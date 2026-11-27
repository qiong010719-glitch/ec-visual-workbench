import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {categoryForProduct,defaultsFromMother,validatePackageDefaults,listingReadiness,retainedListingData,readPackageUnits,readTemuListing,listingAction,createDxmListingPreparer,originForProduct,settleListingSave,compareListingWithPriorProof,comparableListing,comparableListingSaveSnapshot,newDraftSiteInitializationIssues,initializeNewDraftSite} from '../src/dxm-listing-prepare.mjs';

const item=(label,selections=[],controls=[])=>({label,selections,controls,checked:[],errors:[]});
const sourceCategory={platform:'temu',categoryId:'12869',breadcrumbs:[{name:'Home & Kitchen'},{name:'Wall Art'}]};
const packageDefaults={lengthCm:50,widthCm:40,heightCm:3,weightKg:1.25};

test('SKU readiness rejects collected Chinese specifications and CJK punctuation without rewriting identifiers',()=>{
  for(const value of ['11.8英寸*15.7英寸（30厘米*40厘米）','ART（A-01）','ART，01','ART【01】','SKU-\u{20000}']){
    const {snapshot}=legacyFixture();snapshot.fields.variationSku=[value];const before=structuredClone(snapshot),issues=listingReadiness(snapshot);
    assert.ok(issues.some(issue=>issue.includes('第 1 个SKU货号包含中文或中文标点')),value);assert.deepEqual(snapshot,before);
  }
  for(const value of ['ART-CA_001','123456789','A4-3M.2026/01+BLUE','11.8in*15.7in(30cm*40cm)']){
    const {snapshot}=legacyFixture();snapshot.fields.variationSku=[value];assert.deepEqual(listingReadiness(snapshot),[],value);
  }
});

test('English title readiness flags actual Han text without classifying numeric models or Latin proper names as untranslated',()=>{
  for(const value of ['生命之树帆布画','3M Canvas Print 生命之树']){
    const {snapshot}=legacyFixture();snapshot.items.find(item=>item.label==='英文标题').controls[0].value=value;
    const before=structuredClone(snapshot);assert.ok(listingReadiness(snapshot).includes('英文标题仍含汉字，需核对英文译文'));assert.deepEqual(snapshot,before);
  }
  for(const value of ['3M A4 30x40cm','Café de Flore – Édition 2026','Åland CANVAS-001','123456789']){
    const {snapshot}=legacyFixture();snapshot.items.find(item=>item.label==='产品标题').controls[0].value='生命之树帆布画';snapshot.items.find(item=>item.label==='英文标题').controls[0].value=value;
    assert.deepEqual(listingReadiness(snapshot),[],value);
  }
});

