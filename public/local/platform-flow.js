/* Platform routing surrounds the established execution pages. */
(() => {
  const boot=window.WorkspacePageBoot;if(!boot||boot.page==='settings')return;
  const params=new URLSearchParams(location.search),target=boot.platform||'temu',names={amazon:'Amazon 亚马逊',temu:'Temu 半托管'},source=boot.page==='sourcing';
  const productId=params.get('workspaceProduct'),versionId=params.get('version');
  const $=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let token,snapshot,loading=false,settingErp=false,sourceTimer,sourceSyncing=false;
  const api=async(url,payload)=>{token??=(await (await fetch('/api/session')).json()).token;const response=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'读取失败');return result;};
  const main=source?document.querySelector('main'):document.querySelector('.listing-main');
  const bar=document.createElement('section');bar.className='platform-flow-bar';
  const inListing=!source||location.pathname==='/listings';
  bar.innerHTML=(inListing?'<nav class="platform-mode-links" aria-label="上架模式"><a href="/listings?mode=images&platform='+target+'" '+(!source?'aria-current="page"':'')+'>图片裂变上架</a><a href="/listings?mode=sourcing&platform='+target+'" '+(source?'aria-current="page"':'')+'>自动选品上架</a></nav>':'<strong>选品与采集</strong>')+(source?'<div class="platform-selection"><label for="sourcePlatform">平台</label><select id="sourcePlatform"></select><label for="sourceStore">店铺</label><select id="sourceStore"></select></div>':'<span class="platform-flow-status">平台与店铺来自连接设置</span>');
  main.prepend(bar);
  const notice=document.createElement('div');notice.className='platform-capability-note';notice.hidden=true;bar.after(notice);
  const report=(message,error=false)=>{notice.hidden=!message;notice.textContent=message;notice.setAttribute('role',error?'alert':'status');};
  const selector=source?$('sourcePlatform'):$('platform'),storeSelector=source?$('sourceStore'):$('platformStore');
  function choices(){
    const supported=[...new Set(snapshot.stores.map(s=>s.platform))];
    selector.innerHTML=(supported.includes(target)?'':'<option value="'+target+'" disabled>'+names[target]+'（未绑定店铺）</option>')+supported.map(p=>'<option value="'+p+'">'+names[p]+'</option>').join('');
    selector.value=target;selector.disabled=supported.length===0;
    const shops=snapshot.stores.filter(s=>s.platform===target);
    if(storeSelector){const previous=storeSelector.value||snapshot.context.storeKey;storeSelector.innerHTML='<option value="">'+(shops.length?'选择已绑定店铺':'请先在连接设置绑定店铺')+'</option>'+shops.map(s=>'<option value="'+escape(s.key)+'">'+escape(s.name)+' · '+escape(s.expectedSite)+'</option>').join('');if(shops.some(s=>s.key===previous))storeSelector.value=previous;storeSelector.disabled=!shops.length;}
    if(!supported.includes(target))report('当前平台尚未绑定店铺。请在连接设置中添加后，回到这里选择；商品资料和已生成图片会保留。');
    if(target==='amazon'){
      report(source?'Amazon 选品数据服务尚未接入。已绑定店铺与商品资料可在工作台其他板块继续使用。':'Amazon 成品可在这里核对和导出。当前店小秘自动发布仅接入 Temu，Amazon 店铺绑定会保留供后续接入。');
      if(source)for(const child of [...main.children])if(child!==bar&&child!==notice&&!child.classList.contains('heading'))child.classList.add('platform-source-disabled');
    }
  }
  selector.onchange=async()=>{
    const platform=selector.value;selector.disabled=true;
    try{await api('/api/workspace/context',{platform});const url=new URL(location.href);url.pathname=inListing?'/listings':'/sourcing';url.search='';if(inListing)url.searchParams.set('mode',source?'sourcing':'images');url.searchParams.set('platform',platform);location.href=url.pathname+url.search;}
    catch(e){report(e.message,true);selector.value=target;selector.disabled=false;}
  };
  async function bindStore(key){
    if(!key)return;
    const shop=snapshot.stores.find(s=>s.key===key&&s.platform===target);if(!shop)return;
    if(source){
      const state=await api('/api/sourcing');if(state.busy)throw new Error('采集任务运行中，请完成后再切换目标店铺');
      if(!$('erp')||![...$('erp').options].some(o=>o.value===shop.erpKey))throw new Error('该店铺的 ERP 连接尚未加载，请刷新连接设置后重试');
    }
    await api('/api/workspace/context',{platform:target,storeKey:shop.key,erpKey:shop.erpKey});
    snapshot.context={...snapshot.context,platform:target,storeKey:shop.key,erpKey:shop.erpKey};
    if(source&&$('erp')){settingErp=true;$('erp').value=shop.erpKey;$('erp').dispatchEvent(new Event('change',{bubbles:true}));settingErp=false;}
    if($('platformConnectionHint'))$('platformConnectionHint').textContent='已使用公共店铺绑定：'+shop.name+' · '+shop.expectedSite;
  }
  if(storeSelector)storeSelector.onchange=()=>bindStore(storeSelector.value).catch(e=>report(e.message,true));
  if(!source&&target==='temu')$('targetStore')?.addEventListener('change',()=>bindStore($('targetStore').value).catch(e=>report(e.message,true)));
  function useContext(){
    const shop=snapshot?.stores.find(s=>s.key===snapshot.context.storeKey&&s.platform===target);
    if(shop&&!source&&target==='temu')window.ListingWorkspace?.selectStore(shop);
  }
  async function syncSourceTarget(){
    if(!source||target!=='temu'||!snapshot||!$('erp')||sourceSyncing)return;
    sourceSyncing=true;
    try{
      const state=await api('/api/sourcing'),current=$('erp').value;
      const shop=snapshot.stores.find(s=>s.key===snapshot.context.storeKey&&s.platform===target);
      storeSelector.disabled=!!state.busy||!snapshot.stores.some(s=>s.platform===target);
      if(state.busy){storeSelector.value=shop?.erpKey===current?shop.key:'';return;}
      if(shop&&[...$('erp').options].some(o=>o.value===shop.erpKey)){
        if(current!==shop.erpKey){settingErp=true;$('erp').value=shop.erpKey;$('erp').dispatchEvent(new Event('change',{bubbles:true}));settingErp=false;}
        storeSelector.value=shop.key;
      }else if(shop)storeSelector.value='';
    }catch(e){report(e.message,true);}finally{sourceSyncing=false;}
  }
  if(source&&$('erp')){
    new MutationObserver(()=>{clearTimeout(sourceTimer);sourceTimer=setTimeout(syncSourceTarget,100);}).observe($('erp'),{childList:true,attributes:true,attributeFilter:['disabled']});
    $('erp').addEventListener('change',()=>{
      if(settingErp||!snapshot)return;
      const selected=snapshot.stores.find(s=>s.key===storeSelector.value);
      if(selected&&selected.erpKey!==$('erp').value){storeSelector.value='';snapshot.context.storeKey='';api('/api/workspace/context',{storeKey:'',erpKey:$('erp').value}).catch(e=>report(e.message,true));}
    });
  }
  window.addEventListener('workbench-listing-ready',()=>{useContext();});
  async function load(){if(loading)return;loading=true;try{snapshot=await api('/api/workspace');choices();if(window.ListingWorkspace?.getState().ready)useContext();await syncSourceTarget();}catch(e){report(e.message,true);}finally{loading=false;}}
  window.addEventListener('focus',load);window.addEventListener('storage',e=>{if(e.key==='workbench-settings-changed')load();});
  async function renderSource(){
    if(!productId||source)return;
    const result=await api('/api/workspace/listing-source',{productId,platform:target,...(versionId?{versionId}:{})});
    if(target==='temu'){
      const query=new URLSearchParams({mode:'images',platform:'temu',...(result.groupId?{group:result.groupId}:{draft:result.draftId})});
      location.replace('/listings?'+query);return;
    }
    const {product,version}=result,panel=$('platformReview');
    panel.innerHTML='<h2>'+escape(product.name)+'</h2><p class="platform-flow-status">Amazon · '+version.images.length+' 张已完成图片 · 本页不会重复生成</p><p>'+escape(product.description)+'</p><div class="platform-result-grid">'+version.images.map((image,i)=>'<figure><img src="'+escape(image.url)+'" alt="'+escape(image.kind||'成品')+' '+(i+1)+'"><figcaption>'+escape(({main:'主图',sub:'副图',aplus:'A+ 模块',mobile:'手机版 A+'})[image.kind]||'成品')+' '+(i+1)+'</figcaption></figure>').join('')+'</div><div class="platform-result-actions"><button type="button" class="primary" id="exportPlatformPackage">导出 Amazon 商品资料包</button><a href="/design?platform=amazon&product='+encodeURIComponent(product.id)+'">继续设计</a></div><p id="platformExportStatus" class="platform-flow-status" role="status"></p>';
    $('exportPlatformPackage').onclick=async()=>{
      const button=$('exportPlatformPackage');button.disabled=true;
      try{
        const zip=new JSZip(),files=[];
        for(const [i,image] of version.images.entries()){
          const response=await fetch(image.url);if(!response.ok)throw new Error('成品图片读取失败');
          const filename='images/'+String(i+1).padStart(2,'0')+'-'+(image.kind||'image')+'.'+(image.url.split('.').pop().split('?')[0]||'png');
          zip.file(filename,await response.blob());files.push({...image,file:filename});
          if(image.originalImageUrl){const original=await fetch(image.originalImageUrl);if(!original.ok)throw new Error('原始图片读取失败');zip.file('originals/'+String(i+1).padStart(2,'0')+'.'+image.originalImageUrl.split('.').pop(),await original.blob());}
        }
        zip.file('商品资料.json',JSON.stringify({platform:'amazon',productId:product.id,title:product.name,description:product.description,versionId:version.id,images:files,storeKey:storeSelector?.value||null,published:false},null,2));
        const url=URL.createObjectURL(await zip.generateAsync({type:'blob'})),link=document.createElement('a');link.href=url;link.download=(product.name.replace(/[<>:"/\\|?*]/g,'_')||'商品')+'-Amazon资料.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('platformExportStatus').textContent='商品资料包已导出，包含标准成品与原始图片。';
      }catch(e){$('platformExportStatus').textContent=e.message;}finally{button.disabled=false;}
    };
  }
  (async()=>{await load();try{await renderSource();}catch(e){report(e.message,true);}})();
})();
