import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSourcing} from '../src/sourcing.mjs';
import {rawFixture} from './fixtures/geekbi-raw.mjs';

// Dependency-injected service tests only: no browser, live ERP, or paid API.
const GOODS=['601105252678120','601105252678121','601105252678122'];
const SHOPS=[
  {key:'shop-a',platform:'temu',name:'Temu Canada'},
  {key:'shop-b',platform:'tiktok',name:'TikTok Japan'},
  {key:'shop-c',platform:'temu',name:'Temu US'}
];
const PACKAGE={lengthCm:40,widthCm:30,heightCm:3,weightKg:0.8};
const SEARCH_ID='search-multistore-1';
const ERP={key:'erp-a',provider:'dianxiaomi',browserKey:'chrome-a',expectedAccount:'account-a',name:'ERP A'};
const clone=value=>structuredClone(value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const source=goodsId=>`https://www.temu.com/goods.html?goods_id=${goodsId}`;
const editUrl=(goodsId,shop)=>`https://www.dianxiaomi.com/web/${shop.platform==='temu'?'popTemu':'tiktokProduct'}/edit?id=${goodsId}${SHOPS.findIndex(s=>s.key===shop.key)+1}`;

async function idle(service){
  const deadline=Date.now()+5000;
  while(service.isBusy()){if(Date.now()>deadline)throw new Error('Synthetic sourcing task did not settle');await pause(2);}
}
async function until(predicate){
  const deadline=Date.now()+3000;
  while(!predicate()){if(Date.now()>deadline)throw new Error('Expected persisted write intent was not observed');await pause(2);}
}
function stores(row){assert.ok(Array.isArray(row.storeResults),'each product exposes its per-store results');return row.storeResults;}
function store(row,key){const values=stores(row).filter(s=>s.storeKey===key);assert.equal(values.length,1,`one result for ${key}`);return values[0];}
function count(events,kind,goodsId,storeKey){return events.filter(e=>e.kind===kind&&(goodsId===undefined||e.goodsId===goodsId)&&(storeKey===undefined||e.storeKey===storeKey)).length;}
function writeCounts(events){return Object.fromEntries(['rawDetail','import','claim','save'].map(k=>[k,count(events,k)]));}
function siteProof(args,submission){return {version:1,source:'workbench-new-claim',saveState:'no-workbench-save-submission',account:submission.account,sourceUrl:args.sourceUrl,collectionEditUrl:submission.collectionEditUrl,platformEditUrl:editUrl(args.goodsId,args.targetStore),skuIds:args.product.skus.map(s=>s.id),targetStore:clone(args.targetStore),fromSite:'美国站',toSite:'加拿大站',claimSubmittedAt:submission.claimSubmittedAt,claimRecordTime:submission.claimSubmittedAt,claimRecordTimeText:'synthetic fixture receipt',verifiedAt:new Date().toISOString()};}

async function fixture(t,{profileKeys=SHOPS.map(s=>s.key),initialShops=SHOPS,erpConnections=[ERP],packageByStore={},claimHook,prepareHook,claimVerifyHook,saveVerifyHook}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-multistore-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const events=[],timeline=[];let concurrent=0,maxConcurrent=0,liveShops=clone(initialShops);
  const storeSites=Object.fromEntries(SHOPS.map(s=>[s.key,s.platform==='temu'?'加拿大站':'日本']));
  const state=()=>JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));
  const defaultsFor=key=>({platform:SHOPS.find(s=>s.key===key).platform,packageDefaults:clone(packageByStore[key]||PACKAGE),warehouse:`warehouse-${key}`,shippingTemplate:`shipping-${key}`,source:{templateId:`template-${key}`}});
  const bound=args=>{const expected=erpConnections.find(e=>e.key===args.erpConnection.key);assert.ok(expected);assert.equal(args.erpConnection.expectedAccount,expected.expectedAccount);assert.equal(args.browserConfig.key,expected.browserKey);};
  async function action(kind,args,run){
    const event={kind,goodsId:args.goodsId||args.product?.goodsId,storeKey:args.targetStore?.key,erpKey:args.erpConnection?.key};events.push(event);timeline.push({...event,phase:'start'});
    concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
    try{await pause(1);return await run();}finally{concurrent--;timeline.push({...event,phase:'end'});}
  }
  function claimResult(args){return {status:'claimed',evidence:{platformEditUrl:editUrl(args.goodsId,args.targetStore),sourceUrl:args.sourceUrl,account:args.erpConnection.expectedAccount,targetStore:clone(args.targetStore)}};}
  function prepared(args){return {status:'prepared',ready:true,saved:true,published:false,evidence:{platformEditUrl:args.platformEditUrl,storeKey:args.targetStore.key}};}
  function saveIntent(args){return {url:args.platformEditUrl,expectedSnapshot:{sourceUrl:args.product.sourceUrl,storeKey:args.targetStore.key,packageDefaults:clone(args.defaults.packageDefaults)}};}
  const client=async(kind,params={})=>action(kind,params,()=>kind==='sites'?{data:[{siteId:48,cnName:'美国',currency:'USD'}]}:kind==='rawDetail'?rawFixture(params.goodsId,`Product ${params.goodsId}`):{data:{list:GOODS.map(goodsId=>({goodsId,goodsName:`Product ${goodsId}`,siteId:48,minPrice:4.51})),total:GOODS.length},chargedPoints:10});
  const preferences={
    erp:key=>clone(erpConnections.find(e=>e.key===key)),browser:key=>({key,type:'chrome',debugPort:9333}),
    view:()=>({erpConnections:clone(erpConnections),stores:erpConnections.flatMap(erp=>SHOPS.map(s=>({key:`configured-${erp.key}-${s.key}`,erpKey:erp.key,platform:s.platform,expectedStore:s.name,expectedSite:storeSites[s.key],templates:[{key:`template-${s.key}`,draftId:'220114595122686336',verifiedAt:'2026-11-19'}]})))})
  };
  const adapter={
    preflight:async args=>{bound(args);events.push({kind:'import-preflight'});},
    importProduct:args=>action('import',args,()=>{
      bound(args);assert.equal(args.sourceUrl,source(args.goodsId));assert.ok(fs.existsSync(args.filePath));
      args.beforeSubmit();return {status:'verified',evidence:{editUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=${args.goodsId}`,sourceUrl:args.sourceUrl}};
    }),
    verify:args=>action('import-read',args,()=>({status:'verified',evidence:{sourceUrl:args.sourceUrl}})),
    resolve:()=>assert.fail('must never open Temu to collect product data'),collect:()=>assert.fail('must never use link collection')
  };
  const claimAdapter={
    listStores:async args=>{bound(args);events.push({kind:'stores-read'});return {stores:clone(liveShops)};},
    claimProduct:args=>action('claim',args,async()=>{
      bound(args);assert.equal(args.sourceUrl,source(args.goodsId));
      assert.equal(args.targetStore.name,SHOPS.find(s=>s.key===args.targetStore.key).name);
      const submit=()=>{args.beforeClaim({targetStore:clone(args.targetStore),sourceUrl:args.sourceUrl});return claimResult(args);};
      return claimHook?claimHook(args,{submit,result:()=>claimResult(args),state}):submit();
    }),
    verifyClaim:args=>action('claim-read',args,()=>claimVerifyHook?claimVerifyHook(args,{result:()=>claimResult(args)}):claimResult(args))
  };
  const listingPreparer={
    readDefaults:async args=>defaultsFor(SHOPS.find(s=>s.name===args.store.expectedStore).key),
    prepare:args=>action('save',args,async()=>{
      bound(args);assert.deepEqual(args.defaults,defaultsFor(args.targetStore.key));
      assert.equal(args.platformEditUrl,editUrl(args.product.goodsId,args.targetStore));
      const save=()=>{args.beforeSave(saveIntent(args));return prepared(args);};
      return prepareHook?prepareHook(args,{save,result:()=>prepared(args),intent:()=>saveIntent(args),state}):save();
    }),
    verify:args=>action('save-read',args,()=>{
      if(args.preparationIntent)assert.deepEqual(args.preparationIntent,saveIntent(args));
      else assert.equal(args.previousPreparation?.saved,true,'legacy saved drafts still require their original success proof');
      return saveVerifyHook?saveVerifyHook(args,{result:()=>prepared(args)}):prepared(args);
    })
  };
  const options={directory,configuration:{WORKBENCH_FRESH:'true',GB_APP_KEY:'fixture-key',GB_APP_SECRET:'fixture-secret'},preferences,client,adapter,claimAdapter,listingPreparer};
  const service=createSourcing(options);
  await service.sites();await service.syncStores('erp-a');
  for(const key of profileKeys)await service.storeDefaults({erpKey:'erp-a',targetStoreKey:key});
  service.startSearch({requestId:SEARCH_ID,keywords:'synthetic canvas',siteId:48,size:10});await idle(service);
  return {service,options,directory,events,timeline,state,defaultsFor,maxConcurrent:()=>maxConcurrent,setLiveShops:values=>{liveShops=clone(values);},setStoreSite:(key,site)=>{storeSites[key]=site;},payload:(id,goodsIds=[GOODS[1]],keys=['shop-a','shop-b'])=>({requestId:id,searchId:SEARCH_ID,erpKey:'erp-a',goodsIds,targetStoreKeys:keys})};
}
async function primeAccount(f){
  f.service.startBatch({requestId:'batch-prime-import',searchId:SEARCH_ID,erpKey:'erp-a',goodsIds:[GOODS[0]]});await idle(f.service);
  assert.equal(f.service.getBatch('batch-prime-import').rows[0].status,'verified');
}

test('new draft site context is returned only after the exact claim intent is persisted and its proof reaches preparation',async t=>{
  let originalSubmission;
  const f=await fixture(t,{claimHook:(args,{result,state})=>{
    originalSubmission=args.beforeClaim({targetStore:args.targetStore,sourceUrl:args.sourceUrl,collectionEditUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=${args.goodsId}`});
    assert.equal(originalSubmission.source,'workbench-persisted-claim');assert.equal(originalSubmission.saveState,'no-workbench-save-submission');
    const persisted=store(state().batches['batch-site-proof'].rows[0],'shop-a');assert.equal(persisted.claimSubmittedAt,originalSubmission.claimSubmittedAt);assert.deepEqual(persisted.claimIntent.targetStore,args.targetStore);
    const claim=result();claim.evidence.newDraftSiteInitialization=siteProof(args,originalSubmission);return claim;
  },prepareHook:(args,{save})=>{assert.equal(args.newDraftSiteInitialization.claimSubmittedAt,originalSubmission.claimSubmittedAt);assert.equal(args.newDraftSiteInitialization.toSite,args.targetStore.site);return save();}});
  f.service.startBatch(f.payload('batch-site-proof',[GOODS[1]],['shop-a']));await idle(f.service);
  assert.equal(f.service.getBatch('batch-site-proof').status,'completed');
});

