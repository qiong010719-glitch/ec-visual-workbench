import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createWorkbench} from '../src/server.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
const image2='gpt-image-2',sunburst='gpt-image-2.5-sunburst';
async function fixture(t,{respond,configuration={}}={}) {
  const requests=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const parsed=req.headers['content-type'].includes('multipart/')
      ?Object.fromEntries(await new Response(body,{headers:{'Content-Type':req.headers['content-type']}}).formData())
      :JSON.parse(body);
    requests.push({path:req.url,model:parsed.model,key:req.headers.authorization,body:parsed});
    if(respond)return respond(req,res,parsed);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({model:parsed.model,data:[{b64_json:png.toString('base64')}]}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-model-routing-'));
  const app=createWorkbench({dataDirectory:directory,configuration:{SUANZHOU_IMAGE_API_KEY:'dedicated-image-test',SUANZHOU_API_KEY:'never-use-general-key',SUANZHOU_IMAGE_BASE_URL:'http://127.0.0.1:'+upstream.address().port,SUANZHOU_IMAGE_MODEL:image2,...configuration}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  t.after(async()=>{await new Promise(r=>app.server.close(r));await new Promise(r=>upstream.close(r));app.research.close();fs.rmSync(directory,{recursive:true,force:true});});
  const post=async(endpoint,payload)=>{const r=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
  const settled=async id=>{for(let n=0;n<200;n++){const task=app.store.state.tasks['hyrule_tasks/'+id];if(['completed','failed'].includes(task?.status))return task;await new Promise(r=>setTimeout(r,10));}throw new Error('Task did not settle');};
  return {...app,base,directory,requests,post,settled};
}

test('customer model choice reaches JSON generation and multipart editing with the dedicated key',async t=>{
  const app=await fixture(t);
  const ref=app.saveImage(png);
  for(const [index,model] of [image2,sunburst].entries()){
    for(const withReference of [false,true]){
      const id='choice_'+index+'_'+withReference;
      const result=await app.post('/api/generate',{model,sop_text:'【主图】\n白底产品图',...(withReference?{images:[ref]}:{}),firebase_tasks:[{taskId:id,slot:0}]});
      assert.equal(result.status,202);
      const task=await app.settled(id);
      assert.equal(task.status,'completed');assert.equal(task.model,model);
      assert.equal(app.requests.at(-1).model,model);
      assert.equal(app.requests.at(-1).path,withReference?'/images/edits':'/images/generations');
      assert.equal(app.requests.at(-1).key,'Bearer dedicated-image-test');
      assert.equal(task.providerModel,model);
    }
  }
  const saved=JSON.parse(fs.readFileSync(app.store.file));
  assert.equal(saved.tasks['hyrule_tasks/choice_1_true'].model,sunburst);
  const status=await fetch(app.base+'/api/status').then(r=>r.json());
  assert.deepEqual(status.imageModels.map(m=>m.id),[image2,sunburst]);
});

test('master, fast, ultra, edit and mobile requests honor the selected model',async t=>{
  const app=await fixture(t),ref=app.saveImage(png);
  const cases=[
    ['/api/generate',{generation_mode:'master',model:sunburst,sop_text:'【主图】\n大师摄影',firebase_tasks:[{taskId:'master',slot:0}]}],
    ['/api/generate',{generation_mode:'fast',model:image2,sop_text:'【主图】\n快速设计',firebase_tasks:[{taskId:'fast',slot:0}]}],
    ['/api/ultra_generate',{model:sunburst,mode:'ultra_fast',prompt:'产品图',firebase_tasks:[{taskId:'ultra',slot:0}]}],
    ['/api/inpaint',{model:sunburst,prompt:'改背景',task_id:'edit',base_image_b64:'data:image/png;base64,'+png.toString('base64')}],
    ['/api/generate',{model:sunburst,mobile_reformat:true,tasks:[{taskId:'mobile',source_image_url:ref}]}]
  ];
  for(const [endpoint,payload] of cases){
    assert.equal((await app.post(endpoint,payload)).status,202);
    const id=payload.task_id||payload.firebase_tasks?.[0].taskId||payload.tasks[0].taskId;
    assert.equal((await app.settled(id)).model,payload.model);
    assert.equal(app.requests.at(-1).model,payload.model);
  }
});

test('unsupported models fail before enqueueing or charging; omitted model keeps Image 2',async t=>{
  const app=await fixture(t);
  for(const [index,model] of ['made-up-model','gpt-image-2.5-flare','',null,{}].entries()){
    const result=await app.post('/api/generate',{model,prompt:'产品图',firebase_tasks:[{taskId:'invalid_'+index,slot:0}]});
    assert.equal(result.status,400);assert.match(result.data.error,/模型/);
  }
  assert.equal(app.requests.length,0);assert.equal(app.store.state.charges.length,0);assert.equal(Object.keys(app.store.state.tasks).length,0);
  await app.post('/api/generate',{prompt:'产品图',firebase_tasks:[{taskId:'default',slot:0}]});
  assert.equal((await app.settled('default')).model,image2);
});

test('a rejected Sunburst request stays Sunburst and is never retried as Image 2',async t=>{
  const app=await fixture(t,{respond:(_req,res)=>{res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'model not enabled'}}));}});
  await app.post('/api/generate',{model:sunburst,prompt:'产品图',firebase_tasks:[{taskId:'rejected',slot:0}]});
  const task=await app.settled('rejected');
  assert.equal(task.status,'failed');assert.equal(task.model,sunburst);assert.match(task.error,/2\.5.*403/);
  assert.equal(app.requests.length,1);assert.equal(app.requests[0].model,sunburst);
});

test('an explicitly different upstream model is rejected instead of labeling its image as Sunburst',async t=>{
  const app=await fixture(t,{respond:(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:image2,data:[{b64_json:png.toString('base64')}]}));}});
  await app.post('/api/generate',{model:sunburst,prompt:'产品图',firebase_tasks:[{taskId:'mismatch',slot:0}]});
  const task=await app.settled('mismatch');
  assert.equal(task.status,'failed');assert.match(task.error,/模型.*不一致/);assert.equal(task.imageUrl,undefined);
  assert.equal(app.requests.length,1);
});

test('a queued request retains its own model while another request chooses a different one',async t=>{
  let release;const gate=new Promise(r=>release=r);let calls=0;
  const app=await fixture(t,{configuration:{IMAGE_CONCURRENCY:'1'},respond:async(_req,res,body)=>{if(++calls===1)await gate;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:body.model,data:[{b64_json:png.toString('base64')}]}));}});
  t.after(()=>release());
  await app.post('/api/generate',{model:image2,prompt:'图',firebase_tasks:[{taskId:'first',slot:0}]});
  await app.post('/api/generate',{model:sunburst,prompt:'图',firebase_tasks:[{taskId:'queued',slot:0}]});
  const queuedModel=app.store.state.tasks['hyrule_tasks/queued'].model;
  release();
  await app.settled('first');await app.settled('queued');
  assert.equal(queuedModel,sunburst);
  assert.deepEqual(app.requests.map(r=>r.model),[image2,sunburst]);
});
