import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {productIdentity} from './temu-front-browser.mjs';

const origin='https://www.dianxiaomi.com',draftUrl=origin+'/web/sheinProduct/draft';
const clone=value=>structuredClone(value),text=value=>String(value??'').replace(/\s+/g,' ').trim();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const site=value=>text(value).replace(/站$/,'');
export const DXM_NATIVE_BATCH_CAPABILITIES=Object.freeze({platform:'shein',nativeSelection:true,nativeOpen:true,nativePrepare:false,nativeSave:false,nativePending:false,nativeMoveToPending:false,publish:false});
const formBlocker=()=>({code:'NATIVE_BATCH_FORM_UNVERIFIED',message:'原生批量表单、分类映射及保存回读尚未完成适配；目前只能核对本批并打开原生编辑入口。'});

export function nativeBatchScope({platform,account,storeBinding,rows}={}){
  if(platform!=='shein')throw new Error('尚未观察到此平台可核对的原生批量入口');
  if(typeof account!=='string'||!text(account)||account.length>120||!storeBinding||typeof storeBinding.storeName!=='string'||!text(storeBinding.storeName)||storeBinding.storeName.length>240)throw new Error('原生批量范围缺少明确账号和店铺');
  if(!Array.isArray(rows)||!rows.length||rows.length>30)throw new Error('原生批量需要明确的1至30件店铺草稿');
  const store={key:text(storeBinding.key),storeName:storeBinding.storeName.trim(),storeId:text(storeBinding.storeId),site:text(storeBinding.site),businessMode:text(storeBinding.businessMode||storeBinding.verifiedPricing?.businessMode).toUpperCase()};
  const members=rows.map(row=>{
    if(typeof row.draftId!=='string'||!/^\d{6,32}$/.test(row.draftId)||typeof row.goodsId!=='string'||productIdentity(row.sourceUrl)!==row.goodsId)throw new Error('原生批量草稿、来源编号或完整来源链接不一致');
    if(row.storeBindingKey&&row.storeBindingKey!==store.key||row.storeName&&row.storeName!==store.storeName||row.site&&site(row.site)!==site(store.site))throw new Error('原生批量不能跨店铺或站点扩大范围');
    if(row.platformEditUrl){const u=new URL(row.platformEditUrl);if(u.origin!==origin||u.pathname!=='/web/sheinProduct/edit'||u.searchParams.get('id')!==row.draftId||u.username||u.password||u.hash)throw new Error('原生批量草稿编辑地址不一致');}
    return {draftId:row.draftId,goodsId:row.goodsId,sourceUrl:row.sourceUrl};
  }).sort((a,b)=>a.draftId.localeCompare(b.draftId));
  if(new Set(members.map(row=>row.draftId)).size!==members.length||new Set(members.map(row=>row.goodsId)).size!==members.length)throw new Error('原生批量包含重复草稿或重复来源商品');
  const value={version:1,platform,account:account.trim(),url:draftUrl,storeBinding:store,rows:members};
  return {...value,scopeKey:hash(value)};
}

function checkedScope(value){const result=nativeBatchScope(value);if(value?.scopeKey&&value.scopeKey!==result.scopeKey)throw new Error('原生批量成员范围已变化');return result;}

