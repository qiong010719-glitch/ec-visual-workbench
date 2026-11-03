import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ReferenceLibrary,normalizeProduct} from '../src/reference-library.mjs';
import {buildPlan} from '../src/planner.mjs';

function libraryFor(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-non3c-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return new ReferenceLibrary(directory,path.join(directory,'media'));
}
function add(library,asin,title,category) {
  const p=normalizeProduct({asin,url:'https://www.amazon.com/dp/'+asin,title,categoryName:category,brand:asin,images:['https://m.media-amazon.com/images/I/'+asin+'.jpg']});
  p.analysis={status:'completed',tags:[category],images:p.assets.map(a=>({id:a.id,role:'main',layout:'实际构图',camera:'近景',lighting:'柔光',palette:'浅色',textDensity:'少字',transferableGuidance:'保留清晰层级'}))};
  p.styleProfileIds=['scene_advertising'];
  library.upsert(p);return p;
}
const cases=[
  ['床单四件套','Queen Size 4 Piece Sheet Set - Comfy Breathable & Cooling Sheets','家居与厨房'],
  ['不锈钢水杯','Owala FreeSip Stainless Steel Water Bottle 24 oz','厨房与餐饮'],
  ['身体乳','eos Shea Better Body Lotion, Vanilla Cashmere','美妆与个护'],
  ['宠物猫粮','Purina Fancy Feast Gravy Lovers Wet Cat Food Variety Pack','宠物用品'],
  ['户外净水吸管','LifeStraw Personal Water Filter for Hiking, Travel and Emergency','运动与户外'],
  ['电子蜡烛','Homemory Flickering Flameless Candle Battery Operated LED Tea Lights','工具与家装'],
  ['软胶捏捏玩具','30 Pack Squishy Toys, Kawaii Squishies Party Favors','玩具与游戏'],
  ['婴儿纸尿裤','Pampers Swaddlers Diapers, Size 5, 132 Count','母婴用品']
];
for(const [query,title,category] of cases)test('specific non-3C retrieval: '+query,t=>{
  const library=libraryFor(t);
  add(library,'B000000001','Blink Home & Pet Indoor Security Camera','电子产品');
  const target=add(library,'B000000002',title,category);
  const [result]=library.retrieve({product_name:query},1);
  assert.equal(result?.id,target.id,'具体商品名应优先匹配实际商品类型');
  assert.equal(result.matchType,'category','应使用同类设计观察');
  assert.equal(result.images[0].layout,'实际构图');
});
test('diaper and bedding storage accessories stay style-only when selected explicitly',t=>{
  const library=libraryFor(t);
  const bag=add(library,'B000000003','Baby Diaper Bag Backpack, Organizer for Disposable Diapers','母婴用品');
  const storage=add(library,'B000000004','Bed Sheet Organizer and Storage Bags','家居与厨房');
  for(const [query,p] of [['婴儿纸尿裤',bag],['床单四件套',storage]]){
    assert.equal(library.retrieve({product_name:query,reference_ids:[p.id]},1)[0].matchType,'style-only');
  }
});
test('body lotion does not use face-mask, body-wash or mixed-kit observations as the same product type',t=>{
  const library=libraryFor(t);
  const lotion=add(library,'B000000005','Moisturizing Body Lotion, Vanilla','美妆与个护');
  assert.equal(library.retrieve({product_name:'身体乳',reference_ids:[lotion.id]},1)[0].matchType,'category');
  for(const [asin,title] of [['B000000006','Hydrating Face Mask'],['B000000007','Creamy Body Wash'],['B000000008','Body Lotion and Facial Serum Kit']]){
    const other=add(library,asin,title,'护肤');
    assert.equal(library.retrieve({product_name:'身体乳',reference_ids:[other.id]},1)[0].matchType,'style-only',title);
  }
});
test('car phone mounts recognize cradle stand as the same object',t=>{
  const library=libraryFor(t);
  add(library,'B000000009','Ninja Portable Blender','厨房与餐饮');
  const mount=add(library,'B000000010','VANMASS Car Phone Holder, Cell Phone Mount for Dashboard Windshield Vent Kit, Truck Cradle Stand for iPhone 18 Pro Max','车载手机支架');
  const [result]=library.retrieve({product_name:'车载手机支架'},1);
  assert.equal(result.id,mount.id);
  assert.equal(result.matchType,'category');
  assert.equal(result.images[0].layout,'实际构图');
});
test('phone mount combined with a separate headphone stand remains ambiguous',t=>{
  const library=libraryFor(t);
  const kit=add(library,'B000000011','Car Phone Mount and Headphone Stand Kit','车载手机支架');
  assert.equal(library.retrieve({product_name:'车载手机支架',reference_ids:[kit.id]})[0].matchType,'style-only');
});
test('body mist cannot inherit body-lotion identity from shared category or analysis tags',t=>{
  const library=libraryFor(t);
  const mist=add(library,'B000000012','eos Cashmere Body Mist- Vanilla, Body Spray for Women, Vegan, 6 fl oz','美妆与个护 / 身体乳');
  mist.analysis.tags=['body lotion'];
  library.save();
  const [result]=library.retrieve({product_name:'身体乳',reference_ids:[mist.id]});
  assert.equal(result.matchType,'style-only');
  assert.notEqual(result.images[0].layout,'实际构图');
});
test('baby diapers do not use pet-diaper observations as the same product type',t=>{
  const library=libraryFor(t);
  const dog=add(library,'B000000013','Amazon Basics Absorbent, Leakproof Male Dog Wrap Disposable Diapers','宠物用品');
  const baby=add(library,'B000000014','Pampers Swaddlers Diapers, Size 5, 132 Count','母婴用品');
  const [best]=library.retrieve({product_name:'婴儿纸尿裤'},1);
  assert.equal(best.id,baby.id);
  assert.equal(best.matchType,'category');
  assert.equal(library.retrieve({product_name:'婴儿纸尿裤',reference_ids:[dog.id]})[0].matchType,'style-only');
  assert.equal(library.retrieve({product_name:'宠物纸尿裤',reference_ids:[baby.id]})[0].matchType,'style-only');
});
test('planning prefers same-product references before focus keywords in cross-category styles',()=>{
  const images=(prefix,layout)=>['main','gallery','aplus'].map(role=>({id:prefix+'-'+role,role,layout,camera:'近景',lighting:'柔光',palette:'浅色',textDensity:'少字',transferableGuidance:'清晰层级'}));
  const references=[
    {id:'lotion',matchType:'category',images:images('lotion','同类构图')},
    {id:'mist',matchType:'style-only',images:images('mist','主图 卖点 功能 细节 特写 材质 场景 结构 信息 留白')}
  ];
  const plan=buildPlan({product_name:'身体乳',custom_layout:{main:1,sub:1,aplus:1,aplus_type:'old'}},references);
  assert.equal(plan.sections.length,3);
  for(const section of plan.sections){
    assert.equal(section.referenceEvidence.productId,'lotion',section.title);
    assert.match(section.detail,/同类构图/);
  }
});
test('planning retains general style fallback when the same product lacks the requested image role',()=>{
  const references=[
    {id:'lotion',matchType:'category',images:[{id:'lotion-main',role:'main',layout:'同类构图'}]},
    {id:'mist',matchType:'style-only',images:[{id:'mist-aplus',role:'aplus',layout:'竞品特殊瓶身',visualTraits:['headline_hierarchy']}]}
  ];
  const plan=buildPlan({product_name:'身体乳',custom_layout:{main:1,aplus:1,aplus_type:'old'}},references);
  assert.equal(plan.sections[0].referenceEvidence.productId,'lotion');
  assert.equal(plan.sections[1].referenceEvidence.productId,'mist');
  assert.equal(plan.sections[1].referenceEvidence.matchType,'style-only');
  assert.doesNotMatch(plan.sections[1].detail,/竞品特殊瓶身/);
});
