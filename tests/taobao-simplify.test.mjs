import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan,promptForSlot} from '../src/planner.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
async function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taobao-simplify-'));
  const app=createWorkbench({dataDirectory:directory,configuration:{},researchOptions:{client:{configured:false}},...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await(await fetch(base+'/api/session')).json();
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  const post=async(route,payload)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:response.status,data:await response.json()};};
  const wait=async(group,id)=>{for(let i=0;i<200;i++){const task=await(await fetch(base+'/api/tasks/'+group+'/'+id)).json();if(['completed','failed'].includes(task.status))return task;await new Promise(r=>setTimeout(r,10));}throw Error('Task did not settle');};
  return {...app,base,post,wait};
}

test('retired movement requests and download recovery stop before any provider or simulated charge',async t=>{
  let calls=0,downloads=0;
  const app=await fixture(t,{provider:async()=>{calls++;return png;},download:async()=>{downloads++;return png;}});
  const balance=app.store.state.balance;
  const stopped=await app.post('/api/inpaint',{text_move:true,task_id:'stale_move',slot_idx:0,prompt:'旧页面移字',image_url:'/media/old.png'});
  assert.equal(stopped.status,410);assert.match(stopped.data.error,/功能已移除/);
  assert.equal(app.store.state.balance,balance);assert.equal(Object.keys(app.store.state.tasks).length,0);
  app.store.task('hyrule_tasks/old_download',{taskId:'old_download',status:'failed',phase:'download_failed',resultUrl:'https://example.com/result.png',textMove:{sourceImageUrl:'/media/old.png',regions:[]}});
  assert.equal((await app.post('/api/downloads/retry',{taskId:'old_download'})).status,410);
  const status=await(await fetch(app.base+'/api/tasks/hyrule_tasks/old_download')).json();
  assert.equal(status.canRetryDownload,false);
  assert.equal((await(await fetch(app.base+'/api/status')).json()).recoverableDownloads,0);
  assert.equal((await(await fetch(app.base+'/api/downloads')).json()).length,0);
  assert.equal(calls,0);assert.equal(downloads,0);
  assert.equal((await app.post('/api/inpaint',{task_id:'ordinary_edit',slot_idx:0,prompt:'把背景调暖',base_image_b64:'data:image/png;base64,'+png.toString('base64')})).status,202);
  assert.equal((await app.wait('hyrule_tasks','ordinary_edit')).status,'completed');assert.equal(calls,1,'ordinary local editing remains available');
});

test('first-image background is optional for fresh and older plans, with explicit white requests retained',()=>{
  for(const generation_mode of ['fast','master']) {
    const plan=buildPlan({product_name:'杯子',product_desc:'白色陶瓷杯',generation_mode,design_scope:'custom',custom_layout:{main:1,sub:1}});
    const prompt=promptForSlot({},plan.sections[0],plan);
    assert.doesNotMatch(prompt,/白底|不添加营销文字|不要场景|不添加.*使用场景/);
    assert.match(prompt,/整套风格|设计背景/);
    const oldSection={...plan.sections[0],outputConstraint:'main'};
    assert.doesNotMatch(promptForSlot({sop_text:'【主图】\n暖色客厅内完整展示杯子'},oldSection,plan),/本图最终约束：白底/);
    const white=promptForSlot({sop_text:'【主图】\n按用户要求使用纯白背景',strict_requirements:'首张采用白底产品图'},plan.sections[0],plan);
    assert.match(white,/纯白背景/);assert.match(white,/首张采用白底/);
  }
});

test('text-planner instructions and actual single-slot generation both allow a scene first image',async t=>{
  const planned=[],generated=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    planned.push(JSON.parse(Buffer.concat(chunks)));
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'【主图】\n暖色客厅背景，完整展示陶瓷杯，标题：日常一杯。'}}]}));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  t.after(async()=>{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});
  const app=await fixture(t,{configuration:{PLANNER_BASE_URL:'http://127.0.0.1:'+upstream.address().port+'/v1',PLANNER_API_KEY:'fixture-only',PLANNER_MODEL:'text-fixture'},provider:async request=>{generated.push(request);return png;}});
  for(const mode of ['fast','master']) {
    const payload={product_name:'陶瓷杯',product_desc:'白色杯身',generation_mode:mode,design_scope:'custom',custom_layout:{main:1,sub:0,aplus:0},slot_directives:[{slot:0,requirement:'整套风格：暖色氛围。客厅场景。'}]};
    assert.equal((await app.post('/api/agent',{...payload,agent_task_id:'plan_'+mode})).status,202);
    const agent=await app.wait('agent_tasks','plan_'+mode);assert.equal(agent.status,'completed');
    assert.equal((await app.post('/api/generate',{...payload,agent_task_id:'plan_'+mode,sop_text:agent.result,firebase_tasks:[{taskId:'first_'+mode,slot:0}]})).status,202);
    assert.equal((await app.wait('hyrule_tasks','first_'+mode)).status,'completed');
  }
  assert.equal(planned.length,2);assert.equal(generated.length,2);
  for(const request of planned){const messages=request.messages.map(m=>m.content).join('\n');assert.doesNotMatch(messages,/白底产品主图|主图不加营销文字/);assert.match(messages,/首张主图.*场景或设计背景/);}
  for(const request of generated){assert.match(request.prompt,/暖色客厅|客厅场景/);assert.doesNotMatch(request.prompt,/白底产品主图|本图最终约束：白底|不添加营销文字/);assert.equal(request.model,'gpt-image-2');}
});