// Rendered VXE rows and native checkbox state only. No framework state, request
// bodies or private endpoints are read. The row layout is shared with the
// existing SHEIN list reader; unsupported markup stays an explicit blocker.
export function readDxmNativeBatchPage(expected){
  const visible=element=>{if(!element?.getClientRects().length)return false;for(let node=element;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.getAttribute('aria-hidden')==='true'||node.classList.contains('fixed--hidden')||style.display==='none'||style.visibility==='hidden')return false;}return true;};
  const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
  const account=String(document.querySelector('.btn-user .user-name')?.innerText||'').trim();
  if(expected?.url!=='https://www.dianxiaomi.com/web/sheinProduct/draft'||location.href!==expected.url||account!==expected.account)throw new Error('原生批量页面或账号已变化');
  if([...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(visible))return null;
  const sourceId=value=>{try{const u=new URL(value);if(u.protocol!=='https:'||!['www.temu.com','temu.com'].includes(u.hostname)||u.port||u.username||u.password)return null;return u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||(u.pathname==='/goods.html'&&/^\d{6,32}$/.test(u.searchParams.get('goods_id')||'')?u.searchParams.get('goods_id'):null);}catch{return null;}};
  const groups=new Map();let unidentifiedSelected=0;
  for(const row of [...document.querySelectorAll('tr')].filter(visible)){
    const id=row.getAttribute('rowid'),boxes=[...row.querySelectorAll('td.col--checkbox input[type="checkbox"]')].filter(input=>input.closest('tr')===row&&visible(input.closest('label')||input));
    if(!/^\d{6,32}$/.test(id||'')){if(!row.closest('thead'))unidentifiedSelected+=boxes.filter(input=>input.checked).length;continue;}
    const copies=groups.get(id)||[];copies.push({row,boxes});groups.set(id,copies);
  }
  const siteHeader=[...document.querySelectorAll('thead th[colid]')].filter(visible).find(header=>/^(站点|销售站点)$/.test(tidy(header.innerText)));
  const priceHeaders=[...document.querySelectorAll('thead th[colid]')].filter(header=>visible(header)&&/供货价|申报价格|销售价|售价/.test(header.innerText));
  const rows=[];
  for(const [draftId,copies] of groups){
    const links=[...new Set(copies.flatMap(({row})=>[...row.querySelectorAll('a[href]')].filter(visible).map(a=>a.href)))],sourceUrls=links.filter(sourceId),boxes=copies.flatMap(copy=>copy.boxes);
    const stores=[...new Set(copies.flatMap(({row})=>[...row.innerText.matchAll(/「([^」]+)」/g)].map(match=>match[1].trim())))];
    const modes=[...new Set(copies.flatMap(({row})=>[...row.querySelectorAll('span,div,b')].filter(element=>visible(element)&&!element.children.length&&/^(OBM|OEM|ODM|POP|Marketplace)$/i.test(tidy(element.innerText))).map(element=>tidy(element.innerText).toUpperCase())))];
    const sites=siteHeader?[...new Set(copies.flatMap(({row})=>[...row.querySelectorAll('td[colid]')].filter(cell=>visible(cell)&&cell.getAttribute('colid')===siteHeader.getAttribute('colid')).map(cell=>tidy(cell.innerText.split('\n')[0]))).filter(Boolean))]:[];
    const currencies=[...new Set(copies.flatMap(({row})=>priceHeaders.flatMap(header=>[...row.querySelectorAll('td[colid]')].filter(cell=>visible(cell)&&cell.getAttribute('colid')===header.getAttribute('colid')).flatMap(cell=>[...(`${header.innerText} ${cell.innerText}`).matchAll(/\b(CNY|USD|JPY|EUR|GBP|CAD|AUD)\b/g)].map(match=>match[1])))))];
    rows.push({draftId,sourceUrls,goodsIds:[...new Set(sourceUrls.map(sourceId))],storeNames:stores,sites,siteColumnPresent:!!siteHeader,businessModes:modes,priceCurrencies:currencies,checkboxCount:boxes.length,checked:boxes.length?boxes.every(input=>input.checked):false,checkboxConflict:boxes.some(input=>input.checked)&&boxes.some(input=>!input.checked),checkboxDisabled:boxes.some(input=>input.disabled||input.closest('label')?.getAttribute('aria-disabled')==='true')});
  }
  const body=document.body.innerText,counts=[...new Set([...body.matchAll(/已选(?:择|中)?\s*(\d+)\s*(?:条(?:数据|记录)?|个(?:产品|商品))/g)].map(match=>Number(match[1])))],total=Number(body.match(/共\s*(\d+)\s*条记录/)?.[1]??NaN);
  const selectedCount=counts.length===1?counts[0]:!counts.length&&Number.isSafeInteger(total)&&total===rows.length?rows.filter(row=>row.checked).length:null;
  const texts=['批量操作','批量编辑','批量移入待发布','全属性修改'];
  // The observed trigger includes this decorative private-use arrow glyph.
  // Menu labels may be rendered as generic text spans, not ARIA menuitems.
  const controlText=element=>tidy(element.innerText).replace(/^批量操作\s*\uE007$/,'批量操作');
  let buttons=[...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],li,span,div')].filter(element=>visible(element)&&!element.closest('table')&&texts.includes(controlText(element))&&(element.matches('button,a,[role="button"],[role="menuitem"]')||!element.children.length));
  buttons=buttons.filter(element=>!buttons.some(other=>other!==element&&element.contains(other)&&controlText(element)===controlText(other)));
  const controls=texts.map(label=>({text:label,count:buttons.filter(element=>controlText(element)===label).length,enabledCount:buttons.filter(element=>controlText(element)===label&&!element.disabled&&!element.closest('[aria-disabled="true"],.ant-dropdown-menu-item-disabled,[disabled]')).length}));
  const modalNodes=[...document.querySelectorAll('.ant-modal,[role="dialog"]')].filter(visible),modals=modalNodes.filter(element=>!modalNodes.some(other=>other!==element&&other.contains(element)));
  const dialogs=modals.map(modal=>{const content=tidy(modal.innerText),count=content.match(/共选择\s*(\d+)\s*个产品[，,]?\s*有\s*(\d+)\s*个产品未自动识别出分类/);return {text:content.slice(0,1200),selectedCount:count?Number(count[1]):null,unmappedCount:count?Number(count[2]):null,variantLossWarning:/丢失变种信息/.test(content),buttons:[...modal.querySelectorAll('button,a,[role="button"]')].filter(visible).map(element=>tidy(element.innerText)).filter(Boolean)};});
  const broadSelection=[...document.querySelectorAll('input[type="checkbox"]')].filter(input=>input.checked&&visible(input.closest('label')||input)).some(input=>/(?:全部|所有).*(?:页面|产品|商品|结果)|跨页/.test(tidy(input.closest('label')?.innerText)));
  return {url:location.href,account,rows,total:Number.isSafeInteger(total)?total:null,selectedCount,selectedIds:rows.filter(row=>row.checked).map(row=>row.draftId).sort(),unidentifiedSelected,broadSelection,controls,dialogs,observedAt:new Date().toISOString()};
}

