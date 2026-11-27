import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {normalizeRawProduct,normalizePackageDefaults,writeProductWorkbook,validateImportTemplate,DXM_HEADERS} from '../src/dxm-product-import.mjs';
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

test('explicit package defaults fill every SKU with numeric cm and kg without changing variant facts',t=>{
  const r=rawFixture();r.data.json.sku.push({...structuredClone(r.data.json.sku[0]),skuId:'101130239481328',stockQuantity:125});
  const packageDefaults={lengthCm:'62',widthCm:'42',heightCm:'4.5',weightKg:'0.75'};
  const product=normalizeRawProduct(r,id,{packageDefaults}),file=path.join(folder(t),'packages.xlsx');
  assert.deepEqual(product.packageDefaults,{lengthCm:62,widthCm:42,heightCm:4.5,weightKg:0.75});
  assert.deepEqual(packageDefaults,{lengthCm:'62',widthCm:'42',heightCm:'4.5',weightKg:'0.75'});
  assert.match(product.warnings.join('\n'),/统一默认值/);
  writeProductWorkbook(product,file);
  const book=XLSX.readFile(file),sheet=book.Sheets[book.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
  assert.deepEqual(rows[0],DXM_HEADERS);
  for(const row of rows.slice(1))assert.deepEqual(row.slice(16,20),[62,42,4.5,0.75]);
  for(const address of ['Q2','R2','S2','T2','Q3','R3','S3','T3'])assert.equal(sheet[address].t,'n');
  assert.equal(rows[1][15],748);assert.equal(rows[2][15],125);assert.equal(rows[1][10],'蓝色');assert.equal(rows[1][12],'30x45cm');
});

test('invalid or incomplete package defaults cannot become a partially filled workbook',t=>{
  const valid={lengthCm:62,widthCm:42,heightCm:4.5,weightKg:0.75};
  for(const value of [0,-1,Infinity,NaN,'',' ','0','bad','1e3',true,null,undefined]){
    assert.throws(()=>normalizePackageDefaults({...valid,weightKg:value}),/重量.*有效数值/);
  }
  assert.equal(normalizePackageDefaults(undefined),undefined);
  assert.equal(normalizePackageDefaults(null),undefined);
  assert.throws(()=>normalizePackageDefaults([]),/必须包含/);
  assert.throws(()=>normalizePackageDefaults({lengthCm:62}),/宽.*有效数值/);
  assert.throws(()=>normalizeRawProduct(rawFixture(),id,{packageDefaults:{...valid,heightCm:0}}),/高.*有效数值/);
  const product=normalizeRawProduct(rawFixture(),id);product.packageDefaults={...valid,widthCm:0};
  const file=path.join(folder(t),'invalid.xlsx');assert.throws(()=>writeProductWorkbook(product,file),/宽.*有效数值/);assert.equal(fs.existsSync(file),false);
});

test('source categories retain separate Temu category and navigation identities outside the import columns',t=>{
  const r=rawFixture();Object.assign(r.data.json.goods,{catId:12869,catId1:9711,catId2:12865,catId3:12869,catId4:0});
  r.data.json.crumbOptList=[{optId:-100,optName:'Home'},{optId:36,optName:'Home & Kitchen',pRec:'not retained'},{optId:761,optName:'Wall Art'}];
  const product=normalizeRawProduct(r,id);
  assert.deepEqual(product.sourceCategory,{platform:'temu',categoryId:'12869',categoryPathIds:['9711','12865','12869'],breadcrumbs:[{navigationId:'36',name:'Home & Kitchen'},{navigationId:'761',name:'Wall Art'}],namePath:'Home & Kitchen > Wall Art'});
  assert.equal(JSON.stringify(product).includes('not retained'),false);
  const file=path.join(folder(t),'categories.xlsx');writeProductWorkbook(product,file);
  const book=XLSX.readFile(file),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''});
  assert.equal(rows[0].length,21);assert.equal(rows[1].length,21);assert.equal(rows[1].includes('12869'),false);
  assert.deepEqual(normalizeRawProduct(rawFixture(),id).sourceCategory,{platform:'temu',categoryId:null,categoryPathIds:[],breadcrumbs:[],namePath:''});
  r.data.json.goods.catId=9007199254740992;assert.throws(()=>normalizeRawProduct(r,id),/分类编号/);
});

test('wrong identity, currency, missing inventory and unsupported specs cannot silently import',()=>{
  const cases=[
    [r=>r.data.json.goods.goodsId='601105252678121',/商品ID/],
    [r=>r.data.json.localInfo.currency='CAD',/USD/],
    [r=>delete r.data.json.sku[0].stockQuantity,/库存/],
    [r=>r.data.json.sku[0].specs.push({specKey:'款式',specValue:'A'}),/两组规格/],
    [r=>r.data.json.sku[0].skuId=9007199254740992,/精度/],
    [r=>r.data.json.sku[0].normalPriceStr='$5.51',/显示价格/],
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

test('package verification requires every declared cm and kg value for the correct SKU',()=>{
  const packageDefaults={lengthCm:62,widthCm:42,heightCm:4.5,weightKg:0.75},product=normalizeRawProduct(rawFixture(),id,{packageDefaults});
  const actual={sourceUrl:product.sourceUrl,title:product.title,spu:id,skus:product.skus.map(s=>({...structuredClone(s),package:{lengthCm:'62.00',widthCm:'42',heightCm:'4.5',weightKg:'0.750'}})),images:product.images.map(url=>({url,loaded:true})),variantImages:product.skus.map(s=>({url:s.image,loaded:true})),detailImages:product.detailImages,videoEntry:true};
  const verified=compareImportedProduct(actual,product);assert.equal(verified.status,'verified');assert.equal(verified.evidence.packageChecksPassed,true);
  for(const mutate of [a=>delete a.skus[0].package,a=>a.skus[0].package.lengthCm=null,a=>a.skus[0].package.widthCm='',a=>a.skus[0].package.heightCm='0',a=>a.skus[0].package.weightKg='750',a=>a.skus[0].id='another-sku']){
    const changed=structuredClone(actual);mutate(changed);const result=compareImportedProduct(changed,product);assert.equal(result.status,'needs-review');assert.equal(result.evidence.packageChecksPassed,false);assert.match(result.error,/包裹尺寸或重量/);
  }
  const withoutDefaults=normalizeRawProduct(rawFixture(),id);delete actual.skus[0].package;assert.equal(compareImportedProduct(actual,withoutDefaults).evidence.packageChecksPassed,null);
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
