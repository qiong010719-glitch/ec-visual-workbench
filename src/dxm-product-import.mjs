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
const cents=(value,label)=>{required(Number.isSafeInteger(value)&&value>=0,`${label}缺失或金额单位无法确认`);return value/100;};

export function normalizeRawProduct(response,goodsId){
  const raw=response?.data?.json;
  required(raw&&typeof raw==='object'&&!Array.isArray(raw),'极鲸云未返回可用原始详情；不会转入 Temu 浏览器采集');
  const responseId=identifier(response.data.goodsId,'响应商品'),detailId=identifier(raw.goods?.goodsId,'详情商品');
  required(responseId===goodsId&&detailId===goodsId,`原始详情商品ID与所选商品不一致：所选 ${goodsId}，响应 ${responseId}，详情 ${detailId}；未导入其他商品`);
  required(raw.localInfo?.currency==='USD',`原始详情币种为 ${raw.localInfo?.currency||'未知'}，当前官方模板要求 USD；已停止，未自动换汇`);
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
    const price=cents(s.normalPrice,`SKU ${id} 价格`),salePrice=cents(s.salePrice,`SKU ${id} 促销价`);
    required(typeof s.normalPriceStr==='string'&&s.normalPriceStr.replaceAll(',','')==='$'+price.toFixed(2),`SKU ${id} 金额与美元显示价格不一致`);
    required(Number.isSafeInteger(s.stockQuantity)&&s.stockQuantity>=0,`SKU ${id} 缺少可信库存；不会使用购买限额替代`);
    return {id,specs,price,salePrice,stock:s.stockQuantity,image:s.thumbUrl?media(s.thumbUrl,'SKU图片'):''};
  });
  required(new Set(skus.map(s=>s.id)).size===skus.length,'SKU编号重复');
  const snapshotTime=Number.isFinite(raw.serverTime)&&raw.serverTime>0?new Date(raw.serverTime*1000).toISOString():null;
  const warnings=['价格与库存来自极鲸云历史快照，不代表实时值。','包裹尺寸、重量和说明书缺失，留空；店小秘显示的默认0不代表真实值。'];
  if(!snapshotTime)warnings.push('供应商未提供可确认的原始快照时间。');
  if(!detailImages.length)warnings.push('原始详情未提供详情图。');
  if(skus.some(s=>!s.image))warnings.push('部分SKU未提供变种图。');
  return {goodsId,title,sourceUrl,currency:'USD',images,detailImages,description,videoUrl,skus,snapshotTime,receivedAt:response.receivedAt,warnings};
}

export function validateImportTemplate(buffer){
  const book=XLSX.read(buffer,{type:'buffer'}),headers=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1})[0];
  required(JSON.stringify(headers)===JSON.stringify(DXM_HEADERS),'店小秘官方导入模板字段已变化，未上传，请更新字段映射');
}

export function writeProductWorkbook(product,file){
  const rows=product.skus.map((s,i)=>[product.goodsId,i?'':product.title,i?'':product.sourceUrl,i?'':product.images.join('\n'),i?'':product.videoUrl,i?'':product.description,i?'':product.detailImages.join('\n'),'',s.id,s.specs[0]?.name||'',s.specs[0]?.value||'',s.specs[1]?.name||'',s.specs[1]?.value||'',s.price,s.salePrice,s.stock,'','','','',s.image]);
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
