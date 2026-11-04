import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan,promptForSlot,splitPlan} from '../src/planner.mjs';
import {readCreativeCopy} from '../src/creative-direction.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
async function fixture(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-multisets-'));
  const captured=[];
  const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async p=>{captured.push(p);return png;},...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  t.after(async()=>{if(app.server.listening)await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  const call=async(url,payload)=>{const r=await fetch(base+url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
  const wait=async(id,predicate)=>{for(let i=0;i<400;i++){const {data}=await call('/api/multisets/'+id);if(predicate(data))return data;await new Promise(r=>setTimeout(r,10));}throw new Error('Group did not settle');};
  const image=app.saveImage(png);
  const source={product_name:'米色浴室地垫',product_desc:'米色长方形，圆角包边，可见鹅卵石纹理。',generation_mode:'master',visual_style:'scene_advertising',design_scope:'custom',custom_layout:{main:1,sub:1,aplus:1},categorized_images:[{filename:'产品主体图.png',category:'产品主体图',url:image}]};
  const create=async(extra={})=>{const r=await call('/api/multisets',{request_id:'test_create_001',source,count:3,variation:'both',model:'gpt-image-2.5-sunburst',...extra});assert.equal(r.status,202,JSON.stringify(r.data));return wait(r.data.id,g=>g.recommendation.status!=='running');};
  return {...app,directory,base,call,wait,create,source,captured};
}

test('three independent sets keep full slots, original references, selected model and distinct directions',async t=>{
  const app=await fixture(t);let group=await app.create();
  assert.equal(group.sets.length,3);assert.equal(group.totalImages,9);assert.equal(app.captured.length,0);
  assert.equal((await app.call('/api/multisets/'+group.id+'/plan')).status,405);
  await app.call('/api/multisets/'+group.id+'/plan',{});
  group=await app.wait(group.id,g=>g.sets.every(s=>s.planning.status==='completed'));
  assert.equal(new Set(group.sets.map(s=>s.planId)).size,3);
  assert.ok(group.sets.every(s=>s.plan.sections.length===3));
  await app.call('/api/multisets/'+group.id+'/generate',{});
  group=await app.wait(group.id,g=>g.completedImages===9);
  assert.equal(app.captured.length,9);assert.ok(app.captured.every(p=>p.model==='gpt-image-2.5-sunburst'));
  assert.ok(app.captured.every(p=>p.references.includes(app.source.categorized_images[0].url)));
  for(const set of group.sets){
    const image=set.images.find(i=>i.slot===1),task=app.store.state.tasks['hyrule_tasks/'+image.task.taskId];
    assert.ok(task.prompt.includes(set.direction.audience));assert.ok(task.prompt.includes(set.direction.motivation));
    assert.equal(task.setId,set.id);assert.equal(task.groupId,group.id);
  }
  const calls=app.captured.length,charges=app.store.state.charges.length;
  await app.call('/api/multisets/'+group.id+'/generate',{});
  assert.equal(app.captured.length,calls);assert.equal(app.store.state.charges.length,charges);
  const restored=JSON.parse(fs.readFileSync(path.join(app.directory,'workbench.json')));
  assert.equal(restored.multisets[group.id].sets.length,3);
});

test('directions can be edited before planning and cannot change an accepted set while it runs',async t=>{
  const app=await fixture(t);let group=await app.create({count:2});
  const directions=group.sets.map(s=>s.direction);directions[0].audience='喜欢整洁浴室的用户';
  const edited=await app.call('/api/multisets/'+group.id+'/directions',{revision:group.revision,directions});
  assert.equal(edited.status,200);
  assert.equal((await app.call('/api/multisets/'+group.id+'/directions',{revision:group.revision,directions})).status,409);
  await app.call('/api/multisets/'+group.id+'/plan',{});
  group=await app.wait(group.id,g=>g.sets.every(s=>s.planning.status==='completed'));
  assert.ok(group.sets[0].plan.text.includes('喜欢整洁浴室的用户'));
  assert.equal((await app.call('/api/multisets/'+group.id+'/directions',{revision:group.revision,directions})).status,409);
  assert.equal((await app.call('/api/multisets',{request_id:'test_create_001',source:app.source,count:2,variation:'both',model:'gpt-image-2.5-sunburst'})).data.id,group.id);
});

test('invalid counts, unsupported modes, absent product images and duplicated directions are rejected before image calls',async t=>{
  const app=await fixture(t);
  for(const count of [0,11,2.5,'3'])assert.equal((await app.call('/api/multisets',{request_id:'bad_count_001',source:app.source,count,variation:'both',model:'gpt-image-2'})).status,400);
  assert.equal((await app.call('/api/multisets',{request_id:'bad_mode_001',source:{...app.source,generation_mode:'ultra_fast'},count:2,variation:'both',model:'gpt-image-2'})).status,400);
  assert.equal((await app.call('/api/multisets',{request_id:'no_image_001',source:{...app.source,categorized_images:[]},count:2,variation:'both',model:'gpt-image-2'})).status,400);
  const group=await app.create({count:2});
  assert.equal((await app.call('/api/multisets/'+group.id+'/directions',{revision:group.revision,directions:[group.sets[0].direction,group.sets[0].direction]})).status,400);
  assert.equal((await app.call('/api/multisets/'+group.id+'/directions',{revision:group.revision,directions:[group.sets[0].direction,{...group.sets[1].direction,styleId:group.sets[0].direction.styleId}]})).status,400);
  assert.equal(app.captured.length,0);
});

test('creative direction reaches full planning and individual prompts while main and THD constraints remain',()=>{
  const direction={name:'温暖生活',audience:'新居布置用户',motivation:'了解地垫在浴室中的搭配',scene:'日常洗漱区域',styleId:'natural'};
  const base={product_name:'浴室地垫',product_desc:'米色，圆角包边。',generation_mode:'master',visual_style:'scene_advertising',design_scope:'main_6_premium_aplus',creative_direction:direction};
  const plan=buildPlan(base);
  assert.ok(plan.text.includes(direction.audience));assert.ok(plan.sections[1].storyboard.buyerQuestion.includes(direction.audience));
  assert.ok(promptForSlot({},plan.sections[1],plan).includes(direction.motivation));
  const other=buildPlan({...base,creative_direction:{...direction,styleId:'bold',audience:'关注视觉搭配的用户'}});
  assert.notEqual(other.text,plan.text);assert.equal(other.sections.length,plan.sections.length);
  const main=promptForSlot({},plan.sections[0],plan);assert.match(main,/白底、产品完整入镜/);assert.doesNotMatch(main,/本套独立创意方向/);
  const thd=buildPlan({...base,design_scope:'thd_only'});assert.match(promptForSlot({},thd.sections[2],thd),/不加文字、数字、图标和人物/);
});

test('a failed set does not block another set and explicit retries do not regenerate its successful siblings',async t=>{
  let plans=0,images=0;
  const app=await fixture(t,{planner:async p=>{if(++plans===2)throw new Error('Temporary planner failure');return buildPlan(p);},provider:async()=>{if(++images===2)throw new Error('Provider failure');return png;}});
  let group=await app.create({count:2});
  await app.call('/api/multisets/'+group.id+'/plan',{});
  group=await app.wait(group.id,g=>g.sets.every(s=>['completed','failed'].includes(s.planning.status)));
  assert.equal((await app.call('/api/multisets/'+group.id+'/generate',{})).status,409);assert.equal(images,0);
  const good=group.sets.find(s=>s.planning.status==='completed');
  await app.call('/api/multisets/'+group.id+'/generate',{setId:good.id});
  group=await app.wait(group.id,g=>g.sets.find(s=>s.id===good.id).images.every(i=>['completed','failed'].includes(i.task?.status)));
  const failed=group.sets.find(s=>s.id===good.id).images.find(i=>i.task.status==='failed');
  const before=images;
  const retry={setId:good.id,slot:failed.slot,mode:'regenerate',request_id:'retry_unique_001'};
  assert.equal((await app.call('/api/multisets/'+group.id+'/retry',retry)).status,202);
  await app.wait(group.id,g=>g.sets.find(s=>s.id===good.id).images.every(i=>i.task?.status==='completed'));
  await app.call('/api/multisets/'+group.id+'/retry',retry);assert.equal(images,before+1);
  await app.call('/api/multisets/'+group.id+'/plan',{});
  await app.wait(group.id,g=>g.sets.every(s=>s.planning.status==='completed'));
  assert.equal(plans,3,'Only failed planning was retried');
});

test('a saved download URL is retried without another image generation or charge',async t=>{
  let generated=0,downloads=0;
  const app=await fixture(t,{provider:async({onProgress})=>{generated++;await onProgress({resultUrl:'https://example.com/kept.png'});throw new Error('download interrupted');},download:async()=>{downloads++;return png;}});
  let group=await app.create({count:1,source:{...app.source,custom_layout:{main:1,sub:0,aplus:0}}});
  await app.call('/api/multisets/'+group.id+'/plan',{});await app.wait(group.id,g=>g.sets[0].planning.status==='completed');
  await app.call('/api/multisets/'+group.id+'/generate',{});group=await app.wait(group.id,g=>g.failedImages===1);
  assert.equal(group.sets[0].images[0].task.resultUrl,undefined);
  assert.equal(group.sets[0].images[0].task.canRetryDownload,true);
  const charges=app.store.state.charges.length;
  await app.call('/api/multisets/'+group.id+'/retry',{setId:group.sets[0].id,slot:0,mode:'download'});
  await app.wait(group.id,g=>g.completedImages===1);
  assert.equal(generated,1);assert.equal(downloads,1);assert.equal(app.store.state.charges.length,charges);
});

test('multiple full fourteen-image sets retain all slots without reducing per-set output',async t=>{
  const app=await fixture(t);let group=await app.create({count:2,source:{...app.source,custom_layout:{main:1,sub:6,aplus:7}}});
  assert.equal(group.totalImages,28);
  await app.call('/api/multisets/'+group.id+'/plan',{});await app.wait(group.id,g=>g.sets.every(s=>s.planning.status==='completed'));
  await app.call('/api/multisets/'+group.id+'/generate',{});group=await app.wait(group.id,g=>g.completedImages===28);
  assert.equal(new Set(group.sets.flatMap(s=>s.images.map(i=>i.task.taskId))).size,28);
  assert.ok(group.sets.every(s=>s.plan.sections.length===14&&s.images.length===14));
});

test('style-only and audience-only variation preserve the selected fixed dimension',async t=>{
  const app=await fixture(t);
  const style=await app.create({request_id:'styles_fixed_001',variation:'style',sharedAudience:'新居布置用户'});
  assert.equal(new Set(style.sets.map(s=>s.direction.audience)).size,1);
  assert.equal(style.sets[0].direction.audience,'新居布置用户');
  assert.equal(new Set(style.sets.map(s=>s.direction.styleId)).size,3);
  const audience=await app.create({request_id:'audience_fixed_001',variation:'audience',sharedStyle:'editorial'});
  assert.ok(audience.sets.every(s=>s.direction.styleId==='editorial'));
  assert.equal(new Set(audience.sets.map(s=>s.direction.audience)).size,3);
});

test('recommendations cannot change the fixed audience or style selected by the user',async t=>{
  const app=await fixture(t,{directionPlanner:async()=>({source:'ai',directions:[{name:'错误方向',audience:'其他用户',motivation:'关注细节',scene:'日常环境',styleId:'natural'}]})});
  const group=await app.create({count:1,variation:'style',sharedAudience:'新居布置用户'});
  assert.equal(group.recommendation.status,'failed');assert.match(group.recommendation.error,/已选目标人群/);
  assert.equal(app.captured.length,0);
});

test('a failed regeneration keeps the previous successful image available',async t=>{
  let calls=0;
  const app=await fixture(t,{provider:async()=>{if(++calls>3)throw new Error('retry failed');return png;}});
  let group=await app.create({count:1});
  await app.call('/api/multisets/'+group.id+'/plan',{});await app.wait(group.id,g=>g.phase==='ready');
  await app.call('/api/multisets/'+group.id+'/generate',{});group=await app.wait(group.id,g=>g.phase==='completed');
  const previous=group.sets[0].images[0].task.imageUrl;
  await app.call('/api/multisets/'+group.id+'/retry',{setId:group.sets[0].id,slot:0,mode:'regenerate',request_id:'keep_previous_001'});
  group=await app.wait(group.id,g=>g.failedImages===1);
  assert.equal(group.sets[0].images[0].previousResult.imageUrl,previous);
  assert.equal(group.completedImages,2);assert.equal(calls,4);
});

test('restart preserves groups and only explicitly submits missing slots, never known interrupted requests',async t=>{
  const app=await fixture(t);let group=await app.create({count:1});
  await app.call('/api/multisets/'+group.id+'/plan',{});group=await app.wait(group.id,g=>g.phase==='ready');
  const stored=app.store.state.multisets[group.id],image=stored.sets[0].images[0];
  image.taskId='msimg_known_interrupted';image.attempts.push(image.taskId);
  app.store.task('hyrule_tasks/'+image.taskId,{taskId:image.taskId,status:'running',slot:0});
  await new Promise(r=>app.server.close(r));
  const captured=[];
  const restarted=createWorkbench({dataDirectory:app.directory,configuration:{},provider:async p=>{captured.push(p);return png;}});
  await new Promise(r=>restarted.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+restarted.server.address().port;
  const read=()=>fetch(base+'/api/multisets/'+group.id).then(r=>r.json());
  try{
    const {token}=await fetch(base+'/api/session').then(r=>r.json());
    const send=async()=>fetch(base+'/api/multisets/'+group.id+'/generate',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:'{}'});
    group=await read();
    assert.equal(group.sets[0].images[0].task.status,'failed');assert.equal(captured.length,0);
    assert.equal((await send()).status,202);
    for(let attempt=0;attempt<200;attempt++){group=await read();if(group.completedImages===2)break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(group.completedImages,2);
    assert.equal(group.sets[0].images[0].task.taskId,'msimg_known_interrupted');
    assert.equal(group.failedImages,1);assert.equal(captured.length,2);
    await send();assert.equal(captured.length,2);
  }finally{await new Promise(r=>restarted.server.close(r));}
});

test('cross-set duplicate headlines block images until the affected plan is edited',async t=>{
  const app=await fixture(t,{planner:async payload=>{
    const plan=buildPlan(payload);
    const text=plan.sections.map(s=>s.title+'\n独立设计内容。'+(s.outputConstraint?'':`\n画面主标题：${s.slot===1?'Your Setup, Your Way':'Details in '+payload.creative_direction.styleId}\n画面副文案：Visible product details.`)).join('\n\n');
    return {...plan,source:'configured-planner',text,copyHeadlines:readCreativeCopy(splitPlan(text).blocks,plan.sections)};
  }});
  let group=await app.create({count:2});
  await app.call('/api/multisets/'+group.id+'/plan',{});group=await app.wait(group.id,g=>g.sets.every(s=>s.planning.status==='completed'));
  assert.equal(group.phase,'attention');assert.equal(group.quality.issues.length,1);
  assert.equal((await app.call('/api/multisets/'+group.id+'/generate',{})).status,409);
  assert.equal((await app.call('/api/multisets/'+group.id+'/generate',{setId:group.sets[0].id})).status,409);
  assert.equal(app.captured.length,0);
  const set=group.sets[0],text=set.plan.text.replace('Your Setup, Your Way','Materials for Your Setup');
  assert.equal((await app.call('/api/multisets/'+group.id+'/plan-text',{setId:set.id,text})).status,200);
  assert.equal((await app.call('/api/multisets/'+group.id+'/generate',{})).status,202);
  group=await app.wait(group.id,g=>g.completedImages===6);
  assert.equal(group.quality.issues.length,0);assert.equal(app.captured.length,6);
});
