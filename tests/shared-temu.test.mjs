import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {buildPlan,promptForSlot,slotPlan} from '../src/planner.mjs';
import {createWorkbench} from '../src/server.mjs';

const base={product_name:'米色帆布画',product_desc:'单幅，保留画框与原有颜色。',generation_mode:'master',design_scope:'main_6_premium_aplus',visual_style:'scene_advertising',target_market:'美国',target_lang:'English',model_ethnicity:'Caucasian people',text_depth:true,info_density:'high',scene_intensity:'high'};
test('main-only counts extend through ten without treating later images as A+; invalid counts are rejected',()=>{
  const source={...base,platform:'temu',image_workflow:'shared',design_scope:'main_count',image_ratio:'1:1'};
  for(const generation_mode of ['fast','master'])for(const image_count of [1,7,8,10])for(const visual_style of ['original','scene_advertising']){
    const p={...source,generation_mode,image_count,visual_style},plan=buildPlan(p);
    assert.equal(plan.sections.length,image_count);
    assert.deepEqual(plan.sections.map(s=>s.slot),Array.from({length:image_count},(_,i)=>i));
    assert.equal(plan.sections[0].outputConstraint,'temu-main');
    assert.match(promptForSlot(p,plan.sections[0],plan),/非白色环境/);
    assert.doesNotMatch(promptForSlot(p,plan.sections[0],plan),/白底产品主图|白底、产品完整/);
    for(const section of plan.sections){
      assert.equal(section.ratio,'1:1');assert.doesNotMatch(section.title,/A\+/);
      assert.doesNotMatch(section.purpose,/A\+/);assert.doesNotMatch(section.detail,/A\+|宽幅|横幅/);
      assert.match(promptForSlot(p,section,plan),/画幅最终要求：1:1/);
    }
  }
  for(const image_count of [undefined,0,11,-1,1.5,'8'])assert.throws(()=>buildPlan({...source,image_count}),/1 至 10/);
  assert.throws(()=>buildPlan({...source,image_count:8,generation_mode:'ultra_fast'}),/快速或大师/);
  assert.throws(()=>buildPlan({...source,image_count:8,custom_layout:{main:1,sub:6,aplus:1}}),/不混用/);
});
test('shared Temu preserves output options and gallery rules while using a contextual hero',()=>{
  for(const mode of ['fast','master'])for(const ratio of ['1:1']){
    const original=buildPlan({...base,generation_mode:mode}),shared=buildPlan({...base,generation_mode:mode,platform:'temu',image_workflow:'shared',image_ratio:ratio});
    assert.deepEqual(shared.sections.map(s=>s.title),original.sections.map(s=>s.title));
    assert.equal(shared.sections.length,12);assert.equal(shared.styleGuide,original.styleGuide);
    for(const [i,section] of shared.sections.entries()){
      if(i===0){
        assert.equal(section.outputConstraint,'temu-main');assert.match(section.detail,/非白色环境/);
        const {detail,outputConstraint,...rest}=section;
        const {detail:originalDetail,outputConstraint:originalConstraint,...originalRest}=original.sections[i];
        assert.deepEqual({...rest,ratio:original.sections[i].ratio},originalRest);
      }else assert.deepEqual({...section,ratio:original.sections[i].ratio},original.sections[i]);
      assert.equal(section.ratio,ratio);assert.match(promptForSlot({},section,shared),new RegExp('画幅最终要求：'+ratio));
    }
    assert.match(shared.text,/人物：Caucasian people/);assert.match(shared.text,/文字穿插：允许/);
  }
  for(const scope of ['main_and_6','old_aplus_only','premium_aplus_only','thd_only','ultra_main_8','ultra_old_aplus_4','ultra_premium_aplus_5']){
    const p={...base,design_scope:scope,generation_mode:scope.startsWith('ultra_')?'ultra_fast':'fast'};
    const shared=slotPlan({...p,platform:'temu',image_workflow:'shared',image_ratio:'1:1'}),original=slotPlan(p);
    for(const [i,section] of shared.entries()){
      if(scope==='main_and_6'&&i===0){assert.match(section.detail,/非白色环境/);assert.match(original[i].detail,/白底产品主图/);}
      else assert.deepEqual({...section,ratio:null},{...original[i],ratio:null});
    }
  }
});

