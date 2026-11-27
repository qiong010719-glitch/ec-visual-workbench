import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {ECB_RATES_URL,parseEcbRates,createUsdRateProvider,convertProductToUsd} from '../src/sourcing-fx.mjs';
import {normalizeRawProduct,writeProductWorkbook} from '../src/dxm-product-import.mjs';
import {createSourcing} from '../src/sourcing.mjs';
import {rawFixture} from './fixtures/geekbi-raw.mjs';
const XLSX=createRequire(import.meta.url)('xlsx'),id='601105252678120';
const xml=date=>`<gesmes:Envelope><gesmes:name>European Central Bank</gesmes:name><Cube time='${date}'><Cube currency='USD' rate='1.0968'/><Cube currency='CAD' rate='1.5690'/><Cube currency='JPY' rate='174.85'/></Cube></gesmes:Envelope>`;
const now=Date.parse('2026-11-19T02:00:00Z');
const quote=(currency='EUR',source='1',usd='1.0968')=>({from:currency,to:'USD',source:'欧洲央行 ECB',sourceUrl:ECB_RATES_URL,date:'2026-11-18',fetchedAt:new Date(now).toISOString(),sourcePerEur:source,usdPerEur:usd,rate:Number(usd)/Number(source)});
function euro(){const r=rawFixture();r.data.json.localInfo.currency='EUR';r.data.json.moduleMap.priceModule={data:{priceFormat:{currencyCode:'EUR',decimals:2,groupingSeparator:'.',decimalSeparator:',',symbol:'€',position:1}}};Object.assign(r.data.json.sku[0],{normalPrice:1122,normalPriceStr:'11,22€',salePrice:1000});return r;}
function folder(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-fx-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
async function idle(s){const deadline=Date.now()+4000;while(s.isBusy()){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,5));}}

test('EUR amount parsing and USD workbook preserve original price and distinguish promotion',t=>{
  const original=normalizeRawProduct(euro(),id),converted=convertProductToUsd(original,quote());
  assert.equal(original.currency,'EUR');assert.equal(original.skus[0].price,11.22);assert.equal(converted.skus[0].price,12.31);assert.equal(converted.skus[0].salePrice,10.97);assert.equal(converted.skus[0].originalPrice,11.22);assert.equal(converted.originalCurrency,'EUR');
  const file=path.join(folder(t),'usd.xlsx');assert.throws(()=>writeProductWorkbook(original,file),/先转换/);writeProductWorkbook(converted,file);
  const book=XLSX.readFile(file),row=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1})[1];assert.equal(row[13],12.31);assert.equal(row[14],10.97);
  const wrong=euro();wrong.data.json.sku[0].normalPriceStr='1122,00€';assert.throws(()=>normalizeRawProduct(wrong,id),/显示价格不一致/);
});

test('cross rates, zero-decimal currencies, and half-cent rounding use exact arithmetic',()=>{
  const original=normalizeRawProduct(euro(),id);
  const cad={...original,currency:'CAD',skus:[{...original.skus[0],priceMinor:15690,salePriceMinor:15690,price:156.90,salePrice:156.90}]};
  assert.equal(convertProductToUsd(cad,quote('CAD','1.5690')).skus[0].price,109.68);
  const jpy=euro();jpy.data.json.localInfo.currency='JPY';jpy.data.json.moduleMap.priceModule.data.priceFormat={currencyCode:'JPY',decimals:0,groupingSeparator:',',decimalSeparator:'.',symbol:'¥',position:0};Object.assign(jpy.data.json.sku[0],{normalPrice:17485,normalPriceStr:'¥17,485',salePrice:17485});
  assert.equal(convertProductToUsd(normalizeRawProduct(jpy,id),quote('JPY','174.85')).skus[0].price,109.68);
  const tie={...original,skus:[{...original.skus[0],priceMinor:100,salePriceMinor:100}]};assert.equal(convertProductToUsd(tie,quote('EUR','1','1.005')).skus[0].price,1.01);
  assert.throws(()=>convertProductToUsd(original,quote('CAD')),/不匹配/);
});

