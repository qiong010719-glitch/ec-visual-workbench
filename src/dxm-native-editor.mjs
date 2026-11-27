import {isDeepStrictEqual} from 'node:util';
import {NATIVE_FIELD_POLICY,validateNativeBatchWritePlan} from './dxm-native-fields.mjs';
import {categoryPathMatches} from './dxm-category-browser.mjs';
import {captureExistingDxmPrices,isPriceField,variantSignature} from './listing-field-policy.mjs';

export const SHEIN_NATIVE_BATCH_PATH='/web/sheinProduct/batchEdit';
// Grounded in the public batchEdit-D2b2p61T / batchEdit-B9mSwW7d /
// SourceImagePreView-CbhHtAUz components. These are separate capabilities:
// reading every displayed table cell does not prove category-attribute coverage.
export const NATIVE_EDITOR_CAPABILITIES=Object.freeze({nativeTableRead:true,nativeTableFill:false,nativeRequiredAttributes:false,nativePrepare:false,nativeSave:false,nativePending:false});

function nativeEditorRuntime({action='read',expected={},locator={},scroll=true,write}={}){
  const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
  const visible=element=>{if(!element?.getClientRects().length)return false;for(let node=element;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.getAttribute('aria-hidden')==='true'||style.visibility==='hidden'||style.display==='none')return false;}return true;};
  const account=tidy(document.querySelector('.btn-user .user-name')?.textContent),url=new URL(location.href);
  if(location.href!==expected.url||account!==expected.account||url.origin!=='https://www.dianxiaomi.com'||url.pathname!=='/web/sheinProduct/batchEdit'||url.username||url.password||url.hash)throw new Error('原生批量编辑页面或账号已变化');
  const roots=[...document.querySelectorAll('.shein-batch-edit-table-page')].filter(visible);
  if(roots.length!==1)throw new Error('尚未定位到唯一的 SHEIN 原生批量编辑主表');
  const root=roots[0],scope=expected.scope,issues=[];
  if(!scope||scope.platform!=='shein'||scope.account!==account||!scope.scopeKey||!Array.isArray(scope.rows)||!scope.rows.length)throw new Error('缺少原生批量的明确商品范围');
  const ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean),wanted=scope.rows.map(row=>row.draftId);
  if(ids.length!==wanted.length||new Set(ids).size!==ids.length||ids.some(id=>!wanted.includes(id)))issues.push('原生批量地址的草稿集合与本次任务不一致');
  if(url.searchParams.get('dxmState')==='online')issues.push('当前是在线产品批量更新页面，不属于本批草稿范围');
  const loading=[...document.querySelectorAll('.d-page-loading,.ant-spin-spinning,.vxe-loading.is--visible')].some(visible);
  const modals=[...document.querySelectorAll('.ant-modal-wrap,.ant-modal,[role="dialog"]')].filter(visible);
  if(modals.length)issues.push('原生批量页面仍有弹窗，不能把弹窗字段当作主表字段');
  const path=element=>{const parts=[];for(let node=element;node&&node!==document.documentElement;node=node.parentElement){if(node.id&&document.querySelectorAll('#'+CSS.escape(node.id)).length===1){parts.unshift('#'+CSS.escape(node.id));break;}const siblings=[...node.parentElement?.children||[]].filter(item=>item.tagName===node.tagName);parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(node)+1)+')');}return parts.join(' > ');};
  const point=element=>{if(scroll)element.scrollIntoView({block:'center',inline:'center'});if(!visible(element)||element.disabled||element.getAttribute('aria-disabled')==='true')throw new Error('原生批量操作控件不可用');const rect=element.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,top=document.elementFromPoint(x,y);if(top!==element&&!element.contains(top))throw new Error('原生批量操作控件被其他界面遮挡');return {x,y,selector:path(element),text:tidy(element.textContent)};};
  const fieldElement=selector=>{const elements=[...document.querySelectorAll(selector||'')].filter(visible);if(elements.length!==1||!root.contains(elements[0]))throw new Error('原生批量字段不唯一或已离开主表');return elements[0];};
  if(action==='point'){
    if(issues.length||loading)throw new Error(issues.join('；')||'原生批量页面仍在加载');
    if(locator.text==='保存'){
      const buttons=[...root.querySelectorAll('.action button.button.btn-orange')].filter(button=>visible(button)&&tidy(button.textContent)==='保存');
      if(buttons.length!==1)throw new Error('未找到唯一的原生批量“保存”按钮');
      return point(buttons[0]);
    }
    if(locator.text)throw new Error('此原生批量操作尚无已观察的按钮映射');
    return point(fieldElement(locator.selector));
  }
  if(action==='choices'){
    if(issues.length||loading)throw new Error(issues.join('；')||'原生批量页面仍在加载');
    const element=fieldElement(locator.selector),combo=element.matches('[role="combobox"]')?element:element.querySelector('[role="combobox"]');
    if(!combo)throw new Error('当前字段不是已识别的原生选择框');
    const listId=combo.getAttribute('aria-controls')||combo.getAttribute('aria-owns'),list=listId&&document.getElementById(listId);
    if(!list||!visible(list))return {open:false,options:[],issues:['选择框选项尚未展开']};
    const options=[...list.querySelectorAll('[role="option"]')].filter(visible).map(option=>({value:option.getAttribute('data-value'),label:tidy(option.getAttribute('aria-label')||option.textContent),disabled:option.getAttribute('aria-disabled')==='true',selector:path(option)}));
    // An option's generated DOM id is not a platform enumeration value.
    const invalid=options.some(option=>option.value===null||!option.label)||new Set(options.map(option=>option.value)).size!==options.length;
    return {open:true,options:invalid?[]:options,issues:invalid?['原生选择框未暴露唯一的原始平台选项值']:[]};
  }
  if(action==='write'){
    // No writer is enabled for an incomplete source-only schema. This guard is
    // intentionally before any focus, click, value assignment or event.
    throw new Error('原生主表尚未覆盖完整分类及普通必填属性，未执行填写或保存');
  }
  if(action!=='read')throw new Error('不支持的原生批量读取操作');
  const tables=[...root.querySelectorAll('.batch-table-wrap > table')].filter(visible),members=[],groups=[];
  if(tables.length!==1)issues.push('原生批量商品表格不唯一或尚未加载');
  const rows=tables.length===1?[...tables[0].tBodies].flatMap(body=>[...body.rows]).filter(visible):[];
  if(rows.length!==wanted.length)issues.push('原生批量实际商品行数与本次范围不一致');
  const sourceId=value=>{try{const u=new URL(value);if(u.protocol!=='https:'||!['www.temu.com','temu.com'].includes(u.hostname)||u.username||u.password||u.port)return null;return u.pathname.match(/-g-(\d{6,32})\.html$/)?.[1]||u.searchParams.get('goods_id');}catch{return null;}};
  const columnNames={name:'产品标题',description:'产品描述',supplierCode:'货号',variantThemes:'变种主题',variantName:'变种名称',sku:'变种SKU',supplierArticleNumber:'供方货号',price:'原价',specialPrice:'特价',supplyPrice:'供货价',quantity:'库存',weight:'重量',packageSize:'尺寸(cm)(长*宽*高)'};
  const skuColumns=new Set(['variantName','sku','supplierArticleNumber','price','specialPrice','supplyPrice','quantity','weight','packageSize']);
  const seen=new Set();let tableFieldsComplete=!issues.length&&!loading;
  for(const row of rows){
    const links=[...new Set([...row.querySelectorAll('.source-image-container a[href]')].filter(visible).map(a=>a.href).filter(sourceId))],matches=scope.rows.filter(item=>links.includes(item.sourceUrl)&&links.every(value=>sourceId(value)===item.goodsId));
    const shops=[...new Set([...row.querySelectorAll('.shop-name')].filter(visible).map(node=>tidy(node.textContent).replace(/^[「『]|[」』]$/g,'')))];
    if(matches.length!==1||shops.length!==1||shops[0]!==scope.storeBinding.storeName||seen.has(matches[0]?.draftId)){issues.push('原生商品行缺少唯一来源链接与目标店铺身份，未按行号猜测商品');tableFieldsComplete=false;continue;}
    const member=matches[0];seen.add(member.draftId);
    const cells=new Map();
    for(const [name]of Object.entries(columnNames)){const found=[...row.querySelectorAll('.batch-edit-cell-renderer--'+name)].filter(node=>visible(node)&&node.closest('tr')===row);if(found.length===1)cells.set(name,found[0]);else if(found.length>1){issues.push('同一原生商品行出现重复字段：'+name);tableFieldsComplete=false;}}
    const skuItems=[...cells.get('sku')?.querySelectorAll('.variation-item')||[]].filter(visible),variants=skuItems.map(node=>{const input=node.querySelector('input'),sku=tidy(input?input.value:node.textContent);return {key:sku?'sku:'+sku:'',sku,attributes:[],identitySource:'visible-sku'};});
    if(!variants.length||variants.some(item=>!item.sku)||new Set(variants.map(item=>item.sku)).size!==variants.length){issues.push('原生商品行的完整SKU身份未能唯一读取：'+member.draftId);tableFieldsComplete=false;}
    const category={id:'',path:[],leaf:false,pathIssues:['已观察的原生主表未显示完整产品分类路径']};
    members.push({...member,storeName:shops[0],site:'',category,variants,identityEvidence:'visible-source-url-and-requested-draft-set'});
    const fields=[];
    for(const [name,cell]of cells){
      const variant=skuColumns.has(name),items=variant?[...cell.querySelectorAll('.variation-item')].filter(visible):[cell];
      if(variant&&items.length!==variants.length){issues.push('原生字段未完整对应每个SKU：'+member.draftId+' / '+columnNames[name]);tableFieldsComplete=false;continue;}
      for(let index=0;index<items.length;index++){
        const node=items[index],controls=[...node.querySelectorAll('input,textarea,select,[role="combobox"]')].filter(visible).filter(control=>!['hidden','password','search'].includes(control.type));
        if(controls.length>1||name==='packageSize'){issues.push('原生复合字段尚未逐项适配：'+columnNames[name]);tableFieldsComplete=false;continue;}
        const control=controls[0],copy=node.cloneNode(true);copy.querySelectorAll('.shop-name,.mode,button,[role="button"],.icon,.attach-icons').forEach(item=>item.remove());
        let value=control?String(control.value??''):tidy(copy.textContent),unit='',kind=control?.tagName==='SELECT'?'select':control?.getAttribute('role')==='combobox'?'combobox':/^(price|specialPrice|supplyPrice|quantity|weight)$/.test(name)?'number':'text';
        const price=/^(price|specialPrice|supplyPrice)$/.test(name);
        if(price&&/^(?:--|—)$/.test(value))continue; // source renderer's non-applicable mode column
        if(price&&!control){const amount=value.match(/^(\d+(?:\.\d+)?)([A-Z]{3})$/);if(amount){value=amount[1];unit=amount[2];}else if(value){issues.push('原生价格金额与币种无法完整读取：'+columnNames[name]);tableFieldsComplete=false;}}
        const selector=path(node),options=kind==='select'?[...control.options].map(option=>({value:option.value,label:tidy(option.textContent),disabled:option.disabled,placeholder:!option.value})):[];
        const target={draftId:member.draftId,variantKey:variant?variants[index]?.key||'':'',value};
        const field={key:selector,selector,name,label:columnNames[name],kind,value,empty:!value.trim(),required:!!control?.required||control?.getAttribute('aria-required')==='true',protected:/^(supplierCode|variantThemes|variantName|sku|supplierArticleNumber)$/.test(name),unit,options,errors:[],targets:[target]};
        for(const attribute of ['min','max','step','pattern','minlength','maxlength'])field[{minlength:'minLength',maxlength:'maxLength'}[attribute]||attribute]=control?.getAttribute(attribute)??null;
        field.shape=JSON.stringify({selector,name,kind,unit,options,target:{draftId:target.draftId,variantKey:target.variantKey}});fields.push(field);
      }
    }
    for(const name of ['name','sku','quantity','weight','price','supplyPrice'])if(!cells.has(name)){issues.push('原生主表字段尚未完整显示：'+columnNames[name]);tableFieldsComplete=false;}
    groups.push({key:'native-row:'+member.draftId,memberIds:[member.draftId],category,complete:false,fields});
  }
  if(seen.size!==wanted.length)tableFieldsComplete=false;
  const coverage={tableFieldsComplete,requiredAttributesComplete:false,categoryPathsComplete:false};
  issues.push('当前原生批量主表未覆盖完整分类及普通类目必填属性，不能据此确认整批资料已补齐');
  return {version:1,surface:'native-batch',platform:'shein',url:location.href,account,scopeKey:scope.scopeKey,complete:false,loading,members,groups,coverage,issues:[...new Set(issues)],sourceEvidence:'public-native-components',liveVerified:false};
}

