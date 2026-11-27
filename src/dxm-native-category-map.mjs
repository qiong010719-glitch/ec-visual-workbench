import {isDeepStrictEqual} from 'node:util';
import {nativeBatchScope} from './dxm-native-batch.mjs';
import {applyDxmSearchedCategory,categoryPathMatches} from './dxm-category-browser.mjs';
import {isPriceField,validateExistingDxmPrices} from './listing-field-policy.mjs';

export const NATIVE_CATEGORY_POLICY='native-category-map-v1';
const clone=value=>structuredClone(value),tidy=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const identity=row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId});
const unique=values=>[...new Set(values)],same=(a,b)=>isDeepStrictEqual(a,b);
const stop=fn=>{if(fn?.())throw new Error('已暂停原生分类对应，页面与提交记录已保留');};
function checkedScope(input){const scope=nativeBatchScope(input);if(input?.scopeKey&&input.scopeKey!==scope.scopeKey)throw new Error('原生分类范围已变化');return scope;}
function mapUrl(value,scope){try{const url=new URL(value),ids=url.searchParams.get('ids')?.split(',').filter(Boolean).sort();return url.origin==='https://www.dianxiaomi.com'&&url.pathname==='/web/modifyCategory'&&!url.username&&!url.password&&!url.hash&&url.searchParams.get('platform')==='shein'&&url.searchParams.get('type')==='1'&&same(ids,scope.rows.map(row=>row.draftId).sort());}catch{return false;}}
const sourcePath=row=>row.categoryResolution?.product?.sourcePath||row.productTypeConfirmation?.sourcePath||row.sourceFacts?.categoryPath||[];
function confirmedCategory(row){const category=row.categorySelection?.category;if(!category?.leaf||!Array.isArray(category.path)||category.path.length<2||!category.path.every(value=>typeof value==='string'&&tidy(value))||!(category.candidateId||category.platformCategoryId||category.id))throw new Error('本批商品缺少已经确认的完整目标分类');return category;}
function sameCategory(actual,expected){return !!actual&&categoryPathMatches(actual.path||[],expected.path||[])&&(!actual.platformCategoryId||!expected.platformCategoryId||String(actual.platformCategoryId)===String(expected.platformCategoryId));}
const axisAliases=new Map([['color','color'],['colour','color'],['颜色','color'],['色号','color'],['size','size'],['尺寸','size'],['尺码','size'],['style','style'],['款式','style'],['material','material'],['材质','material'],['capacity','capacity'],['容量','capacity'],['model','model'],['型号','model']]);
function axisName(value){const text=tidy(value),parts=text.match(/^(.*?)\s*\(([^()]*)\)$/);if(parts){const a=axisAliases.get(tidy(parts[1]).toLowerCase()),b=axisAliases.get(tidy(parts[2]).toLowerCase());if(a&&a===b)return a;}return axisAliases.get(text.toLowerCase())||text;}
function attributes(value,mapping=[]){if(!Array.isArray(value))return null;const result=value.map(item=>{const name=tidy(item.name),target=mapping.find(axis=>axisName(axis.source)===axisName(name));return {name:axisName(target?.target||name),value:tidy(item.value)};}).sort((a,b)=>a.name.localeCompare(b.name));return result.some(item=>!item.name||!item.value)||new Set(result.map(item=>item.name)).size!==result.length?null:result;}
function variantSet(value,mapping=[]){if(!Array.isArray(value)||!value.length)return null;const result=value.map(item=>({sku:tidy(item.sku),attributes:attributes(item.attributes||[],mapping)}));if(result.some(item=>!item.attributes||!item.sku&&!item.attributes.length&&result.length!==1))return null;const key=item=>JSON.stringify(item);if(new Set(result.map(key)).size!==result.length)return null;return result.sort((a,b)=>key(a).localeCompare(key(b)));}