test('legacy persisted claim time recovers site proof read-only then carries unsaved identity into another batch without a new claim',async t=>{
  let originalSubmission,checkCount=0;
  const f=await fixture(t,{claimHook:args=>{
    originalSubmission=args.beforeClaim({targetStore:args.targetStore,sourceUrl:args.sourceUrl,collectionEditUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=${args.goodsId}`});
    throw new Error('site was defaulted to another country');
  },claimVerifyHook:(args,{result})=>{
    checkCount++;assert.deepEqual(args.claimSubmission,originalSubmission);
    const claim=result();claim.evidence.newDraftSiteInitialization=siteProof(args,args.claimSubmission);return claim;
  },prepareHook:(args,{save})=>{assert.equal(args.newDraftSiteInitialization.claimSubmittedAt,originalSubmission.claimSubmittedAt);return save();}});
  f.service.startBatch(f.payload('batch-site-unknown',[GOODS[1]],['shop-a']));await idle(f.service);
  const persisted=f.state();delete store(persisted.batches['batch-site-unknown'].rows[0],'shop-a').claimIntent;delete persisted.batches['batch-site-unknown'].rows[0].claimIntent;
  fs.writeFileSync(path.join(f.directory,'state.json'),JSON.stringify(persisted));const restored=createSourcing(f.options);
  const before=writeCounts(f.events);const checked=await restored.reconcile('batch-site-unknown');assert.deepEqual(writeCounts(f.events),before);assert.equal(store(checked.rows[0],'shop-a').status,'claimed');
  restored.startBatch(f.payload('batch-site-resume',[GOODS[1]],['shop-a']));await idle(restored);
  const resumed=restored.getBatch('batch-site-resume');assert.equal(resumed.status,'completed');assert.equal(resumed.estimatedPoints,0);assert.equal(count(f.events,'claim'),1);assert.equal(count(f.events,'save'),1);assert.equal(checkCount,2);
  assert.equal(store(resumed.rows[0],'shop-a').resumedUnpreparedClaim.batchId,'batch-site-unknown');assert.equal(store(resumed.rows[0],'shop-a').claimSubmittedAt,originalSubmission.claimSubmittedAt);
});

test('external initialization flags and an adapter proof without a persisted own claim cannot reach preparation',async t=>{
  const f=await fixture(t,{claimHook:(args,{result})=>{assert.equal(args.claimSubmission,undefined);const claim=result();claim.evidence.newDraftSiteInitialization={version:1,source:'workbench-new-claim',saveState:'no-workbench-save-submission'};return claim;},prepareHook:(args,{save})=>{assert.equal(args.newDraftSiteInitialization,undefined);return save();}});
  f.service.startBatch({...f.payload('batch-site-request-forged',[GOODS[1]],['shop-a']),newDraftSiteInitialization:true,claimSubmission:{claimSubmittedAt:new Date().toISOString()}});await idle(f.service);
  assert.equal(f.service.getBatch('batch-site-request-forged').status,'completed');assert.equal(store(f.service.getBatch('batch-site-request-forged').rows[0],'shop-a').claimSubmittedAt,undefined);
});

test('a persisted save submission removes site initialization authority during all subsequent read-only checks',async t=>{
  let checks=0;
  const f=await fixture(t,{claimVerifyHook:(args,{result})=>{checks++;assert.equal(args.claimSubmission,undefined);return result();}});
  f.service.startBatch(f.payload('batch-site-saved',[GOODS[1]],['shop-a']));await idle(f.service);
  const before=writeCounts(f.events);await f.service.reconcile('batch-site-saved');assert.deepEqual(writeCounts(f.events),before);assert.equal(checks,1);
});

test('unsaved claim authority is not inherited when the selected destination or saved defaults change',async t=>{
  for(const change of ['site','defaults']){
    const packageByStore={};let calls=0;
    const f=await fixture(t,{packageByStore,claimHook:(args,{submit,result})=>{calls++;if(calls===1)return submit();assert.equal(args.claimSubmission,undefined);return result();},prepareHook:args=>{assert.equal(args.newDraftSiteInitialization,undefined);return {status:'needs-configuration',ready:false,saved:false,issues:['fixture stops before saving']};}});
    f.service.startBatch(f.payload(`batch-own-${change}-before`,[GOODS[1]],['shop-a']));await idle(f.service);
    assert.ok(store(f.service.getBatch(`batch-own-${change}-before`).rows[0],'shop-a').claimSubmittedAt);
    if(change==='site')f.setStoreSite('shop-a','美国站');else packageByStore['shop-a']={...PACKAGE,widthCm:41};
    await f.service.storeDefaults({erpKey:'erp-a',targetStoreKey:'shop-a'});
    f.service.startBatch(f.payload(`batch-own-${change}-after`,[GOODS[1]],['shop-a']));await idle(f.service);
    const current=store(f.service.getBatch(`batch-own-${change}-after`).rows[0],'shop-a');
    assert.equal(current.resumedUnpreparedClaim,undefined);assert.equal(current.claimSubmittedAt,undefined);assert.equal(calls,2);
    assert.equal(count(f.events,'rawDetail',GOODS[1]),1);assert.equal(count(f.events,'import',GOODS[1]),1);
  }
});

test('multiple shops share one detail/import per product, then receive their own defaults and persisted claim/save intents serially',async t=>{
  const f=await fixture(t);await primeAccount(f);
  f.service.startBatch(f.payload('batch-multi-success',GOODS.slice(1)));await idle(f.service);
  const b=f.service.getBatch('batch-multi-success');assert.equal(b.status,'completed');
  assert.deepEqual(b.targetStores.map(s=>s.key).sort(),['shop-a','shop-b']);
  for(const row of b.rows){
    assert.equal(row.status,'prepared');assert.equal(count(f.events,'rawDetail',row.goodsId),1);assert.equal(count(f.events,'import',row.goodsId),1);
    for(const key of ['shop-a','shop-b']){
      const s=store(row,key);assert.equal(s.targetStore.key,key);assert.equal(s.status,'prepared');assert.equal(s.preparation.published,false);
      assert.ok(s.claimSubmittedAt&&s.prepareSubmittedAt&&s.preparationIntent);assert.equal(s.preparationIntent.expectedSnapshot.storeKey,key);
      assert.equal(count(f.events,'claim',row.goodsId,key),1);assert.equal(count(f.events,'save',row.goodsId,key),1);
    }
  }
  assert.equal(f.maxConcurrent(),1,'remote actions must run serially');
  const productEvents=f.timeline.filter(e=>GOODS.slice(1).includes(e.goodsId));
  assert.ok(productEvents.findLastIndex(e=>e.goodsId===GOODS[1])<productEvents.findIndex(e=>e.goodsId===GOODS[2]));
});

test('store selection is a canonical set for request idempotency, preserves the old single-store input, and rejects changed targets',async t=>{
  const f=await fixture(t),payload=f.payload('batch-set-idempotent',[GOODS[1]],['shop-b','shop-a']);
  f.service.startBatch(payload);assert.doesNotThrow(()=>f.service.startBatch({...payload,targetStoreKeys:['shop-a','shop-b']}));await idle(f.service);
  const before=writeCounts(f.events);f.service.startBatch({...payload,targetStoreKeys:['shop-a','shop-b']});assert.deepEqual(writeCounts(f.events),before);
  assert.throws(()=>f.service.startBatch({...payload,targetStoreKeys:['shop-a','shop-c']}),/同一批次|目标店铺|修改/);
  f.service.startBatch({requestId:'batch-legacy-single',searchId:SEARCH_ID,erpKey:'erp-a',goodsIds:[GOODS[2]],targetStoreKey:'shop-a'});await idle(f.service);
  const legacy=f.service.getBatch('batch-legacy-single');assert.equal(legacy.status,'completed');assert.equal(store(legacy.rows[0],'shop-a').status,'prepared');
});

test('empty, duplicate, or malformed store selections are rejected before details or import',async t=>{
  const f=await fixture(t);
  for(const [i,keys] of [[],['shop-a','shop-a'],['shop-a',''],['shop-a',null],'shop-a'].entries()){
    assert.throws(()=>f.service.startBatch(f.payload(`batch-bad-keys-${i}`,[GOODS[1]],keys)),/店铺|选择|目标|数组/);
  }
  assert.equal(count(f.events,'rawDetail'),0);assert.equal(count(f.events,'import'),0);
});

test('every selected store needs defaults and compatible package values before any detail charge',async t=>{
  const missing=await fixture(t,{profileKeys:['shop-a']});
  assert.throws(()=>missing.service.startBatch(missing.payload('batch-missing-default')),/默认值|模板/);
  assert.equal(count(missing.events,'rawDetail'),0);assert.equal(count(missing.events,'import'),0);
  const mismatch=await fixture(t,{packageByStore:{'shop-b':{...PACKAGE,widthCm:41}}});
  assert.throws(()=>mismatch.service.startBatch(mismatch.payload('batch-package-mismatch')),/包裹|尺寸|统一|一致/);
  assert.equal(count(mismatch.events,'rawDetail'),0);assert.equal(count(mismatch.events,'import'),0);
});

test('pre-charge authorization checks include every selected store, including one revoked after catalog sync',async t=>{
  const f=await fixture(t);f.setLiveShops(SHOPS.filter(s=>s.key!=='shop-b'));
  f.service.startBatch(f.payload('batch-auth-revoked'));await idle(f.service);
  assert.equal(f.service.getBatch('batch-auth-revoked').status,'paused');assert.equal(count(f.events,'rawDetail'),0);assert.equal(count(f.events,'import'),0);
});

test('a live authorization site change after the cached catalog is rejected before buying any detail',async t=>{
  const initialShops=SHOPS.map(s=>({...s,...(s.key==='shop-b'?{authorizationSite:'日本'}:{})}));
  const f=await fixture(t,{initialShops});
  f.setLiveShops(initialShops.map(s=>s.key==='shop-b'?{...s,authorizationSite:'美国'}:s));
  f.service.startBatch(f.payload('batch-live-site-changed'));await idle(f.service);
  assert.equal(f.service.getBatch('batch-live-site-changed').status,'paused');assert.match(f.service.getBatch('batch-live-site-changed').error,/授权已变化/);
  assert.equal(count(f.events,'rawDetail'),0);assert.equal(count(f.events,'import'),0);
});

test('syncing a same-name shop with a changed authorization site invalidates its cached defaults before detail or import',async t=>{
  const initialShops=SHOPS.map(s=>({...s,...(s.key==='shop-b'?{authorizationSite:'日本'}:{})}));
  const f=await fixture(t,{initialShops});
  assert.ok(f.service.storeView('erp-a').profiles['shop-b'].defaults);
  f.setLiveShops(initialShops.map(s=>s.key==='shop-b'?{...s,authorizationSite:'美国'}:s));await f.service.syncStores('erp-a');
  const view=f.service.storeView('erp-a');assert.equal(view.profiles['shop-b'].defaults,null);
  assert.match(view.profiles['shop-b'].issues.join('；'),/重新|重读|授权|站点/);
  assert.throws(()=>f.service.startBatch(f.payload('batch-stale-authorization',[GOODS[1]],['shop-b'])),/重新|默认值|授权|站点/);
  assert.equal(count(f.events,'rawDetail'),0);assert.equal(count(f.events,'import'),0);
});

test('rereading a changed authorization site reuses common data but cannot reuse the same-name shop draft completed under its old authorization',async t=>{
  const initialShops=SHOPS.map(s=>({...s,...(s.key==='shop-b'?{authorizationSite:'日本'}:{})}));
  const f=await fixture(t,{initialShops});
  f.service.startBatch(f.payload('batch-old-authorization',[GOODS[1]],['shop-b']));await idle(f.service);
  const previous=store(f.service.getBatch('batch-old-authorization').rows[0],'shop-b');assert.equal(previous.status,'prepared');assert.equal(previous.targetStore.authorizationSite,'日本');
  f.setLiveShops(initialShops.map(s=>s.key==='shop-b'?{...s,authorizationSite:'美国'}:s));await f.service.syncStores('erp-a');
  const profile=await f.service.storeDefaults({erpKey:'erp-a',targetStoreKey:'shop-b'});assert.equal(profile.targetStore.authorizationSite,'美国');
  f.service.startBatch(f.payload('batch-new-authorization',[GOODS[1]],['shop-b']));await idle(f.service);
  const b=f.service.getBatch('batch-new-authorization'),current=store(b.rows[0],'shop-b');assert.equal(b.status,'completed');assert.equal(b.estimatedPoints,0);
  assert.equal(current.status,'prepared');assert.equal(current.targetStore.authorizationSite,'美国');
  assert.equal(current.targetStore.site,previous.targetStore.site,'authorization identity must be checked even when the configured site label did not change');
  assert.equal(count(f.events,'rawDetail',GOODS[1]),1);assert.equal(count(f.events,'import',GOODS[1]),1);
  assert.equal(count(f.events,'claim',GOODS[1],'shop-b'),2);assert.equal(count(f.events,'save',GOODS[1],'shop-b'),2);
});

test('an ordinary store failure continues the current product in other selected stores and stops later products',async t=>{
  const f=await fixture(t,{claimHook:(args,{submit})=>{if(args.targetStore.key==='shop-a')throw new Error('store unavailable');return submit();}});await primeAccount(f);
  f.service.startBatch(f.payload('batch-one-store-fails',GOODS.slice(1)));await idle(f.service);
  const b=f.service.getBatch('batch-one-store-fails');assert.equal(b.status,'paused');assert.equal(b.rows[0].status,'partial');
  assert.notEqual(store(b.rows[0],'shop-a').status,'prepared');assert.equal(store(b.rows[0],'shop-b').status,'prepared');
  assert.equal(count(f.events,'rawDetail',GOODS[2]),0);assert.equal(count(f.events,'import',GOODS[2]),0);assert.equal(count(f.events,'claim',GOODS[2]),0);
});

test('an unknown claim blocks only that store from resubmission; other stores finish, and reconciliation only reads',async t=>{
  const f=await fixture(t,{claimHook:(args,{submit})=>{const result=submit();if(args.targetStore.key==='shop-a')throw new Error('claim response lost');return result;}});await primeAccount(f);
  f.service.startBatch(f.payload('batch-claim-unknown',GOODS.slice(1)));await idle(f.service);
  const b=f.service.getBatch('batch-claim-unknown');assert.equal(b.status,'paused');assert.equal(b.rows[0].status,'partial');
  assert.equal(store(b.rows[0],'shop-a').status,'needs-review');assert.ok(store(b.rows[0],'shop-a').claimSubmittedAt);assert.equal(store(b.rows[0],'shop-b').status,'prepared');
  assert.equal(count(f.events,'rawDetail',GOODS[2]),0);
  assert.throws(()=>f.service.startBatch(f.payload('batch-unknown-replay',[GOODS[1]],['shop-a'])),/核对|不明确|已有|重复/);
  const before=writeCounts(f.events),checked=await f.service.reconcile('batch-claim-unknown');
  assert.deepEqual(writeCounts(f.events),before);assert.equal(count(f.events,'claim-read',GOODS[1],'shop-a'),1);assert.equal(count(f.events,'claim-read',GOODS[1],'shop-b'),1);
  assert.equal(store(checked.rows[0],'shop-a').status,'claimed');assert.notEqual(checked.status,'completed');
});

test('a new target store reuses the common import while a previously prepared store is neither claimed nor saved again',async t=>{
  const f=await fixture(t);f.service.startBatch(f.payload('batch-initial-store',[GOODS[1]],['shop-a']));await idle(f.service);
  f.service.startBatch(f.payload('batch-add-store',[GOODS[1]],['shop-a','shop-c']));await idle(f.service);
  const b=f.service.getBatch('batch-add-store');assert.equal(b.status,'completed');assert.equal(b.estimatedPoints,0);
  assert.equal(count(f.events,'rawDetail',GOODS[1]),1);assert.equal(count(f.events,'import',GOODS[1]),1);
  for(const key of ['shop-a','shop-c']){assert.equal(store(b.rows[0],key).status,'prepared');assert.equal(count(f.events,'claim',GOODS[1],key),1);assert.equal(count(f.events,'save',GOODS[1],key),1);}
  assert.equal(count(f.events,'claim-read',GOODS[1],'shop-a'),1);assert.equal(count(f.events,'save-read',GOODS[1],'shop-a'),1);
});

test('changing a store site reuses detail and common import but never treats its old prepared draft as the new destination',async t=>{
  const seenSites=[];
  const f=await fixture(t,{prepareHook:(args,{save})=>{seenSites.push(args.targetStore.site);return save();}});
  f.service.startBatch(f.payload('batch-original-site',[GOODS[1]],['shop-a']));await idle(f.service);
  assert.equal(store(f.service.getBatch('batch-original-site').rows[0],'shop-a').targetStore.site,'加拿大站');
  f.setStoreSite('shop-a','美国站');await f.service.storeDefaults({erpKey:'erp-a',targetStoreKey:'shop-a'});
  f.service.startBatch(f.payload('batch-changed-site',[GOODS[1]],['shop-a']));await idle(f.service);
  const b=f.service.getBatch('batch-changed-site');assert.equal(b.status,'completed');assert.equal(b.estimatedPoints,0);
  assert.equal(store(b.rows[0],'shop-a').targetStore.site,'美国站');assert.equal(store(b.rows[0],'shop-a').status,'prepared');
  assert.equal(count(f.events,'rawDetail',GOODS[1]),1);assert.equal(count(f.events,'import',GOODS[1]),1);
  assert.equal(count(f.events,'claim',GOODS[1],'shop-a'),2);assert.equal(count(f.events,'save',GOODS[1],'shop-a'),2);
  assert.deepEqual(seenSites,['加拿大站','美国站']);
});

test('a first product imported successfully with partial store results unlocks the next multi-product batch without a separate pilot',async t=>{
  const f=await fixture(t,{claimHook:(args,{submit})=>{if(args.targetStore.key==='shop-a')throw new Error('one destination unavailable');return submit();}});
  f.service.startBatch(f.payload('batch-first-partial'));await idle(f.service);
  const first=f.service.getBatch('batch-first-partial');assert.equal(first.status,'paused');assert.equal(first.rows[0].status,'partial');
  assert.equal(first.rows[0].importEvidence.sourceUrl,source(GOODS[1]));assert.equal(store(first.rows[0],'shop-b').status,'prepared');
  const next=f.payload('batch-after-first-partial',[GOODS[0],GOODS[2]],['shop-b']);
  assert.doesNotThrow(()=>f.service.startBatch(next));await idle(f.service);
  const b=f.service.getBatch(next.requestId);assert.equal(b.status,'completed');assert.equal(b.rows.length,2);
  for(const row of b.rows){assert.equal(row.status,'prepared');assert.equal(count(f.events,'rawDetail',row.goodsId),1);assert.equal(count(f.events,'import',row.goodsId),1);}
});

test('an unresolved store does not prevent a new batch for other stores from reusing a verified import and saved draft',async t=>{
  const f=await fixture(t,{claimHook:(args,{submit})=>{const result=submit();if(args.targetStore.key==='shop-a')throw new Error('claim unknown');return result;}});
  f.service.startBatch(f.payload('batch-isolated-unknown'));await idle(f.service);
  f.service.startBatch(f.payload('batch-other-stores',[GOODS[1]],['shop-b','shop-c']));await idle(f.service);
  const b=f.service.getBatch('batch-other-stores');assert.equal(b.status,'completed');assert.equal(b.estimatedPoints,0);
  assert.equal(count(f.events,'rawDetail',GOODS[1]),1);assert.equal(count(f.events,'import',GOODS[1]),1);assert.equal(count(f.events,'claim',GOODS[1],'shop-a'),1);
  assert.equal(count(f.events,'save',GOODS[1],'shop-b'),1);assert.equal(count(f.events,'claim',GOODS[1],'shop-c'),1);
});

test('an unknown store save is reconciled with its own persisted intent and never replays any successful store',async t=>{
  const f=await fixture(t,{prepareHook:(args,{save})=>{const result=save();if(args.targetStore.key==='shop-a')throw new Error('save response lost');return result;}});
  f.service.startBatch(f.payload('batch-save-unknown-multi'));await idle(f.service);
  const b=f.service.getBatch('batch-save-unknown-multi');assert.equal(b.status,'paused');assert.equal(b.rows[0].status,'partial');
  assert.equal(store(b.rows[0],'shop-a').status,'needs-review');assert.equal(store(b.rows[0],'shop-a').preparationIntent.expectedSnapshot.storeKey,'shop-a');
  assert.equal(store(b.rows[0],'shop-b').status,'prepared');
  assert.throws(()=>f.service.startBatch(f.payload('batch-save-replay',[GOODS[1]],['shop-a'])),/保存|核对|不明确/);
  const before=writeCounts(f.events),result=await f.service.reconcile('batch-save-unknown-multi');
  assert.equal(result.status,'completed');assert.equal(result.rows[0].status,'prepared');assert.deepEqual(writeCounts(f.events),before);
  assert.equal(count(f.events,'save-read',GOODS[1],'shop-a'),1);assert.equal(count(f.events,'save-read',GOODS[1],'shop-b'),1);
  f.service.startBatch(f.payload('batch-post-reconcile'));await idle(f.service);assert.deepEqual(writeCounts(f.events),before);
});

test('stop after one claim starts no further store write and restarting the service does not resume the batch',async t=>{
  let f;
  f=await fixture(t,{claimHook:(args,{submit})=>{const result=submit();f.service.stop('batch-stop-multi');return result;}});await primeAccount(f);
  const payload=f.payload('batch-stop-multi',GOODS.slice(1));f.service.startBatch(payload);await idle(f.service);
  const b=f.service.getBatch(payload.requestId);assert.equal(b.status,'paused');assert.equal(b.stopRequested,true);
  assert.equal(count(f.events,'claim',GOODS[1]),1);assert.equal(count(f.events,'save',GOODS[1]),0);assert.equal(count(f.events,'rawDetail',GOODS[2]),0);
  const before=writeCounts(f.events),restored=createSourcing(f.options);restored.startBatch(payload);await idle(restored);
  assert.equal(restored.getBatch(payload.requestId).status,'paused');assert.deepEqual(writeCounts(f.events),before);
});

test('restart preserves a completed store and treats another store interrupted after intent as unknown without reissuing writes',async t=>{
  let intentSeen=false;
  const f=await fixture(t,{claimHook:async(args,{submit})=>{
    const result=submit();if(args.targetStore.key==='shop-b'){intentSeen=true;await new Promise(()=>{});}return result;
  }});
  const payload=f.payload('batch-crash-multi');f.service.startBatch(payload);await until(()=>intentSeen);
  const before=writeCounts(f.events),restored=createSourcing(f.options),interrupted=restored.getBatch(payload.requestId);
  assert.equal(interrupted.status,'paused');assert.equal(store(interrupted.rows[0],'shop-a').status,'prepared');assert.equal(store(interrupted.rows[0],'shop-b').status,'needs-review');
  restored.startBatch(payload);assert.deepEqual(writeCounts(f.events),before);
  assert.throws(()=>restored.startBatch(f.payload('batch-crash-replay',[GOODS[1]],['shop-b'])),/核对|不明确|已有|重复/);
  const reconciled=await restored.reconcile(payload.requestId);assert.deepEqual(writeCounts(f.events),before);assert.equal(store(reconciled.rows[0],'shop-a').status,'prepared');
  assert.equal(count(f.events,'claim-read',GOODS[1],'shop-a'),1);assert.equal(count(f.events,'claim-read',GOODS[1],'shop-b'),1);
});

test('reusing a saved draft waits for live read-only verification and an offline browser cannot falsely complete it',async t=>{
  let offline=false;
  const f=await fixture(t,{claimVerifyHook:(args,{result})=>{if(offline)throw new Error('browser offline');return result();}});
  f.service.startBatch(f.payload('batch-reuse-original',[GOODS[1]],['shop-a']));await idle(f.service);
  const original=store(f.service.getBatch('batch-reuse-original').rows[0],'shop-a'),before=writeCounts(f.events);
  offline=true;const started=f.service.startBatch(f.payload('batch-reuse-offline',[GOODS[1]],['shop-a']));
  assert.equal(store(started.rows[0],'shop-a').status,'verifying-reuse');await idle(f.service);
  const failed=f.service.getBatch('batch-reuse-offline'),destination=store(failed.rows[0],'shop-a');
  assert.equal(failed.status,'paused');assert.equal(destination.status,'needs-review');assert.match(destination.error,/browser offline/);
  assert.deepEqual(destination.previousPreparation,original.preparation);assert.notEqual(destination.preparation.status,'prepared');
  assert.deepEqual(writeCounts(f.events),before);assert.equal(count(f.events,'save-read',GOODS[1],'shop-a'),0);
  assert.throws(()=>f.service.startBatch(f.payload('batch-reuse-not-again',[GOODS[1]],['shop-a'])),/核对|不会再次提交/);
  offline=false;const restored=await f.service.reconcile(failed.id);
  assert.equal(restored.status,'completed');assert.equal(store(restored.rows[0],'shop-a').status,'prepared');
  assert.deepEqual(store(restored.rows[0],'shop-a').previousPreparation,original.preparation);assert.deepEqual(writeCounts(f.events),before);
});

test('reconciliation rechecks every completed store, pauses on changed or unreadable data, and recovers from the original proof without writes',async t=>{
  let check='ok',originalProof;
  const f=await fixture(t,{saveVerifyHook:(args,{result})=>{
    if(args.targetStore.key==='shop-a'){
      assert.deepEqual(args.previousPreparation,originalProof,'read failures must never replace the original saved baseline');
      if(check==='offline')throw new Error('read timed out');
      if(check==='changed')return {status:'needs-review',ready:false,saved:false,issues:['package changed on the saved page']};
    }
    return {...result(),verification:{checkedAt:'new-read-receipt'}};
  }});
  f.service.startBatch(f.payload('batch-reconcile-completed'));await idle(f.service);
  const initial=f.service.getBatch('batch-reconcile-completed');originalProof=clone(store(initial.rows[0],'shop-a').preparation);
  const before=writeCounts(f.events);check='changed';const changed=await f.service.reconcile(initial.id);
  assert.equal(changed.status,'paused');assert.equal(changed.rows[0].status,'partial');assert.equal(store(changed.rows[0],'shop-a').status,'needs-review');
  assert.match(store(changed.rows[0],'shop-a').error,/package changed/);assert.equal(store(changed.rows[0],'shop-b').status,'prepared');
  assert.equal(count(f.events,'claim-read',GOODS[1],'shop-b'),1);assert.equal(count(f.events,'save-read',GOODS[1],'shop-b'),1);
  check='offline';await f.service.reconcile(initial.id);assert.deepEqual(store(f.service.getBatch(initial.id).rows[0],'shop-a').previousPreparation,originalProof);
  const restarted=createSourcing(f.options);check='ok';const recovered=await restarted.reconcile(initial.id);
  assert.equal(recovered.status,'completed');assert.equal(recovered.rows[0].status,'prepared');
  assert.equal(store(recovered.rows[0],'shop-a').preparation.verification.checkedAt,'new-read-receipt');
  assert.deepEqual(store(recovered.rows[0],'shop-a').previousPreparation,originalProof);assert.deepEqual(writeCounts(f.events),before);
  assert.equal(count(f.events,'save-read',GOODS[1],'shop-a'),3);assert.equal(count(f.events,'save-read',GOODS[1],'shop-b'),3);
});

test('legacy saved drafts without a save intent still require live verification with the original preparation proof',async t=>{
  let verified=0;
  const f=await fixture(t,{saveVerifyHook:(args,{result})=>{verified++;assert.equal(args.preparationIntent,undefined);assert.equal(args.previousPreparation.saved,true);return result();}});
  f.service.startBatch(f.payload('batch-legacy-proof',[GOODS[1]],['shop-a']));await idle(f.service);
  const state=f.state(),row=state.batches['batch-legacy-proof'].rows[0],before=writeCounts(f.events);
  for(const destination of [row,...row.storeResults])for(const key of ['preparationIntent','prepareSubmittedAt','previousPreparation'])delete destination[key];
  fs.writeFileSync(path.join(f.directory,'state.json'),JSON.stringify(state));
  const restored=createSourcing(f.options);restored.startBatch(f.payload('batch-recheck-legacy-proof',[GOODS[1]],['shop-a']));await idle(restored);
  assert.equal(restored.getBatch('batch-recheck-legacy-proof').status,'completed');assert.equal(verified,1);assert.deepEqual(writeCounts(f.events),before);
});

test('a restart during live verification pauses the former completed batch and never replays a claim or save',async t=>{
  let reading=false;
  const f=await fixture(t,{claimVerifyHook:async()=>{reading=true;await new Promise(()=>{});}});
  f.service.startBatch(f.payload('batch-interrupted-read',[GOODS[1]],['shop-a']));await idle(f.service);
  const before=writeCounts(f.events);void f.service.reconcile('batch-interrupted-read');await until(()=>reading);
  assert.equal(f.state().batches['batch-interrupted-read'].status,'running');
  const restored=createSourcing(f.options),batch=restored.getBatch('batch-interrupted-read');
  assert.equal(batch.status,'paused');assert.equal(store(batch.rows[0],'shop-a').status,'needs-review');assert.equal(store(batch.rows[0],'shop-a').previousPreparation.saved,true);
  assert.throws(()=>restored.startBatch(f.payload('batch-interrupted-read-again',[GOODS[1]],['shop-a'])),/核对|不会再次提交/);
  assert.deepEqual(writeCounts(f.events),before);
});

test('reusable imports and zero detail estimates are scoped to the ERP account instead of an unrelated account history',async t=>{
  const other={...ERP,key:'erp-b',expectedAccount:'account-b',browserKey:'chrome-b',name:'ERP B'};
  const f=await fixture(t,{erpConnections:[ERP,other]});
  f.service.startBatch(f.payload('batch-account-a-import',[GOODS[1]],['shop-a']));await idle(f.service);
  // A saved import remains reusable even if its separate global detail cache is absent.
  const state=f.state();state.details={};fs.writeFileSync(path.join(f.directory,'state.json'),JSON.stringify(state));
  const restored=createSourcing(f.options);assert.deepEqual(restored.view().reusableImports,{'erp-a':[GOODS[1]],'erp-b':[]});
  restored.startBatch(f.payload('batch-account-a-reuse',[GOODS[1]],['shop-a']));await idle(restored);
  assert.equal(restored.getBatch('batch-account-a-reuse').estimatedPoints,0);assert.equal(count(f.events,'rawDetail',GOODS[1]),1);
  await restored.syncStores('erp-b');await restored.storeDefaults({erpKey:'erp-b',targetStoreKey:'shop-a'});
  const started=restored.startBatch({...f.payload('batch-account-b-import',[GOODS[1]],['shop-a']),erpKey:'erp-b'});
  assert.equal(started.estimatedPoints,50);await idle(restored);
  assert.equal(restored.getBatch(started.id).status,'completed');assert.equal(count(f.events,'rawDetail',GOODS[1]),2);
  assert.equal(f.events.filter(e=>e.kind==='import'&&e.erpKey==='erp-a').length,1);assert.equal(f.events.filter(e=>e.kind==='import'&&e.erpKey==='erp-b').length,1);
  assert.deepEqual(restored.view().reusableImports,{'erp-a':[GOODS[1]],'erp-b':[GOODS[1]]});
});

test('reuse estimates exclude legacy methods and unresolved import submissions even when an older verified file exists',async t=>{
  const f=await fixture(t);f.service.startBatch(f.payload('batch-confirmed-import',[GOODS[1]],['shop-a']));await idle(f.service);
  const state=f.state(),original=state.batches['batch-confirmed-import'];
  state.batches['batch-legacy-import']={...clone(original),id:'batch-legacy-import',method:'temu-link-legacy',rows:[{...clone(original.rows[0]),goodsId:GOODS[0]}]};
  state.batches['batch-later-import-unknown']={...clone(original),id:'batch-later-import-unknown',status:'paused',rows:[{goodsId:GOODS[1],sourceUrl:source(GOODS[1]),fileName:original.rows[0].fileName,submittedAt:'2026-11-19T01:00:00Z',status:'needs-review',importStatus:'needs-review',claim:clone(original.rows[0].claim)}]};
  fs.writeFileSync(path.join(f.directory,'state.json'),JSON.stringify(state));const restored=createSourcing(f.options);
  assert.deepEqual(restored.view().reusableImports,{'erp-a':[]});
  const before=writeCounts(f.events);assert.throws(()=>restored.startBatch(f.payload('batch-import-unknown-replay',[GOODS[1]],['shop-a'])),/已有提交记录/);assert.deepEqual(writeCounts(f.events),before);
});
