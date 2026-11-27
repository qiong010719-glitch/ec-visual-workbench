import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createGeekbiClient,normalizeSearch,temuGoodsId,GEEKBI_PRICES,interpretSourcingPrompt} from './geekbi.mjs';
import {createCollectionBrowser} from './collection-browser.mjs';
import {normalizePackageDefaults,normalizeRawProduct,writeProductWorkbook} from './dxm-product-import.mjs';
import {createUsdRateProvider,convertProductToUsd} from './sourcing-fx.mjs';
import {createDxmClaimBrowser} from './dxm-claim-browser.mjs';
import {createDxmListingDispatcher} from './dxm-listing-dispatch.mjs';

export const SOURCING_REVISION='geekbi-multistore-claim-20261119-v7';
export const COLLECTION_METHOD='geekbi-product-data';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(id);
const copy=value=>structuredClone(value);
const targetsOf=b=>Array.isArray(b.targets)?b.targets:b.targetStore?[{targetStore:b.targetStore,defaults:b.defaults}]:[];
const storeResult=(b,row,key)=>Array.isArray(row.storeResults)?row.storeResults.find(r=>r.storeKey===key):b.targetStore?.key===key?row:null;
const imported=row=>row.importStatus!==undefined?row.importStatus==='verified':!!row.fileName&&(['verified','claimed','prepared'].includes(row.status)||row.claim?.status==='claimed'||row.claimSubmittedAt||row.prepareSubmittedAt);
const prepared=result=>result?.status==='prepared'&&result.ready&&result.saved;
function rememberPreparation(destination){
  if(!prepared(destination.previousPreparation)&&prepared(destination.preparation))destination.previousPreparation=copy(destination.preparation);
  return destination.previousPreparation;
}
const unknownWrite=row=>!!row&&(row.prepareSubmittedAt&&!row.preparation?.saved||row.claimSubmittedAt&&row.claim?.status!=='claimed'||(prepared(row.previousPreparation)||prepared(row.preparation))&&(row.status!=='prepared'||!prepared(row.preparation)));
const sameAuthorization=(a,b)=>a?.key===b?.key&&a?.platform===b?.platform&&a?.name===b?.name&&(a?.authorizationSite||'')===(b?.authorizationSite||'');
const sameDestination=(a,b)=>sameAuthorization(a,b)&&(a?.site||'')===(b?.site||'');
const defaultsSignature=d=>JSON.stringify({packageDefaults:normalizePackageDefaults(d?.packageDefaults),warehouse:d?.warehouse??null,shippingTemplate:d?.shippingTemplate??null,dispatch:d?.dispatch??null,category:d?.category??null,attributes:d?.attributes??null,currency:d?.currency??null});
const commonEditUrl=row=>row.importEvidence?.editUrl||row.evidence?.editUrl||row.reuseImport?.evidence?.editUrl;
const hasSaveSubmission=result=>!!(result?.prepareSubmittedAt||result?.preparationIntent||result?.preparation?.saved||result?.previousPreparation?.saved);
function summarizeStores(row){
  if(!row.storeResults?.length)return;
  const results=row.storeResults;
  if(results.length===1){
    const r=results[0];
    for(const key of ['claim','claimCheckedAt','claimSubmittedAt','claimIntent','prepareSubmittedAt','preparationIntent','previousPreparation','preparation','checkedAt'])if(r[key]!==undefined)row[key]=copy(r[key]);
  }
  if(results.every(r=>r.status==='prepared'&&prepared(r.preparation)))row.status='prepared';
  else if(results.some(r=>['claiming','preparing-listing','verifying-reuse'].includes(r.status)))row.status=results.findLast(r=>['claiming','preparing-listing','verifying-reuse'].includes(r.status)).status;
  else if(results.some(r=>r.status==='prepared'))row.status='partial';
  else if(results.some(r=>r.status==='needs-review'))row.status='needs-review';
  else if(results.some(r=>r.status==='claimed'))row.status='claimed';
  else if(results.some(r=>r.status==='blocked'||r.status==='failed'))row.status='blocked';
  else row.status=row.importStatus==='verified'?'verified':'pending';
  row.error=results.filter(r=>r.error).map(r=>`${r.targetStore.name}：${r.error}`).join('；')||null;
}

