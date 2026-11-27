import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan,slotPlan,planProduct,promptForSlot} from '../src/planner.mjs';
import {createImageProvider} from '../src/provider.mjs';
import {prepareTemuImage,temuFormats,TEMU_MAX_IMAGE_BYTES,verifyTemuImages} from '../src/temu.mjs';

const sample=await sharp({create:{width:120,height:180,channels:3,background:'#2468ac'}}).png().toBuffer();
const basePayload={platform:'temu',design_scope:'temu_main',product_name:'测试帆布画',product_desc:'已确认：蓝色画面，单幅，保留原有画框',image_ratio:'1:1',image_count:3,generation_mode:'fast',visual_style:'scene_advertising',target_lang:'English'};
async function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-api-'));
  const calls=[];
  const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async p=>{calls.push(p);return sample;},...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await (await fetch(base+'/api/session')).json();
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  const call=async(url,payload)=>{const response=await fetch(base+url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:response.status,data:await response.json()};};
  const settle=async key=>{for(let i=0;i<200;i++){const {data}=await call('/api/tasks/'+key);if(['completed','failed'].includes(data?.status))return data;await new Promise(r=>setTimeout(r,20));}throw new Error('Task timed out');};
  const plan=async(p=basePayload,id='plan')=>{assert.equal((await call('/api/agent',{...p,agent_task_id:id})).status,202);return settle('agent_tasks/'+id);};
  return {...app,base,call,settle,plan,calls,directory};
}

test('Temu plans only the chosen number of square main images; Amazon A+ remains',()=>{
  for(const ratio of ['1:1'])for(const count of [1,3,7]) {
    const payload={...basePayload,image_ratio:ratio,image_count:count},plan=buildPlan(payload);
    assert.equal(plan.sections.length,count);assert.ok(plan.sections.every(s=>s.ratio===ratio && s.slot<7));
    assert.doesNotMatch(plan.text,/A\+|亚马逊/);assert.match(plan.text,/Temu/);
    assert.match(promptForSlot(payload,plan.sections[0],plan),/非白色环境/);
    assert.doesNotMatch(promptForSlot(payload,plan.sections[0],plan),/白底产品主图|白底、产品完整/);
  }
  const legacy=buildPlan({product_name:'水杯',product_desc:'蓝色',design_scope:'main_6_premium_aplus'});
  assert.equal(legacy.sections.length,12);assert.equal(legacy.sections[7].ratio,'21:9');
  assert.match(promptForSlot({},legacy.sections[0],legacy),/白底、产品完整/);
  assert.doesNotMatch(legacy.text,/Temu/);
});

test('invalid Temu counts, ratios, A+ and ultra are rejected',()=>{
  for(const patch of [{image_count:0},{image_count:8},{image_count:1.5},{image_count:'3'},{image_ratio:'16:9'},{image_ratio:'3:4'},{custom_layout:{aplus:5}},{design_scope:'main_6_premium_aplus'},{generation_mode:'ultra_fast'},{mobile_reformat:true}])assert.throws(()=>slotPlan({...basePayload,...patch}));
});

