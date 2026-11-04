import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlan,promptForSlot} from '../src/planner.mjs';
import {productCategory} from '../src/visual-style.mjs';

const base={generation_mode:'master',visual_style:'scene_advertising',design_scope:'custom',custom_layout:{main:1,sub:6,aplus:7},target_lang:'English'};
const eyewear={...base,product_name:'Black rectangular sunglasses',product_desc:'Black full-rim frame; dark gray lenses; gold-tone temple accent. Only visible appearance is confirmed.'};
const soap={...base,product_name:'Softsoap Antibacterial Hand Soap Refill, White Tea & Berry Scent, 50 fl oz, for Bathroom & Kitchen',product_desc:'Liquid; White Tea & Berry Scent; 50 fl oz refill; Paraben-Free; Phthalate-Free; Washes Away Germs; Gentle on Hands; Daily Handwashing for Bathroom & Kitchen'};

test('a full supplement set mixes scenes, camera distances and people-free product explanations',()=>{
  const plan=buildPlan({...base,product_name:'胶原蛋白粉',product_desc:'白色粉末，在水中呈透明状态；每份8,500 mg，其中5,000 mg为Verisol®胶原蛋白肽'});
  const boards=plan.sections.slice(1).map(s=>s.storyboard);
  assert.ok(new Set(boards.map(b=>b.scene)).size>=6,'the set must not reuse one household counter');
  assert.ok(new Set(boards.map(b=>b.camera)).size>=5,'the set must mix wide shots, macro, overhead and graphic views');
  assert.ok(boards.filter(b=>b.humanPresence==='none').length>=4,'not every selling point needs a person');
  assert.ok(boards.filter(b=>b.humanPresence==='person').length<=3,'full portraits must not dominate the set');
  for(const section of plan.sections.slice(1))assert.ok(promptForSlot({},section,plan).includes(section.storyboard.camera));
});

test('low scene intensity removes lifestyle scene and camera instructions together',()=>{
  const plan=buildPlan({...base,product_name:'Vitamin C gummies',product_desc:'Gummy format',generation_mode:'fast',scene_intensity:'low'});
  const board=plan.sections[1].storyboard;
  assert.equal(board.sceneType,'studio_detail');assert.equal(board.humanPresence,'none');
  assert.doesNotMatch(board.scene,/明确交代人物与环境/);
  assert.doesNotMatch(board.camera,/人物和空间为主/);
  assert.match(board.scene,/静物|摄影背景/);
});

test('an edited SOP can move its one-image theme without reinserting it in the default slot',()=>{
  const requirement='要有一张图是针对痛点人群';
  const payload={...base,product_name:'胶原蛋白粉',product_desc:'白色粉末',custom_layout:{main:1,sub:2},strict_requirements:requirement+'，每张图都有logo'};
  const plan=buildPlan(payload);
  const sop_text=plan.text.replace('本图专属要求：'+requirement+'\n','').replace('【卖点图2】\n','【卖点图2】\n本图专属要求：'+requirement+'\n');
  const prompts=plan.sections.map(section=>promptForSlot({...payload,sop_text},section,plan));
  assert.equal(prompts.filter(p=>p.includes(requirement)).length,1);
  assert.ok(prompts[2].includes(requirement));assert.ok(!prompts[1].includes(requirement));
});

test('one-image continuations remain scoped until an explicit shared requirement starts',()=>{
  const payload={...base,product_name:'胶原蛋白粉',product_desc:'白色粉末',custom_layout:{main:1,sub:2},strict_requirements:'要有一张图针对痛点人群，展示忙碌上班族的日常需求，每张图有logo，含量标注8,500 mg'};
  const plan=buildPlan(payload);
  const prompts=plan.sections.map(section=>promptForSlot({...payload,sop_text:plan.text},section,plan));
  assert.equal(prompts.filter(p=>p.includes('展示忙碌上班族的日常需求')).length,1);
  assert.ok(prompts.every(p=>p.includes('每张图有logo')&&p.includes('含量标注8,500 mg')));
});

test('compatible one-image requests are allowed in THD and single-main output scopes',()=>{
  for(const options of [{design_scope:'thd_only',custom_layout:null,strict_requirements:'至少一张图展示产品背面'},{custom_layout:{main:1,sub:0,aplus:0},strict_requirements:'一张图展示产品正面'}]){
    const payload={...base,product_name:'收纳盒',product_desc:'蓝色外壳',...options};
    const plan=buildPlan(payload);
    const prompts=plan.sections.map(section=>promptForSlot(payload,section,plan));
    assert.equal(prompts.filter(p=>p.includes(options.strict_requirements)).length,1);
    assert.ok(prompts.every(p=>/本图最终约束/.test(p)));
  }
});

