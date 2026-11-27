import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {COLLECTION_URL} from './collection-browser.mjs';
import {temuGoodsId} from './geekbi.mjs';
import {collectionClaimDestination,resolveCollectionClaimStore,assertCollectionClaimIdentities} from './listing-destinations.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const clone=value=>structuredClone(value);
const stopped=args=>{if(args.isStopped?.())throw new Error('认领任务已暂停，未继续操作');};
const commonId=value=>{try{const url=new URL(value);return url.origin==='https://www.dianxiaomi.com'&&url.pathname==='/web/productCrawl/edit'&&/^\d{6,32}$/.test(url.searchParams.get('id')||'')?url.searchParams.get('id'):null;}catch{return null;}};
const siteKey=value=>String(value||'').trim().replace(/站$/,'');

export function allocationSources(rows){
  if(!Array.isArray(rows)||!rows.length||rows.length>30)throw new Error('认领需要本批1至30件已核对的来源商品');
  const result=rows.map(row=>{
    const goodsId=String(row.goodsId||''),sourceUrl=row.sourceUrl,collectionEditUrl=row.collectionEditUrl||row.collectionEvidence?.editUrl||row.evidence?.editUrl;
    if(!/^\d{6,32}$/.test(goodsId)||temuGoodsId(sourceUrl)!==goodsId||!commonId(collectionEditUrl))throw new Error('来源商品编号、链接或通用采集记录地址不一致');
    return {goodsId,sourceUrl,collectionEditUrl,commonId:commonId(collectionEditUrl)};
  });
  if(new Set(result.map(row=>row.goodsId)).size!==result.length||new Set(result.map(row=>row.commonId)).size!==result.length)throw new Error('本批来源商品或通用采集记录重复');
  return result;
}

export function allocationDestinationKeys(destinations){
  if(!Array.isArray(destinations)||!destinations.length||destinations.length>500)throw new Error('认领分配模板缺少完整目的地');
  const keys=destinations.map(destination=>{
    if(!['temu','tiktok','shein'].includes(destination.platform)||!destination.storeName?.trim()||destination.platform!=='shein'&&!siteKey(destination.site))throw new Error('认领目的地的平台、店铺或站点未明确');
    return JSON.stringify([destination.platform,destination.storeName.trim(),siteKey(destination.site),destination.mode===undefined?null:String(destination.mode)]);
  }).sort();
  if(new Set(keys).size!==keys.length)throw new Error('认领分配模板包含重复目的地');
  return keys;
}

export function assertAllocationDestinations(actual,expected){
  if(JSON.stringify(allocationDestinationKeys(actual))!==JSON.stringify(allocationDestinationKeys(expected)))throw new Error('店小秘认领模板的完整目的地已变化，未提交；请重新同步模板');
}

export function directAllocationDestinations(input){
  allocationDestinationKeys(input);
  const result=input.map(item=>{
    if(!['temu','shein'].includes(item.platform))throw new Error('当前平台的直接店铺认领尚不能核实站点');
    if(item.storeId!==undefined&&(typeof item.storeId!=='string'||item.storeId.length>100))throw new Error('认领店铺编号无效');
    return collectionClaimDestination({platform:item.platform,storeName:item.storeName.trim(),storeId:item.storeId||'',site:String(item.site||'').trim()});
  });
  allocationDestinationKeys(result);
  if(new Set(result.map(item=>JSON.stringify([item.platform,siteKey(item.site)]))).size!==1)throw new Error('直接认领需要同一平台和站点的店铺');
  return result;
}
export function assertDirectAllocationDestinations(actual,expected,evidence,account){
  assertAllocationDestinations(actual,expected);
  assertCollectionClaimIdentities(actual,expected,evidence,account);
}

function claimStoreEvidence(modal,args){
  return {account:args.erpConnection.expectedAccount,pageUrl:COLLECTION_URL,shops:modal.shops.map(({platform,storeName,storeId,disabled})=>({platform,storeName,storeId:storeId||'',disabled:!!disabled}))};
}

export function assertAllocationSelection(page,selectedIds){
  const selected=new Set(selectedIds);
  if(page.selectedCount!==selected.size||page.rows.some(row=>row.checked!==selected.has(row.commonId)))throw new Error('本批商品勾选范围发生变化，未提交认领');
}