function legacyFixture(){
  const sourceUrl='https://www.temu.com/goods.html?goods_id=601102827259469',url='https://www.dianxiaomi.com/web/popTemu/edit?id=123456789';
  const product={sourceUrl,title:'Wood Framed Canvas Poster',sourceCategory,description:'Frame Type：Wrapped Canvas\nArtwork Surface Material：Canvas\nOrigin：Zhejiang, China',images:['https://img.kwcdn.com/goods/main-a.jpg','https://img.kwcdn.com/goods/main-b.jpg'],detailImages:['https://img.kwcdn.com/goods/detail.jpg'],skus:[{id:'17606613128563',stock:944,specs:[{key:'Size',value:'40cm'}],image:'https://img.kwcdn.com/goods/variant.jpg'}]};
  const defaults={storeName:'店铺1',site:'加拿大站',templateId:'987654321',packageDefaults,warehouse:'加拿大仓',shippingTemplate:'加拿大',dispatch:'2个工作日内发货',category:{label:'海报和印刷品',path:['家居、厨房用品','装饰字画','海报和印刷品']}};
  const priceSnapshot=[{sku:product.skus[0].id,declaredCurrency:'CNY',declaredPrice:'81.93',suggestedCurrency:'USD',suggestedPrice:''}];
  const previousPreparation={status:'prepared',ready:true,saved:true,published:false,url,issues:[],verification:{checkedAt:'2026-11-18T20:11:04.127Z',sourceUrl,storeName:'店铺1',skuCount:1,packageDefaults,warehouse:defaults.warehouse,category:[defaults.category.label],origin:['中国大陆','浙江省'],shippingTemplate:[defaults.shippingTemplate],dispatch:[defaults.dispatch],priceSnapshot,priceCurrency:'CNY',mainImageCount:2,detailImageCount:1,variantImageCount:1,publicationAccepted:false}};
  const snapshot={url,account:'fixture',storeName:'店铺1',site:'加拿大站',sources:[sourceUrl],items:[item('产品标题',[],[{name:'',value:product.title}]),item('英文标题',[],[{name:'',value:product.title}]),item('产品分类',[defaults.category.label]),item('产地',['中国大陆','浙江省']),item('运费模板',[defaults.shippingTemplate]),item('承诺发货时效',[defaults.dispatch])],fields:{variationSku:[product.skus[0].id],price:['81.93'],stock:['944'],skuLength:['50'],skuWidth:['40'],skuHeight:['3'],weight:['1250']},media:{main:product.images.map(u=>u.replace('img.kwcdn.com','img.cdnfe.com')),detail:product.detailImages,variants:[product.skus[0].image]},variants:['尺码\n40cm\n添加','颜色\n添加'],warehouses:[defaults.warehouse],priceSnapshot};
  return {args:{platformEditUrl:url,erpConnection:{expectedAccount:'fixture'},browserConfig:{type:'chrome'},targetStore:{platform:'temu',name:'店铺1',site:'加拿大站'},product:structuredClone(product),defaults:structuredClone(defaults),previousPreparation:structuredClone(previousPreparation)},snapshot:structuredClone(snapshot),extra:{units:{dimension:'cm',weight:'g'},categoryPath:[...defaults.category.path]}};
}

function legacyTransport(fixture,events){
  const page={send:async method=>{events.push(method);if(method!=='Page.enable')throw new Error('Unexpected page write '+method);},close:()=>{},evaluate:async(fn)=>{events.push(fn.name);if(fn===readTemuListing)return structuredClone(fixture.snapshot);if(fn===readPackageUnits)return fixture.extra.units;if(fn.name==='readTemplateCategoryPath')return fixture.extra.categoryPath;throw new Error('Unexpected evaluation '+fn.name);}};
  return {'bit-cdp.mjs':{connection:async()=>({ws:'mock'}),connect:async()=>({send:async method=>{events.push(method);if(method==='Target.createTarget')return {targetId:'read-only-tab'};if(method!=='Target.closeTarget')throw new Error('Unexpected browser action '+method);},close:()=>{}}),pageById:async()=>page,poll:async fn=>{const value=await fn();if(!value)throw new Error('snapshot mismatch');return value;}},'erp-page-state.mjs':{navigateAndWait:async(_page,url)=>{assert.equal(url,fixture.args.platformEditUrl);events.push('navigate-read');}}};
}

function siteFixture(){
  const f=legacyFixture();delete f.args.previousPreparation;f.args.targetStore.key='temu-store-fixture';f.snapshot.site='美国站';
  const now=Date.now();f.args.newDraftSiteInitialization={version:1,source:'workbench-new-claim',saveState:'no-workbench-save-submission',account:f.args.erpConnection.expectedAccount,sourceUrl:f.args.product.sourceUrl,collectionEditUrl:'https://www.dianxiaomi.com/web/productCrawl/edit?id=123456788',platformEditUrl:f.args.platformEditUrl,skuIds:f.args.product.skus.map(s=>s.id),targetStore:structuredClone(f.args.targetStore),fromSite:'美国站',toSite:'加拿大站',claimSubmittedAt:new Date(now-60000).toISOString(),claimRecordTime:new Date(now-90000).toISOString(),verifiedAt:new Date(now).toISOString()};
  f.expected={url:f.args.platformEditUrl,account:f.args.erpConnection.expectedAccount,storeName:f.args.targetStore.name,site:'加拿大站',sourceUrl:f.args.product.sourceUrl,templateId:f.args.defaults.templateId};return f;
}

