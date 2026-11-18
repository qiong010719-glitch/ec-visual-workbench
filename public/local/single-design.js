/* One click submits a fixed product snapshot; polling never submits paid work. */
(() => {
  const workbench=window.DesignWorkbench||window.TemuWorkbench;
  if(!workbench?.sharedUi)return;
  const $=id=>document.getElementById(id),key=workbench.pendingKey||'temu-single-design::'+location.host;
  let pending=null,submitting=false,timer,attachedId=null,planId=null,notice,retry;
  try{pending=JSON.parse(localStorage.getItem(key)||'null');}catch{}
  const normal=()=>['fast','master'].includes($('generationMode').value);
  const busy=()=>!__idbRestored||submitting||!!pending||!!activeAgentTask||activeKieTasks.length>0;
  const message=text=>{if(notice)notice.textContent=text;};
  function sync(){
    if(!notice)return;
    const locked=busy();
    if(normal()||pending){
      const button=$('mainBtn'),label=pending?'正在构思并生成…':submitting?'正在提交…':locked?'任务处理中…':'开始生成';
      if(button.disabled!==locked)button.disabled=locked;
      if(button.textContent!==label)button.textContent=label;
      button.classList.toggle('ready-to-fuse',!locked);
      $('ctaHint').textContent='点击后自动构思并生成整套图片，使用文本与图片服务额度。构思失败会停止。';
    }
    $('agentBtn').disabled=locked;
    $('generateReviewedPlan').disabled=locked||!$('sopText').value.trim()||!window._lastAgentTaskId;
    document.querySelector('.workspace-grid').inert=!!pending||submitting;
    $('singlePlanReview').inert=!!pending||submitting;
    $('multiSetBtn').disabled=!!pending||submitting;
  }
  const saveState=window.saveAppState;
  window.saveAppState=function(...args){const result=saveState.apply(this,args);sync();return result;};
  async function submit(payload){
    const response=await fetch('/api/single-design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||'提交失败'),{rejected:true});
    return data;
  }
  function clear(){pending=null;localStorage.removeItem(key);retry.hidden=true;sync();}
  function capture(id){
    const scope=$('designScope').value,mode=$('generationMode').value,custom=window.__customLayout,market=JSON.parse($('targetMarket').value);
    if(!scope)throw new Error('请先选择图文输出范围。');
    if(!$('prodName').value.trim()||!$('prodDesc').value.trim())throw new Error('请填写商品名称和商品资料。');
    if(!globalMaterials.some(m=>m.category==='产品主体图'))throw new Error('请上传至少一张产品主体图。');
    if(scope==='custom'&&!custom){openCustomModal();throw new Error('请先确认自定义图片方案。');}
    const category=window.__categoryState;
    if(scope==='custom'&&category?.category!=='general'&&category?.allocation&&Object.values(category.allocation).reduce((a,b)=>a+Number(b||0),0)!==getMainFlowTarget())throw new Error('产品类型的图片配额与自定义张数不一致，请重新确认。');
    return workbench.decorateSource({agent_task_id:id,product_name:$('prodName').value,product_desc:$('prodDesc').value,generation_mode:mode,
      model:$('modelChoice').value,visual_style:window.getLocalVisualStyle?.(mode)||'scene_advertising',design_scope:getEffectiveScope(),
      custom_layout:scope==='custom'?{main:custom.main|0,sub:custom.sub|0,aplus:custom.aplus|0,aplus_type:custom.aplusType||'premium'}:null,
      target_market:market.market,target_lang:market.lang,model_ethnicity:getModelEthnicity(market.market),strict_requirements:$('strictReq').value,text_depth:isTextDepthOn(),
      info_density:$('infoDensity').value,scene_intensity:$('sceneIntensity').value,category:category?.category||'general',category_confirmed:!!category?.confirmed,
      image_allocation:category?.allocation||null,structure_notes:category?.structure_notes||null,slot_directives:buildSlotDirectives(),reference_ids:window.__designReferenceIds||[],
      categorized_images:globalMaterials.map(m=>({filename:m.filename,url:m.url}))});
  }
  async function start(){
    if(busy())return;
    if(!normal())return triggerGeneration();
    submitting=true;sync();message('正在检查商品资料与参考图…');
    try{
      const id='single_'+crypto.randomUUID();capture(id);
      const materials=await ensureMaterialUrls(globalMaterials);
      if(materials.lost.length)throw new Error('参考图已失效，请重新上传：'+materials.lost.join('、'));
      await workbench.prepareSource?.();
      const payload=capture(id);
      // Persist before POST, including the exact ID for an uncertain response.
      localStorage.setItem(key,JSON.stringify({id,payload}));pending={id,payload};saveAppState();
      await submit(payload);message('正在构思，完成后自动生成图片…');
    }catch(error){
      if(error.rejected)clear();
      message(pending?'提交结果尚未确认，正在查询同一任务，请勿重复开始。':error.message);
    }finally{submitting=false;sync();if(pending)poll();}
  }
  async function poll(){
    clearTimeout(timer);const current=pending;if(!current)return;
    try{
      const task=await workbench.api('/api/tasks/agent_tasks/'+current.id);
      if(pending!==current)return;
      if(!task){message('尚未查询到任务。可用同一任务编号重新提交，避免重复生成。');retry.hidden=false;return;}
      retry.hidden=true;
      const flow=task.singleDesign;
      if(!flow)throw new Error('无法识别此单品任务，请保留页面并检查服务版本。');
      if(task.status==='completed'&&task.result&&planId!==current.id){
        planId=current.id;$('sopText').value=task.result;window._lastAgentTaskId=current.id;lastAgentTaskId=current.id;
        $('localPlanLabel').textContent='构思已完成 · 自动生成图片';
        saveAppState();
      }
      if(flow.images.some(i=>i.status!=='not_started')&&attachedId!==current.id){
        workbench.recordSingleResult(task.payload,flow.tasks,task.result);
        attachedId=current.id;imageSlots=Array(14).fill(null);activeKieTasks=flow.tasks.map(({taskId,slot})=>({taskId,slot}));
        buildGalleryLayout();switchView('adventure-log',$('nav-notes'));
        activeKieTasks.forEach(t=>resumeKieListener(t.slot,t.taskId));saveAppState();
      }
      const complete=flow.images.filter(i=>i.status==='completed').length;
      const text=flow.phase==='planning'?'正在构思，完成后自动生成图片…':flow.phase==='completed'?`本套 ${complete} 张图片已完成。`:flow.phase==='failed'?
        (task.status==='failed'?'构思未完成，已停止生图。':'图片未全部完成，已有结果已保留。')+(flow.error||''):
        `构思已完成，正在生成图片（${complete}/${flow.tasks.length}）…`;
      message(text);if(attachedId===current.id)$('logContent').textContent=text;
      if(['completed','failed'].includes(flow.phase)){
        $('localPlanLabel').textContent=flow.phase==='completed'?'本套图片已完成':'本次生成已停止';
        if(flow.phase==='completed'&&workbench.onSingleComplete){
          try{await workbench.onSingleComplete(task);message(`本套 ${complete} 张图片已完成，已保存到商品库。`);}
          catch(error){message(`图片已完成，保存到商品库未完成：${error.message}。可点击“保存到商品库”重试。`);}
        }
        clear();return;
      }
    }catch(error){message('任务状态暂时无法读取，正在恢复查询；不会重复提交。');}
    if(pending===current)timer=setTimeout(poll,1500);
  }
  function setup(){
    const box=document.createElement('div');box.className='single-generation-status';
    notice=document.createElement('p');notice.id='singleGenerationStatus';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
    retry=document.createElement('button');retry.type='button';retry.hidden=true;retry.textContent='重新提交同一任务';
    retry.onclick=async()=>{if(submitting||!pending)return;submitting=true;retry.disabled=true;try{await submit(pending.payload);}catch(e){if(e.rejected){message(e.message);clear();}}finally{submitting=false;retry.disabled=false;sync();poll();}};
    box.append(notice,retry);$('mainBtn').after(box);$('mainBtn').onclick=start;
    message('点击“开始生成”自动构思并生图，将使用文本与图片服务额度。');
    $('agentBtn').lastChild.textContent='仅构思方案（可选）';
    const reviewed=document.createElement('button');reviewed.id='generateReviewedPlan';reviewed.type='button';reviewed.textContent='按当前方案生成';reviewed.onclick=()=>{if(!busy())triggerGeneration();};
    $('singlePlanReview').append(reviewed);
    $('singlePlanReview').querySelector('p').textContent='默认点击“开始生成”即可自动构思并生图。需要先调整方案时，可选择“仅构思方案”，修改后再按当前方案生成。';
    new MutationObserver(sync).observe($('mainBtn'),{attributes:true,attributeFilter:['disabled'],childList:true});
    document.addEventListener('change',()=>queueMicrotask(sync));
    window.addEventListener('local-design-plan',sync);window.addEventListener('local-image-task-update',sync);
    const ready=()=>{if(!__idbRestored){setTimeout(ready,50);return;}sync();if(pending){message('正在恢复单品生成进度…');poll();}};ready();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
