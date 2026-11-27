import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createTemuCaptchaSolver} from './temu-captcha.mjs';
import {readTemuSourceFacts,normalizeTemuSourceFacts} from './temu-source-facts.mjs';

export function productIdentity(value){
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||!['www.temu.com','temu.com'].includes(u.hostname)||u.username||u.password||u.port)return null;
    const id=u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||(u.pathname==='/goods.html'?u.searchParams.get('goods_id'):null);
    return /^\d{6,32}$/.test(id||'')?id:null;
  }catch{return null;}
}
export const searchUrl=keyword=>'https://www.temu.com/search_result.html?'+new URLSearchParams({search_key:keyword,search_method:'user'}).toString().replaceAll('+','%20');

// Verified search-list markers; product recommendations elsewhere on the page are excluded.
function scrollTemuSearchPage({keyword}){
  const url=new URL(location.href);
  if(url.protocol!=='https:'||!['www.temu.com','temu.com'].includes(url.hostname)||url.username||url.password||url.port||url.pathname!=='/search_result.html'||url.searchParams.get('search_key')!==keyword)return {status:'changed',url:location.href};
  const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  if([...document.querySelectorAll('#verification,[id*="captcha"],[class*="captcha"]')].some(visible))return {status:'verification',url:location.href};
  const lists=[...document.querySelectorAll('.js-search-goodsList')].filter(visible);
  const fallback=[...document.querySelectorAll('main .autoFitGoodsList,[role="main"] .autoFitGoodsList')].filter(visible);
  const list=lists.length===1?lists[0]:lists.length===0&&fallback.length===1?fallback[0]:null;
  if(!list)return {status:'unsupported',url:location.href};
  const more=[...list.querySelectorAll('button,[role="button"]')].filter(e=>visible(e)&&/^(查看更多|加载更多|view more|show more|load more)$/i.test(e.innerText.trim())&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  if(more.length>1)return {status:'unsupported',url:location.href};
  if(more.length===1){
    more[0].scrollIntoView({block:'center'});
    const rect=more[0].getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    if(more[0].contains(document.elementFromPoint(x,y)))return {status:'load-more',url:location.href,button:{x,y}};
  }
  let scroller=document.scrollingElement;
  for(let parent=list.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
    if(/auto|scroll/.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight+2){scroller=parent;break;}
  }
  if(!scroller)return {status:'unsupported',url:location.href};
  const viewport=scroller===document.scrollingElement?innerHeight:scroller.clientHeight;
  const before=scroller.scrollTop,max=Math.max(0,scroller.scrollHeight-viewport);
  scroller.scrollTo({top:Math.min(max,before+Math.max(300,Math.round(viewport*0.85))),left:scroller.scrollLeft,behavior:'instant'});
  return {status:'scrolled',url:location.href,before,after:scroller.scrollTop,atEnd:scroller.scrollTop>=max-2};
}

function readSearchProductAction({keyword,goodsId,point}){
  const url=new URL(location.href);
  if(url.protocol!=='https:'||!['www.temu.com','temu.com'].includes(url.hostname)||url.username||url.password||url.port||url.pathname!=='/search_result.html'||url.searchParams.get('search_key')!==keyword)return {status:'changed'};
  const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  if([...document.querySelectorAll('#verification,[id*="captcha"],[class*="captcha"]')].some(visible))return {status:'verification'};
  const lists=[...document.querySelectorAll('.js-search-goodsList')].filter(visible),fallback=[...document.querySelectorAll('main .autoFitGoodsList,[role="main"] .autoFitGoodsList')].filter(visible);
  const list=lists.length===1?lists[0]:lists.length===0&&fallback.length===1?fallback[0]:null;
  const grids=list?[...list.querySelectorAll('.autoFitGoodsList')].filter(visible):[];
  if(!list||grids.length>1)return {status:'unsupported'};
  const links=[...(grids[0]||list).querySelectorAll('a[href]')].filter(anchor=>{
    if(!visible(anchor)||anchor.closest('aside,nav,[role="complementary"],[role="navigation"]'))return false;
    const value=new URL(anchor.href),id=value.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||(value.pathname==='/goods.html'?value.searchParams.get('goods_id'):null);
    return value.protocol==='https:'&&['www.temu.com','temu.com'].includes(value.hostname)&&!value.username&&!value.password&&!value.port&&id===goodsId;
  });
  const safeHit=hit=>hit&&!hit.closest('button,[role="button"],input,select,textarea')&&!/采到店小秘|采集到店小秘|开始采集/.test(hit.innerText||hit.textContent||'');
  if(point){
    const hit=document.elementFromPoint(point.x,point.y),anchor=safeHit(hit)&&links.find(link=>link.contains(hit));
    return anchor?{status:'ready',point,sourceUrl:anchor.href}:{status:'blocked'};
  }
  for(const anchor of links){
    for(const element of [...anchor.querySelectorAll('img'),anchor].filter(visible)){
      element.scrollIntoView({block:'center',inline:'center'});
      const rect=element.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2,hit=document.elementFromPoint(x,y);
      if(rect.width>0&&rect.height>0&&safeHit(hit)&&anchor.contains(hit))return {status:'ready',point:{x,y},sourceUrl:anchor.href};
    }
  }
  return {status:links.length?'blocked':'missing'};
}

// Observe visible page state. The bounded CAPTCHA adapter handles supported challenges.
export function readTemuPage(){
  const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const text=document.body?.innerText||'';
  const roots=[document];
  for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
  const all=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)]).filter(visible);
  if(location.pathname==='/bgn_no_access.html'||/没有网络连接|无法连接到互联网|no internet connection|unable to connect to the internet/i.test(text))return {status:'waiting-network',message:'Temu 返回“没有网络连接”访问失败页，尚未进入验证码。请先恢复该浏览器对 Temu 的访问，再继续本任务。',url:location.href};
  const challenge=/(?:拖动|滑动).{0,24}(?:滑块|验证|拼图)|完成安全验证|请完成验证|确认您是真人|请验证您|verify (?:that )?you(?:'re| are) (?:a )?human|security verification|drag.{0,40}(?:slider|puzzle)|slide.{0,30}verify/i.test(text)||
    /(?:captcha|challenge|verification)/i.test(location.pathname)||all('iframe').some(e=>/captcha|challenge/i.test((e.getAttribute('src')||'')+' '+e.title))||all('#verification,[id*="captcha"],[class*="captcha"],[id*="Captcha"],[class*="Captcha"]').length>0;
  if(challenge)return {status:'waiting-verification',message:'Temu 出现安全验证，当前页和进度已保留。',url:location.href};
  const login=/\/(?:login|signin)(?:\.|\/|$)/i.test(location.pathname)||all('[role="dialog"]').some(e=>/登录后继续|sign in to continue|log in to continue/i.test(e.innerText));
  if(login)return {status:'waiting-login',message:'请在原浏览器完成 Temu 登录，然后点击继续。',url:location.href};
  const productUrl=new URL(location.href);
  const goodsId=productUrl.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||(productUrl.pathname==='/goods.html'?productUrl.searchParams.get('goods_id'):null);
  const validProductUrl=productUrl.protocol==='https:'&&['www.temu.com','temu.com'].includes(productUrl.hostname)&&!productUrl.username&&!productUrl.password&&!productUrl.port&&/^\d{6,32}$/.test(goodsId||'');
  if(validProductUrl&&!all('h1,#goodsDetail').length){
    const soldOut=all('*').filter(el=>{
      if(el.children.length||(el.innerText||el.textContent||'').trim()!=='此商品已售罄。')return false;
      for(let parent=el;parent;parent=parent.parentElement)if(parent.hidden||parent.getAttribute('aria-hidden')==='true'||getComputedStyle(parent).opacity==='0')return false;
      return true;
    });
    if(soldOut.length===1)return {status:'unavailable',url:location.href,message:'商品详情暂不可用（页面显示售罄）：Temu 显示“此商品已售罄。”，且未显示商品标题或详情；未点击采集。',evidence:{kind:'temu-sold-out',goodsId,text:'此商品已售罄。',titlePresent:false,detailsPresent:false}};
  }
  let productLinks=all('a[href]'),searchListStatus;
  if(location.pathname==='/search_result.html'){
    const lists=all('.js-search-goodsList');
    const fallback=all('main .autoFitGoodsList,[role="main"] .autoFitGoodsList');
    const list=lists.length===1?lists[0]:lists.length===0&&fallback.length===1?fallback[0]:null;
    const grids=list?[...list.querySelectorAll('.autoFitGoodsList')].filter(visible):[];
    searchListStatus=!list?'unavailable':grids.length>1?'ambiguous':'ready';
    const scope=searchListStatus==='ready'?(grids[0]||list):null;
    productLinks=scope?[...scope.querySelectorAll('a[href]')].filter(a=>visible(a)&&!a.closest('aside,nav,[role="complementary"],[role="navigation"]')):[];
  }
  // Preserve the actual absolute href, including any query; identity deduplication happens later.
  const products=productLinks.map(a=>({sourceUrl:a.href,title:(a.getAttribute('aria-label')||a.querySelector('img')?.alt||a.innerText||'').trim().slice(0,500)}));
  const label=el=>(el.value||el.innerText||el.textContent||'').trim();
  const actions=all('button,[role="button"],input[type="button"]');
  const fixedPanels=all('div,section,aside,dialog,[role="dialog"]').filter(el=>{
    const panelText=(el.innerText||el.textContent||'').trim();
    return panelText.length<1500&&panelText.includes('采集到店小秘')&&getComputedStyle(el).position==='fixed';
  });
  const pluginText=fixedPanels.length===1?(fixedPanels[0].innerText||fixedPanels[0].textContent||''):'';
  const duplicateText=text=>/(?:该|此)?(?:产品|商品)在店小秘已有采集记录/.test(text)||/^(?:该|此)?(?:产品|商品)(?:已经|已)采集(?:过)?[。！!\s]*$/.test(text.trim());
  const repeatAction=fixedPanels.length===1&&[...fixedPanels[0].querySelectorAll('*')].some(el=>visible(el)&&label(el)==='重复采集');
  const panelStatus=repeatAction||duplicateText(pluginText)?'duplicate':/采集成功/.test(pluginText)?'success':/采集失败/.test(pluginText)?'failed':/正在采集|采集中/.test(pluginText)?'pending':null;
  const toastText=el=>(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
  const toastCandidates=all('div,span,section,[role="alert"],[role="status"]').filter(el=>{
    const content=toastText(el),box=el.getBoundingClientRect();
    if(content.length>200||!/^采集成功[，,]\s*可继续采集产品或者\s*前往采集箱\s*(?:[（(]\s*已启用采集设置\s*[）)])?[。.!！×\s]*$/.test(content)||box.top<0||box.top>innerHeight/3)return false;
    const linked=[...el.querySelectorAll('a[href]')].some(a=>{
      if(!visible(a)||toastText(a)!=='前往采集箱')return false;
      try{const u=new URL(a.href);return u.origin==='https://www.dianxiaomi.com'&&!u.username&&!u.password&&!u.port&&u.pathname==='/web/productCrawl/dataAcquisition';}catch{return false;}
    });
    if(!linked)return false;
    let floating=false;
    for(let node=el;node&&node!==document.body;node=node.parentElement){
      const style=getComputedStyle(node);
      if(node.hidden||node.getAttribute('aria-hidden')==='true'||style.opacity==='0')return false;
      if(['fixed','absolute'].includes(style.position))floating=true;
    }
    return floating;
  });
  const toasts=toastCandidates.filter(el=>!toastCandidates.some(other=>other!==el&&el.contains(other)));
  // This is our own DOM-node identity cache, not extension/application state.
  // Replacing a stale toast with a new node is observable even when its text is identical.
  const receiptCacheKey=Symbol.for('ec-workbench.plugin-receipt-nodes');
  const receiptCache=globalThis[receiptCacheKey]??={nodes:new WeakMap(),sequence:0};
  const receipt=(node,kind,status,content)=>{
    if(!receiptCache.nodes.has(node))receiptCache.nodes.set(node,++receiptCache.sequence);
    return {key:`${receiptCache.nodes.get(node)}:${status}:${content}`,kind,status,text:content};
  };
  const pluginReceipts=toasts.map(node=>receipt(node,'toast','success',toastText(node)));
  if(panelStatus)pluginReceipts.push(receipt(fixedPanels[0],repeatAction?'repeat-action':'panel',panelStatus,pluginText.trim()));
  // Only plugin panels or visible dialogs can report a duplicate; product copy
  // and recommendations with the same words must not skip a product.
  const duplicateNotices=all('[role="dialog"],.ant-modal,.el-message-box,.layui-layer,[role="alert"],[role="status"]').filter(el=>{
    const content=toastText(el);return content.length<800&&/(?:产品|商品)在店小秘已有采集记录/.test(content);
  }).filter(el=>!fixedPanels.some(panel=>panel.contains(el)));
  const duplicateLeaves=duplicateNotices.filter(el=>!duplicateNotices.some(other=>other!==el&&el.contains(other)));
  if(duplicateLeaves.length===1)pluginReceipts.push(receipt(duplicateLeaves[0],'duplicate-dialog','duplicate',toastText(duplicateLeaves[0])));
  const pluginStatus=duplicateLeaves.length===1?'duplicate':toasts.length===1?'success':panelStatus;
  // The global plugin panel has one native action; its title and product hover clones are not actions.
  const candidates=fixedPanels.length?actions.filter(el=>label(el)==='开始采集'&&fixedPanels.some(panel=>panel.contains(el))):actions.filter(el=>{
    if(!/^(开始采集|采到店小秘|采集到店小秘)$/.test(label(el)))return false;
    for(let parent=el,depth=0;parent&&parent!==document.body&&parent!==document.documentElement&&depth<6;parent=parent.parentElement,depth++){
      const context=parent.innerText||parent.textContent||'';
      if(/dianxiaomi|dxm|xiaomi/i.test(parent.id+' '+parent.className)||(context.length<1500&&/店小秘/.test(context)))return true;
    }
    return false;
  });
  const pluginAccount=all('[id*="dianxiaomi"],[id*="dxm"],[class*="dianxiaomi"],[class*="dxm"]').some(el=>/请先登录|登录店小秘|log in/i.test(el.innerText||''));
  if(pluginAccount)return {status:'waiting-plugin',message:'店小秘插件需要登录，请在同一浏览器登录绑定账号后继续。',url:location.href};
  const autoClaim=all('label').some(el=>/自动认领/.test(el.textContent)&&el.querySelector('input[type="checkbox"]')?.checked);
  if(autoClaim)return {status:'waiting-plugin',message:'插件开启了自动认领，请关闭后继续。本任务只采集到通用采集箱。',url:location.href};
  let button=null;
  if(candidates.length===1){
    const el=candidates[0];if(location.pathname!=='/search_result.html')el.scrollIntoView({block:'center'});
    const rect=el.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const root=el.getRootNode(),hit=root.elementFromPoint?.(x,y)||document.elementFromPoint(x,y);
    if(!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&el.contains(hit))button={x,y};
  }
  const productReady=all('h1').some(e=>!!e.innerText.trim())&&all('#goodsDetail').some(e=>!!e.innerText.trim());
  return {status:'ready',url:location.href,products,button,buttonCount:candidates.length,pluginStatus,pluginReceipts,productReady,...(searchListStatus?{searchListStatus}:{})};
}

export function createTemuFrontBrowser(configuration={},transport,{captchaClient,captchaSolver}={}){
  const solver=captchaSolver||createTemuCaptchaSolver({configuration,client:captchaClient});
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const library=()=>transport||import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  const stopped=()=>({status:'paused',message:'任务已暂停，当前页面和进度已保留。'});
  async function read(page,args,solve=true){
    if(args.isStopped?.())return stopped();
    const observed=await page.evaluate(readTemuPage);
    if(args.isStopped?.())return stopped();
    if(observed.status!=='waiting-verification'||!solve)return observed;
    const challengeUrl=new URL(observed.url);
    if(challengeUrl.protocol!=='https:'||!['www.temu.com','temu.com'].includes(challengeUrl.hostname)||challengeUrl.username||challengeUrl.password||challengeUrl.port||args.keyword&&challengeUrl.pathname==='/search_result.html'&&challengeUrl.searchParams.get('search_key')!==args.keyword)return {status:'paused',url:observed.url,message:'验证码所在页面的地址或关键词已变化，未请求识别或继续采集。'};
    const result=await solver.solve({page,args,readPage:readTemuPage});
    return result.status==='solved'?page.evaluate(readTemuPage):{...result,url:observed.url};
  }
  async function withTarget(args,kind,url,fn,{activate=false,existingOnly=false,foreground=false,readOnly=false}={}){
    if(!activate&&args.isStopped?.())return stopped();
    const lib=await library(),info=await lib.connection(args.browserConfig),chrome=await lib.connect(info.ws);
    let page;
    try{
      if(!activate&&args.isStopped?.())return stopped();
      const targets=await info.targets();let target=targets.find(t=>t.id===args.tabs?.[kind]&&t.type==='page');
      if(!target){
        if(existingOnly)return {status:'paused',message:'搜索入口打开的商品标签页已关闭，未直接导航商品链接。请检查后继续。'};
        url??=kind==='search'?searchUrl(args.keyword):args.sourceUrl;
        if(!url)throw new Error('任务页面已关闭，缺少可恢复的商品链接。');
        const {targetId}=await chrome.send('Target.createTarget',{url:'about:blank'});
        args.onTarget(kind,targetId,{owned:true,...(['product','source-facts'].includes(kind)?{goodsId:productIdentity(url),sourceUrl:url}:{})});target={id:targetId,url:'about:blank'};
      }
      page=await lib.pageById(info,target.id);await page.send('Page.enable');await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      if(!activate&&args.isStopped?.())return stopped();
      let current=await page.evaluate(()=>location.href);
      if(current!=='about:blank'){
        const u=new URL(current);
        if(u.protocol!=='https:'||!['www.temu.com','temu.com'].includes(u.hostname))throw new Error('任务标签页已跳转到其他网站，未接管该页面。请关闭该任务标签页后继续。');
        const observed=await read(page,args,!activate&&!readOnly);
        // Verification can redirect this tab while read() is completing.
        current=await page.evaluate(()=>location.href);
        const afterRead=new URL(current);
        if(afterRead.protocol!=='https:'||!['www.temu.com','temu.com'].includes(afterRead.hostname))throw new Error('任务标签页已跳转到其他网站，未接管该页面。请关闭该任务标签页后继续。');
        const moveFromUnavailable=!activate&&kind==='product'&&observed.status==='unavailable'&&productIdentity(current)&&productIdentity(url)&&productIdentity(current)!==productIdentity(url);
        if(observed.status!=='ready'&&(observed.status!=='waiting-network'||activate)&&!moveFromUnavailable&&!(readOnly&&observed.status==='waiting-plugin')){if(activate)await chrome.send('Target.activateTarget',{targetId:target.id});return observed;}
        if(readOnly&&productIdentity(current)!==args.goodsId)return {status:'paused',message:'来源资料补读页已变化，已保留页面，未导航或接管其他商品。'};
      }
      const sameDocument=url&&(current===url||kind==='product'&&productIdentity(current)&&productIdentity(current)===productIdentity(url)||kind==='search'&&new URL(current).pathname==='/search_result.html'&&new URL(current).searchParams.get('search_key')===args.keyword);
      if(url&&!sameDocument){
        if(!activate&&args.isStopped?.())return stopped();
        await page.send('Page.navigate',{url});
        await lib.poll(async()=>{if(!activate&&args.isStopped?.())return true;try{return await page.evaluate(()=>document.readyState==='complete'&&location.href!=='about:blank');}catch{return false;}},{timeout:45000,label:'Temu 页面加载'});
      }
      if(!activate&&args.isStopped?.())return stopped();
      if(activate||foreground)await chrome.send('Target.activateTarget',{targetId:target.id});
      if(!activate&&args.isStopped?.())return stopped();
      return await fn(page,lib,{info,chrome,targetId:target.id});
    }finally{if(page)await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});page?.close();chrome.close();}
  }
  async function observe(page,lib,args,ready,label,timeout=15000){
    let last;
    try{return await lib.poll(async()=>{
      last=await read(page,args);
      if(last.status!=='ready'||ready(last))return last;return null;
    },{timeout,interval:750,label});}catch(error){if(last?.status==='ready')return last;throw error;}
  }
  async function searchState(page,args){
    if(args.isStopped?.())return stopped();
    const href=await page.evaluate(()=>location.href);
    const u=new URL(href),origin=u.protocol==='https:'&&['www.temu.com','temu.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port;
    if(!origin||u.pathname==='/search_result.html'&&u.searchParams.get('search_key')!==args.keyword||u.pathname!=='/search_result.html'&&!/(?:captcha|challenge|verification|bgn_no_access)/i.test(u.pathname))return {status:'paused',url:href,message:'搜索标签页的地址或关键词已变化，未继续读取、滚动或采集。'};
    const result=await read(page,args);
    if(result.status!=='ready')return result;
    const current=new URL(result.url);
    if(current.protocol!=='https:'||!['www.temu.com','temu.com'].includes(current.hostname)||current.username||current.password||current.port||current.pathname!=='/search_result.html'||current.searchParams.get('search_key')!==args.keyword)return {status:'paused',url:result.url,message:'搜索页面的地址或关键词已变化，未继续读取或采集。'};
    return result;
  }
  async function searchProducts(page,lib,args){
    const limit=Number(args.limit);
    if(!Number.isInteger(limit)||limit<1)throw new Error('搜索采集数量必须为正整数。');
    const excluded=new Set(args.excludeGoodsIds||[]);
    const unique=new Map();let last,scrolls=0,idle=0;
    const add=result=>{for(const product of result.products||[]){const id=productIdentity(product.sourceUrl);if(id&&!excluded.has(id)&&!unique.has(id))unique.set(id,product);}};
    const waitFor=async(predicate,timeout,label)=>{
      try{return await lib.poll(async()=>{
        last=await searchState(page,args);
        if(last.status!=='ready')return last;
        if(last.searchListStatus==='ambiguous')return {...last,status:'paused',message:'当前搜索页有多个结果列表，无法确认前序商品；未开始采集。'};
        if(last.searchListStatus==='ready')add(last);
        return predicate(last)?last:null;
      },{timeout,interval:250,label});}catch(error){if(error.code==='ERP_WAIT_TIMEOUT'&&last?.status==='ready')return last;throw error;}
    };
    let result=await waitFor(value=>value.searchListStatus==='ready'&&(unique.size>0||excluded.size>0),15000,'Temu 主搜索结果');
    if(result.status!=='ready')return result;
    if(result.searchListStatus!=='ready')return {status:'paused',url:result.url,message:'未找到可确认的 Temu 主搜索结果列表，未将侧边推荐作为搜索结果，也未开始采集。',products:[]};
    while(unique.size<limit&&scrolls<12&&idle<3){
      if(args.isStopped?.())return stopped();
      const checkpoint=await searchState(page,args);
      if(checkpoint.status!=='ready')return checkpoint;
      if(checkpoint.searchListStatus!=='ready')return {status:'paused',message:'搜索结果列表结构已变化，未继续滚动或采集。',url:checkpoint.url};
      add(checkpoint);if(unique.size>=limit){result=checkpoint;break;}
      const movement=await page.evaluate(scrollTemuSearchPage,{keyword:args.keyword});
      if(args.isStopped?.())return stopped();
      if(movement.status==='changed')return {status:'paused',url:movement.url,message:'搜索标签页的地址或关键词已变化，未继续滚动或采集。'};
      if(movement.status==='unsupported')return {status:'paused',url:movement.url,message:'搜索结果列表已变化，未继续滚动或采集。'};
      if(movement.status==='load-more'){
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...movement.button});
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...movement.button});
        scrolls++;
      }
      if(movement.status==='scrolled')scrolls++;
      const before=unique.size;
      result=await waitFor(value=>value.searchListStatus!=='ready'||unique.size>before,2500,'Temu 搜索结果加载');
      if(result.status!=='ready')return result;
      if(result.searchListStatus!=='ready')return {status:'paused',url:result.url,message:'搜索结果列表已变化，未开始采集。'};
      idle=unique.size>before?0:idle+1;
    }
    if(args.isStopped?.())return stopped();
    if(unique.size<limit&&(!args.allowPartial||!unique.size))return {status:'paused',url:result.url,products:[...unique.values()],searchSummary:{requested:limit,found:unique.size,scrolls},message:excluded.size?`当前关键词下未读到更多未处理商品，仍需补充 ${limit} 件；本轮有限加载后已暂停，可检查搜索页后继续。`:`已按主搜索列表顺序确认 ${unique.size} 件商品，尚未达到要求的 ${limit} 件；本轮有限加载后已暂停，未开始采集。请检查搜索页后继续。`};
    const final=await searchState(page,args);
    if(final.status!=='ready')return final;
    if(final.searchListStatus!=='ready')return {status:'paused',url:final.url,message:'返回商品前搜索结果列表已变化，未开始采集。'};
    const current=new Map();for(const product of final.products){const id=productIdentity(product.sourceUrl);if(id&&!excluded.has(id)&&!current.has(id))current.set(id,product);}
    // A complete current DOM snapshot wins; accumulated order supports forward-only virtualized lists.
    const ordered=current.size>=limit?current:unique;
    return {...final,products:[...ordered.values()].slice(0,limit),searchSummary:{requested:limit,found:ordered.size,scrolls}};
  }
  async function productFromSearch(args){
    if(args.isStopped?.())return stopped();
    if(!args.forceSearch&&args.tabs?.product){
      const lib=await library(),info=await lib.connection(args.browserConfig);
      const target=(await info.targets()).find(item=>item.id===args.tabs.product&&item.type==='page'&&productIdentity(item.url)===args.goodsId);
      if(target){
        const page=await lib.pageById(info,target.id);
        try{
          await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
          if(productIdentity(await page.evaluate(()=>location.href))!==args.goodsId)return {status:'paused',message:'待复用商品标签页的地址已变化，未请求验证或点击采集。'};
          const state=await read(page,args);
          if(state.status==='ready'&&productIdentity(state.url)===args.goodsId)return {status:'ready',targetId:target.id};
          if(state.status!=='ready'&&state.status!=='unavailable')return state;
        }finally{await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});page.close();}
      }
    }
    return withTarget(args,'search',searchUrl(args.keyword),async(page,lib,{info,chrome})=>{
      // A replacement item may come from a short final portion of the list.
      // Opening it requires its own observed entry, not another full batch.
      const result=await searchProducts(page,lib,{...args,limit:1,allowPartial:true});
      if(result.status!=='ready')return result;
      let action;
      try{
        action=await lib.poll(async()=>{
          const state=await searchState(page,args);
          if(state.status!=='ready')return state;
          const candidate=await page.evaluate(readSearchProductAction,{keyword:args.keyword,goodsId:args.goodsId});
          if(candidate.status==='ready')return candidate;
          if(candidate.status==='changed'||candidate.status==='unsupported')return {status:'paused',message:'搜索入口的关键词或主列表已变化，未打开商品。'};
          return null;
        },{timeout:15000,interval:250,label:'搜索主列表中的商品入口'});
      }catch(error){
        if(error.code!=='ERP_WAIT_TIMEOUT')throw error;
        return {status:'paused',message:'未在当前关键词的主列表找到该商品的可点击入口，未直接导航商品链接。请检查列表后继续。'};
      }
      if(action.status!=='ready')return action;
      if(args.isStopped?.())return stopped();
      const existing=new Set((await info.targets()).map(target=>target.id));
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...action.point});
      const checked=await page.evaluate(readSearchProductAction,{keyword:args.keyword,goodsId:args.goodsId,point:action.point});
      if(checked.status!=='ready')return {status:'paused',message:'商品入口在鼠标移入后已变化或被遮挡，未点击入口或采集按钮。'};
      if(args.isStopped?.())return stopped();
      // Native Ctrl-click preserves the site's navigation context and the observed href.
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,modifiers:2,...action.point});
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,modifiers:2,...action.point});
      let activatedTarget,boundTarget;
      try{
        return await lib.poll(async()=>{
          if(args.isStopped?.())return stopped();
          const targets=(await info.targets()).filter(target=>target.type==='page'&&!existing.has(target.id)&&productIdentity(target.url)===args.goodsId);
          if(targets.length>1)return {status:'paused',message:'搜索入口打开了多个同商品标签页，无法确认本次目标，未点击采集。'};
          if(targets.length===1){
            const targetId=targets[0].id;
            if(activatedTarget!==targetId){await chrome.send('Target.activateTarget',{targetId});activatedTarget=targetId;}
            let opened,state;
            try{opened=await lib.pageById(info,targetId);state=await opened.evaluate(()=>({url:location.href,readyState:document.readyState}));}catch{}finally{opened?.close();}
            if(productIdentity(state?.url)===args.goodsId){
              // Retain the verified new tab even if loading times out; resume must not open it again.
              if(boundTarget!==targetId){args.onTarget('product',targetId,{owned:true,goodsId:args.goodsId,sourceUrl:state.url});boundTarget=targetId;}
              if(['interactive','complete'].includes(state.readyState))return args.isStopped?.()?stopped():{status:'ready',targetId};
            }
          }
          return args.isStopped?.()?stopped():null;
        },{timeout:20000,interval:250,label:'搜索入口打开的商品标签页'});
      }catch(error){
        if(error.code!=='ERP_WAIT_TIMEOUT')throw error;
        return {status:'paused',message:boundTarget?'搜索入口已打开并保留对应商品页，页面仍在加载，未点击采集。请检查该标签页后继续。':'搜索入口点击后未观察到对应商品的新标签页，未点击采集。请核对浏览器后继续。'};
      }
    },{foreground:true});
  }
  return {
    search:args=>withTarget(args,'search',searchUrl(args.keyword),(page,lib)=>searchProducts(page,lib,args)),
    readSourceFacts:async args=>{
      if(productIdentity(args.sourceUrl)!==args.goodsId)throw new Error('来源资料补读的商品链接与身份不一致。');
      const kind='source-facts',existing=args.tabs?.[kind],ownership=args.ownedTabs?.[existing];
      if(existing&&(!ownership?.owned||ownership.kind!==kind||ownership.goodsId!==args.goodsId))return {status:'paused',message:'上次来源资料补读页尚未核对或关闭，请检查保留的页面后再补读其他商品。'};
      // Use a separate owned page so historical reads cannot navigate the active
      // collection/search page or replay the plugin. Challenges stay visible;
      // this read-only path never spends CAPTCHA credits.
      return withTarget(args,kind,args.sourceUrl,async(page,lib,{info,chrome,targetId})=>{
        let observed,raw;
        try{
          await lib.poll(async()=>{
            observed=await read(page,args,false);
            if(!['ready','waiting-plugin'].includes(observed.status))return true;
            if(productIdentity(observed.url)!==args.goodsId)throw new Error('补读来源资料时商品页面已变化。');
            raw=await page.evaluate(readTemuSourceFacts,{goodsId:args.goodsId});
            return raw.productReady;
          },{timeout:15000,interval:750,label:'Temu 来源分类、直接售价与当前规格'});
        }catch(error){if(!raw||!['ERP_WAIT_TIMEOUT'].includes(error.code))throw error;}
        if(!['ready','waiting-plugin'].includes(observed?.status))return observed||stopped();
        if(!raw?.productReady)return {status:'paused',message:'Temu 商品详情仍未加载完成，未推测来源价格或分类，已保留补读页面。'};
        const sourceFacts=normalizeTemuSourceFacts(raw,args);
        if(args.isStopped?.())return stopped();
        if(productIdentity(await page.evaluate(()=>location.href))!==args.goodsId)throw new Error('来源资料读取后商品页面已变化，未保存该资料。');
        await args.onSourceFacts?.(sourceFacts);
        // Close only this independently owned, identity-checked page after its
        // observation has been persisted. Other task tabs are left untouched.
        if(args.isStopped?.())return {...stopped(),sourceFacts};
        if(args.tabs?.[kind]===targetId&&args.ownedTabs?.[targetId]?.owned===true&&args.ownedTabs[targetId].kind===kind&&args.ownedTabs[targetId].goodsId===args.goodsId){
          if(productIdentity(await page.evaluate(()=>location.href))!==args.goodsId)return {status:'paused',sourceFacts,message:'来源资料已读取，但补读页随后已变化，未关闭该页面。'};
          const closed=await chrome.send('Target.closeTarget',{targetId});
          if(closed.success!==true)return {status:'paused',sourceFacts,message:'来源资料已读取，补读页关闭尚未确认，请先核对保留页面。'};
          try{await lib.poll(async()=>!(await info.targets()).some(target=>target.id===targetId),{timeout:3000,interval:200,label:'来源资料补读页关闭确认'});}catch{return {status:'paused',sourceFacts,message:'来源资料已读取，补读页仍存在，所有权记录已保留，请先检查页面。'};}
          await args.onTargetClosed?.(kind,targetId);
        }
        return {status:'ready',sourceFacts,message:sourceFacts.status==='ready'?'已读取 Temu 可见分类、当前规格和直接售价。':'已读取页面，但来源资料仍有缺项，请查看具体原因。'};
      },{readOnly:true});
    },
    verifyChallenge:async args=>{
      if(!args.tabs?.product)return {status:'ready'};
      const lib=await library(),info=await lib.connection(args.browserConfig);
      const target=(await info.targets()).find(t=>t.id===args.tabs.product&&t.type==='page');
      if(!target||productIdentity(target.url)!==args.goodsId)return {status:'ready'};
      const page=await lib.pageById(info,target.id);
      try{
        await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
        if(productIdentity(await page.evaluate(()=>location.href))!==args.goodsId)return {status:'ready'};
        return await read(page,args);
      }finally{await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});page.close();}
    },
    returnToSearch:async args=>{
      if(args.isStopped?.())return stopped();
      if(!args.tabs?.search||!args.tabs?.product||!args.keyword||productIdentity(args.sourceUrl)!==args.goodsId)return {status:'paused',message:'缺少可核对的本任务搜索页或商品身份，未切换标签页。'};
      const productTargetId=args.tabs.product,owner=args.ownedTabs?.[productTargetId],receipt=args.pluginReceipt;
      const ownsProduct=owner?.owned===true&&owner.kind==='product'&&owner.goodsId===args.goodsId&&productIdentity(owner.sourceUrl)===args.goodsId;
      if(args.closeProduct&&ownsProduct&&(!receipt||!['success','duplicate'].includes(receipt.status)||receipt.targetId!==productTargetId||productIdentity(receipt.sourceUrl)!==args.goodsId||!Number.isFinite(Date.parse(receipt.observedAt))))return {status:'paused',message:'商品页尚无已保存的对应成功或重复提示，已保留页面，未关闭。'};
      const lib=await library(),info=await lib.connection(args.browserConfig),chrome=await lib.connect(info.ws);
      let searchPage,productPage;
      try{
        const targets=await info.targets();
        if(!targets.some(t=>t.id===args.tabs.search&&t.type==='page')||!targets.some(t=>t.id===args.tabs.product&&t.type==='page'))return {status:'paused',message:'本任务搜索页或商品页已关闭，未打开替代页面。'};
        productPage=await lib.pageById(info,args.tabs.product);
        if(productIdentity(await productPage.evaluate(()=>location.href))!==args.goodsId)return {status:'paused',message:'本任务商品页已变化，未切换标签页。'};
        searchPage=await lib.pageById(info,args.tabs.search);
        const href=await searchPage.evaluate(()=>location.href),u=new URL(href);
        if(u.protocol!=='https:'||!['www.temu.com','temu.com'].includes(u.hostname)||u.username||u.password||u.port||u.pathname!=='/search_result.html'||u.searchParams.get('search_key')!==args.keyword)return {status:'paused',message:'本任务搜索页的地址或关键词已变化，未切换标签页。'};
        if(args.closeProduct&&ownsProduct){
          // A saved receipt authorizes retiring only the tab this task opened. Keep challenge/error pages for recovery.
          const productState=await read(productPage,args,false),searchResult=await read(searchPage,args,false);
          if(productState.status!=='ready')return productState;
          if(searchResult.status!=='ready')return searchResult;
          if(!productState.productReady||productIdentity(productState.url)!==args.goodsId)return {status:'paused',message:'已采集商品页的内容或身份已变化，已保留页面。'};
          if(receipt.status!=='duplicate'&&['pending','failed'].includes(productState.pluginStatus))return {status:'needs-review',message:'商品页的插件状态已变化，已保留页面和成功回执，请核对已有提交。'};
        }
        if(args.isStopped?.())return stopped();
        await chrome.send('Target.activateTarget',{targetId:args.tabs.search});
        if(args.closeProduct&&ownsProduct){
          if(args.isStopped?.())return stopped();
          if(args.tabs.product!==productTargetId||productIdentity(await productPage.evaluate(()=>location.href))!==args.goodsId)return {status:'paused',message:'待关闭商品页已变化，已保留页面。'};
          const closed=await chrome.send('Target.closeTarget',{targetId:productTargetId});
          if(closed.success!==true)return {status:'paused',message:'商品页关闭未确认，已保留目标记录，请检查后继续。'};
          try{await lib.poll(async()=>!(await info.targets()).some(target=>target.id===productTargetId),{timeout:5000,interval:100,label:'已采集商品标签页关闭'});}catch(error){
            if(error.code!=='ERP_WAIT_TIMEOUT')throw error;
            return {status:'paused',message:'商品页关闭未确认，已保留目标记录，请检查后继续。'};
          }
          await args.onTargetClosed?.('product',productTargetId);
          return {status:'ready',url:href,closedTargetId:productTargetId,message:'已返回本任务搜索结果，并关闭已采集商品页。'};
        }
        return {status:'ready',url:href,message:'已返回本任务搜索结果。'};
      }finally{searchPage?.close();productPage?.close();chrome.close();}
    },
    collect:async args=>{
      if(productIdentity(args.sourceUrl)!==args.goodsId)throw new Error('商品来源链接与商品编号不一致。');
      if(args.keyword){
        const entry=await productFromSearch(args);
        if(entry.status!=='ready')return entry;
        args={...args,tabs:{...args.tabs,product:entry.targetId}};
      }
      return withTarget(args,'product',args.keyword?null:args.sourceUrl,async(page,lib,{targetId})=>{
        const duplicateResult=receipt=>({status:'skipped-duplicate',pluginStatus:'duplicate',message:'店小秘提示已有采集记录，已跳过并继续下一件。',receipt:{...receipt,status:'duplicate',sourceUrl:args.sourceUrl,targetId,observedAt:new Date().toISOString()}});
        const duplicateReceipt=state=>{const receipts=(state.pluginReceipts||[]).filter(item=>item.status==='duplicate');return receipts.length===1?receipts[0]:null;};
        const result=await observe(page,lib,args,v=>(!!v.button||!!duplicateReceipt(v))&&v.productReady,'Temu 商品内容及店小秘插件采集按钮',45000);
        if(result.status!=='ready')return result;
        if(productIdentity(result.url)!==args.goodsId)throw new Error('商品页面已变化，未点击采集按钮。');
        if(!result.productReady)return {status:'paused',message:'Temu 商品标题和详情尚未加载完成，未点击采集按钮。'};
        if(duplicateReceipt(result))return duplicateResult(duplicateReceipt(result));
        if(!result.button)return {status:'waiting-plugin',message:'未找到唯一且可点击的店小秘采集按钮。请检查插件安装和登录，关闭遮挡后继续；不会改用链接采集。'};
        if(typeof args.onSourceFacts==='function'){
          const sourceFacts=normalizeTemuSourceFacts(await page.evaluate(readTemuSourceFacts,{goodsId:args.goodsId}),args);
          await args.onSourceFacts(sourceFacts);
        }
        // Recheck both challenge and button immediately before the only write action.
        const checked=await read(page,args);
        if(checked.status!=='ready')return checked;
        if(productIdentity(checked.url)===args.goodsId&&checked.productReady&&duplicateReceipt(checked))return duplicateResult(duplicateReceipt(checked));
        if(productIdentity(checked.url)!==args.goodsId||!checked.button||!checked.productReady)throw new Error('采集按钮或商品页面发生变化，未提交。');
        const staleReceipts=new Set((checked.pluginReceipts||[]).map(item=>item.key));
        let dialogResult=null,dialogTask=null;
        const offDialog=page.on?.('Page.javascriptDialogOpening',event=>{
          const matches=['confirm','alert'].includes(event.type)&&/^(?:该|此)?(?:产品|商品)在店小秘已有采集记录[，,。.!！?\s]*(?:是否继续采集[？?]?)?$/.test(String(event.message||'').trim())&&(!event.url||productIdentity(event.url)===args.goodsId);
          if(!matches){dialogResult={status:'needs-review',message:'采集出现无法确认的浏览器弹窗，已保留现场。'};return;}
          // Decline only the known duplicate confirmation. Never accept a second
          // collection; dismissing it releases the page so the next item can run.
          dialogTask=page.send('Page.handleJavaScriptDialog',{accept:false}).then(()=>{dialogResult=duplicateResult({kind:'native-duplicate-dialog',text:event.message});},()=>{dialogResult={status:'needs-review',message:'重复提示关闭结果不明确，已保留现场。'};});
        });
        try{
          args.beforeSubmit();
          await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...checked.button});
          await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...checked.button});
          // A submitted intent survives an unfinished plugin request; timeout cannot imply completion.
          let receipt,freshReceipt;
          try{
            await lib.poll(async()=>{
              if(dialogTask)await dialogTask;
              if(dialogResult)return dialogResult;
              receipt=await read(page,args);
              if(receipt.status!=='ready')return receipt;
              if(productIdentity(receipt.url)!==args.goodsId)throw new Error('等待采集结果时商品页面已变化，请只核对已有提交。');
              const current=receipt.pluginReceipts||[],visibleKeys=new Set(current.map(item=>item.key));
              for(const key of staleReceipts)if(!visibleKeys.has(key))staleReceipts.delete(key);
              const fresh=current.filter(item=>!staleReceipts.has(item.key));
              // The button also changes to "重复采集" after a NEW successful
              // submission. Only a real duplicate notice proves a post-click skip.
              const duplicate=fresh.filter(item=>item.status==='duplicate'&&item.kind!=='repeat-action');
              if(duplicate.length===1){freshReceipt=duplicate[0];return receipt;}
              const successful=fresh.filter(item=>item.status==='success'),toasts=successful.filter(item=>item.kind==='toast');
              freshReceipt=fresh.find(item=>item.status==='failed')||(toasts.length===1?toasts[0]:!toasts.length&&successful.length===1?successful[0]:null);
              return freshReceipt?receipt:null;
            },{timeout:90000,interval:750,label:'店小秘插件采集完成'});
          }catch(error){
            if(error.code!=='ERP_WAIT_TIMEOUT')throw error;
            return {status:'needs-review',pluginStatus:receipt?.pluginStatus??null,message:receipt?.pluginStatus==='pending'?'等待插件完成已达 90 秒，插件仍显示采集中；原提交记录已保留，未重复点击采集。请核对已有请求和采集箱。':'等待插件完成已达 90 秒，仍未取得成功或失败回执；原提交记录已保留，未重复点击采集。请只核对已有提交。'};
          }
          if(dialogResult)return dialogResult;
          if(receipt.status!=='ready')return receipt;
          if(productIdentity(receipt.url)!==args.goodsId)throw new Error('等待采集结果时商品页面已变化，请只核对已有提交。');
          if(freshReceipt?.status==='duplicate')return duplicateResult(freshReceipt);
          if(freshReceipt?.status!=='success')return {status:'needs-review',pluginStatus:'failed',message:freshReceipt?.text||'店小秘返回采集失败，请只核对已有提交。'};
          return {status:'submitted',pluginStatus:'success',message:freshReceipt.text,receipt:{kind:freshReceipt.kind,text:freshReceipt.text,sourceUrl:receipt.url,targetId,observedAt:new Date().toISOString()}};
        }finally{offDialog?.();}
      },{existingOnly:!!args.keyword,foreground:!!args.keyword});
    },
    open:args=>{
      const kind=args.kind||'search';
      // Do not navigate an existing human-verification page just to bring it forward.
      return withTarget(args,kind,!args.tabs?.[kind]?(kind==='search'?searchUrl(args.keyword):args.sourceUrl):null,async()=>({message:'已显示本任务的 Temu 页面。'}),{activate:true});
    }
  };
}
