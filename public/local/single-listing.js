/* Single-design handoff to the existing ERP executor. No image regeneration. */
(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  window.openSingleListing=async({draft,api,dialog})=>{
    const request=(route,data)=>api('/api/temu/erp/'+route,data);
    const d=dialog('直接上架', '<p role="status">正在载入本套图片和已绑定的 ERP 店铺…</p>');
    d.classList.add('single-listing-dialog');
    let config,preview;
    try{[config,preview]=await Promise.all([request('config'),request('import-generated',{draftId:draft.id})]);}
    catch(error){if(d.isConnected)d.insertAdjacentHTML('beforeend',`<p role="alert">${escape(error.message)}</p>`);return;}
    if(!d.isConnected||!d.open)return;
    const row=preview.rows[0],images=preview.folders.find(f=>f.name===row.folder).images;
    const storageKey='single-listing:'+draft.id;
    let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
    d.querySelector('[role="status"]').remove();
    d.insertAdjacentHTML('beforeend',`
      <p><strong>${escape(draft.title)}</strong> · ${images.length} 张图片</p>
      <div class="single-listing-images">${images.map((im,i)=>`<img src="${escape(im.url)}" alt="上架图片 ${i+1}">`).join('')}</div>
      <p class="local-muted">主图与详情同图同序；类目、规格、价格、库存和 SKU 预览图沿用所选母稿。</p>
      <form id="singleListingForm">
        <fieldset>
          <div class="single-listing-fields">
            <label>ERP 连接<select id="singleListingErp" name="erpKey" required></select></label>
            <label>绑定店铺<select id="singleListingStore" name="storeKey" required></select></label>
            <label>商品母稿<select id="singleListingMother" name="templateKey" required></select></label>
            <label>执行方式<select id="singleListingMode" name="executionMode"><option value="publish">保存并发布</option><option value="draft">仅保存到待发布</option></select></label>
            <label>货号<input name="productCode" required maxlength="60" pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,59}" value="${escape(saved.productCode||row.productCode)}"></label>
            <label><span id="singleListingTitleLabel">上架标题</span><input name="title" required maxlength="250" value="${escape(saved.title||row.title)}"></label>
            <label class="single-listing-wide">英文标题<input name="englishTitle" required maxlength="250" value="${escape(saved.englishTitle||row.englishTitle||'')}" placeholder="填写商品英文标题"></label>
          </div>
          <p id="singleListingBinding" class="local-muted"></p>
          <div class="local-row"><button type="button" id="singleListingRefresh">刷新店铺</button><button type="button" id="singleListingCheck">检查连接</button><a href="/settings" target="_blank" rel="noopener">管理 ERP、店铺与母稿</a></div>
          <p id="singleListingModeHint" class="local-muted"></p>
          <button type="submit" class="primary" id="singleListingSubmit">保存并发布</button>
        </fieldset>
      </form>
      <p id="singleListingStatus" role="status" aria-live="polite"></p>
      <a id="singleListingProgress" hidden>查看上架进度与结果</a>`);
    const $=id=>d.querySelector('#'+id),form=$('singleListingForm'),fieldset=form.querySelector('fieldset');
    let busy=false,prepared=null;
    const erps=()=>config.erpConnections.filter(e=>!e.provider||e.provider==='dianxiaomi');
    const erp=()=>erps().find(e=>e.key===$('singleListingErp').value);
    const shop=()=>config.stores.find(s=>s.key===$('singleListingStore').value&&s.erpKey===erp()?.key&&s.platform==='temu');
    const mother=()=>shop()?.templates.find(t=>t.key===$('singleListingMother').value);
    const binding=()=>({erpConnection:erp(),browserConfig:config.browsers.find(b=>b.key===erp()?.browserKey)});
    const values=()=>Object.fromEntries(new FormData(form));
    const remember=()=>{try{localStorage.setItem(storageKey,JSON.stringify(values()));}catch{}};
    const notice=(message,error=false)=>{$('singleListingStatus').textContent=message;$('singleListingStatus').classList.toggle('single-listing-error',error);};
    function options(select,items,placeholder,value){
      select.innerHTML=`<option value="">${escape(placeholder)}</option>`+items.map(([key,name])=>`<option value="${escape(key)}">${escape(name)}</option>`).join('');
      select.value=items.some(([key])=>key===value)?value:'';
    }
    function controls(){
      const e=erp(),s=shop(),m=mother();
      $('singleListingStore').disabled=!e;$('singleListingMother').disabled=!s;
      $('singleListingSubmit').disabled=busy||!!prepared||!e||!s||!m||!binding().browserConfig;
      $('singleListingCheck').disabled=busy||!e;
      $('singleListingTitleLabel').textContent='上架标题'+(s?.titleLanguage?.label?'（'+s.titleLanguage.label+'）':'');
      $('singleListingBinding').textContent=!erps().length?'尚未绑定可上架的 ERP，请先到连接设置添加。':!e?'请选择 ERP 连接。':!config.stores.some(s=>s.erpKey===e.key&&s.platform==='temu')?'此 ERP 尚未绑定 Temu 店铺，请先到连接设置添加。':!s?'请选择此 ERP 下的店铺。':!s.templates.length?'这家店铺尚未配置母稿，请先到连接设置添加。':m?`${s.expectedStore} · ${s.expectedSite} · ${m.name}（${m.draftId}）`:'请选择这家店铺的母稿。';
      const publish=$('singleListingMode').value==='publish';
      $('singleListingSubmit').textContent=publish?'保存并发布':'保存到待发布';
      $('singleListingModeHint').textContent=publish?'核对以上商品信息后提交；保存并核验后提交平台发布，审核与在售状态可在进度页查看。':'仅创建并核验店小秘待发布草稿。';
    }
    function renderMothers(selected=''){
      const templates=shop()?.templates||[];
      options($('singleListingMother'),templates.map(t=>[t.key,t.name+' · '+t.draftId]),'请选择本店铺母稿',selected|| (templates.length===1?templates[0].key:''));controls();
    }
    function renderStores(selected='',template=''){
      const shops=config.stores.filter(s=>s.erpKey===erp()?.key&&s.platform==='temu');
      options($('singleListingStore'),shops.map(s=>[s.key,s.expectedStore+' · '+s.expectedSite]),erp()?(shops.length?'请选择店铺':'此 ERP 尚未绑定店铺'):'请先选择 ERP 连接',selected);
      renderMothers(template);
    }
    function renderConnections(selection={}){
      options($('singleListingErp'),erps().map(e=>[e.key,e.name+' · 店小秘']),'请选择 ERP 连接',selection.erpKey||(erps().length===1?erps()[0].key:''));
      renderStores(selection.storeKey,selection.templateKey);
    }
    function setBusy(value){busy=value;fieldset.disabled=value;d.querySelector('[data-close]').disabled=value;controls();}
    d.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    $('singleListingMode').value=saved.executionMode==='draft'?'draft':'publish';renderConnections(saved);
    $('singleListingErp').onchange=()=>{renderStores();notice('');remember();};
    $('singleListingStore').onchange=()=>{renderMothers();notice('');remember();};
    form.addEventListener('input',remember);form.addEventListener('change',()=>{controls();remember();});
    $('singleListingRefresh').onclick=async()=>{
      const selection=values();setBusy(true);
      try{config=await request('config');renderConnections(selection);notice('已更新 ERP、店铺和母稿列表。');}
      catch(error){notice(error.message,true);}finally{setBusy(false);}
    };
    $('singleListingCheck').onclick=async()=>{
      const erpKey=erp()?.key;if(!erpKey||busy)return;setBusy(true);notice('正在检查所选 ERP 的登录环境…');
      try{const result=await request('connection',{erpKey});notice(result.accountMatched===false?'店小秘账号不匹配，请检查连接设置。':result.loggedIn?'店小秘已登录'+(result.account?'：'+result.account:''):result.connected?'浏览器可连接，请在其中登录店小秘。':'ERP 环境无法连接。',!result.loggedIn||result.accountMatched===false);}
      catch(error){notice(error.message,true);}finally{setBusy(false);}
    };
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||prepared||!form.reportValidity())return;
      const selection=values(),target=shop(),template=mother(),connectionBinding=binding();
      if(!target||!template)return;
      remember();setBusy(true);notice('正在核对店铺绑定并准备上架…');
      try{
        // A setting changed in another window must never silently redirect this submission.
        const latest=await request('config'),nextStore=latest.stores.find(s=>s.key===target.key),nextErp=latest.erpConnections.find(e=>e.key===selection.erpKey);
        if(canonical({store:nextStore,connection:{erpConnection:nextErp,browserConfig:latest.browsers.find(b=>b.key===nextErp?.browserKey)}})!==canonical({store:target,connection:connectionBinding})){
          config=latest;renderConnections(selection);throw new Error('ERP、店铺或母稿配置已变化，已更新列表，请重新核对后提交。');
        }
        prepared=await request('prepare',{previewId:preview.id,storeKey:target.key,erpKey:selection.erpKey,storeName:target.expectedStore,site:target.expectedSite,connectionBinding,executionMode:selection.executionMode,
          rows:[{...row,productCode:selection.productCode.trim(),title:selection.title.trim(),englishTitle:selection.englishTitle.trim(),templateKey:template.key,imageIds:images.map(i=>i.id)}]});
        const url='/temu/listings?batch='+encodeURIComponent(prepared.id);
        const progress=$('singleListingProgress');progress.href=url;progress.hidden=false;
        try{localStorage.setItem('temu-erp-active',prepared.id);localStorage.setItem('listing-active-task',JSON.stringify({kind:'execution',id:prepared.id,mode:'generated'}));}catch{}
        // Existing or uncertain work is resumed through its recorded status, never from this shortcut.
        if(prepared.status==='ready'){
          notice(selection.executionMode==='publish'?'正在提交保存并发布…':'正在提交保存到待发布…');
          await request('batches/'+prepared.id+'/start',{});
        }
        location.assign(url);
      }catch(error){notice(error.message+(prepared?'。执行清单已保留，请打开下方进度页核对或继续，不要重复提交。':''),true);}
      finally{setBusy(false);if(prepared)fieldset.disabled=true;}
    };
  };
})();