// Rendered product-info and nested theme tables are from the public November
// 2026 modifyCategory components. No Vue state or business endpoint is read.
export function readDxmNativeCategoryMapPage({expected}={}){
  const tidy=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
  const controlText=value=>String(value??'').replace(/\s+/g,' ').trim();
  const visible=element=>{if(!element?.getClientRects().length)return false;for(let node=element;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.getAttribute('aria-hidden')==='true'||node.classList.contains('fixed--hidden')||style.display==='none'||style.visibility==='hidden')return false;}return true;};
  if(location.href!==expected?.url||location.origin!=='https://www.dianxiaomi.com'||location.pathname!=='/web/modifyCategory'||tidy(document.querySelector('.btn-user .user-name')?.textContent)!==expected.account)throw new Error('原生分类对应页面或账号已变化');
  const selector=element=>{if(element.id&&document.querySelectorAll('#'+CSS.escape(element.id)).length===1)return '#'+CSS.escape(element.id);const parts=[];for(let node=element;node&&node!==document.documentElement;node=node.parentElement){const tag=node.tagName.toLowerCase(),siblings=[...node.parentElement.children].filter(item=>item.tagName===node.tagName);parts.unshift(tag+':nth-of-type('+(siblings.indexOf(node)+1)+')');}return parts.join(' > ');};
  const loading=[...document.querySelectorAll('.ant-spin-spinning,.d-page-loading,.vxe-loading.is--visible')].some(visible);
  if(loading)return null;
  const infos=[...document.querySelectorAll('.table-container .product-info')].filter(visible),groups=[],issues=[];
  for(const info of infos){
    const row=info.closest('tr'),productCell=info.closest('td'),cells=row?[...row.children].filter(element=>element.tagName==='TD'&&visible(element)):[];
    if(!row||!productCell||!cells.length){issues.push('分类产品行结构未能核实');continue;}
    const outer=row.closest('.vxe-table'),headers=[...(outer||row.closest('table')).querySelectorAll('thead th[colid]')].filter(header=>visible(header)&&(!outer||header.closest('.vxe-table')===outer));
    const targetHeader=headers.filter(header=>tidy(header.innerText)==='SHEIN分类');
    const categoryCell=targetHeader.length===1?cells.find(cell=>cell.getAttribute('colid')===targetHeader[0].getAttribute('colid')):null;
    if(!categoryCell){issues.push('未定位唯一SHEIN分类列');continue;}
    const head=tidy(info.querySelector('.fw600')?.textContent),count=head.match(/^\((\d+)\)个\s*(.*)$/),title=tidy(info.querySelector('p')?.textContent),stores=[...info.innerText.matchAll(/「([^」]+)」/g)].map(match=>tidy(match[1]));
    const sourceText=tidy(info.querySelector('.max-w-120')?.textContent).replace(/^来源\s*[:：]\s*/,'');
    const sourceCategory=count?.[2]||'',sourceCategoryPath=sourceCategory&&sourceCategory!=='无分类'?sourceCategory.split(/\s+>\s+/).map(tidy):[];
    const controls=[...categoryCell.querySelectorAll('button,.link')].filter(node=>visible(node)&&['选择分类','更换分类'].includes(tidy(node.textContent)));
    const pathNodes=[...categoryCell.querySelectorAll('div.mt10')].filter(node=>visible(node)&&node.classList.contains('color-#a0a3a6')&&node.closest('tr')===row);
    const paths=uniqueText(pathNodes.map(node=>tidy(node.textContent)));
    const axes=[];
    for(const nested of [...categoryCell.querySelectorAll('tr')].filter(node=>visible(node)&&node.closest('thead')===null)){
      const nestedCells=[...nested.children].filter(cell=>cell.tagName==='TD'&&visible(cell));if(nestedCells.length!==2)continue;
      const boxes=[...nestedCells[1].querySelectorAll('select,.ant-select')].filter(visible);if(!boxes.length)continue;
      const box=boxes[0],input=box.tagName==='SELECT'?box:box.querySelector('[role="combobox"]'),selected=box.tagName==='SELECT'?[...box.selectedOptions].map(item=>tidy(item.textContent)):uniqueText([...box.querySelectorAll('.ant-select-selection-item')].map(item=>tidy(item.getAttribute('title')||item.textContent)));
      const target=selected.length===1&&!/^请选择/.test(selected[0])?selected[0]:'',options=[];
      if(box.tagName==='SELECT'){for(const option of box.options)if(visible(box))options.push({value:option.value,label:controlText(option.textContent),disabled:option.disabled,selector:selector(option),native:true});}
      else {
        const listId=input?.getAttribute('aria-controls')||input?.getAttribute('aria-owns'),list=listId&&document.getElementById(listId),dropdown=list?.closest('.ant-select-dropdown');
        // Ant's screen-reader listbox can be zero-sized; click the rendered
        // option instead. Its text is evidence, never a fabricated platform ID.
        const rendered=dropdown&&visible(dropdown)?[...dropdown.querySelectorAll('.ant-select-item-option')].filter(visible):[];
        const nodes=rendered.length?rendered:list&&visible(list)?[...list.querySelectorAll('[role="option"]')].filter(visible).filter(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;}):[];
        for(const option of nodes)options.push({value:option.getAttribute('data-value')||'',observedLabel:true,label:controlText(option.getAttribute('title')||option.getAttribute('aria-label')||option.querySelector('.ant-select-item-option-content')?.textContent||option.textContent),disabled:option.getAttribute('aria-disabled')==='true'||option.classList.contains('ant-select-item-option-disabled'),selector:selector(option)});
      }
      const radios=[...nestedCells[1].querySelectorAll('input[type="radio"]')].filter(node=>visible(node.closest('label')||node));
      axes.push({source:tidy(nestedCells[0].innerText),target,selector:selector(box),inputSelector:input?selector(input):null,native:box.tagName==='SELECT',disabled:box.disabled||box.classList.contains('ant-select-disabled')||input?.disabled||false,options,main:radios.some(input=>input.checked),mainControls:radios.map(input=>({checked:input.checked,disabled:input.disabled,selector:selector(input.closest('label')||input)}))});
    }
    const links=[...info.querySelectorAll('a[href]')].filter(visible).map(node=>node.href),draftIds=[],sourceUrls=[];
    for(const link of links){try{const url=new URL(link);if(url.origin===location.origin&&url.pathname==='/web/sheinProduct/edit'&&/^\d{6,32}$/.test(url.searchParams.get('id')||''))draftIds.push(url.searchParams.get('id'));if(url.protocol==='https:'&&['www.temu.com','temu.com'].includes(url.hostname)&&(/-g-\d{6,32}\.html$/.test(url.pathname)||url.pathname==='/goods.html'&&/^\d{6,32}$/.test(url.searchParams.get('goods_id')||'')))sourceUrls.push(link);}catch{}}
    groups.push({selector:selector(row),title,count:count?Number(count[1]):null,draftIds:uniqueText(draftIds),sourceUrls:uniqueText(sourceUrls),storeNames:uniqueText(stores),sourcePlatform:sourceText,sourceCategoryPath,categoryPath:paths.length===1?paths[0].split(/\s+>\s+/).map(tidy):[],categoryPathAmbiguous:paths.length>1,categoryControls:controls.map(node=>({selector:selector(node),text:tidy(node.textContent),disabled:node.disabled||node.getAttribute('aria-disabled')==='true'})),axes,errors:[...categoryCell.querySelectorAll('.theme-error,.ant-form-item-explain-error')].filter(visible).map(node=>tidy(node.innerText))});
  }
  function uniqueText(values){return [...new Set(values.filter(Boolean))];}
  const buttons=[...document.querySelectorAll('button')].filter(visible),save=buttons.filter(node=>/^保存[，,]\s*下一步$/.test(tidy(node.textContent))),expand=[...document.querySelectorAll('.expand-block')].filter(visible).filter(node=>/^\+\s*查看已对应的/.test(tidy(node.textContent))),dialogs=[...document.querySelectorAll('.ant-modal,[role="dialog"]')].filter(visible).filter(node=>!node.parentElement?.closest('.ant-modal,[role="dialog"]'));
  return {url:location.href,account:expected.account,groups,issues,expand:expand.map(node=>({selector:selector(node),text:controlText(node.textContent)})),save:save.map(node=>({selector:selector(node),text:controlText(node.textContent),disabled:node.disabled||node.getAttribute('aria-disabled')==='true'})),dialogs:dialogs.map(node=>tidy(node.innerText).slice(0,1000)),observedAt:new Date().toISOString()};
}

