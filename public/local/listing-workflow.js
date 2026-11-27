(() => {
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const labels={pending:'待核对',created:'待核对',running:'执行中',inspecting:'核对采集箱',inspected:'已核对采集箱',located:'已定位店铺商品',claimed:'已确认认领',unclaimed:'尚未认领到该店',ambiguous:'存在多条候选记录',partial:'部分完成','ready-to-prepare':'等待填写',preparing:'填写并保存中',saving:'正在保存',ready:'已核对，待填写',prepared:'已保存并核对',saved:'已保存',verified:'已核对',publishing:'正在提交发布',published:'已取得发布成功回执',submitted:'已提交发布',listed:'店小秘在线，平台状态待同步',online:'平台在售',reviewing:'平台审核中','pending-launch':'平台待上架',completed:'本次处理完成',paused:'已暂停',stopped:'已停止','needs-review':'待核对',unknown:'结果待核对',blocked:'有待补充项','waiting-claim':'等待认领',missing:'未找到记录',failed:'失败'};
  let token,settings={erpConnections:[],stores:[]},templates=[],sourceJobs=[],state={jobs:[],busy:false,otherBusy:false};
  let editor=null,editorDirty=false,acting=false,polling=false,workflowReady=false,pending=null;
  let selectedGoods=new Set(),selectedStores=new Set(),selectedDestinations=new Set();
  const categoryCatalogs=new Map(),categorySearchForms=new Map(),platformNames={temu:'Temu 半托管',shein:'SHEIN 希音',tiktok:'TikTok'};
  const automatic=()=>$('listingMode').value==='required-fields';
  const collectionBackendMessage='请关闭旧工作台服务后重新启动，启用新版采集店铺功能';
  const collectionFeaturesReady=()=>Array.isArray(settings.collectionStores)&&Array.isArray(settings.collectionPlatforms);
  const automaticJob=job=>job.workflowMode==='required-fields';
  const destinationGroup=store=>JSON.stringify([store.erpKey,store.platform,String(store.site||'').trim().replace(/站$/,'')]);
  const destinations=()=>(collectionFeaturesReady()?settings.collectionStores:[]).filter(store=>store.erpKey===erpKeyOf(source())&&destinationGroup(store)===$('destinationGroup').value);
  const sourceParam=new URLSearchParams(location.search).get('freeJobId');
  try{pending=JSON.parse(sessionStorage.getItem('listing-workflow-pending'));}catch{}
  const show=(text,error=false)=>{$('workflowNotice').hidden=false;$('workflowNotice').className=error?'error':'';$('workflowNotice').textContent=text;};
  const template=()=>templates.find(item=>item.id===$('activeTemplate').value);
  const source=()=>sourceJobs.find(item=>item.id===$('sourceBatch').value);
  const erpKeyOf=job=>job?.binding?.erpConnection?.key||job?.binding?.erpKey||job?.erpKey||'';
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN'):'';
  // Candidate timestamps are the displayed local values from 店小秘; no timezone is supplied.
  const candidateLabel=item=>[item.draftId,item.createdAt&&`创建 ${item.createdAt}`,item.updatedAt&&`更新 ${item.updatedAt}`,item.category].filter(Boolean).join(' · ');
  const valueLabel=value=>typeof value==='object'&&value?value.label||value.name||'':String(value??'');
  const issueText=issue=>typeof issue==='string'?issue:issue?.message||issue?.label||'有待核对项';
  const packageFields={lengthCm:'templatePackageLength',widthCm:'templatePackageWidth',heightCm:'templatePackageHeight',weightKg:'templatePackageWeight'};
  Object.assign(labels,{'waiting-category':'等待选择分类','needs-category':'等待选择分类','pending-publication':'已转入待发布','pending-ready':'已转入待发布',moving:'正在转入待发布',draft:'待发布',unsupported:'当前页面尚未适配',incomplete:'必填项待补充'});
  function bulkRuleSummary(rules={}){
    const pack=rules.packageDefaults;
    return `<div class="rule-summary bulk-rule-summary"><span>分类：<strong>${rules.categoryMode==='replace'?'统一替换为模板分类':'仅补空分类，已有分类须一致'}</strong></span><span>包装：<strong>${pack?`${esc(pack.lengthCm)} × ${esc(pack.widthCm)} × ${esc(pack.heightCm)} cm · ${esc(pack.weightKg)} kg`:'保留各 SKU 原值'}</strong></span><span>库存：<strong>${rules.inventory?.mode==='fixed'?`每个 SKU ${esc(rules.inventory.quantity)}`:'保留各 SKU 原值'}</strong></span><span>保存：<strong>${rules.saveMode==='draft'?'包装待补先存草稿':'资料完整后保存'}</strong></span></div>`;
  }
  const actionAllowed=(job,action)=>Array.isArray(job.availableActions)&&job.availableActions.includes(action)&&!(automaticJob(job)&&(action==='publish'||action==='process'&&job.nativeBatch?.ready!==true));

  async function api(route,payload){
    const response=await fetch('/api/'+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});
    const value=await response.json().catch(()=>({error:'服务暂未返回可读取的结果，请刷新核对。'}));
    if(!response.ok)throw Object.assign(new Error(value.error||'请求失败'),{status:response.status});
    return value;
  }
  function remember(value){pending=value;try{if(value)sessionStorage.setItem('listing-workflow-pending',JSON.stringify(value));else sessionStorage.removeItem('listing-workflow-pending');}catch{}}
  function dirty(){editorDirty=true;$('templateDirty').textContent='尚未保存';$('templateSaveStatus').textContent='';}
  function controls(){
    const busy=!token||acting||state.busy||state.otherBusy;
    for(const field of $('templateForm').elements)field.disabled=!!busy;
    $('templateInventoryQuantity').disabled=!!busy||$('templateInventoryMode').value!=='fixed';
    $('templateInventoryQuantity').required=$('templateInventoryMode').value==='fixed';
    for(const field of $('listingJobForm').elements)field.disabled=!!(busy||pending||!workflowReady);
    document.querySelectorAll('#batchGoods input[data-unavailable]').forEach(input=>input.disabled=true);
    $('activeTemplate').disabled=!!busy;
    $('newTemplate').disabled=!!busy;
    $('editTemplate').disabled=!!(busy||!template());$('copyTemplate').disabled=!!(busy||!template());
    $('refreshWorkflow').disabled=!!(acting||polling);
    $('listingMode').disabled=!!busy;$('destinationGroup').disabled=!!busy||!collectionFeaturesReady();
    const destinationReady=automatic()?selectedDestinations.size>0&&[...selectedDestinations].every(key=>destinations().some(store=>store.key===key)):!!template()&&selectedStores.size>0&&erpKeyOf(source())===template()?.erpKey;
    $('createListingJob').disabled=!!(busy||pending||!workflowReady||!source()||!selectedGoods.size||!destinationReady||automatic()&&!collectionFeaturesReady());
    document.querySelectorAll('[data-job-action]').forEach(button=>{const job=state.jobs.find(item=>item.id===button.closest('[data-job]').dataset.job);button.disabled=!!(acting||state.otherBusy||state.busy&&button.dataset.jobAction!=='stop'||!job||!actionAllowed(job,button.dataset.jobAction));});
    document.querySelectorAll('[data-job-field],[data-allocation-action],[data-resolve-goods],[data-category-action],[data-category-option],[data-category-field],[data-category-candidate]').forEach(field=>{const job=state.jobs.find(item=>item.id===field.closest('[data-job]')?.dataset.job);field.disabled=!!(busy||!job||field.dataset.unavailable);});
    $('workflowBusy').textContent=pending?'上一条建立任务请求的结果待核对。点击刷新记录，系统会查找同一任务。':state.otherBusy?'其他工作台任务正在使用浏览器，完成后可继续。':state.busy?'正在按店铺执行，进度会自动更新。':'';
  }
  function renderTemplateOptions(preferred){
    const selected=preferred??$('activeTemplate').value;
    $('activeTemplate').innerHTML=templates.length?'<option value="">请选择已保存的模板</option>'+templates.map(item=>`<option value="${esc(item.id)}">${esc(item.name)} · v${item.version}</option>`).join(''):'<option value="">还没有固定模板，请先创建</option>';
    if(templates.some(item=>item.id===selected))$('activeTemplate').value=selected;
    else if(templates.length===1)$('activeTemplate').value=templates[0].id;
  }
  function renderTemplateSummary(resetStores=false){
    const current=template();
    if(!current){$('templateSummary').innerHTML='<p class="muted">创建一次模板，后续批次直接选择复用。</p>';selectedStores.clear();renderStoreChoices();renderExecutionSummary();return;}
    const erp=settings.erpConnections.find(item=>item.key===current.erpKey),issues=current.readiness?.issues||[];
    $('templateSummary').innerHTML=`<div class="template-summary"><span><strong>${esc(current.platform==='temu'?'Temu半托管':current.platform==='tiktok'?'TikTok':current.platform)}</strong> · ${esc(current.site||'站点待填')}</span><span>${esc(current.productType||'商品类型待填')}</span><span>${esc(erp?.name||'关联账号待核对')}</span><span>${current.storeBindings.length} 家店铺</span><span class="small muted">保存于 ${esc(date(current.updatedAt))}</span></div><p class="small muted">分类：${esc(current.category?.path?.join(' → ')||'待填写')}</p>${bulkRuleSummary(current.rules)}${issues.length?`<div class="template-issues"><p>模板已保存，以下设置仍待补充：</p><ul>${issues.map(issue=>`<li>${esc(issueText(issue))}</li>`).join('')}</ul></div>`:'<p class="small muted">配置已保存。执行时仍会逐项核对商品资料和店铺绑定。</p>'}`;
    if(resetStores)selectedStores=new Set(current.storeBindings.map(binding=>binding.key));
    else selectedStores=new Set([...selectedStores].filter(key=>current.storeBindings.some(binding=>binding.key===key)));
    renderStoreChoices();renderExecutionSummary();
  }
  function renderStoreChoices(){
    if(automatic()){
      if(!collectionFeaturesReady()){$('runStoreChoices').innerHTML=`<p class="error small">${collectionBackendMessage}</p>`;selectedDestinations.clear();return;}
      const stores=destinations();
      selectedDestinations=new Set([...selectedDestinations].filter(key=>stores.some(store=>store.key===key)));
      $('runStoreChoices').innerHTML=stores.length?stores.map(store=>`<label class="run-store"><input type="checkbox" data-run-destination="${esc(store.key)}" ${selectedDestinations.has(store.key)?'checked':''}><span>${esc(store.storeName)}${store.site?' · '+esc(store.site):''}<small>${esc(platformNames[store.platform]||store.platform)}${store.storeId?' · 店铺 ID '+esc(store.storeId):''}</small></span></label>`).join(''):'<p class="muted small">本批账号尚无对应的采集箱店铺。<a href="/settings#collectionStores">前往绑定店铺</a></p>';
      return;
    }
    $('runStoreChoices').innerHTML=template()?.storeBindings.length?template().storeBindings.map(binding=>`<label class="run-store"><input type="checkbox" data-run-store="${esc(binding.key)}" ${selectedStores.has(binding.key)?'checked':''}><span>${esc(binding.storeName)} · ${esc(binding.site||template().site)}<small>仓库：${esc(valueLabel(binding.warehouse)||'待填')} · 运费：${esc(valueLabel(binding.shippingTemplate)||'待填')} · ${esc(valueLabel(binding.dispatch)||'时效待填')}</small></span></label>`).join(''):'<p class="muted small">此模板尚未绑定店铺，可先编辑模板并保存。</p>';
  }
  function renderDestinationGroups(){
    const previous=$('destinationGroup').value,groups=new Map();
    for(const store of collectionFeaturesReady()?settings.collectionStores:[])if(store.erpKey===erpKeyOf(source())){const key=destinationGroup(store);if(!groups.has(key))groups.set(key,store);}
    $('destinationGroup').innerHTML=groups.size?[...groups].map(([key,store])=>`<option value="${esc(key)}">${esc(platformNames[store.platform]||store.platform)}${store.site?' · '+esc(store.site):' · 店铺默认站点'} · ${(settings.collectionStores||[]).filter(candidate=>destinationGroup(candidate)===key).length} 家店铺</option>`).join(''):'<option value="">'+(source()?'请先绑定本批账号的采集箱店铺':'先选择已采集批次')+'</option>';
    if(groups.has(previous))$('destinationGroup').value=previous;
    if(previous!==$('destinationGroup').value)selectedDestinations=new Set(destinations().map(store=>store.key));
    $('destinationHint').textContent=collectionFeaturesReady()?'仅显示本批店小秘账号的已绑定店铺。不同平台或站点分别建任务，同一组可选择多家店铺。':collectionBackendMessage;
    renderStoreChoices();
  }
  function renderMode(){
    $('templateLibrary').hidden=automatic();$('destinationSetup').hidden=!automatic();
    $('createListingJob').textContent=automatic()?'建立本批补全任务':'建立本批上架任务';
    $('createListingHint').textContent=automatic()?collectionFeaturesReady()?'先领取到所选店铺；分类对应来源类别，保留店小秘已换算的售价，普通属性空项按各平台表单补齐。':collectionBackendMessage:'先核对本批商品的认领记录，再按已保存的固定模板填写。';
    renderStoreChoices();renderExecutionSummary();
  }
  function attributeRow(name='',value=''){
    const row=document.createElement('div');row.className='attribute-row';
    row.innerHTML=`<label><span class="small muted">属性名称</span><input data-attribute-name maxlength="160" value="${esc(name)}" placeholder="例如：框架类型"></label><label><span class="small muted">共用属性值</span><input data-attribute-value maxlength="500" value="${esc(value)}" placeholder="填写已确认的值"></label><button type="button" data-remove-attribute aria-label="移除这项共用属性">移除</button>`;
    $('attributeRows').append(row);
  }
  function bindingRow(binding={}){
    const row=document.createElement('section');row.className='store-binding';row.dataset.bindingKey=binding.key||crypto.randomUUID();
    row.innerHTML=`<div class="section-title"><h4>店铺配置</h4><button type="button" data-remove-binding>移除这家店</button></div><div class="fields"><label class="store-name-field">店铺名称<input data-binding-field="storeName" maxlength="240" value="${esc(binding.storeName)}" placeholder="店小秘中的完整店铺名称"></label><label class="store-site-field">站点<input data-binding-field="site" maxlength="160" value="${esc(binding.site||$('templateSite').value)}" placeholder="与模板销售站点一致"></label><label>仓库<input data-binding-field="warehouse" maxlength="240" value="${esc(valueLabel(binding.warehouse))}" placeholder="该店可用的仓库"></label><label>运费模板<input data-binding-field="shippingTemplate" maxlength="240" value="${esc(valueLabel(binding.shippingTemplate))}" placeholder="该店可用的运费模板"></label><label>发货时效<input data-binding-field="dispatch" maxlength="160" value="${esc(valueLabel(binding.dispatch))}" placeholder="例如：2个工作日内发货"></label></div>`;
    $('storeBindingRows').append(row);
  }
  function loadEditor(item){
    editor=item?clone(item):null;editorDirty=false;
    $('templateEditorTitle').textContent=item?`编辑「${item.name}」 · v${item.version}`:'新建固定上架模板';$('templateDirty').textContent='';$('templateSaveStatus').textContent='';
    $('templateName').value=item?.name||'';$('templateErp').value=item?.erpKey||erpKeyOf(source())||settings.erpConnections[0]?.key||'';
    $('templatePlatform').value=item?.platform||'temu';$('templateBusiness').value=item?.businessType||'半托管';$('templateSite').value=item?.site||'加拿大站';$('templateProductType').value=item?.productType||'';
    $('templateCategory').value=item?.category?.path?.join(' > ')||'';$('templateNotes').value=item?.notes||'';
    $('templateCategoryMode').value=item?.rules?.categoryMode||(item?'match':'replace');
    for(const [name,id] of Object.entries(packageFields))$(id).value=item?.rules?.packageDefaults?.[name]??'';
    $('templateInventoryMode').value=item?(item.rules?.inventory?.mode==='fixed'?'fixed':'preserve'):'fixed';
    $('templateInventoryQuantity').value=item?.rules?.inventory?.quantity??10000;
    $('templateSaveMode').value=item?.rules?.saveMode||(item?'ready':'draft');
    $('attributeRows').replaceChildren();Object.entries(item?.rules?.attributes||{}).filter(([,value])=>['string','number','boolean'].includes(typeof value)).forEach(([name,value])=>attributeRow(name,value));
    $('titleRuleSummary').textContent=!item?.rules?.title?.mode||item.rules.title.mode==='preserve'?'保留商品原内容':'沿用已保存的标题规则';
    $('priceRuleSummary').textContent=!item?.rules?.pricing?.mode||item.rules.pricing.mode==='preserve'?'保留商品原值':'沿用已保存的定价规则';
    $('storeBindingRows').replaceChildren();(item?.storeBindings||[]).forEach(bindingRow);
    $('templateEditor').open=true;controls();
  }
  function requireCleanEditor(){if(editorDirty)throw new Error('模板有未保存的修改，请先保存，或点击“结束编辑”放弃本次修改。');}
  function readTemplate(){
    const categoryPath=$('templateCategory').value.split(/\s*(?:>|→)\s*/).map(value=>value.trim()).filter(Boolean);
    const attributes=Object.fromEntries(Object.entries(editor?.rules?.attributes||{}).filter(([,value])=>value!==null&&typeof value==='object'));
    for(const row of $('attributeRows').children){const name=row.querySelector('[data-attribute-name]').value.trim(),value=row.querySelector('[data-attribute-value]').value.trim();if(!name&&!value)continue;if(!name||!value)throw new Error('共用属性需要同时填写名称和值，或者移除该项后保存。');if(Object.hasOwn(attributes,name))throw new Error(`共用属性“${name}”重复，请保留一项。`);attributes[name]=value;}
    const storeBindings=[...$('storeBindingRows').children].map(row=>{
      const original=editor?.storeBindings.find(binding=>binding.key===row.dataset.bindingKey)||{};
      const fields=Object.fromEntries([...row.querySelectorAll('[data-binding-field]')].map(input=>[input.dataset.bindingField,input.value.trim()]));
      if(!fields.storeName)throw new Error('请填写店铺名称，或移除空白的店铺配置。');
      const binding={...original,key:row.dataset.bindingKey,...fields,overrides:clone(original.overrides||{})};
      if(fields.storeName!==original.storeName||fields.site!==original.site||$('templateErp').value!==editor?.erpKey||$('templatePlatform').value!==editor?.platform){delete binding.storeKey;delete binding.storeId;}
      if(fields.warehouse!==valueLabel(original.warehouse))delete binding.warehouseId;
      if(fields.shippingTemplate!==valueLabel(original.shippingTemplate))delete binding.shippingTemplateId;
      if(fields.dispatch!==valueLabel(original.dispatch))delete binding.dispatchId;
      return binding;
    });
    const rules={...clone(editor?.rules||{}),attributes};rules.title??={mode:'preserve'};rules.pricing??={mode:'preserve'};
    rules.categoryMode=$('templateCategoryMode').value;
    if(!['replace','match'].includes(rules.categoryMode))throw new Error('请选择分类应用方式。');
    rules.saveMode=$('templateSaveMode').value;
    if(!['draft','ready'].includes(rules.saveMode))throw new Error('请选择填写后的保存方式。');
    const packageValues=Object.fromEntries(Object.entries(packageFields).map(([name,id])=>[name,$(id).value.trim()]));
    if(Object.values(packageValues).some(Boolean)){
      if(Object.values(packageValues).some(value=>!value||!Number.isFinite(Number(value))||Number(value)<=0))throw new Error('统一包装参数需要同时填写大于 0 的长、宽、高和重量。尺寸单位为 cm，重量单位为 kg。');
      rules.packageDefaults=Object.fromEntries(Object.entries(packageValues).map(([name,value])=>[name,Number(value)]));
    }else delete rules.packageDefaults;
    if($('templateInventoryMode').value==='fixed'){
      const raw=$('templateInventoryQuantity').value.trim(),quantity=Number(raw);
      if(!raw||!Number.isSafeInteger(quantity)||quantity<0)throw new Error('每个 SKU 库存须为大于或等于 0 的整数。');
      rules.inventory={mode:'fixed',quantity};
    }else if($('templateInventoryMode').value==='preserve')rules.inventory={mode:'preserve'};
    else throw new Error('请选择库存应用方式。');
    return {...(editor?{id:editor.id,version:editor.version}:{}),name:$('templateName').value.trim(),erpKey:$('templateErp').value,platform:$('templatePlatform').value,businessType:$('templateBusiness').value.trim(),site:$('templateSite').value.trim(),productType:$('templateProductType').value.trim(),category:{id:JSON.stringify(categoryPath)===JSON.stringify(editor?.category?.path)?editor?.category?.id||'':'',label:categoryPath.at(-1)||'',path:categoryPath},rules,storeBindings,notes:$('templateNotes').value.trim()};
  }
  function renderSources(preferred){
    const chosen=preferred??$('sourceBatch').value;
    const available=sourceJobs.filter(job=>job.rows?.some(row=>row.status==='verified'));
    $('sourceBatch').innerHTML=available.length?available.map(job=>`<option value="${esc(job.id)}">${esc(job.keyword)} · ${job.rows.filter(row=>row.status==='verified').length} 件已确认 · ${esc(date(job.createdAt))}</option>`).join(''):'<option value="">还没有已确认入箱的采集批次</option>';
    if(available.some(job=>job.id===chosen))$('sourceBatch').value=chosen;
  }
  function renderGoods(reset=false){
    const job=source(),rows=job?.rows||[],verified=rows.filter(row=>row.status==='verified');
    if(reset)selectedGoods=new Set(verified.map(row=>row.goodsId));
    else selectedGoods=new Set([...selectedGoods].filter(id=>verified.some(row=>row.goodsId===id)));
    $('sourceBatchSummary').textContent=job?`${job.binding?.erpConnection?.name||'关联账号'} · 已确认通用采集记录 ${verified.length} / 目标 ${job.limit??rows.length} 件；各店认领结果需继续核对。选择范围仅限这个采集批次。`:'';
    $('batchGoods').innerHTML=rows.length?rows.map(row=>`<label class="batch-good${row.status==='verified'?'':' unavailable'}"><input type="checkbox" data-good="${esc(row.goodsId)}" ${row.status==='verified'?'':'data-unavailable disabled'} ${selectedGoods.has(row.goodsId)?'checked':''}><span>${esc(row.title||row.goodsId)}<small>${esc(row.goodsId)} · ${row.status==='verified'?'已确认通用采集记录':row.status==='skipped-duplicate'?'前端提示重复，已跳过，不计入本批认领':'尚未确认入箱，本次不能选择'}</small></span></label>`).join(''):'<p class="empty">先完成一批免费选品采集。</p>';
    $('selectBatchGoods').checked=!!verified.length&&selectedGoods.size===verified.length;$('selectBatchGoods').indeterminate=selectedGoods.size>0&&selectedGoods.size<verified.length;renderDestinationGroups();renderExecutionSummary();
  }
  function renderExecutionSummary(){
    const current=template(),job=source();
    $('executionSummary').textContent=automatic()?`本次选择 ${selectedGoods.size} 件来源商品 · ${selectedDestinations.size} 家采集箱店铺。建立任务后核对认领、确认分类，再补齐属性、保存回读并转入待发布。原生批量能力和可用操作会按当前平台显示。`:current&&job&&current.erpKey!==erpKeyOf(job)?'当前模板与采集批次属于不同店小秘账号，请选择同一账号的模板。':`本次选择 ${selectedGoods.size} 件来源商品 · ${selectedStores.size} 家店铺${current?` · 模板 v${current.version}`:''}。店铺选择只影响本次任务。`;
    controls();
  }
  function safeDraftUrl(row){
    const value=row.platformEditUrl||row.evidence?.draftUrl||row.draftUrl||row.editUrl;
    if(!value)return '';
    try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['www.dianxiaomi.com','dianxiaomi.com'].includes(url.hostname)&&/^\/web\//.test(url.pathname)?url.href:'';}catch{return '';}
  }
  const categoryKey=(job,row)=>JSON.stringify([job.id,row.goodsId,row.storeBindingKey]);
  const categoryEditable=row=>row.locationStatus==='located'&&!row.saved&&!row.nativeCategoryIntent&&!row.saveIntent&&!row.moveIntent&&!row.publishIntent;
  const chosenCategory=row=>row.categorySelection?.category||row.categorySelection||row.category;
  const sourceFactsOf=(job,row)=>row.sourceFacts||job.sourceRows?.find(source=>source.goodsId===row.goodsId)?.sourceFacts||{};
  const sourceStateOf=(job,row)=>{
    const facts=sourceFactsOf(job,row),status=row.sourceFactsStatus||{},price=facts.price,categoryPath=status.categoryPath||facts.categoryPath||[],selectedVariant=facts.selectedVariant;
    return {facts,status,price,categoryPath,selectedVariant,priceReady:status.priceReady,categoryReady:status.categoryReady??categoryPath.length>0};
  };
  const completedRow=row=>row.saved===true&&row.ready===true&&row.publicationStatus==='draft'&&(row.movedToPending===true||row.moveIntent?.status==='confirmed')&&!(row.issues||[]).length&&![row.saveIntent,row.moveIntent,row.publishIntent].some(intent=>intent&&intent.status!=='confirmed');
  const waitingPrice=(job,row)=>sourceStateOf(job,row).priceReady===false||(row.issues||[]).some(issue=>/价格|售价|币种|货币|price|currency/i.test(issueText(issue)));
  const waitingCategory=(job,row)=>!chosenCategory(row)?.path?.length||['waiting-category','needs-category'].includes(row.status);
  function batchProgress(job){
    if(!automaticJob(job))return '';
    const groups=new Map();for(const row of job.rows||[]){if(!groups.has(row.goodsId))groups.set(row.goodsId,[]);groups.get(row.goodsId).push(row);}
    const all=[...groups.values()],done=all.filter(rows=>rows.every(completedRow)).length,category=all.filter(rows=>rows.some(row=>!completedRow(row)&&waitingCategory(job,row))).length,price=all.filter(rows=>rows.some(row=>!completedRow(row)&&waitingPrice(job,row))).length;
    return `<div class="batch-progress" aria-label="本批处理进度"><strong>${all.length} 件中</strong><span data-batch-count="completed">${done} 件已全部转待发布</span><span data-batch-count="category">${category} 件待分类</span><span data-batch-count="price">${price} 件待核对店铺价</span>${all.some(rows=>rows.some(row=>!completedRow(row)&&waitingCategory(job,row))&&rows.some(row=>!completedRow(row)&&waitingPrice(job,row)))?'<small class="muted">同一商品可能同时待分类和待核对店铺价。</small>':''}</div>`;
  }
  function sourceFactsPanel(job,row){
    if(!automaticJob(job))return '';
    const {facts,price,categoryPath,selectedVariant,priceReady}=sourceStateOf(job,row),attributes=selectedVariant?.attributes||[];
    const displayedPrice=price?.amount&&price?.currency?`${price.amount} ${price.currency}`:'尚未读取；不影响保留店小秘已有售价';
    return `<div class="row-source-facts"><dl><div><dt>Temu 来源分类</dt><dd>${esc(categoryPath.join(' → ')||'待补读来源分类')}</dd></div><div><dt>店小秘售价</dt><dd>${priceReady===true?'已有售价已读取，保存时核对前后不变':priceReady===false?'当前店铺售价待核对；不会用默认值覆盖':'保留已有换算价，填写时读取并核对'}</dd></div><div><dt>Temu 来源售价（仅对照）</dt><dd class="source-price">${esc(displayedPrice)}</dd></div><div><dt>来源对应规格</dt><dd>${esc(attributes.length?attributes.map(item=>`${item.name}：${item.value}`).join(' · '):selectedVariant?.selectionComplete?'已确认无规格选项':'尚未读取来源规格')}</dd></div></dl>${facts.observedAt?`<p class="small muted">来源读取时间：${esc(date(facts.observedAt))}</p>`:''}</div>`;
  }
  function sameSourceCategoryRows(job,row){
    const source=sourceStateOf(job,row),path=source.categoryPath,confirmation=row.productTypeConfirmation,type=normalizedType(confirmation?.productType);
    if(!source.categoryReady||!path.length||!type)return [row];
    const identity=JSON.stringify(path.map(part=>String(part).normalize('NFKC').trim()));
    const confirmedPath=value=>JSON.stringify((value?.sourcePath||[]).map(part=>String(part).normalize('NFKC').trim()));
    if(confirmedPath(confirmation)!==identity)return [row];
    return job.rows.filter(item=>item.storeBindingKey===row.storeBindingKey&&categoryEditable(item)&&sourceStateOf(job,item).categoryReady&&normalizedType(item.productTypeConfirmation?.productType)===type&&confirmedPath(item.productTypeConfirmation)===identity&&JSON.stringify(sourceStateOf(job,item).categoryPath.map(part=>String(part).normalize('NFKC').trim()))===identity);
  }
  const normalizedType=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  function searchForm(job,row){
    const key=categoryKey(job,row);
    if(!categorySearchForms.has(key))categorySearchForms.set(key,{query:row.productTypeConfirmation?.productType||String(row.title||'').slice(0,160),productType:row.productTypeConfirmation?.productType||'',usage:row.categoryProductUsage||'',confirmType:false,scope:'row',goodsIds:new Set([row.goodsId])});
    return categorySearchForms.get(key);
  }
  function categorySearchPeers(job,row,form){
    const path=sourceFactsOf(job,row).categoryPath||[],type=normalizedType(form.productType);
    if(!path.length||!type)return [row];
    const identity=JSON.stringify(path.map(value=>String(value).normalize('NFKC').trim()));
    return job.rows.filter(item=>{
      const confirmed=item.productTypeConfirmation;
      return item.storeBindingKey===row.storeBindingKey&&categoryEditable(item)&&JSON.stringify((sourceFactsOf(job,item).categoryPath||[]).map(value=>String(value).normalize('NFKC').trim()))===identity&&(item===row||!confirmed||normalizedType(confirmed.productType)===type);
    });
  }
  const sameCandidate=(one,two)=>one?.candidateId===two?.candidateId&&one?.platformCategoryId===two?.platformCategoryId&&one?.label===two?.label&&JSON.stringify(one?.path)===JSON.stringify(two?.path);
  function searchCategoryPanel(job,row,summary,current){
    const form=searchForm(job,row),catalog=categoryCatalogs.get(categoryKey(job,row)),result=catalog?.mode==='search'?catalog:null,peers=categorySearchPeers(job,row,form),identity=`data-goods="${esc(row.goodsId)}" data-store="${esc(row.storeBindingKey)}"`;
    const selected=result?.selected,expired=result&&Date.parse(result.expiresAt)<=Date.now(),resolution=result?.resolution;
    const proposed=result?.candidates.find(candidate=>sameCandidate(candidate,resolution?.proposedCandidate||resolution?.category));
    const resolutionLabel=resolution?.status==='resolved'?'已复用确认过的具体类型映射':resolution?.method==='model-ranking'?'模型排序建议，尚未确认':resolution?.status==='unresolved'?'分类尚未确定':'店铺候选，等待确认';
    const members=peers.filter(item=>form.goodsIds.has(item.goodsId)),canBatch=peers.length>1&&form.productType.trim();
    return `<div class="row-category category-search" ${identity}>${summary}${current}<div class="category-search-fields"><label>中文分类关键词<input data-category-field="query" maxlength="160" value="${esc(form.query)}" placeholder="输入具体商品名，例如便携式果汁机"></label><label>具体商品类型（用于同类复用，可选）<input data-category-field="product-type" maxlength="160" value="${esc(form.productType)}" placeholder="区分实际商品类型，不只填上级大类"></label><label>已知用途（可选）<input data-category-field="usage" maxlength="1200" value="${esc(form.usage)}" placeholder="只填写商品资料已说明的用途"></label><button type="button" data-category-action="search">搜索本店真实分类</button><p class="small muted">读取当前店铺的中文搜索或推荐结果。模型只排列实际候选，不代替分类确认。</p></div>${result?`<div class="category-search-result"><div class="category-suggestion"><strong>${esc(resolutionLabel)}</strong><p class="small">${esc(resolution?.reason||'核对完整分类路径后再确认。')}</p>${proposed?`<p class="small">${resolution?.status==='resolved'?'已确认对应':'建议核对'}：${esc(proposed.path.join(' → '))}</p>`:''}${resolution?.modelReason?`<p class="small muted">建议依据：${esc(resolution.modelReason)}</p>`:''}</div>${expired?'<p class="error small">这次候选已过期，请重新搜索；不会使用旧候选继续确认。</p>':''}${result.candidates.length?`<fieldset class="category-candidates"><legend>店铺实际末级分类 · ${result.candidates.length} 项</legend>${result.candidates.map((candidate,index)=>`<label class="category-candidate"><input type="radio" name="category-${esc(result.catalogId)}" data-category-candidate value="${index}" ${selected===candidate?'checked':''} ${expired?'data-unavailable="expired"':''}><span><strong>${esc(candidate.path.join(' → '))}</strong><small>${candidate.source==='store-recommendation'?'店铺推荐':'店铺搜索'}${proposed===candidate?' · 建议核对':''}${result.candidates.filter(item=>JSON.stringify(item.path)===JSON.stringify(candidate.path)).length>1?' · '+esc(candidate.platformCategoryId?'平台类目 ID '+candidate.platformCategoryId:'候选 '+(index+1)):''}</small></span></label>`).join('')}</fieldset>`:'<p class="small muted">没有取得真实末级候选，请调整关键词；其他已确认商品可继续处理。</p>'}${selected?`<div class="category-selection"><p class="small">将确认：<strong>${esc(selected.path.join(' → '))}</strong></p><label class="category-type-confirm"><input type="checkbox" data-category-field="confirm-type" ${form.confirmType?'checked':''}><span>我已核对，本次勾选商品均属于上方填写的具体商品类型</span></label>${form.confirmType&&!form.productType.trim()?'<p class="small error">请填写具体商品类型，或取消类型确认并仅确认当前商品。</p>':''}<label>应用范围<select data-category-field="scope"><option value="row" ${form.scope==='row'?'selected':''}>仅当前商品与店铺</option>${canBatch?`<option value="batch" ${form.scope==='batch'?'selected':''}>手动选择本店同来源路径的同类商品</option>`:''}</select></label>${form.scope==='batch'&&canBatch?`<fieldset class="category-batch-members"><legend>逐件核对具体类型 · 已选 ${members.length} 件</legend>${peers.map(item=>`<label class="category-batch-member"><input type="checkbox" data-category-field="member" data-member-goods="${esc(item.goodsId)}" ${form.goodsIds.has(item.goodsId)?'checked':''} ${item.goodsId===row.goodsId?'data-unavailable="anchor"':''}><span>${esc(item.title||item.goodsId)}<small>${item.goodsId===row.goodsId?'当前搜索商品':item.productTypeConfirmation?'已确认类型：'+esc(item.productTypeConfirmation.productType):'具体类型尚未确认，请核对后勾选'}</small></span></label>`).join('')}<p class="small muted">仅列出同店、同完整来源路径的未保存商品；不同已确认类型不纳入。</p></fieldset>`:''}<button type="button" class="primary" data-category-action="resolve" ${expired?'data-unavailable="expired"':''}>${form.scope==='batch'&&canBatch?'确认所选 '+members.length+' 件商品分类':'确认本商品分类'}</button></div>`:''}</div>`:''}</div>`;
  }
  function categoryPanel(job,row){
    if(!automaticJob(job))return '';
    const saved=chosenCategory(row),chosenPath=saved?.path||[],storedCatalog=categoryCatalogs.get(categoryKey(job,row)),catalog=storedCatalog?.mode==='search'?null:storedCatalog;
    const fields=row.requiredFields||row.inspection?.requiredFields||[],missing=fields.filter(field=>field.missing===true||field.empty===true);
    const summary=!chosenPath.length?`<p class="small muted">已读取 ${fields.length} 项基础字段；分类确认后继续读取完整必填项。</p>`:fields.length?`<p class="small muted">已读取 ${fields.length} 个必填项${missing.length?' · 待补：'+missing.map(field=>esc(field.label||field.name||'必填项')).join('、'):row.saved&&row.ready?' · 已保存并回读核对':' · 当前读取范围内无空项，保存前继续核对分类联动字段'}</p>`:'';
    const current=`<p class="small"><strong>产品分类：</strong>${esc(chosenPath.join(' → ')||'等待选择正确分类')}</p>`;
    if(!categoryEditable(row)||job.needsReconcile)return `<div class="row-category">${summary}${current}${row.locationStatus!=='located'?'<p class="small muted">定位店铺商品后可读取分类选项。</p>':job.needsReconcile?'<p class="small muted">已有执行结果待核对，完成核对后再修改分类。</p>':''}</div>`;
    if(job.categorySearch?.supported===true)return searchCategoryPanel(job,row,summary,current);
    const identity=`data-goods="${esc(row.goodsId)}" data-store="${esc(row.storeBindingKey)}"`;
    if(!catalog)return `<div class="row-category" ${identity}>${summary}${current}<button type="button" data-category-action="read">${chosenPath.length?'修改分类':'读取并选择分类'}</button></div>`;
    const selected=catalog.selected,path=catalog.path||[],sameSourceRows=sameSourceCategoryRows(job,row),suggestion=catalog.suggestion;
    const suggestionMarkup=suggestion?`<div class="category-suggestion"><p class="small">${esc(suggestion.reason||'请确认来源类别与目标平台分类的对应关系')}</p>${suggestion.category?.path?.length?`<p class="small">对应目标：${esc(suggestion.category.path.join(' → '))}</p>`:''}</div>`:'';
    return `<div class="row-category" ${identity}>${summary}${current}${suggestionMarkup}<div class="category-trail"><span>${esc(path.join(' → ')||'从一级分类开始选择')}</span>${path.length?'<button type="button" data-category-action="back">返回上一级</button>':''}<button type="button" data-category-action="read">重新读取</button></div><label>当前层级分类<select data-category-option aria-label="当前层级分类"><option value="">请选择分类</option>${(catalog.options||[]).map((option,index)=>`<option value="${index}" ${selected===option?'selected':''}>${esc(option.label)}${option.leaf?'':' ›'}</option>`).join('')}</select></label>${selected?.leaf?`<div class="category-selection"><p class="small">已选末级：<strong>${esc(selected.path.join(' → '))}</strong></p><label>应用范围<select data-job-field="category-scope" ${identity}><option value="row">仅当前商品与店铺</option>${sameSourceRows.length>1?`<option value="batch">本店已确认同类型的 ${sameSourceRows.length} 件商品</option>`:''}</select></label><button type="button" class="primary" data-category-action="select">确认使用此分类</button></div>`:'<p class="small muted">逐级选择至末级分类，再确认应用范围。</p>'}${catalog.options?.length?'':'<p class="small muted">本层没有可用分类，请返回上一级或重新读取。</p>'}</div>`;
  }
  function nativeProgress(job){
    if(!automaticJob(job)||job.nativeBatch?.ready!==true)return '';
    const progress=job.progress||{},phase=progress.phase,stage=progress.stage||'',active=progress.active===true;
    const current=phase==='pending'?2:phase==='verify'||phase==='prepare'&&/save|readback|verif/i.test(stage)?1:phase==='prepare'||phase==='native-select'?0:-1;
    const count=phase==='native-select'&&Number.isSafeInteger(progress.selected)&&Number.isSafeInteger(progress.total)?` · 已选 ${progress.selected}/${progress.total}`:'';
    return `<div class="native-flow" aria-label="本平台原生批量流程"><strong>本平台已接通原生批量处理</strong><ol>${['批量填写属性与必填项','保存并回读核对','转入待发布'].map((label,index)=>`<li ${active&&index===current?'class="active" aria-current="step"':''}>${index+1}. ${label}</li>`).join('')}</ol><p class="small muted">按店铺与已确认分类分组，只处理本批范围。未确认分类的商品单独等待，其他组继续执行。</p>${progress.message?`<p class="small native-progress-message" role="status">${active?'当前进度':'最近进度'}：${esc(progress.message)}${esc(count)}</p>`:''}</div>`;
  }
  function renderJob(job){
    const auto=automaticJob(job),hasProcess=auto&&actionAllowed(job,'process'),buttons=[['inspect','核对认领与资料'],['claim',auto?'领取到所选店铺':'按分配模板认领缺失商品'],['source-facts','补读 Temu 来源资料（只读）'],['process','继续处理本批到待发布'],['prepare',auto?'逐件补齐本批必填项并保存':'按模板填写并保存'],['pending','逐件将已就绪商品转入待发布'],['review-corrections','核对包装修改'],['publish','提交发布'],['reconcile','只核对结果'],['stop','暂停后续条目']].filter(([action])=>actionAllowed(job,action)&&!(hasProcess&&['prepare','pending'].includes(action)));
    const nativeStores=actionAllowed(job,'native-edit')?[...new Map((job.rows||[]).filter(categoryEditable).map(row=>[row.storeBindingKey,{key:row.storeBindingKey,name:row.storeName,site:row.site}])).values()]:[];
    const nativeNotice=auto&&job.nativeBatch?.ready===false?`<div class="native-batch-notice" role="note"><strong>原生批量自动填充待接通</strong><p>${nativeStores.length?'可先打开店小秘本店本批的原生批量编辑页面；自动填写与保存尚未接通。':esc(job.nativeBatch.reason||'当前平台尚未接通完整原生批量填写、保存与转待发布。')}</p>${buttons.some(([action])=>['prepare','pending'].includes(action))?'<p>下方“逐件”按钮会逐个处理本批可执行商品。</p>':''}</div>`:'';
    const nativeControls=nativeStores.length?`<div class="native-store-actions">${nativeStores.map(store=>`<div><p class="small">${esc(store.name)}${store.site?' · '+esc(store.site):''}</p><button type="button" data-job-action="native-edit" data-job-store="${esc(store.key)}">打开本店原生批量编辑</button></div>`).join('')}<p class="small muted">仅打开所选店铺、本批未保存商品的原生编辑范围，不填写或保存。</p></div>`:'';
    const heading=auto?(job.keyword?job.keyword+' · 必填补全':'本批必填补全'):job.templateSnapshot?.name||'上架任务';
    return `<article class="listing-job" id="job-${esc(job.id)}" data-job="${esc(job.id)}"><div class="job-head"><div><h3>${esc(heading)}</h3><time>${esc(date(job.createdAt))}${auto?' · 完成后进入待发布':' · 模板 v'+esc(job.templateSnapshot?.version||'—')}</time></div><span class="state ${esc(job.status)}">${esc(labels[job.status]||job.status)}</span></div><p>${esc(job.message||'任务已保存，等待核对。')}</p><p class="small muted">${new Set((job.rows||[]).map(row=>row.goodsId)).size} 件来源商品 · ${(job.rows||[]).length} 条店铺记录</p>${batchProgress(job)}${auto?'<p class="job-policy small muted">分类对应具体商品类型；售价保留店小秘已有换算值，保存前后核对不变，不再换算。普通属性空项使用当前平台表单的可用值。来源售价只供对照，缺少来源售价不阻塞补全。</p>':''}${nativeNotice}${nativeProgress(job)}${nativeControls}<div class="actions">${buttons.map(([action,label])=>`<button type="button" data-job-action="${action}" ${['process','prepare','pending','publish'].includes(action)?'class="primary"':''}>${label}</button>`).join('')}</div>${actionAllowed(job,'source-facts')?'<p class="source-read-hint small muted">补读会按需打开 Temu 商品页，只读取当前显示的分类、规格和售价；来源售价仅供对照。</p>':''}<ul class="job-rows">${(job.rows||[]).map(row=>{
      const url=safeDraftUrl(row),issues=row.issues||[];
      return `<li class="job-row"><div class="job-row-head"><strong>${esc(row.storeName)}${row.site?' · '+esc(row.site):''}</strong><span class="state ${esc(row.status)}">${esc(labels[row.publicationStatus]||labels[row.status]||row.status)}</span></div><p class="row-title">${esc(row.title||row.goodsId)}</p><p class="small muted">来源 ${esc(row.goodsId)}${row.draftId?' · 店铺记录 '+esc(row.draftId):''}${url?` · <a href="${esc(url)}" target="_blank" rel="noreferrer">查看店小秘商品 ↗</a>`:''}</p>${sourceFactsPanel(job,row)}${row.saved===true&&row.saveIntent?.status==='confirmed'&&row.ready!==true&&!row.published&&!row.moveIntent&&!row.publishIntent?'<p class="small">草稿已保存并回读，仍有待补项。</p>':''}${row.message?`<p class="small">${esc(row.message)}</p>`:''}${row.error?`<p class="error small">${esc(row.error)}</p>`:''}${issues.length?`<ul>${issues.map(issue=>`<li>${esc(issueText(issue))}</li>`).join('')}</ul>`:''}${categoryPanel(job,row)}</li>`;
    }).join('')}</ul></article>`;
  }
  function renderJobs(force=false){
    // Keep active selectors and text composition intact. A later poll or the
    // action's refresh renders new rows after the user finishes interacting.
    const jobFieldsFocused=$('listingJobs').contains(document.activeElement)&&document.activeElement?.matches('[data-job-field],[data-category-option],[data-category-field],[data-category-candidate]');
    if(jobFieldsFocused&&!acting&&!force){$('jobCount').textContent=`${state.jobs.length} 个任务`;controls();return;}
    const keptDetails=new Map([...$('listingJobs').querySelectorAll('details.allocation-settings')].map(details=>[details.closest('[data-job]').dataset.job,details.open]));
    const keptFields=[...document.querySelectorAll('[data-job-field]')].map(input=>({job:input.closest('[data-job]').dataset.job,field:input.dataset.jobField,goods:input.dataset.goods||'',store:input.dataset.store||'',value:input.value}));
    $('jobCount').textContent=`${state.jobs.length} 个任务`;
    $('listingJobs').innerHTML=state.jobs.map(renderJob).join('')||'<p class="empty">选择本批商品和目标店铺后，建立补全任务。</p>';
    for(const article of $('listingJobs').querySelectorAll('[data-job]')){
      const job=state.jobs.find(item=>item.id===article.dataset.job),catalog=job.allocationCatalog?.templates||[];
      const allocation=document.createElement('details');allocation.className='allocation-settings';allocation.open=keptDetails.get(job.id)===true;
      allocation.innerHTML=`<summary>认领分配模板${job.allocationSnapshot?`：${esc(job.allocationSnapshot.name)}`:'：尚未绑定'}</summary><p class="small muted">从店小秘读取已人工绑定的模板。当前任务要求分配目的地与本次处理店铺一致；已经入箱的商品会复用。</p><label>模板名称（可选）<input data-job-field="allocation-name" placeholder="例如：画板" value="${esc(job.allocationCatalog?.requestedName||'')}"></label><button type="button" data-allocation-action="sync">读取店小秘认领模板</button>${catalog.length?`<label>实际分配模板<select data-job-field="allocation-template"><option value="">请选择</option>${catalog.map(item=>`<option value="${esc(item.id)}" ${job.allocationSnapshot?.id===item.id?'selected':''}>${esc(item.name)} · ${item.destinations.length} 个目的地</option>`).join('')}</select></label><button type="button" data-allocation-action="select">绑定本次认领模板</button>`:''}${job.allocationSnapshot?`<ul>${job.allocationSnapshot.destinations.map(item=>`<li>${esc(item.platform==='temu'?'Temu半托管':item.platform)} · ${esc(item.storeName)} · ${esc(item.site)}</li>`).join('')}</ul>`:''}${job.claimIntent?`<p class="small">认领提交：${esc(job.claimIntent.status==='confirmed'?'已回查确认':'结果待回查，不重复提交')}</p>`:''}`;
      if(!automaticJob(job))article.querySelector('.actions').before(allocation);
      [...article.querySelectorAll('.job-row')].forEach((element,index)=>{
        const row=job.rows[index],candidates=row.inspection?.candidates||[];
        if(row.locationStatus!=='ambiguous'&&!row.resolvedTarget)return;
        if(row.resolvedTarget){const note=document.createElement('p');note.className='small muted';note.textContent=`已指定草稿 ${row.resolvedTarget.draftId}，执行前再次核对身份。`;element.append(note);return;}
        if(!candidates.length)return;
        const choice=document.createElement('div');choice.className='candidate-choice';choice.innerHTML=`<label>选择本次处理的实际草稿<select data-job-field="candidate" data-goods="${esc(row.goodsId)}" data-store="${esc(row.storeBindingKey)}"><option value="">请选择已核对的记录</option>${candidates.map(item=>`<option value="${esc(item.draftId)}">${esc(candidateLabel(item))}</option>`).join('')}</select></label><button type="button" data-resolve-goods="${esc(row.goodsId)}" data-resolve-store="${esc(row.storeBindingKey)}">使用这条记录</button>`;element.append(choice);
      });
    }
    for(const input of document.querySelectorAll('[data-job-field]')){
      const old=keptFields.find(item=>item.job===input.closest('[data-job]').dataset.job&&item.field===input.dataset.jobField&&item.goods===(input.dataset.goods||'')&&item.store===(input.dataset.store||''));
      if(old&&(!input.options||[...input.options].some(option=>option.value===old.value)))input.value=old.value;
    }
    controls();
  }
  async function recoverPendingRequest(){
    const request=pending;if(!request?.requestId)return;
    if(state.jobs.some(job=>job.id===request.requestId||job.requestId===request.requestId)){remember(null);return;}
    try{
      // A deduplicated request can be an alias of an older task ID.
      const job=await api(`listing-workflow/jobs/${encodeURIComponent(request.requestId)}`);
      if(pending!==request)return;
      if(!job?.id)throw new Error('上一条建立任务请求的返回记录不完整，请继续刷新核对。');
      const index=state.jobs.findIndex(item=>item.id===job.id);if(index<0)state.jobs.unshift(job);else state.jobs[index]=job;
      remember(null);
    }catch(error){if(error.status!==404)throw error;}
  }
  async function refreshJobs(){state=await api('listing-workflow');state.jobs??=[];workflowReady=true;try{await recoverPendingRequest();}finally{renderJobs();}}
  async function refreshAll(){
    const previousTemplate=$('activeTemplate').value,previousSource=$('sourceBatch').value;
    const results=await Promise.allSettled([api('listing-templates'),api('free-sourcing'),api('listing-workflow'),api('settings')]);
    if(results[3].status==='fulfilled')settings=results[3].value;
    if(results[0].status==='fulfilled'){templates=results[0].value.templates||[];renderTemplateOptions(previousTemplate);renderTemplateSummary(previousTemplate!==$('activeTemplate').value);}
    if(results[1].status==='fulfilled'){sourceJobs=results[1].value.jobs||[];renderSources(previousSource||sourceParam);renderGoods(previousSource!==$('sourceBatch').value);}
    if(results[2].status==='fulfilled'){state=results[2].value;state.jobs??=[];workflowReady=true;try{await recoverPendingRequest();}finally{renderJobs();}}else workflowReady=false;
    const failures=results.filter(result=>result.status==='rejected');if(failures.length)throw failures[0].reason;
    renderDestinationGroups();renderMode();controls();
  }
  async function action(fn){if(acting)return;acting=true;controls();try{await fn();}catch(error){show(error.message,true);}finally{acting=false;controls();}}

  $('templateForm').addEventListener('input',dirty);$('templateForm').addEventListener('change',dirty);
  $('templateInventoryMode').onchange=controls;
  $('clearPackageDefaults').onclick=()=>{for(const id of Object.values(packageFields))$(id).value='';dirty();};
  $('newTemplate').onclick=()=>action(async()=>{requireCleanEditor();loadEditor(null);$('templateName').focus();});
  $('editTemplate').onclick=()=>action(async()=>{requireCleanEditor();loadEditor(template());});
  $('copyTemplate').onclick=()=>action(async()=>{requireCleanEditor();const current=template();if(!current)return;const copied=await api(`listing-templates/${encodeURIComponent(current.id)}/copy`,{name:`${current.name}（副本）`,version:current.version});templates=(await api('listing-templates')).templates;renderTemplateOptions(copied.id);renderTemplateSummary(true);loadEditor(copied);show(`已保存模板副本“${copied.name}”，可以修改后继续保存。`);});
  $('cancelTemplateEdit').onclick=()=>{loadEditor(editor);$('templateEditor').open=false;};
  $('addAttribute').onclick=()=>{attributeRow();dirty();};$('addStoreBinding').onclick=()=>{bindingRow();dirty();};
  $('attributeRows').onclick=event=>{const button=event.target.closest('[data-remove-attribute]');if(button){button.closest('.attribute-row').remove();dirty();}};
  $('storeBindingRows').onclick=event=>{const button=event.target.closest('[data-remove-binding]');if(button){button.closest('.store-binding').remove();dirty();}};
  $('templateForm').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{const saved=await api('listing-templates',readTemplate());templates=(await api('listing-templates')).templates;renderTemplateOptions(saved.id);renderTemplateSummary(true);loadEditor(saved);$('templateSaveStatus').textContent=`已长期保存 · v${saved.version}`;show(`固定模板“${saved.name}”已保存，后续批次可直接使用。`);});});
  $('activeTemplate').onchange=()=>renderTemplateSummary(true);
  $('listingMode').onchange=()=>renderMode();
  $('destinationGroup').onchange=()=>{selectedDestinations=new Set(destinations().map(store=>store.key));renderStoreChoices();renderExecutionSummary();};
  $('sourceBatch').onchange=()=>{renderGoods(true);const job=source();const url=new URL(location.href);if(job)url.searchParams.set('freeJobId',job.id);else url.searchParams.delete('freeJobId');history.replaceState(null,'',url);};
  $('batchGoods').onchange=event=>{const input=event.target.closest('[data-good]');if(!input||input.disabled)return;input.checked?selectedGoods.add(input.dataset.good):selectedGoods.delete(input.dataset.good);const total=(source()?.rows||[]).filter(row=>row.status==='verified').length;$('selectBatchGoods').checked=!!total&&selectedGoods.size===total;$('selectBatchGoods').indeterminate=selectedGoods.size>0&&selectedGoods.size<total;renderExecutionSummary();};
  $('selectBatchGoods').onchange=()=>{selectedGoods=$('selectBatchGoods').checked?new Set((source()?.rows||[]).filter(row=>row.status==='verified').map(row=>row.goodsId)):new Set();renderGoods();};
  $('runStoreChoices').onchange=event=>{const input=event.target.closest('[data-run-store],[data-run-destination]');if(!input)return;const values=input.dataset.runDestination?selectedDestinations:selectedStores,key=input.dataset.runDestination||input.dataset.runStore;input.checked?values.add(key):values.delete(key);renderExecutionSummary();};
  $('listingJobForm').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{
    if(automatic()&&!collectionFeaturesReady())throw new Error(collectionBackendMessage);
    if(pending)throw new Error('请先刷新核对上次建立任务的结果。');
    const current=template(),job=source();if(!job||!selectedGoods.size)throw new Error('请选择本批已确认入箱的商品。');
    let payload;
    if(automatic()){
      if(!selectedDestinations.size||![...selectedDestinations].every(key=>destinations().some(store=>store.key===key)))throw new Error('请选择同一账号、平台和站点的已绑定采集箱店铺。');
      payload={requestId:crypto.randomUUID(),sourceJobId:job.id,goodsIds:[...selectedGoods],destinationKeys:[...selectedDestinations]};
    }else{
      if(!current||!selectedStores.size)throw new Error('请选择固定模板和本次处理店铺。');if(erpKeyOf(job)!==current.erpKey)throw new Error('模板与采集批次的店小秘账号不一致。');
      payload={requestId:crypto.randomUUID(),freeJobId:job.id,goodsIds:[...selectedGoods],templateId:current.id,templateVersion:current.version,storeKeys:[...selectedStores]};
    }
    remember(payload);
    try{await api('listing-workflow/jobs',payload);remember(null);}catch(error){if(error.status)remember(null);throw error;}
    await refreshJobs();show(automatic()?'本批补全任务已保存。先核对并领取到目标店铺，再选择分类和补齐必填项。':'本批上架任务已保存。可先核对认领记录和商品资料。');
  });});
  async function readCategories(job,row,path=[]){
    if(!categoryEditable(row))throw new Error('当前商品已保存或状态发生变化，请刷新核对后继续。');
    const catalog=await api(`listing-workflow/jobs/${encodeURIComponent(job.id)}/categories/read`,{goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,path});
    if(typeof catalog.catalogId!=='string'||!catalog.catalogId||!Array.isArray(catalog.options)||catalog.options.some(option=>!option||typeof option.id!=='string'||typeof option.label!=='string'||!Array.isArray(option.path)||option.path.some(part=>typeof part!=='string')||typeof option.leaf!=='boolean'))throw new Error('分类选项返回不完整，请重新读取。');
    const suggested=catalog.suggestion?.status==='matched'?catalog.suggestion.category:null;
    const matching=suggested?catalog.options.filter(option=>option.leaf&&option.id===suggested.id&&option.label===suggested.label&&JSON.stringify(option.path)===JSON.stringify(suggested.path)):[];
    categoryCatalogs.set(categoryKey(job,row),{...catalog,path:Array.isArray(catalog.path)?catalog.path:path,selected:matching.length===1?matching[0]:null});renderJobs();
  }
  async function searchCategories(job,row){
    if(job.categorySearch?.supported!==true)throw new Error('当前平台尚未提供店铺分类搜索，请刷新核对可用操作。');
    const form=searchForm(job,row),query=form.query.trim(),key=categoryKey(job,row);
    if(!query)throw new Error('请输入具体商品的中文分类关键词。');
    categoryCatalogs.delete(key);form.scope='row';form.goodsIds=new Set([row.goodsId]);
    const catalog=await api(`listing-workflow/jobs/${encodeURIComponent(job.id)}/categories/search`,{goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,query,...(form.productType.trim()?{productType:form.productType.trim()}:{}),...(form.usage.trim()?{usage:form.usage.trim()}:{})});
    if(typeof catalog.catalogId!=='string'||!catalog.catalogId||typeof catalog.catalogDigest!=='string'||!catalog.catalogDigest||catalog.goodsId!==row.goodsId||catalog.storeBindingKey!==row.storeBindingKey||catalog.scope?.jobId!==job.id||catalog.scope?.storeBindingKey!==row.storeBindingKey||catalog.query!==query||!Number.isFinite(Date.parse(catalog.expiresAt))||!Array.isArray(catalog.candidates)||catalog.candidates.length>100||catalog.candidates.some(candidate=>!candidate||typeof candidate.candidateId!=='string'||!candidate.candidateId||candidate.leaf!==true||typeof candidate.label!=='string'||!Array.isArray(candidate.path)||!candidate.path.length||candidate.path.some(part=>typeof part!=='string'||!part.trim())||candidate.label!==candidate.path.at(-1)||!['store-search','store-recommendation'].includes(candidate.source))||new Set(catalog.candidates.map(candidate=>candidate.candidateId)).size!==catalog.candidates.length)throw new Error('店铺分类候选返回不完整或不属于当前商品，请重新搜索。');
    categoryCatalogs.set(key,{...catalog,mode:'search',selected:null});
    await refreshJobs();
  }
  async function resolveSearchCategory(job,row,catalog){
    if(!catalog||catalog.mode!=='search'||!catalog.selected||!catalog.candidates.includes(catalog.selected))throw new Error('请先勾选本次搜索得到的完整末级分类。');
    if(Date.parse(catalog.expiresAt)<=Date.now()){categoryCatalogs.delete(categoryKey(job,row));renderJobs();throw new Error('分类候选已过期，请重新搜索。');}
    const form=searchForm(job,row),type=form.productType.trim();
    if(form.confirmType&&!type)throw new Error('请填写具体商品类型，或取消类型确认并仅确认当前商品。');
    if(form.scope==='batch'&&(!form.confirmType||!type))throw new Error('批量确认前，请明确填写并确认所选商品的具体类型。');
    const peers=categorySearchPeers(job,row,form),rows=form.scope==='batch'?peers.filter(item=>form.goodsIds.has(item.goodsId)):[row];
    if(!rows.includes(row)||form.scope==='batch'&&rows.length!==form.goodsIds.size)throw new Error('所选商品的类型、来源路径或保存状态已变化，请重新核对范围。');
    try{await api(`listing-workflow/jobs/${encodeURIComponent(job.id)}/categories/resolve`,{catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:catalog.selected.candidateId,goodsIds:rows.map(item=>item.goodsId),storeBindingKey:row.storeBindingKey,...(type?{productType:type}:{}),confirmProductType:form.confirmType});}
    catch(error){if(error.status===409){categoryCatalogs.delete(categoryKey(job,row));renderJobs();}throw error;}
    for(const item of rows){categoryCatalogs.delete(categoryKey(job,item));categorySearchForms.delete(categoryKey(job,item));}
    show(`已明确确认 ${rows.length} 件商品的分类。可继续执行本批可处理商品，其余待分类项单独保留。`);
  }
  function categoryContext(element){
    const article=element.closest('[data-job]'),panel=element.closest('.row-category'),job=state.jobs.find(item=>item.id===article?.dataset.job),row=job?.rows.find(item=>item.goodsId===panel?.dataset.goods&&item.storeBindingKey===panel?.dataset.store);
    if(!job||!row||!categoryEditable(row)||job.needsReconcile)throw new Error('当前商品状态已变化，请刷新后继续选择分类。');
    return {job,row,panel,catalog:categoryCatalogs.get(categoryKey(job,row))};
  }
  function updateSearchField(field){
    const {job,row}=categoryContext(field),form=searchForm(job,row),kind=field.dataset.categoryField;
    if(kind==='query'||kind==='usage'){form[kind]=field.value;categoryCatalogs.delete(categoryKey(job,row));}
    if(kind==='product-type'&&form.productType!==field.value){form.productType=field.value;form.confirmType=false;form.scope='row';form.goodsIds=new Set([row.goodsId]);categoryCatalogs.delete(categoryKey(job,row));}
    if(kind==='confirm-type')form.confirmType=field.checked;
    if(kind==='scope')form.scope=field.value;
    if(kind==='member'&&field.dataset.memberGoods!==row.goodsId)field.checked?form.goodsIds.add(field.dataset.memberGoods):form.goodsIds.delete(field.dataset.memberGoods);
  }
  $('listingJobs').oninput=event=>{const field=event.target.closest('[data-category-field]');if(!field||field.disabled||!['query','product-type','usage'].includes(field.dataset.categoryField))return;try{updateSearchField(field);field.closest('.row-category').querySelector('.category-search-result')?.remove();}catch(error){show(error.message,true);}};
  $('listingJobs').onchange=event=>{
    const field=event.target.closest('[data-category-field]');
    if(field&&!field.disabled){try{updateSearchField(field);if(!['query','product-type','usage'].includes(field.dataset.categoryField))renderJobs(true);}catch(error){show(error.message,true);}return;}
    const candidate=event.target.closest('[data-category-candidate]');
    if(candidate&&!candidate.disabled){void action(async()=>{const {catalog}=categoryContext(candidate);if(catalog?.mode!=='search'||!catalog.candidates[Number(candidate.value)])throw new Error('分类候选已变化，请重新搜索。');catalog.selected=catalog.candidates[Number(candidate.value)];renderJobs();});return;}
    const select=event.target.closest('[data-category-option]');if(!select||select.disabled||select.value==='')return;void action(async()=>{
    const {job,row,catalog}=categoryContext(select),option=catalog?.options[Number(select.value)];if(!option)throw new Error('分类选项已变化，请重新读取。');
    if(option.leaf){catalog.selected=option;renderJobs();}else await readCategories(job,row,option.path);
  });};
  $('listingJobs').onclick=event=>{const button=event.target.closest('[data-job-action],[data-allocation-action],[data-resolve-goods],[data-category-action]');if(!button||button.disabled)return;void action(async()=>{
    const article=button.closest('[data-job]'),job=state.jobs.find(item=>item.id===article.dataset.job);if(!job)throw new Error('任务状态已变化，请刷新后继续。');
    const base=`listing-workflow/jobs/${encodeURIComponent(job.id)}`;
    if(button.dataset.categoryAction){
      const {row,panel,catalog}=categoryContext(button),kind=button.dataset.categoryAction;
      if(kind==='search'){await searchCategories(job,row);return;}
      if(kind==='resolve'){await resolveSearchCategory(job,row,catalog);await refreshJobs();return;}
      if(kind==='read'||kind==='back'){await readCategories(job,row,kind==='back'?(catalog?.path||[]).slice(0,-1):[]);return;}
      if(!catalog?.selected?.leaf||!catalog.catalogId)throw new Error('请先选择一个完整的末级分类。');
      const scope=panel.querySelector('[data-job-field="category-scope"]')?.value||'row';
      const rows=scope==='batch'?sameSourceCategoryRows(job,row):[row];
      if(scope==='batch'&&rows.length<2)throw new Error('当前没有同店、同来源路径且已确认同具体类型的商品，请使用当前商品范围。');
      if(rows.some(item=>!categoryEditable(item)))throw new Error('所选范围含有尚未定位或已经保存的商品，请使用当前商品范围选择分类。');
      await api(`${base}/categories/select`,{goodsIds:[...new Set(rows.map(item=>item.goodsId))],storeBindingKeys:[...new Set(rows.map(item=>item.storeBindingKey))],category:{id:catalog.selected.id,label:catalog.selected.label,path:catalog.selected.path},catalogId:catalog.catalogId});
      for(const item of rows)categoryCatalogs.delete(categoryKey(job,item));show('分类已确认。可继续处理本批，待分类或待价格的商品会单独保留。');
    }
    else if(button.dataset.allocationAction){const kind=button.dataset.allocationAction;await api(`${base}/allocation/${kind}`,kind==='sync'?{templateName:article.querySelector('[data-job-field="allocation-name"]').value.trim()||undefined}:{templateId:article.querySelector('[data-job-field="allocation-template"]').value});}
    else if(button.dataset.resolveGoods){const select=[...article.querySelectorAll('[data-job-field="candidate"]')].find(input=>input.dataset.goods===button.dataset.resolveGoods&&input.dataset.store===button.dataset.resolveStore);if(!select?.value)throw new Error('请先选择现场返回的具体草稿。');await api(`${base}/resolve`,{goodsId:button.dataset.resolveGoods,storeBindingKey:button.dataset.resolveStore,draftId:select.value});}
    else {const kind=button.dataset.jobAction;if(!actionAllowed(job,kind))throw new Error('任务状态已变化，请刷新后继续。');await api(`${base}/${kind}`,kind==='native-edit'?{storeBindingKey:button.dataset.jobStore}:{});}
    await refreshJobs();
  });};
  $('refreshWorkflow').onclick=()=>action(refreshAll);
  void(async()=>{
    if(new URLSearchParams(location.search).get('mode')==='template')$('listingMode').value='template';
    controls();({token}=await api('session'));settings=await api('settings');
    $('templateErp').innerHTML=settings.erpConnections.filter(item=>(item.provider||'dianxiaomi')==='dianxiaomi').map(item=>`<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('')||'<option value="">请先在连接设置添加账号</option>';
    await refreshAll();if(!templates.length)loadEditor(null);renderMode();
    setInterval(async()=>{if(polling||acting||document.hidden)return;polling=true;try{await refreshJobs();}catch(error){show(error.message,true);}finally{polling=false;controls();}},4000);
  })().catch(error=>{show(error.message,true);controls();});
})();