test('rate provider reuses recent rates across restarts and rejects stale, future, malformed or unsupported quotes',async t=>{
  const directory=folder(t);let calls=0;
  const fetcher=async url=>{assert.equal(url,ECB_RATES_URL);calls++;return {ok:true,text:async()=>xml('2026-11-18')};};
  const a=createUsdRateProvider({directory,fetcher,clock:()=>now});assert.equal((await a.quote('EUR')).rate,1.0968);
  const b=createUsdRateProvider({directory,fetcher,clock:()=>now+1000});assert.equal((await b.quote('CAD')).sourcePerEur,'1.5690');assert.equal(calls,1);
  const cross=await b.quote('JPY','CAD');assert.equal(cross.to,'CAD');assert.equal(cross.sourcePerEur,'174.85');assert.equal(cross.targetPerEur,'1.5690');assert.equal(cross.usdPerEur,'1.0968');assert.equal(calls,1);
  await assert.rejects(b.quote('JPY','XYZ'),/未提供/);
  await assert.rejects(b.quote('XXX'),/未提供/);
  for(const invalid of [xml('2026-11-01'),xml('2026-11-20'),xml('2026-11-18').replace("rate='1.0968'","rate='0'"),xml('2026-11-18').replace("currency='JPY'","currency='USD'")])assert.throws(()=>parseEcbRates(invalid,now));
  const offline=async()=>{throw new Error('offline');};
  const cached=createUsdRateProvider({directory,fetcher:offline,clock:()=>now+2*3600000});assert.equal((await cached.quote('EUR')).cacheFallback,true);
  const stale=createUsdRateProvider({directory,fetcher:offline,clock:()=>now+8*86400000});await assert.rejects(stale.quote('EUR'),/无法取得/);
});

test('failed currency conversion resumes from cached raw detail; mismatch never requests a rate or uploads',async t=>{
  const directory=folder(t);let detailCalls=0,rateCalls=0,uploads=0;let rateReady=false;
  const options={directory,configuration:{GB_APP_KEY:'test',GB_APP_SECRET:'test'},preferences:{erp:()=>({key:'erp',provider:'dianxiaomi',expectedAccount:'test',browserKey:'chrome'}),browser:()=>({type:'chrome'})},client:async kind=>kind==='sites'?{data:[{siteId:6,currency:'CAD'}]}:kind==='search'?{data:{list:[{goodsId:id,siteId:6}],total:1}}:(detailCalls++,euro()),rateProvider:{quote:async currency=>{rateCalls++;assert.equal(currency,'EUR');if(!rateReady)throw new Error('rate unavailable');return quote();}},adapter:{preflight:async()=>{},importProduct:async a=>{uploads++;assert.equal(a.product.skus[0].price,12.31);a.beforeSubmit();return {status:'verified'};}}};
  const s=createSourcing(options);await s.sites();s.startSearch({requestId:'query-fx',siteId:6,keywords:'art'});await idle(s);
  const payload={requestId:'batch-fx-1',searchId:'query-fx',erpKey:'erp',goodsIds:[id]};s.startBatch(payload);await idle(s);assert.equal(uploads,0);assert.match(s.getBatch(payload.requestId).rows[0].error,/rate unavailable/);
  rateReady=true;const restored=createSourcing(options);restored.startBatch({...payload,requestId:'batch-fx-2'});await idle(restored);const row=restored.getBatch('batch-fx-2').rows[0];assert.equal(row.status,'verified');assert.equal(row.detailCached,true);assert.equal(row.detailChargedPoints,0);assert.equal(row.conversion.from,'EUR');assert.equal(row.priceConversions[0].originalPrice,11.22);assert.equal(detailCalls,1);assert.equal(rateCalls,2);
  const bad=euro();bad.data.json.goods.goodsId='601105252678121';const badOptions={...options,directory:folder(t),client:async kind=>kind==='rawDetail'?bad:options.client(kind),rateProvider:{quote:()=>assert.fail('wrong product must stop before FX')},adapter:{preflight:async()=>{},importProduct:()=>assert.fail('wrong product must not upload')}};
  const invalid=createSourcing(badOptions);await invalid.sites();invalid.startSearch({requestId:'query-fx',siteId:6,keywords:'art'});await idle(invalid);invalid.startBatch(payload);await idle(invalid);assert.match(invalid.getBatch(payload.requestId).rows[0].error,/商品ID/);
});