// Keep every DOM dependency inside the serialized function, as with the other
// owned-page readers. Public component source is never imported or executed.
const serialized=(name,action)=>new Function(`return function ${name}(args){return (${nativeEditorRuntime.toString()})({...${action==='read'?'{expected:args}':'args'},action:${JSON.stringify(action)}});}`)();
export const readNativeEditor=serialized('readNativeEditor','read');
export const nativeEditorUiPoint=serialized('nativeEditorUiPoint','point');
export const readNativeChoiceOptions=serialized('readNativeChoiceOptions','choices');
const writeNativeField=serialized('writeNativeField','write');

export async function ensureNativeChoiceOptions({page,expected,isStopped}={}){
  if(isStopped?.())throw new Error('本批任务已暂停');
  const snapshot=await page.evaluate(readNativeEditor,expected);
  // Opening a variant-theme select can change SKU identity. Until ordinary
  // attribute groups are observed, no such control is opened as a substitute.
  if(!snapshot.complete)return {...snapshot,choiceOptionsReady:false};
  return {...snapshot,choiceOptionsReady:true};
}

export async function applyNativeWrites({page,expected,plan,read,isStopped}={}){
  if(isStopped?.())throw new Error('本批任务已暂停');
  const snapshot=await (read?read():page.evaluate(readNativeEditor,expected));
  if(snapshot?.coverage?.requiredAttributesComplete!==true||snapshot.complete!==true)throw new Error(snapshot?.issues?.join('；')||'原生主表尚未覆盖普通必填属性，未执行填写');
  const checked=validateNativeBatchWritePlan(snapshot,plan,{scope:expected.scope});
  if(!checked.ready)throw new Error(checked.issues.join('；'));
  // Deliberately disabled while nativeRequiredAttributes remains false. An
  // injected callback cannot bypass the source-grounded browser write guard.
  if(plan.writes?.length)return page.evaluate(writeNativeField,{expected,write:plan.writes[0]});
  return {written:0,changes:[]};
}

