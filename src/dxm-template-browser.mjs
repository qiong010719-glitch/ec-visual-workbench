import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {temuGoodsId} from './geekbi.mjs';
import {readTemuListing,listingReadiness,readCategoryDialog,readTemplateCategoryPath,readPackageUnits} from './dxm-listing-prepare.mjs';
import {validateTemplateRules} from './listing-templates.mjs';
import {readRequiredFields,completeRequiredFields,planRequiredFields} from './dxm-required-fields.mjs';
import {readDxmCategoryCatalog,browseDxmCategoryCatalog,categoryPathMatches} from './dxm-category-browser.mjs';
import {sourcePriceContext,sourcePriceEvidence,verifySourcePriceEvidence,completeOrdinaryChoices} from './dxm-required-platform-browser.mjs';
import {validateExistingDxmPrices,isPriceField,SOURCE_PRICE_POLICY} from './listing-field-policy.mjs';
export {readDxmCategoryCatalog as readTemuCategoryCatalog};

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const listUrl='https://www.dianxiaomi.com/web/popTemu/pageList/draft';
const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const clean=value=>String(value||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
const selected=item=>[...(item?.selections||[]),...(item?.checked||[])].filter(Boolean);
const categoryValues=snapshot=>{const item=snapshot.items.find(item=>item.label==='产品分类');return [...selected(item),...(item?.controls||[]).map(control=>control.value)].filter(value=>String(value??'').trim());};
const siteKey=value=>String(value||'').replace(/站$/,'').trim();
const validEdit=value=>{try{const u=new URL(value);return u.origin==='https://www.dianxiaomi.com'&&u.pathname==='/web/popTemu/edit'&&/^\d{6,32}$/.test(u.searchParams.get('id')||'')&&!u.username&&!u.password&&!u.hash;}catch{return false;}};
const stopped=args=>{if(args.isStopped?.())throw new Error('已暂停，未继续操作下一项');};
const pageFingerprint=state=>state.rows.map(row=>String(row.draftId)).sort().join('|');

// Browser evaluations are serialized without their module scope. Embed this
// one selector implementation in both readers/actions so their rules agree.
function withTemplatePager(operation){
  return new Function(`return function ${operation.name}(arg){const readTemplatePager=${readTemplatePager.toString()};const templateEditControl=${templateEditControl.toString()};return (${operation.toString()})(arg);}`)();
}
function templateEditControl({expected,draftId,scroll=false}){
  if(!/^\d{6,32}$/.test(draftId)||location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('编辑按钮所在页面、账号或草稿编号不一致');
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none';
  const rows=[...document.querySelectorAll('tr.vxe-body--row[rowid]')].filter(row=>row.getAttribute('rowid')===draftId),shownRows=rows.filter(visible);
  const buttons=rows.flatMap(row=>[...row.querySelectorAll('button')].filter(button=>button.textContent.trim()==='编辑'));
  const eligible=buttons.filter(button=>visible(button)&&!button.closest('.fixed--hidden')&&!button.disabled&&button.getAttribute('aria-disabled')!=='true');
  if(scroll){
    // Scroll the main row so VXE can synchronize its fixed-column copies. A
    // hidden fixed-column cell is never a click target or a scroll anchor.
    const main=shownRows.find(row=>!row.closest('.vxe-table--fixed-left-wrapper,.vxe-table--fixed-right-wrapper'));
    (main||eligible[0])?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    // A wide non-fixed row can be visible while its right-hand action remains
    // outside the viewport. Bring only the unique eligible button into view;
    // leave vertical positioning to the main row so fixed copies can sync.
    if(eligible.length===1){
      const button=eligible[0],rect=button.getBoundingClientRect();let left=0,right=innerWidth;
      for(let ancestor=button.parentElement;ancestor&&ancestor!==document.documentElement;ancestor=ancestor.parentElement){
        if(!/hidden|auto|scroll|clip/.test(getComputedStyle(ancestor).overflowX))continue;
        const box=ancestor.getBoundingClientRect();left=Math.max(left,box.left+ancestor.clientLeft);right=Math.min(right,box.left+ancestor.clientLeft+ancestor.clientWidth);
      }
      if(rect.left<left||rect.right>right)button.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});
    }
  }
  const rectValue=rect=>({x:rect.x,y:rect.y,width:rect.width,height:rect.height}),hits=[],controls=[];
  for(const [index,button] of buttons.entries()){
    const rect=button.getBoundingClientRect();let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom);
    for(let ancestor=button.parentElement;ancestor&&ancestor!==document.documentElement;ancestor=ancestor.parentElement){
      const style=getComputedStyle(ancestor),box=ancestor.getBoundingClientRect();
      if(/hidden|auto|scroll|clip/.test(style.overflowX)){left=Math.max(left,box.left+ancestor.clientLeft);right=Math.min(right,box.left+ancestor.clientLeft+ancestor.clientWidth);}
      if(/hidden|auto|scroll|clip/.test(style.overflowY)){top=Math.max(top,box.top+ancestor.clientTop);bottom=Math.min(bottom,box.top+ancestor.clientTop+ancestor.clientHeight);}
    }
    let point=null,hit=null;
    if(eligible.includes(button)&&right-left>2&&bottom-top>2){
      for(const [fractionX,fractionY] of [[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75]]){
        const candidate={x:left+(right-left)*fractionX,y:top+(bottom-top)*fractionY},element=document.elementFromPoint(candidate.x,candidate.y);
        hit??=element;if(button.contains(element)){point=candidate;hit=element;break;}
      }
      if(point)hits.push({element:button,point,bounds:rectValue(rect),targetKey:draftId+':编辑'});
    }
    if(controls.length<8)controls.push({index,visible:visible(button),fixedHidden:!!button.closest('.fixed--hidden'),disabled:!!button.disabled,focused:document.activeElement===button,ariaDisabled:button.getAttribute('aria-disabled'),className:String(button.className||'').slice(0,120),bounds:rectValue(rect),clipped:{x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)},hittable:!!point,hitTag:hit?.tagName||null,hitClassName:String(hit?.className||'').slice(0,120)});
  }
  const diagnostics={draftId,pagePath:location.pathname,documentHasFocus:document.hasFocus(),visibilityState:document.visibilityState,viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},rowCopies:rows.length,visibleRowCopies:shownRows.length,buttonCount:buttons.length,eligibleButtonCount:eligible.length,hitCount:hits.length,controls};
  if(hits.length>1)throw Object.assign(new Error('同一草稿存在多个可点击编辑入口，未猜测点击'),{data:{editDiagnostics:diagnostics}});
  const found=hits[0];return {hit:found?{point:found.point,bounds:found.bounds,targetKey:found.targetKey}:null,element:found?.element,diagnostics};
}

export const readTemplateEditDiagnostics=withTemplatePager(function readTemplateEditDiagnostics(args){return templateEditControl(args).diagnostics;});
export function templateHitIsStable(first,second){
  return !!first&&!!second&&first.targetKey===second.targetKey&&['x','y'].every(key=>Number.isFinite(first.point?.[key])&&Number.isFinite(second.point?.[key])&&Math.abs(first.point[key]-second.point[key])<=1)&&['x','y','width','height'].every(key=>Number.isFinite(first.bounds?.[key])&&Number.isFinite(second.bounds?.[key])&&Math.abs(first.bounds[key]-second.bounds[key])<=1);
}
function readTemplatePager(){
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none';
  const roots=[...document.querySelectorAll('.vxe-pager,.ant-pagination')].filter(visible),groups=[],diagnosticInputs=[];
  const numeric=input=>/^[1-9]\d*$/.test(input.value.trim())&&Number.isSafeInteger(Number(input.value.trim()));
  const pageSize=input=>!!input.closest('.vxe-pager--sizes,.vxe-pager--size,.vxe-select,.ant-select,.ant-pagination-options-size-changer')||input.getAttribute('role')==='combobox'||/page[\s_-]*size|size[\s_-]*page|每页|页大小|分页大小/i.test([input.name,input.id,input.className,input.title,input.getAttribute('aria-label')].join(' '));
  roots.forEach((root,pagerIndex)=>{
    const visibleInputs=[...root.querySelectorAll('input')].filter(input=>visible(input)&&input.closest('.vxe-pager,.ant-pagination')===root);
    const eligible=visibleInputs.filter(input=>['text','number','tel','search'].includes(input.type)&&!pageSize(input));
    const named=eligible.filter(input=>input.getAttribute('aria-label')?.trim()==='页数'||input.title.trim()==='页数');
    const candidates=named.length?named:eligible.filter(numeric),input=candidates.length===1?candidates[0]:null;
    const active=root.querySelector('.ant-pagination-item-active,.vxe-pager--num-btn.is--active');
    const activeValue=active&&visible(active)?active.textContent.trim():'';
    groups.push({root,input,candidateCount:candidates.length,currentPage:input&&numeric(input)?Number(input.value.trim()):null,activePage:/^[1-9]\d*$/.test(activeValue)?Number(activeValue):null});
    for(const control of visibleInputs){
      if(diagnosticInputs.length>=10)break;
      const bounded=value=>String(value||'').slice(0,120);
      diagnosticInputs.push({pagerIndex,type:bounded(control.type),title:bounded(control.title),ariaLabel:bounded(control.getAttribute('aria-label')),className:bounded(control.className),value:['text','number','tel','search'].includes(control.type)?bounded(control.value):'[redacted]',selected:control===input,pageSize:pageSize(control)});
    }
  });
  const inputs=groups.flatMap(group=>group.input?[group.input]:[]),pageNumbers=groups.filter(group=>group.input).map(group=>group.currentPage),selectionIssues=[];
  if(groups.some(group=>group.candidateCount>1))selectionIssues.push('分页区域存在多个页码候选输入框');
  if(inputs.length&&inputs.length!==groups.length)selectionIssues.push('每个分页区域必须各有一个可核对的页码输入框');
  const currentPage=inputs.length&&inputs.length===groups.length&&!selectionIssues.length&&pageNumbers.every(value=>Number.isSafeInteger(value)&&value>0)&&new Set(pageNumbers).size===1?pageNumbers[0]:null;
  return {groups,inputs,pageNumbers,currentPage,selectionIssues,diagnostics:{pagerCount:roots.length,pageInputCount:inputs.length,selectionIssues,documentHasFocus:document.hasFocus(),activeElementIsPageInput:inputs.includes(document.activeElement),inputs:diagnosticInputs}};
}

