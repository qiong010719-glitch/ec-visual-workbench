import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {normalizePackageDefaults} from './dxm-product-import.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const TIKTOK_POSTER_PATH=Object.freeze(['日用雑貨(家居用品)','室内装飾(装饰)','ポスター・プリント(印刷制品)']);
const fail=message=>{throw new Error(message);};
const positive=value=>value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>0;
const itemValues=item=>[...(item?.selections||[]),...(item?.checked||[]),...(item?.controls||[]).filter(c=>!c.disabled&&!c.searchOnly).map(c=>c.value)].filter(x=>String(x??'').trim());

export function tiktokSourceFacts(product){
  const properties=Object.fromEntries(String(product?.description||'').split('\n').map(line=>{const match=line.match(/^([^：:]+)[：:]\s*(.*)$/);return match?[match[1].trim(),match[2].trim()]:[];}).filter(x=>x.length===2));
  const source=product?.sourceCategory||{},names=source.breadcrumbs?.map(x=>x.name)||[],issues=[];
  const poster=source.platform==='temu'&&String(source.categoryId)==='12869'&&names.includes('Wall Art')
    &&properties['Artwork Surface Material']==='Canvas'&&['Wrapped Canvas','Framed'].includes(properties['Frame Type'])
    &&/\b(?:poster|print(?:ed|s)?)\b/i.test(product.title||'')
    &&!/(?:hand[- ]painted|original oil painting|sculpture|手绘原作|雕塑)/i.test(product.title||'');
  if(!poster)issues.push('商品来源分类和属性尚未匹配已验证的TikTok印刷制品分类');
  const origin=/\bChina\b|中国/.test(properties.Origin||'')?'中国':null;
  if(!origin)issues.push('TikTok必填原产地缺少可确认的来源值');
  const material=properties['Artwork Surface Material']==='Canvas'?'帆布(キャンバス)':null;
  if(!material)issues.push('TikTok必填材质缺少已验证的来源映射');
  return {categoryPath:poster?[...TIKTOK_POSTER_PATH]:[],origin,material,issues,sourceEvidence:{categoryId:source.categoryId||null,origin:properties.Origin||null,surfaceMaterial:properties['Artwork Surface Material']||null,frameType:properties['Frame Type']||null}};
}