export function nativeBatchReadiness(snapshot,input,{requireSelected=false}={}){
  const scope=checkedScope(input),issues=[],missing=[];
  if(!snapshot||snapshot.url!==scope.url||snapshot.account!==scope.account)return {ready:false,canSelect:false,canOpen:false,missingIds:scope.rows.map(row=>row.draftId),blockers:[{code:'NATIVE_CONTEXT_MISMATCH',message:'原生批量页面尚未加载或账号不一致'},formBlocker()],capabilities:clone(DXM_NATIVE_BATCH_CAPABILITIES)};
  if(snapshot.selectedCount===null||snapshot.selectedCount!==snapshot.selectedIds.length||snapshot.unidentifiedSelected||snapshot.broadSelection)issues.push({code:'NATIVE_SELECTION_UNVERIFIED',message:'存在跨页、未知或数量不一致的已选商品；未扩大选择范围'});
  if(snapshot.selectedIds.some(id=>!scope.rows.some(row=>row.draftId===id)))issues.push({code:'NATIVE_OUTSIDE_SELECTION',message:'页面已勾选本批以外的商品，请先核对原选择'});
  for(const member of scope.rows){
    const matches=snapshot.rows.filter(row=>row.draftId===member.draftId);if(matches.length!==1){missing.push(member.draftId);continue;}
    const row=matches[0];
    if(row.goodsIds.length!==1||row.goodsIds[0]!==member.goodsId||!row.sourceUrls.includes(member.sourceUrl)||row.storeNames.length!==1||row.storeNames[0]!==scope.storeBinding.storeName||row.siteColumnPresent&&scope.storeBinding.site&&(row.sites.length!==1||site(row.sites[0])!==site(scope.storeBinding.site))||scope.storeBinding.businessMode&&(row.businessModes.length!==1||row.businessModes[0]!==scope.storeBinding.businessMode))issues.push({code:'NATIVE_MEMBER_IDENTITY_MISMATCH',draftId:member.draftId,message:'目标草稿的来源链接、店铺、站点或经营模式与本批不一致'});
    if(!row.checkboxCount||row.checkboxConflict||row.checkboxDisabled)issues.push({code:'NATIVE_CHECKBOX_UNVERIFIED',draftId:member.draftId,message:'目标草稿复选框缺失、状态冲突或不可用'});
  }
  if(missing.length)issues.push({code:'NATIVE_MEMBERS_NOT_VISIBLE',message:'本批部分草稿不在当前可核对列表中；未全选或跨页扩选'});
  for(const dialog of snapshot.dialogs){
    if(dialog.variantLossWarning||dialog.unmappedCount>0)issues.push({code:'NATIVE_CATEGORY_MAPPING_REQUIRED',message:'原生批量要求先对应产品分类；跳过会丢失变种，已停止并保留页面'});
    else issues.push({code:'NATIVE_DIALOG_UNVERIFIED',message:'原生批量出现尚未适配的弹窗，已保留页面'});
    if(dialog.selectedCount!==null&&dialog.selectedCount!==scope.rows.length)issues.push({code:'NATIVE_DIALOG_COUNT_MISMATCH',message:'批量弹窗的产品数量与本批不一致'});
  }
  const selectionExact=scope.rows.length===snapshot.selectedIds.length&&scope.rows.every(row=>snapshot.selectedIds.includes(row.draftId));
  if(requireSelected&&!selectionExact)issues.push({code:'NATIVE_SELECTION_INCOMPLETE',message:'尚未完整且仅勾选本批草稿'});
  const trigger=snapshot.controls.find(control=>control.text==='批量操作'),editor=snapshot.controls.find(control=>control.text==='批量编辑');
  if(!(trigger?.count===1&&trigger.enabledCount===1)&&!(editor?.count===1&&editor.enabledCount===1))issues.push({code:'NATIVE_MENU_UNVERIFIED',message:'未找到唯一且可用的原生批量操作或批量编辑入口'});
  return {ready:false,canSelect:!issues.length,canOpen:!issues.length&&selectionExact,selectionExact,missingIds:missing,blockers:[...issues,formBlocker()],capabilities:clone(DXM_NATIVE_BATCH_CAPABILITIES)};
}

