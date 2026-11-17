(() => {
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const temu=window.TemuWorkbench;
  const standaloneTemu=temu&&!temu.sharedUi;
  const selectedKey=temu?'temu_multisets_selected':'ec_multisets_selected';
  let config,selected=null,group=null,timer,creatingId=null,creatingFingerprint=null,actionBusy=false,copiedSource=null,copiedModel=null,copiedSlots=null;
  const retryRequests=new Map();
  const planDrafts=new Map();
  function collectPlanDrafts(){for(const field of panel.querySelectorAll('[data-plan]'))if(!field.readOnly&&field.value!==field.defaultValue)planDrafts.set(field.dataset.plan,field.value);}
  const labels={recommending:'推荐方向中',directions:'等待确认方向',planning:'逐套构思中',ready:'方案已就绪',generating:'图片生成中',completed:'生成完成',attention:'需要处理'};
  const stage=task=>({not_started:'尚未开始',pending:'排队中',running:task?.phase==='downloading'?'下载图片中':'处理中',completed:'已完成',failed:'未完成'}[task?.status]||'等待生成');
  const api=async(url,data)=>{if(temu)return temu.api(url.replace('/api/multisets','/api/temu/multisets'),data);const response=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw new Error(value.error||'请求未完成');return value;};
  const notify=(text='',error=false)=>{const node=$('msNotice');node.textContent=text;node.dataset.error=String(error);};
  const styleName=id=>config?.styles.find(s=>s.id===id)?.label||id;
  const styleOptions=value=>config.styles.map(s=>`<option value="${s.id}" ${s.id===value?'selected':''}>${escape(s.label)}</option>`).join('');
  const nav=document.createElement('button');
  nav.id='nav-multisets';nav.className='category-icon';nav.dataset.label='裂变';nav.title='多套裂变：不同人群与风格';nav.setAttribute('aria-label','多套裂变');
  nav.innerHTML='<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="8" height="8" rx="2"/><rect x="14" y="3" width="8" height="8" rx="2"/><rect x="8" y="15" width="8" height="7" rx="2"/><path d="M6 11v2h12v-2M12 13v2"/></svg>';
  if(standaloneTemu){nav.className='';nav.textContent='多套裂变';document.querySelector('.header-actions').prepend(nav);}else $('nav-notes').after(nav);
  const restoreState=window.__loadAppStateFrom;
  if(!standaloneTemu)window.__loadAppStateFrom=function(...args){const keepView=location.hash==='#multisets';const result=restoreState.apply(this,args);if(keepView)switchView('multisets',nav);return result;};
  const panel=document.createElement('section');panel.id='view-multisets';panel.className='ms-page hidden';
  panel.innerHTML=`<header class="ms-top"><div><h1>多套裂变</h1><p class="ms-muted">同一产品，为不同人群设计完整套图。</p></div><div class="ms-row"><button type="button" data-action="source">返回产品资料</button><button type="button" data-action="new">新建裂变</button></div></header><div id="msNotice" class="ms-notice" role="status" aria-live="polite"></div><div class="ms-layout"><aside class="ms-panel"><h2>我的裂变批次</h2><div id="msHistory" class="ms-history"></div></aside><main class="ms-main"><section id="msCreate" class="ms-panel"><h2>选择这次的变化方向</h2><div id="msSource" class="ms-source"></div><div class="ms-controls"><label>生成套数<select id="msCount"><option value="2">2 套</option><option value="3" selected>3 套</option><option value="5">5 套</option><option value="custom">自定义</option></select></label><label>裂变方式<select id="msVariation"><option value="both">不同人群＋不同风格</option><option value="style">同人群，不同风格</option><option value="audience">同风格，不同人群</option></select></label><label id="msCustomWrap" hidden>自定义套数<input id="msCustomCount" type="number" min="1" max="10" value="3"></label><label id="msAudienceWrap" hidden>共用目标人群<input id="msSharedAudience" maxlength="240" value="关注本产品已知用途的用户"></label><label id="msStyleWrap" hidden>共用视觉风格<select id="msSharedStyle"></select></label></div><p id="msEstimate" class="ms-count"></p><p id="msSettings" class="ms-muted"></p><p class="ms-muted">每套独立构思、逐张生成。先确认方向，再开始生图。服务按实际用量计费。</p><button type="button" class="ms-primary" id="msRecommend" data-action="create">推荐方案方向</button></section><div id="msGroup"></div></main></div>`;
  if(standaloneTemu){panel.classList.add('temu-multisets');document.querySelector('.workspace').after(panel);}else $('view-dashboard').parentElement.append(panel);
  const launch=document.createElement('button');launch.id='multiSetBtn';launch.type='button';launch.className='ms-launch';launch.textContent=temu?'多套裂变 · 最多 20 套':'多套裂变 · 不同人群与风格';(standaloneTemu?$('planButton'):$('mainBtn')).after(launch);

  function count(){return Number($('msCount').value==='custom'?$('msCustomCount').value:$('msCount').value);}
  function estimate(){
    $('msCustomWrap').hidden=$('msCount').value!=='custom';
    $('msAudienceWrap').hidden=$('msVariation').value!=='style';$('msStyleWrap').hidden=$('msVariation').value!=='audience';
    const titles=copiedSlots|| (standaloneTemu?Array(Number($('imageCount').value)).fill('商品图'):typeof getCurrentSlotTitles==='function'?getCurrentSlotTitles().filter(Boolean):[]);
    $('msEstimate').textContent=titles.length?`每套 ${titles.length} 张 × ${count()} 套 = ${titles.length*count()} 张`:'请先在工作台选择每套的输出范围';
    const mode=copiedSource?.generation_mode||$('generationMode')?.value;
    $('msSettings').textContent=`沿用${copiedSource?'原批次':'工作台'}设置：${mode==='master'?'大师模式':mode==='fast'?'快速模式':'请切换为大师或快速模式'} · ${copiedModel||$('modelChoice')?.selectedOptions[0]?.textContent||'请选择图片模型'}。白底主图遵循平台规则，人群与风格差异主要呈现在副图和 A+。`;
    if(temu)$('msSettings').textContent=`沿用${copiedSource?'原批次':'工作台'}设置：${mode==='master'?'大师模式':'快速模式'} · ${copiedModel||temu.model()} · ${copiedSource?.image_ratio||temu.source().image_ratio}。轮播首图采用突出商品的非白底场景，按所选图文范围独立构思每套，详情页可复用同图同序。`;
    const first=copiedSource?.categorized_images[0]||(standaloneTemu?temu.source().categorized_images[0]:typeof globalMaterials!=='undefined'?globalMaterials[0]:null);
    $('msSource').innerHTML=`${first?.url?.startsWith('/media/')?`<img src="${escape(first.url)}" alt="产品参考图">`:''}<div><strong>${escape(copiedSource?.product_name||(standaloneTemu?temu.source().product_name:$('prodName')?.value)||'尚未填写产品名称')}</strong><div class="ms-muted">${copiedSource?'沿用所选批次的原始产品资料与图片':'使用工作台中上传的产品图片和资料'}</div></div>`;
  }
  async function capture(){
    if(standaloneTemu)return temu.capture();
    const scope=$('designScope').value,mode=$('generationMode').value;
    if(!['master','fast'].includes(mode))throw new Error('请先在工作台切换为大师或快速模式；多套裂变逐张生成图片。');
    if(!scope)throw new Error('请先在工作台选择每套输出范围。');
    if(!$('prodName').value.trim()||!$('prodDesc').value.trim())throw new Error('请先填写产品名称和产品资料。');
    if(!globalMaterials.length||!globalMaterials.some(m=>m.category==='产品主体图'))throw new Error('请先上传并标记产品主体图。');
    const material=await ensureMaterialUrls(globalMaterials);
    if(material.lost.length)throw new Error('参考图已失效，请重新上传：'+material.lost.join('、'));
    const market=JSON.parse($('targetMarket').value),custom=window.__customLayout;
    const source={product_name:$('prodName').value,product_desc:$('prodDesc').value,generation_mode:mode,visual_style:window.getLocalVisualStyle?.(mode)||'scene_advertising',design_scope:getEffectiveScope(),
      custom_layout:scope==='custom'?{main:custom.main|0,sub:custom.sub|0,aplus:custom.aplus|0,aplus_type:custom.aplusType||'premium'}:null,
      target_market:market.market,target_lang:market.lang,model_ethnicity:getModelEthnicity(market.market),strict_requirements:$('strictReq').value,text_depth:isTextDepthOn(),info_density:$('infoDensity')?.value||'high',scene_intensity:$('sceneIntensity')?.value||'original',
      category:window.__categoryState?.category||'general',category_confirmed:!!window.__categoryState?.confirmed,image_allocation:window.__categoryState?.allocation||null,
      structure_notes:window.__categoryState?.structure_notes||null,slot_directives:buildSlotDirectives(),reference_ids:window.__designReferenceIds||[],categorized_images:globalMaterials.map(m=>({filename:m.filename,category:m.category,url:m.url}))};
    return temu?.decorateSource?temu.decorateSource(source):source;
  }
  async function history(){
    const rows=await api('/api/multisets');
    $('msHistory').innerHTML=rows.length?rows.map(row=>`<button type="button" data-action="select" data-id="${escape(row.id)}" aria-current="${row.id===selected}"><strong>${escape(row.name)}</strong><small>${row.count} 套 · ${row.completedImages}/${row.totalImages} 张 · ${labels[row.phase]||row.phase}</small></button>`).join(''):'<p class="ms-muted">还没有裂变批次</p>';
  }
  function remember(value){selected=value;try{if(value)localStorage.setItem(selectedKey,value);else localStorage.removeItem(selectedKey);}catch{}}
  function open(){if(standaloneTemu){document.querySelector('.workspace').hidden=true;panel.classList.remove('hidden');window.scrollTo(0,0);}else switchView('multisets',nav);location.hash='multisets';estimate();history().catch(e=>notify(e.message,true));if(selected)load(selected).catch(e=>notify(e.message,true));}
  nav.onclick=open;launch.onclick=()=>{remember(null);group=null;copiedSource=null;copiedModel=null;copiedSlots=null;creatingId=null;creatingFingerprint=null;$('msCreate').hidden=false;$('msGroup').innerHTML='';clearTimeout(timer);timer=null;open();};
  document.querySelectorAll('.category-icon:not(#nav-multisets)').forEach(button=>button.addEventListener('click',()=>{if(location.hash==='#multisets')window.history.replaceState(null,'',location.pathname+location.search);}));
  for(const name of ['msCount','msCustomCount','msVariation'])$(name).addEventListener('change',estimate);
  function directionsHtml(g){return `<div class="ms-directions">${g.sets.map((set,index)=>`<div class="ms-direction" data-set="${set.id}"><h3>方案 ${index+1}</h3><label>方案名称<input data-field="name" maxlength="80" value="${escape(set.direction.name)}"></label><label>目标人群<input data-field="audience" ${g.variation==='style'?'readonly':''} maxlength="240" value="${escape(set.direction.audience)}"></label><label>购买关注点<textarea data-field="motivation" maxlength="240">${escape(set.direction.motivation)}</textarea></label><label>场景方向<textarea data-field="scene" maxlength="240">${escape(set.direction.scene)}</textarea></label><label>视觉风格<select data-field="styleId" ${g.variation==='audience'?'disabled':''}>${styleOptions(set.direction.styleId)}</select></label></div>`).join('')}</div>`;}
  function imageHtml(set,image){
    const task=image.task,ready=task?.status==='completed',working=['pending','running'].includes(task?.status);
    return `<article class="ms-image" data-slot="${image.slot}">${ready?`<a href="${escape(task.imageUrl)}" target="_blank" rel="noopener"><img src="${escape(task.imageUrl)}" alt="${escape(image.title)}" loading="lazy"></a>`:`<div class="ms-placeholder">${escape(stage(task))}</div>`}<div class="ms-image-body"><strong>${escape(image.title)}</strong>${temu&&task?.dimensions?`<small class="ms-muted">${task.dimensions.width} × ${task.dimensions.height}</small>`:""}${temu&&task?.fitted?'<p class="ms-muted">已保留完整画面并补边到目标比例，请检查构图。</p>':""}${task?.error?`<p class="ms-error">${escape(task.error)}</p>`:''}<div class="ms-row">${ready?`<button type="button" data-action="download-image" data-set="${set.id}" data-slot="${image.slot}">下载图片</button>`:''}${task?.canRetryDownload?`<button type="button" data-action="retry-download" data-set="${set.id}" data-slot="${image.slot}">重试下载</button>`:''}${image.previousResult?`<a class="ms-link" href="${escape(image.previousResult.imageUrl)}" target="_blank" rel="noopener">查看上次成功图片</a>`:''}${task&&!working?`<button type="button" data-action="regenerate" data-set="${set.id}" data-slot="${image.slot}">重新生成</button>`:''}</div></div></article>`;
  }
  function setHtml(set){
    const complete=set.images.filter(i=>i.task?.status==='completed').length,started=set.images.some(i=>i.task),missing=set.images.filter(i=>!i.task).length,planning=set.planning.status==='completed';
    return `<section class="ms-set" data-set="${set.id}"><div class="ms-set-header"><div><h2>${escape(set.direction.name)}</h2><p><span class="ms-chip">${escape(set.direction.audience)}</span> <span class="ms-chip">${escape(styleName(set.direction.styleId))}</span></p><p class="ms-muted">${escape(set.direction.motivation)}</p></div><div class="ms-row">${planning&&missing?`<button type="button" class="ms-primary" data-action="generate-set" data-set="${set.id}" ${set.qualityIssues?.length||set.legacyPlan||(temu&&!temu.imageReady())?'disabled':''}>${started?'补齐未开始的图片':'生成这套'} · ${missing} 张</button>`:''}${planning&&!started?`<button type="button" data-action="replan-set" data-set="${set.id}">重新构思这套</button>`:''}${['not_started','failed'].includes(set.planning.status)?`<button type="button" data-action="plan-set" data-set="${set.id}">${set.planning.status==='failed'?'重试这套构思':'开始这套构思'}</button>`:''}${complete&&(!temu||complete===set.images.length)?`<button type="button" data-action="download-set" data-set="${set.id}">${temu?"导出这套上架资料包":"下载这套"}（${complete} 张）</button>`:''}</div></div><p class="ms-muted">构思：${stage(set.planning)} · 图片 ${complete}/${set.images.length}</p>${(set.qualityIssues||[]).map(message=>`<p class="ms-error">${escape(message)}</p>`).join('')}${set.planning.error?`<p class="ms-error">${escape(set.planning.error)}</p>`:''}${planning?`<details><summary>查看${started?'':'／编辑'}这套的完整方案</summary><textarea class="ms-plan-text" data-plan="${set.id}" ${started?'readonly':''}>${escape(planDrafts.get(set.id)??set.plan.text)}</textarea>${!started?`<button type="button" data-action="save-plan" data-set="${set.id}">保存方案</button>`:''}</details>`:''}<div class="ms-images">${set.images.map(image=>imageHtml(set,image)).join('')}</div></section>`;
  }
  function copyReviewHtml(g){
    if(['pending','running'].includes(g.copyRepair?.status))return '<p class="ms-notice" role="status">正在检查并修正重复文案，第 '+(g.copyRepair.attempt||1)+'/2 轮，请稍候。</p>';
    if(!g.quality?.issues.length)return g.copyRepair?.changedHeadlines?'<p class="ms-notice">重复文案已修正，全部方案检查通过。</p>':'';
    if(g.sets.some(s=>['pending','running'].includes(s.planning.status)))return '<p class="ms-notice" role="status">已发现重复画面标题，等待全部套图构思完成后自动修正；下方可查看每套进度。</p>';
    const messages=g.quality.issues.map(issue=>'<p class="ms-error">'+escape(issue.message)+'</p>').join('');
    return messages+(g.copyRepair?.error?'<p class="ms-error">'+escape(g.copyRepair.error)+'</p>':'')+(g.sets.every(s=>s.planning.status==='completed')?'<button type="button" data-action="repair-copy">'+(g.copyRepair?.status==='failed'?'重试修正文案':'修正重复文案')+'</button>':'');
  }
  function render(g){
    collectPlanDrafts();for(const set of g.sets)if(planDrafts.get(set.id)===set.plan?.text)planDrafts.delete(set.id);
    group=g;$('msCreate').hidden=true;
    const expanded=[...panel.querySelectorAll('.ms-set details[open]')].map(el=>el.closest('[data-set]').dataset.set);
    const allPlanned=g.sets.length&&g.sets.every(s=>s.planning.status==='completed');
    const anyStarted=g.sets.some(s=>s.images.some(i=>i.task));
    $('msGroup').innerHTML=`<section class="ms-panel"><div class="ms-set-header"><div><h2>${escape(g.source.product_name)}</h2><p class="ms-muted">${g.count} 套 × 每套 ${g.slots.length} 张${temu?` · ${escape(g.source.image_ratio)}`:""} · ${escape(g.model)} · ${g.source.generation_mode==='master'?'大师模式':'快速模式'}</p></div><span class="ms-chip">${['pending','running'].includes(g.copyRepair?.status)?'检查并修正文案中':labels[g.phase]}</span></div><div class="ms-progress"><i style="width:${100*g.completedImages/g.totalImages}%"></i></div><p class="ms-count">已生成 ${g.completedImages} / ${g.totalImages} 张</p>${copyReviewHtml(g)}${g.quality?.legacySets.length?'<p class="ms-notice">这是旧版裂变结果。新版已改进风格和文案差异；可复制资料新建批次，原图保留。</p>':''}${temu&&!temu.imageReady()?'<p class="ms-notice">图片通道尚未配置，可先构思和编辑方案；配置后刷新页面即可生图。</p>':''}${g.recommendation.error?`<p class="ms-error">${escape(g.recommendation.error)}</p><button type="button" data-action="recommend-again">重新推荐方向</button>`:''}${g.recommendation.status==='running'?'<p>正在根据产品资料推荐不同方向，请稍候。刷新后可继续查看。</p>':''}${!g.locked&&g.recommendation.status==='completed'?`<p class="ms-muted">${g.recommendation.source==='ai'?'AI 已推荐以下方向，可逐套修改。':'以下方向来自资料规则，可逐套修改。'}确认后分别生成完整方案。</p>${directionsHtml(g)}<div class="ms-row ms-group-actions"><button type="button" data-action="save-directions">保存方向</button><button type="button" class="ms-primary" id="msPlanAll" data-action="plan-all">确认方向，构思 ${g.count} 套</button></div>`:''}${g.locked?`<div class="ms-row ms-group-actions">${allPlanned&&g.sets.some(s=>s.images.some(i=>!i.task))?`<button type="button" class="ms-primary" id="msGenerateAll" data-action="generate-all" ${g.quality?.issues.length||g.quality?.legacySets.length||(temu&&!temu.imageReady())?'disabled':''}>${anyStarted?'生成尚未开始的图片':'生成全部套图'}</button>`:''}${g.completedImages&&(!temu||g.completedImages===g.totalImages)?`<button type="button" data-action="download-all">${temu?"导出全部上架资料包":"按套打包下载"}</button>`:''}<button type="button" data-action="copy">复制资料，新建裂变</button></div><p class="ms-muted">各套使用同一模型与完整构思流程。生成后请确认商品还原、文字及整体效果。</p>`:''}</section>${g.locked?g.sets.map(setHtml).join(''):''}`;
    if(['pending','running'].includes(g.copyRepair?.status))for(const node of $('msGroup').querySelectorAll('button,textarea'))node.disabled=true;
    for(const key of expanded){const details=panel.querySelector(`.ms-set[data-set="${key}"] details`);if(details)details.open=true;}
  }
  function poll(key,delay=2200){clearTimeout(timer);timer=setTimeout(()=>{timer=null;if(selected===key)load(key).catch(e=>{notify('进度读取失败，正在重新连接：'+e.message,true);if(selected===key)poll(key,5000);});},delay);}
  async function load(key){
    clearTimeout(timer);timer=null;const value=await api('/api/multisets/'+key);if(selected!==key)return;
    const changed=group?.phase!==value.phase||group?.completedImages!==value.completedImages;
    if(panel.contains(document.activeElement)&&document.activeElement.matches('[data-plan]'))group=value;else render(value);
    if($('msNotice').textContent.startsWith('进度读取失败'))notify('连接已恢复。');
    if(changed)history().catch(()=>{});
    if(['recommending','planning','generating'].includes(value.phase))poll(key);
  }
  function collectDirections(){return group.sets.map(set=>Object.fromEntries([...panel.querySelectorAll(`.ms-direction[data-set="${set.id}"] [data-field]`)].map(el=>[el.dataset.field,el.value])));}
  async function saveDirections(){
    const directions=collectDirections();
    if(JSON.stringify(directions)!==JSON.stringify(group.sets.map(s=>s.direction)))group=await api('/api/multisets/'+selected+'/directions',{revision:group.revision,directions});
  }
  async function fileBytes(url){const response=await fetch(url);if(!response.ok)throw new Error('图片下载失败，可稍后重新下载');return response.blob();}
  function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  const filename=value=>String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,90);
  async function downloadSets(sets){
    if(temu){await temu.exportSets(group,sets);notify(`已保存并导出 ${sets.length} 套完整资料包，主图和详情图同图同序，商品未上架。`);return;}
    const zip=new JSZip();let total=0;
    for(const [index,set] of sets.entries()){
      const folder=zip.folder(`${String(index+1).padStart(2,'0')}-${filename(set.direction.name)}`);
      folder.file('设计方案.txt',set.plan?.text||'');folder.file('方向.json',JSON.stringify(set.direction,null,2));
      for(const image of set.images)if(image.task?.status==='completed'){const blob=await fileBytes(image.task.imageUrl);folder.file(`${String(image.slot+1).padStart(2,'0')}-${filename(image.title)}${/\.webp$/.test(image.task.imageUrl)?'.webp':/\.jpg$/.test(image.task.imageUrl)?'.jpg':'.png'}`,blob);total++;}
    }
    zip.file('生成状态.json',JSON.stringify({product:group.source.product_name,model:group.model,totalImages:sets.reduce((n,s)=>n+s.images.length,0),downloadedImages:total,sets:sets.map(s=>({name:s.direction.name,images:s.images.map(i=>({title:i.title,status:i.task?.status||'not_started'}))}))},null,2));
    saveBlob(await zip.generateAsync({type:'blob'}),filename(group.source.product_name)+'-裂变套图.zip');notify(`已打包 ${total} 张已完成图片，文件夹按套区分。`);
  }
  for(const event of ['input','change'])panel.addEventListener(event,e=>{if(e.target.dataset.plan)planDrafts.set(e.target.dataset.plan,e.target.value);});
  panel.addEventListener('focusout',e=>{if(!e.target.matches('[data-plan]'))return;setTimeout(()=>{if(!actionBusy&&group&&!panel.querySelector('[data-plan]:focus'))render(group);},0);});
  panel.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button||actionBusy)return;
    collectPlanDrafts();
    const action=button.dataset.action;
    actionBusy=true;button.disabled=true;notify('');clearTimeout(timer);timer=null;
    try{
      if(action==='source'){if(standaloneTemu){panel.classList.add('hidden');document.querySelector('.workspace').hidden=false;}else switchView('dashboard',$('nav-dash'));if(location.hash==='#multisets')window.history.replaceState(null,'',location.pathname+location.search);return;}
      if(action==='new'||action==='copy'){
        copiedSource=action==='copy'?structuredClone(group.source):null;copiedModel=action==='copy'?group.model:null;copiedSlots=action==='copy'?group.slots:null;remember(null);group=null;creatingId=null;creatingFingerprint=null;$('msCreate').hidden=false;$('msGroup').innerHTML='';estimate();if(copiedSource)notify('已复制产品资料，选择套数和变化方向即可新建。');await history();return;
      }
      if(action==='select'){remember(button.dataset.id);await load(selected);await history();return;}
      if(action==='create'){
        const source=copiedSource||await capture();
        const payload={source,count:count(),variation:$('msVariation').value,sharedAudience:$('msSharedAudience').value,sharedStyle:$('msSharedStyle').value,model:copiedModel||(temu?temu.model():$('modelChoice').value)};
        const fingerprint=JSON.stringify(payload);if(creatingFingerprint!==fingerprint){creatingFingerprint=fingerprint;creatingId=crypto.randomUUID();}
        const value=await api('/api/multisets',{request_id:creatingId,...payload});
        creatingId=null;creatingFingerprint=null;remember(value.id);await load(selected);await history();return;
      }
      if(action==='save-directions'||action==='plan-all'){await saveDirections();if(action==='plan-all')await api('/api/multisets/'+selected+'/plan',{});else notify('方向已保存。');}
      else if(action==='recommend-again')await api('/api/multisets/'+selected+'/recommend',{});
      else if(action==='repair-copy'){if([...planDrafts].some(([id,text])=>group.sets.some(s=>s.id===id&&s.plan.text!==text)))throw new Error('请先保存正在编辑的方案，再修正文案。');await api('/api/multisets/'+selected+'/repair-copy',{});}
      else if(action==='plan-set'||action==='replan-set')await api('/api/multisets/'+selected+'/plan',{setId:button.dataset.set,force:action==='replan-set'});
      else if(action==='save-plan'){await api('/api/multisets/'+selected+'/plan-text',{setId:button.dataset.set,text:panel.querySelector(`[data-plan="${button.dataset.set}"]`).value});planDrafts.delete(button.dataset.set);notify('本套设计方案已保存。');}
      else if(action==='generate-all'||action==='generate-set'){
        const sets=action==='generate-set'?group.sets.filter(s=>s.id===button.dataset.set):group.sets.filter(s=>s.images.some(i=>!i.task));
        if(sets.some(s=>planDrafts.has(s.id)&&planDrafts.get(s.id)!==s.plan.text))throw new Error('请先保存修改后的完整方案，再开始生图。');
        const number=sets.reduce((n,s)=>n+s.images.filter(i=>!i.task).length,0);
        if(!number)return;
        if(!confirm(`本次将生成 ${sets.length} 套、共 ${number} 张图片，使用 ${group.model} 并消耗图片服务额度。确认开始？`))return;
        await api('/api/multisets/'+selected+'/generate',action==='generate-set'?{setId:button.dataset.set}:{});
      }else if(action==='regenerate'||action==='retry-download'){
        if(action==='regenerate'&&!confirm('重新生成这一张会使用图片服务额度。确认重新生成？'))return;
        const retryKey=selected+':'+button.dataset.set+':'+button.dataset.slot;
        if(!retryRequests.has(retryKey))retryRequests.set(retryKey,crypto.randomUUID());
        await api('/api/multisets/'+selected+'/retry',{setId:button.dataset.set,slot:Number(button.dataset.slot),mode:action==='retry-download'?'download':'regenerate',request_id:retryRequests.get(retryKey)});
        retryRequests.delete(retryKey);
      }else if(action==='download-image'){
        const image=group.sets.find(s=>s.id===button.dataset.set).images.find(i=>i.slot===Number(button.dataset.slot));
        saveBlob(await fileBytes(image.task.imageUrl),filename(image.title)+image.task.imageUrl.slice(image.task.imageUrl.lastIndexOf('.')));
      }else if(action==='download-all'||action==='download-set')await downloadSets(action==='download-all'?group.sets:group.sets.filter(s=>s.id===button.dataset.set));
      if(selected)await load(selected);await history();
    }catch(error){notify(error.message,true);}finally{actionBusy=false;button.disabled=false;if(selected&&group&&['recommending','planning','generating'].includes(group.phase)&&!timer)poll(selected);}
  });
  async function init(){
    try{await (temu?temu.ready:LocalWorkbench.ready);config=await api('/api/multisets/config');$('msSharedStyle').innerHTML=styleOptions('natural');$('msCustomCount').max=config.maxSets;try{selected=new URLSearchParams(location.search).get('group')||localStorage.getItem(selectedKey);if(selected)localStorage.setItem(selectedKey,selected);}catch{}await history();if(location.hash==='#multisets')open();}catch(error){$('msRecommend').disabled=true;notify('多套裂变暂不可用：'+error.message,true);}
  }
  init();
})();
