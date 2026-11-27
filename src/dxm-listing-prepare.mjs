import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0;
const normalizeTitle=value=>typeof value==='string'?value.replace(/ {2,}/g,' '):value;
const valueOf=(snapshot,label)=>snapshot.items.find(item=>item.label===label);
const chosen=item=>[...(item?.selections||[]),...(item?.checked||[])].filter(Boolean);
const hanText=/\p{Script=Han}/u;
// CJK and full-width punctuation, not a blanket ban on non-ASCII names.
const chineseSkuPunctuation=/[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/u;
const fail=message=>{throw new Error(message);};

export function validatePackageDefaults(value){
  const keys=['lengthCm','widthCm','heightCm','weightKg'];
  if(!value||keys.some(key=>!positive(value[key])))fail('店铺统一包裹长、宽、高及重量必须是已确认的大于0的数值');
  return Object.fromEntries(keys.map(key=>[key,Number(value[key])]));
}

// Source categories identify a source taxonomy. Only an explicit source mapping
// or the same precise leaf label can authorize choosing a destination category.
export function categoryForProduct(product,defaults){
  const source=product.sourceCategory||{},mapping=defaults.categoryMapping;
  if(mapping){
    const sourceMatches=mapping.sourcePlatform===(source.platform||'temu')
      &&String(mapping.sourceCategoryId)===String(source.categoryId||'')
      &&Array.isArray(mapping.targetPath)&&mapping.targetPath.length>0
      &&mapping.targetPath.every(x=>typeof x==='string'&&x.trim());
    if(!sourceMatches)return {allowed:false,reason:'商品来源分类不匹配当前店铺的分类映射'};
    return {allowed:true,path:mapping.targetPath,label:mapping.targetPath.at(-1),reason:'explicit-category-mapping'};
  }
  const names=source.breadcrumbs?.map(x=>x.name)||source.path||[],leaf=names.at(-1);
  const target=defaults.category?.label;
  const detail=product.description||'';
  const frameType=detail.match(/^Frame Type[：:][ \t]*(Wrapped Canvas|Framed)[ \t]*$/im)?.[1];
  const canvasPoster=source.platform==='temu'&&String(source.categoryId)==='12869'&&names.includes('Wall Art')
    &&/\b(?:poster|print(?:ed|s)?)\b/i.test(product.title||'')
    &&/Artwork Surface Material[：:]\s*Canvas(?:\s|$)/i.test(detail)
    &&!!frameType
    &&!/(?:hand[- ]painted|original oil painting|sculpture|手绘原作|雕塑)/i.test(product.title||'');
  if(canvasPoster&&target==='海报和印刷品'&&isDeepStrictEqual(defaults.category?.path,['家居、厨房用品','装饰字画','海报和印刷品']))
    return {allowed:true,path:defaults.category.path,label:target,reason:'source-canvas-poster-evidence',evidence:{sourceCategoryId:'12869',sourceLeaf:'Wall Art',properties:[`Frame Type: ${frameType}`,'Artwork Surface Material: Canvas'],titleMentionsPosterOrPrint:true}};
  const equivalent=[new Set(['海报和印刷品','海报与印刷品','Posters & Prints','Posters and Prints'])];
  const same=leaf&&target&&(leaf===target||equivalent.some(set=>set.has(leaf)&&set.has(target)));
  if(!same||!defaults.category?.path?.length)return {allowed:false,reason:'来源分类尚未对应到目标店铺的完整发布分类；不会按商品标题猜分类'};
  return {allowed:true,path:defaults.category.path,label:target,reason:'verified-leaf-category'};
}

export function defaultsFromMother({mother,extra,units,store,template,categoryPath}){
  if(!['cm'].includes(units?.dimension)||!['kg','g'].includes(units?.weight))fail('无法确认母稿包裹尺寸或重量单位，未猜测转换');
  const one=name=>{const values=mother.variantFields[name];if(values?.length!==1||!positive(values[0]))fail(`母稿${name}没有唯一有效值`);return Number(values[0]);};
  const packageDefaults=validatePackageDefaults({lengthCm:one('skuLength'),widthCm:one('skuWidth'),heightCm:one('skuHeight'),weightKg:one('weight')/(units.weight==='g'?1000:1)});
  if(extra.warehouses?.length!==1)fail('母稿仓库不唯一，不能自动选定发货仓库');
  const shipping=chosen(valueOf(mother,'运费模板')),dispatch=chosen(valueOf(mother,'承诺发货时效'));
  if(shipping.length!==1||dispatch.length!==1)fail('母稿运费模板或承诺发货时效缺失');
  const category=chosen(valueOf(mother,'产品分类'));
  return {platform:'temu',storeName:store.expectedStore||store.name,site:store.expectedSite||store.site,
    templateId:template.draftId,packageDefaults,warehouse:extra.warehouses[0],shippingTemplate:shipping[0],dispatch:dispatch[0],
    category:{label:category.at(-1)||'',path:categoryPath||template.categoryPath||[]},
    source:{draftId:template.draftId,url:mother.url,checkedAt:new Date().toISOString(),weightUnit:units.weight,dimensionUnit:units.dimension}};
}

// Read the visible headers/labels next to the observed package input names.
// Unitless values never become KG defaults implicitly.
export function readPackageUnits(){
  const textFor=name=>{const input=document.querySelector(`input[name="${name}"]`);if(!input)return '';
    const cell=input.closest('td'),row=cell?.parentElement,table=cell?.closest('table');
    const index=row?[...row.children].indexOf(cell):-1,header=index>=0?table?.querySelectorAll('thead th')[index]?.textContent:'';
    return [cell?.textContent,header,input.parentElement?.textContent,input.closest('.ant-form-item')?.textContent].filter(Boolean).join(' ');};
  const dimensions=['skuLength','skuWidth','skuHeight'].map(textFor),weight=textFor('weight');
  return {dimension:dimensions.every(x=>/(?:\bcm\b|厘米)/i.test(x))?'cm':null,
    weight:/(?:\bkg\b|千克|公斤)/i.test(weight)?'kg':/(?:\bg\b|克)/i.test(weight)?'g':null};
}

export function readTemplateCategoryPath(){
  const item=document.querySelector('.category-item'),label=item?.querySelector('.ant-select-selection-item')?.textContent.trim();
  if(!item||!label)return [];
  const categoryLabel=value=>{const text=String(value||'').normalize('NFKC').trim(),match=text.match(/^(.*?)\s*\(([^()]*)\)$/);return match&&/[\u3400-\u9fff]/.test(match[1])&&/^[\x20-\x7e]+$/.test(match[2])&&/[A-Za-z]/.test(match[2])?match[1].trim():text;};
  for(const container of [item.parentElement,item.parentElement?.parentElement]){
    const paths=[...new Set((container?.innerText||'').split('\n').map(x=>x.trim()).filter(x=>x.includes(' > ')&&categoryLabel(x.split(' > ').at(-1))===categoryLabel(label)))];
    if(paths.length===1)return paths[0].split(' > ').map(x=>x.trim());
    if(paths.length>1)return [];
  }
  return [];
}

export function readCategoryDialog(){
  const visible=e=>!!e.getClientRects().length;
  const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&e.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');
  if(modals.length!==1)return null;
  const modal=modals[0],path=modal.querySelector('.modal-body .w-960')?.textContent.trim()||'';
  return {path:path.includes(' > ')?path.split(' > ').map(s=>s.trim()):[],boxes:[...modal.querySelectorAll('.categories-box')].filter(visible).map(e=>[...e.querySelectorAll('.categories-item-name')].filter(visible).map(x=>x.textContent.trim()))};
}

export function readTemuListing(expected){
  const u=new URL(location.href),visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  if(u.origin!=='https://www.dianxiaomi.com'||u.pathname!=='/web/popTemu/edit'||u.href!==expected.url)throw new Error('认领商品编辑页已变化');
  const clean=s=>(s||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  const account=document.querySelector('.btn-user .user-name')?.textContent.trim();
  if(!expected.account||account!==expected.account)throw new Error('认领商品账号与工作台绑定账号不一致');
  const items=[...document.querySelectorAll('.ant-form-item')].filter(visible).map(el=>{
    const label=clean(el.querySelector('.ant-form-item-label')?.textContent);if(!label||/密码|密钥|token|password|secret|cookie|csrf/i.test(label))return null;
    const owns=e=>visible(e)&&e.closest('.ant-form-item')===el;
    const controls=[...el.querySelectorAll('input,textarea')].filter(owns).filter(e=>!['hidden','password','checkbox','radio','file','search'].includes(e.type)).map(e=>({name:e.name||e.id||'',value:e.value}));
    return {label,controls,selections:[...el.querySelectorAll('.ant-select-selection-item')].filter(owns).map(e=>clean(e.textContent)),
      checked:[...el.querySelectorAll('input:checked')].filter(owns).map(e=>clean(e.closest('label')?.textContent)),
      required:!!el.querySelector('.ant-form-item-label')?.querySelector('.ant-form-item-required'),hasMedia:[...el.querySelectorAll('img')].filter(owns).some(e=>/^https:/.test(e.src)&&e.naturalWidth>1),placeholders:[...el.querySelectorAll('.ant-select-selection-placeholder')].filter(owns).map(e=>e.textContent.trim()),errors:[...el.querySelectorAll('.ant-form-item-explain-error')].filter(visible).map(e=>e.textContent.trim())};
  }).filter(Boolean);
  const selected=label=>items.find(x=>x.label===label)?.selections||[];
  if(!selected('店铺账号').includes(expected.storeName))throw new Error('认领后的实际店铺与所选店铺不一致');
  if(expected.site&&!selected('经营站点').includes(expected.site))throw new Error('认领后的实际站点与所选站点不一致');
  const sources=[...document.querySelectorAll('input')].filter(e=>visible(e)&&/^https?:/.test(e.value)&&/temu\.com/.test(e.value)).map(e=>e.value);
  if(!sources.includes(expected.sourceUrl))throw new Error('认领后的来源链接与本批商品不一致');
  const fields=Object.fromEntries(['variationSku','price','skuLength','skuWidth','skuHeight','weight','stock','identifierCode','skuCategoryNum','numberOfPiecesNew'].map(name=>[name,[...document.getElementsByName(name)].filter(visible).map(e=>e.value)]));
  const images=selector=>[...document.querySelectorAll(selector)].map(e=>e.getAttribute('src')).filter(Boolean);
  const media={main:images('.mainImage .img-list img'),variants:images('.sku-image img'),detail:images('#wirelessDescContentBox img')};
  const variants=[...document.querySelectorAll('.theme-value-add')].map(e=>e.parentElement.parentElement.innerText.trim());
  const warehouses=[...document.querySelectorAll('.in-selector.ant-select-multiple.ant-select-allow-clear .ant-select-selection-item')].map(e=>e.getAttribute('title')||e.querySelector('[title]')?.getAttribute('title')||e.textContent.trim());
  const priceSnapshot=[...document.querySelectorAll('input[name="variationSku"]')].filter(visible).map(input=>{
    const row=input.closest('tr'),currency=[...row?.querySelectorAll('select')||[]].find(e=>[...e.options].some(o=>o.value==='USD'));
    const suggested=currency?.closest('td')?.querySelector('input'),header=row?.closest('table')?.querySelector('thead')?.innerText||'';
    return {sku:input.value,declaredCurrency:/申报价格\s*\(CNY\)/.test(header)?'CNY':null,declaredPrice:row?.querySelector('input[name="price"]')?.value??null,suggestedCurrency:currency?.value||null,suggestedPrice:suggested?.value??null};
  });
  return {url:u.href,account,storeName:expected.storeName,site:selected('经营站点').join('、'),sources,items,fields,media,variants,warehouses,
    priceSnapshot,
    notices:[...document.querySelectorAll('.ant-message-notice-content,.ant-modal')].filter(visible).map(e=>e.textContent.trim())};
}

export function listingReadiness(snapshot){
  const issues=[];
  for(const label of ['产品分类','承诺发货时效','运费模板']){
    const item=valueOf(snapshot,label);if(!item||![...chosen(item),...item.controls.map(x=>x.value)].some(Boolean))issues.push(`缺少${label}`);
  }
  for(const item of snapshot.items){
    for(const message of item.errors||[])issues.push(`${item.label}：${message}`);
    const mediaField=['产品轮播图','产品素材图','产品描述'].includes(item.label)&&item.hasMedia;
    if(item.required&&!['选择仓库'].includes(item.label)&&((!mediaField&&![...chosen(item),...item.controls.map(x=>x.value)].some(x=>String(x).trim()))||item.placeholders?.some(x=>/请选择省份/.test(x))))issues.push(`缺少${item.label}`);
  }
  if(snapshot.warehouses.length!==1)issues.push('需要唯一明确的发货仓库');
  const ids=snapshot.fields.variationSku;
  if(!ids.length||ids.some(x=>!x)||new Set(ids).size!==ids.length)issues.push('SKU为空或不唯一');
  const invalidSkuRows=ids.flatMap((value,index)=>hanText.test(String(value))||chineseSkuPunctuation.test(String(value))?[index+1]:[]);
  if(invalidSkuRows.length)issues.push(`第 ${invalidSkuRows.join('、')} 个SKU货号包含中文或中文标点，需填写不含这些字符的货号`);
  const englishTitle=valueOf(snapshot,'英文标题');
  if(englishTitle?.controls?.some(control=>hanText.test(String(control.value||''))))issues.push('英文标题仍含汉字，需核对英文译文');
  for(const name of ['price','skuLength','skuWidth','skuHeight','weight'])if(snapshot.fields[name].length!==ids.length||snapshot.fields[name].some(v=>!positive(v)))issues.push(`SKU ${name}不完整`);
  if(!ids.length||snapshot.fields.stock.length!==ids.length||snapshot.fields.stock.some(v=>!String(v).trim()||!Number.isSafeInteger(Number(v))||Number(v)<0))issues.push('仓库库存不完整');
  return [...new Set(issues)];
}

export function retainedListingData(snapshot){
  const ignored=new Set(['产品分类','承诺发货时效','运费模板','选择仓库']);
  return {sources:snapshot.sources,fields:Object.fromEntries(Object.entries(snapshot.fields).filter(([key])=>!['skuLength','skuWidth','skuHeight','weight'].includes(key))),
    media:snapshot.media,variants:snapshot.variants,priceSnapshot:snapshot.priceSnapshot,items:snapshot.items.filter(x=>!ignored.has(x.label)&&!x.controls.some(c=>['skuLength','skuWidth','skuHeight','weight'].includes(c.name))).map(({required,hasMedia,errors,...x})=>x)};
}

export function commodityData(snapshot){
  const retained=retainedListingData(snapshot);delete retained.fields.stock;
  retained.items=retained.items.filter(item=>item.label!=='产地');return retained;
}

export function comparableListing(snapshot){
  return {retained:retainedListingData(snapshot),fields:snapshot.fields,warehouses:snapshot.warehouses,
    category:chosen(valueOf(snapshot,'产品分类')),shipping:chosen(valueOf(snapshot,'运费模板')),dispatch:chosen(valueOf(snapshot,'承诺发货时效'))};
}

// DXM collapses repeated ASCII spaces in the product title on save. Keep all
// other fields and whitespace exact, including the independent English title.
export function comparableListingSaveSnapshot(snapshot){
  const result=structuredClone(snapshot);
  for(const item of result?.retained?.items||[])if(item.label==='产品标题')for(const control of item.controls||[]){
    control.value=normalizeTitle(control.value);
  }
  return result;
}

function verificationFor(snapshot,product,defaults){
  return {checkedAt:new Date().toISOString(),storeName:snapshot.storeName,sourceUrl:product.sourceUrl,skuCount:snapshot.fields.variationSku.length,
    packageDefaults:defaults.packageDefaults,warehouse:snapshot.warehouses[0],category:chosen(valueOf(snapshot,'产品分类')),
    shippingTemplate:chosen(valueOf(snapshot,'运费模板')),dispatch:chosen(valueOf(snapshot,'承诺发货时效')),
    priceCurrency:snapshot.priceSnapshot.every(s=>s.declaredCurrency==='CNY')?'CNY':null,priceSnapshot:snapshot.priceSnapshot,origin:chosen(valueOf(snapshot,'产地')),
    mainImageCount:snapshot.media.main.length,detailImageCount:snapshot.media.detail.length,variantImageCount:snapshot.media.variants.length,publicationAccepted:false};
}

function priorProofIssues(args){
  const previous=args.previousPreparation,proof=previous?.verification,product=args.product,defaults=args.defaults,target=args.targetStore,issues=[];
  if(previous?.status!=='prepared'||previous.ready!==true||previous.saved!==true||previous.published!==false||!proof||!Number.isFinite(Date.parse(proof.checkedAt)))return ['缺少已独立核验成功的旧版草稿凭证，不能推定保存成功'];
  if(previous.url!==args.platformEditUrl||proof.sourceUrl!==product?.sourceUrl||proof.storeName!==target?.name)issues.push('旧版保存凭证的商品地址、来源或店铺与本次核对不一致');
  if(!product?.skus?.length||product.skus.length!==1)issues.push('旧版凭证未保留多SKU规格对应快照，不能自动确认逐SKU规格');
  const ids=product?.skus?.map(s=>s.id)||[];
  if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||proof.skuCount!==ids.length)issues.push('旧版凭证的SKU数量与原始商品不一致');
  if(!product?.title||!product?.sourceUrl||!product?.images?.length||!Array.isArray(product?.detailImages)||!product?.skus?.every(s=>typeof s.image==='string'&&Array.isArray(s.specs)&&s.specs.length&&s.specs.every(v=>typeof v.value==='string'&&v.value)))issues.push('缺少原始商品标题、图片或规格证据');
  if(proof.mainImageCount!==product?.images?.length||proof.detailImageCount!==product?.detailImages?.length||proof.variantImageCount!==ids.length)issues.push('旧版凭证缺少与原始商品一致的图片数量');
  const mapping=categoryForProduct(product||{},defaults||{}),origin=originForProduct(product||{});
  if(!mapping.allowed||!isDeepStrictEqual(proof.category,[mapping.label]))issues.push('旧版分类凭证不能与来源分类对应');
  if(!origin||!isDeepStrictEqual(proof.origin,[origin.country,origin.province]))issues.push('旧版产地凭证不能与来源资料对应');
  if(defaults?.storeName!==target?.name||defaults?.site!==(target?.site||target?.expectedSite))issues.push('旧版默认参数不属于所选店铺及站点');
  try{if(!isDeepStrictEqual(validatePackageDefaults(proof.packageDefaults),validatePackageDefaults(defaults?.packageDefaults)))issues.push('旧版包裹凭证与本次默认值不一致');}catch{issues.push('旧版包裹凭证缺失或无效');}
  if(!defaults?.warehouse||proof.warehouse!==defaults.warehouse||!defaults.shippingTemplate||!isDeepStrictEqual(proof.shippingTemplate,[defaults.shippingTemplate])||!defaults.dispatch||!isDeepStrictEqual(proof.dispatch,[defaults.dispatch]))issues.push('旧版仓库、运费模板或发货时效凭证不完整或不一致');
  if(proof.priceCurrency!=='CNY'||!Array.isArray(proof.priceSnapshot)||proof.priceSnapshot.length!==ids.length||proof.priceSnapshot.some((p,i)=>p.sku!==ids[i]||p.declaredCurrency!=='CNY'||!positive(p.declaredPrice)||!Object.hasOwn(p,'suggestedCurrency')||!Object.hasOwn(p,'suggestedPrice')))issues.push('旧版逐SKU价格与币种凭证不完整');
  return [...new Set(issues)];
}

// Legacy successful receipts are a persisted baseline, never a reconstructed
// pre-save snapshot. This fallback is limited to a single-SKU source because
// those receipts did not retain the association between multiple SKU specs.
export function compareListingWithPriorProof(snapshot,args,{units,categoryPath}={}){
  const issues=priorProofIssues(args);if(issues.length)return issues;
  const {product,defaults,previousPreparation}=args,proof=previousPreparation.verification;
  if(snapshot.url!==args.platformEditUrl||snapshot.account!==args.erpConnection?.expectedAccount||snapshot.storeName!==args.targetStore.name||snapshot.site!==(args.targetStore.site||args.targetStore.expectedSite))issues.push('当前草稿账号、店铺、站点或地址与目标不一致');
  if(!snapshot.sources.length||snapshot.sources.some(s=>s!==product.sourceUrl))issues.push('当前草稿来源链接与原始商品不一致');
  for(const label of ['产品标题','英文标题']){
    const controls=valueOf(snapshot,label)?.controls;
    if(controls?.length!==1||normalizeTitle(controls[0].value)!==normalizeTitle(product.title))issues.push(`${label}与原始商品不一致`);
  }
  if(!isDeepStrictEqual(snapshot.fields.variationSku,product.skus.map(s=>s.id)))issues.push('当前草稿SKU与原始商品不一致');
  if(!isDeepStrictEqual(snapshot.fields.stock.map(Number),product.skus.map(s=>s.stock)))issues.push('当前草稿库存与原始商品不一致');
  for(const sku of product.skus)for(const spec of sku.specs)if(!snapshot.variants.some(v=>v.split('\n').map(s=>s.trim()).includes(spec.value)))issues.push('当前草稿规格与原始商品不一致');
  const imageIds=values=>values.map(value=>{try{const u=new URL(value);return u.protocol==='https:'&&['img.kwcdn.com','img.cdnfe.com'].includes(u.hostname)?u.pathname:null;}catch{return null;}});
  for(const [kind,source]of [['main',product.images],['detail',product.detailImages],['variants',product.skus.map(s=>s.image)]]){
    const actual=imageIds(snapshot.media[kind]),expected=imageIds(source);
    if(actual.includes(null)||expected.includes(null)||!isDeepStrictEqual(actual,expected))issues.push(`当前草稿${kind}图片或顺序与原始商品不一致`);
  }
  if(units?.dimension!=='cm'||!['g','kg'].includes(units?.weight))issues.push('当前草稿包裹单位无法确认');
  else for(const [name,value]of Object.entries({skuLength:defaults.packageDefaults.lengthCm,skuWidth:defaults.packageDefaults.widthCm,skuHeight:defaults.packageDefaults.heightCm,weight:defaults.packageDefaults.weightKg*(units.weight==='g'?1000:1)}))if(!isDeepStrictEqual(snapshot.fields[name].map(Number),product.skus.map(()=>Number(value))))issues.push(`当前草稿${name}与已确认包裹参数不一致`);
  for(const [label,key]of [['产品分类','category'],['产地','origin'],['运费模板','shippingTemplate'],['承诺发货时效','dispatch']])if(!isDeepStrictEqual(chosen(valueOf(snapshot,label)),proof[key]))issues.push(`当前草稿${label}与原已验证凭证不一致`);
  if(!isDeepStrictEqual(categoryPath,categoryForProduct(product,defaults).path))issues.push('当前草稿完整分类路径与来源映射不一致');
  if(!isDeepStrictEqual(snapshot.warehouses,[proof.warehouse]))issues.push('当前草稿仓库与原已验证凭证不一致');
  if(!isDeepStrictEqual(snapshot.priceSnapshot,proof.priceSnapshot))issues.push('当前草稿逐SKU价格或币种与原已验证凭证不一致');
  issues.push(...listingReadiness(snapshot));return [...new Set(issues)];
}

// A transient toast is only an acknowledgement. The independent GET and the
// immutable pre-save snapshot determine the result, even if that toast is lost.
export async function settleListingSave({observeReceipt,verifyReadOnly}){
  let observed=false,observationIssue;
  try{observed=!!await observeReceipt();}catch(error){observationIssue=error.message;}
  const result=await verifyReadOnly();
  return {...result,saveReceipt:{observed,...(observationIssue?{observationIssue}:{})}};
}

export function originForProduct(product){
  const line=(product.description||'').split('\n').find(line=>/^(?:Origin|产地)[：:]/i.test(line));
  if(!line)return null;
  if(/^(?:Origin|产地)[：:]\s*(?:Zhejiang,\s*China|中国[，,、\s]*浙江省?|浙江省?[，,、\s]*中国)\s*$/i.test(line))return {country:'中国大陆',province:'浙江省',evidence:line};
  if(/^(?:Origin|产地)[：:]\s*(?:Guangdong,\s*China|中国[，,、\s]*广东省?|广东省?[，,、\s]*中国)\s*$/i.test(line))return {country:'中国大陆',province:'广东省',evidence:line};
  return null;
}

export function newDraftSiteInitializationIssues(args,snapshot,now=Date.now()){
  const proof=args.newDraftSiteInitialization,target=args.targetStore,defaults=args.defaults,product=args.product,issues=[];
  if(!proof||proof.version!==1||proof.source!=='workbench-new-claim'||proof.saveState!=='no-workbench-save-submission')return ['缺少本工作台新认领且无保存提交的站点初始化证明'];
  if(args.preparationIntent||args.prepareSubmittedAt||args.previousPreparation&&args.previousPreparation.saved!==false||args.preparation&&args.preparation.saved!==false)issues.push('已有保存提交或保存结果，不能初始化经营站点');
  const site=target?.site||target?.expectedSite;
  if(target?.platform!=='temu'||!target.key||proof.targetStore?.platform!=='temu'||proof.targetStore.key!==target.key||proof.targetStore.name!==target.name||proof.targetStore.site!==site||defaults?.storeName!==target.name||defaults.site!==site||site!=='加拿大站'||proof.toSite!==site||proof.fromSite!=='美国站'||snapshot.site!==proof.fromSite)issues.push('经营站点初始化的来源或目标店铺、站点不一致');
  if(!args.erpConnection?.expectedAccount||proof.account!==args.erpConnection.expectedAccount||snapshot.account!==proof.account||snapshot.storeName!==target.name||proof.platformEditUrl!==args.platformEditUrl||snapshot.url!==proof.platformEditUrl||proof.sourceUrl!==product?.sourceUrl||!snapshot.sources?.length||snapshot.sources.some(s=>s!==proof.sourceUrl))issues.push('经营站点初始化的账号、商品来源或草稿地址不一致');
  for(const [url,pathname]of [[proof.collectionEditUrl,'/web/productCrawl/edit'],[proof.platformEditUrl,'/web/popTemu/edit']]){
    try{const u=new URL(url);if(u.origin!=='https://www.dianxiaomi.com'||u.pathname!==pathname||!/^\d{6,30}$/.test(u.searchParams.get('id')||'')||u.searchParams.get('id')===defaults.templateId)throw new Error();}catch{issues.push('经营站点初始化缺少唯一有效的来源及平台草稿链接');}
  }
  const ids=product?.skus?.map(s=>s.id),complete=values=>Array.isArray(values)&&values.length>0&&values.every(x=>typeof x==='string'&&x)&&new Set(values).size===values.length;
  if(!complete(ids)||!complete(proof.skuIds)||!isDeepStrictEqual([...ids||[]].sort(),[...proof.skuIds||[]].sort())||snapshot.fields?.variationSku?.length&&!isDeepStrictEqual([...snapshot.fields.variationSku].sort(),[...ids||[]].sort()))issues.push('经营站点初始化缺少与来源一致的完整SKU证明');
  if(!product?.title||!valueOf(snapshot,'产品标题')?.controls?.some(c=>normalizeTitle(c.value)===normalizeTitle(product.title)))issues.push('经营站点初始化的商品标题与来源不一致');
  const submitted=Date.parse(proof.claimSubmittedAt),recorded=Date.parse(proof.claimRecordTime),verified=Date.parse(proof.verifiedAt);
  if(![submitted,recorded,verified].every(Number.isFinite)||verified<submitted||recorded-submitted< -60000||recorded-submitted>90000||now-verified>600000||verified-now>60000)issues.push('新认领证明的时间不匹配或已过期，请重新只读核对');
  return [...new Set(issues)];
}

export async function initializeNewDraftSite(args,expected,{read,point,send,poll}){
  const initial=await read({...expected,site:undefined});
  if(initial.site===expected.site)return initial;
  const issues=newDraftSiteInitializationIssues(args,initial);if(issues.length)fail(issues.join('；'));
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  for(const step of ['open','option']){
    const coordinates=await poll(()=>point({expected,action:'point',locator:{siteInitialization:step},initialization:args.newDraftSiteInitialization}),{timeout:15000,label:step==='open'?'新草稿经营站点菜单':'已配置的加拿大站选项'});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...coordinates});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...coordinates});
  }
  const after=await poll(async()=>{const current=await read({...expected,site:undefined});if(current.site===args.newDraftSiteInitialization.fromSite)return null;return read(expected);},{timeout:30000,label:'新草稿经营站点与目标店铺一致'});
  const ids=args.product.skus.map(s=>s.id);
  if(after.fields.variationSku.length&&!isDeepStrictEqual([...after.fields.variationSku].sort(),[...ids].sort()))fail('初始化站点后SKU与来源不一致，未继续');
  const stable=s=>({sources:s.sources,titles:s.items.filter(i=>['产品标题','英文标题'].includes(i.label)).map(i=>i.controls.map(c=>normalizeTitle(c.value))),media:s.media});
  if(!isDeepStrictEqual(stable(initial),stable(after))||initial.priceSnapshot.length&&!isDeepStrictEqual(initial.priceSnapshot,after.priceSnapshot))fail('初始化站点时商品来源、标题、图片或已有价格发生变化，未继续');
  return after;
}

