// Customer roles must survive the legacy 主图/卖点图/A+ slot numbering.
export const SKU_CONTRACT_VERSION = 1;

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
  const refs = d?.ref_images?.length ? [...d.ref_images] :
    (payload.categorized_images || []).filter(m => /主体/.test(m.filename)).slice(0, 1).map(m => m.filename);
  const benchmark = d?._benchmark;
  const detail = [
    '本图职责：SKU规格确认。让买家确认当前选择的这一款商品、颜色与规格。',
    '以本张绑定的上传图为商品依据，保留完整商品的轮廓、比例、可见结构、部件数量、配件和配色。不得换成主图中的另一款，也不得混合其他SKU。',
    '默认版式：完整商品居中或按原图位置大幅展示，是画面视觉主体，周围只留必要的规格文字空间。保持原图商品视角，不重组为局部特写和卖点信息卡。',
    '规格文字：保留本张原图中清晰可辨、明确属于这一款的尺寸、单位、颜色和款式；尺寸与方向对应，不能省略清晰的规格或把其他款的数字套过来。看不清或没有提供的参数不猜、不编。',
    '若上传的是手机或购物截图，只取商品和对应规格；移除状态栏、聊天按钮、购买按钮、价格、促销和店铺界面。',
    '默认不加营销主标题、耐看耐用卖点卡、外观细节拼版、认证和性能承诺。不要从全套商品描述中自动摘卖点填满SKU图。',
    '整套风格在本张只协调背景、光线、字体；不能改变商品身份、商品占主体的版式和规格可读性。通用信息密度、镜头多样性、场景广告模板不适用于本张。',
    benchmark ? '本张另有绑定的对标图，仅参考适合SKU的字体、配色与规格文字位置；保持本品完整大图和本品规格，不能套用对标的卖点拼版或商品参数。对标观察：'+JSON.stringify(benchmark.layout) : '',
    refs.length ? '本张商品依据仅为：'+refs.join('、')+'。' : '没有绑定规格图：仅展示当前本品可见外观，不创造尺寸或虚构新款。'
  ].filter(Boolean).join('\n');
  return {...section, outputRole:'sku', skuContractVersion:SKU_CONTRACT_VERSION,
    purpose:'SKU规格确认', ref_images:refs, storyboard:null, referenceEvidence:null,
    skuSources:refs.map(filename=>({filename,url:(payload.categorized_images || []).find(m=>m.filename===filename)?.url || null})),
    outputConstraint:null, ...(benchmark ? {benchmark} : {}), detail};
}

export function assertCurrentSkuPlan(payload, section) {
  const current = isSkuSlot(payload, section.slot);
  if (!current && section.outputRole !== 'sku') return;
  const refsChanged = JSON.stringify(skuSection(payload,section).skuSources) !== JSON.stringify(section.skuSources);
  if (!current || section.skuContractVersion !== SKU_CONTRACT_VERSION || refsChanged) {
    throw Object.assign(new Error('SKU规格图规则或参考图已改变，请重新构思后再生成；原图已保留，没有提交出图请求。'), {status:409});
  }
}
