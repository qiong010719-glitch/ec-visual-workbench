import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {productIdentity} from './temu-front-browser.mjs';
import {readRequiredFields,completeRequiredFields,planRequiredFields,ordinaryFieldDefault} from './dxm-required-fields.mjs';
import {browseDxmCategoryCatalog,readDxmCategoryCatalog,categoryPathMatches} from './dxm-category-browser.mjs';
import {validateSourcePrices,isPriceField,SOURCE_PRICE_POLICY,DXM_PRICE_POLICY,captureExistingDxmPrices,validateExistingDxmPrices} from './listing-field-policy.mjs';
import {nativeBatchScope,openDxmNativeBatchSelection,moveDxmNativeBatchSelection,continueDxmNativeCategoryMapping} from './dxm-native-batch.mjs';
import {runDxmNativePreparation,runDxmNativePending,nativeOwnedDescendants} from './dxm-native-runner.mjs';
import {completeNativeBatchFields,captureNativeBatchFieldState,validateNativeBatchOriginalPrices} from './dxm-native-fields.mjs';

const origin='https://www.dianxiaomi.com';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const routes={shein:'sheinProduct',tiktok:'tiktokProduct'};
const clone=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const siteKey=value=>String(value||'').trim().replace(/站$/,'');
const matchesPlatformSite=(platform,site,row)=>!site||row.sites.length===1&&siteKey(row.sites[0])===siteKey(site)||platform==='shein'&&row.siteColumnPresent===false&&row.sites.length===0;
const stop=args=>{if(args.isStopped?.())throw new Error('任务已暂停，未继续填写或移动商品');};
function platformOf(args){const platform=args.templateSnapshot?.platform;if(!Object.hasOwn(routes,platform))throw new Error('此平台未接入必填项补全');return platform;}
function editUrl(value,platform){try{const url=new URL(value);return url.origin===origin&&url.pathname===`/web/${routes[platform]}/edit`&&/^\d{6,32}$/.test(url.searchParams.get('id')||'')&&!url.username&&!url.password&&!url.hash;}catch{return false;}}
const listUrl=(platform,status='draft')=>`${origin}/web/${routes[platform]}/${status}`;

// SHEIN and TikTok use the same VXE list layout. Merge pinned-column copies
// before matching source/store identity; a row index is never a product ID.
export function readRequiredPlatformList(expected){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const account=document.querySelector('.btn-user .user-name')?.textContent.trim();
  if(location.href!==expected.url||account!==expected.account)throw new Error('平台采集箱地址或账号不一致');
  if([...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(visible))return null;
  const sourceId=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='temu.com'||u.hostname.endsWith('.temu.com'))?u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||u.searchParams.get('goods_id'):null;}catch{return null;}};
  const groups=new Map();
  const siteColumn=[...document.querySelectorAll('thead th[colid]')].find(header=>/^(站点|销售站点)$/.test(header.textContent.trim()))?.getAttribute('colid');
  const priceColumns=[...document.querySelectorAll('thead th[colid]')].filter(header=>/供货价|申报价格|销售价|售价/.test(header.textContent)).map(header=>({column:header.getAttribute('colid'),label:header.textContent.replace(/\s+/g,' ').trim()}));
  for(const element of [...document.querySelectorAll('tr[rowid]')].filter(visible)){
    const id=element.getAttribute('rowid');if(!/^\d{6,32}$/.test(id||''))continue;
    const item=groups.get(id)||{draftId:id,sourceUrls:[],goodsIds:[],storeNames:[],sites:[],siteColumnPresent:!!siteColumn,title:'',businessModes:[],priceCurrencies:[]};
    const links=[...element.querySelectorAll('a[href]')].map(link=>link.href),sources=links.filter(sourceId);
    item.sourceUrls.push(...sources);item.goodsIds.push(...sources.map(sourceId));
    item.storeNames.push(...[...element.innerText.matchAll(/「([^」]+)」/g)].map(match=>match[1]));
    const site=siteColumn?element.querySelector(`td[colid="${siteColumn}"]`)?.innerText.trim().split('\n')[0]:'';if(site)item.sites.push(site);
    item.title||=element.querySelector('.no-new-line3')?.textContent.trim()||'';
    item.businessModes.push(...[...element.querySelectorAll('span,div,b,[data-business-mode]')].filter(node=>visible(node)&&!node.children.length&&/^(OBM|OEM|ODM|POP|Marketplace)$/i.test(node.textContent.trim())).map(node=>node.textContent.trim().toUpperCase()));
    for(const column of priceColumns){const cell=element.querySelector(`td[colid="${column.column}"]`);if(cell&&visible(cell))item.priceCurrencies.push(...[...(`${column.label} ${cell.innerText}`).matchAll(/\b(USD|CNY|JPY|EUR|GBP|CAD|AUD|SGD|MYR|THB|PHP|VND|IDR|MXN|BRL)\b/g)].map(match=>match[1]));}
    const edit=links.find(value=>{try{const u=new URL(value);return u.origin===location.origin&&u.pathname===expected.editPath&&u.searchParams.get('id')===id;}catch{return false;}});if(edit)item.platformEditUrl=edit;
    groups.set(id,item);
  }
  const rows=[...groups.values()].map(item=>({...item,sourceUrls:[...new Set(item.sourceUrls)],goodsIds:[...new Set(item.goodsIds)],storeNames:[...new Set(item.storeNames)],sites:[...new Set(item.sites)],businessModes:[...new Set(item.businessModes)],priceCurrencies:[...new Set(item.priceCurrencies)]}));
  const empty=[...document.querySelectorAll('.vxe-table--empty-content,.ant-empty-description')].some(e=>visible(e)&&/暂无数据|No data/i.test(e.textContent));
  const total=Number(document.body.innerText.match(/共\s*(\d+)\s*条记录/)?.[1]??(empty?0:NaN));if(!Number.isSafeInteger(total))return null;
  const next=[...document.querySelectorAll('.vxe-pager--next-btn,.ant-pagination-next')].find(visible);
  const nextEnabled=!!next&&!next.disabled&&next.getAttribute('aria-disabled')!=='true'&&!next.classList.contains('is--disabled')&&!next.classList.contains('ant-pagination-disabled');
  const pageNumbers=[...document.querySelectorAll('.vxe-pager input[placeholder="页数"],.vxe-pager input[title="页数"]')].filter(visible).map(e=>Number(e.value));
  const filters=[...document.querySelectorAll('.in-screen-single,.in-screen-multiple')].filter(visible).map(group=>({title:group.querySelector('.title')?.textContent.trim()||'',selected:[...group.querySelectorAll('.d-tag-group-item.active')].filter(visible).map(e=>e.textContent.trim())})).filter(group=>/^(店铺账号|站点)[：:]/.test(group.title));
  const searches=[...document.querySelectorAll('input')].filter(e=>visible(e)&&/search.*input|searchValue|tableSearchInput/i.test([e.id,e.name].join(' ')));
  return {url:location.href,account,rows,total,nextEnabled,pageNumbers,filters,search:searches.map(e=>e.value).filter(Boolean).join('|')};
}

