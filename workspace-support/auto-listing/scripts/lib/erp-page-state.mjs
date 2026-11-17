import {poll} from './bit-cdp.mjs';

// A document can be replaced while a read is in flight. Only read-only checks retry.
export async function navigating(read) {
  try { return await read(); }
  catch(error) {
    if (/Execution context was destroyed|Cannot find context|Inspected target navigated|Cannot find default execution context/i.test(error.message)) return false;
    throw error;
  }
}

export async function navigateAndWait(page,url,ready,arg,{label,timeout=40000}={}) {
  const navigation=await page.send('Page.navigate',{url});
  if(navigation.errorText)throw new Error(`${label}：页面打开失败（${navigation.errorText}）`);
  return poll(()=>navigating(async()=>{
    if(navigation.loaderId){
      const tree=await page.send('Page.getFrameTree');
      if(tree.frameTree.frame.loaderId!==navigation.loaderId)return false;
    }
    const matches=await page.evaluate(expected=>{
      const u=new URL(expected);
      return ['www.dianxiaomi.com','dianxiaomi.com'].includes(location.hostname)
        &&location.pathname===u.pathname&&[...u.searchParams].every(([k,v])=>new URL(location.href).searchParams.get(k)===v)
        &&document.readyState!=='loading';
    },url);
    return matches&&await page.evaluate(ready,arg);
  }),{timeout,label});
}

// Restrict failure diagnostics to UI structure, never credentials or input values.
export function readAutomationState() {
  const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const selectors=['#wirelessDescBox','#baiduStatisticsSmtNewEditorEditClickNum button','.smt-content-center','.ant-modal .menu-button','.custom-batch-btn li','.custom-delete-btn li','.batch-smt-image-content','.mainImage .img-list img','.smt-content-center .desc-img-box img','#wirelessDescContentBox img'];
  const u=new URL(location.href),id=u.searchParams.get('id');
  return {url:u.origin+u.pathname+(/^\d{6,30}$/.test(id||'')?'?id='+id:''),readyState:document.readyState,visibility:document.visibilityState,
    documentStartedAt:new Date(performance.timeOrigin).toISOString(),navigationType:performance.getEntriesByType('navigation')[0]?.type,
    hasAttemptMarker:!!document.documentElement.dataset.workbenchAttempt,
    controls:selectors.map(selector=>{const nodes=[...document.querySelectorAll(selector)];return {selector,total:nodes.length,visible:nodes.filter(visible).length,disabled:nodes.filter(e=>e.disabled||e.getAttribute('aria-disabled')==='true').length};}),
    modals:[...document.querySelectorAll('.ant-modal')].filter(visible).map(e=>({title:e.querySelector('.ant-modal-title')?.textContent.trim().slice(0,120)||'',buttons:[...e.querySelectorAll('button')].filter(visible).map(b=>b.textContent.trim().slice(0,50))}))};
}
