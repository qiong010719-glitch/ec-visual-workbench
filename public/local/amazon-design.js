/* Shared product handoff; only explicit Amazon pages change image presets. */
(() => {
  const boot=window.WorkspaceDesignBoot||{},platform=boot.platform||window.WorkbenchPlatform;
  if(!['amazon','temu'].includes(platform))return;
  const $=id=>document.getElementById(id),temu=platform==='temu'?window.TemuWorkbench:null;
  const api=temu?.api||async function(url,payload){
    const response=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'请求未完成');return value;
  };
  const adapterKey=window.WorkspaceDesignAdapterKey;
  const adapterState=()=>{try{return adapterKey?JSON.parse(localStorage.getItem(adapterKey)||'{}'):{};}catch{return {};}};
  const restored=adapterState();
  let productId=boot.productId||null,preparing=null,sourceFingerprint='',resultSnapshot=restored.workspaceResult||null,savedVersion=restored.workspaceVersion||null,observing=null;
  if(!savedVersion&&boot.productId){
    const previous=boot.product?.versions?.find(version=>version.platform===platform&&version.status==='completed'&&version.source?.id===boot.data?.appState?.lastAgentTaskId);
    if(previous)savedVersion={productId:boot.productId,id:previous.id};
  }
  function persistAdapter(){
    if(!adapterKey)return;
    localStorage.setItem(adapterKey,JSON.stringify({...adapterState(),workspaceResult:resultSnapshot,workspaceVersion:savedVersion}));
    window.saveAppState?.();
  }
  const notice=text=>{for(const el of document.querySelectorAll('[data-design-library-status]'))el.textContent=text;};
  const localImages=()=>globalMaterials.map(m=>({url:m.url,filename:m.filename,category:m.category}));
  function bindProduct(product){
    productId=product.id;
    const key=productId+':'+platform;
    if(boot.key!==key){boot.key=key;boot.revision=0;}
    boot.productId=productId;boot.product=product;
    const url=new URL(location.href);url.pathname='/design';url.searchParams.set('platform',platform);url.searchParams.set('product',productId);
    history.replaceState(history.state,'',url);
    window.dispatchEvent(new CustomEvent('workspace-product-bound',{detail:{productId,platform,key}}));
  }
  async function prepareSource(){
    if(preparing)return preparing;
    preparing=(async()=>{
      const name=$('prodName').value.trim(),description=$('prodDesc').value.trim(),images=localImages();
      if(!name||!description||!images.length)throw new Error('请填写商品名称、资料并上传主体图');
      const fingerprint=JSON.stringify({name,description,images});
      if(productId&&sourceFingerprint===fingerprint)return productId;
      // An opened design keeps its own product binding even if another tab has
      // since changed the workspace's current product.
      if(!productId&&!Object.hasOwn(boot,'productId')){const context=await api('/api/workspace/context');productId=context.productId||null;}
      const product=await api('/api/workspace/products'+(productId?'/'+encodeURIComponent(productId):''),{name,description,images,source:{kind:'single-design'}});
      bindProduct(product);
      await api('/api/workspace/context',{productId:product.id,platform});
      sourceFingerprint=fingerprint;return productId;
    })();
    try{return await preparing;}finally{preparing=null;}
  }
  function decorateSource(source){
    if(temu)return {...temu.decorateSource(source),...(productId?{workspace_product_id:productId}:{})};
    const result={...source,platform:'amazon',image_workflow:'platform',...(productId?{workspace_product_id:productId}:{})};
    delete result.image_ratio;
    if(source.design_scope==='main_count')result.image_count=Number($('mainImageCount').value);
    return result;
  }
  function recordSingleResult(payload,tasks,sop){
    temu?.recordSingleResult(payload,tasks,sop);
    resultSnapshot={payload,tasks,sop};savedVersion=null;persistAdapter();
  }
  const imageKind=(payload,image)=>payload.mobile_reformat||image.formatId==='mobile'?'mobile':image.slot>=7&&payload.design_scope!=='main_count'?'aplus':image.slot===0?'main':'sub';
  async function persistResult(snapshot,images){
    if(!snapshot?.tasks?.length||images.length!==snapshot.tasks.length||images.some(i=>i.status!=='completed'||!i.imageUrl?.startsWith('/media/')))throw new Error('请等待本套所有图片完成后保存');
    const id=snapshot.payload.workspace_product_id||productId;
    if(!id)throw new Error('本套图片尚未绑定公共商品，请从内容制作重新选择商品');
    const taskId=snapshot.payload.agent_task_id||snapshot.payload.batch_id||snapshot.tasks[0].taskId;
    const version={id:'single:'+taskId,platform,status:'completed',
      images:images.map(image=>({url:image.imageUrl,slot:String(image.slot),kind:imageKind(snapshot.payload,image),...(image.dimensions?{width:image.dimensions.width,height:image.dimensions.height,ratio:image.dimensions.ratio}:{}),...(image.originalImageUrl?{originalImageUrl:image.originalImageUrl}:{})})),
      source:{kind:'single-design',id:taskId},url:'/design?platform='+platform+'&product='+encodeURIComponent(id)};
    await api('/api/workspace/products/'+encodeURIComponent(id),{version});
    savedVersion={productId:id,id:version.id};persistAdapter();notice('本套图片已保存到商品库，各板块共用这份商品和素材。');
    window.dispatchEvent(new CustomEvent('workspace-product-updated',{detail:{productId:id,platform,versionId:version.id}}));
    return savedVersion;
  }
  async function onSingleComplete(task){
    recordSingleResult(task.payload,task.singleDesign.tasks,task.result);
    return persistResult(resultSnapshot,task.singleDesign.images);
  }
  async function saveCurrent(){
    // The legacy Temu draft writer owns its adapter object. Recover by the
    // durable agent ID when it saved a draft after the shared version hook.
    if(!resultSnapshot&&boot.data?.appState?.lastAgentTaskId){
      const task=await api('/api/tasks/agent_tasks/'+encodeURIComponent(boot.data.appState.lastAgentTaskId));
      if(task?.singleDesign?.phase==='completed')return onSingleComplete(task);
    }
    if(!resultSnapshot)throw new Error('请先完成一套图片；已有成品可在商品库中查看');
    const snapshot=resultSnapshot;
    const images=await Promise.all(snapshot.tasks.map(async task=>({...await api('/api/tasks/hyrule_tasks/'+encodeURIComponent(task.taskId)),slot:task.slot})));
    return persistResult(snapshot,images);
  }
  // Reviewed-plan generation keeps the original API and task IDs. Observe its
  // results to create the same product version as the one-click path.
  async function observeResults(snapshot){
    if(observing===snapshot)return;observing=snapshot;
    try{
      const images=await Promise.all(snapshot.tasks.map(async task=>({...await api('/api/tasks/hyrule_tasks/'+encodeURIComponent(task.taskId)),slot:task.slot})));
      if(resultSnapshot!==snapshot)return;
      if(images.every(i=>i.status==='completed')){await persistResult(snapshot,images);return;}
      if(images.every(i=>['completed','failed'].includes(i.status))){notice('本套图片未全部完成，已生成结果仍保留在任务记录中。');return;}
      setTimeout(()=>observeResults(snapshot),1500);
    }catch(error){notice('商品库同步暂未完成，可点击“保存到商品库”重试。');}
    finally{if(observing===snapshot)observing=null;}
  }
  const originalDecorator=window.decorateWorkbenchPayload;
  window.decorateWorkbenchPayload=(payload,route)=>{
    let result=temu&&originalDecorator?originalDecorator(payload,route):decorateSource(payload);
    if(productId)result={...result,workspace_product_id:productId};
    if(platform==='amazon'&&route==='/api/inpaint'){
      result.design_scope=result.design_scope||resultSnapshot?.payload.design_scope;
      result.custom_layout=result.custom_layout||resultSnapshot?.payload.custom_layout;
    }
    if(['/api/generate','/api/ultra_generate'].includes(route)&&Array.isArray(result.firebase_tasks)&&result.redraw_index==null){
      recordSingleResult(result,result.firebase_tasks,result.sop_text);
      const snapshot=resultSnapshot;setTimeout(()=>observeResults(snapshot),1000);
    }
    return result;
  };
  const workbench={...temu,sharedUi:true,platform,api,prepareSource,decorateSource,recordSingleResult,onSingleComplete,saveCurrent,
    pendingKey:window.WorkspaceDesignPendingKey||(platform==='amazon'?'amazon-single-design::'+location.host:undefined)};
  window.DesignWorkbench=workbench;
  // These user actions may follow the optional plan-review route. Saving source
  // data first makes their generated assets part of the same shared product.
  for(const name of ['summonAgent','triggerGeneration']){
    const original=window[name];if(!original)continue;
    window[name]=async function(...args){
      try{
        const material=await ensureMaterialUrls(globalMaterials);
        if(material.lost.length)throw new Error('参考图已失效，请重新上传：'+material.lost.join('、'));
        await prepareSource();return original.apply(this,args);
      }catch(error){notice(error.message);if(window.aquaNotify)aquaNotify('商品资料未就绪',error.message,'!');}
    };
  }
  function setup(){
    if(platform==='amazon'){
      const plan=$('sopText'),review=document.createElement('details');review.id='singlePlanReview';review.className='single-plan-review';
      review.innerHTML='<summary>查看并修改本套设计方案</summary><p>构思完成后，可核对主图、副图和 A+ 的逐张要求。</p>';
      document.querySelector('.workspace-grid').after(review);review.append(plan);
      const dimensions=document.createElement('p');dimensions.id='amazonImageDimensions';dimensions.className='local-muted';
      dimensions.textContent='Amazon 输出：主副图 1024 × 1024；老 A+ 970 × 600；高级 A+ 1464 × 600；手机版 A+ 1200 × 900。按比例留白适配，保留原始成图。';
      $('modeDescription').after(dimensions);
      $('temuEntry')?.remove();$('localPlanLabel').textContent='Amazon 单品设计';
      const css=document.createElement('style');css.textContent='#view-adventure-log .quest-slot img{object-fit:contain!important}.design-library-entry{margin-top:16px;padding:16px;border:1px solid var(--border-1,#ccd5e4);border-radius:12px}.design-library-entry button,.design-library-entry a{margin-right:8px}';document.head.append(css);
      $('localDraftButton').textContent='商品库';$('localDraftButton').onclick=()=>{location.href='/products'+(productId?'?product='+encodeURIComponent(productId):'');};
      window.openLocalDrafts=()=>{location.href='/products';};
      window.openLocalDraftEditor=()=>saveCurrent().catch(error=>notice(error.message));
    }
    const entry=document.createElement('div');entry.className='design-library-entry';
    entry.innerHTML='<button type="button" class="local-action" data-save-design-library>保存到商品库</button><button type="button" class="local-action" data-open-design-listing>前往上架中心</button><p class="local-muted" data-design-library-status role="status">完成套图后会保存为当前平台的商品素材版本。</p>';
    $('view-adventure-log').querySelector('.results-side').append(entry);
    entry.querySelector('[data-save-design-library]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await saveCurrent();}catch(error){notice(error.message);}finally{button.disabled=false;}};
    entry.querySelector('[data-open-design-listing]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const saved=savedVersion||await saveCurrent();await window.WorkspaceSaveDesign?.();location.href='/listings?mode=images&source=generated&platform='+platform+'&workspaceProduct='+encodeURIComponent(saved.productId)+'&version='+encodeURIComponent(saved.id);}catch(error){notice(error.message);}finally{button.disabled=false;}};
    if(new URL(location.href).searchParams.get('view')==='edit'){
      const openEdit=()=>{if(typeof __idbRestored==='undefined'||!__idbRestored){setTimeout(openEdit,50);return;}$('nav-edit')?.click();};openEdit();
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
