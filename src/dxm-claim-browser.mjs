import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {COLLECTION_URL} from './collection-browser.mjs';
import {temuGoodsId} from './geekbi.mjs';
import {COLLECTION_SOURCE_MODE_SELECTOR,readCollectionSourceMode,withCollectionSourceMode} from './dxm-collection-query.mjs';

const PLATFORM_LABELS={tiktok:'TikTok',temu:'Temu半托管'};
const PLATFORM_EDIT_PATHS={tiktok:'/web/tiktokProduct/edit',temu:'/web/popTemu/edit'};
const PLATFORM_LIST_URLS={tiktok:'https://www.dianxiaomi.com/web/tiktokProduct/draft',temu:'https://www.dianxiaomi.com/web/popTemu/pageList/draft'};
const AUTHORIZATION_URL='https://www.dianxiaomi.com/web/system/authorization/platform?go=m518';

// Temu normalizes repeated ASCII spaces in titles when saving a draft. Keep
// every other character, including non-ASCII whitespace, strictly identical.
export function claimTitlesMatch(actual,expected,platform){
  if(typeof actual!=='string'||typeof expected!=='string')return false;
  return platform==='temu'?actual.replace(/ {2,}/g,' ')===expected.replace(/ {2,}/g,' '):actual===expected;
}

// Names are read from the account's claim dialog. A repeated name in one platform
// is ambiguous and must not silently resolve to whichever checkbox appeared first.
export function claimStoreKey(store){
  if(!Object.hasOwn(PLATFORM_LABELS,store?.platform)||typeof store.name!=='string'||!store.name.trim()||store.name.length>240)throw new Error('目标平台或店铺名称无效');
  return Buffer.from(JSON.stringify([store.platform,store.name.trim()])).toString('base64url');
}

export function selectClaimStore(stores,target){
  const key=claimStoreKey(target);
  if(target.key&&target.key!==key)throw new Error('目标店铺标识与名称不一致，请重新同步店铺');
  const matches=stores.filter(s=>s.platform===target.platform&&s.name===target.name);
  if(matches.length!==1)throw new Error(matches.length?'店小秘存在同平台同名店铺，无法安全自动认领':'店铺已不存在或未授权，请重新同步店铺');
  if(matches[0].disabled)throw new Error('店小秘已停用该店铺，无法认领');
  return {...matches[0],key};
}

export function isClaimEditorUrl(value,platform){
  try{const u=new URL(value);return u.origin==='https://www.dianxiaomi.com'&&u.pathname===PLATFORM_EDIT_PATHS[platform]&&/^\d{6,30}$/.test(u.searchParams.get('id')||'');}catch{return false;}
}

// These readers use rendered labels and native checkbox state only. They never
// inspect Vue/React stores, intercept requests, or discover undocumented APIs.
export function readClaimModal(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const norm=s=>String(s||'').replace(/\s+/g,'').trim();
  const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&norm(e.querySelector('.ant-modal-title')?.textContent)==='选择店铺-认领到采集箱');
  if(modals.length!==1)return null;
  const modal=modals[0],groups={tiktok:{name:'tiktok',label:'TikTok'},temu:{name:'popTemu',label:'Temu半托管'}},stores=[];
  for(const [platform,{name:groupName,label}] of Object.entries(groups)){
    for(const group of modal.querySelectorAll('.shop-div[name="'+groupName+'"]'))for(const input of group.querySelectorAll('.shop-label-box input[type="checkbox"]')){
      if(!group.querySelector('.shop-title')?.textContent.includes(label))continue;
      const wrapper=input.closest('label');if(!visible(wrapper))continue;
      const name=wrapper.textContent.trim();if(!name||name==='全选')continue;
      const found={platform,name,checked:input.checked,disabled:input.disabled};
      if(!stores.some(s=>s.platform===platform&&s.name===name&&s.input===input))stores.push({...found,input});
    }
  }
  const duplicateControl=[...modal.querySelectorAll('label')].find(e=>visible(e)&&norm(e.textContent)==='已认领至相同店铺的产品不再认领');
  const checkedCount=stores.filter(s=>s.checked).length;
  return {stores:stores.map(({input,...s})=>s),checkedCount,skipDuplicate:duplicateControl?.querySelector('input[type="checkbox"]')?.checked??null,
    templateSelections:[...modal.querySelectorAll('.ant-select-selection-item')].filter(visible).map(e=>e.textContent.trim()),
    selectedSummary:modal.textContent.match(/已选\s*\((\d+)\)/)?.[1]??null};
}

