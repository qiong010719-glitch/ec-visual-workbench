import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {normalizeRawProduct,writeProductWorkbook,validateImportTemplate,DXM_HEADERS} from '../src/dxm-product-import.mjs';
import {compareImportedProduct} from '../src/collection-browser.mjs';
import {createSourcing} from '../src/sourcing.mjs';
import {rawFixture} from './fixtures/geekbi-raw.mjs';
const XLSX=createRequire(import.meta.url)('xlsx');
const id='601105252678120';
function folder(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dxm-import-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
async function idle(service){const deadline=Date.now()+4000;while(service.isBusy()){assert.ok(Date.now()<deadline,'service did not settle');await new Promise(r=>setTimeout(r,5));}}
const erp={key:'erp-main',provider:'dianxiaomi',name:'test',expectedAccount:'test-account',browserKey:'chrome'};
async function fixture(t,{raw=rawFixture(),adapter={},client:custom}={}){
  const calls=[],directory=folder(t),configuration={GB_APP_KEY:'fixture',GB_APP_SECRET:'fixture'};
  const client=custom||async function(kind){calls.push(kind);return kind==='sites'?{data:[{siteId:48,currency:'USD'}]}:kind==='search'?{data:{list:[{goodsId:id,goodsName:'Original title',siteId:48}],total:1}}:raw;};
  const options={directory,configuration,preferences:{erp:key=>({...erp,key}),browser:()=>({type:'chrome'})},client,adapter:{preflight:async()=>{},importProduct:async a=>{a.beforeSubmit();return {status:'verified'};},...adapter}};
  const service=createSourcing(options);await service.sites();service.startSearch({requestId:'query-fixture',siteId:48,keywords:'art'});await idle(service);
  const payload={requestId:'batch-fixture',searchId:'query-fixture',erpKey:erp.key,goodsIds:[id]};return {service,options,payload,calls,directory};
}

test('official workbook preserves text IDs, variant facts and unknown dimensions without formulas',t=>{
  const r=rawFixture();r.data.json.goods.goodsName='=HYPERLINK("https://example.test")';
  const product=normalizeRawProduct(r,id),file=path.join(folder(t),'product.xlsx'),receipt=writeProductWorkbook(product,file);
  const book=XLSX.readFile(file,{cellFormula:true}),sheet=book.Sheets[book.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
  assert.deepEqual(rows[0],DXM_HEADERS);assert.equal(sheet.A2.t,'s');assert.equal(sheet.I2.t,'s');assert.equal(sheet.B2.f,undefined);assert.equal(sheet.B2.v,r.data.json.goods.goodsName);
  assert.equal(rows[1][13],4.51);assert.equal(rows[1][14],4.01);assert.equal(rows[1][15],748);assert.deepEqual(rows[1].slice(16,20),['','','','']);assert.equal(receipt.skuCount,1);
  validateImportTemplate(fs.readFileSync(file));sheet.A1.v='changed';assert.throws(()=>validateImportTemplate(XLSX.write(book,{type:'buffer',bookType:'xlsx'})),/模板字段已变化/);
});

test('wrong identity, currency, missing inventory and unsupported specs cannot silently import',()=>{
  const cases=[
    [r=>r.data.json.goods.goodsId='601105252678121',/商品ID/],
    [r=>r.data.json.localInfo.currency='CAD',/USD/],
    [r=>delete r.data.json.sku[0].stockQuantity,/库存/],
    [r=>r.data.json.sku[0].specs.push({specKey:'款式',specValue:'A'}),/两组规格/],
    [r=>r.data.json.sku[0].skuId=9007199254740992,/精度/],
    [r=>r.data.json.sku[0].normalPriceStr='$5.51',/美元显示价格/],
    [r=>r.data.json.moduleMap.shareModule.data.share.linkUrl='/search_result.html?search_key='+id,/来源链接/],
    [r=>r.data.json.goods.bannerList[0].url='https://localhost/private',/素材地址/]
  ];
  for(const [change,error] of cases){const r=rawFixture();change(r);assert.throws(()=>normalizeRawProduct(r,id),error);}
});

test('verification detects altered stock, missing images, mismatched variants and missing video',()=>{
  const product=normalizeRawProduct(rawFixture(),id);
  const actual={sourceUrl:product.sourceUrl,title:product.title,spu:id,skus:structuredClone(product.skus),images:product.images.map(url=>({url:url.replace('kwcdn.com','cdnfe.com'),loaded:true})),variantImages:product.skus.map(s=>({url:s.image,loaded:true})),detailImages:product.detailImages,videoEntry:true,editUrl:'https://www.dianxiaomi.com/web/productCrawl/edit?id=123'};
  assert.equal(compareImportedProduct(actual,product).status,'verified');
  for(const mutate of [a=>a.skus[0].stock=38,a=>a.images=[],a=>a.skus[0].specs[0].value='红色',a=>a.videoEntry=false,a=>a.skus.push(a.skus[0])]){
    const changed=structuredClone(actual);mutate(changed);assert.equal(compareImportedProduct(changed,product).status,'needs-review');
  }
});

test('preflight failure buys no raw detail and never invokes the Temu resolver',async t=>{
  const f=await fixture(t,{adapter:{preflight:async()=>{throw new Error('wrong account');},resolve:()=>assert.fail('no Temu')}});
  f.service.startBatch(f.payload);await idle(f.service);assert.equal(f.calls.includes('rawDetail'),false);assert.equal(f.service.getBatch(f.payload.requestId).status,'paused');
});

test('retry before upload reuses saved detail across restarts, then deduplicates account aliases',async t=>{
  let uploads=0;const f=await fixture(t,{adapter:{importProduct:async a=>{if(++uploads===1)throw new Error('upload UI not ready');a.beforeSubmit();return {status:'verified'};}}});
  f.service.startBatch(f.payload);await idle(f.service);assert.equal(f.service.getBatch(f.payload.requestId).rows[0].submittedAt,undefined);
  const restored=createSourcing(f.options),second={...f.payload,requestId:'batch-retry'};restored.startBatch(second);await idle(restored);
  assert.equal(f.calls.filter(k=>k==='rawDetail').length,1);assert.equal(restored.getBatch(second.requestId).rows[0].detailCached,true);assert.equal(restored.getBatch(second.requestId).estimatedPoints,0);
  assert.throws(()=>restored.startBatch({...f.payload,requestId:'batch-duplicate',erpKey:'same-account-other-connection'}),/已有提交记录/);
});

test('uncertain paid detail is not reissued by another request ID or a restart',async t=>{
  const f=await fixture(t);const client=f.options.client;let requests=0;f.options.client=async(kind,p)=>{if(kind==='rawDetail'){requests++;throw Object.assign(new Error('unknown paid result'),{uncertain:true});}return client(kind,p);};
  const service=createSourcing(f.options);service.startBatch(f.payload);await idle(service);
  const restored=createSourcing(f.options);assert.throws(()=>restored.startBatch({...f.payload,requestId:'another-batch'}),/详情调用结果待核对/);assert.equal(requests,1);
});

test('a paid detail that fails mapping remains cached, with no browser fallback',async t=>{
  const raw=rawFixture();raw.data.json.localInfo.currency='CAD';const f=await fixture(t,{raw,adapter:{importProduct:()=>assert.fail('must not upload'),resolve:()=>assert.fail('must not navigate Temu')}});
  for(const requestId of ['batch-first','batch-second']){f.service.startBatch({...f.payload,requestId});await idle(f.service);const row=f.service.getBatch(requestId).rows[0];assert.match(row.error,/USD/);assert.equal(row.currency,'CAD');assert.equal(row.detailChargedPoints,requestId==='batch-first'?50:0);}
  assert.equal(f.calls.filter(k=>k==='rawDetail').length,1);
});

test('stop during detail retrieval persists the response but does not upload',async t=>{
  const f=await fixture(t,{adapter:{importProduct:()=>assert.fail('must stop before upload')}});const client=f.options.client;let release;
  f.options.client=(kind,p)=>kind==='rawDetail'?new Promise(resolve=>{release=()=>resolve(rawFixture());}):client(kind,p);
  const service=createSourcing(f.options);service.startBatch(f.payload);while(!release)await new Promise(r=>setTimeout(r,5));service.stop(f.payload.requestId);release();await idle(service);
  assert.equal(service.view().details[id].status,'ready');assert.equal(service.getBatch(f.payload.requestId).rows[0].submittedAt,undefined);
});