// Adds completeness evidence to readRequiredFields. The caller supplies only a
// fresh DOM field snapshot; every price value is read again before acceptance.
export function readDxmCategoryVariantEvidence({expected,fields}={}){
  const tidy=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim(),issues=[],priceIssues=[];
  const pricePattern=/(?:price|售价|价格|供货价|申报价|金额|单价|零售价|原价|特价|促销价|折扣价)/i,secret=/(?:password|passwd|secret|cookie|csrf|credential|authorization|token|api.?key|密码|密钥|令牌)/i;
  const visible=element=>{if(!element?.getClientRects().length)return false;for(let node=element;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.hasAttribute('inert')||node.getAttribute('aria-hidden')==='true'||node.classList.contains('fixed--hidden')||style.visibility==='hidden'||style.display==='none'||style.opacity==='0')return false;}return true;};
  const account=tidy(document.querySelector('.btn-user .user-name')?.textContent);
  if(location.href!==expected?.url||account!==expected.account||fields?.url!==location.href||fields?.account!==account)throw new Error('变种证据所属商品或账号已变化');
  const allFields=Array.isArray(fields.fields)?fields.fields:[],prices=allFields.filter(field=>pricePattern.test([field.name,field.id,field.label,field.priceSemantic].join(' '))),tables=new Map(),rows=new Map(),matched=new Map();
  const cellHeader=cell=>{
    if(!cell)return null;const table=cell.closest('table'),wrapper=table?.closest('.vxe-table'),colid=cell.getAttribute('colid');
    if(colid&&wrapper){const headers=[...wrapper.querySelectorAll('thead th[colid]')].filter(header=>header.getAttribute('colid')===colid&&header.closest('.vxe-table')===wrapper);if(headers.length===1)return headers[0];}
    const headers=[...table?.querySelectorAll('thead tr:last-child th')||[]].filter(header=>header.closest('table')===table);
    return headers.length===cell.parentElement?.cells?.length&&headers.every(header=>header.colSpan===1&&header.rowSpan===1)?headers[cell.cellIndex]:null;
  };
  const controlIsPrice=node=>{
    const own=[node.name,node.id,node.getAttribute('aria-label'),node.getAttribute('placeholder')].filter(Boolean).join(' ');
    // Only metadata is inspected for unavailable controls. Backend IDs and
    // credentials are never read, nor are their values returned as evidence.
    if(secret.test(own)||node.matches('input[type="password"],input[type="file"],input[type="submit"],input[type="button"],button'))return false;
    if(node.matches('input[type="hidden"]')&&!pricePattern.test(own))return false;
    const group=node.closest('.ant-form-item,.form-group,.control-group,.form-item'),label=group?.querySelector('.ant-form-item-label,.control-label,.form-label,legend'),linked=[...node.labels||[]].map(label=>label.textContent).join(' '),header=cellHeader(node.closest('td'));
    return pricePattern.test([own,label?.textContent,linked,header?.textContent].join(' '));
  };
  const rawControls=[...document.querySelectorAll('input,textarea,select,[role="combobox"]')];
  if(rawControls.length>2000)return {version:1,policy:'visible-sku-table-v1',url:location.href,account,complete:false,priceFieldsComplete:false,count:0,variants:[],observedPriceControls:0,matchedPriceControls:0,issues:['价格控件超过可完整核对的范围，未截断检查'],observedAt:new Date().toISOString()};
  const priceControls=rawControls.filter(controlIsPrice);
  for(const node of priceControls){const table=node.closest('table');if(table)tables.set(table,true);}
  if(!prices.length)issues.push('没有读取到SKU价格行，无法证明完整变种');
  for(const field of prices){
    let nodes=[];try{nodes=field.selector?[...document.querySelectorAll(field.selector)]:[];}catch{}
    if(nodes.length!==1||!visible(nodes[0])||!priceControls.includes(nodes[0])||nodes[0].disabled||nodes[0].readOnly||nodes[0].matches(':disabled')||nodes[0].getAttribute('aria-disabled')==='true'||nodes[0].closest('.ant-select-disabled')||nodes[0].matches('input[type="hidden"]')){priceIssues.push('价格快照对应的控件隐藏、禁用、只读或已改变，未确认完整价格');continue;}
    if(matched.has(nodes[0])||tidy(nodes[0].value)!==tidy(field.value)||String(nodes[0].name||'')!==String(field.name||'')){priceIssues.push('价格表单已变化或重复，未使用旧变种证据');continue;}
    matched.set(nodes[0],field);
    const node=nodes[0],row=node.closest('tr'),table=row?.closest('table'),key=tidy(field.rowIdentity?.sku)||JSON.stringify(field.rowIdentity?.attributes||[]);
    // Product-level amounts still participate in price coverage, but cannot
    // stand in for a missing SKU table or its complete row identities.
    if(!row||!table)continue;
    if(!field.rowIdentity||key==='[]'&&!field.rowIdentity.id){issues.push('SKU行缺少可核对规格身份');continue;}
    const old=rows.get(row);if(old&&JSON.stringify(old.identity)!==JSON.stringify(field.rowIdentity)){issues.push('同一SKU价格行返回了冲突身份');continue;}
    rows.set(row,{identity:field.rowIdentity,table});tables.set(table,true);
  }
  for(const node of priceControls){
    if(!visible(node)||node.matches('input[type="hidden"]'))priceIssues.push('存在隐藏的价格控件，未读取其值且不能确认完整价格范围');
    else if(node.disabled||node.matches(':disabled')||node.getAttribute('aria-disabled')==='true'||node.closest('.ant-select-disabled'))priceIssues.push('存在被禁用的价格控件，当前字段快照未完整核对');
    else if(node.readOnly||node.getAttribute('aria-readonly')==='true')priceIssues.push('存在只读价格控件，当前字段快照未完整核对');
    else if(!matched.has(node))priceIssues.push('存在未纳入实际字段快照的价格控件，未确认完整价格范围');
  }
  // Discover read-only price columns as well as tables that contain no usable
  // inputs at all. An omitted text cell must not silently disappear from proof.
  for(const table of document.querySelectorAll('table')){
    const headers=[...table.querySelectorAll('thead th')].filter(header=>header.closest('table')===table);
    if(headers.some(header=>pricePattern.test(header.textContent)))tables.set(table,true);
  }
  for(const table of tables.keys()){
    const wrapper=table.closest('.vxe-grid,.ant-table-wrapper,.ant-form-item,.form-group')||table.closest('.vxe-table')?.parentElement||table.parentElement;
    const virtual=[wrapper,...wrapper?.querySelectorAll('.vxe-table,.vxe-table--y-space,.ant-table-tbody-virtual,[aria-rowcount]')||[]].filter(Boolean).some(node=>/is--virtual|virtual--|virtual-scroll/.test(node.className||'')||node.matches('.ant-table-tbody-virtual')||node.matches('.vxe-table--y-space')&&visible(node)&&node.getBoundingClientRect().height>0);
    const controls=[...wrapper?.querySelectorAll('.ant-pagination,.vxe-pager,.pagination,nav[aria-label*="pagination" i],nav[aria-label*="分页"]')||[]].filter(visible);
    const actualRows=[...table.querySelectorAll('tbody > tr')].filter(row=>row.closest('table')===table&&!row.classList.contains('vxe-body--expanded-row')&&!row.classList.contains('ant-table-measure-row'));
    const totalNodes=[table,...wrapper?.querySelectorAll('[aria-rowcount]')||[]].filter(node=>node.hasAttribute('aria-rowcount')),headerRows=table.tHead?.rows.length||0;
    if(virtual||controls.length||totalNodes.some(node=>!/^\d+$/.test(node.getAttribute('aria-rowcount'))||Number(node.getAttribute('aria-rowcount'))!==actualRows.length+headerRows)){issues.push('SKU表使用虚拟滚动、分页或声明行数不完整，尚未证明完整变种范围');priceIssues.push('SKU行范围不完整，不能确认全部SKU价格');}
    if(!actualRows.length||actualRows.some(row=>!visible(row)||!rows.has(row))){issues.push('SKU表存在未核对、隐藏或缺少价格的变种行');priceIssues.push('部分SKU行的价格没有被实际读取');}
    for(const row of actualRows)for(const cell of row.cells){
      const header=cellHeader(cell);if(!header||!pricePattern.test(header.textContent))continue;
      const controls=[...cell.querySelectorAll('input,textarea,select,[role="combobox"]')].filter(controlIsPrice);
      if(!controls.length||controls.some(node=>!matched.has(node))){priceIssues.push('实际价格列含未核对的文本或控件，不能只核对同一SKU的其他价格');}
    }
  }
  const variants=[...rows.values()].map(({identity})=>({sku:tidy(identity.sku),attributes:Array.isArray(identity.attributes)?identity.attributes.map(item=>({name:tidy(item.name),value:tidy(item.value)})):[],rowId:tidy(identity.id)}));
  if(!variants.length)issues.push('没有完整SKU行证据');
  if(variants.some(variant=>!variant.sku&&!variant.attributes.length)&&variants.length!==1)issues.push('多个SKU缺少稳定货号或完整规格，无法核对是否丢失');
  if(new Set(variants.map(item=>JSON.stringify({sku:item.sku,attributes:item.attributes}))).size!==variants.length)issues.push('SKU规格身份重复，无法证明一一对应');
  if(!priceControls.length)priceIssues.push('没有实际价格控件可供完整核对');
  issues.push(...priceIssues);
  return {version:1,policy:'visible-sku-table-v1',url:location.href,account,complete:!issues.length,priceFieldsComplete:!priceIssues.length,observedPriceControls:priceControls.length,matchedPriceControls:matched.size,count:variants.length,variants,issues:[...new Set(issues)],observedAt:new Date().toISOString()};
}

