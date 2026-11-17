import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {buildPlan,promptForSlot} from '../src/planner.mjs';
import {stylesForPlatform} from '../src/creative-direction.mjs';
import {TEMU_DESIGN_REVISION} from '../src/image-scope.mjs';
import {merchantFixture} from './merchant-fixture.mjs';

const source={platform:'temu',image_workflow:'shared',image_ratio:'1:1',design_scope:'main_count',image_count:7,
  generation_mode:'master',visual_style:'scene_advertising',info_density:'high',scene_intensity:'high',target_lang:'English',
  product_name:'冬夜雪巷装饰画',product_desc:'单幅竖版装饰画，蓝白雪景与暖黄色路灯图案。保持原图构图和颜色。'};
const direction=styleId=>({name:'独立风格 '+styleId,styleId,audience:'关注居家装饰的用户',motivation:'看清画作与生活空间的关系',scene:'与已确认用途一致的真实空间'});
const contentKeys=['visualDevice','productRole','scene','action','camera','productScale','humanPresence','sceneType','visualProof','supportingFacts','claimBoundary','informationIncrement'];
const content=board=>Object.fromEntries(contentKeys.map(k=>[k,board[k]]));

test('all 20 Temu styles preserve the complete single-design narrative, people and evidence',()=>{
  for(const generation_mode of ['master','fast'])for(const product of [source,{...source,product_name:'宠物滑板',product_desc:'黑色板面，白色爪印图案，四轮结构。'},
    {...source,product_name:'Black sunglasses',product_desc:'Black frame and dark lenses. Appearance only.'}]){
    const payload={...product,generation_mode},single=buildPlan(payload),variants=[];
    for(const style of stylesForPlatform('temu')){
      const p={...payload,creative_direction:direction(style.id)},plan=buildPlan(p);
      assert.equal(plan.designRevision,TEMU_DESIGN_REVISION);
      assert.equal(plan.sections.length,7);
      assert.equal(plan.sections[0].outputConstraint,'temu-main');
      for(const section of plan.sections.slice(1)){
        const original=single.sections.find(s=>s.slot===section.slot).storyboard;
        assert.deepEqual(content(section.storyboard),content(original),`${generation_mode}/${style.id}/${section.slot}`);
        assert.ok(section.storyboard.composition.startsWith(original.composition),'style must preserve the original photo relationships');
        const prompt=promptForSlot(p,section,plan);
        assert.ok(prompt.includes(section.storyboard.composition));
        assert.ok(prompt.includes(section.storyboard.claimBoundary));
        assert.doesNotMatch(prompt,/不拼人物照片|不安排完整人物|不出现完整人物或房间生活全景/);
        assert.equal(section.ratio,'1:1');
      }
      variants.push(plan.sections[1].storyboard.composition);
    }
    assert.equal(new Set(variants).size,20,'each style still has a distinct visual treatment');
  }
});

test('square main groups reuse the rich single-design sequence without adding wide modules',()=>{
  const single=buildPlan({...source,design_scope:'premium_aplus_only'});
  const group=buildPlan(source);
  assert.deepEqual(group.sections.slice(1,6).map(s=>s.storyboard.visualDevice),single.sections.map(s=>s.storyboard.visualDevice));
  assert.deepEqual(group.sections.slice(1).map(s=>s.storyboard.humanPresence),['person','none','person','hands','none','hands']);
  for(const image_count of [1,2,5,7,8,10]){
    const plan=buildPlan({...source,image_count});
    assert.equal(plan.sections.length,image_count);
    assert.equal(new Set(plan.sections.slice(1).map(s=>s.storyboard.visualDevice)).size,image_count-1);
    for(const section of plan.sections){
      assert.equal(section.ratio,'1:1');
      assert.doesNotMatch(section.title+section.detail,/A\+|宽幅|横幅/);
    }
  }
  // Explicit low-scene selection still takes precedence over decorative styles.
  const low={...source,generation_mode:'fast',scene_intensity:'low'};
  assert.equal(buildPlan({...low,creative_direction:direction('temu-gallery')}).sections[1].storyboard.humanPresence,'none');
});

test('store batches and one-click single design deliver the same content to the image provider',async t=>{
  const calls=[],png=await sharp({create:{width:90,height:90,channels:3,background:'#abcdee'}}).png().toBuffer();
  const f=await merchantFixture({provider:async p=>{calls.push(p);return png;}});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  let batch=await f.api('/api/products',{requestId:'design-parity-20261115',platform:'temu',storeKey:'merchant-ca',
    sourceFolder:imported.sourceFolder,outputParent:imported.outputParent,products:imported.products,imageCount:7,ratio:'1:1',mode:'fast',model:'gpt-image-2'});
  const route='/api/products/'+batch.id;
  await f.api(route+'/plan',{});
  batch=await f.wait(route,b=>b.phase!=='planning');assert.equal(batch.phase,'ready',JSON.stringify(batch.products.map(p=>p.error)));
  for(const product of batch.products){
    assert.equal(product.group.variation,'style');
    assert.equal(product.group.source.info_density,'high');assert.equal(product.group.source.scene_intensity,'high');
    assert.equal(new Set(product.group.sets.map(s=>s.direction.audience)).size,1);
    for(const set of product.group.sets){
      assert.deepEqual(set.plan.sections.slice(1).map(s=>s.storyboard.humanPresence),['person','none','person','hands','none','hands']);
    }
  }
  const group=batch.products[0].group,singleId='single_parity_fixture';
  await f.api('/api/single-design',{...group.source,agent_task_id:singleId,model:'gpt-image-2'});
  await f.wait('/api/tasks/agent_tasks/'+singleId,t=>t.singleDesign?.phase==='completed');
  const single=f.app.store.state.tasks['agent_tasks/'+singleId].plan;
  for(const set of group.sets)for(const section of set.plan.sections.slice(1))assert.deepEqual(content(section.storyboard),content(single.sections.find(s=>s.slot===section.slot).storyboard));
  const singleCalls=calls.length;
  await f.api(route+'/generate',{});batch=await f.wait(route,b=>b.phase!=='generating');
  assert.equal(batch.phase,'completed',JSON.stringify(batch.products.map(p=>p.error)));
  assert.equal(calls.length-singleCalls,28);assert.ok(calls.every(c=>c.model==='gpt-image-2'&&c.ratio==='1:1'&&c.references.length));
  for(const p of batch.products)for(const set of p.group.sets)for(const section of set.plan.sections.slice(1)){
    assert.ok(calls.some(c=>c.prompt.includes(section.storyboard.composition)&&c.prompt.includes(section.storyboard.visualProof)));
  }
  const count=calls.length;await f.api(route+'/generate',{});assert.equal(calls.length,count,'completed batches never resubmit images');
  assert.equal(f.writes.length,0,'validation never writes store drafts');
});
