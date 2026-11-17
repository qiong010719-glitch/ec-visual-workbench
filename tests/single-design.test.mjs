import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan} from '../src/planner.mjs';

const sample=await sharp({create:{width:80,height:80,channels:3,background:'#54789a'}}).png().toBuffer();
async function fixture(t,options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'single-design-api-')),plans=[],images=[];
  const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},planner:async p=>{plans.push(p);return buildPlan(p,[]);},provider:async p=>{images.push(p);return sample;},...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await (await fetch(base+'/api/session')).json();
  t.after(async()=>{await new Promise(r=>app.server.close(r));});
  const call=async(url,p)=>{const response=await fetch(base+url,p?{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(p)}:{});return {status:response.status,data:await response.json()};};
  const payload={agent_task_id:'single_fixture',platform:'temu',image_workflow:'shared',generation_mode:'fast',design_scope:'main_count',image_count:2,image_ratio:'1:1',visual_style:'scene_advertising',model:'gpt-image-2',product_name:'蓝色帆布画',product_desc:'单幅帆布画，保留完整画框',target_lang:'English',categorized_images:[{filename:'主体图',url:app.saveImage(sample)}]};
  const wait=async id=>{for(let i=0;i<300;i++){const {data}=await call('/api/tasks/agent_tasks/'+id);if(['completed','failed'].includes(data?.singleDesign?.phase))return data;await new Promise(r=>setTimeout(r,20));}throw new Error('Single design did not settle');};
  return {app,call,payload,wait,plans,images,dir};
}
test('one request plans and generates fixed slots exactly once in both modes',async t=>{
  for(const mode of ['fast','master']){
    const f=await fixture(t),p={...f.payload,generation_mode:mode};
    const responses=await Promise.all([f.call('/api/single-design',p),f.call('/api/single-design',p)]);
    assert.ok(responses.every(r=>r.status===202));
    const task=await f.wait(p.agent_task_id);assert.equal(task.singleDesign.phase,'completed');
    assert.equal(f.plans.length,1);assert.equal(f.images.length,2);
    assert.ok(f.images.every(i=>i.model===p.model&&i.ratio==='1:1'));
    assert.deepEqual(task.singleDesign.images.map(i=>i.slot),[0,1]);
    await f.call('/api/single-design',p);assert.equal(f.plans.length,1);assert.equal(f.images.length,2);
    assert.equal((await f.call('/api/single-design',{...p,image_count:3})).status,409);
  }
});
test('planner failure preserves old results and never calls the image provider',async t=>{
  const f=await fixture(t,{planner:async()=>{throw new Error('构思超时');}});
  f.app.store.task('hyrule_tasks/old',{status:'completed',imageUrl:'/media/old.png'});
  await f.call('/api/single-design',f.payload);const task=await f.wait(f.payload.agent_task_id);
  assert.equal(task.singleDesign.phase,'failed');assert.equal(f.images.length,0);
  assert.equal(f.app.store.state.tasks['hyrule_tasks/old'].imageUrl,'/media/old.png');
  await f.call('/api/single-design',f.payload);assert.equal(f.images.length,0);
});
test('image failure is retained without automatic retries',async t=>{
  let attempts=0;
  const f=await fixture(t,{provider:async()=>{if(++attempts===1)throw new Error('图片服务超时');return sample;}});
  await f.call('/api/single-design',f.payload);const task=await f.wait(f.payload.agent_task_id);
  assert.equal(task.status,'completed');assert.equal(task.singleDesign.phase,'failed');
  assert.deepEqual(task.singleDesign.images.map(i=>i.status),['failed','completed']);assert.equal(attempts,2);
  await f.call('/api/single-design',f.payload);assert.equal(attempts,2);
});
test('preflight rejects missing image service and invalid scope before planning',async t=>{
  const f=await fixture(t,{provider:undefined});
  assert.equal((await f.call('/api/single-design',f.payload)).status,503);assert.equal(f.plans.length,0);
  assert.equal((await f.call('/api/single-design',{...f.payload,generation_mode:'ultra_fast'})).status,400);
});
test('restart in the plan-to-image gap stops instead of repeating paid work',async t=>{
  const f=await fixture(t),p=f.payload,plan=buildPlan(p,[]);
  f.app.store.task('agent_tasks/'+p.agent_task_id,{status:'completed',payload:p,result:plan.text,plan,singleDesign:{phase:'planning',tasks:[{slot:0,taskId:p.agent_task_id+'_0'}]}});
  const restarted=createWorkbench({dataDirectory:f.dir,configuration:{WORKBENCH_FRESH:'true'},provider:async()=>{throw new Error('Must not submit after restart');}});
  assert.equal(restarted.store.state.tasks['agent_tasks/'+p.agent_task_id].singleDesign.phase,'failed');
  assert.match(restarted.store.state.tasks['agent_tasks/'+p.agent_task_id].singleDesign.error,/中断/);
  restarted.server.emit('close');
});
