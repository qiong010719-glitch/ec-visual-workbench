import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench} from '../src/server.mjs';
import {taobaoLink,resolveTaobaoLink,referenceGroups,createTaobaoSource} from '../src/taobao-source.mjs';
import {validateBenchmarkLayout,analyzeBenchmark,TaobaoBenchmarks} from '../src/taobao-benchmarks.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
const layout={background:'暖色背景',palette:['米色'],typography:'上方大标题，下方小标签',reading_order:['title','product'],regions:[{id:'title',kind:'text',box:[0.05,0.02,0.9,0.15],description:'顶部标题',style:'大字，左对齐',max_chars:16},{id:'product',kind:'product',box:[0.1,0.2,0.8,0.7],description:'下方完整产品'}]};
const link='https://item.taobao.com/item.htm?id=12345678901234567890';
const groups={main:['https://img.alicdn.com/main.jpg'],sku:['https://img.alicdn.com/sku.jpg'],detail:['https://img.alicdn.com/detail.jpg']};
async function fixture(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taobao-benchmark-')),calls={collect:0,analyze:0,generate:[]};
  const source={configured:async()=>true,resolve:async input=>taobaoLink(input),getItem:async()=>{calls.collect++;return {title:'对标品牌 超强999W（不是本品事实）',groups};}};
  const app=createWorkbench({dataDirectory:directory,configuration:{},researchOptions:{client:{configured:false}},provider:async p=>{calls.generate.push(p);return png;},benchmarkOptions:{source,download:async()=>png,analyze:async()=>{calls.analyze++;return layout;},...options}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await(await fetch(base+'/api/session')).json();
  const call=async(route,body)=>{const r=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const wait=async route=>{for(let i=0;i<200;i++){const {data}=await call(route);if(!['pending','running'].includes(data.status))return data;await new Promise(r=>setTimeout(r,10));}throw Error('Task did not finish');};
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  return {...app,calls,directory,call,wait};
}
async function ready(app){
  assert.equal((await app.call('/api/taobao/benchmarks',{request_id:'import_test',link})).status,202);
  const job=await app.wait('/api/taobao/benchmarks/import_test');assert.equal(job.status,'completed');
  assert.equal((await app.call('/api/taobao/benchmark-analyses',{request_id:'analyze_test',job_id:job.id,asset_ids:job.assets.map(a=>a.id)})).status,202);
  assert.equal((await app.wait('/api/taobao/benchmark-analyses/analyze_test')).status,'completed');return (await app.call('/api/taobao/benchmarks/'+job.id)).data;
}
test('Taobao intake keeps long IDs as strings, restricts hosts and rejects multi-link input',()=>{
  assert.equal(taobaoLink('分享 '+link+'。').itemId,'12345678901234567890');
  assert.equal(taobaoLink('https://detail.tmall.com/item.htm?id=123456').itemId,'123456');
  for(const bad of ['https://127.0.0.1/item.htm?id=123456','https://item.taobao.com.evil.com/?id=123456','https://user@item.taobao.com/item.htm?id=123456','https://item.taobao.com:8443/?id=123456',link+' '+link,'file:///secret'])assert.throws(()=>taobaoLink(bad));
});
test('share resolution reads only allowed landing pages, never the resolved item HTML',async()=>{
  const seen=[];const result=await resolveTaobaoLink('https://e.tb.cn/abc',async url=>{seen.push(url);return new Response('',{status:302,headers:{location:link}});});
  assert.equal(result.itemId,'12345678901234567890');assert.deepEqual(seen,['https://e.tb.cn/abc']);
  await assert.rejects(resolveTaobaoLink('https://e.tb.cn/bad',async()=>new Response('',{status:302,headers:{location:'http://localhost/private'}})));
});
test('images retain source group and order, excluding unrelated external hosts and recommendation images',()=>{
  const result=referenceGroups({item_imgs:[{url:'//img.alicdn.com/1.jpg'},{url:'https://img.alicdn.com/1.jpg'},{url:'http://127.0.0.1/a.png'}],pic_url:'https://img.alicdn.com/2.jpg',desc:'<img data-src="//img.alicdn.com/d.jpg">',prop_imgs:{prop_img:[{url:'https://img.alicdn.com/s.jpg'}]},recommendations:{images:['https://img.alicdn.com/unrelated.jpg']}});
  assert.deepEqual(result,{main:['https://img.alicdn.com/1.jpg','https://img.alicdn.com/2.jpg'],detail:['https://img.alicdn.com/d.jpg'],sku:['https://img.alicdn.com/s.jpg']});
  assert.deepEqual(referenceGroups({pic_url:'https://img.alicdn.com/main.jpg'}).detail,[]);
});
test('OneBound reuses injected credentials without exposing them; timeout submits only once',async()=>{
  let count=0;const credentials={key:'test-key-secret',secret:'test-secondary-secret'};
  const source=createTaobaoSource({keyReader:async()=>credentials,fetcher:async url=>{
    count++;assert.equal(url.searchParams.get('num_iid'),'12345678901234567890');assert.equal(url.searchParams.get('lang'),'zh-CN');assert.equal(url.searchParams.get('cache'),'no');
    return new Response(JSON.stringify({item:{title:credentials.key,item_imgs:[{url:groups.main[0]}]},echo:credentials.secret}));
  }});
  assert.equal(await source.configured(),true);const result=await source.getItem('12345678901234567890');
  assert.equal(count,1);assert.doesNotMatch(JSON.stringify(result),/test-key-secret|test-secondary-secret/);
  let failed=0;const broken=createTaobaoSource({keyReader:async()=>credentials,fetcher:async()=>{failed++;throw Error('secret '+credentials.key);}});
  await assert.rejects(broken.getItem('123456'),error=>!error.message.includes(credentials.key));assert.equal(failed,1);
});
test('visual analysis sends actual bytes and rejects invalid or out-of-canvas layouts',async()=>{
  let request;const result=await analyzeBenchmark(png,'image/png',{VISION_BASE_URL:'https://vision.example/v1',VISION_API_KEY:'test-only',VISION_MODEL:'fixture'},async(_url,init)=>{request=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(layout)}}]}));});
  assert.deepEqual(result,layout);assert.ok(request.messages[1].content[1].image_url.url.endsWith(png.toString('base64')));
  assert.match(request.messages[0].content,/不要抄录竞品文案/);
  assert.throws(()=>validateBenchmarkLayout({...layout,regions:[{...layout.regions[1],box:[0.8,0,0.8,1]}]}));
  assert.throws(()=>validateBenchmarkLayout({...layout,reading_order:['missing']}));
});
test('import and analysis are idempotent, cached, persisted, and do not generate images',async t=>{
  const app=await fixture(t);await ready(app);
  await app.call('/api/taobao/benchmarks',{request_id:'import_test',link});
  assert.equal((await app.call('/api/taobao/benchmarks',{request_id:'import_test',link:'https://item.taobao.com/item.htm?id=654321'})).status,409);
  await app.call('/api/taobao/benchmarks',{request_id:'cached_test',link});const cached=await app.wait('/api/taobao/benchmarks/cached_test');
  assert.equal(cached.cachedFrom,'import_test');assert.equal(app.calls.collect,1);assert.equal(app.calls.analyze,3);assert.equal(app.calls.generate.length,0);
  await app.call('/api/taobao/benchmark-analyses',{request_id:'cached_analysis',job_id:'cached_test',asset_ids:['main_1']});
  await app.wait('/api/taobao/benchmark-analyses/cached_analysis');assert.equal(app.calls.analyze,3);
  const reopened=new TaobaoBenchmarks({directory:path.join(app.directory,'taobao-benchmarks'),mediaDirectory:app.mediaDirectory});assert.ok(reopened.get('cached_test').assets[0].layout);
});
test('bound main, SKU and detail keep own identities, per-slot ratios and distinct benchmarks in actual generation requests',async t=>{
  const app=await fixture(t);const job=await ready(app),own=app.saveImage(png),sku=app.saveImage(Buffer.concat([png,Buffer.from('sku') ]));
  const payload={agent_task_id:'bound_plan',product_name:'本品收纳柜',product_desc:'白色柜体，仅有已提供款式',design_scope:'custom',custom_layout:{main:1,sub:1,aplus:1},visual_style:'original',categorized_images:[{filename:'产品主体图_1',url:own},{filename:'SKU图_1',url:sku}],slot_directives:[
    {slot:0,aspect_ratio:'1:1',ref_images:['产品主体图_1'],benchmark:{job_id:job.id,asset_id:'main_1'}},
    {slot:1,aspect_ratio:'1:1',ref_images:['SKU图_1'],benchmark:{job_id:job.id,asset_id:'sku_1'}},
    {slot:7,aspect_ratio:'3:4',ref_images:['产品主体图_1'],benchmark:{job_id:job.id,asset_id:'detail_1'}}]};
  assert.equal((await app.call('/api/agent',payload)).status,202);const plan=await app.wait('/api/tasks/agent_tasks/bound_plan');
  assert.equal(plan.status,'completed');assert.match(plan.result,/本图绑定对标 detail_1/);assert.doesNotMatch(plan.result,/超强999W|对标品牌/);
  const images={...payload,sop_text:plan.result,firebase_tasks:[0,1,7].map(slot=>({slot,taskId:'bound_image_'+slot,aspect_ratio:slot===7?'3:4':'1:1'}))};
  assert.equal((await app.call('/api/generate',images)).status,202);
  for(const slot of [0,1,7])assert.equal((await app.wait('/api/tasks/hyrule_tasks/bound_image_'+slot)).status,'completed');
  assert.equal(app.calls.generate.length,3);
  for(const [i,expectedOwn] of [[0,own],[1,sku],[2,own]]){
    const request=app.calls.generate[i];assert.deepEqual(request.references,[expectedOwn,job.assets[i].localUrl]);assert.match(request.prompt,/最后1张只定义本图版式/);
  }
  assert.equal(app.calls.generate[2].ratio,'3:4');
  const task=(await app.call('/api/tasks/hyrule_tasks/bound_image_1')).data;assert.equal(task.benchmark.assetId,'sku_1');assert.deepEqual(task.referenceRoles.map(r=>r.role),['own-product','benchmark-layout']);
  const changed=structuredClone(images);changed.slot_directives[0].benchmark.asset_id='sku_1';changed.firebase_tasks=[{slot:0,taskId:'changed_ref'}];
  assert.equal((await app.call('/api/generate',changed)).status,409);assert.equal(app.calls.generate.length,3);
});

