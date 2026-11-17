import fs from 'node:fs';
import path from 'node:path';
import {connection,connect,pageById,poll} from './bit-cdp.mjs';

const publishPath=/^\/api\/popTemuProduct\/batchPublish[^/]*\.json$/;
const exactId=value=>typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';
const identity=x=>exactId(typeof x==='object'&&x?(x.idStr??x.dxmProductIdStr??x.id):x);
// JSON numbers can contain 18-digit ERP IDs. Preserve the source digits before rounding.
export const parseErpResponse=text=>JSON.parse(text,(_key,value,context)=>typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)?context?.source??null:value);
export function publicationReceipt(body,id){
  let value=body;for(let depth=0;depth<4&&!value?.successList&&!value?.failList;depth++)value=value?.bor??value?.data;
  if(value?.failList?.some(x=>identity(x)===id))return {publicationStatus:'failed',error:String(value.failList.find(x=>identity(x)===id).msg||'店小秘拒绝发布').slice(0,1000)};
  if(value?.successList?.some(x=>identity(x)===id))return {publicationStatus:'submitted',submittedAt:new Date().toISOString(),published:false};
  return null;
}
export function listingPublication(body,id){
  let found;
  const walk=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>8||found)return;if(identity(v)===id&&(v.dxmState||v.dxmOfflineState||v.productStatus)){found=v;return;}for(const x of Object.values(v))walk(x,depth+1);};walk(body);
  if(!found)return null;
  const offline=found.dxmOfflineState,status=found.productStatus;
  const state=status==='ONLINE'?'online':status==='PENDING_APPROVAL'?'reviewing':status==='PENDING_LAUNCH'?'pending-launch':found.dxmState==='online'?'listed':offline==='publishFail'?'failed':offline==='publishing'?'submitted':found.dxmState==='offline'&&(!offline||offline==='waitPublish')?'draft':'unknown';
  return {publicationStatus:state,published:state==='online',checkedAt:new Date().toISOString(),platformStatus:status||null,erpState:found.dxmState||null,erpOfflineState:offline||null,platformProductId:exactId(found.productIdStr??found.productId)||null,error:state==='failed'?String(found.errMsg||found.errorMsg||found.failReason||found.errorInfo||'店小秘显示发布失败，请打开店小秘查看原因').slice(0,1000):null};
}
async function ownedPage(browserConfig,work){const info=await connection(browserConfig),browser=await connect(info.ws);let page,targetId,keep=false;try{({targetId}=await browser.send('Target.createTarget',{url:'about:blank'}));page=await pageById(info,targetId);return await work(page);}catch(e){keep=!!e.keepReviewPage;if(keep)e.reviewTargetId=targetId;throw e;}finally{page?.close();if(targetId&&!keep)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}}
async function openList(page,list,ready=()=>true){
  const navigation=await page.send('Page.navigate',{url:'https://www.dianxiaomi.com/web/popTemu/pageList/'+list});
  if(navigation.errorText)throw new Error('店小秘列表打开失败：'+navigation.errorText);
  await poll(async()=>{try{if(!ready())return false;const tree=await page.send('Page.getFrameTree');if(navigation.loaderId&&tree.frameTree.frame.loaderId!==navigation.loaderId)return false;return await page.evaluate(()=>/共\s*\d+\s*条记录/.test(document.body?.innerText||'')||[...document.querySelectorAll('.vxe-table--empty-content,.ant-empty-description')].some(e=>e.getClientRects().length&&e.textContent.includes('暂无数据')));}catch(e){if(/context.*destroyed|Cannot find context|context with specified/i.test(e.message))return false;throw e;}},{timeout:30000});
}
async function locateDraft(page,id){
  for(let count=0;count<100;count++){
    const ids=await page.evaluate(()=>[...document.querySelectorAll('tr[rowid]')].filter(e=>e.getClientRects().length).map(e=>e.getAttribute('rowid')));
    if(ids.includes(id))return true;
    const moved=await page.evaluate(()=>{const next=document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');if(!next||next.getAttribute('aria-disabled')==='true')return false;next.click();return true;});if(!moved)return false;
    await poll(()=>page.evaluate(old=>{const ids=[...document.querySelectorAll('tr[rowid]')].filter(e=>e.getClientRects().length).map(e=>e.getAttribute('rowid'));return ids.length&&JSON.stringify(ids)!==JSON.stringify(old);},ids),{timeout:30000});
  }
  throw new Error('已检查 100 页仍未找到该草稿，请在店小秘按货号核对');
}
function capture(page,matcher,accept){
  const tracked=new Set(),pending=new Set();let result=null,loaded=false;
  const offResponse=page.on('Network.responseReceived',e=>{let u;try{u=new URL(e.response.url);}catch{return;}if(['www.dianxiaomi.com','dianxiaomi.com'].includes(u.hostname)&&matcher(u.pathname))tracked.add(e.requestId);});
  const offFinished=page.on('Network.loadingFinished',e=>{if(!tracked.has(e.requestId))return;const work=page.send('Network.getResponseBody',{requestId:e.requestId}).then(r=>{const s=r.base64Encoded?Buffer.from(r.body,'base64').toString():r.body;const v=accept(parseErpResponse(s));loaded=true;if(v)result=v;}).catch(()=>{}).finally(()=>pending.delete(work));pending.add(work);});
  return {get result(){return result;},get loaded(){return loaded;},async settle(){await Promise.allSettled([...pending]);},async close(){offResponse();offFinished();await Promise.allSettled([...pending]);}};
}
export async function checkPublication({row,browserConfig}){
  return ownedPage(browserConfig,page=>checkPublicationOnPage(page,{row}));
}
export async function checkPublicationOnPage(page,{row}){
  await page.send('Network.enable');let fallback;
  // A published product can move between lists. Never let an old pending result mask it.
  for(const list of ['online','offline?dxmOfflineState=publishing','offline?dxmOfflineState=publishFail','offline']){
    const observer=capture(page,p=>p==='/api/popTemuProduct/pageList.json',body=>listingPublication(body,row.draftId));
    try{
      await openList(page,list,()=>observer.loaded);await locateDraft(page,row.draftId);await observer.settle();
      const result=observer.result;
      if(result&&!['draft','unknown'].includes(result.publicationStatus))return result;
      if(result&&(!fallback||result.publicationStatus==='draft'))fallback=result;
    }finally{await observer.close();}
  }
  return fallback||{publicationStatus:'unknown',published:false,error:'当前列表未找到可确认的发布状态，请在店小秘核对该草稿；不会自动再次提交。'};
}
export async function publishDraft({store,row,browserConfig,onProgress=()=>{},evidenceDirectory}){
  return ownedPage(browserConfig,page=>publishDraftOnPage(page,{store,row,onProgress,evidenceDirectory},{readPublication:()=>checkPublication({row,browserConfig})}));
}
export async function publishDraftOnPage(page,{store,row,onProgress=()=>{},evidenceDirectory},{receiptTimeout=60000,readPublication}={}){
  if(!/^\d{6,30}$/.test(row.draftId)||row.draftId===store.draftId||!row.verifiedAt)throw new Error('只能发布本批已保存并核验的新草稿');
    let attempted=false,listing;
    await page.send('Network.enable');const observer=capture(page,p=>publishPath.test(p),body=>publicationReceipt(body,row.draftId));
    try{
      const preflight=capture(page,p=>p==='/api/popTemuProduct/pageList.json',()=>null);
      try{await openList(page,'offline',()=>preflight.loaded);}finally{await preflight.close();}
      if(!await locateDraft(page,row.draftId))throw new Error('待发布列表未找到该草稿，请先在店小秘核对其状态');
      // Select this draft only; never use the bulk toolbar or another visible row.
      await page.evaluate(({id,sku,name,site,account})=>{
        if(location.pathname!=='/web/popTemu/pageList/offline')throw new Error('不在待发布页面');
        if(account&&document.querySelector('.btn-user .user-name')?.textContent.trim()!==account)throw new Error('店小秘账号不匹配');
        const rows=[...document.querySelectorAll('tr[rowid]')].filter(e=>e.getAttribute('rowid')===id&&e.getClientRects().length);
        if(rows.length!==1||!rows[0].innerText.split(/\s+/).includes(sku)||!rows[0].innerText.includes('「'+name+'」')||!rows[0].innerText.includes(site.replace(/站$/,'')))throw new Error('当前页未找到与草稿 ID、SKU、店铺和站点完全匹配的商品，请在店小秘核对');
        const buttons=[...rows[0].querySelectorAll('button.ant-dropdown-trigger')].filter(e=>e.textContent.trim()==='发布');
        if(buttons.length!==1)throw new Error('未找到该草稿的发布入口');
        buttons[0].dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));buttons[0].dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
      },{id:row.draftId,sku:row.sku,name:store.expectedStore,site:store.expectedSite,account:store.erpConnection?.expectedAccount});
      await poll(()=>page.evaluate(()=>[...document.querySelectorAll('[role="menuitem"]')].filter(e=>e.getClientRects().length&&e.innerText.trim()==='发布').length===1),{timeout:10000});
      listing=capture(page,p=>p==='/api/popTemuProduct/pageList.json',body=>{const result=listingPublication(body,row.draftId);return result&&['submitted','listed','online','reviewing','pending-launch','failed'].includes(result.publicationStatus)?result:null;});
      onProgress('publishing',{publicationAttemptedAt:new Date().toISOString()});
      attempted=true;
      await page.evaluate(()=>{const menu=[...document.querySelectorAll('[role="menuitem"]')].filter(e=>e.getClientRects().length&&e.innerText.trim()==='发布');if(menu.length!==1)throw new Error('发布菜单已变化');menu[0].click();});
      // Site validations may show dialogs. Never auto-accept price or banned-word changes.
      let result;try{result=await poll(()=>observer.result||listing.result,{timeout:receiptTimeout,interval:500});}catch{
        const reason=await page.evaluate(()=>[...document.querySelectorAll('.ant-modal,.ant-message-notice-content')].filter(e=>e.getClientRects().length).map(e=>e.innerText).join('\n').slice(0,1200));
        if(!reason&&readPublication){
          // A lost receipt is read back in a separate page; the review page remains intact.
          const checked=await readPublication().catch(()=>null);
          if(checked&&['submitted','listed','online','reviewing','pending-launch','failed'].includes(checked.publicationStatus))result=checked;
        }
        if(!result)
        throw new Error('发布结果待核对'+(reason?'：'+reason:'，未取得该草稿的明确提交回执'));
      }
      fs.writeFileSync(path.join(evidenceDirectory,'publication.json'),JSON.stringify({draftId:row.draftId,...result},null,2));
      return result;
    }catch(e){if(attempted)e.keepReviewPage=true;throw e;}finally{await observer.close();await listing?.close();}
}
