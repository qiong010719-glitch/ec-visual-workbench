import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan,slotPlan} from '../src/planner.mjs';
import {normalizeProduct} from '../src/reference-library.mjs';
import {imageType,resolveImage,createImageProvider} from '../src/provider.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
async function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-workbench-test-'));
  const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async()=>png,...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await (await fetch(base+'/api/session')).json();
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  const call=async(url,payload)=>{
    const response=await fetch(base+url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});
    return {response,data:await response.json()};
  };
  const settled=async key=>{
    for(let i=0;i<100;i++) {const {data}=await call('/api/tasks/'+key);if(['completed','failed'].includes(data?.status))return data;await new Promise(r=>setTimeout(r,10));}
    throw new Error('Task did not settle');
  };
  return {...app,base,token,call,settled,directory};
}

test('stale scene plans require replanning before image charges or provider calls',async t=>{
  let calls=0;
  const app=await fixture(t,{provider:async()=>{calls++;return png;}});
  const payload={product_name:'Sunglasses',product_desc:'Black frame',design_scope:'main_only',visual_style:'scene_advertising'};
  const old=buildPlan(payload);old.visualStyle.version=2;
  app.store.task('agent_tasks/old_scene',{status:'completed',payload,plan:old});
  const before=app.store.state.balance;
  for(const endpoint of ['/api/generate','/api/ultra_generate']){
    const {response,data}=await app.call(endpoint,{agent_task_id:'old_scene',product_name:payload.product_name,sop_text:old.text,firebase_tasks:[{slot:0,taskId:'stale_'+calls}]});
    assert.equal(response.status,409);assert.match(data.error,/重新构思/);
  }
  assert.equal(calls,0);assert.equal(app.store.state.balance,before);
});

test('saved original plans remain usable and new scene evidence reaches the provider',async t=>{
  const captured=[];const app=await fixture(t,{provider:async p=>{captured.push(p);return png;}});
  for(const style of ['original','scene_advertising']){
    const payload={agent_task_id:style,product_name:'Black sunglasses',product_desc:'Black frame',design_scope:'custom',custom_layout:{main:0,sub:0,aplus:7},visual_style:style};
    await app.call('/api/agent',payload);const agent=await app.settled('agent_tasks/'+style);
    const result=await app.call('/api/generate',{agent_task_id:style,sop_text:'【高级A+模块7】\nUSER_EDIT_KEEP',firebase_tasks:[{slot:13,taskId:style+'_image'}]});
    assert.equal(result.response.status,202);
    const task=await app.settled('hyrule_tasks/'+style+'_image');assert.equal(task.status,'completed');
    assert.match(captured.at(-1).prompt,/USER_EDIT_KEEP/);
    if(style==='scene_advertising'){
      assert.ok(captured.at(-1).prompt.includes(agent.plan.sections[6].storyboard.informationIncrement));
      assert.equal(task.visualStyle.version,3);assert.equal(task.promptVersion,'per-slot-v5');
    }else assert.doesNotMatch(captured.at(-1).prompt,/本图叙事约定/);
  }
});
test('source interface is served and original service keys are absent',async t=>{
  const app=await fixture(t);const response=await fetch(app.base+'/');
  assert.equal(response.status,200);assert.match(await response.text(),/本地复刻/);
  const source=await(await fetch(app.base+'/original/original-01.js')).text();
  assert.doesNotMatch(source,/sb_publishable_|sapient-hub-485206|vxlwmeonxrvntwwdqcew|6d70ba77dad1fd3e/);
});
test('one-image requirements reach one assigned provider prompt while all-image requirements stay shared',async t=>{
  const captured=[];
  const app=await fixture(t,{provider:async p=>{captured.push(p);return png;}});
  const strict_requirements='要有一张图是针对痛点人群，每张图都要有logo';
  const payload={agent_task_id:'scoped_requirements',product_name:'胶原蛋白粉',product_desc:'白色粉末；每份8,500 mg',generation_mode:'master',custom_layout:{main:1,sub:2,aplus:0},strict_requirements};
  await app.call('/api/agent',payload);
  const agent=await app.settled('agent_tasks/scoped_requirements');
  const tasks=[0,1,2].map(slot=>({slot,taskId:'requirement_image_'+slot}));
  const result=await app.call('/api/generate',{agent_task_id:payload.agent_task_id,sop_text:agent.result,strict_requirements,firebase_tasks:tasks});
  assert.equal(result.response.status,202);
  for(const task of tasks)assert.equal((await app.settled('hyrule_tasks/'+task.taskId)).status,'completed');
  assert.equal(captured.filter(p=>p.prompt.includes('要有一张图是针对痛点人群')).length,1);
  assert.doesNotMatch(captured[0].prompt,/痛点人群/);
  assert.ok(captured.every(p=>p.prompt.includes('每张图都要有logo')));
  assert.equal(captured[1].prompt.split('要有一张图是针对痛点人群').length-1,1);
  assert.ok(agent.plan.text.includes('8,500 mg'),'commas in numeric facts must remain intact');
});

