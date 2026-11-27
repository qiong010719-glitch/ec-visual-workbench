import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {productIdentity} from './temu-front-browser.mjs';
import {readTemuListing,listingReadiness,readTemplateCategoryPath} from './dxm-listing-prepare.mjs';
import {readTemplateIdentity,templateSaveSnapshotsMatch,templateUiAction} from './dxm-template-browser.mjs';
import {readRequiredFields,planRequiredFields} from './dxm-required-fields.mjs';
import {verifySourcePriceEvidence} from './dxm-required-platform-browser.mjs';
import {categoryPathMatches} from './dxm-category-browser.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const origin='https://www.dianxiaomi.com',collectionUrl=origin+'/web/popTemu/pageList/draft';
const now=()=>new Date().toISOString();
const copy=value=>structuredClone(value);
const siteKey=value=>String(value||'').trim().replace(/站$/,'');
const accepted=new Set(['submitted','listed','online','reviewing','pending-launch']);
const validEdit=value=>{try{const u=new URL(value);return u.origin===origin&&u.pathname==='/web/popTemu/edit'&&/^\d{6,30}$/.test(u.searchParams.get('id')||'')&&!u.username&&!u.password&&!u.hash;}catch{return false;}};
const stop=args=>{if(args.isStopped?.())throw new Error('任务已暂停，未继续移动或发布商品');};

// The list has duplicate VXE rows for pinned columns. Treat copies as one
// record, while requiring one visible, unoccluded action for that exact record.
export function readPublicationList(expected){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  if(location.origin!=='https://www.dianxiaomi.com'||!/^\/web\/popTemu\/pageList\/(draft|offline|online)$/.test(location.pathname))throw new Error('不在商品发布列表');
  const account=document.querySelector('.btn-user .user-name')?.textContent.trim();
  if(account!==expected.account)throw new Error('发布列表账号与工作台绑定不一致');
  if([...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(visible))return null;
  const headers=[...document.querySelectorAll('thead th[colid]')],siteColumn=headers.find(header=>header.textContent.trim()==='站点')?.getAttribute('colid');
  const goods=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['www.temu.com','temu.com'].includes(u.hostname)?u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||(u.pathname==='/goods.html'?u.searchParams.get('goods_id'):null):null;}catch{return null;}};
  const groups=new Map();
  for(const element of [...document.querySelectorAll('tr[rowid]')].filter(visible)){
    const id=element.getAttribute('rowid');if(!/^\d{6,30}$/.test(id||''))continue;
    const item=groups.get(id)||{draftId:id,sourceGoodsIds:[],storeNames:[],sites:[],texts:[],visibleCopies:0};
    item.sourceGoodsIds.push(...[...element.querySelectorAll('a[href]')].map(link=>goods(link.href)).filter(Boolean));
    item.storeNames.push(...[...element.innerText.matchAll(/「([^」]+)」/g)].map(match=>match[1]));
    if(siteColumn){const site=element.querySelector(`td[colid="${siteColumn}"]`)?.innerText.trim().split('\n')[0];if(site)item.sites.push(site);}
    item.texts.push(element.innerText);item.visibleCopies++;groups.set(id,item);
  }
  const rows=[...groups.values()].map(item=>({...item,sourceGoodsIds:[...new Set(item.sourceGoodsIds)],storeNames:[...new Set(item.storeNames)],sites:[...new Set(item.sites)]}));
  const total=Number(document.body.innerText.match(/共\s*(\d+)\s*条记录/)?.[1]??NaN);
  const empty=[...document.querySelectorAll('.vxe-table--empty-content,.ant-empty-description')].some(element=>visible(element)&&element.textContent.includes('暂无数据'));
  if(!Number.isFinite(total)&&!empty)return null;
  const next=[...document.querySelectorAll('.ant-pagination-next,.vxe-pager--next-btn')].find(visible);
  const nextEnabled=!!next&&!next.disabled&&next.getAttribute('aria-disabled')!=='true'&&!next.classList.contains('ant-pagination-disabled')&&!next.classList.contains('is--disabled');
  const filters=[...document.querySelectorAll('.in-screen-single,.in-screen-multiple')].filter(visible).map(group=>({title:group.querySelector('.title')?.textContent.trim()||'',selected:[...group.querySelectorAll('.d-tag-group-item.active')].filter(visible).map(element=>element.textContent.trim())})).filter(group=>/^(店铺账号|站点)[：:]/.test(group.title));
  return {url:location.href,account,rows,total:empty&&!Number.isFinite(total)?0:total,empty,nextEnabled,filters,search:document.querySelector('input[name="tableSearchInput"]')?.value||''};
}

