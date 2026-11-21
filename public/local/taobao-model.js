/* One explicit person reference is shared by image tasks, drafts and future video tasks. */
(() => {
  const $=id=>document.getElementById(id),key='taobao-model-identity-v1',jobKey='taobao-model-generation-v1';
  let state={version:1,enabled:false},busy=false,job=null,watching=false,source='upload';
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.version===1&&typeof saved.enabled==='boolean')state=saved;}catch{}
  try{const saved=JSON.parse(localStorage.getItem(jobKey)||'null');if(/^modelgen_[\w-]{1,100}$/.test(saved?.taskId||''))job=saved;}catch{}
  source=state.source==='generated'||job?'generated':'upload';
  const copy=()=>structuredClone(state);
  const message=text=>{if($('tbModelMessage'))$('tbModelMessage').textContent=text;};
  const save=()=>localStorage.setItem(key,JSON.stringify(state));
  const saveJob=()=>localStorage.setItem(jobKey,JSON.stringify(job));
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  function render(){
    if(!$('tbModelPresence'))return;
    $('tbModelPresence').value=state.enabled?'yes':'no';$('tbModelPresence').disabled=busy;
    $('tbModelControls').hidden=!state.enabled;
    $('tbModelUpload').disabled=busy;$('tbModelClear').disabled=busy;
    $('tbModelSource').disabled=busy;$('tbModelSource').value=source;
    $('tbModelUploadArea').hidden=source!=='upload';$('tbModelGenerateArea').hidden=source!=='generated';
    $('tbModelGenerate').disabled=busy||!!job&&['submitting','pending','running','unknown'].includes(job.status);
    $('tbModelDescription').disabled=busy;
    $('tbModelCheck').hidden=!job;$('tbModelCheck').disabled=busy||watching;
    $('tbModelForget').hidden=!job;$('tbModelForget').disabled=busy||['pending','running','submitting'].includes(job?.status);
    const candidate=job?.candidateIdentity;
    $('tbModelCandidate').hidden=!candidate;
    if(candidate)$('tbModelCandidatePreview').src=candidate.references[0].url;else $('tbModelCandidatePreview').removeAttribute('src');
    $('tbModelUse').disabled=busy||!candidate||candidate.id===state.id;
    $('tbModelUse').textContent=candidate&&candidate.id===state.id?'已使用这位模特':'使用这位模特';
    const statusText={submitting:'正在提交1张模特候选…',pending:'模特候选排队中，尚未替换已选人物。',running:'正在生成模特候选，尚未替换已选人物。',completed:'候选已生成。确认外观后，点击“使用这位模特”固定人物。',failed:'任务失败：'+(job?.error||'结果未确认')+'。不会自动重新生成。',unknown:'提交结果尚未确认。请查询原任务；不要重复付费生成。'};
    $('tbModelGenerationMessage').textContent=job?statusText[job.status]||'请查询原任务状态。':'';
    if(candidate&&candidate.id===state.id)$('tbModelGenerationMessage').textContent='已选定这位模特，后续图片与视频复用此人物参考。';
    $('tbModelRetryDownload').hidden=!job?.canRetryDownload;$('tbModelRetryDownload').disabled=busy||watching;
    $('tbModelExport').disabled=busy||!state.references?.length;
    const ref=state.references?.[0];$('tbModelPreview').hidden=!ref;
    if(ref)$('tbModelPreview').src=ref.url;else $('tbModelPreview').removeAttribute('src');
    $('tbModelName').textContent=ref?`已选模特（${state.source==='generated'?'系统生成':'客户上传'}）：${ref.filename}`:'尚未选择模特参考图';
  }
  const rememberTask=task=>{job={taskId:task.taskId,status:task.status,description:task.description,error:task.error,canRetryDownload:task.canRetryDownload,candidateIdentity:task.candidateIdentity};saveJob();render();};
  async function api(url,payload){
    const response=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'模特服务请求失败。'),{status:response.status});return data;
  }
  async function watch(){
    if(!job||watching)return;
    const taskId=job.taskId;watching=true;render();
    try{
      do{
        const task=await api('/api/taobao/models/'+taskId);
        if(job?.taskId!==taskId)return;
        rememberTask(task);
        if(!['pending','running'].includes(task.status))break;
        await new Promise(resolve=>setTimeout(resolve,1500));
      }while(job?.taskId===taskId);
    }catch(error){
      if(job?.taskId===taskId){job.status='unknown';saveJob();message('查询原模特任务失败：'+error.message+' 请稍后点“查询原任务”；没有重新提交生成。');}
    }finally{watching=false;render();}
  }
  window.TaobaoModelState={
    capture(){if(busy)throw Error('请等待当前模特操作完成。');return copy();},
    restore(value){state=value?structuredClone(value):{version:1,enabled:false};source=state.source==='generated'?'generated':'upload';save();render();message('已恢复模特设置，没有提交生成任务。');}
  };
  window.prepareTaobaoModelPayload=async payload=>{
    if(!window.__customLayout?.taobao)return payload;
    if(busy)throw Error('请等待当前模特操作完成。');
    const status=await LocalWorkbench.imageModelStatus();
    if(status.modelIdentityVersion!==1)throw Error('本地服务尚未加载模特功能，请重启本项目服务并刷新网页；没有提交构思或出图。');
    if(state.enabled&&status.modelPlacementVersion!==1)throw Error('本地服务尚未加载模特分镜修正，请重启本项目服务并刷新网页；没有提交构思或出图。');
    if(state.enabled&&state.source==='generated'&&status.modelGenerationVersion!==1)throw Error('本地服务尚未加载系统模特功能，请重启本项目服务并刷新网页；没有提交构思或出图。');
    if(state.enabled&&!state.references?.length)throw Error('已选择模特出镜，请先上传模特图，或生成候选后点击“使用这位模特”。');
    return {...payload,model_identity:state.enabled?copy():{version:1,enabled:false}};
  };
  for(const name of ['summonAgent','triggerGeneration']){
    const original=window[name];if(!original)continue;
    window[name]=async function(...args){
      try{await window.prepareTaobaoModelPayload({});}catch(error){message(error.message);window.aquaNotify?.('模特设置',error.message,'⚠️');return;}
      return original.apply(this,args);
    };
  }
  function setup(){
    if(!$('taobaoShell'))return;
    // The selected person's reference replaces the older random casting dropdown.
    if($('modelEthnicity'))$('modelEthnicity').style.display='none';
    const panel=document.createElement('section');panel.id='taobaoModel';
    panel.style.cssText='border:1px solid #6b91a8;padding:12px;margin:12px 0;border-radius:10px;background:#101b2a88;font-size:12px';
    panel.innerHTML=`<label style="display:flex;gap:12px;align-items:center;font-weight:bold">是否模特出镜
      <select id="tbModelPresence" style="background:#0f172a;color:#fff;padding:6px;border-radius:6px"><option value="no">否 · 只展示商品</option><option value="yes">是 · 使用固定模特</option></select></label>
      <p class="local-muted">选“是”后，人物镜头使用同一位模特，不会每张都有人。首张主图由模特辅助展示；其余按分镜保留静物、微距、结构、仅手部与场景图。SKU图只展示商品和规格。图片与后续AI视频共用此人物参考，实际结果需核对是否同一人。</p>
      <div id="tbModelControls" hidden><p>上传或生成一位模特，选定后固定复用。后续视频使用这位模特及已确认的成图；视频生成功能尚未接入。</p>
      <label>模特来源 <select id="tbModelSource" style="background:#0f172a;color:#fff;padding:6px;border-radius:6px"><option value="upload">客户上传</option><option value="generated">系统生成</option></select></label>
      <div id="tbModelUploadArea" style="margin:8px 0"><p>上传一张单人、脸部清晰的模特图。</p><button id="tbModelUpload" type="button">上传固定模特参考图</button><input id="tbModelFile" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>
      <div id="tbModelGenerateArea" hidden style="margin:8px 0"><label for="tbModelDescription">模特外观与服装</label><textarea id="tbModelDescription" maxlength="1200" rows="3" style="width:100%;box-sizing:border-box;background:#0f172a;color:#fff" placeholder="例如：成年女性，短发，米色衬衫与深色长裤，自然亲切"></textarea>
      <p class="local-muted">每次生成1张候选，使用现有图片服务额度。选定后反复复用；选择来源或刷新页面不会生成。</p>
      <button id="tbModelGenerate" type="button">生成1位模特候选</button><button id="tbModelCheck" type="button" hidden>查询原任务</button><button id="tbModelRetryDownload" type="button" hidden>仅重试下载</button><button id="tbModelForget" type="button" hidden>清除候选任务记录</button>
      <p id="tbModelGenerationMessage" class="local-muted" aria-live="polite"></p><div id="tbModelCandidate" hidden><img id="tbModelCandidatePreview" alt="系统生成的待选模特" style="width:100%;max-height:300px;object-fit:contain"><button id="tbModelUse" type="button">使用这位模特</button></div></div>
      <button id="tbModelClear" type="button">移除模特参考</button><div style="display:flex;align-items:center;gap:10px;margin:8px 0"><img id="tbModelPreview" alt="固定模特参考" style="width:74px;height:96px;object-fit:contain" hidden><span id="tbModelName"></span></div>
      <button id="tbModelExport" type="button">下载图片／视频共用模特包</button></div><p id="tbModelMessage" class="local-muted" aria-live="polite"></p>`;
    $('taobaoShell').append(panel);
    $('tbModelPresence').onchange=()=>{state.enabled=$('tbModelPresence').value==='yes';save();render();message('设置已更改，请重新构思。已有图片保留。');};
    $('tbModelUpload').onclick=()=>$('tbModelFile').click();
    $('tbModelSource').onchange=()=>{source=$('tbModelSource').value;render();message('切换来源不会更换已选模特，也不会自动生成。');};
    $('tbModelCheck').onclick=()=>watch();
    $('tbModelForget').onclick=()=>{
      if(!confirm('只清除当前候选的查询记录，不取消已提交的任务，也不退还图片服务费用。请先核对原任务与账单。已选模特保留。继续清除？'))return;
      job=null;saveJob();render();
    };
    $('tbModelRetryDownload').onclick=async()=>{
      if(!job?.canRetryDownload)return;
      busy=true;render();
      try{await api('/api/downloads/retry',{taskId:job.taskId});void watch();}
      catch(error){message(error.message);}finally{busy=false;render();}
    };
    $('tbModelUse').onclick=()=>{
      if(!job?.candidateIdentity)return;
      state=structuredClone(job.candidateIdentity);save();render();message('已固定这位系统生成模特，请重新构思。后续图片与视频共用此人物参考；本次选择没有额外生成。');
    };
    $('tbModelGenerate').onclick=async()=>{
      const description=$('tbModelDescription').value.trim();
      if(!description){message('请先填写模特外观与服装要求。');return;}
      busy=true;render();
      try{
        const status=await LocalWorkbench.imageModelStatus();
        if(status.modelGenerationVersion!==1)throw Error('本地服务尚未加载系统模特功能，请重启本项目服务并刷新网页；没有提交生成。');
        if(!status.imageConfigured)throw Error('尚未配置图片服务，未提交模特生成。');
        const warning=job?.status==='failed'?'上次任务失败，可能已产生费用。请确认已核对原任务和账单。\n':'';
        if(!confirm(warning+'将通过现有图片服务生成1张模特候选（GPT Image 2），会使用服务额度，实际费用以服务账单为准。不会自动重试，也不会替换已选模特。确认付费生成？'))return;
        job={taskId:'modelgen_'+crypto.randomUUID(),status:'submitting',description};saveJob();render();
        try{rememberTask(await api('/api/taobao/models/generate',{task_id:job.taskId,description,confirmed:true}));}
        catch(error){job.status=error.status&&error.status<500?'failed':'unknown';job.error=error.message;saveJob();message(error.message);}
        if(job.status!=='failed')void watch();
      }catch(error){message(error.message);}finally{busy=false;render();}
    };
    $('tbModelClear').onclick=()=>{state={version:1,enabled:state.enabled};save();render();message('模特参考已移除，已有图片保留。');};
    $('tbModelFile').onchange=async event=>{
      const file=event.target.files?.[0];if(!file)return;
      busy=true;render();message('正在保存模特参考图…');
      try{
        const bytes=await file.arrayBuffer(),sha256=await digest(bytes),url=await LocalWorkbench.upload(file);
        state={version:1,enabled:true,id:'model_'+crypto.randomUUID(),name:file.name,source:'upload',references:[{filename:file.name,url,sha256}]};
        save();message('模特参考已保存；请重新构思。图片和后续视频复用此人物，不会自动生成。');
      }catch(error){message(error.message);}finally{busy=false;event.target.value='';render();}
    };
    $('tbModelExport').onclick=async()=>{
      const snapshot=copy();busy=true;render();
      try{
        const ref=snapshot.references[0],response=await fetch(ref.url);if(!response.ok)throw Error('模特参考图无法读取。');
        const bytes=await response.arrayBuffer();if(await digest(bytes)!==ref.sha256)throw Error('模特参考图已变化，停止导出。');
        const filename='model-reference.'+ref.url.split('.').pop(),zip=new JSZip();
        zip.file(filename,bytes);zip.file('model-identity.json',JSON.stringify({...snapshot,references:[{...ref,url:undefined,file:filename}],imageReview:'not_reviewed',videoReview:'not_reviewed',videoGeneration:'not_implemented'},null,2));
        const url=URL.createObjectURL(await zip.generateAsync({type:'blob'})),a=document.createElement('a');a.href=url;a.download='图片视频共用模特.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
        message('已导出同一份人物参考与校验记录；没有生成图片或视频。');
      }catch(error){message(error.message);}finally{busy=false;render();}
    };
    render();
    if(job?.description)$('tbModelDescription').value=job.description;
    if(job)void watch();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