export function readRequiredPlatformEditor(expected){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const clean=value=>String(value||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  const account=document.querySelector('.btn-user .user-name')?.textContent.trim();
  if(location.href!==expected.url||account!==expected.account)throw new Error('商品编辑地址或账号不一致');
  const items=[...document.querySelectorAll('.ant-form-item')].filter(visible);
  const values=labels=>items.filter(item=>labels.includes(clean(item.querySelector('.ant-form-item-label')?.textContent))).flatMap(item=>[...item.querySelectorAll('.ant-select-selection-item,select option:checked')].filter(visible).map(e=>clean(e.getAttribute('title')||e.textContent))).filter(Boolean);
  const stores=values(['店铺账号','店铺','选择店铺']),sites=values(['经营站点','销售站点','站点']);
  const siteFieldPresent=items.some(item=>['经营站点','销售站点','站点'].includes(clean(item.querySelector('.ant-form-item-label')?.textContent)));
  const sourceId=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='temu.com'||u.hostname.endsWith('.temu.com'))?u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||u.searchParams.get('goods_id'):null;}catch{return null;}};
  const sources=[...new Set([...document.querySelectorAll('input')].filter(visible).map(e=>e.value).filter(sourceId))];
  if(stores.length!==1||stores[0]!==expected.storeName)throw new Error('商品编辑页店铺不匹配或不唯一');
  const storeOnly=location.pathname==='/web/sheinProduct/edit'&&!siteFieldPresent&&sites.length===0;
  if(expected.site&&!storeOnly&&(sites.length!==1||sites[0].replace(/站$/,'')!==expected.site.replace(/站$/,'')))throw new Error('商品编辑页站点未能核实');
  if(!sources.length||sources.some(value=>sourceId(value)!==expected.goodsId))throw new Error('商品来源与本批商品不一致');
  const category=values(['产品分类','分类']);
  const categoryItem=items.find(item=>clean(item.querySelector('.ant-form-item-label')?.textContent)==='产品分类');
  const categoryLabel=value=>{const text=String(value||'').normalize('NFKC').trim(),match=text.match(/^(.*?)\s*\(([^()]*)\)$/);return match&&/[\u3400-\u9fff]/.test(match[1])&&/^[\x20-\x7e]+$/.test(match[2])&&/[A-Za-z]/.test(match[2])?match[1].trim():text;};
  const pathTexts=[...new Set([categoryItem,categoryItem?.parentElement,categoryItem?.parentElement?.parentElement].flatMap(item=>(item?.innerText||'').split('\n').map(line=>line.trim()).filter(line=>line.includes(' > ')&&category.some(label=>categoryLabel(line.split(' > ').at(-1))===categoryLabel(label)))))];
  const pathText=pathTexts.length===1?pathTexts[0]:'';
  const media=[...new Set([...document.querySelectorAll('form img,.ant-form img')].filter(visible).map(e=>e.currentSrc||e.src).filter(value=>/^https?:/.test(value)))].sort();
  const namedValues=labels=>{const selected=values(labels);if(selected.length)return selected;return items.filter(item=>labels.includes(clean(item.querySelector('.ant-form-item-label')?.textContent))).flatMap(item=>[...item.querySelectorAll('input,.ant-form-item-control-input-content')].filter(visible).map(node=>clean(node.value||node.textContent))).filter(Boolean);};
  const modeValues=[...new Set(namedValues(['经营模式','店铺模式','业务模式']))],currencyValues=[...new Set(namedValues(['币种','销售币种','结算币种']))];
  const businessMode=modeValues.length===1?modeValues[0]:'',priceCurrency=currencyValues.length===1&&/^[A-Z]{3}$/.test(currencyValues[0])?currencyValues[0]:'';
  return {url:location.href,account,storeName:stores[0],site:sites[0]||'',siteFieldPresent,sources,category,categoryPath:pathText?pathText.split(' > ').map(value=>value.trim()):[],media,...(businessMode?{businessMode}:{}),...(priceCurrency?{priceCurrency}:{})};
}

export async function sourcePriceContext(args,fields,editor={}){
  const supplied=args.pricePolicy||{},observed=args.row.inspection?.pricingEvidence||args.row.pricingEvidence;
  const usable=observed?.source==='matched-platform-list-row'&&observed.platform===args.templateSnapshot?.platform&&observed.account===args.erpConnection?.expectedAccount&&String(observed.goodsId)===String(args.row.goodsId)&&String(observed.draftId)===String(args.row.draftId)&&observed.storeName===args.storeBinding?.storeName;
  editor={...(usable?{businessMode:observed.businessMode,priceCurrency:observed.priceCurrency}:{}),...editor};
  const options={platform:args.templateSnapshot?.platform,goodsId:String(args.row.goodsId),businessMode:editor.businessMode||supplied.businessMode||args.storeBinding?.verifiedPricing?.businessMode,targetCurrency:editor.priceCurrency||supplied.targetCurrency||args.storeBinding?.verifiedPricing?.currency};
  return {options,plan:captureExistingDxmPrices(fields,options)};
}

export function sourcePriceEvidence(context,fields){
  const baseline=context.plan||captureExistingDxmPrices(fields,context.options),verified=validateExistingDxmPrices(fields,baseline);
  const issues=[...new Set([...verified.issues,...(baseline.issues||[])])];
  const options={platform:context.options.platform,goodsId:context.options.goodsId,businessMode:context.options.businessMode,targetCurrency:context.options.targetCurrency};
  return {version:1,policy:DXM_PRICE_POLICY,url:baseline.url,account:baseline.account,checkedAt:now(),options,prices:clone(baseline.prices),conversions:[],fxVerified:false,assurance:'existing-dxm-price-unchanged',ready:verified.ready&&!issues.length,issues};
}

export function verifySourcePriceEvidence(fields,evidence,{goodsId,platform}={}){
  if(!fields||!Array.isArray(fields.fields))return {ready:false,issues:['缺少保存后实际SKU价格表单，无法核对店小秘原有价格']};
  if(evidence?.version!==1||![SOURCE_PRICE_POLICY,DXM_PRICE_POLICY].includes(evidence.policy)||evidence.ready!==true||evidence.issues?.length||String(evidence.options?.goodsId)!==String(goodsId)||evidence.options?.platform!==platform||!Number.isFinite(Date.parse(evidence.checkedAt))||Date.parse(evidence.checkedAt)>Date.now())return {ready:false,issues:['缺少本商品保存时的店小秘价格及规格记录']};
  if(evidence.policy===DXM_PRICE_POLICY)return validateExistingDxmPrices(fields,evidence,{goodsId,platform});
  // Recheck the saved conversion at its decision time. A restart does not
  // replace the committed quote with today's rate or newer source data.
  return validateSourcePrices(fields,{...evidence.options,clock:()=>Date.parse(evidence.checkedAt)});
}

export function requiredChoiceUiPoint({expected,selector,option,scroll=true}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('属性选择页面或账号发生变化');
  const inputs=[...document.querySelectorAll(selector)].filter(visible);if(inputs.length!==1)throw new Error('自定义属性控件不唯一');
  const input=inputs[0],container=input.closest('.ant-select,.select2-container,.bootstrap-select');
  if(input.disabled||input.getAttribute('aria-disabled')==='true')throw new Error('自定义属性控件已禁用');
  let element;
  if(option){
    const listId=input.getAttribute('aria-controls')||input.getAttribute('aria-owns'),list=listId&&document.getElementById(listId);
    if(!list||!visible(list))return null;
    const candidates=[...list.querySelectorAll('[role="option"]')].filter(e=>visible(e)&&e.getAttribute('aria-disabled')!=='true'&&(e.getAttribute('data-value')??e.id)===option.value&&String(e.getAttribute('aria-label')||e.textContent).replace(/\s+/g,' ').trim()===option.label);
    if(candidates.length!==1)throw new Error('自定义属性选项已变化或不唯一');element=candidates[0];
  }else element=container?.querySelector('.ant-select-selector,.select2-selection,.dropdown-toggle')||input;
  if(scroll)element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  const r=element.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2};
  return element.contains(document.elementFromPoint(point.x,point.y))?{point,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}}:null;
}