// Search snapshots and submission intent survive restarts. Ambiguous writes are never replayed.
export function createSourcing({directory,configuration,preferences,isOtherBusy=()=>false,client,adapter,rateProvider,claimAdapter,listingPreparer}){
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'state.json');
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{searches:{},batches:{},sites:[]};
  state.details??={};
  state.storeCatalogs??={};state.storeProfiles??={};
  const detailDirectory=path.join(directory,'details'),importDirectory=path.join(directory,'imports');
  fs.mkdirSync(detailDirectory,{recursive:true});fs.mkdirSync(importDirectory,{recursive:true});
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2));fs.renameSync(file+'.tmp',file);};
  for(const s of Object.values(state.searches))if(s.status==='running'){s.status='needs-review';s.error='查询被中断，请核对极鲸云调用记录；不会自动重发。';}
  for(const b of Object.values(state.batches))if(b.status==='running'){
    b.status='paused';for(const r of b.rows){
      if(r.storeResults?.length&&imported(r)){
        for(const destination of r.storeResults)if(destination.status!=='prepared'){
          destination.status=unknownWrite(destination)?'needs-review':destination.claim?.status==='claimed'?'claimed':'blocked';
          destination.error='工作台被中断，未自动重发认领或保存；可只读核对该店铺结果。';
        }
        summarizeStores(r);
      }else if(!['verified','prepared'].includes(r.status)){r.status=r.submittedAt||r.claimSubmittedAt||r.prepareSubmittedAt?'needs-review':'blocked';r.error='工作台被中断，请核对详情调用、导入和认领记录；不会自动重发。';}
    }
  }
  for(const d of Object.values(state.details))if(d.status==='requesting'){d.status='needs-review';d.error='详情调用被中断，请核对极鲸云调用记录；不会自动重复扣点。';}
  save();
  const request=client||createGeekbiClient(configuration);
  const browser=adapter||createCollectionBrowser(configuration);
  const claimant=claimAdapter||createDxmClaimBrowser(configuration);
  const preparer=listingPreparer||createDxmListingDispatcher(configuration);
  const rates=rateProvider||createUsdRateProvider({directory});
  let active=null;
  const available=()=>{if(active||isOtherBusy())throw fail('有任务正在运行，请等当前任务结束。',409);};
  const search=id=>{const value=state.searches[id];if(!value)throw fail('选品记录不存在',404);return value;};
  const batch=id=>{const value=state.batches[id];if(!value)throw fail('采集批次不存在',404);return value;};
  const binding=erpKey=>{
    const erpConnection=preferences.erp(erpKey);
    if((erpConnection.provider||'dianxiaomi')!=='dianxiaomi')throw fail('本阶段仅支持店小秘采集箱');
    if(!erpConnection.expectedAccount)throw fail('请先在连接设置填写店小秘账号显示名，用于防止采集到错误账号');
    const browserConfig=preferences.browser(erpConnection.browserKey);
    if(browserConfig.type!=='chrome')throw fail('当前商品数据导入仅支持谷歌浏览器，请在连接设置绑定 Chrome');
    return copy({erpConnection,browserConfig});
  };
  const sameAccount=(a,b)=>(a.erpConnection.provider||'dianxiaomi')===(b.erpConnection.provider||'dianxiaomi')&&a.erpConnection.expectedAccount===b.erpConnection.expectedAccount;
  const accountKey=bound=>JSON.stringify([bound.erpConnection.provider||'dianxiaomi',bound.erpConnection.expectedAccount,bound.browserConfig.key]);
  const profileKey=(bound,storeKey)=>JSON.stringify([accountKey(bound),storeKey]);
  const importHistory=(bound,goodsId)=>Object.values(state.batches).filter(b=>sameAccount(b.binding,bound)).reverse().flatMap(b=>b.rows.filter(r=>r.goodsId===goodsId).map(row=>({batch:b,row})));
  function reusableImport(history){
    const submitted=history.find(h=>h.batch.method===COLLECTION_METHOD&&h.row.submittedAt);
    if(submitted&&!imported(submitted.row))return null;
    return history.find(h=>h.batch.method===COLLECTION_METHOD&&h.row.fileName&&imported(h.row))?.row||null;
  }
  function reusableImports(){
    const accounts=preferences.view?.().erpConnections||Object.values(state.batches).map(b=>b.binding.erpConnection);
    const goodsIds=new Set(Object.values(state.batches).flatMap(b=>b.rows.map(r=>r.goodsId)));
    return Object.fromEntries(accounts.filter(e=>(e.provider||'dianxiaomi')==='dianxiaomi'&&e.expectedAccount).map(erpConnection=>[erpConnection.key,[...goodsIds].filter(goodsId=>reusableImport(importHistory({erpConnection},goodsId)))]));
  }
  async function syncStores(erpKey){
    available();const bound=binding(erpKey);active='stores';
    try{const result=await claimant.listStores(bound),stores=Array.isArray(result)?result:result.stores;
      if(!Array.isArray(stores)||stores.some(s=>!s.key||!s.name||!s.platform)||new Set(stores.map(s=>s.key)).size!==stores.length)throw fail('店小秘店铺列表无法完整核对');
      const catalog={stores:copy(stores),observedAt:now()};state.storeCatalogs[accountKey(bound)]=catalog;save();return copy(catalog);
    }finally{active=null;}
  }
  function target(bound,key){const catalog=state.storeCatalogs[accountKey(bound)];const store=catalog?.stores.find(s=>s.key===key);if(!store)throw fail('请先同步店小秘店铺，再选择本次认领的目标店铺');if(store.disabled)throw fail('目标店铺已停用，请选择有效店铺');return copy(store);}
  function savedProduct(fileName,goodsId){
    const manifest=JSON.parse(fs.readFileSync(path.join(importDirectory,fileName+'.json'),'utf8'));
    if(manifest.product.goodsId!==goodsId)throw fail('已保存商品编号不一致，不能复用导入记录');
    if(!manifest.product.sourceCategory&&fs.existsSync(path.join(detailDirectory,goodsId+'.json')))manifest.product.sourceCategory=normalizeRawProduct(JSON.parse(fs.readFileSync(path.join(detailDirectory,goodsId+'.json'),'utf8')),goodsId).sourceCategory;
    return manifest;
  }
  // This context is made only from persisted workbench state. No request field
  // can grant site initialization, and a save intent permanently disables it.
  function claimSubmission(b,row,destination,targetStore){
    const collectionEditUrl=commonEditUrl(row),submitted=destination.claimSubmittedAt;
    if(b.method!==COLLECTION_METHOD||targetStore.platform!=='temu'||targetStore.site!=='加拿大站'||!imported(row)||!Number.isFinite(Date.parse(submitted))||hasSaveSubmission(destination))return undefined;
    if(!/^https:\/\/www\.dianxiaomi\.com\/web\/productCrawl\/edit\?id=\d{6,30}$/.test(collectionEditUrl||'')||!row.sourceUrl)return undefined;
    const intent=destination.claimIntent;
    if(intent&&(intent.claimSubmittedAt!==submitted||intent.account!==b.binding.erpConnection.expectedAccount||intent.sourceUrl!==row.sourceUrl||intent.collectionEditUrl!==collectionEditUrl||!sameDestination(intent.targetStore,targetStore)))return undefined;
    const savedElsewhere=importHistory(b.binding,row.goodsId).some(h=>commonEditUrl(h.row)===collectionEditUrl&&targetsOf(h.batch).some(t=>sameDestination(t.targetStore,targetStore)&&hasSaveSubmission(storeResult(h.batch,h.row,t.targetStore.key))));
    if(savedElsewhere)return undefined;
    return {version:1,source:'workbench-persisted-claim',saveState:'no-workbench-save-submission',account:b.binding.erpConnection.expectedAccount,sourceUrl:row.sourceUrl,collectionEditUrl,targetStore:copy(targetStore),claimSubmittedAt:submitted};
  }
  async function storeDefaults(payload){
    available();const bound=binding(payload.erpKey),targetStore=target(bound,payload.targetStoreKey);active='store-defaults';
    try{
      const settings=preferences.view(),configured=settings.stores.filter(s=>s.platform===targetStore.platform&&s.expectedStore===targetStore.name&&sameAccount({erpConnection:settings.erpConnections.find(e=>e.key===s.erpKey)||{}},bound));
      if(configured.length>1)throw fail('有多个同名店铺配置，请在连接设置核对站点后再读取默认值');
      const store=configured[0],template=store?.templates.find(t=>payload.templateKey?t.key===payload.templateKey:!!t.verifiedAt);
      if(targetStore.platform==='tiktok'&&!template){
        let shared=Object.entries(state.storeProfiles).filter(([key,p])=>JSON.parse(key)[0]===accountKey(bound)&&p.defaults?.platform==='temu'&&p.defaults?.packageDefaults).map(([,p])=>p.defaults);
        if(!shared.length){
          const candidates=settings.stores.filter(s=>s.platform==='temu'&&sameAccount({erpConnection:settings.erpConnections.find(e=>e.key===s.erpKey)||{}},bound)).flatMap(s=>s.templates.filter(t=>t.verifiedAt).map(t=>({store:s,template:t})));
          if(candidates.length===1)shared=[await preparer.readDefaults({...bound,...candidates[0]})];
        }
        const packages=new Set(shared.map(d=>JSON.stringify(d.packageDefaults)));
        if(packages.size!==1)throw fail('需要先确定一组统一包裹参数，请先读取已配置店铺的模板默认值');
        const rows=Object.values(state.batches).filter(b=>b.method===COLLECTION_METHOD&&sameAccount(b.binding,bound)).reverse().flatMap(b=>b.rows).filter(r=>r.fileName&&imported(r));
        let seed;
        for(const row of [...new Map(rows.map(r=>[r.goodsId,r])).values()].slice(0,3)){
          const {product}=savedProduct(row.fileName,row.goodsId);
          const claim=await claimant.verifyClaim({...bound,goodsId:row.goodsId,sourceUrl:product.sourceUrl,product,targetStore,importEvidence:row.importEvidence||row.evidence});
          const platformEditUrl=claim.evidence?.platformEditUrl||claim.platformEditUrl;
          if(claim.status==='claimed'&&platformEditUrl){seed={product,platformEditUrl};break;}
        }
        if(!seed)throw fail('该店铺还没有可读取的已认领商品草稿，无法核对仓库及平台必填项');
        const defaults=await preparer.readDefaults({...bound,targetStore,...seed,packageDefaults:shared[0].packageDefaults,packageSource:shared[0].source});
        const profile={targetStore,defaults,checkedAt:now(),issues:defaults.issues||[]};state.storeProfiles[profileKey(bound,targetStore.key)]=profile;save();return copy(profile);
      }
      if(!store||!template){const profile={targetStore,defaults:null,issues:['该店铺还没有可读取的商品模板，请先在连接设置配置该店铺的母稿。'],checkedAt:now()};state.storeProfiles[profileKey(bound,targetStore.key)]=profile;save();return copy(profile);}
      const defaults=await preparer.readDefaults({...bound,store,template});
      const profile={targetStore:{...targetStore,site:store.expectedSite},defaults,checkedAt:now(),issues:[]};state.storeProfiles[profileKey(bound,targetStore.key)]=profile;save();return copy(profile);
    }finally{active=null;}
  }
  function storeView(erpKey){
    const bound=binding(erpKey),catalog=state.storeCatalogs[accountKey(bound)]||{stores:[]};
    return {...copy(catalog),profiles:Object.fromEntries(catalog.stores.map(s=>{
      const profile=copy(state.storeProfiles[profileKey(bound,s.key)]||null);
      if(profile&&!sameAuthorization(s,profile.targetStore)){profile.defaults=null;profile.issues=[`${s.name} 的授权站点已变化，请重新读取该店铺默认值`];}
      return [s.key,profile];
    }))};
  }
  async function detail(goodsId,row){
    let record=state.details[goodsId];
    if(record?.status==='needs-review')throw fail(record.error||'详情调用结果不明确，请先核对极鲸云调用记录，不能重复获取');
    if(record?.status==='ready'){
      row.detailCached=true;row.detailChargedPoints=0;save();
      try{return JSON.parse(fs.readFileSync(path.join(detailDirectory,goodsId+'.json'),'utf8'));}
      catch{throw fail('已获取的详情文件缺失或损坏，已停止；不会自动再次扣点');}
    }
    record=state.details[goodsId]={status:'requesting',startedAt:now()};row.detailCached=false;save();
    try{
      const r=await request('rawDetail',{goodsId});
      fs.writeFileSync(path.join(detailDirectory,goodsId+'.json.tmp'),JSON.stringify(r,null,2));
      fs.renameSync(path.join(detailDirectory,goodsId+'.json.tmp'),path.join(detailDirectory,goodsId+'.json'));
      Object.assign(record,{status:'ready',receivedAt:r.receivedAt,chargedPoints:r.chargedPoints});row.detailChargedPoints=r.chargedPoints;save();return r;
    }catch(e){
      // A transport failure or a local persistence failure may follow a charged call.
      record.status=e.uncertain||!e.status?'needs-review':'failed';record.error=e.message;save();throw e;
    }
  }
  async function sites(){
    available();active='sites';
    try{const r=await request('sites');if(!Array.isArray(r.data))throw fail('极鲸云站点列表格式变化，请检查接口文档');state.sites=r.data;save();return copy(state.sites);}finally{active=null;}
  }
  async function categories(parentCatId){
    if(parentCatId&&!/^\d{1,20}$/.test(String(parentCatId)))throw fail('类目编号无效');
    available();active='categories';try{const r=await request('categories',parentCatId?{parentCatId}:{});if(!Array.isArray(r.data))throw fail('极鲸云类目列表格式变化');return r.data;}finally{active=null;}
  }
  function startSearch(payload){
    const {requestId}=payload;if(!idOK(requestId))throw fail('查询编号无效');
    const filters=normalizeSearch(payload),fingerprint=JSON.stringify(filters);
    if(state.searches[requestId]){
      const s=search(requestId),comparison={...filters};
      // Reconcile old requests without silently turning a replay into a new paid strict search.
      if(s.filters.matchMode===undefined&&payload.matchMode===undefined)delete comparison.matchMode;
      if(s.fingerprint!==JSON.stringify(comparison))throw fail('同一个查询编号不能修改条件',409);return copy(s);
    }
    available();
    const site=state.sites.find(s=>Number(s.siteId)===filters.siteId);if(!site)throw fail('请先加载站点，再选择经营站点');
    if(!configuration.GB_APP_KEY||!configuration.GB_APP_SECRET)throw fail('请先在连接设置保存极鲸云调用标识和应用密钥');
    const s={id:requestId,fingerprint,filters,site:copy(site),createdAt:now(),status:'running',rows:[],calls:[],estimatedPoints:Math.max(1,filters.keywords.length)*GEEKBI_PRICES.search};
    state.searches[s.id]=s;active=s.id;save();
    (async()=>{
      for(const keyword of filters.keywords.length?filters.keywords:[undefined]){
        const {keywords,...params}=filters;const call={keyword:keyword||'',startedAt:now(),status:'requesting'};s.calls.push(call);save();
        try{
          const r=await request('search',{...params,page:1,keyword});
          if(!Array.isArray(r.data?.list))throw Object.assign(fail('极鲸云商品结构变化，请检查调用记录'),{uncertain:true});
          Object.assign(call,{status:'succeeded',chargedPoints:r.chargedPoints,receivedAt:r.receivedAt,total:r.data.total});
          // Keep the exact returned fields separately; no generated copy or inferred zero metrics.
          fs.writeFileSync(path.join(directory,`${s.id}-${s.calls.length}.json`),JSON.stringify(r,null,2));
          for(const raw of r.data.list){
            const goodsId=String(raw.goodsId||'');if(!/^\d{6,32}$/.test(goodsId))continue;
            if(s.rows.some(x=>x.goodsId===goodsId&&Number(x.siteId)===Number(raw.siteId??filters.siteId)))continue;
            s.rows.push({goodsId,siteId:raw.siteId??filters.siteId,raw:copy(raw),receivedAt:r.receivedAt,sourceUrl:temuGoodsId(raw.linkUrl)===goodsId?raw.linkUrl:null});
          }
          save();
        }catch(e){call.status=e.uncertain?'needs-review':'failed';call.error=e.message;s.error=e.message;s.status=e.uncertain?'needs-review':s.rows.length?'partial':'failed';save();return;}
      }
      s.status='completed';s.completedAt=now();save();
    })().catch(e=>{s.status='needs-review';s.error=String(e.message);save();}).finally(()=>{active=null;});
    return copy(s);
  }
  function startBatch(payload){
    const {requestId,searchId,erpKey,goodsIds,targetStoreKey}=payload;
    if(!idOK(requestId))throw fail('批次编号无效');
    if(!Array.isArray(goodsIds)||!goodsIds.length||goodsIds.length>20||new Set(goodsIds).size!==goodsIds.length)throw fail('每批请选择1—20件商品');
    const multiple=Object.hasOwn(payload,'targetStoreKeys');
    if(multiple&&targetStoreKey!==undefined)throw fail('请使用一种店铺选择方式，不能同时提交单店和多店字段');
    const requestedKeys=multiple?payload.targetStoreKeys:targetStoreKey?[targetStoreKey]:[];
    if(!Array.isArray(requestedKeys)||multiple&&!requestedKeys.length||requestedKeys.some(key=>typeof key!=='string'||!key.trim())||new Set(requestedKeys).size!==requestedKeys.length)throw fail('请至少选择一家目标店铺，店铺编号不能重复或为空');
    const targetStoreKeys=[...requestedKeys].sort();
    const fingerprint=JSON.stringify({searchId,erpKey,goodsIds,...(targetStoreKeys.length?{targetStoreKeys}:{})});
    if(state.batches[requestId]){
      const b=batch(requestId),priorKeys=targetsOf(b).map(t=>t.targetStore.key).sort();
      if(b.searchId!==searchId||b.binding.erpConnection.key!==erpKey||JSON.stringify(b.rows.map(r=>r.goodsId))!==JSON.stringify(goodsIds)||JSON.stringify(priorKeys)!==JSON.stringify(targetStoreKeys))throw fail('同一批次编号不能修改商品、账号或目标店铺',409);
      return copy(b);
    }
    available();const s=search(searchId),bound=binding(erpKey);
    const selectedTargets=targetStoreKeys.map(key=>{
      const selected=target(bound,key),profile=state.storeProfiles[profileKey(bound,key)];
      if(profile&&!sameAuthorization(selected,profile.targetStore))throw fail(`${selected.name} 的授权站点已变化，请重新读取该店铺默认值后再开始采集`);
      if(!profile?.defaults?.packageDefaults)throw fail(`请先读取 ${selected.name} 的店铺默认值，确认统一包裹尺寸和重量后再开始采集`);
      const packageDefaults=normalizePackageDefaults(profile.defaults.packageDefaults);
      if(!packageDefaults)throw fail(`${selected.name} 缺少完整的统一包裹默认值`);
      return {targetStore:copy(profile.targetStore),defaults:{...copy(profile.defaults),packageDefaults}};
    });
    const packageChoices=new Set(selectedTargets.map(t=>JSON.stringify(t.defaults.packageDefaults)));
    if(packageChoices.size>1)throw fail('所选店铺的统一包裹尺寸或重量不一致，请先统一店铺默认值，再开始采集');
    const packageDefaults=selectedTargets[0]?.defaults.packageDefaults;
    if(!['completed','partial'].includes(s.status))throw fail('请等待选品查询完成并核对结果后再导入');
    const proven=Object.values(state.batches).some(b=>b.method===COLLECTION_METHOD&&sameAccount(b.binding,bound)&&b.rows.some(imported));
    if(!proven&&goodsIds.length!==1)throw fail('这个账号尚未完成首次入箱验证，请先选择1件商品。确认成功后可批量采集。');
    const rows=goodsIds.map(goodsId=>{
      const r=s.rows.find(r=>r.goodsId===goodsId);if(!r)throw fail('所选商品不属于当前选品结果');
      if(Number(r.siteId)!==Number(s.site.siteId))throw fail('商品返回站点与筛选站点不一致，已停止采集');
      const history=importHistory(bound,goodsId);
      const latestImport=history.find(h=>h.batch.method===COLLECTION_METHOD&&h.row.submittedAt);
      if(latestImport&&!imported(latestImport.row))throw fail(`商品 ${goodsId} 已有提交记录，请先核对已有批次，避免重复采集。`,409);
      const destinations=selectedTargets.map(({targetStore,defaults})=>{
        const attempts=history.filter(h=>h.batch.method===COLLECTION_METHOD).map(h=>({...h,result:storeResult(h.batch,h.row,targetStore.key)})).filter(h=>h.result);
        const latest=attempts.find(h=>h.result.claimSubmittedAt||h.result.prepareSubmittedAt||h.result.claim||h.result.preparation);
        if(latest&&unknownWrite(latest.result))throw fail(`商品 ${goodsId} 在 ${targetStore.name} 的认领或保存结果尚未核对，请先核对原批次，不会再次提交。`,409);
        const previousTarget=latest&&targetsOf(latest.batch).find(t=>t.targetStore.key===targetStore.key),previousDefaults=previousTarget?.defaults;
        const result={storeKey:targetStore.key,targetStore:copy(targetStore),status:'pending'};
        if(latest?.result.status==='prepared'&&prepared(latest.result.preparation)&&sameDestination(previousTarget?.targetStore,targetStore)&&previousDefaults&&defaultsSignature(previousDefaults)===defaultsSignature(defaults)){
          for(const key of ['claim','claimCheckedAt','claimSubmittedAt','claimIntent','prepareSubmittedAt','preparationIntent','previousPreparation','preparation','checkedAt'])if(latest.result[key]!==undefined)result[key]=copy(latest.result[key]);
          rememberPreparation(result);result.status='verifying-reuse';result.reusedPrevious={batchId:latest.batch.id,checkedAt:latest.result.checkedAt||latest.result.preparation.verification?.checkedAt||latest.result.claimCheckedAt,defaults:copy(previousDefaults)};
        }else if(latest?.result.claim?.status==='claimed'&&!hasSaveSubmission(latest.result)&&sameDestination(previousTarget?.targetStore,targetStore)&&previousDefaults&&defaultsSignature(previousDefaults)===defaultsSignature(defaults)){
          for(const key of ['claim','claimCheckedAt','claimSubmittedAt','claimIntent'])if(latest.result[key]!==undefined)result[key]=copy(latest.result[key]);
          result.resumedUnpreparedClaim={batchId:latest.batch.id};
        }
        return result;
      });
      const previous=selectedTargets.length?reusableImport(history):null;
      if(!previous&&history.some(h=>h.row.submittedAt||h.row.status==='verified'))throw fail(`商品 ${goodsId} 已有提交记录，请先核对已有批次，避免重复采集。`,409);
      if(state.details[goodsId]?.status==='needs-review')throw fail(`商品 ${goodsId} 的详情调用结果待核对；不会自动再次扣点。`,409);
      return {goodsId,title:r.raw.goodsName||goodsId,status:'pending',sourceUrl:r.sourceUrl,...(destinations.length?{storeResults:destinations}:{}),...(previous?{reuseImport:{fileName:previous.fileName,evidence:copy(previous.importEvidence||previous.evidence)},detailCached:true,detailChargedPoints:0}:{})};
    });
    const estimatedPoints=rows.filter(r=>!r.reuseImport&&state.details[r.goodsId]?.status!=='ready').length*GEEKBI_PRICES.rawDetail;
    if(estimatedPoints&&(!configuration.GB_APP_KEY||!configuration.GB_APP_SECRET))throw fail('请先保存极鲸云凭据');
    const b={id:requestId,fingerprint,method:COLLECTION_METHOD,estimatedPoints,searchId,binding:bound,targets:copy(selectedTargets),targetStores:selectedTargets.map(t=>copy(t.targetStore)),targetStore:selectedTargets.length===1?copy(selectedTargets[0].targetStore):null,defaults:selectedTargets.length===1?copy(selectedTargets[0].defaults):null,packageDefaults:copy(packageDefaults),site:copy(s.site),status:'running',createdAt:now(),rows};state.batches[b.id]=b;active=b.id;save();
    (async()=>{
      // Check the bound account and the public import form before buying any detail.
      if(b.rows.some(r=>!r.reuseImport))await browser.preflight(bound);
      if(b.targets.length&&b.estimatedPoints){
        const result=await claimant.listStores(bound),stores=Array.isArray(result)?result:result.stores;
        for(const {targetStore}of b.targets)if(stores.filter(s=>sameAuthorization(s,targetStore)&&!s.disabled).length!==1)throw fail(`${targetStore.name} 的店铺授权已变化，已在付费详情获取前停止，请重新同步店铺`);
      }
      const batchRates=new Map();
      for(const row of b.rows){
        if(b.stopRequested){b.status='paused';b.error='已按要求停止，未提交后续商品。';save();return;}
        try{
          if(row.reuseImport){
            const {product,...manifest}=savedProduct(row.reuseImport.fileName,row.goodsId);
            Object.assign(row,manifest,{fileName:row.reuseImport.fileName,sourceUrl:product.sourceUrl,title:product.title,snapshotTime:product.snapshotTime,currency:product.currency,originalCurrency:product.originalCurrency,conversion:product.conversion,priceConversions:product.conversion?product.skus.map(s=>({skuId:s.id,originalPrice:s.originalPrice,originalSalePrice:s.originalSalePrice,price:s.price,salePrice:s.salePrice})):undefined,warnings:product.warnings,sourceCategory:product.sourceCategory,packageDefaults:b.packageDefaults,importEvidence:row.reuseImport.evidence,importStatus:'verified',status:'verified'});save();
            if(!await claimAndPrepare(b,row,product))return;
            continue;
          }
          row.status='fetching-detail';save();
          const response=await detail(row.goodsId,row);
          // Keep the supplier receipt visible even if a field prevents file creation.
          const raw=response.data?.json;
          Object.assign(row,{detailReceivedAt:response.receivedAt,currency:typeof raw?.localInfo?.currency==='string'?raw.localInfo.currency:null});save();
          const original=normalizeRawProduct(response,row.goodsId,{packageDefaults:b.packageDefaults});
          if(b.stopRequested){row.status='blocked';row.error='详情已保存，已停止本件导入。';b.status='paused';save();return;}
          if(original.currency!=='USD'&&!batchRates.has(original.currency)){row.status='converting-price';save();batchRates.set(original.currency,await rates.quote(original.currency));}
          const product=convertProductToUsd(original,batchRates.get(original.currency));
          Object.assign(row,{title:product.title,sourceUrl:product.sourceUrl,snapshotTime:product.snapshotTime,detailReceivedAt:product.receivedAt,currency:product.currency,originalCurrency:product.originalCurrency,conversion:product.conversion,priceConversions:product.conversion?product.skus.map(s=>({skuId:s.id,originalPrice:s.originalPrice,originalSalePrice:s.originalSalePrice,price:s.price,salePrice:s.salePrice})):undefined,warnings:product.warnings,status:'preparing-file'});save();
          const fileName=`gb-${row.goodsId}-${b.id}.xlsx`,filePath=path.join(importDirectory,fileName);
          const manifest=writeProductWorkbook(product,filePath);
          fs.writeFileSync(filePath+'.json',JSON.stringify({product,...manifest},null,2));
          Object.assign(row,{fileName,...manifest,status:'ready-to-import'});save();
          if(b.stopRequested){b.status='paused';b.error='详情已保存，按要求停止，未上传本件商品。';row.status='blocked';row.error=b.error;save();return;}
          const result=await browser.importProduct({...bound,goodsId:row.goodsId,sourceUrl:row.sourceUrl,product,filePath,beforeSubmit:()=>{
            if(b.stopRequested)throw fail('已停止，未上传本件商品');
            row.submittedAt=now();row.status='submitting';save();
          }});
          if(!['verified','failed','needs-review'].includes(result.status))throw fail('采集结果无法确认');
          Object.assign(row,result,{importStatus:result.status,checkedAt:now(),sourceCategory:product.sourceCategory,packageDefaults:product.packageDefaults,importEvidence:result.evidence});save();
          if(row.status!=='verified'){b.status='paused';b.error='已停止本批后续商品，请先处理当前条目的采集结果。';save();return;}
          if(b.targets.length&&!await claimAndPrepare(b,row,product))return;
        }catch(e){row.status=row.submittedAt||row.claimSubmittedAt||row.prepareSubmittedAt?'needs-review':'blocked';row.error=e.message;b.status='paused';b.error='已停止本批后续商品。';save();return;}
      }
      b.status='completed';b.completedAt=now();save();
    })().catch(e=>{b.status='paused';b.error=e.message;for(const row of b.rows)if(row.status==='pending'){row.status='blocked';row.error=e.message;}save();}).finally(()=>{active=null;});
    return copy(b);
  }
  async function claimAndPrepare(b,row,product){
    const persist=()=>{summarizeStores(row);save();};
    for(const destination of row.storeResults){
      if(b.stopRequested)break;
      const {targetStore,defaults}=b.targets.find(t=>t.targetStore.key===destination.storeKey);
      if(destination.reusedPrevious){
        await reconcileStore(b,row,destination,targetStore,defaults,product);persist();continue;
      }
      try{
        destination.status='claiming';destination.error=null;persist();
        const args={...b.binding,goodsId:row.goodsId,sourceUrl:product.sourceUrl,product,targetStore,importEvidence:row.importEvidence,claimSubmission:claimSubmission(b,row,destination,targetStore),beforeClaim:intent=>{
          if(b.stopRequested)throw fail('已停止，未发起认领');
          if(intent&&(intent.sourceUrl!==product.sourceUrl||intent.targetStore?.platform!==targetStore.platform||intent.targetStore?.name!==targetStore.name||intent.collectionEditUrl&&commonEditUrl(row)&&intent.collectionEditUrl!==commonEditUrl(row)))throw fail('认领提交身份与批次不一致，未提交');
          destination.claimSubmittedAt=now();
          destination.claimIntent={account:b.binding.erpConnection.expectedAccount,sourceUrl:product.sourceUrl,collectionEditUrl:intent?.collectionEditUrl||commonEditUrl(row),targetStore:copy(targetStore),claimSubmittedAt:destination.claimSubmittedAt};persist();
          return claimSubmission(b,row,destination,targetStore);
        }};
        const claim=await (destination.resumedUnpreparedClaim?claimant.verifyClaim(args):claimant.claimProduct(args));destination.claim=claim;destination.claimCheckedAt=now();persist();
        if(claim.status!=='claimed'){destination.status='needs-review';destination.error=claim.error||'认领结果尚未核实，未再次提交';continue;}
        destination.status='claimed';persist();
        if(b.stopRequested){destination.error='已认领，按要求停止后续补全。';break;}
        const platformEditUrl=claim.evidence?.platformEditUrl||claim.platformEditUrl;
        if(!platformEditUrl){destination.error='已认领到目标店铺，但尚未取得该店铺商品编辑地址；不会重复认领。';continue;}
        destination.status='preparing-listing';persist();
        const newDraftSiteInitialization=claimSubmission(b,row,destination,targetStore)?claim.evidence?.newDraftSiteInitialization:undefined;
        const result=await preparer.prepare({...b.binding,targetStore,defaults,product,platformEditUrl,newDraftSiteInitialization,beforeSave:intent=>{
          if(b.stopRequested)throw fail('已停止，未保存店铺商品');destination.prepareSubmittedAt=now();destination.preparationIntent=intent;persist();
        }});
        destination.preparation=result;destination.checkedAt=now();
        destination.status=prepared(result)?'prepared':unknownWrite(destination)?'needs-review':'claimed';
        rememberPreparation(destination);
        destination.error=destination.status==='prepared'?null:(result.issues||[]).join('；')||'已认领，部分必填项仍待配置';
      }catch(error){destination.status=unknownWrite(destination)?'needs-review':destination.claim?.status==='claimed'?'claimed':'blocked';destination.error=error.message;}
      finally{persist();}
    }
    persist();
    if(row.status!=='prepared'){
      b.status='paused';b.error=b.stopRequested?'已停止尚未执行的店铺和后续商品。':'当前商品部分店铺未完成，结果已分别保存，已停止后续商品。';save();return false;
    }
    return true;
  }
  async function reconcileStore(b,row,destination,targetStore,defaults,product){
    const previousPreparation=rememberPreparation(destination);
    if(!destination.claimSubmittedAt&&!destination.claim&&!destination.prepareSubmittedAt&&!previousPreparation){destination.error='商品已入箱，该店铺尚未执行认领；只读核对不会发起认领。';return;}
    const verifySaved=!!previousPreparation||!!(destination.prepareSubmittedAt&&destination.preparationIntent);
    if(previousPreparation){destination.status='verifying-reuse';destination.error=null;summarizeStores(row);save();}
    try{
      const result=await claimant.verifyClaim({...b.binding,goodsId:row.goodsId,sourceUrl:row.sourceUrl,product,targetStore,importEvidence:row.importEvidence,claimSubmission:claimSubmission(b,row,destination,targetStore)});destination.claim=result;destination.claimCheckedAt=now();
      const unknownSave=destination.prepareSubmittedAt&&!destination.preparation?.saved;
      if(verifySaved){
        if(result.status!=='claimed')throw fail(result.error||'店铺认领结果仍待核对，未重新认领或保存');
        if(!preparer.verify)throw fail('当前平台尚不支持只读核对已有草稿，未重新保存');
        const platformEditUrl=result.evidence?.platformEditUrl||result.platformEditUrl;
        if(!platformEditUrl)throw fail('尚未核实该店铺的商品编辑地址，未重新认领或保存');
        const checked=await preparer.verify({...b.binding,targetStore,defaults,product,platformEditUrl,preparationIntent:destination.preparationIntent,previousPreparation:copy(previousPreparation)});
        destination.preparation=checked;destination.status=prepared(checked)?'prepared':'needs-review';destination.error=destination.status==='prepared'?null:(checked.issues||[]).join('；')||'上次保存结果仍待核对';
        rememberPreparation(destination);
      }else{
        destination.status=result.status==='claimed'&&!unknownSave?'claimed':'needs-review';destination.error=unknownSave?'已核实店铺认领，但上次保存结果仍不明确；未再次保存或发布，请核对店铺草稿。':result.status==='claimed'?'已核实店铺认领；本次只读核对，未再次保存或发布商品。':result.error||'店铺认领结果仍待核对';
      }
    }catch(error){destination.status='needs-review';destination.error=error.message;if(verifySaved)destination.preparation={status:'needs-review',ready:false,issues:[error.message]};}
    destination.checkedAt=now();
  }
  async function reconcile(id){
    available();const b=batch(id);const current=binding(b.binding.erpConnection.key);
    if(JSON.stringify(current)!==JSON.stringify(b.binding))throw fail('ERP绑定已变化，请在原账号采集箱核对记录');
    active=b.id;
    const targets=targetsOf(b);
    b.status='running';save();
    try{for(const row of b.rows.filter(r=>targets.length||r.sourceUrl&&r.status!=='verified')){
      try{
      if(!row.sourceUrl)throw fail('商品来源地址缺失，未重新获取详情或提交。');
      let product;
      if(b.method===COLLECTION_METHOD){
        if(!row.fileName)throw fail('尚未生成可核对的导入文件，未重新获取详情或提交。');
        product=savedProduct(row.fileName,row.goodsId).product;
      }
      if(row.storeResults?.length){
        if(!imported(row)){
          try{
            const result=await browser.verify({...b.binding,goodsId:row.goodsId,sourceUrl:row.sourceUrl,product});Object.assign(row,result,{importStatus:result.status,importEvidence:result.evidence,checkedAt:now()});save();
            if(result.status!=='verified')continue;
          }catch(error){row.status='needs-review';row.error=error.message;save();continue;}
        }
        for(const destination of row.storeResults){
          const configured=targets.find(t=>t.targetStore.key===destination.storeKey);
          if(!configured){rememberPreparation(destination);destination.status='needs-review';destination.error='批次的目标店铺记录缺失，未重新提交';}
          else await reconcileStore(b,row,destination,configured.targetStore,configured.defaults,product);
          summarizeStores(row);save();
        }
        continue;
      }
      if(b.targetStore&&(row.claimSubmittedAt||row.claim||row.prepareSubmittedAt||prepared(row.preparation)||prepared(row.previousPreparation))){
        await reconcileStore(b,row,row,b.targetStore,b.defaults,product);save();continue;
      }
      const result=await browser.verify({...b.binding,goodsId:row.goodsId,sourceUrl:row.sourceUrl,product});Object.assign(row,result,{importStatus:result.status,checkedAt:now()});save();
      }catch(error){
        if(row.storeResults?.length){for(const destination of row.storeResults){rememberPreparation(destination);destination.status='needs-review';destination.error=error.message;destination.checkedAt=now();}summarizeStores(row);}
        else{rememberPreparation(row);row.status='needs-review';row.error=error.message;row.checkedAt=now();}
        save();
      }
    }if(b.rows.every(r=>r.status===(targets.length?'prepared':'verified'))){b.status='completed';b.error=null;b.completedAt??=now();}
    else{b.status='paused';b.error='现场核对尚未全部通过，未重新获取详情、导入、认领或保存。';}
    save();return copy(b);}finally{active=null;}
  }
  async function open(erpKey){available();const bound=binding(erpKey);active='open';try{return await browser.open(bound);}finally{active=null;}}
  return {isBusy:()=>!!active,sites,categories,startSearch,startBatch,reconcile,open,syncStores,storeDefaults,storeView,
    stop:id=>{const b=batch(id);if(b.status==='running'){b.stopRequested=true;save();}return copy(b);},
    parse:async prompt=>{available();active='parse';try{return await interpretSourcingPrompt(prompt,configuration);}finally{active=null;}},
    getSearch:id=>copy(search(id)),getBatch:id=>copy(batch(id)),
    importFile:(batchId,goodsId)=>{const row=batch(batchId).rows.find(r=>r.goodsId===goodsId);if(!row?.fileName)throw fail('导入文件尚未生成',404);const location=path.join(importDirectory,row.fileName);if(!fs.existsSync(location))throw fail('导入文件已丢失，请核对本地文件；不会自动重新获取付费详情',404);return {path:location,name:row.fileName};},
    view:()=>{const otherBusy=!!isOtherBusy();return {revision:SOURCING_REVISION,method:COLLECTION_METHOD,configured:!!configuration.GB_APP_KEY&&!!configuration.GB_APP_SECRET,busy:!!active||otherBusy,otherBusy,sites:copy(state.sites),prices:GEEKBI_PRICES,details:copy(state.details),reusableImports:reusableImports(),searches:Object.values(state.searches).map(s=>({id:s.id,status:s.status,createdAt:s.createdAt,filters:s.filters,count:s.rows.length})).reverse(),batches:Object.values(state.batches).map(b=>({id:b.id,method:b.method||'temu-link-legacy',estimatedPoints:b.estimatedPoints,status:b.status,createdAt:b.createdAt,erpName:b.binding.erpConnection.name,targetStore:copy(b.targetStore),targetStores:targetsOf(b).map(t=>copy(t.targetStore)),rows:copy(b.rows),error:b.error})).reverse()};}};
}