function baselineMember(value,row,scope){
  const item=value?.rows?.find(item=>item.draftId===row.draftId),editor=item?.editor,fields=item?.fields,evidence=item?.variantEvidence||fields?.variantEvidence;
  if(!item||Object.entries(identity(row)).some(([key,value])=>item[key]!==value)||item.sourceUrl!==row.sourceUrl||editor?.url!==row.platformEditUrl||fields?.url!==row.platformEditUrl||editor.account!==scope.account||fields.account!==scope.account||editor.storeName!==scope.storeBinding.storeName||!Array.isArray(editor.sources)||!editor.sources.includes(row.sourceUrl)||editor.sources.some(value=>value!==row.sourceUrl))throw new Error('分类保存前缺少本商品与店铺一致的只读基线');
  if(evidence?.policy!=='visible-sku-table-v1'||evidence.complete!==true||evidence.priceFieldsComplete!==true||evidence.url!==row.platformEditUrl||evidence.account!==scope.account||evidence.issues?.length||evidence.count!==evidence.variants?.length||!variantSet(evidence.variants))throw new Error('分类保存前尚未证明完整变种，未保存下一步');
  const priceRows=(fields.fields||[]).filter(isPriceField).map(field=>({sku:tidy(field.rowIdentity?.sku),attributes:field.rowIdentity?.attributes||[]}));
  if(evidence.variants.some(variant=>!priceRows.some(price=>same(variantSet([price]),variantSet([variant])))))throw new Error('变种证据与实际价格行不一致');
  const originalPriceEvidence=item.originalPriceEvidence,prices=validateExistingDxmPrices(fields,originalPriceEvidence,{platform:'shein',goodsId:row.goodsId});
  if(!prices.ready||originalPriceEvidence?.ready!==true)throw new Error('分类保存前缺少一致的店小秘原有价格基线：'+prices.issues.join('；'));
  return {version:1,policy:NATIVE_CATEGORY_POLICY,scopeKey:scope.scopeKey,scope:clone(scope),...identity(row),sourceUrl:row.sourceUrl,platformEditUrl:row.platformEditUrl,account:scope.account,storeName:scope.storeBinding.storeName,site:scope.storeBinding.site,category:clone(confirmedCategory(row)),variants:clone(evidence.variants),variantCount:evidence.count,variantEvidence:clone(evidence),originalPriceEvidence:clone(originalPriceEvidence),axisMapping:[]};
}

