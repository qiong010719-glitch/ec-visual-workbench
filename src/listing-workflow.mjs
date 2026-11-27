import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {listingTemplateReadiness} from './listing-templates.mjs';
import {productIdentity} from './temu-front-browser.mjs';
import {collectionClaimDestination,assertCollectionClaimIdentities} from './listing-destinations.mjs';
import {normalizeTemuSourceFacts} from './temu-source-facts.mjs';
import {suggestListingCategory,createConfirmedCategoryMapping} from './listing-category-policy.mjs';
import {createCategoryCandidateCatalog,validateCategoryCandidateCatalog,resolveListingCategory,confirmListingCategory,createCategoryRanker} from './listing-category-resolution.mjs';

const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const idOK=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const secretName=/(?:api.?key|secret|password|authorization|cookie|csrf|credential|access.?token|refresh.?token)/i;
const submissionFields=['saveIntent','moveIntent','publishIntent'];
const nativeSnapshotPolicy='native-batch-preserve-fields-v1';
const acceptedPublication=row=>['submitted','listed','reviewing','pending-launch'].includes(row.publicationStatus);
const preflightOnly=row=>row.publicationStatus==='unknown'&&row.publicationPreflightBlocked===true&&!row.moveIntent&&!row.publishIntent;
const publicationPending=row=>!!row.publicationStatus&&!['draft','online','submitted','listed','reviewing','pending-launch'].includes(row.publicationStatus)&&!preflightOnly(row);
const categoryUncertain=row=>!!row.nativeCategoryIntent&&row.nativeCategoryIntent.status!=='confirmed';
const uncertain=row=>categoryUncertain(row)||submissionFields.some(name=>row[name]&&row[name].status!=='confirmed'&&!(name==='publishIntent'&&row[name].status==='accepted'&&acceptedPublication(row)))||publicationPending(row);
const unattempted=row=>!submissionFields.some(name=>row[name])&&!row.nativeCategoryIntent&&!row.publicationStatus;
const unwritten=row=>!row.saved&&!row.nativeCategoryIntent&&!submissionFields.some(name=>row[name]);
const claimUncertain=job=>!!job.claimIntent&&job.claimIntent.status!=='confirmed';
const prepared=row=>row.ready===true&&row.saved===true&&!row.issues.length&&row.locationStatus==='located'&&!uncertain(row)&&!acceptedPublication(row);
const rowKey=(goodsId,storeBindingKey)=>JSON.stringify([goodsId,storeBindingKey]);
const sorted=value=>[...value].sort();
const sameSet=(a,b)=>isDeepStrictEqual(sorted(a),sorted(b));
const siteKey=value=>String(value||'').trim().replace(/站$/,'');
const destinationKey=value=>JSON.stringify([value.platform,value.storeName,siteKey(value.site)]);
const requiredFields=job=>job.workflowMode==='required-fields';
const pendingComplete=row=>row.publicationStatus==='draft'&&row.movedToPending===true&&row.saved===true&&row.ready===true&&!row.publishIntent&&!row.published&&!uncertain(row)&&!row.issues.length;
const packageCorrectionFields=new Set(['skuLength','skuWidth','skuHeight','weight']);
const correctable=row=>row.saved===true&&row.saveIntent?.status==='confirmed'&&!!row.saveIntent.payload?.expectedSnapshot&&row.locationStatus==='located'&&editUrl(row.platformEditUrl)&&!row.moveIntent&&!row.publishIntent&&(!row.publicationStatus||preflightOnly(row))&&!row.published;

// Explicit package correction review keeps the saved product identity and all
// non-package facts fixed. Keep array/control shapes, so a missing SKU or field
// cannot disappear merely because its values are allowed to change.
function correctionStableData(snapshot){
  const value=copy(snapshot);
  for(const name of packageCorrectionFields)if(Array.isArray(value.fields?.[name]))value.fields[name]=value.fields[name].map(()=>null);
  for(const item of value.items||[])for(const control of item.controls||[])if(packageCorrectionFields.has(control.name))control.value=null;
  return value;
}

function editUrl(value,common=false){
  try{const u=new URL(value);return u.origin==='https://www.dianxiaomi.com'&&!u.username&&!u.password&&!u.hash&&/^\d{6,32}$/.test(u.searchParams.get('id')||'')&&(common?u.pathname==='/web/productCrawl/edit':/^\/web\/(?!productCrawl\/)[a-zA-Z0-9]+\/edit$/.test(u.pathname));}catch{return false;}
}
function draftIdentity(value){try{const url=new URL(value);return `${url.origin}${url.pathname}?id=${url.searchParams.get('id')}`;}catch{return null;}}

