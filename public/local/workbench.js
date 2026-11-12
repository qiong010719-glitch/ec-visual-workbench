/* Additions to the preserved interface: local service status, restored planning, draft packages. */
(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notify = (text, error = false) => {
    if (window.aquaNotify) aquaNotify(error ? '操作未完成' : '本地工作台',text,error ? '⚠️' : '✓');
    else _showSimpleToast(text,error ? '#ff6b6b' : '#00ffc5');
  };
  const api = async (url, data) => {
    const response = await fetch(url,data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
  };
  const style = document.createElement('style');
  style.textContent = `
    .local-dialog {width:min(900px,94vw);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:22px;background:#1b2036;color:#edf0fa;padding:28px;box-shadow:0 30px 100px #0009;font:14px/1.65 system-ui}
    .local-dialog::backdrop{background:#080a1599;backdrop-filter:blur(8px)}
    .local-dialog h2{font-size:23px;margin:0 0 12px;font-weight:700}.local-dialog h3{font-size:16px;margin:20px 0 8px}
    .local-dialog input,.local-dialog select,.local-dialog textarea{width:100%;background:#ffffff0b;color:#fff;border:1px solid #ffffff25;border-radius:9px;padding:10px;font:inherit;margin:5px 0 13px}
    .local-dialog select option{background:#20263d}.local-dialog label{display:block;color:#b9c4d9;font-size:12px}
    .local-dialog button,.local-action{border:1px solid #ffffff30;border-radius:10px;padding:8px 15px;background:#ffffff0e;color:inherit;cursor:pointer}.local-dialog button:hover,.local-action:hover{background:#ffffff25}
    .local-dialog .primary{background:#357cf3;border-color:#357cf3}.local-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.local-muted{color:#a3afc7;font-size:12px}.local-card{background:#ffffff08;border:1px solid #ffffff19;border-radius:13px;padding:14px;margin-top:12px}
    .local-sku{display:grid;grid-template-columns:1fr 1.7fr 90px 80px 40px;gap:8px;align-items:center}.local-thumb{height:72px;width:72px;object-fit:cover;border-radius:8px}.local-dialog output{display:block;color:#f5bd75;white-space:pre-wrap}
    .local-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.local-head{display:flex;justify-content:space-between;align-items:center;gap:16px}.local-pill{font-size:11px;padding:4px 9px;border-radius:20px;background:#209be221;color:#9edcff}
    @media(max-width:650px){.local-sku{grid-template-columns:1fr 1fr}.local-grid{grid-template-columns:1fr}.local-dialog{padding:18px}.mac-tools .wp-hint{display:none!important}.mac-tool-btn{white-space:nowrap;flex-shrink:0;font-size:11px!important}.mac-tools{gap:5px!important}.mac-titlebar .mac-title{display:none}}
  `;
  document.head.appendChild(style);
  function modal(id,content) {
    $(id)?.remove();
    const dialog = document.createElement('dialog');dialog.id=id;dialog.className='local-dialog';dialog.innerHTML=content;
    dialog.addEventListener('click',e => {if (e.target === dialog) dialog.close();});
    document.body.appendChild(dialog);dialog.showModal();return dialog;
  }
  function closeButton(dialog) {dialog.querySelector('[data-close]').onclick=() => dialog.close();}

  // Replace remote storage transport, preserving the original material and canvas tools.
  window.cnUpload = async (blob,onProgress) => {const url = await LocalWorkbench.upload(blob);onProgress?.(100);return url;};
  window.editSetBaseFromUrl = async () => {
    const url=prompt('输入要导入的公开 HTTPS 图片地址：');
    if(!url)return;
    try {const imported=await api('/api/media/import',{url});editSetBase({url:imported.url,dataUrl:null,name:'导入图片'});}
    catch(error) {notify(error.message,true);}
  };
  window.guardGuest = () => false;
  window.maybeShowAnnounce = () => {};
  window.maybeShowModeModal = () => {};
  window.maybeStartResultTour = () => false;
  window.maybeShowLocalStatus = async () => {
    try {
      const status = await api('/api/status');
      const dialog = modal('localStatus',`<div class="local-head"><h2>本地工作台</h2><button data-close>关闭</button></div>
        <p>已复刻原站的公开页面和交互。任务、素材、评价与草稿保存在这台电脑。</p>
        <div class="local-card"><div>图片通道：<b>${escape($('modelChoice')?.selectedOptions[0]?.textContent?.replace(/^模型 · /,'') || status.model)}</b></div><div>专用图片密钥：${status.imageConfigured?'已配置':'未配置'}</div><div>图片下载：${status.downloadProxyConfigured?'已配置代理':'直接连接'}</div><div>待恢复下载：${status.recoverableDownloads || 0} 张</div><div>构思：${status.planner==='local-rules'?'本地规则方案，可手动修改':'已配置的文本模型'}</div><div>任务：${status.active} 个运行中 · ${status.queued} 个排队中</div></div>
        <p class="local-muted" style="margin-top:15px">点击生图会使用图片服务额度。页面测试点数仅用于记录流程；本地版不充值。原站的私有模型工作流与付费账户未复制。</p>
        <p class="local-muted">图片生成 / 编辑接口已接线，实际图片质量与比例取决于服务商。商品保存为本地草稿，不是淘宝草稿箱，也没有发布到淘宝。</p>`);
      closeButton(dialog);
    } catch(error) {notify(error.message,true);}
  };
  window.openRechargeModal = window.maybeShowLocalStatus;
  window.showContactAdmin = window.maybeShowLocalStatus;
  window.loadCredits = async () => {
    try {const record = await api('/api/orders');if ($('creditDisplay')) $('creditDisplay').textContent=`⚡ ${record.balance} 测试点`;}
    catch(error) {notify(error.message,true);}
  };
  window.openOrdersModal = async () => {
    const data = await api('/api/orders');
    const dialog=modal('localOrders',`<div class="local-head"><h2>本地任务记录</h2><button data-close>关闭</button></div><p class="local-muted">测试点数用于流程记录，不是实际扣费账单。真实费用以实际服务账单为准。</p><div>${data.charges.length?data.charges.slice().reverse().map(c=>`<div class="local-card"><b>${escape(c.created_at)}</b><div>${c.task_ids.length} 个任务 · 测试点数 ${c.amount} · 已退 ${c.refunded.length*c.unit}</div><div class="local-muted">${escape(c.task_ids.join('、'))}</div></div>`).join(''):'<p>暂无任务</p>'}</div>`);closeButton(dialog);
  };
  window.addEventListener('local-design-plan',event => {
    const data = event.detail;
    $('sopText').value=data.result;
    window._lastAgentTaskId=data.taskId;
    $('mainBtn').disabled=false;
    $('mainBtn').classList.add('ready-to-fuse');
    buildGalleryLayout();saveAppState();
    if ($('localPlanLabel')) $('localPlanLabel').textContent=({'local-rules':'本地规则构思完成','reference-rules':'参考库辅助构思完成','configured-planner':'模型构思完成','reference-planner':'参考库辅助模型构思完成'})[data.plan?.source] || '构思完成';
    if($('localPlanLabel')&&data.plan?.visualStyle)$('localPlanLabel').textContent+=' · '+(data.plan.generationMode==='master'?'大师':'快速')+' · '+data.plan.visualStyle.label;
  });
  window.addEventListener('local-task-failure',event => notify(event.detail.error || '生成失败',true));
  // Bind updates to the task that owns each visible slot; older products must not overwrite it.
  for(const [name,prefix] of [['resumeKieListener','slot-'],['resumeUltraKieListener','ultra-slot-']]) {
    const original=window[name];
    window[name]=function(slot,taskId,...args){
      const element=$(prefix+slot);if(element)element.dataset.localTaskId=taskId;
      return original.call(this,slot,taskId,...args);
    };
  }
  async function recoverSlot(task,button,ultra) {
    button.disabled=true;
    try {
      await api('/api/downloads/retry',{taskId:task.taskId});
      activeKieTasks=activeKieTasks.filter(t=>t.slot!==task.slot);
      activeKieTasks.push({slot:task.slot,taskId:task.taskId,isInpaint:true});saveAppState();
      if(ultra)resumeUltraKieListener(task.slot,task.taskId);else resumeKieListener(task.slot,task.taskId,true);
    } catch(error){button.disabled=false;notify(error.message,true);}
  }
  window.addEventListener('local-image-task-update',event=>{
    const task=event.detail;
    if(['pending','running'].includes(task.status))clearWatchdog('img:'+task.taskId);
    const slot=[$('slot-'+task.slot),$('ultra-slot-'+task.slot)].find(el=>el?.dataset.localTaskId===task.taskId);
    if(!slot)return;
    if(['pending','running'].includes(task.status)) {
      const label=slot.querySelector('.animate-pulse');
      if(label)label.textContent=task.status==='pending'?'排队中…':task.phase==='downloading'?(task.downloadAttempt>1?`下载重试（${task.downloadAttempt}/3）…`:'正在下载图片…'):'正在生成图片…';
    } else if(task.status==='failed' && task.canRetryDownload) {
      slot.classList.remove('standby');slot.classList.add('failed');
      slot.innerHTML=`<div style="padding:16px;text-align:center"><strong>图片已生成，下载未完成</strong><p class="local-muted">${escape(task.error || '下载失败')}</p><button type="button" class="local-action" data-download-retry>重试下载</button><p class="local-muted">只取回已有图片，不重新生图</p></div>`;
      if(slot.id.startsWith('ultra-'))slot.firstElementChild.classList.add('ultra-card-img-wrap');
      slot.querySelector('[data-download-retry]').onclick=event=>recoverSlot(task,event.currentTarget,slot.id.startsWith('ultra-'));
    }
  });
  async function openDownloadRecovery() {
    try {
      const tasks=await api('/api/downloads');
      const dialog=modal('localDownloads','<div class="local-head"><h2>恢复图片下载</h2><button data-close>关闭</button></div><p class="local-muted">这里恢复已经生成的图片，只重试下载。较早任务如果没有保存结果链接，将无法在这里恢复。</p><div data-download-list></div>');
      closeButton(dialog);
      const list=dialog.querySelector('[data-download-list]');
      if(!tasks.length)list.textContent='暂无可恢复的图片下载。';
      for(const task of tasks) {
        const card=document.createElement('article');card.className='local-card';list.appendChild(card);
        function render(current) {
          card.innerHTML=`<b>${escape(current.createdAt?new Date(current.createdAt).toLocaleString('zh-CN'):'图片任务')} · 图片 ${Number(current.slot)+1}</b><p class="local-muted">${escape(current.taskId)}</p><div data-result></div>`;
          const result=card.querySelector('[data-result]');
          if(current.status==='completed' && current.imageUrl){result.innerHTML=`<img class="local-thumb" src="${escape(current.imageUrl)}" alt="已恢复图片"><a class="local-action" href="${escape(current.imageUrl)}" download>下载图片</a>`;return;}
          if(current.status==='failed') {
            result.innerHTML=`<p>${escape(current.error || '下载未完成')}</p><button class="local-action" data-retry>重试下载</button>`;
            result.querySelector('[data-retry]').onclick=async event=>{
              event.currentTarget.disabled=true;
              try{render(await api('/api/downloads/retry',{taskId:current.taskId}));}catch(error){notify(error.message,true);render(current);}
            };
          } else {
            result.textContent=current.status==='pending'?'排队中…':'正在下载图片…';
            setTimeout(async()=>{if(!dialog.open)return;try{render(await api('/api/tasks/hyrule_tasks/'+current.taskId));}catch(error){result.textContent=error.message;}},1500);
          }
        }
        render(task);
      }
    } catch(error){notify(error.message,true);}
  }
  const restoreState=window.__loadAppStateFrom;
  window.__loadAppStateFrom=function(...args) {
    restoreState.apply(this,args);
    const count=imageSlots.filter(Boolean).length;
    if(count && !activeKieTasks.length) {
      const log=$($('generationMode').value==='ultra_fast'?'ultraLogContent':'logContent');
      if(log)log.textContent=`已恢复 ${count} 张图片，可继续编辑或下载。`;
    }
  };
  for(const name of ['triggerGeneration','editRunGeneration','qmRun','generateMobileReformat','sendInpaintTask','summonAgent']) {
    const original=window[name];
    if(!original)continue;
    window[name]=async function(...args) {
      if(name==='summonAgent' && $('generationMode').value!=='ultra_fast') return original.apply(this,args);
      try {
        const status=await api('/api/status');
        if(!status.imageConfigured) {notify('尚未配置专用图片密钥，请在通道状态中查看。',true);return;}
        return original.apply(this,args);
      } catch(error) {notify(error.message,true);}
    };
  }
  window.renderCostBill=function(...args) {
    const bill=$('scopeCostDisplay');
    if(bill) {bill.classList.remove('hidden');bill.textContent='构思与生图按实际调用计费；测试点数仅用于记录流程。';}
  };

  let currentDraft=null;
  function currentImages() {
    return [...new Set([
      ...(typeof imageSlots!=='undefined'?imageSlots:[]).filter(Boolean).map(v=>v.url),
      ...(typeof editHistory!=='undefined'?editHistory:[]),
      ...(typeof mobileSlots!=='undefined'?mobileSlots:[]).filter(Boolean).map(v=>v.url)
    ].filter(v=>typeof v==='string' && v.startsWith('/media/')))];
  }
  function skuRow(sku={code:'',name:'',price:'',stock:''}) {
    const row=document.createElement('div');row.className='local-sku';
    row.innerHTML=`<input aria-label="SKU 编码" placeholder="编码" data-sku="code" value="${escape(sku.code)}"><input aria-label="SKU 名称" placeholder="规格名称" data-sku="name" value="${escape(sku.name)}"><input aria-label="SKU 价格" placeholder="价格" min="0" step="0.01" type="number" data-sku="price" value="${escape(sku.price)}"><input aria-label="SKU 库存" placeholder="库存" min="0" step="1" type="number" data-sku="stock" value="${escape(sku.stock)}"><button type="button" aria-label="移除此 SKU">×</button>`;
    row.querySelector('button').onclick=()=>row.remove();return row;
  }
  async function openDraftEditor(draft) {
    currentDraft=draft || null;
    const images=draft?.images || currentImages();
    const dialog=modal('localDraftEditor',`<div class="local-head"><h2>${draft?'编辑':'保存'}商品草稿</h2><button data-close>关闭</button></div>
      <p class="local-muted">保存到本机草稿，不是淘宝草稿箱，也没有发布到淘宝。资料包可交给人工上架；平台必填字段仍需按实际类目匹配。</p>
      <form id="draftForm"><label>商品标题<input id="draftTitle" required maxlength="160" value="${escape(draft?.title || $('prodName').value)}"></label>
      <div class="local-grid"><label>目标平台<select id="draftPlatform"><option>通用</option><option>淘宝</option><option>抖店</option><option>Amazon</option></select></label><label>状态<input value="草稿 · 未发布" readonly></label></div>
      <label>商品说明<textarea id="draftDescription" rows="3">${escape(draft?.description || $('prodDesc').value)}</textarea></label>
      <h3>SKU</h3><div id="draftSkus"></div><button type="button" id="draftAddSku">＋ 添加 SKU</button>
      <h3>图片 · ${images.length} 张</h3><div class="local-row">${images.map(u=>`<img class="local-thumb" src="${escape(u)}" alt="草稿图片">`).join('') || '<span class="local-muted">暂无已生成图片，可以先保存资料。</span>'}</div>
      <output id="draftError"></output><div class="local-row" style="margin-top:22px"><button class="primary" type="submit">保存草稿</button><button type="button" id="draftExport">导出资料包 ZIP</button><button type="button" id="draftList">草稿箱</button></div></form>`);
    closeButton(dialog);$('draftPlatform').value=draft?.platform || '淘宝';
    for(const sku of draft?.skus || []) $('draftSkus').appendChild(skuRow(sku));
    $('draftAddSku').onclick=()=>$('draftSkus').appendChild(skuRow());
    const read = () => {
      const skus=[...$('draftSkus').children].map(row=>{
        const data={};row.querySelectorAll('[data-sku]').forEach(el=>data[el.dataset.sku]=el.value.trim());
        if(!data.code || !data.name || data.price==='' || data.stock==='') throw new Error('请补齐每条 SKU 的编码、名称、价格和库存');
        return {...data,price:Number(data.price),stock:Number(data.stock)};
      });
      return {id:currentDraft?.id,title:$('draftTitle').value,platform:$('draftPlatform').value,description:$('draftDescription').value,skus,images,sop:draft?.sop || $('sopText').value,status:'draft'};
    };
    async function save() {
      const result=await api('/api/drafts',read());
      const persisted=(await api('/api/drafts')).find(v=>v.id===result.id);
      if(!persisted || persisted.updatedAt!==result.updatedAt) throw new Error('保存后的草稿未能重新读取');
      currentDraft=persisted;notify('草稿已保存并重新读取核对');return persisted;
    }
    $('draftForm').onsubmit=async event=>{event.preventDefault();try {await save();$('draftError').textContent='已保存 · 未发布';}catch(error){$('draftError').textContent=error.message;}};
    $('draftExport').onclick=async()=>{try {const saved=await save();await exportDraft(saved);}catch(error){$('draftError').textContent=error.message;}};
    $('draftList').onclick=()=>{dialog.close();openDraftList();};
  }
  async function exportDraft(draft) {
    const zip=new JSZip();
    zip.file('商品草稿.json',JSON.stringify(draft,null,2));
    zip.file('设计方案.txt',draft.sop || '');
    zip.file('说明.txt','状态：本地草稿，未发布。不是淘宝草稿箱，未调用淘宝发布接口。平台字段、SKU 和图片请按实际类目审核后交给人工上架流程。');
    const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
    zip.file('SKU.csv','\uFEFF'+[['编码','名称','价格','库存'],...draft.skus.map(s=>[s.code,s.name,s.price,s.stock])].map(row=>row.map(csvCell).join(',')).join('\r\n'));
    for(let i=0;i<draft.images.length;i++) {
      const response=await fetch(draft.images[i]);if(!response.ok)throw new Error(`第 ${i+1} 张图片无法读取`);
      zip.file(`images/${String(i+1).padStart(2,'0')}.${draft.images[i].split('.').pop()}`,await response.blob());
    }
    const blob=await zip.generateAsync({type:'blob'});const url=URL.createObjectURL(blob);const link=document.createElement('a');
    link.href=url;link.download=draft.title.replace(/[<>:"/\\|?*]/g,'_')+'-草稿.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function openDraftList() {
    try {
      const drafts=await api('/api/drafts');
      const dialog=modal('localDraftList',`<div class="local-head"><h2>本地草稿箱 · ${drafts.length}</h2><button data-close>关闭</button></div><div class="local-row"><button id="draftNew" class="primary">从当前工作台新建草稿</button></div><div id="draftCards"></div>`);
      closeButton(dialog);$('draftNew').onclick=()=>{dialog.close();openDraftEditor();};
      if(!drafts.length) $('draftCards').innerHTML='<p class="local-muted" style="margin-top:24px">尚未保存草稿。可以先完善产品资料，再添加生成图片。</p>';
      for(const draft of drafts) {
        const card=document.createElement('article');card.className='local-card';
        card.innerHTML=`<div class="local-head"><strong>${escape(draft.title)}</strong><span class="local-pill">草稿 · 未发布</span></div><p class="local-muted">${escape(draft.platform)} · ${draft.skus.length} 个 SKU · ${draft.images.length} 张图片 · ${escape(new Date(draft.updatedAt).toLocaleString('zh-CN'))}</p><div class="local-row"><button data-edit>打开草稿</button><button data-export>导出 ZIP</button></div>`;
        card.querySelector('[data-edit]').onclick=()=>{dialog.close();openDraftEditor(draft);};
        card.querySelector('[data-export]').onclick=()=>exportDraft(draft).catch(e=>notify(e.message,true));
        $('draftCards').appendChild(card);
      }
    } catch(error) {notify(error.message,true);}
  }
  window.openLocalDrafts=openDraftList;
  window.openLocalDraftEditor=openDraftEditor;

  function setup() {
    $('authOverlay').style.display='none';
    $('announceModal')?.classList.remove('show');
    $('modeSelectionModal').style.display='none';
    const recharge=$('rechargeBtn');if(recharge)recharge.textContent='通道状态';
    const header=$('view-dashboard').querySelector('header');
    const actions=document.createElement('div');actions.className='local-row';
    actions.innerHTML='<span class="local-pill" id="localPlanLabel">本地复刻</span><button class="local-action" id="localDraftButton">草稿箱</button><button class="local-action" id="localReferenceButton">设计参考库</button><button class="local-action" id="localDownloadsButton">恢复下载</button>';
    header?.appendChild(actions);$('localDraftButton').onclick=openDraftList;$('localDownloadsButton').onclick=openDownloadRecovery;
    const referenceScript=document.createElement('script');referenceScript.src='/local/research.js';
    referenceScript.onload=()=>{$('localReferenceButton').onclick=()=>window.openReferenceLibrary();};document.head.appendChild(referenceScript);
    LocalWorkbench.imageModelStatus().then(status=>{
      const choice=$('modelChoice'),selected=choice.value;
      choice.replaceChildren(...status.imageModels.map(model=>new Option('模型 · '+model.label,model.id)));
      if(selected && !status.imageModels.some(model=>model.id===selected)){
        const unavailable=new Option('模型 · '+selected+'（服务暂不支持）',selected);unavailable.disabled=true;choice.add(unavailable);
      }
      choice.value=selected || status.model;
      if(status.isolatedPreview){const previewNotice=document.createElement('p');previewNotice.className='local-muted';previewNotice.textContent='风格更新预览 · 使用独立数据副本，新任务保存在此预览中。';actions.after(previewNotice);}
      $('modelChoice').dispatchEvent(new Event('change',{bubbles:true}));
    }).catch(error=>notify(error.message,true));
    for(const id of ['genChannel','editChannel']) {const element=$(id);if(element)element.innerHTML='<option value="kie">渠道 · 图片生成服务</option>';}
    $('modelChoice').dispatchEvent(new Event('change',{bubbles:true}));
    for(const id of ['genChannel','editChannel']) $(id)?.dispatchEvent(new Event('change',{bubbles:true}));
    const note=document.createElement('p');note.className='local-muted';note.style.margin='12px 0';
    note.textContent='本地版：先生成可编辑的设计方案，再提交图片任务。新增商品在草稿箱保存与导出。';
    $('agentBtn')?.parentElement?.appendChild(note);
    const confirmation=$('agentConfirmModal');
    if(confirmation) {
      const text=confirmation.querySelector('.modal-body') || confirmation.querySelector('p');
      if(text)text.textContent='将根据产品资料和已分析的设计参考生成可编辑方案。若已配置构思模型，会使用其额度；生图将在你点击「开始生成」后提交。';
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