const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
const empty=value=>value===undefined||value===null||value===''||Array.isArray(value)&&!value.length;
function semantic(field){
  const name=tidy(field.name||field.semanticKey).replace(/[_\s-]/g,'').toLowerCase(),label=tidy(field.label).replace(/[*＊:：]/g,'').replace(/\b[A-Z]{3}\b/g,'').replace(/\s+/g,'').toLowerCase();
  const joined=name+' '+label;
  if(/currency|币种/.test(joined))return 'currency';
  if(/supplyprice|供货价|采购价/.test(joined))return 'supplyPrice';
  if(/specialprice|特价|促销价/.test(joined))return 'specialPrice';
  if(/originalprice|原价|划线价/.test(joined))return 'originalPrice';
  if(/saleprice|sellingprice|售价|销售价/.test(joined))return 'salePrice';
  if(/^(?:name|title|producttitle|productname)$/.test(name)||/^(?:产品标题|商品标题|产品名称|商品名称)$/.test(label))return 'title';
  if(/^(?:stock|quantity|inventory)$/.test(name)||label==='库存')return 'quantity';
  if(/^(?:weight|packageweight)$/.test(name)||/^(?:重量|包装重量)(?:\([^)]*\))?$/.test(label))return 'weight';
  if(/^(?:description|productdescription)$/.test(name)||/^(?:产品描述|商品描述)$/.test(label))return 'description';
  if(/^(?:sku|variationsku)$/.test(name)||/^(?:变种sku|sku)$/.test(label))return 'sku';
  return name||label;
}
const kind=field=>['select','combobox','radio','checkbox-group'].includes(field.kind)?'choice':['number','text','tel'].includes(field.kind)?'scalar':field.kind;
const equalValue=(expected,actual)=>isDeepStrictEqual(expected,actual)||typeof expected==='string'&&typeof actual==='string'&&tidy(expected)===tidy(actual);
const keyOfRow=row=>tidy(row.sku)?'sku:'+tidy(row.sku):Array.isArray(row.attributes)&&row.attributes.length?'attrs:'+variantSignature(row.attributes):row.id?'id:'+row.id:'';
function sameVariant(expected,actual){
  if(expected.sku&&tidy(actual?.sku)!==expected.sku)return false;
  if(expected.attributes?.length&&variantSignature(actual?.attributes)!==variantSignature(expected.attributes))return false;
  return !!expected.sku||expected.attributes?.length>0||expected.identitySource==='single-variant'&&!actual?.sku&&!actual?.attributes?.length;
}
function choiceValueMatches(previous,current){
  if(equalValue(previous.value,current.value))return true;
  if(kind(previous)!=='choice'||!previous.optionEvidence?.length)return false;
  const labels=previous.optionEvidence.map(option=>option.label),actual=Array.isArray(current.value)?current.value:[current.value];
  return isDeepStrictEqual(actual,labels)||current.kind==='combobox'&&tidy(current.value)===labels.join('、');
}

