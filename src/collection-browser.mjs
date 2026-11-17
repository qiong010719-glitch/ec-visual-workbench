import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {temuGoodsId} from './geekbi.mjs';

const COLLECTION_URL='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition';
// These operations run in the workbench's explicitly bound browser, never a copied personal profile.
export function createCollectionBrowser(configuration){
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const library=()=>import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  async function withPage(bound,url,fn,{keep=false}={}){
    const lib=await library(),info=await lib.connection(bound.browserConfig),chrome=await lib.connect(info.ws);
    let page,targetId,finished=false;
    try{
      ({targetId}=await chrome.send('Target.createTarget',{url:'about:blank'}));
      page=await lib.pageById(info,targetId);await page.send('Page.enable');await page.send('Page.navigate',{url});
      await lib.poll(async()=>{try{return await page.evaluate(expected=>location.origin===expected&&document.readyState==='complete',new URL(url).origin);}catch{return false;}},{timeout:45000,label:'页面加载'});
      const result=await fn(page,lib);finished=true;return result;
    }finally{page?.close();if(finished&&!keep&&targetId)await chrome.send('Target.closeTarget',{targetId}).catch(()=>{});chrome.close();}
  }
  async function checkAccount(page,expected){
    const value=await page.evaluate(()=>({url:location.href,account:document.querySelector('.btn-user .user-name')?.textContent.trim()||''}));
    if(!value.url.startsWith(COLLECTION_URL)||!expected||value.account!==expected)throw new Error('店小秘页面未就绪、未登录或账号与绑定不一致，请在此工作台绑定的浏览器中登录后检查。');
  }
  async function clickText(page,text){
    const result=await page.evaluate(text=>{const matches=[...document.querySelectorAll('button')].filter(el=>el.getClientRects().length&&!el.disabled&&el.textContent.trim()===text);if(matches.length!==1)return null;const el=matches[0];el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!el.contains(document.elementFromPoint(x,y)))return null;return {x,y};},text);
    if(!result)throw new Error(`未找到唯一的“${text}”按钮，页面已保留，请人工核对。`);
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...result});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...result});
  }
  async function fill(page,selector,value){
    const ok=await page.evaluate(({selector,value})=>{const el=document.querySelector(selector);if(!el||!el.getClientRects().length||el.disabled||el.readOnly)return false;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();if(!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return false;const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value===value;},{selector,value});
    if(!ok)throw new Error('采集页面输入框已变化，请人工核对后再继续。');
  }
  async function scanTab(page,lib,suffix,sourceUrl,goodsId){
    const found=await page.evaluate(suffix=>{const el=[...document.querySelectorAll('[role="tab"]')].find(e=>e.id.endsWith(suffix)&&e.getClientRects().length);if(!el)return false;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();if(!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return false;el.click();return true;},suffix);
    if(!found)throw new Error('未找到店小秘采集箱分类，不能确认采集结果。');
    await lib.poll(()=>page.evaluate(suffix=>[...document.querySelectorAll('[role="tab"]')].some(e=>e.id.endsWith(suffix)&&e.getAttribute('aria-selected')==='true'),suffix),{label:'采集箱分类'});
    // The site's default search mode is title, not URL. Clear it and inspect exact
    // links in the current result page; absence is unknown, never proof of failure.
    await fill(page,'#c-searchValue','');await clickText(page,'搜索');
    // A successful row must be visible under the selected tab and contain the exact product link.
    // The modal's success counter alone is insufficient evidence of a saved product.
    const until=Date.now()+10000;
    do{
      const result=await page.evaluate(({sourceUrl,goodsId,suffix})=>{
        const tab=[...document.querySelectorAll('[role="tab"]')].find(e=>e.id.endsWith(suffix));
        if(tab?.getAttribute('aria-selected')!=='true')return null;
        if(/\(0\)/.test(tab.textContent)||[...document.querySelectorAll('.ant-spin-spinning')].some(e=>e.getClientRects().length))return null;
        // This page renders its tables outside the Ant tabpanel container.
        const a=[...document.querySelectorAll('table a[href]')].find(e=>e.getClientRects().length&&(e.href===sourceUrl||new RegExp('-g-'+goodsId+'\\.html(?:[?#]|$)').test(e.href)));
        const row=a?.closest('tr');if(!row)return null;
        const text=row.innerText.trim();
        if(!text)return null;
        const header=[...document.querySelectorAll('th')].find(e=>e.getClientRects().length&&e.textContent.trim()==='标题');
        const column=header&&[...header.classList].find(c=>/^col_\d+$/.test(c));
        const title=column?row.querySelector('.'+column)?.textContent.trim():'';
        return {sourceUrl:a.href,rowText:text.slice(0,4000),title:title||'',hasImage:[...row.querySelectorAll('img')].some(i=>i.naturalWidth>0)};
      },{sourceUrl,goodsId,suffix});
      if(result)return result;
      await new Promise(resolve=>setTimeout(resolve,650));
    }while(Date.now()<until);
    return null;
  }
  async function verifyPage(page,lib,args){
    await checkAccount(page,args.erpConnection.expectedAccount);
    const good=await scanTab(page,lib,'-no',args.sourceUrl,args.goodsId);
    if(good?.hasImage&&good.title&&!/采集失败|采集中/.test(good.rowText))return {status:'verified',evidence:{...good,tab:'未认领',account:args.erpConnection.expectedAccount,url:COLLECTION_URL},error:null};
    const bad=await scanTab(page,lib,'-FAILED',args.sourceUrl,args.goodsId);
    if(bad)return {status:'failed',evidence:{...bad,tab:'采集失败',url:COLLECTION_URL},error:'店小秘显示采集失败。'+bad.rowText};
    return {status:'needs-review',error:'未在“未认领”或“采集失败”分类找到可确认的商品记录，请在采集箱核对；不会自动重发。'};
  }
  return {
    open:bound=>withPage(bound,COLLECTION_URL,async()=>({url:COLLECTION_URL,message:'已在绑定浏览器打开店小秘采集箱。请检查账号、Temu访问和采集插件。'}),{keep:true}),
    resolve:args=>withPage(args,'https://www.temu.com/search_result.html?'+new URLSearchParams({search_key:args.goodsId,search_method:'user',...(args.site?.regionId?{region:args.site.regionId}:{})}),async(page,lib)=>{
      const url=await lib.poll(async()=>{
        const links=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].filter(a=>a.getClientRects().length).map(a=>a.href));
        return links.find(link=>temuGoodsId(link)===args.goodsId);
      },{timeout:30000,label:'与商品ID一致的 Temu 原始详情链接（如有验证请在浏览器完成）'});
      return {sourceUrl:url,sourceResolvedAt:new Date().toISOString(),sourceMethod:'temu-visible-product-link',sourceMarketNote:'Temu 前端可能沿用浏览器地区；采集内容以该原始商品页面为准，价格可能与极鲸云站点快照不同。'};
    }),
    collect:args=>withPage(args,COLLECTION_URL,async(page,lib)=>{
      if(temuGoodsId(args.sourceUrl)!==args.goodsId)throw new Error('原始详情链接与所选商品ID不一致');
      await lib.poll(()=>page.evaluate(()=>!!document.querySelector('textarea[placeholder^="请填写产品详情页"]')),{label:'链接采集表单'});
      await checkAccount(page,args.erpConnection.expectedAccount);
      await fill(page,'textarea[placeholder^="请填写产品详情页"]',args.sourceUrl);
      const guard=await page.evaluate(()=>{
        const label=[...document.querySelectorAll('label')].find(e=>e.getClientRects().length&&e.textContent.includes('自动认领'));
        const box=label?.querySelector('input[type="checkbox"]');if(!box)return false;if(box.checked)box.click();return true;
      });
      if(!guard)throw new Error('不能确认“自动认领”开关，未提交采集。');
      const safe=await page.evaluate(sourceUrl=>{const box=[...document.querySelectorAll('label')].find(e=>e.textContent.includes('自动认领'))?.querySelector('input[type="checkbox"]');return box&&!box.checked&&document.querySelector('textarea[placeholder^="请填写产品详情页"]')?.value===sourceUrl;},args.sourceUrl);
      if(!safe)throw new Error('采集条件已变化，未提交。');
      await checkAccount(page,args.erpConnection.expectedAccount);
      args.beforeSubmit();await clickText(page,'开始采集');
      await lib.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.ant-modal')].some(e=>e.getClientRects().length&&/采集完成/.test(e.innerText))),{timeout:90000,interval:1000,label:'店小秘采集完成'});
      await page.evaluate(()=>{const modal=[...document.querySelectorAll('.ant-modal')].find(e=>e.getClientRects().length&&/采集完成/.test(e.innerText));modal?.querySelector('.ant-modal-close')?.click();});
      return verifyPage(page,lib,args);
    },{keep:true}),
    verify:args=>withPage(args,COLLECTION_URL,(page,lib)=>verifyPage(page,lib,args),{keep:true})
  };
}
