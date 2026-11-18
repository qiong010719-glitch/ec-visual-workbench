import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {designResultFormat,prepareDesignResult,validateSingleDesignPlatform,singleDesignPlanSignature} from '../src/design-platforms.mjs';
import {createSingleDesign} from '../src/single-design.mjs';
import {temuPlanSignature} from '../src/temu.mjs';

const amazon={platform:'amazon',image_workflow:'platform',generation_mode:'fast',design_scope:'main_6_premium_aplus'};

test('only explicit Amazon results receive per-slot output dimensions',async()=>{
  for(const task of [{},{platform:'temu',image_ratio:'1:1'},{platform:'other'},{...amazon,design_scope:'ultra_main_8',slot:0},{...amazon,slot:-1}]){
    assert.equal(designResultFormat(task),null);
    // A non-Amazon payload is returned before image decoding, preserving all
    // existing Temu and legacy save paths even if the provider bytes are bad.
    assert.equal(await prepareDesignResult(Buffer.from('unread'),task),null);
  }
  assert.equal(designResultFormat({...amazon,slot:0}).id,'main');
  assert.equal(designResultFormat({...amazon,slot:8}).id,'premium_aplus');
  assert.equal(designResultFormat({...amazon,design_scope:'main_6_old_aplus',slot:7}).id,'old_aplus');
  assert.equal(designResultFormat({...amazon,design_scope:'main_count',image_count:10,slot:9}).id,'main');
  assert.equal(designResultFormat({...amazon,design_scope:'custom',custom_layout:{main:1,sub:2,aplus:2,aplus_type:'old'},slot:8}).id,'old_aplus');
  assert.equal(designResultFormat({...amazon,mobile_reformat:true,slot:0}).id,'mobile');
});

test('Amazon outputs contain the entire image and keep exact original bytes',async()=>{
  const input=await sharp({create:{width:80,height:80,channels:3,background:'#123456'}}).png().toBuffer();
  for(const [task,width,height] of [
    [{...amazon,slot:0},1024,1024],
    [{...amazon,design_scope:'main_6_old_aplus',slot:7},970,600],
    [{...amazon,slot:7},1464,600],
    [{...amazon,mobile_reformat:true,slot:0},1200,900]
  ]){
    const result=await prepareDesignResult(input,task);
    assert.equal(result.originalBytes,input);
    const output=await sharp(result.bytes).metadata();assert.deepEqual([output.width,output.height],[width,height]);
    assert.deepEqual(result.sourceDimensions,{width:80,height:80});
    assert.equal(result.fitted,width!==height);
    const {data,info}=await sharp(result.bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel=(x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
    assert.deepEqual(pixel(Math.floor(width/2),Math.floor(height/2)),[18,52,86]);
    if(width!==height)assert.deepEqual(pixel(0,Math.floor(height/2)),[255,255,255]);
    // The full colored square occupies a square area, not a stretched wide one.
    assert.deepEqual(pixel(Math.floor((width-height)/2)+3,Math.floor(height/2)),[18,52,86]);
  }
});

test('orientation is respected before reporting and fitting Amazon results',async()=>{
  const source=await sharp({create:{width:60,height:30,channels:3,background:'#123456'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const result=await prepareDesignResult(source,{...amazon,slot:0});
  assert.deepEqual(result.sourceDimensions,{width:30,height:60});
  assert.equal((await sharp(result.bytes).metadata()).orientation,undefined);
});

test('platform validation rejects mixed ratios and keeps Temu idempotency signatures',()=>{
  const temu={...amazon,platform:'temu',image_workflow:'shared',image_ratio:'1:1',model:'gpt-image-2'};
  assert.equal(singleDesignPlanSignature(temu),JSON.stringify([temuPlanSignature(temu),temu.model]));
  assert.doesNotThrow(()=>validateSingleDesignPlatform(temu));
  assert.doesNotThrow(()=>validateSingleDesignPlatform(amazon));
  assert.doesNotThrow(()=>validateSingleDesignPlatform({...amazon,custom_layout:{main:1,sub:1,aplus:1,aplus_type:'premium'}}));
  for(const bad of [{...amazon,platform:'ebay'},{...amazon,image_workflow:'shared',image_ratio:'1:1'},
    {...amazon,design_scope:'typo'},{...amazon,design_scope:'custom',custom_layout:{main:1,sub:8,aplus:0,aplus_type:'premium'}},
    {...amazon,custom_layout:{main:1,sub:1,aplus:0,aplus_type:'typo'}},{...temu,image_ratio:'3:4'}]){
    assert.throws(()=>validateSingleDesignPlatform(bad),{status:400});
  }
});

test('one-click Amazon plans retain mixed slot ratios and retry identical IDs without another plan',()=>{
  const state={tasks:{}},plans=[],submissions=[];
  const store={state,task:(key,patch)=>state.tasks[key]={...state.tasks[key],...patch}};
  const service=createSingleDesign({store,configuration:{},imageAvailable:()=>true,
    submitPlan:(payload,flow)=>{plans.push(payload);store.task('agent_tasks/'+payload.agent_task_id,{payload,singleDesign:flow,requestId:'request-1',status:'pending'});return 'request-1';},
    submitImages:payload=>{submissions.push(payload);return 'images-1';}});
  const payload={...amazon,agent_task_id:'single_amazon',model:'gpt-image-2',product_name:'帆布画',product_desc:'一幅蓝色画作',categorized_images:[{filename:'主体图',url:'/media/source.png'}],workspace_product_id:'product_1'};
  assert.equal(service.start(payload),'request-1');assert.equal(service.start(payload),'request-1');assert.equal(plans.length,1);
  const task=state.tasks['agent_tasks/'+payload.agent_task_id];
  assert.deepEqual(task.singleDesign.tasks.map(t=>t.aspect_ratio),[...Array(7).fill('1:1'),...Array(5).fill('21:9')]);
  assert.throws(()=>service.start({...payload,workspace_product_id:'product_2'}),{status:409});
  assert.throws(()=>service.start({...payload,design_scope:'main_6_old_aplus'}),{status:409});
  task.status='completed';task.result='方案';service.planSettled(payload.agent_task_id);service.planSettled(payload.agent_task_id);
  assert.equal(submissions.length,1);assert.equal(submissions[0].firebase_tasks[7].aspect_ratio,'21:9');
});