export function publicationRowAction({expected,action}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  if(location.href!==expected.listUrl||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('移动或发布前页面与账号已变化');
  const rows=[...document.querySelectorAll('tr[rowid]')].filter(row=>visible(row)&&row.getAttribute('rowid')===expected.draftId);
  if(!rows.length)throw new Error('当前页面没有本次目标草稿');
  const goods=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['www.temu.com','temu.com'].includes(u.hostname)?u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||(u.pathname==='/goods.html'?u.searchParams.get('goods_id'):null):null;}catch{return null;}};
  const sourceIds=[...new Set(rows.flatMap(row=>[...row.querySelectorAll('a[href]')].map(link=>goods(link.href)).filter(Boolean)))];
  const names=[...new Set(rows.flatMap(row=>[...row.innerText.matchAll(/「([^」]+)」/g)].map(match=>match[1])))];
  const siteColumn=[...document.querySelectorAll('thead th[colid]')].find(header=>header.textContent.trim()==='站点')?.getAttribute('colid');
  const sites=[...new Set(rows.map(row=>siteColumn?row.querySelector(`td[colid="${siteColumn}"]`)?.innerText.trim().split('\n')[0]:null).filter(Boolean))];
  const siteKey=value=>String(value||'').trim().replace(/站$/,'');
  if(sourceIds.length!==1||sourceIds[0]!==expected.goodsId||names.length!==1||names[0]!==expected.storeName||sites.length!==1||siteKey(sites[0])!==siteKey(expected.site))throw new Error('目标草稿的来源商品、店铺或站点未唯一匹配，未移动或发布');
  const label=action==='move'?'移入待发布':action==='publish'?'发布':null;
  if(!label)throw new Error('不支持的商品操作');
  const candidates=rows.flatMap(row=>[...row.querySelectorAll('button,a')]).filter(element=>visible(element)&&!element.disabled&&element.getAttribute('aria-disabled')!=='true'&&element.textContent.trim()===label);
  candidates[0]?.scrollIntoView({block:'center',inline:'nearest'});
  const positions=[];
  for(const element of candidates){const rect=element.getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};if(element.contains(document.elementFromPoint(point.x,point.y)))positions.push(point);}
  const unique=[...new Map(positions.map(point=>[`${point.x}:${point.y}`,point])).values()];
  if(unique.length!==1)throw new Error(`目标草稿的${label}入口不存在、不唯一或被遮挡`);
  return unique[0];
}

export function publicationOutcome(result,{movedToPending=false,publicationNotSubmitted=false,readOnly=false}={}){
  const status=result?.publicationStatus||'unknown';
  return {...copy(result||{}),status:status==='failed'?'failed':status==='unknown'?'needs-review':status,publicationStatus:status,published:status==='online',submitted:accepted.has(status),accepted:accepted.has(status),
    movedToPending,publicationNotSubmitted,readOnly,issues:result?.error?[result.error]:status==='unknown'?['发布结果尚未核实，未自动重新提交']:[]};
}

