/* Pure Taobao shell mapping. Customer labels sit on the existing 14 slots.
   Internal titles stay 主图 / 卖点图 / 高级A+ so the planner and single-slot redraw keep working.
   Sizes stay the workbench trio: 1:1 → 1024², 16:9 → 1536×1024, 3:4 → 1024×1536. */
(function (root) {
  const SIZE_CHOICES = [
    {id:'square', ratio:'1:1', label:'工作台可选尺寸 · 方图', pixels:'1024×1024'},
    {id:'landscape', ratio:'16:9', label:'工作台可选尺寸 · 横图', pixels:'1536×1024'},
    {id:'portrait', ratio:'3:4', label:'工作台可选尺寸 · 竖图', pixels:'1024×1536'}
  ];
  const DEFAULTS = {
    mainCount:5, skuCount:1, detailCount:3,
    sizes:{main:'square', sku:'square', detail:'portrait'},
    detailWhitespace:true, background:'off'
  };
  function clampInt(value, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }
  function clampLayout(spec) {
    let mainCount = clampInt(spec?.mainCount, 0, 5);
    let skuCount = clampInt(spec?.skuCount, 0, 6);
    let detailCount = clampInt(spec?.detailCount, 0, 7);
    const skuRoom = mainCount > 0 ? 7 - mainCount : 6;
    if (skuCount > skuRoom) skuCount = skuRoom;
    if (mainCount + skuCount + detailCount < 1) mainCount = 1;
    return {mainCount, skuCount, detailCount};
  }
  function sizesOf(spec) {
    const sizes = spec?.sizes || {};
    const known = id => SIZE_CHOICES.some(choice => choice.id === id);
    return {
      main: known(sizes.main) ? sizes.main : DEFAULTS.sizes.main,
      sku: known(sizes.sku) ? sizes.sku : DEFAULTS.sizes.sku,
      detail: known(sizes.detail) ? sizes.detail : DEFAULTS.sizes.detail
    };
  }
  function normalize(spec) {
    const counts = clampLayout(spec || DEFAULTS);
    return {
      ...counts,
      sizes: sizesOf(spec || DEFAULTS),
      detailWhitespace: !!(spec && Object.prototype.hasOwnProperty.call(spec, 'detailWhitespace') ? spec.detailWhitespace : DEFAULTS.detailWhitespace),
      background: spec?.background === 'white' || spec?.background === 'transparent' ? spec.background : 'off'
    };
  }
  function activeSlots(spec) {
    const c = normalize(spec);
    const slots = [];
    if (c.mainCount > 0) slots.push({slot:0, zone:'main', index:1});
    for (let i = 1; i < c.mainCount; i++) slots.push({slot:i, zone:'main', index:i + 1});
    const skuStart = c.mainCount > 0 ? c.mainCount : 1;
    for (let k = 0; k < c.skuCount; k++) slots.push({slot:skuStart + k, zone:'sku', index:k + 1});
    for (let d = 0; d < c.detailCount; d++) slots.push({slot:7 + d, zone:'detail', index:d + 1});
    return slots;
  }
  function zoneForSlot(slot, spec) {
    return activeSlots(spec).find(item => item.slot === slot) || null;
  }
  function customerLabel(slot, spec) {
    const item = zoneForSlot(slot, spec);
    if (!item) return '';
    if (item.zone === 'main') return `淘宝主图 ${item.index}`;
    if (item.zone === 'sku') return `SKU图 ${item.index}`;
    return `详情 ${item.index}`;
  }
  function toCustomLayout(spec, directives) {
    const c = normalize(spec);
    const main = c.mainCount > 0 ? 1 : 0;
    const sub = (c.mainCount > 0 ? c.mainCount - 1 : 0) + c.skuCount;
    return {
      main, sub, aplus: c.detailCount, aplusType:'premium',
      directives: directives || {},
      taobao: {...c, applied:true}
    };
  }
  function countsMatch(layout) {
    if (!layout?.taobao?.applied) return false;
    const mapped = toCustomLayout(layout.taobao, {});
    return mapped.main === (layout.main | 0) && mapped.sub === (layout.sub | 0) && mapped.aplus === (layout.aplus | 0);
  }
  function ratioForZone(zone, spec) {
    const sizes = normalize(spec).sizes;
    const id = sizes[zone] || (zone === 'detail' ? 'portrait' : 'square');
    return SIZE_CHOICES.find(choice => choice.id === id)?.ratio || '1:1';
  }
  function slotFromTitle(title) {
    const text = String(title || '');
    if (/卖点图/.test(text)) {
      const match = text.match(/卖点图\s*(\d+)/);
      return match ? Number(match[1]) : null;
    }
    if (/A\s*\+\s*模块/.test(text)) {
      const match = text.match(/模块\s*(\d+)/);
      return match ? 6 + Number(match[1]) : null;
    }
    if (text.includes('主图') && !text.includes('THD')) return 0;
    return null;
  }
  function ratioForTitle(title, spec) {
    const slot = slotFromTitle(title);
    const item = slot == null ? null : zoneForSlot(slot, spec);
    if (!item) return null;
    return ratioForZone(item.zone, spec);
  }
  function backgroundNote(mode) {
    if (mode === 'transparent') return '本张按透明图要求：背景尽量留空、接近纯白，方便后期抠图；不要场景和投影铺满。现有出图通道不保证文件带透明通道。';
    if (mode === 'white') return '本张为白底图：纯白背景，产品完整入镜，不要场景、不要阴影铺满，也不要营销文字。';
    return '';
  }
  function directiveNote(zone, spec) {
    const c = normalize(spec);
    if (zone === 'detail' && c.detailWhitespace) return '详情图底部留出一条干净留白，用来和下一卖点分开；主体和文字不要贴底。';
    if (zone === 'sku') return backgroundNote(c.background);
    return '';
  }
  function annotateDirectives(dirs, spec, oneShot) {
    let used = false;
    const directives = (dirs || []).map(item => {
      const zone = zoneForSlot(item.slot, spec)?.zone;
      const notes = [];
      const zoneNote = directiveNote(zone, spec);
      if (zoneNote) notes.push(zoneNote);
      if (oneShot && oneShot.slot === item.slot && oneShot.note) { notes.push(oneShot.note); used = true; }
      if (!notes.length) return item;
      return {...item, requirement:[item.requirement, ...notes].filter(Boolean).join('；')};
    });
    return {directives, used};
  }
  function backgroundSlot(spec) {
    const slots = activeSlots(spec);
    return (slots.find(item => item.zone === 'sku') || slots.find(item => item.zone === 'main') || slots.find(item => item.zone === 'detail'))?.slot ?? null;
  }
  root.TaobaoLayout = {
    SIZE_CHOICES, DEFAULTS, clampLayout, normalize, activeSlots, zoneForSlot, customerLabel,
    toCustomLayout, countsMatch, ratioForZone, slotFromTitle, ratioForTitle, backgroundNote,
    directiveNote, annotateDirectives, backgroundSlot
  };
})(typeof window !== 'undefined' ? window : globalThis);