function siteTransport(f,{missingOption=false,afterSelect}={}){
  const events=[];let current=structuredClone(f.snapshot),step;
  return {events,read:async expected=>{events.push(['read',expected.site]);if(expected.site&&expected.site!==current.site)throw new Error('site mismatch');if(expected.account!==current.account||expected.storeName!==current.storeName||!current.sources.includes(expected.sourceUrl)||current.url!==expected.url)throw new Error('identity mismatch');return structuredClone(current);},
    point:async input=>{step=input.locator.siteInitialization;events.push(['point',step]);assert.deepEqual(input.initialization,f.args.newDraftSiteInitialization);return step==='option'&&missingOption?null:{x:10,y:20};},
    send:async(method,input)=>{events.push([method,input.type]);if(step==='option'&&input.type==='mouseReleased'){current.site=f.expected.site;afterSelect?.(current);}},
    poll:async fn=>{const result=await fn();if(!result)throw new Error('exact option or state missing');return result;}};
}

test('only a fresh new-claim proof can initialize the observed US site to the configured Canada site',async()=>{
  const f=siteFixture(),io=siteTransport(f);assert.deepEqual(newDraftSiteInitializationIssues(f.args,f.snapshot),[]);
  const result=await initializeNewDraftSite(f.args,f.expected,io);assert.equal(result.site,'加拿大站');
  assert.deepEqual(io.events.filter(e=>e[0]==='point'),[['point','open'],['point','option']]);
  assert.deepEqual(io.events.at(-1),['read','加拿大站']);assert.deepEqual(result.fields,f.snapshot.fields);assert.deepEqual(result.priceSnapshot,f.snapshot.priceSnapshot);
  const already=siteFixture();already.snapshot.site='加拿大站';delete already.args.newDraftSiteInitialization;const noWrite=siteTransport(already);
  await initializeNewDraftSite(already.args,already.expected,noWrite);assert.equal(noWrite.events.filter(e=>e[0]==='point').length,0);
});

test('site initialization rejects missing, stale, saved, wrong-account/source/store/SKU/destination evidence before any action',async()=>{
  for(const change of [
    f=>{delete f.args.newDraftSiteInitialization;},f=>{f.args.newDraftSiteInitialization.saveState='saved';},f=>{f.args.preparationIntent={};},f=>{f.args.prepareSubmittedAt=new Date().toISOString();},f=>{f.args.previousPreparation={saved:true};},f=>{f.args.previousPreparation={saved:null};},
    f=>{f.args.newDraftSiteInitialization.verifiedAt=new Date(Date.now()-660000).toISOString();},f=>{f.args.newDraftSiteInitialization.claimRecordTime=new Date(Date.now()-86400000).toISOString();},
    f=>{f.args.newDraftSiteInitialization.account='another';},f=>{f.args.newDraftSiteInitialization.sourceUrl+='0';},f=>{f.args.newDraftSiteInitialization.targetStore.key='another';},f=>{f.args.newDraftSiteInitialization.targetStore.name='another';},f=>{f.args.newDraftSiteInitialization.skuIds=['another'];},
    f=>{f.args.newDraftSiteInitialization.platformEditUrl+='0';},f=>{f.args.newDraftSiteInitialization.collectionEditUrl='https://www.dianxiaomi.com/web/productCrawl/edit?id=123';},f=>{f.args.defaults.site='美国站';},f=>{f.args.newDraftSiteInitialization.toSite='英国站';},f=>{f.snapshot.site='英国站';},f=>{f.snapshot.sources=['different'];},f=>{f.snapshot.fields.variationSku=['another'];},f=>{f.snapshot.items[0].controls[0].value='different';}
  ]){const f=siteFixture();change(f);const io=siteTransport(f);await assert.rejects(initializeNewDraftSite(f.args,f.expected,io));assert.equal(io.events.filter(e=>e[0]==='point').length,0,change.toString());}
});

test('initialization requires the exact visible option and restores identity, price, media and SKU checks immediately',async()=>{
  const f=siteFixture();await assert.rejects(initializeNewDraftSite(f.args,f.expected,siteTransport(f,{missingOption:true})),/missing/);
  for(const afterSelect of [s=>{s.account='another';},s=>{s.storeName='another';},s=>{s.site='英国站';},s=>{s.sources=['different'];},s=>{s.fields.variationSku=['another'];},s=>{s.priceSnapshot[0].declaredPrice='1';},s=>{s.media.main=[];}]){
    const changed=siteFixture();await assert.rejects(initializeNewDraftSite(changed.args,changed.expected,siteTransport(changed,{afterSelect})));
  }
  const pending=siteFixture();pending.snapshot.fields.variationSku=[];pending.snapshot.priceSnapshot=[];
  assert.deepEqual(newDraftSiteInitializationIssues(pending.args,pending.snapshot),[],'a new editor with no category can use the separately verified complete platform-list SKU proof');
});