export function nativeCategoryMapReadiness(snapshot,input,rows,{requireMapped=false}={}){
  const scope=checkedScope(input),issues=[],bindings=[];
  if(!snapshot||!mapUrl(snapshot.url,scope)||snapshot.account!==scope.account)return {ready:false,bindings,issues:['原生分类对应地址、账号或完整商品编号不匹配']};
  if(!Array.isArray(rows)||rows.length!==scope.rows.length||rows.some(row=>!scope.rows.some(member=>member.draftId===row.draftId&&member.goodsId===row.goodsId&&member.sourceUrl===row.sourceUrl)||row.storeBindingKey!==scope.storeBinding.key)||new Set(rows.map(row=>row.draftId)).size!==rows.length)return {ready:false,bindings,issues:['原生分类对应成员与持久化任务不一致']};
  issues.push(...snapshot.issues);if(snapshot.dialogs.length)issues.push('分类弹窗尚未关闭，不能核对本批对应结果');if(snapshot.expand.length)issues.push('已对应商品仍折叠，尚未核对完整范围');
  if(snapshot.save.length!==1||snapshot.save[0].disabled)issues.push('没有唯一可用的保存下一步按钮');
  const used=new Set();
  for(const group of snapshot.groups){
    if(!Number.isSafeInteger(group.count)||group.count<1||group.storeNames.length!==1||group.storeNames[0]!==scope.storeBinding.storeName||!/^temu(?:\s*特姆)?$/i.test(group.sourcePlatform)){issues.push('分类分组数量、来源平台或店铺尚未核实');continue;}
    let matches;
    if(group.draftIds?.length===group.count)matches=rows.filter(row=>group.draftIds.includes(row.draftId)&&(!group.sourceUrls.length||group.sourceUrls.includes(row.sourceUrl)));
    else if(group.sourceUrls?.length===group.count)matches=rows.filter(row=>group.sourceUrls.includes(row.sourceUrl));
    else if(snapshot.groups.length===1&&group.count===rows.length)matches=rows;
    else matches=rows.filter(row=>sourcePath(row).length>1&&categoryPathMatches(group.sourceCategoryPath,sourcePath(row)));
    if(matches.length!==group.count||!matches.some(row=>tidy(row.title)===group.title)||matches.some(row=>used.has(row.draftId))){issues.push('分类分组无法唯一对应本批完整成员，未按行序或数量猜测');continue;}
    const categories=matches.map(confirmedCategory),first=categories[0];
    if(categories.some(category=>!sameCategory(category,first)))issues.push('同一原生来源分组包含不同目标分类，不能整体套用');
    if(matches.length>1){const type=matches[0].productTypeConfirmation;if(!type?.productType||!Number.isFinite(Date.parse(type.confirmedAt))||matches.some(row=>row.productTypeConfirmation?.productType!==type.productType||!same(row.productTypeConfirmation.sourcePath,sourcePath(row))||!same(sourcePath(row),sourcePath(matches[0]))))issues.push('原生多商品分组缺少相同具体类型及完整来源分类确认');}
    for(const row of matches)used.add(row.draftId);
    if(group.categoryPathAmbiguous)issues.push('分类分组的目标路径不唯一');
    if(requireMapped){
      if(!categoryPathMatches(group.categoryPath,first.path))issues.push('分类分组尚未读回已确认的完整目标路径');
      if(group.axes.some(axis=>!axis.source||!axis.target||axisName(axis.source)!==axisName(axis.target)))issues.push('来源变种轴尚未对应真实目标变种轴');
      if(group.axes.length&&new Set(group.axes.map(axis=>axisName(axis.target))).size!==group.axes.length)issues.push('多个来源变种轴指向同一目标轴');
      const eligible=group.axes.flatMap(axis=>axis.mainControls);if(eligible.length&&eligible.filter(radio=>radio.checked).length!==1)issues.push('原生分类缺少唯一主规格');
      issues.push(...group.errors);
    }
    bindings.push({group,rows:matches,category:first});
  }
  if(used.size!==rows.length||snapshot.groups.reduce((sum,group)=>sum+(group.count||0),0)!==rows.length)issues.push('原生分类页面未完整且仅包含本批商品');
  return {ready:!issues.length,bindings,issues:unique(issues)};
}