export function readClaimRecords(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&/认领记录/.test(e.querySelector('.ant-modal-title')?.textContent||''));
  if(modals.length!==1)return null;
  const modal=modals[0];
  if([...modal.querySelectorAll('.ant-spin-spinning,.vxe-loading.is--visible')].some(visible))return null;
  const records=[...modal.querySelectorAll('tbody tr')].filter(visible).map(row=>({cells:[...row.querySelectorAll('td')].map(c=>c.textContent.trim()),links:[...row.querySelectorAll('a[href]')].map(a=>({text:a.textContent.trim(),url:a.href})),text:row.innerText.trim()})).filter(r=>r.cells.length&&!/暂无数据|No data/.test(r.text));
  return {records,headers:[...modal.querySelectorAll('th')].map(e=>e.textContent.trim()),empty:records.length===0&&/暂无数据|暂无认领记录|No data/.test(modal.textContent),text:modal.innerText.slice(0,5000)};
}

export function findClaimRecord(history,target){
  if(!history||!Array.isArray(history.records))throw new Error('认领记录未加载，不能确认是否重复');
  const platformLabel=PLATFORM_LABELS[target.platform];
  const records=history.records.filter(r=>r.cells.some(v=>v===target.name)&&r.cells.some(v=>v===platformLabel||v===target.platform));
  if(records.length>1)throw new Error('该商品在目标店铺有多条认领记录，已停止避免重复认领');
  if(!records.length){if(history.empty||history.records.length)return null;throw new Error('认领记录为空但页面未确认无数据');}
  const record=records[0];
  const links=record.links.filter(l=>isClaimEditorUrl(l.url,target.platform));
  if(links.length>1&&new Set(links.map(l=>l.url)).size>1)throw new Error('认领记录包含多个平台商品，无法确定要核对的商品');
  if(/失败|异常|处理中|认领中/.test(record.text))throw new Error('目标店铺已有未成功的认领记录，请先核对，未重复认领');
  const datedHistory=history.headers?.includes('认领时间')&&record.cells.some(c=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(c));
  if(!datedHistory&&!/成功|已认领/.test(record.text)&&links.length!==1)throw new Error('目标店铺认领记录存在，但成功状态无法确认');
  const claimRecordTimeText=record.cells.find(c=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(c));
  return {platformEditUrl:links[0]?.url||null,claimReceipt:record.text,...(claimRecordTimeText?{claimRecordTimeText}:{})};
}

export function verifyNewDraftSiteInitialization({args,identity,collectionEditUrl,claimRecord,skuIds}){
  const submission=args.claimSubmission,target=args.targetStore;
  if(!submission||submission.version!==1||submission.source!=='workbench-persisted-claim'||submission.saveState!=='no-workbench-save-submission')return null;
  if(target.platform!=='temu'||target.site!=='加拿大站'||identity.site.join('、')!=='美国站')return null;
  if(submission.account!==args.erpConnection.expectedAccount||submission.sourceUrl!==args.sourceUrl||submission.collectionEditUrl!==collectionEditUrl)return null;
  if(!/^https:\/\/www\.dianxiaomi\.com\/web\/productCrawl\/edit\?id=\d{6,30}$/.test(collectionEditUrl||''))return null;
  const bound=submission.targetStore;
  if(!bound||bound.platform!==target.platform||bound.name!==target.name||bound.key!==target.key||bound.site!==target.site||(bound.authorizationSite||'')!==(target.authorizationSite||''))return null;
  const submitted=Date.parse(submission.claimSubmittedAt),text=claimRecord?.claimRecordTimeText;
  if(!Number.isFinite(submitted)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(text||''))return null;
  const recorded=Date.parse(text.replace(' ','T')+'+08:00'),delta=recorded-submitted;
  // DXM renders account-local claim times to the minute. Accept only this
  // persisted submission's minute (or the immediately following completion).
  if(!Number.isFinite(recorded)||delta< -60000||delta>90000||submitted>Date.now()+5000)return null;
  if(identity.account!==submission.account||identity.store.length!==1||identity.store[0]!==target.name||!identity.sources.includes(args.sourceUrl)||!isClaimEditorUrl(identity.url,'temu')||!skuIds.length)return null;
  return {version:1,source:'workbench-new-claim',saveState:'no-workbench-save-submission',account:submission.account,sourceUrl:args.sourceUrl,collectionEditUrl,platformEditUrl:identity.url,skuIds:[...skuIds],targetStore:{...target},fromSite:'美国站',toSite:target.site,claimSubmittedAt:submission.claimSubmittedAt,claimRecordTime:new Date(recorded).toISOString(),claimRecordTimeText:text,verifiedAt:new Date().toISOString()};
}

