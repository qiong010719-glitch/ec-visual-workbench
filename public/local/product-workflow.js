/* Product generation inside the shared store-listing workspace. */
window.createProductWorkflow=({request,notice,getStore,getMotherKey,getConnectionBinding,onState,onHistory,onReview})=>{
  const $=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let products=[],batch,timer,pending=0,requestId=crypto.randomUUID(),sourceFolder=null,renderingInputs=false;
  const labels={draft:'资料已保存',planning:'构思与标题生成中',ready:'方案与标题已就绪',generating:'正在生成图片',completed:'素材已完成',attention:'需要处理',interrupted:'执行曾中断',paused:'已暂停',pending:'待开始',recognizing:'识别产品与卖点',titles:'生成商品标题',failed:'失败'};
  const working=()=>!!batch&&(batch.titlesRegenerating||['planning','generating'].includes(batch.phase));
  const templateOptions=selected=>{const templates=getStore()?.templates||[],key=selected||getMotherKey();return (key&&!templates.some(t=>t.key===key)?`<option value="${escape(key)}" selected disabled>原母稿已移除，请重新选择</option>`:'')+templates.map(t=>`<option value="${escape(t.key)}" ${t.key===key?'selected':''}>${escape(t.name)}</option>`).join('')||'<option value="">请先选择店铺母稿</option>';};
  const briefFields=[
    ['category','商品类目','如：手机壳、装饰画、连衣裙',120],
    ['compatibility','适配型号','仅填写已经确认适配的完整型号',300],
    ['material','材质','如实填写，不能凭图片猜测',200],
    ['dimensions','尺寸／容量','填写真实数值和单位',200],
    ['quantity','包装数量','填写实际售卖数量，不是图片中的件数',120],
    ['features','已确认功能与区别特征','只写有依据的功能、结构、图案或工艺',800],
    ['usage','适用人群／用途','有明确依据再填写，可留空',300],
    ['keywords','希望覆盖的搜索词','仅采用与当前商品相符的词，不代表热搜词',400],
    ['referenceTitles','同站点同类目参考标题','可粘贴参考标题；仅借鉴措辞，不复制对方参数',1500]
  ];
  const readBrief=root=>Object.fromEntries([...root.querySelectorAll('[data-title-brief]')].map(field=>[field.dataset.titleBrief,field.value]));
  const briefEditor=(brief={},result=false)=>'<details class="title-brief"><summary>Temu 标题资料（选填）</summary><p class="hint">补充真实选购信息，按类目组织标题。母稿参数不会自动视为新品事实。'+(result?'修改后点击“按 Temu 类目重新撰写标题”保存并应用；只更新标题。':'资料留空也能生成基础标题。')+'</p><div class="fields">'+briefFields.map(([key,label,placeholder,max])=>'<label>'+label+'<textarea data-title-brief="'+key+'" maxlength="'+max+'" placeholder="'+escape(placeholder)+'" '+(result&&working()?'disabled':'')+'>'+escape(brief[key])+'</textarea></label>').join('')+'</div></details>';
  function collectProducts(){
    if(renderingInputs)return;
    for(const row of $('productInputs').querySelectorAll('[data-product]')){
      const product=products[Number(row.dataset.product)];if(!product)continue;
      for(const field of row.querySelectorAll('[data-field]'))product[field.dataset.field]=field.dataset.field==='count'?Number(field.value):field.value;
      product.titleBrief=readBrief(row);
    }
  }
  function estimates(){const total=products.reduce((n,p)=>n+Number(p.count||0),0);$('estimate').textContent=`${products.length} 个产品 · ${total} 条商品 · ${total*Number($('imageCount').value)} 张图片`;$('createBatch').disabled=!products.length||!getStore();}
  function renderInputs(){
    renderingInputs=true;try{
    $('productInputs').innerHTML=products.map((p,i)=>`<article class="product-input" data-product="${i}"><div class="product-heading"><h3>产品 ${i+1}</h3><button type="button" data-remove="${i}">移除</button></div><div class="thumbs">${p.images.map(im=>`<img src="${escape(im.url)}" alt="原始商品图">`).join('')}</div><div class="fields"><label>货号<input data-field="productCode" value="${escape(p.productCode)}" maxlength="36"></label><label>产品名称<input data-field="name" value="${escape(p.name)}"></label><label>裂变套数<input data-field="count" type="number" min="1" max="20" value="${p.count}"></label><label>使用母稿<select data-field="templateKey">${templateOptions(p.templateKey)}</select></label></div><label>商品卖点与资料（选填）<textarea data-field="description" aria-describedby="product-facts-hint-${i}" placeholder="填写你的商品卖点；留空时 AI 会识别产品原图、提炼卖点并生成图片和标题">${escape(p.description)}</textarea></label><p class="hint" id="product-facts-hint-${i}">填写时优先使用你的卖点；留空时由 AI 根据原图识别卖点。图片与标题共用这些信息，提供中文核对标题和英文版本，实际上架标题按店铺国家语言撰写。</p>${briefEditor(p.titleBrief)}</article>`).join('')||'<div class="listing-empty"><p>先读取原图素材文件夹</p><p>选择单个产品的图片文件夹，或多个产品的上一级目录，随后选择母稿和裂变套数。</p></div>';}finally{renderingInputs=false;}estimates();
  }
  function paintActions(){if(!batch)return;const groups=batch.products.map(p=>p.group);
    $('planBatch').textContent=groups.some(g=>g?.sets.some(s=>s.planning.status==='failed'))?'重试失败构思':groups.some(g=>g?.quality?.issues.length)?'重试重复文案修正':batch.products.some(p=>p.titleRepair?.status==='failed')?'重试重复商品标题':groups.every(g=>g?.sets.every(s=>s.planning.status==='completed'))&&batch.products.some(p=>!p.titles.length)?'继续生成商品标题':'构思图片并生成标题';$('planBatch').disabled=working()||batch.phase==='completed';$('generateBatch').disabled=working()||batch.phase==='completed'||batch.products.some(p=>!p.titles.length||!p.group?.sets.every(s=>s.planning.status==='completed')||p.group?.quality?.issues.length||p.group?.quality?.legacySets.length);
    $('retryBatch').hidden=!groups.some(g=>g?.failedImages);$('retryBatch').disabled=working()||groups.some(g=>g?.quality?.issues.length||g?.quality?.legacySets.length);$('pauseGeneration').hidden=!working();$('pauseGeneration').disabled=!!batch.stopRequested;
    $('reviewGenerated').disabled=working()||batch.phase!=='completed';$('exportBatch').disabled=$('reviewGenerated').disabled;
    $('materializeBatch').disabled=working()||!groups.every(g=>g?.completedImages===g?.totalImages&&g?.totalImages>0);
    // Failed tasks need the retry route; ordinary generation leaves them untouched.
    if(groups.some(g=>g?.failedImages))$('generateBatch').disabled=true;
    const next=['retryBatch','reviewGenerated','generateBatch','planBatch'].find(id=>!$(id).hidden&&!$(id).disabled);
    for(const id of ['planBatch','generateBatch','retryBatch','reviewGenerated'])$(id).classList.toggle('primary',id===next);
  }
  async function action(button,fn){pending++;button.disabled=true;notice('');onState();try{await fn();}catch(e){notice(e.message,true);}finally{pending--;button.disabled=false;paintActions();onState();}}
  function changedTitles(){return Array.from($('batchProducts').querySelectorAll('[data-title]')).filter(field=>field.value!==field.defaultValue);}
  function changedBrief(){return [...$('batchProducts').querySelectorAll('[data-title-brief]')].filter(field=>field.value!==field.defaultValue);}
  const editsKey=id=>'listing-product-edits:'+id;
  function currentEdits(){
    return {
      titles:changedTitles().map(field=>({productId:field.closest('[data-id]').dataset.id,setId:field.closest('[data-set]').dataset.set,key:field.dataset.title,value:field.value})),
      briefs:changedBrief().map(field=>({productId:field.closest('[data-id]').dataset.id,key:field.dataset.titleBrief,value:field.value})),
      outputParent:$('savedOutputParent').value!==$('savedOutputParent').defaultValue?$('savedOutputParent').value:undefined
    };
  }
  function savedEdits(){try{return JSON.parse(localStorage.getItem(editsKey(batch.id)))||{};}catch{return {};}}
  function saveEdits(){
    if(!batch||$('batchProducts').dataset.batch!==batch.id)return;
    const edits=currentEdits();
    try{
      if(edits.titles.length||edits.briefs.length||edits.outputParent!==undefined)localStorage.setItem(editsKey(batch.id),JSON.stringify(edits));
      else localStorage.removeItem(editsKey(batch.id));
    }catch{notice('本机空间不足，未保存的标题与资料无法暂存，请先保存后再离开。',true);}
  }
  function requireSavedTitles({allowBrief=false}={}){if(changedTitles().length)throw new Error('请先保存修改后的商品标题，再继续操作。');if(!allowBrief&&changedBrief().length)throw new Error('标题资料尚未应用，请先点击该产品的“按 Temu 类目重新撰写标题”。');}
  function imageFailures(set){return (set?.images||[]).filter(im=>im.task?.status==='failed').map(im=>'<p class="error">第 '+(im.slot+1)+' 张：'+escape(im.task.error||'图片生成失败')+'</p>').join('');}
  function planningProgress(p){
    const g=p.group;if(!g||!['planning','attention','failed','titles','interrupted'].includes(p.status))return '';
    const sets=g.sets,indices=status=>sets.flatMap((s,i)=>s.planning.status===status?[i+1]:[]),done=indices('completed');
    const parts=[`构思已完成 ${done.length}/${sets.length} 套`];
    for(const [status,label] of [['running','正在构思'],['pending','排队等待'],['failed','构思失败']]){const values=indices(status);if(values.length)parts.push(`${label}：第 ${values.join('、')} 套`);}
    if(['pending','running'].includes(g.copyRepair?.status))parts.push(`正在修正重复画面标题，第 ${g.copyRepair.attempt||1}/2 轮`);
    else if(g.quality?.issues.length&&sets.some(s=>['pending','running'].includes(s.planning.status)))parts.push('已发现重复画面标题，等待全部构思完成后自动修正');
    if(['running','checking'].includes(p.titleRepair?.status))parts.push(`正在检查或修正商品标题，第 ${p.titleRepair.attempt||0}/2 轮`);
    return '<p class="hint" data-planning-progress role="status">'+parts.map(escape).join('；')+'</p>';
  }
  function renderBatch({discardTitlesFor}={}){
    const draft=$('batchProducts').dataset.batch===batch.id?currentEdits():savedEdits();
    const edits=(draft.titles||[]).filter(edit=>edit.productId!==discardTitlesFor);
    const briefEdits=(draft.briefs||[]).filter(edit=>edit.productId!==discardTitlesFor);
    const openBriefs=new Set($('batchProducts').dataset.batch===batch.id?[...$('batchProducts').querySelectorAll('.title-brief[open]')].map(el=>el.closest('[data-id]').dataset.id):[]);
    if($('savedOutputParent').dataset.batch!==batch.id){$('savedOutputParent').dataset.batch=batch.id;$('savedOutputParent').defaultValue=batch.outputParent||'';$('savedOutputParent').value=typeof draft.outputParent==='string'?draft.outputParent:batch.outputParent||'';$('savedOutputEditor').open=!batch.outputParent||draft.outputParent!==undefined;}
    $('intake').hidden=true;$('generationPanel').hidden=false;$('batchTitle').textContent=batch.label;
    $('batchSummary').textContent=`${batch.storeName} · ${batch.site} · ${batch.products.length} 个产品 · ${batch.totalListings} 条商品 · 每套 ${batch.imageCount} 张`;
    $('generationState').textContent=batch.products.some(p=>['pending','running'].includes(p.group?.copyRepair?.status))?'检查并修正重复文案中':batch.products.some(p=>['running','checking'].includes(p.titleRepair?.status))?'检查并修正商品标题中':labels[batch.phase]||batch.phase;$('batchError').textContent=batch.titleError||batch.titleUpdateWarning||batch.error||'';
    $('batchProducts').innerHTML=batch.products.map(p=>`<article class="product-result" data-id="${p.id}"><div class="section-heading"><div><h3>${escape(p.productCode)} · ${escape(p.name)}</h3><small>${p.count} 套 · ${labels[p.status]||escape(p.status)}${p.group?` · 图片 ${p.group.completedImages}/${p.group.totalImages}`:''}</small></div>${p.group?`<a href="/temu?group=${encodeURIComponent(p.group.id)}#multisets">查看／处理每套方案</a>`:''}</div>${p.error?`<p class="error">${escape(p.error)}</p>`:''}${planningProgress(p)}${p.recognition?`<details class="recognized-points"><summary>AI 识别的产品与卖点</summary><p>${escape(p.recognition.productName)}</p><ul>${p.recognition.points.map(point=>`<li>${escape(point.sellingPoint)}<small> · 原图 ${point.imageIndexes.join("、")}</small></li>`).join('')}</ul></details>`:''}${p.groupId?briefEditor(p.titleBrief,true):''}${p.titleReview?.warnings.length?`<div class="title-review"><p class="hint">标题资料提示 · ${escape(p.titleReview.category)}</p><ul>${p.titleReview.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul></div>`:''}${p.titles.map((t,i)=>{const s=p.group.sets.find(s=>s.id===t.setId);return `<div class="set-title" data-set="${t.setId}"><strong>商品 ${i+1} · ${escape(s?.direction.name)}</strong><label>中文标题（核对用）<textarea data-title="chineseTitle" maxlength="250" placeholder="旧批次可点击下方“补全中文标题”" ${working()?'disabled':''}>${escape(t.chineseTitle)}</textarea></label><label>英文标题（店小秘字段）<textarea data-title="englishTitle" maxlength="250" ${working()?'disabled':''}>${escape(t.englishTitle)}</textarea></label><p class="title-help">中文用于核对；提交标题使用${batch.titleLanguage?.english?'英文':escape(batch.titleLanguage?.label||'本站语言')+'和英文'}。修改中文不会自动改写上架标题。</p><details class="site-title"><summary>查看 / 修改实际提交标题（${escape(batch.titleLanguage?.label||'本站语言')}）</summary><textarea data-title="title" maxlength="250" ${working()?'disabled':''}>${escape(t.title)}</textarea></details>${imageFailures(s)}<div class="thumbs">${s?.images.filter(im=>im.task?.imageUrl).map(im=>`<a href="${im.task.imageUrl}" target="_blank"><img src="${im.task.imageUrl}" alt="${escape(im.title)}"></a>`).join('')||''}</div></div>`;}).join('')}${p.titles.some(t=>!t.chineseTitle)?`<button data-chinese-titles="${p.id}" ${working()?'disabled':''}>补全中文标题</button>`:''}${p.groupId?`<button data-regenerate-titles="${p.id}" ${working()?'disabled':''}>按 Temu 类目重新撰写标题</button>`:''}${p.titles.length?`<button data-save-titles="${p.id}" ${working()?'disabled':''}>保存本产品的标题修改</button>`:''}</article>`).join('');
    $('batchProducts').dataset.batch=batch.id;
    for(const field of $('batchProducts').querySelectorAll('[data-title]')){const edit=edits.find(e=>e.setId===field.closest('[data-set]').dataset.set&&e.key===field.dataset.title);if(edit)field.value=edit.value;}
    for(const field of $('batchProducts').querySelectorAll('[data-title-brief]')){const edit=briefEdits.find(e=>e.productId===field.closest('[data-id]').dataset.id&&e.key===field.dataset.titleBrief);if(edit)field.value=edit.value;}
    for(const el of $('batchProducts').querySelectorAll('.title-brief'))el.open=openBriefs.has(el.closest('[data-id]').dataset.id);
    saveEdits();paintActions();onState();clearTimeout(timer);if(working())timer=setTimeout(refresh,1800);
  }
  async function refresh(){const id=batch?.id;if(!id)return;try{const next=await request('/api/products/'+id);if(batch?.id!==id)return;batch=next;renderBatch();if(!working())await onHistory();}catch(e){notice(e.message,true);timer=setTimeout(refresh,5000);}}
  $('productInputs').oninput=$('productInputs').onchange=()=>{if(renderingInputs)return;collectProducts();estimates();onState();};
  $('batchProducts').addEventListener('input',saveEdits);
  $('savedOutputParent').addEventListener('input',saveEdits);
  $('productInputs').onclick=e=>{const b=e.target.closest('[data-remove]');if(b){collectProducts();products.splice(Number(b.dataset.remove),1);renderInputs();onState();}};
  $('imageCount').innerHTML=Array.from({length:10},(_,i)=>`<option value="${i+1}" ${i===6?'selected':''}>${i+1} 张</option>`).join('');$('imageCount').onchange=estimates;
  $('createBatch').onclick=()=>action($('createBatch'),async()=>{
    collectProducts();
    batch=await request('/api/products',{requestId,sourceFolder,outputParent:$('outputParent').value.trim()||undefined,platform:'temu',storeKey:getStore()?.key,erpKey:getStore()?.erpKey,connectionBinding:getConnectionBinding?.(),label:$('batchName').value,products,imageCount:Number($('imageCount').value),ratio:$('ratio').value,mode:$('mode').value,model:$('imageModel').value});localStorage.setItem('merchant-active-batch',batch.id);renderBatch();await onHistory();
  });
  $('batchProducts').onclick=e=>{const chinese=e.target.closest('[data-chinese-titles]');if(chinese){action(chinese,async()=>{requireSavedTitles();notice('正在补全中文核对标题…');batch=await request('/api/products/'+batch.id+'/chinese-titles',{productId:chinese.dataset.chineseTitles});renderBatch();notice('中文核对标题已补全。');});return;}const rewrite=e.target.closest('[data-regenerate-titles]');if(rewrite){action(rewrite,async()=>{requireSavedTitles({allowBrief:true});const root=rewrite.closest('[data-id]'),titleBrief=readBrief(root);notice('正在按 Temu 类目、真实属性和店铺语言重新撰写标题…');for(const field of root.querySelectorAll('textarea,button'))field.disabled=true;try{batch=await request('/api/products/'+batch.id+'/regenerate-titles',{productId:rewrite.dataset.regenerateTitles,titleBrief});renderBatch({discardTitlesFor:rewrite.dataset.regenerateTitles});await onHistory();notice(batch.titleUpdateWarning||'Temu 标题已更新，补充资料已保存，商品图片保持原样。');}finally{for(const field of root.querySelectorAll('textarea,button'))field.disabled=false;}});return;}const b=e.target.closest('[data-save-titles]');if(!b)return;action(b,async()=>{const titles=[...b.closest('[data-id]').querySelectorAll('[data-set]')].map(row=>({setId:row.dataset.set,title:row.querySelector('[data-title="title"]').value,englishTitle:row.querySelector('[data-title="englishTitle"]').value,chineseTitle:row.querySelector('[data-title="chineseTitle"]').value}));batch=await request('/api/products/'+batch.id+'/titles',{productId:b.dataset.saveTitles,titles});notice('本产品的上架标题与英文版本已保存。');renderBatch();});};
  for(const [id,route,payload] of [['planBatch','plan',{}],['generateBatch','generate',{}],['retryBatch','generate',{retryFailed:true}],['pauseGeneration','stop',{}]])$(id).onclick=()=>action($(id),async()=>{if(route!=='stop')requireSavedTitles();batch=await request('/api/products/'+batch.id+'/'+route,payload);renderBatch();});
  $('reviewGenerated').onclick=()=>action($('reviewGenerated'),async()=>{requireSavedTitles();const result=await request('/api/products/'+batch.id+'/prepare',{});batch=result.batch;await onReview(result);});
  $('materializeBatch').onclick=()=>action($('materializeBatch'),async()=>{requireSavedTitles();batch=await request('/api/products/'+batch.id+'/materialize',{});renderBatch();notice('已生成新的结果文件包，原有文件包保留。');});
  $('exportBatch').onclick=()=>action($('exportBatch'),async()=>{requireSavedTitles();const folder=window.desktop?await window.desktop.chooseFolder():prompt('输入导出父文件夹的完整路径');if(!folder)return;const result=await request('/api/products/'+batch.id+'/export',{folder});notice('已导出 '+result.count+' 条商品：\n'+result.folder);});
  $('browseSavedOutput').onclick=()=>action($('browseSavedOutput'),async()=>{if(!window.desktop){notice('请粘贴本机结果文件夹的完整路径。');return;}const folder=await window.desktop.chooseFolder();if(folder)$('savedOutputParent').value=folder;});
  $('saveOutputParent').onclick=()=>action($('saveOutputParent'),async()=>{batch=await request('/api/products/'+batch.id+'/output',{folder:$('savedOutputParent').value.trim()});$('savedOutputParent').defaultValue=batch.outputParent;$('savedOutputParent').value=batch.outputParent;renderBatch();notice(batch.resultPackage?'已有图片和 Excel 已同步到：\n'+batch.resultPackage.folder:'保存位置已更新，生成完成后会自动写入。');});
  function reset(){saveEdits();clearTimeout(timer);batch=null;products=[];sourceFolder=null;requestId=crypto.randomUUID();$('intake').hidden=false;$('generationPanel').hidden=true;$('batchProducts').innerHTML='';delete $('batchProducts').dataset.batch;delete $('savedOutputParent').dataset.batch;renderInputs();}
  reset();
  function snapshotIntake(){collectProducts();return {products,sourceFolder,requestId};}
  function restoreIntake(draft){products=draft.products;sourceFolder=draft.sourceFolder;requestId=draft.requestId;renderInputs();}
  function refreshStoreOptions(){collectProducts();renderingInputs=true;try{for(const row of $('productInputs').querySelectorAll('[data-product]')){const p=products[Number(row.dataset.product)];row.querySelector('[data-field="templateKey"]').innerHTML=templateOptions(p.templateKey);}}finally{renderingInputs=false;}estimates();}
  return {labels,refreshStoreOptions,snapshotIntake,restoreIntake,saveEdits,working:()=>working()||pending>0,get batch(){return batch;},motherKeys(){return (batch?.products||products).map(p=>p.templateKey||getMotherKey());},async applyMother(templateKey){if(batch){batch=await request('/api/products/'+batch.id+'/mothers',{templateKey});renderBatch();}else{collectProducts();for(const p of products)p.templateKey=templateKey;renderInputs();}},reset,storeChanged(){collectProducts();for(const p of products)p.templateKey=getMotherKey();renderInputs();},import(result){reset();sourceFolder=result.sourceFolder;products=result.products.map(p=>({...p,templateKey:getStore()?.templates.some(t=>t.key===p.templateKey)?p.templateKey:getMotherKey()}));$('batchName').value=result.label;if(!$('outputParent').value)$('outputParent').value=result.outputParent||'';renderInputs();},async load(id){saveEdits();clearTimeout(timer);batch=await request('/api/products/'+encodeURIComponent(id));localStorage.setItem('merchant-active-batch',batch.id);renderBatch();return batch;}};
};
