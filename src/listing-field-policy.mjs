import {convertDisplayedSalePrice,normalizeMoneyAmount,currencyDecimals} from './sourcing-fx.mjs';

export const SOURCE_PRICE_POLICY='temu-source-price-v1';
export const DXM_PRICE_POLICY='preserve-dxm-converted';
const text=value=>String(value??'').replace(/\s+/g,' ').trim();
const issueLabel=field=>field.label||field.name||'价格';
export const isPriceField=field=>/(?:price|售价|价格|供货价|申报价|金额|单价|零售价|原价|特价|促销价|折扣价)/i.test([field?.name,field?.id,field?.label,field?.priceSemantic].map(text).join(' '));
const conditionalPrice=field=>/(?:msrp|rrp|suggest(?:ed)?|reference|original|listPrice|compareAt|marketPrice|retailRecommend|specialPrice|promotionPrice|discountPrice|建议|参考|划线|原价|特价|促销价|折扣价)/i.test([field.name,field.id,field.label].join(' '));

// These mappings describe ERP input semantics, not an assertion that every
// platform uses the same commercial price. Unknown modes must be inspected.
export function resolvePriceSemantic(field,{platform,businessMode}={}){
  const p=text(platform).toLowerCase(),mode=text(businessMode).toLowerCase(),label=[field.name,field.id,field.label].map(text).join(' ');
  if(!isPriceField(field))return {semantic:null};
  if(conditionalPrice(field))return {semantic:null,issue:'建议价、划线价或原价不是 Temu 当前直接售价，需平台专用定价规则'};
  if(/temu|特慕/.test(p)){
    if(/(?:申报|供货|declared|supply)/i.test(label)||field.name==='price')return {semantic:'temu-declared-price'};
    return {semantic:null,issue:'无法确认此 Temu 价格字段是申报价还是其他价格'};
  }
  if(/shein|希音/.test(p)){
    if(/(?:供货|采购|supply|purchase)/i.test(label))return {semantic:'shein-supply-price'};
    if(/(?:obm|托管|managed|supplier|供货)/i.test(mode)){
      if(field.name==='price')return {semantic:'shein-supply-price'};
      return {semantic:null,issue:'当前 SHEIN 经营模式的供货价字段尚未识别'};
    }
    if(/(?:marketplace|pop|自主|自营|seller)/i.test(mode)){
      if(field.name==='price'||/售价|销售价|salePrice|sellingPrice/i.test(label))return {semantic:'shein-local-sale-price'};
      return {semantic:null,issue:'当前 SHEIN 经营模式的本地售价字段尚未识别'};
    }
    return {semantic:null,issue:'SHEIN 经营模式未确认，无法区分供货价和本地售价'};
  }
  if(/tiktok|抖音/.test(p)){
    if(/(?:供货|申报|采购|supply|purchase|declared)/i.test(label))return {semantic:null,issue:'此字段不是 TikTok 本地展示售价'};
    if(field.name==='price'||/售价|销售价|salePrice|sellingPrice|localPrice|retailPrice/i.test(label))return {semantic:'tiktok-local-sale-price'};
    return {semantic:null,issue:'未识别 TikTok 本地展示售价字段'};
  }
  return {semantic:null,issue:'当前平台尚无可核实的价格字段映射'};
}

export function readPriceCurrency(field,targetCurrency){
  const explicit=text(field.currency||field.priceCurrency),inLabel=[...([field.unit,field.label].map(text).join(' ')).matchAll(/\b([A-Z]{3})\b/g)].map(match=>match[1]);
  const actual=[...new Set([explicit,...inLabel].filter(Boolean))];
  if(actual.length>1)throw new Error('价格控件显示了互相冲突的币种');
  if(targetCurrency&&actual.length&&targetCurrency!==actual[0])throw new Error('目标币种与价格控件币种不一致');
  const currency=actual[0]||text(targetCurrency);
  if(!currency)throw new Error('价格控件没有明确币种，不能根据站点或货币符号猜测');
  currencyDecimals(currency);return currency;
}

export function variantSignature(attributes){
  if(!Array.isArray(attributes))return null;
  const aliases={颜色:'color',color:'color',colour:'color',尺码:'size',尺寸:'size',size:'size',款式:'style',style:'style',容量:'capacity',capacity:'capacity',材质:'material',material:'material',型号:'model',model:'model'};
  const parts=attributes.map(item=>({name:aliases[text(item?.name).toLowerCase()]||text(item?.name),value:text(item?.value)}));
  if(parts.some(item=>!item.name||!item.value)||new Set(parts.map(item=>item.name)).size!==parts.length)return null;
  return JSON.stringify(parts.sort((a,b)=>a.name.localeCompare(b.name)).map(item=>[item.name,item.value]));
}