// Uses only selectors emitted by the current DOM reader. Native select updates
// dispatch the same ordinary input/change events as a selected visible option.
export function setDxmNativeCategoryAxis({expected,selector,value,label}={}){
  if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('变种对应页面或账号已变化');
  const nodes=[...document.querySelectorAll(selector)].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
  if(nodes.length!==1||nodes[0].tagName!=='SELECT'||nodes[0].disabled)throw new Error('变种对应控件不唯一或不可用');
  const node=nodes[0],options=[...node.options].filter(option=>!option.disabled&&option.value===value&&option.textContent.trim()===label);
  if(options.length!==1)throw new Error('变种对应选项已变化');
  const previous=node.value;if(previous&&!/^请选择/.test(node.selectedOptions[0]?.textContent.trim()||''))throw new Error('变种对应已填写，未覆盖');node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return {previous,value:node.value};
}

export async function mapDxmNativeCategories({page,poll,point,expected,scope:input,rows,baseline,beforeCategorySubmit,isStopped,onProgress,applyCategory=applyDxmSearchedCategory}={}){
  const scope=checkedScope(input),result={status:'needs-review',scopeKey:scope.scopeKey,rows:[],issues:[],retainPage:true};let committed=false;
  const read=()=>page.evaluate(readDxmNativeCategoryMapPage,{expected});
  const check=async requireMapped=>{stop(isStopped);const snapshot=await poll(read,{timeout:30000,label:'原生分类分组'}),ready=nativeCategoryMapReadiness(snapshot,scope,rows,{requireMapped});if(!ready.ready)throw new Error(ready.issues.join('；'));return {snapshot,...ready};};
  try{
    if(typeof point!=='function'||typeof beforeCategorySubmit!=='function')throw new Error('缺少原生控件操作或分类保存前的持久化回调');
    if(rows.some(row=>row.nativeCategoryIntent))throw new Error('已有分类提交记录，只能在原生编辑页核对，不得再次保存下一步');
    if(!mapUrl(expected?.url,scope)||expected.account!==scope.account)throw new Error('分类对应范围与当前页不一致');
    const locked=rows.map(row=>baselineMember(baseline,row,scope));
    let initial=await poll(read,{timeout:30000,label:'原生分类对应页'});
    if(initial.expand.length){if(initial.expand.length!==1||initial.dialogs.length)throw new Error('已对应分组无法唯一展开');stop(isStopped);await point(initial.expand[0]);initial=await poll(async()=>{const value=await read();return value&&!value.expand.length?value:null;},{timeout:10000,label:'展开已对应商品'});}
    let checked=await check(false);
    for(const binding of checked.bindings){
      stop(isStopped);let current=(await check(false)).bindings.find(item=>same(item.rows.map(row=>row.draftId).sort(),binding.rows.map(row=>row.draftId).sort()));
      if(!current)throw new Error('分类分组成员已变化');
      if(!categoryPathMatches(current.group.categoryPath,current.category.path)){
        const controls=current.group.categoryControls.filter(control=>!control.disabled);if(controls.length!==1)throw new Error('没有唯一可用的本组分类选择按钮');
        await point(controls[0]);stop(isStopped);
        await applyCategory({page,poll,point,expected,query:current.rows[0].categorySelection.searchQuery,category:current.category,isStopped});
        await poll(async()=>{const snapshot=await read();return snapshot&&snapshot.groups.some(group=>group.selector===current.group.selector&&categoryPathMatches(group.categoryPath,current.category.path))?snapshot:null;},{timeout:30000,label:'目标分类完整路径回读'});
      }
      let mapped=(await check(false)).bindings.find(item=>item.group.selector===current.group.selector);
      for(const axis of mapped.group.axes){
        if(axis.target){if(axisName(axis.target)!==axisName(axis.source))throw new Error('已有变种对应与来源轴不一致，未覆盖');continue;}
        if(axis.disabled)throw new Error('来源变种轴尚未对应且控件不可用');
        if(!axis.native)await point({selector:axis.selector});stop(isStopped);
        const opened=await poll(async()=>{const state=await read(),group=state?.groups.find(group=>group.selector===mapped.group.selector);return group?.axes.find(item=>item.source===axis.source&&item.options.length);},{timeout:10000,label:'实际变种轴选项'});
        const options=opened.options.filter(option=>!option.disabled&&(option.value||option.observedLabel)&&axisName(option.label)===axisName(axis.source));if(options.length!==1)throw new Error('来源变种轴没有唯一且相同含义的真实选项');
        const latest=(await check(false)).bindings.find(item=>item.group.selector===mapped.group.selector)?.group.axes.find(item=>item.source===axis.source);if(!latest||latest.target)throw new Error('变种对应状态已变化，未覆盖');stop(isStopped);
        if(opened.native)await page.evaluate(setDxmNativeCategoryAxis,{expected,selector:opened.selector,value:options[0].value,label:options[0].label});else await point({selector:options[0].selector,text:options[0].label});
        await poll(async()=>{const state=await read(),group=state?.groups.find(group=>group.selector===mapped.group.selector);return group?.axes.find(item=>item.source===axis.source&&axisName(item.target)===axisName(axis.source));},{timeout:10000,label:'变种对应回读'});
      }
      mapped=(await check(false)).bindings.find(item=>item.group.selector===current.group.selector);
      const radios=mapped.group.axes.flatMap(axis=>axis.mainControls);if(radios.length&&!radios.some(radio=>radio.checked)){const choices=radios.filter(radio=>!radio.disabled);if(choices.length!==1)throw new Error('存在多个可能的主规格，需要明确选择');stop(isStopped);await point({selector:choices[0].selector});}
      await onProgress?.({phase:'native-category-map',members:current.rows.length,message:'已对应本组分类与原有变种轴，尚未保存'});
    }
    checked=await check(true);
    for(const member of locked){const binding=checked.bindings.find(item=>item.rows.some(row=>row.draftId===member.draftId));member.axisMapping=binding.group.axes.map(axis=>({source:axis.source,target:axis.target,main:axis.main}));const names=unique(member.variants.flatMap(variant=>variant.attributes.map(attribute=>axisName(attribute.name))));if(names.some(name=>!member.axisMapping.some(axis=>axisName(axis.source)===name))||member.axisMapping.some(axis=>!names.includes(axisName(axis.source))))throw new Error('来源完整规格与分类对应表中的变种轴不一致，未保存下一步');}
    result.rows=rows.map(row=>({...identity(row),category:clone(confirmedCategory(row)),expectedSnapshot:locked.find(item=>item.draftId===row.draftId)}));
    const payload={scopeKey:scope.scopeKey,rows:result.rows.map(member=>{const row=rows.find(row=>row.id===member.id);return {...identity(row),payload:{url:expected.url,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,sourceUrl:row.sourceUrl,category:clone(member.category),expectedSnapshot:clone(member.expectedSnapshot)}};})};
    stop(isStopped);await beforeCategorySubmit(clone(payload));committed=true;stop(isStopped);
    const last=await check(true);if(!same(last.snapshot.groups,checked.snapshot.groups)||!same(last.snapshot.save,checked.snapshot.save))throw new Error('分类提交记录后页面发生变化，未点击保存下一步');
    await point(last.snapshot.save[0]);result.status='submitted-for-readback';result.retainPage=true;return result;
  }catch(error){result.issues=[String(error.message||error)];result.submissionRecorded=committed;return result;}
}

