import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {temuGoodsId} from './geekbi.mjs';

const XLSX=createRequire(import.meta.url)('xlsx');
// Downloaded from the account's official “导入产品数据” dialog, 2026-11-18.
export const DXM_TEMPLATE_URL='https://www.dianxiaomi.com/static/importTemplate/import_product_data.xls?v=1.0';
export const DXM_HEADERS=['SPU（必填）','产品标题（必填）','产品链接url（非必填）','产品图片链接url（非必填，多个用,或换行隔开）','产品视频链接url（非必填）','产品简易描述（非必填，仅支持文本）','产品详细描述（非必填，图片图文请换行）','产品说明书url（非必填，Temu专用，仅支持填写1个）','变种SKU（必填）','变种属性名称一（非必填）','变种属性值一（非必填）','变种属性名称二（非必填）','变种属性值二（非必填）','SKU价格（USD,非必填）','促销价（USD,非必填）','库存（非必填）','尺寸-长（cm,非必填）','尺寸-宽（cm,非必填）','尺寸-高（cm,非必填）','重量（KG,非必填）','变种SKU图片链接（非必填，多个用,或换号隔开）'];
const required=(condition,message)=>{if(!condition)throw new Error(message);};
function identifier(value,label){
  required(typeof value==='string'||Number.isSafeInteger(value),`${label}编号精度无法确认`);
  required(/^\d{6,32}$/.test(String(value)),`${label}编号缺失或无效`);return String(value);
}
function text(value,label){required(typeof value==='string'&&value.trim()&&value.length<=32767,`${label}缺失或超出表格限制`);return value;}
function media(value,label){
  let u;try{u=new URL(value);}catch{throw new Error(`${label}链接缺失或无效`);}
  required(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='kwcdn.com'||u.hostname.endsWith('.kwcdn.com')),`${label}不是已支持的 Temu 素材地址，请人工核对`);return value;
}
function priceFormat(raw,currency){
  const format=raw.moduleMap?.priceModule?.data?.priceFormat||(currency==='USD'?{currencyCode:'USD',decimals:2,groupingSeparator:',',decimalSeparator:'.',symbol:'$',position:0}:null);
  required(format&&format.currencyCode===currency&&Number.isInteger(format.decimals)&&format.decimals>=0&&format.decimals<=4&&['.',','].includes(format.decimalSeparator)&&[',','.',' ','\u00a0','\u202f',''].includes(format.groupingSeparator)&&format.groupingSeparator!==format.decimalSeparator&&typeof format.symbol==='string'&&format.symbol.length>0&&format.symbol.length<10&&[0,1].includes(format.position),'原始详情币种或金额格式无法确认，不能转换为USD');
  return format;
}
function sourcePrice(value,format,label,display){
  required(Number.isSafeInteger(value)&&value>=0,`${label}缺失或金额单位无法确认`);
  if(display!==undefined){
    const digits=String(value).padStart(format.decimals+1,'0'),integer=format.decimals?digits.slice(0,-format.decimals):digits;
    const grouped=format.groupingSeparator?integer.replace(/\B(?=(\d{3})+(?!\d))/g,format.groupingSeparator):integer;
    const amount=grouped+(format.decimals?format.decimalSeparator+digits.slice(-format.decimals):'');
    const expected=format.position===0?format.symbol+amount:amount+format.symbol;
    const clean=s=>typeof s==='string'?s.replace(/[\s\u200e\u200f\u061c]/g,''):null;
    required(clean(display)===clean(expected),`${label}金额与${format.currencyCode}显示价格不一致，未猜测金额单位`);
  }
  return value/10**format.decimals;
}

export function normalizePackageDefaults(value){
  if(value===undefined||value===null)return undefined;
  required(typeof value==='object'&&!Array.isArray(value),'统一包裹参数必须包含长、宽、高和重量');
  const result={};
  for(const [key,label]of [['lengthCm','长(cm)'],['widthCm','宽(cm)'],['heightCm','高(cm)'],['weightKg','重量(kg)']]){
    const input=value[key],validType=typeof input==='number'||typeof input==='string'&&/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(input.trim());
    const number=validType?Number(input):NaN;
    required(Number.isFinite(number)&&number>0&&number<=Number.MAX_SAFE_INTEGER,`统一包裹${label}必须是大于0的有效数值，不能用空值或0代替`);
    result[key]=number;
  }
  return result;
}