test('uploads preserve original bytes and reject executable content',async t=>{
  const app=await fixture(t);
  const response=await fetch(app.base+'/api/media/up',{method:'POST',headers:{'Content-Type':'image/png','X-Workbench-Token':app.token},body:png});
  const data=await response.json();assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await(await fetch(app.base+data.url)).arrayBuffer()),png);
  const bad=await fetch(app.base+'/api/media/up',{method:'POST',headers:{'X-Workbench-Token':app.token},body:'<script>alert(1)</script>'});assert.equal(bad.status,400);
});
test('planning persists the selected product and custom layout',async t=>{
  const app=await fixture(t);
  const result=await app.call('/api/agent',{agent_task_id:'agent_test',product_name:'测试杯',product_desc:'仅测试',design_scope:'main',custom_layout:{main:1,sub:1,aplus:1,aplus_type:'old'},target_lang:'Deutsch'});
  assert.equal(result.response.status,202);const task=await app.settled('agent_tasks/agent_test');
  assert.match(task.result,/测试杯/);assert.match(task.result,/Deutsch/);assert.equal(task.plan.sections.length,3);assert.equal(task.plan.source,'local-rules');
  assert.equal(JSON.parse(fs.readFileSync(app.store.file)).tasks['agent_tasks/agent_test'].status,'completed');
});
test('failed planning retains diagnostic evidence without promoting partial text to a usable plan',async t=>{
  const diagnostics={timeoutMs:300000,elapsedMs:164000,expectedSections:12,returnedSections:7,missingTitles:['【高级A+模块1】']};
  const app=await fixture(t,{planner:async()=>{throw Object.assign(new Error('构思方案缺少完整段落'),{code:'PLANNER_INCOMPLETE',planningDiagnostics:diagnostics,partialPlanText:'【主图】\n尚未完整的设计内容'});}});
  await app.call('/api/agent',{agent_task_id:'incomplete_plan',product_name:'测试盒',product_desc:'蓝色'});
  const task=await app.settled('agent_tasks/incomplete_plan');
  assert.equal(task.status,'failed');assert.equal(task.errorCode,'PLANNER_INCOMPLETE');
  assert.deepEqual(task.planningDiagnostics,diagnostics);
  assert.equal(task.result,undefined);assert.equal(task.plan,undefined);
  assert.equal(task.partialPlanText,undefined,'partial output stays in server-side diagnostics');
  const saved=JSON.parse(fs.readFileSync(app.store.file)).tasks['agent_tasks/incomplete_plan'];
  assert.equal(saved.partialPlanText,'【主图】\n尚未完整的设计内容');
  assert.equal(saved.payload.product_name,'测试盒');
  const reopened=createWorkbench({dataDirectory:app.directory,configuration:{}});t.after(()=>reopened.research.close());
  assert.equal(reopened.store.state.tasks['agent_tasks/incomplete_plan'].partialPlanText,saved.partialPlanText);
});
test('generation is idempotent and references are passed to the image provider',async t=>{
  let calls=0,captured;
  const app=await fixture(t,{provider:async payload=>{calls++;captured=payload;return png;}});
  const image=app.saveImage(png);
  const payload={sop_text:'只生成一张主图',categorized_images:[{filename:'主体.png',url:image}],firebase_tasks:[{taskId:'image_test',slot:0,aspect_ratio:'1:1'}]};
  const a=await app.call('/api/generate',payload);const b=await app.call('/api/generate',payload);
  assert.equal(a.response.headers.get('x-request-id'),b.response.headers.get('x-request-id'));
  const task=await app.settled('hyrule_tasks/image_test');assert.equal(task.status,'completed');assert.equal(calls,1);assert.deepEqual(captured.references,[image]);
  assert.equal(app.store.state.charges.length,1);
});

