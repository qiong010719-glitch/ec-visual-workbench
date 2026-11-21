/* Complete local snapshots reuse the existing app state and never start model jobs. */
(() => {
  const $=id=>document.getElementById(id);
  async function api(route,data){const r=await fetch(route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error||'草稿操作失败');return value;}
  async function idle(){const s=await api('/api/status');if(!__idbRestored||s.active||s.queued||activeAgentTask||activeKieTasks.length)throw Error('请等待当前任务完成后再保存或切换草稿。');}
  async function capture(){
    if(!window.__customLayout?.taobao)return null;
    await idle();
    const benchmark=window.TaobaoBenchmarkState.capture();
    for(const m of globalMaterials){
      if(m.url?.startsWith('/media/'))continue;
      if(!m.base64)throw Error('本品素材尚未保存到本机，请重新上传后保存草稿。');
      const response=await fetch('data:image/jpeg;base64,'+m.base64);m.url=await LocalWorkbench.upload(await response.blob());
    }
    saveAppState();
    const app=structuredClone(captureAppState());
    app.materialMeta=app.materialMeta.map(({id,filename,category,url})=>({id,filename,category,url}));
    return {version:1,app,benchmark,modelIdentity:window.TaobaoModelState.capture(),visualStyle:window.getLocalVisualStyle(),referenceIds:window.__designReferenceIds||[]};
  }
  async function restore(id){
    await idle();
    // Validate every file before saving a backup or replacing the visible workbench.
    const draft=await api('/api/drafts/'+encodeURIComponent(id));
    const current=await capture();
    const backedUp=!!(current&&(current.app.prodName||current.app.materialMeta.length||current.app.imageSlots.some(Boolean)));
    if(backedUp){
      const images=current.app.imageSlots.filter(Boolean).map(s=>s.history?.[s.currentIndex]||s.url);
      await api('/api/drafts',{title:'切换前自动备份 · '+(current.app.prodName||'未命名'),description:current.app.prodDesc,platform:'淘宝',skus:[],images,sop:current.app.sopText,workbench:current,status:'draft'});
    }
    const snapshot=draft.workbench,app=structuredClone(snapshot.app);
    // The legacy loader skips empty fields. Clear them explicitly so another product cannot leak in.
    for(const key of ['prodName','prodDesc','strictReq','sopText'])$(key).value='';
    globalMaterials=[];imageSlots=new Array(14).fill(null);mobileSlots=[];activeAgentTask=null;activeKieTasks=[];lastAgentTaskId=null;window._lastAgentTaskId=null;
    window.__customLayout=null;window.__categoryState=null;window.__designReferenceIds=snapshot.referenceIds||[];
    renderMaterialGrid();$('uploadCountIndicator').textContent='0/8';
    $('mobileGalleryContainer')?.replaceChildren();
    window.__loadAppStateFrom(JSON.stringify(app));
    window.restoreLocalVisualStyle(snapshot.visualStyle,app.generationMode);
    window.TaobaoModelState.restore(snapshot.modelIdentity);
    await window.TaobaoBenchmarkState.restore(snapshot.benchmark);
    saveAppState();
    window.aquaNotify?.('草稿已恢复','本品素材、对标绑定、逐图要求和成图已载入。'+(backedUp?'切换前内容已自动备份。':''),'✓');
    return draft;
  }
  window.TaobaoDrafts={capture,restore};
})();
