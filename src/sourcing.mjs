import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createGeekbiClient,normalizeSearch,temuGoodsId,GEEKBI_PRICES,interpretSourcingPrompt} from './geekbi.mjs';
import {createCollectionBrowser} from './collection-browser.mjs';

export const SOURCING_REVISION='geekbi-collection-20261117-v1';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(id);
const copy=value=>structuredClone(value);

// Search snapshots and submission intent survive restarts. Ambiguous writes are never replayed.
export function createSourcing({directory,configuration,preferences,isOtherBusy=()=>false,client,adapter}){
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'state.json');
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{searches:{},batches:{},sites:[]};
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2));fs.renameSync(file+'.tmp',file);};
  for(const s of Object.values(state.searches))if(s.status==='running'){s.status='needs-review';s.error='查询被中断，请核对极鲸云调用记录；不会自动重发。';}
  for(const b of Object.values(state.batches))if(b.status==='running'){
    b.status='paused';for(const r of b.rows)if(['resolving','submitting'].includes(r.status)){r.status=r.submittedAt?'needs-review':'blocked';r.error='工作台被中断，请核对当前页面和采集记录。';}
  }
  save();
  const request=client||createGeekbiClient(configuration);
  const browser=adapter||createCollectionBrowser(configuration);
  let active=null;
  const available=()=>{if(active||isOtherBusy())throw fail('有任务正在运行，请等当前任务结束。',409);};
  const search=id=>{const value=state.searches[id];if(!value)throw fail('选品记录不存在',404);return value;};
  const batch=id=>{const value=state.batches[id];if(!value)throw fail('采集批次不存在',404);return value;};
  const binding=erpKey=>{
    const erpConnection=preferences.erp(erpKey);
    if((erpConnection.provider||'dianxiaomi')!=='dianxiaomi')throw fail('本阶段仅支持店小秘采集箱');
    if(!erpConnection.expectedAccount)throw fail('请先在连接设置填写店小秘账号显示名，用于防止采集到错误账号');
    return copy({erpConnection,browserConfig:preferences.browser(erpConnection.browserKey)});
  };
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
    if(state.searches[requestId]){const s=search(requestId);if(s.fingerprint!==fingerprint)throw fail('同一个查询编号不能修改条件',409);return copy(s);}
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
    const {requestId,searchId,erpKey,goodsIds}=payload;
    if(!idOK(requestId))throw fail('批次编号无效');
    if(!Array.isArray(goodsIds)||!goodsIds.length||goodsIds.length>20||new Set(goodsIds).size!==goodsIds.length)throw fail('每批请选择1—20件商品');
    const fingerprint=JSON.stringify({searchId,erpKey,goodsIds});
    if(state.batches[requestId]){const b=batch(requestId);if(b.fingerprint!==fingerprint)throw fail('同一批次编号不能修改商品或账号',409);return copy(b);}
    available();const s=search(searchId),bound=binding(erpKey);
    const proven=Object.values(state.batches).some(b=>b.binding.erpConnection.key===erpKey&&b.rows.some(r=>r.status==='verified'));
    if(!proven&&goodsIds.length!==1)throw fail('这个账号尚未完成首次入箱验证，请先选择1件商品。确认成功后可批量采集。');
    const rows=goodsIds.map(goodsId=>{
      const r=s.rows.find(r=>r.goodsId===goodsId);if(!r)throw fail('所选商品不属于当前选品结果');
      if(Number(r.siteId)!==Number(s.site.siteId))throw fail('商品返回站点与筛选站点不一致，已停止采集');
      const previous=Object.values(state.batches).flatMap(b=>b.binding.erpConnection.key===erpKey?b.rows:[]).find(r=>r.goodsId===goodsId&&(r.submittedAt||r.status==='verified'));
      if(previous)throw fail(`商品 ${goodsId} 已有提交记录，请先核对已有批次，避免重复采集。`,409);
      return {goodsId,title:r.raw.goodsName||goodsId,status:'pending',sourceUrl:r.sourceUrl};
    });
    const b={id:requestId,fingerprint,searchId,binding:bound,site:copy(s.site),status:'running',createdAt:now(),rows};state.batches[b.id]=b;active=b.id;save();
    (async()=>{
      for(const row of b.rows){
        if(b.stopRequested){b.status='paused';b.error='已按要求停止，未提交后续商品。';save();return;}
        try{
          row.status='resolving';save();
          if(!row.sourceUrl){const r=await browser.resolve({...bound,goodsId:row.goodsId,site:b.site});if(temuGoodsId(r.sourceUrl)!==row.goodsId)throw fail('没有找到匹配商品ID的 Temu 原始详情链接');Object.assign(row,r);save();}
          const result=await browser.collect({...bound,goodsId:row.goodsId,sourceUrl:row.sourceUrl,beforeSubmit:()=>{row.submittedAt=now();row.status='submitting';save();}});
          if(!['verified','failed','needs-review'].includes(result.status))throw fail('采集结果无法确认');
          Object.assign(row,result,{checkedAt:now()});save();
          if(row.status!=='verified'){b.status='paused';b.error='已停止本批后续商品，请先处理当前条目的采集结果。';save();return;}
        }catch(e){row.status=row.submittedAt?'needs-review':'blocked';row.error=e.message;b.status='paused';b.error='已停止本批后续商品。';save();return;}
      }
      b.status='completed';b.completedAt=now();save();
    })().catch(e=>{b.status='paused';b.error=e.message;save();}).finally(()=>{active=null;});
    return copy(b);
  }
  async function reconcile(id){
    available();const b=batch(id);const current=binding(b.binding.erpConnection.key);
    if(JSON.stringify(current)!==JSON.stringify(b.binding))throw fail('ERP绑定已变化，请在原账号采集箱核对记录');
    active=b.id;
    try{for(const row of b.rows.filter(r=>r.sourceUrl&&r.status!=='verified')){const result=await browser.verify({...b.binding,goodsId:row.goodsId,sourceUrl:row.sourceUrl});Object.assign(row,result,{checkedAt:now()});save();}if(b.rows.every(r=>r.status==='verified'))b.status='completed';save();return copy(b);}finally{active=null;}
  }
  async function open(erpKey){available();const bound=binding(erpKey);active='open';try{return await browser.open(bound);}finally{active=null;}}
  return {isBusy:()=>!!active,sites,categories,startSearch,startBatch,reconcile,open,
    stop:id=>{const b=batch(id);if(b.status==='running'){b.stopRequested=true;save();}return copy(b);},
    parse:async prompt=>{available();active='parse';try{return await interpretSourcingPrompt(prompt,configuration);}finally{active=null;}},
    getSearch:id=>copy(search(id)),getBatch:id=>copy(batch(id)),
    view:()=>({revision:SOURCING_REVISION,configured:!!configuration.GB_APP_KEY&&!!configuration.GB_APP_SECRET,busy:!!active,sites:copy(state.sites),prices:GEEKBI_PRICES,searches:Object.values(state.searches).map(s=>({id:s.id,status:s.status,createdAt:s.createdAt,filters:s.filters,count:s.rows.length})).reverse(),batches:Object.values(state.batches).map(b=>({id:b.id,status:b.status,createdAt:b.createdAt,erpName:b.binding.erpConnection.name,rows:copy(b.rows),error:b.error})).reverse()})};
}
