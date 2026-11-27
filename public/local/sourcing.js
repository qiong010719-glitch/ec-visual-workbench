(() => {
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={running:'运行中',pending:'等待','fetching-detail':'获取极鲸云详情','converting-price':'换算美元价格','preparing-file':'生成导入文件','ready-to-import':'等待文件导入',resolving:'旧版链接核对',submitting:'已发起导入',verified:'已确认入箱',claiming:'正在认领到店铺',claimed:'已认领到店铺','preparing-listing':'填写店铺必填项','verifying-reuse':'核对该店已有草稿',prepared:'草稿准备完成',failed:'失败',blocked:'需处理',paused:'已停止后续',completed:'完成',partial:'部分结果','needs-review':'待核对'};
  let token,settings,state,current,selected=new Set(),categories=[],chosenCategories=new Map(),polling=false;
  let storeState={erpKey:'',stores:[],profiles:{}},selectedStoreKeys=new Set(),storesLoading=false,defaultsLoading=false,storeRequest=0;
  let defaultsQueue=[],defaultsTask=null,loadingStore=null,packageDependencyRetries=new Set(),pendingSubmission=null;
  const lockedButtons=new Set(),submissionStorageKey='sourcing-pending-submission';
  const serviceBusy=()=>!!(state?.busy||state?.otherBusy);
  $('notice').insertAdjacentHTML('afterend','<p id="otherTaskStatus" class="muted small" role="status" aria-live="polite" hidden></p>');
  try{const saved=JSON.parse(sessionStorage.getItem(submissionStorageKey));if(saved&&['searches','batches'].includes(saved.kind)&&typeof saved.id==='string')pendingSubmission={...saved,status:'uncertain'};}catch{}
  function rememberSubmission(value){pendingSubmission=value;try{if(value)sessionStorage.setItem(submissionStorageKey,JSON.stringify({kind:value.kind,id:value.id}));else sessionStorage.removeItem(submissionStorageKey);}catch{}}
  const api=async(route,p)=>{const r=await fetch('/api/'+route,p===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(p)});let v;try{v=await r.json();}catch{throw Object.assign(new Error('服务响应无法读取，请先核对原请求记录'),{status:r.status,uncertain:true});}if(!r.ok)throw Object.assign(new Error(v.error||'请求失败'),{status:r.status});return v;};
  const message=(text,error=false)=>{$('notice').hidden=false;$('notice').className=error?'error':'';$('notice').textContent=text;};
  const action=async(button,fn)=>{if(lockedButtons.has(button))return;lockedButtons.add(button);button.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{lockedButtons.delete(button);button.disabled=false;updateSelection();}};
  async function submitRequest(kind,payload){
    if(pendingSubmission)throw new Error('上一条提交仍在核对中，请先刷新原记录，不会重复提交。');
    if(serviceBusy())throw new Error(state?.otherBusy?'工作台有做图或其他上架任务正在运行，结束后会自动恢复查询和采集。':'有任务正在运行，请等当前任务结束。');
    const submission={kind,id:payload.requestId,status:'sending'};rememberSubmission(submission);updateSelection();
    try{const record=await api('sourcing/'+kind,payload);if(state&&record.status==='running')state.busy=true;rememberSubmission(null);return record;}
    catch(error){
      if(error.status>=400&&error.status<500&&!error.uncertain){rememberSubmission(null);await refresh().catch(()=>{});throw error;}
      submission.status='uncertain';
      await refresh().catch(()=>{});
      if(submission.record)return submission.record;
      throw new Error('提交响应不明确，正在只读核对原'+(kind==='searches'?'查询':'批次')+'记录；未自动重新提交或扣费。可点击“刷新记录”继续核对。');
    }finally{updateSelection();}
  }
  const safeUrl=(value,hosts)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.some(h=>u.hostname===h||h[0]==='.'&&u.hostname.endsWith(h))?u.href:'';}catch{return '';}};
  const number=v=>v===undefined||v===null?'—':String(v);
  const date=v=>v?new Date(v).toLocaleString('zh-CN'):'—';
  const numericFilters=['priceMin','priceMax','monthSoldMin','monthSoldMax','goodsScoreMin','similarNumMax'];
  const formFilters=()=>({...Object.fromEntries(new FormData($('searchForm'))),catIds:[...chosenCategories.keys()]});
  const filterSignature=f=>JSON.stringify({keywords:[...new Set((Array.isArray(f.keywords)?f.keywords:String(f.keywords||'').split(/[\n；;]+/)).map(x=>String(x).trim()).filter(Boolean))],siteId:Number(f.siteId),size:Number(f.size||10),catIds:(f.catIds||[]).map(Number).sort((a,b)=>a-b),...Object.fromEntries(numericFilters.map(k=>[k,f[k]===undefined||f[k]===null||f[k]===''?null:Number(f[k])])),sort:f.sort||'monthSold',order:f.order||'desc',matchMode:Number(f.matchMode??2)});
  const hasDraftChanges=()=>!!current&&filterSignature(formFilters())!==filterSignature(current.filters);
  function currencyLabels(){const currency=state?.sites.find(s=>String(s.siteId)===$('site').value)?.currency||'站点币种';$('priceMinLabel').textContent=`价格下限（${currency}）`;$('priceMaxLabel').textContent=`价格上限（${currency}）`;}
  function restoreFilters(search){
    const f=search.filters,form=$('searchForm');
    for(const key of ['keywords','siteId','size',...numericFilters,'sort','order','matchMode'])form.elements[key].value=key==='keywords'?f.keywords.join('\n'):key==='matchMode'?f.matchMode??2:f[key]??'';
    chosenCategories=new Map((f.catIds||[]).map(id=>[id,chosenCategories.get(id)||`已选类目 ${id}`]));renderChips();currencyLabels();
  }
  function renderSites(){const prior=$('site').value;$('site').innerHTML='<option value="">请选择站点</option>'+(state.sites||[]).map(s=>`<option value="${esc(s.siteId)}">${esc(s.cnName||s.name)} · ${esc(s.currency)}</option>`).join('');if((state.sites||[]).some(s=>String(s.siteId)===prior))$('site').value=prior;currencyLabels();}
  const activeStores=()=>storeState.erpKey===$('erp').value?storeState.stores.filter(s=>selectedStoreKeys.has(s.key)&&!s.disabled):[];
  const profileFor=store=>storeState.profiles?.[store.key];
  const packageValues=profile=>{const value=profile?.defaults?.packageDefaults,keys=['lengthCm','widthCm','heightCm','weightKg'];return value&&keys.every(k=>(typeof value[k]==='number'||typeof value[k]==='string'&&/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value[k].trim()))&&Number.isFinite(Number(value[k]))&&Number(value[k])>0)?keys.map(k=>Number(value[k])):null;};
  const isStoreLoading=store=>loadingStore?.request===storeRequest&&loadingStore.erpKey===storeState.erpKey&&loadingStore.key===store.key;
  function storeReadiness(){
    const stores=activeStores(),missing=stores.filter(s=>!packageValues(profileFor(s))||profileFor(s)?.defaults?.ready===false||profileFor(s)?.issues?.length),valid=stores.filter(s=>!missing.includes(s));
    const first=valid[0],different=first?valid.filter(s=>JSON.stringify(packageValues(profileFor(s)))!==JSON.stringify(packageValues(profileFor(first)))):[];
    return {stores,missing,different,reference:first,ready:!!stores.length&&!missing.length&&!different.length};
  }
  const platformName=value=>({temu:'Temu半托管',tiktok:'TikTok'}[value]||value);
  const storeName=store=>`${platformName(store.platform)} · ${store.name}${store.site?' · '+store.site:''}`;
  const defaultText=value=>value&&typeof value==='object'?value.path?.length?value.path.join(' > '):value.label||value.name||'未提供':value||'未提供';
  function updateSelection(){
    const dirty=hasDraftChanges(),reusable=new Set(state?.reusableImports?.[$('erp').value]||[]),reused=[...selected].filter(id=>reusable.has(id)).length,cached=[...selected].filter(id=>!reusable.has(id)&&state?.details?.[id]?.status==='ready').length,points=(selected.size-cached-reused)*(state?.prices?.rawDetail??50),submitting=!!pendingSubmission,busy=serviceBusy()||storesLoading||defaultsLoading||submitting,ready=storeReadiness();
    $('otherTaskStatus').hidden=!state?.otherBusy;$('otherTaskStatus').textContent=state?.otherBusy?'工作台有做图或其他上架任务正在运行。查询、采集和店铺操作暂不可用，任务结束后会自动恢复；已选商品和店铺会保留。':'';
    $('collect').textContent=`采集并认领（${selected.size}件 · ${ready.stores.length}家店铺）`;
    $('importCost').textContent=`极鲸云原始详情预计 ${points} 点 · 按商品计费，不按店铺数量翻倍 · ${reused} 件复用当前账号已入箱记录，${cached} 件复用已保存详情。实际扣点以接口回执为准；详情获取成功后，后续步骤失败也不代表详情费用退回。`;
    $('collect').disabled=dirty||!selected.size||!$('erp').value||!ready.ready||busy;$('searchButton').disabled=busy;$('searchHistory').disabled=submitting;
    $('syncStores').disabled=!$('erp').value||busy;$('loadStoreDefaults').disabled=!ready.stores.length||busy;$('openCollection').disabled=!$('erp').value||busy;
    document.querySelectorAll('#targetStores [data-store]').forEach(input=>{input.disabled=serviceBusy()||storesLoading||submitting||!!storeState.stores.find(s=>s.key===input.dataset.store)?.disabled;});$('erp').disabled=busy;
    $('selectAll').checked=!!current?.rows.length&&selected.size===Math.min(20,current.rows.length);$('selectAll').disabled=dirty||!current?.rows.length||submitting||serviceBusy();document.querySelectorAll('#goods [data-goods]').forEach(input=>{input.disabled=dirty||submitting||serviceBusy();});
    for(const id of ['parse','loadSites','rootCategories','childCategories'])$(id).disabled=busy;
    $('draftNotice').hidden=!dirty;$('draftNotice').textContent=dirty?'筛选条件已修改。下方仍是上次查询结果，请点击“查询商品”获取新结果。':'';
    for(const button of lockedButtons)button.disabled=true;
  }
  function erpBinding(){const e=settings.erpConnections.find(e=>e.key===$('erp').value),b=settings.browsers.find(b=>b.key===e?.browserKey);$('erpBinding').textContent=e?`账号：${e.expectedAccount||'尚未填写，请先到连接设置填写'} · 浏览器：${b?.name||'未绑定'}`:'请先在连接设置添加店小秘账号。';updateSelection();}
  function renderStoreChoices(){
    $('targetStores').innerHTML=storeState.stores.map(s=>`<label class="store-option ${selectedStoreKeys.has(s.key)?'selected':''}"><input type="checkbox" data-store="${esc(s.key)}" ${selectedStoreKeys.has(s.key)?'checked':''} ${s.disabled?'disabled':''} aria-label="认领到 ${esc(storeName(s))}"><span><strong>${esc(s.name)}</strong><small class="muted">${esc(platformName(s.platform))}${s.site?' · '+esc(s.site):''}${s.disabled?' · 已停用':''}</small></span></label>`).join('')||`<p class="muted">${storesLoading?'正在读取店铺列表…':$('erp').value?'还没有已同步店铺，请点击“同步店小秘店铺”。':'请先在连接设置添加店小秘账号。'}</p>`;
  }
  function renderStoreDefaults(){
    const readiness=storeReadiness(),stores=readiness.stores,issues=[];
    $('targetStoresSummary').textContent=stores.length?`已选 ${stores.length} 家店铺：${stores.map(storeName).join('、')}`:'尚未选择目标店铺。';
    $('storeDefaults').innerHTML=stores.map(target=>{
      const profile=profileFor(target),d=profile?.defaults,p=d?.packageDefaults,loading=isStoreLoading(target),pending=defaultsQueue.some(e=>e.request===storeRequest&&e.key===target.key),valid=packageValues(profile)&&!profile?.issues?.length&&d?.ready!==false;
      const source=safeUrl(d?.source?.url,['www.dianxiaomi.com']),packageSource=safeUrl(d?.source?.packageSource?.url||d?.source?.url,['www.dianxiaomi.com']);
      const problems=[...(profile?.issues||[])];if(d&&!packageValues(profile))problems.push('未读取到有效的统一包裹长宽高和重量');if(d?.ready===false&&!problems.length)problems.push('店铺默认配置未就绪');for(const problem of problems)issues.push(`${storeName(target)}：${problem}`);
      return `<article class="store-default-card" data-store-default="${esc(target.key)}"><div class="store-card-head"><strong>${esc(storeName(target))}</strong><span class="state ${valid?'verified':''}">${loading?'读取中':pending?'排队读取':valid?'默认值已就绪':problems.length?'缺少配置':'未读取'}</span></div>${d?`<p class="small"><strong>目标站点：</strong>${esc(d.site||target.site||target.authorizationSite||"尚未提供")}</p><p><strong>包裹预填值：</strong>${p?`${esc(p.lengthCm)} × ${esc(p.widthCm)} × ${esc(p.heightCm)} cm · ${esc(p.weightKg)} kg`:'尚缺参数'}${packageSource?` · <a href="${esc(packageSource)}" target="_blank" rel="noreferrer">查看包裹参数来源 ↗</a>`:''}</p><p class="small"><strong>仓库：</strong>${esc(defaultText(d.warehouse))}${d.platform==='tiktok'?'<span class="muted"> · 当前店铺表单无需填写运费模板和发货时效</span>':` · <strong>运费模板：</strong>${esc(defaultText(d.shippingTemplate))} · <strong>发货时效：</strong>${esc(defaultText(d.dispatch))}`}</p><p class="small"><strong>已验证分类：</strong>${esc(defaultText(d.category))} · 读取时间：${esc(date(profile.checkedAt))}${source?` · <a href="${esc(source)}" target="_blank" rel="noreferrer">查看店铺参数来源 ↗</a>`:''}</p>`:`<p class="muted small">${loading?'正在读取本店的包裹和物流设置…':pending?'等待前一家店铺读取完成。':problems.length?problems.map(esc).join('；'):'勾选店铺后会自动读取默认参数。'}</p>`}</article>`;
    }).join('')||'<p class="muted">请选择商品要认领到的店铺，可同时勾选多家。</p>';
    if(stores.length)$('storeDefaults').insertAdjacentHTML('beforeend','<p class="muted small">包裹数值取自已有模板，并非各商品实测值；所有所选店铺的长宽高和重量必须一致，才会统一预填至本批商品和SKU。实际发布前需与实际包裹配置一致。分类和属性会按每件商品的来源资料分别匹配。</p>');
    if(readiness.different.length)issues.push(`包裹预填值不一致：${readiness.different.map(storeName).join('、')}与${storeName(readiness.reference)}不同。请统一各店默认参数后重新读取。`);
    $('storeIssues').innerHTML=issues.map(issue=>`<p>${esc(issue)}</p>`).join('');$('storeIssues').hidden=!issues.length;
    $('collectRequirement').textContent=!stores.length?'先同步并勾选至少一家目标店铺。':defaultsLoading?'正在逐店读取默认参数，请等待全部所选店铺就绪。':readiness.missing.length?`尚未就绪：${readiness.missing.map(storeName).join('、')}。请读取并补齐这些店铺的默认配置。`:readiness.different.length?'所选店铺的包裹默认值不一致，暂不能开始采集。':`${stores.length} 家店铺已就绪，包裹默认值一致；采集后将逐店认领并检查必填项。`;
    updateSelection();
  }
  async function loadStores(refresh=false){
    const erpKey=$('erp').value,request=++storeRequest,previous=storeState.erpKey===erpKey?new Set(selectedStoreKeys):new Set();
    selectedStoreKeys.clear();defaultsQueue=[];packageDependencyRetries.clear();storesLoading=true;storeState={erpKey,stores:[],profiles:{}};renderStoreChoices();renderStoreDefaults();
    try{
      if(!erpKey){$('targetStoreStatus').textContent='';return;}
      let result=await api('sourcing/stores',{erpKey,refresh});if(refresh)result=await api('sourcing/stores',{erpKey});
      if(request!==storeRequest||erpKey!==$('erp').value)return;
      storeState={erpKey,...result};selectedStoreKeys=new Set(storeState.stores.filter(s=>previous.has(s.key)&&!s.disabled).map(s=>s.key));
      $('targetStoreStatus').textContent=storeState.stores.length?`已同步 ${storeState.stores.length} 家店铺 · ${date(storeState.observedAt)}`:'还没有已同步的店铺。点击“同步店小秘店铺”读取当前账号的真实店铺。';
    }catch(error){if(request===storeRequest)$('targetStoreStatus').textContent='店铺读取失败：'+error.message;throw error;}
    finally{if(request===storeRequest){storesLoading=false;renderStoreChoices();renderStoreDefaults();queueStoreDefaults();}}
  }
  function queuePackageDependents(){
    const hasPackageSource=activeStores().some(s=>s.platform==='temu'&&packageValues(profileFor(s))&&profileFor(s)?.defaults?.ready!==false&&!profileFor(s)?.issues?.length);
    if(!hasPackageSource)return;
    for(const target of activeStores()){
      const dependencyMissing=target.platform==='tiktok'&&!profileFor(target)?.defaults&&profileFor(target)?.issues?.some(issue=>String(issue).includes('需要先确定一组统一包裹参数'));
      if(!dependencyMissing||packageDependencyRetries.has(target.key)||isStoreLoading(target)||defaultsQueue.some(e=>e.request===storeRequest&&e.key===target.key))continue;
      packageDependencyRetries.add(target.key);storeState.profiles={...storeState.profiles,[target.key]:null};defaultsQueue.push({erpKey:storeState.erpKey,key:target.key,request:storeRequest});
    }
  }
  function queueStoreDefaults(force=false){
    const erpKey=$('erp').value;
    for(const target of activeStores()){
      if(!force&&profileFor(target))continue;
      if(isStoreLoading(target)||defaultsQueue.some(e=>e.request===storeRequest&&e.erpKey===erpKey&&e.key===target.key))continue;
      if(force)packageDependencyRetries.delete(target.key);
      storeState.profiles={...storeState.profiles,[target.key]:null};defaultsQueue.push({erpKey,key:target.key,request:storeRequest});
    }
    queuePackageDependents();
    if(defaultsTask||!defaultsQueue.length){renderStoreDefaults();return defaultsTask||Promise.resolve();}
    defaultsLoading=true;defaultsTask=(async()=>{
      try{while(defaultsQueue.length){
        const next=defaultsQueue.shift();if(next.request!==storeRequest||next.erpKey!==$('erp').value||!selectedStoreKeys.has(next.key))continue;
        loadingStore=next;renderStoreDefaults();
        let profile;try{profile=await api('sourcing/store-defaults',{erpKey:next.erpKey,targetStoreKey:next.key});}catch(error){profile={defaults:null,issues:[error.message]};}
        if(next.request===storeRequest&&next.erpKey===$('erp').value&&storeState.erpKey===next.erpKey)storeState.profiles={...storeState.profiles,[next.key]:profile};
        loadingStore=null;queuePackageDependents();renderStoreDefaults();
      }}finally{loadingStore=null;defaultsLoading=false;defaultsTask=null;renderStoreDefaults();}
    })();return defaultsTask;
  }
  function renderSearch(){
    if(!current)return;
    $('resultCount').textContent=`${current.rows.length}件 · ${labels[current.status]||current.status}`;
    const costs=current.calls||[],known=costs.filter(c=>c.chargedPoints!==null&&c.chargedPoints!==undefined);
    $('searchInfo').textContent=`${current.site.cnName||current.site.name} · ${current.site.currency} · 预计 ${current.estimatedPoints} 点。`+(known.length?`已收到扣点回执 ${known.reduce((n,c)=>n+Number(c.chargedPoints),0)} 点。`:'实际扣点请以极鲸云控制台记录为准。')+(current.error?' '+current.error:'');
    const f=current.filters,applied=[`实际查询：${f.keywords.join(' / ')||'仅按类目'}`,Number(f.matchMode??2)===1?'严格匹配':'模糊匹配',f.catIds.length?`已限定 ${f.catIds.length} 个类目`:'未限定类目'];
    for(const [key,label] of [['priceMin',`价格下限 ${current.site.currency}`],['priceMax',`价格上限 ${current.site.currency}`],['monthSoldMin','月销量至少'],['monthSoldMax','月销量至多'],['similarNumMax','同款数量至多'],['goodsScoreMin','评分至少']])if(f[key]!==undefined&&f[key]!==null&&f[key]!=='')applied.push(`${label} ${f[key]}`);
    const sorts={monthSold:'近30天销量',sold:'累计销量',minPrice:'价格',goodsScore:'评分',onSaleTime:'上架时间'};applied.push(`${sorts[f.sort]||f.sort} · ${f.order==='asc'?'从低到高':'从高到低'}`);$('executedFilters').textContent=applied.join('；');
    $('goods').innerHTML=current.rows.map(r=>{const v=r.raw,img=safeUrl(v.thumbnail,['.kwcdn.com']),detail=safeUrl(v.linkUrl,['www.geekbi.com','geekbi.com','www.temu.com','temu.com']);return `<tr><td><input type="checkbox" data-goods="${esc(r.goodsId)}" ${selected.has(r.goodsId)?'checked':''} aria-label="选择商品 ${esc(r.goodsId)}"></td><td><div class="product">${img?`<img src="${esc(img)}" alt="商品缩略图" loading="lazy" referrerpolicy="no-referrer">`:''}<div><div class="title">${esc(v.goodsName||r.goodsId)}</div><small class="muted">${esc(r.goodsId)}</small>${detail?`<a href="${esc(detail)}" target="_blank" rel="noreferrer">查看来源详情 ↗</a>`:''}</div></div></td><td>${esc(number(v.minPrice))} ${esc(current.site.currency)}</td><td>${esc(number(v.monthSold))}</td><td>${esc(date(v.updateTime))}</td></tr>`;}).join('')||`<tr><td colspan="5" class="empty">${current.status==='running'?'正在查询，请稍候。':current.status==='completed'?'极鲸云未返回符合以上全部条件的商品。可调整关键词、类目，或清空数值限制后重新查询。':'没有可展示的商品，请检查错误信息；不自动重发查询。'}</td></tr>`;
    updateSelection();
  }
  function conversionReceipt(row){
    const fx=row.conversion;if(!fx)return '';
    const rate=Number(fx.rate).toLocaleString('zh-CN',{maximumFractionDigits:8});
    return `<p class="muted small">美元换算：1 ${esc(fx.from)} = ${esc(rate)} USD · 汇率日期 ${esc(fx.date)} · ${esc(fx.source)}</p><details><summary>查看各SKU原价与美元价</summary><div class="table-wrap"><table><thead><tr><th>SKU</th><th>原价 ${esc(fx.from)}</th><th>导入价 USD</th><th>原促销价 ${esc(fx.from)}</th><th>促销价 USD</th></tr></thead><tbody>${(row.priceConversions||[]).map(p=>`<tr><td>${esc(p.skuId)}</td><td>${esc(p.originalPrice)}</td><td>${Number(p.price).toFixed(2)}</td><td>${esc(p.originalSalePrice)}</td><td>${Number(p.salePrice).toFixed(2)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  const batchStores=batch=>Array.isArray(batch.targetStores)&&batch.targetStores.length?batch.targetStores:batch.targetStore?[batch.targetStore]:[];
  function storeResults(batch,row){
    if(row.storeResults?.length)return row.storeResults;
    if(batch.targetStore)return [{storeKey:batch.targetStore.key,targetStore:batch.targetStore,status:row.status,claim:row.claim,preparation:row.preparation,error:row.error}];
    return batchStores(batch).map(targetStore=>({storeKey:targetStore.key,targetStore,status:'pending'}));
  }
  function renderStoreResults(batch,row){
    return storeResults(batch,row).map(result=>{
      const store=result.targetStore||batchStores(batch).find(s=>s.key===result.storeKey),name=store?storeName(store):result.storeKey||'目标店铺',draft=safeUrl(result.preparation?.url||result.claim?.evidence?.platformEditUrl,['www.dianxiaomi.com']),issues=[...new Set([...(result.preparation?.issues||[]),result.error].filter(Boolean))];
      return `<section class="store-result" data-store-result="${esc(result.storeKey||store?.key)}"><div class="store-card-head"><strong>${esc(name)}</strong><span class="state ${esc(result.status)}">${labels[result.status]||esc(result.status)}</span></div>${draft?`<a href="${esc(draft)}" target="_blank" rel="noreferrer">查看 ${esc(name)} 草稿 ↗</a>`:''}${result.status==='prepared'?'<p class="small">已保存店铺草稿并通过本次必填项检查，尚未实际发布。</p>':''}${result.reusedPrevious?'<p class="muted small">复用该店铺已有结果，未重复认领。</p>':''}${issues.map(issue=>`<p class="error small">${esc(issue)}</p>`).join('')}${result.checkedAt?`<p class="muted small">核对时间：${esc(date(result.checkedAt))}</p>`:''}</section>`;
    }).join('');
  }
  function renderBatches(){
    $('batches').innerHTML=state.batches.map(b=>`<article class="batch" data-batch="${esc(b.id)}"><div class="batch-head"><div><strong>${esc(b.erpName)}${batchStores(b).length?' → '+batchStores(b).length+'家店铺':''}</strong> <span class="state">${labels[b.status]||esc(b.status)}</span>${batchStores(b).length?`<p class="small">${batchStores(b).map(s=>esc(storeName(s))).join('、')}</p>`:''}<small class="muted">${esc(date(b.createdAt))} · ${b.method==='geekbi-product-data'?'极鲸云详情 / 文件导入':'旧版链接采集记录'}</small></div>${b.status==='running'?`<button data-stop="${b.id}">停止后续商品</button>`:''}<button data-reconcile="${b.id}" ${serviceBusy()?'disabled':''}>只核对结果</button></div>${b.error?`<p class="muted">${esc(b.error)}</p>`:''}<ul>${b.rows.map(r=>{
      const url=safeUrl(r.sourceUrl,['www.temu.com','temu.com']),results=storeResults(b,r),legacyDraft=!results.length&&safeUrl(r.preparation?.url||r.claim?.evidence?.platformEditUrl,['www.dianxiaomi.com']),edit=legacyDraft||safeUrl(r.evidence?.editUrl,['www.dianxiaomi.com']);
      return `<li><span class="state ${esc(r.status)}">${r.status==='partial'?'部分店铺未完成':labels[r.status]||esc(r.status)}</span>${esc(r.title)}<small class="muted"> · ${esc(r.goodsId)}</small><div>${r.fileName?`<a href="/api/sourcing/batches/${encodeURIComponent(b.id)}/files/${encodeURIComponent(r.goodsId)}">下载导入文件</a>`:''}${edit?` <a href="${esc(edit)}" target="_blank" rel="noreferrer">${legacyDraft?'查看店铺草稿':'查看店小秘商品'} ↗</a>`:''}</div>${r.fileName?`<p class="muted small">快照：${esc(date(r.snapshotTime))} · ${esc(r.currency)} · ${r.skuCount} 个SKU / ${r.mainImageCount} 张主图 / ${r.detailImageCount} 张详情图</p>`:''}${results.length?`<div class="store-results">${renderStoreResults(b,r)}</div>`:r.status==='prepared'?'<p class="small">已保存店铺草稿并通过本次必填项检查，尚未实际发布。</p>':''}${!results.length&&r.preparation?.issues?.length?`<p class="error small">店铺草稿待处理：${r.preparation.issues.map(esc).join('；')}</p>`:''}${r.detailCached!==undefined?`<p class="muted small">${r.detailCached?'复用已保存详情，本次未重新扣详情点数':`详情扣点回执：${number(r.detailChargedPoints)} 点`}${!r.fileName&&r.currency?` · 原始币种：${esc(r.currency)}`:''}</p>`:''}${conversionReceipt(r)}${url?`<details><summary>商品来源链接</summary><a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a></details>`:''}${r.error?`<p class="error small">${esc(r.error)}</p>`:''}${(r.warnings||[]).map(w=>`<p class="muted small">${esc(w)}</p>`).join('')}${r.sourceMarketNote?`<p class="muted small">${esc(r.sourceMarketNote)}</p>`:''}</li>`;
    }).join('')}</ul></article>`).join('')||'<p class="muted">尚无采集批次。</p>';
  }
  async function refresh(){
    state=await api('sourcing');$('connectionState').textContent=state.configured?'极鲸云已配置':'待连接极鲸云';$('keyStatus').textContent=state.configured?' · 已保存':' · 未保存';
    $('searchHistory').innerHTML='<option value="">选择历史记录</option>'+state.searches.map(s=>`<option value="${s.id}">${esc(date(s.createdAt))} · ${esc(s.filters.keywords.join(' / ')||'类目选品')} · ${s.count}件</option>`).join('');
    try{
      const uncertain=pendingSubmission?.status==='uncertain'?pendingSubmission:null,found=uncertain&&state[uncertain.kind]?.find(record=>record.id===uncertain.id);
      if(found){
        uncertain.record=uncertain.kind==='searches'?await api('sourcing/searches/'+found.id):found;
        if(uncertain.kind==='searches'){current=uncertain.record;restoreFilters(current);}
        selected.clear();rememberSubmission(null);renderSearch();message('已找回原'+(uncertain.kind==='searches'?'查询':'批次')+'记录，后续只读取进度，没有再次提交。');
      }else if(uncertain){message('原'+(uncertain.kind==='searches'?'查询':'批次')+'的提交结果仍待核对，暂不发起新提交。正在只读刷新记录。',true);}
      if(current){const id=current.id;$('searchHistory').value=id;const next=await api('sourcing/searches/'+id);if(current?.id===id&&JSON.stringify(next)!==JSON.stringify(current)){current=next;renderSearch();}}
    }finally{
      // The confirmed batch and busy snapshot must remain visible if the
      // independent search-detail read fails on the final polling tick.
      renderBatches();updateSelection();
    }
  }
  async function loadSites(){state.sites=await api('sourcing/sites',{});renderSites();message('极鲸云连接成功，已读取站点列表。');}
  $('credentialForm').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{settings=await api('settings');settings=await api('settings',{revision:settings.revision,models:Object.fromEntries(new FormData(e.target))});e.target.reset();await refresh();await loadSites();$('credentials').open=false;});};
  $('loadSites').onclick=e=>action(e.target,loadSites);
  $('searchForm').oninput=$('searchForm').onchange=()=>{currencyLabels();updateSelection();};
  $('clearNumericFilters').onclick=()=>{for(const name of numericFilters)$('searchForm').elements[name].value='';updateSelection();message('已清空价格、销量、同款数量和评分限制；点击“查询商品”后才会发起新查询。');};
  $('parse').onclick=e=>action(e.target,async()=>{const result=await api('sourcing/parse',{prompt:$('prompt').value});for(const name of ['keywords','priceMin','priceMax','monthSoldMin','monthSoldMax','goodsScoreMin','similarNumMax'])$('searchForm').elements[name].value='';for(const [key,value] of Object.entries(result)){const input=$('searchForm').elements[key];if(input)input.value=Array.isArray(value)?value.join('\n'):value;}$('parseNotes').textContent=result.notes||'';updateSelection();message('已整理筛选条件，请核对数值、站点和类目后查询。');});
  async function loadCategories(parentCatId){categories=await api('sourcing/categories',{parentCatId});$('category').innerHTML=categories.map(c=>`<option value="${esc(c.catId)}">${esc(c.catName)}${c.isLeaf?'':' ›'}</option>`).join('')||'<option value="">暂无下级类目</option>';}
  $('rootCategories').onclick=e=>action(e.target,()=>loadCategories());
  $('childCategories').onclick=e=>action(e.target,()=>{if(!$('category').value)throw new Error('请先选择类目');return loadCategories($('category').value);});
  const renderChips=()=>{$('categoryChips').innerHTML=[...chosenCategories].map(([id,name])=>`<button type="button" data-category="${esc(id)}">${esc(name)} ×</button>`).join('');updateSelection();};
  $('addCategory').onclick=()=>{const c=categories.find(c=>String(c.catId)===$('category').value);if(c){chosenCategories.set(c.catId,c.catName);renderChips();}};
  $('categoryChips').onclick=e=>{if(e.target.dataset.category){for(const id of chosenCategories.keys())if(String(id)===e.target.dataset.category)chosenCategories.delete(id);renderChips();}};
  $('searchForm').onsubmit=e=>{e.preventDefault();action(e.submitter||$('searchButton'),async()=>{const payload={...formFilters(),requestId:crypto.randomUUID()};current=await submitRequest('searches',payload);selected.clear();renderSearch();await refresh();message('查询已开始。请等待结果；请求不明确时不会自动重发。');});};
  $('searchHistory').onchange=e=>action(e.target,async()=>{if(e.target.value){current=await api('sourcing/searches/'+e.target.value);selected.clear();restoreFilters(current);renderSearch();}});
  $('goods').onchange=e=>{const id=e.target.dataset.goods;if(!id)return;if(e.target.checked&&selected.size>=20){e.target.checked=false;message('每批最多选择20件商品。',true);return;}if(e.target.checked)selected.add(id);else selected.delete(id);updateSelection();};
  $('selectAll').onchange=e=>{selected=new Set(e.target.checked?(current?.rows||[]).slice(0,20).map(r=>r.goodsId):[]);renderSearch();};
  $('erp').onchange=e=>action(e.target,async()=>{erpBinding();await loadStores();});
  $('syncStores').onclick=e=>action(e.target,async()=>{await loadStores(true);message('已读取店小秘当前账号绑定的店铺，请选择本批商品要认领到的店铺。');});
  $('targetStores').onchange=e=>{const key=e.target.dataset.store,target=storeState.stores.find(s=>s.key===key);if(!key||!target)return;if(target.disabled||pendingSubmission||serviceBusy()){e.target.checked=selectedStoreKeys.has(key)&&!target.disabled;updateSelection();return;}if(e.target.checked)selectedStoreKeys.add(key);else selectedStoreKeys.delete(key);e.target.closest('.store-option')?.classList.toggle('selected',e.target.checked);renderStoreDefaults();queueStoreDefaults();};
  $('loadStoreDefaults').onclick=e=>action(e.target,()=>queueStoreDefaults(true));
  $('openCollection').onclick=e=>action(e.target,async()=>{const r=await api('sourcing/open',{erpKey:$('erp').value});message(r.message);});
  $('collect').onclick=e=>action(e.target,async()=>{const ready=storeReadiness();if(!ready.ready||defaultsLoading)throw new Error('请勾选店铺，读取完整默认配置，并确保各店包裹长宽高和重量一致');await submitRequest('batches',{requestId:crypto.randomUUID(),searchId:current.id,erpKey:$('erp').value,targetStoreKeys:ready.stores.map(s=>s.key),goodsIds:[...selected]});selected.clear();renderSearch();await refresh();message('批次已开始：每件商品获取一次详情、导入或复用记录，再逐店认领、填写并核对草稿。各店结果会分别展示。');});
  $('batches').onclick=e=>{if(e.target.dataset.stop)action(e.target,async()=>{await api('sourcing/batches/'+e.target.dataset.stop+'/stop',{});message('会在当前商品核对完成后停止，不会重复提交。');});if(e.target.dataset.reconcile)action(e.target,async()=>{await api('sourcing/batches/'+e.target.dataset.reconcile+'/reconcile',{});await refresh();message('核对完成，未重新提交采集。');});};
  $('refresh').onclick=e=>action(e.target,refresh);
  (async()=>{token=(await api('session')).token;settings=await api('settings');await refresh();renderSites();$('credentials').open=!state.configured;$('erp').innerHTML=settings.erpConnections.filter(e=>(e.provider||'dianxiaomi')==='dianxiaomi'&&settings.browsers.some(b=>b.key===e.browserKey&&b.type==='chrome')).map(e=>`<option value="${esc(e.key)}">${esc(e.name)} · ${esc(e.expectedAccount||'待填写账号')}</option>`).join('');erpBinding();await loadStores().catch(e=>message(e.message,true));if(state.searches.length){current=await api('sourcing/searches/'+state.searches[0].id);$('searchHistory').value=current.id;restoreFilters(current);renderSearch();}setInterval(async()=>{if(polling||!serviceBusy()&&pendingSubmission?.status!=='uncertain')return;polling=true;try{await refresh();}catch(e){message(e.message,true);}finally{polling=false;}},2500);})().catch(e=>message(e.message,true));
})();