// These readers only consume rendered rows, native form state and accessibility
// labels. They do not inspect framework state or call undocumented DXM APIs.
export function readAllocationCollectionPage(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  if(location.href!=='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition')throw new Error('当前不是通用数据采集页');
  if([...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(visible))return null;
  const sourceId=value=>{try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='temu.com'||url.hostname.endsWith('.temu.com'))?url.searchParams.get('goods_id')||url.pathname.match(/(?:^|-)g-(\d+)\.html$/)?.[1]||null:null;}catch{return null;}};
  const records=new Map(),groups=new Map();
  for(const row of [...document.querySelectorAll('tr.vxe-body--row,tr')].filter(visible)){
    const key=row.getAttribute('rowid')||row;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  // VXE renders a source link, edit link and checkbox in separate copies of the
  // same row. Join those copies before requiring an edit link or source ID.
  for(const copies of groups.values()){
    const rowId=copies[0].getAttribute('rowid');
    const links=[...new Set(copies.flatMap(row=>[...row.querySelectorAll('a[href]')].filter(visible).map(link=>link.href)))];
    const edits=links.filter(value=>{try{const url=new URL(value);return url.origin==='https://www.dianxiaomi.com'&&url.pathname==='/web/productCrawl/edit'&&/^\d{6,32}$/.test(url.searchParams.get('id')||'');}catch{return false;}});
    if(!edits.length)continue;
    const ids=[...new Set(edits.map(value=>new URL(value).searchParams.get('id')))];
    if(ids.length!==1)throw new Error('通用采集行包含多个商品记录，无法精确勾选');
    const id=ids[0];
    const boxes=copies.flatMap(copy=>[...copy.querySelectorAll('td.col--checkbox input[type="checkbox"]')]).filter(input=>visible(input.closest('label')||input));
    if(records.has(id))throw new Error('同一通用采集记录对应不同列表行，无法精确勾选');
    const sourceUrls=links.filter(sourceId);
    records.set(id,{commonId:id,editUrl:edits[0],rowId,sourceUrls,goodsIds:[...new Set(sourceUrls.map(sourceId))],checked:boxes.some(input=>input.checked),checkboxCount:boxes.length});
  }
  const text=document.body.innerText,selection=text.match(/已选中?\s*(\d+)\s*条数据/),rows=[...records.values()];
  const enabled=element=>!!element&&!element.disabled&&element.getAttribute('aria-disabled')!=='true'&&!element.classList.contains('is--disabled')&&!element.classList.contains('ant-pagination-disabled');
  const control=title=>[...document.querySelectorAll('button[title]')].find(element=>visible(element)&&element.title===title);
  return {url:location.href,account:document.querySelector('.btn-user .user-name')?.textContent.trim()||'',rows,
    selectedCount:selection?Number(selection[1]):rows.some(row=>row.checked)?null:0,total:Number(text.match(/共\s*(\d+)\s*条记录/)?.[1]??NaN),
    previousEnabled:enabled(control('上一页')),nextEnabled:enabled(control('下一页')),pageToken:rows.map(row=>row.commonId).join('|'),
    search:document.querySelector('#c-searchValue')?.value||'',allSelected:[...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some(element=>/-tab-$/.test(element.id))};
}

export function readAllocationModal(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const clean=value=>String(value||'').replace(/\s+/g,'').trim();
  const modals=[...document.querySelectorAll('.ant-modal')].filter(element=>visible(element)&&clean(element.querySelector('.ant-modal-title')?.textContent)==='选择店铺-认领到采集箱');
  if(!modals.length)return null;if(modals.length!==1)throw new Error('认领弹窗不唯一');
  const modal=modals[0],destinations=[],issues=[],shops=[],siteOptions=[];
  for(const group of modal.querySelectorAll('.shop-div[name]')){
    const name=group.getAttribute('name'),platform=name==='popTemu'?'temu':['shein','sheinProduct'].includes(name)?'shein':name;
    const inputs=[...group.querySelectorAll('.shop-label-box input[type="checkbox"]')].filter(input=>!input.closest('.temu-site-wrapper'));
    for(const input of inputs){const storeName=input.closest('label')?.textContent.trim();if(storeName&&storeName!=='全选')shops.push({platform,groupName:name,storeName,storeId:input.value&&input.value!=='on'?String(input.value):'',checked:input.checked,disabled:input.disabled});}
    if(platform==='temu')for(const input of group.querySelectorAll('.temu-site-wrapper input[type="checkbox"]')){const site=input.closest('label')?.textContent.trim();if(site&&site!=='全选')siteOptions.push({platform,groupName:name,site,checked:input.checked,disabled:input.disabled});}
    const selected=inputs.filter(input=>input.checked);
    if(!selected.length)continue;
    if(!['temu','tiktok','shein'].includes(platform)){issues.push('认领模板包含尚未支持的平台目的地：'+name);continue;}
    const sites=platform==='temu'?[...group.querySelectorAll('.temu-site-wrapper input[type="checkbox"]')].filter(input=>input.checked).map(input=>input.closest('label')?.textContent.trim()).filter(name=>name&&name!=='全选'):platform==='shein'?['']:[];
    const mode=platform==='tiktok'?[...group.querySelectorAll('input[type="radio"]')].find(input=>input.checked)?.value:undefined;
    for(const input of selected){
      const storeName=input.closest('label')?.textContent.trim();
      if(!storeName||storeName==='全选')continue;
      if(input.disabled)issues.push('模板包含已停用的店铺：'+storeName);
      if(platform==='temu'&&!sites.length)issues.push('Temu模板未选择站点：'+storeName);
      if(platform==='tiktok')issues.push('TikTok店铺站点无法从当前认领弹窗确认：'+storeName);
      for(const site of sites)destinations.push({platform,storeName,site,...(input.value&&input.value!=='on'?{storeId:String(input.value)}:{}),...(mode!==undefined?{mode:String(mode)}:{})});
    }
  }
  const duplicate=[...modal.querySelectorAll('label')].find(element=>clean(element.textContent)==='已认领至相同店铺的产品不再认领');
  return {selectedNames:[...modal.querySelectorAll('.ant-select-selection-item')].filter(visible).map(element=>element.getAttribute('title')||element.textContent.trim()),destinations,issues,shops,siteOptions,
    skipDuplicates:duplicate?.querySelector('input[type="checkbox"]')?.checked??null,loading:[...modal.querySelectorAll('.ant-spin-spinning')].some(visible)};
}

export function readAllocationCatalog(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const dropdowns=[...document.querySelectorAll('.ant-select-dropdown')].filter(visible);
  if(!dropdowns.length)return null;if(dropdowns.length!==1)throw new Error('认领模板目录不唯一');
  const dropdown=dropdowns[0],templates=[];
  // Ant's accessible options expose the stable template ID while visible option
  // cards expose its name. Both must agree; option order is never an identity.
  for(const option of [...dropdown.querySelectorAll('.ant-select-item-option[title]')].filter(visible)){
    const name=option.getAttribute('title'),ids=[...dropdown.querySelectorAll('[role="option"][aria-label]')].filter(element=>element.getAttribute('aria-label')===name).map(element=>element.textContent.trim()).filter(id=>/^\d+$/.test(id));
    if(new Set(ids).size!==1)throw new Error('认领模板缺少唯一编号：'+name);
    templates.push({id:ids[0],name,destinations:[]});
  }
  if(new Set(templates.map(template=>template.id)).size!==templates.length||new Set(templates.map(template=>template.name)).size!==templates.length)throw new Error('认领模板存在同名或重复编号，未自动选择');
  const clipped=[...dropdown.querySelectorAll('.rc-virtual-list-holder,.vc-virtual-list-holder')].some(element=>element.scrollHeight>element.clientHeight+2);
  return {templates,catalogComplete:!clipped};
}

export function allocationHitIsStable(first,second){
  return !!first&&!!second&&['x','y','width','height'].every(key=>Number.isFinite(first.bounds?.[key])&&Number.isFinite(second.bounds?.[key])&&Math.abs(first.bounds[key]-second.bounds[key])<=0.5)
    &&['x','y'].every(key=>Number.isFinite(first.point?.[key])&&Number.isFinite(second.point?.[key])&&Math.abs(first.point[key]-second.point[key])<=0.5);
}

export function allocationTemplateControl({account,focusIfCollapsed=false}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  if(location.href!=='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'||document.querySelector('.btn-user .user-name')?.textContent.trim()!==account)throw new Error('认领页面或登录账号已变化');
  const modals=[...document.querySelectorAll('.ant-modal')].filter(element=>visible(element)&&element.querySelector('.ant-modal-title')?.textContent.replace(/\s+/g,'')==='选择店铺-认领到采集箱');
  if(modals.length!==1)throw new Error('认领模板弹窗不存在或不唯一');
  const selectors=[...modals[0].querySelectorAll('.ant-select-selector')].filter(visible);
  const combos=selectors.length===1?[...selectors[0].querySelectorAll('[role="combobox"]')].filter(visible):[];
  const combo=combos.length===1?combos[0]:null,expanded=combo?.getAttribute('aria-expanded')||null;
  const canFocus=!!combo&&combo.tagName==='INPUT'&&!['password','hidden','file'].includes(combo.type)&&!combo.disabled&&combo.getAttribute('aria-disabled')!=='true';
  if(focusIfCollapsed){
    if(selectors.length!==1||combos.length!==1||expanded!=='false'||!canFocus)throw new Error('未确认唯一且未展开的模板输入框，未发送替代按键');
    combo.focus({preventScroll:true});if(document.activeElement!==combo)throw new Error('模板输入框未取得焦点，未发送替代按键');
  }
  return {selectorCount:selectors.length,comboboxCount:combos.length,expanded,canFocus,focused:!!combo&&document.activeElement===combo};
}

export function allocationTemplateEventProbe({account,action,point}){
  const key=Symbol.for('ec-visual-workbench.allocation-template-event-probe');
  if(action==='read'||action==='remove'){
    const state=window[key];if(!state)return null;
    const result=state.snapshot();if(action==='remove'){state.dispose();delete window[key];}return result;
  }
  if(['arm-pointer','after-pointer-down','finish-pointer'].includes(action)){
    const state=window[key];if(!state)throw new Error('模板事件诊断不存在，未继续点击');
    return action==='arm-pointer'?state.arm(point):action==='after-pointer-down'?state.afterPress():state.finishPointer();
  }
  if(action!=='install')throw new Error('不支持的模板事件诊断操作');
  if(window[key])throw new Error('模板事件诊断尚未清理，未重复安装');
  if(location.href!=='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'||document.querySelector('.btn-user .user-name')?.textContent.trim()!==account)throw new Error('认领页面或登录账号已变化');
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const findControls=()=>{
    const modals=[...document.querySelectorAll('.ant-modal')].filter(element=>visible(element)&&element.querySelector('.ant-modal-title')?.textContent.replace(/\s+/g,'')==='选择店铺-认领到采集箱');
    const selectors=modals.length===1?[...modals[0].querySelectorAll('.ant-select-selector')].filter(visible):[];
    const combos=selectors.length===1?[...selectors[0].querySelectorAll('[role="combobox"]')].filter(visible):[];
    return {selectors,combos};
  };
  const {selectors,combos}=findControls();
  const selector=selectors.length===1?selectors[0]:null,combo=combos.length===1?combos[0]:null,selectRoot=combo?.closest('.ant-select')||null;
  const installed=!!selector&&!!combo,events=[],frames=new Set(),outsideSeen=new Set(),types=['mousedown','mouseup','click','keydown','keyup'];let active=true,pointerWindow=false,pointer=null;
  const focus=()=>({documentHasFocus:document.hasFocus(),visibilityState:document.visibilityState});
  const bounds=element=>{if(!element)return null;const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};};
  const freshState=()=>{
    const fresh=findControls(),freshSelector=fresh.selectors.length===1?fresh.selectors[0]:null,freshCombo=fresh.combos.length===1?fresh.combos[0]:null;
    return {selectorConnected:selector?.isConnected===true,comboConnected:combo?.isConnected===true,sameSelector:!!selector&&freshSelector===selector,sameCombo:!!combo&&freshCombo===combo,
      freshSelectorCount:fresh.selectors.length,freshComboCount:fresh.combos.length,freshSelectorBounds:bounds(freshSelector),freshComboBounds:bounds(freshCombo)};
  };
  const targetInfo=target=>{
    const fresh=findControls(),freshSelector=fresh.selectors.length===1?fresh.selectors[0]:null,freshCombo=fresh.combos.length===1?fresh.combos[0]:null;
    const relation=target===combo?'original-combo':target===selector?'original-selector':selector?.contains(target)?'original-descendant':target===freshCombo?'fresh-combo':target===freshSelector?'fresh-selector':freshSelector?.contains(target)?'fresh-descendant':'outside';
    const tags=['INPUT','DIV','SPAN','BUTTON','A','SVG','PATH','BODY','HTML','LABEL'],roles=['combobox','button','option','listbox','dialog','menu','menuitem','checkbox','radio','presentation','none'];
    const classNames=['ant-select','ant-select-selector','ant-select-selection-search','ant-select-selection-search-input','ant-select-selection-placeholder','ant-select-selection-item','ant-select-arrow','ant-select-clear','ant-select-dropdown','ant-select-item','ant-select-item-option','ant-modal','ant-modal-wrap','ant-modal-mask','ant-modal-body','ant-modal-content','ant-modal-title','ant-btn','ant-btn-primary'];
    const tag=String(target?.tagName||'').toUpperCase(),role=target?.getAttribute?.('role');
    return {targetRelation:relation,targetTag:tags.includes(tag)?tag:'OTHER',targetRole:roles.includes(role)?role:null,targetClasses:classNames.filter(name=>target?.classList?.contains(name)).slice(0,6)};
  };
  const record=(event,scope)=>{
    if(!active||events.length>=12)return;
    const keyboard=event.type==='keydown'||event.type==='keyup';
    const entry={type:event.type,scope,isTrusted:event.isTrusted,key:keyboard?event.key:null,keyCode:keyboard?event.keyCode:null,which:event.which,button:keyboard?null:event.button,buttons:keyboard?null:event.buttons,
      targetIsCombo:event.target===combo,targetIsSelector:event.target===selector,...targetInfo(event.target),defaultPrevented:event.defaultPrevented,nextFrameDefaultPrevented:null,ariaExpanded:combo.getAttribute('aria-expanded'),nextFrameAriaExpanded:null,nextFrameRootOpen:null,nextFrameRootDisabled:null,...focus()};
    events.push(entry);
    const frame=window.requestAnimationFrame(()=>{frames.delete(frame);if(active){entry.nextFrameAriaExpanded=combo.getAttribute('aria-expanded');entry.nextFrameDefaultPrevented=event.defaultPrevented;entry.nextFrameRootOpen=selectRoot?selectRoot.classList.contains('ant-select-open'):null;entry.nextFrameRootDisabled=selectRoot?selectRoot.classList.contains('ant-select-disabled'):null;if(event.type==='mousedown')entry.nextFrameControls=freshState();}});frames.add(frame);
  };
  const handle=event=>{if(!selector.contains(event.target))return;const keyboard=event.type==='keydown'||event.type==='keyup';if(keyboard&&(event.target!==combo||!['ArrowDown','Enter','Escape'].includes(event.key)))return;record(event,'selector');};
  const outsideRelease=event=>{if(!pointerWindow||!pointer||event.button!==0||selector.contains(event.target)||outsideSeen.has(event.type))return;outsideSeen.add(event.type);record(event,'document');};
  const state={snapshot:()=>({installed,selectorCount:selectors.length,comboboxCount:combos.length,...focus(),events:events.map(event=>({...event})),pointer}),
    arm(value){
      if(!installed||pointer||!Number.isFinite(value?.x)||!Number.isFinite(value?.y))throw new Error('模板点击诊断不能重复开始或目标不唯一');
      const before=freshState();if(!before.selectorConnected||!before.comboConnected||!before.sameSelector||!before.sameCombo)throw new Error('模板控件在按下前已变化，未点击');
      pointer={point:{x:value.x,y:value.y},before,after:null};pointerWindow=true;return {armed:true};
    },
    afterPress(){
      if(!pointerWindow||!pointer)throw new Error('模板点击诊断未开始');const after=freshState(),hit=document.elementFromPoint(pointer.point.x,pointer.point.y);
      const sameBounds=(first,second)=>!!first&&!!second&&['x','y','width','height'].every(name=>Number.isFinite(first[name])&&Number.isFinite(second[name])&&Math.abs(first[name]-second[name])<=0.5);
      const safeToContinue=after.selectorConnected&&after.comboConnected&&after.sameSelector&&after.sameCombo&&sameBounds(pointer.before.freshSelectorBounds,after.freshSelectorBounds)&&sameBounds(pointer.before.freshComboBounds,after.freshComboBounds);
      pointer.after={...after,hit:targetInfo(hit),safeToContinue};return pointer.after;
    },
    finishPointer(){pointerWindow=false;return {finished:true};},
    dispose(){active=false;pointerWindow=false;if(installed){for(const type of types)selector.removeEventListener(type,handle,true);for(const type of ['mouseup','click'])document.removeEventListener(type,outsideRelease,true);}for(const frame of frames)window.cancelAnimationFrame(frame);frames.clear();}};
  Object.defineProperty(window,key,{configurable:true,value:state});
  try{if(installed){for(const type of types)selector.addEventListener(type,handle,true);for(const type of ['mouseup','click'])document.addEventListener(type,outsideRelease,true);}}
  catch(error){state.dispose();delete window[key];throw error;}
  return {installed,selectorCount:selectors.length,comboboxCount:combos.length};
}

