/* Destination adapter: all design controls and generation actions stay in the shared UI. */
(() => {
  if(window.WorkbenchPlatform!=='temu')return;
  const $=id=>document.getElementById(id),key=window.WorkspaceDesignAdapterKey||'temu-shared-image-settings';
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let settings={ratio:'1:1',resultRatio:'1:1'},status;
  try{settings={...settings,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{}
  const persist=()=>localStorage.setItem(key,JSON.stringify(settings));
  const api=async(url,payload)=>{
    const response=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'请求未完成');return value;
  };
  const ratio=()=>'1:1';
  const countFields=p=>p.design_scope==='main_count'?{image_count:Number($('mainImageCount').value)}:{};
  const decorateSource=p=>({...p,...countFields(p),platform:'temu',image_workflow:'shared',image_ratio:ratio()});
  window.decorateWorkbenchPayload=(p,route)=>{
    // The existing mobile reformat and free editing tools keep their source aspect.
    if(p.mobile_reformat)return p;
    const edited=route==='/api/inpaint';
    if(edited&&p.slot_idx===-1&&!['1:1','3:4'].includes(p.aspect_ratio))return p;
    const target=edited?(p.slot_idx===-1&&['1:1','3:4'].includes(p.aspect_ratio)?p.aspect_ratio:settings.resultRatio||ratio()):ratio();
    const result={...p,...countFields(p),platform:'temu',image_workflow:'shared',image_ratio:target};
    if(edited)result.aspect_ratio=target;
    if(Array.isArray(p.firebase_tasks))result.firebase_tasks=p.firebase_tasks.map(t=>({...t,aspect_ratio:target}));
    if(!edited){
      const market=JSON.parse($('targetMarket').value);
      Object.assign(result,{product_name:$('prodName').value,product_desc:$('prodDesc').value,target_market:market.market,target_lang:market.lang,model_ethnicity:getModelEthnicity(market.market),text_depth:isTextDepthOn()});
    }
    if(['/api/generate','/api/ultra_generate'].includes(route)){
      settings.resultRatio=target;
      if(p.redraw_index==null){settings.resultSource={title:result.product_name,description:result.product_desc,sop:result.sop_text};settings.resultTasks={};}
      for(const task of result.firebase_tasks||[])(settings.resultTasks??={})[task.slot]=task.taskId;
      persist();
    }
    if(edited&&p.slot_idx>=0&&settings.resultTasks){settings.resultTasks[p.slot_idx]=p.task_id;persist();}
    return result;
  };
  function recordSingleResult(payload,tasks,sop){
    settings.resultRatio=payload.image_ratio;
    settings.resultSource={title:payload.product_name,description:payload.product_desc,sop};
    settings.resultTasks=Object.fromEntries(tasks.map(t=>[t.slot,t.taskId]));persist();
  }
  function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  const packageNotes='Temu 图片资料包\n主图与详情使用相同图片、相同顺序，图片路径以 listing-manifest.json 为准。\nSKU 预览图保留母稿原图。\n此资料包未发布商品，价格、库存和类目由上架流程补充。';
  function dialog(title,content){$('temuSharedDialog')?.remove();const d=document.createElement('dialog');d.id='temuSharedDialog';d.className='local-dialog';d.innerHTML=`<div class="local-head"><h2>${escape(title)}</h2><button data-close>关闭</button></div>${content}`;document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.showModal();return d;}
  async function exportDraft(draft){
    const zip=new JSZip(),files=[];
    for(const [i,url] of draft.images.entries()){
      const response=await fetch(url);if(!response.ok)throw new Error('图片读取失败，请恢复图片后重新导出');
      const file=`images/${String(i+1).padStart(2,'0')}.${url.split('.').pop()}`;zip.file(file,await response.blob());files.push(file);
    }
    if(!files.length)throw new Error('请先完成图片，再导出上架资料包');
    const manifest={schemaVersion:1,platform:'temu',title:draft.title,description:draft.description,imageRatio:draft.imageRatio,
      ...(draft.groupId?{groupId:draft.groupId,setId:draft.setId,setIndex:draft.setIndex}:{}),
      mainImages:files,detailImages:[...files],skuPreviewPolicy:'preserve-source',skus:[],status:'draft',published:false};
    zip.file('listing-manifest.json',JSON.stringify(manifest,null,2));zip.file('商品草稿.json',JSON.stringify(draft,null,2));zip.file('设计方案.txt',draft.sop||'');zip.file('使用说明.txt',packageNotes);
    saveBlob(await zip.generateAsync({type:'blob'}),draft.title+'-Temu图片包.zip');
  }
  async function saveCurrent(){
    if(activeKieTasks.length)throw new Error('请等本套图片任务完成后保存');
    const slots=settings.resultTasks?Object.keys(settings.resultTasks).map(Number).sort((a,b)=>a-b):getCurrentSlotTitles().map((title,slot)=>title?slot:null).filter(slot=>slot!==null);
    if(!slots.length||slots.some(slot=>!imageSlots[slot]?.url?.startsWith('/media/')))throw new Error('请先完成所选范围内的全部图片');
    if(settings.resultTasks)for(const slot of slots){
      const task=await api('/api/tasks/hyrule_tasks/'+settings.resultTasks[slot]);
      if(task?.status!=='completed'||task.imageUrl!==imageSlots[slot].url)throw new Error('本套图片尚未全部完成或已发生变化，请核对任务结果后再保存');
    }
    const images=slots.map(slot=>imageSlots[slot].url),fingerprint=JSON.stringify(images);
    const draft=await api('/api/drafts',{id:settings.draftFingerprint===fingerprint?settings.draftId:undefined,platform:'temu',title:settings.resultSource?.title||$('prodName').value,description:settings.resultSource?.description||$('prodDesc').value,image_ratio:settings.resultRatio,images,sop:settings.resultSource?.sop||$('sopText').value,skus:[],status:'draft'});
    settings.draftId=draft.id;settings.draftFingerprint=fingerprint;persist();return draft;
  }
  let listingScript,openingListing=false;
  async function openListing(draft){
    if(openingListing)return;openingListing=true;
    try{
      const saved=draft||await saveCurrent();
      if(!saved.images.length||saved.images.length>10)throw new Error('直接上架每个商品支持 1—10 张图片，请使用对应的主图方案。');
      listingScript??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/local/single-listing.js';script.onload=resolve;script.onerror=()=>{script.remove();listingScript=null;reject(new Error('上架面板加载失败，请重试'));};document.head.append(script);});
      await listingScript;await window.openSingleListing({draft:saved,api,dialog});
    }catch(e){dialog('直接上架',`<p role="alert">${escape(e.message)}</p>`);}
    finally{openingListing=false;}
  }
  async function openDraftEditor(draft){
    try{const saved=draft||await saveCurrent();const d=dialog('Temu 商品草稿',`<p>${escape(saved.title)} · ${escape(saved.imageRatio)} · ${saved.images.length} 张</p><p class="local-muted">主图与详情同图同序，SKU 预览图保留母稿原图。</p><div class="local-row"><button class="primary" data-list>直接上架</button><button data-export>导出上架资料包</button><a class="local-action" href="/temu/listings">前往上架任务</a></div><output></output>`);d.querySelector('[data-list]').onclick=()=>openListing(saved);d.querySelector('[data-export]').onclick=async()=>{try{await exportDraft(saved);}catch(e){d.querySelector('output').textContent=e.message;}};}
    catch(e){dialog('保存商品草稿',`<p>${escape(e.message)}</p>`);}
  }
  async function openDrafts(){
    try{
      const drafts=await api('/api/drafts?platform=temu');const d=dialog('Temu 草稿箱',`<div class="local-row"><button data-save>保存当前完整套图</button><a class="local-action" href="/temu/listings">上架任务</a></div><div>${drafts.map((draft,i)=>`<article class="local-card"><strong>${escape(draft.title)}</strong><p class="local-muted">${escape(draft.imageRatio)} · ${draft.images.length} 张 · 未发布</p><button data-draft="${i}">查看／导出</button></article>`).join('')||'<p>暂无已保存套图</p>'}</div>`);
      d.querySelector('[data-save]').onclick=()=>{d.close();openDraftEditor();};for(const b of d.querySelectorAll('[data-draft]'))b.onclick=()=>{d.close();openDraftEditor(drafts[Number(b.dataset.draft)]);};
    }catch(e){dialog('Temu 草稿箱',`<p>${escape(e.message)}</p>`);}
  }
  async function exportSets(group,sets){
    const result=await api(`/api/temu/multisets/${group.id}/export`,sets.length===group.sets.length?{}:{setId:sets[0].id}),zip=new JSZip();
    for(const file of result.manifest.files){
      const response=await fetch(file.url);if(!response.ok)throw new Error('图片读取失败，未导出不完整资料包');
      const bytes=await response.arrayBuffer();const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(digest!==file.sha256)throw new Error('图片内容已变化，请重新导出');zip.file(file.path,bytes);
    }
    zip.file('listing-manifest.json',JSON.stringify(result.manifest,null,2));
    zip.file('使用说明.txt',packageNotes);
    for(const set of result.manifest.sets){const draft=result.drafts.find(d=>d.setId===set.setId);zip.file(set.folder+'/商品草稿.json',JSON.stringify(draft,null,2));zip.file(set.folder+'/设计方案.txt',draft.sop);}
    saveBlob(await zip.generateAsync({type:'blob'}),group.source.product_name+'-Temu裂变图片包.zip');
  }
  function setup(){
    for(const id of ['view-adventure-log','view-ultra-log']){
      const panel=document.createElement('div');panel.className='single-listing-entry';
      panel.innerHTML='<button type="button" class="local-action" data-single-listing disabled>直接上架</button><p data-listing-hint>完成整套图片后，选择 ERP、店铺和母稿直接上架。</p>';
      $(id).querySelector('.results-side').append(panel);panel.querySelector('button').onclick=()=>openListing();
    }
    const updateListingEntry=()=>{
      const slots=settings.resultTasks?Object.keys(settings.resultTasks).map(Number):getCurrentSlotTitles().flatMap((title,slot)=>title?[slot]:[]);
      const complete=slots.length>0&&slots.every(slot=>imageSlots[slot]?.url?.startsWith('/media/')),busy=activeKieTasks.length>0;
      for(const panel of document.querySelectorAll('.single-listing-entry')){
        panel.querySelector('button').disabled=openingListing||busy||!complete||slots.length>10;
        panel.querySelector('p').textContent=busy?'图片处理中，完成后即可上架。':slots.length>10?'直接上架支持 1—10 张图片，请使用对应的主图方案。':complete?`本套 ${slots.length} 张图片已就绪，可选择 ERP、店铺和母稿。`:'完成整套图片后，选择 ERP、店铺和母稿直接上架。';
      }
    };
    updateListingEntry();setInterval(updateListingEntry,1000);
    // Keep the existing plan field and its save handler, but make it reachable in Temu.
    const plan=$('sopText'),review=document.createElement('details');review.id='singlePlanReview';review.className='single-plan-review';
    review.innerHTML='<summary>查看并修改本套设计方案</summary><p>构思完成后，可在这里核对每张图的内容，再开始生成。</p>';
    document.querySelector('.workspace-grid').after(review);review.append(plan);
    const control=document.createElement('label');control.className='text-xs font-mono';control.style.color='#b9c4d9';control.htmlFor='imageRatio';
    control.innerHTML='图片尺寸<select id="imageRatio" class="sheikah-input text-sm font-mono font-bold custom-scrollbar shrink-0" style="width:100%;margin-top:6px"><option value="1:1">1:1 · 1024 × 1024 · ≤2 MB</option></select>';
    $('modeDescription').after(control);$('imageRatio').value='1:1';$('imageRatio').disabled=true;
    $('imageRatio').onchange=()=>{settings.ratio=ratio();persist();lastAgentTaskId=null;window._lastAgentTaskId=null;$('mainBtn').disabled=true;$('localPlanLabel').textContent='尺寸已改变，请重新构思';};
    for(const title of document.querySelectorAll('.mac-title'))title.textContent='商品视觉工作台 · Temu';
    $('temuEntry')?.remove();$('localPlanLabel').textContent='通用做图 · Temu 上架';
    const originalAspect=window._aspectForTitle;
    window._aspectForTitle=title=>ratio()||originalAspect(title);
    const labelGallery=value=>{for(const el of document.querySelectorAll('#galleryContainer .gallery-wrapper > div')){
      if(/^Main Flow \(/.test(el.textContent))el.textContent=`Main Flow (${value})`;
      if(/^A\+ Assets \(/.test(el.textContent))el.textContent=`A+ Assets (${value})`;
    }};
    const originalGallery=window.buildGalleryLayout;
    window.buildGalleryLayout=function(...args){const result=originalGallery.apply(this,args);labelGallery(ratio());return result;};
    labelGallery(imageSlots.some(s=>s?.url)?settings.resultRatio:ratio());
    const css=document.createElement('style');css.textContent='#view-adventure-log .quest-slot img{object-fit:contain!important}#imageRatio{color:var(--text-1,#f2f6ff)}';document.head.append(css);
  }
  const ready=LocalWorkbench.ready.then(async()=>{status=await api('/api/status');});
  window.TemuWorkbench={sharedUi:true,api,ready,model:()=>$('modelChoice').value,imageReady:()=>!!status?.imageConfigured,source:()=>({image_ratio:ratio()}),decorateSource,recordSingleResult,exportSets,openDrafts,openDraftEditor};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