export async function completeOrdinaryChoices({page,poll,expected,defaults={},sourceValues={},isStopped,validateIdentity}={}){
  const changes=[],issues=[],attempted=new Set();
  async function click(field,option){
    if(isStopped?.())throw new Error('已暂停属性选择');await validateIdentity?.();
    const args={expected,selector:field.selector,...(option?{option}: {})};
    const hit=await poll(async()=>{const a=await page.evaluate(requiredChoiceUiPoint,args),b=a&&await page.evaluate(requiredChoiceUiPoint,{...args,scroll:false});return a&&isDeepStrictEqual(a,b)?a:null;},{timeout:10000,label:option?'实际属性选项':'展开必填属性'});
    if(isStopped?.())throw new Error('已暂停属性选择');
    const live=await page.evaluate(readRequiredFields,{expected}),current=live.fields.find(item=>item.key===field.key);
    if(!current?.empty||current.protected||current.kind!=='combobox'||!current.required||isPriceField(current))throw new Error('属性已填写或身份发生变化，未覆盖');
    const last=await page.evaluate(requiredChoiceUiPoint,{...args,scroll:false});if(!isDeepStrictEqual(hit,last))throw new Error('属性选项位置已变化');
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...hit.point});
    try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...hit.point});}finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit.point});}
  }
  for(let count=0;count<30;count++){
    if(isStopped?.())throw new Error('已暂停属性选择');
    const snapshot=await page.evaluate(readRequiredFields,{expected}),field=snapshot.fields.find(item=>item.required&&item.empty&&!item.protected&&item.kind==='combobox'&&!isPriceField(item)&&!attempted.has(item.key));
    if(!field)break;attempted.add(field.key);
    try{
      await click(field);
      const opened=await poll(async()=>{const current=await page.evaluate(readRequiredFields,{expected}),found=current.fields.find(item=>item.key===field.key);return found?.options.length?found:null;},{timeout:10000,label:'读取可用属性选项'});
      let chosen;for(const table of [sourceValues,defaults])for(const key of [opened.key,opened.name,opened.id,opened.label])if(chosen===undefined&&key&&table[key]!==undefined)chosen=table[key];
      chosen??=ordinaryFieldDefault(opened);
      const matches=opened.options.filter(option=>!option.disabled&&!option.placeholder&&(option.value===String(chosen)||option.label===String(chosen)));
      if(matches.length!==1)throw new Error('没有唯一可用的默认属性选项');
      await click(opened,matches[0]);
      await poll(async()=>{const current=await page.evaluate(readRequiredFields,{expected}),found=current.fields.find(item=>item.key===field.key);return found&&!found.empty&&[matches[0].label,matches[0].value].includes(String(found.value));},{timeout:10000,label:'实际属性选择结果'});
      changes.push({key:field.key,label:field.label,value:matches[0].label,reason:'ordinary-visible-option'});
    }catch(error){if(isStopped?.())throw error;issues.push(`${field.label}：${error.message}`);}
  }
  return {changes,issues};
}

// Only locators emitted by the inspected list/editor/category dialog are used.
// Final save and move remain separate from all field and category reads.
export function requiredPlatformUiPoint({expected,locator,scroll=true}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const clean=value=>String(value||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('平台操作页面或账号发生变化');
  let nodes=[];
  if(locator.draftId){
    const rows=[...document.querySelectorAll('tr[rowid]')].filter(e=>visible(e)&&e.getAttribute('rowid')===locator.draftId);
    if(!rows.length)throw new Error('当前页未找到目标草稿');
    if(expected.goodsId||expected.storeName){
      const goods=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='temu.com'||u.hostname.endsWith('.temu.com'))?u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||u.searchParams.get('goods_id'):null;}catch{return null;}};
      const ids=[...new Set(rows.flatMap(row=>[...row.querySelectorAll('a[href]')].map(a=>goods(a.href)).filter(Boolean)))];
      const names=[...new Set(rows.flatMap(row=>[...row.innerText.matchAll(/「([^」]+)」/g)].map(match=>match[1])))];
      if(ids.length!==1||ids[0]!==expected.goodsId||names.length!==1||names[0]!==expected.storeName)throw new Error('移动前草稿的来源或店铺发生变化');
      if(expected.site){
        const column=[...document.querySelectorAll('thead th[colid]')].find(e=>/^(站点|销售站点)$/.test(e.textContent.trim()))?.getAttribute('colid');
        const sites=[...new Set(rows.map(row=>column?row.querySelector(`td[colid="${column}"]`)?.innerText.trim().split('\n')[0]:'').filter(Boolean))];
        const storeOnly=/^\/web\/sheinProduct\/(draft|offline)$/.test(location.pathname)&&!column&&sites.length===0;
        if(!storeOnly&&(sites.length!==1||sites[0].replace(/站$/,'')!==expected.site.replace(/站$/,'')))throw new Error('移动前草稿站点发生变化');
      }
    }
    nodes=rows.flatMap(row=>[...row.querySelectorAll('button,a')]).filter(e=>e.textContent.trim()===locator.text);
  }else if(locator.categoryDepth!==undefined){
    const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&e.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');
    if(modals.length!==1)throw new Error('分类窗口不唯一');
    const boxes=[...modals[0].querySelectorAll('.categories-box')].filter(visible),box=boxes[locator.categoryDepth];
    nodes=[...box?.querySelectorAll('.categories-item-name')||[]].filter(e=>e.textContent.trim()===locator.text);
  }else if(locator.formLabel){
    const items=[...document.querySelectorAll('.ant-form-item')].filter(e=>visible(e)&&clean(e.querySelector('.ant-form-item-label')?.textContent)===locator.formLabel);
    if(items.length!==1)throw new Error('表单项目无法唯一定位：'+locator.formLabel);
    nodes=[...items[0].querySelectorAll(locator.descendant||'button')].filter(e=>!locator.text||e.textContent.trim()===locator.text);
  }else if(locator.filterTitle){
    const groups=[...document.querySelectorAll('.in-screen-single,.in-screen-multiple')].filter(e=>visible(e)&&e.querySelector('.title')?.textContent.trim()===locator.filterTitle);
    if(groups.length!==1)throw new Error('平台列表筛选范围不唯一');
    nodes=[...groups[0].querySelectorAll('.d-tag-group-item')].filter(e=>e.textContent.trim()===locator.text);
  }else if(locator.next)nodes=[...document.querySelectorAll('.vxe-pager--next-btn,.ant-pagination-next')].filter(visible).slice(0,1);
  else nodes=[...document.querySelectorAll(locator.selector||'button')].filter(e=>!locator.text||e.textContent.trim()===locator.text);
  nodes=nodes.filter(e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!e.classList.contains('is--disabled')&&!e.closest('.fixed--hidden'));
  // The editor repeats the same save action above and below its form.
  if(locator.first===true)nodes=nodes.slice(0,1);
  if(scroll&&nodes.length===1)nodes[0].scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  const hits=nodes.map(e=>{const r=e.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(point.x,point.y))?{point,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}}:null;}).filter(Boolean);
  if(hits.length>1)throw new Error('操作入口不唯一，未猜测点击');return hits[0]||null;
}

export function requiredPlatformSnapshot(editor,fields){
  // Selector IDs and table render IDs can change when the editor is reopened.
  // Keep product data and SKU identity in the persisted comparison instead.
  const {siteFieldPresent,...content}=clone(editor);
  return {...content,fields:fields.fields.map(field=>({label:field.label,name:field.name,kind:field.kind,value:clone(field.value),required:field.required,protected:field.protected,rowSku:field.rowIdentity?.sku||'',options:field.kind==='combobox'?[]:field.options.map(option=>({value:option.value,label:option.label,disabled:option.disabled}))}))};
}

export function requiredPlatformSnapshotsMatch(actual,expected){
  const current=clone(actual);
  if(current.categoryPath?.length&&expected?.categoryPath?.length&&categoryPathMatches(current.categoryPath,expected.categoryPath)){
    current.categoryPath=clone(expected.categoryPath);
    if(categoryPathMatches(current.category,expected.category))current.category=clone(expected.category);
    for(const field of current.fields||[])if(/分类|类目/.test(field.label)){
      const prior=expected.fields?.find(item=>item.name===field.name&&item.label===field.label&&item.rowSku===field.rowSku);
      if(prior&&categoryPathMatches(Array.isArray(field.value)?field.value:[field.value],Array.isArray(prior.value)?prior.value:[prior.value]))field.value=clone(prior.value);
    }
  }
  return isDeepStrictEqual(current,expected);
}