test('invalid per-slot plans and missing mobile sources fail before any task or charge',async t=>{
  let calls=0;const app=await fixture(t,{provider:async()=>{calls++;return png;}});
  for(const payload of [
    {sop_text:'【主图】\n白底',custom_layout:{main:1,sub:1},firebase_tasks:[{taskId:'valid_first',slot:0},{taskId:'missing_second',slot:1}]},
    {mobile_reformat:true,tasks:[{taskId:'missing_source'}]}
  ])assert.equal((await app.call('/api/generate',payload)).response.status,400);
  assert.equal(calls,0);assert.equal(app.store.state.charges.length,0);assert.equal(Object.keys(app.store.state.tasks).length,0);
});

test('reference evidence reaches planning and separate prompts, while image provider receives only current product images',async t=>{
  const captured=[];const app=await fixture(t,{provider:async p=>{captured.push(p);return png;}});
  const p=normalizeProduct({url:'https://www.amazon.com/dp/B000000001',title:'COMPETITOR Power Bank 50000mAh',brand:'COMPETITOR',images:['https://m.media-amazon.com/competitor.jpg']});
  p.analysis={status:'completed',analyzedAt:'now',tags:['充电宝'],images:[{id:p.assets[0].id,role:'gallery',layout:'竖向分区，图片在下方',lighting:'柔光',transferableGuidance:'标题留白',camera:'俯拍',palette:'浅色',textDensity:'低'}]};app.research.library.upsert(p);
  const payload={agent_task_id:'reference_plan',product_name:'自己的充电宝',product_desc:'蓝色',custom_layout:{main:1,sub:1},reference_ids:[p.id]};
  await app.call('/api/agent',payload);const plan=await app.settled('agent_tasks/reference_plan');assert.equal(plan.plan.source,'reference-rules');assert.match(plan.result,/竖向分区/);assert.doesNotMatch(plan.result,/COMPETITOR|50000mAh/);
  const image=app.saveImage(png);
  assert.equal((await app.call('/api/generate',{...payload,sop_text:plan.result,categorized_images:[{filename:'产品主体图.png',url:image}],firebase_tasks:[{taskId:'own_main',slot:0},{taskId:'own_sub',slot:1}]})).response.status,202);
  await app.settled('hyrule_tasks/own_main');await app.settled('hyrule_tasks/own_sub');
  assert.equal(captured.length,2);assert.ok(captured.every(p=>JSON.stringify(p.references)===JSON.stringify([image])));
  assert.doesNotMatch(captured[0].prompt,/【卖点图1】/);assert.doesNotMatch(captured[1].prompt,/【主图】/);
  assert.equal((await app.call('/api/research/products/'+p.id)).data.analysis.status,'completed');
});
test('failed tasks settle, refund once, and cannot refund successful jobs',async t=>{
  const app=await fixture(t,{provider:async()=>{throw new Error('test provider failure');}});
  const {data}=await app.call('/api/generate',{sop_text:'test',firebase_tasks:[{taskId:'bad_image',slot:0}]});
  assert.equal((await app.settled('hyrule_tasks/bad_image')).status,'failed');
  assert.equal(app.store.state.balance,100000);
  assert.equal((await app.call('/api/refund',{request_id:data.request_id,refund_key:'bad_image'})).data.refunded,0);
});

