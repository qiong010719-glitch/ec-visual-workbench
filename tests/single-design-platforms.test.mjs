import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan} from '../src/planner.mjs';

async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'single-platforms-')),calls=[];
  const source=await sharp({create:{width:80,height:40,channels:3,background:'#1976a3'}}).png().toBuffer();
  const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},planner:async p=>buildPlan(p,[]),provider:async p=>{calls.push(p);return source;}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json();
  const call=async(url,payload)=>{const response=await fetch(base+url,payload?{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)}:{});return {status:response.status,data:await response.json()};};
  const wait=async(path,done)=>{for(let i=0;i<300;i++){const {data}=await call(path);if(done(data))return data;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Task did not settle');};
  const payload={agent_task_id:'single_amazon_integration',platform:'amazon',image_workflow:'platform',generation_mode:'fast',visual_style:'original',design_scope:'custom',custom_layout:{main:1,sub:0,aplus:1,aplus_type:'old'},model:'gpt-image-2',product_name:'蓝色帆布画',product_desc:'一幅画作，保留画框和画面',categorized_images:[{filename:'产品主体图.png',category:'产品主体图',url:app.saveImage(source)}]};
  const dimensions=async url=>{const metadata=await sharp(Buffer.from(await(await fetch(base+url)).arrayBuffer())).metadata();return [metadata.width,metadata.height];};
  return {app,base,call,wait,payload,calls,dimensions};
}

test('explicit Amazon one-click stores correct main and A+ sizes plus untouched originals',async t=>{
  for(const [type,ratio,size] of [['old','16:9',[970,600]],['premium','21:9',[1464,600]]]){
    const f=await fixture(t),payload={...f.payload,custom_layout:{...f.payload.custom_layout,aplus_type:type},workspace_product_id:'product_mock'};
    assert.equal((await f.call('/api/single-design',payload)).status,202);
    const task=await f.wait('/api/tasks/agent_tasks/'+payload.agent_task_id,t=>['completed','failed'].includes(t?.singleDesign?.phase));
    assert.equal(task.singleDesign.phase,'completed');assert.deepEqual(f.calls.map(p=>p.ratio),['1:1',ratio]);
    const [main,aplus]=task.singleDesign.images;
    assert.deepEqual(await f.dimensions(main.imageUrl),[1024,1024]);assert.deepEqual(await f.dimensions(aplus.imageUrl),size);
    assert.deepEqual(await f.dimensions(main.originalImageUrl),[80,40]);assert.deepEqual(await f.dimensions(aplus.originalImageUrl),[80,40]);
    assert.notEqual(main.imageUrl,main.originalImageUrl);
    assert.equal(f.app.store.state.tasks['hyrule_tasks/'+main.taskId].workspace_product_id,'product_mock');
    await f.call('/api/single-design',payload);assert.equal(f.calls.length,2);
  }
});

test('Temu one-click keeps its existing square transform and does not acquire Amazon output fields',async t=>{
  const f=await fixture(t),payload={...f.payload,platform:'temu',image_workflow:'shared',image_ratio:'1:1'};
  assert.equal((await f.call('/api/single-design',payload)).status,202);
  const task=await f.wait('/api/tasks/agent_tasks/'+payload.agent_task_id,t=>['completed','failed'].includes(t?.singleDesign?.phase));
  assert.equal(task.singleDesign.phase,'completed');assert.deepEqual(f.calls.map(p=>p.ratio),['1:1','1:1']);
  for(const image of task.singleDesign.images){assert.deepEqual(await f.dimensions(image.imageUrl),[1024,1024]);assert.equal(image.originalImageUrl,undefined);assert.equal(image.formatId,undefined);}
});

test('Amazon mobile reformat remains available and stores 1200 by 900 alongside the source result',async t=>{
  const f=await fixture(t),taskId='mobile_amazon_platforms';
  const result=await f.call('/api/generate',{platform:'amazon',image_workflow:'platform',mobile_reformat:true,generation_mode:'mobile_reformat',model:'gpt-image-2',tasks:[{taskId,source_image_url:f.payload.categorized_images[0].url,title:'手机A+'}]});
  assert.equal(result.status,202);
  const task=await f.wait('/api/tasks/hyrule_tasks/'+taskId,t=>['completed','failed'].includes(t?.status));
  assert.equal(task.status,'completed');assert.deepEqual(await f.dimensions(task.imageUrl),[1200,900]);
  assert.deepEqual(await f.dimensions(task.originalImageUrl),[80,40]);assert.equal(f.calls[0].ratio,'4:3');
});