export function existingRequiredValuesIssues(before,after,{pricePlan}={}){
  const issues=[];
  for(const field of before.fields){
    if(field.empty||/分类|类目/.test(field.label))continue;
    const matches=after.fields.filter(candidate=>candidate.name===field.name&&candidate.label===field.label&&(candidate.rowIdentity?.sku||'')===(field.rowIdentity?.sku||''));
    const target=matches.length===1?matches[0]:matches.find(candidate=>candidate.key===field.key);
    if(isPriceField(field)&&target&&pricePlan?.policy===SOURCE_PRICE_POLICY&&pricePlan.prices?.some(price=>price.key===target.key&&price.matched))continue;
    if(!target||!isDeepStrictEqual(target.value,field.value))issues.push('已有内容发生变化：'+field.label);
  }
  return [...new Set(issues)];
}

export async function dispatchDxmNativeSave({page,poll,expected,beforeDispatch,isStopped}={}){
  if(typeof beforeDispatch!=='function')throw new Error('缺少原生批量保存前检查和提交记录');
  const {nativeEditorUiPoint}=await import('./dxm-native-editor.mjs');
  const parameters={expected,locator:{text:'保存'}},checkStopped=()=>{if(isStopped?.())throw new Error('本批任务已暂停，未继续保存');};
  checkStopped();
  const hit=await poll(async()=>{
    checkStopped();const first=await page.evaluate(nativeEditorUiPoint,parameters);
    const second=first&&await page.evaluate(nativeEditorUiPoint,{...parameters,scroll:false});
    return first&&isDeepStrictEqual(first,second)?first:null;
  },{timeout:15000,label:'原生批量保存入口'});
  if(!Number.isFinite(hit?.x)||!Number.isFinite(hit?.y))throw new Error('原生批量保存按钮坐标无效，未记录或提交保存');
  checkStopped();await beforeDispatch();checkStopped();
  if(!isDeepStrictEqual(hit,await page.evaluate(nativeEditorUiPoint,{...parameters,scroll:false})))throw new Error('原生保存入口已变化，未再次点击');
  const point={x:hit.x,y:hit.y};
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...point});
  try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});}
  finally{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
}

