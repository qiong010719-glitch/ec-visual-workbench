/* Taobao shell. Relabels existing slots and reuses size mapping.
   Does not call a Taobao publish API. SKU photos stay on the material library. */
(() => {
  const layout = window.TaobaoLayout;
  if (!layout) return;
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notify = (text, error = false) => {
    if (window.aquaNotify) aquaNotify(error ? '淘宝壳' : '淘宝壳', text, error ? '⚠️' : '✓');
    else if (typeof _showSimpleToast === 'function') _showSimpleToast(text, error ? '#ff6b6b' : '#00ffc5');
  };
  const style = document.createElement('style');
  style.textContent = `
    #taobaoShell{margin:0 0 12px;padding:12px;border:1px solid rgba(0,255,197,.35);border-radius:14px;background:rgba(0,255,197,.06)}
    #taobaoShell h3{margin:0 0 6px;font-size:14px;color:#9fffea}
    #taobaoShell p{margin:0 0 8px}
    #taobaoShell .tb-grid{display:grid;grid-template-columns:1.2fr .7fr;gap:8px;align-items:center}
    #taobaoShell label{display:flex;justify-content:space-between;gap:8px;align-items:center;color:#d5deee;font-size:12px}
    #taobaoShell input[type="number"],#taobaoShell select{width:118px;background:#00000088;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px}
    #taobaoShell label.tb-style,#taobaoShell label.tb-custom{grid-column:1 / -1}
    #taobaoShell label.tb-style select{width:min(100%,240px)}
    #taobaoShell .tb-pair{display:flex;gap:6px}
    #taobaoShell .tb-pair input{width:72px}
    #taobaoShell .tb-row{display:flex;flex-wrap:wrap;gap:8px 12px;margin-top:8px;color:#d5deee;font-size:12px}
    #taobaoShell button{border:1px solid rgba(0,255,197,.45);background:rgba(0,255,197,.12);color:#eafff8;border-radius:8px;padding:7px 10px;cursor:pointer}
    #taobaoShell .tb-sku-upload{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 8px}
    #taobaoShell #tbSkuUploadCount{font-size:13px;font-weight:700;color:#ffd36a}
    #taobaoShell [data-sku-upload]{background:#ffd36a;color:#1a1404;border-color:#ffd36a;font-weight:800}
    #taobaoShell .tb-sku-spec{border:1px solid #ffffff33;border-radius:8px;padding:10px;margin:8px 0}
    #taobaoShell .tb-sku-spec legend{font-size:13px;color:#ffd36a;padding:0 4px}
    #taobaoShell .tb-sku-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    #taobaoShell .tb-sku-fields input,#taobaoShell .tb-sku-fields select{width:100%;min-width:0;box-sizing:border-box;background:#101b32;color:#fff;border:1px solid #ffffff44;border-radius:6px;padding:7px}
    #taobaoShell .tb-sku-fields label{display:flex;flex-direction:column;align-items:stretch;gap:4px}
    #taobaoShell .tb-sku-upload + label{flex-direction:column;align-items:stretch;gap:4px}
    #taobaoShell [hidden]{display:none !important}
    #tbSkuFile{position:fixed;left:-120px;top:0;width:1px;height:1px;opacity:0}
    .taobao-legacy{margin:0;padding:0;border:0}
    .taobao-legacy summary{display:none}
    #designScope option[hidden],#targetMarket option[hidden],#targetMarket optgroup[hidden]{display:none !important}
    .taobao-deemphasize{opacity:.55}
    .taobao-slot-label{font-size:11px;font-weight:700;letter-spacing:.04em;color:#9fffea;padding:6px 8px 0}
    .taobao-image-size{font-size:11px;line-height:1.6;color:#c7d5e8;padding:6px 10px;background:#091125}
    #customLayoutModal.taobao-directives .taobao-counts{display:none}
    .quest-slot[data-taobao-zone]{flex-direction:column;align-items:stretch;height:auto;transform:none !important}
    .quest-slot[data-taobao-zone] .slot-actions{position:static;transform:none;opacity:1;width:100%;box-sizing:border-box}
    .quest-slot[data-taobao-zone] > img{display:block;width:100%;height:auto}
    .taobao-redraw{width:100%;margin-top:4px;border:1px solid #ffd36a;color:#ffd36a;background:transparent;border-radius:8px;padding:6px;font-size:12px;font-weight:700;cursor:pointer}
    #galleryContainer.taobao-whitespace [data-taobao-zone="detail"]{box-shadow:inset 0 -36px 0 #f7f7f7}
    #galleryContainer.taobao-whitespace [data-taobao-zone="detail"] .taobao-pad{display:block;margin-top:4px;background:#f7f7f7;color:#666;text-align:center;font-size:10px;line-height:22px;border-radius:0 0 8px 8px}
    #localReferenceButton.taobao-deemphasize{opacity:.55;font-size:11px;border-style:dashed}
  `;
  document.head.appendChild(style);

  function currentSpec() {
    const shell = window.__customLayout?.taobao;
    if (!shell?.applied || $('designScope')?.value !== 'custom') return null;
    return unifiedSpec(shell);
  }
  function unifiedSpec(raw) {
    const spec=layout.normalize(raw?.applied&&!raw.skuMode?{...raw,skuMode:'photo'}:raw);
    if(spec.skuMode!=='combined'){
      const photos=skuMaterials();
      spec.skuSpecs.forEach((entry,i)=>{entry.photoId=spec.skuMode==='photo'?(photos[i]?.id||null):null;});
      spec.skuMode='combined';
      if(window.__customLayout?.taobao)Object.assign(window.__customLayout.taobao,spec);
    }
    return spec;
  }
  function readPanel() {
    return layout.normalize({
      mainCount:$('tbMainCount')?.value,
      skuCount:$('tbSkuCount')?.value,
      detailCount:$('tbDetailCount')?.value,
      sizes:{main:$('tbMainSize')?.value, sku:$('tbSkuSize')?.value, detail:$('tbDetailSize')?.value},
      customSizes:{
        main:{width:$('tbMainWidth')?.value, height:$('tbMainHeight')?.value},
        sku:{width:$('tbSkuWidth')?.value, height:$('tbSkuHeight')?.value},
        detail:{width:$('tbDetailWidth')?.value, height:$('tbDetailHeight')?.value}
      },
      detailWhitespace:!!$('tbWhitespace')?.checked,
      skuMode:'combined',
      skuSpecs:(()=>{
        const specs=layout.normalize(window.__customLayout?.taobao || {}).skuSpecs;
        document.querySelectorAll('#tbSkuFields [data-sku-index]').forEach(row=>{
          const entry=specs[Number(row.dataset.skuIndex)];
          row.querySelectorAll('[data-sku-field]').forEach(input=>{entry[input.dataset.skuField]=input.value;});
        });
        return specs;
      })(),
      background:document.querySelector('input[name="tbBg"]:checked')?.value || 'off',
      setStyle:$('tbSetStyle')?.value
    });
  }
  function styleOptions(selected) {
    return layout.SET_STYLES.map(choice => `<option value="${choice.id}" ${choice.id === selected ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`).join('');
  }
  function styleHint(spec) {
    const choice = layout.styleOf(spec);
    if (choice.id === 'off') return '不强制：主图、SKU图、详情仍按现在的生图规则，不额外改风格。';
    return `已选「${choice.label}」。主图、SKU图、详情整套共用这一条风格说明，仍走现在的生图。不承诺成图质量。`;
  }
  function sizeOptions(selected) {
    return layout.SIZE_CHOICES.map(choice => `<option value="${choice.id}" ${choice.id === selected ? 'selected' : ''}>${escapeHtml(choice.label.replace('工作台可选尺寸 · ', ''))} · ${choice.ratio}</option>`).join('');
  }
  function sizeHint(spec) {
    const value = layout.normalize(spec || layout.DEFAULTS);
    const names = {main:'主图', sku:'SKU', detail:'详情'};
    const parts = ['main','sku','detail'].map(zone => {
      const custom = value.customSizes[zone];
      if (custom) return `${names[zone]} ${custom.width}×${custom.height}`;
      const choice = layout.SIZE_CHOICES.find(item => item.id === value.sizes[zone]);
      return `${names[zone]} ${choice?.ratio || ''}`;
    });
    return `构图目标：${parts.join('，')}。宽和高都填上（${layout.CUSTOM_MIN}–${layout.CUSTOM_MAX} px）才启用自定义目标。生成仍使用方图 1024×1024、横图 1536×1024、竖图 1024×1536 档位；竖向比例会选就近支持档。实际像素以成图标注为准，下载保留原文件，不自动裁切或拉伸到目标尺寸。改快捷尺寸会清空该组自定义值。`;
  }
  function syncCustom(widthId, heightId, size) {
    const width = $(widthId);
    const height = $(heightId);
    if (!width || !height) return;
    if (size) { width.value = String(size.width); height.value = String(size.height); return; }
    if (layout.parseCustomSize({width:width.value, height:height.value})) { width.value = ''; height.value = ''; }
  }
  function syncPanel(spec) {
    const value = unifiedSpec(spec || layout.DEFAULTS);
    if ($('tbMainCount')) $('tbMainCount').value = value.mainCount;
    if ($('tbSkuCount')) $('tbSkuCount').value = value.skuCount;
    if ($('tbDetailCount')) $('tbDetailCount').value = value.detailCount;
    if ($('tbMainSize')) $('tbMainSize').value = value.sizes.main;
    if ($('tbSkuSize')) $('tbSkuSize').value = value.sizes.sku;
    if ($('tbDetailSize')) $('tbDetailSize').value = value.sizes.detail;
    syncCustom('tbMainWidth', 'tbMainHeight', value.customSizes.main);
    syncCustom('tbSkuWidth', 'tbSkuHeight', value.customSizes.sku);
    syncCustom('tbDetailWidth', 'tbDetailHeight', value.customSizes.detail);
    const sizeLine = $('tbSizeHint');
    if (sizeLine) sizeLine.textContent = sizeHint(value);
    if ($('tbWhitespace')) $('tbWhitespace').checked = value.detailWhitespace;
    if ($('tbSetStyle')) $('tbSetStyle').value = value.setStyle;
    syncSkuInputs(value);
    const radio = document.querySelector(`input[name="tbBg"][value="${value.background}"]`);
    if (radio) radio.checked = true;
    const hint = $('tbStyleHint');
    if (hint) hint.textContent = styleHint(value);
    const status = $('tbStatus');
    if (status) status.textContent = currentSpec() ? '淘宝壳已套用到当前出图范围。本地草稿，不是淘宝草稿，也未发布。' : '改数量或尺寸后会套用到淘宝主图 / SKU图 / 详情。尚未覆盖当前旧范围。';
  }
  function syncGselLabel(select) {
    if (!select) return;
    const label = document.querySelector(`[data-gsel-for="${select.id}"] .gsel-label`);
    const chosen = select.selectedOptions?.[0] || select.options[select.selectedIndex];
    if (label && chosen) label.textContent = chosen.textContent;
  }
  function lockCustomerMarket() {
    const sel = $('targetMarket');
    if (!sel) return;
    const china = [...sel.options].find(option => {
      try { return JSON.parse(option.value).market === '中国大陆'; }
      catch { return option.textContent.includes('中国大陆'); }
    });
    if (!china) return;
    if (china.parentElement && china.parentElement !== sel) sel.appendChild(china);
    china.hidden = false;
    china.disabled = false;
    for (const option of [...sel.options]) if (option !== china) option.hidden = true;
    for (const group of [...sel.querySelectorAll('optgroup')]) group.hidden = true;
    if (sel.value !== china.value) sel.value = china.value;
    syncGselLabel(sel);
  }
  function preferChinaMarket() { lockCustomerMarket(); }
  function applySpec(spec, {market} = {}) {
    const normalized = layout.normalize(spec);
    const previous = window.__customLayout?.directives || {};
    window.__customLayout = layout.toCustomLayout(normalized, previous);
    const scope = $('designScope');
    if (scope) scope.value = 'custom';
    if (typeof __lastScopeVal !== 'undefined') __lastScopeVal = 'custom';
    const edit = $('customEditBtn');
    if (edit) edit.style.display = '';
    if (market) preferChinaMarket();
    syncGselLabel(scope);
    if (typeof buildGalleryLayout === 'function') buildGalleryLayout();
    if (typeof imageSlots !== 'undefined' && typeof renderSlot === 'function') imageSlots.forEach((img, index) => { if (img) renderSlot(index); });
    syncPanel(normalized);
    if (typeof saveAppState === 'function') saveAppState();
  }
  function maybeApplyPreset() {
    const scope = $('designScope');
    if (!scope || scope.value) { syncPanel(window.__customLayout?.taobao || layout.DEFAULTS); return; }
    applySpec(layout.DEFAULTS, {market:true});
  }

  function mountPanel() {
    if ($('taobaoShell') || !$('designScope')) return;
    const defaults = layout.DEFAULTS;
    const panel = document.createElement('section');
    panel.id = 'taobaoShell';
    panel.innerHTML = `
      <h3>淘宝壳 · 主图 / SKU图 / 详情</h3>
      <h3>SKU图片与规格信息</h3>
      <p id="tbSkuUploadHint" class="local-muted">每款SKU在同一卡片提供图片和信息。有图可补充规格；没图请至少填写一项实物尺寸，并上传右侧产品主体图。填写的名称与尺寸优先于图片中的同项信息，未知项留空，不会借用其他SKU图。</p>
      <input id="tbSkuFile" type="file" accept="image/*">
      <span id="tbSkuUploadCount" class="local-muted"></span>
      <div id="tbSkuFields"></div>
      <p id="tbSkuError" role="status" style="color:#ffd36a"></p>
      <p id="tbDisclaimer" class="local-muted">图片和草稿保存在本机，不是淘宝草稿，也未发布。自定义宽高用于构图，实际尺寸会显示在成图旁；下载保留原图尺寸和格式。</p>
      <div class="tb-grid">
        <label>淘宝主图张数 <input id="tbMainCount" type="number" min="0" max="5" value="${defaults.mainCount}"></label>
        <label>主图尺寸 <select id="tbMainSize">${sizeOptions(defaults.sizes.main)}</select></label>
        <label class="tb-custom">主图构图目标宽 × 高（px） <span class="tb-pair"><input id="tbMainWidth" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="宽"><input id="tbMainHeight" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="高"></span></label>
        <label>SKU图张数 <input id="tbSkuCount" type="number" min="0" max="6" value="${defaults.skuCount}"></label>
        <label>SKU尺寸 <select id="tbSkuSize">${sizeOptions(defaults.sizes.sku)}</select></label>
        <label class="tb-custom">SKU构图目标宽 × 高（px） <span class="tb-pair"><input id="tbSkuWidth" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="宽"><input id="tbSkuHeight" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="高"></span></label>
        <label>详情张数 <input id="tbDetailCount" type="number" min="0" max="7" value="${defaults.detailCount}"></label>
        <label>详情尺寸 <select id="tbDetailSize">${sizeOptions(defaults.sizes.detail)}</select></label>
        <label class="tb-custom">详情构图目标宽 × 高（px） <span class="tb-pair"><input id="tbDetailWidth" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="宽"><input id="tbDetailHeight" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="高"></span></label>
        <label class="tb-style">整套风格 <select id="tbSetStyle">${styleOptions(defaults.setStyle)}</select></label>
      </div>
      <p id="tbSizeHint" class="local-muted">${escapeHtml(sizeHint(defaults))}</p>
      <p id="tbMainHint" class="local-muted">第一张主图可用场景或设计背景，按构思、整套风格和逐张要求安排；白底可按需选择。</p>
      <p id="tbStyleHint" class="local-muted">${escapeHtml(styleHint(defaults))}</p>
      <div class="tb-row">
        <label><input id="tbWhitespace" type="checkbox" checked> 详情底部留白</label>
        <label><input type="radio" name="tbBg" value="off" checked> 不附加白底/透明</label>
        <label><input type="radio" name="tbBg" value="white"> 白底图</label>
        <label><input type="radio" name="tbBg" value="transparent"> 透明图</label>
      </div>
      <div class="tb-row">
        <button type="button" id="tbBgEntry">只重绘一张白底/透明图</button>
      </div>
      <p id="tbStatus" class="local-muted"></p>`;
    $('designScope').before(panel);
    for (const id of ['tbMainCount','tbSkuCount','tbDetailCount','tbSetStyle']) $(id).addEventListener('change', () => applySpec(readPanel()));
    bindShortcut('tbMainSize', 'tbMainWidth', 'tbMainHeight');
    bindShortcut('tbSkuSize', 'tbSkuWidth', 'tbSkuHeight');
    bindShortcut('tbDetailSize', 'tbDetailWidth', 'tbDetailHeight');
    for (const id of ['tbMainWidth','tbMainHeight','tbSkuWidth','tbSkuHeight','tbDetailWidth','tbDetailHeight']) {
      $(id).addEventListener('input', () => applySpec(readPanel()));
      $(id).addEventListener('change', () => applySpec(readPanel()));
    }
    $('tbWhitespace').addEventListener('change', () => applySpec(readPanel()));
    document.querySelectorAll('input[name="tbBg"]').forEach(input => input.addEventListener('change', () => applySpec(readPanel())));
    $('tbBgEntry').addEventListener('click', redrawBackground);
    $('tbSkuFile').addEventListener('change', onSkuFiles);
    $('tbSkuFields').addEventListener('click',event=>{
      const button=event.target.closest('[data-sku-upload],[data-sku-remove]');
      if(!button||skuUploading)return;
      const index=Number(button.closest('[data-sku-index]').dataset.skuIndex);
      if(button.hasAttribute('data-sku-upload')){skuUploadIndex=index;$('tbSkuFile').click();}
      else{
        const spec=readPanel(),id=spec.skuSpecs[index].photoId;spec.skuSpecs[index].photoId=null;
        applySpec(spec);
        if(id&&!spec.skuSpecs.some(entry=>entry.photoId===id)&&typeof removeMaterial==='function')removeMaterial(id);
      }
    });
    $('tbSkuFields').addEventListener('change',event=>{
      if(!event.target.matches('[data-sku-photo]'))return;
      const spec=readPanel(),index=Number(event.target.closest('[data-sku-index]').dataset.skuIndex);
      spec.skuSpecs[index].photoId=event.target.value||null;applySpec(spec);
    });
    for(const event of ['input','change'])$('tbSkuFields').addEventListener(event,e=>{
      if(e.target.matches('[data-sku-field]'))applySpec(readPanel());
    });
  }
  function syncSkuInputs(spec) {
    if(!$('tbSkuFields'))return;
    const box=$('tbSkuFields');
    if(box.querySelectorAll('[data-sku-index]').length!==spec.skuCount){
      box.innerHTML=Array.from({length:spec.skuCount},(_,i)=>`<fieldset class="tb-sku-spec" data-sku-index="${i}"><legend>SKU图 ${i+1} · 图片与规格</legend><div class="tb-sku-upload"><img data-sku-preview alt="SKU ${i+1} 参考图" hidden style="width:72px;height:72px;object-fit:contain;border-radius:6px"><button type="button" data-sku-upload aria-label="上传SKU ${i+1} 图片">上传本款图片</button><button type="button" data-sku-remove hidden aria-label="移除SKU ${i+1} 图片">移除图片</button></div><label>本款参考图<select data-sku-photo aria-label="SKU ${i+1} 图片" style="width:100%"></select></label><p data-sku-photo-hint class="local-muted"></p><div class="tb-sku-fields"><label>名称 / 款式（选填）<input data-sku-field="name" type="text" maxlength="80" aria-label="SKU ${i+1} 名称"></label><label>尺寸单位<select data-sku-field="unit" aria-label="SKU ${i+1} 单位"><option value="mm">毫米 mm</option><option value="cm">厘米 cm</option><option value="m">米 m</option></select></label>${[['length','长'],['width','宽'],['height','高'],['depth','深 / 厚']].map(([key,label])=>`<label>${label}<input data-sku-field="${key}" type="number" min="0" step="any" placeholder="未知留空" aria-label="SKU ${i+1} ${label}"></label>`).join('')}</div></fieldset>`).join('');
    }
    box.querySelectorAll('[data-sku-index]').forEach(row=>row.querySelectorAll('[data-sku-field]').forEach(input=>{
      const value=spec.skuSpecs[Number(row.dataset.skuIndex)][input.dataset.skuField];
      if(input.value!==value)input.value=value;
    }));
    renderSkuPhotos(spec);
  }
  const SKU_CATEGORY = 'SKU图';
  function skuMaterials() {
    if (typeof window.__workbenchMaterials !== 'function') return [];
    const list = window.__workbenchMaterials();
    if (!Array.isArray(list)) return [];
    return list.filter(item => item && item.category === SKU_CATEGORY && item.filename);
  }
  window.prepareTaobaoSkuPayload=async payload=>{
    const spec=currentSpec();
    if(!spec?.skuCount)return payload;
    const status=await LocalWorkbench.imageModelStatus();
    if(status.skuInputVersion!==2)throw Error('本地服务尚未加载SKU图片与信息合并功能，请重启本项目服务并刷新网页；没有提交构思或出图。');
    if(skuUploading)throw Error('SKU图片仍在读取，请完成后再构思。');
    for(let i=0;i<spec.skuCount;i++){
      const entry=spec.skuSpecs[i],photo=skuMaterials().find(p=>p.id===entry.photoId);
      const values=['length','width','height','depth'].map(key=>entry[key].trim()).filter(Boolean);
      if(entry.photoId&&!photo)throw Error(`SKU图 ${i+1} 的图片已移除，请重新选择图片或点击移除图片清除绑定。`);
      if(values.some(value=>!/^\d+(?:\.\d+)?$/.test(value)||Number(value)<=0||Number(value)>999999))throw Error(`SKU图 ${i+1} 的实物尺寸须为大于0的数字。`);
      if(!photo&&!values.length)throw Error(`请为SKU图 ${i+1} 上传图片或至少填写一项实物尺寸。`);
      if(!photo&&!window.__workbenchMaterials?.().some(item=>item.category==='产品主体图'))throw Error('请上传产品主体图，系统将结合本品外观与填写尺寸生成SKU规格图。');
    }
    $('tbSkuError').textContent='';return payload;
  };
  async function skuPreflight(){
    try{await window.prepareTaobaoSkuPayload({});return true;}
    catch(error){if($('tbSkuError'))$('tbSkuError').textContent=error.message;notify(error.message,true);return false;}
  }
  let skuUploadIndex=0,skuUploading=false;
  function renderSkuPhotos(spec){
    const photos=skuMaterials();
    const count=$('tbSkuUploadCount');if(count)count.textContent=`已上传 ${photos.length} 张 SKU 图`;
    $('tbSkuFields')?.querySelectorAll('[data-sku-index]').forEach(row=>{
      const entry=spec.skuSpecs[Number(row.dataset.skuIndex)],photo=photos.find(p=>p.id===entry.photoId);
      const select=row.querySelector('[data-sku-photo]'),img=row.querySelector('[data-sku-preview]');
      const options='<option value="">无SKU图 · 使用产品主体图与填写尺寸</option>'+photos.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.filename)}</option>`).join('')+(entry.photoId&&!photo?`<option value="${escapeHtml(entry.photoId)}">图片已移除，请重新选择</option>`:'');
      if(select.innerHTML!==options)select.innerHTML=options;
      select.value=entry.photoId||'';select.disabled=skuUploading;
      img.hidden=!photo;if(photo)img.src=photo.preview||photo.url||'';else img.removeAttribute('src');
      const upload=row.querySelector('[data-sku-upload]');upload.disabled=skuUploading;upload.textContent=photo?'更换本款图片':'上传本款图片';
      const remove=row.querySelector('[data-sku-remove]');remove.hidden=!entry.photoId;remove.disabled=skuUploading;
      row.querySelector('[data-sku-photo-hint]').textContent=photo?'按本款图片生成，可在下方补充名称与尺寸。':'没有本款图片时，请在下方至少填写一项商品实物尺寸（不是图片像素）。';
    });
  }
  function refreshSkuStrip() {
    renderSkuPhotos(currentSpec()||layout.normalize(window.__customLayout?.taobao||layout.DEFAULTS));
  }
  async function onSkuFiles() {
    const input=$('tbSkuFile'),file=input?.files?.[0],index=skuUploadIndex;
    if(input)input.value='';if(!file||skuUploading)return;
    if(!file.type.startsWith('image/')){notify('请选择图片文件。',true);return;}
    const oldId=readPanel().skuSpecs[index].photoId;
    const replaceOld=oldId&&!readPanel().skuSpecs.some((entry,i)=>i!==index&&entry.photoId===oldId)&&globalMaterials.some(m=>m.id===oldId);
    if(globalMaterials.length>=8&&!replaceOld){notify('参考图最多8张，请先移除不需要的图片。',true);return;}
    skuUploading=true;refreshSkuStrip();
    try{
      const dataUrl=await compressImageFile(file).catch(()=>new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取失败'));reader.readAsDataURL(file);
      }));
      const spec=readPanel();
      if(globalMaterials.length-(replaceOld&&globalMaterials.some(m=>m.id===oldId)?1:0)>=8)throw Error('参考图已满');
      if(replaceOld)globalMaterials=globalMaterials.filter(m=>m.id!==oldId);
      const photo={id:'mat_'+crypto.randomUUID(),base64:dataUrl.split(',')[1],preview:dataUrl,category:SKU_CATEGORY};
      globalMaterials.push(photo);updateFilenames();renderMaterialGrid();
      $('uploadCountIndicator').innerText=globalMaterials.length+'/8';
      spec.skuSpecs[index].photoId=photo.id;applySpec(spec);
      $('tbSkuError').textContent='图片与信息已绑定到本款SKU；生成前请重新构思。';
    }catch(error){notify(error.message==='参考图已满'?'参考图最多8张，请先移除不需要的图片。':'这张图片无法读取，请换一张JPG或PNG图片。',true);}
    finally{skuUploading=false;refreshSkuStrip();}
  }
  function hookMaterialChanges() {
    if (typeof processNewFiles === 'function' && !processNewFiles.__tbSku) {
      const original = processNewFiles;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        refreshSkuStrip();
        setTimeout(refreshSkuStrip, 700);
        return result;
      };
      wrapped.__tbSku = true;
      window.processNewFiles = wrapped;
    }
    if (typeof removeMaterial === 'function' && !removeMaterial.__tbSku) {
      const original = removeMaterial;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        refreshSkuStrip();
        if(typeof saveAppState==='function')saveAppState();
        return result;
      };
      wrapped.__tbSku = true;
      window.removeMaterial = wrapped;
    }
  }
  function bindShortcut(selectId, widthId, heightId) {
    $(selectId).addEventListener('change', () => {
      if ($(widthId)) $(widthId).value = '';
      if ($(heightId)) $(heightId).value = '';
      applySpec(readPanel());
    });
  }
  function redrawBackground() {
    const picked = document.querySelector('input[name="tbBg"]:checked')?.value;
    const mode = picked === 'transparent' ? 'transparent' : 'white';
    applySpec(readPanel());
    const spec = currentSpec();
    const slot = layout.backgroundSlot(spec);
    if (slot == null) { notify('至少保留一张主图、SKU图或详情，才能单张重绘。', true); return; }
    window.__taobaoOneShot = {slot, note:layout.backgroundNote(mode), used:false};
    if (typeof triggerGeneration !== 'function') { notify('单张重绘入口还没准备好。', true); return; }
    notify(mode === 'transparent' ? `只重绘第 ${slot + 1} 槽（透明图要求），不重跑整套。` : `只重绘第 ${slot + 1} 槽（白底图），不重跑整套。`);
    triggerGeneration(slot);
  }

  function hideLegacyOptions() {
    const scope = $('designScope');
    if (!scope || scope.dataset.taobaoHiding === '1') return;
    scope.dataset.taobaoHiding = '1';
    let custom = [...scope.options].find(option => option.value === 'custom');
    if (!custom) {
      custom = document.createElement('option');
      custom.value = 'custom';
      scope.appendChild(custom);
    }
    custom.hidden = false;
    custom.disabled = false;
    custom.textContent = '淘宝壳 · 主图 / SKU图 / 详情';
    for (const option of [...scope.options]) {
      if (option === custom || !option.value) continue;
      option.hidden = true;
      if (option.textContent.startsWith('内部保留')) continue;
      const label = option.value === 'ultra_main_8' ? '极速合图' : option.value === 'main_and_6' ? '主幅图7张' : option.textContent;
      option.textContent = '内部保留 · ' + label;
    }
    scope.dataset.taobaoHiding = '';
    const typeLabel = $('clAplusType')?.closest('label');
    if (typeLabel) typeLabel.classList.add('taobao-deemphasize');
    const typeName = typeLabel?.querySelector('span');
    if (typeName && !typeName.dataset.taobaoLabeled) { typeName.dataset.taobaoLabeled = '1'; typeName.textContent = '内部保留 · 老A+ / 高级A+'; }
    const manual = $('btnModeManual');
    if (manual) { manual.classList.add('taobao-deemphasize'); manual.textContent = '内部 · 连排切割'; }
    document.querySelectorAll('#panelManual label').forEach(label => label.classList.add('taobao-deemphasize'));
    $('editTabMobile')?.classList.add('taobao-deemphasize');
    const reference = $('localReferenceButton');
    if (reference) { reference.classList.add('taobao-deemphasize'); reference.textContent = '内部·美国站参考'; reference.title = '美国站 Apify 参考库仍保留，不是淘宝客户入口'; }
  }
  function parkLegacyScope() {
    const scope = $('designScope');
    if (!scope || $('taobaoLegacyScope')) return;
    const details = document.createElement('details');
    details.id = 'taobaoLegacyScope';
    details.className = 'taobao-legacy';
    details.innerHTML = '<summary hidden></summary>';
    scope.before(details);
    details.appendChild(scope);
    const edit = $('customEditBtn');
    if (edit) { edit.textContent = '逐张要求与参考图'; $('taobaoShell').appendChild(edit); }
  }

  function showImageSize(slot, spec, zone) {
    const image = slot.querySelector('img');
    if (!image) return;
    let line = slot.querySelector('.taobao-image-size');
    if (!line) { line = document.createElement('div'); line.className = 'taobao-image-size'; image.after(line); }
    const update = () => {
      if (!image.naturalWidth) { line.textContent = '图片加载后显示实际尺寸'; return; }
      const custom = spec.customSizes[zone];
      line.textContent = `原图 ${image.naturalWidth}×${image.naturalHeight} px · 下载保留原尺寸` +
        (custom ? `；构图目标 ${custom.width}×${custom.height} px` : '');
    };
    if (!image.complete) image.addEventListener('load', update, {once:true});
    update();
  }
  function decorateSlot(index) {
    const spec = currentSpec();
    const slot = $('slot-' + index);
    if (!spec || !slot) return;
    const item = layout.zoneForSlot(index, spec);
    const label = layout.customerLabel(index, spec);
    if (!item || !label) return;
    slot.dataset.taobaoZone = item.zone;
    let caption = slot.querySelector('.taobao-slot-label');
    if (!caption) { caption = document.createElement('div'); caption.className = 'taobao-slot-label'; slot.prepend(caption); }
    caption.textContent = label;
    showImageSize(slot, spec, item.zone);
    const idle = slot.querySelector('.opacity-30');
    if (idle) idle.innerHTML = `${escapeHtml(label)}<br><span class="text-[10px]">单张位 · 工作台可选尺寸</span>`;
    if (item.zone === 'detail' && spec.detailWhitespace && !slot.querySelector('.taobao-pad')) {
      const pad = document.createElement('div');
      pad.className = 'taobao-pad';
      pad.textContent = '详情底部留白';
      slot.appendChild(pad);
    }
    const existingRedraw = slot.querySelector(`button[onclick="triggerGeneration(${index})"]`);
    if (existingRedraw) existingRedraw.dataset.taobaoRedraw = String(index);
    if (!slot.querySelector('[data-taobao-redraw]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'taobao-redraw';
      button.dataset.taobaoRedraw = String(index);
      button.textContent = '重绘这一张';
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (typeof triggerGeneration === 'function') triggerGeneration(index); });
      (slot.querySelector('.slot-actions') || slot).appendChild(button);
    }
  }

  function imageItem(index, spec) {
    const data = typeof imageSlots !== 'undefined' ? imageSlots[index] : null;
    const url = data?.history?.[data.currentIndex] || data?.url;
    return url ? {url, label:layout.customerLabel(index, spec)} : null;
  }
  if (typeof downloadSingle === 'function') {
    const originalDownload = downloadSingle;
    const downloading = new Set();
    window.downloadSingle = async function (index) {
      const spec = currentSpec();
      if (!spec || !window.TaobaoFiles) return originalDownload(index);
      const item = imageItem(index, spec);
      if (!item || downloading.has(index)) return;
      downloading.add(index);
      try { await TaobaoFiles.download(item); }
      catch (error) { notify(error.message, true); }
      finally { downloading.delete(index); }
    };
  }
  if (typeof batchDownloadAll === 'function') {
    const originalBatch = batchDownloadAll;
    let downloading = false;
    window.batchDownloadAll = async function () {
      const spec = currentSpec();
      if (!spec || !window.TaobaoFiles) return originalBatch();
      if (downloading) return;
      const items = layout.activeSlots(spec).map(item => imageItem(item.slot, spec)).filter(Boolean);
      if (!items.length) { notify('还没有可下载的成图。'); return; }
      const pending = typeof activeKieTasks !== 'undefined' ? activeKieTasks.length : 0;
      if (pending) notify(`还有 ${pending} 张在处理中，本次只下载已显示的 ${items.length} 张。`);
      const subtitle = $('batchBtnContainer')?.querySelector('.btn-split-bottom');
      const previous = subtitle?.textContent;
      downloading = true;
      try {
        const result = await TaobaoFiles.bundle(items, (done, total) => { if (subtitle) subtitle.textContent = `正在打包 ${done}/${total} 张原图…`; });
        notify(result.failed.length ? `已打包 ${result.count} 张；未下载：${result.failed.join('、')}。详见包内清单，可重试下载。` : `已打包 ${result.count} 张原图，保留实际尺寸和格式。`, !!result.failed.length);
      } catch (error) { notify(error.message, true); }
      finally { downloading = false; if (subtitle) subtitle.textContent = previous; }
    };
  }

  if (typeof renderCustomCards === 'function') {
    const originalCards = renderCustomCards;
    window.renderCustomCards = function () {
      originalCards();
      const spec = currentSpec(), modal = $('customLayoutModal');
      if (!modal) return;
      modal.classList.toggle('taobao-directives', !!spec);
      if (!spec) return;
      modal.querySelector('h3').textContent = '逐张要求与参考图';
      $('clTotalLine').parentElement.classList.add('taobao-counts');
      const cards = Array.from($('customSlotCards').children);
      const photos = skuMaterials();
      layout.activeSlots(spec).forEach((item, i) => {
        const heading = cards[i]?.querySelector('.font-bold');
        if (heading) heading.textContent = layout.customerLabel(item.slot, spec);
        if (item.zone === 'sku') {
          const picker = cards[i]?.querySelector('[onclick^="toggleCustomRef"]')?.parentElement;
          if (picker) {
            picker.hidden = true;
            picker.style.display = 'none';
            const photo=photos.find(p=>p.id===spec.skuSpecs[item.index-1].photoId);
            picker.previousElementSibling.textContent = photo?`参考图：${photo.filename}；结合本款填写信息`:'参考图：产品主体图；规格来自本款填写信息';
          }
        }
      });
      const hint = $('customSlotCards').previousElementSibling;
      if (hint) hint.textContent = '数量、画幅与SKU实物尺寸在工作台设置。每张要求可单独填写；主图、详情可勾参考图。SKU在同一卡片绑定本款图片与填写信息。';
    };
  }
  function decorateGallery() {
    const gallery = $('galleryContainer');
    const spec = currentSpec();
    if (!gallery) return;
    gallery.classList.toggle('taobao-whitespace', !!(spec && spec.detailWhitespace));
    if (!spec) return;
    const mainHead = gallery.querySelector('.gallery-wrapper > .text-sheikah-blue');
    const detailHead = gallery.querySelector('.gallery-wrapper > .text-zonai-teal');
    if (spec.mainCount > 0 && mainHead) mainHead.textContent = '淘宝主图 · 工作台可选尺寸';
    else if (spec.mainCount === 0 && spec.skuCount > 0 && mainHead) mainHead.textContent = 'SKU图 · 工作台可选尺寸';
    if (detailHead) detailHead.textContent = '详情 · 工作台可选尺寸';
    const mainGrid = gallery.querySelector('.main-images-section');
    const skuSlots = layout.activeSlots(spec).filter(item => item.zone === 'sku');
    if (spec.mainCount > 0 && skuSlots.length && mainGrid && !gallery.querySelector('[data-taobao-sku-grid]')) {
      const head = document.createElement('div');
      head.className = 'text-sheikah-blue font-bold tracking-widest mt-8 mb-3 font-mono text-sm';
      head.textContent = 'SKU图 · 工作台可选尺寸';
      const grid = document.createElement('div');
      grid.className = 'main-images-section';
      grid.dataset.taobaoSkuGrid = '1';
      mainGrid.after(head, grid);
      skuSlots.forEach(item => { const slot = $('slot-' + item.slot); if (slot) grid.appendChild(slot); });
    }
    for (let index = 0; index < 14; index++) decorateSlot(index);
  }

  if (typeof buildGalleryLayout === 'function') {
    const originalBuild = buildGalleryLayout;
    window.buildGalleryLayout = function () { originalBuild(); decorateGallery(); };
  }
  if (typeof renderSlot === 'function') {
    const originalRender = renderSlot;
    window.renderSlot = function (index) { originalRender(index); decorateSlot(index); };
  }
  if (typeof _aspectForTitle === 'function') {
    const originalAspect = _aspectForTitle;
    window._aspectForTitle = function (title) {
      const spec = currentSpec();
      const ratio = spec ? layout.ratioForTitle(title, spec) : null;
      return ratio || originalAspect(title);
    };
  }
  if (typeof buildSlotDirectives === 'function') {
    const originalDirectives = buildSlotDirectives;
    window.buildSlotDirectives = function () {
      const dirs = originalDirectives();
      const spec = currentSpec();
      if (!dirs || !spec) return dirs;
      const annotated = layout.annotateDirectives(dirs, spec, window.__taobaoOneShot);
      if (window.__taobaoOneShot) {
        window.__taobaoOneShot.used = true;
        window.__taobaoOneShot = null;
      }
      return layout.attachSkuRefs(annotated.directives, spec, skuMaterials()).directives;
    };
  }
  if (typeof triggerGeneration === 'function') {
    const originalTrigger = triggerGeneration;
    window.triggerGeneration = async function (...args) {
      if(!await skuPreflight())return;
      const shot = window.__taobaoOneShot;
      try { return await originalTrigger.apply(this, args); }
      finally { if (shot && !shot.used) window.__taobaoOneShot = null; }
    };
  }
  if(typeof summonAgent==='function'){
    const originalSummon=summonAgent;
    window.summonAgent=async function(...args){if(!await skuPreflight())return;return originalSummon.apply(this,args);};
  }
  if (typeof confirmCustomLayout === 'function') {
    const originalConfirm = confirmCustomLayout;
    window.confirmCustomLayout = function () {
      const previousSpec = currentSpec();
      const previousImages = typeof imageSlots !== 'undefined' ? imageSlots.slice() : [];
      originalConfirm();
      const custom = window.__customLayout;
      if (custom?.taobao && !layout.countsMatch(custom)) {
        delete custom.taobao;
        if (typeof buildGalleryLayout === 'function') buildGalleryLayout();
      }
      syncPanel(custom?.taobao || readPanel());
      const spec = currentSpec();
      if (previousSpec && spec && typeof imageSlots !== 'undefined') {
        layout.activeSlots(spec).forEach(item => {
          if (previousImages[item.slot] && layout.customerLabel(item.slot, previousSpec) === layout.customerLabel(item.slot, spec)) {
            imageSlots[item.slot] = previousImages[item.slot];
            if (typeof renderSlot === 'function') renderSlot(item.slot);
          }
        });
        if (typeof saveAppState === 'function') saveAppState();
      }
    };
  }
  if (typeof openEditModal === 'function') {
    const originalOpen = openEditModal;
    window.openEditModal = function (index) {
      originalOpen(index);
      const label = currentSpec() ? layout.customerLabel(index, currentSpec()) : '';
      if (label && $('modalSlotTitle')) $('modalSlotTitle').textContent = `[ ${label} ]`;
    };
  }
  if (typeof __loadAppStateFrom === 'function') {
    const originalLoad = __loadAppStateFrom;
    window.__loadAppStateFrom = function (...args) {
      const result = originalLoad.apply(this, args);
      hideLegacyOptions();
      lockCustomerMarket();
      maybeApplyPreset();
      refreshSkuStrip();
      return result;
    };
  }

  function watchScope() {
    const scope = $('designScope');
    if (!scope || scope.dataset.taobaoWatch) return;
    scope.dataset.taobaoWatch = '1';
    new MutationObserver(() => hideLegacyOptions()).observe(scope, {childList:true});
  }
  function setup() {
    mountPanel();
    parkLegacyScope();
    watchScope();
    hideLegacyOptions();
    lockCustomerMarket();
    $('generationMode')?.addEventListener('change', event => {
      hideLegacyOptions();
      syncGselLabel($('designScope'));
      if (!(event.detail && event.detail.isRestore) && !$('designScope')?.value && typeof buildGalleryLayout === 'function') buildGalleryLayout();
      syncPanel(window.__customLayout?.taobao || readPanel());
    });
    hookMaterialChanges();
    refreshSkuStrip();
    setTimeout(refreshSkuStrip, 1700);
    maybeApplyPreset();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