export function readAllocationDiagnostics(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const label=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,120);
  const names=elements=>[...new Set(elements.map(element=>label(element.getAttribute('title')||element.getAttribute('aria-label')||element.textContent)).filter(Boolean))].slice(0,12);
  const modals=[...document.querySelectorAll('.ant-modal')].filter(visible);
  const modal=modals.find(element=>element.querySelector('.ant-modal-title')?.textContent.replace(/\s+/g,'')==='选择店铺-认领到采集箱');
  const dropdowns=[...document.querySelectorAll('.ant-select-dropdown')].filter(visible);
  const combos=[...modal?.querySelectorAll('.ant-select-selector [role="combobox"]')||[]].filter(visible);
  return {pageTitle:label(document.title),pagePath:location.pathname,scroll:{x:Number(window.scrollX)||0,y:Number(window.scrollY)||0},
    modalCount:modals.length,modalTitles:modals.slice(0,3).map(element=>label(element.querySelector('.ant-modal-title')?.textContent)),
    selectedNames:names([...modal?.querySelectorAll('.ant-select-selection-item')||[]].filter(visible)),
    comboboxCount:combos.length,comboboxes:combos.slice(0,3).map(combo=>{const rect=combo.getBoundingClientRect(),root=combo.closest('.ant-select');return {tag:combo.tagName,type:combo.type,role:combo.getAttribute('role'),ariaExpanded:combo.getAttribute('aria-expanded'),ariaControls:label(combo.getAttribute('aria-controls')),disabled:!!combo.disabled,readOnly:!!combo.readOnly,focused:document.activeElement===combo,rootClassName:String(root?.className||'').slice(0,160),rootAriaDisabled:root?.getAttribute('aria-disabled')??null,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};}),
    visibleDropdownCount:dropdowns.length,dropdowns:dropdowns.slice(0,3).map(dropdown=>{
      const options=[...dropdown.querySelectorAll('.ant-select-item-option')].filter(visible),ariaOptions=[...dropdown.querySelectorAll('[role="option"][aria-label]')].filter(visible);
      const holder=[...dropdown.querySelectorAll('.rc-virtual-list-holder,.vc-virtual-list-holder')].find(visible)||dropdown;
      return {optionCount:options.length,optionLabels:names(options),ariaOptionCount:ariaOptions.length,ariaOptionLabels:names(ariaOptions),scrollTop:holder.scrollTop,scrollHeight:holder.scrollHeight,clientHeight:holder.clientHeight};
    })};
}

