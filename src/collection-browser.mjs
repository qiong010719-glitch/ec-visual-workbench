import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {temuGoodsId} from './geekbi.mjs';
import {DXM_TEMPLATE_URL,validateImportTemplate} from './dxm-product-import.mjs';

export const COLLECTION_URL='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition';
const validEdit=url=>{try{const u=new URL(url);return u.origin==='https://www.dianxiaomi.com'&&u.pathname==='/web/productCrawl/edit'&&/^\d+$/.test(u.searchParams.get('id'));}catch{return false;}};

// Read the product form and its DOM-backed editor value, never private application state.
export function readImportedProduct(){
  const val=s=>document.querySelector(s)?.value??null;
  const table=document.querySelector('#skuDataInfo table');
  const headers=[...table?.querySelectorAll('th')||[]].map(e=>e.textContent.replace(/\s+/g,''));
  const index=pattern=>headers.findIndex(x=>pattern.test(x));
  const columns={id:index(/^SKU/),price:index(/^价格\(USD\)/),salePrice:index(/^促销价\(USD\)/),stock:index(/^库存/)};
  const skus=[...table?.querySelectorAll('tbody tr')||[]].filter(r=>r.querySelector('td input')).map(row=>{
    const cells=[...row.querySelectorAll('td')],read=i=>i<0?null:cells[i]?.querySelector('input')?.value??cells[i]?.textContent.trim()??null;
    return {id:read(columns.id),price:read(columns.price),salePrice:read(columns.salePrice),stock:read(columns.stock),specs:cells.slice(0,columns.id).map((c,i)=>({name:headers[i],value:c.textContent.trim()}))};
  });
  const images=selector=>[...document.querySelectorAll(selector)].filter(e=>e.src.startsWith('https://')).map(e=>({url:e.src,loaded:e.naturalWidth>1}));
  const html=val('#descInfo textarea.general-detail-desc-task-module');
  const detailImages=html===null?null:[...new DOMParser().parseFromString(html,'text/html').querySelectorAll('img')].map(e=>e.getAttribute('src'));
  return {sourceUrl:val('#form_item_sourceList_0_path'),title:val('#productInfo [placeholder="请填写标题"]'),spu:val('#productInfo input[placeholder^="示例："]'),skus,images:images('#imageInfo img.img-css'),variantImages:images('#skuVariantImages img.img-css'),detailImages,videoEntry:[...document.querySelectorAll('#imageInfo a')].some(e=>e.textContent.trim()==='播放'),editUrl:location.href};
}