// Only reversible selection and the observed native editor-opening controls
// have locators. There is deliberately no select-all/save/publish/skip locator.
export function nativeBatchUiPoint({expected,locator,scroll=true}={}){
  const visible=element=>{if(!element?.getClientRects().length)return false;for(let node=element;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.getAttribute('aria-hidden')==='true'||node.classList.contains('fixed--hidden')||style.display==='none'||style.visibility==='hidden')return false;}return true;};
  const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
  if(location.href!==expected.url||location.href!=='https://www.dianxiaomi.com/web/sheinProduct/draft'||String(document.querySelector('.btn-user .user-name')?.innerText||'').trim()!==expected.account)throw new Error('原生批量控件所在页面或账号已变化');
  let nodes=[];
  if(locator?.kind==='checkbox'&&/^\d{6,32}$/.test(locator.draftId||'')){
    const copies=[...document.querySelectorAll('tr[rowid]')].filter(row=>row.getAttribute('rowid')===locator.draftId&&visible(row));
    nodes=copies.flatMap(row=>[...row.querySelectorAll('td.col--checkbox input[type="checkbox"]')].filter(input=>input.closest('tr')===row&&!input.checked&&!input.disabled).map(input=>input.closest('label')||input));
  }else if(locator?.kind==='menu'&&['批量操作','批量编辑','批量移入待发布'].includes(locator.text)){
    const controlText=element=>tidy(element.innerText).replace(/^批量操作\s*\uE007$/,'批量操作');
    nodes=[...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],li,span,div')].filter(element=>!element.closest('table')&&controlText(element)===locator.text&&(element.matches('button,a,[role="button"],[role="menuitem"]')||!element.children.length));
    nodes=nodes.filter(element=>!nodes.some(other=>other!==element&&element.contains(other)&&controlText(other)===locator.text));
  }else throw new Error('此原生批量动作未开放：不允许全选、跳过分类、保存或发布');
  nodes=nodes.filter(element=>visible(element)&&!element.disabled&&!element.closest('[aria-disabled="true"],.ant-dropdown-menu-item-disabled,[disabled]'));
  const hits=[];
  for(const element of nodes){
    if(element.tagName==='A'&&element.getAttribute('href')&&!/^(?:#|javascript:(?:void\(0\)|;)?;?)$/.test(element.getAttribute('href'))){const u=new URL(element.href);if(u.origin!==location.origin)throw new Error('原生批量入口指向其他网站');}
    if(scroll)element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const rect=element.getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    if(element.contains(document.elementFromPoint(point.x,point.y)))hits.push({point,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},targetKey:locator.kind+':'+(locator.draftId||locator.text)});
  }
  if(hits.length>1)throw new Error('原生批量控件存在多个可点击副本，未猜测选择');return hits[0]||null;
}

