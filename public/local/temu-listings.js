(() => {
  'use strict';
  const $=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const displayError=message=>/^Command failed:.*powershell\.exe[\s\S]*Get-NetTCPConnection/.test(message||'')?'旧版检查 Chrome 端口时失败，未能完成本次操作。请使用新版检查 ERP 环境，再按执行状态核对或继续。':message;
  let token,config,preview,rows=[],batch,previews=[],timer,mode='raw',stage='generation',pending=0,productTasks=[],executions=[];
  let configReady=false,refreshingConfig=false,taskContext=null;
  const intakeKey='listing-intake-v1';
  const intakeFields=['folderPath','workbookPath','outputParent','batchName','imageCount','ratio','mode','imageModel','generatedChoice','executionMode'];
  function saveIntake(){
    if(!configReady||preview||batch||generation.batch)return;
    try{
      localStorage.setItem(intakeKey,JSON.stringify({version:1,mode,erpKey:$('erpConnection').value,storeKey:$('targetStore').value,motherKey:getMotherKey(),fields:Object.fromEntries(intakeFields.map(id=>[id,$(id).value])),generation:generation.snapshotIntake()}));
      remember('intake','');
    }catch{notice('本机空间不足，商品资料无法自动暂存，请先保存本批商品后再离开。',true);}
  }
  function restoreIntake(){
    try{
      const draft=JSON.parse(localStorage.getItem(intakeKey));
      if(draft?.version!==1||!['raw','folder','generated'].includes(draft.mode)||!draft.fields||!Array.isArray(draft.generation?.products)||!draft.generation.products.every(p=>p&&Array.isArray(p.images))||typeof draft.generation.requestId!=='string')return false;
      renderConnections(draft.erpKey||'',draft.storeKey||'');rememberMother(draft.motherKey);
      selectSource(draft.mode,draft.fields.generatedChoice);
      for(const id of intakeFields){
        if(id==='generatedChoice')continue;
        const field=$(id),value=draft.fields[id];
        if(typeof value==='string'&&(field.tagName!=='SELECT'||[...field.options].some(o=>o.value===value)))field.value=value;
      }
      generation.restoreIntake(draft.generation);
      if(draft.generation.sourceFolder)showPaths({sourceFolder:draft.generation.sourceFolder,outputParent:$('outputParent').value});
      modeText();paintMother();syncControls();return true;
    }catch{notice('暂存的商品资料无法恢复，请检查本机存储后重试。',true);return false;}
  }
  const labels={ready:'待执行',running:'执行中',pending:'排队中',saving:'正在保存',verified:'待发布 · 已核验',completed:'全部完成',failed:'已停止',paused:'已暂停',interrupted:'运行中断','needs-review':'保存结果待核对',connecting:'连接浏览器','checking-duplicates':'核对重复商品',building:'填写新草稿',uploading:'上传主图',description:'补入详情图','reading-back':'重新打开核验'};
  Object.assign(labels,{publishing:'正在提交发布',submitted:'已提交 · 等待平台结果',listed:'店小秘在线 · 生命周期待同步',online:'平台显示在售',reviewing:'平台审核中','pending-launch':'平台待上架','publication-failed':'发布失败','publication-unknown':'发布结果待核对','titles-updated':'未执行条目标题已更新'});
  const request=async(route,data)=>{const r=await fetch(route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw new Error(v.error||'请求失败');return v;};
  const api=(route,data)=>request('/api/temu/erp/'+route,data);
  const notice=(text,error=false)=>{$('listingNotice').hidden=!text;$('listingNotice').textContent=text;$('listingNotice').classList.toggle('error',error);};
  function collectRows(){
    for(const article of $('productRows').querySelectorAll('[data-row]')){
      const row=rows[Number(article.dataset.row)];if(!row)continue;
      const folder=row.folder;
      for(const field of article.querySelectorAll('[data-field]'))row[field.dataset.field]=field.value;
      if(folder!==row.folder)row.imageIds=preview.folders.find(f=>f.name===row.folder)?.images.map(i=>i.id)||[];
      else row.imageIds=Array.from(article.querySelectorAll('input[data-image]:checked'),input=>input.dataset.image);
    }
  }
  async function action(button,work){pending++;button.disabled=true;notice('');syncControls();try{await work();}catch(e){notice(e.message,true);}finally{pending--;button.disabled=false;if(batch)renderBatch();syncControls();saveIntake();}}
  function saveReview(){if(!preview)return;try{localStorage.setItem('erp-review-'+preview.id,JSON.stringify({...taskContext,rows,storeKey:$('targetStore').value,erpKey:$('erpConnection').value,motherKey:getMotherKey()}));localStorage.setItem('erp-review-current',preview.id);remember('preview',preview.id);}catch{notice('本机存储空间不足，请先生成执行清单保存本次修改。',true);}}
  function invalidate(){saveReview();if(batch?.status!=='running'){batch=null;$('executionPanel').hidden=true;}localStorage.removeItem('temu-erp-active');syncControls();}
  function setPreview(p){preview=p;rows=p.rows.map(r=>({...r,templateKey:r.templateKey||getMotherKey(),imageIds:p.folders.find(f=>f.name===r.folder)?.images.map(i=>i.id)||[]}));try{const saved=JSON.parse(localStorage.getItem('erp-review-'+p.id));if(saved&&(!$('targetStore').value||saved.storeKey===$('targetStore').value)){rows=rows.map(r=>({...r,...saved.rows.find(x=>x.rowId===r.rowId),...(r.chineseTitle?{chineseTitle:r.chineseTitle}:{})}));if(!taskContext)restoreContext(saved);if(saved.motherKey)rememberMother(saved.motherKey);paintMother();}}catch{}restoreExecutionMode('preview',p.id,$('executionMode').value);invalidate();renderRows();showPaths(p.source);showStage('review');remember('preview',p.id);paintMother();}
  function showPaths(s={}){$('pathSummary').hidden=false;$('sourceLocation').textContent=s.sourceFolder||s.folder||(s.kind==='product-batch'?'此历史批次未记录原始文件夹':'工作台已有素材');$('resultLocation').textContent=s.resultFolder||s.outputParent||'生成完成后自动整理';$('workbookLocation').textContent=s.workbook||(s.resultFolder?s.resultFolder+'\\商品.xlsx':'生成完成后自动写入商品.xlsx');}
  function renderRows(){
    $('reviewEmpty').hidden=!!preview;$('prepareBatch').disabled=!preview;$('reviewSummary').textContent=preview?`${rows.length} 条商品 · ${preview.folders.reduce((n,f)=>n+f.images.length,0)} 张图片`: '尚未导入素材';
    $('productRows').innerHTML=rows.map((r,index)=>{
      const f=preview.folders.find(f=>f.name===r.folder),images=f?[...f.images].sort((a,b)=>{const ai=r.imageIds.indexOf(a.id),bi=r.imageIds.indexOf(b.id);return (ai<0?999:ai)-(bi<0?999:bi);}):[];
      return `<article class="listing-row" data-row="${index}"><div class="row-head"><strong>商品 ${index+1}</strong><span>${r.imageIds.length} 张选中 · 主图 / 详情共用</span></div>${r.chineseTitle?`<p class="hint">中文核对：${escape(r.chineseTitle)}</p>`:''}<div class="row-fields">${[['productCode','货号'],['title','上架标题（'+(getStore()?.titleLanguage?.label||'按店铺国家')+'）'],['englishTitle','英文标题']].map(([key,label])=>`<label>${label}<input data-field="${key}" aria-label="商品${index+1}${label}" value="${escape(r[key])}" maxlength="${key==='productCode'?60:250}"></label>`).join('')}<label>商品母稿<select data-field="templateKey" aria-label="商品${index+1}母稿">${motherOptions(r.templateKey||getMotherKey())}</select></label><label>图片文件夹<select data-field="folder" aria-label="商品${index+1}图片文件夹"><option value="">请选择对应文件夹</option>${preview.folders.map(f=>`<option value="${escape(f.name)}"${f.name===r.folder?' selected':''}>${escape(f.name)}</option>`).join('')}</select></label></div>${f?`<div class="image-strip">${images.map(i=>`<figure class="listing-thumb ${r.imageIds.includes(i.id)?'':'excluded'}"><img src="${escape(i.url)}" alt="${escape(i.name)}" loading="lazy"><figcaption><label><input type="checkbox" data-image="${i.id}" ${r.imageIds.includes(i.id)?'checked':''}>${r.imageIds.includes(i.id)?r.imageIds.indexOf(i.id)+1:'不使用'}</label><button type="button" data-earlier="${i.id}" aria-label="将图片${r.imageIds.indexOf(i.id)+1}前移" ${r.imageIds.indexOf(i.id)<=0?'disabled':''}>前移</button></figcaption></figure>`).join('')}</div>`:'<p class="folder-warning">货号未匹配文件夹，请在上方选择。</p>'}</article>`;
    }).join('');paintMother();
  }
  $('productRows').addEventListener('input',e=>{const article=e.target.closest('[data-row]');if(!article)return;const row=rows[Number(article.dataset.row)],field=e.target.dataset.field;
    if(field&&field!=='folder'&&field!=='templateKey'){collectRows();invalidate();}
  });
  $('productRows').addEventListener('change',e=>{const article=e.target.closest('[data-row]');if(!article)return;const row=rows[Number(article.dataset.row)];
    if(!e.target.dataset.field&&!e.target.dataset.image)return;
    collectRows();
    invalidate();if(['folder','templateKey'].includes(e.target.dataset.field)||e.target.dataset.image)renderRows();
  });
  $('productRows').addEventListener('click',e=>{const button=e.target.closest('[data-earlier]');if(!button)return;collectRows();const row=rows[Number(button.closest('[data-row]').dataset.row)],at=row.imageIds.indexOf(button.dataset.earlier);if(at>0){[row.imageIds[at-1],row.imageIds[at]]=[row.imageIds[at],row.imageIds[at-1]];invalidate();renderRows();}});
  function getMotherKey(){
    const shop=getStore();if(!shop)return '';
    let saved;try{saved=localStorage.getItem('listing-mother:'+shop.key);}catch{}
    return shop.templates.find(t=>t.key===saved)?.key||shop.templates[0]?.key||'';
  }
  function motherOptions(key,withId=false){
    const templates=getStore()?.templates||[];
    return (key&&!templates.some(t=>t.key===key)?`<option value="${escape(key)}" selected disabled>原母稿已移除，请重新选择</option>`:'')+templates.map(t=>`<option value="${escape(t.key)}" ${t.key===key?'selected':''}>${escape(t.name)}${withId?' · '+escape(t.draftId):''}</option>`).join('');
  }
  function updateChoices(select,options,value){
    const previous=select.selectedOptions[0]?.textContent||value;
    select.innerHTML=options;
    if(value&&![...select.options].some(o=>o.value===value))select.add(new Option(previous+'（已移除）',value));
    select.value=value;
    for(const option of select.options)if(option.textContent.endsWith('（已移除）'))option.disabled=true;
  }
  const getErp=()=>config?.erpConnections.find(e=>e.key===$('erpConnection').value);
  const getStore=()=>config?.stores.find(s=>s.key===$('targetStore').value&&s.erpKey===$('erpConnection').value);
  const listingErps=()=>config?.erpConnections.filter(e=>!e.provider||e.provider==='dianxiaomi')||[];
  function currentBinding(){const erpConnection=getErp();return erpConnection?{erpConnection,browserConfig:config.browsers.find(b=>b.key===erpConnection.browserKey)}:null;}
  const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  function bindingIssue(){
    if(!taskContext)return '';
    const s=getStore(),binding=currentBinding();
    if(!s||!binding?.browserConfig||taskContext.storeKey!==s.key||taskContext.erpKey!==s.erpKey||taskContext.browserKey&&taskContext.browserKey!==binding.browserConfig.key||taskContext.connectionBinding&&canonical(taskContext.connectionBinding)!==canonical(binding)||taskContext.storeName&&taskContext.storeName!==s.expectedStore||taskContext.site&&taskContext.site!==s.expectedSite)return '本批使用的 ERP、店铺或浏览器绑定已变化。请核对连接设置；原素材与执行记录已保留，需要更换连接时请新建批次。';
    return '';
  }
  function resetConnectionState(){$('connectionState').textContent='选择已保存的 ERP 连接，再检查登录状态。';}
  function renderConnections(erpKey=$('erpConnection').value,storeKey=$('targetStore').value){
    updateChoices($('erpConnection'),'<option value="">请选择 ERP 连接</option>'+listingErps().map(e=>`<option value="${escape(e.key)}">${escape(e.name)} · 店小秘</option>`).join(''),erpKey);
    const shops=config.stores.filter(s=>s.erpKey===erpKey&&s.platform==='temu');
    updateChoices($('targetStore'),`<option value="">${!erpKey?'请先选择 ERP 连接':shops.length?'请选择店铺':'该 ERP 尚未关联店铺'}</option>`+shops.map(s=>`<option value="${escape(s.key)}">${escape(s.expectedStore)} · ${escape(s.expectedSite)}</option>`).join(''),storeKey);
    if(!$('storeSyncStatus').dataset.failed)$('storeSyncStatus').hidden=true;
  }
  function restoreContext(source){
    const storeKey=source.storeKey||source.store?.key,erpKey=source.erpKey||source.store?.erpKey||source.store?.erpConnection?.key||config.stores.find(s=>s.key===storeKey)?.erpKey||'';
    if($('erpConnection').value!==erpKey)resetConnectionState();
    renderConnections(erpKey,storeKey||'');
    taskContext={storeKey,erpKey,browserKey:source.browserKey,connectionBinding:source.connectionBinding||(source.store?.erpConnection&&source.browserConfig?{erpConnection:source.store.erpConnection,browserConfig:source.browserConfig}:undefined),storeName:source.storeName||source.store?.expectedStore,site:source.site||source.store?.expectedSite};
  }
  async function refreshStoreConfig(){
    if(!configReady||document.hidden||isBusy()||refreshingConfig)return;
    refreshingConfig=true;
    try{
      const next=await api('config');
      if(isBusy())return;
      if(JSON.stringify(next)===JSON.stringify(config)){
        if($('storeSyncStatus').dataset.failed){$('storeSyncStatus').hidden=true;delete $('storeSyncStatus').dataset.failed;}
        return;
      }
      // Refresh choices only: adding a store must not rebind an existing batch or erase edits.
      const storeKey=$('targetStore').value,erpKey=$('erpConnection').value,beforeBinding=canonical(currentBinding());
      collectRows();config=next;
      renderConnections(erpKey,storeKey);
      if(beforeBinding!==canonical(currentBinding()))resetConnectionState();
      generation.refreshStoreOptions();
      for(const article of $('productRows').querySelectorAll('[data-row]')){
        const row=rows[Number(article.dataset.row)],select=article.querySelector('[data-field="templateKey"]');
        if(select){select.innerHTML=motherOptions(row.templateKey);select.value=row.templateKey||'';}
      }
      paintMother();syncControls();
      const status=$('storeSyncStatus');status.hidden=false;delete status.dataset.failed;status.textContent=bindingIssue()||`连接设置已同步，当前 ERP 下有 ${config.stores.filter(s=>s.erpKey===$('erpConnection').value).length} 家店铺。`;
    }catch{const status=$('storeSyncStatus');status.hidden=false;status.dataset.failed='true';status.textContent='店铺列表暂时无法更新，已保留当前选择，稍后自动重试。';}
    finally{refreshingConfig=false;}
  }
  function rememberMother(key){const shop=getStore();if(shop?.templates.some(t=>t.key===key))try{localStorage.setItem('listing-mother:'+shop.key,key);}catch{}}
  function motherLocked(){return stage==='review'?[batch,...executions.filter(e=>e.previewId===preview?.id&&e.store.key===$('targetStore').value)].some(e=>e?.rows.some(r=>r.status!=='pending'||r.draftId)):!!generation.batch?.previewId&&executions.some(e=>e.previewId===generation.batch.previewId);}
  function paintMother(){
    const shop=getStore(),keys=[...new Set((stage==='review'?rows.map(r=>r.templateKey||getMotherKey()):generation.motherKeys()).filter(Boolean))];
    const mixed=keys.length>1,key=mixed?'':keys[0]||getMotherKey(),selected=shop?.templates.find(t=>t.key===key);
    $('batchMother').innerHTML=(mixed?'<option value="">多份母稿（按商品选择）</option>':'')+(motherOptions(key,true)||'<option value="">请先选择店铺</option>');
    $('batchMother').value=key;
    $('erpBinding').textContent=bindingIssue()||(getErp()?(config.stores.some(s=>s.erpKey===getErp().key)?'使用此 ERP 连接中已保存的登录环境。':'此 ERP 尚未关联店铺，请在连接设置中添加或修改店铺。'):'先选择 ERP 连接，再选择它的店铺和母稿。');
    $('motherInfo').innerHTML=selected?`<strong>${escape(selected.name)}</strong><a href="https://www.dianxiaomi.com/web/popTemu/edit?id=${escape(selected.draftId)}" target="_blank" rel="noopener">查看母稿 ${escape(selected.draftId)}</a><p>引用该母稿的类目、规格、仓库与运费设置。</p>`:mixed?'<p>本批商品使用不同母稿，请在各商品内查看。</p>':'<p class="muted">选择店铺后，使用对应的母稿。</p>';
    $('batchMotherHint').textContent=motherLocked()?'本批已有执行清单，母稿已锁定。新增商品请新建批次。':'选择后应用于本批全部商品，也可在商品内单独调整。';
    $('batchMother').disabled=isBusy()||!shop?.templates.length||motherLocked();
  }
  function mother(){collectRows();rows.forEach(r=>r.templateKey=getMotherKey());invalidate();renderRows();}
  $('batchMother').onchange=()=>{const key=$('batchMother').value;if(!key||isBusy()||motherLocked())return;action($('batchMother'),async()=>{
    if(!getStore()?.templates.some(t=>t.key===key))throw new Error('请选择当前店铺的母稿');
    if(stage==='review'){collectRows();rows.forEach(r=>r.templateKey=key);rememberMother(key);invalidate();renderRows();}
    else{await generation.applyMother(key);rememberMother(key);}
    paintMother();notice('本批商品已选择母稿：'+getStore().templates.find(t=>t.key===key).name);
  });};
  $('erpConnection').onchange=()=>{taskContext=null;resetConnectionState();renderConnections($('erpConnection').value,'');mother();generation.storeChanged();paintMother();syncControls();};
  $('targetStore').onchange=()=>{taskContext=null;mother();generation.storeChanged();paintMother();syncControls();};
  $('checkConnection').onclick=()=>action($('checkConnection'),async()=>{const erpKey=getErp()?.key;if(!erpKey)throw new Error('请先选择 ERP 连接');$('connectionState').textContent='正在检查所选 ERP 的登录环境…';try{const s=await api('connection',{erpKey});if($('erpConnection').value!==erpKey)return;$('connectionState').textContent=s.accountMatched===false?'店小秘账号不匹配，请检查连接设置。':s.loggedIn?'店小秘已登录'+(s.account?'：'+s.account:''):s.connected?'ERP 浏览器可连接，请在其中完成店小秘登录。':'ERP 环境无法连接';}catch(e){$('connectionState').textContent=e.message;throw e;}});
  function selectSource(next,sourceChoice){mode=next;showStage(next==='raw'?'generation':'input');$('folderSource').hidden=next==='generated';$('generatedSource').hidden=next!=='generated';$('workbookOptions').hidden=next!=='folder';
    $('outputOptions').hidden=next!=='raw';
    for(const [id,value] of [['rawTab','raw'],['folderTab','folder'],['generatedTab','generated']])$(id).setAttribute('aria-pressed',String(value===next));
    $('folderHint').textContent=next==='raw'?'单个产品：直接选择放图片的文件夹。多个产品：选择包含各产品子文件夹的上一级目录。每个产品 1—8 张 PNG / JPG / WebP / AVIF；资料可用“商品资料.txt”或 Excel 填写，结果目录会自动跳过。':'文件夹内放一份 .xls / .xlsx 和图片子文件夹。表格包含货号、标题、英文标题，货号对应子文件夹名。';
    if(next==='generated')loadSources(sourceChoice).catch(e=>notice(e.message,true));syncControls();saveIntake();
  }
  for(const [id,value] of [['rawTab','raw'],['folderTab','folder'],['generatedTab','generated']])$(id).onclick=()=>{if(isBusy())return;clearWorkspace();selectSource(value);};
  async function loadPreviews(){previews=await api('previews');}
  $('browseFolder').onclick=()=>action($('browseFolder'),async()=>{if(!window.desktop){notice('网页测试时请粘贴文件夹完整路径；桌面版支持浏览选择。');return;}const p=await window.desktop.chooseFolder();if(p)$('folderPath').value=p;});
  $('browseOutput').onclick=()=>action($('browseOutput'),async()=>{if(!window.desktop){notice('请在生成结果保存位置粘贴本机文件夹完整路径。');return;}const p=await window.desktop.chooseFolder();if(p)$('outputParent').value=p;});
  $('importFolder').onclick=()=>action($('importFolder'),async()=>{
    if(mode==='raw'){const result=await request('/api/products/import-folder',{folder:$('folderPath').value.trim(),outputParent:$('outputParent').value.trim()||undefined});generation.import(result);showPaths({...result,outputParent:$('outputParent').value});const skipped=(result.ignoredFolders||[]).map(f=>`「${f.name}」（${f.reason}）`).join('、');notice(`已读取 ${result.products.length} 个产品、${result.products.reduce((n,p)=>n+p.images.length,0)} 张原图。${skipped?'已跳过 '+skipped+'。':''}请选择母稿和裂变套数；商品卖点可填写，也可留空由 AI 识别。`);}
    else{const p=await api('import-folder',{folder:$('folderPath').value.trim(),workbook:$('workbookPath').value.trim()||undefined});await history();setPreview(p);notice('素材已读取，请核对货号、标题和图片顺序。');}
  });
  async function loadSources(selected=$('generatedChoice').value){const s=await api('sources');$('generatedChoice').innerHTML='<option value="">请选择已完成素材</option>'+s.groups.map(g=>`<option value="group:${g.id}" ${g.completedImages!==g.totalImages||!g.totalImages?'disabled':''}>裂变：${escape(g.name)} · ${g.count} 套 · ${g.completedImages}/${g.totalImages} 张</option>`).join('')+s.drafts.map(d=>`<option value="draft:${d.id}">图片草稿：${escape(d.title)} · ${d.count} 张</option>`).join('');if([...$('generatedChoice').options].some(o=>o.value===selected&&!o.disabled))$('generatedChoice').value=selected;saveIntake();}
  $('refreshSources').onclick=()=>action($('refreshSources'),loadSources);
  $('importGenerated').onclick=()=>action($('importGenerated'),async()=>{const [kind,id]=$('generatedChoice').value.split(':');if(!id)throw new Error('请选择已完成的素材');const p=await api('import-generated',kind==='group'?{groupId:id}:{draftId:id});await history();setPreview(p);notice('已载入生成图片，请核对每套货号并补全本站语言标题和英文版本。');});
  function modeText(){const publish=$('executionMode').value==='publish';$('modeHint').textContent=publish?'保存并核验后提交发布；提交成功不代表平台已在售。':'保存到店小秘待发布。';document.querySelector('.destination-label').textContent=publish?'保存并发布':'仅保存草稿';}
  function executionModeKey(kind='none',id=''){
    // Generation and review belong to one batch and must share its selection.
    if(kind==='execution'){
      const execution=batch?.id===id?batch:executions.find(b=>b.id===id);
      if(execution){kind='preview';id=execution.previewId;}
    }
    if(kind==='preview'){
      const source=(preview?.id===id?preview:previews.find(p=>p.id===id))?.source;
      if(source?.batchId){kind='product';id=source.batchId;}
    }
    return 'listing-execution-mode:'+kind+':'+id;
  }
  function saveExecutionMode(kind,id){
    try{localStorage.setItem(executionModeKey(kind,id),$('executionMode').value);}
    catch{notice('无法在本机保存执行方式，请先生成执行清单保存本次选择。',true);}
  }
  function restoreExecutionMode(kind,id,fallback='draft'){
    let value=fallback;try{value=localStorage.getItem(executionModeKey(kind,id))??fallback;}catch{}
    $('executionMode').value=value==='publish'?'publish':'draft';modeText();
  }
  $('executionMode').onchange=()=>{const active=activeTask();saveExecutionMode(active?.kind,active?.id);invalidate();modeText();};
  $('prepareBatch').onclick=()=>action($('prepareBatch'),async()=>{if(!preview)throw new Error('请先导入素材');if(bindingIssue())throw new Error(bindingIssue());if(!getStore())throw new Error('请先选择 ERP 连接和对应店铺');collectRows();saveReview();batch=await api('prepare',{...taskContext,connectionBinding:taskContext?.connectionBinding||currentBinding(),previewId:preview.id,storeKey:getStore().key,erpKey:getErp().key,executionMode:$('executionMode').value,rows});restoreContext(batch);localStorage.setItem('temu-erp-active',batch.id);remember('execution',batch.id);renderBatch();await history();notice('执行清单已保存。请核对下方执行方式和商品。');$('executionPanel').scrollIntoView({behavior:'smooth',block:'start'});});
  function renderBatch(){
    if(!batch)return;$('executionPanel').hidden=false;$('executionSummary').textContent=`${batch.store.expectedStore} · ${batch.store.expectedSite} · ${batch.rows.length} 条 · 按每条商品所选母稿填写`;$('batchState').textContent=labels[batch.status]||batch.status;
    $('executionRows').innerHTML=batch.rows.map(r=>`<div class="execution-row"><strong>${escape(r.productCode)}</strong><span>${escape(r.title)}</span><span>${labels[r.status]||escape(r.status)}</span>${r.url?`<a href="${escape(r.url)}" target="_blank" rel="noopener">查看店小秘商品</a>`:''}${r.draftId&&batch.executionMode==='publish'?`<button data-publication="${escape(r.rowId)}" type="button" ${batch.status==='running'?'disabled':''}>核对发布结果</button>`:''}${r.status==='needs-review'?`<button data-reconcile="${escape(r.rowId)}" type="button">核对现有草稿</button><button data-check-not-saved="${escape(r.rowId)}" type="button">检查是否未保存</button>`:''}${r.error?`<p class="row-error">${escape(displayError(r.error))}</p>`:''}</div>`).join('');
    const publish=batch.executionMode==='publish';$('executionMode').value=publish?'publish':'draft';modeText();$('executionSummary').textContent+=' · '+(publish?'保存并发布':'仅保存草稿');
    const review=batch.rows.some(r=>['needs-review','publication-unknown'].includes(r.status));$('startBatch').disabled=['running','completed'].includes(batch.status)||review||!!batch.cleaningUp;$('startBatch').textContent=batch.cleaningUp?'正在整理执行页面…':batch.status==='completed'?(publish?'已完成提交，请核对平台结果':'已全部保存并核验'):batch.status==='running'?'正在执行…':batch.status==='ready'?(publish?'开始保存并发布':'开始保存到待发布'):'继续未完成条目';$('stopBatch').hidden=batch.status!=='running';$('stopBatch').disabled=!!batch.stopRequested;
    $('executionHint').textContent=displayError(batch.error)|| (batch.status==='completed'?(publish?'已核对每条提交或在线记录。平台审核、在售状态可继续核对。':'已重新打开每条草稿核验。可点击结果链接检查。'):batch.stopRequested?'当前条完成后暂停。':batch.status==='paused'?'已核对的条目不会重复创建或提交；可以继续未完成条目。':'每条独立保存并回读核对，完成的条目不会重复创建。');
    $('eventLog').innerHTML=batch.events.slice(-40).map(e=>`<li>${new Date(e.at).toLocaleTimeString('zh-CN')} ${escape(e.productCode||'')}：${escape(e.step||labels[e.phase]||e.phase)}</li>`).join('');
    syncControls();
    clearTimeout(timer);if(batch.status==='running'||batch.cleaningUp)timer=setTimeout(async()=>{try{batch=await api('batches/'+batch.id);renderBatch();if(batch.status!=='running'&&!batch.cleaningUp)await history();}catch(e){notice(e.message,true);}},1800);
  }
  $('executionRows').onclick=e=>{const publication=e.target.closest('[data-publication]');if(publication){action(publication,async()=>{batch=await api('batches/'+batch.id+'/publicationStatus',{rowId:publication.dataset.publication});renderBatch();await history();});return;}const rejected=e.target.closest('[data-check-not-saved]');if(rejected){action(rejected,async()=>{batch=await api('batches/'+batch.id+'/reconcile',{rowId:rejected.dataset.checkNotSaved,checkNotSaved:true});renderBatch();await history();notice('已确认图片数量校验阻止了保存。请补齐图片后重新导入。');});return;}const b=e.target.closest('[data-reconcile]');if(!b)return;action(b,async()=>{const value=prompt('粘贴店小秘中对应新草稿的编辑链接或 ID。程序会回读核对，匹配后才标记完成。');if(!value)return;const draftId=value.includes('://')?new URL(value).searchParams.get('id'):value.trim();batch=await api('batches/'+batch.id+'/reconcile',{rowId:b.dataset.reconcile,draftId});renderBatch();await history();});};
  $('startBatch').onclick=()=>action($('startBatch'),async()=>{if(bindingIssue())throw new Error(bindingIssue());const previous=JSON.stringify(rows);collectRows();if(previous!==JSON.stringify(rows)||$('targetStore').value!==batch.store.key||$('erpConnection').value!==batch.store.erpKey||$('executionMode').value!==(batch.executionMode||'draft')){invalidate();throw new Error('核对内容已变化，请重新生成执行清单后再执行。');}batch=await api('batches/'+batch.id+'/start',{});renderBatch();setTimeout(renderBatch,0);});
  $('stopBatch').onclick=()=>action($('stopBatch'),async()=>{batch=await api('batches/'+batch.id+'/stop',{});renderBatch();});
  async function history(){
    [productTasks,executions,previews]=await Promise.all([request('/api/products'),api('batches'),api('previews')]);
    const entries=productTasks.map(p=>{const imported=previews.find(v=>v.source?.batchId===p.id),execution=executions.find(b=>b.previewId===imported?.id);return {key:'product:'+p.id,label:p.label+' · '+p.storeName+' · '+(execution?labels[execution.status]:imported?'待核对图片':generation.labels[p.phase]||p.phase),at:p.createdAt};});
    for(const p of previews.filter(p=>!productTasks.some(b=>b.id===p.source?.batchId))){const execution=executions.find(b=>b.previewId===p.id);entries.push({key:'preview:'+p.id,label:p.label+' · '+(execution?execution.store.expectedStore+' · '+labels[execution.status]:'待核对素材'),at:p.createdAt});}
    for(const b of executions.filter(b=>!previews.some(p=>p.id===b.previewId)||executions.find(e=>e.previewId===b.previewId)?.id!==b.id))entries.push({key:'execution:'+b.id,label:b.store.expectedStore+' · '+b.rows.length+' 条 · '+labels[b.status],at:b.createdAt});
    entries.sort((a,b)=>b.at.localeCompare(a.at));$('taskHistory').innerHTML='<option value="">新建批次</option>'+entries.map(e=>'<option value="'+escape(e.key)+'">'+escape(e.label)+'</option>').join('');syncHistorySelection();
  }
  async function restoreBatch(id){
    batch=await api('batches/'+encodeURIComponent(id));preview=previews.find(p=>p.id===batch.previewId);
    rows=preview?batch.rows.map(r=>({...r,imageIds:r.images.map(i=>i.id)})):[];
    restoreContext(batch);paintMother();renderRows();
    localStorage.setItem('temu-erp-active',batch.id);showStage('review');renderBatch();remember('execution',batch.id);
    showPaths(preview?.source);
  }

  const generation=window.createProductWorkflow({request,notice,getStore,getMotherKey,getConnectionBinding:currentBinding,onHistory:history,onState:()=>{
    if(stage==='generation'&&generation.batch){const b=generation.batch;restoreContext(b);paintMother();remember('product',b.id);$('sourcePanel').hidden=true;}
    if(stage==='generation'&&generation.batch){const b=generation.batch;showPaths({kind:'product-batch',sourceFolder:b.sourceFolder,outputParent:b.outputParent,resultFolder:b.resultPackage?.folder,workbook:b.resultPackage?.workbook});}
    paintMother();syncControls();saveIntake();
  },onReview:async result=>{await history();const p=previews.find(p=>p.id===result.previewId);if(!p)throw new Error('未找到本批生成素材，请重试');restoreContext(result.batch);setPreview(p);paintMother();$('reviewPanel').scrollIntoView({behavior:'smooth',block:'start'});}});
  function isBusy(){return pending>0||generation.working()||batch?.status==='running';}
  function syncControls(){
    const busy=isBusy(),fixedStore=(stage==='generation'&&!!generation.batch)||(stage==='review'&&preview?.source?.kind==='product-batch'),issue=bindingIssue();
    for(const el of document.querySelectorAll('#sourcePanel button,#sourcePanel select,#sourcePanel input,#productInputs input,#productInputs select,#productInputs textarea,#productInputs button,#productRows input,#productRows select,#productRows button,#newBatch,#taskHistory'))el.disabled=busy;
    for(const el of $('productRows').querySelectorAll('[data-earlier]')){
      const row=rows[Number(el.closest('[data-row]').dataset.row)];
      el.disabled=busy||row.imageIds.indexOf(el.dataset.earlier)<=0;
    }
    for(const el of $('productRows').querySelectorAll('[data-field="templateKey"]'))el.disabled=busy||motherLocked();
    $('batchMother').disabled=busy||!getStore()?.templates.length||motherLocked();
    $('targetStore').disabled=busy||fixedStore||!getErp();$('erpConnection').disabled=busy||fixedStore;$('prepareBatch').disabled=busy||!preview||!!batch||!getStore()||!!issue;
    $('checkConnection').disabled=busy||!getErp()||!!issue;
    if(issue)for(const id of ['planBatch','generateBatch','retryBatch','startBatch'])$(id).disabled=true;
    $('executionMode').disabled=busy||!!batch;
    $('savedOutputEditor').hidden=stage!=='generation'||!generation.batch;
    for(const el of document.querySelectorAll('#savedOutputEditor input,#savedOutputEditor button'))el.disabled=busy;
    $('backToGeneration').disabled=busy;
    $('prepareHint').textContent=issue||(batch?'执行清单已保存；修改核对内容后需重新生成。':!getStore()?'先选择 ERP 连接和目标店铺，再核对素材。':preview?'已选择 '+getStore().expectedStore+' · '+getStore().expectedSite+'。请核对每条商品的标题、母稿和图片顺序。':'请先读取素材，再核对商品。');
  }
  function showStage(next){stage=next;$('generationWorkspace').hidden=next!=='generation';$('reviewPanel').hidden=next!=='review';$('sourcePanel').hidden=next==='review'||(next==='generation'&&!!generation.batch);$('backToGeneration').hidden=!preview?.source?.batchId;paintMother();syncControls();}
  function remember(kind,id){saveExecutionMode(kind,id);localStorage.setItem('listing-active-task',JSON.stringify({kind,id,mode}));if(kind!=='intake')localStorage.removeItem(intakeKey);syncHistorySelection();}
  function activeTask(){try{return JSON.parse(localStorage.getItem('listing-active-task'));}catch{return null;}}
  function syncHistorySelection(){const a=activeTask();if(!a)return;let key=a.kind+':'+a.id;const p=a.kind==='preview'?previews.find(p=>p.id===a.id):a.kind==='execution'?previews.find(p=>p.id===executions.find(b=>b.id===a.id)?.previewId):null;if(p&&(a.kind!=='execution'||executions.find(b=>b.previewId===p.id)?.id===a.id))key=p.source?.batchId?'product:'+p.source.batchId:'preview:'+p.id;$('taskHistory').value=key;}
  function clearWorkspace(){clearTimeout(timer);batch=null;preview=null;rows=[];taskContext=null;generation.reset();$('executionPanel').hidden=true;$('pathSummary').hidden=true;$('outputParent').value='';$('executionMode').value='draft';modeText();$('productRows').innerHTML='';$('listingNotice').hidden=true;for(const key of ['temu-erp-active','erp-review-current','merchant-active-batch'])localStorage.removeItem(key);remember('none','');window.history.replaceState(null,'','/temu/listings');}
  async function restorePreview(p,storeKey){
    if(!p)throw new Error('未找到这批素材');
    mode=p.source?.kind==='product-batch'?'raw':p.source?.kind==='excel'?'folder':'generated';
    if(p.source?.batchId)restoreContext(await request('/api/products/'+p.source.batchId));
    else{taskContext=null;renderConnections(config.stores.find(s=>s.key===storeKey)?.erpKey||$('erpConnection').value,storeKey||'');}
    restoreExecutionMode('preview',p.id);setPreview(p);paintMother();
  }
  async function restoreProduct(id,resume=false){const p=previews.find(p=>p.source?.batchId===id),e=executions.find(b=>b.previewId===p?.id);
    if(resume&&e)return restoreBatch(e.id);if(resume&&p)return restorePreview(p);
    restoreExecutionMode('product',id);selectSource('raw');await generation.load(id);showStage('generation');
  }
  $('newBatch').onclick=()=>{if(isBusy())return;clearWorkspace();selectSource('raw');};
  $('backToGeneration').onclick=()=>action($('backToGeneration'),async()=>{const id=preview.source.batchId;clearWorkspace();await restoreProduct(id);});
  $('taskHistory').onchange=()=>{const [kind,id]=$('taskHistory').value.split(':');action($('taskHistory'),async()=>{clearWorkspace();if(!id){selectSource('raw');return;}if(kind==='product')await restoreProduct(id,true);else if(kind==='execution')await restoreBatch(id);else{const e=executions.find(b=>b.previewId===id);if(e)await restoreBatch(e.id);else await restorePreview(previews.find(p=>p.id===id));}});};
  function saveWorkspace(){saveIntake();generation.saveEdits();if(preview&&!batch){collectRows();saveReview();}}
  function saveIntakeField(event){if(intakeFields.includes(event.target.id)||['erpConnection','targetStore','batchMother'].includes(event.target.id)||event.target.closest('#productInputs'))saveIntake();}
  document.querySelector('.listing-workspace').addEventListener('input',saveIntakeField);
  document.querySelector('.listing-workspace').addEventListener('change',saveIntakeField);
  window.addEventListener('pagehide',saveWorkspace);
  window.addEventListener('storage',e=>{if(e.key==='workbench-settings-changed')refreshStoreConfig();});
  window.addEventListener('focus',refreshStoreConfig);
  window.addEventListener('pageshow',refreshStoreConfig);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveWorkspace();else refreshStoreConfig();});
  // Also catch saves from another desktop/browser profile and retry deferred or failed reads.
  setInterval(refreshStoreConfig,5000);
  window.ListingWorkspace={
    getState:()=>({ready:configReady,busy:isBusy(),locked:!!taskContext||!!preview||!!generation.batch||!!batch,storeKey:$('targetStore').value,erpKey:$('erpConnection').value}),
    selectStore:store=>{if(taskContext||preview||generation.batch||batch)return false;renderConnections(store.erpKey,store.key);$('targetStore').onchange();return true;}
  };
  (async()=>{try{
    token=(await request('/api/session')).token;config=await api('config');renderConnections(listingErps().length===1?listingErps()[0].key:'','');$('folderPath').value=config.defaultFolder;
    await history();const params=new URLSearchParams(location.search);let active=activeTask();
    if(params.get('batch'))active={kind:'execution',id:params.get('batch')};
    else if(params.get('preview'))active={kind:'preview',id:params.get('preview')};
    else if(params.get('product'))active={kind:'product',id:params.get('product')};
    else if(params.get('group')||params.get('draft')){const p=await api('import-generated',params.get('group')?{groupId:params.get('group')}:{draftId:params.get('draft')});await history();await restorePreview(p);window.history.replaceState(null,'','/temu/listings');return;}
    if(!active){const e=localStorage.getItem('temu-erp-active'),g=localStorage.getItem('merchant-active-batch'),p=localStorage.getItem('erp-review-current');active=e?{kind:'execution',id:e}:g?{kind:'product',id:g}:p?{kind:'preview',id:p}:null;}
    restoreExecutionMode(active?.kind,active?.id);
    if(active?.kind==='execution')await restoreBatch(active.id);else if(active?.kind==='product')await restoreProduct(active.id);else if(active?.kind==='preview')await restorePreview(previews.find(p=>p.id===active.id),params.get('store'));else if(!restoreIntake())selectSource('raw');
    window.history.replaceState(null,'','/temu/listings');if(!config.stores.length){notice('请先配置浏览器、ERP 连接和店铺母稿。 ');const link=document.createElement('a');link.href='/settings';link.textContent='前往连接设置';$('listingNotice').append(link);}
  }catch(e){notice(e.message,true);selectSource('raw');}finally{configReady=!!config;refreshStoreConfig();window.dispatchEvent(new Event('workbench-listing-ready'));}})();
})();
