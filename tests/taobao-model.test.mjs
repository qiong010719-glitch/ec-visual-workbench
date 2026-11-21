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

test('five main images, two SKUs and three details retain varied shots and receive the actor only when needed',async t=>{
  const app=await fixture(t);
  const slots=[0,1,2,3,4,5,6,7,8,9];
  const payload={...app.payload,product_name:'帆布油画',custom_layout:{main:1,sub:6,aplus:3},slot_directives:slots.map(slot=>({slot,taobao_role:[5,6].includes(slot)?'sku':slot>=7?'detail':'main',ref_images:[[5,6].includes(slot)?'SKU图_1':'产品主体图_1']}))};
  assert.equal((await app.call('/api/agent',payload)).status,202);
  const plan=await app.settled('agent_tasks/model_plan');assert.equal(plan.status,'completed');
  assert.equal(plan.plan.modelIdentity.id,app.identity.id);assert.match(plan.result,/至少三张不出现完整人物/);
  const original=buildPlan({...payload,model_identity:undefined});
  for(const section of original.sections)assert.deepEqual(plan.plan.sections.find(s=>s.slot===section.slot).storyboard,section.storyboard,'casting must not rewrite the shot');
  const presence=['person','none','none','hands','none','none','none','none','none','person'];
  const request={agent_task_id:'model_plan',sop_text:plan.result,firebase_tasks:slots.map(slot=>({slot,taskId:'model_image_'+slot}))};
  assert.equal((await app.call('/api/generate',request)).status,202);
  for(const slot of slots){
    const task=await app.settled('hyrule_tasks/model_image_'+slot);assert.equal(task.status,'completed');
    assert.equal(task.modelIdentity.id,app.identity.id);
    const usesActor=presence[slot]!=='none';
    assert.equal(task.modelPresence,presence[slot]);
    assert.deepEqual(task.referenceImages,[[5,6].includes(slot)?app.sku:app.own,...(usesActor?[app.actor]:[])]);
    assert.deepEqual(task.referenceRoles.map(r=>r.role),usesActor?['own-product','model-identity']:['own-product']);
    if(usesActor)assert.equal(task.referenceRoles[1].sha256,digest(png));
    else assert.match(task.prompt,/本图人物安排：不出镜/);
    assert.doesNotMatch(task.prompt,/本张必须出现|面部清晰可辨|模特位于商品侧面|优先于自动分镜的无人/);
  }
  assert.equal(app.calls.length,10);
  assert.match(app.store.state.tasks['hyrule_tasks/model_image_3'].prompt,/仅手部.*不出现脸部/);
  for(const call of app.calls)assert.equal(call.model,'gpt-image-2');
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

test('old all-person plans are rejected before spending or changing existing results',async t=>{
  const app=await fixture(t);
  await app.call('/api/agent',app.payload);const agent=await app.settled('agent_tasks/model_plan');
  delete agent.plan.modelPlacementVersion;app.store.save();
  const before=JSON.stringify(app.store.state);
  const r=await app.call('/api/generate',{agent_task_id:'model_plan',sop_text:agent.result,firebase_tasks:[{slot:0,taskId:'old_policy'}]});
  assert.equal(r.status,409);assert.match(r.data.error,/模特分镜规则已更新/);
  assert.equal(app.calls.length,0);assert.equal(JSON.stringify(app.store.state),before);
});

test('fixed identity preserves all existing storyboards across design modes and categories',()=>{
  for(const generation_mode of ['fast','master'])for(const product_name of ['帆布油画','家具柜子','太阳镜','洗手液']){
    const payload={product_name,product_desc:'仅按已提供外观',generation_mode,visual_style:'scene_advertising',design_scope:'custom',custom_layout:{main:1,sub:6,aplus:7}};
    const original=buildPlan(payload),cast=buildPlan({...payload,model_identity:{version:1,enabled:true,id:'chosen',references:[]}});
    for(const section of original.sections)assert.deepEqual(cast.sections.find(s=>s.slot===section.slot).storyboard,section.storyboard);
  }
});

test('turning people off preserves existing nonhuman closeups and information layouts',()=>{
  const payload={product_name:'胡桃色柜子',product_desc:'奶油白门板',generation_mode:'fast',visual_style:'scene_advertising',design_scope:'main_only'};
  const original=buildPlan(payload),without=buildPlan({...payload,model_identity:{version:1,enabled:false}});
  const staticShots=original.sections.filter(s=>s.storyboard?.humanPresence==='none');assert.ok(staticShots.length>=2);
  for(const section of staticShots)assert.deepEqual(without.sections.find(s=>s.slot===section.slot).storyboard,section.storyboard);
});
