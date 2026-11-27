const identity=value=>{
  try{const u=new URL(value);if(u.protocol!=='https:'||!['www.temu.com','temu.com'].includes(u.hostname)||u.username||u.password||u.port)return null;const id=u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||(u.pathname==='/goods.html'?u.searchParams.get('goods_id'):null);return /^\d{6,32}$/.test(id||'')?id:null;}catch{return null;}
};
const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
const decimal=/^\d{1,12}(?:\.\d{1,2})?$/;
const conditional=/(?:预计|预估|券后|折后预估|到手价|原价|划线价|建议零售价|参考价|after\s+coupon|estimated|original\s+price|list\s+price|MSRP|RRP)/i;
const currencyMarkers=[['JPY',/(?:\bJPY\b|\bJP¥|円)/i],['CNY',/(?:\bCNY\b|\bRMB\b|\bCN¥|人民币)/i],['USD',/(?:\bUSD\b|\bUS\$)/i],['CAD',/(?:\bCAD\b|\bCA\$)/i],['AUD',/(?:\bAUD\b|\bAU\$|\bA\$)/i],['NZD',/(?:\bNZD\b|\bNZ\$)/i],['HKD',/(?:\bHKD\b|\bHK\$)/i],['SGD',/(?:\bSGD\b|\bSG\$|\bS\$)/i],['EUR',/(?:\bEUR\b|€)/i],['GBP',/(?:\bGBP\b|£)/i],['KRW',/(?:\bKRW\b|₩|원)/i],['BRL',/(?:\bBRL\b|\bR\$)/i],['MXN',/\bMXN\b/i]];

