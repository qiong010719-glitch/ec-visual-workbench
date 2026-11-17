import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {connection,connect,pageById,poll,config,root} from './bit-cdp.mjs';
import {readPage} from '../inspect-draft.mjs';
import {mainImageLimits,validateMainImageCount} from './erp-image-rules.mjs';
import {openChrome} from './chrome-cdp.mjs';
import {createDraftSession} from './draft-session.mjs';
import {navigateAndWait,navigating,readAutomationState} from './erp-page-state.mjs';
export {createDraftSession} from './draft-session.mjs';
export {publishDraft,checkPublication} from './temu-publish.mjs';
export {validateMother,openMotherSource} from './temu-mothers.mjs';
import {readMother,copyMother} from './temu-mothers.mjs';
import {fill,click,menu,setPreservedSkuPreview,
  clearInheritedDescription,clearInheritedMainImages,fillEmptyDescriptionFromMainImages} from './draft-ui.mjs';

const equal=(a,b,label)=>assert.deepEqual(a,b,label);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const stable=s=>({store:s.store,site:s.site,items:s.items,variantFields:s.variantFields,media:s.media,
  warehouseContext:s.warehouseContext.map(t=>t.replaceAll('内计共含','共计内含'))});
const selected=(s,label)=>s.items.find(i=>i.label===label);
const value=(s,label)=>selected(s,label)?.controls[0]?.value;

export async function checkConnection(browserConfig=config,erpConfig={}){
  const info=await connection(browserConfig);const targets=await info.targets();
  let account='';const pages=targets.filter(t=>t.type==='page'&&/^https:\/\/(www\.)?dianxiaomi\.com\//.test(t.url));
  for(const t of pages){let page;try{page=await pageById(info,t.id);account=await page.evaluate(()=>document.querySelector('.btn-user .user-name')?.textContent.trim()||'');if(account)break;}finally{page?.close();}}
  return {connected:true,browserKey:browserConfig.key||browserConfig.browserId,erpOpen:!!pages.length,loggedIn:!!account,account,accountMatched:erpConfig.expectedAccount?erpConfig.expectedAccount===account:null,checkedAt:new Date().toISOString()};
}
export async function openLogin(browserConfig){
  const info=browserConfig.type==='chrome'?await openChrome(browserConfig):await connection(browserConfig),browser=await connect(info.ws);
  try{await browser.send('Target.createTarget',{url:'https://www.dianxiaomi.com/web/popTemu/pageList/offline'});return {opened:true,message:'店小秘窗口已打开，请在该窗口完成登录，再点击“检查登录”。'};}finally{browser.close();}
}
async function checkAccount(page,store){
  if(!store.erpConnection?.expectedAccount)return;
  const account=await page.evaluate(()=>document.querySelector('.btn-user .user-name')?.textContent.trim()||'');
  if(account!==store.erpConnection.expectedAccount)throw new Error('店小秘当前登录账号与绑定账号不一致，请检查连接设置');
}

// Resolve an ambiguous save only by comparing a real ERP draft with the pre-save snapshot.
export async function reconcileDraft({store,row,draftId,browserConfig,evidenceDirectory}){
  if(!/^\d{6,30}$/.test(draftId)||draftId===store.draftId)throw new Error('请输入新建草稿的编辑链接，不是母稿链接');
  const preparedFile=path.join(evidenceDirectory,'prepared.json');
  if(!fs.existsSync(preparedFile))throw new Error('缺少保存前快照，不能自动确认该条结果');
  const prepared=JSON.parse(fs.readFileSync(preparedFile,'utf8'));
  const info=await connection(browserConfig),browser=await connect(info.ws);let page;
  try{
    const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});page=await pageById(info,targetId);
    const readback=await readDraft(page,store,draftId);equal(stable(readback),stable(prepared),'现有草稿与保存前数据不一致');
    equal(readback.variantFields.variationSku,[row.sku],'草稿 SKU 不匹配');
    const result={draftId,url:'https://www.dianxiaomi.com/web/popTemu/edit?id='+draftId,verifiedAt:new Date().toISOString(),published:false,reconciled:true};
    fs.writeFileSync(path.join(evidenceDirectory,'reconciled.json'),JSON.stringify({result,readback},null,2));return result;
  }finally{page?.close();browser.close();}
}