export function nativeBatchOpenIntent(snapshot,input,requestId){
  const scope=checkedScope(input),readiness=nativeBatchReadiness(snapshot,scope,{requireSelected:true});
  if(!/^[\w-]{8,100}$/.test(requestId||''))throw new Error('原生批量打开操作需要稳定请求编号');
  if(!readiness.canOpen)throw new Error(readiness.blockers.find(blocker=>blocker.code!=='NATIVE_BATCH_FORM_UNVERIFIED')?.message||'本批原生选择尚未核实');
  return {version:1,operation:'open-native-batch-editor',requestId,scopeKey:scope.scopeKey,scope:clone(scope),selectedIds:[...snapshot.selectedIds],createdAt:new Date().toISOString(),status:'intent-recorded',businessWrite:false};
}

export async function readbackDxmNativeBatch({page,scope:input,intent,onReadback}={}){
  const scope=checkedScope(input);
  if(intent&&(intent.operation!=='open-native-batch-editor'||intent.scopeKey!==scope.scopeKey||!isDeepStrictEqual(intent.scope,scope)))throw new Error('原生批量打开记录不属于本批成员范围');
  let snapshot=null,blockers=[formBlocker()];
  try{snapshot=await page.evaluate(readDxmNativeBatchPage,{url:scope.url,account:scope.account});blockers=nativeBatchReadiness(snapshot,scope,{requireSelected:true}).blockers;}
  catch(error){blockers.unshift({code:'NATIVE_EDITOR_UNVERIFIED',message:'原生页面已切换或无法读取；批量编辑表单尚未核对，未继续填写或保存'});}
  const result={status:'needs-review',phase:snapshot?.dialogs.some(dialog=>dialog.variantLossWarning||dialog.unmappedCount>0)?'category-mapping-required':'native-form-unverified',retainPage:true,businessWrite:false,capabilities:clone(DXM_NATIVE_BATCH_CAPABILITIES),scopeKey:scope.scopeKey,intent:intent?clone(intent):null,readback:{observedAt:new Date().toISOString(),selectedIds:snapshot?.selectedIds||[],dialogs:snapshot?.dialogs||[],controls:snapshot?.controls||[]},blockers};
  await onReadback?.(clone(result));return result;
}