function receipt(row,expected){return {...identity(row),platformEditUrl:row.platformEditUrl,category:clone(expected.category),categoryConfirmed:true,variantsPreserved:true,sourceUrl:expected.sourceUrl,readOnly:true};}
function memberIssues(member,expected){const issues=[];if(!member||member.draftId!==expected.draftId||member.goodsId!==expected.goodsId||member.sourceUrl!==expected.sourceUrl||member.storeName!==expected.storeName)issues.push('分类回读的商品、来源或店铺不一致');if(!sameCategory(member?.category,expected.category))issues.push('分类回读未找到已确认的完整目标路径');const actual=variantSet(member?.variants),before=variantSet(expected.variants,expected.axisMapping);if(!actual||!before||!same(actual,before)||member?.variants?.length!==expected.variantCount)issues.push('完整SKU规格数量或内容与分类保存前不一致，不能确认变种保留');return issues;}

export function verifyNativeCategoryReadback({snapshot,scope:input,rows,mapping}={}){
  const scope=checkedScope(input),issues=[],receipts=[];
  if(mapping?.scopeKey!==scope.scopeKey||snapshot?.account!==scope.account||snapshot?.scopeKey&&snapshot.scopeKey!==scope.scopeKey||!Array.isArray(snapshot?.members)||snapshot.members.length!==scope.rows.length||new Set(snapshot.members.map(member=>member.draftId)).size!==scope.rows.length)issues.push('分类保存后原生编辑页未完整回读本批成员');
  issues.push(...(snapshot?.issues||[]));
  try{const url=new URL(snapshot.url),ids=url.searchParams.get('ids')?.split(',').filter(Boolean).sort();if(url.origin!=='https://www.dianxiaomi.com'||url.pathname!=='/web/sheinProduct/batchEdit'||!same(ids,scope.rows.map(row=>row.draftId).sort())||url.username||url.password||url.hash)issues.push('分类保存后没有进入本批原生编辑页面');}catch{issues.push('分类保存后原生编辑地址无效');}
  for(const row of rows||[]){const expected=mapping?.rows?.find(member=>member.draftId===row.draftId)?.expectedSnapshot;if(!expected||expected.policy!==NATIVE_CATEGORY_POLICY||expected.scopeKey!==scope.scopeKey||Object.entries(identity(row)).some(([key,value])=>expected[key]!==value)){issues.push('分类保存前的成员记录缺失或不匹配');continue;}issues.push(...memberIssues(snapshot?.members?.find(member=>member.draftId===row.draftId),expected));receipts.push(receipt(row,expected));}
  if(receipts.length!==scope.rows.length)issues.push('本批分类回读成员不完整');
  return {ready:!issues.length,readOnly:true,phase:'native-batch-editor',scopeKey:scope.scopeKey,rows:issues.length?[]:receipts,issues:unique(issues)};
}

