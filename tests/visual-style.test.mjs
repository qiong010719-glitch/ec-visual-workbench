import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlan,promptForSlot,planProduct} from '../src/planner.mjs';

const product={product_name:'单根自带线充电宝',product_desc:'* 粉色外壳\n* 单根自带线\n* 25,000mAh（90Wh , <100Wh）\n* 通过20,000次弯折测试',generation_mode:'master',design_scope:'main_and_6_aplus',info_density:'high',scene_intensity:'high'};

test('new plans use a shared scene advertising guide and distinct buyer questions',()=>{
  const plan=buildPlan(product);
  assert.equal(plan.visualStyle.id,'scene_advertising');
  assert.match(plan.styleGuide,/整套.*字体/);
  assert.match(plan.styleGuide,/主色/);
  assert.equal(plan.sections.length,12);
  assert.equal(new Set(plan.sections.slice(1,7).map(s=>s.storyboard.buyerQuestion)).size,6);
  assert.ok(plan.sections.slice(1).every(s=>s.storyboard.scene&&s.storyboard.action&&s.storyboard.visualProof));
});
test('a numeric fact remains whole in the slot using it',()=>{
  const plan=buildPlan(product);
  const capacity=plan.sections.find(s=>s.primaryFact.includes('25,000'));
  assert.ok(capacity);assert.match(capacity.primaryFact,/25,000mAh（90Wh , <100Wh）/);
  assert.ok(plan.sections.some(s=>s.primaryFact.includes('20,000次')));
  assert.ok(plan.sections.every(s=>!/^000|^\*?\s*25$/.test(s.primaryFact)));
});
test('master and fast have separate direction and fast controls do not leak into master',()=>{
  const master=buildPlan(product);
  const fast=buildPlan({...product,generation_mode:'fast'});
  assert.equal(master.generationMode,'master');assert.equal(fast.generationMode,'fast');
  assert.match(master.styleGuide,/大师模式.*摄影/);
  assert.match(fast.styleGuide,/快速设计模式.*信息/);
  assert.match(fast.styleGuide,/中高信息密度/);
  assert.doesNotMatch(master.styleGuide,/中高信息密度/);
  assert.equal(master.styleGuide,buildPlan({...product,info_density:'low',scene_intensity:'low'}).styleGuide);
  assert.notEqual(master.sections[1].storyboard.composition,fast.sections[1].storyboard.composition);
  assert.match(master.sections[1].detail,/视觉证据/);
});
test('the original style remains available explicitly',()=>{
  const plan=buildPlan({...product,visual_style:'original'});
  assert.equal(plan.visualStyle.id,'original');assert.equal(plan.styleGuide,'');
  assert.match(plan.sections[1].detail,/少字、大留白/);
});
test('fast scene intensity changes actual scene allocation while master ignores it',()=>{
  const count=plan=>plan.sections.filter(s=>s.storyboard?.sceneType==='lifestyle').length;
  const fast={...product,generation_mode:'fast'};
  assert.ok(count(buildPlan({...fast,scene_intensity:'high'}))>count(buildPlan({...fast,scene_intensity:'low'})));
  assert.equal(count(buildPlan({...product,scene_intensity:'high'})),count(buildPlan({...product,scene_intensity:'low'})));
});
test('pet and electronics storyboards adapt the action to the product',()=>{
  const pet=buildPlan({...product,product_name:'宠物营养膏',product_desc:'易于拌粮，凝胶质地'});
  const electronics=buildPlan(product);
  assert.match(pet.sections.map(s=>s.storyboard?.scene).join(' '),/宠物|喂食/);
  assert.match(electronics.sections.map(s=>s.storyboard?.scene).join(' '),/充电|线缆|设备/);
  assert.doesNotMatch(electronics.styleGuide,/犬|猫|南瓜|FDA/);
});
test('newly studied carrier, garden and bag categories use relevant actions',()=>{
  for(const [name,scene,action] of [['婴儿背带',/亲子/,/穿戴/],['草坪播撒工具',/草坪/,/推行/],['户外手提包',/出行/,/取放|肩背/]]){
    const section=buildPlan({...product,product_name:name,product_desc:'仅依据提供的外观和使用素材'}).sections[1];
    assert.match(section.storyboard.scene,scene);assert.match(section.storyboard.action,action);
  }
});
test('main and THD keep their stronger constraints',()=>{
  const main=buildPlan(product);
  assert.match(main.sections[0].detail,/白底/);
  assert.match(main.sections[0].detail,/不.*营销文字/);
  const thd=buildPlan({...product,design_scope:'thd_only'});
  const prompt=promptForSlot({},thd.sections[3],thd);
  assert.match(prompt,/不加文字、数字、图标和人物/);
  assert.doesNotMatch(prompt,/中高信息密度|短副标题|大标题/);
});
test('edited SOP still carries the shared guide and only its own slot',()=>{
  const plan=buildPlan({...product,custom_layout:{main:true,sub:2}});
  const prompt=promptForSlot({sop_text:'GLOBAL_EDIT\n【主图】\nMAIN_ONLY\n【卖点图1】\nONE_ONLY\n【卖点图2】\nTWO_ONLY'},plan.sections[1],plan);
  assert.match(prompt,/整套.*字体/);assert.match(prompt,/GLOBAL_EDIT/);assert.match(prompt,/ONE_ONLY/);
  assert.doesNotMatch(prompt,/MAIN_ONLY|TWO_ONLY/);
});
test('cross-category references cannot replace the current product scene',()=>{
  const ref={id:'pet-ref',title:'Other Product',matchType:'style-only',images:[{id:'ref1',role:'gallery',purpose:'场景',layout:'狗趴在南瓜边',camera:'近景',lighting:'暖光',palette:'绿色宠物包装',textDensity:'高',transferableGuidance:'宠物吃食'}]};
  const plan=buildPlan(product,[ref]);
  assert.doesNotMatch(plan.sections.map(s=>s.detail).join(' '),/狗趴|绿色宠物包装|宠物吃食/);
  assert.ok(plan.sections.some(s=>s.referenceEvidence?.matchType==='style-only'));
});
test('ultra composites contain one set guide and real per-panel directions',()=>{
  const plan=buildPlan({...product,design_scope:'ultra_main'});
  assert.equal(plan.sections.length,1);assert.match(plan.text,/场景广告/);
  assert.match(plan.sections[0].detail,/分镜1|画面1/);
  assert.match(plan.sections[0].detail,/白底/);
  assert.match(plan.sections[0].detail,/视觉证据/);
});
test('all three no-text/main-only output scopes remain valid',()=>{
  for(const design_scope of ['main_only','old_aplus','premium_aplus']){
    const plan=buildPlan({...product,design_scope});
    assert.ok(plan.sections.length>0);
    for(const section of plan.sections)assert.ok(promptForSlot({},section,plan).length>30);
  }
});