// A bare dollar/yen symbol does not establish a currency. The caller must have
// visible currency evidence; a country in the URL is not currency evidence.
export function parseVisibleTemuPrice(value,currencyEvidence=[]){
  const text=tidy(value);if(!text||text.length>180||conditional.test(text)||/[~～]|\d\s*[-–—]\s*\d/.test(text))return null;
  const evidence=[...new Set(currencyMarkers.filter(([,re])=>re.test(text)).map(([code])=>code))];
  for(const entry of currencyEvidence){const code=tidy(entry).toUpperCase();if(currencyMarkers.some(([candidate])=>candidate===code)&&!evidence.includes(code))evidence.push(code);}
  if(evidence.length!==1)return null;
  let remaining=text;for(const [,re] of currencyMarkers)remaining=remaining.replace(new RegExp(re.source,'gi'),'');
  remaining=remaining.replace(/[¥￥$]/g,'').replace(/(?:券前价|商品价格|售价|价格|price|before\s+coupon)/gi,'').trim();
  if(!/^[\d.,\s]+$/.test(remaining))return null;
  const values=remaining.match(/\d[\d\s.,]*/g)||[];if(values.length!==1)return null;
  const literal=values[0].trim();if(/\s/.test(literal)&&!/^\d{1,3}(?: \d{3})+(?:[.,]\d{1,6})?$/.test(literal))return null;
  let amount=literal.replace(/\s/g,'');
  // Thousands commas are accepted only in unambiguous 3-digit groups. A single
  // comma with two digits is a decimal comma; mixed European notation is read
  // only when its thousands groups are explicit.
  if(/^\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?$/.test(amount))amount=amount.replaceAll(',','');
  else if(/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(amount))amount=amount.replaceAll('.','').replace(',','.');
  else if(/^\d+,\d{1,2}$/.test(amount))amount=amount.replace(',','.');
  if(!decimal.test(amount)||!Number.isFinite(Number(amount))||Number(amount)<=0)return null;
  if(['JPY','KRW'].includes(evidence[0])&&amount.includes('.')&&Number(amount)%1)return null;
  return {amount:amount.replace(/^0+(?=\d)/,'').replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1'),currency:evidence[0],kind:'displayed-sale',displayText:text};
}

export function normalizeTemuSourceFacts(raw,{goodsId,sourceUrl}={}){
  if(!raw||typeof raw!=='object'||identity(raw.sourceUrl)!==goodsId||identity(sourceUrl)!==goodsId||raw.goodsId!==goodsId)throw new Error('Temu 来源资料与商品身份不一致');
  if(typeof raw.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(raw.observedAt)||!Number.isFinite(Date.parse(raw.observedAt)))throw new Error('Temu 来源资料缺少有效读取时间');
  const issues=[],categoryValid=Array.isArray(raw.categoryPath)&&raw.categoryPath.length>0&&raw.categoryPath.length<=16&&raw.categoryPath.every(value=>typeof value==='string'&&tidy(value)&&value.length<=240&&!/(?:\.{3}|…)\s*$/.test(value));
  const categoryPath=categoryValid?raw.categoryPath.map(tidy):[];
  if(!categoryValid)issues.push('尚未读取到 Temu 商品的完整可见分类路径');
  const sourceVariant=raw.selectedVariant||{},attributes=Array.isArray(sourceVariant.attributes)?sourceVariant.attributes.map(item=>({name:typeof item?.name==='string'?tidy(item.name):'',value:typeof item?.value==='string'?tidy(item.value):''})):[];
  const selectionComplete=sourceVariant.selectionComplete===true&&Array.isArray(sourceVariant.attributes)&&attributes.length<=24&&attributes.every(item=>item.name&&item.value&&item.name.length<=120&&item.value.length<=240)&&new Set(attributes.map(item=>item.name)).size===attributes.length;
  if(!selectionComplete)issues.push('Temu 当前规格尚未唯一确认，价格不能应用到其他规格');
  const selectedVariant={...(typeof sourceVariant.skuId==='string'&&/^[\w-]{1,100}$/.test(sourceVariant.skuId)?{skuId:sourceVariant.skuId}:{}),attributes:attributes.filter(item=>item.name&&item.value).slice(0,24),selectionComplete};
  const candidates=(Array.isArray(raw.priceCandidates)?raw.priceCandidates:raw.price?[raw.price]:[]).filter(candidate=>candidate?.kind==='displayed-sale').flatMap(candidate=>{
    const price=parseVisibleTemuPrice(candidate.displayText||candidate.text,raw.currencyEvidence||[candidate.currency].filter(Boolean));
    if(!price||candidate.amount!==undefined&&(String(candidate.amount)!==price.amount||candidate.currency!==price.currency))return [];
    return [price];
  });
  const prices=[...new Map(candidates.map(price=>[price.currency+':'+price.amount,price])).values()];
  const price=prices.length===1?prices[0]:null;
  if(!price)issues.push(prices.length>1?'Temu 页面存在多个直接售价，尚不能确认当前规格价格':'未识别当前页面带明确币种的 Temu 直接售价，不会使用预估价或券后价');
  if(raw.unavailable===true)issues.push('Temu 商品当前不可用');
  // Revalidating an already incomplete record must never erase the condition
  // that made it unsafe (for example an unavailable page or a truncated path).
  if(Array.isArray(raw.issues))issues.push(...raw.issues.filter(value=>typeof value==='string').slice(0,20).map(value=>tidy(value).slice(0,700)).filter(Boolean));
  if(raw.status==='incomplete'&&!issues.length)issues.push('来源资料仍有未解决的核对问题，请重新补读');
  return {version:1,platform:'temu',goodsId,sourceUrl:raw.sourceUrl,observedAt:new Date(raw.observedAt).toISOString(),status:issues.length?'incomplete':'ready',categoryPath,price,selectedVariant,variants:price&&selectionComplete?[{...(selectedVariant.skuId?{skuId:selectedVariant.skuId}:{}),attributes:structuredClone(selectedVariant.attributes),price:structuredClone(price)}]:[],issues:[...new Set(issues)]};
}

// This function is serialized into the page. It reads visible DOM only: no
// scripts, framework stores, network requests or interactions with variants.
export function readTemuSourceFacts({goodsId}={}){
  const visible=element=>{if(!element?.getClientRects().length)return false;for(let node=element;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.getAttribute('aria-hidden')==='true'||style.visibility==='hidden'||style.display==='none')return false;}return true;};
  const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
  const all=selector=>[...document.querySelectorAll(selector)].filter(visible);
  const priceCandidates=[],currencyEvidence=[];
  const labelledText=element=>{
    const labelledBy=(element.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)).filter(visible).map(node=>tidy(node.innerText)).filter(Boolean).join(' ');
    return labelledBy||tidy(element.getAttribute('aria-label'));
  };
  // Only standard visible schema/ARIA/native form semantics are supported here;
  // no Temu-specific class/data attribute is invented without a captured page.
  // Unknown current layouts deliberately remain incomplete.
  const conditional=/(?:预计|预估|券后|到手价|原价|划线价|建议零售价|参考价|after\s+coupon|estimated|original\s+price|list\s+price|MSRP|RRP)/i;
  for(const element of all('#goodsDetail [itemprop~="price"]')){
    let excluded=!!element.closest('s,del,[aria-hidden="true"]');
    for(let node=element;node&&node.id!=='goodsDetail';node=node.parentElement){
      if(getComputedStyle(node).textDecorationLine.includes('line-through'))excluded=true;
      const context=tidy(node.innerText);if(context.length<=180&&conditional.test(context))excluded=true;
    }
    if(excluded)continue;
    const text=tidy(element.innerText||element.textContent);if(text)priceCandidates.push({text,kind:'displayed-sale'});
  }
  for(const element of all('[aria-label="Currency" i],[aria-label="币种"],#goodsDetail [itemprop~="priceCurrency"]')){
    const displayed=element.tagName==='SELECT'?element.selectedOptions[0]?.textContent:element.innerText||element.getAttribute('aria-label');
    const matches=tidy(displayed).match(/\b(?:JPY|CNY|USD|CAD|AUD|NZD|HKD|SGD|EUR|GBP|KRW|BRL|MXN)\b/gi)||[];currencyEvidence.push(...matches.map(value=>value.toUpperCase()));
  }
  const breadcrumbs=all('[aria-label="breadcrumb" i],[aria-label="面包屑"],[itemtype="https://schema.org/BreadcrumbList"],[itemtype="http://schema.org/BreadcrumbList"]');
  const breadcrumbRoots=breadcrumbs.filter(root=>!breadcrumbs.some(other=>other!==root&&root.contains(other)));
  const title=tidy(all('h1')[0]?.innerText);
  const categoryPath=breadcrumbRoots.length===1?[...breadcrumbRoots[0].querySelectorAll('a, [itemprop~="name"]')].filter(element=>visible(element)&&!element.closest('[aria-current="page"]')&&!(element.matches('[itemprop~="name"]')&&element.closest('a'))).filter(element=>{
    const href=element.closest('a')?.href;if(!href)return true;
    try{const u=new URL(href);return !(u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]===goodsId||u.pathname==='/goods.html'&&u.searchParams.get('goods_id')===goodsId);}catch{return true;}
  }).map(element=>tidy(element.innerText||element.textContent)).filter(text=>text&&text!==title&&!/^(?:首页|Home|主页)$/i.test(text)):[];
  const candidateGroups=all('#goodsDetail [role="radiogroup"],#goodsDetail fieldset');
  const groups=candidateGroups.filter(group=>!candidateGroups.some(other=>other!==group&&group.contains(other))),attributes=[];let selectionComplete=groups.length>0;
  for(const group of groups){
    const legend=group.closest('fieldset')?.querySelector('legend');
    const name=labelledText(group)||(visible(legend)?tidy(legend.innerText):'');
    const selected=[...group.querySelectorAll('[aria-checked="true"],[aria-selected="true"],input:checked')].filter(visible);
    if(!name||selected.length!==1){selectionComplete=false;continue;}
    const element=selected[0],labels=[...(element.labels||[])].filter(visible).map(label=>tidy(label.innerText)).filter(Boolean);
    const value=labelledText(element)||labels.join(' ')||tidy(element.innerText);
    if(!value){selectionComplete=false;continue;}attributes.push({name,value});
  }
  return {version:1,platform:'temu',goodsId,sourceUrl:location.href,observedAt:new Date().toISOString(),productReady:!!title&&all('#goodsDetail').some(element=>tidy(element.innerText)),categoryPath,priceCandidates,currencyEvidence,selectedVariant:{attributes,selectionComplete}};
}