// A missing draft alone cannot establish a rejected save. Also require the original
// unsaved page, matching SKU and a currently visible image-count rule violation.
export async function checkRejectedDraft({store,row,browserConfig,evidenceDirectory}){
  const info=await connection(browserConfig),browser=await connect(info.ws);let original,page,targetId;
  try{
    if(!row.targetId)throw new Error('缺少原编辑窗口，无法确认未保存');
    original=await pageById(info,row.targetId);
    const form=await original.evaluate(()=>({host:location.hostname,path:location.pathname,id:new URL(location.href).searchParams.get('id'),sku:document.querySelector('[name="variationSku"]')?.value,count:document.querySelectorAll('.mainImage .img-list img').length,rules:document.querySelector('.mainImage')?.innerText||''}));
    const limits=mainImageLimits(form.rules);
    if(!['www.dianxiaomi.com','dianxiaomi.com'].includes(form.host)||!((form.path==='/web/popTemu/add'&&!form.id)||(form.path==='/web/popTemu/quoteEdit'&&form.id===store?.draftId))||form.sku!==row.sku||limits.minimum===null||form.count>=limits.minimum)throw new Error('没有确认图片数量校验阻止了保存，请继续核对现有草稿');
    ({targetId}=await browser.send('Target.createTarget',{url:'about:blank'}));page=await pageById(info,targetId);
    const pending=await pendingList(page);
    if(pending.rows.some(r=>r.text.split(/\s+/).includes(row.sku)))throw new Error('待发布已存在该 SKU，请使用草稿链接回读核对');
    const result={confirmedNotSaved:true,checkedAt:new Date().toISOString(),reason:`至少需要 ${limits.minimum} 张主图，当前只有 ${form.count} 张；原页面仍未保存，待发布中不存在该 SKU。`};
    fs.writeFileSync(path.join(evidenceDirectory,'rejected-save-verification.json'),JSON.stringify({result,form,pending},null,2));
    return result;
  }finally{original?.close();page?.close();if(targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
}

async function readDraft(page,store,id,expected){
  await navigateAndWait(page,'https://www.dianxiaomi.com/web/popTemu/edit?id='+id,id=>location.pathname==='/web/popTemu/edit'&&new URL(location.href).searchParams.get('id')===id
    &&document.querySelectorAll('.theme-value-add').length===2&&document.getElementsByName('variationSku').length>0
    &&document.querySelector('.sku-image img')?.src?.includes('wxalbum')
    &&document.querySelectorAll('input[name="stock"]').length>0,id,{label:'核验页完整加载'});
  await checkAccount(page,store);
  if(expected)return poll(()=>navigating(async()=>{const actual=await page.evaluate(readPage,{...store,draftId:id});return isDeepStrictEqual(stable(actual),stable(expected))?actual:null;}),{timeout:30000,label:id===store.draftId?'母稿内容与执行前一致':'已保存商品与保存前快照一致'});
  return page.evaluate(readPage,{...store,draftId:id});
}

async function pendingList(page){
  await navigateAndWait(page,'https://www.dianxiaomi.com/web/popTemu/pageList/offline',()=>/共\s*\d+\s*条记录/.test(document.body?.innerText||''),undefined,{label:'待发布列表加载'});
  // Only a complete inventory may be used for duplicate checks.
  const list=await page.evaluate(()=>({rows:[...document.querySelectorAll('tr[rowid]')].map(el=>({id:el.getAttribute('rowid'),text:el.innerText})),
    total:Number(document.body.innerText.match(/共\s*(\d+)\s*条记录/)?.[1])}));
  while(list.rows.length<list.total){
    const previous=list.rows.map(r=>r.id);
    const moved=await page.evaluate(()=>{const next=document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');if(!next||next.getAttribute('aria-disabled')==='true')return false;next.click();return true;});
    if(!moved)break;
    const rows=await poll(()=>page.evaluate(ids=>{const rows=[...document.querySelectorAll('tr[rowid]')].map(el=>({id:el.getAttribute('rowid'),text:el.innerText}));return rows.length&&rows.every(r=>!ids.includes(r.id))?rows:null;},previous),{timeout:30000,label:'待发布列表下一页加载'});
    list.rows.push(...rows);
    if(list.rows.length>10000)throw new Error('待发布数据过多，请先清理历史草稿或按店铺筛选后核对');
  }
  if(list.total!==list.rows.length)throw new Error('待发布列表存在分页或筛选，当前无法完整核对重复商品；未创建新稿。');
  return list;
}

export async function uploadMainImages(page,images,identity,{timeout=60000}={}){
  const read=async()=>{
    let state;
    try{state=await page.evaluate(({motherId,attemptToken,sku})=>({
      same:['www.dianxiaomi.com','dianxiaomi.com'].includes(location.hostname)
        &&location.pathname==='/web/popTemu/quoteEdit'&&new URL(location.href).searchParams.get('id')===motherId
        &&document.documentElement.dataset.workbenchMotherId===motherId
        &&document.documentElement.dataset.workbenchAttempt===attemptToken
        &&document.documentElement.dataset.workbenchAttemptSku===sku
        &&document.querySelector('[name="variationSku"]')?.value===sku,
      urls:[...document.querySelectorAll('.mainImage .img-list img')].map(e=>e.src)
    }),identity);}catch(e){if(!/Execution context was destroyed|Cannot find context|Inspected target navigated|Cannot find default execution context/i.test(e.message))throw e;}
    if(!state?.same)throw Object.assign(new Error('编辑页在上传期间刷新或发生变化，已停止；尚未提交保存，请核对失败页后继续。'),{code:'ERP_EDITOR_RESET'});
    return state.urls;
  };
  await read();
  equal(await page.evaluate(()=>document.querySelectorAll('.mainImage .img-list img').length),0,'新稿已有主图，请核对');
  // Upload one at a time so completion order cannot reorder the gallery.
  const urls=[];
  for(const im of images){
    await read();
    if(sha(fs.readFileSync(im.file))!==im.sha256)throw new Error('执行文件已变化：'+im.name);
    await menu(page,{selector:'.mainImage button',text:'选择图片'},'本地图片');
    await poll(()=>page.evaluate(()=>Boolean(document.querySelector('#localFileUploadInp'))),{label:`第 ${urls.length+1} 张主图的上传控件`});
    const document=await page.send('DOM.getDocument',{depth:1});
    const {nodeId}=await page.send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#localFileUploadInp'});
    if(!nodeId)throw new Error('没有找到主图上传控件');
    await page.send('DOM.setFileInputFiles',{nodeId,files:[im.file]});
    const next=await poll(async()=>{const a=await read();return a.length===urls.length+1&&a.every(u=>u.startsWith('https://wxalbum-10001658-file.dianxiaomi.com/'))?a:null;},{timeout,label:`第 ${urls.length+1} 张主图上传完成`});
    equal(next.slice(0,-1),urls,'上传期间主图顺序改变');
    const response=await fetch(next.at(-1),{signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok||sha(Buffer.from(await response.arrayBuffer()))!==im.sha256)throw new Error('上传图片与本地执行文件不一致，未保存商品');
    urls.push(next.at(-1));
  }
  await read();
  return urls;
}

export async function runDraft({store,row,browserKey,browserConfig=config,onProgress=()=>{},evidenceDirectory,draftSession}){
  if(!browserConfig||browserKey!==(browserConfig.key||browserConfig.browserId))throw new Error('比特窗口与配置不一致');
  const configured=[store];
  fs.mkdirSync(evidenceDirectory,{recursive:true});
  const evidence=(name,data)=>fs.writeFileSync(path.join(evidenceDirectory,name+'.json'),JSON.stringify(data,null,2));
  const lock=path.resolve(evidenceDirectory,'../../..','erp-execution.lock');fs.mkdirSync(path.dirname(lock),{recursive:true});
  let lockFd;
  if(fs.existsSync(lock)){
    let previous;try{previous=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{}
    if(Number.isInteger(previous?.pid)&&previous.pid>0){try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')fs.unlinkSync(lock);}}
  }
  try{lockFd=fs.openSync(lock,'wx');fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,at:new Date().toISOString(),code:row.productCode}));}
  catch{throw new Error('另一个执行器持有浏览器任务锁，请核对正在运行的任务');}
  let session=draftSession,page,targetId,claimed=false,phase='连接浏览器';
  const progress=(name,label,detail={})=>{phase=label;onProgress(name,{step:label,...detail});};
  try{
    progress('connecting','连接浏览器');session??=await createDraftSession(browserConfig);session.begin();
    // A manual retry may retire only its own identified, still-unsaved failed editor.
    await session.retireFailure(row,store);
    const inspector=await session.page('inspector');page=inspector.page;targetId=inspector.targetId;
    progress('checking-duplicates','核对待发布列表中的重复 SKU');
    const initial=await pendingList(page);evidence('pending-before',initial);
    if(initial.rows.some(r=>r.text.split(/\s+/).includes(row.sku)))throw new Error('店小秘已有相同 SKU，请先核对现有商品：'+row.sku);
    progress('reading-mother','读取母稿');const {mother,extra}=await readMother(page,store);
    evidence('mother-before',{mother,extra});
    ({page,targetId}=await session.page('editor'));
    progress('building','引用母稿创建副本',{targetId,attemptToken:null});
    await copyMother(page,store,mother,extra);
    const attemptToken=await session.claim(page,store,row);claimed=true;
    progress('filling','填写商品字段',{targetId,attemptToken});
    validateMainImageCount(row.images.length,await page.evaluate(()=>document.querySelector('.mainImage')?.innerText||''));
    await fill(page,{formLabel:'产品标题',descendant:'input:not([type=hidden]),textarea'},row.title);
    await fill(page,{formLabel:'英文标题',descendant:'input:not([type=hidden]),textarea'},row.englishTitle);
    await fill(page,{formLabel:'产品货号',descendant:'input'},row.productCode);
    await fill(page,{selector:'input[name="variationSku"]'},row.sku);
    for(const name of ['price','skuLength','skuWidth','skuHeight','weight','identifierCode']){
      const v=mother.variantFields[name];if(v.length!==1)throw new Error('母稿缺少字段：'+name);await fill(page,{selector:`input[name="${name}"]`},v[0]);
    }
    await poll(()=>page.evaluate(()=>document.getElementsByName('stock').length===1),{label:'副本库存字段加载'});
    for(const name of ['stock','skuCategoryNum','numberOfPiecesNew'])if(mother.variantFields[name].length===1)
      await fill(page,{selector:`input[name="${name}"]`},mother.variantFields[name][0]);
    await setPreservedSkuPreview(page,mother.media.skuPreviewImages[0]);
    progress('clearing-description','清空副本继承的旧详情');await clearInheritedDescription(page,extra.description);
    progress('clearing-images','清空副本继承的旧主图');
    await clearInheritedMainImages(page,mother.media.mainImages);
    progress('uploading','上传新主图');const urls=await uploadMainImages(page,row.images,{motherId:store.draftId,attemptToken,sku:row.sku});
    progress('description','将主图写入详情');await fillEmptyDescriptionFromMainImages(page);
    const prepared=await page.evaluate(readPage,{...store,isNew:true,quoteSourceId:store.draftId});
    equal(value(prepared,'产品标题'),row.title);equal(value(prepared,'英文标题'),row.englishTitle);equal(value(prepared,'产品货号'),row.productCode);
    equal(prepared.media,{mainImages:urls,detailImages:urls,skuPreviewImages:mother.media.skuPreviewImages});
    equal(prepared.variantFields,{...mother.variantFields,variationSku:[row.sku]},'SKU 规格字段与母稿不同');
    evidence('prepared',prepared);
    // Journal before the one irreversible-in-this-run save attempt. No automatic replay on ambiguity.
    progress('saving','保存到待发布');await click(page,{selector:'button',text:'保存',index:0});
    await poll(()=>page.evaluate(()=>[...document.querySelectorAll('.ant-modal')].some(e=>e.getClientRects().length&&e.innerText.includes('您的产品已保存到「待发布」'))),{timeout:45000,label:'店小秘保存成功回执'});
    await click(page,{selector:'.ant-modal button',text:'继续编辑'});
    const draftId=await poll(()=>navigating(()=>page.evaluate(()=>location.pathname==='/web/popTemu/edit'?new URL(location.href).searchParams.get('id'):null)),{timeout:30000,label:'保存后的新草稿 ID'});
    if(configured.some(s=>s.draftId===draftId))throw new Error('保存结果指向母稿，停止');
    const url='https://www.dianxiaomi.com/web/popTemu/edit?id='+draftId;progress('reading-back','回读核验已保存商品',{draftId,url});
    page=inspector.page;targetId=inspector.targetId;
    const readback=await readDraft(page,store,draftId,prepared);equal(stable(readback),stable(prepared),'服务端回读与保存前不一致');
    progress('checking-mother','核验母稿未变');const motherAfter=await readDraft(page,store,store.draftId,mother);equal(stable(motherAfter),stable(mother),'母稿发生变化');
    progress('checking-saved-sku','核验待发布 SKU 唯一');
    const list=await pendingList(page);equal(list.rows.filter(r=>r.id===draftId&&r.text.split(/\s+/).includes(row.sku)).length,1,'待发布记录核验失败');
    equal(list.rows.filter(r=>r.text.split(/\s+/).includes(row.sku)).length,1,'待发布 SKU 重复');
    const result={draftId,url,verifiedAt:new Date().toISOString(),published:false,sourceUnchanged:true,
      checks:{store:true,site:true,mainAndDetail:true,skuPreview:true,serverPersistence:true,uniquePendingSku:true},
      limitations:['沿用母稿的类目、规格、价格、库存与运费设置；本步骤不验证正式发布条件']};
    evidence('verification',{...result,readback,motherAfter,pending:list});
    return result;
  }catch(error){
    if(claimed)session.keepEditor();
    let state;try{state=page&&await page.evaluate(readAutomationState);}catch{}
    const wait=error.waitLabel?error:error.cause||error;
    const message=`${row.productCode} · ${phase}：${error.message}`;
    const failure={at:new Date().toISOString(),message,productCode:row.productCode,phase,targetId,waitLabel:wait.waitLabel,waitMs:wait.waitMs,state,stack:error.stack};
    evidence('error',failure);
    // Preserve each attempt's diagnostics instead of overwriting the only failure record.
    evidence('error-'+failure.at.replace(/[:.]/g,'-'),failure);
    if(page)try{const shot=await page.send('Page.captureScreenshot',{format:'png'}),bytes=Buffer.from(shot.data,'base64');fs.writeFileSync(path.join(evidenceDirectory,'failure.png'),bytes);fs.writeFileSync(path.join(evidenceDirectory,'failure-'+failure.at.replace(/[:.]/g,'-')+'.png'),bytes);}catch{}
    throw Object.assign(new Error(message,{cause:error}),{code:error.code,step:phase,waitLabel:wait.waitLabel,waitMs:wait.waitMs});
  }finally{try{if(!draftSession)await session?.close();}finally{if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}}}
}
