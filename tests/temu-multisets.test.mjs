import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';
import {temuFormats} from '../src/temu.mjs';

const png=await sharp({create:{width:120,height:160,channels:3,background:'#abcdee'}}).png().toBuffer();
async function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-sets-')),calls=[];
  const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async p=>{calls.push(p);return png;},...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  const api='/api/temu/multisets';
  const call=async(url,payload)=>{const r=await fetch(base+url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
  const wait=async(id,predicate)=>{for(let i=0;i<400;i++){const {data}=await call(api+'/'+id);if(predicate(data))return data;await new Promise(r=>setTimeout(r,15));}throw new Error('Temu group timed out');};
  t.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  const source={platform:'temu',design_scope:'temu_main',product_name:'米色帆布画',product_desc:'单幅，米色画面，保留原框与可见纹理。',image_ratio:'3:4',image_count:2,generation_mode:'fast',visual_style:'scene_advertising',target_lang:'English',categorized_images:[{filename:'产品主体图.png',url:app.saveImage(png)}]};
  const create=async(extra={})=>{const r=await call(api,{request_id:crypto.randomUUID(),source,count:2,variation:'both',model:'gpt-image-2.5-sunburst',...extra});assert.equal(r.status,202,JSON.stringify(r.data));return wait(r.data.id,g=>g.recommendation.status==='completed');};
  const plan=async g=>{const r=await call(api+'/'+g.id+'/plan',{});assert.equal(r.status,202,JSON.stringify(r.data));return wait(g.id,g=>g.sets.every(s=>s.planning.status==='completed'));};
  const generate=async(g,setId)=>{const r=await call(api+'/'+g.id+'/generate',setId?{setId}:{});assert.equal(r.status,202,JSON.stringify(r.data));return wait(g.id,g=>(setId?g.sets.filter(s=>s.id===setId):g.sets).every(s=>s.images.every(i=>i.task?.status==='completed')));};
  return {...app,base,directory,calls,call,api,wait,create,plan,generate,source};
}

test('Temu accepts 20 independent full seven-image plans, retains Amazon limits and platform isolation',async t=>{
  const a=await fixture(t);
  const config=(await a.call(a.api+'/config')).data;
  assert.equal(config.maxSets,20);assert.equal(config.styles.length,20);
  const amazon=(await a.call('/api/multisets/config')).data;assert.equal(amazon.maxSets,10);assert.equal(amazon.styles.length,10);
  let g=await a.create({count:20,source:{...a.source,image_count:7}});
  assert.equal(g.totalImages,140);assert.equal(new Set(g.sets.map(s=>s.direction.styleId)).size,20);
  g=await a.plan(g);assert.equal(new Set(g.sets.map(s=>s.planId)).size,20);
  for(const set of g.sets){assert.equal(set.plan.sections.length,7);assert.doesNotMatch(set.plan.text,/A\+|亚马逊/);assert.ok(set.plan.sections.every(s=>s.ratio==='3:4'));}
  assert.equal((await a.call('/api/multisets')).data.length,0);
  assert.equal((await a.call('/api/multisets/'+g.id)).status,404);
  assert.equal((await a.call('/api/multisets/'+g.id+'/generate',{})).status,404);
  for(const count of [0,21,2.5,'20'])assert.equal((await a.call(a.api,{source:a.source,count,request_id:crypto.randomUUID()})).status,400);
  assert.equal((await a.call('/api/multisets',{source:a.source,count:2,request_id:crypto.randomUUID()})).status,400);
  assert.equal(a.calls.length,0);
  const style=await a.create({count:20,variation:'style',sharedAudience:'关注画面搭配的用户'});
  assert.ok(style.sets.every(s=>s.direction.audience===style.sharedAudience));
  const audience=await a.create({count:20,variation:'audience',sharedStyle:'temu-macro'});
  assert.ok(audience.sets.every(s=>s.direction.styleId==='temu-macro'));assert.equal(new Set(audience.sets.map(s=>s.direction.audience)).size,20);
});

test('Temu multi-set generation and listing packages keep ratios, ordered references, IDs and selected model',async t=>{
  const a=await fixture(t);
  for(const ratio of ['1:1','3:4']){
    let g=await a.plan(await a.create({source:{...a.source,image_ratio:ratio}}));
    assert.equal((await a.call(a.api+'/'+g.id+'/export',{})).status,409);
    g=await a.generate(g,g.sets[1].id);
    assert.equal((await a.call(a.api+'/'+g.id+'/export',{})).status,409,'partial batch cannot masquerade as complete');
    const single=await a.call(a.api+'/'+g.id+'/export',{setId:g.sets[1].id});assert.equal(single.status,200);
    assert.equal(single.data.manifest.sets[0].setIndex,2,'single export preserves original index');
    assert.equal(single.data.manifest.setCount,1);assert.equal(single.data.manifest.batchSetCount,2);
    g=await a.generate(g);
    const exported=await a.call(a.api+'/'+g.id+'/export',{});assert.equal(exported.status,200,JSON.stringify(exported.data));
    const {manifest,drafts}=exported.data;
    assert.equal(manifest.sets.length,2);assert.equal(manifest.files.length,4);assert.equal(manifest.published,false);
    for(const set of manifest.sets){assert.deepEqual(set.mainImages,set.detailImages);assert.equal(set.skuPreviewPolicy,'preserve-source');assert.equal(set.mainImages.length,2);}
    for(const file of manifest.files){
      const bytes=Buffer.from(await (await fetch(a.base+file.url)).arrayBuffer());
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);
      const meta=await sharp(bytes).metadata();assert.equal(meta.width,temuFormats[ratio].width);assert.equal(meta.height,temuFormats[ratio].height);
    }
    const again=await a.call(a.api+'/'+g.id+'/export',{});assert.deepEqual(again.data.drafts.map(d=>d.id),drafts.map(d=>d.id));
    assert.equal(a.store.state.drafts.filter(d=>d.groupId===g.id).length,2,'exports update existing drafts');
    assert.equal((await a.call('/api/drafts')).data.length,0);
    await a.call(a.api+'/'+g.id+'/generate',{});
    for(const set of g.sets)for(const image of set.images){const task=a.store.state.tasks['hyrule_tasks/'+image.task.taskId];assert.equal(task.groupId,g.id);assert.equal(task.setId,set.id);assert.ok(task.prompt.includes(set.direction.audience));}
  }
  assert.equal(a.calls.length,8,'export, reload and duplicate generate never call image service again');
  assert.ok(a.calls.every(p=>p.platform==='temu'&&p.model==='gpt-image-2.5-sunburst'&&p.references.includes(a.source.categorized_images[0].url)));
});