// Every value comes from the rendered form or the same-origin editor document.
export function readTiktokListing(expected){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',clean=s=>(s||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  if(location.href!==expected.url||location.origin!=='https://www.dianxiaomi.com'||location.pathname!=='/web/tiktokProduct/edit')throw new Error('TikTok商品编辑页已变化');
  const account=document.querySelector('.btn-user .user-name')?.textContent.trim();
  if(!expected.account||account!==expected.account)throw new Error('TikTok商品所在店小秘账号不一致');
  const items=[...document.querySelectorAll('.ant-form-item')].filter(visible).map(el=>{
    const labelNode=el.querySelector('.ant-form-item-label'),label=clean(labelNode?.textContent);if(!label||/密码|密钥|token|password|secret|cookie|csrf/i.test(label))return null;
    const owns=e=>visible(e)&&e.closest('.ant-form-item')===el;
    const controls=[...el.querySelectorAll('input,textarea')].filter(owns).filter(e=>!['hidden','password','checkbox','radio','file'].includes(e.type)).map(e=>({name:e.name||e.id||'',value:e.value,disabled:e.disabled,searchOnly:e.placeholder==='搜索'||e.name==='productAttrSearchSearch'||e.type==='search'&&!e.closest('.ant-select-auto-complete')}));
    return {label,attribute:!!labelNode?.querySelector('.attr-label'),required:!!labelNode?.querySelector('.ant-form-item-required,.attr-label.required'),controls,
      selections:[...el.querySelectorAll('.ant-select-selection-item')].filter(owns).map(e=>clean(e.textContent)),
      checked:[...el.querySelectorAll('input:checked')].filter(e=>e.closest('.ant-form-item')===el).map(e=>clean(e.closest('label')?.textContent)),
      errors:[...el.querySelectorAll('.ant-form-item-explain-error')].filter(visible).map(e=>e.textContent.trim())};
  }).filter(Boolean);
  const values=label=>{const item=items.find(x=>x.label===label);return [...(item?.selections||[]),...(item?.checked||[]),...(item?.controls||[]).filter(c=>!c.searchOnly&&!c.disabled).map(c=>c.value)].filter(Boolean);};
  if(!values('店铺账号').includes(expected.storeName))throw new Error('TikTok实际店铺与工作台所选店铺不一致');
  const sourceUrls=[...document.querySelectorAll('input[name="sourceUrl"]')].filter(visible).map(e=>e.value);
  if(!sourceUrls.includes(expected.sourceUrl))throw new Error('TikTok草稿来源与本批商品不一致');
  const category=values('新版产品分类')[0]||values('产品分类')[0]||'';
  const lines=(document.querySelector('#productBasicInfo')?.innerText||'').split('\n').map(x=>x.trim());
  const pathLines=[...new Set(lines.filter(x=>category&&x.includes(' > ')&&x.endsWith(category)))];
  const categoryPath=pathLines.length===1?pathLines[0].split(' > ').map(x=>x.trim()):[];
  const table=document.querySelector('#skuDataInfo table'),headers=[...table?.querySelectorAll('th')||[]].map(e=>clean(e.textContent)),skuIndex=headers.findIndex(x=>/^SKU/.test(x));
  const currency=headers.map(x=>x.match(/本地展示价\(([A-Z]{3})\)/)?.[1]).find(Boolean)||null;
  const skus=[...table?.querySelectorAll('tbody tr')||[]].filter(r=>r.querySelector('[name="sellerSku"]')).map(row=>{
    const value=name=>row.querySelector(`input[name="${name}"]`)?.value??null,preSale=row.querySelector('[name="preSaleDays"]');
    return {id:value('sellerSku'),price:value('originalPrice'),stock:value('availableStock'),specs:[...row.querySelectorAll('td')].slice(0,skuIndex).map((e,i)=>({name:headers[i],value:e.textContent.trim()})),preSaleDays:preSale&&!preSale.disabled?preSale.value:null};
  });
  const inputValue=name=>document.querySelector(`input[name="${name}"]`)?.value??null;
  const packageDefaults={lengthCm:inputValue('proLength'),widthCm:inputValue('proWidth'),heightCm:inputValue('proHeight'),weightKg:inputValue('proWeight')};
  const unitText=name=>document.querySelector(`input[name="${name}"]`)?.closest('.ant-form-item')?.innerText||'';
  const units={dimension:['proLength','proWidth','proHeight'].every(x=>/\bCM\b/i.test(unitText(x)))?'cm':null,weight:/\bKG\b/i.test(unitText('proWeight'))?'kg':null};
  const images=selector=>[...document.querySelectorAll(selector)].map(e=>({url:e.src,loaded:e.naturalWidth>=300&&e.naturalHeight>=300}));
  const frame=document.querySelector('iframe.cke_wysiwyg_frame'),description=frame?.contentDocument?.body;
  const detailImages=[...description?.querySelectorAll('img')||[]].map(e=>e.getAttribute('src'));
  const imageCount=(document.querySelector('#imageInfo')?.innerText||'').match(/已经选用了\s*(\d+)张/);
  return {url:location.href,account,storeName:expected.storeName,sourceUrls,items,categoryPath,category,skus,currency,packageDefaults,units,warehouse:values('仓库')[0]||null,
    title:document.querySelector('input[name="productTitle"]')?.value||'',images:images('#imageInfo .image-checkbox-in-box-wrap img.img-css'),variantImages:images('#skuAttrsInfo .image-checkbox-in-box-wrap img.img-css'),detailImages,selectedImageCount:imageCount?Number(imageCount[1]):null,descriptionPresent:!!description&&(detailImages.length>0||!!description.innerText.trim()),
    notices:[...document.querySelectorAll('.ant-message-notice-content,.ant-notification-notice-description,.ant-modal')].filter(visible).map(e=>e.textContent.trim())};
}

