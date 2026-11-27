import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createTemuFrontBrowser,productIdentity} from './temu-front-browser.mjs';
import {createCollectionBrowser} from './collection-browser.mjs';
import {createSadCaptchaClient} from './sadcaptcha-client.mjs';
import {createDxmPluginBrowser} from './dxm-plugin-browser.mjs';
import {sanitizeCaptchaDiagnostic,getCaptchaDiagnosticMessage} from './temu-captcha-diagnostics.mjs';
import {normalizeTemuSourceFacts} from './temu-source-facts.mjs';

export const FREE_SOURCING_REVISION='plugin-source-facts-20261125-v24';

const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const finished=row=>row.status==='verified';
const duplicateSkipped=row=>row.status==='skipped-duplicate';
const processed=row=>finished(row)||duplicateSkipped(row);
// Pending submissions reserve a slot until reconciled; duplicates never do.
const quotaUsed=job=>job.rows.filter(row=>finished(row)||row.submittedAt&&!duplicateSkipped(row)).length;
const pauses=new Set(['waiting-verification','waiting-plugin','waiting-login','waiting-network','paused','needs-review']);

// No paid data client is part of this service. Persist write intent before a plugin click.
export function createFreeSourcing({directory,configuration={},preferences,isOtherBusy=()=>false,adapter,collectionAdapter,captchaClient,pluginAdapter}){
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'state.json');
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{jobs:{}};
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2));fs.renameSync(file+'.tmp',file);};
  for(const job of Object.values(state.jobs))if(job.status==='running'){
    job.status=job.rows.some(r=>r.submittedAt&&!processed(r))?'needs-review':'paused';
    job.message='工作台已重启，进度已保留。继续前会核对采集箱，已提交商品不会再次点击采集。';
  }
  for(const job of Object.values(state.jobs)){
    job.tabs??={};job.ownedTabs??={};
    if(job.sourceFactsRead?.status==='running'){job.sourceFactsRead.status='interrupted';job.sourceFactsRead.message='来源资料补读被工作台重启中断，未自动重试。';}
    job.captcha??={maxAttempts:0,attempts:[]};
    for(const attempt of job.captcha.attempts)if(attempt.status==='requesting'){
      attempt.status='unknown';attempt.message='工作台重启前已发起验证码请求，计费结果未知，未自动重发。';
    }
  }
  save();
  const captcha=captchaClient||createSadCaptchaClient(configuration);
  const front=adapter||createTemuFrontBrowser(configuration,undefined,{captchaClient:captcha});
  const box=collectionAdapter||createCollectionBrowser(configuration);
  const plugin=pluginAdapter||createDxmPluginBrowser(configuration),pluginChecks=new Map();
  let active=null,creditCache=null;
  const available=()=>{if(active||isOtherBusy())throw fail('有任务正在运行，请等当前任务结束。',409);};
  const get=id=>{if(!Object.hasOwn(state.jobs,id))throw fail('免费采集任务不存在',404);return state.jobs[id];};
  function binding(erpKey){
    const erpConnection=preferences.erp(erpKey),browserConfig=preferences.browser(erpConnection.browserKey);
    if((erpConnection.provider||'dianxiaomi')!=='dianxiaomi'||!erpConnection.expectedAccount||browserConfig.type!=='chrome')throw fail('请先绑定谷歌浏览器和店小秘账号显示名，并在该浏览器安装店小秘采集插件。');
    return copy({erpConnection,browserConfig});
  }
  const pause=(job,status,message)=>{job.status=pauses.has(status)?status:'paused';job.message=message;save();};
  function persistSourceFacts(row,value){
    const facts=normalizeTemuSourceFacts(value,{goodsId:row.goodsId,sourceUrl:row.sourceUrl});
    if(row.sourceFacts&&JSON.stringify(row.sourceFacts)!==JSON.stringify(facts))row.sourceFactsHistory=[...(row.sourceFactsHistory||[]),row.sourceFacts].slice(-5);
    row.sourceFacts=facts;delete row.sourceFactsReadError;save();return facts;
  }
  async function inspectPlugin(bound,erpKey){
    let result;
    try{result=await plugin.check(bound);}catch{result={status:'unknown',message:'无法确认店小秘插件状态，请在绑定的采集窗口检查后重试。'};}
    const status=['ready','missing','disabled','browser-closed','unknown'].includes(result?.status)?result.status:'unknown';
    const value={erpKey,browserKey:bound.browserConfig.key,browserName:bound.browserConfig.name||'采集窗口',status,checkedAt:now(),
      message:String(result?.message||'无法确认店小秘插件状态，请在绑定的采集窗口检查后重试。').slice(0,700),
      name:String(result?.name||'').slice(0,100),version:String(result?.version||'').slice(0,80)};
    pluginChecks.set(erpKey,{binding:JSON.stringify(bound),value});return copy(value);
  }
  function pluginBinding({erpKey,jobId}={}){
    if(jobId){const job=get(jobId),bound=binding(job.erpKey);if(JSON.stringify(bound)!==JSON.stringify(job.binding))throw fail('账号或浏览器绑定已变化，请恢复原绑定后检查插件。',409);return {bound,erpKey:job.erpKey};}
    return {bound:binding(erpKey),erpKey};
  }
  async function pluginOperation(payload,open){
    available();const {bound,erpKey}=pluginBinding(payload);
    const view=payload?.view??'install';if(open&&!['install','manage','help'].includes(view))throw fail('插件页面类型无效。');
    active='plugin-setup';
    try{
      if(!open)return await inspectPlugin(bound,erpKey);
      pluginChecks.delete(erpKey);
      const result=await plugin.openSetup({...bound,view});
      return {erpKey,browserKey:bound.browserConfig.key,browserName:bound.browserConfig.name||'采集窗口',message:result.message};
    }finally{active=null;}
  }
  function captchaPreflight(job){
    if(job.stopRequested)return {allowed:false,message:'任务已暂停，未发起验证码请求。'};
    if(!job.captcha.maxAttempts)return {allowed:false,message:'本任务未启用自动验证，可在原浏览器完成验证后继续。'};
    if(!configuration.SADCAPTCHA_API_KEY)return {allowed:false,message:'请先在免费选品页保存 SadCaptcha API Key，再继续本任务。'};
    if(job.captcha.attempts.some(a=>['requesting','unknown'].includes(a.status)))return {allowed:false,message:'上一次验证码请求结果或计费未知，未自动重发。请核对 SadCaptcha 记录及原页面。'};
    if(job.captcha.attempts.length>=job.captcha.maxAttempts)return {allowed:false,message:`本任务已达到 ${job.captcha.maxAttempts} 次验证码调用上限，原页面和进度已保留。`};
    return {allowed:true,remaining:job.captcha.maxAttempts-job.captcha.attempts.length};
  }
  const args=(job,extra={})=>({...job.binding,keyword:job.keyword,limit:job.limit,...extra,tabs:job.tabs,ownedTabs:job.ownedTabs,
    onTarget:(kind,targetId,metadata)=>{
      job.tabs[kind]=targetId;
      if(metadata?.owned===true)job.ownedTabs[targetId]={kind,owned:true,sourceUrl:metadata.sourceUrl,...(metadata.goodsId?{goodsId:metadata.goodsId}:{}),createdAt:job.ownedTabs[targetId]?.createdAt||now()};
      save();
    },
    onTargetClosed:(kind,targetId)=>{
      if(job.ownedTabs[targetId]?.kind!==kind)return;
      job.closedTabs??=[];
      job.closedTabs.push({...job.ownedTabs[targetId],targetId,closedAt:now()});
      delete job.ownedTabs[targetId];
      if(job.tabs[kind]===targetId)delete job.tabs[kind];
      save();
    },
    isStopped:()=>!!job.stopRequested,
    captchaPreflight:()=>captchaPreflight(job),
    onCaptchaDiagnostic:value=>{
      const diagnostic=sanitizeCaptchaDiagnostic(value);if(!diagnostic)return;
      const goodsId=/^\d{6,32}$/.test(extra.goodsId||'')?String(extra.goodsId):null;
      const event={...diagnostic,message:getCaptchaDiagnosticMessage(diagnostic.code),observedAt:now(),stage:goodsId?'product':'search',...(goodsId?{goodsId}:{}),attemptsAtObservation:job.captcha.attempts.length};
      // Keep detection failures separate from paid request attempts. Only bounded,
      // allow-listed metadata is retained; no page text, images, URLs or secrets.
      job.captcha.diagnostics=[...(job.captcha.diagnostics||[]),event].slice(-20);save();
    },
    beforeCaptcha:({type,fingerprint})=>{
      const gate=captchaPreflight(job);if(!gate.allowed)throw fail(gate.message);
      if(!['puzzle','temu-arced-slide','semantic-items','temu-three-by-three'].includes(type)||!/^[a-f0-9]{64}$/.test(fingerprint||''))throw fail('验证码请求缺少可核对的类型或图像标识。');
      if(job.captcha.attempts.some(a=>a.fingerprint===fingerprint))throw fail('这张验证码已请求过识别，未重复扣费调用。请核对原页面。');
      const attempt={id:randomUUID(),type,fingerprint,status:'requesting',createdAt:now()};
      creditCache=null;
      job.captcha.attempts.push(attempt);job.message=`正在请求 SadCaptcha 识别（${job.captcha.attempts.length}/${job.captcha.maxAttempts}）。`;save();return attempt.id;
    },
    afterCaptcha:(id,result)=>{
      const attempt=job.captcha.attempts.find(a=>a.id===id);
      if(!attempt||!['answered','solved','not-passed','failed','unknown','cancelled'].includes(result.status))throw fail('验证码记录状态无效。');
      attempt.status=result.status;attempt.updatedAt=now();attempt.message=String(result.message||'').slice(0,500);
      if(Number.isFinite(result.durationMs))attempt.durationMs=result.durationMs;
      if(result.code)attempt.code=String(result.code).slice(0,80);
      save();
    }
  });
  function previousSubmission(job,row){
    return Object.values(state.jobs).flatMap(j=>j.id!==job.id&&j.binding.erpConnection.expectedAccount===job.binding.erpConnection.expectedAccount?j.rows:[]).find(r=>r.goodsId===row.goodsId&&r.submittedAt&&!processed(r));
  }
  async function verify(job,row,{resolveVerification=false,pauseOnFailure=true}={}){
    if(resolveVerification&&front.verifyChallenge){
      const pageState=await front.verifyChallenge(args(job,row));
      if(pageState.status!=='ready'){pause(job,pageState.status,pageState.message);return false;}
    }
    const result=await box.verify(args(job,row));
    row.checkedAt=now();row.status=result.status;row.evidence=result.evidence;row.error=result.error||null;save();
    if(result.status!=='verified'){if(pauseOnFailure)pause(job,'needs-review',result.error||'采集结果尚未确认，请只核对结果；不会重复点击采集。');return false;}
    return true;
  }
  async function prepareRow(job,row,retrySubmitted){
    if(row.submittedAt&&!retrySubmitted)return await verify(job,row,{resolveVerification:true})?'skip':'stop';
    const prior=row.submittedAt?null:previousSubmission(job,row);
    if(prior){
      row.submittedAt=prior.submittedAt;row.reusedSubmission=true;row.retryHistory=copy(prior.retryHistory||[]);save();
      return await verify(job,row)?'skip':'stop';
    }
    // Ordinary products go straight to the frontend plugin. Only an explicitly
    // requested replay of an uncertain submission requires a receipt lookup.
    if(!retrySubmitted){row.status='pending';row.error=null;save();return 'collect';}
    row.status='checking';save();
    const existing=await box.lookup(args(job,row));
    if(existing.status==='verified'){
      row.status='verified';row.reused=true;row.evidence=existing.evidence;row.checkedAt=now();save();return 'skip';
    }
    if(existing.status!=='absent'){
      row.status='needs-review';row.error=existing.error;pause(job,'needs-review',existing.error||'采集箱查询结果不明确，未点击插件。');return 'stop';
    }
    row.preflightAt=now();row.status=row.submittedAt?'needs-review':'pending';save();return 'collect';
  }
  async function run(job,{reconcileOnly=false,keepStopped=false,retrySubmittedGoodsId=null,deferGoodsIds=[],reopenFromSearch=false}={}){
    let currentRow=null;
    try{
      // Check the actual bound profile before search, paid verification, or box queries.
      // Reconciliation of previous submissions remains available without the plugin.
      const needsPlugin=!reconcileOnly&&(!job.searchCompleted||quotaUsed(job)<job.limit||retrySubmittedGoodsId||job.rows.some(r=>!processed(r)&&r.status!=='unavailable'&&!r.submittedAt));
      if(needsPlugin){
        if(job.stopRequested){pause(job,'paused','已暂停，进度已保存。');return;}
        job.message='正在检查采集窗口内的店小秘插件。';save();
        const result=await inspectPlugin(job.binding,job.erpKey);
        if(job.stopRequested){pause(job,'paused','已暂停，进度已保存。');return;}
        if(result.status!=='ready'){pause(job,'waiting-plugin',result.message);return;}
      }
      // Public ERP page account check happens before any Temu plugin submission.
      await box.check(args(job));
      if(reconcileOnly){
        for(const row of job.rows.filter(r=>r.submittedAt&&!processed(r))){if(job.stopRequested){pause(job,'paused','已暂停核对。');return;}if(!await verify(job,row))return;}
        job.status=job.rows.filter(finished).length>=job.limit?'completed':keepStopped?'stopped':'paused';
        job.message=job.status==='completed'?`本批处理完成：${job.rows.filter(finished).length} 件已确认入箱，${job.rows.filter(duplicateSkipped).length} 件前端提示重复已跳过。`:`已核对已提交商品，已确认 ${job.rows.filter(finished).length}/${job.limit} 件；重复商品不计入目标，点击继续补足剩余数量。`;save();return;
      }
      if(!job.searchCompleted){
        if(job.stopRequested){pause(job,'paused','已暂停，进度已保存。');return;}
        const found=await front.search(args(job,{keyword:job.keyword,limit:job.limit}));
        if(found.status!=='ready'){pause(job,found.status,found.message);return;}
        const seen=new Set();
        job.rows=found.products.flatMap(p=>{
          const goodsId=productIdentity(p.sourceUrl);if(!goodsId||seen.has(goodsId))return [];seen.add(goodsId);
          return [{goodsId,sourceUrl:p.sourceUrl,title:String(p.title||goodsId).slice(0,500),status:'pending'}];
        }).slice(0,job.limit);
        if(!job.rows.length){pause(job,'paused','当前页面没有可确认的商品链接，请在搜索页检查结果。');return;}
        job.searchCompleted=true;job.searchObservedAt=now();save();
      }
      const recording=job.collectionMode==='recording';
      if(recording){
        if(typeof front.returnToSearch!=='function')throw fail('当前浏览器执行器不支持返回搜索页，未开始连续采集。');
        job.message='正在从搜索结果逐件打开商品并点击店小秘采集；前端提示重复时跳过并继续下一件。';save();
      }
      let shortfallMessage='';
      for(let index=0;;index++){
        if(index>=job.rows.length){
          const remaining=job.limit-quotaUsed(job);
          if(remaining<=0)break;
          currentRow=null;
          if(job.stopRequested){pause(job,'paused','已暂停补充商品，进度已保存。');return;}
          job.message=`重复及不可用商品不计入目标，正在从原搜索结果补充 ${remaining} 件商品。`;save();
          const found=await front.search(args(job,{limit:remaining,excludeGoodsIds:job.rows.map(row=>row.goodsId),allowPartial:true}));
          if(found.status!=='ready'){
            if(found.status!=='paused'){pause(job,found.status,found.message);return;}
            shortfallMessage=found.message;break;
          }
          const seen=new Set(job.rows.map(row=>row.goodsId));
          const extra=(found.products||[]).flatMap(product=>{
            const goodsId=productIdentity(product.sourceUrl);if(!goodsId||seen.has(goodsId))return [];seen.add(goodsId);
            return [{goodsId,sourceUrl:product.sourceUrl,title:String(product.title||goodsId).slice(0,500),status:'pending'}];
          }).slice(0,remaining);
          if(!extra.length){shortfallMessage='当前搜索结果没有更多未处理商品，请检查搜索页后继续。';break;}
          job.rows.push(...extra);job.searchObservedAt=now();save();
        }
        const row=job.rows[index];
        if(processed(row)||row.status==='unavailable')continue;
        if(!row.submittedAt&&quotaUsed(job)>=job.limit)break;
        if(deferGoodsIds.includes(row.goodsId)){row.deferredAt=now();save();continue;}
        currentRow=row;
        if(job.stopRequested){pause(job,'paused','已暂停后续商品，已完成记录已保留。');return;}
        const retrySubmitted=retrySubmittedGoodsId===row.goodsId;
        const preparedRow=await prepareRow(job,row,retrySubmitted);if(preparedRow==='stop')return;if(preparedRow==='skip')continue;
        if(job.stopRequested){row.status='pending';pause(job,'paused','已暂停，未提交当前商品。');return;}
        const result=await front.collect(args(job,{...row,forceSearch:reopenFromSearch||retrySubmitted,onSourceFacts:value=>persistSourceFacts(row,value),beforeSubmit:()=>{
          if(job.stopRequested)throw fail('已暂停，未提交当前商品。');
          if(retrySubmitted){
            row.retryHistory??=[];
            row.retryHistory.push({submittedAt:now(),originalSubmittedAt:row.submittedAt,reason:reopenFromSearch?'修复商品进入路径后，从搜索结果重开；点击前采集箱来源查询已确认无记录':'明确请求重试；点击前采集箱来源查询已确认无记录'});
          }else row.submittedAt=now();
          row.status='submitted';row.error=null;delete row.pluginReceipt;save();
        }}));
        if(result.status==='skipped-duplicate'){
          const receipt=result.receipt,submittedAt=row.retryHistory?.at(-1)?.submittedAt||row.submittedAt;
          if(result.pluginStatus!=='duplicate'||!receipt||receipt.status!=='duplicate'||productIdentity(receipt.sourceUrl)!==row.goodsId||!Number.isFinite(Date.parse(receipt.observedAt))||submittedAt&&Date.parse(receipt.observedAt)<Date.parse(submittedAt))throw fail('前端重复提示无法对应当前商品，已保留现场。');
          row.status='skipped-duplicate';row.pluginReceipt=copy(receipt);row.error=null;row.skippedAt=now();
          job.message='店小秘前端提示该商品重复，已跳过，继续采集下一件。';save();
          if(recording){const returned=await front.returnToSearch(args(job,{...row,closeProduct:true}));if(returned.status!=='ready'){pause(job,returned.status,returned.message);return;}}
          continue;
        }
        if(result.status!=='submitted'){
          if(result.status==='unavailable'&&!row.submittedAt){
            row.status='unavailable';row.error=result.message;row.checkedAt=now();
            row.evidence={...result.evidence,sourceUrl:result.url||row.sourceUrl,message:result.message};save();continue;
          }
          // A missed extension receipt can still have a confirmed server record.
          // Query once through the bounded verifier; never replay the plugin click.
          if(!recording&&row.submittedAt&&result.status==='needs-review'&&Object.hasOwn(result,'pluginStatus')){
            if(!await verify(job,row))return;
            continue;
          }
          row.status=row.submittedAt?'needs-review':'pending';
          pause(job,row.submittedAt?'needs-review':result.status,result.message);return;
        }
        if(!row.submittedAt)throw fail('插件执行器没有保存提交记录，已停止。');
        if(recording){
          const receipt=result.receipt,submittedAt=row.retryHistory?.at(-1)?.submittedAt||row.submittedAt;
          if(result.pluginStatus!=='success'||!receipt||productIdentity(receipt.sourceUrl)!==row.goodsId||!Number.isFinite(Date.parse(receipt.observedAt))||Date.parse(receipt.observedAt)<Date.parse(submittedAt)){
            row.status='needs-review';row.error=result.message||'本次采集未取得可确认的成功提示，未继续下一件。';pause(job,'needs-review',row.error);return;
          }
          row.pluginReceipt=copy({...receipt,status:'success'});row.status='collected';row.error=null;
          job.message=`已收到 ${job.rows.filter(r=>r.pluginReceipt?.status==='success').length} 件采集成功提示，整批结束后核对采集箱。`;save();
          // Persist the receipt before leaving its page so a restart cannot replay it.
          const returned=await front.returnToSearch(args(job,{...row,closeProduct:true}));
          if(returned.status!=='ready'){pause(job,returned.status,returned.message);return;}
          continue;
        }
        if(!await verify(job,row))return;
      }
      if(recording){
        job.message='连续采集已结束，正在统一核对采集箱记录。';save();
        for(const row of job.rows.filter(r=>r.submittedAt&&!processed(r)&&!deferGoodsIds.includes(r.goodsId))){
          currentRow=row;
          if(job.stopRequested){pause(job,'paused','已暂停核对；成功提示和提交记录已保存。');return;}
          await verify(job,row,{pauseOnFailure:false});
        }
      }
      const confirmed=job.rows.filter(finished).length;
      const skipped=job.rows.filter(duplicateSkipped).length;
      const unavailable=job.rows.filter(r=>r.status==='unavailable').length;
      const unresolved=job.rows.length-confirmed-skipped-unavailable;
      job.status=confirmed>=job.limit&&!unresolved?'completed':unresolved?'needs-review':'paused';
      job.message=`已确认 ${confirmed} 件商品进入店小秘采集箱（目标 ${job.limit} 件）${skipped?`；${skipped} 件前端提示重复已跳过，不计入目标`:''}${unavailable?`；${unavailable} 件详情页暂不可用`:''}${unresolved?`；另有 ${unresolved} 件保留提交记录待核对`:''}${job.status==='completed'?'。下一步：批量认领到目标店铺，选择分类并补齐必填项，转入待发布':`。尚缺 ${Math.max(0,job.limit-confirmed)} 件。${shortfallMessage||'请核对已有提交后继续，未重复点击采集。'}`}`;save();
    }catch(error){
      const uncertain=currentRow?.submittedAt&&!processed(currentRow)?currentRow:null;
      if(uncertain){uncertain.status='needs-review';uncertain.error=error.message;}
      pause(job,uncertain?'needs-review':'paused',error.message);
    }finally{active=null;}
  }
  function launch(job,options){job.status='running';job.message='正在检查浏览器与采集进度。';job.stopRequested=false;save();active=job.id;void run(job,options);return copy(job);}
  return {
    isBusy:()=>!!active,
    view:()=>({busy:!!active,otherBusy:!!isOtherBusy(),jobs:copy(Object.values(state.jobs).reverse()),pluginChecks:[...pluginChecks].flatMap(([erpKey,item])=>{try{return item.binding===JSON.stringify(binding(erpKey))?[copy(item.value)]:[];}catch{return [];}})}),
    checkPlugin:payload=>pluginOperation(payload,false),
    openPlugin:payload=>pluginOperation(payload,true),
    captchaStatus:()=>({configured:!!configuration.SADCAPTCHA_API_KEY,provider:'sadcaptcha',credits:creditCache&&creditCache.key===configuration.SADCAPTCHA_API_KEY?creditCache.credits:null,checkedAt:creditCache&&creditCache.key===configuration.SADCAPTCHA_API_KEY?creditCache.checkedAt:null,usage:{attempts:Object.values(state.jobs).reduce((n,j)=>n+j.captcha.attempts.length,0)}}),
    async checkCaptcha(){const key=configuration.SADCAPTCHA_API_KEY;if(!key)throw fail('请先保存 SadCaptcha API Key。');const result=await captcha.credits();creditCache={key,credits:result.credits,checkedAt:now()};return {configured:true,provider:'sadcaptcha',credits:result.credits,checkedAt:creditCache.checkedAt};},
    get:id=>copy(get(id)),
    async readSourceFacts(id,{goodsIds}={}){
      available();const job=get(id);
      if(JSON.stringify(binding(job.erpKey))!==JSON.stringify(job.binding))throw fail('浏览器或账号绑定已变化，请恢复原绑定再补读来源资料。',409);
      if(!Array.isArray(goodsIds)||!goodsIds.length||goodsIds.length>30||new Set(goodsIds).size!==goodsIds.length||goodsIds.some(goodsId=>!job.rows.some(row=>row.goodsId===goodsId&&finished(row)&&productIdentity(row.sourceUrl)===goodsId)))throw fail('仅可补读本批已确认入箱且来源身份一致的商品，请选择1—30件。');
      if(typeof front.readSourceFacts!=='function')throw fail('当前浏览器执行器不支持只读补读 Temu 来源资料。');
      active=job.id;
      const batch=job.sourceFactsRead={status:'running',startedAt:now(),goodsIds:[...goodsIds],completed:0,issues:[],stopRequested:false};save();
      try{
        for(const goodsId of goodsIds){
          if(batch.stopRequested){batch.status='paused';batch.message='已暂停来源资料补读，原采集任务和已读资料已保留。';break;}
          const row=job.rows.find(item=>item.goodsId===goodsId);
          try{
            const result=await front.readSourceFacts({...args(job,{...row,onSourceFacts:value=>persistSourceFacts(row,value)}),isStopped:()=>batch.stopRequested,
              captchaPreflight:()=>({allowed:false,message:'来源资料补读不调用自动验证码。'}),beforeCaptcha:()=>{throw fail('来源资料补读不调用自动验证码。');}});
            if(result.sourceFacts)persistSourceFacts(row,result.sourceFacts);
            if(result.status!=='ready'||!result.sourceFacts){
              const message=String(result.message||'未取得可核对的 Temu 来源资料，原页面已保留。').slice(0,700);
              if(!result.sourceFacts)persistSourceFacts(row,{goodsId:row.goodsId,sourceUrl:row.sourceUrl,observedAt:now(),categoryPath:[],selectedVariant:{attributes:[],selectionComplete:false},priceCandidates:[]});
              row.sourceFactsReadError=message;batch.issues.push({goodsId,message});batch.status='incomplete';break;
            }
            batch.completed++;
            if(row.sourceFacts.status!=='ready')batch.issues.push({goodsId,message:row.sourceFacts.issues.join('；')});
          }catch(error){
            persistSourceFacts(row,{goodsId:row.goodsId,sourceUrl:row.sourceUrl,observedAt:now(),categoryPath:[],selectedVariant:{attributes:[],selectionComplete:false},priceCandidates:[]});
            row.sourceFactsReadError=String(error.message||'来源资料补读失败').slice(0,700);batch.issues.push({goodsId,message:row.sourceFactsReadError});batch.status='incomplete';break;
          }finally{save();}
        }
        if(batch.status==='running')batch.status=batch.issues.length?'incomplete':'completed';
        batch.finishedAt=now();save();return copy(job);
      }finally{active=null;}
    },
    start(payload){
      const {requestId,erpKey}=payload,keyword=String(payload.keyword||'').trim(),limit=Number(payload.limit??3),captchaMaxAttempts=Number(payload.captchaMaxAttempts??2);
      const collectionMode=payload.collectionMode??'verified';
      if(!['verified','recording'].includes(collectionMode))throw fail('采集执行方式无效。');
      if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId||'')||!keyword||keyword.length>200||!Number.isInteger(limit)||limit<1||limit>30)throw fail('请输入一个关键词（最多200字），采集数量为1—30件。');
      if(!Number.isInteger(captchaMaxAttempts)||captchaMaxAttempts<0||captchaMaxAttempts>30)throw fail('验证码调用上限为0—30次，0表示手动验证。');
      if(Object.hasOwn(state.jobs,requestId)){
        const job=get(requestId);if(job.keyword!==keyword||job.limit!==limit||job.erpKey!==erpKey||(payload.captchaMaxAttempts!==undefined&&job.captcha.maxAttempts!==captchaMaxAttempts)||(payload.collectionMode!==undefined&&(job.collectionMode??'verified')!==collectionMode))throw fail('任务编号已用于其他参数，请刷新核对原任务。',409);return copy(job);
      }
      available();
      if(Object.values(state.jobs).some(j=>!['completed','stopped'].includes(j.status)))throw fail('请先继续或结束当前未完成的免费采集任务。',409);
      const job={id:requestId,keyword,limit,erpKey,collectionMode,binding:binding(erpKey),createdAt:now(),tabs:{},ownedTabs:{},rows:[],status:'pending',captcha:{maxAttempts:captchaMaxAttempts,attempts:[]}};
      state.jobs[requestId]=job;return launch(job);
    },
    resume(id,{reconcileOnly=false,retrySubmittedGoodsId=null,deferGoodsIds=[],retryUnavailable=false,reopenFromSearch=false,collectionMode}={}){
      available();const job=get(id);
      if(collectionMode!==undefined&&(!['verified','recording'].includes(collectionMode)||reconcileOnly))throw fail('采集执行方式无效；只核对结果不能改变执行方式。');
      if(JSON.stringify(binding(job.erpKey))!==JSON.stringify(job.binding))throw fail('浏览器或账号绑定已变化，请恢复原绑定再继续核对。');
      if(job.status==='completed')return copy(job);
      if(job.status==='stopped'&&!reconcileOnly)throw fail('该任务已结束，只能核对已有提交。');
      if(typeof retryUnavailable!=='boolean'||typeof reopenFromSearch!=='boolean'||reconcileOnly&&(retryUnavailable||reopenFromSearch)||reopenFromSearch&&!retrySubmittedGoodsId)throw fail('恢复商品入口参数无效。');
      if(!Array.isArray(deferGoodsIds)||deferGoodsIds.some(id=>{const row=job.rows.find(r=>r.goodsId===id);return reconcileOnly||id===retrySubmittedGoodsId||!row?.submittedAt||!row.checkedAt||processed(row);}))throw fail('只允许暂缓已经核对但尚未确认入箱的提交，不能跳过未提交商品。');
      if(retrySubmittedGoodsId){
        const row=job.rows.find(r=>r.goodsId===retrySubmittedGoodsId);
        if(reconcileOnly||!['needs-review','paused'].includes(job.status)||!row?.submittedAt||processed(row)||(row.retryHistory?.length||0)>=(reopenFromSearch?2:1))throw fail('已有提交的恢复次数已用完，原始记录保留；仅修复搜索入口后可额外重开一次。');
      }
      if(retryUnavailable)for(const row of job.rows.filter(r=>r.status==='unavailable'&&!r.submittedAt)){
        row.pageObservations??=[];row.pageObservations.push({checkedAt:row.checkedAt,status:row.status,error:row.error,evidence:row.evidence});
        row.status='pending';row.error=null;delete row.evidence;
      }
      if(collectionMode!==undefined)job.collectionMode=collectionMode;
      return launch(job,{reconcileOnly,keepStopped:job.status==='stopped',retrySubmittedGoodsId,deferGoodsIds,reopenFromSearch});
    },
    stop(id){const job=get(id);if(active===id&&job.sourceFactsRead?.status==='running'){job.sourceFactsRead.stopRequested=true;job.sourceFactsRead.message='将暂停来源资料补读，原采集任务状态保持不变。';}else if(job.status==='running'){job.stopRequested=true;job.message='将暂停后续商品；正在提交的商品先核对结果。';}else if(job.status!=='completed'){job.status='stopped';job.message='任务已结束，已提交商品仍可只核对结果。';}save();return copy(job);},
    async open(id,kind){available();const job=get(id);if(JSON.stringify(binding(job.erpKey))!==JSON.stringify(job.binding))throw fail('账号或浏览器绑定已变化，请恢复原绑定。');active=job.id;try{const current=job.rows.find(r=>!finished(r));return kind==='collection'?await box.open(args(job)):await front.open(args(job,{keyword:job.keyword,sourceUrl:current?.sourceUrl,kind:current&&job.tabs.product?'product':'search'}));}finally{active=null;}}
  };
}
