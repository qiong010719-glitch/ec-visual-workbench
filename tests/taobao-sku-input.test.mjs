import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan} from '../src/planner.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sku-input-')),calls=[],plans=[];
  const app=createWorkbench({dataDirectory:directory,configuration:{},planner:async p=>{plans.push(p);return buildPlan(p);},provider:async p=>{calls.push(p);return png;}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));assert.notEqual(app.server.address().port,4185);
  const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json();
  const call=async(route,payload)=>{const r=await fetch(base+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
  const settled=async key=>{for(let i=0;i<100;i++){const task=app.store.state.tasks[key];if(['completed','failed'].includes(task?.status))return task;await new Promise(r=>setTimeout(r,10));}throw Error('Fixture timeout');};
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  const own=app.saveImage(png),photos=[app.saveImage(png),app.saveImage(png)];
  const payload={agent_task_id:'sku_manual',product_name:'帆布油画',product_desc:'按提供的商品外观',design_scope:'custom',custom_layout:{main:1,sub:2,aplus:0},
    model_identity:{version:1,enabled:false},categorized_images:[{filename:'产品主体图_1',url:own},...photos.map((url,i)=>({filename:'SKU图_'+(i+1),url}))],
    slot_directives:[{slot:0,taobao_role:'main',ref_images:['产品主体图_1']},...['小号','大号'].map((name,i)=>({slot:i+1,taobao_role:'sku',ref_images:[],sku_input:{version:1,mode:'manual',name,unit:'cm',width:String(40*(i+1)),height:String(60*(i+1))}}))]};
  return {...app,call,settled,calls,plans,payload,own,photos};
}

test('manual dimensions stay with their SKU and use product identity instead of dormant SKU photos',async t=>{
  const app=await fixture(t);assert.equal((await app.call('/api/status')).data.skuInputVersion,2);
  assert.equal((await app.call('/api/agent',app.payload)).status,202);const agent=await app.settled('agent_tasks/sku_manual');
  assert.equal(agent.status,'completed');
  assert.equal((await app.call('/api/generate',{agent_task_id:'sku_manual',sop_text:agent.result,firebase_tasks:[1,2].map(slot=>({slot,taskId:'manual_'+slot}))})).status,202);
  for(const slot of [1,2]){
    const task=await app.settled('hyrule_tasks/manual_'+slot);assert.equal(task.status,'completed');assert.deepEqual(task.referenceImages,[app.own]);
    assert.match(task.prompt,new RegExp('"宽":"'+40*slot+'cm"'));assert.match(task.prompt,new RegExp('"高":"'+60*slot+'cm"'));
    assert.doesNotMatch(task.prompt,new RegExp('"宽":"'+40*(3-slot)+'cm"'));
    assert.match(task.prompt,/参考图中原有尺寸不沿用/);assert.match(task.prompt,/不画尺寸箭头/);assert.match(task.prompt,/SKU规格确认/);
    assert.doesNotMatch(task.prompt,/SKU图_1|SKU图_2/);
  }
  assert.equal(app.calls.length,2);
});

test('photo mode binds each uploaded specification without carrying dormant manual sizes',async t=>{
  const app=await fixture(t),payload=structuredClone(app.payload);
  for(const d of payload.slot_directives.filter(d=>d.taobao_role==='sku')){d.sku_input={version:1,mode:'photo'};d.ref_images=['SKU图_'+d.slot];}
  await app.call('/api/agent',payload);const agent=await app.settled('agent_tasks/sku_manual');
  assert.equal((await app.call('/api/generate',{agent_task_id:'sku_manual',sop_text:agent.result,firebase_tasks:[1,2].map(slot=>({slot,taskId:'photo_'+slot}))})).status,202);
  for(const slot of [1,2]){
    const task=await app.settled('hyrule_tasks/photo_'+slot);assert.deepEqual(task.referenceImages,[app.photos[slot-1]]);
    assert.match(task.prompt,/尺寸、单位、颜色和款式/);assert.doesNotMatch(task.prompt,/40cm|60cm|80cm|120cm|本SKU已确认数据/);
  }
});

test('missing or invalid dimensions, units, photo inputs and product references block before planner calls',async t=>{
  const app=await fixture(t),balance=app.store.state.balance;
  const invalidInputs=[{version:1,mode:'manual',unit:'cm'},...['0','-2','abc','1e3','1000000'].map(width=>({version:1,mode:'manual',unit:'cm',width})),{version:1,mode:'manual',width:'40',unit:'px'},{version:1,mode:'photo'},{version:99,mode:'manual',unit:'cm',width:'1'}];
  for(const input of invalidInputs){const payload=structuredClone(app.payload);payload.slot_directives[1].sku_input=input;assert.equal((await app.call('/api/agent',payload)).status,400);}
  const noProduct={...app.payload,categorized_images:app.payload.categorized_images.slice(1)};assert.equal((await app.call('/api/agent',noProduct)).status,400);
  assert.equal(app.plans.length,0);assert.equal(app.calls.length,0);assert.equal(app.store.state.balance,balance);assert.equal(Object.keys(app.store.state.tasks).length,0);
});

test('changing sizes, units, name, source mode or removing the manual contract requires a fresh plan',async t=>{
  const app=await fixture(t);await app.call('/api/agent',app.payload);const agent=await app.settled('agent_tasks/sku_manual'),balance=app.store.state.balance;
  for(const change of [{width:'41'},{unit:'mm'},{name:'不同款式'},{mode:'photo'},null]){
    const dirs=structuredClone(app.payload.slot_directives);
    if(change===null)delete dirs[1].sku_input;else dirs[1].sku_input={...dirs[1].sku_input,...change};
    if(change?.mode==='photo')dirs[1].ref_images=['SKU图_1'];
    const r=await app.call('/api/generate',{agent_task_id:'sku_manual',sop_text:agent.result,slot_directives:dirs,firebase_tasks:[{slot:1,taskId:'changed'}]});
    assert.equal(r.status,409);assert.match(r.data.error,/重新构思/);
  }
  assert.equal(app.calls.length,0);assert.equal(app.store.state.balance,balance);
});

test('combined SKU cards send both their own image and supplemental specifications; mixed no-photo cards use the product',async t=>{
  const app=await fixture(t),payload=structuredClone(app.payload);
  payload.slot_directives[1].ref_images=['SKU图_1'];
  for(const d of payload.slot_directives.slice(1))d.sku_input={...d.sku_input,version:2,mode:'combined'};
  assert.equal((await app.call('/api/agent',payload)).status,202);
  const agent=await app.settled('agent_tasks/sku_manual');
  assert.equal((await app.call('/api/generate',{agent_task_id:'sku_manual',sop_text:agent.result,firebase_tasks:[1,2].map(slot=>({slot,taskId:'combined_'+slot}))})).status,202);
  const small=await app.settled('hyrule_tasks/combined_1'),large=await app.settled('hyrule_tasks/combined_2');
  assert.deepEqual(small.referenceImages,[app.photos[0]]);assert.deepEqual(large.referenceImages,[app.own]);
  assert.match(small.prompt,/"宽":"40cm"/);assert.match(small.prompt,/"name":"小号"/);assert.match(small.prompt,/与图片中同项规格不一致时，以填写值为准/);
  assert.doesNotMatch(small.prompt,/80cm|120cm|SKU图_2/);assert.match(large.prompt,/"宽":"80cm"/);assert.doesNotMatch(large.prompt,/40cm|60cm|SKU图_1/);
  const balance=app.store.state.balance;
  for(const change of [{width:'41'},{name:'更名'},{unit:'mm'}]){
    const dirs=structuredClone(payload.slot_directives);Object.assign(dirs[1].sku_input,change);
    const response=await app.call('/api/generate',{agent_task_id:'sku_manual',sop_text:agent.result,slot_directives:dirs,firebase_tasks:[{slot:1,taskId:'stale'}]});
    assert.equal(response.status,409);
  }
  assert.equal(app.calls.length,2);assert.equal(app.store.state.balance,balance);
});

test('combined photo-only is valid; invalid or missing card inputs are rejected before planning',async t=>{
  const app=await fixture(t),payload=structuredClone(app.payload);
  payload.slot_directives[1]={slot:1,taobao_role:'sku',ref_images:['SKU图_1'],sku_input:{version:2,mode:'combined',unit:'cm',name:'图示款'}};
  assert.equal((await app.call('/api/agent',payload)).status,202);await app.settled('agent_tasks/sku_manual');
  for(const change of [{ref_images:[]},{ref_images:['SKU图_999']},{ref_images:['产品主体图_1']},{ref_images:['SKU图_1','SKU图_2']},{sku_input:{version:2,mode:'combined',unit:'cm',width:'0'}},{sku_input:{version:2,mode:'combined',unit:'cm',width:'20',photo_missing:true}}]){
    const bad=structuredClone(payload);bad.agent_task_id='bad_'+crypto.randomUUID();Object.assign(bad.slot_directives[1],change);
    assert.equal((await app.call('/api/agent',bad)).status,400);
  }
  assert.equal(app.plans.length,1);assert.equal(app.calls.length,0);
});