// All mutations remain confined to the exact claimed product, account and store.
export function listingAction({expected,action,locator,value,initialization}){
  const u=new URL(location.href),visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  if(u.origin!=='https://www.dianxiaomi.com'||u.pathname!=='/web/popTemu/edit'||u.href!==expected.url||u.searchParams.get('id')===expected.templateId)throw new Error('只能补全本批已认领商品，不能修改母稿');
  if(document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('补全期间店小秘账号发生变化');
  const clean=s=>(s||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  const store=[...document.querySelectorAll('.ant-form-item')].find(e=>clean(e.querySelector('.ant-form-item-label')?.textContent)==='店铺账号');
  if(![...store?.querySelectorAll('.ant-select-selection-item')||[]].some(e=>clean(e.textContent)===expected.storeName))throw new Error('补全期间目标店铺发生变化');
  const site=[...document.querySelectorAll('.ant-form-item')].find(e=>clean(e.querySelector('.ant-form-item-label')?.textContent)==='经营站点');
  const siteValues=[...site?.querySelectorAll('.ant-select-selection-item')||[]].filter(visible).map(e=>clean(e.textContent));
  const initializeSite=action==='point'&&['open','option'].includes(locator.siteInitialization)&&initialization?.version===1&&initialization.source==='workbench-new-claim'&&initialization.saveState==='no-workbench-save-submission'&&initialization.platformEditUrl===expected.url&&initialization.account===expected.account&&initialization.sourceUrl===expected.sourceUrl&&initialization.targetStore?.name===expected.storeName&&initialization.targetStore?.site===expected.site&&initialization.toSite===expected.site&&expected.site==='加拿大站'&&initialization.fromSite==='美国站'&&siteValues.length===1&&siteValues[0]===initialization.fromSite;
  if(locator.siteInitialization&&!initializeSite)throw new Error('经营站点初始化证明或当前初始站点不一致');
  if(expected.site&&(siteValues.length!==1||siteValues[0]!==expected.site)&&!initializeSite)throw new Error('补全期间目标站点发生变化');
  if(![...document.querySelectorAll('input')].some(e=>visible(e)&&e.value===expected.sourceUrl))throw new Error('补全期间商品来源发生变化');
  let nodes;
  if(initializeSite){
    if(locator.siteInitialization==='open')nodes=[...site.querySelectorAll('.ant-select-selector')];
    else{
      const input=site.querySelector('input[role="combobox"]'),listId=input?.getAttribute('aria-controls')||input?.getAttribute('aria-owns'),dropdown=listId?document.getElementById(listId)?.closest('.ant-select-dropdown'):null;
      nodes=[...dropdown?.querySelectorAll('.ant-select-item-option')||[]].filter(e=>clean(e.textContent)===expected.site&&!e.classList.contains('ant-select-item-option-disabled'));
    }
  }else if(locator.categoryDepth!==undefined){
    const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&e.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');
    if(modals.length!==1)throw new Error('分类窗口不唯一');
    const column=[...modals[0].querySelectorAll('.categories-box')].filter(visible)[locator.categoryDepth];
    nodes=column?[...column.querySelectorAll('.categories-item-name')]:[];
  }else nodes=locator.formLabel?[...document.querySelectorAll('.ant-form-item')].filter(e=>clean(e.querySelector('.ant-form-item-label')?.textContent)===locator.formLabel):[...document.querySelectorAll(locator.selector)];
  if(locator.descendant)nodes=nodes.flatMap(e=>[...e.querySelectorAll(locator.descendant)]);
  nodes=nodes.filter(visible);if(locator.text!==undefined)nodes=nodes.filter(e=>e.textContent.trim()===locator.text);
  if(locator.index!==undefined)nodes=nodes[locator.index]?[nodes[locator.index]]:[];
  if(action==='point'&&nodes.length===0)return null;
  if(nodes.length!==1)throw new Error(`补全控件必须唯一：${locator.formLabel||locator.selector}（${nodes.length}）`);
  const e=nodes[0];if(e.disabled||e.readOnly||e.getAttribute('aria-disabled')==='true')throw new Error('补全控件不可操作');
  if(action==='search'){
    if(e.type!=='search'||!e.classList.contains('ant-select-selection-search-input')||typeof value!=='string')throw new Error('只能搜索当前下拉框选项');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));return e.value;
  }
  if(action==='fill'){
    const packageField=['skuLength','skuWidth','skuHeight','weight'].includes(e.name),stockField=e.name==='stock';
    if((!packageField&&!stockField)||!Number.isFinite(Number(value))||(stockField?(!Number.isSafeInteger(Number(value))||Number(value)<0):Number(value)<=0))throw new Error('只允许填写已确认的包裹尺寸、重量和来源库存');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;
  }
  if(action==='point'){
    e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2};
    if(!e.contains(document.elementFromPoint(point.x,point.y)))return null;return point;
  }
  throw new Error('不支持的补全操作');
}