export function createListingWorkflow({directory,configuration={},preferences,templates,freeSourcing,adapter,allocationAdapter,isOtherBusy=()=>false}={}){
  if(typeof directory!=='string'||!directory||!preferences||!templates||!freeSourcing)throw fail('缺少上架联动服务配置');
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'state.json');
  let state;
  try{state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schemaVersion:1,jobs:{},requestAliases:{}};}catch{throw fail('上架任务文件无法读取，未覆盖已有任务',500);}
  if(state?.schemaVersion!==1||!state.jobs||typeof state.jobs!=='object'||Array.isArray(state.jobs))throw fail('上架任务文件格式无效，未覆盖已有任务',500);
  state.requestAliases??={};
  state.categoryMappings??=[];
  state.categoryResolutionMappings??=[];
  let active=null;
  const backend=adapter||{};
  const allocator=allocationAdapter||{};
  // A catalog is a short-lived observation of one account/platform/store. It
  // intentionally does not survive restart or authorize a different store.
  const categoryCatalogs=new Map(),categoryLifetimeMs=15*60*1000;
  const categorySearches=new Map();
  const categoryRanker=configuration.PLANNER_BASE_URL&&configuration.PLANNER_API_KEY&&configuration.PLANNER_MODEL?createCategoryRanker(configuration):undefined;
  function redact(value){
    let result=String(value??'');
    for(const [key,secret] of Object.entries(configuration))if(secretName.test(key)&&typeof secret==='string'&&secret.length>=6)result=result.replaceAll(secret,'[已隐藏]');
    return result;
  }
  function clean(value,depth=0){
    if(depth>18)return '[内容层级过深]';
    if(value===undefined)return null;
    if(value===null||typeof value==='boolean'||typeof value==='number')return value;
    if(typeof value==='string')return redact(value);
    if(Array.isArray(value))return value.map(item=>clean(item,depth+1));
    if(typeof value!=='object')return null;
    return Object.fromEntries(Object.entries(value).filter(([key])=>!secretName.test(key)&&!['__proto__','constructor','prototype'].includes(key)).map(([key,item])=>[key,clean(item,depth+1)]));
  }
  function boundedPagerDiagnostics(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
    const safe=clean(value);return JSON.stringify(safe).length<=16384?safe:{captureError:'分页诊断超过大小限制，未保存'};
  }
  function progressIssue(job,value){
    let result=redact(value),account=job.binding.erpConnection.expectedAccount;
    if(account)result=result.replaceAll(account,'[账号已隐藏]');
    return result.replace(/https?:\/\/[^\s<>"']+/gi,'[链接已隐藏]').replace(/((?:账号|账户|account)\s*[:：=]\s*)[^\s，；。,;]+/gi,'$1[已隐藏]').slice(0,300);
  }
  function save(){const temporary=`${file}.${randomUUID()}.tmp`;try{fs.writeFileSync(temporary,JSON.stringify(state,null,2),{flag:'wx'});fs.renameSync(temporary,file);}catch(error){if(fs.existsSync(temporary))fs.unlinkSync(temporary);throw error;}}
  function getRaw(id){const actual=state.requestAliases[id]||id;if(!Object.hasOwn(state.jobs,actual))throw fail('上架联动任务不存在',404);return state.jobs[actual];}
  function binding(erpKey){
    const erpConnection=preferences.erp(erpKey),browserConfig=preferences.browser(erpConnection.browserKey);
    if((erpConnection.provider||'dianxiaomi')!=='dianxiaomi'||!erpConnection.expectedAccount)throw fail('请绑定店小秘账号显示名后再进行上架联动');
    if(browserConfig.type!=='chrome')throw fail('上架联动目前需要已绑定的谷歌浏览器');
    return copy({erpConnection,browserConfig});
  }
  function checkBinding(job){
    if(!isDeepStrictEqual(binding(job.erpKey),job.binding))throw fail('账号或浏览器绑定已变化，请恢复原绑定再核对原任务',409);
    if(requiredFields(job)){
      const stores=preferences.view?.().collectionStores||[];
      for(const saved of job.destinationSnapshot||[]){const current=stores.find(store=>store.key===saved.key);if(!current||!isDeepStrictEqual(destinationSnapshot(current),saved))throw fail('采集箱店铺绑定已变化，请恢复原绑定再核对原任务',409);}
    }
  }
  function categoryReady(row){const selected=row.categorySelection,category=selected?.category;return !!category?.path?.length&&(!!category.id||selected.resolutionStatus==='resolved'&&!!category.candidateId);}
  function sourceFacts(job,row){return job.sourceRows.find(source=>source.goodsId===row.goodsId)?.sourceFacts||null;}
  function sourceStatus(job,row){
    const facts=sourceFacts(job,row),issues=[];
    if(!facts)issues.push('请补读 Temu 前端分类、规格和直接售价');
    else {
      if(facts.goodsId!==row.goodsId||productIdentity(facts.sourceUrl)!==row.goodsId)issues.push('来源资料与本批商品身份不一致');
      issues.push(...(facts.issues||[]));
    }
    const priceReady=prepared(row)||pendingComplete(row)||row.inspection?.priceCheck?.ready===true;
    const categoryReady=!!facts?.categoryPath?.length;
    return {ready:priceReady&&categoryReady,priceReady,categoryReady,issues,price:copy(facts?.price||null),categoryPath:copy(facts?.categoryPath||[]),selectedVariant:copy(facts?.selectedVariant||null),pricePolicy:'dxm-preserved-price-v1'};
  }
  const categoryScope=(job,row)=>({account:job.binding.erpConnection.expectedAccount,platform:row.platform,storeBindingKey:row.storeBindingKey,site:row.site,mode:row.inspection?.pricingEvidence?.businessMode||''});
  const canPrepareRow=(job,row)=>row.locationStatus==='located'&&editUrl(row.platformEditUrl)&&!prepared(row)&&!submissionFields.some(name=>row[name])&&(!requiredFields(job)||categoryReady(row));
  const canMoveRow=row=>!pendingComplete(row)&&prepared(row)&&!row.publishIntent&&!row.moveIntent&&!row.published;
  function configurationReadiness(job){
    if(!requiredFields(job))return listingTemplateReadiness(job.templateSnapshot);
    const missing=job.rows.filter(row=>!categoryReady(row));
    return {scope:'configuration',ready:missing.length===0,issues:missing.length?[`还有 ${missing.length} 条店铺商品未选择末级分类`]:[]};
  }
  function available(){if(active||isOtherBusy())throw fail('有任务正在运行，请等当前任务结束',409);}
  function publishingSupported(){return typeof backend.publish==='function'&&backend.capabilities?.publish!==false;}
  function nativeCapability(job,kind){
    const flag=kind==='prepare'?'nativePrepare':'nativePending',method=kind==='prepare'?'prepareBatch':'moveToPendingBatch',platforms=backend.capabilities?.[`${flag}Platforms`];
    // Old adapters only implemented SHEIN. A missing platform list must never
    // turn that implementation on for another marketplace.
    return backend.capabilities?.[flag]===true&&typeof backend[method]==='function'&&(platforms===undefined?job.templateSnapshot.platform==='shein':Array.isArray(platforms)&&platforms.includes(job.templateSnapshot.platform));
  }
  function categorySearchSupported(job){const platforms=backend.capabilities?.categorySearchPlatforms;return requiredFields(job)&&typeof backend.searchCategories==='function'&&(platforms===undefined?job.templateSnapshot.platform==='shein':Array.isArray(platforms)&&platforms.includes(job.templateSnapshot.platform));}
  function actions(job){
    if(active===job.id)return ['stop'];
    if(active||isOtherBusy())return [];
    try{checkBinding(job);}catch{return [];}
    if(job.needsReconcile||job.rows.some(uncertain)||claimUncertain(job))return typeof backend.verify==='function'||typeof backend.verifyPublication==='function'||typeof backend.verifyNativeBatchMember==='function'||typeof backend.inspect==='function'?['reconcile']:[];
    const result=[];
    if(requiredFields(job)&&typeof freeSourcing.readSourceFacts==='function'&&job.rows.some(unwritten))result.push('source-facts');
    if(typeof backend.inspect==='function'&&!job.rows.some(row=>row.moveIntent||row.publishIntent||row.publicationStatus))result.push('inspect');
    if(requiredFields(job)&&typeof backend.openNativeBatch==='function'&&backend.capabilities?.nativeOpenPlatforms?.includes(job.templateSnapshot.platform)&&job.rows.some(row=>row.locationStatus==='located'&&unwritten(row)))result.push('native-edit');
    if((requiredFields(job)?typeof allocator.claimDestinations==='function':typeof allocator.claim==='function'&&job.allocationSnapshot)&&!job.claimIntent&&job.rows.some(row=>row.locationStatus==='unclaimed')&&job.rows.every(row=>['located','unclaimed'].includes(row.locationStatus)))result.push('claim');
    if((typeof backend.verify==='function'||typeof backend.verifyPublication==='function'||typeof backend.verifyNativeBatchMember==='function')&&job.rows.some(row=>row.platformEditUrl))result.push('reconcile');
    if(typeof backend.prepare==='function'&&(requiredFields(job)?job.rows.some(row=>canPrepareRow(job,row)&&!row.nativeCategoryIntent):configurationReadiness(job).ready&&job.rows.length&&job.rows.every(row=>row.locationStatus==='located'&&editUrl(row.platformEditUrl))&&job.rows.some(row=>!prepared(row)&&!row.saveIntent&&!row.moveIntent&&!row.publishIntent)))result.push('prepare');
    // The continuous native-batch action is offered only by an adapter that
    // actually implements a native group form. Never disguise a row loop.
    if(requiredFields(job)&&nativeCapability(job,'prepare')&&nativeCapability(job,'pending')&&job.rows.some(row=>canPrepareRow(job,row)||canMoveRow(row)))result.push('process');
    if(job.templateSnapshot.platform==='temu'&&typeof backend.reviewCorrections==='function'&&job.rows.some(correctable)&&!job.rows.some(row=>row.moveIntent||row.publishIntent||row.publicationStatus&&!preflightOnly(row)||row.published))result.push('review-corrections');
    const pending=job.rows.filter(row=>!row.publishIntent&&!row.published&&!acceptedPublication(row));
    if(!requiredFields(job)&&job.completionMode!=='pending'&&publishingSupported()&&pending.length&&pending.every(prepared))result.push('publish');
    const toMove=job.rows.filter(row=>!pendingComplete(row));
    if(typeof backend.moveToPending==='function'&&backend.capabilities?.moveToPending!==false&&toMove.length&&(requiredFields(job)?toMove.some(canMoveRow):toMove.every(canMoveRow)))result.push('pending');
    return result;
  }
  function present(job){
    const totals={products:job.sourceRows.length,stores:job.templateSnapshot.storeBindings.length,rows:job.rows.length,located:0,prepared:0,pending:0,submitted:0,published:0,unclaimed:0,ambiguous:0,failed:0,needsReview:0};
    for(const row of job.rows){if(row.locationStatus==='located')totals.located++;if(prepared(row))totals.prepared++;if(acceptedPublication(row))totals.submitted++;if(row.published)totals.published++;if(row.locationStatus==='unclaimed')totals.unclaimed++;if(row.locationStatus==='ambiguous')totals.ambiguous++;if(row.status==='failed')totals.failed++;if(row.status==='needs-review'||uncertain(row))totals.needsReview++;}
    let bindingIssue=null;try{checkBinding(job);}catch(error){bindingIssue=redact(error.message);}
    totals.pending=job.rows.filter(pendingComplete).length;
    const value=copy(job);if(requiredFields(job)){
      value.fieldPolicy='dxm-preserved-price-v1';
      const nativeReady=nativeCapability(job,'prepare')&&nativeCapability(job,'pending');
      value.nativeBatch={ready:nativeReady,reason:nativeReady?'':'原生批量表单尚未完成适配；当前补全仍按商品分别保存，不会自动改用逐件操作执行原生批量请求'};
      value.categorySearch={supported:categorySearchSupported(job)};
      value.rows=value.rows.map(row=>({...row,category:copy(row.categorySelection?.category||{id:'',label:'',path:[]}),categoryRequired:!categoryReady(row),sourceFactsStatus:sourceStatus(job,row)}));
    }
    return {...value,configurationReadiness:configurationReadiness(job),availableActions:actions(job),bindingIssue,totals};
  }
  function summarize(job){
    if(job.rows.some(uncertain)||claimUncertain(job)||job.needsReconcile)job.status='needs-review';
    else if(job.completionMode==='pending'&&job.rows.length&&job.rows.every(pendingComplete))job.status='pending-ready';
    else if(job.completionMode==='pending'&&job.rows.some(row=>row.published||acceptedPublication(row)))job.status='needs-review';
    else if(job.rows.length&&job.rows.every(row=>row.published))job.status='completed';
    else if(job.rows.length&&job.rows.every(row=>row.published||acceptedPublication(row)))job.status='submitted';
    else if(job.rows.some(acceptedPublication))job.status='partial';
    else if(job.rows.length&&job.rows.every(prepared))job.status='prepared';
    else if(job.rows.some(row=>row.issues.length||['failed','unclaimed','ambiguous','needs-review'].includes(row.status)))job.status=job.rows.some(prepared)?'partial':'needs-review';
    else if(job.rows.length&&job.rows.every(row=>row.locationStatus==='located'))job.status='inspected';
    else job.status='pending';
    job.updatedAt=now();
  }
  for(const job of Object.values(state.jobs)){
    if(!Array.isArray(job.rows)||!Array.isArray(job.sourceRows)||!job.templateSnapshot||!job.binding)throw fail('上架任务记录不完整，未覆盖已有任务',500);
    if(job.claimIntent?.status==='pending'){job.claimIntent.status='unknown';job.claimIntent.interruptedAt=now();}
    for(const row of job.rows){
      row.issues??=[];
      for(const name of submissionFields)if(row[name]?.status==='pending'){row[name].status='unknown';row[name].interruptedAt=now();}
      if(row.nativeCategoryIntent?.status==='pending'){row.nativeCategoryIntent.status='unknown';row.nativeCategoryIntent.interruptedAt=now();}
      if(uncertain(row)){row.status='needs-review';row.issues=['上次保存、移动或发布结果需要只读核对；未重新提交'];}
      else if(['preparing','publishing'].includes(row.status))row.status=row.saved?'prepared':'located';
    }
    for(const operation of job.batchOperations||[]){if(operation.categoryIntent?.status==='pending'){operation.categoryIntent.status='unknown';operation.categoryIntent.interruptedAt=now();}if(['planning','pending'].includes(operation.status)){operation.status=operation.status==='pending'||operation.categoryIntent?.status==='unknown'?'unknown':'interrupted';operation.interruptedAt=now();}}
    if(job.status!=='completed'){job.needsReconcile=true;job.status='needs-review';job.message='工作台已重启，原配置和提交记录已保留；先只读核对后继续';}
    if(job.progress?.active)job.progress={...job.progress,active:false,interruptedAt:now()};
    job.action=null;job.stopRequested=false;
  }
  if(Object.keys(state.jobs).length)save();

  function sameRequest(job,payload){return job.freeJobId===payload.freeJobId&&job.templateId===payload.templateId&&(payload.templateVersion===undefined||job.templateVersion===payload.templateVersion)&&sameSet(job.goodsIds,payload.goodsIds)&&(payload.storeKeys===undefined||sameSet(job.storeKeys,payload.storeKeys));}
  function destinationSnapshot(store){return {key:store.key,erpKey:store.erpKey,platform:store.platform,storeName:store.storeName,storeId:store.storeId||'',site:store.site||''};}
  function createRequiredFields(payload){
    const sourceJobId=payload.sourceJobId||payload.freeJobId;
    if(!idOK(payload.requestId)||!idOK(sourceJobId)||!Array.isArray(payload.goodsIds)||!payload.goodsIds.length||payload.goodsIds.length>30||payload.goodsIds.some(id=>typeof id!=='string'||!/^\d{6,32}$/.test(id))||new Set(payload.goodsIds).size!==payload.goodsIds.length)throw fail('请选择本次已采集商品和有效任务编号');
    if(!Array.isArray(payload.destinationKeys)||!payload.destinationKeys.length||payload.destinationKeys.length>500||payload.destinationKeys.some(key=>!idOK(key))||new Set(payload.destinationKeys).size!==payload.destinationKeys.length)throw fail('请选择本次目标采集箱店铺');
    const equivalent=job=>requiredFields(job)&&job.freeJobId===sourceJobId&&sameSet(job.goodsIds,payload.goodsIds)&&sameSet(job.storeKeys,payload.destinationKeys);
    if(Object.hasOwn(state.jobs,payload.requestId)||Object.hasOwn(state.requestAliases,payload.requestId)){const old=getRaw(payload.requestId);if(!equivalent(old))throw fail('任务编号已用于其他商品或采集箱店铺',409);return present(old);}
    const sourceJob=freeSourcing.view().jobs.find(job=>job.id===sourceJobId);if(!sourceJob)throw fail('来源采集任务不存在',404);
    const configured=preferences.view?.().collectionStores||[],destinations=payload.destinationKeys.map(key=>{
      const matches=configured.filter(store=>store.key===key);if(matches.length!==1)throw fail('目标采集箱店铺不存在或不唯一');
      const store=destinationSnapshot(matches[0]);
      if(!['temu','tiktok','shein'].includes(store.platform)||!store.storeName||store.erpKey!==sourceJob.erpKey||store.erpKey!==sourceJob.binding?.erpConnection?.key)throw fail('采集箱店铺与采集批次不属于同一ERP账号或平台不受支持');
      if(store.platform==='temu'&&!store.site.trim())throw fail('Temu采集箱店铺必须绑定真实站点');
      return store;
    });
    if(new Set(destinations.map(store=>JSON.stringify([store.platform,siteKey(store.site)]))).size!==1)throw fail('一次补全任务只能处理同一平台和站点的店铺，请分组创建');
    if(new Set(destinations.map(destinationKey)).size!==destinations.length)throw fail('本次采集箱店铺目的地重复');
    const currentBinding=binding(sourceJob.erpKey);if(!isDeepStrictEqual(currentBinding,sourceJob.binding))throw fail('采集时的账号或浏览器绑定已变化，请先恢复原绑定',409);
    const sourceRows=payload.goodsIds.map(goodsId=>{
      const matches=sourceJob.rows.filter(row=>row.goodsId===goodsId);if(matches.length!==1||matches[0].status!=='verified')throw fail(`商品 ${goodsId} 尚未唯一核实进入通用采集箱`);
      const source=matches[0],collectionEditUrl=source.evidence?.editUrl;
      if(productIdentity(source.sourceUrl)!==goodsId||source.evidence?.sourceUrl&&productIdentity(source.evidence.sourceUrl)!==goodsId||!editUrl(collectionEditUrl,true))throw fail(`商品 ${goodsId} 缺少可靠的来源链接或采集记录地址`);
      return {goodsId,sourceUrl:source.sourceUrl,title:String(source.title||source.evidence?.title||''),collectionEditUrl,collectionEvidence:clean(source.evidence),...(source.sourceFacts?{sourceFacts:normalizeTemuSourceFacts(source.sourceFacts,{goodsId,sourceUrl:source.sourceUrl})}:{})};
    });
    if(new Set(sourceRows.map(row=>row.collectionEditUrl)).size!==sourceRows.length)throw fail('不同来源商品不能指向同一条通用采集记录');
    const previous=Object.values(state.jobs).find(equivalent);if(previous){state.requestAliases[payload.requestId]=previous.id;save();return present(previous);}
    const createdAt=now(),platform=destinations[0].platform,site=destinations[0].site;
    const storeBindings=destinations.map(store=>({key:store.key,storeKey:store.key,storeId:store.storeId,storeName:store.storeName,site:store.site,warehouse:'',warehouseId:'',shippingTemplate:'',shippingTemplateId:'',dispatch:'',dispatchId:'',overrides:{}}));
    const templateSnapshot={id:`required-${payload.requestId}`,version:1,name:'本批商品资料',erpKey:sourceJob.erpKey,platform,site,productType:'采集商品',workflowMode:'required-fields',completionMode:'pending',category:{id:'',label:'',path:[]},rules:{autoFillRequired:true},storeBindings,snapshotAt:createdAt};
    const job={id:payload.requestId,workflowMode:'required-fields',completionMode:'pending',sourceJobId,freeJobId:sourceJobId,keyword:sourceJob.keyword||'',erpKey:sourceJob.erpKey,templateId:templateSnapshot.id,templateVersion:1,templateSnapshot,destinationSnapshot:copy(destinations),goodsIds:copy(payload.goodsIds),storeKeys:copy(payload.destinationKeys),sourceRows,binding:currentBinding,tabs:{},rows:[],status:'pending',createdAt,updatedAt:createdAt,action:null,needsReconcile:false,stopRequested:false,message:'已保存本批商品和采集箱店铺，请先核对商品，再选择正确分类'};
    job.rows=sourceRows.flatMap(source=>storeBindings.map(store=>({id:rowKey(source.goodsId,store.key),...copy(source),storeBindingKey:store.key,storeName:store.storeName,storeId:store.storeId,site:store.site,platform,locationStatus:'pending',status:'pending',platformEditUrl:null,ready:false,saved:false,published:false,issues:[]})));
    state.jobs[job.id]=job;save();return present(job);
  }
  function create(payload){
    if(payload&&(payload.workflowMode==='required-fields'||payload.sourceJobId||payload.destinationKeys))return createRequiredFields(payload);
    if(!payload||!idOK(payload.requestId)||!idOK(payload.freeJobId)||!idOK(payload.templateId)||!Array.isArray(payload.goodsIds)||!payload.goodsIds.length||payload.goodsIds.length>30||payload.goodsIds.some(id=>typeof id!=='string'||!/^\d{6,32}$/.test(id))||new Set(payload.goodsIds).size!==payload.goodsIds.length)throw fail('请选择本次采集的商品、固定上架模板和有效任务编号');
    if(payload.templateVersion!==undefined&&(!Number.isSafeInteger(payload.templateVersion)||payload.templateVersion<1))throw fail('模板版本无效');
    if(payload.storeKeys!==undefined&&(!Array.isArray(payload.storeKeys)||!payload.storeKeys.length||payload.storeKeys.some(id=>!idOK(id))||new Set(payload.storeKeys).size!==payload.storeKeys.length))throw fail('本次店铺选择无效');
    if(Object.hasOwn(state.jobs,payload.requestId)||Object.hasOwn(state.requestAliases,payload.requestId)){
      const old=getRaw(payload.requestId);if(!sameRequest(old,payload))throw fail('任务编号已用于其他商品或模板，请核对原任务',409);return present(old);
    }
    const sourceJob=freeSourcing.view().jobs.find(job=>job.id===payload.freeJobId);
    if(!sourceJob)throw fail('来源采集任务不存在',404);
    const templateSnapshot=templates.snapshot(payload.templateId,{version:payload.templateVersion,storeKeys:payload.storeKeys});
    if(!templateSnapshot.storeBindings.length)throw fail('请先在上架模板中绑定至少一家店铺');
    if(templateSnapshot.erpKey!==sourceJob.erpKey||templateSnapshot.erpKey!==sourceJob.binding?.erpConnection?.key)throw fail('上架模板与采集批次不属于同一ERP账号');
    const currentBinding=binding(templateSnapshot.erpKey);
    if(!isDeepStrictEqual(currentBinding,sourceJob.binding))throw fail('采集时的账号或浏览器绑定已变化，请先恢复原绑定',409);
    const sourceRows=payload.goodsIds.map(goodsId=>{
      const matches=sourceJob.rows.filter(row=>row.goodsId===goodsId);
      if(matches.length!==1||matches[0].status!=='verified')throw fail(`商品 ${goodsId} 尚未唯一核实进入通用采集箱`);
      const source=matches[0],collectionEditUrl=source.evidence?.editUrl;
      if(productIdentity(source.sourceUrl)!==goodsId||source.evidence?.sourceUrl&&productIdentity(source.evidence.sourceUrl)!==goodsId||!editUrl(collectionEditUrl,true))throw fail(`商品 ${goodsId} 缺少可靠的来源链接或采集记录地址`);
      return {goodsId,sourceUrl:source.sourceUrl,title:String(source.title||source.evidence?.title||''),collectionEditUrl,collectionEvidence:clean(source.evidence)};
    });
    if(new Set(sourceRows.map(row=>row.collectionEditUrl)).size!==sourceRows.length)throw fail('不同来源商品不能指向同一条通用采集记录');
    const storeKeys=templateSnapshot.storeBindings.map(store=>store.key);
    const previous=Object.values(state.jobs).find(job=>job.freeJobId===payload.freeJobId&&job.templateId===payload.templateId&&job.templateVersion===templateSnapshot.version&&sameSet(job.goodsIds,payload.goodsIds)&&sameSet(job.storeKeys,storeKeys));
    if(previous){state.requestAliases[payload.requestId]=previous.id;save();return present(previous);}
    const createdAt=now(),job={id:payload.requestId,freeJobId:sourceJob.id,keyword:sourceJob.keyword||'',erpKey:templateSnapshot.erpKey,templateId:templateSnapshot.id,templateVersion:templateSnapshot.version,templateSnapshot:copy(templateSnapshot),goodsIds:copy(payload.goodsIds),storeKeys,sourceRows,binding:currentBinding,tabs:{},rows:[],status:'pending',createdAt,updatedAt:createdAt,action:null,needsReconcile:false,stopRequested:false,message:'已保存本次商品和固定模板，下一步核对各店采集箱记录'};
    job.rows=sourceRows.flatMap(source=>templateSnapshot.storeBindings.map(store=>({id:rowKey(source.goodsId,store.key),...copy(source),storeBindingKey:store.key,storeName:store.storeName,storeId:store.storeId||'',site:store.site,platform:templateSnapshot.platform,locationStatus:'pending',status:'pending',platformEditUrl:null,ready:false,saved:false,published:false,issues:[]})));
    state.jobs[job.id]=job;save();return present(job);
  }
  function progress(job,event){
    if(active!==job.id||!job.action)return;
    if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.phase!=='string'||!['scan','match','inspect','prepare','verify','claim','publish','pending','review-corrections','native-select'].includes(event.phase))throw fail('执行器返回的进度阶段无效');
    if(event.goodsId&&!job.goodsIds.includes(event.goodsId)||event.storeBindingKey&&!job.storeKeys.includes(event.storeBindingKey))throw fail('执行器进度不属于本次商品或店铺');
    const value={phase:event.phase,active:true,updatedAt:now()};
    if(typeof event.stage==='string')value.stage=redact(event.stage).slice(0,80);
    for(const key of ['page','scanned','total','targets','matched','rowIndex','rowCount','inspected','selected'])if(Number.isSafeInteger(event[key])&&event[key]>=0)value[key]=event[key];
    for(const key of ['goodsId','storeBindingKey'])if(event[key])value[key]=event[key];
    if(event.counts&&typeof event.counts==='object'&&!Array.isArray(event.counts))value.counts=Object.fromEntries(['sources','stores','candidates','located','ambiguous','unclaimed','needsReview'].filter(key=>Number.isSafeInteger(event.counts[key])&&event.counts[key]>=0).map(key=>[key,event.counts[key]]));
    if(event.result&&typeof event.result==='object'&&!Array.isArray(event.result)){
      const result={};
      if(typeof event.result.status==='string')result.status=progressIssue(job,event.result.status).slice(0,40);
      if(typeof event.result.draftId==='string'&&/^\d{6,32}$/.test(event.result.draftId))result.draftId=event.result.draftId;
      for(const key of ['candidateCount','issueCount'])if(Number.isSafeInteger(event.result[key])&&event.result[key]>=0)result[key]=event.result[key];
      if(Array.isArray(event.result.issues))result.issues=event.result.issues.slice(0,10).filter(issue=>typeof issue==='string').map(issue=>progressIssue(job,issue));
      value.result=result;
    }
    if(job.progress?.lastCompleted)value.lastCompleted=copy(job.progress.lastCompleted);
    if(value.stage==='row-complete'&&value.result)value.lastCompleted=Object.fromEntries(['phase','rowIndex','rowCount','goodsId','storeBindingKey','updatedAt','result'].filter(key=>value[key]!==undefined).map(key=>[key,copy(value[key])]));
    value.message=typeof event.message==='string'&&event.message.trim()?redact(event.message.trim()).slice(0,600):event.phase==='native-select'?`正在店小秘原生页面选择本批商品：${value.selected||0}/${value.total||0}`:event.phase==='scan'?`正在扫描采集箱第 ${value.page||1} 页，已读取 ${value.scanned||0} 条记录`:event.phase==='match'?`已匹配 ${value.matched||0} 个目标，正在逐件核对`:`正在核对第 ${value.rowIndex||value.inspected||0}/${value.rowCount||value.targets||job.rows.length} 个目标`;
    job.progress=value;if(!job.stopRequested)job.message=value.message;job.updatedAt=value.updatedAt;save();
  }
  function adapterArgs(job,extra={}){
    const templateSnapshot=copy(job.templateSnapshot);
    if(requiredFields(job)&&extra.row?.categorySelection)templateSnapshot.category=copy(extra.row.categorySelection.category);
    return {...copy(job.binding),workflowMode:job.workflowMode,completionMode:job.completionMode,templateSnapshot,tabs:copy(job.tabs),resolvedTargets:job.rows.filter(row=>row.resolvedTarget).map(row=>({goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,...copy(row.resolvedTarget)})),isStopped:()=>job.stopRequested===true,onProgress:event=>progress(job,event),onTarget:(kind,targetId)=>{if(typeof kind!=='string'||kind.length>100||['__proto__','constructor','prototype'].includes(kind)||typeof targetId!=='string'||targetId.length>200)throw fail('执行器返回的标签页编号无效');job.tabs[kind]=targetId;save();},...extra,...(requiredFields(job)&&extra.row?{sourceFacts:copy(sourceFacts(job,extra.row)),pricePolicy:{mode:'preserve-dxm-converted'}}:{})};
  }
  function readSources(id){
    available();const job=getRaw(id);checkBinding(job);
    if(!actions(job).includes('source-facts'))throw fail('请先核对原任务；只有尚未保存的商品可补读来源资料',409);
    const goodsIds=[...new Set(job.rows.filter(unwritten).map(row=>row.goodsId))];
    // freeSourcing acquires its own browser lock synchronously before its first
    // await. Acquire our lock afterwards, avoiding the mutual isOtherBusy gate.
    const reading=freeSourcing.readSourceFacts(job.freeJobId,{goodsIds});
    active=job.id;job.action='source-facts';job.stopRequested=false;job.message='正在只读补读 Temu 前端分类、规格和售价';job.updatedAt=now();save();
    void (async()=>{
      try{
        const sourceJob=await reading;checkBinding(job);
        if(sourceJob.id!==job.freeJobId||!isDeepStrictEqual(sourceJob.binding,job.binding))throw fail('来源资料读取返回了其他账号或批次');
        for(const goodsId of goodsIds){
          const matches=sourceJob.rows.filter(row=>row.goodsId===goodsId&&row.status==='verified');
          const source=job.sourceRows.find(row=>row.goodsId===goodsId);
          if(matches.length!==1||matches[0].sourceUrl!==source.sourceUrl)throw fail('来源资料的商品范围已变化');
          const previousPath=source.sourceFacts?.categoryPath;
          if(matches[0].sourceFacts)source.sourceFacts=clean(normalizeTemuSourceFacts(matches[0].sourceFacts,{goodsId,sourceUrl:source.sourceUrl}));
          for(const row of job.rows.filter(row=>row.goodsId===goodsId&&unwritten(row))){
            delete row.sourceFacts;
            if(previousPath?.length&&!isDeepStrictEqual(previousPath,source.sourceFacts?.categoryPath)&&row.categorySelection){row.categorySelectionHistory??=[];row.categorySelectionHistory.push(copy(row.categorySelection));delete row.categorySelection;row.issues=['重新读取的来源分类与原分类不同，请重新确认目标分类'];}
          }
        }
        job.sourceFactsRead=clean(sourceJob.sourceFactsRead);summarize(job);
        job.message=job.sourceRows.every(source=>source.sourceFacts?.categoryPath?.length)?'来源分类已补读；价格保留店小秘目标店铺已换算的值，不再二次换算':'已保留读到的来源资料；缺少来源对照不影响保留店小秘已有价格';
      }catch(error){job.status='needs-review';job.message=redact(error.message);job.error=job.message;}
      finally{job.action=null;job.updatedAt=now();save();active=null;}
    })();
    return present(job);
  }
  function openNative(id,{storeBindingKey}={}){
    available();const job=getRaw(id);checkBinding(job);
    if(!actions(job).includes('native-edit'))throw fail('当前任务没有可打开的店小秘原生批量编辑范围',409);
    const stores=job.templateSnapshot.storeBindings.filter(store=>job.rows.some(row=>row.storeBindingKey===store.key&&row.locationStatus==='located'&&unwritten(row)));
    const store=storeBindingKey?stores.find(store=>store.key===storeBindingKey):stores.length===1?stores[0]:null;
    if(!store)throw fail('请选择本次要打开原生批量编辑的一个店铺');
    const rows=job.rows.filter(row=>row.storeBindingKey===store.key&&row.locationStatus==='located'&&unwritten(row));
    const earlier=[job.nativeEdit,...(job.nativeEditHistory||[])].find(item=>item?.intent&&item.storeBindingKey===store.key&&item.memberIds?.some(id=>rows.some(row=>row.id===id)));
    if(earlier){
      job.message='本店已记录原生批量打开动作，请在保留的店小秘页面核对；未重复打开或提交';job.updatedAt=now();save();return present(job);
    }
    if(job.nativeEdit?.intent){job.nativeEditHistory??=[];job.nativeEditHistory.push(copy(job.nativeEdit));}
    delete job.nativeEdit;
    active=job.id;job.action='native-edit';job.stopRequested=false;job.message='正在限定本批范围并打开店小秘原生批量编辑；尚未保存商品';save();
    void(async()=>{
      try{
        const result=await backend.openNativeBatch(adapterArgs(job,{rows:copy(rows),storeBinding:copy(store),requestId:randomUUID(),beforeOpen:value=>{checkBinding(job);if(job.stopRequested)throw fail('原生批量打开已暂停');job.nativeEdit={storeBindingKey:store.key,memberIds:rows.map(row=>row.id),openedAt:now(),intent:clean(value),status:'opening'};save();}}));
        checkBinding(job);job.nativeEdit={...(job.nativeEdit||{}),storeBindingKey:store.key,memberIds:rows.map(row=>row.id),result:clean(result),status:result.status||'needs-review',checkedAt:now()};
        // Opening a form is not a save receipt. Inspect must establish the
        // actual saved data if the user later edits it outside the workbench.
        job.message=result.message||result.issues?.join('；')||result.blockers?.map(item=>item.message).filter(Boolean).join('；')||(result.status==='blocked'?'原生批量入口尚未打开，请核对本批范围':'原生批量入口已检查；尚未自动填写、保存或移入待发布');
      }catch(error){job.message=redact(error.message);job.error=job.message;}
      finally{job.action=null;job.updatedAt=now();if(job.progress?.phase==='native-select')job.progress={...job.progress,active:false,finishedAt:job.updatedAt};save();active=null;}
    })();
    return present(job);
  }
  function categoryRow(job,goodsId,storeBindingKey){
    const row=job.rows.find(item=>item.goodsId===goodsId&&item.storeBindingKey===storeBindingKey);
    if(!requiredFields(job)||!row)throw fail('分类选择不属于本次补全任务');
    if(row.locationStatus!=='located'||!editUrl(row.platformEditUrl))throw fail('请先核对目标店铺采集箱中的商品');
    if(job.needsReconcile||claimUncertain(job)||submissionFields.some(name=>row[name])||row.nativeCategoryIntent||row.saved||row.published)throw fail('商品已有提交记录或需要核对，不能重新选择分类',409);
    return row;
  }
  function categoryProduct(job,row,{productType,usage}={}){
    const sourcePath=sourceFacts(job,row)?.categoryPath||[],confirmed=row.productTypeConfirmation;
    const type=productType===undefined?confirmed?.productType||'':productType;
    if(typeof type!=='string'||type.length>160||usage!==undefined&&(typeof usage!=='string'||usage.length>1200))throw fail('具体商品类型或用途格式无效');
    const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    return {id:row.id,title:row.title||row.goodsId,usage:usage===undefined?row.categoryProductUsage||'':usage,sourcePath:copy(sourcePath),productType:normalize(type),productTypeConfirmed:!!confirmed&&Number.isFinite(Date.parse(confirmed.confirmedAt))&&normalize(confirmed.productType)===normalize(type)&&isDeepStrictEqual(confirmed.sourcePath,sourcePath)};
  }
  const categorySearchScope=(job,row)=>({jobId:job.id,...categoryScope(job,row)});
  const categoryProductIdentity=(job,row)=>({id:row.id,draftId:row.draftId,sourceUrl:row.sourceUrl,title:row.title,sourcePath:copy(sourceFacts(job,row)?.categoryPath||[])});
  function applyCategoryResolution(job,row,result,catalog,catalogId,product,searchQuery){
    if(result.status!=='resolved'||!result.category)throw fail('分类尚未确认，未应用到商品');
    if(row.categorySelection){row.categorySelectionHistory??=[];row.categorySelectionHistory.push(copy(row.categorySelection));}
    row.categorySelection={category:copy(result.category),resolutionStatus:'resolved',resolutionMethod:result.method,catalogId,catalogDigest:catalog.digest,searchQuery,selectedAt:now(),checkedAt:catalog.observedAt,platform:catalog.scope.platform,storeBindingKey:catalog.scope.storeBindingKey,account:catalog.scope.account};
    row.categoryResolution=clean({...result,catalogId,product,checkedAt:now()});row.ready=false;row.issues=[];
    if(product.productTypeConfirmed)row.productTypeConfirmation={productType:product.productType,sourcePath:copy(product.sourcePath),confirmedAt:now()};
    if(product.usage)row.categoryProductUsage=product.usage;
    if(result.mapping){state.categoryResolutionMappings=state.categoryResolutionMappings.filter(mapping=>mapping.id!==result.mapping.id);state.categoryResolutionMappings.push(copy(result.mapping));}
  }
  async function searchCategories(id,{goodsId,storeBindingKey,query,productType,usage}={}){
    available();const job=getRaw(id);checkBinding(job);const row=categoryRow(job,goodsId,storeBindingKey);
    if(!categorySearchSupported(job))throw fail('此平台尚未接入当前店铺的分类搜索');
    const search=query===undefined?String(row.title||'').slice(0,160):query;
    if(typeof search!=='string'||!search.trim()||search.length>160)throw fail('请输入1至160字的商品分类搜索词');
    const product=categoryProduct(job,row,{productType,usage}),scope=categorySearchScope(job,row),identity=categoryProductIdentity(job,row),storeBinding=job.templateSnapshot.storeBindings.find(store=>store.key===storeBindingKey);
    active=job.id;job.action='search-categories';job.stopRequested=false;job.error=null;job.message='正在读取当前店铺的真实分类候选';save();
    try{
      const result=await backend.searchCategories(adapterArgs(job,{row:copy(row),storeBinding:copy(storeBinding),query:search.trim()}));checkBinding(job);
      if(job.stopRequested)throw fail('已暂停分类搜索，未应用分类');
      if(result?.platform!==scope.platform||result?.account!==scope.account||result?.storeBindingKey!==storeBindingKey||result?.query!==search.trim()||result?.mode!==undefined&&result.mode!==scope.mode||result?.site!==undefined&&siteKey(result.site)!==siteKey(scope.site))throw fail('搜索候选的账号、平台、店铺或查询条件不一致');
      if(!isDeepStrictEqual(identity,categoryProductIdentity(job,row)))throw fail('分类搜索期间商品身份或来源分类已变化');
      const catalog=createCategoryCandidateCatalog({scope:{...scope,...(result.catalogKey?{catalogKey:result.catalogKey}:{})},productId:row.id,candidates:result.candidates,observedAt:result.observedAt||now(),...(result.expiresAt?{expiresAt:result.expiresAt}:{})});
      const resolution=await resolveListingCategory({product,catalog,scope:catalog.scope,mappings:state.categoryResolutionMappings,ranker:categoryRanker});checkBinding(job);
      if(job.stopRequested)throw fail('已暂停分类候选处理，未应用分类');
      validateCategoryCandidateCatalog(catalog,{scope:catalog.scope,productId:row.id});
      const catalogId=randomUUID();for(const [key,value] of categorySearches)if(Date.parse(value.catalog.expiresAt)<=Date.now()||value.catalog.scope.jobId===job.id&&value.catalog.productId===row.id)categorySearches.delete(key);
      categorySearches.set(catalogId,{catalogId,catalog,query:search.trim(),product:copy(product),identity,binding:copy(job.binding)});
      row.categoryResolution=clean({...resolution,catalogId,product,checkedAt:now()});
      if(resolution.status==='resolved')applyCategoryResolution(job,row,resolution,catalog,catalogId,product,search.trim());
      summarize(job);job.message=resolution.reason;save();
      return {catalogId,catalogDigest:catalog.digest,goodsId,storeBindingKey,scope:copy(catalog.scope),product:copy(product),query:search.trim(),candidates:copy(catalog.candidates),resolution:copy(resolution),observedAt:catalog.observedAt,expiresAt:catalog.expiresAt};
    }catch(error){job.message=redact(error.message);job.error=job.message;save();throw error;}
    finally{job.action=null;active=null;save();}
  }
  function resolveCategories(id,{catalogId,catalogDigest,candidateId,goodsIds,storeBindingKey,productType,confirmProductType=false}={}){
    available();const job=getRaw(id);checkBinding(job);
    const entry=categorySearches.get(catalogId);
    if(!entry||entry.catalog.scope.jobId!==job.id||entry.catalog.scope.storeBindingKey!==storeBindingKey||!isDeepStrictEqual(entry.binding,job.binding))throw fail('分类搜索记录不存在、已过期或不属于本次店铺，请重新搜索',409);
    if(!Array.isArray(goodsIds)||!goodsIds.length||goodsIds.length>30||new Set(goodsIds).size!==goodsIds.length)throw fail('请选择本批待确认分类的商品');
    const rows=goodsIds.map(goodsId=>categoryRow(job,goodsId,storeBindingKey)),anchor=rows.find(row=>row.id===entry.catalog.productId);
    if(!anchor||!isDeepStrictEqual(entry.identity,categoryProductIdentity(job,anchor)))throw fail('原搜索商品不在本次范围中或资料已经变化，请重新搜索',409);
    const currentScope={...categorySearchScope(job,anchor),catalogKey:entry.catalog.scope.catalogKey};
    const catalog=validateCategoryCandidateCatalog(entry.catalog,{scope:currentScope,productId:anchor.id});
    if(catalogDigest!==catalog.digest)throw fail('分类候选已变化，请重新搜索并确认',409);
    if(typeof confirmProductType!=='boolean'||productType!==undefined&&(typeof productType!=='string'||!productType.trim()||productType.length>160))throw fail('具体商品类型确认格式无效');
    const selectedType=productType===undefined?entry.product.productType:productType.trim();
    if(confirmProductType&&!selectedType)throw fail('请填写要确认的具体商品类型');
    const productFor=row=>{const product=categoryProduct(job,row,{productType:selectedType,usage:row===anchor?entry.product.usage:undefined});if(confirmProductType)product.productTypeConfirmed=true;return product;};
    const products=rows.map(productFor),anchorProduct=products[rows.indexOf(anchor)];
    if(rows.length>1&&(products.some(product=>!product.productTypeConfirmed||!product.productType||!product.sourcePath.length)||products.some(product=>product.productType!==anchorProduct.productType||!isDeepStrictEqual(product.sourcePath,anchorProduct.sourcePath))))throw fail('批量确认需要相同且已确认的具体商品类型和完整来源分类；未知或不同商品请分别确认');
    // Validate every member and confirmation before changing any job row.
    const resolutions=rows.map((row,index)=>{
      if(!isDeepStrictEqual({...categorySearchScope(job,row),catalogKey:catalog.scope.catalogKey},currentScope))throw fail('批量分类不能跨平台、店铺、站点或经营模式');
      const memberCatalog=row===anchor?catalog:createCategoryCandidateCatalog({...catalog,productId:row.id});
      return {row,product:products[index],catalog:memberCatalog,result:confirmListingCategory({catalog:memberCatalog,catalogDigest:memberCatalog.digest,candidateId,product:products[index],scope:memberCatalog.scope})};
    });
    for(const item of resolutions)applyCategoryResolution(job,item.row,item.result,item.catalog,catalogId,item.product,entry.query);
    categorySearches.delete(catalogId);summarize(job);job.message=`已确认 ${rows.length} 件商品的完整目标分类，可继续原生批量处理`;save();return present(job);
  }
  async function readCategories(id,{goodsId,storeBindingKey,path:categoryPath=[]}={}){
    available();const job=getRaw(id);checkBinding(job);const row=categoryRow(job,goodsId,storeBindingKey);
    if(typeof backend.readCategories!=='function')throw fail('该平台尚未接入分类目录读取');
    if(!Array.isArray(categoryPath)||categoryPath.length>16||categoryPath.some(label=>typeof label!=='string'||!label.trim()||label.length>240))throw fail('分类路径无效');
    const valid=catalog=>catalog.jobId===job.id&&catalog.storeBindingKey===storeBindingKey&&catalog.expiresAt>Date.now()&&isDeepStrictEqual(catalog.binding,job.binding);
    if(categoryPath.length&&![...categoryCatalogs.values()].some(catalog=>valid(catalog)&&catalog.options.some(option=>option.leaf===false&&isDeepStrictEqual(option.path,categoryPath))))throw fail('分类路径不在刚读取的目录中，请从根分类重新选择',409);
    const storeBinding=job.templateSnapshot.storeBindings.find(store=>store.key===storeBindingKey);
    active=job.id;job.action='read-categories';job.stopRequested=false;
    try{
      const result=await backend.readCategories(adapterArgs(job,{row:copy(row),storeBinding:copy(storeBinding),path:copy(categoryPath)}));checkBinding(job);
      if(job.stopRequested)throw fail('已暂停分类读取');
      if(result?.platform!==job.templateSnapshot.platform||result?.account!==job.binding.erpConnection.expectedAccount||result?.storeBindingKey!==storeBindingKey||!isDeepStrictEqual(result?.path,categoryPath))throw fail('分类目录的账号、平台、店铺或路径与本次任务不一致');
      if(!Array.isArray(result.options)||result.options.length>5000)throw fail('分类目录结果无效');
      const options=result.options.map(option=>{
        if(!option||typeof option.id!=='string'||!option.id.trim()||option.id.length>100||typeof option.label!=='string'||!option.label.trim()||option.label.length>240||typeof option.leaf!=='boolean'||!Array.isArray(option.path)||option.path.length!==categoryPath.length+1||!isDeepStrictEqual(option.path.slice(0,-1),categoryPath)||option.path.at(-1)!==option.label)throw fail('分类目录缺少真实编号、完整路径或末级标记');
        return {id:option.id,label:option.label,path:copy(option.path),leaf:option.leaf};
      });
      if(new Set(options.map(option=>option.id)).size!==options.length||new Set(options.map(option=>JSON.stringify(option.path))).size!==options.length)throw fail('分类目录存在重复编号或路径');
      for(const [key,catalog] of categoryCatalogs)if(catalog.expiresAt<=Date.now()||catalog.jobId===job.id&&catalog.storeBindingKey===storeBindingKey&&isDeepStrictEqual(catalog.path.slice(0,categoryPath.length),categoryPath))categoryCatalogs.delete(key);
      const catalogId=randomUUID(),checkedAt=now(),expiresAt=Date.now()+categoryLifetimeMs,catalog={catalogId,jobId:job.id,goodsId,storeBindingKey,platform:result.platform,account:result.account,path:copy(categoryPath),options,checkedAt,expiresAt,binding:copy(job.binding)};
      categoryCatalogs.set(catalogId,catalog);
      const suggestion=suggestListingCategory({sourceFacts:sourceFacts(job,row),scope:categoryScope(job,row),options,mappings:state.categoryMappings});
      return {catalogId,goodsId,storeBindingKey,platform:result.platform,path:copy(categoryPath),options:copy(options),suggestion,checkedAt,expiresAt:new Date(expiresAt).toISOString()};
    }finally{job.action=null;active=null;save();}
  }
  function selectCategories(id,{goodsIds,storeBindingKeys,category,catalogId}={}){
    available();const job=getRaw(id);checkBinding(job);
    if(!Array.isArray(goodsIds)||!goodsIds.length||new Set(goodsIds).size!==goodsIds.length||!Array.isArray(storeBindingKeys)||storeBindingKeys.length!==1||!category||typeof category.id!=='string'||typeof category.label!=='string'||!Array.isArray(category.path))throw fail('请选择商品、一个已读取分类的店铺和末级分类');
    const rows=goodsIds.map(goodsId=>categoryRow(job,goodsId,storeBindingKeys[0]));
    if(rows.length>1){const paths=rows.map(row=>sourceFacts(job,row)?.categoryPath);if(paths.some(path=>!path?.length)||paths.some(path=>!isDeepStrictEqual(path,paths[0])))throw fail('只能将分类应用到同店、同一来源完整分类的商品；未知分类请逐件确认');}
    const token=catalogId||category.catalogId;
    const candidates=[...categoryCatalogs.values()].filter(catalog=>(!token||catalog.catalogId===token)&&catalog.jobId===job.id&&catalog.storeBindingKey===storeBindingKeys[0]&&catalog.platform===job.templateSnapshot.platform&&catalog.account===job.binding.erpConnection.expectedAccount&&catalog.expiresAt>Date.now()&&isDeepStrictEqual(catalog.binding,job.binding)&&catalog.options.some(option=>option.leaf&&option.id===category.id&&option.label===category.label&&isDeepStrictEqual(option.path,category.path)));
    if(candidates.length!==1)throw fail('分类不属于刚读取的末级目录，或目录已过期，请重新读取后选择',409);
    if(rows.length>1){const products=rows.map(row=>categoryProduct(job,row));if(products.some(product=>!product.productTypeConfirmed||!product.productType)||products.some(product=>product.productType!==products[0].productType)||rows.some(row=>!isDeepStrictEqual(categoryScope(job,row),categoryScope(job,rows[0]))))throw fail('批量分类需要相同且已确认的具体商品类型、完整来源分类和店铺经营模式；请先确认具体类型或逐件选择');}
    const catalog=candidates[0],selected=catalog.options.find(option=>option.id===category.id);
    const value={id:selected.id,label:selected.label,path:copy(selected.path)};
    for(const row of rows){
      row.categorySelection={category:copy(value),catalogId:catalog.catalogId,selectedAt:now(),checkedAt:catalog.checkedAt,platform:catalog.platform,storeBindingKey:catalog.storeBindingKey,account:catalog.account};row.ready=false;row.issues=[];
      if(sourceFacts(job,row)?.categoryPath?.length){const mapping=createConfirmedCategoryMapping({sourceFacts:sourceFacts(job,row),scope:categoryScope(job,row),category:value,options:catalog.options});state.categoryMappings=state.categoryMappings.filter(item=>item.id!==mapping.id);state.categoryMappings.push(mapping);}
    }
    summarize(job);job.message=`已为 ${rows.length} 条商品保存分类；填写时使用每件商品自己的分类`;save();return present(job);
  }
  function inspectIdentity(row,result){
    if(result.goodsId!==row.goodsId||result.storeBindingKey!==row.storeBindingKey||result.platform&&result.platform!==row.platform||result.sourceUrl&&productIdentity(result.sourceUrl)!==row.goodsId||result.storeName&&result.storeName!==row.storeName||result.site&&siteKey(result.site)!==siteKey(row.site))throw fail('执行器返回的商品或店铺身份与本次任务不一致');
    const url=result.platformEditUrl||result.url;
    if(url&&!editUrl(url))throw fail('执行器返回的店铺商品编辑地址无效');
    if(url&&row.platform==='shein'&&new URL(url).pathname!=='/web/sheinProduct/edit')throw fail('执行器返回的SHEIN商品不属于对应平台');
    if(url&&result.draftId&&new URL(url).searchParams.get('id')!==result.draftId)throw fail('执行器返回的店铺商品编号与编辑地址不一致');
    if(url&&row.resolvedTarget&&draftIdentity(url)!==draftIdentity(row.resolvedTarget.platformEditUrl))throw fail('执行器返回了其他草稿，不能替换已明确选定的候选记录');
    if(row.platformEditUrl&&url&&row.platformEditUrl!==url&&submissionFields.some(name=>row[name]))throw fail('已有提交的店铺商品记录发生变化，不能切换到其他记录');
    return url;
  }
  async function inspect(job,{unattemptedOnly=false}={}){
    if(typeof backend.inspect!=='function')throw fail('尚未接入采集箱记录核对');
    const result=await backend.inspect(adapterArgs(job,{rows:copy(job.sourceRows)}));
    if(!Array.isArray(result?.rows))throw fail('采集箱核对未返回逐店商品记录');
    const expected=new Set(job.rows.map(row=>row.id)),seen=new Set(),urls=new Set();
    for(const item of result.rows){const key=rowKey(item.goodsId,item.storeBindingKey);if(!expected.has(key)||seen.has(key))throw fail('采集箱核对返回了无关或重复的商品店铺记录');seen.add(key);const target=job.rows.find(row=>row.id===key);if(unattemptedOnly&&!unattempted(target))continue;const url=inspectIdentity(target,item);if(url&&urls.has(url))throw fail('不同商品店铺记录不能指向同一个平台草稿');if(url)urls.add(url);}
    for(const row of job.rows){
      if(unattemptedOnly&&!unattempted(row))continue;
      // Moved/submitted drafts no longer have to remain in the collection box.
      // Their original identity is checked through publication readback instead.
      if(row.moveIntent||row.publishIntent||row.publicationStatus)continue;
      const item=result.rows.find(candidate=>rowKey(candidate.goodsId,candidate.storeBindingKey)===row.id);
      if(!item){row.locationStatus='needs-review';row.status='needs-review';row.issues=['执行器没有返回该店铺商品的核对结果'];continue;}
      const url=inspectIdentity(row,item),status=item.status;
      row.inspection=clean(item);
      const diagnostics=boundedPagerDiagnostics(item.pagerDiagnostics);if(diagnostics)row.inspection.pagerDiagnostics=diagnostics;else delete row.inspection.pagerDiagnostics;
      row.checkedAt=now();
      row.locationStatus=['located','claimed','verified','prepared'].includes(status)&&url?'located':['unclaimed','ambiguous','failed'].includes(status)?status:'needs-review';
      row.issues=(Array.isArray(item.issues)?item.issues:[]).map(redact);
      if(item.error&&!row.issues.includes(redact(item.error)))row.issues.push(redact(item.error));
      if(row.locationStatus==='located'){row.platformEditUrl=url;row.draftId=new URL(url).searchParams.get('id');}
      else if(!row.issues.length)row.issues=[row.locationStatus==='unclaimed'?'该商品尚未认领到此店铺':row.locationStatus==='ambiguous'?'此店铺存在多个候选商品记录':'该店铺商品记录尚未核实'];
      if(!row.saveIntent&&!row.publishIntent){row.status=row.locationStatus;row.ready=false;row.saved=false;}
      else if(row.locationStatus!=='located'||uncertain(row))row.status='needs-review';
    }
    job.inspectedAt=now();save();
  }
  function historicalUncertain(job,row){
    return Object.values(state.jobs).filter(other=>other.id!==job.id&&other.binding.erpConnection.expectedAccount===job.binding.erpConnection.expectedAccount&&(other.binding.erpConnection.provider||'dianxiaomi')===(job.binding.erpConnection.provider||'dianxiaomi')).flatMap(other=>other.rows.map(prior=>({job:other,row:prior}))).find(prior=>(uncertain(prior.row)||acceptedPublication(prior.row)||claimUncertain(prior.job)&&prior.job.claimIntent.goodsIds?.includes(prior.row.goodsId))&&(row.platformEditUrl&&draftIdentity(prior.row.platformEditUrl)===draftIdentity(row.platformEditUrl)||prior.row.goodsId===row.goodsId&&prior.row.platform===row.platform&&prior.row.storeName===row.storeName&&(row.platform==='shein'||siteKey(prior.row.site)===siteKey(row.site))));
  }
  function intent(job,row,kind,payload){
    checkBinding(job);if(job.stopRequested)throw fail('任务已暂停，未提交当前商品');
    if(kind==='publish'&&(requiredFields(job)||job.completionMode==='pending'))throw fail('本任务只允许转入待发布，不能提交平台发布',409);
    const field=kind==='save'?'saveIntent':kind==='move'?'moveIntent':'publishIntent';
    if(row[field])throw fail('该商品已有保存、移动或发布提交记录，仅允许核对已有结果',409);
    if(kind==='move'&&(row.publishIntent||!payload||payload.draftId!==row.draftId||payload.goodsId!==row.goodsId||payload.storeBindingKey!==row.storeBindingKey||payload.url!==row.platformEditUrl||productIdentity(payload.sourceUrl)!==row.goodsId||payload.from!=='collection'||payload.to!=='pending-publication'))throw fail('移入待发布前的草稿、来源或店铺与本次任务不一致');
    if(kind==='publish'&&(row.moveIntent&&row.moveIntent.status!=='confirmed'||payload?.draftId&&payload.draftId!==row.draftId||payload?.goodsId&&payload.goodsId!==row.goodsId||payload?.storeBindingKey&&payload.storeBindingKey!==row.storeBindingKey||payload?.url&&payload.url!==row.platformEditUrl))throw fail('发布前草稿身份或移入待发布状态尚未核实');
    const prior=historicalUncertain(job,row);if(prior)throw fail(`该商品在任务 ${prior.job.id} 中的提交结果尚未核对，未重新提交`,409);
    row[field]={submittedAt:now(),status:'pending',payload:clean(payload??{})};row.status=kind==='save'?'saving':kind==='move'?'moving':'publishing';save();
  }
  function moved(job,row,result){
    checkBinding(job);
    if(!row.moveIntent||result?.draftId!==row.draftId||result.movedToPending!==true||!['draft','submitted','listed','online','reviewing','pending-launch'].includes(result.publicationStatus))throw fail('移入待发布的核对证据与原提交记录不一致');
    row.moveIntent.status='confirmed';row.moveIntent.confirmedAt=now();row.moveIntent.verification=clean(result);row.movedToPending=result.publicationStatus==='draft';save();
  }
  function applyPublication(row,result,{verifying=false}={}){
    if(result?.goodsId&&result.goodsId!==row.goodsId||result?.storeBindingKey&&result.storeBindingKey!==row.storeBindingKey||result?.draftId&&result.draftId!==row.draftId)throw fail('发布核对结果身份与本次商品不一致');
    const url=result?.platformEditUrl||result?.url;
    if(url&&url!==row.platformEditUrl)throw fail('发布核对结果地址与本次商品不一致');
    const status=result?.publicationStatus||(result?.published===true?'online':result?.submitted===true||result?.accepted===true?'submitted':'unknown');
    if(!['online','listed','reviewing','pending-launch','submitted','draft','failed','unknown'].includes(status)||result?.published===true&&status!=='online')throw fail('发布执行器返回了矛盾或无效的商品状态');
    row[verifying?'publicationReconciliation':'publication']=clean(result);row.checkedAt=now();row.publicationStatus=status;row.published=status==='online';
    row.movedToPending=status==='draft'&&result?.movedToPending===true;
    row.publicationPreflightBlocked=status==='unknown'&&!row.moveIntent&&!row.publishIntent&&result?.publicationNotSubmitted===true&&result?.moveAttempted!==true;
    row.issues=(Array.isArray(result?.issues)?result.issues:[]).map(redact);if(result?.error&&!row.issues.includes(redact(result.error)))row.issues.push(redact(result.error));
    if(row.moveIntent&&result?.movedToPending===true&&status!=='unknown'){row.moveIntent.status='confirmed';row.moveIntent.confirmedAt=now();row.moveIntent.verification=clean(result);}
    if(!row.publishIntent&&!verifying&&result?.readOnly!==true&&result?.publicationNotSubmitted!==true){
      row.publishIntent={submittedAt:null,detectedAt:now(),status:'unknown',protocolViolation:'missing-beforePublish',payload:null};
      throw fail('执行器未记录发布意图，发布结果需要只读核对，不能再次提交');
    }
    if(status==='online'){
      row.published=true;row.status='published';row.ready=row.saved===true&&!row.issues.length;
      if(row.publishIntent){row.publishIntent.status='confirmed';row.publishIntent.confirmedAt=now();}
    }else if(['listed','reviewing','pending-launch','submitted'].includes(status)){
      row.published=false;row.ready=false;row.status=status;if(row.publishIntent)row.publishIntent.status='accepted';
    }else if(status==='draft'&&!row.publishIntent&&result?.publicationNotSubmitted===true){
      row.published=false;row.ready=result.ready===true&&result.saved===true&&!row.issues.length;row.saved=result.saved===true;
      row.status=row.ready&&!uncertain(row)?'prepared':'needs-review';
    }else {
      row.ready=false;row.status=status==='failed'?'failed':'needs-review';
      if(row.publishIntent&&row.publishIntent.status==='pending')row.publishIntent.status='unknown';
      if(!row.issues.length)row.issues=['已有移动或发布提交结果仍待核对，未重新提交'];
    }
  }
  function applyPreparation(row,result,{verifying=false}={}){
    if(result?.goodsId&&result.goodsId!==row.goodsId||result?.storeBindingKey&&result.storeBindingKey!==row.storeBindingKey)throw fail('商品核对结果身份不一致');
    const url=result?.platformEditUrl||result?.url;
    if(url&&url!==row.platformEditUrl)throw fail('商品核对结果地址与本次提交记录不一致');
    row[verifying?'reconciliation':'preparation']=clean(result);row.checkedAt=now();
    row.issues=(Array.isArray(result?.issues)?result.issues:[]).map(redact);
    if(result?.error)row.issues.push(redact(result.error));
    if(result?.saved===true){
      if(!verifying&&!row.saveIntent){
        row.saveIntent={submittedAt:null,detectedAt:now(),status:'unknown',protocolViolation:'missing-beforeSave',payload:null};
        throw fail('执行器未记录保存意图却报告已保存，结果需要只读核对，不能再次提交');
      }
      row.saved=true;if(row.saveIntent){row.saveIntent.status='confirmed';row.saveIntent.confirmedAt=now();}
    }
    if(result?.published===true){
      row.published=true;row.publicationStatus='online';if(row.publishIntent){row.publishIntent.status='confirmed';row.publishIntent.confirmedAt=now();}
    }
    row.ready=result?.ready===true&&row.saved&&row.issues.length===0;
    if(verifying&&row.publicationPreflightBlocked&&row.ready&&!row.moveIntent&&!row.publishIntent){delete row.publicationStatus;row.publicationPreflightBlocked=false;}
    if(uncertain(row)){row.status='needs-review';if(!row.issues.length)row.issues=['上次提交结果仍待核对，未重新提交'];}
    else if(row.published)row.status='published';
    else if(row.ready)row.status='prepared';
    else {row.status=result?.status==='failed'?'failed':'needs-review';if(!row.issues.length)row.issues=['商品资料仍有待核对项'];}
  }
  function nativeCategoryReceipt(row,result){
    if(result?.id!==row.id||result.goodsId!==row.goodsId||result.storeBindingKey!==row.storeBindingKey||result.draftId!==row.draftId||result.categoryConfirmed!==true||result.variantsPreserved!==true||result.saved===true||result.submitted===true||result.published===true||!isDeepStrictEqual(result.category,row.nativeCategoryIntent?.payload?.category))throw fail('分类保存回读未确认完整成员、目标分类及原变种映射');
    if(result.sourceUrl!==undefined&&result.sourceUrl!==row.sourceUrl)throw fail('分类回读的来源商品不一致');
  }
  function nativeReconciliationBatch(job,row,{categoryOnly=false}={}){
    const field=categoryOnly?'nativeCategoryIntent':'saveIntent',id=row[field]?.batchId,operation=job.batchOperations?.find(item=>item.id===id&&item.action==='prepare');
    if(!operation||!Array.isArray(operation.memberIds)||!operation.memberIds.length||operation.memberIds.length>30||new Set(operation.memberIds).size!==operation.memberIds.length||!operation.memberIds.includes(row.id))throw fail('缺少原生保存批次的明确成员记录，未猜测核对范围');
    const rows=operation.memberIds.map(memberId=>job.rows.find(item=>item.id===memberId));
    if(rows.some(member=>!member||member[field]?.batchId!==id||!categoryOnly&&member[field].payload?.url!==member.platformEditUrl||member[field].payload?.goodsId!==member.goodsId||member[field].payload?.storeBindingKey!==member.storeBindingKey||member.storeBindingKey!==row.storeBindingKey||member.platform!==row.platform))throw fail('原生保存批次的成员或原提交身份发生变化');
    const intents=rows.map(member=>({id:member.id,goodsId:member.goodsId,storeBindingKey:member.storeBindingKey,draftId:member.draftId,payload:copy(member[field].payload)}));
    return {id,memberIds:copy(operation.memberIds),rows:copy(rows),...(categoryOnly?{categoryIntents:intents,scopeKey:operation.categoryIntent?.scopeKey}:{preparationIntents:intents})};
  }
  async function reconcile(job){
    let failed=false;
    if(claimUncertain(job)||job.rows.some(row=>!row.platformEditUrl||unattempted(row)))await inspect(job,{unattemptedOnly:true});
    confirmClaim(job);
    for(const row of job.rows){
      if(job.stopRequested)break;
      // Inspection is the evidence for untouched drafts. There is no save
      // receipt or expected saved snapshot to verify until beforeSave ran.
      if(unattempted(row))continue;
      if(!row.platformEditUrl||row.locationStatus!=='located')continue;
      checkBinding(job);
      const publication=row.moveIntent||row.publishIntent||row.publicationStatus&&!row.publicationPreflightBlocked;
      const categoryOnly=!!row.nativeCategoryIntent&&!submissionFields.some(name=>row[name]),native=categoryOnly||row.saveIntent?.payload?.expectedSnapshot?.policy===nativeSnapshotPolicy;
      const verifier=native?backend.verifyNativeBatchMember:publication&&typeof backend.verifyPublication==='function'?backend.verifyPublication:backend.verify;
      if(typeof verifier!=='function'){
        if(submissionFields.some(name=>row[name])){row.status='needs-review';row.issues=[native?'尚未接入原生批量快照的只读核对，未改用单件旧字段快照':'尚未接入已提交商品的只读核对'];failed=true;}
        continue;
      }
      try{
        const storeBinding=job.templateSnapshot.storeBindings.find(store=>store.key===row.storeBindingKey);
        const result=await verifier(adapterArgs(job,{row:copy(row),storeBinding:copy(storeBinding),preparationIntent:copy(row.saveIntent?.payload||null),moveIntent:copy(row.moveIntent?.payload||null),publicationIntent:copy(row.publishIntent?.payload||null),...(native?{verifyPending:!!publication,verifyCategoryOnly:categoryOnly,nativeCategoryIntent:copy(row.nativeCategoryIntent?.payload||null),nativeBatch:nativeReconciliationBatch(job,row,{categoryOnly})}:{})}));
        if(categoryOnly){
          if(result?.readOnly!==true||result.phase!=='native-batch-editor'||result.saved===true||result.published===true||result.submitted===true)throw fail('分类核对尚未确认进入原生编辑阶段，不能当作完整保存');
          nativeCategoryReceipt(row,result);row.nativeCategoryIntent.status='confirmed';row.nativeCategoryIntent.confirmedAt=now();row.nativeCategoryIntent.verification=clean(result);row.status='located';row.ready=false;row.saved=false;row.issues=[];
        }else{
          if(native&&(result?.readOnly!==true||result.id!==row.id||result.goodsId!==row.goodsId||result.storeBindingKey!==row.storeBindingKey||result.draftId!==row.draftId||(result.platformEditUrl||result.url)!==row.platformEditUrl))throw fail('原生批量只读核对返回了不一致的商品、草稿或读写状态');
          if(publication&&(native||typeof backend.verifyPublication==='function'))applyPublication(row,result,{verifying:true});else applyPreparation(row,result,{verifying:true});
        }save();
      }catch(error){failed=true;row.status='needs-review';row.issues=[redact(error.message)];save();}
    }
    for(const operation of job.batchOperations||[]){
      if(operation.categoryIntent&&operation.memberIds.every(id=>{const member=job.rows.find(row=>row.id===id);return member?.nativeCategoryIntent?.batchId===operation.id&&member.nativeCategoryIntent.status==='confirmed';})){operation.categoryIntent.status='confirmed';operation.categoryIntent.checkedAt=now();}
      if(!['pending','unknown'].includes(operation.status)||!Array.isArray(operation.memberIds)||!operation.memberIds.length)continue;
      const field=operation.action==='prepare'?'saveIntent':'moveIntent',members=operation.memberIds.map(id=>job.rows.find(row=>row.id===id));
      if(members.every(row=>row?.[field]?.batchId===operation.id&&row[field].status==='confirmed')){operation.status='confirmed';operation.checkedAt=now();}
    }
    job.needsReconcile=failed||job.stopRequested;job.reconciledAt=now();save();
  }
  function allocationDestinations(value){
    if(!Array.isArray(value)||value.length>500)throw fail('认领分配模板目的地列表无效');
    const result=value.map(item=>{
      if(!item||!['temu','tiktok','shein'].includes(item.platform)||typeof item.storeName!=='string'||!item.storeName.trim()||typeof item.site!=='string'||item.platform!=='shein'&&!item.site.trim())throw fail('认领模板需要明确的平台、店铺和站点');
      return {platform:item.platform,storeName:item.storeName.trim(),site:item.site.trim(),...(typeof item.mode==='string'?{mode:item.mode}:{} )};
    });
    if(new Set(result.map(destinationKey)).size!==result.length)throw fail('认领分配模板包含重复目的地');
    return result;
  }
  function allocationMatches(job,destinations){return sameSet(destinations.map(destinationKey),job.templateSnapshot.storeBindings.map(store=>destinationKey({platform:job.templateSnapshot.platform,...store})));}
  async function syncAllocation(id,{templateName}={}){
    available();const job=getRaw(id);checkBinding(job);
    if(typeof allocator.readTemplates!=='function')throw fail('尚未接入店小秘认领分配模板读取');
    if(templateName!==undefined&&(typeof templateName!=='string'||!templateName.trim()||templateName.length>200))throw fail('认领分配模板名称无效');
    active=job.id;job.action='sync-allocation';job.status='running';job.stopRequested=false;job.error=null;delete job.allocationDiagnostics;job.message='正在读取店小秘认领分配模板及实际店铺站点';save();
    try{
      const result=await allocator.readTemplates(adapterArgs(job,{sourceRows:copy(job.sourceRows),templateName}));
      checkBinding(job);
      if(!Array.isArray(result?.templates)||result.templates.length>500)throw fail('未取得店小秘认领分配模板列表');
      const checkedAt=now(),catalog=result.templates.map(item=>{
        const templateId=typeof item.id==='number'&&Number.isSafeInteger(item.id)?String(item.id):item.id;
        if(!idOK(templateId)||typeof item.name!=='string'||!item.name.trim())throw fail('认领分配模板编号或名称无效');
        return {id:templateId,name:item.name.trim(),destinations:allocationDestinations(item.destinations||[]),checkedAt};
      });
      if(new Set(catalog.map(item=>item.id)).size!==catalog.length)throw fail('认领分配模板编号重复');
      const old=templateName?job.allocationCatalog?.templates||[]:[];
      job.allocationCatalog={checkedAt,catalogComplete:result.catalogComplete===true,requestedName:templateName||null,templates:[...old.filter(item=>!catalog.some(fresh=>fresh.id===item.id)),...catalog]};
      job.message='已读取店小秘认领分配模板，请选择本次使用的分配模板';job.error=null;
    }catch(error){
      job.error=redact(error.message);job.message=job.error;
      const diagnostics=error.data?.allocationDiagnostics;
      if(diagnostics&&typeof diagnostics==='object'&&!Array.isArray(diagnostics)){
        const safe=clean(diagnostics);
        job.allocationDiagnostics=JSON.stringify(safe).length<=16384?safe:{captureError:'页面诊断超过大小限制，未保存'};
      }
      throw error;
    }
    finally{job.action=null;summarize(job);save();active=null;}
    return present(job);
  }
  function selectAllocation(id,{templateId}={}){
    available();const job=getRaw(id);checkBinding(job);
    if(!idOK(templateId))throw fail('请选择已读取的认领分配模板');
    if(job.claimIntent)throw fail('本任务已有认领提交记录，不能更换认领分配模板',409);
    const template=job.allocationCatalog?.templates?.find(item=>item.id===templateId);
    if(!template||!template.destinations.length)throw fail('所选认领模板尚未读取完整目的地，请先同步该模板');
    if(!allocationMatches(job,template.destinations))throw fail('本次认领模板的完整平台、店铺、站点必须与本任务所选上架店铺一致；其他平台或店铺需另行分组处理',409);
    job.allocationSnapshot={...copy(template),selectedAt:now()};job.updatedAt=now();job.message='认领分配模板和完整目的地已固定；它与商品填写用的上架模板分别保存';save();return present(job);
  }
  function confirmClaim(job){
    if(!job.claimIntent||job.claimIntent.status==='confirmed')return;
    const relevant=job.rows.filter(row=>job.claimIntent.goodsIds?.includes(row.goodsId));
    if(relevant.length&&relevant.every(row=>row.locationStatus==='located'&&editUrl(row.platformEditUrl))){job.claimIntent.status='confirmed';job.claimIntent.confirmedAt=now();job.claimIntent.confirmedRows=relevant.map(row=>({goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,platformEditUrl:row.platformEditUrl}));save();}
  }
  async function claim(job){
    const direct=requiredFields(job),destinations=direct?job.destinationSnapshot.map(({platform,storeName,storeId,site})=>({platform,storeName,storeId,site})):job.allocationSnapshot?.destinations;
    const observedDestinations=direct?destinations.map(collectionClaimDestination):destinations;
    if(!direct&&(!job.allocationSnapshot||!allocationMatches(job,job.allocationSnapshot.destinations)))throw fail('认领分配模板尚未与本次目的地集合对应');
    const ids=[...new Set(job.rows.filter(row=>row.locationStatus==='unclaimed').map(row=>row.goodsId))],sourceRows=job.sourceRows.filter(row=>ids.includes(row.goodsId));
    if(!ids.length||job.claimIntent)throw fail('本任务没有可新提交的认领商品');
    for(const row of job.rows.filter(row=>ids.includes(row.goodsId))){const prior=historicalUncertain(job,row);if(prior)throw fail(`任务 ${prior.job.id} 的相同商品仍有未决提交，请先核对原任务`,409);}
    const beforeClaim=payload=>{
      checkBinding(job);if(job.stopRequested)throw fail('任务已暂停，未提交认领');
      if(job.claimIntent)throw fail('本任务已有认领提交意图，不能重复提交',409);
      if(!payload||!direct&&(String(payload.templateId)!==job.allocationSnapshot.id||payload.templateName&&payload.templateName!==job.allocationSnapshot.name)||!Array.isArray(payload.goodsIds)||!sameSet(payload.goodsIds,ids)||payload.skipDuplicates!==true||!isDeepStrictEqual(allocationDestinations(payload.destinations).sort((a,b)=>destinationKey(a).localeCompare(destinationKey(b))),allocationDestinations(observedDestinations).sort((a,b)=>destinationKey(a).localeCompare(destinationKey(b)))))throw fail('认领执行器提交前的商品、完整目的地或重复跳过设置不一致，未授权提交');
      if(direct)assertCollectionClaimIdentities(payload.destinations,observedDestinations,payload.storeIdentityEvidence,job.binding.erpConnection.expectedAccount);
      job.claimIntent={submittedAt:now(),status:'pending',goodsIds:copy(ids),...(direct?{destinations:copy(destinations)}:{allocationSnapshot:copy(job.allocationSnapshot)}),payload:clean(payload)};save();
    };
    try{
      const result=await allocator[direct?'claimDestinations':'claim'](adapterArgs(job,{sourceRows:copy(sourceRows),rows:copy(sourceRows),...(direct?{destinations:copy(destinations)}:{allocationSnapshot:copy(job.allocationSnapshot)}),beforeClaim}));
      job.claimResult=clean(result);
      if(!job.claimIntent){
        if(result?.submitted===true||result?.status==='claimed')job.claimIntent={submittedAt:null,detectedAt:now(),status:'unknown',protocolViolation:'missing-beforeClaim',goodsIds:copy(ids),...(direct?{destinations:copy(destinations)}:{allocationSnapshot:copy(job.allocationSnapshot)}),payload:null};
        throw fail(result?.issues?.join('；')||'认领执行器没有保存提交记录，不能确认本次认领');
      }
      job.claimIntent.status='unknown';save();
      if(!job.stopRequested){await inspect(job);confirmClaim(job);}
    }catch(error){if(job.claimIntent?.status==='pending')job.claimIntent.status='unknown';save();throw error;}
  }
  async function reviewCorrections(job){
    if(job.templateSnapshot.platform!=='temu')throw fail('此平台暂不支持包装修改核对，请使用原任务只读核对',409);
    for(const [index,row] of job.rows.entries()){
      if(job.stopRequested)break;
      if(!correctable(row))continue;
      checkBinding(job);
      const prior=historicalUncertain(job,row);
      if(prior){row.ready=false;row.status='needs-review';row.issues=[`任务 ${prior.job.id} 的相同商品提交结果尚未核对`];save();continue;}
      const storeBinding=job.templateSnapshot.storeBindings.find(store=>store.key===row.storeBindingKey);
      progress(job,{phase:'review-corrections',stage:'row-start',rowIndex:index+1,rowCount:job.rows.length,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,message:`正在回读第 ${index+1}/${job.rows.length} 条已保存商品的包装修改`});
      try{
        // This path never receives mutation hooks. It only adopts a freshly
        // observed correction after the original save was already confirmed.
        const result=await backend.reviewCorrections(adapterArgs(job,{row:copy(row),storeBinding:copy(storeBinding),preparationIntent:copy(row.saveIntent.payload)}));
        checkBinding(job);
        if(job.stopRequested)break;
        if(result?.reviewAccepted!==true){
          row.correctionReview=clean(result);row.ready=false;row.status='needs-review';row.checkedAt=now();
          row.issues=(Array.isArray(result?.issues)?result.issues:[]).map(redact);
          if(result?.error)row.issues.push(redact(result.error));
          if(!row.issues.length)row.issues=['包装修改尚未通过回读核对，已保留原保存快照'];
          save();continue;
        }
        const before=row.saveIntent.payload.expectedSnapshot,after=result.expectedSnapshot;
        if(result.saved!==true||result.readOnly!==true||result.published===true||result.submitted===true||!after||typeof after!=='object'||Array.isArray(after))throw fail('包装修改核对缺少明确的只读保存快照，未替换原记录');
        if(result.goodsId&&result.goodsId!==row.goodsId||result.storeBindingKey&&result.storeBindingKey!==row.storeBindingKey||result.draftId&&result.draftId!==row.draftId||result.platformEditUrl&&result.platformEditUrl!==row.platformEditUrl||result.url&&result.url!==row.platformEditUrl)throw fail('包装修改回读结果与本次商品身份不一致');
        if(before.url!==row.platformEditUrl||before.account!==job.binding.erpConnection.expectedAccount||before.storeName!==row.storeName||siteKey(before.site)!==siteKey(row.site)||!before.sources?.includes(row.sourceUrl))throw fail('原保存快照与商品、账号、店铺或站点不一致，不能接受包装修改');
        if(!isDeepStrictEqual(correctionStableData(before),correctionStableData(after)))throw fail('包装以外的商品资料发生变化，未替换原保存快照');
        const ids=after.fields?.variationSku;
        if(!Array.isArray(ids)||!ids.length||ids.some(value=>!String(value||'').trim())||new Set(ids).size!==ids.length||[...packageCorrectionFields].some(name=>!Array.isArray(after.fields?.[name])||after.fields[name].length!==ids.length||after.fields[name].some(value=>!['string','number'].includes(typeof value)||!Number.isFinite(Number(value))||Number(value)<=0)))throw fail('包装修改需要完整SKU及每个SKU有效的长、宽、高和重量');
        // Capture the first saved baseline once; the bounded history stores
        // just the changed packaging and timestamps rather than whole media.
        const correctedAt=now(),changed=!isDeepStrictEqual(before,after);
        if(changed){
          row.saveIntent.originalExpectedSnapshot??=copy(before);
          const packages=snapshot=>Object.fromEntries([...packageCorrectionFields].map(name=>[name,copy(snapshot.fields[name])]));
          row.correctionHistory=[...(row.correctionHistory||[]),{checkedAt:correctedAt,skuIds:copy(ids),before:packages(before),after:packages(after),readOnly:true}].slice(-20);
          row.correctionCount=(row.correctionCount||0)+1;
          row.saveIntent.payload.expectedSnapshot=clean(after);
          row.saveIntent.correctionReviewedAt=correctedAt;
        }
        row.correctionReview=clean({...result,checkedAt:correctedAt,changed});
        applyPreparation(row,result,{verifying:true});
        save();
      }catch(error){row.ready=false;row.status='needs-review';row.issues=[redact(error.message)];row.checkedAt=now();save();}
    }
  }
  async function mutate(job,action){
    for(const row of job.rows){
      if(job.stopRequested)break;
      if(requiredFields(job)&&action==='prepare'&&(!canPrepareRow(job,row)||row.nativeCategoryIntent)||requiredFields(job)&&action==='pending'&&!canMoveRow(row))continue;
      if(action==='prepare'&&(prepared(row)||submissionFields.some(name=>row[name]))||action==='publish'&&(row.publishIntent||row.published||acceptedPublication(row))||action==='pending'&&pendingComplete(row))continue;
      checkBinding(job);const prior=historicalUncertain(job,row);if(prior){row.status='needs-review';row.issues=[`任务 ${prior.job.id} 的相同商品提交结果尚未核对`];save();if(action==='publish'||action==='pending')break;continue;}
      const storeBinding=job.templateSnapshot.storeBindings.find(store=>store.key===row.storeBindingKey);
      row.status=action==='prepare'?'preparing':action==='pending'?'moving':'publishing';row.issues=[];save();
      try{
        const method=action==='pending'?'moveToPending':action;
        const result=await backend[method](adapterArgs(job,{row:copy(row),storeBinding:copy(storeBinding),beforeSave:value=>intent(job,row,'save',value),beforeMoveToPending:value=>intent(job,row,'move',value),onMovedToPending:value=>moved(job,row,value),beforePublish:value=>intent(job,row,'publish',value)}));
        if(action==='prepare')applyPreparation(row,result);
        else applyPublication(row,result);
      }catch(error){
        row.status=submissionFields.some(name=>row[name])?'needs-review':'failed';row.issues=[redact(error.message)];
      }
      for(const name of submissionFields)if(row[name]?.status==='pending')row[name].status='unknown';
      save();
      if(uncertain(row)||['publish','pending'].includes(action)&&(row.status==='failed'||row.issues.length))break;
    }
  }
  async function processBatch(job){
    // A group cannot cross an account, shop, site, business mode or leaf
    // category. A native adapter must report every exact member independently.
    for(const action of ['prepare','pending']){
      if(!nativeCapability(job,action))throw fail('本平台的原生批量能力未启用，未改用逐件操作');
      const candidates=job.rows.filter(row=>action==='prepare'?canPrepareRow(job,row):canMoveRow(row));
      const groups=new Map();
      for(const row of candidates){const key=JSON.stringify([row.platform,row.storeBindingKey,row.site,row.inspection?.pricingEvidence?.businessMode||'',row.categorySelection?.category]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
      for(const rows of groups.values()){
        if(job.stopRequested||job.rows.some(uncertain))return;
        checkBinding(job);
        const method=action==='prepare'?'prepareBatch':'moveToPendingBatch',kind=action==='prepare'?'save':'move';
        if(typeof backend[method]!=='function')throw fail('当前平台的原生批量执行尚未接通，未改用逐件操作');
        const storeBinding=job.templateSnapshot.storeBindings.find(store=>store.key===rows[0].storeBindingKey);
        const batchId=randomUUID(),memberIds=rows.map(row=>row.id);
        job.batchOperations??=[];
        const operation={id:batchId,action,memberIds,createdAt:now(),status:'planning'};job.batchOperations.push(operation);save();
        const beforeCategorySubmit=payload=>{
          checkBinding(job);if(job.stopRequested)throw fail('批次已暂停，未保存分类');
          if(action!=='prepare'||operation.categoryIntent||operation.status!=='planning'||typeof payload?.scopeKey!=='string'||!payload.scopeKey||payload.scopeKey.length>200||!Array.isArray(payload.rows)||!sameSet(payload.rows.map(member=>member.id),memberIds)||new Set(payload.rows.map(member=>member.id)).size!==rows.length)throw fail('原生分类提交范围与本次批次不一致');
          for(const row of rows){
            if(row.nativeCategoryIntent||submissionFields.some(name=>row[name])||uncertain(row)||historicalUncertain(job,row))throw fail('分类已有提交记录或存在未决提交，不能重复保存');
            const member=payload.rows.find(item=>item.id===row.id),value=member.payload;let url;try{url=new URL(value?.url);}catch{}
            if(member.goodsId!==row.goodsId||member.storeBindingKey!==row.storeBindingKey||member.draftId!==row.draftId||value?.goodsId!==row.goodsId||value?.storeBindingKey!==row.storeBindingKey||value?.draftId!==row.draftId||value?.sourceUrl!==row.sourceUrl||url?.origin!=='https://www.dianxiaomi.com'||url.pathname!=='/web/modifyCategory'||url.username||url.password||url.hash||!isDeepStrictEqual(value.category,row.categorySelection?.category)||!value.expectedSnapshot||typeof value.expectedSnapshot!=='object'||Array.isArray(value.expectedSnapshot))throw fail('原生分类草稿、来源、店铺、分类或变种快照不一致');
          }
          for(const row of rows){row.nativeCategoryIntent={status:'pending',batchId,scopeKey:payload.scopeKey,submittedAt:now(),payload:clean(payload.rows.find(member=>member.id===row.id).payload)};row.status='mapping-category';}
          operation.categoryIntent={status:'pending',scopeKey:payload.scopeKey,memberIds:copy(memberIds),submittedAt:now()};save();
        };
        const onCategoryReadback=result=>{
          checkBinding(job);
          if(!operation.categoryIntent||result?.readOnly!==true||result.phase!=='native-batch-editor'||result.saved===true||result.submitted===true||result.published===true||result.scopeKey!==operation.categoryIntent.scopeKey||!Array.isArray(result.rows)||!sameSet(result.rows.map(member=>member.id),memberIds)||new Set(result.rows.map(member=>member.id)).size!==rows.length)throw fail('分类保存后的下一阶段或成员范围尚未核实');
          for(const row of rows)nativeCategoryReceipt(row,result.rows.find(member=>member.id===row.id));
          for(const row of rows){row.nativeCategoryIntent.status='confirmed';row.nativeCategoryIntent.confirmedAt=now();row.nativeCategoryIntent.verification=clean(result.rows.find(member=>member.id===row.id));row.status='located';}
          operation.categoryIntent.status='confirmed';operation.categoryIntent.checkedAt=now();save();
        };
        const beforeSubmit=payload=>{
          checkBinding(job);if(job.stopRequested)throw fail('批次已暂停，未提交');
          if(operation.status!=='planning'||!Array.isArray(payload?.rows)||!sameSet(payload.rows.map(row=>row.id),memberIds)||new Set(payload.rows.map(row=>row.id)).size!==rows.length)throw fail('原生批量表单商品集合与本次分组不一致');
          // Validate all members before committing any intent, then persist the
          // whole batch atomically before the browser is allowed to submit.
          for(const row of rows){
            if(uncertain(row)||row[`${kind}Intent`]||historicalUncertain(job,row))throw fail('批量成员存在未决提交，不能重发');
            const member=payload.rows.find(item=>item.id===row.id),value=member.payload;
            if(member.goodsId!==row.goodsId||member.storeBindingKey!==row.storeBindingKey||member.draftId!==row.draftId||value?.url!==row.platformEditUrl||value.goodsId!==row.goodsId||value.storeBindingKey!==row.storeBindingKey)throw fail('批量表单草稿身份不一致');
            if(kind==='save'&&(!value.expectedSnapshot||typeof value.expectedSnapshot!=='object'||Array.isArray(value.expectedSnapshot)||!value.priceEvidence||typeof value.priceEvidence!=='object'))throw fail('原生批量保存缺少逐成员只读核对快照或原有价格记录');
            if(kind==='move'&&(value.from!=='collection'||value.to!=='pending-publication'||value.draftId!==row.draftId||productIdentity(value.sourceUrl)!==row.goodsId))throw fail('批量移入待发布的范围不一致');
          }
          for(const row of rows){row[`${kind}Intent`]={submittedAt:now(),status:'pending',batchId,payload:clean(payload.rows.find(item=>item.id===row.id).payload)};row.status=kind==='save'?'saving':'moving';}
          operation.status='pending';operation.submittedAt=now();save();
        };
        try{
          const result=await backend[method](adapterArgs(job,{row:copy(rows[0]),rows:copy(rows),sourceRows:copy(job.sourceRows.filter(source=>rows.some(row=>row.goodsId===source.goodsId))),storeBinding:copy(storeBinding),batchId,beforeSubmit,...(action==='prepare'?{beforeCategorySubmit,onCategoryReadback}:{})}));
          const writeReported=item=>kind==='save'&&item?.saved===true||item?.movedToPending===true||item?.submitted===true||item?.published===true;
          if(operation.status==='planning'&&[result,...(Array.isArray(result?.rows)?result.rows:[])].some(writeReported)){
            for(const row of rows)row[`${kind}Intent`]={submittedAt:null,detectedAt:now(),status:'unknown',batchId,protocolViolation:'missing-beforeSubmit',payload:null};
            operation.status='unknown';save();
          }
          if(!Array.isArray(result?.rows)||!sameSet(result.rows.map(row=>row.id),memberIds)||new Set(result.rows.map(row=>row.id)).size!==rows.length)throw fail('原生批量回读未完整返回本次分组');
          for(const row of rows){const item=result.rows.find(item=>item.id===row.id);if(item.goodsId!==row.goodsId||item.storeBindingKey!==row.storeBindingKey||item.draftId!==row.draftId||(item.platformEditUrl||item.url)!==row.platformEditUrl)throw fail('原生批量回读的商品、店铺或草稿身份不一致');}
          if(operation.status!=='pending'){
            if(result.rows.some(writeReported)){
              for(const row of rows)row[`${kind}Intent`]={submittedAt:null,detectedAt:now(),status:'unknown',batchId,protocolViolation:'missing-beforeSubmit',payload:null};
              operation.status='unknown';
            }
            if(operation.status==='planning'){
              operation.status='blocked';operation.issues=[...new Set([...(result.issues||[]),...(result.blockers||[]).map(item=>item.message),...result.rows.flatMap(item=>item.issues||[])].filter(value=>typeof value==='string'&&value.trim()).map(redact))];
              for(const row of rows){const item=result.rows.find(item=>item.id===row.id);row.status='needs-review';row.issues=(Array.isArray(item.issues)&&item.issues.length?item.issues:operation.issues.length?operation.issues:['原生批量尚未通过提交前核对，未保存商品']).map(redact);}
              continue;
            }
            throw fail('原生批量执行器未记录提交意图，不能确认保存');
          }
          if(result.rows.some(item=>item.submitted===true||item.published===true||['online','listed','reviewing','pending-launch','submitted'].includes(item.publicationStatus)))throw fail('本次原生批量只允许保存并转入待发布，返回了平台发布状态，需要只读核对');
          for(const row of rows){const item=result.rows.find(item=>item.id===row.id);if(action==='prepare')applyPreparation(row,item);else applyPublication(row,{...item,publicationNotSubmitted:true});}
          operation.status=rows.some(uncertain)?'unknown':'confirmed';operation.checkedAt=now();
        }catch(error){operation.status=['pending','unknown'].includes(operation.status)||rows.some(uncertain)?'unknown':'blocked';operation.issue=redact(error.message);for(const row of rows){row.status='needs-review';row.issues=[operation.issue];}}
        finally{for(const row of rows){for(const name of submissionFields)if(row[name]?.status==='pending')row[name].status='unknown';if(row.nativeCategoryIntent?.status==='pending')row.nativeCategoryIntent.status='unknown';}if(operation.categoryIntent?.status==='pending')operation.categoryIntent.status='unknown';if(operation.categoryIntent?.status==='unknown')operation.status='unknown';save();}
      }
    }
  }
  async function execute(job,action){
    try{
      checkBinding(job);
      if(action==='inspect')await inspect(job);
      else if(action==='reconcile')await reconcile(job);
      else if(action==='claim')await claim(job);
      else if(action==='review-corrections')await reviewCorrections(job);
      else if(action==='process')await processBatch(job);
      else await mutate(job,action);
      summarize(job);
      if(job.stopRequested){job.status=job.rows.some(uncertain)||claimUncertain(job)?'needs-review':'paused';job.message='已暂停后续商品，已完成记录和提交意图已保留';}
      else job.message=job.status==='pending-ready'?'本批商品已全部转入待发布，已停止后续发布':job.status==='prepared'?'本批商品已保存并核对，可统一转入待发布':job.status==='completed'?'本批所有目标商品已取得发布成功结果':job.status==='submitted'?'本批商品均已取得提交或平台状态回执；只有核实在线后才计为发布成功':job.status==='inspected'?'已定位本批各店商品，请选择正确分类后继续填写':'已保留逐店处理结果，请查看未认领、缺失资料或待核对项';
    }catch(error){
      job.status='needs-review';job.message=redact(error.message);job.error=job.message;
      const diagnostics=boundedPagerDiagnostics(error.data?.pagerDiagnostics);if(diagnostics)job.pagerDiagnostics=diagnostics;
    }
    finally{job.action=null;job.updatedAt=now();if(job.progress)job.progress={...job.progress,active:false,finishedAt:job.updatedAt};save();active=null;}
  }
  function run(id,action){
    if(action==='source-facts')return readSources(id);
    if(!['inspect','claim','prepare','pending','publish','reconcile','review-corrections','process'].includes(action))throw fail('上架联动操作无效');
    available();const job=getRaw(id);checkBinding(job);
    if(action==='publish'&&(requiredFields(job)||job.completionMode==='pending'))throw fail('本任务只允许转入待发布，不能提交平台发布',409);
    if(action==='review-corrections'&&job.templateSnapshot.platform!=='temu')throw fail('此平台暂不支持包装修改核对，请使用原任务只读核对',409);
    if(!actions(job).includes(action)){
      if(job.needsReconcile||job.rows.some(uncertain)||claimUncertain(job))throw fail('已有提交或中断记录需要先只读核对，不能再次认领、保存或发布',409);
      if(action==='claim'&&!requiredFields(job)&&!job.allocationSnapshot)throw fail('请先同步并选择店小秘的认领分配模板',409);
      if(action==='prepare'&&!configurationReadiness(job).ready)throw fail(`商品配置尚未完成：${configurationReadiness(job).issues.join('；')}`,409);
      if(action==='publish'&&!publishingSupported())throw fail('真实发布执行尚未接通，不能提交发布',409);
      throw fail('当前商品状态不支持此操作，请先核对全部目标记录及待补项',409);
    }
    job.status='running';job.action=action;job.stopRequested=false;job.error=null;delete job.pagerDiagnostics;job.message=action==='process'?'正在按店铺和分类分组进行原生批量处理':action==='inspect'?'正在定位各店采集箱中的本批商品':action==='reconcile'?'正在只读核对已有商品及提交结果':action==='claim'?'正在按分配模板认领本批缺少的店铺商品记录':action==='prepare'?'正在按所选分类填写并保存本批商品':action==='pending'?'正在将本批商品转入待发布并回读核对':action==='review-corrections'?'正在回读已保存的包装修改，保留原保存记录':'正在提交发布并核对结果';job.updatedAt=now();job.progress={phase:action,active:true,startedAt:job.updatedAt,updatedAt:job.updatedAt,message:job.message};active=job.id;save();void execute(job,action);return present(job);
  }
  function resolve(id,payload){
    available();const job=getRaw(id);checkBinding(job);
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['goodsId','storeBindingKey','draftId'].includes(key))||typeof payload.goodsId!=='string'||!idOK(payload.storeBindingKey)||typeof payload.draftId!=='string'||!/^\d{6,32}$/.test(payload.draftId))throw fail('请选择本次核对返回的候选商品编号');
    const row=job.rows.find(item=>item.goodsId===payload.goodsId&&item.storeBindingKey===payload.storeBindingKey);
    if(!row)throw fail('该商品或店铺不属于本次任务');
    if(row.resolvedTarget?.draftId===payload.draftId)return present(job);
    if(submissionFields.some(name=>row[name]))throw fail('该商品已有保存、移动或发布记录，不能改绑到其他草稿',409);
    if(row.inspection?.status!=='ambiguous'||!Array.isArray(row.inspection.candidates))throw fail('该商品没有待选择的现场候选记录，请先重新核对',409);
    const matches=row.inspection.candidates.filter(candidate=>candidate.draftId===payload.draftId);
    if(matches.length!==1)throw fail('候选商品不存在或编号重复，请重新核对',409);
    const candidate=matches[0],url=candidate.platformEditUrl;
    if(!editUrl(url)||new URL(url).searchParams.get('id')!==candidate.draftId)throw fail('候选商品编辑地址未通过校验，未保存绑定');
    if(row.platform==='temu'&&new URL(url).pathname!=='/web/popTemu/edit')throw fail('候选商品不属于本次目标平台');
    if(row.platform==='shein'&&new URL(url).pathname!=='/web/sheinProduct/edit')throw fail('候选商品不属于本次目标平台');
    if(candidate.goodsId&&candidate.goodsId!==row.goodsId||candidate.storeBindingKey&&candidate.storeBindingKey!==row.storeBindingKey||candidate.storeName&&candidate.storeName!==row.storeName||candidate.site&&siteKey(candidate.site)!==siteKey(row.site)||candidate.sourceUrl&&productIdentity(candidate.sourceUrl)!==row.goodsId)throw fail('候选商品的来源、店铺或站点与本次目标不一致');
    if(job.rows.some(other=>other!==row&&[other.platformEditUrl,other.resolvedTarget?.platformEditUrl].some(otherUrl=>otherUrl&&draftIdentity(otherUrl)===draftIdentity(url))))throw fail('该候选草稿已属于本任务的另一个商品或店铺');
    if(row.resolvedTarget){row.resolutionHistory??=[];row.resolutionHistory.push(copy(row.resolvedTarget));}
    row.resolvedTarget={draftId:candidate.draftId,platformEditUrl:url,...(typeof candidate.editorUrlObserved==='boolean'?{editorUrlObserved:candidate.editorUrlObserved}:{}),selectedAt:now(),sourceInspectionAt:row.checkedAt||job.inspectedAt||null};
    row.locationStatus='pending';row.status='pending';row.platformEditUrl=null;delete row.draftId;row.ready=false;row.saved=false;row.published=false;row.issues=['已保存候选选择，待现场核对来源、店铺和站点'];
    summarize(job);job.message='候选选择已保存，下一次核对将只检查已选草稿；尚未填写或保存商品';save();return present(job);
  }
  function stop(id){const job=getRaw(id);if(active===job.id){job.stopRequested=true;if(job.action==='source-facts')freeSourcing.stop?.(job.freeJobId);job.message='将在当前商品完成核对后暂停，不再开始下一件';}else if(job.status!=='completed'){job.stopRequested=true;job.status=job.rows.some(uncertain)||claimUncertain(job)?'needs-review':'paused';job.message='已暂停，原商品范围、固定模板和执行记录已保留';}save();return present(job);}
  return {create,run,stop,resolve,readSources,openNative,readCategories,selectCategories,searchCategories,resolveCategories,syncAllocation,selectAllocation,get:id=>present(getRaw(id)),view:()=>({busy:!!active,otherBusy:!!isOtherBusy(),jobs:Object.values(state.jobs).reverse().map(present)}),isBusy:()=>!!active};
}