test('specific use categories take precedence over bottle, kitchen and tea words',()=>{
  for(const [name,category] of [[soap.product_name,'handsoap'],[eyewear.product_name,'eyewear'],['小檗碱 berberine supplement bottle','supplements'],['OLLY Sleep Gummies bottle','supplements'],['保温水杯 bottle','outdoor']])assert.equal(productCategory({product_name:name}),category,name);
});
test('all seven A+ chapters have separate questions, devices and a clear information increment',()=>{
  for(const product of [eyewear,soap,{...base,product_name:'营养软糖',product_desc:'Gummy format; 60 gummies'}, {...base,product_name:'桌面支架',product_desc:'黑色外观'}]){
    const plan=buildPlan(product),gallery=plan.sections.slice(1,7),aplus=plan.sections.slice(7);
    assert.equal(aplus.length,7);
    assert.equal(new Set(aplus.map(s=>s.storyboard.buyerQuestion)).size,7);
    assert.equal(new Set(aplus.map(s=>s.storyboard.visualDevice)).size,7);
    assert.ok(aplus.every(s=>s.storyboard.informationIncrement?.length>15));
    assert.ok(aplus.every(s=>!gallery.some(g=>g.storyboard.visualDevice===s.storyboard.visualDevice)));
    assert.ok(new Set(aplus.map(s=>s.storyboard.productRole)).size>=3);
  }
});
test('supporting facts follow visual intent instead of input order',()=>{
  const plan=buildPlan(soap),reordered=buildPlan({...soap,product_desc:soap.product_desc.split(';').reverse().join(';')});
  const scent=p=>p.sections.find(s=>s.storyboard?.intent==='scent');
  assert.ok(scent(plan),'a scent story exists for a hand soap with scent evidence');
  assert.deepEqual(scent(plan).storyboard.supportingFacts,['White Tea & Berry Scent']);
  assert.deepEqual(scent(reordered).storyboard.supportingFacts,scent(plan).storyboard.supportingFacts);
  assert.match(scent(plan).storyboard.claimBoundary,/香调.*成分/);
  assert.doesNotMatch(scent(plan).primaryFact,/50 fl oz|Paraben/);
});
test('sparse inputs use appearance evidence and do not prescribe invented product claims',()=>{
  const plan=buildPlan({...eyewear,product_desc:'墨镜，外观见上传图片。'});
  assert.ok(plan.sections.slice(1).every(s=>Array.isArray(s.storyboard.supportingFacts)));
  const prompt=promptForSlot({},plan.sections[9],plan);
  assert.match(prompt,/不得.*UV|不得.*偏光/);
  assert.match(prompt,/上传.*外观|外观.*上传/);
  assert.ok(plan.sections.slice(1).every(s=>s.storyboard.evidenceMode==='visible_reference'||s.storyboard.supportingFacts.length));
});
test('the chosen slot retains evidence and A+ increment with edited SOP, without other slot content',()=>{
  const plan=buildPlan(eyewear),section=plan.sections[10];
  const sop_text='CUSTOM GLOBAL\n【高级A+模块3】\nOTHER_SLOT\n【高级A+模块4】\nEDITED SCENE AND COPY\n【高级A+模块5】\nANOTHER_SLOT';
  const prompt=promptForSlot({sop_text},section,plan);
  assert.match(prompt,/EDITED SCENE AND COPY/);
  assert.ok(prompt.includes(section.storyboard.informationIncrement));
  assert.ok(prompt.includes(section.storyboard.claimBoundary));
  assert.doesNotMatch(prompt,/OTHER_SLOT|ANOTHER_SLOT/);
  assert.match(prompt,/用户.*编辑.*优先/);
});
test('rich scene plans are versioned while original style and constrained formats remain isolated',()=>{
  const plan=buildPlan(eyewear);assert.ok(plan.visualStyle.version>=2);
  const original=buildPlan({...eyewear,visual_style:'original'});assert.equal(original.styleGuide,'');assert.equal(original.visualStyle.version,1);
  assert.ok(original.sections.every(s=>!s.storyboard));
  const main=promptForSlot({},plan.sections[0],plan);assert.doesNotMatch(main,/本图叙事约定|本图信息增量/);
  const thd=buildPlan({...eyewear,custom_layout:null,design_scope:'thd_only'});
  assert.ok(thd.sections.every(s=>!s.storyboard));
});

test('product type beats ingredient and shape modifiers in mixed names',()=>{
  for(const [product_name,expected] of [['Vitamin C Face Serum','beauty'],['Cat Eye Sunglasses','eyewear'],['Cat-eye sunglasses','eyewear'],['Dog vitamin gummies','pet'],['Vitamin C gummy bottle','supplements'],['White Tea Hand Soap for Kitchen','handsoap']])assert.equal(productCategory({product_name}),expected,product_name);
});
test('unscented and missing scent evidence produce neutral chapters, not fragrance promises',()=>{
  for(const product_desc of ['Fragrance-free; unscented; liquid hand soap','无香精；无香型；液体洗手液','Liquid hand soap']){
    const plan=buildPlan({...soap,product_name:'Unscented Hand Soap',product_desc});
    for(const slot of [2,10]){
      const b=plan.sections.find(s=>s.slot===slot).storyboard;
      assert.notEqual(b.intent,'scent');assert.doesNotMatch(b.copy,/MEET YOUR SCENT|A SCENTED MOMENT/);
      assert.doesNotMatch(b.composition,/香气意象|SCENT NOTES/);
    }
  }
  assert.equal(buildPlan(soap).sections[2].storyboard.intent,'scent');
});
test('explicit child eyewear changes the depicted audience without inventing fit or protection',()=>{
  for(const product_name of ['Kids sunglasses','儿童太阳镜']){
    const plan=buildPlan({...eyewear,product_name,product_desc:'儿童款；黑色镜框'});
    const text=plan.sections.slice(1).map(s=>s.detail).join('\n');
    assert.match(text,/儿童/);assert.doesNotMatch(text,/成人/);assert.match(text,/偏光/);
  }
  const text=buildPlan({...eyewear,product_desc:'黑色镜框'}).text;
  assert.doesNotMatch(text,/完整人物必须是成人/);
  assert.match(text,/适用人群未提供/);
});
test('an empty current scene SOP block is rejected before a paid image can use it',()=>{
  const plan=buildPlan(eyewear);
  assert.throws(()=>promptForSlot({sop_text:'【卖点图2】\n   \n【卖点图3】\nA valid other slot'},plan.sections[2],plan),/当前图片.*内容.*空|当前图片.*空/);
});
