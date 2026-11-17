/* Use the same workbench and isolate only the destination's saved state. */
window.WorkbenchPlatform='temu';
document.documentElement.classList.add('temu-theme');
window.WorkbenchNamespace='temu::'+location.host;
(() => {
  try {
    const key='hyrule_state_v13::'+window.WorkbenchNamespace;
    if(localStorage.getItem(key))return;
    const old=JSON.parse(localStorage.getItem('temu-workbench-v1'));
    if(!old?.form)return;
    const f=old.form,count=Number(f.imageCount)||7;
    const state={generationMode:f.generationMode||'fast',designScope:'custom',customLayout:{main:1,sub:Math.max(0,count-1),aplus:0,aplusType:'premium'},
      prodName:f.productName||'',prodDesc:f.productDesc||'',strictReq:f.requirements||'',modelChoice:f.model,
      targetMarket:'{"market":'+JSON.stringify(f.targetMarket||'加拿大')+', "lang":'+JSON.stringify(f.targetLang||'English')+'}',infoDensity:f.infoDensity,sceneIntensity:f.sceneIntensity,
      materialMeta:(old.materials||[]).map((m,i)=>({id:'temu-migrated-'+i,filename:m.filename,category:'产品主体图',url:m.url})),
      imageSlots:Array.from({length:14},(_,i)=>old.results?.[i]?.status==='completed'?{url:old.results[i].imageUrl,id:old.results[i].taskId}:null),activeKieTasks:[]};
    localStorage.setItem(key,JSON.stringify(state));
    localStorage.setItem('temu-shared-image-settings',JSON.stringify({ratio:f.ratio||'1:1',resultRatio:old.resultPayload?.image_ratio||f.ratio||'1:1'}));
  } catch { /* An unreadable old snapshot stays untouched. */ }
})();
