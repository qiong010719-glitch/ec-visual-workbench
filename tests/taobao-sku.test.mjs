import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildPlan,promptForSlot,splitPlan} from '../src/planner.mjs';

const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/local/taobao-layout.js',import.meta.url),'utf8'),context);
const layout=context.TaobaoLayout;
const clone=value=>JSON.parse(JSON.stringify(value));

// Mirrors the failing default webpage flow: no hand-authored SKU dimensions or SOP.
function payloadFor(mainCount=5,skuCount=1) {
  const spec=layout.normalize({mainCount,skuCount,detailCount:3});
  const custom=layout.toCustomLayout(spec,{});
  const raw=layout.activeSlots(spec).map(s=>({slot:s.slot,title:s.slot===0?'【主图】':s.slot<7?`【卖点图${s.slot}】`:`【高级A+模块${s.slot-6}】`,ref_images:[]}));
  const photos=['SKU图_1','SKU图_2','SKU图_3','SKU图_4','SKU图_5'];
  return {product_name:'玄关柜子',product_desc:'耐看耐用',generation_mode:'fast',visual_style:'scene_advertising',info_density:'high',
    design_scope:'main_6_premium_aplus',custom_layout:{main:custom.main,sub:custom.sub,aplus:custom.aplus,aplus_type:custom.aplusType},
    categorized_images:[{filename:'产品主体图_1',url:'/media/own-main.jpg'},...photos.map((filename,i)=>({filename,url:`/media/own-sku-${i+1}.jpg`}))],
    slot_directives:clone(layout.attachSkuRefs(layout.annotateDirectives(raw,spec).directives,spec,photos).directives)};
}

test('webpage default 5 main + 1 SKU + 3 detail gives SKU its own specification layout',()=>{
  const payload=payloadFor(),plan=buildPlan(payload),sku=plan.sections.find(s=>s.slot===5);
  assert.equal(payload.slot_directives.find(d=>d.slot===5).taobao_role,'sku');
  assert.equal(sku.outputRole,'sku');assert.equal(sku.storyboard,null);assert.equal(sku.referenceEvidence,null);
  assert.deepEqual(sku.ref_images,['SKU图_1']);
  const prompt=promptForSlot(payload,sku,plan);
  assert.match(prompt,/完整商品.*大幅展示/);assert.match(prompt,/尺寸、单位、颜色和款式/);
  assert.match(prompt,/尺寸与方向对应/);assert.match(prompt,/移除状态栏/);
  assert.doesNotMatch(prompt,/要点，一眼看清|10[%％]|20[%％]|10%—20%|信息密度：high|产品主体图_1|SKU图_2|采用ENF/);
  assert.ok(plan.sections.find(s=>s.slot===4).storyboard,'main images still use the advertising storyboard');
  assert.ok(plan.sections.find(s=>s.slot===7).storyboard,'detail pages retain their independent layout');
});

test('SKU role follows customer counts, mode and style instead of a fixed legacy slot number',()=>{
  for(const [main,sku] of [[0,3],[1,6],[3,2],[5,2]])for(const generation_mode of ['fast','master'])for(const visual_style of ['original','scene_advertising']) {
    const payload={...payloadFor(main,sku),generation_mode,visual_style};
    const plan=buildPlan(payload),sections=plan.sections.filter(s=>s.outputRole==='sku');
    assert.equal(sections.length,sku);
    sections.forEach((section,i)=>{
      assert.deepEqual(section.ref_images,[`SKU图_${Math.min(i+1,5)}`]);
      assert.equal(section.storyboard,null);
      assert.match(promptForSlot(payload,section,plan),/SKU规格确认/);
    });
  }
});

test('legacy uploaded-SKU drafts are recognized and stale or rebound plans cannot submit',()=>{
  const payload=payloadFor();payload.slot_directives.forEach(d=>delete d.taobao_role);
  const plan=buildPlan(payload),section=plan.sections.find(s=>s.slot===5);
  assert.equal(section.outputRole,'sku');
  const old={...section};delete old.skuContractVersion;delete old.outputRole;
  assert.throws(()=>promptForSlot(payload,old,plan),/重新构思/);
  const moved=structuredClone(payload);moved.slot_directives.find(d=>d.slot===5).ref_images=['SKU图_2'];
  assert.throws(()=>promptForSlot(moved,section,plan),/重新构思/);
  const replaced=structuredClone(payload);replaced.categorized_images.find(m=>m.filename==='SKU图_1').url='/media/a-different-variant.jpg';
  assert.throws(()=>promptForSlot(replaced,section,plan),/重新构思/);
  const removed=structuredClone(payload);removed.slot_directives.find(d=>d.slot===5).taobao_role='sku';removed.slot_directives.find(d=>d.slot===5).ref_images=[];
  assert.throws(()=>promptForSlot(removed,section,plan),/重新构思/);
});

test('SKU-bound benchmark and full-set advertising do not replace SKU identity or add unprovided specifications',()=>{
  const payload=payloadFor();payload.strict_requirements='要有一张图针对痛点人群';
  payload.slot_directives.find(d=>d.slot===5)._benchmark={assetId:'style-only',layout:{palette:'暖灰',composition:'多卖点图谱'}};
  const plan=buildPlan(payload),sku=plan.sections.find(s=>s.slot===5);
  const prompt=promptForSlot(payload,sku,plan);
  assert.match(prompt,/对标图，仅参考适合SKU的字体/);assert.match(prompt,/看不清或没有提供的参数不猜/);
  assert.doesNotMatch(prompt,/痛点人群|140|100|88cm/);
  assert.equal([...splitPlan(plan.text).blocks.values()].filter(s=>s.includes('本图专属要求：要有一张图针对痛点人群')).length,1);
});