export function createDxmRequiredPlatformBrowser(configuration={},transport){
  const library=()=>transport||import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  async function owned(args,work,{preserve=false}={}){
    if(args.browserConfig?.type!=='chrome'||!args.erpConnection?.expectedAccount)throw new Error('请先绑定店小秘账号及谷歌浏览器');
    stop(args);const lib=await library(),info=await lib.connection(args.browserConfig),browser=await lib.connect(info.ws);let page,targetId,completed=false;const childPages=new Map();
    try{
      ({targetId}=await browser.send('Target.createTarget',{url:'about:blank',background:true}));
      page=await lib.pageById(info,targetId);await page.send('Page.enable');await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      const session={targetId,async nextPage(current,allowedPaths){
        const allow=value=>{try{const url=new URL(value);return url.origin===origin&&!url.username&&!url.password&&!url.hash&&allowedPaths.includes(url.pathname);}catch{return false;}};
        const ownedIds=new Set([targetId,...childPages.keys()]);
        return lib.poll(async()=>{
          stop(args);const targets=(await browser.send('Target.getTargets')).targetInfos||[];
          const matches=nativeOwnedDescendants(targets,ownedIds,allowedPaths);
          // The next page must be the current owned tab after navigation or a
          // uniquely identified popup opened by our owned page, never by URL alone.
          const currentUrl=await current.evaluate(()=>location.href).catch(()=>'');
          if(allow(currentUrl))return {page:current,url:currentUrl};
          const fresh=matches.filter(target=>!ownedIds.has(target.targetId));
          if(fresh.length>1)throw new Error('原生批量打开了多个目标页面，未猜测操作范围');
          if(fresh.length!==1)return null;
          const target=fresh[0],child=await lib.pageById(info,target.targetId);childPages.set(target.targetId,child);
          await child.send('Page.enable');await child.send('Emulation.setFocusEmulationEnabled',{enabled:true});
          await args.onTarget?.('native-'+(args.batchId||'batch'),target.targetId);
          return {page:child,url:target.url};
        },{timeout:30000,label:'本批原生编辑页面'});
      }};
      const result=await work(page,lib,session);
      completed=!preserve&&!result?.retainPage&&result?.status!=='needs-review'&&!result?.rows?.some(row=>['needs-review','ambiguous'].includes(row.status));
      return result;
    }finally{
      for(const [id,child] of childPages){await child.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});await child.close();if(completed)await browser.send('Target.closeTarget',{targetId:id}).catch(()=>{});}
      if(page)await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});
      await page?.close();
      // Keep failed or unresolved pages available for inspection; detaching the
      // automation session must not destroy the user's error context.
      if(completed&&targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});
      browser.close();
    }
  }
  async function navigate(page,lib,args,url){
    const platform=platformOf(args);if(![listUrl(platform),listUrl(platform,'offline')].includes(url)&&!editUrl(url,platform))throw new Error('不允许打开此平台操作地址');
    stop(args);const navigation=await page.send('Page.navigate',{url});if(navigation.errorText)throw new Error('平台页面打开失败：'+navigation.errorText);
    await lib.poll(async()=>{stop(args);try{return await page.evaluate(({url,account})=>location.href===url&&document.readyState==='complete'&&document.querySelector('.btn-user .user-name')?.textContent.trim()===account,{url,account:args.erpConnection.expectedAccount});}catch(error){if(/context|navigat/i.test(error.message))return false;throw error;}},{timeout:45000,label:'平台页面及账号加载'});
  }
  async function point(page,lib,args,expected,locator,beforeDispatch){
    stop(args);const hit=await lib.poll(async()=>{
      const first=await page.evaluate(requiredPlatformUiPoint,{expected,locator});if(!first)return null;
      const second=await page.evaluate(requiredPlatformUiPoint,{expected,locator,scroll:false});
      return second&&isDeepStrictEqual(first,second)?second:null;
    },{timeout:15000,label:'平台操作入口：'+(locator.text||locator.formLabel||'下一页')});
    stop(args);await beforeDispatch?.();stop(args);
    const current=await page.evaluate(requiredPlatformUiPoint,{expected,locator,scroll:false});if(!current||!isDeepStrictEqual(hit,current))throw new Error('操作入口变化，未重复点击');
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...hit.point});
    try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...hit.point});}
    catch(error){await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit.point}).catch(()=>{});throw error;}
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit.point});
  }
  function expectedRow(args){
    const platform=platformOf(args),row=args.row,binding=args.storeBinding;
    if(!row||!binding||!editUrl(row.platformEditUrl,platform)||new URL(row.platformEditUrl).searchParams.get('id')!==row.draftId||productIdentity(row.sourceUrl)!==row.goodsId||row.storeBindingKey&&row.storeBindingKey!==binding.key||row.storeName&&row.storeName!==binding.storeName)throw new Error('商品、店铺或草稿身份不一致');
    return {url:row.platformEditUrl,account:args.erpConnection.expectedAccount,storeName:binding.storeName,site:binding.site||'',goodsId:row.goodsId};
  }
  async function editor(page,lib,args){
    const expected=expectedRow(args);await navigate(page,lib,args,expected.url);
    const state=await lib.poll(async()=>{try{return await page.evaluate(readRequiredPlatformEditor,expected);}catch(error){if(/来源|店铺|站点/.test(error.message))return null;throw error;}},{timeout:30000,label:'商品来源、店铺和分类表单'});
    return {expected,state};
  }
  async function scan(page,lib,args,status='draft'){
    const platform=platformOf(args),url=listUrl(platform,status),expected={url,account:args.erpConnection.expectedAccount,editPath:`/web/${routes[platform]}/edit`};
    await navigate(page,lib,args,url);const visited=new Set(),records=new Map();
    for(let number=1;number<=100;number++){
      let state=await lib.poll(()=>page.evaluate(readRequiredPlatformList,expected),{timeout:45000,label:'平台商品列表'});
      if(number===1)for(let attempt=0;attempt<4;attempt++){
        const group=state.filters.find(item=>item.selected.length!==1||item.selected[0]!=='全部');if(!group)break;
        await point(page,lib,args,expected,{filterTitle:group.title,text:'全部'});
        state=await lib.poll(async()=>{const next=await page.evaluate(readRequiredPlatformList,expected);return next?.filters.find(item=>item.title===group.title)?.selected.join('|')==='全部'?next:null;},{timeout:15000,label:'恢复平台全部店铺筛选'});
      }
      if(state.search||state.filters.some(item=>item.selected.length!==1||item.selected[0]!=='全部'))throw new Error('平台列表仍有筛选，不能判断本批商品是否存在');
      if(state.pageNumbers.length&&state.pageNumbers.some(value=>value!==number))throw new Error('平台列表页码不连续，未将部分列表当作完整结果');
      const fingerprint=state.rows.map(row=>row.draftId).join('|');if(visited.has(fingerprint))throw new Error('平台商品列表重复返回同一页');visited.add(fingerprint);
      for(const row of state.rows){if(records.has(row.draftId))throw new Error('平台列表跨页出现重复草稿');records.set(row.draftId,row);}
      stop(args);await args.onProgress?.({phase:'scan',page:number,scanned:records.size,total:state.total,message:`正在核对${platform.toUpperCase()}采集箱，第${number}页`});
      if(!state.nextEnabled){if(records.size!==state.total)throw new Error('平台商品列表记录数量未完整核对');return {rows:[...records.values()],expected};}
      await point(page,lib,args,expected,{next:true});
      await lib.poll(async()=>{const next=await page.evaluate(readRequiredPlatformList,expected);return next&&next.rows.map(row=>row.draftId).join('|')!==fingerprint;},{timeout:30000,label:'平台下一页商品'});
    }
    throw new Error('平台列表超过分页读取上限，未将部分结果当作完整记录');
  }
  async function locate(page,lib,args,status){
    const result=await scan(page,lib,args,status),matches=result.rows.filter(row=>row.draftId===args.row.draftId);
    if(!matches.length)return null;
    const row=matches[0];if(row.goodsIds.length!==1||row.goodsIds[0]!==args.row.goodsId||row.storeNames.length!==1||row.storeNames[0]!==args.storeBinding.storeName||!matchesPlatformSite(platformOf(args),args.storeBinding.site,row))throw new Error('平台列表中的草稿来源、店铺或站点不一致');
    return row;
  }
  async function inspect(args){
    const platform=platformOf(args);
    return owned(args,async(page,lib)=>{
      const result=await scan(page,lib,args),rows=[];
      for(const source of args.rows)for(const binding of args.templateSnapshot.storeBindings){
        stop(args);const base={goodsId:source.goodsId,sourceUrl:source.sourceUrl,storeBindingKey:binding.key,storeName:binding.storeName,site:binding.site||''};
        const sameStore=result.rows.filter(row=>row.goodsIds.includes(source.goodsId)&&row.storeNames.includes(binding.storeName));
        const candidates=sameStore.filter(row=>matchesPlatformSite(platform,binding.site,row));
        const resolved=args.resolvedTargets?.find(row=>row.goodsId===source.goodsId&&row.storeBindingKey===binding.key);
        const unknown=result.rows.some(row=>!row.goodsIds.length&&!row.storeNames.length||row.storeNames.includes(binding.storeName)&&row.goodsIds.length!==1||row.goodsIds.includes(source.goodsId)&&(row.storeNames.length!==1||binding.site&&row.sites.length!==1&&!matchesPlatformSite(platform,binding.site,row)));
        if(unknown&&!resolved){rows.push({...base,status:'needs-review',issues:['此店铺有来源或身份不完整的采集箱记录，尚不能判断是否已认领']});continue;}
        if(!candidates.length){rows.push({...base,status:sameStore.length?'needs-review':'unclaimed',issues:[sameStore.length?'已找到同源店铺商品，但站点与绑定不一致或尚未核实，未重复认领':'该商品尚未在此店铺采集箱找到']});continue;}
        const selected=resolved?candidates.filter(row=>row.draftId===resolved.draftId):candidates;
        if(selected.length!==1){rows.push({...base,status:'ambiguous',candidates:candidates.map(row=>({...row,platformEditUrl:`${origin}/web/${routes[platform]}/edit?id=${row.draftId}`})),issues:['该店存在多个来源商品记录，请明确本次草稿']});continue;}
        const candidate=selected[0],platformEditUrl=`${origin}/web/${routes[platform]}/edit?id=${candidate.draftId}`;
        try{
          const rowArgs={...args,row:{...base,draftId:candidate.draftId,platformEditUrl},storeBinding:binding};
          const {expected,state}=await editor(page,lib,rowArgs),fields=await page.evaluate(readRequiredFields,{expected});
          const missing=fields.fields.filter(field=>field.required&&field.empty).map(field=>({label:field.label,value:field.value,missing:true}));
          const pricingEvidence={source:'matched-platform-list-row',platform,account:expected.account,draftId:candidate.draftId,goodsId:source.goodsId,storeName:binding.storeName,...(candidate.businessModes?.length===1?{businessMode:candidate.businessModes[0]}:{}),...(candidate.priceCurrencies?.length===1?{priceCurrency:candidate.priceCurrencies[0]}:{}),observedAt:now()};
          rows.push({...base,status:'located',draftId:candidate.draftId,platformEditUrl,pricingEvidence,siteEvidence:{configuredSite:binding.site||'',observedSite:state.site,fieldPresent:state.siteFieldPresent},snapshot:requiredPlatformSnapshot(state,fields),requiredFields:fields.fields.filter(field=>field.required).map(field=>({label:field.label,value:field.value,missing:field.empty})),issues:missing.map(field=>'待填写：'+field.label)});
        }catch(error){rows.push({...base,status:'needs-review',draftId:candidate.draftId,platformEditUrl,issues:[error.message]});}
      }
      return {rows};
    });
  }
  async function readCategories(args){
    const platform=platformOf(args);
    return owned(args,async(page,lib)=>{
      const {expected}=await editor(page,lib,args);
      await point(page,lib,args,expected,{formLabel:'产品分类',text:'选择分类'});
      const result=await browseDxmCategoryCatalog({page,poll:lib.poll,point:locator=>point(page,lib,args,expected,locator),expected,path:args.path||[],isStopped:args.isStopped});
      return {...result,platform,account:expected.account,storeBindingKey:args.storeBinding.key};
    });
  }
  async function searchCategories(args){
    const platform=platformOf(args);if(platform!=='shein')throw new Error('此平台尚未接入当前店铺的分类搜索');
    const {searchDxmCategoryCatalog}=await import('./dxm-category-browser.mjs');
    return owned(args,async(page,lib)=>{
      const {expected}=await editor(page,lib,args);
      await point(page,lib,args,expected,{formLabel:'产品分类',text:'选择分类'});
      const result=await searchDxmCategoryCatalog({page,poll:lib.poll,point:locator=>point(page,lib,args,expected,locator),expected,query:args.query,isStopped:args.isStopped});
      return {...result,platform,account:expected.account,storeBindingKey:args.storeBinding.key};
    });
  }
  function newMode(args){if(args.workflowMode!=='required-fields'||args.completionMode!=='pending'||args.templateSnapshot?.rules?.autoFillRequired!==true)throw new Error('此执行器仅支持补齐必填项后转入待发布');}
  async function chooseCategory(page,lib,args,expected){
    const category=args.templateSnapshot.category;if(!category?.path?.length||!category.id&&!category.candidateId)throw new Error('请先在工作台选择已读取的末级分类');
    await point(page,lib,args,expected,{formLabel:'产品分类',text:'选择分类'});
    if(category.source==='store-search'||category.candidateId){
      const {applyDxmSearchedCategory}=await import('./dxm-category-browser.mjs');
      const query=args.row?.categorySelection?.searchQuery||category.path.at(-1).replace(/\s*\([^()]*\)\s*$/,'');
      await applyDxmSearchedCategory({page,poll:lib.poll,point:locator=>point(page,lib,args,expected,locator),expected,query,category,isStopped:args.isStopped});
      await lib.poll(async()=>{const state=await page.evaluate(readRequiredPlatformEditor,expected);return categoryPathMatches(state.categoryPath,category.path);},{timeout:30000,label:'所选完整分类回读'});
      return;
    }
    const parent=category.path.slice(0,-1),catalog=await browseDxmCategoryCatalog({page,poll:lib.poll,point:locator=>point(page,lib,args,expected,locator),expected,path:parent,isStopped:args.isStopped});
    if(!catalog.options.some(item=>item.id===category.id&&item.leaf&&categoryPathMatches(item.path,category.path)))throw new Error('所选分类在此店铺的实际目录中已变化');
    await point(page,lib,args,expected,{categoryDepth:parent.length,text:category.path.at(-1)});
    await lib.poll(async()=>{const state=await page.evaluate(readDxmCategoryCatalog,{expected});if(state?.pathIssues?.some(issue=>issue.code==='ambiguous'))throw new Error(state.pathIssues.map(issue=>issue.message).join('；'));return state&&!state.loading&&!state.pathIssues?.length&&state.canSelect&&categoryPathMatches(state.path,category.path,{columns:state.columns,pathIds:state.pathIds,expectedIds:category.path.map((_,index)=>index===category.path.length-1?category.id:'')});},{timeout:30000,label:'所选末级分类完整路径'});
    await point(page,lib,args,expected,{selector:'.ant-modal button',text:'选择'});
    await lib.poll(async()=>{const state=await page.evaluate(readRequiredPlatformEditor,expected);return categoryPathMatches(state.category.slice(-1),category.path.slice(-1));},{timeout:30000,label:'产品分类及必填项加载'});
  }
  async function verifyOnPage(page,lib,args){
    const intent=args.preparationIntent||args.row.saveIntent?.payload;
    const base={platformEditUrl:args.row.platformEditUrl,published:false,submitted:false};
    if(!intent?.expectedSnapshot||intent.url!==args.row.platformEditUrl||intent.goodsId!==args.row.goodsId||intent.storeBindingKey!==args.storeBinding.key)return {...base,status:'needs-review',saved:null,ready:false,issues:['缺少本商品保存前的完整记录']};
    if(intent.expectedSnapshot.policy==='native-batch-preserve-fields-v1')return verifyNativeOnPage(page,lib,args,intent);
    const {expected}=await editor(page,lib,args);let snapshot,fields;
    try{await lib.poll(async()=>{const state=await page.evaluate(readRequiredPlatformEditor,expected);fields=await page.evaluate(readRequiredFields,{expected});snapshot=requiredPlatformSnapshot(state,fields);return requiredPlatformSnapshotsMatch(snapshot,intent.expectedSnapshot);},{timeout:30000,label:'独立回读商品保存结果'});}catch{return {...base,status:'needs-review',saved:null,ready:false,issues:['保存后内容与提交前快照不一致，未重复保存']};}
    const plan=planRequiredFields(fields),price=verifySourcePriceEvidence(fields,intent.priceEvidence,{goodsId:args.row.goodsId,platform:platformOf(args)}),issues=[...plan.issues,...plan.missing.map(field=>'必填项仍未完成：'+field.label),...price.issues];
    if(!categoryPathMatches(snapshot.categoryPath,args.templateSnapshot.category.path))issues.push('保存后完整分类路径与用户选择不一致');
    return {...base,status:issues.length?'needs-review':'prepared',saved:true,ready:!issues.length,issues,snapshot,priceEvidence:intent.priceEvidence,requiredFields:fields.fields.filter(field=>field.required).map(field=>({label:field.label,value:field.value,missing:field.empty})),verification:{method:intent.priceEvidence?.policy===DXM_PRICE_POLICY?'persisted-required-fields-and-dxm-price':'persisted-required-fields-and-source-price',readOnly:true,checkedAt:now(),draftId:args.row.draftId}};
  }
  async function prepare(args){
    newMode(args);
    if(args.row.saveIntent||args.row.moveIntent||args.row.publishIntent)throw new Error('此商品已有提交记录，请先只读核对，不能重复保存');
    return owned(args,async(page,lib)=>{
      const {expected,state:initial}=await editor(page,lib,args),before=await page.evaluate(readRequiredFields,{expected});
      await chooseCategory(page,lib,args,expected);
      let last='';await lib.poll(async()=>{const fields=await page.evaluate(readRequiredFields,{expected}),key=JSON.stringify(fields.fields.map(field=>[field.key,field.value]));const stable=last===key;last=key;return stable;},{timeout:15000,label:'分类后动态表单稳定'});
      const sourceValues={产品标题:args.row.title||'',title:args.row.title||''},choiceChanges=[],choiceIssues=[];
      const choose=async()=>{const result=await completeOrdinaryChoices({page,poll:lib.poll,expected,sourceValues,isStopped:args.isStopped,validateIdentity:()=>page.evaluate(readRequiredPlatformEditor,expected)});choiceChanges.push(...result.changes);choiceIssues.splice(0,choiceIssues.length,...result.issues);};
      const pricing=await sourcePriceContext(args,await page.evaluate(readRequiredFields,{expected}),await page.evaluate(readRequiredPlatformEditor,expected));await choose();
      const result=await completeRequiredFields({page,expected,allowOrdinaryDefaults:true,isStopped:args.isStopped,validateIdentity:()=>page.evaluate(readRequiredPlatformEditor,expected),sourceValues,pricePlanFor:fields=>validateExistingDxmPrices(fields,pricing.plan),afterWrite:async()=>{await lib.poll(async()=>{stop(args);return !!await page.evaluate(readRequiredPlatformEditor,expected);},{timeout:10000,label:'必填项填写回读'});await choose();}});
      const state=await page.evaluate(readRequiredPlatformEditor,expected),fields=await page.evaluate(readRequiredFields,{expected});
      const priceEvidence=sourcePriceEvidence(pricing,fields);
      const issues=[...existingRequiredValuesIssues(before,fields),...result.issues,...choiceIssues,...priceEvidence.issues];
      if(!initial.media.every(url=>state.media.includes(url)))issues.push('原商品图片发生变化，未保存');
      if(!categoryPathMatches(state.category.slice(-1),args.templateSnapshot.category.path.slice(-1))||!categoryPathMatches(state.categoryPath,args.templateSnapshot.category.path))issues.push('产品完整分类路径未与用户选择一致');
      const snapshot=requiredPlatformSnapshot(state,fields),base={platformEditUrl:expected.url,published:false,submitted:false,snapshot,priceEvidence,requiredFields:fields.fields.filter(field=>field.required).map(field=>({label:field.label,value:field.value,missing:field.empty})),changes:[...result.changes,...choiceChanges]};
      if(issues.length||!result.ready||args.dryRun)return {...base,status:issues.length?'needs-review':'ready-to-save',saved:false,ready:false,readyToSave:!issues.length&&result.ready,issues:[...new Set(issues)],saveOutcome:'not-saved'};
      if(typeof args.beforeSave!=='function')throw new Error('缺少保存前提交记录，未保存商品');
      const intent={version:2,url:expected.url,goodsId:args.row.goodsId,storeBindingKey:args.storeBinding.key,templateId:args.templateSnapshot.id,templateVersion:args.templateSnapshot.version,expectedSnapshot:snapshot,priceEvidence,createdAt:now()};
      await point(page,lib,args,expected,{selector:'button',text:'保存',first:true},async()=>{
        const check=async()=>{const editorState=await page.evaluate(readRequiredPlatformEditor,expected),fieldState=await page.evaluate(readRequiredFields,{expected});if(!isDeepStrictEqual(requiredPlatformSnapshot(editorState,fieldState),snapshot))throw new Error('保存前表单内容已变化，未提交保存');};
        await check();await args.beforeSave(clone(intent));await check();
      });
      // A missing toast never authorizes another save. Verification opens an
      // independent page and compares the original intent, including old values.
      await lib.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.ant-message-notice-content')].some(e=>e.getClientRects().length&&/保存成功|已保存|保存失败/.test(e.textContent))),{timeout:8000,label:'保存回执'}).catch(()=>{});
      return owned(args,(review,reviewLib)=>verifyOnPage(review,reviewLib,{...args,preparationIntent:intent}));
    });
  }
  const verify=args=>owned(args,(page,lib)=>verifyOnPage(page,lib,args));
  async function verifyNativeOnPage(page,lib,args,intent){
    const {verifyNativeBatchMemberReadback}=await import('./dxm-native-editor.mjs');
    const {readDxmCategoryVariantEvidence}=await import('./dxm-native-category-map.mjs');
    const row=args.row,base={id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,platformEditUrl:row.platformEditUrl,published:false,submitted:false,readOnly:true};
    const {expected}=await editor(page,lib,args);let check,fields;
    try{
      await lib.poll(async()=>{
        stop(args);const state=await page.evaluate(readRequiredPlatformEditor,expected);fields=await page.evaluate(readRequiredFields,{expected});
        fields.variantEvidence=await page.evaluate(readDxmCategoryVariantEvidence,{expected,fields});
        check=verifyNativeBatchMemberReadback({editor:state,fields,expectedSnapshot:intent.expectedSnapshot,priceEvidence:intent.priceEvidence,memberPriceEvidence:intent.memberPriceEvidence});
        return check.ready;
      },{timeout:30000,label:'独立核对原生批量保存的属性、空项、价格和变种'});
    }catch(error){return {...base,status:'needs-review',ready:false,saved:null,issues:check?.issues?.length?check.issues:[error.message]};}
    return {...base,status:'prepared',ready:true,saved:true,issues:[],priceEvidence:intent.priceEvidence,requiredFields:fields.fields.filter(field=>field.required).map(field=>({label:field.label,value:field.value,missing:field.empty})),verification:{method:'independent-native-member-readback',readOnly:true,checkedAt:now(),draftId:row.draftId}};
  }
  async function verifyNativeBatchMember(args){
    if(args.verifyCategoryOnly){
      const {verifyNativeCategoryMemberReadback,readDxmCategoryVariantEvidence}=await import('./dxm-native-category-map.mjs');
      return owned(args,async(page,lib)=>{
        const {expected,state}=await editor(page,lib,args),fields=await page.evaluate(readRequiredFields,{expected});
        fields.variantEvidence=await page.evaluate(readDxmCategoryVariantEvidence,{expected,fields});
        return verifyNativeCategoryMemberReadback({editor:state,fields,row:args.row,scope:args.nativeBatch,nativeCategoryIntent:args.nativeCategoryIntent});
      });
    }
    const identity={id:args.row.id,goodsId:args.row.goodsId,storeBindingKey:args.row.storeBindingKey,draftId:args.row.draftId,platformEditUrl:args.row.platformEditUrl,readOnly:true};
    return {...(args.verifyPending?await verifyPublication(args):await verify(args)),...identity};
  }
  async function verifyPublication(args){
    return owned(args,async(page,lib)=>{
      const found=await locate(page,lib,args,'offline');
      if(!found)return {status:'needs-review',publicationStatus:'unknown',movedToPending:false,published:false,submitted:false,publicationNotSubmitted:true,issues:['待发布列表尚未确认本商品，未重新移动']};
      const saved=await verifyOnPage(page,lib,args);
      if(saved.saved!==true||!saved.ready)return {...saved,publicationStatus:'unknown',movedToPending:false,publicationNotSubmitted:true};
      return {...saved,status:'pending-ready',publicationStatus:'draft',movedToPending:true,published:false,submitted:false,publicationNotSubmitted:true,issues:[],verification:{...saved.verification,method:'exact-pending-draft-and-snapshot',readOnly:true}};
    });
  }
  async function moveToPending(args){
    newMode(args);expectedRow(args);
    if(args.row.publishIntent)throw new Error('此商品已有正式发布记录，需要先核对');
    return owned(args,async(page,lib)=>{
      const pending=await locate(page,lib,args,'offline');
      if(pending)return verifyPublication(args);
      if(args.row.moveIntent)throw new Error('已有移动记录但结果尚未确认，不能重复移动');
      const saved=await verifyOnPage(page,lib,args);if(!saved.ready||saved.saved!==true)return {...saved,publicationStatus:'unknown',publicationNotSubmitted:true,movedToPending:false};
      const found=await locate(page,lib,args,'draft');if(!found)throw new Error('采集箱没有定位本次商品，未移动');
      // locate() may scan several pages. Return to the exact record's page
      // before obtaining a button; never act on a different row after scanning.
      const platform=platformOf(args),url=listUrl(platform),expected={url,account:args.erpConnection.expectedAccount,editPath:`/web/${routes[platform]}/edit`,goodsId:args.row.goodsId,storeName:args.storeBinding.storeName,site:args.storeBinding.site||''};
      await navigate(page,lib,args,url);let located=false;
      for(let index=0;index<100;index++){
        const current=await lib.poll(()=>page.evaluate(readRequiredPlatformList,expected),{timeout:30000,label:'定位本次待移动草稿'});
        if(current.rows.some(row=>row.draftId===args.row.draftId)){located=true;break;}
        if(!current.nextEnabled)break;const prior=current.rows.map(row=>row.draftId).join('|');await point(page,lib,args,expected,{next:true});await lib.poll(async()=>{const next=await page.evaluate(readRequiredPlatformList,expected);return next&&next.rows.map(row=>row.draftId).join('|')!==prior;},{timeout:30000,label:'定位草稿下一页'});
      }
      if(!located)throw new Error('待移动草稿所在页面已变化');
      if(typeof args.beforeMoveToPending!=='function')throw new Error('缺少移动前提交记录');
      const row=args.row,payload={draftId:row.draftId,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,url:row.platformEditUrl,sourceUrl:row.sourceUrl,from:'collection',to:'pending-publication',createdAt:now()};
      let attempted=false;
      try{
        await point(page,lib,args,expected,{draftId:row.draftId,text:'移入待发布'},async()=>{await args.beforeMoveToPending(payload);attempted=true;});
        const result=await verifyPublication(args);
        if(result.movedToPending)await args.onMovedToPending?.({draftId:row.draftId,movedToPending:true,publicationStatus:'draft',checkedAt:now()});
        return result;
      }catch(error){return {status:'needs-review',publicationStatus:'unknown',movedToPending:false,moveAttempted:attempted,published:false,submitted:false,publicationNotSubmitted:true,issues:[error.message]};}
    });
  }
  async function openNativeBatch(args){
    const platform=platformOf(args);
    if(platform!=='shein')throw new Error('此平台的原生批量编辑入口尚未适配');
    const scope=nativeBatchScope({platform,account:args.erpConnection?.expectedAccount,storeBinding:args.storeBinding,rows:args.rows});
    return owned(args,async(page,lib)=>{
      await navigate(page,lib,args,scope.url);
      const result=await openDxmNativeBatchSelection({page,poll:lib.poll,scope,requestId:args.requestId,beforeOpen:args.beforeOpen,onReadback:args.onReadback,onProgress:args.onProgress,isStopped:args.isStopped,existingIntent:args.existingIntent});
      await page.send('Page.bringToFront').catch(()=>{});
      return {...result,retainPage:true};
    },{preserve:true});
  }
  async function moveToPendingBatch(args){
    newMode(args);
    const native=await import('./dxm-native-editor.mjs');
    if(!native.NATIVE_EDITOR_CAPABILITIES.nativePending)return unsupportedNative(args,'原生批量完整资料及移入待发布尚未完成验证，未移动本批商品');
    return owned(args,async(page,lib)=>runDxmNativePending(args,{
      verify:(row,preparationIntent)=>verifyNativeBatchMember({...args,row,preparationIntent,verifyPending:false}),
      verifyPending:(row,preparationIntent)=>verifyNativeBatchMember({...args,row,preparationIntent,verifyPending:true}),
      move:async(scope,beforeDispatch)=>{
        await navigate(page,lib,args,scope.url);
        return moveDxmNativeBatchSelection({page,poll:lib.poll,scope,beforeDispatch,onProgress:args.onProgress,isStopped:args.isStopped});
      }
    }));
  }
  async function prepareBatch(args){
    newMode(args);
    const native=await import('./dxm-native-editor.mjs'),category=await import('./dxm-native-category-map.mjs');
    if(!native.NATIVE_EDITOR_CAPABILITIES.nativePrepare)return unsupportedNative(args,'当前原生批量主表未提供完整普通类目属性；尚不能自动完成整批资料，未保存分类或商品');
    return owned(args,async(page,lib,session)=>{
      const baseline={rows:[]};
      return runDxmNativePreparation(args,{
        enter:async scope=>{
          for(const row of args.rows){
            stop(args);const {expected,state}=await editor(page,lib,{...args,row});
            const fields=await page.evaluate(readRequiredFields,{expected});
            const variantEvidence=await page.evaluate(category.readDxmCategoryVariantEvidence,{expected,fields});
            const pricing=await sourcePriceContext({...args,row},fields,state);
            if(!pricing.plan.ready)throw new Error(pricing.plan.issues.join('；')||'分类前店小秘原有价格尚未完整核实');
            baseline.rows.push({...clone(row),editor:state,fields,variantEvidence,originalPriceEvidence:clone(pricing.plan)});
          }
          await navigate(page,lib,args,scope.url);
          const opened=await openDxmNativeBatchSelection({page,poll:lib.poll,scope,requestId:args.batchId,beforeOpen:async value=>args.onProgress?.({phase:'native-open',scopeKey:value.scopeKey,message:'已核对本批商品，正在打开店小秘原生批量编辑'}),onProgress:args.onProgress,isStopped:args.isStopped});
          if(!opened.intent)throw new Error(opened.blockers?.[0]?.message||'原生批量入口未打开');
          if(opened.phase==='category-mapping-required')await continueDxmNativeCategoryMapping({page,poll:lib.poll,scope,isStopped:args.isStopped});
          return session.nextPage(page,['/web/modifyCategory','/web/sheinProduct/batchEdit']);
        },
        categories:async(context,scope)=>{
          let mapping;
          if(new URL(context.url).pathname==='/web/modifyCategory'){
            const expected={url:context.url,account:scope.account,platform:'shein'};
            mapping=await category.mapDxmNativeCategories({page:context.page,poll:lib.poll,point:locator=>point(context.page,lib,args,expected,locator),expected,scope,rows:args.rows,baseline,beforeCategorySubmit:args.beforeCategorySubmit,isStopped:args.isStopped,onProgress:args.onProgress});
            if(mapping.status!=='submitted-for-readback')throw new Error(mapping.issues?.join('；')||'分类及变种对应尚未完成');
            context=await session.nextPage(context.page,['/web/sheinProduct/batchEdit']);
          }
          context.expected={url:context.url,account:scope.account,scope};
          const snapshot=await lib.poll(()=>context.page.evaluate(native.readNativeEditor,context.expected),{timeout:30000,label:'原生批量编辑表单'});
          const prices=validateNativeBatchOriginalPrices(snapshot,{scope,originalPrices:baseline.rows.map(row=>({draftId:row.draftId,goodsId:row.goodsId,evidence:row.originalPriceEvidence}))});
          if(!prices.ready)throw new Error(prices.issues.join('；'));
          if(mapping){
            const check=category.verifyNativeCategoryReadback({snapshot,scope,rows:args.rows,mapping});
            if(!check.ready)throw new Error(check.issues.join('；'));
            await args.onCategoryReadback?.({readOnly:true,phase:'native-batch-editor',scopeKey:scope.scopeKey,rows:check.rows});
          }
          return context;
        },
        complete:async(context,scope)=>{
          const read=async()=>{
            if(native.ensureNativeChoiceOptions)await native.ensureNativeChoiceOptions({page:context.page,expected:context.expected,poll:lib.poll,isStopped:args.isStopped});
            const snapshot=await context.page.evaluate(native.readNativeEditor,context.expected);
            const prices=validateNativeBatchOriginalPrices(snapshot,{scope,originalPrices:baseline.rows.map(row=>({draftId:row.draftId,goodsId:row.goodsId,evidence:row.originalPriceEvidence}))});
            if(!prices.ready)throw new Error(prices.issues.join('；'));
            return snapshot;
          };
          return completeNativeBatchFields({read,apply:plan=>native.applyNativeWrites({page:context.page,expected:context.expected,plan,poll:lib.poll,isStopped:args.isStopped}),scope,targetLanguage:args.storeBinding.contentLanguage||args.templateSnapshot.rules.targetLanguage,allowOrdinaryDefaults:true,fillOptional:true,isStopped:args.isStopped,onProgress:args.onProgress});
        },
        save:async(context,completed,beforeDispatch)=>{
          const check=async()=>{
            stop(args);const live=await context.page.evaluate(native.readNativeEditor,context.expected),state=captureNativeBatchFieldState(live,{scope:context.expected.scope});
            if(!state.ready||state.stateKey!==completed.expectedSnapshot.stateKey)throw new Error('保存前批量成员、属性、价格或变种发生变化');
          };
          await dispatchDxmNativeSave({page:context.page,poll:lib.poll,expected:context.expected,isStopped:args.isStopped,beforeDispatch:async()=>{await check();await beforeDispatch();await check();}});
        },
        verify:(row,preparationIntent)=>verifyNativeBatchMember({...args,row,preparationIntent,verifyPending:false})
      });
    });
  }
  function unsupportedNative(args,message){
    return {status:'needs-review',ready:false,issues:[message],rows:(args.rows||[]).map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,platformEditUrl:row.platformEditUrl,status:'needs-review',saved:false,ready:false,movedToPending:false,published:false,submitted:false,publicationNotSubmitted:true,issues:[message]}))};
  }
  // The observed native grid does not expose ordinary category attributes.
  // Keep full native processing unavailable until that coverage is verified;
  // do not substitute a loop of single-product saves behind this capability.
  return {inspect,readCategories,searchCategories,prepare,prepareBatch,verify,verifyNativeBatchMember,moveToPending,moveToPendingBatch,verifyPublication,openNativeBatch,capabilities:{platforms:Object.keys(routes),publish:false,moveToPending:true,verifyPublication:true,categorySearchPlatforms:['shein'],nativeOpenPlatforms:['shein'],nativePrepare:false,nativeSave:false,nativePending:false,nativeMoveToPending:false}};
}