// The caller supplies an already owned, scoped Chrome page. This helper never
// creates/closes tabs, changes filters, paginates, fills product fields or saves.
export async function openDxmNativeBatchSelection({page,poll,scope:input,requestId,beforeOpen,onReadback,onProgress,isStopped,existingIntent,selectionOnly=false}={}){
  const scope=checkedScope(input),expected={url:scope.url,account:scope.account};let intent=null;
  const stopped=()=>{if(isStopped?.())throw new Error('已暂停原生批量入口操作');};
  const read=async()=>{stopped();return poll(()=>page.evaluate(readDxmNativeBatchPage,expected),{timeout:15000,interval:300,label:'原生批量成员与勾选范围'});};
  const assertScope=(snapshot,requireSelected=false)=>{const readiness=nativeBatchReadiness(snapshot,scope,{requireSelected});if(!(requireSelected?readiness.canOpen:readiness.canSelect))throw new Error(readiness.blockers.find(blocker=>blocker.code!=='NATIVE_BATCH_FORM_UNVERIFIED')?.message||'原生批量范围尚未核实');};
  async function click(locator,requireSelected=false,beforeDispatch){
    stopped();assertScope(await read(),requireSelected);
    const hit=await poll(async()=>{const first=await page.evaluate(nativeBatchUiPoint,{expected,locator}),second=first&&await page.evaluate(nativeBatchUiPoint,{expected,locator,scroll:false});return first&&isDeepStrictEqual(first,second)?second:null;},{timeout:10000,interval:200,label:'原生批量入口位置稳定'});
    stopped();await beforeDispatch?.();stopped();assertScope(await read(),requireSelected);
    const current=await page.evaluate(nativeBatchUiPoint,{expected,locator,scroll:false});if(!isDeepStrictEqual(hit,current))throw new Error('原生批量入口位置或状态已变化，未点击');
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...hit.point});
    try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...hit.point});}finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit.point});}
  }
  if(existingIntent)return readbackDxmNativeBatch({page,scope,intent:existingIntent,onReadback});
  try{
    let snapshot=await read();assertScope(snapshot);
    for(const row of scope.rows){
      snapshot=await read();assertScope(snapshot);
      if(!snapshot.selectedIds.includes(row.draftId)){
        await click({kind:'checkbox',draftId:row.draftId});
        snapshot=await poll(async()=>{const next=await read();assertScope(next);return next.selectedIds.includes(row.draftId)?next:null;},{timeout:10000,interval:200,label:'本批单件勾选回读'});
      }
      await onProgress?.({phase:'native-select',selected:snapshot.selectedIds.length,total:scope.rows.length,scopeKey:scope.scopeKey});
    }
    snapshot=await read();assertScope(snapshot,true);
    if(selectionOnly)return {status:'selected',scopeKey:scope.scopeKey,snapshot,businessWrite:false};
    if(snapshot.controls.find(control=>control.text==='批量编辑')?.enabledCount!==1){await click({kind:'menu',text:'批量操作'},true);snapshot=await poll(async()=>{const next=await read();assertScope(next,true);return next.controls.find(control=>control.text==='批量编辑')?.enabledCount===1?next:null;},{timeout:10000,interval:200,label:'读取原生批量菜单'});}
    if(typeof beforeOpen!=='function')throw new Error('缺少原生打开意图的持久化回调，未点击批量编辑');
    await click({kind:'menu',text:'批量编辑'},true,async()=>{intent=nativeBatchOpenIntent(await read(),scope,requestId);await beforeOpen(clone(intent));});
    // A category-loss warning or a navigation is enough to stop. Lack of a
    // visible result never authorizes replaying the recorded opening action.
    try{await poll(async()=>{try{const next=await page.evaluate(readDxmNativeBatchPage,expected);return next?.dialogs.length||next&&next.controls.find(control=>control.text==='批量编辑')?.count===0;}catch{return true;}},{timeout:5000,interval:250,label:'原生批量入口回读'});}catch{}
    return await readbackDxmNativeBatch({page,scope,intent,onReadback});
  }catch(error){
    const result={status:intent?'needs-review':'blocked',phase:intent?'native-open-unconfirmed':'native-selection-blocked',retainPage:true,businessWrite:false,capabilities:clone(DXM_NATIVE_BATCH_CAPABILITIES),scopeKey:scope.scopeKey,intent:intent?clone(intent):null,blockers:[{code:intent?'NATIVE_OPEN_UNCONFIRMED':'NATIVE_SELECTION_BLOCKED',message:String(error.message||error).slice(0,500)},formBlocker()]};
    await onReadback?.(clone(result));return result;
  }
}

