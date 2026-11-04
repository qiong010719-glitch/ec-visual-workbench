/* Temu has its own form, plan and result state; the Amazon workspace is untouched. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), key='temu-workbench-v1';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=['productName','productDesc','imageCount','generationMode','targetMarket','targetLang','visualStyle','infoDensity','sceneIntensity','requirements'];
  let state={materials:[],results:[]},status,token,pollTimer,polling=false,uploading=false,submitting=false,exporting=false;
  try {const saved=JSON.parse(localStorage.getItem(key));if(saved && typeof saved==='object')state={...state,...saved};} catch {}
  const notice=(message,error=false)=>{ $('notice').hidden=false;$('notice').textContent=message;$('notice').classList.toggle('error',error); };
  const api=async(url,data)=>{
    const response=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(data)});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(value.error||`请求失败（${response.status}）`),{status:response.status});
    return value;
  };
  function formData() {
    return Object.fromEntries([...fields.map(id=>[id,$(id).value]),['ratio',document.querySelector('input[name=ratio]:checked').value],['model',$('imageModel').value]]);
  }
  function persist() {
    state.form=formData();
    try {localStorage.setItem(key,JSON.stringify(state));} catch {notice('浏览器保存空间不足。本次结果仍在服务器，请先导出资料包。',true);}
  }
  function payload() {
    const f=formData();
    return {platform:'temu',design_scope:'temu_main',product_name:f.productName.trim(),product_desc:f.productDesc.trim(),image_ratio:f.ratio,image_count:Number(f.imageCount),generation_mode:f.generationMode,target_market:f.targetMarket.trim(),target_lang:f.targetLang,visual_style:f.visualStyle,info_density:f.infoDensity,scene_intensity:f.sceneIntensity,strict_requirements:f.requirements.trim(),categorized_images:state.materials.map(m=>({filename:m.filename,url:m.url}))};
  }
  const active=()=>submitting || uploading || state.plan?.status==='pending' || state.plan?.status==='running' || state.results.some(r=>['pending','running'].includes(r.status));
  const currentPlan=()=>state.plan?.status==='completed' && JSON.stringify(state.plan.payload)===JSON.stringify(payload());
  const complete=()=>!!state.resultPayload && state.results.length===state.resultPayload.image_count && state.results.every(r=>r.status==='completed' && r.imageUrl);
  function controls() {
    const busy=active(),planMatches=currentPlan();
    for(const el of $('productForm').elements)el.disabled=busy;
    $('infoDensity').disabled=busy || $('generationMode').value==='master';
    $('sceneIntensity').disabled=busy || $('generationMode').value==='master';
    $('planButton').disabled=busy || !token;
    $('planButton').textContent=['pending','running'].includes(state.plan?.status)?'正在构思…':'生成设计方案';
    $('generateButton').disabled=busy || !planMatches || !state.plan?.text?.trim() || !status?.imageConfigured;
    $('generateButton').textContent=state.results.some(r=>['pending','running'].includes(r.status))?'图片生成中…':'生成整套图片';
    $('planText').disabled=busy || !state.plan?.text;
    $('imageModel').disabled=busy || !status;
    $('newButton').disabled=busy;
    $('exportButton').disabled=busy || !complete() || exporting;
    $('formatBadge').textContent=payload().image_ratio+' · '+payload().image_count+' 张';
    $('planState').textContent=['pending','running'].includes(state.plan?.status)?'正在生成，请稍候':state.plan?.status==='failed'?'构思未完成':planMatches?'方案可编辑':state.plan?.text?'资料已变更，请重新构思':'等待商品资料';
    for(const button of document.querySelectorAll('[data-regenerate],[data-edit],[data-recover],[data-remove-material]'))button.disabled=busy;
  }
  function renderMaterials() {
    $('materialList').innerHTML=state.materials.map((m,i)=>`<div class="material"><img src="${escape(m.url)}" alt="${escape(m.name)}"><button type="button" data-remove-material="${i}" aria-label="移除 ${escape(m.name)}">×</button></div>`).join('');
    controls();
  }
  function renderResults() {
    const result=state.resultPayload;
    $('emptyState').hidden=state.results.length>0;
    const done=state.results.filter(r=>r.status==='completed').length;
    $('resultSummary').textContent=result?`${result.product_name} · ${result.image_ratio} · 已完成 ${done}/${result.image_count} 张。主图与详情页同图同序。`:'生成后可逐张查看、重新生成和下载。';
    $('imageGrid').style.setProperty('--image-ratio',result?.image_ratio==='3:4'?'3 / 4':'1');
    const phases={pending:'排队中',generating:'正在生成',downloading:'正在下载',download_queued:'下载排队中'};
    $('imageGrid').innerHTML=state.results.map((r,i)=>{
      const pending=['pending','running'].includes(r.status),failed=r.status==='failed';
      const body=r.status==='completed' && r.imageUrl?`<img src="${escape(r.imageUrl)}" alt="第 ${i+1} 张商品图" data-preview="${escape(r.imageUrl)}">`:`${pending?'<span class="busy-dot" aria-hidden="true"></span>':''}<p>${escape(failed?r.error||'生成失败':phases[r.phase]||phases[r.status]||'等待结果')}</p>`;
      return `<article class="image-card" data-slot="${i}"><div class="image-frame">${body}</div><header><strong>${i===0?'首图':'商品图 '+(i+1)}</strong><small>${r.dimensions?`${r.dimensions.width} × ${r.dimensions.height}`:escape(result?.image_ratio||'')}</small></header><footer>${r.status==='completed'?`<a href="${escape(r.imageUrl)}" download="Temu-${i+1}.png">下载</a><button data-edit="${i}" type="button">修改图片</button>`:''}${r.canRetryDownload?`<button data-recover="${i}" type="button">重试下载</button>`:`<button data-regenerate="${i}" type="button">${failed?'重新生成':'重做此图'}</button>`}${r.previousImageUrl?`<a href="${escape(r.previousImageUrl)}" target="_blank" rel="noopener">上一版</a>`:''}</footer></article>`;
    }).join('');
    controls();
  }
  function openDialog(title,html) { $('dialogTitle').textContent=title;$('dialogContent').innerHTML=html;if(!$('dialog').open)$('dialog').showModal(); }
  $('closeDialog').onclick=()=>$('dialog').close();
  $('dialog').addEventListener('click',e=>{if(e.target===$('dialog'))$('dialog').close();});
  function confirmAction(title,message,action) {
    openDialog(title,`<p>${escape(message)}</p><div class="dialog-actions"><button id="cancelAction" type="button">取消</button><button class="primary" id="confirmAction" type="button">确认</button></div>`);
    $('cancelAction').onclick=()=>$('dialog').close();
    $('confirmAction').onclick=()=>{$('dialog').close();action();};
  }
  function schedulePoll(){clearTimeout(pollTimer);pollTimer=setTimeout(poll,1500);}
  async function poll() {
    if(polling)return;polling=true;
    try {
      if(['pending','running'].includes(state.plan?.status)) {
        const task=await api('/api/tasks/agent_tasks/'+state.plan.id);
        if(task) {
          state.plan.status=task.status;
          if(task.status==='completed'){state.plan.text=task.result;$('planText').value=task.result;notice('方案已就绪。确认每张图的内容后，可以开始生成。');}
          if(task.status==='failed')notice(task.error||'构思失败，商品资料已保留。',true);
        }
      }
      const pending=state.results.filter(r=>['pending','running'].includes(r.status));
      let changed=false;
      for(const result of await Promise.allSettled(pending.map(async r=>({id:r.taskId,task:await api('/api/tasks/hyrule_tasks/'+r.taskId)})))) {
        if(result.status==='rejected'){notice('状态读取中断，正在重新连接；不会重复提交生图。',true);continue;}
        const {id,task}=result.value;
        const slot=state.results.find(r=>r.taskId===id);
        if(task && slot){const next={...slot,...task};if(JSON.stringify(next)!==JSON.stringify(slot)){Object.assign(slot,next);changed=true;}}
      }
      persist();if(changed)renderResults();else controls();
      if(changed && complete())notice('本套图片已完成，可以下载或导出上架资料包。'+(state.results.some(r=>r.fitted)?' 服务返回的尺寸与目标不一致，已完整保留画面并补边到指定尺寸；请检查边缘。':''));
    } catch(error){notice('状态连接中断：'+error.message+'。将继续查询，不重复提交任务。',true);}
    finally {polling=false;if(active())schedulePoll();}
  }
  $('productForm').addEventListener('input',()=>{persist();controls();});
  $('productForm').addEventListener('change',()=>{persist();controls();});
  $('imageModel').onchange=persist;
  $('planText').oninput=()=>{if(state.plan){state.plan.text=$('planText').value;persist();controls();}};
  $('materialList').onclick=event=>{const button=event.target.closest('[data-remove-material]');if(!button || active())return;state.materials.splice(Number(button.dataset.removeMaterial),1);persist();renderMaterials();};
  $('materials').onchange=async event=>{
    const files=[...event.target.files];if(!files.length)return;
    if(state.materials.length+files.length>8){notice('最多上传 8 张商品原图。',true);event.target.value='';return;}
    uploading=true;controls();
    try {
      for(const file of files) {
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>25*1024*1024)throw new Error('请使用不超过 25 MB 的 PNG、JPG 或 WebP 图片');
        const response=await fetch('/api/media/up',{method:'POST',headers:{'Content-Type':file.type,'X-Workbench-Token':token},body:file});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'素材上传失败');
        state.materials.push({name:file.name,filename:'产品主体图_'+crypto.randomUUID()+'.'+file.name.split('.').pop(),url:data.url});persist();
      }
      notice('商品原图已上传，设计方案将以这些素材为准。');
    } catch(error){notice(error.message,true);}
    finally {uploading=false;event.target.value='';renderMaterials();persist();}
  };
  $('productForm').onsubmit=async event=>{
    event.preventDefault();if(active() || !$('productForm').reportValidity())return;
    if(!state.materials.length){notice('请先上传至少一张当前商品原图。',true);return;}
    const data=payload(),id='temu_plan_'+crypto.randomUUID();
    state.plan={id,payload:data,status:'pending',text:''};$('planText').value='';persist();controls();
    try {await api('/api/agent',{...data,agent_task_id:id});notice('正在构思。本页可以刷新恢复，无需重复提交。');schedulePoll();}
    catch(error){state.plan.status='failed';notice(error.message,true);persist();controls();}
  };
  async function generate(slot=null) {
    if(active() || !currentPlan())return;
    if(!state.plan.text.trim()){notice('请补齐设计方案。',true);return;}
    if(slot!==null && JSON.stringify(state.resultPayload)!==JSON.stringify(state.plan.payload)){notice('当前结果对应上一版商品资料。请生成新的一套，避免混入不同商品的图片。',true);return;}
    submitting=true;controls();
    const priorResults=structuredClone(state.results),priorPayload=state.resultPayload,priorSop=state.resultSop,priorDraft=state.resultDraftId;
    const selected=slot===null?Array.from({length:state.plan.payload.image_count},(_,i)=>i):[slot];
    const tasks=selected.map(i=>({slot:i,taskId:'temu_image_'+crypto.randomUUID(),aspect_ratio:state.plan.payload.image_ratio}));
    if(slot===null)state.results=tasks.map(t=>({...t,status:'pending',phase:'queued'}));
    else state.results[slot]={...tasks[0],status:'pending',phase:'queued',previousImageUrl:state.results[slot].imageUrl||state.results[slot].previousImageUrl};
    state.resultPayload=structuredClone(state.plan.payload);state.resultSop=state.plan.text;state.resultDraftId=null;persist();renderResults();
    try {await api('/api/generate',{...state.plan.payload,agent_task_id:state.plan.id,sop_text:state.plan.text,model:$('imageModel').value,firebase_tasks:tasks});notice('图片任务已提交，可刷新恢复进度。');}
    catch(error){
      if(error.status){state.results=priorResults;state.resultPayload=priorPayload;state.resultSop=priorSop;state.resultDraftId=priorDraft;notice(error.message,true);}
      else notice('提交结果尚未确认，正在查询原任务状态；请不要重复生成。',true);
    } finally {submitting=false;persist();renderResults();if(active())schedulePoll();}
  }
  $('generateButton').onclick=()=>state.results.length?confirmAction('生成新的一套','将生成当前方案的一整套图片，会再次调用图片服务。需要保留当前图片时，请先导出资料包。',()=>generate()):generate();
  async function retryDownload(slot) {
    if(active())return;submitting=true;controls();
    try {const result=await api('/api/downloads/retry',{taskId:state.results[slot].taskId});Object.assign(state.results[slot],result);notice('仅恢复已有图片的下载，不重新生图。');}
    catch(error){notice(error.message,true);}
    finally {submitting=false;persist();renderResults();if(active())schedulePoll();}
  }
  function editImage(slot) {
    const image=state.results[slot];if(active() || !image?.imageUrl)return;
    openDialog('修改商品图',`<p>在当前图片上修改，保持商品身份和 ${escape(state.resultPayload.image_ratio)} 比例。提交后调用图片服务。</p><textarea class="edit-prompt" id="editPrompt" aria-label="图片修改要求" placeholder="例如：背景改为明亮客厅，商品本身保持不变"></textarea><div class="dialog-actions"><button class="primary" id="runEdit" type="button">提交图片修改</button></div>`);
    $('runEdit').onclick=async()=>{
      const prompt=$('editPrompt').value.trim();if(!prompt)return;
      $('dialog').close();submitting=true;controls();
      const previous=structuredClone(image),taskId='temu_edit_'+crypto.randomUUID();
      state.results[slot]={slot,taskId,status:'pending',phase:'queued',previousImageUrl:previous.imageUrl};persist();renderResults();
      try {await api('/api/inpaint',{platform:'temu',image_ratio:state.resultPayload.image_ratio,aspect_ratio:state.resultPayload.image_ratio,task_id:taskId,slot_idx:slot,prompt,source_image_url:previous.imageUrl,model:$('imageModel').value});state.resultDraftId=null;}
      catch(error){if(error.status)state.results[slot]=previous;notice(error.message,true);}
      finally{submitting=false;persist();renderResults();if(active())schedulePoll();}
    };
  }
  $('imageGrid').onclick=event=>{
    const preview=event.target.closest('[data-preview]');if(preview){openDialog('图片预览',`<img src="${escape(preview.dataset.preview)}" alt="商品图预览">`);return;}
    const regen=event.target.closest('[data-regenerate]');if(regen){confirmAction('重新生成此图','将重新调用图片服务生成这一张，其他图片保持不变。',()=>generate(Number(regen.dataset.regenerate)));return;}
    const recovery=event.target.closest('[data-recover]');if(recovery){retryDownload(Number(recovery.dataset.recover));return;}
    const edit=event.target.closest('[data-edit]');if(edit)editImage(Number(edit.dataset.edit));
  };
  async function downloadPackage(draft) {
    if(!draft.images?.length)throw new Error('草稿没有图片');
    const zip=new JSZip(),files=[];
    for(let i=0;i<draft.images.length;i++) {
      const response=await fetch(draft.images[i]);if(!response.ok)throw new Error(`第 ${i+1} 张图片读取失败，未导出不完整资料包`);
      const filename=`images/${String(i+1).padStart(2,'0')}.${draft.images[i].split('.').pop()}`;
      zip.file(filename,await response.blob());files.push(filename);
    }
    const manifest={schemaVersion:1,platform:'temu',...(draft.groupId?{groupId:draft.groupId,setId:draft.setId,setIndex:draft.setIndex,direction:draft.direction,model:draft.model}:{}),title:draft.title,description:draft.description,imageRatio:draft.imageRatio,mainImages:files,detailImages:[...files],skuPreviewPolicy:'preserve-source',skus:draft.skus,status:'draft',published:false};
    zip.file('listing-manifest.json',JSON.stringify(manifest,null,2));
    zip.file('商品草稿.json',JSON.stringify(draft,null,2));zip.file('设计方案.txt',draft.sop||'');
    zip.file('使用说明.txt','Temu 图片资料包\n主图和详情页使用 images/ 中相同图片、相同顺序，不需要再次生成。\nSKU 预览图保持上架母稿原图，不用新主图替换。\n此包尚未写入店铺或发布商品；价格、库存和类目等由后续上架流程补充。');
    const blob=await zip.generateAsync({type:'blob'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=draft.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')+'-Temu图片包.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  $('exportButton').onclick=async()=>{
    if(!complete() || active() || exporting)return;exporting=true;controls();
    try {
      const p=state.resultPayload;
      const draft=await api('/api/drafts',{id:state.resultDraftId||undefined,platform:'temu',title:p.product_name,description:p.product_desc,image_ratio:p.image_ratio,images:state.results.map(r=>r.imageUrl),skus:[],sop:state.resultSop,status:'draft'});
      const saved=(await api('/api/drafts?platform=temu')).find(d=>d.id===draft.id);
      if(!saved || saved.updatedAt!==draft.updatedAt)throw new Error('草稿保存后未能重新读取，请稍后再试');
      state.resultDraftId=draft.id;persist();await downloadPackage(saved);notice('Temu 草稿已保存并核对，资料包已导出。主图和详情图片一致，商品尚未上架。');
    } catch(error){notice(error.message,true);}
    finally{exporting=false;controls();}
  };
  $('draftsButton').onclick=async()=>{
    try {
      const drafts=await api('/api/drafts?platform=temu');
      openDialog('Temu 草稿箱',drafts.length?drafts.map((d,i)=>`<article class="draft-row"><div><strong>${escape(d.title)}</strong><p>${escape(d.imageRatio)} · ${d.images.length} 张 · ${escape(new Date(d.updatedAt).toLocaleString('zh-CN'))} · 未上架</p></div><button data-export-draft="${i}" type="button">导出图片包</button></article>`).join(''):'<p class="muted">还没有 Temu 草稿。图片完成后，点击「保存并导出上架资料包」。</p>');
      for(const button of document.querySelectorAll('[data-export-draft]'))button.onclick=async()=>{button.disabled=true;try{await downloadPackage(drafts[Number(button.dataset.exportDraft)]);}catch(error){notice(error.message,true);}finally{button.disabled=false;}};
    } catch(error){notice(error.message,true);}
  };
  $('statusButton').onclick=async()=>{
    try {
      status=await api('/api/status');controls();
      openDialog('通道状态',`<dl class="status-list"><dt>图片服务</dt><dd>${status.imageConfigured?'已配置':'未配置专用图片密钥'}</dd><dt>构思方式</dt><dd>${status.planner==='local-rules'?'本地规则，可编辑方案':'已配置文本模型'}</dd><dt>图片下载</dt><dd>${status.downloadProxyConfigured?'使用已配置代理':'直接下载'}</dd><dt>当前任务</dt><dd>${status.active} 个运行中，${status.queued} 个排队中</dd></dl><p class="muted">亚马逊和 Temu 共用模型服务，商品资料与草稿分别保存。图片服务和文本模型按实际调用计费；当前工作台不发布商品。</p>`);
    } catch(error){notice(error.message,true);}
  };
  $('newButton').onclick=()=>confirmAction('新建商品','将清空当前工作区。已保存的 Temu 草稿保留；未导出的图片请先保存资料包。',()=>{localStorage.removeItem(key);location.reload();});
  async function init() {
    const form=state.form||{};
    for(const id of fields)if(form[id]!==undefined)$(id).value=form[id];
    const ratio=[...document.querySelectorAll('input[name=ratio]')].find(el=>el.value===form.ratio);if(ratio)ratio.checked=true;
    $('planText').value=state.plan?.text||'';renderMaterials();renderResults();
    try {
      const results=await Promise.all([api('/api/session'),api('/api/status'),api('/api/temu/config')]);token=results[0].token;status=results[1];
      $('imageModel').replaceChildren(...status.imageModels.map(m=>new Option(m.label,m.id)));
      $('imageModel').value=status.imageModels.some(m=>m.id===form.model)?form.model:status.model;
      $('plannerHint').textContent=status.planner==='local-rules'?'使用本地规则构思，方案可手动修改。':'构思使用已配置的文本模型，按实际调用计费。';
      if(!status.imageConfigured)notice('图片通道尚未配置。可以先完善资料并生成方案，在「通道状态」查看配置情况。');
      controls();if(active())schedulePoll();
    } catch(error){notice('连接工作台失败：'+error.message+'。请确认已启动包含 Temu 入口的新版本。',true);}
  }
  window.TemuWorkbench={api,source:payload,imageReady:()=>!!status?.imageConfigured,model:()=>$('imageModel').value,
    capture:()=>{
      if(uploading||!token)throw new Error('请等待图片上传和通道初始化完成');
      const p=payload();
      if(!p.product_name||!p.product_desc||!p.categorized_images.length)throw new Error('请先填写商品名称、真实资料，并上传商品原图');
      persist();return structuredClone(p);
    },
    exportSets:async(group,sets)=>{
      const result=await api(`/api/temu/multisets/${group.id}/export`,sets.length===group.sets.length?{}:{setId:sets[0].id});
      const zip=new JSZip();
      for(const file of result.manifest.files){
        const response=await fetch(file.url);if(!response.ok)throw new Error('图片读取失败，未导出不完整资料包');
        const bytes=await response.arrayBuffer();
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
        if(digest!==file.sha256)throw new Error('图片内容已发生变化，请重新导出');
        zip.file(file.path,bytes);
      }
      zip.file('listing-manifest.json',JSON.stringify(result.manifest,null,2));
      for(const set of result.manifest.sets){
        const draft=result.drafts.find(d=>d.setId===set.setId);
        zip.file(set.folder+'/设计方案.txt',draft.sop);
        zip.file(set.folder+'/商品草稿.json',JSON.stringify(draft,null,2));
      }
      zip.file('使用说明.txt','Temu 多套图片资料包\n每套的 mainImages 与 detailImages 同图同序，路径相对于本包根目录。\n按 groupId + setId 对应商品草稿，setIndex 保留原批次顺序。\nSKU 预览图保持上架母稿原图；商品未发布，价格、库存和类目由后续上架流程补充。');
      const url=URL.createObjectURL(await zip.generateAsync({type:'blob'})),link=document.createElement('a');
      link.href=url;link.download=group.source.product_name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')+'-Temu裂变图片包.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    },ready:init()};
})();