export function allocationUiPoint({account,kind,value,commonId,rowId,withGeometry=false}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&!e.closest('.fixed--hidden');
  if(location.href!=='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'||document.querySelector('.btn-user .user-name')?.textContent.trim()!==account)throw new Error('认领页面或登录账号已变化');
  const modal=[...document.querySelectorAll('.ant-modal')].find(element=>visible(element)&&element.querySelector('.ant-modal-title')?.textContent.replace(/\s+/g,'')==='选择店铺-认领到采集箱');
  let nodes=[];
  if(kind==='all')nodes=[...document.querySelectorAll('[role="tab"]')].filter(element=>/-tab-$/.test(element.id));
  else if(kind==='page')nodes=[...document.querySelectorAll('button[title]')].filter(element=>element.title===value);
  else if(kind==='row'){
    const rows=[...document.querySelectorAll('tr.vxe-body--row,tr')].filter(row=>rowId?row.getAttribute('rowid')===rowId:[...row.querySelectorAll('a[href]')].some(link=>{try{return new URL(link.href).pathname==='/web/productCrawl/edit'&&new URL(link.href).searchParams.get('id')===commonId;}catch{return false;}}));
    nodes=rows.flatMap(row=>[...row.querySelectorAll('td.col--checkbox label.ant-checkbox-wrapper')]);
  }else if(kind==='batch')nodes=[...document.querySelectorAll('button,a')].filter(element=>element.textContent.trim()==='批量认领');
  else if(kind==='store'||kind==='site'){
    const groups=[...modal?.querySelectorAll('.shop-div[name]')||[]].filter(group=>group.getAttribute('name')===value?.groupName);
    if(groups.length!==1)throw new Error('认领平台店铺分组不存在唯一匹配');
    const selector=kind==='store'?'.shop-label-box input[type="checkbox"]':'.temu-site-wrapper input[type="checkbox"]';
    const matches=[...groups[0].querySelectorAll(selector)].filter(input=>{
      const label=input.closest('label'),text=label?.textContent.trim();
      if(kind==='store'&&input.closest('.temu-site-wrapper'))return false;
      return text===(kind==='store'?value.storeName:value.site)&&(!value.storeId||input.value===value.storeId)&&input.checked===value.expectedChecked;
    });
    nodes=matches.map(input=>input.closest('label')).filter(Boolean);
  }
  else if(kind==='clear-template')nodes=[...modal?.querySelectorAll('.ant-select-clear')||[]];
  else if(kind==='templates')nodes=[...modal?.querySelectorAll('.ant-select-selector')||[]];
  else if(kind==='option')nodes=[...document.querySelectorAll('.ant-select-dropdown .ant-select-item-option[title]')].filter(element=>element.getAttribute('title')===value);
  else if(kind==='skip')nodes=[...modal?.querySelectorAll('label')||[]].filter(element=>element.textContent.replace(/\s+/g,'')==='已认领至相同店铺的产品不再认领');
  else if(kind==='close'||kind==='confirm')nodes=[...modal?.querySelectorAll('button')||[]].filter(element=>element.textContent.trim()===(kind==='confirm'?'确定':'关闭'));
  nodes=nodes.filter(visible).filter(element=>!element.disabled&&element.getAttribute('aria-disabled')!=='true'&&!element.querySelector('input:disabled'));
  if(kind==='page')nodes=nodes.slice(0,1);
  if(!nodes.length)return null;if(nodes.length!==1)throw new Error('认领控件不存在唯一匹配：'+kind);
  const element=nodes[0];element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const rect=element.getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  if(!element.contains(document.elementFromPoint(point.x,point.y)))return null;
  return withGeometry?{point,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}:point;
}