test('a legacy single-SKU receipt is independently re-read, compared with source and prior prices, and never resaved',async()=>{
  const f=legacyFixture(),events=[],adapter=createDxmListingPreparer({},legacyTransport(f,events));
  const result=await adapter.verify(f.args);
  assert.equal(result.status,'prepared');assert.equal(result.saved,true);assert.equal(result.published,false);
  assert.equal(result.verification.method,'read-only-source-and-prior-proof');assert.equal(result.verification.readOnly,true);
  assert.equal(result.verification.priorVerifiedAt,f.args.previousPreparation.verification.checkedAt);
  assert.notEqual(result.verification.checkedAt,result.verification.priorVerifiedAt);
  assert.ok(events.includes('navigate-read')&&events.includes('readTemuListing'));assert.ok(!events.includes('listingAction'));
  assert.equal(Object.hasOwn(result,'expectedSnapshot'),false);assert.equal(Object.hasOwn(f.args,'preparationIntent'),false);
  const second=await adapter.verify({...f.args,previousPreparation:result});assert.equal(second.saved,true,'a newly verified receipt retains the evidence needed for later read-only checks');
});

test('legacy read-only verification detects changed source data, product identity, package, category, logistics and prices',()=>{
  const f=legacyFixture();assert.deepEqual(compareListingWithPriorProof(f.snapshot,f.args,f.extra),[]);
  const cases=[
    s=>{s.account='other';},s=>{s.storeName='店铺2';},s=>{s.site='美国站';},s=>{s.sources=['https://www.temu.com/goods.html?goods_id=601100000000000'];},
    s=>{s.items[0].controls[0].value='Changed title';},s=>{s.fields.variationSku=['other-sku'];},s=>{s.fields.stock=['1'];},s=>{s.variants=['尺码\n140cm\n添加'];},
    s=>{s.media.main.reverse();},s=>{s.media.detail=[];},s=>{s.media.variants=['https://img.kwcdn.com/wrong.jpg'];},s=>{s.fields.weight=['1.25'];},
    s=>{s.items.find(i=>i.label==='产品分类').selections=['其他'];},s=>{s.items.find(i=>i.label==='产地').selections=['中国大陆','广东省'];},
    s=>{s.warehouses=['其他仓'];},s=>{s.items.find(i=>i.label==='运费模板').selections=['美国'];},s=>{s.items.find(i=>i.label==='承诺发货时效').selections=['1个工作日内发货'];},
    s=>{s.priceSnapshot[0].declaredPrice='12.31';},s=>{s.priceSnapshot[0].declaredCurrency='USD';},s=>{s.items.push({...item('品牌'),required:true});}
  ];
  for(const change of cases){const snapshot=structuredClone(f.snapshot);change(snapshot);assert.ok(compareListingWithPriorProof(snapshot,f.args,f.extra).length,change.toString());}
  assert.ok(compareListingWithPriorProof(f.snapshot,f.args,{...f.extra,categoryPath:['别的父分类','海报和印刷品']}).length);
  assert.ok(compareListingWithPriorProof(f.snapshot,f.args,{...f.extra,units:{dimension:'cm',weight:null}}).length);
});

test('insufficient or changed legacy proof cannot open a browser or confirm an unknown save',async()=>{
  const f=legacyFixture(),adapter=createDxmListingPreparer({WORKBENCH_ADAPTER_ROOT:'Z:/not-a-real-adapter'});
  const cases=[a=>{a.previousPreparation.saved=null;},a=>{delete a.previousPreparation.verification.priceSnapshot;},a=>{delete a.previousPreparation.verification.origin;},a=>{delete a.previousPreparation.verification.mainImageCount;},a=>{a.previousPreparation.url+='0';},a=>{a.defaults.packageDefaults.lengthCm=51;},a=>{a.product.skus.push({...a.product.skus[0],id:'another'});}];
  for(const change of cases){const args=structuredClone(f.args);change(args);const result=await adapter.verify(args);assert.equal(result.status,'needs-review');assert.equal(result.saved,null);}
});

