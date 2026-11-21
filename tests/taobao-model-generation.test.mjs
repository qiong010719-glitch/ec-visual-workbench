import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createWorkbench} from '../src/server.mjs';
import {hydrateModelIdentity} from '../src/taobao-model.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
const request={task_id:'modelgen_test',description:'成年模特，短发，米色衬衫',confirmed:true};
async function fixture(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taobao-modelgen-')),calls=[];
  const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async p=>{calls.push(p);return options.generate?options.generate(p):png;},download:async()=>png});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));assert.notEqual(app.server.address().port,4185);
  const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json();
  const call=async(route,payload)=>{const r=await fetch(base+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
  const settled=async key=>{for(let i=0;i<200;i++){const task=app.store.state.tasks[key];if(['completed','failed'].includes(task?.status))return task;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture timeout');};
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  return {...app,call,settled,calls};
}

test('one confirmed model candidate is reused only by planned person shots',async t=>{
  const app=await fixture(t);assert.equal((await app.call('/api/status')).data.modelGenerationVersion,1);
  assert.equal((await app.call('/api/taobao/models/generate',request)).status,202);
  await app.settled('hyrule_tasks/'+request.task_id);
  const first=(await app.call('/api/taobao/models/'+request.task_id)).data;
  const repeated=await app.call('/api/taobao/models/generate',request);
  assert.deepEqual(repeated.data.candidateIdentity,first.candidateIdentity);assert.equal(app.calls.length,1);
  assert.equal(app.calls[0].model,'gpt-image-2');assert.equal(app.calls[0].ratio,'3:4');assert.deepEqual(app.calls[0].references,[]);
  assert.match(app.calls[0].prompt,/原创虚拟成年/);
  const identity=first.candidateIdentity;
  assert.equal(identity.source,'generated');assert.equal(identity.generationTaskId,request.task_id);
  const own=app.saveImage(png);
  const payload={agent_task_id:'generated_person_plan',product_name:'柜子',product_desc:'白色门板',generation_mode:'fast',design_scope:'custom',custom_layout:{main:1,sub:1,aplus:1},model_identity:identity,
    categorized_images:[{filename:'本品',url:own},{filename:'SKU图_1',url:own}],slot_directives:[{slot:0,taobao_role:'main',ref_images:['本品']},{slot:1,taobao_role:'sku',ref_images:['SKU图_1']},{slot:7,taobao_role:'detail',ref_images:['本品']}]};
  assert.equal((await app.call('/api/agent',payload)).status,202);const agent=await app.settled('agent_tasks/generated_person_plan');
  assert.deepEqual(agent.plan.modelIdentity,identity);
  assert.equal((await app.call('/api/generate',{agent_task_id:payload.agent_task_id,sop_text:agent.result,firebase_tasks:[0,1,7].map(slot=>({slot,taskId:'generated_person_image_'+slot}))})).status,202);
  for(const slot of [0,1,7]){
    const task=await app.settled('hyrule_tasks/generated_person_image_'+slot);
    assert.equal(task.status,'completed');assert.deepEqual(task.modelIdentity,identity);
    assert.deepEqual(task.referenceImages,slot===0?[own,identity.references[0].url]:[own]);
    if(slot===0)assert.equal(task.referenceRoles[1].identityId,identity.id);
    else assert.match(task.prompt,/本图人物安排：不出镜/);
  }
  assert.equal(app.calls.length,4,'one actor, three product images; no recasting per slot');
  for(const value of [identity,{...identity,enabled:false}])assert.deepEqual(hydrateModelIdentity(value,app.mediaDirectory,{draft:true,tasks:app.store.state.tasks}),value);
  for(const patch of [{id:'fake_identity'},{generationTaskId:'missing_task'},{references:[{...identity.references[0],url:own}]}]){
    const result=await app.call('/api/agent',{...payload,agent_task_id:'bad_model',model_identity:{...identity,...patch}});
    assert.equal(result.status,400);assert.match(result.data.error,/不一致/);
  }
});

test('missing consent, invalid input and conflicting idempotency keys never dispatch another model',async t=>{
  const app=await fixture(t);
  for(const patch of [{confirmed:false},{confirmed:undefined},{description:''},{description:'x'.repeat(1201)},{task_id:'bad'}])assert.equal((await app.call('/api/taobao/models/generate',{...request,...patch})).status,400);
  assert.equal(app.calls.length,0);assert.deepEqual(app.store.state.tasks,{});
  await Promise.all([app.call('/api/taobao/models/generate',request),app.call('/api/taobao/models/generate',request)]);
  await app.settled('hyrule_tasks/'+request.task_id);
  assert.equal((await app.call('/api/taobao/models/generate',{...request,description:'不同的衣服'})).status,409);
  assert.equal(app.calls.length,1);
  assert.equal((await app.call('/api/taobao/models/unknown')).status,404);
  assert.equal((await app.call('/api/generate',{product_name:'柜子',firebase_tasks:[{slot:0,taskId:request.task_id}]})).status,409);
});

test('an unfinished model choice can be backed up but cannot submit planning or images',async t=>{
  const app=await fixture(t),unfinished={version:1,enabled:true};
  assert.deepEqual(hydrateModelIdentity(unfinished,app.mediaDirectory,{draft:true,tasks:app.store.state.tasks}),unfinished);
  assert.throws(()=>hydrateModelIdentity(unfinished,app.mediaDirectory),/先上传或生成并选定/);
  assert.equal((await app.call('/api/agent',{agent_task_id:'unfinished',product_name:'柜子',product_desc:'白色',model_identity:unfinished})).status,400);
  assert.equal(app.calls.length,0);
});

test('uncertain generation failure stays failed on reads and duplicate submissions',async t=>{
  const app=await fixture(t,{generate:async()=>{throw Error('测试：生成请求超时，结果未确认');}});
  await app.call('/api/taobao/models/generate',request);await app.settled('hyrule_tasks/'+request.task_id);
  for(let i=0;i<3;i++){
    const result=await app.call('/api/taobao/models/generate',request);
    assert.equal(result.data.status,'failed');assert.equal(result.data.candidateIdentity,null);
  }
  assert.equal(app.calls.length,1);assert.equal(app.store.state.charges.length,0,'does not report a simulated refund as a real provider refund');
});

test('download-only recovery creates the original candidate without a second generation',async t=>{
  const app=await fixture(t,{generate:async p=>{await p.onProgress({resultUrl:'https://example.invalid/fixture.png'});throw Error('测试：仅下载失败');}});
  await app.call('/api/taobao/models/generate',request);await app.settled('hyrule_tasks/'+request.task_id);
  const failed=(await app.call('/api/taobao/models/'+request.task_id)).data;
  assert.equal(failed.canRetryDownload,true);assert.equal(failed.candidateIdentity,null);assert.equal(failed.resultUrl,undefined);
  assert.equal((await app.call('/api/downloads/retry',{taskId:request.task_id})).status,202);
  await app.settled('hyrule_tasks/'+request.task_id);
  const task=(await app.call('/api/taobao/models/'+request.task_id)).data;
  assert.equal(task.status,'completed');assert.equal(task.candidateIdentity.source,'generated');assert.equal(app.calls.length,1);
  assert.deepEqual(hydrateModelIdentity(task.candidateIdentity,app.mediaDirectory,{tasks:app.store.state.tasks}),task.candidateIdentity);
});
