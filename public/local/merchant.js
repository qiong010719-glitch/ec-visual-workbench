(() => {
  const $=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let token,settings,templates=[],storeStep='details',working=false,storeBaseline='',pendingFocus=null;
  let chromeBusy=false,chromeInspection=null,chromeBaseline=null,chromeFreeze=false;
  const editorStorage='merchant-store-editor-v1';
  const collectionEditorStorage='merchant-collection-editor-v1';
  const collectionBackendMessage='请关闭旧工作台服务后重新启动，启用新版采集店铺功能';
  const collectionFeaturesReady=()=>Array.isArray(settings?.collectionStores)&&Array.isArray(settings?.collectionPlatforms);
  function requireCollectionFeatures(){if(!collectionFeaturesReady())throw new Error(collectionBackendMessage);}
  const connectionStorage='merchant-connection-editor-v1',connectionChecks=new Map();
  const templateChecks=new Map();
  const templateSteps=new Map();
  const api=async(route,p)=>{const response=await fetch(route,p===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(p)});const value=await response.json().catch(()=>{throw Object.assign(new Error('后台返回异常，请检查工作台服务是否可用。'),{status:response.status});});if(!response.ok)throw Object.assign(new Error(value.error||'请求失败'),{status:response.status});return value;};
  function notice(message,error=false){$('notice').hidden=false;$('notice').className=error?'error':'';$('notice').textContent=message;}
  async function action(button,fn){
    if(working||chromeBusy||!settings)return;
    working=true;const wasDisabled=button?.disabled;
    if(button)button.disabled=true;
    $('settingsPage').inert=true;$('settingsPage').setAttribute('aria-busy','true');
    notice('正在处理，请稍候…');
    try{await fn();}catch(e){notice(e.message,true);}
    finally{working=false;$('settingsPage').inert=false;$('settingsPage').removeAttribute('aria-busy');if(button?.isConnected)button.disabled=wasDisabled;pendingFocus?.focus({preventScroll:true});pendingFocus=null;}
  }
  function focusField(field){if(working)pendingFocus=field;else field?.focus({preventScroll:true});}
  const formValue=form=>Object.fromEntries(new FormData(form));
  const uid=()=>crypto.randomUUID();
  const chromeBrowsers=()=>settings.browsers.filter(b=>b.type==='chrome');
  const existingChrome=browser=>browser?.connectionMode==='existing';
  const chromeLabel=browser=>browser.name+(existingChrome(browser)?' · 复用当前 Chrome':' · 端口 '+browser.debugPort);
  function announceSettings(){const detail={revision:settings.revision,at:Date.now()};try{localStorage.setItem('workbench-settings-changed',JSON.stringify(detail));}catch{}window.dispatchEvent(new CustomEvent('workbench-settings-changed',{detail}));document.dispatchEvent(new CustomEvent('workspace:refresh'));}
  const erpProvider=e=>(settings.erpProviders||[{id:'dianxiaomi',name:'店小秘',loginUrl:'https://www.dianxiaomi.com/',listingPlatforms:['temu'],status:'已接入 Temu 半托管'}]).find(p=>p.id===(e?.provider||'dianxiaomi'));
  function erpFields(){
    const provider=erpProvider(formValue($('erpForm'))),editing=!!$('erpForm').elements.key.value;
    $('erpLoginUrl').value=provider?.loginUrl||'';
    $('erpProviderHint').textContent=settings.erpProviders?provider?.status||'':'新增妙手连接需在当前任务结束后重启工作台。已有店小秘连接仍可使用。';
    $('erpForm').elements.expectedAccount.required=provider?.id==='dianxiaomi';
    $('saveErp').textContent=editing?'保存账号修改':'保存并打开登录';
    $('erpEditorSummary').textContent=editing?'修改 ERP 账号':'新增 ERP 账号';
  }
  const connectionSignature=erp=>JSON.stringify([erp,settings.browsers.find(b=>b.key===erp.browserKey)]);
  function checkedConnection(erp){
    const proof=connectionChecks.get(erp.key);
    return proof?.signature===connectionSignature(erp)?proof:null;
  }
  function updateGuide(){
    const browsers=chromeBrowsers(),accounts=settings.erpConnections.filter(e=>browsers.some(b=>b.key===e.browserKey));
    const supported=accounts.filter(e=>erpProvider(e)?.listingPlatforms.includes('temu'));
    const verified=supported.filter(e=>checkedConnection(e)?.verified);
    $('browserDefault').hidden=browsers.length>0;
    $('browserSettings').classList.toggle('configured',browsers.length>0);
    $('browserStatus').textContent=browsers.length?(browsers.some(existingChrome)?'ERP 登录与采集会使用各账号绑定的浏览器。当前 Chrome 连接可复用已有登录和插件，首次连接需在 Chrome 中允许。':'当前仍使用独立 Chrome 配置。点击“改用当前 Chrome”并保存，可让关联账号的登录与采集复用日常 Chrome 的登录和插件。'):'推荐连接已打开的 Chrome，复用已有登录与店小秘插件；首次连接需在 Chrome 中授权。';
    $('browserStepStatus').textContent=browsers.length?'已配置':'待准备';
    $('erpStepStatus').textContent=verified.length?'本次已核实 '+verified.length+' 个账号':accounts.length?'已保存 · 待检查':'待连接';
    $('storeStepStatus').textContent=(settings.collectionStores?.length||settings.stores.length)?`${settings.collectionStores?.length||0} 家采集店铺 · ${settings.stores.length} 家做图店铺`:'按上架方式配置';
    const next=$('setupNext');next.hidden=false;
    if(!browsers.length){$('setupSummary').textContent='先连接当前 Chrome，再绑定你的 ERP 账号。';next.textContent='使用当前 Chrome';next.dataset.next='browser';}
    else if(!supported.length){$('setupSummary').textContent='浏览器配置已保存。接下来连接店小秘账号，完成登录。';next.textContent='连接 ERP 账号';next.dataset.next='erp';}
    else if(!verified.length){$('setupSummary').textContent='账号配置已保存。打开登录窗口后，点击“检查登录”确认本次连接。';next.textContent='查看账号与登录';next.dataset.next='login';}
    else{$('setupSummary').textContent='本次已核实账号登录。按你的业务选择采集商品上架，或配置做图店铺。';next.textContent='选择上架方式';next.dataset.next='store';}
    next.hidden=!browsers.length;
    const step=!browsers.length?'#browserSettings':!verified.length?'#erpSettings':'#storeSettings';
    for(const link of $('setupSteps').querySelectorAll('a')){if(link.getAttribute('href')===step)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');}
  }
  function replaceOptions(select,options){
    const previous=select.value;select.innerHTML='<option value="">请选择</option>'+options;
    select.value=[...select.options].some(o=>o.value===previous&&!o.disabled)?previous:'';
  }
  async function saveSettings(p){
    if(Object.hasOwn(p,'collectionStores'))requireCollectionFeatures();
    collectTemplates();
    settings=await api('/api/settings',{revision:settings.revision,...p});
    clearCatalog();renderSettings();paintTemplateStatus();rememberEditor();rememberConnections();
    announceSettings();
    notice('配置已保存在本机。');
  }
  function renderSettings(){
    $('erpForm').elements.provider.querySelector('[value="miaoshou"]').disabled=!settings.erpProviders?.some(p=>p.id==='miaoshou');
    for(const badge of document.querySelectorAll('[data-secret-status]')){
      const configured=!!settings.models[badge.dataset.secretStatus+'Configured'];
      badge.textContent=configured?'已保存':'未配置';badge.dataset.configured=String(configured);
    }
    $('modelStatus').textContent='已保存仅表示密钥已配置，服务可用性以实际调用结果为准。';
    $('browserList').innerHTML=chromeBrowsers().map(b=>`<div class="config-row"><div><strong>${escape(chromeLabel(b))}</strong><small>${existingChrome(b)?'复用已打开的 Chrome 登录和插件 · 连接时由 Chrome 授权':'独立配置窗口 · 保留该窗口自己的登录和插件'}</small></div><div>${!existingChrome(b)&&!chromeBrowsers().some(existingChrome)?`<button data-browser-reuse="${escape(b.key)}">改用当前 Chrome</button>`:''}<button data-browser-edit="${escape(b.key)}">调整设置</button><details class="row-more"><summary>更多</summary><button data-browser-check="${escape(b.key)}">检查连接</button><button data-browser-remove="${escape(b.key)}">删除</button></details></div></div>`).join('');
    $('storeList').innerHTML=settings.stores.map(s=>`<div class="config-row"><div><strong>${escape(s.expectedStore)} · ${escape(s.expectedSite)}</strong><small>${escape(settings.erpConnections.find(e=>e.key===s.erpKey)?.name||'账号待配置')} · ${s.platform==='amazon'?'Amazon · 自动发布待接入':s.templates.length+' 个商品母稿'+(s.templates.some(t=>!t.verifiedAt)?' · 需要校验':'')}</small></div><div><button data-store-edit="${escape(s.key)}">编辑</button><details class="row-more"><summary>更多</summary><button data-store-remove="${escape(s.key)}">删除</button></details></div></div>`).join('')||'<p class="muted">做图或导入成品图片上架时，在这里添加店铺和参考商品。采集商品使用上方的采集箱店铺绑定。</p>';
    replaceOptions($('erpForm').elements.browserKey,chromeBrowsers().map(b=>`<option value="${escape(b.key)}">${escape(chromeLabel(b))}</option>`).join(''));
    renderStoreErps();renderCollectionStores();
    $('erpList').innerHTML=settings.erpConnections.map(e=>{
      const p=erpProvider(e),browser=chromeBrowsers().find(b=>b.key===e.browserKey),proof=checkedConnection(e);
      return `<div class="config-row"><div><strong>${escape(e.name)}</strong><small>${escape(p?.name)} · ${browser?escape(chromeLabel(browser)):'请修改账号，选择 Chrome 连接'}${e.expectedAccount?' · 账号 '+escape(e.expectedAccount):' · 尚未填写账号显示名'}</small><p class="last-check ${proof?.verified?'success':proof?.error?'error':''}">${escape(proof?.message||'配置已保存，登录状态待检查')}</p>${p?.listingPlatforms.includes('temu')?'':`<small>${escape(p?.status)}</small>`}</div><div><button data-erp-open="${escape(e.key)}" ${browser?'':'disabled'}>打开${escape(p?.name)}登录</button><button data-erp-check="${escape(e.key)}" ${browser?'':'disabled'}>${p?.id==='miaoshou'?'检查连接':'检查登录'}</button><button data-erp-edit="${escape(e.key)}">编辑</button><details class="row-more"><summary>更多</summary><button data-erp-remove="${escape(e.key)}">删除</button></details></div></div>`;
    }).join('')||'<p class="muted">添加账号后，将使用所选 Chrome 的登录状态；需要时在工作窗口完成登录。</p>';
    erpFields();updateGuide();renderChromeChoices();
  }
  $('modelForm').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{await saveSettings({models:formValue(e.target)});for(const el of e.target.querySelectorAll('input[type=password]'))el.value='';});};

  const collectionPlatformName=platform=>({temu:'Temu 半托管',shein:'SHEIN 希音',tiktok:'TikTok'}[platform]||platform);
  function collectionSiteHint(){
    const form=$('collectionStoreForm'),temu=form.elements.platform.value==='temu';
    form.elements.site.required=temu;
    $('collectionStoreSiteHint').textContent=temu?'Temu 需要指定经营站点，请与店小秘中的名称保持一致。':form.elements.platform.value==='shein'?'SHEIN 认领按店铺选择；站点可保留用于本地分组，平台页面显示站点时会核对，不会在认领弹窗另选站点。':'平台未区分站点时可留空；如店铺有多个站点，请填写本次使用的站点。';
  }
  function renderCollectionStores(){
    const ready=collectionFeaturesReady(),stores=ready?settings.collectionStores:[];
    $('collectionBackendNotice').hidden=ready;$('collectionBackendNotice').textContent=ready?'':collectionBackendMessage;
    $('newCollectionStore').disabled=!ready;
    for(const field of $('collectionStoreForm').elements)field.disabled=!ready;
    if(!ready)$('collectionStoreForm').hidden=true;
    $('collectionStoreList').innerHTML=stores.map(store=>`<div class="config-row"><div><strong>${escape(store.storeName)}${store.site?' · '+escape(store.site):''}</strong><small>${escape(collectionPlatformName(store.platform))} · ${escape(settings.erpConnections.find(erp=>erp.key===store.erpKey)?.name||'账号待配置')}${store.storeId?' · ID '+escape(store.storeId):''}</small></div><div><button type="button" data-collection-edit="${escape(store.key)}">编辑</button><button type="button" data-collection-remove="${escape(store.key)}">移除绑定</button></div></div>`).join('')||'<p class="muted">先绑定接收采集商品的平台和店铺，再到本批补全页选择使用。</p>';
    replaceOptions($('collectionStoreForm').elements.erpKey,settings.erpConnections.filter(erp=>(erp.provider||'dianxiaomi')==='dianxiaomi'&&chromeBrowsers().some(browser=>browser.key===erp.browserKey)).map(erp=>`<option value="${escape(erp.key)}">${escape(erp.name)}</option>`).join(''));
    collectionSiteHint();
  }
  function rememberCollectionEditor(){
    if(!settings)return;
    try{localStorage.setItem(collectionEditorStorage,JSON.stringify({revision:settings.revision,fields:formValue($('collectionStoreForm')),open:!$('collectionStoreForm').hidden}));}catch{}
  }
  function editCollectionStore(store){
    if(!collectionFeaturesReady()){notice(collectionBackendMessage,true);return;}
    const form=$('collectionStoreForm');form.reset();
    for(const field of form.elements)if(field.name&&store&&Object.hasOwn(store,field.name))field.value=store[field.name];
    if(!store){form.elements.key.value='';const choices=[...form.elements.erpKey.options].filter(option=>option.value);if(choices.length===1)form.elements.erpKey.value=choices[0].value;}
    $('collectionStoreEditorTitle').textContent=store?'编辑采集箱店铺':'绑定采集箱店铺';form.hidden=false;collectionSiteHint();rememberCollectionEditor();focusField(form.elements.storeName);
  }
  $('newCollectionStore').onclick=()=>editCollectionStore();
  $('cancelCollectionStore').onclick=()=>{$('collectionStoreForm').hidden=true;rememberCollectionEditor();};
  $('collectionStoreForm').addEventListener('input',rememberCollectionEditor);
  $('collectionStoreForm').addEventListener('change',()=>{collectionSiteHint();rememberCollectionEditor();});
  $('collectionStoreForm').onsubmit=event=>{event.preventDefault();void action(event.submitter,async()=>{
    requireCollectionFeatures();
    const values=formValue(event.target),record={key:values.key||uid(),erpKey:values.erpKey,platform:values.platform,storeName:values.storeName.trim(),site:values.site.trim(),...(values.storeId.trim()?{storeId:values.storeId.trim()}:{})};
    await saveSettings({collectionStores:[...(settings.collectionStores||[]).filter(store=>store.key!==record.key),record]});
    event.target.reset();event.target.elements.key.value='';event.target.hidden=true;rememberCollectionEditor();notice(`“${record.storeName}”采集箱绑定已保存，可在本批补全页选择。`);
  });};
  $('collectionStoreList').onclick=event=>{const button=event.target.closest('[data-collection-edit],[data-collection-remove]');if(!button)return;
    if(button.dataset.collectionEdit){editCollectionStore((settings.collectionStores||[]).find(store=>store.key===button.dataset.collectionEdit));return;}
    void action(button,async()=>{await saveSettings({collectionStores:(settings.collectionStores||[]).filter(store=>store.key!==button.dataset.collectionRemove)});if($('collectionStoreForm').elements.key.value===button.dataset.collectionRemove){$('collectionStoreForm').reset();$('collectionStoreForm').hidden=true;}rememberCollectionEditor();notice('已移除采集箱店铺绑定，历史任务记录保留。');});
  };

  function reveal(id){const element=$(id);if(element.tagName==='DETAILS')element.open=true;else element.hidden=false;element.scrollIntoView({block:'start',behavior:'instant'});}
  function rememberConnections(){
    if(!settings)return;
    try{localStorage.setItem(connectionStorage,JSON.stringify({revision:settings.revision,browser:formValue($('browserForm')),erp:formValue($('erpForm')),browserOpen:$('browserEditor').open,erpOpen:$('erpEditor').open,advanced:$('erpAdvanced').open}));}catch{}
  }
  function restoreConnections(){
    try{
      const saved=JSON.parse(localStorage.getItem(connectionStorage)||'null');
      if(!saved||saved.revision!==settings.revision)return;
      for(const [id,fields] of [['browserForm',saved.browser],['erpForm',saved.erp]]){
        if(!fields)continue;
        for(const el of $(id).elements)if(el.name&&Object.hasOwn(fields,el.name))el.value=fields[el.name];
      }
      $('browserEditor').open=!!saved.browserOpen;$('erpEditor').open=!!saved.erpOpen;$('erpAdvanced').open=!!saved.advanced;erpFields();
    }catch{}
  }
  function editErp(value,{open=true,persist=true}={}){
    const form=$('erpForm');form.reset();
    for(const el of form.elements)if(el.name)el.value=value?.[el.name]??(el.name==='provider'?'dianxiaomi':'');
    if(!value&&chromeBrowsers().length===1)form.elements.browserKey.value=chromeBrowsers()[0].key;
    $('erpAdvanced').open=chromeBrowsers().length!==1||!!value&&!chromeBrowsers().some(b=>b.key===value.browserKey);
    erpFields();$('erpEditor').open=open;
    if(open){reveal('erpEditor');focusField(form.elements.expectedAccount);}
    if(persist)rememberConnections();
  }
  async function defaultBrowser(){
    if(!chromeBrowsers().length){const browser={key:uid(),type:'chrome',connectionMode:'existing',name:'当前 Chrome'};acceptChromeSettings(await api('/api/settings/chrome/save',{revision:settings.revision,browser}));}
    editBrowser();$('browserEditor').open=false;editErp();
    notice('浏览器配置已保存。填写店小秘账号显示名，再保存并打开登录。');
  }
  $('browserDefault').onclick=e=>action(e.currentTarget,defaultBrowser);
  $('setupNext').onclick=e=>{
    const next=e.currentTarget.dataset.next;
    if(next==='browser')return action(e.currentTarget,defaultBrowser);
    if(next==='erp')editErp();
    else reveal(next==='login'?'erpSettings':'storeSettings');
  };
  function chromeValue(){const fields=$('browserForm').elements,connectionMode=fields.connectionMode.value||'dedicated';return {key:fields.key.value,type:'chrome',connectionMode,name:fields.name.value.trim(),...(connectionMode==='dedicated'?{debugPort:Number(fields.debugPort.value),executable:fields.executable.value.trim()}:{})};}
  const chromeFingerprint=()=>JSON.stringify(chromeValue());
  function chromeStatus(message,state='unchecked'){$('chromePortStatus').textContent=message;$('chromePortStatus').className='chrome-port-status '+state;$('chromePortStatus').setAttribute('role',['error','occupied','profile_running','unavailable'].includes(state)?'alert':'status');}
  function chromeError(error){return error.status===404||error.status===405?'当前后台尚未提供此 Chrome 连接设置，请更新或重启后台后重试。当前输入已保留。':error.name==='TypeError'?'无法连接工作台后台，请确认服务正在运行。当前输入已保留。':error.message+' 当前输入已保留。';}
  function updateChromeControls(){
    if(!settings)return;
    const value=chromeValue(),existing=chromeBrowsers().find(browser=>browser.key===value.key),blocked=!existingChrome(value)&&chromeInspection?.fingerprint===chromeFingerprint()&&['occupied','profile_running','unavailable'].includes(chromeInspection.state);
    $('chromePortField').hidden=existingChrome(value);$('chromeDebugPort').required=!existingChrome(value);$('browserAdvanced').hidden=existingChrome(value);$('suggestChromePort').hidden=existingChrome(value);$('chromeExistingHelp').hidden=!existingChrome(value);
    $('inspectChromePort').textContent=existingChrome(value)?'检查当前 Chrome':'检查端口';
    $('chromeInspectHelp').textContent=existingChrome(value)?'只读取当前可发现的 Chrome 连接，不打开窗口、不请求授权。':'只检查端口，不打开浏览器或登录账号。';
    $('chromeConnectionMode').disabled=chromeBusy&&chromeFreeze;
    for(const id of ['savedChromeWindow','newChromeWindow','inspectChromePort','suggestChromePort','refreshChromeRevision'])$(id).disabled=chromeBusy;
    $('resetBrowser').disabled=chromeBusy||!existing;$('saveChromeWindow').disabled=chromeBusy||blocked;
    for(const field of $('browserForm').querySelectorAll('input:not([type="hidden"])'))field.readOnly=chromeBusy&&chromeFreeze;
    for(const button of $('browserList').querySelectorAll('button'))button.disabled=chromeBusy;
    $('chromeEditorTitle').textContent=existing?'编辑连接 · '+existing.name:'新增浏览器连接';
    $('chromeDraftStatus').textContent=existing&&chromeBaseline===chromeFingerprint()?'已保存配置':'尚未保存';
    const erps=settings.erpConnections.filter(erp=>erp.browserKey===value.key),keys=new Set(erps.map(erp=>erp.key)),stores=settings.stores.filter(store=>keys.has(store.erpKey));
    $('chromeImpactHint').hidden=!existing||!erps.length;
    $('chromeImpactHint').textContent=erps.length?`保存后，关联的 ${erps.length} 条 ERP 连接会统一使用所选浏览器进行登录与采集。${stores.length?`关联的 ${stores.length} 家店铺母稿需重新核对。`:''}历史任务保留原绑定。`:'';
  }
  function renderChromeChoices(){
    const current=$('browserForm').elements.key.value,exists=chromeBrowsers().some(browser=>browser.key===current);
    $('savedChromeWindow').innerHTML=(exists?'':'<option value="">'+(current?'新增浏览器连接（尚未保存）':'请选择已保存连接')+'</option>')+chromeBrowsers().map(browser=>`<option value="${escape(browser.key)}">${escape(chromeLabel(browser))}</option>`).join('');
    $('savedChromeWindow').value=exists?current:'';updateChromeControls();
  }
  function editBrowser(value){
    const saved=value||chromeBrowsers().find(browser=>browser.key===$('browserForm').elements.key.value)||chromeBrowsers()[0];
    const draft=saved?{...saved,connectionMode:saved.connectionMode||'dedicated'}:{key:uid(),type:'chrome',connectionMode:'existing',name:'当前 Chrome',debugPort:'',executable:''};
    for(const field of $('browserForm').elements)if(field.name)field.value=field.name==='type'?'chrome':draft[field.name]??'';
    chromeBaseline=saved?chromeFingerprint():null;chromeInspection=null;$('refreshChromeRevision').hidden=true;renderChromeChoices();chromeStatus(existingChrome(draft)?'使用已打开的 Chrome。保存不会连接浏览器；请按上方说明启用并授权连接。':saved?'已载入保存的独立窗口配置。检查端口可确认当前是否可用。':'请填写新窗口名称，并选择一个空闲端口。');
  }
  function newBrowser(){
    const draft={key:uid(),type:'chrome',connectionMode:'existing',name:'当前 Chrome',debugPort:'',executable:''};
    for(const field of $('browserForm').elements)if(field.name)field.value=draft[field.name]??'';
    chromeBaseline=null;chromeInspection=null;$('refreshChromeRevision').hidden=true;renderChromeChoices();chromeStatus('新连接默认复用当前 Chrome；原有配置与 ERP 绑定保持不变。');
  }
  function validateChrome(requireName=false){const value=chromeValue();if(requireName&&!value.name)throw new Error('请填写连接名称。');if(!['existing','dedicated'].includes(value.connectionMode))throw new Error('请选择有效的 Chrome 连接方式。');if(!existingChrome(value)&&(!Number.isInteger(value.debugPort)||value.debugPort<1024||value.debugPort>65535))throw new Error('请填写 1024—65535 之间的整数端口。');return value;}
  async function chromeAction(fn,{freeze=false}={}){
    if(chromeBusy||working||!settings)return;chromeBusy=true;chromeFreeze=freeze;$('settingsPage').inert=freeze;updateChromeControls();
    try{await fn();}catch(error){chromeStatus(chromeError(error),'error');if(error.status===409)$('refreshChromeRevision').hidden=false;}
    finally{chromeBusy=false;chromeFreeze=false;$('settingsPage').inert=false;updateChromeControls();rememberConnections();}
  }
  function acceptChromeSettings(next){collectTemplates();settings=next;clearCatalog();renderSettings();if(templates.length)paintTemplateStatus();announceSettings();rememberEditor();rememberConnections();}
  async function chooseChromePort(){
    if(existingChrome(chromeValue()))return;
    await chromeAction(async()=>{const fingerprint=chromeFingerprint(),key=chromeValue().key;chromeStatus('正在查找空闲端口…');const result=await api('/api/settings/chrome/suggest',{browserKey:key});if(fingerprint!==chromeFingerprint()){chromeStatus('输入已变化，未应用旧的端口建议，请重新选择。');return;}if(!Number.isInteger(result.debugPort))throw new Error('后台未返回有效的空闲端口。');$('browserForm').elements.debugPort.value=result.debugPort;chromeInspection=null;chromeStatus((result.message||'已选择空闲端口 '+result.debugPort)+' 点击“保存并应用”后生效。','suggested');});
  }
  $('savedChromeWindow').onchange=()=>{const saved=chromeBrowsers().find(browser=>browser.key===$('savedChromeWindow').value);if(saved)editBrowser(saved);};
  $('newChromeWindow').onclick=()=>{if(chromeBusy||!settings)return;newBrowser();rememberConnections();};
  $('browserForm').addEventListener('input',()=>{chromeInspection=null;chromeStatus(existingChrome(chromeValue())?'配置已修改，可检查当前 Chrome；保存不会连接或更改权限。':'配置已修改，请重新检查当前端口。');updateChromeControls();});
  $('browserForm').addEventListener('change',()=>{chromeInspection=null;chromeStatus(existingChrome(chromeValue())?'配置已修改，可检查当前 Chrome；保存不会连接或更改权限。':'配置已修改，请重新检查当前端口。');updateChromeControls();});
  $('inspectChromePort').onclick=()=>chromeAction(async()=>{const value=validateChrome(),fingerprint=chromeFingerprint();chromeStatus(existingChrome(value)?'正在只读查找当前 Chrome 连接…':'正在只读检查端口 '+value.debugPort+'…');const result=await api('/api/settings/chrome/inspect',{browser:value});if(fingerprint!==chromeFingerprint()){chromeStatus('输入已变化，刚才的检测结果已失效，请重新检查。');return;}chromeInspection={...result,fingerprint};chromeStatus(result.message||'Chrome 连接检查完成。',result.state||'unavailable');});
  $('suggestChromePort').onclick=chooseChromePort;
  $('browserForm').onsubmit=event=>{event.preventDefault();chromeAction(async()=>{const browser=validateChrome(true),next=await api('/api/settings/chrome/save',{revision:settings.revision,browser});acceptChromeSettings(next);editBrowser(settings.browsers.find(saved=>saved.key===browser.key));chromeStatus(`已保存并应用：${chromeLabel(browser)}。关联的 ERP 与整个工作台会使用这份配置。`,'saved');notice('Chrome 连接配置已保存并应用。');},{freeze:true});};
  $('resetBrowser').onclick=()=>chromeAction(async()=>{const key=chromeValue().key,next=await api('/api/settings');acceptChromeSettings(next);const saved=chromeBrowsers().find(browser=>browser.key===key);if(!saved)throw new Error('该窗口已在其他页面移除，请选择其他窗口或新增。');editBrowser(saved);chromeStatus('已从后台重新读取并恢复该窗口配置。');},{freeze:true});
  $('refreshChromeRevision').onclick=()=>chromeAction(async()=>{acceptChromeSettings(await api('/api/settings'));chromeInspection=null;$('refreshChromeRevision').hidden=true;chromeStatus('已读取最新后台配置；当前窗口输入已保留，请核对后再次保存。');},{freeze:true});
  $('browserList').onclick=e=>{const b=e.target.closest('button');if(!b)return;action(b,async()=>{
    if(b.dataset.browserEdit){editBrowser(chromeBrowsers().find(v=>v.key===b.dataset.browserEdit));reveal('browserEditor');rememberConnections();$('notice').hidden=true;}
    if(b.dataset.browserReuse){
      const saved=chromeBrowsers().find(v=>v.key===b.dataset.browserReuse);if(!saved)return;
      editBrowser(saved);$('chromeConnectionMode').value='existing';chromeInspection=null;updateChromeControls();
      chromeStatus('已选择复用当前 Chrome。点击“保存并应用”，关联账号的登录与采集将一起切换；随后按上方说明开启 Chrome 连接。');
      reveal('browserEditor');rememberConnections();$('notice').hidden=true;
    }
    if(b.dataset.browserCheck){const result=await api('/api/temu/erp/connection',{browserKey:b.dataset.browserCheck});notice(result.connected?'Chrome 已连接；账号登录请在下方检查。':'尚未连接 Chrome，请检查该连接方式的授权或窗口状态。',!result.connected);}
    if(b.dataset.browserRemove){if(!confirm('删除这个浏览器配置？关联的 ERP 账号需先改用其他浏览器。')){$('notice').hidden=true;return;}await saveSettings({browsers:settings.browsers.filter(v=>v.key!==b.dataset.browserRemove)});editBrowser();rememberConnections();}
  });};
  function forgetBrowserChecks(erp){for(const other of settings.erpConnections)if(other.browserKey===erp.browserKey)connectionChecks.delete(other.key);}
  async function openErp(key){
    const erp=settings.erpConnections.find(e=>e.key===key),reuse=existingChrome(settings.browsers.find(b=>b.key===erp.browserKey));forgetBrowserChecks(erp);
    try{
      const result=await api('/api/temu/erp/open-login',{erpKey:key});
      connectionChecks.set(key,{signature:connectionSignature(erp),verified:false,message:reuse?'已在当前 Chrome 打开工作窗口，可复用已有登录；请点击“检查登录”核对账号。':'登录窗口已打开，请完成登录后点击“检查登录”。'});
      renderSettings();notice(result.message+(reuse?'。可复用已有登录，返回这里点击“检查登录”核对账号。':'。完成登录后，返回这里点击“检查登录”。'));
    }catch(error){
      connectionChecks.set(key,{signature:connectionSignature(erp),verified:false,error:true,message:'登录窗口未打开，请重试“打开登录”或检查浏览器设置。'});
      renderSettings();throw new Error('账号配置已保存，登录窗口未打开：'+error.message);
    }
  }
  async function checkErp(key){
    const erp=settings.erpConnections.find(e=>e.key===key),signature=connectionSignature(erp),provider=erpProvider(erp);
    forgetBrowserChecks(erp);
    try{
      const result=await api('/api/temu/erp/connection',{erpKey:key});
      if(signature!==connectionSignature(settings.erpConnections.find(e=>e.key===key)))return;
      const verified=result.loginVerificationSupported!==false&&result.loggedIn===true&&!!erp.expectedAccount&&result.account===erp.expectedAccount&&result.accountMatched===true;
      const message=result.loginVerificationSupported===false?(result.message||'当前 ERP 仅支持连接检查，登录尚未核实。')
        :verified?'本次登录已核实：'+result.account
        :result.loggedIn&&!erp.expectedAccount?'已登录，请编辑连接补充账号显示名后再检查。'
        :result.accountMatched===false||result.loggedIn&&result.account&&result.account!==erp.expectedAccount?'当前登录账号与配置不一致，请在专用窗口切换账号后重新检查。'
        :result.loggedIn?'账号身份尚未核实，请重新检查。'
        :result.erpOpen?'请在专用窗口完成登录，再点击“检查登录”。':'请先点击“打开'+provider.name+'登录”。';
      connectionChecks.set(key,{signature,verified,error:!verified,message});renderSettings();notice(message,!verified);
    }catch(error){connectionChecks.set(key,{signature,verified:false,error:true,message:'检查未完成：'+error.message});renderSettings();throw error;}
  }
  $('erpForm').elements.provider.onchange=()=>{erpFields();rememberConnections();};
  $('resetErp').onclick=()=>{if($('erpEditor').open&&($('erpForm').elements.expectedAccount.value||$('erpForm').elements.name.value)&&!confirm('开始新增另一个账号？当前未保存的账号输入将被清空。'))return;editErp();};
  $('cancelErp').onclick=()=>{$('erpEditor').open=false;rememberConnections();};
  $('erpForm').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{
    const value=formValue(e.target),isNew=!value.key;value.expectedAccount=value.expectedAccount.trim();
    if(!value.browserKey){$('erpAdvanced').open=true;throw new Error('请先保存 Chrome 连接，再选择这个账号使用的浏览器。');}
    if(value.provider==='dianxiaomi'&&!value.expectedAccount)throw new Error('请填写店小秘页面右上角显示的账号名称。');
    value.key||=uid();value.name=value.name.trim()||value.expectedAccount||erpProvider(value).name+'账号';
    await saveSettings({erpConnections:[...settings.erpConnections.filter(v=>v.key!==value.key),value]});
    editErp(settings.erpConnections.find(v=>v.key===value.key),{open:false});rememberConnections();
    if(isNew)await openErp(value.key);else notice('账号修改已保存，请重新检查登录。');
  });};
  $('erpList').onclick=e=>{const b=e.target.closest('button');if(!b)return;action(b,async()=>{
    if(b.dataset.erpEdit){editErp(settings.erpConnections.find(v=>v.key===b.dataset.erpEdit));$('notice').hidden=true;}
    if(b.dataset.erpOpen)await openErp(b.dataset.erpOpen);
    if(b.dataset.erpCheck)await checkErp(b.dataset.erpCheck);
    if(b.dataset.erpRemove){if(!confirm('删除这个 ERP 连接？关联店铺需先调整到其他连接，历史任务保留。')){$('notice').hidden=true;return;}await saveSettings({erpConnections:settings.erpConnections.filter(v=>v.key!==b.dataset.erpRemove)});if($('erpForm').elements.key.value===b.dataset.erpRemove)editErp(undefined,{open:false});}
  });};
  for(const id of ['browserForm','erpForm'])$(id).addEventListener('input',rememberConnections);
  for(const id of ['browserEditor','erpEditor','erpAdvanced'])$(id).addEventListener('toggle',()=>{if(settings)rememberConnections();});
  function renderStoreErps(){const amazon=$('storeForm').elements.platform.value==='amazon';replaceOptions($('storeForm').elements.erpKey,settings.erpConnections.map(e=>`<option value="${escape(e.key)}" ${amazon||erpProvider(e)?.listingPlatforms.includes('temu')?'':'disabled'}>${escape(e.name)} · ${escape(erpProvider(e)?.name)}</option>`).join(''));}
  $('storeForm').elements.platform.addEventListener('change',()=>{renderStoreErps();updateStoreEditor();rememberEditor();});
  const storeContext=()=>{const f=formValue($('storeForm'));return {platform:f.platform,expectedStore:f.expectedStore?.trim(),expectedSite:f.expectedSite?.trim(),erpKey:f.erpKey};};
  function updateStoreEditor(){
    const editing=!!$('storeForm').elements.key.value,amazon=$('storeForm').elements.platform.value==='amazon',mothers=amazon||storeStep==='mothers';
    $('storeEditorTitle').textContent=editing?'编辑店铺 · '+($('storeForm').elements.expectedStore.value.trim()||'未命名店铺'):'新增店铺';
    $('storeEditorHelp').textContent=editing?'下方信息和母稿属于正在编辑的这家店铺。':'先填写新店铺信息，再添加该店铺的母稿。';
    $('storeForm').elements.expectedStore.placeholder=editing?'填写店小秘中的店铺名称':'填写要新增的店铺名称';
    $('continueStore').hidden=mothers;$('storeMothers').hidden=!mothers;
    for(const element of [$('templateInputs'),$('addTemplate'),$('storeMothers').querySelector('.note'),$('storeMothersTitle')])element.hidden=amazon;
    if(amazon)$('storeEditorHelp').textContent='Amazon 可保存店铺绑定并制作内容，自动发布尚未接入。';
    $('saveStore').textContent=amazon?'保存店铺绑定':editing?'校验并保存修改':'校验并保存店铺';
    $('storeSaveHint').textContent=amazon?'Amazon 店铺仅保存绑定，自动发布尚未接入。':'保存时会核对账号、店铺、站点和商品母稿；通过后，上架页会自动更新。';
  }
  function focusStoreDetails(){
    $('storeEditor').hidden=false;
    $('storeForm').scrollIntoView({block:'start',behavior:'instant'});
    focusField($('storeForm').elements.expectedStore);
  }
  function continueStore(){
    if($('storeForm').inert)return;
    for(const name of ['expectedStore','expectedSite','erpKey']){
      const field=$('storeForm').elements[name];
      if(!field.value.trim()){
        notice(name==='erpKey'?'请先保存店小秘 ERP 连接，再选择新店铺使用的账号。':name==='expectedStore'?'请填写要新增的店铺名称。':'请填写新店铺的经营站点，灰色示例不算已填写。',true);
        field.focus();field.reportValidity();return;
      }
    }
    storeStep='mothers';updateStoreEditor();$('notice').hidden=true;rememberEditor();
    $('storeMothers').scrollIntoView({block:'start',behavior:'instant'});
    $('templateInputs').querySelector('[data-field="draftId"]')?.focus({preventScroll:true});
  }
  $('continueStore').onclick=continueStore;
  $('storeForm').addEventListener('input',()=>{$('storeSaveStatus').hidden=true;});
  const contextKey=()=>JSON.stringify([storeContext(),settings.revision]);
  function draftIdFromInput(value,index=0){
    let id=String(value||'').trim();
    if(id.includes('://')){try{const u=new URL(id),ids=u.searchParams.getAll('id');id=u.protocol==='https:'&&['www.dianxiaomi.com','dianxiaomi.com'].includes(u.hostname)&&u.pathname==='/web/popTemu/edit'&&!u.username&&!u.password&&ids.length===1?ids[0]:'';}catch{id='';}}
    if(!/^\d{6,30}$/.test(id))throw new Error(`第 ${index+1} 个母稿：请粘贴店小秘完整的商品编辑链接，或 6—30 位数字 ID。`);
    return id;
  }
  const sourceId=t=>{try{return draftIdFromInput(t.draftId);}catch{return t.draftId;}};
  const checkKey=t=>JSON.stringify([contextKey(),sourceId(t)]);
  function savedTemplate(t){
    const f=storeContext(),shop=settings.stores.find(s=>s.key===$('storeForm').elements.key.value);
    if(!shop||shop.erpKey!==f.erpKey||shop.expectedStore!==f.expectedStore||shop.expectedSite!==f.expectedSite)return null;
    return shop.templates.find(old=>old.key===t.key&&old.draftId===sourceId(t)&&old.sourceMode==='product'&&old.verifiedAt);
  }
  function templateState(t){
    const result=templateChecks.get(checkKey(t)),saved=savedTemplate(t),proof=result?.valid?result:saved;
    if(result&&!result.valid)return {label:'需要处理',tone:'error',detail:result.issues.join('；')};
    if(proof)return {label:saved?'已校验':'已校验 · 待保存',tone:'success',detail:`${proof.actualStore||storeContext().expectedStore} · ${proof.actualSite||storeContext().expectedSite} · ${proof.category||'类目已核对'} · 运费：${proof.shippingTemplate||'已填写'}${proof.sourceTitle?' · 商品：'+proof.sourceTitle:''}${saved?'':'。点击“保存店铺”后生效。'}`};
    return {label:'待校验',tone:'',detail:'直接读取链接对应的商品。开始裂变前会重新检查店铺、站点、规格、库存和运费。'};
  }
  function paintTemplateStatus(){
    updateStoreEditor();
    for(const row of $('templateInputs').querySelectorAll('[data-template]')){
      const t=templates[Number(row.dataset.template)],state=templateState(t),status=row.querySelector('[data-template-status]'),badge=row.querySelector('[data-binding-state]');
      status.className='template-status '+state.tone;status.textContent=state.detail;badge.className='binding-badge '+state.tone;badge.textContent=state.label;
      row.querySelector('[data-mother-name]').textContent=t.name.trim()||'新母稿';row.querySelector('[data-source-summary]').textContent=sourceId(t)?'母稿 ID：'+sourceId(t):'尚未填写母稿链接';
    }
  }
  function paintTemplates(){
    $('templateInputs').innerHTML=templates.map((t,i)=>{const open=templateSteps.get(t.key)==='source';return `<section class="template-row" data-template="${i}" data-template-key="${escape(t.key)}"><div class="mother-heading"><div class="mother-title"><strong data-mother-name></strong><span data-binding-state></span></div><div class="template-actions"><button type="button" data-edit-template="${i}" aria-expanded="${open}" aria-controls="mother-editor-${escape(t.key)}" ${open?'hidden':''}>查看 / 修改母稿</button><button type="button" data-close-template="${i}" ${open?'':'hidden'}>收起</button><button type="button" data-remove-template="${i}">移除</button></div></div><p class="mother-source" data-source-summary></p><p class="template-status" data-template-status role="status"></p><div id="mother-editor-${escape(t.key)}" class="mother-editor" ${open?'':'hidden'}><div data-source-step><div class="fields mother-fields"><label>母稿链接<input data-field="draftId" value="${escape(t.draftId)}" placeholder="粘贴店小秘商品的编辑链接或 ID"></label><label>母稿名称（选填）<input data-field="name" value="${escape(t.name)}" placeholder="例如：蜡烛装饰画" maxlength="240"></label></div><p class="muted">粘贴该店铺的商品链接后，可直接点击下方“校验并保存店铺”。读取母稿可提前查看校验结果。</p></div><div class="template-actions"><button type="button" class="primary" data-check-template="${i}">读取并校验母稿</button><button type="button" data-open-template="${i}">打开店小秘母稿</button></div></div></section>`;}).join('');paintTemplateStatus();
  }
  function collectTemplates(){
    templates=Array.from($('templateInputs').querySelectorAll('[data-template]'),row=>({...templates[Number(row.dataset.template)],name:row.querySelector('[data-field="name"]').value,draftId:row.querySelector('[data-field="draftId"]').value}));
  }
  const storeEditorValue=()=>JSON.stringify({fields:formValue($('storeForm')),templates:templates.map(t=>({key:t.key,name:t.name,draftId:t.draftId}))});
  function rememberEditor(){collectTemplates();$('resumeStore').hidden=!$('storeEditor').hidden||storeEditorValue()===storeBaseline;try{localStorage.setItem(editorStorage,JSON.stringify({revision:settings.revision,fields:formValue($('storeForm')),templates,steps:Object.fromEntries(templateSteps),storeStep,open:!$('storeEditor').hidden,baseline:storeBaseline,scrollY:window.scrollY}));}catch{}}
  function restoreEditor(){
    try{const saved=JSON.parse(localStorage.getItem(editorStorage)||sessionStorage.getItem(editorStorage)||'null');if(!saved||saved.revision!==settings.revision||!Array.isArray(saved.templates)||saved.templates.some(t=>typeof t.key!=='string'))return false;
      for(const el of $('storeForm').elements)if(el.name&&Object.hasOwn(saved.fields,el.name))el.value=saved.fields[el.name];templates=saved.templates;
      storeStep=saved.storeStep==='mothers'||!saved.storeStep&&saved.fields.expectedStore?.trim()&&saved.fields.expectedSite?.trim()&&templates.some(t=>t.name||t.draftId)?'mothers':'details';
      for(const t of templates)if(['source','template'].includes(saved.steps?.[t.key]))templateSteps.set(t.key,'source');
      $('storeEditor').hidden=saved.open===false||saved.open===undefined&&!saved.fields.expectedStore&&!templates.some(t=>t.name||t.draftId);
      paintTemplates();storeBaseline=saved.baseline||storeEditorValue();
      $('resumeStore').hidden=!$('storeEditor').hidden||storeEditorValue()===storeBaseline;
      if(!$('storeEditor').hidden)requestAnimationFrame(()=>window.scrollTo(0,saved.scrollY||0));return true;
    }catch{return false;}
  }
  window.addEventListener('beforeunload',()=>{if(settings){rememberEditor();rememberConnections();}});
  async function storeAction(button,fn){await action(button,async()=>{$('storeForm').inert=true;try{await fn();}finally{$('storeForm').inert=false;rememberEditor();}});}
  function showTemplateStep(t,step){templateSteps.set(t.key,step);paintTemplates();rememberEditor();}
  $('templateInputs').oninput=()=>{rememberEditor();paintTemplateStatus();};
  $('templateInputs').onchange=()=>{rememberEditor();paintTemplateStatus();};
  $('templateInputs').onclick=e=>{const b=e.target.closest('button');if(!b)return;collectTemplates();
    if(b.dataset.removeTemplate!==undefined){templates.splice(Number(b.dataset.removeTemplate),1);paintTemplates();rememberEditor();return;}
    if(b.dataset.editTemplate!==undefined||b.dataset.closeTemplate!==undefined){const i=Number(b.dataset.editTemplate??b.dataset.closeTemplate);showTemplateStep(templates[i],b.dataset.closeTemplate!==undefined?'closed':'source');return;}
    storeAction(b,async()=>{const index=Number(b.dataset.checkTemplate??b.dataset.openTemplate),t=templates[index];
      const payload={...storeContext(),draftId:draftIdFromInput(t.draftId,index)};
      if(b.dataset.openTemplate!==undefined){const result=await api('/api/temu/erp/open-mother',payload);notice(result.message);return;}
      notice('正在按链接读取母稿，并检查新品副本能否正确继承资料…');
      const requestKey=checkKey(t),result=await api('/api/temu/erp/mother-check',payload);collectTemplates();const current=templates.find(x=>x.key===t.key);
      if(!current||checkKey(current)!==requestKey){paintTemplateStatus();notice('母稿或店铺输入已变化，请重新读取当前链接。');return;}
      templateChecks.set(requestKey,result);
      if(result.valid){if(!current.name.trim())current.name=result.sourceTitle||'母稿 '+result.draftId;templateSteps.set(current.key,'closed');}
      paintTemplates();notice(result.valid?'已按链接校验这份母稿。点击“保存店铺”后生效。':result.issues.join('；'),!result.valid);
    });
  };
  function clearCatalog(){templateChecks.clear();}
  $('storeForm').addEventListener('input',e=>{if(['expectedStore','expectedSite','erpKey','platform'].includes(e.target.name)){collectTemplates();clearCatalog();paintTemplates();rememberEditor();}});
  $('addTemplate').onclick=()=>{collectTemplates();const t={key:uid(),name:'',draftId:''};templates.push(t);showTemplateStep(t,'source');$('templateInputs').lastElementChild.scrollIntoView({block:'nearest'});};
  function resetStore(){
    $('storeForm').reset();$('storeForm').elements.key.value='';storeStep='details';
    const accounts=settings.erpConnections.filter(e=>erpProvider(e)?.listingPlatforms.includes('temu'));
    $('storeForm').elements.erpKey.value=accounts.length===1?accounts[0].key:'';
    templates=[{key:uid(),name:'',draftId:''}];templateSteps.clear();templateSteps.set(templates[0].key,'source');clearCatalog();paintTemplates();
    $('notice').hidden=true;$('storeSaveStatus').hidden=true;storeBaseline=storeEditorValue();
    try{localStorage.removeItem(editorStorage);sessionStorage.removeItem(editorStorage);}catch{}
  }
  function canReplaceStoreEditor(){collectTemplates();return storeEditorValue()===storeBaseline||confirm('切换店铺会清空当前未保存的修改，是否继续？');}
  $('resetStore').onclick=()=>{if($('storeForm').inert||!canReplaceStoreEditor())return;resetStore();focusStoreDetails();rememberEditor();};
  $('cancelStore').onclick=()=>{$('storeEditor').hidden=true;rememberEditor();};
  $('resumeStore').onclick=()=>{focusStoreDetails();rememberEditor();};
  $('backStore').onclick=()=>{collectTemplates();storeStep='details';updateStoreEditor();focusStoreDetails();rememberEditor();};
  function editStore(value){$('storeEditor').hidden=false;$('storeSaveStatus').hidden=true;for(const el of $('storeForm').elements)if(el.name)el.value=value[el.name]??'';templates=structuredClone(value.templates);storeStep='mothers';templateSteps.clear();clearCatalog();paintTemplates();storeBaseline=storeEditorValue();rememberEditor();}
  $('storeForm').onsubmit=e=>{e.preventDefault();if(!$('continueStore').hidden){continueStore();return;}storeAction(e.submitter||$('saveStore'),async()=>{
    const status=$('storeSaveStatus');status.hidden=false;status.className='muted';status.textContent='正在校验并保存店铺，请稍候…';notice(status.textContent);
    try{collectTemplates();
    const amazon=e.target.elements.platform.value==='amazon';
    if(!amazon)for(const [i,t] of templates.entries())try{const id=draftIdFromInput(t.draftId,i);if(!t.name.trim())t.name='母稿 '+id;}catch(error){showTemplateStep(t,'source');throw error;}
    const value={...formValue(e.target),platform:e.target.elements.platform.value,templates:amazon?[]:templates.map((t,i)=>({...t,draftId:draftIdFromInput(t.draftId,i)}))};value.key||=uid();
    const verifyMothers=(amazon?[]:templates).filter(t=>templateChecks.get(checkKey(t))?.valid).map(t=>value.key+':'+t.key);
    await saveSettings({stores:[...settings.stores.filter(s=>s.key!==value.key),value],verifyMothers});editStore(settings.stores.find(s=>s.key===value.key));status.hidden=false;status.textContent=amazon?`“${value.expectedStore}”店铺绑定已保存；自动发布尚未接入。`:`“${value.expectedStore}”已校验并保存，可前往店铺上架。`;notice(status.textContent);$('storeEditor').hidden=true;rememberEditor();}
    catch(error){status.className='error';status.textContent='店铺尚未保存：'+error.message;throw error;}
  });};
  $('storeList').onclick=e=>{const b=e.target.closest('button');if(!b||$('storeForm').inert)return;action(b,async()=>{if(b.dataset.storeEdit){if(!canReplaceStoreEditor()){$('notice').hidden=true;return;}editStore(settings.stores.find(s=>s.key===b.dataset.storeEdit));$('notice').hidden=true;focusStoreDetails();}if(b.dataset.storeRemove){if(!confirm('删除店铺配置？历史任务记录仍保留。')){$('notice').hidden=true;return;}await saveSettings({stores:settings.stores.filter(s=>s.key!==b.dataset.storeRemove)});if($('storeForm').elements.key.value===b.dataset.storeRemove){resetStore();$('storeEditor').hidden=true;}}});};
  (async()=>{try{
    token=(await api('/api/session')).token;settings=await api('/api/settings');renderSettings();
    try{const saved=JSON.parse(localStorage.getItem(collectionEditorStorage)||'null');if(collectionFeaturesReady()&&saved?.revision===settings.revision){for(const field of $('collectionStoreForm').elements)if(field.name&&Object.hasOwn(saved.fields||{},field.name))field.value=saved.fields[field.name];$('collectionStoreForm').hidden=!saved.open;collectionSiteHint();}}catch{}
    if(new URLSearchParams(location.search).get('newStore')==='1'){resetStore();focusStoreDetails();rememberEditor();history.replaceState(null,'','/settings#storeSettings');}
    else if(!restoreEditor())resetStore();
    editBrowser();editErp(undefined,{open:false,persist:false});restoreConnections();renderChromeChoices();
  }catch(e){notice(e.message,true);}})();
})();