test('Temu export validates all files before creating any draft and retries only one slot',async t=>{
  const a=await fixture(t);let g=await a.generate(await a.plan(await a.create()));
  const victim=path.join(a.directory,'media',path.basename(g.sets[1].images[1].task.imageUrl));
  const original=fs.readFileSync(victim);fs.writeFileSync(victim,png);
  assert.equal((await a.call(a.api+'/'+g.id+'/export',{})).status,400);assert.equal(a.store.state.drafts.length,0);
  fs.rmSync(victim);assert.equal((await a.call(a.api+'/'+g.id+'/export',{})).status,409);assert.equal(a.store.state.drafts.length,0);
  fs.writeFileSync(victim,original);
  const ids=g.sets.map(s=>s.images.map(i=>i.task.taskId));
  const retry={setId:g.sets[0].id,slot:1,mode:'regenerate',request_id:crypto.randomUUID()};
  assert.equal((await a.call(a.api+'/'+g.id+'/retry',retry)).status,202);
  g=await a.wait(g.id,g=>g.phase==='completed');await a.call(a.api+'/'+g.id+'/retry',retry);
  assert.equal(a.calls.length,5);assert.equal(g.sets[0].images[0].task.taskId,ids[0][0]);assert.deepEqual(g.sets[1].images.map(i=>i.task.taskId),ids[1]);
  assert.ok(g.sets[0].images[1].previousResult.imageUrl);
  assert.equal((await a.call(a.api+'/'+g.id+'/export',{})).status,200);
});