// Restart recovery reads one independently opened editor. It confirms only the
// category write; it never promotes this receipt to a fully saved product.
export function verifyNativeCategoryMemberReadback({editor,fields,row,scope,nativeCategoryIntent}={}){
  const expected=nativeCategoryIntent?.expectedSnapshot,issues=[];
  const fail=message=>({status:'needs-review',readOnly:true,phase:'native-batch-editor',...identity(row),platformEditUrl:row.platformEditUrl,categoryConfirmed:false,variantsPreserved:false,issues:[message]});
  if(expected?.policy!==NATIVE_CATEGORY_POLICY||!scope?.scopeKey||scope.scopeKey!==expected.scopeKey||Object.entries(identity(row)).some(([key,value])=>expected[key]!==value)||!same(nativeCategoryIntent.category,expected.category)||nativeCategoryIntent.sourceUrl!==row.sourceUrl)return fail('分类提交记录或本批成员身份不一致');
  let nativeScope;try{nativeScope=checkedScope(expected.scope);}catch{return fail('原分类提交范围无法核实');}
  if(scope.rows?.length!==nativeScope.rows.length||nativeScope.rows.some(member=>!scope.rows.some(item=>item.draftId===member.draftId&&item.goodsId===member.goodsId&&item.sourceUrl===member.sourceUrl)))return fail('原生分类提交的整批成员范围已变化');
  if(editor?.url!==row.platformEditUrl||fields?.url!==row.platformEditUrl||editor.account!==expected.account||fields.account!==expected.account||editor.storeName!==expected.storeName||editor.sources?.length!==1||editor.sources[0]!==expected.sourceUrl)return fail('只读回读的编辑页、账号、店铺或来源不匹配');
  const evidence=fields.variantEvidence;if(evidence?.policy!=='visible-sku-table-v1'||!evidence.complete||evidence.priceFieldsComplete!==true||evidence.url!==editor.url||evidence.account!==editor.account||evidence.issues?.length||evidence.count!==evidence.variants?.length)return fail('只读回读尚未证明完整SKU范围，未确认分类提交');
  issues.push(...memberIssues({draftId:row.draftId,goodsId:row.goodsId,sourceUrl:editor.sources[0],storeName:editor.storeName,category:{path:editor.categoryPath},variants:evidence.variants},expected));
  issues.push(...validateExistingDxmPrices(fields,expected.originalPriceEvidence,{platform:'shein',goodsId:row.goodsId}).issues);
  if(issues.length)return fail(unique(issues).join('；'));
  return {status:'category-confirmed',phase:'native-batch-editor',scopeKey:expected.scopeKey,...receipt(row,expected),issues:[]};
}