export function readPlatformSourceRows({sourceUrl,targetStore}){
  const headers=[...document.querySelectorAll('thead th[colid]')];
  const skuHeader=headers.find(h=>/^SKU/.test(h.textContent.trim()));
  if(!skuHeader)return null;
  const skuColumn=skuHeader.getAttribute('colid');
  const rows=[...document.querySelectorAll('tr.vxe-body--row')].filter(row=>row.getClientRects().length&&[...row.querySelectorAll('a[href]')].some(a=>a.href===sourceUrl)&&[...row.querySelectorAll('p,span')].some(e=>e.textContent.trim()==='「'+targetStore.name+'」'));
  return rows.map(row=>{
    const cell=row.querySelector('td[colid="'+skuColumn+'"]');
    const skus=targetStore.platform==='temu'?[...cell?.querySelectorAll('table tbody tr')||[]].map(r=>r.querySelector('td')?.textContent.trim()):[...cell?.querySelectorAll('span')||[]].map(s=>s.textContent.trim()).filter(Boolean);
    return {rowId:row.getAttribute('rowid'),sourceUrl,skus,title:row.querySelector('.no-new-line3')?.textContent.trim()||'',store:targetStore.name};
  });
}

export function readClaimEditorIdentity(){
  const field=label=>[...document.querySelectorAll('.ant-form-item')].find(e=>e.querySelector('.ant-form-item-label')?.textContent.trim()===label);
  const selections=label=>[...field(label)?.querySelectorAll('.ant-select-selection-item')||[]].map(e=>e.textContent.trim());
  return {url:location.href,account:document.querySelector('.btn-user .user-name')?.textContent.trim(),sources:[...document.querySelectorAll('input[name="sourceUrl"]')].map(e=>e.value),store:selections('店铺账号'),site:selections('经营站点'),titles:[...field('产品标题')?.querySelectorAll('input,textarea')||[]].map(e=>e.value).filter(Boolean),skus:[...document.querySelectorAll('input[name="variationSku"]')].map(e=>e.value).filter(Boolean)};
}