export function compareImportedProduct(actual,expected){
  const errors=[];
  if(actual.sourceUrl!==expected.sourceUrl)errors.push('来源链接不一致');
  if(actual.title!==expected.title)errors.push('标题不一致');
  if(actual.spu!==expected.goodsId)errors.push('SPU不一致');
  if(actual.skus.length!==expected.skus.length)errors.push('SKU数量不一致');
  for(const sku of expected.skus){
    const matches=actual.skus.filter(s=>s.id===sku.id),a=matches[0];
    if(matches.length!==1||['price','salePrice','stock'].some(k=>a[k]===null||a[k]===''||Number(a[k])!==sku[k])||JSON.stringify(a.specs)!==JSON.stringify(sku.specs))errors.push(`SKU ${sku.id} 的规格、价格或库存不一致`);
  }
  // DXM rewrites kwcdn.com to its cdnfe.com proxy; this is a path check, not byte equality.
  const assetKey=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['kwcdn.com','cdnfe.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.pathname:null;}catch{return null;}};
  const sameImages=(urls,source)=>Array.isArray(urls)&&urls.length===source.length&&urls.every((url,i)=>assetKey(url)!==null&&assetKey(url)===assetKey(source[i]));
  if(!sameImages(actual.images.map(i=>i.url),expected.images)||actual.images.some(i=>!i.loaded))errors.push('主图链接、顺序或加载结果待核对');
  if(!sameImages(actual.detailImages,expected.detailImages))errors.push('详情图链接或顺序待核对');
  if(!sameImages(actual.variantImages.map(i=>i.url),expected.skus.filter(s=>s.image).map(s=>s.image)))errors.push('变种图链接或顺序待核对');
  if(expected.videoUrl&&!actual.videoEntry)errors.push('未找到视频入口');
  return {status:errors.length?'needs-review':'verified',error:errors.length?errors.join('；'):null,evidence:{editUrl:actual.editUrl,sourceUrl:actual.sourceUrl,skuCount:actual.skus.length,mainImageCount:actual.images.length,detailImageCount:actual.detailImages?.length,videoEntry:actual.videoEntry,fieldChecksPassed:!errors.length,mediaBinaryEqualityVerified:false,fullVideoPlaybackVerified:false}};
}

export function createCollectionBrowser(configuration){
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const library=()=>import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  async function withPage(bound,fn,{keep=false}={}){
    if(bound.browserConfig.type!=='chrome')throw new Error('文件导入仅支持绑定的谷歌浏览器');
    const lib=await library(),info=await lib.connection(bound.browserConfig),chrome=await lib.connect(info.ws);
    let page,targetId,finished=false;
    try{
      ({targetId}=await chrome.send('Target.createTarget',{url:'about:blank'}));page=await lib.pageById(info,targetId);await page.send('Page.enable');
      await navigate(page,lib,COLLECTION_URL);const result=await fn(page,lib);finished=true;return result;
    }finally{page?.close();if(finished&&!keep&&targetId)await chrome.send('Target.closeTarget',{targetId}).catch(()=>{});chrome.close();}
  }
  async function navigate(page,lib,url){
    if(url!==COLLECTION_URL&&!validEdit(url))throw new Error('导入流程只允许打开店小秘采集箱和商品核对页');
    await page.send('Page.navigate',{url});
    await lib.poll(async()=>{try{return await page.evaluate(expected=>location.href===expected&&document.readyState==='complete',url);}catch{return false;}},{timeout:45000,label:'店小秘页面加载'});
    await lib.poll(()=>page.evaluate(()=>!!document.querySelector('.btn-user .user-name')?.textContent.trim()),{label:'店小秘登录信息'});
  }
  async function checkAccount(page,expected){
    const value=await page.evaluate(()=>({url:location.href,account:document.querySelector('.btn-user .user-name')?.textContent.trim()||''}));
    if((value.url!==COLLECTION_URL&&!validEdit(value.url))||!expected||value.account!==expected)throw new Error('店小秘未登录或账号与绑定不一致，请在工作台绑定的谷歌浏览器中登录。');
  }
  async function click(page,selector,text){
    const lib=await library();
    // Loading masks may outlive the account header. Retry observation only, never the click.
    const point=await lib.poll(()=>page.evaluate(({selector,text})=>{const matches=[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()===text);if(matches.length!==1)return null;const el=matches[0];el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))return null;return {x,y};},{selector,text}),{timeout:15000,label:`可操作的“${text}”控件`});
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  }
  async function fill(page,selector,value){
    const ok=await page.evaluate(({selector,value})=>{const el=document.querySelector(selector);if(!el||!el.getClientRects().length||el.disabled||el.readOnly)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value===value;},{selector,value});
    if(!ok)throw new Error('采集箱查询输入框已变化，请人工核对。');
  }
  async function importForm(page,lib,bound){
    await checkAccount(page,bound.erpConnection.expectedAccount);await click(page,'[role="tab"]','导入采集');
    await lib.poll(()=>page.evaluate(()=>[...document.querySelectorAll('button')].some(e=>e.getClientRects().length&&e.textContent.trim()==='导入产品数据')),{label:'产品数据导入入口'});
    await click(page,'button','导入产品数据');
    const href=await lib.poll(()=>page.evaluate(()=>{const modal=[...document.querySelectorAll('.ant-modal')].find(e=>e.getClientRects().length&&e.querySelector('.ant-modal-title')?.textContent.trim()==='导入产品数据');return modal?.querySelector('a[href*="import_product_data.xls"]')?.href;}),{label:'官方产品数据模板'});
    if(href!==DXM_TEMPLATE_URL)throw new Error('店小秘产品数据模板地址变化，已停止，请核对官方模板');return href;
  }
  async function scanTab(page,lib,tabKind,args){
    await page.evaluate(tabKind=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(e=>e.id.endsWith('-tab-'+tabKind));if(!tab)throw new Error('采集箱分类结构变化');tab.click();},tabKind);
    await lib.poll(()=>page.evaluate(tabKind=>[...document.querySelectorAll('[role="tab"]')].some(e=>e.id.endsWith('-tab-'+tabKind)&&e.getAttribute('aria-selected')==='true'),tabKind),{label:'采集箱分类'});
    await click(page,'.search-item','来源URL');await fill(page,'#c-searchValue',args.sourceUrl);await click(page,'button','搜索');
    const deadline=Date.now()+10000;
    do{
      const result=await page.evaluate(({sourceUrl,tabKind})=>{
        const tab=[...document.querySelectorAll('[role="tab"]')].find(e=>e.id.endsWith('-tab-'+tabKind));
        if(tab?.getAttribute('aria-selected')!=='true'||[...document.querySelectorAll('.ant-spin-spinning,.vxe-loading.is--visible')].some(e=>e.getClientRects().length))return null;
        const links=[...document.querySelectorAll('table a[href]')].filter(a=>a.href===sourceUrl&&a.getClientRects().length);
        const rows=links.map(a=>a.closest('tr')).filter(Boolean);
        const found=rows.map(row=>({sourceUrl,rowText:row.innerText.slice(0,4000),title:row.querySelector('.no-new-line4')?.textContent.trim()||'',editUrl:row.querySelector('a[href^="/web/productCrawl/edit?"]')?.href||'',hasImage:[...row.querySelectorAll('img')].some(i=>i.src.startsWith('https:')&&i.naturalWidth>1)}));
        const unique=[...new Map(found.map(r=>[r.editUrl||r.rowText,r])).values()];return unique.length?{records:unique}:null;
      },{sourceUrl:args.sourceUrl,tabKind});
      if(result)return result;await new Promise(r=>setTimeout(r,650));
    }while(Date.now()<deadline);return null;
  }
  async function verifyPage(page,lib,args){
    await checkAccount(page,args.erpConnection.expectedAccount);
    const found=await scanTab(page,lib,'no',args),good=found?.records[0];
    if(found?.records.length>1)return {status:'needs-review',error:'采集箱有多条同来源记录，请人工核对，未重复提交'};
    if(good&&good.title&&!/采集失败|采集中/.test(good.rowText)){
      if(!args.product)return good.hasImage?{status:'verified',evidence:{...good,tab:'未认领'},error:null}:{status:'needs-review',error:'旧版记录图片待核对'};
      if(!validEdit(good.editUrl))return {status:'needs-review',error:'找到商品但编辑页地址无法确认'};
      await navigate(page,lib,good.editUrl);await checkAccount(page,args.erpConnection.expectedAccount);
      await lib.poll(()=>page.evaluate(()=>!!document.querySelector('#productInfo [placeholder="请填写标题"]')?.value),{label:'已导入商品详情'});
      const deadline=Date.now()+20000;let checked;
      do{checked=compareImportedProduct(await page.evaluate(readImportedProduct),args.product);if(checked.status==='verified')break;await new Promise(r=>setTimeout(r,750));}while(Date.now()<deadline);
      checked.evidence={...checked.evidence,tab:'未认领',account:args.erpConnection.expectedAccount};return checked;
    }
    const bad=await scanTab(page,lib,'FAILED',args);if(bad)return {status:'failed',error:'店小秘显示采集失败。'+bad.records[0].rowText};
    return {status:'needs-review',error:'未在未认领中找到可确认的商品，请核对是否已认领或被修改；不会重复导入。'};
  }
  return {
    open:bound=>withPage(bound,async()=>({url:COLLECTION_URL,message:'已在绑定的谷歌浏览器打开店小秘采集箱。请检查登录账号。'}),{keep:true}),
    preflight:bound=>withPage(bound,async(page,lib)=>{
      const url=await importForm(page,lib,bound),r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('无法读取店小秘官方模板，未获取付费详情');
      validateImportTemplate(Buffer.from(await r.arrayBuffer()));return {ready:true};
    }),
    importProduct:args=>withPage(args,async(page,lib)=>{
      if(temuGoodsId(args.sourceUrl)!==args.goodsId)throw new Error('来源链接与商品ID不一致');await checkAccount(page,args.erpConnection.expectedAccount);
      const prior=await scanTab(page,lib,'',args);
      if(prior){const verified=await verifyPage(page,lib,args);return {...verified,alreadyPresent:true,error:verified.status==='verified'?null:'店小秘已有同来源商品，未重复导入。'+(verified.error||'')};}
      await importForm(page,lib,args);
      const fileName=path.basename(args.filePath);if(!fs.existsSync(args.filePath)||!fileName.endsWith('.xlsx'))throw new Error('导入文件不存在');await checkAccount(page,args.erpConnection.expectedAccount);
      // File selection itself may upload. Persist intent before the first remote write.
      const {root}=await page.send('DOM.getDocument',{depth:0});
      const {nodeIds}=await page.send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'.ant-modal input[type="file"]'});if(nodeIds.length!==1)throw new Error('文件上传控件不唯一，未上传');
      args.beforeSubmit();await page.send('DOM.setFileInputFiles',{nodeId:nodeIds[0],files:[args.filePath]});
      await lib.poll(()=>page.evaluate(fileName=>{const modal=[...document.querySelectorAll('.ant-modal')].find(e=>e.getClientRects().length&&e.querySelector('.ant-modal-title')?.textContent.trim()==='导入产品数据');return modal?.textContent.includes(fileName)&&!modal.querySelector('.ant-upload-list-item-uploading');},fileName),{timeout:60000,label:'导入文件上传完成'});
      await checkAccount(page,args.erpConnection.expectedAccount);await click(page,'.ant-modal button','确定');
      const receipt=await lib.poll(()=>page.evaluate(fileName=>{const row=[...document.querySelectorAll('tr')].find(e=>e.getClientRects().length&&[...e.querySelectorAll('td')].some(c=>c.textContent.trim()===fileName));if(!row)return null;const value=row.innerText.trim();return /解析成功|解析失败/.test(value)?value:null;},fileName),{timeout:120000,interval:1500,label:'店小秘文件解析结果'});
      const counts=receipt.match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
      if(/解析失败/.test(receipt)||counts&&(Number(counts[2])>0||Number(counts[1])!==1||Number(counts[3])!==1))return {status:'failed',error:'店小秘导入结果异常，请核对导入记录。'+receipt,importReceipt:receipt};
      if(!counts)return {status:'needs-review',error:'文件已提交，但解析成功数量无法确认。',importReceipt:receipt};
      await navigate(page,lib,COLLECTION_URL);return {...await verifyPage(page,lib,args),importReceipt:receipt};
    },{keep:true}),
    verify:args=>withPage(args,(page,lib)=>verifyPage(page,lib,args),{keep:true})
  };
}
