/* The original editor remains a client of one durable workspace. */
(() => {
  const boot=window.WorkspaceDesignBoot;if(!boot)return;
  const $=id=>document.getElementById(id),owner=window.WorkspaceDesignRecoveryOwner||crypto.randomUUID(),prefix='workspace-recovery:design:';
  const memory=new Map(),read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
  let timer,pending=Promise.resolve(),saved=JSON.stringify(boot.data||null),conflict=false,lastError,dirty=false,restoring=false,suppressUnload=false,recoveryChoice='',storageError=false;
  const data=()=>{
    const appState=read(window.WorkspaceDesignStorageKey);
    if(appState?.materialMeta)appState.materialMeta=appState.materialMeta.map(m=>m.url?{id:m.id,filename:m.filename,category:m.category,url:m.url}:m);
    return {appState,adapter:read(window.WorkspaceDesignAdapterKey),pending:read(window.WorkspaceDesignPendingKey)};
  };
  const recoveryKey=key=>prefix+encodeURIComponent(key)+':'+owner;
  function checkpoint(key,revision,snapshot){try{localStorage.setItem('workspace-checkpoint:design:'+encodeURIComponent(key),JSON.stringify({key,revision,data:snapshot,storageKey:window.WorkspaceDesignStorageKey,updatedAt:new Date().toISOString()}));}catch{}}
  const records=()=>{
    const found=new Map(memory);
    try{for(const key of Object.keys(localStorage))if(key.startsWith(prefix)){const record=read(key);if(record?.kind==='design'&&record.key===boot.key&&record.data)found.set(key,{...record,storageKey:key});}}catch{}
    return [...found.values()].filter(record=>record.key===boot.key&&JSON.stringify(record.data)!==saved).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  };
  function retain(snapshot,key=boot.key,baseRevision=boot.revision,reason='尚未同步'){
    if(!snapshot?.appState)return null;
    const storageKey=recoveryKey(key),record={schema:1,kind:'design',key,productId:key.slice(0,key.lastIndexOf(':'))==='blank'?'':key.slice(0,key.lastIndexOf(':')),platform:key.slice(key.lastIndexOf(':')+1),baseRevision,updatedAt:new Date().toISOString(),reason,data:snapshot,storageKey};
    memory.set(storageKey,record);
    try{localStorage.setItem(storageKey,JSON.stringify(record));}catch{storageError=true;}
    return record;
  }
  function removeExact(record){
    if(!record)return;const current=read(record.storageKey)||memory.get(record.storageKey);
    if(current&&current.baseRevision===record.baseRevision&&JSON.stringify(current.data)===JSON.stringify(record.data)){try{localStorage.removeItem(record.storageKey);}catch{}memory.delete(record.storageKey);}
  }
  function capture(){
    if(typeof __idbRestored!=='undefined'&&!__idbRestored)return null;
    const snapshot=data(),serialized=JSON.stringify(snapshot);if(!snapshot.appState)return null;
    dirty=serialized!==saved;
    return dirty?retain(snapshot,boot.key,boot.revision,conflict?'与其他页面版本冲突':lastError?'同步失败':'尚未同步'):null;
  }
  const status=text=>{if($('designSyncState'))$('designSyncState').textContent=text;};
  function drawRecovery(){
    let panel=$('designRecoveryPanel');
    if(!panel){const grid=document.querySelector('.workspace-grid');if(!grid)return;panel=document.createElement('section');panel.id='designRecoveryPanel';panel.className='design-recovery-panel';panel.setAttribute('role','status');panel.innerHTML='<strong>未同步的本机草稿</strong><p data-recovery-description></p><div><select id="designRecoveryChoice" aria-label="选择未同步设计草稿"></select><button type="button" id="downloadDesignRecovery">下载未同步草稿</button><button type="button" id="restoreDesignRecovery">恢复本机版本</button></div>';grid.before(panel);$('designRecoveryChoice').onchange=()=>{recoveryChoice=$('designRecoveryChoice').value;};$('downloadDesignRecovery').onclick=downloadRecovery;$('restoreDesignRecovery').onclick=restoreRecovery;}
    const items=records();panel.hidden=!items.length;if(!items.length)return;
    if(!items.some(item=>item.storageKey===recoveryChoice))recoveryChoice=items[0].storageKey;
    const select=$('designRecoveryChoice');select.replaceChildren(...items.map(record=>{const option=document.createElement('option');option.value=record.storageKey;option.textContent=new Date(record.updatedAt).toLocaleString('zh-CN')+' · '+(record.data.appState?.prodName||'未命名商品')+' · '+record.reason;return option;}));select.value=recoveryChoice;
    panel.querySelector('[data-recovery-description]').textContent=(storageError?'浏览器存储已满，请先下载草稿。':'本机副本已保留，重新打开也不会覆盖它。')+' 恢复会把所选副本提交到当前服务器版本；若其他页面再次更新，将保留副本并提示冲突。';
    select.disabled=restoring;$('restoreDesignRecovery').disabled=restoring;$('downloadDesignRecovery').disabled=restoring;
  }
  const chosenRecovery=()=>records().find(record=>record.storageKey===recoveryChoice)||records()[0];
  function downloadRecovery(){const record=chosenRecovery();if(!record)return;const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='未同步设计草稿-'+record.platform+'-'+record.updatedAt.replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function save(){
    if(suppressUnload)return;
    const record=capture();if(!record||conflict||restoring){drawRecovery();return;}
    const key=record.key,serialized=JSON.stringify(record.data),revision=record.baseRevision;
    try{
      const response=await fetch('/api/workspace/design-state?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,data:record.data}),keepalive:serialized.length<50000}),result=await response.json();
      if(!response.ok){if(key===boot.key&&response.status===409)conflict=true;throw new Error(result.error||'草稿暂未同步');}
      removeExact(record);
      if(key===boot.key){boot.revision=result.revision;saved=serialized;checkpoint(key,result.revision,record.data);lastError=null;dirty=JSON.stringify(data())!==saved;if(dirty)capture();status('资料与设计进度已保存到工作台');}
    }catch(error){if(key===boot.key){lastError=error;retain(data(),key,revision,conflict?'与其他页面版本冲突':error.message);}error.designKey=key;throw error;}
    finally{drawRecovery();}
  }
  const flush=()=>{clearTimeout(timer);if(suppressUnload)return pending;capture();pending=pending.then(save).catch(error=>{if(error.designKey&&error.designKey!==boot.key)return;lastError=error;status(error.message+'。未同步草稿已保留，请下载或明确恢复本机版本。');drawRecovery();});return pending;};
  const schedule=()=>{if(suppressUnload)return;capture();clearTimeout(timer);timer=setTimeout(flush,450);};
  async function restoreRecovery(){
    const record=chosenRecovery();if(!record||restoring)return;
    restoring=true;clearTimeout(timer);drawRecovery();
    try{
      await pending;
      const currentResponse=await fetch('/api/workspace/design-state?key='+encodeURIComponent(record.key),{cache:'no-store'}),current=await currentResponse.json();if(!currentResponse.ok)throw new Error(current.error||'无法读取服务器版本');
      const response=await fetch('/api/workspace/design-state?key='+encodeURIComponent(record.key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,data:record.data})}),result=await response.json();
      if(!response.ok)throw new Error(result.error||'恢复未完成，草稿仍保留');
      // Consume only the unchanged copy explicitly selected by the user.
      // Other windows' recovery records survive even a successful POST.
      removeExact(record);saved=JSON.stringify(record.data);boot.revision=result.revision;checkpoint(record.key,result.revision,record.data);sessionStorage.setItem('workspace-restore-commit:design:'+encodeURIComponent(record.key),String(result.revision));dirty=false;lastError=null;conflict=false;suppressUnload=true;location.reload();
    }catch(error){lastError=error;status(error.message+'。本机副本仍保留，请核对后再恢复。');}
    finally{restoring=false;drawRecovery();}
  }
  const original=window.saveAppState;
  window.saveAppState=function(...args){if(suppressUnload)return;const result=original.apply(this,args);schedule();return result;};
  window.addEventListener('workspace-product-bound',()=>{saved='';conflict=false;lastError=null;schedule();drawRecovery();});
  window.addEventListener('workspace-product-updated',schedule);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!suppressUnload)flush();});
  window.addEventListener('pagehide',()=>{if(!suppressUnload)flush();});
  window.addEventListener('beforeunload',event=>{if(suppressUnload)return;window.saveAppState();capture();if(dirty||conflict||lastError){event.preventDefault();event.returnValue='';}});
  window.WorkspaceSaveDesign=async()=>{window.saveAppState();await flush();if(lastError)throw lastError;if(conflict)throw new Error('另一页面已更新此商品，请先下载草稿或明确恢复本机版本');};
  // A blank editor creates its default snapshot on its first save. Complete
  // that save before same-site navigation rather than creating a dirty draft
  // for the first time inside beforeunload and blocking an untouched page.
  let navigating=false;
  document.addEventListener('click',async event=>{
    const link=event.target.closest('a[href]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.hasAttribute('download')||link.target&&link.target!=='_self')return;
    const next=new URL(link.href,location.href);
    if(next.origin!==location.origin||!['http:','https:'].includes(next.protocol)||next.pathname===location.pathname&&next.search===location.search&&next.hash)return;
    event.preventDefault();if(navigating)return;navigating=true;
    try{await window.WorkspaceSaveDesign();location.assign(next.href);}
    catch(error){status(error.message+'。页面尚未跳转，未同步草稿已保留。');}
    finally{navigating=false;}
  });
  const grid=document.querySelector('.workspace-grid'),heading=document.querySelector('.ws-header h2'),subtitle=document.querySelector('.ws-subtitle');
  if(heading)heading.textContent='单品设计';if(subtitle)subtitle.textContent=boot.platform==='amazon'?'Amazon 主图、附图与 A+':'Temu 商品图与详情图';
  if(grid){
    const bar=document.createElement('section');bar.className='design-platform-bar';bar.innerHTML='<div><strong>内容制作 / 单品设计</strong><p id="designSyncState" role="status">正在恢复工作台资料…</p></div><label>目标平台<select id="designPlatform"><option value="amazon">Amazon 亚马逊</option><option value="temu">Temu</option></select></label><a href="/products">选择商品</a>';grid.before(bar);$('designPlatform').value=boot.platform;
    $('designPlatform').onchange=async()=>{const next=$('designPlatform').value;$('designPlatform').disabled=true;try{await window.WorkspaceSaveDesign();const response=await fetch('/api/workspace/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform:next,...(boot.productId?{productId:boot.productId}:{})})}),result=await response.json();if(!response.ok)throw new Error(result.error);location.href='/design?platform='+next+(boot.productId?'&product='+encodeURIComponent(boot.productId):'');}catch(error){status(error.message);$('designPlatform').value=boot.platform;$('designPlatform').disabled=false;}};
    status(boot.data?.appState?'已恢复本商品的平台设计进度':boot.product?'已载入商品库资料':'新建单品设计');
    const style=document.createElement('style');style.textContent='.design-platform-bar,.design-recovery-panel{display:flex;gap:24px;align-items:center;justify-content:space-between;margin:16px 0 20px;padding:18px 24px;background:#fff;border:1px solid #d8e0ed;border-radius:12px;color:#25364e}.design-platform-bar p,.design-recovery-panel p{margin-top:6px;font-size:13px;color:#6b7c96}.design-platform-bar label{display:flex;gap:12px;align-items:center}.design-platform-bar select,.design-recovery-panel select,.design-recovery-panel button{background:#fff;color:#25364e;border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px}.design-platform-bar a{color:#c64d0b;font-size:14px}.design-recovery-panel{display:block;border-color:#edbd9d;background:#fff8f2}.design-recovery-panel[hidden]{display:none}.design-recovery-panel>div{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.design-recovery-panel select{min-width:0;max-width:100%;flex:1}.design-recovery-panel button{cursor:pointer;font-size:13px}';document.head.append(style);
  }
  drawRecovery();
  if(new URLSearchParams(location.search).get('view')==='multisets'){const open=()=>{if(typeof __idbRestored==='undefined'||!__idbRestored){setTimeout(open,100);return;}$('multiSetBtn')?.click();};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',open,{once:true});else open();}
})();