function pagerFailure(error,state,current=state,targetPage=null){
  error.data={...(error.data||{}),pagerDiagnostics:{...(current?.pagerDiagnostics||state?.pagerDiagnostics||{}),initialPage:state?.currentPage??null,currentPage:current?.currentPage??null,targetPage}};
  return error;
}

export function templateRules(template,binding={}){
  const attributes=new Map(),issues=[];
  let categoryMode='match',saveMode='ready',packageDefaults=null,inventory=null,autoFillRequired=false;
  for(const input of [template?.rules||{},binding.overrides||{}]){
    let rules;try{rules=validateTemplateRules(input);}catch(error){issues.push(error.message);continue;}
    for(const [name,value] of Object.entries(rules)){
      if(name==='attributes'){
        const entries=Array.isArray(value)?value.map(item=>[item?.label,item?.value]):value&&typeof value==='object'?Object.entries(value):null;
        if(!entries){issues.push('产品属性规则格式无效');continue;}
        for(const [label,entry] of entries){
          if(typeof label!=='string'||!clean(label)||typeof entry!=='string'||!entry.trim())issues.push('产品属性须填写明确的标签和值');
          else if(/密码|密钥|token|password|secret|cookie/i.test(label))issues.push('产品属性不能包含账号凭据');
          else attributes.set(clean(label),entry.trim());
        }
      }else if(name==='categoryMode')categoryMode=value;
      else if(name==='saveMode')saveMode=value;
      else if(name==='packageDefaults')packageDefaults=value;
      else if(name==='inventory')inventory=value.mode==='fixed'?value:null;
      else if(name==='autoFillRequired')autoFillRequired=value;
      else if(['title','pricing'].includes(name)&&(value==='preserve'||value?.mode==='preserve'))continue;
      else issues.push(`尚未接入填写规则：${name}`);
    }
  }
  return {category:template?.category||{path:[]},categoryMode,saveMode,packageDefaults,inventory,autoFillRequired,attributes:[...attributes].map(([label,value])=>({label,value})),issues};
}

const packageFieldNames=['skuLength','skuWidth','skuHeight','weight'];
export function templateSkuPlan(snapshot,rules,binding,units){
  const values={},issues=[],skus=snapshot.fields.variationSku||[];
  if(rules.packageDefaults){
    if(units?.dimension!=='cm'||!['kg','g'].includes(units?.weight))issues.push('无法确认包装尺寸和重量单位，未填写包装默认值');
    else {const p=rules.packageDefaults;Object.assign(values,{skuLength:p.lengthCm,skuWidth:p.widthCm,skuHeight:p.heightCm,weight:Number((p.weightKg*(units.weight==='g'?1000:1)).toPrecision(15))});}
  }
  if(rules.inventory){
    if(!binding.warehouse||snapshot.warehouses.length!==1||snapshot.warehouses[0]!==binding.warehouse)issues.push('固定库存需要唯一且与模板一致的仓库');
    values.stock=rules.inventory.quantity;
  }
  if(Object.keys(values).length){
    if(!skus.length||skus.some(value=>!String(value).trim())||new Set(skus).size!==skus.length)issues.push('批量填写前需要完整且唯一的SKU货号');
    for(const [name,value] of Object.entries(values)){
      if(!Number.isFinite(value)||(name==='stock'?!Number.isSafeInteger(value)||value<0:value<=0))issues.push('模板SKU数值无效：'+name);
      if(snapshot.fields[name]?.length!==skus.length)issues.push('每个SKU需要一个明确的填写控件：'+name);
    }
  }
  return {skus:[...skus],values,warehouse:binding.warehouse,units:units||null,issues};
}

export function templateSkuValueIssues(snapshot,plan){
  const issues=[];
  if(!isDeepStrictEqual(snapshot.fields.variationSku,plan.skus))issues.push('批量填写期间SKU顺序或货号发生变化');
  for(const [name,value] of Object.entries(plan.values))if(snapshot.fields[name]?.length!==plan.skus.length||snapshot.fields[name].some(entry=>String(entry).trim()===''||Number(entry)!==value))issues.push('批量数值未完整填写：'+name);
  return issues;
}