// Independent readback receives a separately loaded single editor. It matches
// semantics plus SKU identity, never transient table selectors/row positions.
// ready proves equality to the persisted intent, not that an ERP save occurred.
export function verifyNativeBatchMemberReadback({editor,fields,expectedSnapshot,priceEvidence,memberPriceEvidence,variantEvidence=fields?.variantEvidence}={}){
  const issues=[],snapshot=expectedSnapshot,member=snapshot?.member;
  const result=()=>({ready:!issues.length,issues:[...new Set(issues)],readOnly:true,fxVerified:false});
  if(snapshot?.policy!==NATIVE_FIELD_POLICY||snapshot.version!==1||!member||!Array.isArray(snapshot.fields)||!snapshot.fields.length||!Array.isArray(member.variants)||!member.variants.length||!Array.isArray(fields?.fields)){issues.push('缺少完整的原生批量保存前商品、字段或SKU记录');return result();}
  let correctUrl=false;
  try{const url=new URL(editor?.url);correctUrl=url.origin==='https://www.dianxiaomi.com'&&url.pathname==='/web/sheinProduct/edit'&&url.searchParams.get('id')===member.draftId&&!url.hash&&!url.username&&!url.password;}catch{}
  if(!correctUrl||fields.url!==editor?.url||editor.account!==snapshot.account||fields.account!==snapshot.account||editor.storeName!==member.storeName||!Array.isArray(editor.sources)||!editor.sources.includes(member.sourceUrl)||editor.sources.some(source=>source!==member.sourceUrl))issues.push('独立回读的商品草稿、账号、店铺或完整来源链接不一致');
  if(member.site&&editor.siteFieldPresent!==false&&tidy(editor.site).replace(/站$/,'')!==tidy(member.site).replace(/站$/,''))issues.push('独立回读的店铺站点未能核实');
  if(member.category?.leaf!==true||member.category?.pathIssues?.length||!member.category?.path?.length||!editor.categoryPath?.length||editor.pathIssues?.length||!categoryPathMatches(editor.categoryPath,member.category.path))issues.push('独立回读的完整末级分类与保存前记录不一致');
  const expectedCategoryId=member.category?.platformCategoryId||member.category?.idKind==='platform'&&member.category?.id;
  const currentCategoryId=editor.platformCategoryId||editor.category?.platformCategoryId||(editor.category?.idKind==='platform'?editor.category.id:null);
  if(expectedCategoryId&&String(currentCategoryId||'')!==String(expectedCategoryId))issues.push('已确认的平台分类ID未能在独立编辑页匹配，未降级为仅比较分类名称');
  const actualFields=fields.fields,actualRows=new Map();
  for(const field of actualFields){const row=field.rowIdentity;if(!row)continue;const key=keyOfRow(row);if(!key)continue;const list=actualRows.get(key)||[];list.push(row);actualRows.set(key,list);}
  const actualVariants=[...actualRows.values()].map(rows=>rows[0]);
  for(const rows of actualRows.values())if(new Set(rows.map(row=>tidy(row.id)).filter(Boolean)).size>1||rows.some(row=>tidy(row.sku)!==tidy(rows[0].sku)||variantSignature(row.attributes)!==variantSignature(rows[0].attributes)))issues.push('同一SKU出现重复行或相互冲突的规格');
  const variantRows=new Map();
  for(const variant of member.variants){let matches=actualVariants.filter(row=>sameVariant(variant,row));if(!actualVariants.length&&member.variants.length===1&&variant.identitySource==='single-variant')matches=[null];if(matches.length!==1){issues.push('未能唯一回读保存前SKU：'+(variant.sku||variant.key));continue;}variantRows.set(variant.key,matches[0]);}
  if(actualVariants.length&&actualVariants.length!==member.variants.length||actualVariants.some(row=>member.variants.filter(variant=>sameVariant(variant,row)).length!==1))issues.push('保存后的完整SKU集合与本批记录不一致');
  const full=variantEvidence;
  if(full?.policy!=='visible-sku-table-v1'||full.complete!==true||full.priceFieldsComplete!==true||full.url!==editor.url||full.account!==snapshot.account||full.issues?.length||!Array.isArray(full.variants)||full.count!==full.variants.length||full.count!==member.variants.length){
    issues.push('独立回读尚未证明完整SKU与价格控件范围，隐藏、停用或分页行不能视为不存在');
  }else{
    const witnessed=new Set();
    for(const witness of full.variants){
      const matches=member.variants.filter(variant=>sameVariant(variant,witness)),actual=actualVariants.filter(row=>tidy(row.sku)===tidy(witness.sku)&&variantSignature(row.attributes||[])===variantSignature(witness.attributes||[]));
      if(matches.length!==1||witnessed.has(matches[0]?.key)||actual.length!==1||witness.rowId&&actual[0]?.id&&tidy(witness.rowId)!==tidy(actual[0].id))issues.push('完整SKU证据与保存前成员或当前价格行不一致');
      else witnessed.add(matches[0].key);
    }
    if(witnessed.size!==member.variants.length)issues.push('完整SKU证据未覆盖本件商品的全部变种');
  }
  const mappings=new Map(),used=new Set();
  for(const previous of snapshot.fields){
    const row=previous.variantKey?variantRows.get(previous.variantKey):undefined;
    const matches=actualFields.filter(current=>semantic(current)===semantic(previous)&&kind(current)===kind(previous)&&(previous.variantKey?variantRows.has(previous.variantKey)&&(row?current.rowIdentity&&keyOfRow(current.rowIdentity)===keyOfRow(row):!current.rowIdentity||!keyOfRow(current.rowIdentity)):!current.rowIdentity||!keyOfRow(current.rowIdentity)));
    if(matches.length!==1||used.has(matches[0])){issues.push('字段无法与独立编辑页唯一对应：'+(previous.label||previous.name));continue;}
    const current=matches[0];used.add(current);mappings.set(previous,current);
    if(!previous.price&&!choiceValueMatches(previous,current))issues.push('保存前后已有内容或本次填写内容不同：'+(previous.label||previous.name));
  }
  for(const field of actualFields){if(field.errors?.length)issues.push((field.label||field.name)+'：'+field.errors.join('；'));if(field.required&&(field.empty||empty(field.value)))issues.push('独立回读仍有必填项为空：'+(field.label||field.name));}
  const expectedPriceFields=snapshot.fields.filter(field=>field.price),actualPriceFields=actualFields.filter(isPriceField);
  if(!expectedPriceFields.length||actualPriceFields.length!==expectedPriceFields.length||actualPriceFields.some(field=>!used.has(field)))issues.push('独立回读的整件商品价格字段范围与保存前不一致');
  const proofs=[...(Array.isArray(priceEvidence)?priceEvidence:[]),...(memberPriceEvidence?[memberPriceEvidence]:[])];
  if(!Array.isArray(priceEvidence)||priceEvidence.length!==member.variants.length||new Set(priceEvidence?.map(proof=>proof.variantKey)).size!==member.variants.length||!memberPriceEvidence)issues.push('缺少整件商品和每个SKU的独立价格证据');
  for(const proof of proofs){
    const evidence=proof.evidence,variant=proof.variantKey?member.variants.find(item=>item.key===proof.variantKey):null;
    if(proof.draftId!==member.draftId||proof.variantKey&&!variant||evidence?.policy!=='preserve-dxm-converted'||evidence.ready!==true||evidence.goodsId!==member.goodsId||evidence.url!==snapshot.url||evidence.account!==snapshot.account||!evidence.prices?.length){issues.push('保存前的店小秘价格证据不完整或不属于本商品');continue;}
    const expectedForProof=expectedPriceFields.filter(field=>!variant||field.variantKey===variant.key||!field.variantKey&&member.variants.length===1),matchedProofs=new Set();
    for(const previous of expectedForProof){
      const v=member.variants.find(item=>item.key===previous.variantKey),matches=evidence.prices.filter(price=>semantic(price)===semantic(previous)&&kind(price)===kind(previous)&&(v?sameVariant(v,price.row):!price.row?.sku&&!price.row?.attributes?.length));
      if(matches.length!==1||matchedProofs.has(matches[0])){issues.push('保存前整品与SKU价格证据不能唯一对应：'+(previous.label||previous.name));continue;}
      const old=matches[0],current=mappings.get(previous);matchedProofs.add(old);if(!current)continue;
      const captured=captureExistingDxmPrices({url:editor.url,account:editor.account,fields:[current]},{platform:'shein',goodsId:member.goodsId}),now=captured.prices[0];
      if(!old.matched||!now||!now.matched||old.currencyOnly!==now.currencyOnly||old.currency!==now.currency||old.unit!==now.unit||!(old.currencyOnly?equalValue(old.expectedValue,now.expectedValue):old.blank&&now.blank||old.amount!==null&&old.amount===now.amount))issues.push('店小秘原有价格、币种或规格发生变化：'+(previous.label||previous.name));
    }
    if(matchedProofs.size!==evidence.prices.length||expectedForProof.length!==evidence.prices.length)issues.push('保存前价格证据与完整字段范围不一致');
  }
  return result();
}
