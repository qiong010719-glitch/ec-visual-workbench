// Customer roles must survive the legacy 主图/卖点图/A+ slot numbering.
export const SKU_CONTRACT_VERSION = 1;
export const SKU_INPUT_VERSION = 2;
const dimensions={length:'长',width:'宽',height:'高',depth:'深/厚'};
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};

function skuInput(value) {
  if(value===undefined)return null; // Existing photo-only drafts remain readable.
  if(!value||!(value.version===1&&['photo','manual'].includes(value.mode)||value.version===2&&value.mode==='combined'))invalid('SKU图片与规格信息无效，请刷新网页后重新构思。');
  if(value.mode==='photo')return {version:1,mode:'photo'};
  if(value.photo_missing)invalid('本SKU绑定的图片已移除，请在对应SKU卡片重新选择图片或明确移除绑定。');
  if(!['mm','cm','m'].includes(value.unit))invalid('请选择SKU实物尺寸单位（mm、cm或m）。');
  if(value.name!==undefined&&(typeof value.name!=='string'||value.name.length>80))invalid('SKU名称最多80字。');
  const result={version:value.version,mode:value.mode,name:(value.name||'').trim(),unit:value.unit};
  for(const key of Object.keys(dimensions)){
    const raw=String(value[key]??'').trim();
    if(!raw)continue;
    if(!/^\d+(?:\.\d+)?$/.test(raw)||raw.length>20||Number(raw)<=0||Number(raw)>999999)invalid('SKU实物尺寸须为大于0的数字，未知尺寸请留空。');
    result[key]=String(Number(raw));
  }
  if(value.mode==='manual'&&!Object.keys(dimensions).some(key=>result[key]))invalid('没有SKU图时，请为每个SKU至少填写一项已知实物尺寸及单位。');
  return result;
}

export function validateSkuInputs(payload,sections) {
  for(const section of sections)if(isSkuSlot(payload,section.slot))skuSection(payload,section);
}

export function directiveFor(payload, slot) {
  const dirs = payload.slot_directives;
  return Array.isArray(dirs) ? dirs.find(d => Number(d.slot ?? d.index) === slot) : dirs?.[slot];
}

export function isSkuSlot(payload, slot) {
  const d = directiveFor(payload, slot);
  if (d?.taobao_role) return d.taobao_role === 'sku';
  // Older saved drafts predate explicit roles, but already name their SKU uploads.
  return slot < 7 && !!d?.ref_images?.some(name => /^SKU图_\d+$/.test(name));
}