function sourceIdentityIssues(sourceFacts,goodsId,now){
  const issues=[];
  if(!Number.isFinite(now))issues.push('当前价格核对时间无法确认');
  if(!sourceFacts||sourceFacts.version!==1||sourceFacts.platform!=='temu')return ['缺少已核实的 Temu 前端商品与价格记录'];
  if(!goodsId||String(sourceFacts.goodsId)!==String(goodsId))issues.push('来源售价记录与本批商品ID不一致');
  try{
    const url=new URL(sourceFacts.sourceUrl);
    if(url.protocol!=='https:'||!(url.hostname==='temu.com'||url.hostname.endsWith('.temu.com')))throw new Error();
    const ids=[url.searchParams.get('goods_id'),url.searchParams.get('goodsId'),url.pathname.match(/-g-(\d+)\.html/)?.[1]].filter(Boolean);
    if(!ids.length||ids.some(id=>id!==String(goodsId)))throw new Error();
  }catch{issues.push('来源售价链接无法对应当前 Temu 商品');}
  const observed=Date.parse(sourceFacts.observedAt);
  if(!Number.isFinite(observed)||observed>now)issues.push('来源售价的采集时间无法确认');
  if(sourceFacts.status!=='ready'||sourceFacts.selectedVariant?.selectionComplete!==true)issues.push('Temu 前端售价或规格尚未核实完整');
  if(sourceFacts.issues!==undefined&&!Array.isArray(sourceFacts.issues))issues.push('来源记录的核对结果格式无效');
  else if(sourceFacts.issues?.length)issues.push(...sourceFacts.issues.map(item=>'来源记录：'+text(item)));
  return issues;
}

function sameVariant(a,b){
  const sa=text(a?.skuId),sb=text(b?.skuId),aa=variantSignature(a?.attributes),ab=variantSignature(b?.attributes);
  if(sa&&sb)return sa===sb&&(aa===null||ab===null||aa===ab);
  return aa!==null&&ab!==null&&aa===ab;
}

function variantForField(field,variants,sourceFacts,skuMappings,distinctRows){
  const row=field.rowIdentity||{},mappings=skuMappings.filter(mapping=>
    (mapping.targetSku||mapping.targetRowId)&&(!mapping.targetSku||text(mapping.targetSku)===text(row.sku))&&(!mapping.targetRowId||text(mapping.targetRowId)===text(row.id)));
  if(mappings.length>1)throw new Error('同一个目标SKU有多条来源规格映射');
  if(mappings.length===1){
    const mapping=mappings[0],signature=mapping.sourceAttributes===undefined?null:variantSignature(mapping.sourceAttributes),id=text(mapping.sourceSkuId);
    if(!id&&signature===null)throw new Error('来源SKU映射没有完整规格或来源SKU编号');
    const found=variants.filter(variant=>(!id||text(variant.skuId)===id)&&(signature===null||variantSignature(variant.attributes)===signature));
    if(found.length!==1)throw new Error('来源SKU映射不能匹配唯一已核实规格');return found[0];
  }
  const rowSignature=variantSignature(row.attributes),sku=text(row.sourceSkuId||row.sku);
  const byId=sku?variants.filter(variant=>text(variant.skuId)===sku):[];
  if(byId.length===1){
    if(rowSignature!==null&&rowSignature!==variantSignature(byId[0].attributes))throw new Error('SKU编号与规格属性相互冲突');
    return byId[0];
  }
  if(byId.length>1)throw new Error('来源记录含重复SKU编号');
  if(rowSignature!==null){const matches=variants.filter(variant=>variantSignature(variant.attributes)===rowSignature);if(matches.length===1)return matches[0];if(matches.length>1)throw new Error('同一规格存在多个来源SKU');}
  // Only a verified product without variants can use the selected base price.
  const sole=variants.length===1?variants[0]:null;
  if(sole&&distinctRows<=1&&variantSignature(sole.attributes)==='[]'&&variantSignature(sourceFacts.selectedVariant?.attributes)==='[]'&&sameVariant(sole,sourceFacts.selectedVariant))return sole;
  throw new Error(`未匹配此店铺SKU${row.sku?' '+row.sku:''}对应的 Temu 规格，未将选中规格价格复制到其他SKU`);
}

const equalAmount=(actual,expected,currency)=>{try{return normalizeMoneyAmount(String(actual),currency)===expected;}catch{return false;}};