// Evaluate only against the observed editor. Validate all rows before writing;
// the outer driver rereads and compares the entire product before any save.
export function fillTemplateSkuFields({expected,plan}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('SKU填写页面或账号变化');
  const clean=s=>String(s||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  for(const [label,value] of [['店铺账号',expected.storeName],['经营站点',expected.site]]){
    const items=[...document.querySelectorAll('.ant-form-item')].filter(e=>visible(e)&&clean(e.querySelector('.ant-form-item-label')?.textContent)===label);
    if(items.length!==1||![...items[0].querySelectorAll('.ant-select-selection-item')].some(e=>visible(e)&&clean(e.textContent)===value))throw new Error('SKU填写店铺或站点变化');
  }
  if(![...document.querySelectorAll('input')].some(e=>visible(e)&&e.value===expected.sourceUrl))throw new Error('SKU填写来源商品变化');
  const inputs=name=>[...document.getElementsByName(name)].filter(visible);
  const ids=inputs('variationSku');
  if(!plan.skus.length||ids.length!==plan.skus.length||ids.some((e,i)=>e.value!==plan.skus[i])||new Set(plan.skus).size!==ids.length)throw new Error('SKU数量、货号或顺序变化');
  const writes=[];
  for(const [name,value] of Object.entries(plan.values)){
    if(!['skuLength','skuWidth','skuHeight','weight','stock'].includes(name)||typeof value!=='number'||!Number.isFinite(value)||(name==='stock'?!Number.isSafeInteger(value)||value<0:value<=0))throw new Error('不允许的SKU批量写入');
    const controls=inputs(name);
    if(controls.length!==ids.length)throw new Error('每个SKU必须恰有一个可见控件：'+name);
    controls.forEach((control,i)=>{
      if(control.tagName!=='INPUT'||!['text','number','tel'].includes(control.type)||control.disabled||control.readOnly||!ids[i].closest('tr')||control.closest('tr')!==ids[i].closest('tr'))throw new Error('SKU控件不可编辑或所在规格行不一致：'+name);
      writes.push({control,value:String(value)});
    });
  }
  if(Object.hasOwn(plan.values,'stock')){
    const warehouses=[...document.querySelectorAll('.in-selector.ant-select-multiple.ant-select-allow-clear .ant-select-selection-item')].filter(visible).map(e=>e.getAttribute('title')||e.querySelector('[title]')?.getAttribute('title')||e.textContent.trim());
    if(warehouses.length!==1||warehouses[0]!==plan.warehouse)throw new Error('填写库存前仓库发生变化');
  }
  for(const {control,value} of writes){
    // Vue may recreate the table after an earlier input event; never continue
    // against stale nodes or silently skip the remaining SKU rows.
    if(!control.isConnected||!visible(control))throw new Error('SKU表格在填写期间重建，请重新核对');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(control,value);
    control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return {written:writes.length};
}

export function resolveTemplateCandidates(candidates,row,binding,resolved){
  const exact=candidates.filter(candidate=>String(candidate.goodsId)===String(row.goodsId)&&candidate.storeName===binding.storeName&&siteKey(candidate.site)===siteKey(binding.site));
  const unique=[...new Map(exact.map(candidate=>[candidate.draftId,candidate])).values()];
  if(resolved){
    const match=unique.filter(candidate=>candidate.draftId===resolved.draftId&&candidate.platformEditUrl===resolved.platformEditUrl);
    return match.length===1?{status:'located',candidate:match[0]}:{status:'needs-review',candidates:unique,issues:['明确选择的草稿已不在同来源、店铺及站点的候选中，未改选其他商品']};
  }
  if(unique.length===1)return {status:'located',candidate:unique[0]};
  if(unique.length>1)return {status:'ambiguous',candidates:unique,issues:['同一商品在该店铺及站点有多条记录，请明确选择要处理的草稿']};
  return {status:'unclaimed',candidates:[],issues:['完整检查后未找到该商品在目标店铺及站点的采集箱记录']};
}

// Stable product facts are retained across category/logistics edits. An empty
// pre-category SKU table can become populated, but existing values cannot change.
export function templatePreservationIssues(before,after,allowedFields=[]){
  const issues=[];
  for(const field of ['sources','media'])if(!isDeepStrictEqual(before[field],after[field]))issues.push(`商品${field==='sources'?'来源':'图片'}在填写时发生变化`);
  for(const label of ['产品标题','英文标题','产品货号','产地','制造地点']){
    const a=before.items.find(item=>item.label===label),b=after.items.find(item=>item.label===label);
    const values=item=>item?{controls:item.controls,selections:item.selections,checked:item.checked}:null;
    if(!isDeepStrictEqual(values(a),values(b)))issues.push(`${label}在填写时发生变化`);
  }
  const allowed=new Set(allowedFields.filter(name=>[...packageFieldNames,'stock'].includes(name)));
  for(const [name,values] of Object.entries(before.fields||{}))if(values.length&&!isDeepStrictEqual(values,after.fields?.[name])&&(!allowed.has(name)||values.length!==after.fields?.[name]?.length))issues.push(`SKU ${name}在填写时发生变化`);
  if(before.variants?.length&&!isDeepStrictEqual(before.variants,after.variants))issues.push('商品规格在填写时发生变化');
  if(before.priceSnapshot?.length&&!isDeepStrictEqual(before.priceSnapshot,after.priceSnapshot))issues.push('商品价格或币种在填写时发生变化');
  return issues;
}

export function templateSaveSnapshot(snapshot){
  return {url:snapshot.url,account:snapshot.account,storeName:snapshot.storeName,site:snapshot.site,sources:snapshot.sources,
    fields:snapshot.fields,media:snapshot.media,variants:snapshot.variants,warehouses:snapshot.warehouses,priceSnapshot:snapshot.priceSnapshot,
    ...(snapshot.categoryPath?{categoryPath:snapshot.categoryPath}:{}),
    ...(snapshot.requiredFields?{requiredFields:snapshot.requiredFields.fields.map(field=>({name:field.name,label:field.label,kind:field.kind,rowSku:field.rowIdentity?.sku||'',value:field.label==='产品标题'&&typeof field.value==='string'?field.value.replace(/ {2,}/g,' '):field.value}))}:{}),
    items:snapshot.items.map(({label,controls,selections,checked})=>({label,controls:controls.map(control=>({...control,value:label==='产品标题'?control.value.replace(/ {2,}/g,' '):control.value})),selections,checked}))};
}

export function templateSaveSnapshotsMatch(snapshot,expected){
  const actual=templateSaveSnapshot(snapshot);
  if(actual.categoryPath?.length&&expected?.categoryPath?.length&&categoryPathMatches(actual.categoryPath,expected.categoryPath)){
    actual.categoryPath=copy(expected.categoryPath);
    for(const item of actual.items.filter(item=>item.label==='产品分类')){
      const prior=expected.items.find(entry=>entry.label===item.label);if(!prior)continue;
      if(categoryPathMatches(item.selections,prior.selections))item.selections=copy(prior.selections);
      for(const [index,control] of item.controls.entries())if(prior.controls[index]?.name===control.name&&categoryPathMatches([control.value],[prior.controls[index].value]))control.value=prior.controls[index].value;
    }
    for(const field of actual.requiredFields||[])if(/分类|类目/.test(field.label)){
      const prior=expected.requiredFields?.find(item=>item.name===field.name&&item.label===field.label&&item.rowSku===field.rowSku);
      if(prior&&categoryPathMatches(Array.isArray(field.value)?field.value:[field.value],Array.isArray(prior.value)?prior.value:[prior.value]))field.value=copy(prior.value);
    }
  }
  return isDeepStrictEqual(actual,expected);
}

// This mode may complete a blank value, but cannot replace any existing fact.
// Category is the one explicit user selection, checked by its complete path.
export function templateRequiredPreservationIssues(before,after,{pricePlan}={}){
  if(pricePlan?.policy===SOURCE_PRICE_POLICY&&pricePlan.prices?.length&&after.requiredFields){
    before=copy(before);
    for(const price of pricePlan.prices.filter(item=>item.matched)){
      const actual=after.requiredFields.fields.find(field=>field.key===price.key);if(!actual||!isPriceField(actual))continue;
      const original=before.requiredFields?.fields.find(field=>field.name===actual.name&&field.label===actual.label&&(field.rowIdentity?.sku||'')===(actual.rowIdentity?.sku||''));
      if(original){original.value=copy(actual.value);original.empty=false;}
      const index=after.fields?.variationSku?.indexOf(actual.rowIdentity?.sku);
      if(index>=0&&Array.isArray(before.fields?.[actual.name])&&Array.isArray(after.fields?.[actual.name]))before.fields[actual.name][index]=after.fields[actual.name][index];
      if(index>=0&&price.semantic==='temu-declared-price'&&before.priceSnapshot?.[index]&&after.priceSnapshot?.[index])before.priceSnapshot[index].declaredPrice=after.priceSnapshot[index].declaredPrice;
      if(index>=0)for(const item of before.items||[]){
        const controls=item.controls.filter(control=>control.name===actual.name),live=after.items?.find(entry=>entry.label===item.label)?.controls.filter(control=>control.name===actual.name)||[];
        if(controls.length===after.fields.variationSku.length&&live.length===controls.length)controls[index].value=live[index].value;
      }
    }
  }
  const issues=[],filled=value=>value!==undefined&&value!==null&&value!==false&&!(typeof value==='string'&&!value.trim())&&!(Array.isArray(value)&&!value.length);
  const preserves=(a,b)=>{
    if(!filled(a))return true;
    if(Array.isArray(a))return Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>preserves(value,b[index]));
    if(typeof a==='object')return b&&typeof b==='object'&&Object.entries(a).every(([key,value])=>preserves(value,b[key]));
    return isDeepStrictEqual(a,b);
  };
  for(const name of ['sources','media'])if(!isDeepStrictEqual(before[name],after[name]))issues.push(`商品${name==='sources'?'来源':'图片'}在补全时发生变化`);
  for(const name of ['fields','variants','warehouses','priceSnapshot'])if(!preserves(before[name],after[name]))issues.push(`已有商品${name}在补全时发生变化`);
  for(const item of before.items||[]){
    if(item.label==='产品分类')continue;
    const actual=after.items?.find(entry=>entry.label===item.label);
    if(!preserves({controls:item.controls,selections:item.selections,checked:item.checked},actual))issues.push(`已有${item.label}在补全时发生变化`);
  }
  if(before.requiredFields&&after.requiredFields){
    const fields=after.requiredFields.fields;
    for(const field of before.requiredFields.fields){
      if(field.empty||/分类|类目/.test(field.label))continue;
      const same=fields.find(entry=>entry.key===field.key);
      if(!same||!isDeepStrictEqual(field.value,same.value)||!isDeepStrictEqual(field.rowIdentity,same.rowIdentity))issues.push(`已有${field.label}在补全时发生变化`);
    }
  }
  return [...new Set(issues)];
}

export function templateConfigurationIssues(snapshot,rules,binding){
  const issues=[];
  for(const [label,value] of [['产品分类',rules.category.path?.at(-1)],['运费模板',binding.shippingTemplate],['承诺发货时效',binding.dispatch],...rules.attributes.map(item=>[item.label,item.value])]){
    if(!value)continue;const item=snapshot.items.find(item=>item.label===label);
    if(!item||!selected(item).includes(value)&&!item.controls.some(control=>control.value===value))issues.push('模板配置未正确填写：'+label);
  }
  if(binding.warehouse&&(snapshot.warehouses.length!==1||snapshot.warehouses[0]!==binding.warehouse))issues.push('模板仓库未正确填写');
  return issues;
}

export function templateEditorLoadingIssues(snapshot,listCategory=''){
  const category=categoryValues(snapshot);
  if(listCategory&&!category.length)return ['列表显示已有商品分类，但编辑页分类尚未读取完成；未按无分类商品处理'];
  if(category.length&&!snapshot.fields.variationSku.length)return ['编辑页已有商品分类，但SKU尚未读取完成；暂不能判定商品规格缺失'];
  return [];
}

export const readTemplateList=withTemplatePager(function readTemplateList(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  if(location.origin!=='https://www.dianxiaomi.com'||location.pathname!=='/web/popTemu/pageList/draft')throw new Error('不在目标平台采集箱');
  if([...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(visible))return null;
  const sourceId=url=>{try{const u=new URL(url);if(u.protocol!=='https:'||!(u.hostname==='temu.com'||u.hostname.endsWith('.temu.com')))return null;return u.searchParams.get('goods_id')||u.pathname.match(/(?:^|-)g-(\d+)\.html$/)?.[1]||null;}catch{return null;}};
  const headers=[...document.querySelectorAll('thead th[colid]')];
  const siteColumn=headers.find(header=>header.textContent.trim()==='站点')?.getAttribute('colid');
  const records=[...document.querySelectorAll('tr.vxe-body--row[rowid]')].filter(visible).map(row=>{
    const links=[...row.querySelectorAll('a[href]')].filter(visible).map(link=>link.href);
    const sourceUrls=[...new Set(links.filter(sourceId))],text=row.innerText;
    const siteLines=(siteColumn?row.querySelector('td[colid="'+siteColumn+'"]')?.innerText||'':'').split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);
    // Keep the displayed local time verbatim; the page does not identify its
    // timezone, so these values must not be converted or used to auto-select.
    const displayedTime=label=>text.match(new RegExp(label+'\\s*[：:]\\s*(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})(?!\\d)'))?.[1].replace(/\s+/g,' ')||'';
    return {draftId:row.getAttribute('rowid'),sourceUrls,goodsIds:sourceUrls.map(sourceId),storeNames:[...text.matchAll(/「([^」]+)」/g)].map(match=>match[1]),
      site:siteLines[0]||'',category:siteLines.slice(1).filter(line=>!/^[-—–]+$/.test(line)).join(' '),createdAt:displayedTime('创建'),updatedAt:displayedTime('更新'),
      title:row.querySelector('.no-new-line3')?.textContent.trim()||'',platformEditUrl:links.find(url=>/^https:\/\/www\.dianxiaomi\.com\/web\/popTemu\/edit\?id=\d+$/.test(url))||null};
  });
  const byId=new Map();
  for(const record of records){
    const prior=byId.get(record.draftId);
    byId.set(record.draftId,prior?{...prior,sourceUrls:[...new Set([...prior.sourceUrls,...record.sourceUrls])],goodsIds:[...new Set([...prior.goodsIds,...record.goodsIds])],storeNames:[...new Set([...prior.storeNames,...record.storeNames])],site:prior.site||record.site,category:prior.category||record.category,createdAt:prior.createdAt||record.createdAt,updatedAt:prior.updatedAt||record.updatedAt,title:prior.title||record.title,platformEditUrl:prior.platformEditUrl||record.platformEditUrl}:record);
  }
  const rows=[...byId.values()];
  const total=Number(document.body.innerText.match(/共\s*(\d+)\s*条记录/)?.[1]??NaN);
  const next=[...document.querySelectorAll('.ant-pagination-next,.vxe-pager--next-btn')].find(visible);
  const nextEnabled=!!next&&!next.disabled&&next.getAttribute('aria-disabled')!=='true'&&!next.classList.contains('ant-pagination-disabled')&&!next.classList.contains('is--disabled');
  const search=document.querySelector('input[name="tableSearchInput"]')?.value||'';
  const empty=[...document.querySelectorAll('.vxe-table--empty-content,.ant-empty-description')].some(e=>visible(e)&&/暂无数据/.test(e.textContent));
  const filters=[...document.querySelectorAll('.in-screen-single,.in-screen-multiple')].filter(visible).map(group=>({title:group.querySelector('.title')?.textContent.trim()||'',selected:[...group.querySelectorAll('.d-tag-group-item.active')].filter(visible).map(e=>e.textContent.trim())})).filter(group=>/^(店铺账号|站点)[：:]/.test(group.title));
  const pager=readTemplatePager();
  pager.diagnostics.rangeText=(document.body.innerText.match(/第\s*\d+\s*[-–—~至]\s*\d+\s*条[，,\s]*共\s*\d+\s*条记录/)?.[0]||'').replace(/\s+/g,' ').slice(0,120);
  return {account:document.querySelector('.btn-user .user-name')?.textContent.trim(),rows,total,nextEnabled,hasPager:!!next,search,empty,filters,currentPage:pager.currentPage,pageInputCount:pager.inputs.length,pageNumbers:pager.pageNumbers,pagerSelectionIssues:pager.selectionIssues,pagerDiagnostics:pager.diagnostics};
});

export function readTemplateIdentity(){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const clean=s=>String(s||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  const fields=[...document.querySelectorAll('.ant-form-item')].filter(visible),field=label=>fields.find(e=>clean(e.querySelector('.ant-form-item-label')?.textContent)===label);
  const values=label=>[...field(label)?.querySelectorAll('.ant-select-selection-item')||[]].filter(visible).map(e=>clean(e.textContent));
  const loading=[...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(visible);
  return {url:location.href,account:document.querySelector('.btn-user .user-name')?.textContent.trim(),store:values('店铺账号'),site:values('经营站点'),
    sources:[...document.querySelectorAll('input')].filter(e=>visible(e)&&/^https?:/.test(e.value)&&/temu\.com/.test(e.value)).map(e=>e.value),
    loaded:!loading&&!!document.querySelector('#wirelessDescContentBox')&&!!field('产品标题')};
}

export const templateUiAction=withTemplatePager(function templateUiAction({expected,locator,action='point',value,withGeometry=false,scroll=true}){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const clean=s=>String(s||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('执行页面或账号已变化');
  if(expected.sourceUrl){
    const fields=[...document.querySelectorAll('.ant-form-item')].filter(visible);
    const chosen=label=>[...fields.find(e=>clean(e.querySelector('.ant-form-item-label')?.textContent)===label)?.querySelectorAll('.ant-select-selection-item')||[]].filter(visible).map(e=>clean(e.textContent));
    if(!chosen('店铺账号').includes(expected.storeName)||!chosen('经营站点').includes(expected.site)||![...document.querySelectorAll('input')].some(e=>visible(e)&&e.value===expected.sourceUrl))throw new Error('填写期间商品来源、店铺或站点已变化');
  }
  if(locator.editDraftId){
    const {hit,element}=templateEditControl({expected,draftId:locator.editDraftId,scroll});if(!hit)return null;
    if(action==='focus')element.focus({preventScroll:true});
    if(['focus','focused'].includes(action)&&(!document.hasFocus()||document.activeElement!==element))throw new Error('已核对的编辑按钮未取得焦点，未发送回车');
    return withGeometry?hit:hit.point;
  }
  let nodes;
  if(locator.paginationPage){
    const {from,to,count}=locator.paginationPage,pager=readTemplatePager(),inputs=pager.inputs;
    if(!Number.isSafeInteger(from)||from<1||to!==from+1||!Number.isSafeInteger(count)||count<1||inputs.length!==count||pager.selectionIssues.length||pager.currentPage!==from)throw new Error('顶部与底部页码不一致或目标不是下一页，未跳转');
    nodes=inputs.filter(input=>!input.disabled&&!input.readOnly);nodes.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);nodes=nodes.slice(0,1);
  }else if(locator.paginationNext){
    const all=[...document.querySelectorAll('.ant-pagination-next,.vxe-pager--next-btn')].filter(visible),pager=readTemplatePager();
    if(pager.selectionIssues.length||pager.inputs.length&&pager.currentPage===null)throw new Error('顶部与底部分页的当前页不一致或无法确认，未翻页');
    const pageNumber=button=>{
      const group=pager.groups.find(group=>group.root===button.closest('.ant-pagination,.vxe-pager'));
      return group?.currentPage??group?.activePage??null;
    };
    if(all.length>1){
      const numbers=all.map(pageNumber);
      if(numbers.some(number=>!number)||new Set(numbers).size!==1)throw new Error('顶部与底部分页的当前页不一致或无法确认，未翻页');
    }
    nodes=all.filter(button=>!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&!button.classList.contains('ant-pagination-disabled')&&!button.classList.contains('is--disabled'));
    // Only pagination has two equivalent controls. Other locators retain the
    // strict uniqueness requirement below.
    nodes.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);nodes=nodes.slice(0,1);
  }else if(locator.filterTitle){
    const groups=[...document.querySelectorAll('.in-screen-single,.in-screen-multiple')].filter(e=>visible(e)&&e.querySelector('.title')?.textContent.trim()===locator.filterTitle);
    if(groups.length!==1)throw new Error('采集箱筛选组不存在或不唯一');nodes=[...groups[0].querySelectorAll('.d-tag-group-item')];
  }else if(locator.categoryDepth!==undefined){
    const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&e.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');
    if(modals.length!==1)throw new Error('商品分类窗口不唯一');
    const box=[...modals[0].querySelectorAll('.categories-box')].filter(visible)[locator.categoryDepth];nodes=[...box?.querySelectorAll('.categories-item-name')||[]];
  }else if(locator.formLabel){
    nodes=[...document.querySelectorAll('.ant-form-item')].filter(e=>visible(e)&&clean(e.querySelector('.ant-form-item-label')?.textContent)===locator.formLabel);
    if(nodes.length!==1)throw new Error('填写字段不存在或不唯一：'+locator.formLabel);
    if(locator.descendant)nodes=[...nodes[0].querySelectorAll(locator.descendant)].filter(e=>e.closest('.ant-form-item')===nodes[0]);
  }else nodes=[...document.querySelectorAll(locator.selector)];
  nodes=nodes.filter(visible).filter(e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  if(locator.text!==undefined)nodes=nodes.filter(e=>e.textContent.trim()===locator.text);
  if(locator.index!==undefined)nodes=nodes[locator.index]?[nodes[locator.index]]:[];
  if(!nodes.length)return null;
  if(nodes.length!==1)throw new Error('填写控件不唯一：'+(locator.formLabel||locator.selector||locator.text));
  const element=nodes[0];
  if(action==='fill'){
    if(!locator.formLabel||typeof value!=='string'||!['INPUT','TEXTAREA'].includes(element.tagName)||['password','hidden','file','checkbox','radio'].includes(element.type)||element.readOnly)throw new Error('仅允许填写模板明确指定的可见属性文本');
    const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return true;
  }
  if(action==='page'){
    if(!locator.paginationPage||element.tagName!=='INPUT')throw new Error('仅允许填写已核对的下一页页码');
    element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});element.focus({preventScroll:true});
    if(document.activeElement!==element||!document.hasFocus())throw new Error('下一页页码输入框或页面未取得焦点，未跳转');
    element.select();
    if(element.selectionStart!==0||element.selectionEnd!==element.value.length)throw new Error('下一页页码原值未完整选中，未输入或跳转');
    return true;
  }
  if(scroll)element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const rect=element.getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  return element.contains(document.elementFromPoint(point.x,point.y))?(withGeometry?{point,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}:point):null;
});

export function readTemplateField(label){
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const clean=s=>String(s||'').replace(/\s+/g,' ').replace(/[：:*]/g,'').trim();
  const fields=[...document.querySelectorAll('.ant-form-item')].filter(e=>visible(e)&&clean(e.querySelector('.ant-form-item-label')?.textContent)===label);
  if(fields.length!==1)return null;const field=fields[0],owns=e=>e.closest('.ant-form-item')===field&&visible(e);
  return {selects:[...field.querySelectorAll('.ant-select-selector')].filter(owns).length,radios:[...field.querySelectorAll('input[type="radio"]')].filter(owns).length,
    textInputs:[...field.querySelectorAll('input,textarea')].filter(owns).filter(e=>!['search','hidden','radio','checkbox','file','password'].includes(e.type)).length,
    multi:!!field.querySelector('.ant-select-multiple')};
}

export function createDxmTemplateBrowser(configuration={},transport){
  const library=()=>transport||import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib/bit-cdp.mjs')).href);
  const lastOwnedUrl=new Map();
  function diagnosticText(args,input,limit=300){
    let value=String(input??'');
    for(const [key,secret] of Object.entries(configuration))if(/api.?key|secret|password|authorization|cookie|csrf|credential|access.?token|refresh.?token/i.test(key)&&typeof secret==='string'&&secret.length>=6)value=value.replaceAll(secret,'[已隐藏]');
    if(args.erpConnection?.expectedAccount)value=value.replaceAll(args.erpConnection.expectedAccount,'[账号已隐藏]');
    return value.replace(/https?:\/\/[^\s<>"']+/gi,'[链接已隐藏]').replace(/((?:账号|账户|account)\s*[:：=]\s*)[^\s，；。,;]+/gi,'$1[已隐藏]').slice(0,limit);
  }
  function rowPagerDiagnostics(args,value){
    if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
    const result={};
    for(const key of ['pagerCount','pageInputCount','initialPage','currentPage','targetPage'])if(value[key]===null||Number.isSafeInteger(value[key])&&value[key]>=0)result[key]=value[key];
    for(const key of ['documentHasFocus','activeElementIsPageInput'])if(typeof value[key]==='boolean')result[key]=value[key];
    for(const key of ['rangeText','captureError'])if(typeof value[key]==='string')result[key]=diagnosticText(args,value[key],key==='rangeText'?120:300);
    if(Array.isArray(value.selectionIssues))result.selectionIssues=value.selectionIssues.slice(0,10).filter(item=>typeof item==='string').map(item=>diagnosticText(args,item));
    if(Array.isArray(value.inputs))result.inputs=value.inputs.slice(0,10).filter(item=>item&&typeof item==='object'&&!Array.isArray(item)).map(item=>{
      const input={};if(Number.isSafeInteger(item.pagerIndex)&&item.pagerIndex>=0)input.pagerIndex=item.pagerIndex;
      for(const key of ['type','title','ariaLabel','className','value'])if(typeof item[key]==='string')input[key]=diagnosticText(args,item[key],120);
      for(const key of ['selected','pageSize'])if(typeof item[key]==='boolean')input[key]=item[key];return input;
    });
    return JSON.stringify(result).length<=16384?result:{captureError:'分页诊断超过大小限制，未保存'};
  }
  function editDiagnostics(args,value){
    if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
    const clean=(input,depth=0)=>{if(depth>6)return undefined;if(input===null||typeof input==='boolean'||typeof input==='number')return input;if(typeof input==='string')return diagnosticText(args,input,300);if(Array.isArray(input))return input.slice(0,8).map(item=>clean(item,depth+1));if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).filter(([key])=>!/account|url|snapshot|cookie|secret|password|token|authorization/i.test(key)).slice(0,30).map(([key,item])=>[key,clean(item,depth+1)]));return undefined;};
    const result=clean(value);return JSON.stringify(result).length<=16384?result:{captureError:'编辑控件诊断超过大小限制，未保存'};
  }
  async function progress(args,event){
    stopped(args);
    if(args.onProgress)await args.onProgress(copy(event));
    stopped(args);
  }
  async function owned(args,work){
    if(args.browserConfig?.type!=='chrome'||!args.erpConnection?.expectedAccount)throw new Error('固定模板执行需要已绑定账号的谷歌浏览器');
    stopped(args);const lib=await library(),info=await lib.connection(args.browserConfig),browser=await lib.connect(info.ws);
    let page,targetId,created=false;
    try{
      const prior=args.tabs?.listingTemplate;
      if(prior){
        const target=(await info.targets()).find(item=>(item.id||item.targetId)===prior&&item.type==='page');
        if(target){
          const url=target.url;
          if(url==='about:blank'||url===listUrl||url===args.row?.platformEditUrl||url===lastOwnedUrl.get(prior))targetId=prior;
        }
      }
      if(!targetId){({targetId}=await browser.send('Target.createTarget',{url:'about:blank'}));created=true;if(args.onTarget)await args.onTarget('listingTemplate',targetId,{owned:true});}
      page=await lib.pageById(info,targetId);await page.send('Page.enable');await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});await browser.send('Target.activateTarget',{targetId});
      const result=await work(page,lib,{browser,info,targetId});lastOwnedUrl.set(targetId,await page.evaluate(()=>location.href).catch(()=>''));return result;
    }finally{if(page)await page.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});page?.close();if(created&&!args.onTarget&&targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
  }
  async function navigate(page,lib,args,url){
    stopped(args);if(url!==listUrl&&!validEdit(url))throw new Error('仅允许读取采集箱及已定位的Temu商品编辑页');
    const result=await page.send('Page.navigate',{url});if(result.errorText)throw new Error('店小秘页面打开失败：'+result.errorText);
    await lib.poll(async()=>{try{return await page.evaluate(({url,account})=>location.href===url&&document.readyState==='complete'&&document.querySelector('.btn-user .user-name')?.textContent.trim()===account,{url,account:args.erpConnection.expectedAccount});}catch(error){if(/context|navigat/i.test(error.message))return false;throw error;}},{timeout:45000,label:'固定模板目标页面及账号'});
  }
  async function point(page,lib,args,expected,locator){
    stopped(args);let hit;
    try{
      hit=await lib.poll(async()=>{
        stopped(args);const first=await page.evaluate(templateUiAction,{expected,locator,withGeometry:true});if(!first)return null;
        await new Promise(resolve=>setTimeout(resolve,200));stopped(args);
        const second=await page.evaluate(templateUiAction,{expected,locator,withGeometry:true,scroll:false});if(!templateHitIsStable(first,second))return null;
        await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',...second.point});stopped(args);
        const third=await page.evaluate(templateUiAction,{expected,locator,withGeometry:true,scroll:false});return templateHitIsStable(second,third)?third:null;
      },{timeout:15000,label:'固定模板控件：'+(locator.editDraftId?'编辑':locator.formLabel||locator.text||locator.selector)});
      stopped(args);await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...hit.point});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...hit.point});return hit;
    }catch(error){
      if(locator.editDraftId){
        let diagnostic;try{diagnostic=await page.evaluate(readTemplateEditDiagnostics,{expected,draftId:locator.editDraftId});}catch(capture){diagnostic={draftId:locator.editDraftId,captureError:diagnosticText(args,capture.message)};}
        error.data={...(error.data||{}),editDiagnostics:editDiagnostics(args,{stage:'locate-edit',...diagnostic})};
      }
      throw error;
    }
  }
  async function activateEdit(page,lib,args,expected,draftId){
    const locator={editDraftId:draftId,text:'编辑'};let hit;
    try{
      hit=await lib.poll(async()=>{
        stopped(args);const first=await page.evaluate(templateUiAction,{expected,locator,action:'focus',withGeometry:true});if(!first)return null;
        await new Promise(resolve=>setTimeout(resolve,200));stopped(args);
        const second=await page.evaluate(templateUiAction,{expected,locator,action:'focused',withGeometry:true,scroll:false});return templateHitIsStable(first,second)?second:null;
      },{timeout:15000,label:'固定模板控件：编辑'});
      stopped(args);await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});return hit;
    }catch(error){
      let diagnostic;try{diagnostic=await page.evaluate(readTemplateEditDiagnostics,{expected,draftId});}catch(capture){diagnostic={draftId,captureError:diagnosticText(args,capture.message)};}
      error.data={...(error.data||{}),editDiagnostics:editDiagnostics(args,{stage:'locate-edit',...diagnostic,lastHit:hit})};throw error;
    }
  }
  function checkPageState(state,args){
    if(state.account!==args.erpConnection.expectedAccount||state.search||state.filters?.some(group=>group.selected.length!==1||group.selected[0]!=='全部'))throw new Error('列表账号或筛选条件发生变化');
    if(state.pagerSelectionIssues?.length||state.pageInputCount&&(!Number.isSafeInteger(state.currentPage)||state.currentPage<1||state.pageNumbers?.some(number=>number!==state.currentPage)))throw pagerFailure(new Error('顶部与底部分页的当前页不一致或无法确认，未翻页'),state);
  }
  async function advancePage(page,lib,args,state,visited){
    const expected={url:listUrl,account:args.erpConnection.expectedAccount},prior=pageFingerprint(state),numbered=Number.isSafeInteger(state.currentPage),target=numbered?state.currentPage+1:null;
    let current=state;
    try{
    stopped(args);checkPageState(state,args);if(!state.nextEnabled)throw new Error('当前页没有可核对的下一页，未跳转');
    let submitted=false;
    if(numbered&&state.pageInputCount){
      submitted=await page.evaluate(templateUiAction,{expected,locator:{paginationPage:{from:state.currentPage,to:target,count:state.pageInputCount}},action:'page'});
      if(submitted){
        stopped(args);await page.send('Input.insertText',{text:String(target)});
        stopped(args);await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
        await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
      }
    }
    if(!submitted)await point(page,lib,args,expected,{paginationNext:true});
    return await lib.poll(async()=>{
      stopped(args);const next=await page.evaluate(readTemplateList);if(!next)return null;
      current=next;
      if(next.account!==args.erpConnection.expectedAccount||next.search||next.filters?.some(group=>group.selected.length!==1||group.selected[0]!=='全部'))throw new Error('翻页期间账号或筛选条件发生变化');
      if(next.pagerSelectionIssues?.length)throw new Error('翻页期间页码输入框无法唯一确认，未继续扫描');
      if(numbered){
        if(next.pageInputCount!==state.pageInputCount)throw new Error('翻页期间页码控件数量发生变化，未继续扫描');
        if(next.currentPage===null||next.pageNumbers?.some(number=>number!==next.currentPage))return null;
        if(next.currentPage!==state.currentPage&&next.currentPage!==target)throw new Error('采集箱跳过预期下一页，未继续扫描');
        if(next.currentPage!==target)return null;
      }
      const fingerprint=pageFingerprint(next);if(!fingerprint||fingerprint===prior)return null;
      if(visited.has(fingerprint))throw new Error('采集箱重复返回已读取页面，未当作完整采集箱');
      return next;
    },{timeout:45000,label:numbered?`采集箱第${target}页页码与记录同时更新`:'下一页采集箱记录'});
    }catch(error){throw pagerFailure(error,state,current,target);}
  }
  async function readEditor(page,lib,args,row,binding){
    if(!validEdit(row.platformEditUrl)||temuGoodsId(row.sourceUrl)!==String(row.goodsId))throw new Error('目标草稿或来源商品编号无效');
    const identity=await lib.poll(async()=>{const identity=await page.evaluate(readTemplateIdentity);return identity.loaded&&identity.store.length&&identity.site.length&&identity.sources.length?identity:null;},{timeout:60000,label:'商品编辑信息完整加载'});
    if(identity.url!==row.platformEditUrl||identity.account!==args.erpConnection.expectedAccount||identity.store.length!==1||identity.store[0]!==binding.storeName||identity.site.length!==1||siteKey(identity.site[0])!==siteKey(binding.site))throw new Error('草稿账号、店铺或站点不匹配');
    const sources=identity.sources.filter(source=>temuGoodsId(source)===String(row.goodsId));
    if(!sources.length||identity.sources.some(source=>temuGoodsId(source)!==String(row.goodsId)))throw new Error('草稿来源商品与本批商品不匹配');
    const expected={url:identity.url,account:identity.account,storeName:binding.storeName,site:identity.site[0],sourceUrl:sources[0]};
    const listCategory=row.listEvidence?.category||row.inspection?.listEvidence?.category||'';
    let snapshot=await page.evaluate(readTemuListing,expected),loadingIssues=templateEditorLoadingIssues(snapshot,listCategory);
    if(loadingIssues.length){
      try{
        snapshot=await lib.poll(async()=>{stopped(args);const value=await page.evaluate(readTemuListing,expected);return templateEditorLoadingIssues(value,listCategory).length?null:value;},{timeout:15000,label:'编辑页已有分类及SKU数据加载'});
        loadingIssues=[];
      }catch(error){
        if(error.code!=='ERP_WAIT_TIMEOUT')throw error;
        stopped(args);snapshot=await page.evaluate(readTemuListing,expected);loadingIssues=templateEditorLoadingIssues(snapshot,listCategory);
      }
    }
    return {expected,snapshot,loadingIssues};
  }
  async function editor(page,lib,args,row,binding){await navigate(page,lib,args,row.platformEditUrl);return readEditor(page,lib,args,row,binding);}
  async function resetFilters(page,lib,args){
    for(let attempt=0;attempt<4;attempt++){
      const state=await lib.poll(()=>page.evaluate(readTemplateList),{timeout:45000,label:'采集箱筛选读取'});
      if(state.account!==args.erpConnection.expectedAccount||state.search)throw new Error('采集箱账号或查询条件不匹配');
      const filtered=state.filters?.find(group=>group.selected.length!==1||group.selected[0]!=='全部');
      if(!filtered)return;
      await point(page,lib,args,{url:listUrl,account:args.erpConnection.expectedAccount},{filterTitle:filtered.title,text:'全部'});
      await lib.poll(async()=>{const current=await page.evaluate(readTemplateList),group=current?.filters?.find(group=>group.title===filtered.title);return group?.selected.length===1&&group.selected[0]==='全部';},{timeout:30000,label:'恢复采集箱全部范围'});
    }
    throw new Error('未能确认采集箱店铺及站点全部范围');
  }
  async function openObservedEditor(page,lib,args,candidate,session,work){
    await navigate(page,lib,args,listUrl);await resetFilters(page,lib,args);
    let found=false;const visited=new Set();
    for(let index=0;index<100;index++){
      const state=await lib.poll(()=>page.evaluate(readTemplateList),{timeout:45000,label:'定位候选草稿所在页'});
      checkPageState(state,args);if(Number.isSafeInteger(state.currentPage)&&state.currentPage!==index+1)throw new Error('候选草稿定位未从第一页连续读取，未打开其他记录');
      const fingerprint=pageFingerprint(state);if(visited.has(fingerprint))throw new Error('候选草稿分页重复，未打开其他记录');visited.add(fingerprint);
      if(state.rows.some(row=>row.draftId===candidate.draftId)){found=true;break;}
      if(!state.nextEnabled)break;
      await advancePage(page,lib,args,state,visited);
    }
    if(!found)throw new Error('选定草稿已离开采集箱，未打开其他记录');
    const before=new Set((await session.browser.send('Target.getTargets')).targetInfos.map(target=>target.targetId));
    const expected={url:listUrl,account:args.erpConnection.expectedAccount},clickHit=await activateEdit(page,lib,args,expected,candidate.draftId);
    let child,targetId;
    try{
      const opened=await lib.poll(async()=>{
        const current=await page.evaluate(()=>location.href);
        if(validEdit(current))return {page,url:current};
        const candidates=(await session.browser.send('Target.getTargets')).targetInfos.filter(target=>!before.has(target.targetId)&&target.openerId===session.targetId&&target.type==='page'&&validEdit(target.url));
        if(candidates.length>1)throw new Error('编辑操作打开多个目标，未继续填写');
        if(!candidates.length)return null;return {targetId:candidates[0].targetId,url:candidates[0].url};
      },{timeout:30000,label:'实际编辑按钮打开的草稿地址'});
      if(new URL(opened.url).searchParams.get('id')!==candidate.draftId)throw new Error('实际编辑地址的草稿编号与候选行不一致');
      if(opened.page)return await work(opened.page,opened.url);
      targetId=opened.targetId;child=await lib.pageById(session.info,targetId);await child.send('Page.enable');return await work(child,opened.url);
    }catch(error){
      let diagnostic;try{diagnostic=await page.evaluate(readTemplateEditDiagnostics,{expected,draftId:candidate.draftId});}catch(capture){diagnostic={draftId:candidate.draftId,captureError:diagnosticText(args,capture.message)};}
      error.data={...(error.data||{}),editDiagnostics:editDiagnostics(args,{stage:'open-edit',...diagnostic,lastHit:clickHit})};throw error;
    }finally{child?.close();if(targetId)await session.browser.send('Target.closeTarget',{targetId}).catch(()=>{});}
  }
  async function inspect(args){
    const template=args.templateSnapshot,bindings=template?.storeBindings||[],scanOnly=args.scanOnly===true;
    if(!Array.isArray(args.rows)||!args.rows.length||!bindings.length)throw new Error('缺少本次商品或模板店铺');
    if(template.platform!=='temu')return {rows:args.rows.flatMap(row=>bindings.map(binding=>({goodsId:row.goodsId,storeBindingKey:binding.key,status:'unsupported',sourceUrl:row.sourceUrl,storeName:binding.storeName,site:binding.site,issues:['该平台固定模板执行尚未接入']})))};
    return owned(args,async(page,lib,session)=>{
      await navigate(page,lib,args,listUrl);const expected={url:listUrl,account:args.erpConnection.expectedAccount};
      await resetFilters(page,lib,args);
      const initial=await lib.poll(()=>page.evaluate(readTemplateList),{timeout:45000,label:'采集箱列表'});
      if(initial.search)throw new Error('采集箱存在搜索条件，请清空后重新核对，未将筛选结果当成完整采集箱');
      const seen=new Set(),visited=new Set(),listRows=[];let complete=false;
      for(let pageIndex=0;pageIndex<100;pageIndex++){
        stopped(args);const state=await lib.poll(()=>page.evaluate(readTemplateList),{timeout:45000,label:'采集箱分页加载'});
        checkPageState(state,args);if(Number.isSafeInteger(state.currentPage)&&state.currentPage!==pageIndex+1)throw new Error('采集箱未从第一页连续读取，未将结果当作完整采集箱');
        const fingerprint=pageFingerprint(state);if(visited.has(fingerprint))throw new Error('采集箱重复返回已读取页面，未当作完整采集箱');visited.add(fingerprint);
        for(const row of state.rows)if(!seen.has(row.draftId)){seen.add(row.draftId);listRows.push(row);}
        await progress(args,{phase:'scan',stage:'page',page:pageIndex+1,scanned:listRows.length,...(Number.isFinite(state.total)?{total:state.total}:{}),message:`已读取采集箱第${pageIndex+1}页，累计${listRows.length}条记录`});
        if(!state.nextEnabled){
          complete=Number.isFinite(state.total)?listRows.length===state.total:state.empty&&listRows.length===0;
          if(!complete)throw new Error('采集箱分页未完整读取，未将未匹配商品记为未认领');break;
        }
        await advancePage(page,lib,args,state,visited);
      }
      if(!complete)throw new Error('采集箱超过100页，未能确认完整商品范围');
      const wanted=new Set(args.rows.map(row=>String(row.goodsId))),candidates=[],unresolvedListRows=[];
      for(const row of listRows){
        stopped(args);if(!/^\d{6,32}$/.test(row.draftId))continue;
        const targetBindings=bindings.filter(binding=>row.storeNames.includes(binding.storeName)&&(!row.site||siteKey(row.site)===siteKey(binding.site)));
        if(!targetBindings.length||row.goodsIds.length&&!row.goodsIds.some(id=>wanted.has(id)))continue;
        const url=row.platformEditUrl||`https://www.dianxiaomi.com/web/popTemu/edit?id=${row.draftId}`;
        if(row.goodsIds.length){
          for(const binding of targetBindings)for(const goodsId of row.goodsIds.filter(id=>wanted.has(id)))candidates.push({...row,goodsId,storeName:binding.storeName,site:row.site||binding.site,platformEditUrl:url,editorUrlObserved:!!row.platformEditUrl});
        }else{
          if(scanOnly){unresolvedListRows.push(row);continue;}
          const readIdentity=async editorPage=>lib.poll(async()=>{const value=await editorPage.evaluate(readTemplateIdentity);return value.loaded?value:null;},{timeout:60000,label:'核对缺少来源链接的草稿'});
          const identity=row.platformEditUrl?(await navigate(page,lib,args,url),await readIdentity(page)):await openObservedEditor(page,lib,args,row,session,readIdentity);
          for(const sourceUrl of identity.sources){const goodsId=temuGoodsId(sourceUrl);if(wanted.has(goodsId)&&identity.account===args.erpConnection.expectedAccount&&identity.store.length===1&&identity.site.length===1)candidates.push({...row,goodsId,sourceUrls:[sourceUrl],storeName:identity.store[0],site:identity.site[0],platformEditUrl:identity.url});}
        }
      }
      const targets=[];
      for(const source of args.rows)for(const binding of bindings){
        stopped(args);const base={goodsId:String(source.goodsId),storeBindingKey:binding.key,sourceUrl:source.sourceUrl,collectionEditUrl:source.collectionEditUrl,storeName:binding.storeName,site:binding.site};
        const resolved=args.resolvedTargets?.find(target=>target.goodsId===base.goodsId&&target.storeBindingKey===binding.key);
        let found=resolveTemplateCandidates(candidates,source,binding,resolved);
        if(scanOnly&&found.status==='unclaimed'&&unresolvedListRows.some(row=>row.storeNames.includes(binding.storeName)&&(!row.site||siteKey(row.site)===siteKey(binding.site))))found={status:'needs-review',candidates:[],issues:['列表存在缺少来源链接的目标店铺记录，仅扫描列表无法确认该商品是否已认领']};
        targets.push({source,binding,base,found});
      }
      const counts={sources:args.rows.length,stores:bindings.length,candidates:candidates.length,located:0,ambiguous:0,unclaimed:0,needsReview:0};
      for(const {found} of targets)counts[found.status==='needs-review'?'needsReview':found.status]++;
      await progress(args,{phase:'match',stage:'matched',targets:targets.length,matched:counts.located,counts,message:`候选匹配完成：${counts.located}条唯一记录，${counts.ambiguous}条存在多个候选，${counts.unclaimed}条未认领，${counts.needsReview}条需重新核对`});
      const result=[];
      for(const [index,{source,binding,base,found}] of targets.entries()){
        const rowProgress={phase:'inspect',rowIndex:index+1,rowCount:targets.length,targets:targets.length,goodsId:base.goodsId,storeBindingKey:base.storeBindingKey};
        await progress(args,{...rowProgress,stage:'row-start',inspected:index,message:`正在${scanOnly?'整理列表候选':'核对'}第${index+1}/${targets.length}条店铺商品`});
        let item;
        if(scanOnly)item=found.status==='located'?{...base,status:'needs-review',candidates:[found.candidate],issues:['列表候选唯一，尚未进入编辑页核对商品身份及完整资料'],listOnly:true}:{...base,...found,listOnly:true};
        else if(found.status!=='located')item={...base,...found};
        else{
          const candidate=found.candidate;
          const listEvidence={category:candidate.category||'',createdAt:candidate.createdAt||'',updatedAt:candidate.updatedAt||''};
          try{
            const {snapshot,loadingIssues}=candidate.editorUrlObserved===false
              ?await openObservedEditor(page,lib,args,candidate,session,(editorPage,url)=>readEditor(editorPage,lib,args,{...source,platformEditUrl:url,listEvidence},binding))
              :await editor(page,lib,args,{...source,platformEditUrl:candidate.platformEditUrl,listEvidence},binding);
            item={...base,status:loadingIssues.length?'needs-review':'located',draftId:candidate.draftId,platformEditUrl:candidate.platformEditUrl,listEvidence,snapshot,issues:loadingIssues.length?loadingIssues:listingReadiness(snapshot),checkedAt:now()};
          }catch(error){
            item={...base,status:'needs-review',draftId:candidate.draftId,platformEditUrl:candidate.platformEditUrl,listEvidence,issues:[diagnosticText(args,error.message,600)]};
            const diagnostics=rowPagerDiagnostics(args,error.data?.pagerDiagnostics);if(diagnostics)item.pagerDiagnostics=diagnostics;
            const edit=editDiagnostics(args,error.data?.editDiagnostics);if(edit)item.editDiagnostics=edit;
          }
        }
        result.push(item);
        // Progress is a bounded status summary. Full account and product snapshots
        // remain in the final result instead of being copied into progress logs.
        const summary={status:item.status,candidateCount:item.candidates?.length||0,issueCount:item.issues?.length||0,issues:(item.issues||[]).slice(0,10).filter(issue=>typeof issue==='string').map(issue=>diagnosticText(args,issue))};
        if(item.draftId)summary.draftId=item.draftId;
        await progress(args,{...rowProgress,stage:'row-complete',inspected:index+1,result:summary,message:`已${scanOnly?'整理列表候选':'核对'}${index+1}/${targets.length}条店铺商品${item.issues?.length?'，当前条目有待补充或核对项':''}`});
      }
      return {rows:result,checkedAt:now(),scannedRecords:listRows.length,...(scanOnly?{scanOnly:true,unresolvedListRecords:unresolvedListRows.length}: {})};
    });
  }
  async function chooseField(page,lib,args,expected,label,value,snapshot){
    const item=snapshot.items.find(item=>item.label===label);
    if(item&&(selected(item).includes(value)||item.controls.some(control=>control.value===value)))return;
    const shape=await page.evaluate(readTemplateField,label);if(!shape)throw new Error('模板属性在当前商品中不存在或不唯一：'+label);
    if(shape.radios){await point(page,lib,args,expected,{formLabel:label,descendant:'label',text:value});return;}
    if(shape.selects===1){
      if(shape.multi&&selected(item).length)throw new Error('模板属性已有多选值，不能直接追加或覆盖：'+label);
      await point(page,lib,args,expected,{formLabel:label,descendant:'.ant-select-selector'});
      await point(page,lib,args,expected,{selector:'.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',text:value});return;
    }
    if(shape.textInputs===1){stopped(args);const filled=await page.evaluate(templateUiAction,{expected,action:'fill',locator:{formLabel:label,descendant:'input:not([type="search"]):not([type="hidden"]),textarea'},value});if(!filled)throw new Error('模板属性未填写：'+label);return;}
    throw new Error('模板属性控件尚未适配：'+label);
  }
  const resultBase=args=>({platformEditUrl:args.row.platformEditUrl,published:false});
  async function savePrepared(page,lib,args,expected,current,rules,issues=[],priceEvidence){
    if(typeof args.beforeSave!=='function')throw new Error('缺少保存前持久化钩子，未提交保存');
    const intent={version:priceEvidence?2:1,url:expected.url,goodsId:args.row.goodsId,storeBindingKey:args.storeBinding.key,templateId:args.templateSnapshot.id,templateVersion:args.templateSnapshot.version,saveMode:rules.saveMode,readinessIssues:issues,expectedSnapshot:templateSaveSnapshot(current),...(priceEvidence?{priceEvidence}:{}),createdAt:now()};
    stopped(args);await args.beforeSave(copy(intent));stopped(args);
    await point(page,lib,args,expected,{selector:'button',text:'保存',index:0});
    // A missing toast never permits a second save. Reconcile in a new owned
    // tab while the original submission page remains untouched.
    await lib.poll(()=>page.evaluate(()=>[...document.querySelectorAll('.ant-message-notice-content,.ant-modal')].filter(e=>e.getClientRects().length).some(e=>/保存成功|已保存|保存失败/.test(e.textContent))),{timeout:8000,label:'商品保存回执'}).catch(()=>{});
    const verificationArgs={...args,preparationIntent:intent,tabs:undefined,onTarget:undefined};
    return owned(verificationArgs,(readPage,readLib)=>verifyOnPage(readPage,readLib,verificationArgs));
  }
  async function prepareRequired(page,lib,args,expected,initial,current,rules){
    const binding=args.storeBinding,defaults=Object.fromEntries(rules.attributes.map(({label,value})=>[label,value]));
    const read=async()=>{const state=await page.evaluate(readTemuListing,expected);state.requiredFields=await page.evaluate(readRequiredFields,{expected});state.categoryPath=await page.evaluate(readTemplateCategoryPath);return state;};
    current=await read();
    if(binding.warehouse&&!current.warehouses.length){
      await point(page,lib,args,expected,{selector:'.in-selector.ant-select-multiple.ant-select-allow-clear .ant-select-selector'});
      await point(page,lib,args,expected,{selector:'.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',text:binding.warehouse});
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      current=await lib.poll(async()=>{const state=await read();return state.warehouses.includes(binding.warehouse)?state:null;},{timeout:30000,label:'已绑定仓库加载'});
    }
    const configured=[...rules.attributes.map(({label,value})=>[label,value]),['运费模板',binding.shippingTemplate],['承诺发货时效',binding.dispatch]];
    for(const [label,value] of configured){
      if(!value)continue;
      const field=current.requiredFields.fields.find(field=>field.label===label),item=current.items.find(item=>item.label===label);
      const blank=item&&!selected(item).length&&!item.controls.some(control=>String(control.value??'').trim());
      if(!blank||field?.protected||!(field?.required||item.required||['运费模板','承诺发货时效'].includes(label)))continue;
      // Custom selectors require an actual option click. Native controls are
      // filled by the same guarded plan as the remaining dynamic attributes.
      if(field?.kind==='combobox'||['运费模板','承诺发货时效'].includes(label)){await chooseField(page,lib,args,expected,label,value,current);current=await read();}
    }
    const sourceValues=typeof args.row.title==='string'?{title:args.row.title,产品标题:args.row.title}:{},choiceChanges=[],choiceIssues=[];
    const choose=async()=>{const result=await completeOrdinaryChoices({page,poll:lib.poll,expected,defaults,sourceValues,isStopped:args.isStopped,validateIdentity:()=>page.evaluate(readTemuListing,expected)});choiceChanges.push(...result.changes);choiceIssues.splice(0,choiceIssues.length,...result.issues);};
    const pricing=await sourcePriceContext(args,current.requiredFields);await choose();
    const completion=await completeRequiredFields({page,expected,defaults,sourceValues,allowOrdinaryDefaults:true,isStopped:args.isStopped,
      pricePlanFor:fields=>validateExistingDxmPrices(fields,pricing.plan),
      validateIdentity:async()=>{const state=await read(),issues=templateRequiredPreservationIssues(initial,state);if(issues.length)throw new Error(issues.join('；'));},
      afterWrite:async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await choose();}
    });
    current=await read();
    const priceEvidence=sourcePriceEvidence(pricing,current.requiredFields);
    const categoryIssues=categoryPathMatches(await page.evaluate(readTemplateCategoryPath),rules.category.path)?[]:['实际分类与用户选择的完整路径不一致'];
    const issues=[...new Set([...templateRequiredPreservationIssues(initial,current),...categoryIssues,...completion.issues,...choiceIssues,...priceEvidence.issues,...listingReadiness(current)])];
    const details={changes:[...completion.changes,...choiceChanges],rounds:completion.rounds,unresolved:completion.unresolved||[]};
    if(issues.length||args.dryRun)return {...resultBase(args),status:issues.length?'needs-review':'ready-to-save',ready:false,readyToSave:!issues.length,saved:false,saveOutcome:'not-saved',issues,snapshot:current,priceEvidence,requiredCompletion:details};
    return {...await savePrepared(page,lib,args,expected,current,rules,[],priceEvidence),requiredCompletion:details,priceEvidence};
  }
  async function prepare(args){
    if(args.templateSnapshot?.platform!=='temu')return {...resultBase(args),status:'unsupported',saved:false,ready:false,saveOutcome:'not-saved',issues:['该平台固定模板填写尚未接入']};
    const rules=templateRules(args.templateSnapshot,args.storeBinding);
    if(rules.autoFillRequired&&(args.templateSnapshot.workflowMode!=='required-fields'||args.templateSnapshot.completionMode!=='pending'||args.workflowMode!==undefined&&args.workflowMode!=='required-fields'||args.completionMode!==undefined&&args.completionMode!=='pending'))rules.issues.push('必填项自动补全仅允许在补必填并进入待发布的流程中使用');
    if(rules.autoFillRequired&&!rules.category.path?.length)rules.issues.push('请先在工作台选择该平台的正确产品分类');
    if(rules.issues.length)return {...resultBase(args),status:'needs-review',saved:false,ready:false,saveOutcome:'not-saved',issues:rules.issues};
    return owned(args,async(page,lib)=>{
      const {expected,snapshot:initial,loadingIssues}=await editor(page,lib,args,args.row,args.storeBinding);
      if(loadingIssues.length)return {...resultBase(args),status:'needs-review',ready:false,saved:false,saveOutcome:'not-saved',issues:loadingIssues,snapshot:initial};
      if(rules.autoFillRequired)initial.requiredFields=await page.evaluate(readRequiredFields,{expected});
      let baseline=initial,current=initial;
      const categoryPath=rules.category.path||[],category=categoryValues(initial);
      if(categoryPath.length){
        let replace=false;
        if(category.length){
          const actual=await page.evaluate(readTemplateCategoryPath);
          replace=!categoryPathMatches(actual,categoryPath);
          if(replace&&rules.categoryMode!=='replace')return {...resultBase(args),status:'needs-review',ready:false,saved:false,saveOutcome:'not-saved',issues:['已有商品分类未与模板完整路径匹配，未覆盖已有分类'],snapshot:initial};
        }
        if(!category.length||replace){
          await point(page,lib,args,expected,{formLabel:'产品分类',descendant:'button',text:'选择分类'});
          for(const [categoryDepth,text] of categoryPath.entries()){
            await lib.poll(async()=>{const state=await page.evaluate(readCategoryDialog);return state?.boxes[categoryDepth]?.includes(text);},{timeout:30000,label:'分类选项：'+text});
            await point(page,lib,args,expected,{categoryDepth,text});
          }
          const catalog=await page.evaluate(readDxmCategoryCatalog,{expected});
          if(catalog?.pathIssues?.length||!categoryPathMatches((await page.evaluate(readCategoryDialog))?.path,categoryPath,{columns:catalog?.columns?.length?catalog.columns:undefined,pathIds:catalog?.pathIds}))throw new Error(catalog?.pathIssues?.map(issue=>issue.message).join('；')||'分类完整路径不一致，未选择');
          await point(page,lib,args,expected,{selector:'.ant-modal button',text:'选择'});
          try{
            await lib.poll(async()=>{const snapshot=await page.evaluate(readTemuListing,expected);return selected(snapshot.items.find(item=>item.label==='产品分类')).includes(categoryPath.at(-1))&&snapshot.fields.variationSku.length?snapshot:null;},{timeout:60000,label:'分类和原有SKU加载'});
          }catch(error){
            stopped(args);const snapshot=await page.evaluate(readTemuListing,expected);
            if(selected(snapshot.items.find(item=>item.label==='产品分类')).includes(categoryPath.at(-1))&&!snapshot.fields.variationSku.length)return {...resultBase(args),status:'needs-review',ready:false,saved:false,saveOutcome:'not-saved',issues:['已选择模板分类，但SKU仍未加载，无法核对每个规格的价格、包装尺寸、重量和库存；请先核对或补齐商品变种资料',...listingReadiness(snapshot)],snapshot};
            throw error;
          }
          current=await page.evaluate(readTemuListing,expected);
          if(!categoryPathMatches(await page.evaluate(readTemplateCategoryPath),categoryPath))throw new Error('分类修改后完整路径不一致，未保存');
          const issues=(rules.autoFillRequired?templateRequiredPreservationIssues:templatePreservationIssues)(initial,current);if(issues.length)throw new Error(issues.join('；'));
          baseline=current;
        }
      }
      if(rules.autoFillRequired)return prepareRequired(page,lib,args,expected,initial,current,rules);
      for(const attribute of rules.attributes){await chooseField(page,lib,args,expected,attribute.label,attribute.value,current);current=await page.evaluate(readTemuListing,expected);}
      const binding=args.storeBinding;
      if(binding.warehouse&&!current.warehouses.includes(binding.warehouse)){
        if(current.warehouses.length)throw new Error('商品已有其他仓库，未覆盖原仓库库存');
        await point(page,lib,args,expected,{selector:'.in-selector.ant-select-multiple.ant-select-allow-clear .ant-select-selector'});
        await point(page,lib,args,expected,{selector:'.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',text:binding.warehouse});
        await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await lib.poll(async()=>{const state=await page.evaluate(readTemuListing,expected);return state.warehouses.includes(binding.warehouse)?state:null;},{timeout:30000,label:'仓库选择完成'});
        current=await page.evaluate(readTemuListing,expected);
      }
      for(const [label,value] of [['运费模板',binding.shippingTemplate],['承诺发货时效',binding.dispatch]])if(value){await chooseField(page,lib,args,expected,label,value,current);current=await page.evaluate(readTemuListing,expected);}
      current=await lib.poll(async()=>{const state=await page.evaluate(readTemuListing,expected);return templateConfigurationIssues(state,rules,binding).length?null:state;},{timeout:15000,label:'模板配置完整生效'});
      const beforeBulkIssues=templatePreservationIssues(baseline,current);
      if(beforeBulkIssues.length)throw new Error(beforeBulkIssues.join('；'));
      const units=rules.packageDefaults?await page.evaluate(readPackageUnits):null,skuPlan=templateSkuPlan(current,rules,binding,units);
      if(skuPlan.issues.length)return {...resultBase(args),status:'needs-review',ready:false,saved:false,saveOutcome:'not-saved',issues:skuPlan.issues,snapshot:current};
      if(Object.keys(skuPlan.values).length){
        stopped(args);await page.evaluate(fillTemplateSkuFields,{expected,plan:skuPlan});stopped(args);
        current=await lib.poll(async()=>{const snapshot=await page.evaluate(readTemuListing,expected);return templateSkuValueIssues(snapshot,skuPlan).length?null:snapshot;},{timeout:15000,label:'每个SKU的包装和库存回读'});
      }
      const protectionIssues=[...templatePreservationIssues(baseline,current,Object.keys(skuPlan.values)),...templateConfigurationIssues(current,rules,binding),...templateSkuValueIssues(current,skuPlan)];
      const completenessIssues=listingReadiness(current),issues=[...new Set([...protectionIssues,...completenessIssues])];
      // Only packaging has an explicit post-save correction path. Other
      // missing facts must be completed before saving so the task can recover
      // without adopting unrelated edits or silently rewriting its baseline.
      const requiredBeforeSave=rules.saveMode==='draft'?completenessIssues.filter(issue=>!/^SKU (skuLength|skuWidth|skuHeight|weight)不完整$/.test(issue)):completenessIssues;
      const canSave=!protectionIssues.length&&!requiredBeforeSave.length;
      if(!canSave||args.dryRun)return {...resultBase(args),status:issues.length?'needs-review':'ready-to-save',ready:false,readyToSave:canSave,saved:false,saveOutcome:'not-saved',issues,snapshot:current};
      return savePrepared(page,lib,args,expected,current,rules,issues);
    });
  }
  async function verifyOnPage(page,lib,args){
    const intent=args.preparationIntent||args.row.saveIntent?.payload;
    const base={...resultBase(args),status:'needs-review',ready:false,saved:null,saveOutcome:'unknown'};
    if(!intent?.expectedSnapshot||intent.url!==args.row.platformEditUrl||String(intent.goodsId)!==String(args.row.goodsId)||intent.storeBindingKey!==args.storeBinding.key)return {...base,issues:['缺少与本商品及店铺一致的保存前快照，未推定保存成功']};
    const {expected}=await editor(page,lib,args,args.row,args.storeBinding);
    let snapshot;
    try{snapshot=await lib.poll(async()=>{const value=await page.evaluate(readTemuListing,expected);if(intent.expectedSnapshot.requiredFields)value.requiredFields=await page.evaluate(readRequiredFields,{expected});if(intent.expectedSnapshot.categoryPath)value.categoryPath=await page.evaluate(readTemplateCategoryPath);return templateSaveSnapshotsMatch(value,intent.expectedSnapshot)?value:null;},{timeout:30000,label:'保存后独立回读完整快照'});}
    catch{return {...base,issues:['保存后回读与提交前快照不一致，未重新保存']};}
    const required=snapshot.requiredFields?planRequiredFields(snapshot.requiredFields):null;
    const strictPrice=!!intent.priceEvidence||args.templateSnapshot.workflowMode==='required-fields'||intent.expectedSnapshot.requiredFields&&(args.workflowMode==='required-fields'||args.templateSnapshot.rules?.autoFillRequired===true),priceIssues=strictPrice?verifySourcePriceEvidence(snapshot.requiredFields,intent.priceEvidence,{goodsId:args.row.goodsId,platform:'temu'}).issues:[];
    const categoryIssues=intent.expectedSnapshot.categoryPath&&!categoryPathMatches(snapshot.categoryPath,args.templateSnapshot.category.path)?['保存后分类完整路径不一致']:[];
    const issues=[...new Set([...listingReadiness(snapshot),...(required?.issues||[]),...(required?.missing||[]).map(field=>'必填项仍未完成：'+field.label),...priceIssues,...categoryIssues])];
    return {...resultBase(args),status:issues.length?'needs-review':'prepared',saved:true,ready:!issues.length,saveOutcome:'saved',issues,snapshot,...(intent.priceEvidence?{priceEvidence:intent.priceEvidence}:{}),
      verification:{checkedAt:now(),method:'persisted-template-snapshot',draftId:new URL(expected.url).searchParams.get('id'),goodsId:args.row.goodsId,storeBindingKey:args.storeBinding.key,templateId:intent.templateId,templateVersion:intent.templateVersion,readOnly:true,publicationAccepted:false}};
  }
  async function verify(args){
    if(args.templateSnapshot?.platform!=='temu')return {...resultBase(args),status:'unsupported',saved:null,ready:false,saveOutcome:'unknown',issues:['该平台固定模板核对尚未接入']};
    return owned(args,(page,lib)=>verifyOnPage(page,lib,args));
  }
  async function readCategories(args){
    if(args.templateSnapshot?.platform!=='temu')throw new Error('此分类读取器仅支持Temu');
    const parent=args.path??[];
    if(!Array.isArray(parent)||parent.length>16||parent.some(label=>typeof label!=='string'||!label.trim()))throw new Error('分类路径无效');
    // Catalog browsing gets a disposable owned tab, so it cannot disturb an
    // in-progress form or leave a category selection applied to a product.
    const catalogArgs={...args,tabs:undefined,onTarget:undefined};
    return owned(catalogArgs,async(page,lib)=>{
      const {expected}=await editor(page,lib,catalogArgs,args.row,args.storeBinding);
      await point(page,lib,catalogArgs,expected,{formLabel:'产品分类',descendant:'button',text:'选择分类'});
      const catalog=await browseDxmCategoryCatalog({page,poll:lib.poll,point:locator=>point(page,lib,catalogArgs,expected,locator),expected,path:parent,isStopped:args.isStopped});
      await page.evaluate(readTemuListing,expected);
      return {platform:'temu',account:expected.account,storeBindingKey:args.storeBinding.key,...catalog};
    });
  }
  async function reviewCorrections(args){
    const intent=args.preparationIntent||args.row.saveIntent?.payload;
    const declined=issues=>({...resultBase(args),status:'needs-review',reviewAccepted:false,ready:false,saved:null,issues});
    if(args.templateSnapshot?.platform!=='temu')return declined(['该平台包装修改核对尚未接入']);
    if(!intent?.expectedSnapshot||intent.url!==args.row.platformEditUrl||String(intent.goodsId)!==String(args.row.goodsId)||intent.storeBindingKey!==args.storeBinding.key)return declined(['缺少与本商品及店铺一致的已保存快照']);
    return owned(args,async(page,lib)=>{
      const {snapshot,loadingIssues}=await editor(page,lib,args,args.row,args.storeBinding);
      if(loadingIssues.length)return declined(loadingIssues);
      const expectedSnapshot=templateSaveSnapshot(snapshot),original=intent.expectedSnapshot;
      const stripped=value=>{const result=copy(value);for(const name of packageFieldNames)delete result.fields[name];for(const item of result.items)for(const control of item.controls)if(packageFieldNames.includes(control.name))control.value='[包装修改]';return result;};
      if(!isDeepStrictEqual(stripped(original),stripped(expectedSnapshot)))return declined(['除包装尺寸和重量外还有其他资料变化，请先核对；未接纳新的保存快照']);
      const count=snapshot.fields.variationSku.length;
      if(!count||packageFieldNames.some(name=>snapshot.fields[name]?.length!==count||snapshot.fields[name].some(value=>!String(value).trim()||!Number.isFinite(Number(value))||Number(value)<=0)))return declined(['每个SKU的包装尺寸和重量需要完整且大于0']);
      const units=await page.evaluate(readPackageUnits);
      if(units.dimension!=='cm'||!['kg','g'].includes(units.weight))return declined(['无法确认修改后的包装尺寸和重量单位']);
      const issues=listingReadiness(snapshot);
      return {...resultBase(args),status:issues.length?'needs-review':'prepared',reviewAccepted:true,readOnly:true,saved:true,ready:!issues.length,issues,snapshot,expectedSnapshot,verification:{method:'manual-package-correction-readback',checkedAt:now(),readOnly:true}};
    });
  }
  return {inspect,prepare,verify,readCategories,reviewCorrections,capabilities:{inspect:true,prepare:true,verify:true,readCategories:true,reviewCorrections:true,publish:false,platforms:['temu']}};
}