export function tiktokListingReadiness(snapshot,product,defaults,{platformPrices,platformCurrency}={}){
  const facts=tiktokSourceFacts(product),issues=[...facts.issues];
  if(!isDeepStrictEqual(snapshot.categoryPath,facts.categoryPath)||!facts.categoryPath.length)issues.push('TikTok完整商品分类尚未核对');
  if(snapshot.title!==product.title)issues.push('TikTok标题与导入商品不一致');
  if(!snapshot.descriptionPresent)issues.push('TikTok必填产品描述为空');
  if(snapshot.units.dimension!=='cm'||snapshot.units.weight!=='kg')issues.push('TikTok包裹字段单位无法确认');
  let normalizedPackage;
  try{normalizedPackage=normalizePackageDefaults(defaults.packageDefaults);}catch(error){issues.push(error.message);}
  for(const [key,value]of Object.entries(normalizedPackage||{}))if(!positive(snapshot.packageDefaults[key])||Number(snapshot.packageDefaults[key])!==value)issues.push(`TikTok包裹${key}与统一预填值不一致`);
  if(!normalizedPackage)issues.push('未配置完整的统一包裹尺寸和重量');
  if(!snapshot.warehouse||snapshot.warehouse!==defaults.warehouse)issues.push('TikTok发货仓库与本店默认仓库不一致');
  for(const item of snapshot.items){
    if(item.required&&!['产品图片','产品描述'].includes(item.label)&&!itemValues(item).length)issues.push(`TikTok缺少${item.label}`);
    for(const error of item.errors||[])issues.push(`${item.label}：${error}`);
  }
  const origin=snapshot.items.find(x=>/^原产地/.test(x.label)),material=snapshot.items.find(x=>/^材质/.test(x.label));
  if(facts.origin&&!itemValues(origin).includes(facts.origin))issues.push('TikTok原产地与原始详情不一致');
  if(facts.material&&!isDeepStrictEqual(material?.checked,[facts.material]))issues.push('TikTok材质必须与来源Canvas一致，不能保留自动带入的其他材质');
  if(!/^[A-Z]{3}$/.test(snapshot.currency||''))issues.push('TikTok本地展示价格币种无法确认');
  if(platformCurrency&&snapshot.currency!==platformCurrency)issues.push('TikTok本地展示价格币种在补全期间发生变化');
  if(snapshot.skus.length!==product.skus.length)issues.push('TikTok变种数量与原始商品不一致');
  for(const sku of product.skus){
    const matches=snapshot.skus.filter(x=>x.id===sku.id),actual=matches[0];
    if(matches.length!==1||Number(actual.stock)!==sku.stock||!isDeepStrictEqual(actual.specs,sku.specs)||!positive(actual.price))issues.push(`TikTok SKU ${sku.id} 的规格、库存或本地展示价待核对`);
    if(actual&&actual.preSaleDays!==null&&(!Number.isInteger(Number(actual.preSaleDays))||Number(actual.preSaleDays)<3||Number(actual.preSaleDays)>30))issues.push(`TikTok SKU ${sku.id} 预售天数缺失或不在页面允许范围`);
    if(platformPrices&&actual&&Number(actual.price)!==Number(platformPrices.find(x=>x.id===sku.id)?.price))issues.push(`TikTok SKU ${sku.id} 本地展示价在补全期间发生变化`);
  }
  const assetKey=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['kwcdn.com','cdnfe.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.pathname:null;}catch{return null;}};
  const same=(actual,expected)=>actual.length===expected.length&&actual.every((value,i)=>assetKey(value)&&assetKey(value)===assetKey(expected[i]));
  if(!same(snapshot.images.map(x=>x.url),product.images)||snapshot.images.some(x=>!x.loaded)||snapshot.selectedImageCount!==product.images.length||snapshot.images.length>9)issues.push('TikTok主图内容、选中数量或尺寸待核对');
  if(!same(snapshot.detailImages,product.detailImages))issues.push('TikTok详情图与原始商品不一致');
  if(!same(snapshot.variantImages.map(x=>x.url),product.skus.filter(x=>x.image).map(x=>x.image)))issues.push('TikTok变种图与原始商品不一致');
  return {ready:issues.length===0,issues:[...new Set(issues)],facts};
}

export function retainedTiktokListing(snapshot){
  const imageKey=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['kwcdn.com','cdnfe.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.pathname:value;}catch{return value;}};
  return {
    url:snapshot.url,account:snapshot.account,storeName:snapshot.storeName,sourceUrls:snapshot.sourceUrls,
    title:snapshot.title,categoryPath:snapshot.categoryPath,currency:snapshot.currency,skus:snapshot.skus.map(s=>({...s,price:Number(s.price),stock:Number(s.stock)})),
    packageDefaults:Object.fromEntries(Object.entries(snapshot.packageDefaults).map(([key,value])=>[key,Number(value)])),
    units:snapshot.units,warehouse:snapshot.warehouse,
    attributes:snapshot.items.filter(item=>item.attribute).map(item=>({label:item.label,required:item.required,values:itemValues(item).sort()})).sort((a,b)=>a.label.localeCompare(b.label)),
    images:snapshot.images.map(x=>imageKey(x.url)),variantImages:snapshot.variantImages.map(x=>imageKey(x.url)),detailImages:snapshot.detailImages.map(imageKey),selectedImageCount:snapshot.selectedImageCount
  };
}

export function unchangedTiktokMedia(before,after){
  return isDeepStrictEqual(before.images.map(x=>x.url),after.images.map(x=>x.url))&&isDeepStrictEqual(before.detailImages,after.detailImages);
}

export async function waitTiktokMediaBaseline({readSnapshot,poll,product}){
  let previous=null;
  return poll(async()=>{
    const snapshot=await readSnapshot();
    // The fresh editor exposes its title before CKEditor has inserted its images.
    // Establish the baseline only after the expected media is loaded and stable.
    if(!product.images.length||snapshot.images.length!==product.images.length||snapshot.images.some(x=>!x.loaded)||snapshot.selectedImageCount!==product.images.length||snapshot.detailImages.length!==product.detailImages.length||!snapshot.descriptionPresent){previous=null;return null;}
    if(!previous||!unchangedTiktokMedia(previous,snapshot)){previous=snapshot;return null;}
    return snapshot;
  },{timeout:45000,label:'TikTok初始主图与详情完整加载'});
}

export function tiktokSaveAcknowledged(messages){
  return (Array.isArray(messages)?messages:[messages]).some(message=>/(?:保存|操作|编辑)成功|已保存/.test(String(message||'')));
}

export async function settleTiktokSave({submitOnce,observeReceipt,verifyReadOnly,url}){
  let receipt=[],receiptError=null;
  try{await submitOnce();receipt=await observeReceipt();}catch(error){receiptError=error.message;}
  let result;
  try{result=await verifyReadOnly();}
  catch(error){result={status:'needs-review',ready:false,saved:null,published:false,url,issues:['TikTok保存后只读核对未完成：'+error.message]};}
  return {...result,readyToSave:false,verification:{...result.verification,saveReceipt:{acknowledged:tiktokSaveAcknowledged(receipt),messages:receipt||[],error:receiptError},readBackAttempted:true}};
}

// Older saved intents contain numeric form values as strings. Compare amounts,
// preserving every other saved field rather than treating formatting as a mutation.
export function comparableTiktokSaveSnapshot(snapshot){
  return {...snapshot,skus:snapshot.skus.map(s=>({...s,price:Number(s.price),stock:Number(s.stock)})),
    packageDefaults:Object.fromEntries(Object.entries(snapshot.packageDefaults).map(([key,value])=>[key,Number(value)]))};
}

export function createDxmTiktokPreparer(configuration={}){
  const library=()=>import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  function expectedFor(args){
    const url=new URL(args.platformEditUrl);if(url.origin!=='https://www.dianxiaomi.com'||url.pathname!=='/web/tiktokProduct/edit'||!/^\d{6,30}$/.test(url.searchParams.get('id')||''))fail('TikTok草稿编辑链接无效');
    if(args.targetStore?.platform!=='tiktok'||!args.targetStore.name||!args.erpConnection?.expectedAccount||!args.product?.sourceUrl)fail('TikTok草稿缺少明确的账号、店铺或来源商品');
    return {url:url.href,account:args.erpConnection.expectedAccount,storeName:args.targetStore.name,sourceUrl:args.product.sourceUrl};
  }
  async function withPage(args,fn){
    if(args.browserConfig?.type!=='chrome')fail('TikTok草稿准备仅支持绑定的谷歌浏览器');
    const expected=expectedFor(args),lib=await library(),info=await lib.connection(args.browserConfig),browser=await lib.connect(info.ws);let page,targetId;
    const navigate=async()=>{await page.send('Page.navigate',{url:expected.url});await lib.poll(async()=>{try{return await page.evaluate(expected=>location.href===expected.url&&document.querySelector('.btn-user .user-name')?.textContent.trim()===expected.account&&!!document.querySelector('input[name="productTitle"]')?.value&&document.querySelector('input[name="sourceUrl"]')?.value===expected.sourceUrl,expected);}catch{return false;}},{timeout:45000,label:'TikTok商品完整加载'});};
    try{({targetId}=await browser.send('Target.createTarget',{url:'about:blank',background:true}));page=await lib.pageById(info,targetId);await page.send('Page.enable');await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});await navigate();return await fn({page,lib,expected,navigate});}
    finally{if(page)await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});page?.close();if(targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
  }
  async function action(page,expected,locator,kind='click',value){
    const point=await page.evaluate(({expected,locator,kind,value})=>{
      if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('TikTok操作前账号或草稿发生变化');
      const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';let root=document;
      if(locator.label){const items=[...document.querySelectorAll('.ant-form-item')].filter(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()===locator.label);if(items.length!==1)throw new Error('TikTok字段定位不唯一：'+locator.label);root=items[0];}
      if(locator.modal){const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&e.querySelector('.ant-modal-title')?.textContent.trim()===locator.modal);if(modals.length!==1)throw new Error('TikTok窗口定位不唯一');root=modals[0];}
      if(locator.categoryLevel!==undefined){root=root.querySelectorAll('.categories-box')[locator.categoryLevel];if(!root)throw new Error('TikTok分类层级缺失');}
      let elements=[...root.querySelectorAll(locator.selector)].filter(visible);if(locator.text!==undefined)elements=elements.filter(e=>e.textContent.trim()===locator.text);if(locator.leaf)elements=elements.filter(e=>e.children.length===0);if(locator.index!==undefined)elements=elements[locator.index]?[elements[locator.index]]:[];
      if(elements.length!==1)throw new Error('TikTok控件定位不唯一：'+(locator.text||locator.selector));const el=elements[0];if(el.disabled||el.getAttribute('aria-disabled')==='true')throw new Error('TikTok控件不可用');
      if(kind==='fill'){if(el.readOnly)throw new Error('TikTok字段只读');const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));return null;}
      el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y);if(!el.contains(hit))throw new Error('TikTok控件被遮挡：'+(locator.text||locator.selector)+'；遮挡元素：'+(hit?.tagName||'none')+'.'+String(hit?.className||''));return point;
    },{expected,locator,kind,value});
    if(point){await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
  }
  async function category(ctx,path){
    const {page,lib,expected}=ctx,before=await page.evaluate(readTiktokListing,expected);if(isDeepStrictEqual(before.categoryPath,path)){await waitCategoryFields(ctx);return false;}
    if(before.categoryPath.length)fail('TikTok已有其他分类，未覆盖用户已有分类');
    await action(page,expected,{selector:'button',text:'选择分类'});
    await lib.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.ant-modal')].some(e=>e.getClientRects().length&&e.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目')),{label:'TikTok分类窗口'});
    for(let i=0;i<path.length;i++){
      await action(page,expected,{modal:'选择类目',categoryLevel:i,selector:'.categories-item-name',text:path[i]});
      await lib.poll(()=>page.evaluate(({level,name})=>[...document.querySelectorAll('.ant-modal .categories-box')][level]?.querySelector('.categories-item.active .categories-item-name')?.textContent===name,{level:i,name:path[i]}),{label:'TikTok分类选项'});
      if(i<path.length-1)await lib.poll(()=>page.evaluate(level=>document.querySelectorAll('.ant-modal .categories-box').length>level, i+1),{label:'TikTok下级分类'});
    }
    const leaf=await page.evaluate(()=>{const boxes=[...document.querySelectorAll('.ant-modal .categories-box')],item=boxes.at(-1)?.querySelector('.categories-item.active');return item&&!item.querySelector('.icon_right');});if(!leaf)fail('TikTok尚未选择到末级分类');
    await action(page,expected,{modal:'选择类目',selector:'button',text:'选择'});
    await lib.poll(()=>page.evaluate(()=>![...document.querySelectorAll('.ant-modal-wrap')].some(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none')),{label:'TikTok分类窗口关闭'});
    await lib.poll(async()=>isDeepStrictEqual((await page.evaluate(readTiktokListing,expected)).categoryPath,path),{label:'TikTok分类应用到草稿'});
    await waitCategoryFields(ctx);return true;
  }
  async function waitCategoryFields({page,lib},ids){
    await lib.poll(()=>page.evaluate(ids=>{
      const skus=[...document.querySelectorAll('#skuDataInfo input[name="sellerSku"]')].map(e=>e.value),labels=[...document.querySelectorAll('.attr-label.required')].map(e=>e.textContent.trim());
      return skus.length>0&&(!ids||skus.length===ids.length&&ids.every(id=>skus.filter(value=>value===id).length===1))&&labels.some(x=>/^原产地/.test(x))&&labels.some(x=>/^材质/.test(x))&&!!document.querySelector('iframe.cke_wysiwyg_frame')?.contentDocument?.body;
    },ids),{timeout:45000,label:'TikTok分类属性与完整SKU加载'});
  }
  async function expandAttributes(ctx){
    const {page,expected}=ctx,exists=await page.evaluate(()=>[...document.querySelectorAll('span')].some(e=>e.getClientRects().length&&e.textContent.trim()==='+展开'&&e.children.length===0));
    if(exists)await action(page,expected,{selector:'span',text:'+展开',leaf:true});
  }
  async function completeSnapshot(ctx){
    const {page,expected,lib}=ctx;await expandAttributes(ctx);
    const initial=await page.evaluate(readTiktokListing,expected),material=initial.items.find(x=>/^材质/.test(x.label));
    // The material chooser renders a filtered subset. Search its known option to read
    // Canvas's checked state, and retain other checked values from the unfiltered view.
    if(material){
      await action(page,expected,{label:material.label,selector:'input[placeholder="搜索"]'},'fill','帆布');
      await lib.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.attr-form-item label')].some(e=>e.getClientRects().length&&e.textContent.trim()==='帆布(キャンバス)'&&e.querySelector('input[type="checkbox"]'))),{label:'TikTok材质勾选状态'});
    }
    await page.evaluate(()=>document.querySelector('#imageInfo')?.scrollIntoView({block:'center'}));
    await lib.poll(()=>page.evaluate(()=>{const imgs=[...document.querySelectorAll('#imageInfo .image-checkbox-in-box-wrap img.img-css')];return imgs.length&&imgs.every(e=>e.complete&&e.naturalWidth>0);}),{timeout:15000,label:'TikTok商品图片加载'});
    const snapshot=await page.evaluate(readTiktokListing,expected),current=snapshot.items.find(x=>/^材质/.test(x.label));
    if(current)current.checked=[...new Set([...(material?.checked||[]),...current.checked])];
    return snapshot;
  }
  async function warehouseOptions(ctx){
    const {page,lib,expected}=ctx;await action(page,expected,{label:'仓库',selector:'.ant-select-selector'});
    const options=await lib.poll(()=>page.evaluate(()=>{const menus=[...document.querySelectorAll('.ant-select-dropdown')].filter(e=>e.getClientRects().length&&!e.classList.contains('ant-select-dropdown-hidden'));if(menus.length!==1)return null;const names=[...menus[0].querySelectorAll('.ant-select-item-option')].map(e=>e.getAttribute('title')||e.textContent.trim());return names.length?names:null;}),{label:'TikTok仓库选项'});
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});return options;
  }
  async function applyAttributes(ctx,facts,{clearNewDefaults=false}={}){
    const {page,expected,lib}=ctx;await expandAttributes(ctx);let snapshot=await page.evaluate(readTiktokListing,expected);
    const origin=snapshot.items.find(x=>/^原产地/.test(x.label)),material=snapshot.items.find(x=>/^材质/.test(x.label));if(!origin||!material)fail('TikTok已验证分类的原产地或材质字段缺失');
    if(!itemValues(origin).includes(facts.origin))await action(page,expected,{label:origin.label,selector:'.ant-select-auto-complete input'},'fill',facts.origin);
    await action(page,expected,{label:material.label,selector:'input[placeholder="搜索"]'},'fill','');
    // Clear only checked values observed in this material field, never other attributes.
    await page.evaluate(({expected,label,keep})=>{if(location.href!==expected.url)throw new Error('TikTok草稿发生变化');const item=[...document.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()===label);for(const input of item.querySelectorAll('input[type="checkbox"]:checked'))if(input.closest('label')?.textContent.trim()!==keep)input.click();},{expected,label:material.label,keep:facts.material});
    await action(page,expected,{label:material.label,selector:'input[placeholder="搜索"]'},'fill','帆布');
    await lib.poll(()=>page.evaluate(label=>{const item=[...document.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()===label);return [...item?.querySelectorAll('label')||[]].some(e=>e.textContent.trim()==='帆布(キャンバス)'&&e.querySelector('input[type="checkbox"]'));},material.label),{label:'TikTok帆布材质选项'});
    const selected=await page.evaluate(label=>{const item=[...document.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()===label),options=[...item.querySelectorAll('label')].filter(e=>e.textContent.trim()==='帆布(キャンバス)'&&e.querySelector('input[type="checkbox"]'));if(options.length!==1)throw new Error('TikTok帆布选项不唯一');return options[0].querySelector('input').checked;},material.label);
    if(!selected)await action(page,expected,{label:material.label,selector:'label',text:facts.material});
    await action(page,expected,{label:material.label,selector:'input[placeholder="搜索"]'},'fill','');
    if(clearNewDefaults)await page.evaluate(expected=>{if(location.href!==expected.url)throw new Error('TikTok草稿发生变化');for(const item of document.querySelectorAll('.attr-form-item')){const label=item.querySelector('.attr-label');if(!label||label.classList.contains('required'))continue;for(const input of item.querySelectorAll('input[type="checkbox"]:checked'))input.click();}},expected);
  }
  async function readDefaults(args){
    const packageDefaults=normalizePackageDefaults(args.packageDefaults);if(!packageDefaults)fail('TikTok统一包裹参数尚未配置');const facts=tiktokSourceFacts(args.product);if(facts.issues.length)fail(facts.issues.join('；'));
    return withPage(args,async ctx=>{
      const initial=await ctx.page.evaluate(readTiktokListing,ctx.expected),options=await warehouseOptions(ctx);
      if(options.length!==1||initial.warehouse&&initial.warehouse!==options[0])fail('TikTok发货仓库不是唯一可确认值，请先配置该店默认仓库');
      await category(ctx,facts.categoryPath);await expandAttributes(ctx);
      const snapshot=await ctx.page.evaluate(readTiktokListing,ctx.expected);if(snapshot.units.dimension!=='cm'||snapshot.units.weight!=='kg')fail('TikTok包裹字段单位无法确认');
      const material=snapshot.items.find(x=>/^材质/.test(x.label));if(!material)fail('TikTok分类材质字段不存在');
      await action(ctx.page,ctx.expected,{label:material.label,selector:'input[placeholder="搜索"]'},'fill','帆布');
      await ctx.lib.poll(()=>ctx.page.evaluate(()=>[...document.querySelectorAll('.attr-form-item label')].some(e=>e.getClientRects().length&&e.textContent.trim()==='帆布(キャンバス)'&&e.querySelector('input[type="checkbox"]'))),{label:'验证TikTok帆布材质选项'});
      return {platform:'tiktok',storeName:args.targetStore.name,ready:true,packageDefaults,warehouse:options[0],category:{label:facts.categoryPath.at(-1),path:facts.categoryPath},attributes:{origin:facts.origin,material:facts.material},currency:snapshot.currency,
        source:{url:ctx.expected.url,draftId:new URL(ctx.expected.url).searchParams.get('id'),checkedAt:new Date().toISOString(),warehouseSource:'目标店铺草稿及唯一仓库选项',packageSource:args.packageSource||null},sourceEvidence:facts.sourceEvidence};
    });
  }
  async function prepare(args){
    const defaults={...args.defaults,packageDefaults:normalizePackageDefaults(args.defaults?.packageDefaults)},facts=tiktokSourceFacts(args.product);if(!defaults.packageDefaults)fail('TikTok统一包裹参数尚未配置');
    if(facts.issues.length)return {status:'needs-configuration',ready:false,saved:false,published:false,issues:facts.issues,url:args.platformEditUrl};
    return withPage(args,async ctx=>{
      const {page,lib,expected}=ctx,initial=await waitTiktokMediaBaseline({readSnapshot:()=>page.evaluate(readTiktokListing,expected),poll:lib.poll,product:args.product}),changedCategory=await category(ctx,facts.categoryPath);
      await expandAttributes(ctx);const before=await page.evaluate(readTiktokListing,expected),platformPrices=before.skus.map(s=>({id:s.id,price:s.price}));
      if(before.units.dimension!=='cm'||before.units.weight!=='kg')fail('TikTok包裹字段单位无法确认');
      if(before.warehouse!==defaults.warehouse){const options=await warehouseOptions(ctx);if(options.length!==1||options[0]!==defaults.warehouse)fail('TikTok仓库与本店默认值不一致');await action(page,expected,{label:'仓库',selector:'.ant-select-selector'});await action(page,expected,{selector:'.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',text:defaults.warehouse});}
      await applyAttributes(ctx,facts,{clearNewDefaults:changedCategory});
      for(const [name,key]of [['proLength','lengthCm'],['proWidth','widthCm'],['proHeight','heightCm'],['proWeight','weightKg']])await action(page,expected,{selector:`input[name="${name}"]`},'fill',defaults.packageDefaults[key]);
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      const after=await completeSnapshot(ctx),checked=tiktokListingReadiness(after,args.product,defaults,{platformPrices,platformCurrency:before.currency});
      if(!unchangedTiktokMedia(initial,after))checked.issues.push('TikTok补全期间商品图片发生变化');checked.ready=!checked.issues.length;
      const result={status:checked.ready?'ready-to-save':'needs-configuration',ready:false,readyToSave:checked.ready,saved:false,published:false,url:expected.url,issues:checked.issues,plannedFields:{categoryPath:facts.categoryPath,origin:facts.origin,material:facts.material,warehouse:defaults.warehouse,packageDefaults:defaults.packageDefaults},preview:retainedTiktokListing(after),verification:{checkedAt:new Date().toISOString(),currency:after.currency,platformPrices,pricesPreserved:after.currency===before.currency&&after.skus.every(s=>Number(s.price)===Number(platformPrices.find(p=>p.id===s.id)?.price)),priceConversionVerified:false,sourceEvidence:facts.sourceEvidence,skuCount:after.skus.length,publicationAccepted:false}};
      if(!checked.ready||args.dryRun)return result;
      if(typeof args.beforeSave!=='function')fail('保存TikTok草稿前缺少持久化提交记录');
      const preparationIntent={url:expected.url,phase:'saving-prepared-listing',expectedSnapshot:retainedTiktokListing(after)};
      await args.beforeSave(structuredClone(preparationIntent));
      const settled=await settleTiktokSave({
        url:expected.url,submitOnce:()=>action(page,expected,{selector:'button',text:'保存',index:0}),
        observeReceipt:()=>lib.poll(()=>page.evaluate(()=>{const visible=e=>!!e.getClientRects().length;const text=[...document.querySelectorAll('.ant-message-notice-content,.ant-notification-notice-description,.ant-form-item-explain-error,.ant-modal')].filter(visible).map(e=>e.textContent.trim()).filter(Boolean);return text.some(x=>/成功|失败|错误|请填写|请选择|不能为空|不支持/.test(x))?text:null;}),{timeout:8000,label:'TikTok保存回执'}),
        verifyReadOnly:()=>{
          args.onProgress?.('verifying-prepared-listing',{message:'只读核对已保存商品，不重复提交保存'});
          // A fresh page must load the server's draft, regardless of the first page's toast.
          return verify({...args,defaults,preparationIntent});
        }
      });
      return {...result,...settled,verification:{...result.verification,...settled.verification}};
    });
  }
  async function verify(args){
    const recorded=args.preparationIntent?.expectedSnapshot;
    if(!recorded)return {status:'needs-review',ready:false,saved:null,published:false,url:args.platformEditUrl,issues:['缺少TikTok提交前快照，只读核对不能推定保存成功']};
    if(args.targetStore?.platform!=='tiktok'||recorded.url!==args.platformEditUrl||args.preparationIntent.url&&args.preparationIntent.url!==args.platformEditUrl)return {status:'needs-review',ready:false,saved:null,published:false,url:args.platformEditUrl,issues:['TikTok核验地址或目标平台与提交前记录不一致']};
    if(!Array.isArray(recorded.skus)||!recorded.skus.length||recorded.skus.some(s=>typeof s.id!=='string'||!s.id)||new Set(recorded.skus.map(s=>s.id)).size!==recorded.skus.length||!recorded.packageDefaults||!Array.isArray(recorded.attributes))return {status:'needs-review',ready:false,saved:null,published:false,url:args.platformEditUrl,issues:['TikTok提交前商品快照不完整，不能推定保存成功']};
    const expectedSnapshot=comparableTiktokSaveSnapshot(recorded);
    return withPage(args,async ctx=>{
      await waitCategoryFields(ctx,expectedSnapshot.skus.map(s=>s.id));
      const snapshot=await completeSnapshot(ctx);
      const checked=tiktokListingReadiness(snapshot,args.product,args.defaults,{platformPrices:expectedSnapshot.skus,platformCurrency:expectedSnapshot.currency});
      const actual=comparableTiktokSaveSnapshot(retainedTiktokListing(snapshot)),mismatches=Object.keys(expectedSnapshot).filter(key=>!isDeepStrictEqual(actual[key],expectedSnapshot[key]));
      if(!isDeepStrictEqual(actual,expectedSnapshot))checked.issues.push('TikTok当前草稿与提交前快照不一致：'+mismatches.join('、'));checked.ready=!checked.issues.length;
      return {status:checked.ready?'prepared':'needs-review',ready:checked.ready,saved:checked.ready?true:null,published:false,url:ctx.expected.url,issues:checked.issues,
        verification:{checkedAt:new Date().toISOString(),persistedValuesVerified:checked.ready,readOnly:true,currency:snapshot.currency,platformPrices:snapshot.skus.map(s=>({id:s.id,price:s.price})),snapshotMismatches:mismatches,publicationAccepted:false}};
    });
  }
  return {readDefaults,prepare,verify};
}
