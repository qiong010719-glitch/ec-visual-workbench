/* Existing listing drafts share durable state without discarding failed saves. */
(() => {
  const boot=window.WorkspacePageBoot;if(!boot||boot.page!=='listings'||boot.platform!=='temu')return;
  const states=boot.uiStates||{},nativeFetch=window.fetch.bind(window),get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
  const names={'listing:intake':'listing-intake-v1'},prefix='workspace-recovery:ui:',owner=crypto.randomUUID(),memory=new Map();
  for(const key of Object.keys(states))if(key.startsWith('listing:review:'))names[key]='erp-review-'+key.slice(15);
  const selectionKey=key=>['listing-active-task','temu-erp-active','merchant-active-batch','erp-review-current'].includes(key)||/^listing-mother:|^listing-execution-mode:/.test(key);
  const read=key=>{try{return JSON.parse(get.call(localStorage,key)||'null');}catch{return null;}};
  let timer,queue=Promise.resolve(),restoring=false,suppressUnload=false,recoveryChoice='',message='',storageError=false;
  const fingerprints=new Map(),blocked=new Set(),checkpointKey=key=>'workspace-checkpoint:ui:'+encodeURIComponent(key);
  const normalized=(key,data)=>key==='listing:selection'?{items:data?.items||{}}:data??null;
  function checkpoint(key,record){try{set.call(localStorage,checkpointKey(key),JSON.stringify({key,revision:record?.revision||0,data:normalized(key,record?.data),updatedAt:new Date().toISOString()}));}catch{}}
  // Three-way startup merge: keep local edits only when their checkpoint is
  // still the current server revision. Divergent copies require user recovery.
  try{
    const local=values();
    for(const [key,value] of Object.entries(local)){
      const record=states[key]||{revision:0,data:null},prior=read(checkpointKey(key)),server=normalized(key,record.data),present=key==='listing:selection'?Object.keys(value.items).length>0:get.call(localStorage,names[key])!==null;
      const restoreKey='workspace-restore-commit:ui:'+encodeURIComponent(key),forceRestore=sessionStorage.getItem(restoreKey);sessionStorage.removeItem(restoreKey);
      const changed=prior?JSON.stringify(value)!==JSON.stringify(prior.data):present&&JSON.stringify(value)!==JSON.stringify(server);
      if(changed&&!forceRestore){
        retain(key,value,'离页前尚未同步',prior?.revision||0);
        if(!forceRestore&&(prior&&record.revision===prior.revision&&JSON.stringify(server)===JSON.stringify(prior.data)||!prior&&!record.revision))continue;
      }
      if(key==='listing:selection'){for(const name of Object.keys(localStorage))if(selectionKey(name))remove.call(localStorage,name);for(const [name,item] of Object.entries(server.items))if(selectionKey(name))set.call(localStorage,name,item);}
      else if(record.data!==null&&record.data!==undefined)set.call(localStorage,names[key],JSON.stringify(record.data));else if(record.revision)remove.call(localStorage,names[key]);
      checkpoint(key,record);
    }
  }catch{}
  for(const [key,record] of Object.entries(states))fingerprints.set(key,JSON.stringify(normalized(key,record.data)));
  const session=nativeFetch('/api/session').then(async response=>{const data=await response.json();if(!response.ok||!data.token)throw new Error('无法读取本地会话');return data;});
  function values(){
    for(const name of Object.keys(localStorage))if(/^erp-review-[a-zA-Z0-9_-]+$/.test(name)&&name!=='erp-review-current')names['listing:review:'+name.slice(11)]=name;
    return {...Object.fromEntries(Object.entries(names).map(([key,name])=>[key,read(name)])),'listing:selection':{items:Object.fromEntries(Object.keys(localStorage).filter(selectionKey).map(name=>[name,get.call(localStorage,name)]))}};
  }
  function records(){
    const found=new Map(memory);
    try{for(const key of Object.keys(localStorage))if(key.startsWith(prefix)){const record=read(key);if(record?.kind==='ui'&&record.platform==='temu'&&record.key?.startsWith('listing:')&&Object.hasOwn(record,'data'))found.set(key,{...record,storageKey:key});}}catch{}
    return [...found.values()].filter(record=>JSON.stringify(record.data)!==fingerprints.get(record.key)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function retain(key,data,reason='尚未同步',baseRevision=states[key]?.revision||0){
    const storageKey=prefix+encodeURIComponent(key)+':'+owner,record={schema:1,kind:'ui',key,productId:boot.context?.productId||'',platform:'temu',baseRevision,updatedAt:new Date().toISOString(),reason,data,storageKey};
    memory.set(storageKey,record);try{set.call(localStorage,storageKey,JSON.stringify(record));}catch{storageError=true;}return record;
  }
  function retainAll(){
    const captured=[];
    for(const [key,data] of Object.entries(values()))if(fingerprints.get(key)!==JSON.stringify(data))captured.push(retain(key,data,blocked.has(key)?'与其他页面版本冲突':'尚未同步'));
    return captured;
  }
  function removeExact(record){const current=read(record.storageKey)||memory.get(record.storageKey);if(current&&current.baseRevision===record.baseRevision&&JSON.stringify(current.data)===JSON.stringify(record.data)){try{remove.call(localStorage,record.storageKey);}catch{}memory.delete(record.storageKey);}}
  function draw(){
    let box=document.getElementById('sharedStateNotice');
    if(!box){const main=document.querySelector('main');if(!main)return;box=document.createElement('section');box.id='sharedStateNotice';box.className='workspace-sync-notice';box.setAttribute('role','status');box.innerHTML='<p id="sharedStateMessage"></p><div id="listingRecoveryControls"><p>本机副本会保留。恢复会使用刚读取的服务器版本提交所选副本；有新并发修改时仍会提示冲突。</p><select id="listingRecoveryChoice" aria-label="选择未同步上架草稿"></select><button type="button" id="downloadListingRecovery">下载未同步草稿</button><button type="button" id="restoreListingRecovery">恢复本机版本</button></div>';main.prepend(box);document.getElementById('listingRecoveryChoice').onchange=event=>{recoveryChoice=event.target.value;};document.getElementById('downloadListingRecovery').onclick=downloadRecovery;document.getElementById('restoreListingRecovery').onclick=restoreRecovery;}
    const items=records();box.hidden=!message&&!items.length;document.getElementById('sharedStateMessage').textContent=(storageError?'本机存储已满，请先下载草稿。 ':message)||(items.length?'发现未同步的本机上架草稿，尚未覆盖当前服务器内容。':'');
    const controls=document.getElementById('listingRecoveryControls');controls.hidden=!items.length;if(!items.length)return;
    if(!items.some(item=>item.storageKey===recoveryChoice))recoveryChoice=items[0].storageKey;
    const select=document.getElementById('listingRecoveryChoice');select.replaceChildren(...items.map(record=>{const option=document.createElement('option');option.value=record.storageKey;option.textContent=new Date(record.updatedAt).toLocaleString('zh-CN')+' · '+(record.key==='listing:intake'?'素材与裂变设置':record.key==='listing:selection'?'当前任务与母稿选择':'上架核对资料')+' · '+record.reason;return option;}));select.value=recoveryChoice;select.disabled=restoring;
    document.getElementById('downloadListingRecovery').disabled=restoring;document.getElementById('restoreListingRecovery').disabled=restoring;
  }
  const chosenRecovery=()=>records().find(record=>record.storageKey===recoveryChoice)||records()[0];
  function downloadRecovery(){const record=chosenRecovery();if(!record)return;const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='未同步上架草稿-'+record.updatedAt.replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function post(key,data,revision){
    const response=await nativeFetch('/api/workspace/ui-state?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':(await session).token},body:JSON.stringify({data,revision}),keepalive:JSON.stringify(data).length<40000}),result=await response.json();
    if(!response.ok){const error=new Error(result.error||'进度暂未同步');error.status=response.status;throw error;}return result;
  }
  async function capture(){
    if(suppressUnload)return;
    const captured=retainAll();if(restoring)return;
    for(const record of captured){
      const {key,data}=record;if(blocked.has(key))continue;
      try{const result=await post(key,data,record.baseRevision);states[key]=result;fingerprints.set(key,JSON.stringify(data));checkpoint(key,result);removeExact(record);}
      catch(error){if(error.status===409)blocked.add(key);retain(key,values()[key],error.status===409?'与其他页面版本冲突':error.message);throw error;}
    }
    draw();
  }
  const flush=()=>{clearTimeout(timer);if(suppressUnload)return queue;retainAll();queue=queue.then(capture).catch(error=>{message=error.message+'。未同步草稿已保留，可下载或明确恢复本机版本。';draw();});return queue;};
  const schedule=()=>{if(suppressUnload)return;retainAll();clearTimeout(timer);timer=setTimeout(flush,300);};
  async function restoreRecovery(){
    const record=chosenRecovery();if(!record||restoring)return;restoring=true;clearTimeout(timer);retainAll();draw();
    try{
      await queue;
      const response=await nativeFetch('/api/workspace/ui-state?key='+encodeURIComponent(record.key),{cache:'no-store'}),current=await response.json();if(!response.ok)throw new Error(current.error||'无法读取服务器版本');
      const result=await post(record.key,record.data,current.revision);states[record.key]=result;fingerprints.set(record.key,JSON.stringify(record.data));checkpoint(record.key,result);removeExact(record);blocked.delete(record.key);sessionStorage.setItem('workspace-restore-commit:ui:'+encodeURIComponent(record.key),String(result.revision));suppressUnload=true;location.reload();
    }catch(error){message=error.message+'。本机副本仍保留，请核对后再恢复。';}
    finally{restoring=false;draw();}
  }
  document.addEventListener('input',schedule);document.addEventListener('change',schedule);document.addEventListener('click',schedule);
  window.addEventListener('workbench-listing-ready',schedule);
  window.addEventListener('beforeunload',event=>{if(suppressUnload)return;if(retainAll().length){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{if(!suppressUnload)flush();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!suppressUnload)flush();});
  setInterval(()=>{if(!document.hidden&&!restoring)flush();},4000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',draw,{once:true});else draw();
})();

