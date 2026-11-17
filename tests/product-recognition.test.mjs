import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {merchantFixture} from './merchant-fixture.mjs';
import {buildPlan} from '../src/planner.mjs';
import {recognizeProduct,validateRecognition} from '../src/product-recognition.mjs';

const recognition={productName:'蓝金街景装饰画',points:[{visualFeature:'画面为蓝色街道与金色灯光',sellingPoint:'冷暖色对比突出街景图案',imageIndexes:[1]}]};
const payload=(products,id)=>({requestId:id,storeKey:'merchant-ca',products,imageCount:1,ratio:'1:1',mode:'fast'});

test('supplied selling points take priority; blank points are recognized once and shared by planning and titles',async t=>{
  let calls=0,failTitle=true;const plans=[],titles=[];
  const f=await merchantFixture({productRecognizer:async()=>{calls++;return recognition;},planner:async p=>{plans.push(p);return buildPlan(p);},titlePlanner:async g=>{
    titles.push(g.source);if(g.source.product_fact_source==='image'&&failTitle){failTitle=false;throw new Error('temporary title failure');}
    return g.sets.map(s=>({setId:s.id,title:'Decorative Blue Street Scene Wall Print',englishTitle:'Decorative Blue Street Scene Wall Print'}));
  }});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  const supplied='红色花朵图案，突出暖色装饰氛围';
  const products=imported.products.map((p,i)=>({...p,count:1,description:i?' \n ':supplied}));
  let b=await f.api('/api/products',payload(products,'points-source-001')),route='/api/products/'+b.id;
  assert.equal(calls,0,'saving a batch must not call the model');
  await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');assert.equal(b.phase,'attention');assert.equal(calls,1);
  assert.equal(b.products[0].recognition,undefined);assert.equal(b.products[0].description,supplied);assert.equal(b.products[1].description,'');
  assert.equal(b.products[0].group.source.product_desc,supplied);assert.equal(b.products[0].group.source.product_fact_source,'user');
  assert.equal(b.products[1].group.source.product_name,recognition.productName);assert.equal(b.products[1].group.source.product_desc,b.products[1].recognition.description);
  assert.match(b.products[1].recognition.description,/冷暖色对比/);
  await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');assert.equal(b.phase,'ready');assert.equal(calls,1,'retry after a title failure reuses saved recognition');
  for(const source of titles){const plan=plans.find(p=>p.product_name===source.product_name);assert.equal(plan.product_desc,source.product_desc);assert.equal(plan.product_fact_source,source.product_fact_source);assert.match(buildPlan(plan).text,source.product_fact_source==='user'?/必须优先呈现这些卖点/:/AI 根据本批原图识别/);}
  const saved=JSON.parse(fs.readFileSync(f.app.store.file,'utf8')).productBatches[b.id];assert.deepEqual(saved.products[1].recognition,b.products[1].recognition);
  await f.api(route+'/generate',{});b=await f.wait(route,b=>b.phase!=='generating');assert.equal(b.phase,'completed');assert.ok(fs.existsSync(b.resultPackage.workbook));assert.equal(calls,1);
});

test('recognition failure stops before planning and images; retry can recover without creating duplicate groups',async t=>{
  let fail=true,calls=0;const f=await merchantFixture({productRecognizer:async()=>{calls++;if(fail)throw new Error('图片看不清');return recognition;},titlePlanner:async g=>g.sets.map(s=>({setId:s.id,title:'Blue and Gold Street Scene Wall Art',englishTitle:'Blue and Gold Street Scene Wall Art'}))});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});const p={...imported.products[0],description:'',count:1};
  let b=await f.api('/api/products',payload([p],'points-failure-001')),route='/api/products/'+b.id;
  await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');assert.equal(b.phase,'attention');assert.match(b.products[0].error,/图片看不清/);assert.equal(b.products[0].group,null);assert.equal(Object.keys(f.app.store.state.tasks).length,0);
  fail=false;await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');assert.equal(b.phase,'ready');assert.equal(calls,2);assert.equal(Object.keys(f.app.store.state.multisets).length,1);
  for(const description of [undefined,null,''])assert.equal((await f.api('/api/products',payload([{...p,description}],'optional-'+String(description)))).products[0].description,'');
  await assert.rejects(f.api('/api/products',payload([{...p,description:42}],'invalid-points-001')),/须为文字/);
});

test('configured vision request sends original images in both transports and rejects incomplete or unsupported evidence',async t=>{
  const f=await merchantFixture();t.after(f.close);const imported=await f.api('/api/products/import-folder',{folder:f.input});
  const requests=[];let incomplete=false;
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({url:req.url,body:JSON.parse(raw)});const output=JSON.stringify(recognition);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/responses'?{status:incomplete?'incomplete':'completed',output_text:output}:{choices:[{finish_reason:'stop',message:{content:output}}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const config={PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,PLANNER_API_KEY:'fixture',PLANNER_MODEL:'gpt-6.1-sol'};
  for(const format of ['responses','chat']){
    const result=await recognizeProduct(imported.products[0],{...config,PLANNER_API_FORMAT:format},{mediaDirectory:f.app.mediaDirectory});assert.equal(result.productName,recognition.productName);
    const {url,body}=requests.at(-1),content=format==='responses'?body.input[0].content:body.messages[1].content,system=format==='responses'?body.instructions:body.messages[0].content;
    assert.equal(body.model,'gpt-6.1-sol');assert.equal(url,format==='responses'?'/responses':'/chat/completions');assert.equal(content.length,2);assert.match(format==='responses'?content[1].image_url:content[1].image_url.url,/^data:image\/jpeg;base64,/);assert.match(system,/不能凭图猜测尺寸/);assert.match(system,/背景中的沙发/);
  }
  incomplete=true;await assert.rejects(recognizeProduct(imported.products[0],{...config,PLANNER_API_FORMAT:'responses'},{mediaDirectory:f.app.mediaDirectory}),/识别未完成/);assert.equal(requests.length,3);
  assert.throws(()=>validateRecognition({...recognition,points:[]},1),/未识别到/);
  assert.throws(()=>validateRecognition({...recognition,points:[{...recognition.points[0],imageIndexes:[9]}]},1),/图片依据/);
  await assert.rejects(recognizeProduct(imported.products[0],{},{}),/配置文字模型/);
});
