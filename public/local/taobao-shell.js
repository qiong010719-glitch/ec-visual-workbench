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
    #taobaoShell #tbSkuUpload{font-size:15px;font-weight:800;padding:10px 16px;background:#ffd36a;color:#1a1404;border:1px solid #ffd36a}
    #taobaoShell #tbSkuUploadCount{font-size:13px;font-weight:700;color:#ffd36a}
    #taobaoShell .tb-sku-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
    #taobaoShell .tb-sku-card{margin:0;display:flex;flex-direction:column;align-items:center;gap:2px;width:72px}
    #taobaoShell .tb-sku-card img{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,211,106,.8);background:#111}
    #taobaoShell .tb-sku-card figcaption{font-size:10px;color:#ffd36a;text-align:center}
    #taobaoShell .tb-sku-remove{font-size:10px;padding:2px 6px}
    #tbSkuFile{position:fixed;left:-120px;top:0;width:1px;height:1px;opacity:0}
    .taobao-legacy{margin:0;padding:0;border:0}
    .taobao-legacy summary{display:none}
    #designScope option[hidden],#targetMarket option[hidden],#targetMarket optgroup[hidden]{display:none !important}
    .taobao-deemphasize{opacity:.55}
    .taobao-slot-label{font-size:11px;font-weight:700;letter-spacing:.04em;color:#9fffea;padding:6px 8px 0}
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
    return layout.normalize(shell);
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
    return layout.SIZE_CHOICES.map(choice => `<option value="${choice.id}" ${choice.id === selected ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`).join('');
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
    return `当前：${parts.join('，')}。宽和高都填上（${layout.CUSTOM_MIN}–${layout.CUSTOM_MAX}）才用自定义尺寸，并写进这一组现有的生图要求。竖图若不是通道已有的 3:4、2:3、9:16，会就近选一档，避免被收成横图。改快捷尺寸会清掉这一组的自定义数字。`;
  }
  function syncCustom(widthId, heightId, size) {
    const width = $(widthId);
    const height = $(heightId);
    if (!width || !height) return;
    if (size) { width.value = String(size.width); height.value = String(size.height); return; }
    if (layout.parseCustomSize({width:width.value, height:height.value})) { width.value = ''; height.value = ''; }
  }
  function syncPanel(spec) {
    const value = layout.normalize(spec || layout.DEFAULTS);
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
      <div class="tb-sku-upload">
        <button type="button" id="tbSkuUpload">上传 SKU 图</button>
        <input id="tbSkuFile" type="file" accept="image/*" multiple>
        <span id="tbSkuUploadCount">还没有 SKU 图</span>
      </div>
      <p id="tbSkuUploadHint" class="local-muted">规格或颜色各传一张，按顺序对应 SKU图 1、2、3。照片进现有参考图（最多 8 张）。生成 SKU 图时用对应的这张，不再只按产品主体图。没传则仍走原来的生图。照片比 SKU 槽少时，多出来的槽用最后一张规格图。只在本机工作台使用，不会上传到淘宝。</p>
      <div id="tbSkuThumbs" class="tb-sku-thumbs"></div>
      <p id="tbDisclaimer" class="local-muted">只生成本机图。本地草稿 ≠ 淘宝草稿，没有淘宝发布接口，也不会写成「已进淘宝草稿 / 已发布」。尺寸是工作台可选尺寸，沿用现有 1024×1024、1536×1024、1024×1536，不是淘宝官方像素。自定义宽高仍写进现有生图要求。不承诺成图质量。</p>
      <div class="tb-grid">
        <label>淘宝主图张数 <input id="tbMainCount" type="number" min="0" max="5" value="${defaults.mainCount}"></label>
        <label>主图尺寸 <select id="tbMainSize">${sizeOptions(defaults.sizes.main)}</select></label>
        <label class="tb-custom">主图自定义宽 × 高 <span class="tb-pair"><input id="tbMainWidth" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="宽"><input id="tbMainHeight" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="高"></span></label>
        <label>SKU图张数 <input id="tbSkuCount" type="number" min="0" max="6" value="${defaults.skuCount}"></label>
        <label>SKU尺寸 <select id="tbSkuSize">${sizeOptions(defaults.sizes.sku)}</select></label>
        <label class="tb-custom">SKU自定义宽 × 高 <span class="tb-pair"><input id="tbSkuWidth" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="宽"><input id="tbSkuHeight" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="高"></span></label>
        <label>详情张数 <input id="tbDetailCount" type="number" min="0" max="7" value="${defaults.detailCount}"></label>
        <label>详情尺寸 <select id="tbDetailSize">${sizeOptions(defaults.sizes.detail)}</select></label>
        <label class="tb-custom">详情自定义宽 × 高 <span class="tb-pair"><input id="tbDetailWidth" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="宽"><input id="tbDetailHeight" type="number" min="${layout.CUSTOM_MIN}" max="${layout.CUSTOM_MAX}" placeholder="高"></span></label>
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
    $('tbSkuUpload').addEventListener('click', () => {
      const input = $('tbSkuFile');
      if (input && typeof input.click === 'function') input.click();
    });
    $('tbSkuFile').addEventListener('change', onSkuFiles);
  }
  const SKU_CATEGORY = 'SKU图';
  function skuMaterials() {
    if (typeof window.__workbenchMaterials !== 'function') return [];
    const list = window.__workbenchMaterials();
    if (!Array.isArray(list)) return [];
    return list.filter(item => item && item.category === SKU_CATEGORY && item.filename);
  }
  function refreshSkuStrip() {
    const photos = skuMaterials();
    const count = $('tbSkuUploadCount');
    if (count) count.textContent = photos.length ? `已上传 ${photos.length} 张 SKU 图` : '还没有 SKU 图';
    const box = $('tbSkuThumbs');
    if (!box) return;
    box.innerHTML = '';
    photos.forEach((photo, index) => {
      const card = document.createElement('figure');
      card.className = 'tb-sku-card';
      const src = photo.preview || photo.url || '';
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = `SKU图 ${index + 1}`;
        card.appendChild(img);
      }
      const caption = document.createElement('figcaption');
      caption.textContent = photo.filename || `SKU图 ${index + 1}`;
      card.appendChild(caption);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tb-sku-remove';
      remove.textContent = '移除';
      remove.addEventListener('click', () => {
        if (typeof removeMaterial === 'function') removeMaterial(photo.id);
        refreshSkuStrip();
      });
      card.appendChild(remove);
      box.appendChild(card);
    });
  }
  function onSkuFiles() {
    const input = $('tbSkuFile');
    const files = input?.files ? Array.from(input.files) : [];
    if (input) input.value = '';
    if (!files.length) { refreshSkuStrip(); return; }
    if (typeof processNewFiles !== 'function') {
      notify('SKU 图还没接上现有参考图库。', true);
      return;
    }
    processNewFiles(files, SKU_CATEGORY);
    refreshSkuStrip();
    setTimeout(refreshSkuStrip, 700);
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
    if (edit) details.appendChild(edit);
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
    const idle = slot.querySelector('.opacity-30');
    if (idle) idle.innerHTML = `${escapeHtml(label)}<br><span class="text-[10px]">单张位 · 工作台可选尺寸</span>`;
    if (item.zone === 'detail' && spec.detailWhitespace && !slot.querySelector('.taobao-pad')) {
      const pad = document.createElement('div');
      pad.className = 'taobao-pad';
      pad.textContent = '详情底部留白';
      slot.appendChild(pad);
    }
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
      const shot = window.__taobaoOneShot;
      try { return await originalTrigger.apply(this, args); }
      finally { if (shot && !shot.used) window.__taobaoOneShot = null; }
    };
  }
  if (typeof confirmCustomLayout === 'function') {
    const originalConfirm = confirmCustomLayout;
    window.confirmCustomLayout = function () {
      originalConfirm();
      const custom = window.__customLayout;
      if (custom?.taobao && !layout.countsMatch(custom)) {
        delete custom.taobao;
        if (typeof buildGalleryLayout === 'function') buildGalleryLayout();
      }
      syncPanel(custom?.taobao || readPanel());
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
