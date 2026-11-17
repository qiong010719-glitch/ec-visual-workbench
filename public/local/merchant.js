(() => {
  const $=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let token,settings,templates=[],storeStep='details';
  const editorStorage='merchant-store-editor-v1';
  const templateChecks=new Map();
  const templateSteps=new Map();
  const api=async(route,p)=>{const response=await fetch(route,p===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(p)});const value=await response.json();if(!response.ok)throw new Error(value.error||'请求失败');return value;};
  function notice(message,error=false){$('notice').hidden=false;$('notice').className=error?'error':'';$('notice').textContent=message;}
  async function action(button,fn){button.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{button.disabled=false;}}
  const formValue=form=>Object.fromEntries(new FormData(form));
  const uid=()=>crypto.randomUUID();
  const erpProvider=e=>(settings.erpProviders||[{id:'dianxiaomi',name:'店小秘',loginUrl:'https://www.dianxiaomi.com/',listingPlatforms:['temu'],status:'已接入 Temu 半托管'}]).find(p=>p.id===(e?.provider||'dianxiaomi'));
  function erpFields(){const provider=erpProvider(formValue($('erpForm')));$('erpLoginUrl').value=provider?.loginUrl||'';$('erpProviderHint').textContent=settings.erpProviders?provider?.status||'':'新增妙手连接需在当前任务结束后重启工作台。已有店小秘连接仍可使用。';}
  async function saveSettings(p){settings=await api('/api/settings',{revision:settings.revision,...p});renderSettings();try{localStorage.setItem('workbench-settings-changed',JSON.stringify({revision:settings.revision,at:Date.now()}));}catch{}notice('配置已保存在本机。');}
  function renderSettings(){
    $('erpForm').elements.provider.querySelector('[value="miaoshou"]').disabled=!settings.erpProviders?.some(p=>p.id==='miaoshou');
    for(const field of $('modelForm').elements)if(field.name&&field.type!=='password')field.value=settings.models[field.name]||'';
    $('modelStatus').textContent=`图片密钥：${settings.models.SUANZHOU_IMAGE_API_KEYConfigured?'已配置':'未配置'}；文本密钥：${settings.models.PLANNER_API_KEYConfigured?'已配置':'未配置'}`;
    $('browserList').innerHTML=settings.browsers.map(b=>`<div class="config-row"><div><strong>${escape(b.name)}</strong><small>${b.type==='chrome'?'Chrome 专用窗口':'比特窗口 '+escape(b.browserSequence)} · ${escape(b.localApi)}</small></div><div><button data-browser-edit="${b.key}">编辑</button><button data-browser-check="${b.key}">检查连接</button><button data-browser-remove="${b.key}">删除</button></div></div>`).join('')||'<p class="muted">先添加一个比特或 Chrome 浏览器环境。</p>';
    $('storeList').innerHTML=settings.stores.map(s=>`<div class="config-row"><div><strong>${escape(s.expectedStore)} · ${escape(s.expectedSite)}</strong><small>${s.templates.length} 个商品母稿</small></div><div><button data-store-edit="${s.key}">编辑</button><button data-store-remove="${s.key}">删除</button></div></div>`).join('')||'<p class="muted">先添加浏览器，再添加店铺与母稿。</p>';
    const prior=$('erpForm').elements.browserKey.value;$('erpForm').elements.browserKey.innerHTML=settings.browsers.map(b=>`<option value="${b.key}">${escape(b.name)}</option>`).join('');if(settings.browsers.some(b=>b.key===prior))$('erpForm').elements.browserKey.value=prior;
    const current=$('storeForm').elements.erpKey.value;$('storeForm').elements.erpKey.innerHTML=settings.erpConnections.map(e=>`<option value="${e.key}" ${erpProvider(e).listingPlatforms.includes('temu')?'':'disabled'}>${escape(e.name)} · ${escape(erpProvider(e).name)}${erpProvider(e).listingPlatforms.includes('temu')?'':'（自动上架待联调）'}</option>`).join('');if(settings.erpConnections.some(e=>e.key===current&&erpProvider(e).listingPlatforms.includes('temu')))$('storeForm').elements.erpKey.value=current;
    $('erpList').innerHTML=settings.erpConnections.map(e=>{const p=erpProvider(e);return `<div class="config-row"><div><strong>${escape(e.name)}</strong><small>${escape(p.name)} · ${escape(settings.browsers.find(b=>b.key===e.browserKey)?.name)}${e.expectedAccount?' · 配置账号 '+escape(e.expectedAccount):''}</small><small>${escape(p.status)}</small></div><div><button data-erp-edit="${e.key}">编辑</button><button data-erp-open="${e.key}">打开${escape(p.name)}登录</button><button data-erp-check="${e.key}">${p.id==='miaoshou'?'检查连接':'检查登录'}</button><button data-erp-remove="${e.key}">删除</button></div></div>`;}).join('')||'<p class="muted">添加浏览器后，在这里建立 ERP 账号连接。</p>';
    erpFields();
  }
  $('modelForm').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{await saveSettings({models:formValue(e.target)});for(const el of e.target.querySelectorAll('input[type=password]'))el.value='';});};
  function browserFields(){const chrome=$('browserForm').elements.type.value==='chrome';for(const el of $('browserForm').querySelectorAll('[data-bit],[data-chrome]')){const visible=el.hasAttribute('data-chrome')===chrome;el.hidden=!visible;el.querySelector('input').disabled=!visible;}}
  $('browserForm').elements.type.onchange=browserFields;
  $('browserForm').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const value=formValue(e.target);value.key||=uid();value.browserSequence=Number(value.browserSequence);const list=settings.browsers.filter(b=>b.key!==value.key);list.push(value);await saveSettings({browsers:list});$('resetBrowser').click();});};
  $('resetBrowser').onclick=()=>{$('browserForm').reset();$('browserForm').elements.key.value='';browserFields();};
  $('browserList').onclick=e=>{const b=e.target.closest('button');if(!b)return;action(b,async()=>{
    if(b.dataset.browserEdit){const value=settings.browsers.find(v=>v.key===b.dataset.browserEdit);for(const el of $('browserForm').elements)if(el.name)el.value=value[el.name]??(el.name==='type'?'bit':el.name==='debugPort'?'9222':'');browserFields();}
    if(b.dataset.browserCheck){await api('/api/temu/erp/connection',{browserKey:b.dataset.browserCheck});notice('浏览器已连接，请在 ERP 连接中打开或检查对应的登录页面。');}
    if(b.dataset.browserRemove){if(!confirm('删除这个浏览器配置？关联店铺需先改用其他连接。'))return;await saveSettings({browsers:settings.browsers.filter(v=>v.key!==b.dataset.browserRemove)});}
  });};
  $('erpForm').elements.provider.onchange=erpFields;
  $('resetErp').onclick=()=>{$('erpForm').reset();$('erpForm').elements.key.value='';erpFields();};
  $('erpForm').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const value=formValue(e.target);value.key||=uid();await saveSettings({erpConnections:[...settings.erpConnections.filter(v=>v.key!==value.key),value]});$('resetErp').click();});};
  $('erpList').onclick=e=>{const b=e.target.closest('button');if(!b)return;action(b,async()=>{
    if(b.dataset.erpEdit){const v=settings.erpConnections.find(v=>v.key===b.dataset.erpEdit);for(const el of $('erpForm').elements)if(el.name)el.value=v[el.name]||(el.name==='provider'?'dianxiaomi':'');erpFields();}
    if(b.dataset.erpOpen){const r=await api('/api/temu/erp/open-login',{erpKey:b.dataset.erpOpen});notice(r.message);}
    if(b.dataset.erpCheck){const p=erpProvider(settings.erpConnections.find(e=>e.key===b.dataset.erpCheck)),r=await api('/api/temu/erp/connection',{erpKey:b.dataset.erpCheck});notice(r.loginVerificationSupported===false?r.message:r.loggedIn?(r.accountMatched===false?'已登录，但账号与配置不一致。':p.name+'登录有效'+(r.account?'：'+r.account:'')):r.erpOpen?p.name+'页面已打开，请完成登录或重新检查。':'请先打开'+p.name+'登录。',r.accountMatched===false);}
    if(b.dataset.erpRemove)await saveSettings({erpConnections:settings.erpConnections.filter(v=>v.key!==b.dataset.erpRemove)});
  });};
  const storeContext=()=>{const f=formValue($('storeForm'));return {platform:'temu',expectedStore:f.expectedStore?.trim(),expectedSite:f.expectedSite?.trim(),erpKey:f.erpKey};};
  function updateStoreEditor(){
    const editing=!!$('storeForm').elements.key.value,mothers=editing||storeStep==='mothers';
    $('storeEditorTitle').textContent=editing?'编辑店铺 · '+($('storeForm').elements.expectedStore.value.trim()||'未命名店铺'):'新增店铺';
    $('storeEditorHelp').textContent=editing?'下方信息和母稿属于正在编辑的这家店铺。':'先填写新店铺信息，再添加该店铺的母稿。';
    $('storeForm').elements.expectedStore.placeholder=editing?'填写店小秘中的店铺名称':'填写要新增的店铺名称';
    $('continueStore').hidden=mothers;$('storeMothers').hidden=!mothers;
    $('saveStore').textContent=editing?'保存店铺修改':'保存新店铺';
    $('storeSaveHint').textContent=editing?'修改后请保存，上架页会自动更新店铺和母稿列表。':'填写和校验后，还需点击“保存新店铺”；保存成功后，上架页才会出现这家店铺。';
  }
  function focusStoreDetails(){
    $('storeForm').scrollIntoView({block:'start',behavior:'instant'});
    $('storeForm').elements.expectedStore.focus({preventScroll:true});
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
    $('templateInputs').querySelector('[data-field="name"]')?.focus({preventScroll:true});
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
    $('templateInputs').innerHTML=templates.map((t,i)=>{const open=templateSteps.get(t.key)==='source';return `<section class="template-row" data-template="${i}" data-template-key="${escape(t.key)}"><div class="mother-heading"><div class="mother-title"><strong data-mother-name></strong><span data-binding-state></span></div><div class="template-actions"><button type="button" data-edit-template="${i}" aria-expanded="${open}" aria-controls="mother-editor-${escape(t.key)}" ${open?'hidden':''}>查看 / 修改母稿</button><button type="button" data-close-template="${i}" ${open?'':'hidden'}>收起</button><button type="button" data-remove-template="${i}">移除</button></div></div><p class="mother-source" data-source-summary></p><p class="template-status" data-template-status role="status"></p><div id="mother-editor-${escape(t.key)}" class="mother-editor" ${open?'':'hidden'}><div data-source-step><div class="fields mother-fields"><label>母稿名称<input data-field="name" value="${escape(t.name)}" placeholder="例如：蜡烛装饰画" maxlength="240"></label><label>母稿链接<input data-field="draftId" value="${escape(t.draftId)}" placeholder="粘贴店小秘商品的编辑链接或 ID"></label></div><p class="muted">使用这条链接对应的完整商品作为母稿；修改商品后在店小秘保存即可。</p></div><div class="template-actions"><button type="button" class="primary" data-check-template="${i}">读取并校验母稿</button><button type="button" data-open-template="${i}">打开店小秘母稿</button></div></div></section>`;}).join('');paintTemplateStatus();
  }
  function collectTemplates(){
    templates=Array.from($('templateInputs').querySelectorAll('[data-template]'),row=>({...templates[Number(row.dataset.template)],name:row.querySelector('[data-field="name"]').value,draftId:row.querySelector('[data-field="draftId"]').value}));
  }
  function rememberEditor(){collectTemplates();try{localStorage.setItem(editorStorage,JSON.stringify({revision:settings.revision,fields:formValue($('storeForm')),templates,steps:Object.fromEntries(templateSteps),storeStep,scrollY:window.scrollY}));}catch{}}
  function restoreEditor(){
    try{const saved=JSON.parse(localStorage.getItem(editorStorage)||sessionStorage.getItem(editorStorage)||'null');if(!saved||saved.revision!==settings.revision||!Array.isArray(saved.templates)||saved.templates.some(t=>typeof t.key!=='string'))return false;
      for(const el of $('storeForm').elements)if(el.name&&Object.hasOwn(saved.fields,el.name))el.value=saved.fields[el.name];templates=saved.templates;
      storeStep=saved.storeStep==='mothers'||!saved.storeStep&&saved.fields.expectedStore?.trim()&&saved.fields.expectedSite?.trim()&&templates.some(t=>t.name||t.draftId)?'mothers':'details';
      for(const t of templates)if(['source','template'].includes(saved.steps?.[t.key]))templateSteps.set(t.key,'source');paintTemplates();requestAnimationFrame(()=>window.scrollTo(0,saved.scrollY||0));return true;
    }catch{return false;}
  }
  window.addEventListener('beforeunload',()=>{if(settings)rememberEditor();});
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
  function resetStore(){$('storeForm').reset();$('storeForm').elements.key.value='';storeStep='details';templates=[{key:uid(),name:'',draftId:''}];templateSteps.clear();templateSteps.set(templates[0].key,'source');clearCatalog();paintTemplates();$('notice').hidden=true;$('storeSaveStatus').hidden=true;try{localStorage.removeItem(editorStorage);sessionStorage.removeItem(editorStorage);}catch{}}
  $('resetStore').onclick=()=>{if($('storeForm').inert)return;resetStore();rememberEditor();focusStoreDetails();};
  function editStore(value){$('storeSaveStatus').hidden=true;for(const el of $('storeForm').elements)if(el.name)el.value=value[el.name]??'';templates=structuredClone(value.templates);storeStep='mothers';templateSteps.clear();clearCatalog();paintTemplates();rememberEditor();}
  $('storeForm').onsubmit=e=>{e.preventDefault();if(!$('continueStore').hidden){continueStore();return;}storeAction(e.submitter||$('saveStore'),async()=>{
    const status=$('storeSaveStatus');status.hidden=false;status.className='muted';status.textContent='正在校验并保存店铺，请稍候…';notice(status.textContent);
    try{collectTemplates();
    for(const [i,t] of templates.entries())try{draftIdFromInput(t.draftId,i);if(!t.name.trim())throw new Error(`第 ${i+1} 个母稿：请填写名称，或先读取母稿自动命名。`);}catch(error){showTemplateStep(t,'source');throw error;}
    const value={...formValue(e.target),platform:'temu',templates:templates.map((t,i)=>({...t,draftId:draftIdFromInput(t.draftId,i)}))};value.key||=uid();
    const verifyMothers=templates.filter(t=>templateChecks.get(checkKey(t))?.valid).map(t=>value.key+':'+t.key);
    await saveSettings({stores:[...settings.stores.filter(s=>s.key!==value.key),value],verifyMothers});editStore(settings.stores.find(s=>s.key===value.key));status.hidden=false;status.textContent=`“${value.expectedStore}”已保存，上架页的店铺和母稿列表会自动更新。`;notice(status.textContent);}
    catch(error){status.className='error';status.textContent='店铺尚未保存：'+error.message;throw error;}
  });};
  $('storeList').onclick=e=>{const b=e.target.closest('button');if(!b||$('storeForm').inert)return;action(b,async()=>{if(b.dataset.storeEdit){editStore(settings.stores.find(s=>s.key===b.dataset.storeEdit));$('notice').hidden=true;focusStoreDetails();}if(b.dataset.storeRemove){if(!confirm('删除店铺配置？历史任务记录仍保留。'))return;await saveSettings({stores:settings.stores.filter(s=>s.key!==b.dataset.storeRemove)});if($('storeForm').elements.key.value===b.dataset.storeRemove)resetStore();}});};
  (async()=>{try{token=(await api('/api/session')).token;settings=await api('/api/settings');renderSettings();if(new URLSearchParams(location.search).get('newStore')==='1'){resetStore();rememberEditor();focusStoreDetails();history.replaceState(null,'','/settings#storeSettings');}else if(!restoreEditor())resetStore();browserFields();}catch(e){notice(e.message,true);}})();
})();
