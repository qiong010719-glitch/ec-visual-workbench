/* Reference library controls. Secrets stay on the server. */
(() => {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async(url,payload)=>{const r=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error || '请求失败');return d;};
  const labels={pending:'待分析',queued:'排队中',running:'处理中',completed:'已完成',partial:'部分完成',failed:'失败',paused:'可继续同步',submission_unknown:'提交结果待核对'};
  const traitLabels={complete_scene:'完整场景',human_interaction:'自然互动',material_macro:'材质微距',headline_hierarchy:'标题层级',information_graphics:'图文解释',coherent_palette:'统一配色',product_in_use:'实际使用',studio_hero:'摄影主视觉'};
  let dialog;
  const selected=()=>[...dialog.querySelectorAll('[data-reference]:checked')].map(x=>x.value);
  const message=text=>{dialog.querySelector('#referenceMessage').textContent=text;};
  async function refresh() {
    const keep=dialog.dataset.loaded?selected():(window.__designReferenceIds || []);dialog.dataset.loaded='true';
    const [status,products,jobs]=await Promise.all([api('/api/research/status'),api('/api/research/products'),api('/api/research/jobs')]);
    dialog.querySelector('#referenceStats').innerHTML=`<strong>${status.products} 组商品/店铺资料 · ${status.downloadedUnique}/${status.uniqueImages} 张独立图片已下载 · ${status.analyzedUnique} 张已分析</strong><p class="local-muted">${status.analyzed} 组完整分析 · Apify：${status.apifyConfigured?'已配置':'待填写 .env.apify'} · 视觉分析模型：${status.visionConfigured?'已配置':'待配置'} · 当前任务：${status.active?'处理中':'空闲'}</p>`;
    dialog.querySelector('#referenceCollectButton').disabled=!status.apifyConfigured;
    dialog.querySelector('#referenceAnalyze').disabled=!status.visionConfigured;
    for(const collection of status.styleCollections || [])dialog.querySelector('#referenceStats').insertAdjacentHTML('beforeend',`<div class="local-card"><strong>${escape(collection.label)}</strong><p>${collection.analyzedProducts} 款已分析 · ${collection.analyzedImages} 张独立图片 · ${collection.categories.length} 个类目</p><p class="local-muted">${escape(collection.categories.join('、'))}</p><p class="local-muted">快速设计参考信息组织，大师模式参考摄影叙事；两种模式各自规划。</p></div>`);
    const collectionSelect=dialog.querySelector('#referenceCollectionFilter'),previousCollection=collectionSelect.value;
    collectionSelect.innerHTML='<option value="">全部参考集</option>'+(status.styleCollections || []).map(c=>`<option value="${escape(c.id)}">${escape(c.label)}</option>`).join('');collectionSelect.value=previousCollection;
    if(status.expansion){const e=status.expansion;dialog.querySelector('#referenceStats').insertAdjacentHTML('beforeend',`<details><summary>扩类进度：${e.categories.filter(c=>c.analysisStatus==='completed').length}/${e.categories.length} 个分支已完成所选图片分析</summary><p class="local-muted">${escape(e.scope)} · Apify 累计 $${Number(e.budget?.committedUsd||0).toFixed(3)} / $${escape(e.budget?.budgetUsd||5)}</p><table style="width:100%;text-align:left"><thead><tr><th>分支</th><th>品牌 / 商品</th><th>采样目标</th><th>图片分析</th></tr></thead><tbody>${e.categories.map(c=>`<tr><td>${escape(c.label)}</td><td>${c.brands}/5 · ${c.products}/25</td><td>${c.selectionComplete?'已满足':'有缺口'}</td><td>${labels[c.analysisStatus]||escape(c.analysisStatus)}</td></tr>`).join('')}</tbody></table><p class="local-muted">${escape(e.nextPhase||'')}</p></details>`);}
    if(status.expansion?.collectionBlock?.type==='apify_account_monthly_limit')dialog.querySelector('#referenceStats').insertAdjacentHTML('beforeend','<p>Apify 账户已达到当月使用限额，后续采集待恢复额度。已完成的参考仍可正常使用。</p>');
    const categorySelect=dialog.querySelector('#referenceCategoryFilter'),previousCategory=categorySelect.value;
    const categoryOptions=[...new Map(products.flatMap(p=>p.categoryMemberships?.length?p.categoryMemberships.map(c=>[c.id,c.label]):[[p.category||'未分类',p.category||'未分类']])).entries()];
    categorySelect.innerHTML='<option value="">全部类目</option>'+categoryOptions.map(([id,label])=>`<option value="${escape(id)}">${escape(label)}</option>`).join('');categorySelect.value=previousCategory;
    dialog.querySelector('#referenceProducts').innerHTML=products.length?products.map(p=>`<article class="local-card"><div class="local-row"><input style="width:auto;margin:0" type="checkbox" data-reference value="${escape(p.id)}" ${keep.includes(p.id)?'checked':''}>${p.thumbnail?`<img class="local-thumb" src="${escape(p.thumbnail)}" alt="商品参考缩略图">`:''}<div><strong>${escape(p.title || p.asin || '未命名商品')}</strong><p class="local-muted">${escape(p.brand || '品牌待确认')} · ${escape(p.category || '待分类')}<br>图片 ${p.downloaded}/${p.images} · A+ ${p.aplusStatus==='found'?'已取得':'未确认'} · ${labels[p.analysisStatus] || escape(p.analysisStatus)}</p>${p.url?`<a target="_blank" rel="noopener noreferrer" href="${escape(p.url)}">查看来源商品 ↗</a>`:''}</div></div>${p.analysisError?`<p>${escape(p.analysisError)}</p>`:''}</article>`).join(''):'<p class="local-muted">参考库为空。导入现有素材，或从类目畅销榜开始采集。</p>';
    dialog.querySelector('#referenceJobs').innerHTML=jobs.slice(0,12).map(j=>`<article class="local-card"><strong>${escape(j.kind)} · ${labels[j.status] || escape(j.status)}</strong><p>${escape(j.phase || '')}</p>${j.input.budgetUsd?`<p class="local-muted">本批采集上限 $${escape(j.input.budgetUsd)} · ${j.runs.filter(r=>r.runId).length} 个远端运行</p>`:''}${j.categories?.map(c=>c.selection?`<p class="local-muted">${escape(c.label||'')} ${c.selection.brands.length}/5 个品牌 · ${c.selection.brands.reduce((s,b)=>s+b.products.length,0)}/25 款商品（当前榜单样本）</p>`:'').join('') || ''}${j.error?`<p>${escape(j.error)}</p>`:''}${j.warnings?.length?`<details><summary>${j.warnings.length} 条待处理记录</summary><p>${j.warnings.map(escape).join('<br>')}</p></details>`:''}${['paused','failed'].includes(j.status)?`<button data-resume="${escape(j.id)}">继续同步已有运行</button>`:''}</article>`).join('') || '<p class="local-muted">暂无采集或分析任务。</p>';
    for(const button of dialog.querySelectorAll('[data-resume]'))button.onclick=()=>perform(button,async()=>{await api('/api/research/resume',{id:button.dataset.resume});message('已恢复同步');});
    for(const product of products) {
      const card=dialog.querySelector(`input[data-reference][value="${product.id}"]`).closest('article');
      card.dataset.referenceType=product.url?.includes('/stores/')?'storefront':'product';
      card.dataset.referenceCategories=JSON.stringify(product.categoryMemberships?.length?product.categoryMemberships.map(c=>c.id):[product.category||'未分类']);
      card.dataset.referenceCollections=JSON.stringify(product.collectionIds || []);
      if(product.styleProfileIds?.includes('scene_advertising')){const badge=document.createElement('p');badge.className='local-pill';badge.textContent='场景广告风格参考';card.appendChild(badge);}
      if(product.asin){const code=document.createElement('p');code.className='local-muted';code.textContent='ASIN：'+product.asin;card.appendChild(code);}
      const button=document.createElement('button');button.textContent='查看图片与设计分析';button.dataset.analysis=product.id;
      button.onclick=()=>showAnalysis(product.id);card.appendChild(button);
    }
    const filter=()=>{const query=dialog.querySelector('#referenceSearch').value.trim().toLowerCase(),type=dialog.querySelector('#referenceType').value,category=categorySelect.value,collection=collectionSelect.value;for(const card of dialog.querySelectorAll('#referenceProducts article'))card.hidden=!!((type!=='all'&&card.dataset.referenceType!==type)||(category&&!JSON.parse(card.dataset.referenceCategories).includes(category))||(collection&&!JSON.parse(card.dataset.referenceCollections).includes(collection))||(query&&!card.textContent.toLowerCase().includes(query)));};
    dialog.querySelector('#referenceSearch').oninput=filter;dialog.querySelector('#referenceType').onchange=filter;categorySelect.onchange=filter;collectionSelect.onchange=filter;filter();
  }
  async function showAnalysis(id) {
    try {
      const p=await api('/api/research/products/'+encodeURIComponent(id));
      const detail=document.createElement('dialog');detail.className='local-dialog';detail.id='referenceAnalysis';
      const roles={main:'主图',gallery:'商品副图',aplus:'A+',brand_story:'品牌故事',storefront:'店铺装修'};
      detail.innerHTML=`<div class="local-head"><h2>${escape(p.title)}</h2><button data-close-analysis>关闭分析</button></div><p>${p.analysis?.images?.length || 0}/${p.assets.length} 张已分析。设计观察可用于策划，商品参数仍以新商品资料为准。</p>`+p.assets.map(a=>{
        const finding=p.analysis?.images?.find(v=>v.id===a.id);
        return `<article class="local-card">${a.localUrl?`<img loading="lazy" style="width:100%;max-height:230px;object-fit:contain" src="${escape(a.localUrl)}" alt="参考图片">`:''}<strong>${escape((a.roles || [a.role]).map(r=>roles[r] || r).join(' / '))} · ${escape(finding?.purpose || '待分析')}</strong>${finding?`<p class="local-muted">${(finding.visualTraits || []).map(t=>escape(traitLabels[t] || t)).join(' · ')}</p><p>构图：${escape(finding.layout)}</p><p>镜头与光影：${escape(finding.camera)}；${escape(finding.lighting)}</p><p>配色：${escape(finding.palette)}</p><p>文字层级：${escape(finding.textDensity)}</p><p>可迁移方法：${escape(finding.transferableGuidance)}</p>`:'<p class="local-muted">尚无视觉分析结果。</p>'}</article>`;
      }).join('');
      document.body.appendChild(detail);detail.showModal();detail.querySelector('[data-close-analysis]').onclick=()=>{detail.close();detail.remove();};
    }catch(error){message(error.message);}
  }
  async function perform(button,action) {
    button.disabled=true;message('处理中…');
    try {await action();await refresh();}catch(error){message(error.message);}finally{button.disabled=false;}
  }
  window.openReferenceLibrary=async()=>{
    document.getElementById('referenceLibrary')?.remove();dialog=document.createElement('dialog');dialog.id='referenceLibrary';dialog.className='local-dialog';
    dialog.innerHTML=`<div class="local-head"><h2>设计参考库</h2><button id="referenceClose">关闭</button></div>
      <p class="local-muted">内部工具 · 美国站 Apify 参考库，不是淘宝客户入口。采集代码仍保留。</p>
      <div id="referenceStats" class="local-card">正在读取…</div><p class="local-muted">美国站 · 3C 参考与跨类目风格参考。只有完成图片分析的参考用于新方案；自动优先匹配同类目，跨类目只借鉴通用构图方法。</p>
      <details><summary>从类目畅销榜采集</summary><form id="referenceCollect"><label>具体类目畅销榜链接（每行一个）<textarea id="referenceCategoryUrls" rows="3" required placeholder="粘贴美国站具体类目的 Best Sellers 链接"></textarea></label><div class="local-grid"><label>类目标签<input id="referenceCategory" value="充电宝 / Power Banks"></label><label>本批采集费用上限（美元）<input id="referenceBudget" type="number" min="0.1" max="1000" step="0.1" value="5" required></label></div><p class="local-muted">每类目读取最多 100 个榜单商品，核对品牌后筛选 5 个品牌、每品牌最多 5 款。品牌排序按本次榜单推算；不足数量会保留缺口。费用上限分配到榜单和详情两个阶段，不包含后续视觉分析费用。</p><button class="primary" id="referenceCollectButton" type="submit">开始本批采集</button></form></details>
      <details><summary>导入已有商品图片</summary><form id="referenceFolder"><label>单个商品图片文件夹（本机完整路径）<input id="referenceFolderPath" placeholder="E:\\商品素材\\充电宝A" required></label><div class="local-grid"><label>商品名称<input id="referenceTitle" placeholder="参考商品名称"></label><label>类目<input id="referenceLocalCategory" value="充电宝 / Power Banks"></label></div><button id="referenceImportFolder" type="submit">导入本机图片</button></form><label style="margin-top:15px">或导入商品 JSON（Apify 导出数组或含 products 数组）<input id="referenceJSON" type="file" accept=".json,application/json"></label><p class="local-muted">网站中的素材可先整理为包含商品链接、images 和 aPlusImages 的 JSON，再导入。图片角色会保留，未取得的 A+ 会显示缺失。</p></details>
      <output id="referenceMessage"></output><h3>商品与分析</h3><div class="local-row"><button id="referenceRefresh">刷新状态</button><button id="referenceDownload">下载选中图片</button><button id="referenceAnalyze">分析选中商品</button><button id="referenceUse">用于当前商品策划</button><a href="/api/research/export" download>导出参考库记录</a></div><p class="local-muted">分析会调用已配置的视觉模型并使用其额度。参考库用于配色、镜头、排版和逐图分工；新商品参数以当前填写资料为准。</p><div id="referenceProducts"></div><h3>任务记录</h3><div id="referenceJobs"></div>`;
    document.body.appendChild(dialog);dialog.showModal();dialog.querySelector('#referenceClose').onclick=()=>dialog.close();
    const filters=document.createElement('div');filters.className='local-grid';filters.innerHTML='<label>查找资料<input id="referenceSearch" placeholder="商品名称、品牌或 ASIN"></label><label>资料类型<select id="referenceType"><option value="all">全部</option><option value="product">商品资料</option><option value="storefront">店铺装修页面</option></select></label>';dialog.querySelector('#referenceProducts').before(filters);
    filters.insertAdjacentHTML('beforeend','<label>商品类目<select id="referenceCategoryFilter"><option value="">全部类目</option></select></label>');
    filters.insertAdjacentHTML('beforeend','<label>风格参考集<select id="referenceCollectionFilter"><option value="">全部参考集</option></select></label>');
    dialog.querySelector('#referenceRefresh').onclick=e=>perform(e.currentTarget,refresh);
    dialog.querySelector('#referenceCollect').onsubmit=e=>{e.preventDefault();perform(dialog.querySelector('#referenceCollectButton'),async()=>{
      const job=await api('/api/research/jobs',{kind:'collect',requestId:crypto.randomUUID(),categoryUrls:dialog.querySelector('#referenceCategoryUrls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),category:dialog.querySelector('#referenceCategory').value,budgetUsd:Number(dialog.querySelector('#referenceBudget').value),candidateLimit:100});message('采集任务已创建：'+job.id);
    });};
    dialog.querySelector('#referenceFolder').onsubmit=e=>{e.preventDefault();perform(dialog.querySelector('#referenceImportFolder'),async()=>{await api('/api/research/import-folder',{folder:dialog.querySelector('#referenceFolderPath').value,title:dialog.querySelector('#referenceTitle').value,category:dialog.querySelector('#referenceLocalCategory').value});message('图片已导入，等待视觉分析。');});};
    dialog.querySelector('#referenceJSON').onchange=e=>perform(e.currentTarget,async()=>{const file=e.currentTarget.files[0];if(!file)return;const data=JSON.parse(await file.text());const result=await api('/api/research/import',{products:Array.isArray(data)?data:data.products,category:dialog.querySelector('#referenceLocalCategory').value});message(`导入 ${result.imported.length} 个商品；${result.rejected.length} 条未导入。${result.rejected.slice(0,3).map(r=>r.error).join('；')}`);});
    for(const [button,kind] of [['referenceDownload','download'],['referenceAnalyze','analyze']])dialog.querySelector('#'+button).onclick=e=>perform(e.currentTarget,async()=>{await api('/api/research/jobs',{kind,productIds:selected(),requestId:crypto.randomUUID()});message('任务已加入队列。完成后刷新查看。');});
    dialog.querySelector('#referenceUse').onclick=()=>{window.__designReferenceIds=selected();sessionStorage.setItem('workbench-reference-ids',JSON.stringify(window.__designReferenceIds));message(`当前商品策划已选择 ${selected().length} 套参考；仅使用已完成分析的项目。重新点击“一键构思”生效。`);};
    try {await refresh();}catch(error){message(error.message);}
  };
  try {window.__designReferenceIds=JSON.parse(sessionStorage.getItem('workbench-reference-ids') || '[]');}catch{window.__designReferenceIds=[];}
})();
