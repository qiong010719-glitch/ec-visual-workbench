/* One explicit person reference is shared by image tasks, drafts and future video tasks. */
(() => {
  const $=id=>document.getElementById(id),key='taobao-model-identity-v1';
  let state={version:1,enabled:false},busy=false;
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.version===1&&typeof saved.enabled==='boolean')state=saved;}catch{}
  const copy=()=>structuredClone(state);
  const message=text=>{if($('tbModelMessage'))$('tbModelMessage').textContent=text;};
  const save=()=>localStorage.setItem(key,JSON.stringify(state));
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  function render(){
    if(!$('tbModelPresence'))return;
    $('tbModelPresence').value=state.enabled?'yes':'no';$('tbModelPresence').disabled=busy;
    $('tbModelControls').hidden=!state.enabled;
    $('tbModelUpload').disabled=busy;$('tbModelClear').disabled=busy;
    $('tbModelExport').disabled=busy||!state.references?.length;
    const ref=state.references?.[0];$('tbModelPreview').hidden=!ref;
    if(ref)$('tbModelPreview').src=ref.url;else $('tbModelPreview').removeAttribute('src');
    $('tbModelName').textContent=ref?`固定模特：${ref.filename}`:'尚未选择模特参考图';
  }
  window.TaobaoModelState={
    capture(){if(busy)throw Error('请等待模特参考图上传完成。');return copy();},
    restore(value){state=value?structuredClone(value):{version:1,enabled:false};save();render();message('已恢复模特设置，没有提交生成任务。');}
  };
  window.prepareTaobaoModelPayload=async payload=>{
    if(!window.__customLayout?.taobao)return payload;
    if(busy)throw Error('请等待模特参考图上传完成。');
    const status=await LocalWorkbench.imageModelStatus();
    if(status.modelIdentityVersion!==1)throw Error('本地服务尚未加载模特功能，请重启本项目服务并刷新网页；没有提交构思或出图。');
    if(state.enabled&&!state.references?.length)throw Error('已选择模特出镜，请先上传一张固定模特参考图。');
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
      <p class="local-muted">选“是”后，主图、SKU和详情均使用同一位模特；SKU仍以商品和规格为主。图片与后续AI视频共用此人物参考，实际结果需核对是否同一人。</p>
      <div id="tbModelControls" hidden><p>请上传一张单人、脸部清晰的模特图。后续视频使用这位模特及已确认的成图；视频生成功能尚未接入。</p>
      <button id="tbModelUpload" type="button">上传固定模特参考图</button><input id="tbModelFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>
      <button id="tbModelClear" type="button">移除模特参考</button><div style="display:flex;align-items:center;gap:10px;margin:8px 0"><img id="tbModelPreview" alt="固定模特参考" style="width:74px;height:96px;object-fit:contain" hidden><span id="tbModelName"></span></div>
      <button id="tbModelExport" type="button">下载图片／视频共用模特包</button></div><p id="tbModelMessage" class="local-muted" aria-live="polite"></p>`;
    $('taobaoShell').append(panel);
    $('tbModelPresence').onchange=()=>{state.enabled=$('tbModelPresence').value==='yes';save();render();message('设置已更改，请重新构思。已有图片保留。');};
    $('tbModelUpload').onclick=()=>$('tbModelFile').click();
    $('tbModelClear').onclick=()=>{state={version:1,enabled:state.enabled};save();render();message('模特参考已移除，已有图片保留。');};
    $('tbModelFile').onchange=async event=>{
      const file=event.target.files?.[0];if(!file)return;
      busy=true;render();message('正在保存模特参考图…');
      try{
        const bytes=await file.arrayBuffer(),sha256=await digest(bytes),url=await LocalWorkbench.upload(file);
        state={version:1,enabled:true,id:'model_'+crypto.randomUUID(),name:file.name,references:[{filename:file.name,url,sha256}]};
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
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