// The pending operation is one native batch action. The caller persists the
// entire member journal in beforeDispatch; this helper never publishes or
// repeats an action after an acknowledgement timeout.
export async function moveDxmNativeBatchSelection({page,poll,scope:input,beforeDispatch,onProgress,isStopped}={}){
  const scope=checkedScope(input),expected={url:scope.url,account:scope.account};
  const selected=await openDxmNativeBatchSelection({page,poll,scope,selectionOnly:true,onProgress,isStopped});
  if(selected.status!=='selected')throw new Error(selected.blockers?.[0]?.message||'本批移入待发布范围未核实');
  const read=()=>poll(()=>page.evaluate(readDxmNativeBatchPage,expected),{timeout:15000,label:'本批待发布选择范围'});
  const validate=async()=>{if(isStopped?.())throw new Error('已暂停批量移入待发布');const snapshot=await read();const checked=nativeBatchReadiness(snapshot,scope,{requireSelected:true});if(!checked.canOpen)throw new Error(checked.blockers.find(item=>item.code!=='NATIVE_BATCH_FORM_UNVERIFIED')?.message||'本批选择范围发生变化');return snapshot;};
  const click=async(text,commit)=>{
    await validate();const locator={kind:'menu',text};
    const hit=await poll(async()=>{const a=await page.evaluate(nativeBatchUiPoint,{expected,locator}),b=a&&await page.evaluate(nativeBatchUiPoint,{expected,locator,scroll:false});return a&&isDeepStrictEqual(a,b)?a:null;},{timeout:10000,label:text});
    await validate();if(commit){if(typeof beforeDispatch!=='function')throw new Error('缺少整批移入待发布的提交记录');await beforeDispatch();}
    if(isStopped?.())throw new Error('已暂停批量移入待发布');
    if(!isDeepStrictEqual(hit,await page.evaluate(nativeBatchUiPoint,{expected,locator,scroll:false})))throw new Error('批量移入待发布控件发生变化');
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...hit.point});
    try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...hit.point});}finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit.point});}
  };
  if((await read()).controls.find(item=>item.text==='批量移入待发布')?.enabledCount!==1)await click('批量操作',false);
  await click('批量移入待发布',true);
  return {status:'submitted-for-readback',scopeKey:scope.scopeKey,published:false};
}

export function nativeCategoryWarningPoint({expected,count,scroll=true}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const tidy=value=>String(value||'').replace(/\s+/g,' ').trim();
  if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('分类对应提示所在页面或账号已变化');
  const modals=[...document.querySelectorAll('.ant-modal')].filter(visible).filter(e=>/丢失变种信息/.test(e.innerText));
  if(modals.length!==1)return null;
  const modal=modals[0],match=tidy(modal.innerText).match(/共选择\s*(\d+)\s*个产品[，,]?\s*有\s*(\d+)\s*个产品未自动识别出分类/);
  if(!match||Number(match[1])!==count||Number(match[2])<1||Number(match[2])>count)throw new Error('分类对应提示的产品范围与本批不一致');
  const buttons=[...modal.querySelectorAll('button')].filter(e=>visible(e)&&tidy(e.innerText)==='编辑分类'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  if(buttons.length!==1)return null;
  const button=buttons[0];if(scroll)button.scrollIntoView({block:'center',behavior:'instant'});
  const rect=button.getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  return button.contains(document.elementFromPoint(point.x,point.y))?{point,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}:null;
}

export async function continueDxmNativeCategoryMapping({page,poll,scope:input,isStopped}={}){
  const scope=checkedScope(input),expected={url:scope.url,account:scope.account};
  const validate=async()=>{
    if(isStopped?.())throw new Error('已暂停分类对应');
    const snapshot=await page.evaluate(readDxmNativeBatchPage,expected);
    if(!snapshot||snapshot.dialogs.length!==1||snapshot.dialogs[0].selectedCount!==scope.rows.length)throw new Error('分类弹窗与本批成员范围不一致');
    const checked=nativeBatchReadiness({...snapshot,dialogs:[]},scope,{requireSelected:true});
    if(!checked.canOpen)throw new Error(checked.blockers.find(item=>item.code!=='NATIVE_BATCH_FORM_UNVERIFIED')?.message||'分类操作前成员范围已变化');
  };
  await validate();const args={expected,count:scope.rows.length};
  const hit=await poll(async()=>{const a=await page.evaluate(nativeCategoryWarningPoint,args),b=a&&await page.evaluate(nativeCategoryWarningPoint,{...args,scroll:false});return a&&isDeepStrictEqual(a,b)?a:null;},{timeout:15000,label:'本批编辑分类入口'});
  await validate();if(!isDeepStrictEqual(hit,await page.evaluate(nativeCategoryWarningPoint,{...args,scroll:false})))throw new Error('编辑分类入口已变化');
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...hit.point});
  try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...hit.point});}finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit.point});}
  return {status:'category-editor-opening',scopeKey:scope.scopeKey,businessWrite:false};
}