test('Temu hero excludes white-background design references and covers ultra panels without changing THD or A+',()=>{
  const source={...base,platform:'temu',image_workflow:'shared',image_ratio:'1:1'};
  const reference={id:'white-design',images:[{id:'white-main',role:'main',layout:'白底产品主图',camera:'正面',lighting:'均匀',palette:'white',transferableGuidance:'必须使用纯白背景'}]};
  const plan=buildPlan(source,[reference]);
  assert.equal(plan.sections[0].referenceEvidence,null);
  const prompt=promptForSlot(source,plan.sections[0],plan);
  assert.match(prompt,/原始素材即使是白底，也只提取商品身份/);
  assert.doesNotMatch(prompt,/必须使用纯白背景|白底产品主图|白底、产品完整/);
  for(const visual_style of ['original','scene_advertising']){
    const p={...source,design_scope:'ultra_main_8',generation_mode:'ultra_fast',visual_style};
    const ultra=buildPlan(p);
    assert.match(ultra.sections[0].detail,/分镜1（独立画面）：Temu 轮播首图/);
    assert.match(ultra.sections[0].detail,/非白色环境/);
    assert.doesNotMatch(ultra.sections[0].detail,/白底产品主图/);
    assert.ok(ultra.temuHeroPolicyVersion);
  }
  for(const design_scope of ['thd_only','old_aplus_only','ultra_premium_aplus_5']){
    const p={...source,design_scope},unchanged=buildPlan({...p,platform:undefined,image_workflow:undefined,image_ratio:undefined}),current=buildPlan(p);
    assert.equal(current.temuHeroPolicyVersion,undefined);
    assert.deepEqual(current.sections.map(s=>s.detail),unchanged.sections.map(s=>s.detail));
  }
});

test('shared options survive API planning, sparse slots, model selection and ratio-bound export',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-temu-api-')),calls=[];
  const png=await sharp({create:{width:120,height:160,channels:3,background:'#345678'}}).png().toBuffer();
  const a=createWorkbench({dataDirectory:dir,configuration:{},provider:async p=>{calls.push(p);return png;}});
  await new Promise(r=>a.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+a.server.address().port;
  const {token}=await fetch(url+'/api/session').then(r=>r.json());
  const api=async(route,p)=>{const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(p)});return {status:r.status,data:await r.json()};};
  const wait=async id=>{for(let i=0;i<300;i++){const task=a.store.state.tasks[id];if(['completed','failed'].includes(task?.status))return task;await new Promise(r=>setTimeout(r,20));}throw new Error('Task timed out');};
  t.after(async()=>{await new Promise(r=>a.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const p={...base,platform:'temu',image_workflow:'shared',image_ratio:'1:1',design_scope:'custom',custom_layout:{main:1,sub:1,aplus:1,aplus_type:'premium'},categorized_images:[{filename:'产品主体图.png',url:a.saveImage(png)}],agent_task_id:'shared_plan'};
  assert.equal((await api('/api/agent',p)).status,202);const plan=await wait('agent_tasks/shared_plan');assert.equal(plan.status,'completed');assert.deepEqual(plan.plan.sections.map(s=>s.slot),[0,1,7]);
  const tasks=plan.plan.sections.map(s=>({slot:s.slot,taskId:'shared_image_'+s.slot,aspect_ratio:'1:1'}));
  const payload={...p,sop_text:plan.result,model:'gpt-image-2.5-sunburst',firebase_tasks:tasks};
  const version=plan.plan.temuHeroPolicyVersion,charges=a.store.state.charges.length;
  delete plan.plan.temuHeroPolicyVersion;
  const rejected=await api('/api/generate',payload);
  assert.equal(rejected.status,409);assert.match(rejected.data.error,/首图规则已更新/);
  assert.equal(calls.length,0);assert.equal(a.store.state.charges.length,charges);
  assert.ok(tasks.every(t=>!a.store.state.tasks['hyrule_tasks/'+t.taskId]));
  plan.plan.temuHeroPolicyVersion=version;
  assert.ok((await api('/api/generate',{...payload,image_ratio:'3:4'})).status>=400);assert.equal(calls.length,0);
  assert.equal((await api('/api/generate',payload)).status,202);
  const done=await Promise.all(tasks.map(t=>wait('hyrule_tasks/'+t.taskId)));
  assert.ok(done.every(t=>t.status==='completed'&&t.dimensions.width===1024&&t.dimensions.height===1024));
  assert.ok(calls.every(p=>p.model==='gpt-image-2.5-sunburst'&&p.ratio==='1:1'));
  assert.match(calls[0].prompt,/首图最终约束.*\n?/);
  assert.match(calls[0].prompt,/非白色环境/);assert.doesNotMatch(calls[0].prompt,/白底产品主图|白底、产品完整/);
  const draft=await api('/api/drafts',{platform:'temu',image_ratio:'1:1',title:base.product_name,description:base.product_desc,images:done.map(t=>t.imageUrl),skus:[],status:'draft'});
  assert.equal(draft.status,200);assert.deepEqual(draft.data.mainImages,draft.data.detailImages);
});