function sourceCategory(raw){
  const categoryId=value=>{
    if(value===undefined||value===null||value===0||value==='0')return null;
    required((typeof value==='string'||Number.isSafeInteger(value))&&/^[1-9]\d{0,31}$/.test(String(value)),'原始详情分类编号无效或精度无法确认');
    return String(value);
  };
  const categoryPathIds=[1,2,3,4].map(level=>categoryId(raw.goods[`catId${level}`])).filter(Boolean);
  required(raw.crumbOptList===undefined||Array.isArray(raw.crumbOptList),'原始详情分类路径结构变化，请核对');
  // Navigation opt IDs and category IDs are distinct namespaces, even within Temu.
  const breadcrumbs=(raw.crumbOptList||[]).filter(item=>item?.optId!==-100&&item?.optId!=='-100').map(item=>({navigationId:categoryId(item?.optId),name:text(item?.optName,'来源分类名称')}));
  return {platform:'temu',categoryId:categoryId(raw.goods.catId),categoryPathIds,breadcrumbs,namePath:breadcrumbs.map(item=>item.name).join(' > ')};
}

export function normalizeRawProduct(response,goodsId,{packageDefaults:providedPackageDefaults}={}){
  const raw=response?.data?.json;
  required(raw&&typeof raw==='object'&&!Array.isArray(raw),'极鲸云未返回可用原始详情；不会转入 Temu 浏览器采集');
  const responseId=identifier(response.data.goodsId,'响应商品'),detailId=identifier(raw.goods?.goodsId,'详情商品');
  required(responseId===goodsId&&detailId===goodsId,`原始详情商品ID与所选商品不一致：所选 ${goodsId}，响应 ${responseId}，详情 ${detailId}；未导入其他商品`);
  const currency=raw.localInfo?.currency;
  required(typeof currency==='string'&&/^[A-Z]{3}$/.test(currency),'原始详情币种缺失，不能转换为USD');
  const format=priceFormat(raw,currency);
  const title=text(raw.goods.goodsName,'商品标题');
  let sourceUrl;try{sourceUrl=new URL(raw.moduleMap?.shareModule?.data?.share?.linkUrl,'https://www.temu.com/').href;}catch{}
  required(temuGoodsId(sourceUrl)===goodsId,'原始详情没有与商品ID一致的来源链接；不会打开 Temu 补采');
  required(Array.isArray(raw.goods.bannerList)&&raw.goods.bannerList.length,'原始详情缺少主图');
  const images=[...new Set(raw.goods.bannerList.map(i=>media(i.url,'主图')))];
  required(images.length<=50,'主图超过已验证的店小秘50张上限，未截断导入');
  const floors=raw.productDetail?.floorList;
  required(floors===undefined||Array.isArray(floors),'详情图结构变化，请核对');
  const detailImages=(floors||[]).flatMap(f=>{required(Array.isArray(f.items),'详情内容结构变化，请核对');return f.items.map(i=>media(i.url,'详情图'));});
  const properties=raw.goods.goodsProperty;
  required(properties===undefined||Array.isArray(properties),'商品属性结构变化，请核对');
  const description=(properties||[]).map(p=>{required(Array.isArray(p.values)&&p.values.every(v=>typeof v==='string'),'商品属性值结构变化，请核对');return text(p.key,'商品属性名')+'：'+p.values.join('、');}).join('\n');
  const videoUrl=raw.goods.video?.videoUrl?media(raw.goods.video.videoUrl,'视频'):'';
  required(Array.isArray(raw.sku)&&raw.sku.length&&raw.sku.length<=5000,'SKU缺失或超过单文件5000行限制');
  let specNames;
  const skus=raw.sku.map(s=>{
    const id=identifier(s.skuId,'SKU');required(identifier(s.goodsId,'SKU商品')===goodsId,`SKU ${id} 不属于所选商品`);
    required(Array.isArray(s.specs)&&s.specs.length<=2,`SKU ${id} 的规格结构不受当前两组规格模板支持`);
    const specs=s.specs.map(p=>({name:text(p.specKey,'规格名称'),value:text(p.specValue,'规格值')}));
    const names=specs.map(p=>p.name);if(specNames)required(JSON.stringify(names)===JSON.stringify(specNames),'SKU规格名称或顺序不一致，未压缩或丢弃规格');else specNames=names;
    required(typeof s.normalPriceStr==='string',`SKU ${id} 缺少显示价格，未猜测金额单位`);
    const price=sourcePrice(s.normalPrice,format,`SKU ${id} 价格`,s.normalPriceStr),salePrice=sourcePrice(s.salePrice,format,`SKU ${id} 促销价`,Array.isArray(s.salePriceRich)?s.salePriceRich.map(p=>p.text).join(''):undefined);
    required(Number.isSafeInteger(s.stockQuantity)&&s.stockQuantity>=0,`SKU ${id} 缺少可信库存；不会使用购买限额替代`);
    return {id,specs,price,salePrice,priceMinor:s.normalPrice,salePriceMinor:s.salePrice,priceDecimals:format.decimals,stock:s.stockQuantity,image:s.thumbUrl?media(s.thumbUrl,'SKU图片'):''};
  });
  required(new Set(skus.map(s=>s.id)).size===skus.length,'SKU编号重复');
  const packageDefaults=normalizePackageDefaults(providedPackageDefaults),category=sourceCategory(raw);
  const snapshotTime=Number.isFinite(raw.serverTime)&&raw.serverTime>0?new Date(raw.serverTime*1000).toISOString():null;
  const warnings=['价格与库存来自极鲸云历史快照，不代表实时值。',packageDefaults?'包裹尺寸和重量使用已配置的统一默认值，非商品原始实测值。说明书未提供。':'包裹尺寸、重量和说明书缺失，留空；店小秘显示的默认0不代表真实值。'];
  if(!snapshotTime)warnings.push('供应商未提供可确认的原始快照时间。');
  if(!detailImages.length)warnings.push('原始详情未提供详情图。');
  if(skus.some(s=>!s.image))warnings.push('部分SKU未提供变种图。');
  return {goodsId,title,sourceUrl,currency,images,detailImages,description,videoUrl,skus,sourceCategory:category,...(packageDefaults?{packageDefaults}:{}),snapshotTime,receivedAt:response.receivedAt,warnings};
}

