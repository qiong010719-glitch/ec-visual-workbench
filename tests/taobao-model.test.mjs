import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan,promptForSlot} from '../src/planner.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taobao-model-')),calls=[],plans=[];
  const app=createWorkbench({dataDirectory:directory,configuration:{},planner:async p=>{plans.push(p);return buildPlan(p);},provider:async p=>{calls.push(p);return png;}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));assert.notEqual(app.server.address().port,4185);
  const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json();
  const call=async(route,body)=>{const r=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const settled=async key=>{for(let i=0;i<100;i++){const t=app.store.state.tasks[key];if(['completed','failed'].includes(t?.status))return t;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture timed out');};
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  const own=app.saveImage(png),sku=app.saveImage(png),actor=app.saveImage(png);
  const identity={version:1,enabled:true,id:'model_test',name:'固定模特',references:[{url:actor,sha256:digest(png),filename:'model.png'}]};
  const payload={agent_task_id:'model_plan',product_name:'餐边柜',product_desc:'胡桃色柜体',generation_mode:'fast',visual_style:'scene_advertising',design_scope:'custom',custom_layout:{main:1,sub:1,aplus:1},model_identity:identity,
    categorized_images:[{filename:'产品主体图_1',url:own},{filename:'SKU图_1',url:sku}],slot_directives:[{slot:0,taobao_role:'main',ref_images:['产品主体图_1']},{slot:1,taobao_role:'sku',ref_images:['SKU图_1']},{slot:7,taobao_role:'detail',aspect_ratio:'3:4',ref_images:['产品主体图_1']}]};
  return {...app,call,settled,calls,plans,payload,identity,own,sku,actor};
}

test('one fixed model reference reaches every main/SKU/detail request with its role and hash',async t=>{
  const app=await fixture(t);assert.equal((await app.call('/api/agent',app.payload)).status,202);
  const plan=await app.settled('agent_tasks/model_plan');assert.equal(plan.status,'completed');
  assert.equal(plan.plan.modelIdentity.id,app.identity.id);assert.doesNotMatch(plan.result,/至少三张不出现完整人物/);
  assert.equal(plan.plan.sections.find(s=>s.slot===7).storyboard.humanPresence,'person');
  const request={agent_task_id:'model_plan',sop_text:plan.result,firebase_tasks:[0,1,7].map(slot=>({slot,taskId:'model_image_'+slot}))};
  assert.equal((await app.call('/api/generate',request)).status,202);
  for(const slot of [0,1,7]){
    const task=await app.settled('hyrule_tasks/model_image_'+slot);assert.equal(task.status,'completed');
    assert.equal(task.modelIdentity.id,app.identity.id);
    assert.deepEqual(task.referenceImages,[slot===1?app.sku:app.own,app.actor]);
    assert.deepEqual(task.referenceRoles.map(r=>r.role),['own-product','model-identity']);
    assert.equal(task.referenceRoles[1].sha256,digest(png));
  }
  for(const call of app.calls){assert.match(call.prompt,/模特出镜：是/);assert.match(call.prompt,/第2张只定义固定模特/);assert.equal(call.model,'gpt-image-2');}
  assert.match(app.calls.find(c=>c.references[0]===app.sku).prompt,/模特位于商品侧面/);
});

test('no-model mode removes the person reference and overrides automatic people and hands',async t=>{
  const app=await fixture(t);const payload={...app.payload,model_identity:{...app.identity,enabled:false}};
  await app.call('/api/agent',payload);const agent=await app.settled('agent_tasks/model_plan');
  assert.deepEqual(agent.payload.model_identity,{version:1,enabled:false});
  const section=agent.plan.sections.find(s=>s.slot===7);assert.equal(section.storyboard.humanPresence,'none');
  assert.match(promptForSlot(agent.payload,section,agent.plan),/不出现人物、脸、身体、手部/);
  await app.call('/api/generate',{agent_task_id:'model_plan',sop_text:agent.result,firebase_tasks:[{slot:7,taskId:'no_model'}]});
  const result=await app.settled('hyrule_tasks/no_model');assert.deepEqual(result.referenceImages,[app.own]);
  assert.ok(!JSON.stringify(result).includes(app.actor));
});

test('missing, changed, external or overloaded model references stop before planning or image charges',async t=>{
  const app=await fixture(t),initial=app.store.state.balance;
  for(const identity of [{enabled:true}, {...app.identity,references:[{...app.identity.references[0],url:'https://example.com/model.png'}]}, {...app.identity,references:[{...app.identity.references[0],sha256:'0'.repeat(64)}]}]){
    assert.equal((await app.call('/api/agent',{...app.payload,model_identity:identity})).status,400);
  }
  assert.equal(app.plans.length,0);assert.equal(app.calls.length,0);assert.equal(app.store.state.balance,initial);
  await app.call('/api/agent',app.payload);const agent=await app.settled('agent_tasks/model_plan');
  const before=app.store.state.balance;
  for(const identity of [{version:1,enabled:false},{...app.identity,id:'another_person'}]){
    const r=await app.call('/api/generate',{agent_task_id:'model_plan',sop_text:agent.result,model_identity:identity,firebase_tasks:[{slot:0,taskId:'changed'}]});
    assert.equal(r.status,409);assert.match(r.data.error,/重新构思/);
  }
  const many=Array.from({length:8},(_,i)=>({filename:'本品'+i,url:app.saveImage(png)}));
  const over=await app.call('/api/generate',{...app.payload,agent_task_id:undefined,categorized_images:many,slot_directives:[{slot:0,ref_images:many.map(m=>m.filename)}],firebase_tasks:[{slot:0,taskId:'overloaded'}]});
  assert.equal(over.status,400);assert.match(over.data.error,/超过8张/);
  fs.appendFileSync(path.join(app.mediaDirectory,path.basename(app.actor)),'changed');
  const changed=await app.call('/api/generate',{agent_task_id:'model_plan',sop_text:agent.result,firebase_tasks:[{slot:0,taskId:'tampered'}]});
  assert.equal(changed.status,400);assert.match(changed.data.error,/已变化/);
  assert.equal(app.calls.length,0);assert.equal(app.store.state.balance,before);
});

test('model-disabled and legacy plans cannot be silently reused for a selected actor',async t=>{
  const app=await fixture(t),legacy={...app.payload};delete legacy.model_identity;
  await app.call('/api/agent',legacy);const agent=await app.settled('agent_tasks/model_plan');
  const r=await app.call('/api/generate',{agent_task_id:'model_plan',sop_text:agent.result,model_identity:app.identity,firebase_tasks:[{slot:0,taskId:'legacy_actor'}]});
  assert.equal(r.status,409);assert.equal(app.calls.length,0);
});

test('turning people off preserves existing nonhuman closeups and information layouts',()=>{
  const payload={product_name:'胡桃色柜子',product_desc:'奶油白门板',generation_mode:'fast',visual_style:'scene_advertising',design_scope:'main_only'};
  const original=buildPlan(payload),without=buildPlan({...payload,model_identity:{version:1,enabled:false}});
  const staticShots=original.sections.filter(s=>s.storyboard?.humanPresence==='none');assert.ok(staticShots.length>=2);
  for(const section of staticShots)assert.deepEqual(without.sections.find(s=>s.slot===section.slot).storyboard,section.storyboard);
});