// The authorization page is available before any product has been imported.
// Read only the rendered shop-name/site cells, never the API credential column.
export function readAuthorizedShops(platform){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const mode=platform==='temu'?{icon:'pddkj',tab:'半托管店铺'}:platform==='tiktok'?{icon:'tiktok',tab:'普通店铺'}:null;
  if(!mode||!document.querySelector('.plat-auth-icon.'+mode.icon+'.active'))return null;
  if([...document.querySelectorAll('.ant-spin-spinning,.vxe-loading.is--visible')].some(visible))return null;
  const selected=[...document.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(visible).find(e=>e.textContent.trim().startsWith(mode.tab));
  const count=selected?.textContent.match(/\((\d+)\)/)?.[1];if(count===undefined)return null;
  const headers=[...document.querySelectorAll('thead th[colid]')].filter(visible);
  const nameColumn=headers.find(e=>e.textContent.trim().startsWith('店铺名称'))?.getAttribute('colid');
  const siteColumn=headers.find(e=>e.textContent.trim()==='站点')?.getAttribute('colid');
  if(!nameColumn)return null;
  const rows=[...document.querySelectorAll('tr.vxe-body--row')].filter(row=>visible(row)&&row.querySelector('td[colid="'+nameColumn+'"]'));
  const stores=rows.map(row=>{
    const cell=row.querySelector('td[colid="'+nameColumn+'"] .vxe-cell');
    const name=cell?.firstElementChild?.textContent.trim()||'';
    const status=[...cell?.querySelectorAll('span')||[]].map(e=>e.textContent.trim()).filter(t=>/^(已停用|已禁用|授权失效|已过期)$/.test(t));
    return {platform,name,disabled:status.length>0,authorizationSite:siteColumn?row.querySelector('td[colid="'+siteColumn+'"]')?.textContent.trim()||'':''};
  });
  if(stores.some(s=>!s.name))throw new Error('授权店铺名称读取不完整，未同步');
  if(stores.length!==Number(count))return null;
  if(!stores.length&&![...document.querySelectorAll('div,span')].some(e=>visible(e)&&e.children.length===0&&/^未授权店铺$/.test(e.textContent.trim())))return null;
  return {stores,count:Number(count),source:'authorization-page'};
}

function validSource(args){
  if(!/^\d{6,32}$/.test(args.goodsId||'')||temuGoodsId(args.sourceUrl)!==args.goodsId)throw new Error('待认领的来源链接与商品编号不一致');
}

export function createDxmClaimBrowser(configuration={},transport){
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const library=()=>transport||import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  async function withPage(bound,fn,{startUrl=COLLECTION_URL}={}){
    if(bound.browserConfig?.type!=='chrome')throw new Error('自动认领仅支持绑定的谷歌浏览器');
    if(!bound.erpConnection?.expectedAccount)throw new Error('请先绑定店小秘账号');
    const lib=await library(),info=await lib.connection(bound.browserConfig),browser=await lib.connect(info.ws);
    let page,targetId,keep=false;const children=[];
    try{
      ({targetId}=await browser.send('Target.createTarget',{url:'about:blank',background:true}));
      page=await lib.pageById(info,targetId);await page.send('Page.enable');await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      await navigate(page,lib,startUrl);await checkAccount(page,bound.erpConnection.expectedAccount);
      if(startUrl===COLLECTION_URL)await selectAllRecords(page,lib);
      return await fn(page,lib,value=>{keep=value!==false;},{browser,info,targetId,children});
    }finally{
      for(const child of children){child.page.close();await browser.send('Target.closeTarget',{targetId:child.targetId}).catch(()=>{});}
      if(page)await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});
      page?.close();if(targetId&&!keep)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();
    }
  }
  async function navigate(page,lib,url){
    if(url!==COLLECTION_URL&&url!==AUTHORIZATION_URL&&!Object.values(PLATFORM_LIST_URLS).includes(url)&&!Object.keys(PLATFORM_LABELS).some(p=>isClaimEditorUrl(url,p)))throw new Error('认领流程只允许打开店小秘授权页、采集箱与已核对的平台编辑页');
    const nav=await page.send('Page.navigate',{url});if(nav.errorText)throw new Error('店小秘页面打开失败：'+nav.errorText);
    await lib.poll(async()=>{
      try{return await page.evaluate(expected=>location.href===expected&&document.readyState==='complete'&&!!document.querySelector('.btn-user .user-name')?.textContent.trim(),url);}
      catch(e){if(/context|navigat/i.test(e.message))return false;throw e;}
    },{timeout:45000,label:'店小秘认领页面加载'});
  }
  async function checkAccount(page,expected){
    const actual=await page.evaluate(()=>({url:location.href,account:document.querySelector('.btn-user .user-name')?.textContent.trim()}));
    if(actual.account!==expected||actual.url!==COLLECTION_URL&&actual.url!==AUTHORIZATION_URL&&!Object.values(PLATFORM_LIST_URLS).includes(actual.url)&&!Object.keys(PLATFORM_LABELS).some(p=>isClaimEditorUrl(actual.url,p)))throw new Error('店小秘登录账号或页面已变化，已停止自动认领');
  }
  async function selectAllRecords(page,lib){
    await click(page,lib,{selector:'[role="tab"][id$="-tab-"]'});
    await lib.poll(()=>page.evaluate(()=>document.querySelector('[role="tab"][id$="-tab-"]')?.getAttribute('aria-selected')==='true'),{timeout:15000,label:'全部采集记录'});
  }
  async function click(page,lib,locator){
    const point=await lib.poll(()=>page.evaluate(({selector,text})=>{
      const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
      const elements=[...document.querySelectorAll(selector)].filter(e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&(text===undefined||e.textContent.trim()===text));
      if(elements.length>1)throw new Error('认领操作控件不唯一，已停止');if(!elements.length)return null;
      const el=elements[0];el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
    },locator),{timeout:15000,label:'可操作的认领控件：'+(locator.text||locator.selector)});
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  }
  async function sourceRows(page,lib,args){
    validSource(args);
    const tab=await lib.poll(()=>page.evaluate(()=>{
      if([...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'))return null;
      return [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find(e=>/-tab-(?:no)?$/.test(e.id))?.id||null;
    }),{timeout:45000,label:'采集分类查询加载完成'});
    const sourceMode=await page.evaluate(readCollectionSourceMode);
    if(sourceMode.groupCount!==1||sourceMode.sourceCount!==1||sourceMode.activeCount>1)throw new Error('认领搜索类型控件不唯一或状态不明确，未继续认领');
    if(!sourceMode.selected)await click(page,lib,{selector:COLLECTION_SOURCE_MODE_SELECTOR,text:'来源URL'});
    await lib.poll(async()=>!!(await page.evaluate(readCollectionSourceMode)).selected,{timeout:15000,label:'认领来源URL查询方式已选中'});
    await page.evaluate(sourceUrl=>{
      const el=document.querySelector('#c-searchValue');if(!el||el.disabled||el.readOnly)throw new Error('来源链接查询输入框已变化');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,sourceUrl);
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    },args.sourceUrl);
    await click(page,lib,{selector:'button',text:'搜索'});
    return lib.poll(()=>page.evaluate(withCollectionSourceMode(({sourceUrl,tab},sourceMode)=>{
      // The public search keeps the previous rows under this page-wide mask.
      // A matching old row is not the completed result of the current search.
      if([...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'))return null;
      if(document.getElementById(tab)?.getAttribute('aria-selected')!=='true'||document.querySelector('#c-searchValue')?.value!==sourceUrl||!sourceMode.selected)throw new Error('认领查询的分类、来源URL方式或输入值发生变化，未继续认领');
      const rows=[...document.querySelectorAll('table a[href]')].filter(a=>a.href===sourceUrl&&a.getClientRects().length).map(a=>a.closest('tr')).filter(Boolean);
      const records=rows.map(row=>({sourceUrl,title:row.querySelector('.no-new-line4')?.textContent.trim()||'',editUrl:row.querySelector('a[href^="/web/productCrawl/edit?"]')?.href||'',hasClaimHistory:[...row.querySelectorAll('a,button,[role="button"]')].some(e=>e.textContent.trim()==='查看记录'),text:row.innerText.slice(0,4000)}));
      const unique=[...new Map(records.map(r=>[r.editUrl||r.text,r])).values()];return unique.length?unique:null;
    }),{sourceUrl:args.sourceUrl,tab}),{timeout:45000,label:'来源链接完全一致的已导入商品'});
  }
  async function rowAction(page,lib,sourceUrl,text){
    const point=await lib.poll(()=>page.evaluate(({sourceUrl,text})=>{
      const rows=[...document.querySelectorAll('table a[href]')].filter(a=>a.href===sourceUrl&&a.getClientRects().length).map(a=>a.closest('tr')).filter(Boolean);
      // VXE repeats every cell in its fixed-column tables. Scrolling their
      // hidden action copies can move the real button after its point is read.
      const candidates=[...new Set(rows.flatMap(row=>[...row.querySelectorAll('a,button,[role="button"]')].filter(e=>e.textContent.trim()===text&&e.getClientRects().length&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!e.closest('.fixed--hidden')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none')))];
      if(candidates.length>1)throw new Error('同来源商品的操作入口不唯一');if(!candidates.length)return null;
      const el=candidates[0];el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
    },{sourceUrl,text}),{timeout:15000,label:'商品行操作：'+text});
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  }
  async function openClaimModal(page,lib,sourceUrl){
    await rowAction(page,lib,sourceUrl,'认领');
    return lib.poll(async()=>{const value=await page.evaluate(readClaimModal);return value?.stores.length?value:null;},{timeout:45000,label:'店小秘店铺认领选项'});
  }
  async function changeCheckbox(page,lib,{name,platform,checked}){
    const point=await lib.poll(()=>page.evaluate(({name,platform,checked})=>{
      const norm=s=>String(s||'').replace(/\s+/g,'');
      const modal=[...document.querySelectorAll('.ant-modal')].find(e=>e.getClientRects().length&&norm(e.querySelector('.ant-modal-title')?.textContent)==='选择店铺-认领到采集箱');
      if(!modal)return null;
      const labels=[...modal.querySelectorAll('label')].filter(e=>e.getClientRects().length&&e.textContent.trim()===name&&e.querySelector('input[type="checkbox"]'));
      const groupName={tiktok:'tiktok',temu:'popTemu'}[platform];
      const matches=groupName?labels.filter(el=>el.closest('.shop-div')?.getAttribute('name')===groupName):labels;
      if(matches.length!==1)throw new Error('目标认领复选框不唯一或已变化');
      const el=matches[0],input=el.querySelector('input[type="checkbox"]');if(input.disabled)throw new Error('认领选项已禁用');if(input.checked===checked)return {done:true};
      el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
    },{name,platform,checked}),{timeout:15000,label:'选择认领店铺：'+name});
    if(point.done)return;
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  }
  async function history(page,lib,args,record,{requireRecord=false}={}){
    // Newly imported products have no history link at all. Absence alone does
    // not prove that they are unclaimed: verify the same source and common ID
    // in the public Unclaimed tab before treating their history as empty.
    if(!record.hasClaimHistory&&!requireRecord){
      await click(page,lib,{selector:'[role="tab"][id$="-tab-no"]'});
      await lib.poll(()=>page.evaluate(()=>document.querySelector('[role="tab"][id$="-tab-no"]')?.getAttribute('aria-selected')==='true'),{timeout:15000,label:'未认领采集记录'});
      const unclaimed=await uniqueSource(page,lib,args);
      if(unclaimed.editUrl!==record.editUrl||!claimTitlesMatch(unclaimed.title,record.title,args.targetStore.platform))throw new Error('未认领分类中的商品身份已变化，未提交认领');
      if(!unclaimed.hasClaimHistory)return {records:[],headers:[],empty:true,source:'unclaimed-source-match',collectionEditUrl:unclaimed.editUrl};
    }
    await rowAction(page,lib,args.sourceUrl,'查看记录');
    const records=await lib.poll(()=>page.evaluate(readClaimRecords),{timeout:15000,label:'商品认领记录'});
    await click(page,lib,{selector:'.ant-modal button',text:'取消'});return records;
  }
  async function uniqueSource(page,lib,args){
    const rows=await sourceRows(page,lib,args);if(rows.length!==1)throw new Error('店小秘存在多条同来源商品，无法自动认领');
    const record=rows[0];if(!record.title||/采集失败|采集中/.test(record.text))throw new Error('该来源商品尚未成功导入，不能认领');
    return record;
  }
  async function findPlatformProduct(page,lib,args,session,claimIdentity){
    const target=args.targetStore,expectedSkus=args.product?.skus?.map(s=>String(s.id)).sort();
    if(!expectedSkus?.length||!args.product?.title)throw new Error('缺少原始商品SKU和标题，无法核对平台认领商品');
    await navigate(page,lib,PLATFORM_LIST_URLS[target.platform]);await checkAccount(page,args.erpConnection.expectedAccount);
    await click(page,lib,{selector:'.in-screen-single .d-tag-group-item',text:target.name});
    await click(page,lib,{selector:'.d-tag-group-item',text:'SKU'});
    await page.evaluate(sku=>{
      const e=document.querySelector('input[name="tableSearchInput"]');if(!e||e.disabled||e.readOnly)throw new Error('平台采集箱SKU查询框已变化');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,sku);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
    },expectedSkus[0]);
    await click(page,lib,{selector:'button',text:'搜索'});
    const rows=await lib.poll(async()=>{const value=await page.evaluate(readPlatformSourceRows,{sourceUrl:args.sourceUrl,targetStore:target});return value?.length?value:null;},{timeout:45000,label:'目标店铺采集箱的来源链接和SKU'});
    if(rows.length!==1)throw new Error('目标店铺有多条同来源商品，未继续自动填写');
    const row=rows[0];
    if(!/^\d{6,30}$/.test(row.rowId||'')||!claimTitlesMatch(row.title,args.product.title,target.platform)||JSON.stringify([...row.skus].sort())!==JSON.stringify(expectedSkus))throw new Error('平台采集箱中的标题或SKU与原始商品不一致，未继续自动填写');
    const before=new Set((await session.browser.send('Target.getTargets')).targetInfos.map(t=>t.targetId));
    await click(page,lib,{selector:'tr.vxe-body--row[rowid="'+row.rowId+'"] button',text:'编辑'});
    const editor=await lib.poll(async()=>{
      const current=await page.evaluate(()=>location.href).catch(()=>null);
      if(current&&isClaimEditorUrl(current,target.platform))return page;
      const opened=(await session.browser.send('Target.getTargets')).targetInfos.filter(t=>!before.has(t.targetId)&&t.openerId===session.targetId&&t.type==='page'&&isClaimEditorUrl(t.url,target.platform));
      if(opened.length>1)throw new Error('编辑操作打开了多个商品页，无法确认目标');if(!opened.length)return null;
      const childPage=await lib.pageById(session.info,opened[0].targetId);session.children.push({page:childPage,targetId:opened[0].targetId});return childPage;
    },{timeout:30000,label:'平台商品真实编辑地址'});
    const identity=await lib.poll(async()=>{
      const value=await editor.evaluate(readClaimEditorIdentity);
      if(value.sources.some(s=>s&&s!==args.sourceUrl))throw new Error('平台商品来源链接不一致，未继续自动填写');
      if(value.store.length&&value.store[0]!==target.name)throw new Error('平台商品店铺不一致，未继续自动填写');
      return value.sources.includes(args.sourceUrl)&&value.store.length===1&&value.titles.some(title=>claimTitlesMatch(title,args.product.title,target.platform))?value:null;
    },{timeout:90000,label:'平台编辑页真实商品身份'});
    if(identity.account!==args.erpConnection.expectedAccount||!isClaimEditorUrl(identity.url,target.platform))throw new Error('平台编辑页账号或地址与目标不一致');
    if(identity.skus.length&&JSON.stringify([...identity.skus].sort())!==JSON.stringify(expectedSkus))throw new Error('平台编辑页SKU与原始商品不一致');
    let newDraftSiteInitialization;
    if(target.site&&identity.site.join('、')!==target.site){
      newDraftSiteInitialization=verifyNewDraftSiteInitialization({args,identity,...claimIdentity,skuIds:expectedSkus});
      if(!newDraftSiteInitialization)throw new Error('平台商品经营站点与目标不一致');
    }
    return {platformEditUrl:identity.url,platformSite:identity.site.join('、'),sourceUrl:args.sourceUrl,skuIds:expectedSkus,sourceTitle:args.product.title,listSkuIdentityVerified:true,editorSkuIdentityPending:identity.skus.length===0,...(newDraftSiteInitialization?{newDraftSiteInitialization}:{})};
  }
  async function claim(page,lib,args,retain,session,{verifyOnly=false}={}){
    validSource(args);claimStoreKey(args.targetStore);
    const record=await uniqueSource(page,lib,args);
    const prior=findClaimRecord(await history(page,lib,args,record),args.targetStore);
    if(prior)return {status:'claimed',alreadyPresent:true,evidence:{...prior,...await findPlatformProduct(page,lib,args,session,{collectionEditUrl:record.editUrl,claimRecord:prior}),collectionEditUrl:record.editUrl,sourceUrl:args.sourceUrl,targetStore:args.targetStore,account:args.erpConnection.expectedAccount}};
    if(verifyOnly)return {status:'needs-review',error:'尚未在目标店铺找到已成功认领的记录；未重新认领。'};
    const modal=await openClaimModal(page,lib,args.sourceUrl),target=selectClaimStore(modal.stores,args.targetStore);
    // The modal can remember earlier selections. Select exactly one requested shop.
    for(const selected of modal.stores.filter(s=>s.checked&&(s.platform!==target.platform||s.name!==target.name)))await changeCheckbox(page,lib,{...selected,checked:false});
    await changeCheckbox(page,lib,{...target,checked:true});
    await changeCheckbox(page,lib,{name:'已认领至相同店铺的产品不再认领',checked:true});
    const ready=await page.evaluate(readClaimModal);
    if(!ready||ready.checkedCount!==1||ready.selectedSummary!=='1'||ready.skipDuplicate!==true||!ready.stores.some(s=>s.checked&&s.platform===target.platform&&s.name===target.name))throw new Error('认领店铺选择与任务不一致，未提交');
    if(ready.templateSelections.length)throw new Error('认领弹窗存在已选模板，请先清空模板后同步，未提交认领');
    await checkAccount(page,args.erpConnection.expectedAccount);
    if(typeof args.beforeClaim!=='function')throw new Error('认领任务缺少持久化提交记录，未提交');
    const claimSubmission=await args.beforeClaim({targetStore:target,sourceUrl:args.sourceUrl,collectionEditUrl:record.editUrl});retain();
    await click(page,lib,{selector:'.ant-modal button',text:'确定'});
    await lib.poll(async()=>!await page.evaluate(readClaimModal),{timeout:30000,label:'认领提交结果'});
    // DXM can refresh/remove the original row or cover it after a successful
    // claim. Reopen and query the common list before reading the receipt; never
    // replay the claim action to recover its result.
    await navigate(page,lib,COLLECTION_URL);
    await checkAccount(page,args.erpConnection.expectedAccount);
    await selectAllRecords(page,lib);
    const after=await uniqueSource(page,lib,args);
    if(after.editUrl!==record.editUrl)throw new Error('认领后来源商品记录发生变化，请只核对结果，不要重新提交');
    const result=findClaimRecord(await history(page,lib,args,after,{requireRecord:true}),target);
    if(!result)return {status:'needs-review',error:'认领已提交但未核对到成功记录，请只核对结果，不要重新提交。'};
    const platform=await findPlatformProduct(page,lib,{...args,claimSubmission},session,{collectionEditUrl:record.editUrl,claimRecord:result});
    retain(false);return {status:'claimed',evidence:{...result,...platform,collectionEditUrl:record.editUrl,sourceUrl:args.sourceUrl,targetStore:target,account:args.erpConnection.expectedAccount}};
  }
  async function listStores(bound){
    return withPage(bound,async(page,lib)=>{
      const stores=[];
      for(const [platform,icon,tabSuffix] of [['tiktok','tiktok','-tab-site'],['temu','pddkj','-tab-1']]){
        await click(page,lib,{selector:'.plat-auth-icon.'+icon});
        await lib.poll(()=>page.evaluate(icon=>!!document.querySelector('.plat-auth-icon.'+icon+'.active'),icon),{timeout:15000,label:'已授权平台：'+PLATFORM_LABELS[platform]});
        await click(page,lib,{selector:'[role="tab"][id$="'+tabSuffix+'"]'});
        const result=await lib.poll(()=>page.evaluate(readAuthorizedShops,platform),{timeout:30000,label:'完整的'+PLATFORM_LABELS[platform]+'已授权店铺列表'});
        stores.push(...result.stores.map(s=>({...s,key:claimStoreKey(s)})));
        await checkAccount(page,bound.erpConnection.expectedAccount);
      }
      for(const store of stores){if(!store.disabled)selectClaimStore(stores,store);}
      return {stores,account:bound.erpConnection.expectedAccount,observedAt:new Date().toISOString(),source:'authorization-page'};
    },{startUrl:AUTHORIZATION_URL});
  }
  return {
    listStores,
    preflightClaim:async args=>{
      claimStoreKey(args.targetStore);
      const current=await listStores(args),target=selectClaimStore(current.stores,args.targetStore);
      return {status:'ready',targetStore:{...args.targetStore,...target},account:current.account,observedAt:current.observedAt,source:current.source};
    },
    claimProduct:args=>withPage(args,(page,lib,retain,session)=>claim(page,lib,args,retain,session)),
    verifyClaim:args=>withPage(args,(page,lib,retain,session)=>claim(page,lib,args,retain,session,{verifyOnly:true}))
  };
}