export function readAllocationReceipt(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const messages=[...document.querySelectorAll('.ant-message-notice-content,.ant-notification-notice-description,.ant-alert-message,.ant-modal-confirm-content')].filter(visible).map(element=>element.textContent.trim()).filter(Boolean);
  const failed=messages.filter(message=>/认领/.test(message)&&/失败|异常|错误|部分/.test(message));
  const succeeded=messages.filter(message=>/认领(?:已)?(?:成功|完成)|成功认领/.test(message)&&!/失败|部分/.test(message));
  return failed.length?{status:'needs-review',messages:failed}:succeeded.length?{status:'claimed',messages:succeeded}:null;
}

export function createDxmAllocationBrowser(configuration={},transport){
  const library=()=>transport||import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  const attempted=new Set();
  async function withPage(args,work){
    if(args.browserConfig?.type!=='chrome'||!args.erpConnection?.expectedAccount)throw new Error('认领分配需要绑定店小秘账号的谷歌浏览器');
    stopped(args);const lib=await library(),info=await lib.connection(args.browserConfig),browser=await lib.connect(info.ws);
    let page,targetId,created=false,registered=false,retain=false;
    try{
      if(args.tabs?.allocation){const target=(await info.targets()).find(item=>(item.id||item.targetId)===args.tabs.allocation&&item.type==='page');if(target){if(!['about:blank',COLLECTION_URL].includes(target.url))throw new Error('专用认领标签已打开其他页面，未改动该页面');targetId=target.id||target.targetId;}}
      if(!targetId){({targetId}=await browser.send('Target.createTarget',{url:'about:blank',background:true}));created=true;if(args.onTarget){await args.onTarget('allocation',targetId,{owned:true});registered=true;}}
      page=await lib.pageById(info,targetId);await page.send('Page.enable');await browser.send('Target.activateTarget',{targetId});await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      const nav=await page.send('Page.navigate',{url:COLLECTION_URL});if(nav.errorText)throw new Error('数据采集页打开失败：'+nav.errorText);
      await lib.poll(()=>page.evaluate(account=>location.href==='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'&&document.readyState==='complete'&&document.querySelector('.btn-user .user-name')?.textContent.trim()===account,args.erpConnection.expectedAccount),{timeout:45000,label:'认领账号和通用采集页面'});
      return await work(page,lib,()=>{retain=true;});
    }finally{if(page)await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});page?.close();if(created&&!registered&&!retain&&targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
  }
  async function click(page,lib,args,kind,extra={},beforeDispatch){
    stopped(args);const locator={account:args.erpConnection.expectedAccount,kind,...extra,withGeometry:true};
    const point=await lib.poll(async()=>{
      stopped(args);const first=await page.evaluate(allocationUiPoint,locator);if(!first)return null;
      await new Promise(resolve=>setTimeout(resolve,200));stopped(args);
      const second=await page.evaluate(allocationUiPoint,locator);return allocationHitIsStable(first,second)?second.point:null;
    },{timeout:15000,label:'认领控件位置稳定 '+kind});
    stopped(args);await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...point});stopped(args);
    if(kind==='templates')await page.evaluate(allocationTemplateEventProbe,{action:'arm-pointer',point});
    beforeDispatch?.();let failure,phase='mouse-press',releaseAcknowledged=false,releaseFailed=false;
    try{
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await new Promise(resolve=>setTimeout(resolve,32));
      if(kind==='templates'){phase='post-press-read';const after=await page.evaluate(allocationTemplateEventProbe,{action:'after-pointer-down'});if(!after?.safeToContinue)throw new Error('模板控件在鼠标按下后发生变化，已停止后续操作');}
      stopped(args);
    }catch(error){failure=error;}
    finally{
      // Pair the original press exactly once, even when the control changed or
      // the acknowledgement/read failed. Never move to another control.
      try{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});releaseAcknowledged=true;}
      catch(error){releaseFailed=true;if(!failure){failure=error;phase='mouse-release';}}
      if(kind==='templates'){
        await new Promise(resolve=>setTimeout(resolve,32));
        try{await page.evaluate(allocationTemplateEventProbe,{action:'finish-pointer'});}
        catch(error){if(!failure){failure=error;phase='finish-pointer';}}
      }
    }
    if(failure){failure.allocationPointerUncertain=true;failure.data={...failure.data,allocationDiagnostics:{...failure.data?.allocationDiagnostics,pointerDelivery:{kind,phase,releaseAttempted:true,releaseAcknowledged,releaseFailed}}};throw failure;}
  }
  async function state(page,lib,args){
    stopped(args);const value=await lib.poll(()=>page.evaluate(readAllocationCollectionPage),{timeout:45000,label:'通用采集记录加载'});
    if(value.account!==args.erpConnection.expectedAccount||value.url!==COLLECTION_URL)throw new Error('通用采集账号或页面发生变化');
    if(value.search)throw new Error('通用采集页仍有查询条件，未以筛选结果代替本批商品范围');
    return value;
  }
  async function selectSources(page,lib,args,sources){
    let current=await state(page,lib,args);if(!current.allSelected){await click(page,lib,args,'all');current=await lib.poll(async()=>{const value=await state(page,lib,args);return value.allSelected?value:null;},{timeout:15000,label:'全部通用采集记录'});}
    if(!current.allSelected||current.selectedCount!==0)throw new Error('通用采集范围或既有勾选不明确，未继续批量认领');
    for(let count=0;current.previousEnabled;count++){
      if(count>=100)throw new Error('无法回到采集记录首页');const prior=current.pageToken;await click(page,lib,args,'page',{value:'上一页'});
      await lib.poll(async()=>{const next=await state(page,lib,args);return next.pageToken!==prior?next:null;},{timeout:45000,label:'采集记录上一页'});current=await state(page,lib,args);
    }
    const selected=new Set(),visited=new Set();
    for(let pageIndex=0;pageIndex<100;pageIndex++){
      current=await state(page,lib,args);if(visited.has(current.pageToken))throw new Error('采集分页重复，未继续认领');visited.add(current.pageToken);
      assertAllocationSelection(current,selected);
      for(const source of sources){
        if(selected.has(source.commonId))continue;
        const matches=current.rows.filter(row=>row.commonId===source.commonId);
        if(!matches.length)continue;if(matches.length!==1||matches[0].goodsIds.length!==1||matches[0].goodsIds[0]!==source.goodsId||commonId(matches[0].editUrl)!==source.commonId){
          const observed=[...new Set(matches.flatMap(row=>row.goodsIds))];
          throw new Error(`通用采集记录的来源编号与本批不一致：记录${source.commonId}，预期${source.goodsId}，实际${observed.join('、')||'未读到来源编号'}`);
        }
        const row=matches[0];if(row.checked||row.checkboxCount!==1)throw new Error('本批商品勾选控件不唯一或已经被外部改变');
        await click(page,lib,args,'row',{commonId:source.commonId,rowId:row.rowId});selected.add(source.commonId);
        current=await lib.poll(async()=>{const checked=await state(page,lib,args);return checked.selectedCount===selected.size&&checked.rows.some(item=>item.commonId===source.commonId&&item.checked)?checked:null;},{timeout:15000,label:'本批商品勾选确认'});
        assertAllocationSelection(current,selected);
      }
      if(selected.size===sources.length)return;
      if(!current.nextEnabled)break;
      const prior=current.pageToken;await click(page,lib,args,'page',{value:'下一页'});
      await lib.poll(async()=>{const next=await state(page,lib,args);return next.pageToken!==prior?next:null;},{timeout:45000,label:'采集记录下一页'});
    }
    throw new Error('未找到本批全部通用采集记录，未提交任何认领');
  }
  async function openModal(page,lib,args,sources){
    await selectSources(page,lib,args,sources);await click(page,lib,args,'batch');
    await lib.poll(async()=>{const modal=await page.evaluate(readAllocationModal);return modal&&!modal.loading?modal:null;},{timeout:15000,label:'认领分配弹窗'});
  }
  async function catalog(page,lib,args){
    const controlArgs={account:args.erpConnection.expectedAccount};
    await page.evaluate(allocationTemplateEventProbe,{...controlArgs,action:'install'});let failure;
    try{
      const initial=await page.evaluate(allocationTemplateControl,controlArgs);
      if(initial.expanded!=='true')await click(page,lib,args,'templates');
      return await lib.poll(async()=>{stopped(args);const after=await page.evaluate(allocationTemplateControl,controlArgs);return after.selectorCount===1&&after.comboboxCount===1&&after.expanded==='true'?page.evaluate(readAllocationCatalog):null;},{timeout:15000,label:'认领分配模板目录'});
    }catch(error){failure=error;throw error;}
    finally{
      const events=await page.evaluate(allocationTemplateEventProbe,{action:'remove'}).catch(()=>({cleanupError:'模板事件诊断读取或清理失败'}));
      if(failure)failure.data={...failure.data,allocationDiagnostics:{...failure.data?.allocationDiagnostics,templateEvents:events}};
    }
  }
  async function choose(page,lib,args,template){
    await click(page,lib,args,'option',{value:template.name});
    const modal=await lib.poll(async()=>{
      stopped(args);const value=await page.evaluate(readAllocationModal);
      if(!value||value.loading||value.selectedNames.length!==1||value.selectedNames[0]!==template.name)return null;
      // The selected name can render before the template's checkbox group has
      // finished updating. Confirm a stable second DOM reading before freezing.
      await new Promise(resolve=>setTimeout(resolve,200));
      const after=await page.evaluate(readAllocationModal);return after&&!after.loading&&JSON.stringify(value)===JSON.stringify(after)?after:null;
    },{timeout:15000,label:'认领模板实际店铺和站点'});
    if(modal.issues.length)throw new Error(modal.issues.join('；'));allocationDestinationKeys(modal.destinations);return modal;
  }
  async function close(page,lib,args){if(await page.evaluate(readAllocationModal)){await click(page,lib,args,'close');await lib.poll(async()=>!(await page.evaluate(readAllocationModal)),{timeout:15000,label:'关闭认领模板弹窗'});}}
  async function chooseDestinations(page,lib,args,destinations){
    const read=()=>lib.poll(async()=>{stopped(args);const value=await page.evaluate(readAllocationModal);return value&&!value.loading?value:null;},{timeout:15000,label:'认领店铺选项加载'});
    let modal=await read();
    if(modal.selectedNames.length){await click(page,lib,args,'clear-template');modal=await lib.poll(async()=>{const value=await read();return value.selectedNames.length===0?value:null;},{timeout:15000,label:'清空本次未选择的认领模板'});}
    if(!Array.isArray(modal.shops)||!Array.isArray(modal.siteOptions))throw new Error('未读取完整的平台店铺选择控件');
    const targets=destinations.map(target=>({...target,control:clone(resolveCollectionClaimStore(target,modal.shops))}));
    const controlKey=shop=>JSON.stringify([shop.groupName,shop.storeName,shop.storeId]);
    const desired=new Set(targets.map(target=>controlKey(target.control)));
    async function setShop(control,checked){
      const current=(await read()).shops.filter(shop=>controlKey(shop)===controlKey(control));
      if(current.length!==1)throw new Error('认领店铺控件已变化，未继续');const shop=current[0];if(shop.checked===checked)return;
      await click(page,lib,args,'store',{value:{...shop,expectedChecked:shop.checked}});
      await lib.poll(async()=>{const value=await read();return value.shops.some(item=>controlKey(item)===controlKey(shop)&&item.checked===checked)?value:null;},{timeout:15000,label:'认领店铺勾选回读'});
    }
    // Clear individually, so selecting the desired destination never leaves a
    // remembered template's unrelated stores in the submission.
    for(const shop of modal.shops)if(shop.checked&&!desired.has(controlKey(shop)))await setShop(shop,false);
    modal=await read();
    if(destinations[0].platform==='temu'){
      const groups=new Set(targets.map(target=>target.control.groupName)),wanted=siteKey(destinations[0].site);
      for(const groupName of groups){const matches=modal.siteOptions.filter(option=>option.groupName===groupName&&siteKey(option.site)===wanted);if(matches.length!==1||matches[0].disabled)throw new Error('目标Temu站点不存在、重复或已停用');}
      for(const option of modal.siteOptions){const checked=groups.has(option.groupName)&&siteKey(option.site)===wanted;if(option.checked===checked)continue;await click(page,lib,args,'site',{value:{...option,expectedChecked:option.checked}});await lib.poll(async()=>{const value=await read();return value.siteOptions.some(item=>item.groupName===option.groupName&&item.site===option.site&&item.checked===checked)?value:null;},{timeout:15000,label:'认领站点勾选回读'});}
    }
    for(const target of targets)await setShop(target.control,true);
    modal=await read();if(modal.selectedNames.length||modal.issues.length)throw new Error(modal.issues.join('；')||'店铺勾选后仍存在未选择的认领模板');
    assertDirectAllocationDestinations(modal.destinations,destinations,claimStoreEvidence(modal,args),args.erpConnection.expectedAccount);return modal;
  }
  return {
    async claimDestinations(args){
      const sources=allocationSources(args.sourceRows||args.rows),destinations=directAllocationDestinations(args.destinations);
      if(typeof args.beforeClaim!=='function')throw new Error('认领缺少持久化提交意图，未提交');
      const key=JSON.stringify(['destinations',args.erpConnection?.expectedAccount,sources.map(row=>row.commonId).sort(),destinations.map(item=>JSON.stringify(item)).sort()]);
      if(attempted.has(key)||args.claimIntent)throw new Error('这批商品已有认领提交记录，请只读核对，不能重复提交');
      return withPage(args,async(page,lib,retain)=>{
        let submitted=false,failure;
        try{
          await openModal(page,lib,args,sources);let modal=await chooseDestinations(page,lib,args,destinations);
          if(modal.skipDuplicates===null)throw new Error('未找到跳过重复认领选项，未提交');
          if(!modal.skipDuplicates)await click(page,lib,args,'skip');
          modal=await page.evaluate(readAllocationModal);
          if(!modal||modal.loading||modal.selectedNames.length||!modal.skipDuplicates||modal.issues.length)throw new Error('认领店铺或重复跳过设置未就绪');
          const storeIdentityEvidence=claimStoreEvidence(modal,args);
          assertDirectAllocationDestinations(modal.destinations,destinations,storeIdentityEvidence,args.erpConnection.expectedAccount);assertAllocationSelection(await state(page,lib,args),sources.map(row=>row.commonId));
          stopped(args);await args.beforeClaim({goodsIds:sources.map(row=>row.goodsId),collectionEditUrls:sources.map(row=>row.collectionEditUrl),destinations:clone(modal.destinations),storeIdentityEvidence,skipDuplicates:true});
          const finalModal=await page.evaluate(readAllocationModal);
          if(!finalModal||finalModal.loading||finalModal.selectedNames.length||!finalModal.skipDuplicates||finalModal.issues.length)throw new Error('保存提交意图后认领配置发生变化');
          assertDirectAllocationDestinations(finalModal.destinations,destinations,claimStoreEvidence(finalModal,args),args.erpConnection.expectedAccount);
          for(const previous of modal.destinations){const current=finalModal.destinations.find(item=>item.platform===previous.platform&&item.storeName===previous.storeName&&siteKey(item.site)===siteKey(previous.site));if(String(current?.storeId||'')!==String(previous.storeId||''))throw new Error('保存提交意图后店铺编号发生变化，未提交');}
          assertAllocationSelection(await state(page,lib,args),sources.map(row=>row.commonId));
          await click(page,lib,args,'confirm',{},()=>{submitted=true;attempted.add(key);retain();});
          const receipt=await lib.poll(()=>page.evaluate(readAllocationReceipt),{timeout:20000,label:'认领结果回执'});
          return {status:receipt.status,submitted:true,issues:receipt.status==='claimed'?[]:receipt.messages,receipt:{...receipt,goodsIds:sources.map(row=>row.goodsId),destinations:clone(modal.destinations)}};
        }catch(error){failure=error;if(submitted)return {status:'needs-review',submitted:true,issues:['认领已发起，结果尚未确认；请核对各店采集箱，不能重复提交。'+error.message]};throw error;}
        finally{if(!submitted&&!failure?.allocationPointerUncertain)await close(page,lib,{...args,isStopped:()=>false}).catch(()=>{});}
      });
    },
    async readTemplates(args){
      const sources=allocationSources(args.sourceRows||args.rows);
      return withPage(args,async(page,lib)=>{
        let stage='open-modal',failure;
        try{
          await openModal(page,lib,args,sources);stage='read-catalog';const listed=await catalog(page,lib,args);
          if(!args.templateName)return {...listed,account:args.erpConnection.expectedAccount};
          const matches=listed.templates.filter(template=>template.name===args.templateName);if(matches.length!==1)throw new Error('当前目录未找到唯一的认领分配模板：'+args.templateName);
          stage='select-template';
          const template=matches[0],modal=await choose(page,lib,args,template);
          return {templates:[{...template,destinations:clone(modal.destinations)}],catalogComplete:false,account:args.erpConnection.expectedAccount};
        }catch(error){
          failure=error;
          const diagnostic=await page.evaluate(readAllocationDiagnostics).catch(()=>({captureError:'当前可见页面诊断读取失败'}));
          error.data={allocationDiagnostics:{...error.data?.allocationDiagnostics,stage,...diagnostic}};throw error;
        }finally{
          try{if(failure?.allocationPointerUncertain)failure.data.allocationDiagnostics.cleanupSkipped='模板点击目标变化或输入状态未确认，已尝试原位松开，未再点击其他控件';else await close(page,lib,{...args,isStopped:()=>false});}
          catch(error){if(!failure)throw error;failure.data.allocationDiagnostics.cleanupError='认领弹窗未能自动关闭';}
        }
      });
    },
    async claim(args){
      const sources=allocationSources(args.sourceRows||args.rows),template=args.allocationSnapshot||args.template;
      if(!template||typeof template.name!=='string'||!template.name.trim()||!/^\d+$/.test(String(template.id)))throw new Error('请先同步并固定认领分配模板');
      allocationDestinationKeys(template.destinations);if(typeof args.beforeClaim!=='function')throw new Error('认领缺少持久化提交意图，未提交');
      const key=JSON.stringify([args.erpConnection?.expectedAccount,String(template.id),sources.map(row=>row.commonId).sort(),allocationDestinationKeys(template.destinations)]);
      if(attempted.has(key)||args.claimIntent)throw new Error('这批商品已有认领提交记录，请只读核对，不能重复提交');
      return withPage(args,async(page,lib,retain)=>{
        let submitted=false,failure;
        try{
          await openModal(page,lib,args,sources);const listed=await catalog(page,lib,args),matches=listed.templates.filter(item=>item.name===template.name&&item.id===String(template.id));
          if(matches.length!==1)throw new Error('认领分配模板名称或编号已变化，未提交');
          let modal=await choose(page,lib,args,matches[0]);assertAllocationDestinations(modal.destinations,template.destinations);
          if(modal.skipDuplicates===null)throw new Error('未找到跳过重复认领选项，未提交');
          if(!modal.skipDuplicates)await click(page,lib,args,'skip');
          modal=await page.evaluate(readAllocationModal);if(!modal||modal.loading||!modal.skipDuplicates||modal.issues.length)throw new Error('认领目的地或重复跳过设置未就绪');assertAllocationDestinations(modal.destinations,template.destinations);
          const selected=await state(page,lib,args);assertAllocationSelection(selected,sources.map(row=>row.commonId));
          stopped(args);await args.beforeClaim({templateId:String(template.id),templateName:template.name,goodsIds:sources.map(row=>row.goodsId),collectionEditUrls:sources.map(row=>row.collectionEditUrl),destinations:clone(modal.destinations),skipDuplicates:true});
          const finalModal=await page.evaluate(readAllocationModal);if(!finalModal||finalModal.selectedNames.join('|')!==template.name||!finalModal.skipDuplicates||finalModal.issues.length)throw new Error('保存提交意图后认领配置发生变化');assertAllocationDestinations(finalModal.destinations,template.destinations);
          const finalSelection=await state(page,lib,args);assertAllocationSelection(finalSelection,sources.map(row=>row.commonId));
          await click(page,lib,args,'confirm',{},()=>{submitted=true;attempted.add(key);retain();});
          const receipt=await lib.poll(()=>page.evaluate(readAllocationReceipt),{timeout:20000,label:'认领结果回执'});
          return {status:receipt.status,submitted:true,issues:receipt.status==='claimed'?[]:receipt.messages,receipt:{...receipt,templateId:String(template.id),goodsIds:sources.map(row=>row.goodsId),destinations:clone(modal.destinations)}};
        }catch(error){failure=error;if(submitted)return {status:'needs-review',submitted:true,issues:['认领已发起，结果尚未确认；请核对各店采集箱，不能重复提交。'+error.message]};throw error;}
        finally{if(!submitted&&!failure?.allocationPointerUncertain)await close(page,lib,{...args,isStopped:()=>false}).catch(()=>{});}
      });
    }
  };
}
