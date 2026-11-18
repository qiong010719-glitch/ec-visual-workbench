(() => {
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={running:'运行中',pending:'等待',resolving:'核对原始链接',submitting:'已发起采集',verified:'已确认入箱',failed:'失败',blocked:'需处理',paused:'已停止后续',completed:'完成',partial:'部分结果','needs-review':'待核对'};
  let token,settings,state,current,selected=new Set(),categories=[],chosenCategories=new Map(),polling=false;
  const api=async(route,p)=>{const r=await fetch('/api/'+route,p===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(p)});const v=await r.json();if(!r.ok)throw new Error(v.error||'请求失败');return v;};
  const message=(text,error=false)=>{$('notice').hidden=false;$('notice').className=error?'error':'';$('notice').textContent=text;};
  const action=async(button,fn)=>{button.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{button.disabled=false;updateSelection();}};
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
    for(const key of ['keywords','siteId','size',...numericFilters,'sort','order','matchMode'])form.elements[key].value=key==='keywords'?f.keywords.join('\n'):key==='matchMode'?f.matchMode??1:f[key]??'';
    chosenCategories=new Map((f.catIds||[]).map(id=>[id,chosenCategories.get(id)||`已选类目 ${id}`]));renderChips();currencyLabels();
  }
  function renderSites(){const prior=$('site').value;$('site').innerHTML='<option value="">请选择站点</option>'+(state.sites||[]).map(s=>`<option value="${esc(s.siteId)}">${esc(s.cnName||s.name)} · ${esc(s.currency)}</option>`).join('');if((state.sites||[]).some(s=>String(s.siteId)===prior))$('site').value=prior;currencyLabels();}
  function updateSelection(){const dirty=hasDraftChanges();$('collect').textContent=`采集所选商品（${selected.size}）`;$('collect').disabled=dirty||!selected.size||!$('erp').value||!!state?.busy;$('selectAll').checked=!!current?.rows.length&&selected.size===Math.min(20,current.rows.length);$('selectAll').disabled=dirty||!current?.rows.length;document.querySelectorAll('#goods [data-goods]').forEach(input=>{input.disabled=dirty;});$('draftNotice').hidden=!dirty;$('draftNotice').textContent=dirty?'筛选条件已修改。下方仍是上次查询结果，请点击“查询商品”获取新结果。':'';}
  function erpBinding(){const e=settings.erpConnections.find(e=>e.key===$('erp').value),b=settings.browsers.find(b=>b.key===e?.browserKey);$('erpBinding').textContent=e?`账号：${e.expectedAccount||'尚未填写，请先到连接设置填写'} · 浏览器：${b?.name||'未绑定'}`:'请先在连接设置添加店小秘账号。';updateSelection();}
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
  function renderBatches(){
    $('batches').innerHTML=state.batches.map(b=>`<article class="batch"><div class="batch-head"><div><strong>${esc(b.erpName)}</strong> <span class="state">${labels[b.status]||esc(b.status)}</span><small class="muted">${esc(date(b.createdAt))}</small></div>${b.status==='running'?`<button data-stop="${b.id}">停止后续商品</button>`:''}<button data-reconcile="${b.id}" ${state.busy?'disabled':''}>只核对入箱结果</button></div>${b.error?`<p class="muted">${esc(b.error)}</p>`:''}<ul>${b.rows.map(r=>{const url=safeUrl(r.sourceUrl,['www.temu.com','temu.com']);return `<li><span class="state ${r.status}">${labels[r.status]||esc(r.status)}</span>${esc(r.title)}<small class="muted"> · ${esc(r.goodsId)}</small>${url?`<div><a href="${esc(url)}" target="_blank" rel="noreferrer">Temu 原始商品链接 ↗</a></div>`:''}${r.error?`<p class="error small">${esc(r.error)}</p>`:''}${r.sourceMarketNote?`<p class="muted small">${esc(r.sourceMarketNote)}</p>`:''}</li>`;}).join('')}</ul></article>`).join('')||'<p class="muted">尚无采集批次。</p>';
  }
  async function refresh(){
    state=await api('sourcing');$('connectionState').textContent=state.configured?'极鲸云已配置':'待连接极鲸云';$('keyStatus').textContent=state.configured?' · 已保存':' · 未保存';
    $('searchHistory').innerHTML='<option value="">选择历史记录</option>'+state.searches.map(s=>`<option value="${s.id}">${esc(date(s.createdAt))} · ${esc(s.filters.keywords.join(' / ')||'类目选品')} · ${s.count}件</option>`).join('');
    if(current){const id=current.id;$('searchHistory').value=id;const next=await api('sourcing/searches/'+id);if(current?.id===id&&JSON.stringify(next)!==JSON.stringify(current)){current=next;renderSearch();}}
    renderBatches();updateSelection();
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
  $('searchForm').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const payload={...formFilters(),requestId:crypto.randomUUID()};current=await api('sourcing/searches',payload);selected.clear();renderSearch();await refresh();message('查询已开始。请等待结果；请求不明确时不会自动重发。');});};
  $('searchHistory').onchange=e=>action(e.target,async()=>{if(e.target.value){current=await api('sourcing/searches/'+e.target.value);selected.clear();restoreFilters(current);renderSearch();}});
  $('goods').onchange=e=>{const id=e.target.dataset.goods;if(!id)return;if(e.target.checked&&selected.size>=20){e.target.checked=false;message('每批最多选择20件商品。',true);return;}if(e.target.checked)selected.add(id);else selected.delete(id);updateSelection();};
  $('selectAll').onchange=e=>{selected=new Set(e.target.checked?(current?.rows||[]).slice(0,20).map(r=>r.goodsId):[]);renderSearch();};
  $('erp').onchange=erpBinding;
  $('openCollection').onclick=e=>action(e.target,async()=>{const r=await api('sourcing/open',{erpKey:$('erp').value});message(r.message);});
  $('collect').onclick=e=>action(e.target,async()=>{await api('sourcing/batches',{requestId:crypto.randomUUID(),searchId:current.id,erpKey:$('erp').value,goodsIds:[...selected]});selected.clear();renderSearch();await refresh();message('批次已开始。核对原始商品链接后采集，成功以采集箱回读记录为准。');});
  $('batches').onclick=e=>{if(e.target.dataset.stop)action(e.target,async()=>{await api('sourcing/batches/'+e.target.dataset.stop+'/stop',{});message('会在当前商品核对完成后停止，不会重复提交。');});if(e.target.dataset.reconcile)action(e.target,async()=>{await api('sourcing/batches/'+e.target.dataset.reconcile+'/reconcile',{});await refresh();message('核对完成，未重新提交采集。');});};
  $('refresh').onclick=e=>action(e.target,refresh);
  (async()=>{token=(await api('session')).token;settings=await api('settings');await refresh();renderSites();$('credentials').open=!state.configured;$('erp').innerHTML=settings.erpConnections.filter(e=>(e.provider||'dianxiaomi')==='dianxiaomi').map(e=>`<option value="${esc(e.key)}">${esc(e.name)} · ${esc(e.expectedAccount||'待填写账号')}</option>`).join('');erpBinding();if(state.searches.length){current=await api('sourcing/searches/'+state.searches[0].id);$('searchHistory').value=current.id;restoreFilters(current);renderSearch();}setInterval(async()=>{if(polling||!state?.busy)return;polling=true;try{await refresh();}catch(e){message(e.message,true);}finally{polling=false;}},2500);})().catch(e=>message(e.message,true));
})();
