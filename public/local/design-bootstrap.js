/* Restore the durable product/platform draft before the legacy editor starts. */
(() => {
  const boot=window.WorkspaceDesignBoot;
  if(!boot)return;
  window.WorkbenchPlatform=boot.platform;
  document.documentElement.classList.add('temu-theme');
  window.WorkbenchNamespace='workspace::'+boot.key+'::'+boot.revision+'::'+location.host;
  window.WorkspaceDesignStorageKey='hyrule_state_v13::'+window.WorkbenchNamespace;
  window.WorkspaceDesignAdapterKey='workspace-design-adapter::'+boot.key;
  window.WorkspaceDesignPendingKey='workspace-design-pending::'+boot.key;
  // Unsynchronized copies live outside the cache restored from the server.
  window.WorkspaceDesignRecoveryOwner=crypto.randomUUID();
  window.WorkspaceDesignRecoveryRecords=[];
  try{
    for(const key of Object.keys(localStorage))if(key.startsWith('workspace-recovery:design:')){
      const record=JSON.parse(localStorage.getItem(key)||'null');
      if(record?.kind==='design'&&record.key===boot.key&&record.data)window.WorkspaceDesignRecoveryRecords.push({...record,storageKey:key});
    }
  }catch{}
  const checkpointKey='workspace-checkpoint:design:'+encodeURIComponent(boot.key),restoreKey='workspace-restore-commit:design:'+encodeURIComponent(boot.key);
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
  const normalize=value=>{
    if(!value)return {appState:null,adapter:null,pending:null};
    const result=JSON.parse(JSON.stringify({appState:value.appState||null,adapter:value.adapter||null,pending:value.pending||null}));
    if(result.appState?.materialMeta)result.appState.materialMeta=result.appState.materialMeta.map(m=>m.url?{id:m.id,filename:m.filename,category:m.category,url:m.url}:m);
    return result;
  };
  try{
    const prior=read(checkpointKey),local=normalize({appState:read(prior?.storageKey||window.WorkspaceDesignStorageKey),adapter:read(window.WorkspaceDesignAdapterKey),pending:read(window.WorkspaceDesignPendingKey)}),server=normalize(boot.data);
    const forceRestore=sessionStorage.getItem(restoreKey);sessionStorage.removeItem(restoreKey);
    if(!forceRestore&&local.appState&&JSON.stringify(local)!==JSON.stringify(prior?.data||server)){
      const storageKey='workspace-recovery:design:'+encodeURIComponent(boot.key)+':'+window.WorkspaceDesignRecoveryOwner;
      localStorage.setItem(storageKey,JSON.stringify({schema:1,kind:'design',key:boot.key,productId:boot.productId||'',platform:boot.platform,baseRevision:prior?.revision||0,updatedAt:new Date().toISOString(),reason:'离页前尚未同步',data:local,storageKey}));
      if(!forceRestore&&prior&&prior.revision===boot.revision&&JSON.stringify(server)===JSON.stringify(prior.data))boot.localPendingData=local;
    }
    if(!boot.localPendingData)localStorage.setItem(checkpointKey,JSON.stringify({key:boot.key,revision:boot.revision,data:server,storageKey:window.WorkspaceDesignStorageKey,updatedAt:new Date().toISOString()}));
  }catch{}
  try{
    for(const name of ['aplus_newbie_tour_v1','hyrule_result_tour_done','hyrule_veteran'])localStorage.setItem(name,'true');
    const restored=boot.localPendingData||boot.data;
    let state=restored?.appState;
    if(!state&&boot.product){
      state={prodName:boot.product.name,prodDesc:boot.product.description,generationMode:'fast',designScope:'main_and_6',
        materialMeta:boot.product.images.slice(0,8).map((image,i)=>({...image,id:'product-image-'+i,category:image.category||'产品主体图'})),imageSlots:Array(14).fill(null),activeKieTasks:[]};
    }
    if(!state&&!boot.productId){
      const old=boot.platform==='temu'?'hyrule_state_v13::temu::'+location.host:'hyrule_state_v13::'+location.host;
      state=JSON.parse(localStorage.getItem(old)||'null');
    }
    if(state)localStorage.setItem(window.WorkspaceDesignStorageKey,JSON.stringify(state));
    else localStorage.removeItem(window.WorkspaceDesignStorageKey);
    for(const [name,key] of [['adapter',window.WorkspaceDesignAdapterKey],['pending',window.WorkspaceDesignPendingKey]]){
      if(restored?.[name])localStorage.setItem(key,JSON.stringify(restored[name]));
      else localStorage.removeItem(key);
    }
  }catch{ /* The durable draft is retained on the server if browser storage is full. */ }
})();