test('image fitting preserves the entire source and exports exact pixels',async()=>{
  for(const ratio of ['1:1','3:4']) {
    const result=await prepareTemuImage(sample,ratio),meta=await sharp(result.bytes).metadata();
    assert.equal(meta.width,temuFormats[ratio].width);assert.equal(meta.height,temuFormats[ratio].height);
    const {data,info}=await sharp(result.bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
    assert.deepEqual([...data.subarray(0,3)],[255,255,255],'contain adds margin instead of cropping');
    const middle=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels;
    assert.deepEqual([...data.subarray(middle,middle+3)],[36,104,172]);
  }
  const sameRatio=await sharp({create:{width:300,height:400,channels:3,background:'#2468ac'}}).png().toBuffer();
  assert.equal((await prepareTemuImage(sameRatio,'3:4')).fitted,false,'resizing at the same ratio does not claim to add borders');
});

test('upload, plan, ordered generation, download and independent drafts work end to end',async t=>{
  const app=await fixture(t),source=app.saveImage(sample);
  const payload={...basePayload,categorized_images:[{filename:'产品主体图.png',url:source}]};
  const plan=await app.plan(payload);assert.equal(plan.status,'completed');
  const tasks=plan.plan.sections.map(s=>({slot:s.slot,taskId:'temu_'+s.slot,aspect_ratio:'1:1'}));
  const request={...payload,agent_task_id:'plan',sop_text:plan.result,firebase_tasks:tasks};
  assert.equal((await app.call('/api/generate',request)).status,202);
  assert.equal((await app.call('/api/generate',request)).status,202,'repeat submission reuses IDs');
  const images=[];
  for(const task of tasks){const done=await app.settle('hyrule_tasks/'+task.taskId);assert.equal(done.status,'completed',done.error);assert.deepEqual(done.dimensions,{width:1024,height:1024,ratio:'1:1'});images.push(done.imageUrl);}
  assert.equal(app.calls.length,3);assert.ok(app.calls.every(p=>p.ratio==='1:1' && p.platform==='temu' && p.references[0]===source));
  assert.doesNotMatch(app.calls[0].prompt,/【卖点图1】/);
  const bytes=Buffer.from(await(await fetch(app.base+images[0])).arrayBuffer());assert.equal((await sharp(bytes).metadata()).width,1024);
  const draft={platform:'temu',title:'Temu 测试',image_ratio:'1:1',images,skus:[],sop:plan.result};
  const saved=await app.call('/api/drafts',draft);assert.equal(saved.status,200);assert.deepEqual(saved.data.mainImages,saved.data.detailImages);assert.deepEqual(saved.data.mainImages,images);assert.equal(saved.data.skuPreviewPolicy,'preserve-source');
  const amazon=await app.call('/api/drafts',{title:'Amazon 测试',platform:'Amazon',images:[source],skus:[]});assert.equal(amazon.status,200);
  assert.deepEqual((await app.call('/api/drafts')).data.map(d=>d.title),['Amazon 测试']);
  assert.deepEqual((await app.call('/api/drafts?platform=temu')).data.map(d=>d.title),['Temu 测试']);
  assert.equal((await app.call('/api/drafts',{...draft,id:amazon.data.id})).status,400);
  assert.equal((await app.call('/api/drafts',{...draft,images:[source]})).status,400,'incorrect pixels cannot enter the package');
});

test('large generated square images stay below 2 MB through download, export and ERP import',async t=>{
  const noisy=await sharp(crypto.randomBytes(1024*1024*3),{raw:{width:1024,height:1024,channels:3}}).png().toBuffer();
  assert.ok(noisy.length>TEMU_MAX_IMAGE_BYTES);
  const app=await fixture(t,{provider:async()=>noisy});
  const payload={...basePayload,image_count:1},plan=await app.plan(payload);
  assert.equal((await app.call('/api/generate',{...payload,agent_task_id:'plan',sop_text:plan.result,firebase_tasks:[{slot:0,taskId:'large_square',aspect_ratio:'1:1'}]})).status,202);
  const task=await app.settle('hyrule_tasks/large_square');assert.equal(task.status,'completed',task.error);
  assert.match(task.imageUrl,/\.jpg$/);
  const response=await fetch(app.base+task.imageUrl),bytes=Buffer.from(await response.arrayBuffer());
  assert.match(response.headers.get('content-type'),/image\/jpeg/);assert.ok(bytes.length<=TEMU_MAX_IMAGE_BYTES);
  const meta=await sharp(bytes).metadata();assert.equal(meta.width,1024);assert.equal(meta.height,1024);
  const draft=await app.call('/api/drafts',{platform:'temu',image_ratio:'1:1',title:'Square product',images:[task.imageUrl],skus:[]});
  assert.equal(draft.status,200);assert.equal(draft.data.skuPreviewPolicy,'preserve-source');
  const imported=await app.call('/api/temu/erp/import-generated',{draftId:draft.data.id});assert.equal(imported.status,200);
  const upload=Buffer.from(await(await fetch(app.base+imported.data.folders[0].images[0].url)).arrayBuffer());
  assert.ok(upload.length<=TEMU_MAX_IMAGE_BYTES);const uploadMeta=await sharp(upload).metadata();assert.equal(uploadMeta.width,1024);assert.equal(uploadMeta.height,1024);
  const oversized=path.join(app.directory,'oversized.png');fs.writeFileSync(oversized,noisy);
  await assert.rejects(verifyTemuImages([oversized],'1:1'),/超过 2 MB/);
});

test('changed inputs, mismatched ratios and duplicate slots fail before charging or generation',async t=>{
  const app=await fixture(t);const plan=await app.plan();
  const valid={...basePayload,agent_task_id:'plan',sop_text:plan.result,firebase_tasks:[{slot:0,taskId:'new'}]};
  for(const change of [{product_desc:'different product'},{image_ratio:'3:4'},{image_count:4},{firebase_tasks:[{slot:0,taskId:'a',aspect_ratio:'3:4'}]},{firebase_tasks:[{slot:7,taskId:'a'}]},{firebase_tasks:[{slot:0,taskId:'a'},{slot:0,taskId:'b'}]},{agent_task_id:'missing'}]) {
    assert.ok((await app.call('/api/generate',{...valid,...change})).status>=400);
  }
  assert.equal(app.calls.length,0);assert.equal(app.store.state.charges.length,1);assert.equal(app.store.state.charges[0].amount,0);
});

test('Temu editing and recovered downloads retain format without generating again',async t=>{
  let generationCalls=0,downloads=0;
  const app=await fixture(t,{provider:async({onProgress})=>{generationCalls++;await onProgress({resultUrl:'https://example.com/already-generated.png',phase:'downloading'});throw new Error('download interrupted');},download:async()=>{downloads++;return sample;}});
  const image=app.saveImage(sample);
  assert.equal((await app.call('/api/inpaint',{platform:'temu',image_ratio:'1:1',aspect_ratio:'1:1',task_id:'edit',slot_idx:0,prompt:'Keep product',source_image_url:image})).status,202);
  assert.equal((await app.settle('hyrule_tasks/edit')).status,'failed');
  await app.call('/api/downloads/retry',{taskId:'edit'});
  const result=await app.settle('hyrule_tasks/edit');assert.equal(result.status,'completed',result.error);assert.equal(result.dimensions.width,1024);assert.equal(result.dimensions.height,1024);assert.equal(generationCalls,1);assert.equal(downloads,1);
});

test('the workspace homepage is shared while former design URLs preserve Temu',async t=>{
  const app=await fixture(t);
  const home=await fetch(app.base+'/');assert.equal(new URL(home.url).pathname,'/cockpit.html');assert.match(await home.text(),/workspace-shell\.js/);
  for(const route of ['/index.html','/temu','/temu/','/temu.html']){
    const html=await(await fetch(app.base+route)).text();
    assert.match(html,/<title>单品设计 · 跨境工作台/);assert.match(html,/"platform":"temu"/);assert.match(html,/shared-temu\.js/);assert.match(html,/id="designScope"/);assert.match(html,/original-01\.js/);
  }
  const amazon=await(await fetch(app.base+'/design?platform=amazon')).text();assert.match(amazon,/"platform":"amazon"/);assert.doesNotMatch(amazon,/src="\/local\/shared-temu\.js"/);
  assert.equal((await fetch(app.base+'/amazon')).status,404);
  const config=await app.call('/api/temu/config');assert.equal(config.data.workspacePlatform,'temu');assert.equal(config.data.fissionEnabled,true);assert.equal(config.data.publishEnabled,false);
});

test('Temu provider requests exact 3:4 size; Amazon uses its original mapping',async t=>{
  const received=[];
  const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);received.push(JSON.parse(Buffer.concat(chunks)));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:sample.toString('base64')}]}));});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  const provider=createImageProvider({SUANZHOU_IMAGE_API_KEY:'test-only',SUANZHOU_IMAGE_BASE_URL:'http://127.0.0.1:'+upstream.address().port},os.tmpdir());
  await provider({prompt:'test',ratio:'3:4',platform:'temu'});await provider({prompt:'test',ratio:'3:4'});
  assert.deepEqual(received.map(r=>r.size),['1152x1536','1024x1536']);
});

test('Temu text planner uses its own rules and rejects unexpected A+ output',async t=>{
  let extra=false;const received=[];
  const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);received.push(JSON.parse(Buffer.concat(chunks)));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:buildPlan(basePayload).text+(extra?'\n\n【高级A+模块1】\nunwanted module':'')}}]}));});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  const config={PLANNER_BASE_URL:'http://127.0.0.1:'+upstream.address().port,PLANNER_API_KEY:'test-only',PLANNER_MODEL:'test'};
  const plan=await planProduct(basePayload,config);assert.equal(plan.sections.length,3);
  assert.doesNotMatch(received[0].messages.map(m=>m.content).join('\n'),/A\+ 不是可选项|七模块/);
  extra=true;await assert.rejects(planProduct(basePayload,config),/本套范围以外/);
});