export function skuSection(payload, section) {
  const d = directiveFor(payload, section.slot);
  const input=skuInput(d?.sku_input),manual=input?.mode==='manual';
  const refs = !manual&&d?.ref_images?.length ? [...d.ref_images] :
    (payload.categorized_images || []).filter(m => /主体/.test(m.filename)).slice(0, 1).map(m => m.filename);
  const combined=input?.mode==='combined',hasSkuPhoto=combined&&!!d?.ref_images?.length;
  if(hasSkuPhoto&&(refs.length!==1||refs.some(name=>!/^SKU图_\d+$/.test(name)||!(payload.categorized_images||[]).some(m=>m.filename===name&&m.url))))invalid('本SKU绑定的图片已失效，请在对应SKU卡片重新上传或选择图片。');
  if(combined&&!hasSkuPhoto){
    if(!Object.keys(dimensions).some(key=>input[key]))invalid('没有SKU图时，请为每个SKU至少填写一项已知实物尺寸及单位。');
    if(!refs.length||refs.some(name=>!(payload.categorized_images||[]).some(m=>m.filename===name&&m.url)))invalid('没有SKU图时还需要上传产品主体图，用于保持商品外观。');
  }
  if(input?.mode==='photo'&&(!refs.length||refs.some(name=>!/^SKU图_\d+$/.test(name)||!(payload.categorized_images||[]).some(m=>m.filename===name&&m.url))))invalid('已选择有SKU图，请先上传对应SKU图；没有SKU图请切换为填写尺寸，再重新构思。');
  if(manual&&(!refs.length||refs.some(name=>!(payload.categorized_images||[]).some(m=>m.filename===name&&m.url))))invalid('填写尺寸后还需要上传产品主体图，用于保持商品外观；没有提交生成。');
  const benchmark = d?._benchmark;
  const detail = [
    '本图职责：SKU规格确认。让买家确认当前选择的这一款商品、颜色与规格。',
    '以本张绑定的上传图为商品依据，保留完整商品的轮廓、比例、可见结构、部件数量、配件和配色。不得换成主图中的另一款，也不得混合其他SKU。',
    '默认版式：完整商品居中或按原图位置大幅展示，是画面视觉主体，周围只留必要的规格文字空间。保持原图商品视角，不重组为局部特写和卖点信息卡。',
    combined?'本SKU图片与填写信息共同使用。'+(hasSkuPhoto?'商品外观、颜色和款式以本SKU绑定图片为准。填写的名称、尺寸和单位优先；与图片中同项规格不一致时，以填写值为准。未填写的项目仅保留本SKU图中清晰可辨的原规格，不猜测。':'商品外观以产品主体图为准；规格仅使用本SKU填写信息，参考图中原有尺寸不沿用，不采用其他SKU的信息。')+'尺寸为商品实物尺寸，不是图片像素；默认使用清晰规格文字栏，不能确定测量方向时不画尺寸箭头。\n本SKU已确认数据：'+JSON.stringify({name:input.name,dimensions:Object.fromEntries(Object.entries(dimensions).filter(([key])=>input[key]).map(([key,label])=>[label,input[key]+input.unit]))}):'',
    manual?'规格来源：客户手动填写的商品实物尺寸，不是图片像素。仅将下面本SKU的名称、尺寸和单位作为规格文字，逐项完整保留。商品外观仍以本品参考为准，参考图中原有尺寸不沿用，不采用其他SKU、对标、文案中的尺寸。未知维度留空，不推断新款式。默认用清晰规格文字栏；不能确定测量方向时不画尺寸箭头。\n本SKU已确认数据：'+JSON.stringify({name:input.name,dimensions:Object.fromEntries(Object.entries(dimensions).filter(([key])=>input[key]).map(([key,label])=>[label,input[key]+input.unit]))}):'规格文字：保留本张原图中清晰可辨、明确属于这一款的尺寸、单位、颜色和款式；尺寸与方向对应，不能省略清晰的规格或把其他款的数字套过来。看不清或没有提供的参数不猜、不编。',
    '若上传的是手机或购物截图，只取商品和对应规格；移除状态栏、聊天按钮、购买按钮、价格、促销和店铺界面。',
    '默认不加营销主标题、耐看耐用卖点卡、外观细节拼版、认证和性能承诺。不要从全套商品描述中自动摘卖点填满SKU图。',
    '整套风格在本张只协调背景、光线、字体；不能改变商品身份、商品占主体的版式和规格可读性。通用信息密度、镜头多样性、场景广告模板不适用于本张。',
    benchmark ? '本张另有绑定的对标图，仅参考适合SKU的字体、配色与规格文字位置；保持本品完整大图和本品规格，不能套用对标的卖点拼版或商品参数。对标观察：'+JSON.stringify(benchmark.layout) : '',
    refs.length ? '本张商品依据仅为：'+refs.join('、')+'。' : '没有绑定规格图：仅展示当前本品可见外观，不创造尺寸或虚构新款。'
  ].filter(line=>line&&!(combined&&line.startsWith('规格文字：'))).join('\n');
  return {...section, outputRole:'sku', skuContractVersion:SKU_CONTRACT_VERSION, skuInput:input||undefined,
    purpose:'SKU规格确认', ref_images:refs, storyboard:null, referenceEvidence:null,
    skuSources:refs.map(filename=>({filename,url:(payload.categorized_images || []).find(m=>m.filename===filename)?.url || null})),
    outputConstraint:null, ...(benchmark ? {benchmark} : {}), detail};
}

export function assertCurrentSkuPlan(payload, section) {
  const current = isSkuSlot(payload, section.slot);
  if (!current && section.outputRole !== 'sku') return;
  const updated=skuSection(payload,section);
  const refsChanged = JSON.stringify(updated.skuSources) !== JSON.stringify(section.skuSources);
  const inputChanged=JSON.stringify(updated.skuInput||null)!==JSON.stringify(section.skuInput||null);
  if (!current || section.skuContractVersion !== SKU_CONTRACT_VERSION || refsChanged || inputChanged) {
    throw Object.assign(new Error('SKU规格图规则或参考图已改变，请重新构思后再生成；原图已保留，没有提交出图请求。'), {status:409});
  }
}