test('explicit re-import replaces an unusable cached image instead of returning it forever',async t=>{
  const app=await fixture(t);const job=await ready(app);
  fs.unlinkSync(path.join(app.mediaDirectory,path.basename(job.assets[0].localUrl)));
  await app.call('/api/taobao/benchmarks',{request_id:'replace_missing',link});
  const replacement=await app.wait('/api/taobao/benchmarks/replace_missing');
  assert.equal(replacement.status,'completed');assert.equal(replacement.cachedFrom,undefined);
  assert.equal(app.calls.collect,2);assert.equal(app.calls.analyze,3);assert.equal(app.calls.generate.length,0);
  assert.notEqual(replacement.assets[0].localUrl,job.assets[0].localUrl);
  assert.equal(replacement.assets[0].layout,undefined);
});
test('unanalysed, tampered, cross-category or identity-free benchmark use stops before image calls',async t=>{
  const app=await fixture(t);await app.call('/api/taobao/benchmarks',{request_id:'raw_import',link});await app.wait('/api/taobao/benchmarks/raw_import');
  const payload={product_name:'杯子',product_desc:'白色杯身',design_scope:'custom',custom_layout:{main:1,aplus:1},sop_text:'【主图】\n杯子\n【高级A+模块1】\n细节',firebase_tasks:[{slot:0,taskId:'blocked_image'}],slot_directives:[{slot:0,benchmark:{job_id:'raw_import',asset_id:'main_1'}}]};
  assert.equal((await app.call('/api/generate',payload)).status,400);
  const job=await ready(app);payload.slot_directives[0].benchmark.job_id=job.id;
  assert.equal((await app.call('/api/generate',payload)).status,400,'no own image');
  payload.images=[app.saveImage(png)];payload.slot_directives=[{slot:7,benchmark:{job_id:job.id,asset_id:'main_1'}}];payload.firebase_tasks=[{slot:7,taskId:'bad_detail'}];
  assert.equal((await app.call('/api/generate',payload)).status,400);
  payload.slot_directives=[{slot:0,benchmark:{job_id:job.id,asset_id:'main_1'}}];payload.firebase_tasks=[{slot:0,taskId:'bad_hash'}];
  fs.appendFileSync(path.join(app.mediaDirectory,path.basename(job.assets[0].localUrl)),'changed');
  assert.equal((await app.call('/api/generate',payload)).status,400);assert.equal(app.calls.generate.length,0);
});
test('partial downloads and failed analysis keep completed work, never auto-resubmit, and mark interruption on restart',async t=>{
  let attempts=0;const app=await fixture(t,{download:async url=>{if(url.includes('detail'))throw Error('failed');return png;},analyze:async()=>{attempts++;if(attempts===2)throw Error('result unknown');return layout;}});
  await app.call('/api/taobao/benchmarks',{request_id:'partial_import',link});const job=await app.wait('/api/taobao/benchmarks/partial_import');assert.equal(job.status,'partial');
  await app.call('/api/taobao/benchmark-analyses',{request_id:'partial_analysis',job_id:job.id,asset_ids:['main_1','sku_1']});
  assert.equal((await app.wait('/api/taobao/benchmark-analyses/partial_analysis')).status,'failed');assert.equal(attempts,2);
  assert.ok(app.benchmarks.get(job.id).assets[0].layout);
  await app.call('/api/taobao/benchmark-analyses',{request_id:'partial_analysis',job_id:job.id,asset_ids:['main_1','sku_1']});assert.equal(attempts,2);
  app.benchmarks.state.analyses.interrupted={status:'running'};app.benchmarks.save();
  const reopened=new TaobaoBenchmarks({directory:path.join(app.directory,'taobao-benchmarks'),mediaDirectory:app.mediaDirectory});assert.equal(reopened.state.analyses.interrupted.status,'failed');assert.equal(attempts,2);
});