export function createDxmListingPreparer(configuration={},transport){
  const moduleFor=name=>transport?.[name]?Promise.resolve(transport[name]):import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib',name)).href);
  async function owned(args,fn,{keepOnError=false}={}){
    if(args.browserConfig?.type!=='chrome')fail('认领后补全只支持绑定的谷歌浏览器');
    const lib=await moduleFor('bit-cdp.mjs'),info=await lib.connection(args.browserConfig),browser=await lib.connect(info.ws);let page,targetId,finished=false;
    try{({targetId}=await browser.send('Target.createTarget',{url:'about:blank'}));page=await lib.pageById(info,targetId);await page.send('Page.enable');const result=await fn(page,lib,targetId);finished=true;return result;}
    catch(error){if(keepOnError&&targetId)error.reviewTargetId=targetId;throw error;}
    finally{page?.close();if((finished||!keepOnError)&&targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
  }
  async function readDefaults(args){
    const store=args.store||args.targetStore,template=args.template;
    if(store?.platform!=='temu')return {platform:store?.platform,ready:false,issues:['该平台尚未配置已校验的发布默认值']};
    if(!template?.draftId)fail('请为目标店铺选择已校验的商品母稿');
    return owned(args,async page=>{
      const {readMotherExtras,checkMother}=await moduleFor('temu-mothers.mjs');
      const {navigateAndWait}=await moduleFor('erp-page-state.mjs');
      const {readPage}=await import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'inspect-draft.mjs')).href);
      const exact={...store,...template,expectedStore:store.expectedStore||store.name,expectedSite:store.expectedSite||store.site,erpConnection:args.erpConnection};
      if(!/^\d{6,30}$/.test(exact.draftId))fail('母稿ID无效');
      await navigateAndWait(page,'https://www.dianxiaomi.com/web/popTemu/edit?id='+exact.draftId,()=>document.getElementsByName('variationSku').length>0&&document.getElementsByName('stock').length>0&&!!document.querySelector('#wirelessDescContentBox'),undefined,{label:'母稿类目、SKU和库存完整加载',timeout:90000});
      const mother=await page.evaluate(readPage,exact),extra=await page.evaluate(readMotherExtras);
      if(!args.erpConnection?.expectedAccount||extra.account!==args.erpConnection.expectedAccount)fail('母稿账号与工作台绑定账号不一致');
      const issues=checkMother(mother,extra);if(issues.length)fail(issues.join('；'));
      const units=await page.evaluate(readPackageUnits),categoryPath=await page.evaluate(readTemplateCategoryPath);
      return {...defaultsFromMother({mother,extra,units,store:exact,template,categoryPath}),ready:true};
    });
  }
  async function prepare(args){
    const target=args.targetStore,defaults=args.defaults;
    if(target?.platform!=='temu')return {status:'needs-configuration',ready:false,published:false,url:args.platformEditUrl,issues:['该平台的认领后自动补全尚未联调；不会误报可发布']};
    const categoryMapping=categoryForProduct(args.product,defaults||{}),origin=originForProduct(args.product),sourceIssues=[];
    if(!categoryMapping.allowed)sourceIssues.push(categoryMapping.reason);
    if(!origin)sourceIssues.push('Temu必填产地缺少已验证的来源映射');
    if(sourceIssues.length)return {status:'needs-configuration',ready:false,published:false,saved:false,url:args.platformEditUrl,issues:sourceIssues,sourceCategory:args.product.sourceCategory};
    validatePackageDefaults(defaults?.packageDefaults);
    const url=new URL(args.platformEditUrl),expected={url:url.href,account:args.erpConnection?.expectedAccount,storeName:target.name||target.expectedStore,site:target.site||target.expectedSite,sourceUrl:args.product.sourceUrl,templateId:defaults.templateId};
    if(url.origin!=='https://www.dianxiaomi.com'||url.pathname!=='/web/popTemu/edit'||!/^\d{6,30}$/.test(url.searchParams.get('id')||'')||url.searchParams.get('id')===defaults.templateId)fail('认领商品编辑链接无效或指向母稿');
    if(defaults.storeName!==expected.storeName||defaults.site!==expected.site)fail('发布默认值不属于所选店铺及站点');
    return owned(args,async(page,lib)=>{
      const {navigateAndWait}=await moduleFor('erp-page-state.mjs');
      await navigateAndWait(page,url.href,sourceUrl=>!!document.querySelector('.btn-user .user-name')&&!!document.querySelector('#wirelessDescContentBox')&&[...document.querySelectorAll('input')].some(e=>e.value===sourceUrl),args.product.sourceUrl,{label:'已认领商品来源和编辑数据完整加载',timeout:90000});
      const click=async locator=>{
        const point=await lib.poll(()=>page.evaluate(listingAction,{expected,action:'point',locator}),{timeout:15000,label:'补全控件可操作'});
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      };
      const choose=async(label,text)=>{
        await click({formLabel:label,descendant:'.ant-select-selector'});
        await click({selector:'.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',text});
      };
      let before=args.newDraftSiteInitialization?await initializeNewDraftSite(args,expected,{read:input=>page.evaluate(readTemuListing,input),point:input=>page.evaluate(listingAction,input),send:(...input)=>page.send(...input),poll:(...input)=>lib.poll(...input)}):await page.evaluate(readTemuListing,expected);
      if(chosen(valueOf(before,'产品分类')).length){
        await lib.poll(()=>page.evaluate(ids=>{const inputs=[...document.getElementsByName('variationSku')];return inputs.length===ids.length&&inputs.every(e=>ids.includes(e.value));},args.product.skus.map(s=>s.id)),{timeout:60000,label:'已有分类商品的原始SKU完整加载'});
        before=await page.evaluate(readTemuListing,expected);
      }
      const category=valueOf(before,'产品分类');
      if(chosen(category).length&&categoryMapping.allowed&&!chosen(category).includes(categoryMapping.label))return {status:'needs-configuration',ready:false,published:false,saved:false,url:url.href,issues:['已有产品分类与来源证据对应的目标分类不同，未覆盖现有分类'],sourceCategory:args.product.sourceCategory};
      if(!chosen(category).length){
        const mapping=categoryMapping;
        if(!mapping.allowed)return {status:'needs-configuration',ready:false,published:false,url:url.href,issues:[mapping.reason],sourceCategory:args.product.sourceCategory};
        await click({formLabel:'产品分类',descendant:'button',text:'选择分类'});
        for(const [depth,label]of mapping.path.entries()){
          await lib.poll(async()=>{const state=await page.evaluate(readCategoryDialog);return state?.boxes[depth]?.includes(label);},{timeout:30000,label:`分类：${label}`});
          await click({categoryDepth:depth,text:label});
        }
        const selected=await page.evaluate(readCategoryDialog);if(!isDeepStrictEqual(selected?.path,mapping.path))fail('目标分类路径未完整匹配，未应用');
        await click({selector:'.ant-modal button',text:'选择'});
        await lib.poll(()=>page.evaluate(ids=>{const inputs=[...document.getElementsByName('variationSku')];return document.querySelectorAll('.theme-value-add').length>0&&inputs.length===ids.length&&inputs.every(e=>ids.includes(e.value))&&![...document.querySelectorAll('.ant-modal')].some(e=>e.getClientRects().length&&e.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');},args.product.skus.map(s=>s.id)),{timeout:60000,label:'目标分类属性与原始SKU完整映射'});
        const categorized=await page.evaluate(readTemuListing,expected);
        if(!isDeepStrictEqual(before.sources,categorized.sources)||!isDeepStrictEqual(before.media.main,categorized.media.main)||!isDeepStrictEqual(before.media.detail,categorized.media.detail)){
          const error=new Error('选择分类时商品来源、主图或详情图发生变化，未保存');error.diagnostics={before:{sources:before.sources,media:before.media},after:{sources:categorized.sources,media:categorized.media}};throw error;
        }
        before=categorized;
      }
      const ids=before.fields.variationSku;
      if(ids.length!==args.product.skus.length||args.product.skus.some(s=>!ids.includes(s.id)))fail('认领后SKU与原始商品不一致，未修改');
      const units=await page.evaluate(readPackageUnits);
      if(units.dimension!=='cm'||!['kg','g'].includes(units.weight))fail('目标商品包裹单位无法确认，未猜测转换');
      const mapped=before;
      if(!before.warehouses.length){
        await click({selector:'.in-selector.ant-select-multiple.ant-select-allow-clear .ant-select-selector'});
        await click({selector:'.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',text:defaults.warehouse});
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await lib.poll(async()=>{const current=await page.evaluate(readTemuListing,expected);return current.warehouses.length===1&&current.warehouses[0]===defaults.warehouse&&current.fields.stock.length===ids.length;},{timeout:30000,label:'目标仓库和SKU库存字段加载'});
      }else if(before.warehouses.length!==1||before.warehouses[0]!==defaults.warehouse)return {status:'needs-configuration',ready:false,published:false,url:url.href,issues:['商品已有其他仓库，未覆盖既有仓库库存']};
      const withWarehouse=await page.evaluate(readTemuListing,expected);
      if(!isDeepStrictEqual(commodityData(mapped),commodityData(withWarehouse)))fail('选择仓库时商品标题、SKU、价格、规格或图片发生变化，未保存');
      for(const [index,id]of ids.entries()){
        const sku=args.product.skus.find(s=>s.id===id);
        await page.evaluate(listingAction,{expected,action:'fill',locator:{selector:'input[name="stock"]',index},value:sku.stock});
      }
      const originItem=valueOf(withWarehouse,'产地');
      if(originItem?.placeholders?.some(x=>/请选择省份/.test(x))&&origin&&originItem.selections.includes(origin.country)){
        await click({formLabel:'产地',descendant:'.ant-select-selector',index:1});
        await page.evaluate(listingAction,{expected,action:'search',locator:{formLabel:'产地',descendant:'input[type="search"]',index:1},value:origin.province});
        await click({selector:'.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',text:origin.province});
      }
      before=await page.evaluate(readTemuListing,expected);
      if(!isDeepStrictEqual(commodityData(mapped),commodityData(before)))fail('填写库存或产地时商品资料发生非预期变化，未保存');
      if(before.fields.stock.some((value,index)=>Number(value)!==args.product.skus.find(s=>s.id===ids[index]).stock))fail('目标仓库库存与来源SKU库存不一致，未保存');
      for(const [field,text]of [['运费模板',defaults.shippingTemplate]])if(!chosen(valueOf(before,field)).includes(text))await choose(field,text);
      if(!chosen(valueOf(before,'承诺发货时效')).includes(defaults.dispatch))await click({formLabel:'承诺发货时效',descendant:'label',text:defaults.dispatch});
      args.onProgress?.('filling-package',{message:'填写店铺统一包裹参数'});
      const values={skuLength:defaults.packageDefaults.lengthCm,skuWidth:defaults.packageDefaults.widthCm,skuHeight:defaults.packageDefaults.heightCm,weight:defaults.packageDefaults.weightKg*(units.weight==='g'?1000:1)};
      for(const [name,value]of Object.entries(values))for(let i=0;i<ids.length;i++)await page.evaluate(listingAction,{expected,action:'fill',locator:{selector:`input[name="${name}"]`,index:i},value});
      const prepared=await page.evaluate(readTemuListing,expected);
      if(!isDeepStrictEqual(retainedListingData(before),retainedListingData(prepared)))fail('补全期间商品标题、SKU、价格、库存、规格或图片发生变化，未保存');
      const issues=listingReadiness(prepared);
      if(!isDeepStrictEqual(chosen(valueOf(prepared,'产地')),[origin.country,origin.province]))issues.push('产地与原始详情不一致，未使用母稿或其他商品的产地');
      const preview={category:chosen(valueOf(prepared,'产品分类')),packageDefaults:defaults.packageDefaults,warehouse:prepared.warehouses[0],skuStocks:ids.map((id,index)=>({id,stock:Number(prepared.fields.stock[index])})),origin:chosen(valueOf(prepared,'产地')),shippingTemplate:chosen(valueOf(prepared,'运费模板')),dispatch:chosen(valueOf(prepared,'承诺发货时效')),priceSnapshot:prepared.priceSnapshot};
      if(issues.length||args.dryRun)return {status:issues.length?'needs-configuration':'ready-to-save',ready:false,readyToSave:!issues.length,published:false,saved:false,url:url.href,issues,preview};
      if(typeof args.beforeSave!=='function')fail('缺少保存前执行记录，未提交保存');
      const preparationIntent={url:url.href,phase:'saving-prepared-listing',expectedSnapshot:comparableListing(prepared)};
      await args.beforeSave(structuredClone(preparationIntent));
      await click({selector:'button',text:'保存',index:0});
      return settleListingSave({
        observeReceipt:()=>lib.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.ant-message-notice-content,.ant-modal')].filter(e=>e.getClientRects().length).some(e=>/保存成功|已保存/.test(e.textContent))),{timeout:8000,label:'认领商品保存回执'}),
        verifyReadOnly:async()=>{
          args.onProgress?.('verifying-prepared-listing',{message:'只读核对已保存商品，不重复提交保存'});
          return verify({...args,preparationIntent});
        }
      });
    },{keepOnError:!args.dryRun});
  }
  async function verify(args){
    const expectedSnapshot=args.preparationIntent?.expectedSnapshot||args.expectedSnapshot;
    const unresolved=issues=>({status:'needs-review',ready:false,published:false,saved:null,url:args.platformEditUrl,issues});
    if(args.targetStore?.platform!=='temu')return unresolved(['缺少该平台保存前快照，无法自动确认保存结果；不会重复保存']);
    if(args.preparationIntent?.url&&args.preparationIntent.url!==args.platformEditUrl)return {status:'needs-review',ready:false,published:false,saved:null,url:args.platformEditUrl,issues:['核验地址与保存前记录不一致，未确认保存结果']};
    if(!expectedSnapshot){const issues=priorProofIssues(args);if(issues.length)return unresolved(issues);}
    const ids=expectedSnapshot?.fields?.variationSku||args.product?.skus?.map(s=>s.id);
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||expectedSnapshot&&!expectedSnapshot.retained)return unresolved(['保存前商品快照不完整，未确认保存结果；不会重复保存']);
    const url=new URL(args.platformEditUrl),defaults=args.defaults,expected={url:url.href,account:args.erpConnection?.expectedAccount,storeName:args.targetStore.name||args.targetStore.expectedStore,site:args.targetStore.site||args.targetStore.expectedSite,sourceUrl:args.product.sourceUrl,templateId:defaults.templateId};
    if(url.origin!=='https://www.dianxiaomi.com'||url.pathname!=='/web/popTemu/edit'||!/^\d{6,30}$/.test(url.searchParams.get('id')||'')||url.searchParams.get('id')===defaults.templateId)fail('只读核验商品链接无效或指向母稿');
    return owned(args,async(page,lib)=>{
      const {navigateAndWait}=await moduleFor('erp-page-state.mjs');
      await navigateAndWait(page,url.href,({sourceUrl,ids})=>!!document.querySelector('#wirelessDescContentBox')&&[...document.querySelectorAll('input')].some(e=>e.value===sourceUrl)&&[...document.getElementsByName('variationSku')].length===ids.length&&[...document.getElementsByName('variationSku')].every(e=>ids.includes(e.value)),{sourceUrl:args.product.sourceUrl,ids},{label:'只读核验已保存商品',timeout:90000});
      if(!expectedSnapshot){
        const actual=await page.evaluate(readTemuListing,expected),units=await page.evaluate(readPackageUnits),categoryPath=await page.evaluate(readTemplateCategoryPath);
        const issues=compareListingWithPriorProof(actual,args,{units,categoryPath}),ready=!issues.length;
        return {status:ready?'prepared':'needs-review',ready,published:false,saved:ready?true:null,reconciled:true,url:url.href,issues,
          verification:{...verificationFor(actual,args.product,defaults),method:'read-only-source-and-prior-proof',readOnly:true,priorVerifiedAt:args.previousPreparation.verification.checkedAt,sourceAndPriorProofVerified:ready}};
      }
      const savedExpectation=comparableListingSaveSnapshot(expectedSnapshot);
      const actual=await lib.poll(async()=>{const current=await page.evaluate(readTemuListing,expected);return isDeepStrictEqual(savedExpectation,comparableListingSaveSnapshot(comparableListing(current)))?current:null;},{timeout:30000,label:'只读核对保存前快照'});
      const issues=listingReadiness(actual);return {status:issues.length?'needs-review':'prepared',ready:!issues.length,published:false,saved:true,reconciled:true,url:url.href,issues,verification:verificationFor(actual,args.product,defaults)};
    });
  }
  return {readDefaults,prepare,verify};
}

export const readListingDefaults=args=>createDxmListingPreparer(args.configuration).readDefaults(args);
export const prepareListing=args=>createDxmListingPreparer(args.configuration).prepare(args);
export const verifyListing=args=>createDxmListingPreparer(args.configuration).verify(args);