export function validateImportTemplate(buffer){
  const book=XLSX.read(buffer,{type:'buffer'}),headers=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1})[0];
  required(JSON.stringify(headers)===JSON.stringify(DXM_HEADERS),'店小秘官方导入模板字段已变化，未上传，请更新字段映射');
}

export function writeProductWorkbook(product,file){
  required(product.currency==='USD','导入文件价格必须先转换为USD');
  const packageDefaults=normalizePackageDefaults(product.packageDefaults);
  const dimensions=packageDefaults?[packageDefaults.lengthCm,packageDefaults.widthCm,packageDefaults.heightCm,packageDefaults.weightKg]:['','','',''];
  const rows=product.skus.map((s,i)=>[product.goodsId,i?'':product.title,i?'':product.sourceUrl,i?'':product.images.join('\n'),i?'':product.videoUrl,i?'':product.description,i?'':product.detailImages.join('\n'),'',s.id,s.specs[0]?.name||'',s.specs[0]?.value||'',s.specs[1]?.name||'',s.specs[1]?.value||'',s.price,s.salePrice,s.stock,...dimensions,s.image]);
  required(rows.every(row=>row.every(v=>typeof v!=='string'||v.length<=32767)),'单元格内容超出Excel限制，未截断导入');
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([DXM_HEADERS,...rows]),'importProductLinks');
  const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
  required(buffer.length<=10*1024*1024,'导入文件超过10MB，未上传');
  const readBack=XLSX.read(buffer,{type:'buffer',cellFormula:true}),sheet=readBack.Sheets[readBack.SheetNames[0]];
  required(JSON.stringify(XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true}))===JSON.stringify([DXM_HEADERS,...rows]),'导入表格回读不一致');
  required(Object.entries(sheet).every(([key,cell])=>key.startsWith('!')||!cell.f),'导入表格不得包含公式');
  fs.writeFileSync(file,buffer);
  return {sha256:crypto.createHash('sha256').update(buffer).digest('hex'),bytes:buffer.length,skuCount:product.skus.length,mainImageCount:product.images.length,detailImageCount:product.detailImages.length};
}
