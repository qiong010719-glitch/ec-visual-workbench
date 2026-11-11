/* Pure Taobao shell mapping. Customer labels sit on the existing 14 slots.
   Internal titles stay 主图 / 卖点图 / 高级A+ so the planner and single-slot redraw keep working.
   Shortcut sizes stay the workbench trio: 1:1 → 1024², 16:9 → 1536×1024, 3:4 → 1024×1536.
   Custom width/height and the first text placement are written into the same slot directive
   the generate path already sends. Moving text on an existing picture is a masked edit
   of that picture: the same image model repaints the original sentence. No second painter. */
(function (root) {
  const SIZE_CHOICES = [
    {id:'square', ratio:'1:1', label:'工作台可选尺寸 · 方图', pixels:'1024×1024'},
    {id:'landscape', ratio:'16:9', label:'工作台可选尺寸 · 横图', pixels:'1536×1024'},
    {id:'portrait', ratio:'3:4', label:'工作台可选尺寸 · 竖图', pixels:'1024×1536'}
  ];
  const SET_STYLES = [
    {id:'off', label:'不强制', note:''},
    {id:'scene', label:'场景广告', note:'整套风格：场景广告。主图、SKU图和详情都放进能看懂用途的使用场景，用同一套光色和字体讲购买理由，不要拆成互不相干的棚拍。'},
    {id:'white_studio', label:'纯白棚拍', note:'整套风格：纯白棚拍。主图、SKU图和详情都以干净浅色背景为主，产品完整、光线均匀，少放生活杂物。这是出图方向，不是实拍承诺。'},
    {id:'minimal', label:'极简留白', note:'整套风格：极简留白。主图、SKU图和详情都留出大块空白，主体少而清楚，文字短，不要堆满图标和装饰。'},
    {id:'lifestyle', label:'生活方式', note:'整套风格：生活方式。主图、SKU图和详情都放进与商品用途相符的日常空间，手部或人物动作自然，整套地点和光线互相呼应。'},
    {id:'guochao', label:'国潮质感', note:'整套风格：国潮质感。主图、SKU图和详情共用一套中式纹样、墨色和强调色的版式，产品仍是主体，不改商品结构和已确认事实。'},
    {id:'keep', label:'原有风格', note:'整套风格：原有风格。主图、SKU图和详情都贴近当前素材的配色、摆放和包装气质，不另换成场景广告、棚拍或国潮装饰。'},
    {id:'light_luxury', label:'轻奢高级', note:'整套风格：轻奢高级。主图、SKU图和详情共用克制的金属高光、深浅中性色和少量精致空白，产品仍是主体，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'fresh_japanese', label:'清新日系', note:'整套风格：清新日系。主图、SKU图和详情用浅色、柔光和干净空白，杂物少，产品仍是主体，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'morandi', label:'莫兰迪低饱和', note:'整套风格：莫兰迪低饱和。主图、SKU图和详情用灰调低饱和配色，对比收着，不改产品已确认的颜色事实，也不改商品结构。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'warm_mood', label:'暖色氛围', note:'整套风格：暖色氛围。主图、SKU图和详情用同一套暖色光和柔和背景，气氛统一，产品仍是主体，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'cool_minimal', label:'冷色极简', note:'整套风格：冷色极简。主图、SKU图和详情用冷色、少装饰和大块空白，主体清楚，产品仍是主体，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'studio_light', label:'影棚光感', note:'整套风格：影棚光感。主图、SKU图和详情用可控的主光和轮廓光，背景干净，产品完整入镜。这是光线方向，不是实拍承诺，不改商品结构和已确认事实，也不绑定某一品类。'},
    {id:'film_look', label:'胶片质感', note:'整套风格：胶片质感。主图、SKU图和详情用偏胶片的柔和色彩和轻微颗粒，整套统一，产品仍是主体，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'sunlit', label:'通透阳光', note:'整套风格：通透阳光。主图、SKU图和详情用明亮通透的自然光，阴影轻，产品仍是主体，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'dark_tone', label:'暗调质感', note:'整套风格：暗调质感。主图、SKU图和详情用深色背景和集中的主体光，四周收暗，产品仍看得清，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'},
    {id:'high_contrast', label:'高对比撞色', note:'整套风格：高对比撞色。主图、SKU图和详情用同一套高对比色块，颜色少而明确，产品仍是主体，不改商品结构和已确认事实。这是出图方向，不是实拍承诺，也不绑定某一品类。'}
  ];
  const TEXT_PRESETS = [
    {id:'top', label:'靠上', x:50, y:12},
    {id:'middle', label:'居中', x:50, y:50},
    {id:'bottom', label:'靠下', x:50, y:82}
  ];
  const CUSTOM_MIN = 64;
  const CUSTOM_MAX = 2048;
  const PORTRAIT_RATIOS = ['3:4', '2:3', '9:16'];
  const DEFAULTS = {
    mainCount:5, skuCount:1, detailCount:3,
    sizes:{main:'square', sku:'square', detail:'portrait'},
    customSizes:{main:null, sku:null, detail:null},
    textPositions:{},
    detailWhitespace:true, background:'off', setStyle:'off'
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
  function parsePixel(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    if (n < CUSTOM_MIN || n > CUSTOM_MAX) return null;
    return n;
  }
  function parseCustomSize(value) {
    if (!value || typeof value !== 'object') return null;
    const width = parsePixel(value.width);
    const height = parsePixel(value.height);
    if (width == null || height == null) return null;
    return {width, height};
  }
  function customSizesOf(spec) {
    const raw = spec?.customSizes || {};
    return {
      main: parseCustomSize(raw.main),
      sku: parseCustomSize(raw.sku),
      detail: parseCustomSize(raw.detail)
    };
  }
  function clampTextPosition(position) {
    if (!position || typeof position !== 'object') return null;
    const x = Number(position.x);
    const y = Number(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const round = value => Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
    return {x: round(x), y: round(y)};
  }
  function textPositionsOf(spec) {
    const raw = spec?.textPositions || {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!/^\d+$/.test(key)) continue;
      const slot = Number(key);
      if (slot > 13) continue;
      const pos = clampTextPosition(value);
      if (pos) out[slot] = pos;
    }
    return out;
  }
  function textAnchorsOf(spec) {
    const raw = spec?.textAnchors || {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!/^\d+$/.test(key)) continue;
      const slot = Number(key);
      if (slot > 13) continue;
      if (value == null) { out[slot] = null; continue; }
      const pos = clampTextPosition(value);
      if (pos) out[slot] = pos;
    }
    return out;
  }
  function textPositionFromPointer(pointer, rect) {
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const x = (Number(pointer?.clientX) - Number(rect.left)) / width * 100;
    const y = (Number(pointer?.clientY) - Number(rect.top)) / height * 100;
    return clampTextPosition({x, y});
  }
  function normalize(spec) {
    const counts = clampLayout(spec || DEFAULTS);
    return {
      ...counts,
      sizes: sizesOf(spec || DEFAULTS),
      customSizes: customSizesOf(spec || DEFAULTS),
      textPositions: textPositionsOf(spec || DEFAULTS),
      textAnchors: textAnchorsOf(spec || DEFAULTS),
      detailWhitespace: !!(spec && Object.prototype.hasOwnProperty.call(spec, 'detailWhitespace') ? spec.detailWhitespace : DEFAULTS.detailWhitespace),
      background: spec?.background === 'white' || spec?.background === 'transparent' ? spec.background : 'off',
      setStyle: styleOf(spec).id
    };
  }
  function styleOf(spec) {
    return SET_STYLES.find(item => item.id === spec?.setStyle) || SET_STYLES[0];
  }
  function styleNote(spec) {
    return styleOf(spec).note || '';
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
  function gcd(a, b) {
    let x = a, y = b;
    while (y) { const t = y; y = x % y; x = t; }
    return x || 1;
  }
  function reducedRatio(width, height) {
    const g = gcd(width, height);
    return `${width / g}:${height / g}`;
  }
  function nearestPortrait(width, height) {
    const aspect = width / height;
    let best = PORTRAIT_RATIOS[0];
    let bestDelta = Infinity;
    for (const ratio of PORTRAIT_RATIOS) {
      const [w, h] = ratio.split(':').map(Number);
      const delta = Math.abs(w / h - aspect);
      if (delta < bestDelta) { bestDelta = delta; best = ratio; }
    }
    return best;
  }
  function aspectRatioForPixels(width, height) {
    const reduced = reducedRatio(width, height);
    if (reduced === '1:1' || reduced === '16:9' || PORTRAIT_RATIOS.includes(reduced)) return reduced;
    if (height > width) return nearestPortrait(width, height);
    if (width === height) return '1:1';
    return reduced;
  }
  function ratioForZone(zone, spec) {
    const normalized = normalize(spec);
    const custom = normalized.customSizes[zone];
    if (custom) return aspectRatioForPixels(custom.width, custom.height);
    const id = normalized.sizes[zone] || (zone === 'detail' ? 'portrait' : 'square');
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
  function sizeNote(zone, spec) {
    if (zone !== 'main' && zone !== 'sku' && zone !== 'detail') return '';
    const custom = normalize(spec).customSizes[zone];
    if (!custom) return '';
    const ratio = aspectRatioForPixels(custom.width, custom.height);
    return `本张自定义宽高：宽 ${custom.width} 像素，高 ${custom.height} 像素，画幅 ${ratio}。按这个宽高安排构图，产品完整留在画面里。`;
  }
  function positionNote(position) {
    const pos = clampTextPosition(position);
    if (!pos) return '';
    return `文字位置：水平 ${pos.x}%、垂直 ${pos.y}%（相对画面左上角，可落在任意一点，不限于靠上、居中、靠下）。把本张已有文案放到这个位置，不要改文案内容，产品仍完整留在画面里。`;
  }
  function skuReferenceNote(filename) {
    return `本张 SKU 图以已上传的规格图「${filename}」为参考。按这张规格图的颜色和外观出图，不要只按产品主体图来画，也不要换成其他规格。`;
  }
  function attachSkuRefs(directives, spec, photos) {
    const names = [];
    for (const photo of photos || []) {
      const name = (typeof photo === 'string' ? photo : photo?.filename || '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
    const source = directives || [];
    if (!names.length) return {directives: source, attached: false};
    const skuSlots = activeSlots(spec).filter(item => item.zone === 'sku');
    if (!skuSlots.length) return {directives: source, attached: false};
    const bySlot = new Map(skuSlots.map((item, index) => [item.slot, names[Math.min(index, names.length - 1)]]));
    const next = source.map(item => {
      const filename = bySlot.get(item.slot);
      if (!filename) return item;
      return {...item, ref_images: [filename], requirement: [item.requirement, skuReferenceNote(filename)].filter(Boolean).join('；')};
    });
    return {directives: next, attached: true};
  }
  function annotateDirectives(dirs, spec, oneShot) {
    let used = false;
    const style = styleNote(spec);
    const directives = (dirs || []).map(item => {
      const zone = zoneForSlot(item.slot, spec)?.zone;
      const notes = [];
      const zoneNote = directiveNote(zone, spec);
      if (zoneNote) notes.push(zoneNote);
      if (oneShot && oneShot.slot === item.slot && oneShot.note) { notes.push(oneShot.note); used = true; }
      if (zone && style) notes.push(style);
      const size = sizeNote(zone, spec);
      if (size) notes.push(size);
      const place = textPositionsOf(spec)[item.slot] || null;
      const placeNote = positionNote(place);
      if (placeNote) notes.push(placeNote);
      if (!notes.length) return item;
      const next = {...item, requirement:[item.requirement, ...notes].filter(Boolean).join('；')};
      if (place) next.text_position = {x: place.x, y: place.y};
      const custom = zone === 'main' || zone === 'sku' || zone === 'detail' ? customSizesOf(spec)[zone] : null;
      if (custom) next.custom_size = {width: custom.width, height: custom.height};
      return next;
    });
    return {directives, used};
  }
  function textMoveNeeded(spec, index) {
    const normalized = normalize(spec);
    const next = normalized.textPositions[index];
    if (!next) return false;
    if (!Object.prototype.hasOwnProperty.call(normalized.textAnchors, index)) return false;
    const old = normalized.textAnchors[index];
    return !old || old.x !== next.x || old.y !== next.y;
  }
  function textRegion(position, role) {
    const pos = clampTextPosition(position);
    if (!pos) return null;
    const w = 56;
    const h = 18;
    const round = value => Math.round(value * 10) / 10;
    return {
      role,
      x: round(Math.max(0, Math.min(100 - w, pos.x - w / 2))),
      y: round(Math.max(0, Math.min(100 - h, pos.y - h / 2))),
      w, h
    };
  }
  function textMoveRegions(old, next) {
    return [textRegion(old, 'erase'), textRegion(next, 'paint')].filter(Boolean);
  }
  function sectionBody(sop, title) {
    const text = String(sop || '');
    const heading = String(title || '').trim();
    if (!text || !heading) return '';
    const start = text.indexOf(heading);
    if (start < 0) return '';
    const rest = text.slice(start + heading.length);
    const next = rest.search(/\n【/);
    return next < 0 ? rest : rest.slice(0, next);
  }
  function labeledSentence(text) {
    const source = String(text || '');
    const labeled = source.match(/文案[:：]\s*([^\n]{1,120})/) || source.match(/(?:主标题|标题)[:：]\s*([^\n]{1,120})/);
    if (labeled) {
      const sentence = labeled[1].trim().replace(/[。；;]+$/, '');
      if (sentence && !/^(整套风格|文字位置|本张)/.test(sentence)) return sentence;
    }
    const quoted = source.match(/「([^」\n]{1,80})」/);
    if (quoted && !/[._]/.test(quoted[1])) return quoted[1].trim();
    return '';
  }
  function baseRequirement(requirement) {
    return String(requirement || '').split('；').map(part => part.trim()).filter(part => part && !/^(整套风格：|文字位置：|本张自定义宽高：|详情图底部留出|本张为白底图|本张按透明图|本张 SKU 图以已上传)/.test(part)).join('；');
  }
  function plannedSentence({requirement, sop, title, prompt, productDesc} = {}) {
    const section = sectionBody(sop, title);
    const labeled = labeledSentence(prompt) || labeledSentence(section) || labeledSentence(requirement);
    if (labeled) return labeled;
    const base = baseRequirement(requirement);
    if (base) return base;
    const fact = String(prompt || section || '').match(/本图重点资料[:：]\s*([^\n。]{1,80})/);
    if (fact) return fact[1].trim();
    return (labeledSentence(productDesc) || String(productDesc || '').trim()).slice(0, 80);
  }
  function textMovePrompt({sentence, old, next}) {
    const place = value => `水平 ${value.x}%、垂直 ${value.y}%`;
    return [
      '局部遮罩修改。只改遮罩中完全透明的区域。',
      '遮罩以外的产品、房间、背景保持这张已生成图片的原样，不要重新构图，不要重构整张图，不要整张重绘。',
      old ? `旧文字区域（${place(old)} 一带）：去掉这里现有的营销文案，按周围画面补回原来的产品、房间或背景，不要留字。` : '去掉画面上现有的这句营销文案，但只动遮罩里允许修改的地方。',
      `新位置（${place(next)} 一带）：在这里把下面这句原文原样画上去。字形仍由图像模型绘制。不要改字，不要换说法，不要增删。`,
      `原文：${sentence}`,
      '产品外形、颜色、结构和所在房间与当前这张图保持一致。'
    ].join('\n');
  }
  function backgroundSlot(spec) {
    const slots = activeSlots(spec);
    return (slots.find(item => item.zone === 'sku') || slots.find(item => item.zone === 'main') || slots.find(item => item.zone === 'detail'))?.slot ?? null;
  }
  root.TaobaoLayout = {
    SIZE_CHOICES, SET_STYLES, TEXT_PRESETS, CUSTOM_MIN, CUSTOM_MAX, DEFAULTS, clampLayout, normalize, activeSlots, zoneForSlot, customerLabel,
    toCustomLayout, countsMatch, ratioForZone, aspectRatioForPixels, parseCustomSize, clampTextPosition, textPositionFromPointer,
    slotFromTitle, ratioForTitle, backgroundNote,
    directiveNote, sizeNote, positionNote, styleOf, styleNote, annotateDirectives, attachSkuRefs, skuReferenceNote, backgroundSlot,
    textMoveNeeded, textMoveRegions, plannedSentence, textMovePrompt
  };
})(typeof window !== 'undefined' ? window : globalThis);