test('a complete pre-save snapshot takes precedence over a legacy receipt',async()=>{
  const f=legacyFixture(),events=[],adapter=createDxmListingPreparer({},legacyTransport(f,events));
  f.args.previousPreparation.verification.priceSnapshot[0].declaredPrice='1';
  f.args.preparationIntent={url:f.args.platformEditUrl,expectedSnapshot:comparableListing(f.snapshot)};
  const result=await adapter.verify(f.args);assert.equal(result.saved,true);assert.equal(result.verification.method,undefined);assert.ok(!events.includes('readPackageUnits'));
});

test('saved product-title repeated ASCII spaces are equivalent without another save or mutating the persisted intent',async()=>{
  const f=legacyFixture(),events=[],adapter=createDxmListingPreparer({},legacyTransport(f,events));
  f.snapshot.items[0].controls[0].value='Canvas Print,  Framed Artwork';
  const expectedSnapshot=structuredClone(comparableListing(f.snapshot));f.args.preparationIntent={url:f.args.platformEditUrl,expectedSnapshot:structuredClone(expectedSnapshot)};
  f.snapshot.items[0].controls[0].value='Canvas Print, Framed Artwork';
  const result=await adapter.verify(f.args);assert.equal(result.saved,true);assert.equal(result.ready,true);assert.equal(result.published,false);
  assert.deepEqual(f.args.preparationIntent.expectedSnapshot,expectedSnapshot);assert.equal(events.filter(x=>x==='listingAction').length,0);
});

test('source and prior-proof title checks use the same narrow space equivalence without changing original source data',()=>{
  const f=legacyFixture();f.args.product.title='Wood Framed  Canvas Poster';
  for(const i of f.snapshot.items.filter(i=>['产品标题','英文标题'].includes(i.label)))i.controls[0].value='Wood Framed Canvas Poster';
  assert.deepEqual(compareListingWithPriorProof(f.snapshot,f.args,f.extra),[]);assert.equal(f.args.product.title,'Wood Framed  Canvas Poster');
  f.snapshot.items[0].controls[0].value='Wood Framed Canvas Posters';assert.ok(compareListingWithPriorProof(f.snapshot,f.args,f.extra).some(x=>x.includes('产品标题')));
  const fresh=siteFixture();fresh.args.product.title='Wood Framed  Canvas Poster';fresh.snapshot.items[0].controls[0].value='Wood Framed Canvas Poster';
  assert.deepEqual(newDraftSiteInitializationIssues(fresh.args,fresh.snapshot),[]);
  fresh.snapshot.items[0].controls[0].value='Wood Framed\tCanvas Poster';assert.ok(newDraftSiteInitializationIssues(fresh.args,fresh.snapshot).some(x=>x.includes('标题')));
});

test('save comparison preserves title words, case, punctuation, other whitespace, attributes, SKU, price and media differences',()=>{
  const f=legacyFixture();f.snapshot.items[0].controls[0].value='Canvas Print,  Framed Artwork';
  const before=comparableListing(f.snapshot),normal=comparableListingSaveSnapshot(before);
  for(const change of [
    s=>{s.retained.items[0].controls[0].value='Canvas Print, Other Artwork';},
    s=>{s.retained.items[0].controls[0].value='canvas Print, Framed Artwork';},
    s=>{s.retained.items[0].controls[0].value='Canvas Print Framed Artwork';},
    s=>{s.retained.items[0].controls[0].value='Canvas Print,\tFramed Artwork';},
    s=>{s.retained.items[0].controls[0].value='Canvas Print,\nFramed Artwork';},
    s=>{s.retained.items[1].controls[0].value+='  extra';},
    s=>{s.retained.items.push(item('规格',[],[{value:'40  cm'}]));},
    s=>{s.fields.variationSku[0]='different';},s=>{s.fields.price[0]='1';},s=>{s.retained.priceSnapshot[0].declaredCurrency='USD';},s=>{s.retained.media.main.reverse();}
  ]){const changed=structuredClone(before);change(changed);assert.notDeepEqual(comparableListingSaveSnapshot(changed),normal,change.toString());}
  const attribute={retained:{items:[item('规格',[],[{value:'40  cm'}])]}};
  assert.notDeepEqual(comparableListingSaveSnapshot(attribute),comparableListingSaveSnapshot({retained:{items:[item('规格',[],[{value:'40 cm'}])]}}));
});