export function planSourcePrices(snapshot,{platform,businessMode,sourceFacts,goodsId,targetCurrency,fxQuote,skuMappings=[],clock=Date.now}={}){
  if(!snapshot||!Array.isArray(snapshot.fields)||typeof snapshot.url!=='string')throw new Error('缺少价格表单快照');
  const plan={policy:SOURCE_PRICE_POLICY,url:snapshot.url,account:snapshot.account||'',goodsId:String(goodsId||''),ready:false,issues:[],prices:[],conversions:[]};
  const now=typeof clock==='function'?clock():clock,fields=snapshot.fields.filter(isPriceField),variants=Array.isArray(sourceFacts?.variants)?sourceFacts.variants:[];
  plan.issues.push(...sourceIdentityIssues(sourceFacts,goodsId,now));
  if(!Array.isArray(skuMappings)){plan.issues.push('SKU价格映射格式无效');return plan;}
  if(!fields.length)plan.issues.push('当前表单尚未显示可核实的SKU价格字段');
  if(!variants.length)plan.issues.push('来源记录没有已核实售价的规格');
  if(plan.issues.length)return plan;
  const distinctRows=new Set(fields.map(field=>JSON.stringify(field.rowIdentity||null))).size;
  for(const field of fields){
    try{
      const {semantic,issue}=resolvePriceSemantic(field,{platform,businessMode});
      // An empty optional recommendation/promotion input is not a required sale
      // price. A populated or required unknown price must not silently pass.
      if(!semantic){if(!field.required&&field.empty)continue;throw new Error(issue);}
      if(field.protected)throw new Error('价格控件被平台标记为受保护字段');
      if(!['number','text','tel'].includes(field.kind))throw new Error('价格控件类型尚不支持来源售价写入');
      const currency=readPriceCurrency(field,targetCurrency),variant=variantForField(field,variants,sourceFacts,skuMappings,distinctRows);
      if(variant.price?.kind!=='displayed-sale')throw new Error('来源不是 Temu 当前规格的直接售价');
      const converted=convertDisplayedSalePrice(variant.price,currency,fxQuote,{clock:()=>now});
      if(field.errors?.length&&!field.empty&&equalAmount(field.value,converted.amount,currency))throw new Error('当前来源价仍有平台校验提示：'+field.errors.join('；'));
      plan.prices.push({key:field.key,selector:field.selector,shape:field.shape,label:issueLabel(field),kind:field.kind,semantic,currency,expectedValue:converted.amount,previousValue:field.value,matched:equalAmount(field.value,converted.amount,currency),source:{goodsId:String(goodsId),sourceUrl:sourceFacts.sourceUrl,observedAt:sourceFacts.observedAt,skuId:text(variant.skuId),attributes:variant.attributes,amount:converted.originalAmount,currency:converted.originalCurrency,kind:'displayed-sale'},conversion:converted.conversion});
      if(converted.conversion&&!plan.conversions.some(item=>JSON.stringify(item)===JSON.stringify(converted.conversion)))plan.conversions.push(converted.conversion);
    }catch(error){plan.issues.push(`${issueLabel(field)}：${error.message}`);}
  }
  if(!plan.prices.length&&!plan.issues.length)plan.issues.push('尚未发现当前平台经营模式对应的实际销售价格');
  plan.issues=[...new Set(plan.issues)];plan.ready=!plan.issues.length&&plan.prices.length>0;return plan;
}

export function validateSourcePrices(snapshot,options){
  const plan=planSourcePrices(snapshot,options),issues=[...plan.issues];
  for(const price of plan.prices)if(!price.matched)issues.push(`${price.label}：当前 ${text(price.previousValue)||'空'} ${price.currency} 与 Temu 同规格售价 ${price.expectedValue} ${price.currency} 不一致`);
  return {...plan,ready:plan.ready&&!issues.length,issues:[...new Set(issues)]};
}

const currencyControl=field=>/currency|币种/i.test([field.name,field.id,field.label].join(' '));
const decimalKey=value=>{const raw=String(value??'').trim();if(!/^\d{1,14}(?:\.\d{1,8})?$/.test(raw))return null;const [whole,fraction='']=raw.split('.');return BigInt(whole).toString()+'.'+fraction.replace(/0+$/,'');};
function dxmPriceRow(field){return {sku:text(field.rowIdentity?.sku),attributes:field.rowIdentity?.attributes?structuredClone(field.rowIdentity.attributes):null};}
function observedCurrency(field,targetCurrency){try{return {currency:readPriceCurrency(field),currencyStatus:'observed'};}catch{}try{return {currency:readPriceCurrency(field,targetCurrency),currencyStatus:'bound'};}catch{return {currency:null,currencyStatus:'not-confirmed'};}}