export function createDxmTemplatePublisher(configuration={},transport){
  const libraries=async()=>({browser:transport||await import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href),publication:transport?.publication||await import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/temu-publish.mjs')).href)});
  function identity(args,{forPublish=false,forMove=false}={}){
    const {row,storeBinding,templateSnapshot}=args;
    if(templateSnapshot?.platform!=='temu'||!row||!storeBinding||args.browserConfig?.type!=='chrome'||!args.erpConnection?.expectedAccount||!validEdit(row.platformEditUrl)||productIdentity(row.sourceUrl)!==row.goodsId)throw new Error('缺少已核实的Temu草稿、来源商品或账号绑定');
    const draftId=new URL(row.platformEditUrl).searchParams.get('id');
    if(row.draftId&&row.draftId!==draftId||row.storeBindingKey!==storeBinding.key||row.storeName!==storeBinding.storeName||siteKey(row.site)!==siteKey(storeBinding.site))throw new Error('发布的草稿、店铺或站点与任务不一致');
    if(forPublish&&(args.completionMode==='pending'||templateSnapshot.completionMode==='pending'||args.workflowMode==='required-fields'||templateSnapshot.workflowMode==='required-fields'))throw new Error('本任务只允许转入待发布，不能提交平台发布');
    if(forPublish||forMove){
      if(row.publishIntent)throw new Error('已有发布提交记录，只能只读核对，不能再次发布');
      if(row.moveIntent&&row.moveIntent.status!=='confirmed')throw new Error('移入待发布的结果未知，需要先只读核对');
      if(row.ready!==true||row.saved!==true||row.issues?.length||row.saveIntent?.status!=='confirmed'||!row.saveIntent.payload?.expectedSnapshot)throw new Error('只能发布已保存并独立核验的本批商品');
      if(forPublish&&typeof args.beforePublish!=='function')throw new Error('缺少发布前执行记录，未提交发布');
      if(forMove&&typeof args.beforeMoveToPending!=='function')throw new Error('缺少移入待发布前执行记录，未移动商品');
    }
    return {draftId,goodsId:row.goodsId,storeBindingKey:storeBinding.key,storeName:storeBinding.storeName,site:storeBinding.site,sourceUrl:row.sourceUrl,account:args.erpConnection.expectedAccount};
  }
  async function owned(args,work,kind='listingPublication'){
    const {browser:lib,publication}=await libraries(),info=await lib.connection(args.browserConfig),browser=await lib.connect(info.ws);let targetId,page,created=false;
    try{
      const prior=args.tabs?.[kind],targets=await info.targets();
      if(prior&&targets.some(target=>(target.id||target.targetId)===prior&&target.type==='page'&&(target.url==='about:blank'||target.url?.startsWith(origin+'/web/popTemu/'))))targetId=prior;
      if(!targetId){({targetId}=await browser.send('Target.createTarget',{url:'about:blank'}));created=true;await args.onTarget?.(kind,targetId,{owned:true});}
      page=await lib.pageById(info,targetId);await page.send('Page.enable');return await work(page,lib,publication);
    }finally{page?.close();if(created&&!args.onTarget&&targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
  }
  async function account(page,lib,expected){await lib.poll(()=>page.evaluate(account=>document.querySelector('.btn-user .user-name')?.textContent.trim()===account,expected.account),{timeout:30000,label:'发布操作账号核对'});}
  async function navigate(page,lib,url){const result=await page.send('Page.navigate',{url});if(result.errorText)throw new Error('发布页面打开失败：'+result.errorText);await lib.poll(()=>page.evaluate(url=>location.href===url&&document.readyState==='complete',url),{timeout:45000,label:'发布页面加载'});}
  async function readStatus(page,lib,publication,expected){
    const result=await publication.checkPublicationOnPage(page,{row:{draftId:expected.draftId}});await account(page,lib,expected);return result;
  }
  async function point(page,position){await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});}
  async function locate(page,lib,args,url,expected){
    await navigate(page,lib,url);await account(page,lib,expected);
    for(let attempt=0;attempt<4;attempt++){
      const list=await lib.poll(()=>page.evaluate(readPublicationList,expected),{timeout:30000,label:'发布列表加载'});
      if(list.search)throw new Error('发布列表存在未清除的搜索条件，请先核对范围');
      const filter=list.filters.find(group=>group.selected.length!==1||group.selected[0]!=='全部');
      if(!filter)break;
      const position=await page.evaluate(templateUiAction,{expected:{url,account:expected.account},locator:{filterTitle:filter.title,text:'全部'}});if(!position)throw new Error('发布列表筛选条件不能安全清除');stop(args);await point(page,position);
    }
    for(let count=0;count<100;count++){
      stop(args);const list=await lib.poll(()=>page.evaluate(readPublicationList,expected),{timeout:30000,label:'本批发布草稿定位'});
      if(list.filters.some(group=>group.selected.length!==1||group.selected[0]!=='全部'))throw new Error('发布列表仍有未清除的筛选条件');
      const row=list.rows.find(item=>item.draftId===expected.draftId);if(row)return {row,list};
      if(!list.nextEnabled)return null;
      const before=list.rows.map(item=>item.draftId).join('|'),position=await page.evaluate(templateUiAction,{expected:{url:list.url,account:expected.account},locator:{selector:'.ant-pagination-next:not(.ant-pagination-disabled),.vxe-pager--next-btn:not(.is--disabled)',index:0}});
      if(!position)throw new Error('无法定位发布列表下一页');await point(page,position);
      await lib.poll(async()=>{const next=await page.evaluate(readPublicationList,expected);return next&&next.rows.map(item=>item.draftId).join('|')!==before;},{timeout:30000,label:'发布草稿翻页'});
    }
    throw new Error('发布草稿超过100页仍未定位，未提交操作');
  }
  async function verifySaved(page,lib,args,expected){
    await navigate(page,lib,args.row.platformEditUrl);await account(page,lib,expected);
    const actual=await lib.poll(async()=>{const result=await page.evaluate(readTemplateIdentity);return result.loaded&&result.store.length&&result.site.length&&result.sources.length?result:null;},{timeout:60000,label:'发布前商品身份加载'});
    if(!actual.loaded||actual.store.length!==1||actual.store[0]!==expected.storeName||actual.site.length!==1||siteKey(actual.site[0])!==siteKey(expected.site)||!actual.sources.length||actual.sources.some(source=>productIdentity(source)!==expected.goodsId))throw new Error('发布前商品来源、店铺或站点与保存记录不同');
    const snapshot=await page.evaluate(readTemuListing,{url:actual.url,account:actual.account,storeName:actual.store[0],site:actual.site[0],sourceUrl:actual.sources[0]});
    const intent=args.row.saveIntent?.payload;
    if(!intent?.expectedSnapshot)throw new Error('缺少本批已保存快照，不能确认发布准备完成');
    if(intent.expectedSnapshot.categoryPath)snapshot.categoryPath=await page.evaluate(readTemplateCategoryPath);
    if(intent.expectedSnapshot.requiredFields)snapshot.requiredFields=await page.evaluate(readRequiredFields,{expected:{url:actual.url,account:actual.account,storeName:actual.store[0],site:actual.site[0],sourceUrl:actual.sources[0]}});
    if(intent.templateId!==args.templateSnapshot.id||intent.templateVersion!==args.templateSnapshot.version||intent.storeBindingKey!==expected.storeBindingKey||String(intent.goodsId)!==expected.goodsId||!templateSaveSnapshotsMatch(snapshot,intent.expectedSnapshot))throw new Error('发布前回读与本批保存前快照不一致，未移动或发布');
    const issues=listingReadiness(snapshot);
    if(snapshot.requiredFields){const required=planRequiredFields(snapshot.requiredFields);issues.push(...required.issues,...required.missing.map(field=>'必填项尚未完整：'+field.label));}
    if(intent.priceEvidence||args.templateSnapshot.workflowMode==='required-fields'||intent.expectedSnapshot.requiredFields&&(args.workflowMode==='required-fields'||args.templateSnapshot.rules?.autoFillRequired===true))issues.push(...verifySourcePriceEvidence(snapshot.requiredFields,intent.priceEvidence,{goodsId:expected.goodsId,platform:'temu'}).issues);
    if(intent.expectedSnapshot.categoryPath&&args.templateSnapshot.category?.path&&!categoryPathMatches(snapshot.categoryPath,args.templateSnapshot.category.path))issues.push('保存后分类完整路径与本批所选分类不一致');
    if(issues.length)throw new Error('发布前仍缺少商品资料：'+issues.join('；'));return snapshot;
  }
  function capture(page,publication,expected){
    const requests=new Map(),pending=new Set();let result=null;
    const offResponse=page.on('Network.responseReceived',event=>{try{const url=new URL(event.response.url);if(url.origin!==origin)return;if(/^\/api\/popTemuProduct\/batchPublish[^/]*\.json$/.test(url.pathname))requests.set(event.requestId,'receipt');else if(url.pathname==='/api/popTemuProduct/pageList.json')requests.set(event.requestId,'listing');}catch{}});
    const offFinished=page.on('Network.loadingFinished',event=>{if(!requests.has(event.requestId))return;const work=page.send('Network.getResponseBody',{requestId:event.requestId}).then(body=>{const text=body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body,data=publication.parseErpResponse(text);const found=requests.get(event.requestId)==='receipt'?publication.publicationReceipt(data,expected.draftId):publication.listingPublication(data,expected.draftId);if(found&&(accepted.has(found.publicationStatus)||found.publicationStatus==='failed'))result=found;}).catch(()=>{}).finally(()=>pending.delete(work));pending.add(work);});
    return {get result(){return result;},async close(){offResponse();offFinished();await Promise.allSettled([...pending]);}};
  }
  async function enhancedPublish(page,lib,publication,args,expected,evidenceDirectory){
    const url=origin+'/web/popTemu/pageList/offline',located=await locate(page,lib,args,url,expected);if(!located)throw new Error('待发布列表未找到本批草稿，未发起发布');
    const position=await page.evaluate(publicationRowAction,{expected:{...expected,listUrl:url},action:'publish'});
    stop(args);await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...position});
    const menu=()=>page.evaluate(({url,account})=>{const visible=element=>!!element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';if(location.href!==url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==account)throw new Error('发布菜单页面或账号已变化');const items=[...document.querySelectorAll('[role="menuitem"]')].filter(element=>visible(element)&&element.innerText.trim()==='发布');if(items.length!==1)return null;const element=items[0],rect=element.getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};return element.contains(document.elementFromPoint(point.x,point.y))?point:null;},{url,account:expected.account});
    const menuPosition=await lib.poll(menu,{timeout:10000,label:'唯一草稿发布菜单'});
    await page.send('Network.enable');const observer=capture(page,publication,expected);
    try{
      const current=await page.evaluate(readPublicationList,expected),currentRow=current?.rows.find(row=>row.draftId===expected.draftId);
      if(!currentRow||currentRow.sourceGoodsIds.length!==1||currentRow.sourceGoodsIds[0]!==expected.goodsId||currentRow.storeNames.length!==1||currentRow.storeNames[0]!==expected.storeName||currentRow.sites.length!==1||siteKey(currentRow.sites[0])!==siteKey(expected.site))throw new Error('发布菜单对应的商品身份已变化，未提交发布');
      stop(args);await args.beforePublish({draftId:expected.draftId,goodsId:expected.goodsId,storeBindingKey:expected.storeBindingKey,sourceUrl:expected.sourceUrl,url:args.row.platformEditUrl,stage:'publish',createdAt:now()});stop(args);
      const rechecked=await menu();if(!rechecked||rechecked.x!==menuPosition.x||rechecked.y!==menuPosition.y)throw new Error('发布菜单已变化，提交结果需核对');
      await point(page,rechecked);
      let result;try{result=await lib.poll(()=>observer.result,{timeout:60000,interval:500,label:'本批草稿发布回执'});}catch{
        const reason=await page.evaluate(()=>[...document.querySelectorAll('.ant-modal,.ant-message-notice-content')].filter(element=>element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden').map(element=>element.innerText).join('\n').slice(0,1200));
        if(reason)return {publicationStatus:'unknown',published:false,error:'发布结果待核对：'+reason};
        result=await owned(args,(review,reviewLib,reviewPublication)=>readStatus(review,reviewLib,reviewPublication,expected),'listingPublicationReadback');
        if(!accepted.has(result.publicationStatus)&&result.publicationStatus!=='failed')return {publicationStatus:'unknown',published:false,error:'发布提交后没有取得明确回执，未自动重发'};
      }
      fs.writeFileSync(path.join(evidenceDirectory,'publication.json'),JSON.stringify({draftId:expected.draftId,...result},null,2));return result;
    }finally{await observer.close();}
  }
  async function movePrepared(page,lib,publication,args,expected,before,attempt){
    await verifySaved(page,lib,args,expected);
    if(before.publicationStatus==='draft'){attempt.movedToPending=true;return null;}
    if(args.row.moveIntent)throw new Error('已记录移动后仍不能确认待发布状态，未再次移动');
    if(typeof args.beforeMoveToPending!=='function')throw new Error('缺少移入待发布前执行记录，未操作商品');
    const located=await locate(page,lib,args,collectionUrl,expected);if(!located)throw new Error('采集箱与待发布均未定位本批草稿，未操作其他商品');
    const position=await page.evaluate(publicationRowAction,{expected:{...expected,listUrl:collectionUrl},action:'move'});
    stop(args);await args.beforeMoveToPending({draftId:expected.draftId,goodsId:expected.goodsId,storeBindingKey:expected.storeBindingKey,url:args.row.platformEditUrl,sourceUrl:expected.sourceUrl,from:'collection',to:'pending-publication',createdAt:now()});stop(args);
    const rechecked=await page.evaluate(publicationRowAction,{expected:{...expected,listUrl:collectionUrl},action:'move'});
    if(rechecked.x!==position.x||rechecked.y!==position.y)throw new Error('移入待发布入口已变化，结果需要核对');
    attempt.moveAttempted=true;await point(page,rechecked);
    const moved=await readStatus(page,lib,publication,expected);
    if(accepted.has(moved.publicationStatus))return {...publicationOutcome(moved,{readOnly:true,movedToPending:true}),platformEditUrl:args.row.platformEditUrl};
    if(moved.publicationStatus!=='draft')return {status:'needs-review',publicationStatus:'unknown',published:false,submitted:false,movedToPending:false,publicationNotSubmitted:true,issues:['移入待发布结果尚未核实，未提交发布'],platformEditUrl:args.row.platformEditUrl};
    attempt.movedToPending=true;await args.onMovedToPending?.({draftId:expected.draftId,movedToPending:true,publicationStatus:'draft',checkedAt:now()});return null;
  }
  async function moveToPending(args){
    const expected=identity(args,{forMove:true});stop(args);
    return owned(args,async(page,lib,publication)=>{
      const attempt={movedToPending:args.row.moveIntent?.status==='confirmed',moveAttempted:false};
      try{
        const before=await readStatus(page,lib,publication,expected);
        if(accepted.has(before.publicationStatus)||before.publicationStatus==='failed')return {...publicationOutcome(before,{readOnly:true,publicationNotSubmitted:true}),ready:false,saved:args.row.saved===true,issues:['商品已不处于可转入待发布的状态，请核对原平台状态'],platformEditUrl:args.row.platformEditUrl};
        const unresolved=await movePrepared(page,lib,publication,args,expected,before,attempt);if(unresolved)return unresolved;
        // Re-open a separate read-only page to establish both location and
        // saved content. No publication routine is reachable from this action.
        const verified=await verifyPublication(args);
        if(verified.publicationStatus!=='draft'||verified.ready!==true||verified.movedToPending!==true)return {...verified,status:'needs-review',publicationNotSubmitted:true,submitted:false};
        return {...verified,status:'pending-ready',published:false,submitted:false,accepted:false,publicationNotSubmitted:true,moveAttempted:attempt.moveAttempted};
      }catch(error){return {status:'needs-review',publicationStatus:'unknown',published:false,submitted:false,...attempt,publicationNotSubmitted:true,issues:[error.message],platformEditUrl:args.row.platformEditUrl};}
    });
  }
  async function publish(args){
    const expected=identity(args,{forPublish:true});stop(args);
    return owned(args,async(page,lib,publication)=>{
      const attempt={movedToPending:args.row.moveIntent?.status==='confirmed',moveAttempted:false};let publishAttempted=false;
      try{
        const before=await readStatus(page,lib,publication,expected);
        if(accepted.has(before.publicationStatus))return {...publicationOutcome(before,{readOnly:true}),platformEditUrl:args.row.platformEditUrl};
        if(before.publicationStatus==='failed')return {...publicationOutcome(before,{readOnly:true}),platformEditUrl:args.row.platformEditUrl};
        const unresolved=await movePrepared(page,lib,publication,args,expected,before,attempt);if(unresolved)return unresolved;
        const evidenceDirectory=path.join(configuration.WORKBENCH_OUTPUT_ROOT||path.join(project,'outputs'),'listing-publications',expected.draftId);fs.mkdirSync(evidenceDirectory,{recursive:true});
        const publisherArgs={...args,beforePublish:async payload=>{await args.beforePublish(payload);publishAttempted=true;}};
        // The enhanced path retains the legacy receipt parser/status reader and
        // supports the current VXE fixed-column copies without modifying DOM.
        const result=await enhancedPublish(page,lib,publication,publisherArgs,expected,evidenceDirectory);
        return {...publicationOutcome(result,{movedToPending:attempt.movedToPending}),platformEditUrl:args.row.platformEditUrl};
      }catch(error){return {status:'needs-review',publicationStatus:'unknown',published:false,submitted:publishAttempted,...attempt,publicationNotSubmitted:!publishAttempted,issues:[error.message],platformEditUrl:args.row.platformEditUrl};}
    });
  }
  async function verifyPublication(args){
    const expected=identity(args);
    return owned(args,async(page,lib,publication)=>{
      const result=await readStatus(page,lib,publication,expected),moved=result.publicationStatus==='draft'||accepted.has(result.publicationStatus);
      const notSubmitted=!args.row.publishIntent&&!accepted.has(result.publicationStatus),outcome=publicationOutcome(result,{movedToPending:moved,publicationNotSubmitted:notSubmitted,readOnly:true});
      let ready=false,saved=args.row.saved===true;
      if(result.publicationStatus==='draft'&&notSubmitted){
        try{await verifySaved(page,lib,args,expected);ready=true;saved=true;}catch(error){outcome.issues.push(error.message);}
      }
      return {...outcome,platformEditUrl:args.row.platformEditUrl,saved,ready,
        verification:{checkedAt:now(),method:'exact-draft-publication-readback',draftId:expected.draftId,account:expected.account,readOnly:true}};
    },'listingPublicationReadback');
  }
  return {publish,moveToPending,verifyPublication,capabilities:{publish:true,moveToPending:true,verifyPublication:true,platforms:['temu']}};
}
