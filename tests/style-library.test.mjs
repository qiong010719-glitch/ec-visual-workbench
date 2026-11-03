import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ReferenceLibrary,normalizeProduct} from '../src/reference-library.mjs';
import {validateAnalysis} from '../src/reference-analysis.mjs';

function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'style-lib-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new ReferenceLibrary(dir,path.join(dir,'media'));}
function add(lib,asin,title,style=true,status='completed'){
  const p=normalizeProduct({url:'https://www.amazon.com/dp/'+asin,title,brand:asin,images:['https://m.media-amazon.com/'+asin+'.jpg'],styleProfileIds:style?['scene_advertising']:[],collectionIds:style?['scene-20261101']:[]});
  p.analysis={status,images:[{id:p.assets[0].id,role:'gallery',layout:'宠物吃南瓜',camera:'近景',lighting:'暖光',palette:'绿色宠物包装',textDensity:'中',transferableGuidance:'狗在吃食',visualTraits:['complete_scene','headline_hierarchy']}],tags:[]};lib.upsert(p);return p;
}
test('style-matched same category is preferred and metadata survives refresh',t=>{
  const lib=fixture(t);add(lib,'B000000001','Power Bank',false);const p=add(lib,'B000000002','Power Bank');
  assert.equal(lib.retrieve({product_name:'充电宝'},1)[0].id,p.id);
  lib.upsert(normalizeProduct({url:p.url,title:p.title,images:p.assets.map(a=>a.sourceUrl)}));
  assert.deepEqual(lib.state.products[p.id].styleProfileIds,['scene_advertising']);
});
test('cross category style fallback is labeled and strips product-specific observations',t=>{
  const lib=fixture(t);const p=add(lib,'B000000001','Pet Nutrition');
  const refs=lib.retrieve({product_name:'充电宝'});
  assert.equal(refs[0].id,p.id);assert.equal(refs[0].matchType,'style-only');
  assert.doesNotMatch(JSON.stringify(refs[0].images),/宠物|南瓜|吃食|https:/);
  assert.deepEqual(refs[0].images[0].visualTraits,['complete_scene','headline_hierarchy']);
  assert.deepEqual(lib.retrieve({product_name:'充电宝',visual_style:'original'}),[]);
});
test('explicit choices win and incomplete analyses never become fallback',t=>{
  const lib=fixture(t);const p=add(lib,'B000000001','Pet Nutrition');add(lib,'B000000002','Power Bank');
  const partial=add(lib,'B000000003','Power Bank',true,'partial');
  assert.deepEqual(lib.retrieve({product_name:'充电宝',reference_ids:[p.id,partial.id]}).map(r=>r.id),[p.id]);
  assert.deepEqual(lib.retrieve({product_name:'充电宝',reference_ids:['missing']}),[]);
});
test('visual traits are optional and restricted to observed design vocabulary',()=>{
  const asset={id:'a',sha256:'h',role:'gallery'};
  const image={id:'a',layout:'x',camera:'x',lighting:'x',palette:'x',textDensity:'x',transferableGuidance:'x',visualTraits:['complete_scene','BUY THIS BRAND','complete_scene']};
  const result=validateAnalysis({images:[image]},[asset]);
  assert.deepEqual(result.images[0].visualTraits,['complete_scene']);
});
test('generic description and accessory words cannot turn another product type into a category match',t=>{
  const lib=fixture(t);
  const blender=add(lib,'B000000011','Ninja Portable Blender');
  const drill=add(lib,'B000000012','DEWALT Drill Driver Battery and Charger');
  const headphones=add(lib,'B000000013','Portable Wireless Headphones');
  const own=add(lib,'B000000014','Power Bank Portable Charger');
  for(const payload of [
    {product_name:'充电宝',product_desc:'easy to use, lightweight, portable'},
    {product_name:'USB charger',product_desc:'easy to use'},
    {product_name:'不明品类的 portable item',product_desc:'easy to use'}
  ])for(const ref of lib.retrieve({...payload,reference_ids:[blender.id,drill.id,headphones.id]})){
    assert.equal(ref.matchType,'style-only');assert.doesNotMatch(JSON.stringify(ref.images),/宠物|南瓜|吃食/);
  }
  assert.equal(lib.retrieve({product_name:'充电宝'},1)[0].id,own.id);
  assert.equal(lib.retrieve({product_name:'充电宝',reference_ids:[headphones.id]})[0].matchType,'style-only');
});
test('accessories and ambiguous compound titles use style-only even when explicitly chosen',t=>{
  const lib=fixture(t);
  const cases=[
    ['充电宝','Carrying Case for Portable Charger Power Bank'],
    ['耳机','Headphone Stand with USB Charger'],
    ['Screen Protector for iPhone 17','Full-Body iPhone 17 Case with Built-in Glass Screen Protector'],
    ['Screen Protector for iPhone 17','Screen Protector Case for 44mm Apple Watch'],
    ['充电宝','Portable Bluetooth Speaker with Built-in Power Bank']
  ];
  cases.forEach(([query,title],i)=>{
    const p=add(lib,'B00000002'+i,title);p.analysis.tags=['充电宝'];lib.save();
    const ref=lib.retrieve({product_name:query,reference_ids:[p.id]})[0];
    assert.equal(ref.matchType,'style-only',title);assert.doesNotMatch(JSON.stringify(ref.images),/宠物|南瓜|吃食/);
  });
  const own=add(lib,'B000000029','Power Bank, Portable Charger with USB-C Cable');
  // Multi-object titles are conservative; a simple, unambiguous identity remains eligible.
  const plain=add(lib,'B000000030','Power Bank Portable Charger');
  assert.equal(lib.retrieve({product_name:'充电宝',reference_ids:[plain.id]})[0].matchType,'category');
  assert.equal(lib.retrieve({product_name:'充电宝',reference_ids:[own.id]})[0].matchType,'style-only');
});