// DXM performs the currency conversion during collection/claim. This policy
// records its existing values; it neither calculates nor certifies that rate.
export function captureExistingDxmPrices(snapshot,{platform,goodsId,targetCurrency,businessMode}={}){
  if(!snapshot||!Array.isArray(snapshot.fields)||typeof snapshot.url!=='string')throw new Error('缺少店小秘价格表单快照');
  const result={policy:DXM_PRICE_POLICY,url:snapshot.url,account:snapshot.account||'',goodsId:String(goodsId||''),platform:text(platform),businessMode:text(businessMode),targetCurrency:text(targetCurrency),ready:false,prices:[],issues:[],conversions:[],fxVerified:false};
  const fields=snapshot.fields.filter(isPriceField);
  if(!fields.some(field=>!currencyControl(field)&&!conditionalPrice(field)))result.issues.push('尚未读取到店小秘已转换的实际SKU价格，请先核对平台表单是否加载完成');
  for(const field of fields){
    const value=structuredClone(field.value),currencyOnly=currencyControl(field),blank=field.empty||text(value)==='',amount=currencyOnly?null:decimalKey(value);
    const optionalAuxiliary=!field.required&&conditionalPrice(field),actualAmount=!currencyOnly&&!conditionalPrice(field);
    let valid=true;
    if(blank&&(field.required||actualAmount)){result.issues.push(`${issueLabel(field)}：店小秘价格为空，请补齐或核对采集结果；不会自动填价`);valid=false;}
    else if(!blank&&!currencyOnly&&(amount===null||Number(value)<=0&&!optionalAuxiliary)){result.issues.push(`${issueLabel(field)}：店小秘现有价格异常，已保留原值，请核对`);valid=false;}
    if(field.errors?.length){result.issues.push(`${issueLabel(field)}：${field.errors.join('；')}`);valid=false;}
    result.prices.push({key:field.key,selector:field.selector,shape:field.shape,name:field.name||'',label:field.label||'',kind:field.kind,required:!!field.required,row:dxmPriceRow(field),expectedValue:value,previousValue:value,blank,amount,currencyOnly,...observedCurrency(field,targetCurrency),unit:text(field.unit),matched:valid});
  }
  result.issues=[...new Set(result.issues)];result.ready=!result.issues.length;return result;
}

export function validateExistingDxmPrices(snapshot,evidence,{platform,goodsId}={}){
  const baseline=evidence?.prices,options=evidence?.options||evidence;
  if(evidence?.policy!==DXM_PRICE_POLICY||!Array.isArray(baseline)||!baseline.length||String(options?.goodsId)!==String(goodsId??options?.goodsId)||platform&&options.platform!==platform)return {policy:DXM_PRICE_POLICY,url:snapshot?.url,account:snapshot?.account||'',ready:false,prices:[],conversions:[],fxVerified:false,issues:['缺少本商品店小秘原始价格及规格记录']};
  const actual=captureExistingDxmPrices(snapshot,options),issues=[...actual.issues],used=new Set(),prices=[];
  if(evidence.url&&evidence.url!==snapshot.url||evidence.account&&evidence.account!==(snapshot.account||''))issues.push('店小秘原始价格记录所属页面或账号已变化');
  for(const previous of baseline){
    const candidates=actual.prices.filter(price=>price.name===previous.name&&price.label===previous.label&&price.kind===previous.kind&&price.row.sku===previous.row.sku&&variantSignature(price.row.attributes)===variantSignature(previous.row.attributes));
    const current=candidates.length===1?candidates[0]:candidates.find(price=>price.key===previous.key);
    if(!current||used.has(current.key)){issues.push(`${previous.label||previous.name||'价格'}：保存前后的SKU价格控件不再唯一对应`);continue;}
    used.add(current.key);
    const same=current.currencyOnly?JSON.stringify(current.expectedValue)===JSON.stringify(previous.expectedValue):current.blank&&previous.blank||current.amount!==null&&current.amount===previous.amount;
    const unchanged=same&&current.currency===previous.currency&&current.unit===previous.unit;
    if(!unchanged)issues.push(`${current.label||current.name||'价格'}：店小秘原有价格、币种或规格发生变化，已停止保存/移动`);
    prices.push({...current,matched:current.matched&&unchanged});
  }
  if(actual.prices.some(price=>!used.has(price.key)))issues.push('新增了未锁定的SKU价格字段，请重新核对本批价格范围');
  return {...actual,prices,ready:!issues.length,issues:[...new Set(issues)]};
}
