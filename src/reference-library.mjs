import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {imageType, downloadImage} from './provider.mjs';
import {visualStyleId,productCategory,visualTraits,crossCategoryGuidance} from './visual-style.mjs';

export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const text = (value, maximum = 2000) => typeof value === 'string' ? value.trim().slice(0,maximum) : '';
// Some imported US titles have only a broad Chinese category. Match these
// specific Chinese product types against the title, without mixing accessories.
const retrievalTypes = [
  {query:/(?:车载|汽车).*(?:手机架|支架)/i, matches:title=>/(?:车载|汽车).*(?:手机架|支架)|(?:car|truck).{0,40}(?:phone|cell phone).{0,20}(?:holder|mount)|(?:cell )?phone (?:holder|mount).{0,80}(?:dashboard|windshield|car|truck)/i.test(title)},
  {query:/手机.*(?:钢化|保护膜|贴膜)|(?=.*(?:iphone|phone|galaxy|pixel))(?=.*(?:screen protector|tempered glass))/i, matches:title=>/手机.*(?:钢化|保护膜|贴膜)|(?=.*(?:iphone|phone|galaxy|pixel))(?=.*(?:screen protector|tempered glass))/i.test(title)&&!/\bcase\b(?![- ]friendly)/i.test(title)}
];
// A broad family or a word such as "portable" does not establish the same
// product type. Unknown types still supply style observations, conservatively.
const productKinds=[
  ['power_bank',/充电宝|移动电源|power bank|portable charger|battery pack/i],
  ['cable',/充电线|数据线|usb.{0,10}cable|charging cable/i],
  ['earphones',/耳机|headphone|earbud|headset/i],
  ['speaker',/音箱|扬声器|speaker/i],
  ['phone_mount',/手机.*支架|phone.{0,25}(?:holder|mount)/i],
  ['screen_protector',/保护膜|钢化膜|screen protector|tempered glass/i],
  ['phone_case',/手机壳|(?:iphone|phone|galaxy).{0,20}\bcase\b/i],
  ['accessory_case',/收纳包|保护套|\bcase\b(?![- ]friendly)|\bcover\b/i],
  ['accessory_stand',/\bstand\b/i],
  ['drill',/电钻|钻机|drill|impact driver/i],
  ['blender',/搅拌机|料理机|榨汁|blender/i],
  ['coffee_maker',/咖啡机|coffee maker|keurig/i],
  ['cleaner',/吸尘|清洁机|vacuum|carpet cleaner|spot cleaner/i],
  ['charger',/充电器|充电头|charger|charging (?:station|pad)/i],
  ['pet_nutrition',/(?:宠物|犬|狗|猫).*(?:营养|保健|益生菌)|(?=.*(?:pet |dog|cat ))(?=.*(?:nutrition|supplement|probiotic|chew))/i],
  ['cat_food',/猫粮|猫罐头|\bcat food\b/i],
  ['skincare',/护肤|精华|乳液|面霜|serum|moisturiz/i],
  ['body_lotion',/身体乳|润肤乳|\bbody lotion\b/i],
  ['body_wash',/沐浴露|沐浴乳|\bbody wash\b/i],
  ['bed_sheets',/^(?!.*(?:organizer|storage|收纳)).*(?:床单|床品四件套|床上四件套|\bsheet set\b|\bbed sheets?\b)/i],
  ['diapers',/^(?!.*(?:diaper.{0,12}(?:bag|pail|caddy|organizer|backpack)|纸尿裤收纳)).*(?:纸尿裤|尿不湿|\bdiapers?\b)/i],
  ['pet_diapers',/(?:宠物|犬|狗|猫).*(?:尿裤|尿布|尿不湿)|(?=.*\b(?:pet|dog|cat|puppy|canine|feline)s?\b)(?=.*\bdiapers?\b)/i],
  ['filter_straw',/净水吸管|滤水吸管|过滤吸管|\b(?:personal water filter|water filter straws?)\b/i],
  ['flameless_candle',/电子蜡烛|仿真蜡烛|无火蜡烛|\bflameless candles?\b|\b(?:electric|led) tea lights?\b/i],
  ['squishy_toy',/捏捏玩具|\bsquishy toys?\b|\bsquishies\b|\bsensory squeeze toy\b/i],
  ['pillow',/枕|pillow/i],['blanket',/被子|毯|blanket|comforter/i],
  ['bottle',/水杯|水壶|tumbler|water bottle/i],['tent',/帐篷|\btent\b/i],
  ['supplement',/维生素|营养补充|vitamin|supplement|gummies|gummy/i]
];
const productKind=value=>{
  const hits=productKinds.filter(([,pattern])=>pattern.test(value)).map(([id])=>id);
  // "Portable charger" is itself a power-bank synonym. Other multiple nouns
  // may describe a kit, an accessory or a compatible device; don't guess.
  const lotionOnly=hits.includes('body_lotion')&&!/面霜|精华|face cream|serum/i.test(value);
  // "Cradle stand" and "phone stand" may name the mount itself. A separate
  // stand (e.g. a headphone stand) still makes the title ambiguous.
  const phoneStandOnly=hits.includes('phone_mount')&&!/\bstand\b/i.test(value.replace(/\b(?:cradle|(?:cell\s+)?phone)\s+stand\b/gi,''));
  const kinds=hits.filter(id=>!(id==='charger'&&hits.includes('power_bank')&&!productKinds.find(([key])=>key==='charger')[1].test(value.replace(/portable charger/gi,'')))&&!(id==='accessory_case'&&hits.includes('phone_case'))&&!(id==='skincare'&&lotionOnly)&&!(id==='accessory_stand'&&phoneStandOnly)&&!(id==='diapers'&&hits.includes('pet_diapers')));
  return kinds.length===1?kinds[0]:kinds.length?'ambiguous':undefined;
};
export const MARKETPLACES = ['amazon.com','amazon.com.mx','amazon.ca','amazon.co.uk','amazon.de','amazon.fr','amazon.it','amazon.es','amazon.co.jp','amazon.com.au','amazon.in'];
export function amazonUrl(value) {
  const url = new URL(value);
  const marketplace = url.hostname.replace(/^www\./,'');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !MARKETPLACES.includes(marketplace)) throw new Error('需要支持站点的 Amazon HTTPS 链接');
  url.search = ''; url.hash = '';
  return {url:url.href, marketplace};
}
export function asinFrom(value) {return text(value).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase() || null;}
export function categoryIdFrom(value) {try{return new URL(value).pathname.match(/\/(\d+)(?:\/|$)/)?.[1]||null;}catch{return null;}}
export function categoryKeyFrom(value) {
  try {
    const address=amazonUrl(value),pathname=new URL(address.url).pathname.replace(/\/ref[=/].*$/,'').replace(/\/$/,'');
    const parts=pathname.match(/\/(?:gp\/bestsellers|zgbs)\/([a-z0-9-]+)(?:\/(\d+))?$/i);
    return parts?(parts[2]||'department:'+parts[1].toLowerCase()):null;
  } catch {return null;}
}
export function resolveBrand(row) {
  const direct=text(row.brand,160);
  if(direct)return {brand:direct,brandEvidence:{field:'brand',value:direct}};
  const fields=['attributes','productOverview','manufacturerAttributes'].flatMap(source=>(Array.isArray(row[source])?row[source]:[])
    .filter(item=>/^brand(?: name)?$/i.test(text(item.key,80))&&text(item.value,160))
    .map(item=>({field:source+'.'+item.key,value:text(item.value,160)})));
  const distinct=new Set(fields.map(item=>item.value.normalize('NFKC').toLowerCase()));
  return distinct.size===1?{brand:fields[0].value,brandEvidence:fields[0]}:{brand:'',brandEvidence:null,brandConflict:distinct.size>1};
}
function imageUrls(value, depth = 0) {
  if (depth > 10 || value == null) return [];
  if (typeof value === 'string') {
    if (/^https:\/\//.test(value) && !value.includes('<')) return [value];
    // Some Actors return A+ HTML; only take explicit image attributes, never arbitrary links.
    return [...value.matchAll(/<img\b[^>]*\b(?:src|data-src)=["'](https:\/\/[^"']+)["']/gi)].map(m => m[1].replaceAll('&amp;','&'));
  }
  if (Array.isArray(value)) return value.flatMap(v => imageUrls(v,depth+1));
  if (typeof value === 'object') return Object.entries(value).flatMap(([k,v]) => /image|photo|src|url|module|content|items|background/i.test(k) ? imageUrls(v,depth+1) : []);
  return [];
}
function safeImageUrl(value) {
  try {const u = new URL(value);if(MARKETPLACES.includes(u.hostname.replace(/^www\./,''))&&!/\.(?:png|jpe?g|webp)$/i.test(u.pathname))return null;return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u.href : null;} catch {return null;}
}
export function normalizeProduct(row, context = {}) {
  const resolvedBrand=resolveBrand(row);
  const address = amazonUrl(row.url || row.productUrl || context.productUrl);
  const asin = asinFrom(address.url) || (/^[A-Z0-9]{10}$/i.test(row.asin || '') ? row.asin.toUpperCase() : null);
  if (!asin) throw new Error('商品缺少有效 ASIN');
  const gallery = [...new Set(imageUrls(row.highResolutionImages?.length ? row.highResolutionImages : row.images?.length ? row.images : row.galleryImages))];
  const main = safeImageUrl(row.mainImage || row.main_image || gallery[0] || row.thumbnailImage || row.thumbnailUrl || row.thumbnail);
  const aplusFields = ['aPlusImages','aplus_images','aPlusMainImages','aplusImages','aPlusContent'];
  const aplus = [...new Set(aplusFields.flatMap(k=>imageUrls(row[k])))];
  const brandStory=[...new Set(imageUrls(row.brandStory))];
  const assets = [], seen = new Map();
  const add = (url,role) => {url=safeImageUrl(url);if(!url)return;const previous=seen.get(url);if(previous){if(role!=='gallery'&&!previous.roles.includes(role))previous.roles.push(role);return;}const asset={id:hash(url).slice(0,24),sourceUrl:url,role,roles:[role],position:assets.length,status:'pending'};seen.set(url,asset);assets.push(asset);};
  if(main)add(main,'main'); gallery.forEach(u=>add(u,'gallery')); aplus.forEach(u=>add(u,'aplus'));
  brandStory.forEach(u=>add(u,'brand_story'));
  const warnings=[];
  if(resolvedBrand.brandConflict)warnings.push('品牌字段冲突，保留为待核实，不按标题推测');
  if(!assets.length)warnings.push('未取得商品图片');
  if(!aplus.length)warnings.push('未取得 A+ 图片，是否存在 A+ 尚未确认');
  if(assets.length>200)warnings.push('图片超过 200 张，本次保留前 200 张，其余待补采');
  const rank = Number(row.position ?? row.rank ?? row.bestsellerPageData?.position);
  const categoryUrl = row.categoryUrl || row.bestsellerPageData?.categoryUrl || context.categoryUrl || null;
  return {
    id:hash(address.marketplace+':'+asin).slice(0,24),asin,marketplace:address.marketplace,url:`https://www.${address.marketplace}/dp/${asin}`,
    title:text(row.title || row.name || row.productTitle,500),brand:resolvedBrand.brand,brandEvidence:resolvedBrand.brandEvidence,parentAsin:text(row.parentAsin || row.parent_asin,20) || null,
    variantAsins:Array.isArray(row.variantAsins)?[...new Set(row.variantAsins.filter(a=>typeof a==='string'&&/^[A-Z0-9]{10}$/i.test(a)).map(a=>a.toUpperCase()))]:[],
    category:text(row.categoryName || row.category || row.breadCrumbs || context.category,500),categoryUrl,
    rank:Number.isInteger(rank)&&rank>0 ? rank : null,rankBasis:context.rankBasis || 'unverified',
    assets:assets.slice(0,200),aplusStatus:aplus.length?'found':'not_observed',warnings,
    provenance:{source:context.source || 'import',actor:context.actor || null,runId:context.runId || null,datasetId:context.datasetId || null,capturedAt:context.capturedAt || now()},
    styleProfileIds:Array.isArray(row.styleProfileIds)?row.styleProfileIds.filter(id=>id==='scene_advertising'):[],
    collectionIds:Array.isArray(row.collectionIds)?[...new Set(row.collectionIds.filter(id=>typeof id==='string'&&/^[a-z0-9_-]{1,100}$/i.test(id)))]:[],
    analysis:null,createdAt:now(),updatedAt:now()
  };
}

// Rank brands only within the same observed category snapshot. This is a sampling rule, not an official brand leaderboard.
export function selectBrands(products, {brands = 5, perBrand = 5} = {}) {
  const grouped = new Map(),excluded=[];
  const parents=new Map();
  const familyOf=id=>{if(!parents.has(id))parents.set(id,id);if(parents.get(id)!==id)parents.set(id,familyOf(parents.get(id)));return parents.get(id);};
  for(const p of products) {
    const namespace=p.brand?.normalize('NFKC').trim().toLowerCase()+':';
    const members=[p.asin,p.parentAsin,...(p.variantAsins || [])].filter(Boolean).map(a=>namespace+a);
    if(members.length)for(const member of members)parents.set(familyOf(member),familyOf(members[0]));
  }
  for(const product of [...products].sort((a,b)=>(a.rank || Infinity)-(b.rank || Infinity))) {
    if(!product.brand || !product.rank || !['bestsellers_list','category_bsr'].includes(product.rankBasis)) {excluded.push({id:product.id,reason:!product.brand?'品牌缺失':'缺少榜单排名证据'});continue;}
    const key=product.brand.normalize('NFKC').trim().toLowerCase();
    if(!grouped.has(key))grouped.set(key,{brand:product.brand,score:0,products:[],families:new Set()});
    const group=grouped.get(key),family=familyOf(key+':'+product.asin);
    if(group.families.has(family))continue;
    group.families.add(family);group.products.push(product);group.score+=1/product.rank;
  }
  const selected=[...grouped.values()].sort((a,b)=>b.score-a.score || a.products[0].rank-b.products[0].rank || a.brand.localeCompare(b.brand)).slice(0,brands);
  return {
    method:'category_snapshot_sum_reciprocal_rank',label:'当前类目榜单样本中的领先品牌（推算）',
    brands:selected.map(g=>({brand:g.brand,score:g.score,observedProducts:g.products.length,products:g.products.slice(0,perBrand).map(p=>p.id),missing:Math.max(0,perBrand-g.products.length)})),
    missingBrands:Math.max(0,brands-selected.length),excluded
  };
}

export class ReferenceLibrary {
  constructor(directory,mediaDirectory,{download=downloadImage}={}) {
    this.directory=directory;this.mediaDirectory=mediaDirectory;this.download=download;fs.mkdirSync(directory,{recursive:true});
    fs.mkdirSync(mediaDirectory,{recursive:true});
    this.file=path.join(directory,'references.json');
    this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,products:{},campaigns:{}};
    this.loadCuratedStyleCollection();
  }
  loadCuratedStyleCollection() {
    const file=path.join(this.directory,'curated-style-collection.json');if(!fs.existsSync(file))return;
    if(fs.statSync(file).size>20*1024*1024)throw new Error('风格参考集校验失败：文件过大');
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    const validId=id=>typeof id==='string'&&/^[a-z0-9_-]{1,100}$/i.test(id);
    if(value.version!==1||!validId(value.collection?.id)||!Array.isArray(value.products)||value.products.length>100)throw new Error('风格参考集校验失败：结构不完整');
    for(const product of value.products){
      if(!validId(product.id)||!product.collectionIds?.includes(value.collection.id)||!product.styleProfileIds?.includes('scene_advertising')||product.analysis?.status!=='completed'||!Array.isArray(product.assets)||!product.assets.length||!Array.isArray(product.analysis.images)||product.analysis.images.length!==product.assets.length||new Set(product.assets.map(a=>a.id)).size!==product.assets.length||new Set(product.analysis.images.map(a=>a.id)).size!==product.assets.length)throw new Error('风格参考集校验失败：分析未完整覆盖');
      for(const asset of product.assets){
        const finding=product.analysis.images.find(i=>i.id===asset.id);
        if(asset.status!=='downloaded'||!/^\/media\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(asset.localUrl || '')||!finding||finding.sha256!==asset.sha256||['layout','camera','lighting','palette','textDensity','transferableGuidance'].some(field=>typeof finding[field]!=='string'||!finding[field].trim()))throw new Error('风格参考集校验失败：图片与分析不一致');
        const imageFile=path.join(this.mediaDirectory,path.basename(asset.localUrl));
        if(!fs.existsSync(imageFile)||hash(fs.readFileSync(imageFile))!==asset.sha256)throw new Error('风格参考集校验失败：图片文件已变化');
      }
      const prior=this.state.products[product.id];
      if(prior&&JSON.stringify(prior.assets.map(a=>a.sha256))!==JSON.stringify(product.assets.map(a=>a.sha256)))throw new Error('风格参考集校验失败：现有同编号资料不同');
    }
    // Validate the complete collection before changing memory. Existing records win.
    for(const product of value.products){
      this.state.products[product.id] ??= product;
      this.state.imageAnalyses ||= {};
      for(const finding of product.analysis.images)this.state.imageAnalyses[finding.sha256] ??= {...finding,model:product.analysis.model,method:product.analysis.method,analyzedAt:product.analysis.analyzedAt};
    }
    this.state.styleCollections={...this.state.styleCollections,[value.collection.id]:value.collection};
    this.state.styleLearningUsage={...this.state.styleLearningUsage,[value.collection.id]:value.analysisUsage || {}};
  }
  save() {fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.state,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  upsert(product) {
    const prior=this.state.products[product.id];
    if(prior) {
      product.createdAt=prior.createdAt;
      for(const field of ['styleProfileIds','collectionIds'])product[field]=[...new Set([...(prior[field] || []),...(product[field] || [])])];
      if(prior.categoryMemberships?.length||product.categoryMemberships?.length)product.categoryMemberships=[...new Map([...(prior.categoryMemberships||[]),...(product.categoryMemberships||[])].map(c=>[c.id,c])).values()];
      product.assets=product.assets.map(asset=>{
        const previous=prior.assets.find(a=>a.id===asset.id);
        if(!previous)return asset;
        const merged={...previous,...asset};
        // A new source snapshot can lack local download metadata. A successful refresh must win.
        if(asset.status!=='downloaded' && previous.status==='downloaded' && previous.sourceUrl===asset.sourceUrl) {
          for(const key of ['status','localUrl','sha256','mime','bytes','sourceHashMatches'])if(previous[key]!==undefined)merged[key]=previous[key];
        }
        if(merged.status==='downloaded')delete merged.error;
        return merged;
      });
      const signature=assets=>assets.map(a=>[a.id,a.sha256 || '',a.role,(a.roles || []).join(',')].join(':')).join('|');
      if(signature(product.assets)===signature(prior.assets))product.analysis=prior.analysis;
    }
    this.state.products[product.id]=product;this.save();return product;
  }
  importRows(rows,context={}) {
    if(!Array.isArray(rows) || rows.length>5000)throw new Error('导入需要最多 5000 条商品记录的数组');
    const imported=[],rejected=[];
    rows.forEach((row,index)=>{try {imported.push(this.upsert(normalizeProduct(row,context)).id);}catch(error){rejected.push({index,error:error.message});}});
    return {imported:[...new Set(imported)],rejected};
  }
  importFolder({folder,title,category='',brand='',marketplace='local'}) {
    if(!path.isAbsolute(folder || '') || !fs.statSync(folder,{throwIfNoEntry:false})?.isDirectory())throw new Error('请填写存在的图片文件夹绝对路径');
    const root=fs.realpathSync(folder),assets=[];let scanned=0;
    const visit=(directory,depth=0)=>{
      if(depth>5)throw new Error('文件夹层级超过 5 层，请选择单个商品目录');
      for(const e of fs.readdirSync(directory,{withFileTypes:true})) {
        if(++scanned>1000)throw new Error('目录包含过多文件，请选择单个商品目录');
        if(e.isSymbolicLink())continue;
        const file=path.join(directory,e.name);
        if(e.isDirectory()){visit(file,depth+1);continue;}
        if(!/\.(png|jpe?g|webp)$/i.test(e.name))continue;
        if(assets.length>=60)throw new Error('单个商品最多导入 60 张图片，请拆分商品目录');
        if(fs.statSync(file).size>25*1024*1024)throw new Error(`图片超过 25 MB：${e.name}`);
        const bytes=fs.readFileSync(file),[mime,ext]=imageType(bytes),sha=hash(bytes),local='/media/'+sha+ext;
        const destination=path.join(this.mediaDirectory,sha+ext);if(!fs.existsSync(destination))fs.writeFileSync(destination,bytes);
        const relative=path.relative(root,file);
        const role=/a\+|aplus|详情/i.test(relative)?'aplus':/主图|main|hero/i.test(relative)?'main':'gallery';
        assets.push({id:hash(relative).slice(0,24),filename:relative,role,position:assets.length,status:'downloaded',localUrl:local,sha256:sha,mime,bytes:bytes.length});
      }
    };
    visit(root);if(!assets.length)throw new Error('文件夹中没有 PNG、JPEG 或 WebP 图片');
    return this.upsert({id:hash('folder:'+root).slice(0,24),title:text(title || path.basename(root),500),category:text(category,500),brand:text(brand,160),marketplace,asin:null,url:null,categoryUrl:null,rank:null,rankBasis:'user_provided',assets,aplusStatus:assets.some(a=>a.role==='aplus')?'found':'not_observed',warnings:['图片角色由文件名和目录名推断，视觉分析时再次识别'],analysis:null,provenance:{source:'user_folder',folder:root,capturedAt:now()},createdAt:now(),updatedAt:now()});
  }
  async downloadProduct(id) {
    const product=this.state.products[id];if(!product)throw new Error('参考商品不存在');
    this.downloadedSources ||= new Map(Object.values(this.state.products).flatMap(p=>p.assets).filter(a=>a.sourceUrl&&a.status==='downloaded').map(a=>[a.sourceUrl,{status:'downloaded',localUrl:a.localUrl,sha256:a.sha256,mime:a.mime,bytes:a.bytes}]));
    this.downloadPromises ||= new Map();let cursor=0;
    const worker=async()=>{while(cursor<product.assets.length) {
      const asset=product.assets[cursor++];
      if(asset.status==='downloaded' && asset.localUrl && fs.existsSync(path.join(this.mediaDirectory,path.basename(asset.localUrl))))continue;
      try {
        let cached=this.downloadedSources.get(asset.sourceUrl);
        if(cached && !fs.existsSync(path.join(this.mediaDirectory,path.basename(cached.localUrl))))cached=null;
        if(!cached) {
          if(!this.downloadPromises.has(asset.sourceUrl))this.downloadPromises.set(asset.sourceUrl,(async()=>{
            const bytes=await this.download(asset.sourceUrl),[mime,ext]=imageType(bytes),sha=hash(bytes);
            const name=sha+ext,file=path.join(this.mediaDirectory,name);if(!fs.existsSync(file))fs.writeFileSync(file,bytes);
            const result={status:'downloaded',localUrl:'/media/'+name,sha256:sha,mime,bytes:bytes.length};this.downloadedSources.set(asset.sourceUrl,result);return result;
          })());
          try{cached=await this.downloadPromises.get(asset.sourceUrl);}finally{this.downloadPromises.delete(asset.sourceUrl);}
        }
        Object.assign(asset,cached);delete asset.error;
      } catch(error) {asset.status='failed';asset.error=String(error.message).slice(0,250);}
      this.save();
    }};
    await Promise.all(Array.from({length:4},()=>worker()));
    product.updatedAt=now();this.save();return product;
  }
  stats() {
    const products=Object.values(this.state.products),assets=products.flatMap(p=>p.assets);
    return {products:products.length,images:assets.length,uniqueImages:new Set(assets.map(a=>a.sha256 || a.sourceUrl || a.id)).size,downloaded:assets.filter(a=>a.status==='downloaded').length,downloadedUnique:new Set(assets.filter(a=>a.status==='downloaded').map(a=>a.sha256)).size,analyzedUnique:Object.keys(this.state.imageAnalyses || {}).length,analyzed:products.filter(p=>p.analysis?.status==='completed').length,partialAnalysis:products.filter(p=>p.analysis?.status==='partial').length,aplusProducts:products.filter(p=>p.aplusStatus==='found').length};
  }
  styleCollections() {
    return Object.values(this.state.styleCollections || {}).map(collection=>{
      const products=Object.values(this.state.products).filter(p=>p.collectionIds?.includes(collection.id));
      const completed=products.filter(p=>p.analysis?.status==='completed');
      return {...collection,products:products.length,analyzedProducts:completed.length,images:products.reduce((n,p)=>n+p.assets.length,0),analyzedImages:new Set(completed.flatMap(p=>p.analysis.images.map(a=>a.sha256 || a.id))).size,categories:[...new Set(products.map(p=>p.category).filter(Boolean))]};
    });
  }
  retrieve(payload,limit=3) {
    const query=[payload.product_name,payload.product_desc,payload.reference_category].filter(Boolean).join(' ').toLowerCase();
    const terms=[...new Set(query.match(/[a-z0-9]{3,}|[\p{Script=Han}]{2,}/gu)||[])];
    const chosen=Array.isArray(payload.reference_ids)?payload.reference_ids:[];
    const queryType=retrievalTypes.find(type=>type.query.test([payload.product_name,payload.reference_category].filter(Boolean).join(' ')));
    const styleId=visualStyleId(payload),family=productCategory(payload),kind=productKind([payload.product_name,payload.reference_category].filter(Boolean).join(' '));
    const candidates=Object.values(this.state.products).filter(p=>p.analysis?.status==='completed' && (!chosen.length || chosen.includes(p.id))).map(p=>{
      const memberships=(p.categoryMemberships||[]).flatMap(c=>[c.label,c.name]).filter(Boolean);
      const searchable=[p.title,p.category,...memberships,...(p.analysis.tags||[])].join(' ').toLowerCase();
      const explicit=chosen.includes(p.id);
      const keywords=[...(p.category || '').split('/'),...memberships,...(p.analysis.tags||[])].map(s=>s.trim().toLowerCase()).filter(s=>s.length>=2);
      const referenceFamily=productCategory({product_name:p.title,reference_category:[p.category,...memberships,...(p.analysis.tags||[])].join(' ')});
      // Department labels and design tags describe context, not product identity.
      const referenceKind=productKind(p.title || ''),categoryMatch=family!=='general'&&family===referenceFamily;
      const lexical=terms.reduce((s,t)=>s+(searchable.includes(t)?1:0),0)+keywords.filter(k=>query.includes(k)).length;
      const matches=kind!=='ambiguous'&&referenceKind!=='ambiguous'&&(queryType?queryType.matches(p.title || ''):!!kind&&kind===referenceKind);
      const mismatch=(kind&&referenceKind&&kind!==referenceKind)||(family!=='general'&&referenceFamily!=='general'&&family!==referenceFamily);
      const relevant=queryType?matches:!mismatch&&(categoryMatch||lexical>0);
      const styleMatch=styleId==='scene_advertising'&&p.styleProfileIds?.includes(styleId);
      const score=explicit?1000:matches?100+lexical+(styleMatch?5:0):relevant?20+lexical+(styleMatch?5:0):styleMatch?1:0;
      return {p,score,matchType:matches?'category':'style-only'};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || (chosen.length?chosen.indexOf(a.p.id)-chosen.indexOf(b.p.id):0));
    const diverse=[],brands=new Set();
    if(!chosen.length)for(const item of candidates) {
      const brand=(item.p.brand || item.p.id).toLowerCase();
      if(item.score<candidates[0].score-1 || brands.has(brand))continue;
      diverse.push(item);brands.add(brand);if(diverse.length>=limit)break;
    }
    const selected=[...diverse,...candidates.filter(c=>!diverse.includes(c))].slice(0,limit);
    return selected.map(({p,matchType})=>({id:p.id,title:p.title,sourceUrl:p.url,category:p.category,matchType,styleProfileIds:p.styleProfileIds || [],analyzedAt:p.analysis.analyzedAt,images:p.analysis.images.map(a=>{
      const common={id:a.id,role:a.role,roles:a.roles || p.assets.find(x=>x.id===a.id)?.roles || [a.role],visualTraits:(a.visualTraits || []).filter(t=>visualTraits.includes(t))};
      return matchType==='style-only'?{...common,purpose:'跨类目通用风格',layout:crossCategoryGuidance(a),camera:'按当前商品用途设计镜头',lighting:'统一真实光源与接触阴影',palette:'从当前产品提取主色',textDensity:'由当前设计模式决定',transferableGuidance:crossCategoryGuidance(a)}:{...common,purpose:a.purpose,layout:a.layout,camera:a.camera,lighting:a.lighting,palette:a.palette,textDensity:a.textDensity,transferableGuidance:a.transferableGuidance};
    })}));
  }
}