test('scene style and independent mode directions reach actual provider prompts including ultra',async t=>{
  const captured=[];const app=await fixture(t,{provider:async p=>{captured.push(p);return png;}});
  for(const mode of ['fast','master']){
    const payload={product_name:'宠物营养膏',product_desc:'凝胶质地，易于拌粮',generation_mode:mode,info_density:'high',custom_layout:{sub:1}};
    await app.call('/api/agent',{...payload,agent_task_id:'style_'+mode});await app.settled('agent_tasks/style_'+mode);
    assert.equal((await app.call('/api/generate',{...payload,agent_task_id:'style_'+mode,sop_text:'EDITED\n【卖点图1】\nSLOT_ONLY',firebase_tasks:[{taskId:'style_image_'+mode,slot:1}]})).response.status,202);
    await app.settled('hyrule_tasks/style_image_'+mode);
  }
  assert.match(captured[0].prompt,/快速设计模式.*信息/);assert.match(captured[0].prompt,/中高信息密度/);
  assert.match(captured[1].prompt,/大师模式.*摄影/);assert.doesNotMatch(captured[1].prompt,/中高信息密度/);
  assert.ok(captured.every(p=>p.prompt.includes('整套统一字体')&&p.prompt.includes('SLOT_ONLY')));
  assert.equal((await app.call('/api/ultra_generate',{mode:'ultra_fast',design_scope:'ultra_main_8',product_name:'水杯',product_desc:'蓝色',sop_text:'USER_ULTRA_EDIT',firebase_tasks:[{taskId:'style_ultra',slot:0}]})).response.status,202);
  await app.settled('hyrule_tasks/style_ultra');assert.match(captured[2].prompt,/整套统一字体/);assert.match(captured[2].prompt,/分镜8/);assert.match(captured[2].prompt,/USER_ULTRA_EDIT/);
});