test('unconfigured destination never opens a browser or reports publication readiness',async()=>{
  const adapter=createDxmListingPreparer({WORKBENCH_ADAPTER_ROOT:'Z:/not-a-real-adapter'});
  const result=await adapter.prepare({targetStore:{platform:'tiktok',name:'Example'},platformEditUrl:'https://www.dianxiaomi.com/example'});
  assert.equal(result.status,'needs-configuration');assert.equal(result.ready,false);assert.equal(result.published,false);
  assert.equal((await adapter.readDefaults({store:{platform:'tiktok'}})).ready,false);
});

test('an unknown save cannot be confirmed without its exact pre-save snapshot and destination',async()=>{
  const adapter=createDxmListingPreparer({WORKBENCH_ADAPTER_ROOT:'Z:/not-a-real-adapter'});
  const missing=await adapter.verify({targetStore:{platform:'temu'},platformEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456789'});
  assert.equal(missing.status,'needs-review');assert.equal(missing.ready,false);assert.equal(missing.saved,null);
  const changed=await adapter.verify({targetStore:{platform:'temu'},platformEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456789',preparationIntent:{url:'https://www.dianxiaomi.com/web/popTemu/edit?id=987654321',expectedSnapshot:{}}});
  assert.equal(changed.status,'needs-review');assert.equal(changed.saved,null);
  const incomplete=await adapter.verify({targetStore:{platform:'temu'},platformEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456789',preparationIntent:{url:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456789',expectedSnapshot:{}}});
  assert.equal(incomplete.status,'needs-review');assert.equal(incomplete.saved,null);
});

test('a lost save toast still gets one independent read, while a toast cannot substitute for saved data',async()=>{
  let reads=0;
  const verified=await settleListingSave({observeReceipt:async()=>{throw new Error('toast timed out');},verifyReadOnly:async()=>{reads++;return {status:'prepared',ready:true,saved:true,published:false};}});
  assert.equal(reads,1);assert.equal(verified.saved,true);assert.equal(verified.ready,true);assert.deepEqual(verified.saveReceipt,{observed:false,observationIssue:'toast timed out'});
  const mismatch=await settleListingSave({observeReceipt:async()=>true,verifyReadOnly:async()=>({status:'needs-review',ready:false,saved:null,published:false})});
  assert.equal(mismatch.ready,false);assert.equal(mismatch.saved,null);assert.equal(mismatch.saveReceipt.observed,true);
  await assert.rejects(settleListingSave({observeReceipt:async()=>false,verifyReadOnly:async()=>{throw new Error('saved snapshot does not match');}}),/does not match/);
});

test('template measurements retain their source and convert grams to KG, but unknown units block',()=>{
  const mother={url:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456789',variantFields:{skuLength:['50'],skuWidth:['40'],skuHeight:['3'],weight:['1250']},items:[item('产品分类',['海报和印刷品']),item('运费模板',['加拿大']),{...item('承诺发货时效'),checked:['2个工作日内发货']}]};
  const args={mother,extra:{warehouses:['加拿大仓']},units:{dimension:'cm',weight:'g'},store:{expectedStore:'店铺1',expectedSite:'加拿大站'},template:{draftId:'123456789'}};
  const defaults=defaultsFromMother(args);assert.deepEqual(defaults.packageDefaults,packageDefaults);assert.equal(defaults.source.weightUnit,'g');assert.equal(defaults.warehouse,'加拿大仓');
  assert.throws(()=>defaultsFromMother({...args,units:{dimension:'cm',weight:null}}),/单位/);
  assert.throws(()=>validatePackageDefaults({...packageDefaults,weightKg:0}),/大于0/);
  assert.throws(()=>defaultsFromMother({...args,extra:{warehouses:['A','B']}}),/不唯一/);
});

test('broad source category or same title cannot silently become a platform leaf category',()=>{
  const product={title:'Posters & Prints',sourceCategory};
  const defaults={category:{label:'海报和印刷品',path:['家居','墙面装饰','海报和印刷品']}};
  assert.equal(categoryForProduct(product,defaults).allowed,false);
  assert.equal(categoryForProduct({...product,sourceCategory:{...sourceCategory,breadcrumbs:[{name:'Posters & Prints'}]}},defaults).allowed,true);
  const mapping={sourcePlatform:'temu',sourceCategoryId:'12869',targetPath:['家居','墙面装饰','海报和印刷品']};
  assert.equal(categoryForProduct(product,{...defaults,categoryMapping:mapping}).allowed,true);
  assert.equal(categoryForProduct({...product,sourceCategory:{...sourceCategory,categoryId:'9'}},{...defaults,categoryMapping:mapping}).allowed,false);
  const canvas={sourceCategory,title:'Solid Wood Framed Flower Poster, 2D Flat',description:'Frame Type：Wrapped Canvas\nArtwork Surface Material：Canvas'};
  const exact={category:{label:'海报和印刷品',path:['家居、厨房用品','装饰字画','海报和印刷品']}};
  assert.equal(categoryForProduct(canvas,exact).reason,'source-canvas-poster-evidence');
  assert.equal(categoryForProduct({...canvas,title:'Hand-painted original oil painting poster'},exact).allowed,false);
  assert.equal(categoryForProduct({...canvas,description:'Artwork Surface Material：Metal'},exact).allowed,false);
});

test('framed canvas prints with Guangdong evidence map without treating every framed wall art as a print',async()=>{
  const framed={sourceCategory,title:'3pcs Framed Funny Cats Wall Arts, Modern Art Prints, Whimsical Poster Print',description:'Frame Type：Framed\nArtwork Surface Material：Canvas\nOrigin：Guangdong,China'};
  const defaults={category:{label:'海报和印刷品',path:['家居、厨房用品','装饰字画','海报和印刷品']}};
  const mapping=categoryForProduct(framed,defaults);
  assert.equal(mapping.allowed,true);assert.equal(mapping.reason,'source-canvas-poster-evidence');
  assert.deepEqual(mapping.evidence.properties,['Frame Type: Framed','Artwork Surface Material: Canvas']);
  assert.deepEqual(originForProduct(framed),{country:'中国大陆',province:'广东省',evidence:'Origin：Guangdong,China'});
  const adapter=createDxmListingPreparer({WORKBENCH_ADAPTER_ROOT:'Z:/must-not-open'});
  for(const changed of [
    {...framed,title:'Framed Funny Cats Canvas Wall Art'},
    {...framed,title:'Hand-painted original oil painting poster'},
    {...framed,title:'Framed Sculpture Poster'},
    {...framed,description:framed.description.replace('Frame Type：Framed','Frame Type：Unknown')},
    {...framed,sourceCategory:{...sourceCategory,categoryId:'9'}},
    {...framed,sourceCategory:{...sourceCategory,breadcrumbs:[{name:'Other'}]}},
    {...framed,description:framed.description.replace('Artwork Surface Material：Canvas','Artwork Surface Material：Metal')}
  ]){
    assert.equal(categoryForProduct(changed,defaults).allowed,false);
    const result=await adapter.prepare({targetStore:{platform:'temu'},product:changed,defaults});
    assert.equal(result.status,'needs-configuration');assert.equal(result.saved,false);
  }
  for(const origin of ['', 'Origin：Unknown', 'Origin：Guangdong,USA', 'Origin：Unknown,China']){
    const changed={...framed,description:framed.description.replace('Origin：Guangdong,China',origin)};
    assert.equal(originForProduct(changed),null);
    const result=await adapter.prepare({targetStore:{platform:'temu'},product:changed,defaults});
    assert.equal(result.status,'needs-configuration');assert.equal(result.saved,false);assert.ok(result.issues.some(x=>x.includes('产地')));
  }
});

test('readiness requires category and mandatory values, while package-only edits preserve commodity facts',()=>{
  const snapshot={sources:['source'],fields:{variationSku:['SKU1','SKU2'],price:['10','20'],skuLength:['50','50'],skuWidth:['40','40'],skuHeight:['3','3'],weight:['1.25','1.25'],stock:['4','5']},items:[item('产品分类',['海报和印刷品']),item('承诺发货时效',['2天']),item('运费模板',['加拿大']),{...item('品牌'),required:true}],warehouses:['加拿大仓'],media:{main:['a']},variants:['Size S','Size M']};
  assert.deepEqual(listingReadiness(snapshot),['缺少品牌']);
  snapshot.items.at(-1).selections=['无品牌'];assert.deepEqual(listingReadiness(snapshot),[]);
  snapshot.items.push({...item('产品轮播图'),required:true,hasMedia:true});assert.deepEqual(listingReadiness(snapshot),[]);
  snapshot.items.push({...item('产地',['中国大陆']),required:true,placeholders:['请选择省份']});assert.deepEqual(listingReadiness(snapshot),['缺少产地']);
  snapshot.items.at(-1).placeholders=[];snapshot.items.at(-1).selections.push('浙江省');assert.deepEqual(listingReadiness(snapshot),[]);
  const after=structuredClone(snapshot);after.fields.weight=['2','2'];assert.deepEqual(retainedListingData(after),retainedListingData(snapshot));
  after.fields.price[0]='9';assert.notDeepEqual(retainedListingData(after),retainedListingData(snapshot));
  after.fields.variationSku=['SKU1','SKU1'];assert.ok(listingReadiness(after).includes('SKU为空或不唯一'));
});

test('origin uses the product evidence, never the mother draft province',()=>{
  assert.deepEqual(originForProduct({description:'Frame Type：Wrapped Canvas\nOrigin：Zhejiang, China'}),{country:'中国大陆',province:'浙江省',evidence:'Origin：Zhejiang, China'});
  assert.equal(originForProduct({title:'Made in Zhejiang',description:''}),null);
  assert.equal(originForProduct({description:'Origin：Zhejiang, USA'}),null);
});

test('observed DOM checks source/store/account and package units before editing the exact claimed product',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const expected={url:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456789',templateId:'987654321',account:'fixture',storeName:'店铺1',site:'加拿大站',sourceUrl:'https://www.temu.com/goods.html?goods_id=601102827259469'};
  const field=(label,content)=>`<div class="ant-form-item"><label class="ant-form-item-label">${label}</label>${content}</div>`,selection=text=>`<span class="ant-select-selection-item">${text}</span>`;
  const html=`<meta charset="utf-8"><div class="btn-user"><span class="user-name">fixture</span></div>${field('店铺账号',selection('店铺1'))}${field('经营站点',selection('加拿大站'))}${field('产品分类',selection('海报和印刷品'))}${field('来源URL',`<input value="${expected.sourceUrl}">`)}<input name="variationSku" value="17606613128563"><input name="price" value="12.31"><input name="stock" value="944"><table><thead><tr><th>长 cm</th><th>宽 cm</th><th>高 cm</th><th>重量 g</th></tr></thead><tbody><tr>${['skuLength','skuWidth','skuHeight','weight'].map(n=>`<td><input name="${n}" value="0"></td>`).join('')}</tr></tbody></table>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto(expected.url);
  assert.deepEqual(await page.evaluate(readPackageUnits),{dimension:'cm',weight:'g'});
  assert.equal((await page.evaluate(readTemuListing,expected)).fields.price[0],'12.31');
  const action={expected,action:'fill',locator:{selector:'input[name="weight"]'},value:1250};
  await page.evaluate(listingAction,action);assert.equal(await page.locator('input[name=weight]').inputValue(),'1250');assert.equal(await page.locator('input[name=price]').inputValue(),'12.31');
  await assert.rejects(page.evaluate(listingAction,{...action,locator:{selector:'input[name="price"]'}}),/只允许填写/);
  await assert.rejects(page.evaluate(listingAction,{...action,expected:{...expected,templateId:'123456789'}}),/不能修改母稿/);
  await assert.rejects(page.evaluate(listingAction,{...action,expected:{...expected,account:'other'}}),/账号/);
  await assert.rejects(page.evaluate(readTemuListing,{...expected,sourceUrl:expected.sourceUrl+'0'}),/来源链接/);
  await assert.rejects(page.evaluate(listingAction,{...action,expected:{...expected,site:'美国站'}}),/站点/);
});