test('changing mode after a saved new plan requires planning again before image calls',async t=>{
  let calls=0;const app=await fixture(t,{provider:async()=>{calls++;return png;}});
  await app.call('/api/agent',{agent_task_id:'fast_plan',generation_mode:'fast',product_name:'水杯',product_desc:'蓝色'});await app.settled('agent_tasks/fast_plan');
  const result=await app.call('/api/generate',{agent_task_id:'fast_plan',generation_mode:'master',product_name:'水杯',firebase_tasks:[{taskId:'mixed_mode',slot:0}]});
  assert.equal(result.response.status,409);assert.equal(calls,0);assert.match(result.data.error,/重新构思/);
});
test('missing dedicated key does not fall back to a general model key',async t=>{
  const app=await fixture(t,{provider:undefined,configuration:{SUANZHOU_API_KEY:'not-an-image-key'}});
  const result=await app.call('/api/generate',{sop_text:'test',firebase_tasks:[{taskId:'no_key',slot:0}]});
  assert.equal(result.response.status,503);assert.equal(app.store.state.charges.length,0);
  await assert.rejects(createImageProvider({SUANZHOU_API_KEY:'wrong'},app.mediaDirectory)({prompt:'test'}),/专用图片密钥/);
});
test('mobile batch API uses each source image independently',async t=>{
  const captured=[];const app=await fixture(t,{provider:async p=>{captured.push(p);return png;}});
  const a=app.saveImage(png),b=app.saveImage(png);
  const result=await app.call('/api/generate',{mobile_reformat:true,tasks:[{taskId:'m1',source_image_url:a},{taskId:'m2',source_image_url:b}]});
  assert.equal(result.response.status,202);await app.settled('hyrule_tasks/m1');await app.settled('hyrule_tasks/m2');
  assert.deepEqual(captured.map(p=>p.references),[[a],[b]]);assert.ok(captured.every(p=>p.ratio==='4:3'));
});
test('quick mobile accepts the original maximum of 20 images',async t=>{
  const app=await fixture(t);const image=app.saveImage(png);
  const tasks=Array.from({length:20},(_,i)=>({taskId:'mobile_'+i,source_image_url:image}));
  assert.equal((await app.call('/api/generate',{mobile_reformat:true,tasks})).response.status,202);
  await app.settled('hyrule_tasks/mobile_19');
  assert.equal(Object.values(app.store.state.tasks).filter(v=>v.status==='completed').length,20);
});
test('inpaint supports original edit studio request shape',async t=>{
  let captured;const app=await fixture(t,{provider:async p=>{captured=p;return png;}});
  const data='data:image/png;base64,'+png.toString('base64');
  const response=await app.call('/api/inpaint',{task_id:'edit_one',slot_idx:-1,prompt:'保留主体',base_image_b64:data,material_images_b64:[data],aspect_ratio:'3:4'});
  assert.equal(response.response.status,202);await app.settled('hyrule_tasks/edit_one');assert.equal(captured.references[0],data);assert.equal(captured.ratio,'3:4');
});
test('drafts save, reopen, update in place, and prohibit publication',async t=>{
  const app=await fixture(t);const image=app.saveImage(png);
  const draft={title:'测试产品',status:'draft',skus:[{code:'SKU-01',name:'测试规格',price:9.9,stock:1}],images:[image]};
  const a=await app.call('/api/drafts',draft);assert.equal(a.data.published,false);
  const b=await app.call('/api/drafts',{...draft,id:a.data.id,title:'更新后的测试产品'});assert.equal(b.data.id,a.data.id);
  const list=(await app.call('/api/drafts')).data;assert.equal(list.length,1);assert.equal(list[0].skus[0].stock,1);
  assert.equal((await app.call('/api/drafts',{...draft,status:'published'})).response.status,400);
});
test('drafts reject duplicate SKUs, fractional stock and missing images',async t=>{
  const app=await fixture(t);const sku={code:'01',name:'测试',price:1,stock:1};
  for(const payload of [{title:'x',skus:[sku,sku]},{title:'x',skus:[{...sku,stock:0.5}]},{title:'x',skus:[],images:['/media/aaaa.png']}]) assert.equal((await app.call('/api/drafts',payload)).response.status,400);
});
test('local service blocks cross-origin mutations, missing token and traversal',async t=>{
  const app=await fixture(t);
  assert.equal((await fetch(app.base+'/api/drafts',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(app.base+'/api/drafts',{method:'POST',headers:{Origin:'https://example.com','X-Workbench-Token':app.token},body:'{}'})).status,403);
  assert.equal((await fetch(app.base+'/%2e%2e%2fpackage.json')).status,403);
  assert.equal((await app.call('/api/publish',{})).response.status,404);
});
test('feedback is saved locally and payment fails explicitly',async t=>{
  const app=await fixture(t);
  const result=await app.call('/api/feedback',{action:'rating',score:5,task_id:'test'});assert.equal(result.data.savedLocally,true);
  assert.equal(app.store.state.feedback.length,1);assert.equal((await app.call('/api/alipay/create',{amount:10})).response.status,501);
});
test('server restart marks uncertain jobs failed instead of auto-resubmitting',async t=>{
  const app=await fixture(t);app.store.task('hyrule_tasks/interrupted',{status:'running'});
  const recovered=createWorkbench({dataDirectory:app.directory,configuration:{}});
  assert.equal(recovered.store.state.tasks['hyrule_tasks/interrupted'].status,'failed');
});
test('planner covers main, A+, THD, custom and ultra scopes',()=>{
  assert.equal(slotPlan({design_scope:'main_6_premium_aplus'}).length,12);
  assert.equal(slotPlan({design_scope:'thd'}).length,7);
  assert.equal(slotPlan({design_scope:'ultra_main_8'}).length,1);
  assert.match(buildPlan({product_name:'x',product_desc:'y'}).text,/不虚构/);
});
test('image validation and SSRF checks reject non-image and private-network input',async()=>{
  assert.deepEqual(imageType(png),['image/png','.png']);assert.throws(()=>imageType(Buffer.from('<html>')));
  await assert.rejects(resolveImage('https://127.0.0.1/private','.'),/内网/);
  await assert.rejects(resolveImage('file:///C:/Windows/win.ini','.'),/公共 HTTPS/);
});
test('provider sends multipart references and the dedicated key to the configured image endpoint',async t=>{
  const captured=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    captured.push({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString('utf8')});
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  const provider=createImageProvider({SUANZHOU_IMAGE_API_KEY:'dedicated-test-key',SUANZHOU_API_KEY:'general-test-key',SUANZHOU_IMAGE_BASE_URL:'http://127.0.0.1:'+upstream.address().port},'.');
  assert.deepEqual(await provider({prompt:'text-only'}),png);
  assert.deepEqual(await provider({prompt:'with-reference',references:['data:image/png;base64,'+png.toString('base64')]}),png);
  assert.equal(captured[0].url,'/images/generations');assert.equal(captured[1].url,'/images/edits');
  assert.equal(captured[1].headers.authorization,'Bearer dedicated-test-key');assert.match(captured[1].body,/name="image\[\]"/);
  assert.doesNotMatch(captured.map(x=>x.body).join(''),/general-test-key/);
});

test('result URL is persisted before downloading, and failure remains recoverable after restart',async t=>{
  let app;
  app=await fixture(t,{provider:async({onProgress})=>{
    await onProgress({phase:'downloading',resultUrl:'https://generated.example/saved.png',generationCompletedAt:'2026-11-01T00:00:00.000Z'});
    const saved=JSON.parse(fs.readFileSync(app.store.file));
    assert.equal(saved.tasks['hyrule_tasks/saved_result'].resultUrl,'https://generated.example/saved.png');
    throw new Error('图片下载超时');
  }});
  await app.call('/api/generate',{sop_text:'fixture',firebase_tasks:[{taskId:'saved_result',slot:0}]});
  const failed=await app.settled('hyrule_tasks/saved_result');
  assert.equal(failed.phase,'download_failed');assert.equal(failed.canRetryDownload,true);
  assert.equal(failed.resultUrl,undefined,'signed URLs stay on the server');
  const recovered=createWorkbench({dataDirectory:app.directory,configuration:{}});t.after(()=>recovered.research.close());
  assert.equal(recovered.store.state.tasks['hyrule_tasks/saved_result'].resultUrl,'https://generated.example/saved.png');
});

test('download retry reuses the saved URL with no generation or charge and deduplicates repeated clicks',async t=>{
  let generated=0,downloaded=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const app=await fixture(t,{provider:async()=>{generated++;return png;},download:async address=>{assert.equal(address,'https://generated.example/saved.png');downloaded++;await gate;return png;}});
  app.store.task('hyrule_tasks/recover_image',{taskId:'recover_image',slot:0,status:'failed',phase:'download_failed',resultUrl:'https://generated.example/saved.png',error:'图片下载超时'});
  const before=app.store.state.balance;
  const first=await app.call('/api/downloads/retry',{taskId:'recover_image'});
  assert.equal(first.response.status,202);
  assert.equal((await app.call('/api/downloads/retry',{taskId:'recover_image'})).response.status,202);
  release();
  const done=await app.settled('hyrule_tasks/recover_image');
  assert.equal(done.status,'completed');assert.deepEqual(Buffer.from(await(await fetch(app.base+done.imageUrl)).arrayBuffer()),png);
  assert.equal((await app.call('/api/downloads/retry',{taskId:'recover_image'})).response.status,200);
  assert.equal(generated,0);assert.equal(downloaded,1);assert.equal(app.store.state.charges.length,0);assert.equal(app.store.state.balance,before);
});

test('download recovery rejects missing URLs and accepts no caller-supplied URL',async t=>{
  let calls=0;const app=await fixture(t,{download:async()=>{calls++;return png;}});
  app.store.task('hyrule_tasks/no_result',{taskId:'no_result',status:'failed',error:'unknown provider result'});
  assert.equal((await app.call('/api/downloads/retry',{taskId:'no_result',url:'https://other.example/p.png'})).response.status,409);
  assert.equal((await app.call('/api/downloads/retry',{taskId:'missing'})).response.status,404);
  assert.equal((await app.call('/api/downloads/retry',{taskId:'../bad'})).response.status,400);
  assert.equal(calls,0);
});

test('restart marks an interrupted download recoverable without rerunning generation',async t=>{
  const app=await fixture(t);
  app.store.task('hyrule_tasks/interrupted_download',{taskId:'interrupted_download',status:'running',phase:'downloading',resultUrl:'https://generated.example/result.png'});
  const recovered=createWorkbench({dataDirectory:app.directory,configuration:{}});t.after(()=>recovered.research.close());
  assert.equal(recovered.store.state.tasks['hyrule_tasks/interrupted_download'].status,'failed');
  assert.equal(recovered.store.state.tasks['hyrule_tasks/interrupted_download'].phase,'download_failed');
  assert.equal(recovered.store.state.tasks['hyrule_tasks/interrupted_download'].resultUrl,'https://generated.example/result.png');
});
