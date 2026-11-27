import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {nativeBatchScope} from './dxm-native-batch.mjs';
import {categoryPathMatches} from './dxm-category-browser.mjs';
import {planRequiredFields,ordinaryFieldDefault} from './dxm-required-fields.mjs';
import {captureExistingDxmPrices,validateExistingDxmPrices,isPriceField,variantSignature} from './listing-field-policy.mjs';

export const NATIVE_FIELD_POLICY='native-batch-preserve-fields-v1';
const clone=value=>structuredClone(value),tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const empty=value=>value===null||value===undefined||typeof value==='string'&&!value.trim()||Array.isArray(value)&&!value.length||value===false;
const site=value=>tidy(value).replace(/站$/,'');
const protectedField=field=>!!field.protected||/(?:category|brand|trademark|certificat|licen[cs]e|consent|agreement|privacy|captcha|password|token|secret|source.?url|variant|variation|currency|\bsku\b|分类|类目|品牌|商标|认证|资质|声明|协议|同意|密码|密钥|来源|店铺|账号|站点|货号|条形码|币种|币别)/i.test([field.name,field.id,field.label].join(' '));
const targetId=target=>String(target.draftId)+'\u001f'+String(target.variantKey||'');
const byKey=(a,b)=>a.key.localeCompare(b.key);
const defaultTexts=Object.freeze({en:'Other',zh:'其他',ja:'その他',ko:'기타',fr:'Autre',es:'Otro',de:'Sonstige',it:'Altro',pt:'Outro',nl:'Overig',pl:'Inne',tr:'Diğer',ar:'أخرى',th:'อื่น ๆ',vi:'Khác',id:'Lainnya'});
const language=value=>tidy(value).toLowerCase().split(/[-_]/)[0];
const candidateToken=value=>/^(?:path:|dxm-search:|candidate:|ui:)/i.test(value);
const category=value=>{
  const id=tidy(value?.id),candidateId=tidy(value?.candidateId)||(candidateToken(id)?id:''),idKind=tidy(value?.idKind),explicit=tidy(value?.platformCategoryId),pathIssues=clone(value?.pathIssues||[]);
  let platformCategoryId=explicit||(!['candidate','observed-path'].includes(idKind)&&!candidateToken(id)?id:'');
  if(candidateToken(platformCategoryId)){pathIssues.push('界面候选或路径标识不能充当平台分类ID');platformCategoryId='';}
  return {id,platformCategoryId:platformCategoryId||null,idKind:platformCategoryId?'platform':idKind||'observed-path',candidateId,path:Array.isArray(value?.path)?value.path.map(tidy):[],leaf:value?.leaf===true,pathIssues};
};
const sameCategory=(left,right)=>left.leaf&&right.leaf&&!left.pathIssues.length&&!right.pathIssues.length&&left.platformCategoryId===right.platformCategoryId&&categoryPathMatches(left.path,right.path);
const meaningfulCategory=value=>value.leaf&&value.path.length>0&&value.path.every(Boolean)&&!value.pathIssues.length;
const scopeOf=value=>{const scope=nativeBatchScope(value);if(value.scopeKey&&value.scopeKey!==scope.scopeKey)throw new Error('原生批量成员范围已经变化');return scope;};
const issueText=(field,message)=>`${field.groupKey} / ${field.label||field.name||'字段'}：${message}`;
function scalar(value){return value===null||typeof value==='string'||typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'||Array.isArray(value)&&value.length<=100&&value.every(item=>typeof item==='string');}
function fieldId(groupKey,field,targets){return JSON.stringify([groupKey,tidy(field.semanticKey||field.name||field.label),field.kind,targets.map(targetId).sort()]);}
function fieldValue(field,target){
  const value=Object.hasOwn(target,'value')?target.value:field.targets.length===1?field.value:undefined;
  if(field.kind==='checkbox'){if(typeof target.checked==='boolean')return target.checked;if(field.targets.length===1&&typeof field.checked==='boolean')return field.checked;if(value!==undefined)return !empty(value);}
  return value;
}
function checkedUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.dianxiaomi.com'&&!url.port&&!url.username&&!url.password&&!url.hash;}catch{return false;}}

// Snapshot contract: visible native groups, exact members and every SKU; each
// actual control has explicit targets [{draftId, variantKey?, value}]. A shared
// control cannot stand in for missing per-product values. This module performs
// no browser navigation, product save, move or publication.
export function captureNativeBatchFieldState(snapshot,{scope:input,expectedUrl}={}){
  const scope=scopeOf(input),issues=[],members=[],groups=[],fields=[],priceEvidence=[],memberPriceEvidence=[];
  const result={version:1,policy:NATIVE_FIELD_POLICY,scope:clone(scope),scopeKey:scope.scopeKey,url:snapshot?.url||'',account:snapshot?.account||'',members,groups,fields,priceEvidence,memberPriceEvidence,ready:false,issues};
  if(snapshot?.surface!=='native-batch'||snapshot.platform!==scope.platform||snapshot.account!==scope.account||snapshot.scopeKey!==scope.scopeKey||!checkedUrl(snapshot.url)||expectedUrl&&snapshot.url!==expectedUrl)issues.push('原生批量表单地址、账号、平台或成员范围不一致');
  if(snapshot?.complete!==true||snapshot?.loading===true)issues.push('原生批量的分组、商品或字段尚未完整读取');
  if(snapshot?.coverage?.requiredAttributesComplete===false)issues.push('当前原生批量主表未覆盖完整分类及普通类目必填属性，不能据此确认整批资料已补齐');
  if(!Array.isArray(snapshot?.members)||!snapshot.members.length||snapshot.members.length>30||!Array.isArray(snapshot?.groups)||!snapshot.groups.length||snapshot.groups.length>30){issues.push('原生批量缺少完整的商品与分组记录');return result;}
  const seenMembers=new Set();
  for(const original of snapshot.members){
    const id=tidy(original.draftId),expected=scope.rows.find(row=>row.draftId===id),itemCategory=category(original.category),variants=[];
    if(!expected||seenMembers.has(id)||original.goodsId!==expected.goodsId||original.sourceUrl!==expected.sourceUrl||original.storeName!==scope.storeBinding.storeName||original.site&&scope.storeBinding.site&&site(original.site)!==site(scope.storeBinding.site))issues.push('原生批量商品的草稿、来源或店铺身份不一致：'+id);
    seenMembers.add(id);
    if(!meaningfulCategory(itemCategory))issues.push('商品分类尚未确认到末级：'+id);
    if(!Array.isArray(original.variants)||!original.variants.length||original.variants.length>500)issues.push('未读取完整的商品变种：'+id);
    else for(const variant of original.variants){
      const key=tidy(variant.key),sku=tidy(variant.sku),attributes=Array.isArray(variant.attributes)?clone(variant.attributes):[];
      const signature=variantSignature(attributes),identitySource=tidy(variant.identitySource);
      const identifiable=!!sku||attributes.length>0&&!!signature||identitySource==='dom-row-id'||original.variants.length===1&&attributes.length===0&&identitySource==='single-variant';
      if(!key||variants.some(item=>item.key===key)||!identifiable)issues.push('SKU缺少唯一且可回读的规格身份：'+id);
      variants.push({key,sku,attributes,identitySource});
    }
    members.push({draftId:id,goodsId:tidy(original.goodsId),sourceUrl:original.sourceUrl,storeName:original.storeName,site:tidy(original.site),category:itemCategory,variants:variants.sort(byKey)});
  }
  if(seenMembers.size!==scope.rows.length||scope.rows.some(row=>!seenMembers.has(row.draftId)))issues.push('原生批量商品成员与本次范围不完整一致');
  const memberGroups=new Map(),seenGroups=new Set(),seenControls=new Set();
  for(const original of snapshot.groups){
    const key=tidy(original.key),groupCategory=category(original.category),ids=Array.isArray(original.memberIds)?original.memberIds.map(String):[];
    if(!key||seenGroups.has(key)||!ids.length||new Set(ids).size!==ids.length||original.complete!==true||original.loading===true)issues.push('原生批量分组不唯一或尚未加载完成：'+key);
    seenGroups.add(key);
    if(!meaningfulCategory(groupCategory))issues.push('分组分类尚未确认到末级：'+key);
    for(const id of ids){const member=members.find(item=>item.draftId===id);if(!member||memberGroups.has(id)||!sameCategory(member.category,groupCategory))issues.push('商品分组或末级分类与本批不一致：'+id);memberGroups.set(id,key);}
    groups.push({key,memberIds:ids.sort(),category:groupCategory});
    if(!Array.isArray(original.fields)||original.fields.length>5000){issues.push('分组字段缺失或超出可完整核对的范围：'+key);continue;}
    for(const raw of original.fields){
      const field={...clone(raw),groupKey:key,targets:[]};
      if(!tidy(raw.key)||!tidy(raw.selector)||!tidy(raw.shape)||!tidy(raw.name||raw.semanticKey||raw.label)||!Array.isArray(raw.targets)||!raw.targets.length||raw.targets.length>15000){issues.push(issueText(field,'控件缺少稳定身份或明确作用范围'));continue;}
      if(seenControls.has(raw.key))issues.push(issueText(field,'多个控件具有相同定位标识'));seenControls.add(raw.key);
      const seenTargets=new Set();
      for(const target of raw.targets){
        const draftId=tidy(target.draftId),variantKey=tidy(target.variantKey),member=members.find(item=>item.draftId===draftId),value=fieldValue(raw,target),identity=targetId({draftId,variantKey});
        if(!member||!ids.includes(draftId)||seenTargets.has(identity)||variantKey&&!member.variants.some(variant=>variant.key===variantKey))issues.push(issueText(field,'控件作用到未知、重复或其他分组的商品/SKU'));
        seenTargets.add(identity);
        if(!scalar(value))issues.push(issueText(field,'未读取到每个受影响商品的实际现有值'));
        field.targets.push({draftId,variantKey,value:scalar(value)?clone(value):null,empty:empty(value)});
      }
      field.targets.sort((a,b)=>targetId(a).localeCompare(targetId(b)));field.identity=fieldId(key,field,field.targets);
      const variantAttribute=field.targets.some(target=>target.variantKey)&&/^(?:color|colour|size|style|model|颜色|色号|尺寸|尺码|款式|规格|型号)$/i.test(tidy(field.name))||field.targets.some(target=>target.variantKey)&&/^(?:color|colour|size|style|model|颜色|色号|尺寸|尺码|款式|规格|型号)$/i.test(tidy(field.label));
      field.protected=protectedField(field)||variantAttribute;field.price=isPriceField(field);field.targets.forEach(target=>{if(target.empty&&field.protected&&field.required)issues.push(issueText(field,'必填身份、品牌或资质缺失，需要真实资料'));});
      if(fields.some(item=>item.identity===field.identity))issues.push(issueText(field,'字段与商品/SKU对应关系不唯一'));
      // Required-field errors on an ordinary blank can be resolved by the
      // authorized fill. Errors attached to existing or protected values need
      // review; no default may replace them.
      if(raw.errors?.length&&(field.protected||field.price||field.targets.some(target=>!target.empty)))issues.push(issueText(field,raw.errors.join('；')));
      fields.push(field);
    }
  }
  if(members.some(member=>!memberGroups.has(member.draftId)))issues.push('存在没有归入任何实际分组的本批商品');
  for(const member of members)for(const variant of member.variants){
    const priceFields=fields.filter(field=>field.price).flatMap(field=>field.targets.filter(target=>target.draftId===member.draftId&&(target.variantKey===variant.key||!target.variantKey&&member.variants.length===1)).map(target=>({...field,key:field.identity+'\u001f'+targetId(target),value:target.value,empty:target.empty,rowIdentity:{sku:variant.sku,attributes:variant.attributes}})));
    const evidence=captureExistingDxmPrices({url:result.url,account:result.account,fields:priceFields},{platform:scope.platform,goodsId:member.goodsId});
    priceEvidence.push({draftId:member.draftId,variantKey:variant.key,evidence});
    issues.push(...evidence.issues.map(message=>`${member.draftId} / ${variant.sku||variant.key}：${message}`));
  }
  // Also lock the product-level amounts and optional price columns. They may
  // coexist with SKU controls and must not disappear between the SKU checks.
  for(const member of members){const evidence=captureExistingDxmPrices(memberPrices(result,member),{platform:scope.platform,goodsId:member.goodsId});memberPriceEvidence.push({draftId:member.draftId,evidence});issues.push(...evidence.issues.map(message=>`${member.draftId}：${message}`));}
  result.members.sort((a,b)=>a.draftId.localeCompare(b.draftId));result.groups.sort(byKey);result.fields.sort((a,b)=>a.identity.localeCompare(b.identity));
  result.issues=[...new Set(issues)];result.ready=!result.issues.length;result.stateKey=hash(stateContent(result));return result;
}

function memberPrices(state,member){return {url:state.url,account:state.account,fields:state.fields.filter(field=>field.price).flatMap(field=>field.targets.filter(target=>target.draftId===member.draftId).map(target=>{const variant=member.variants.find(item=>item.key===target.variantKey);return {...field,key:field.identity+'\u001f'+targetId(target),value:target.value,empty:target.empty,rowIdentity:variant?{sku:variant.sku,attributes:variant.attributes}:null};}))};}

const priceMeaning=price=>{
  const name=tidy(price.name).replace(/[_\s-]/g,'').toLowerCase(),label=tidy(price.label).replace(/\b[A-Z]{3}\b/g,'').replace(/[\s*＊:：()（）]/g,'').toLowerCase(),both=name+' '+label;
  if(/currency|币种/.test(both))return 'currency';
  if(/supplyprice|供货价|采购价/.test(both))return 'supplyPrice';
  if(/specialprice|特价|促销价/.test(both))return 'specialPrice';
  if(/originalprice|原价|划线价/.test(both))return 'originalPrice';
  if(/saleprice|sellingprice|售价|销售价/.test(both))return 'salePrice';
  return name||label;
};
const samePriceRow=(a,b)=>tidy(a?.sku)===tidy(b?.sku)&&variantSignature(a?.attributes||[])===variantSignature(b?.attributes||[]);

// A category change must not reset the price baseline. The original evidence
// belongs to the independently read single editor before any category action.
// Cross-page matching uses semantic field roles and complete SKU identity, not
// selectors, position, a second FX conversion or the newly displayed amount.
export function validateNativeBatchOriginalPrices(snapshot,{scope:input,originalPrices}={}){
  const scope=scopeOf(input),state=captureNativeBatchFieldState(snapshot,{scope}),issues=[...state.issues];
  if(!Array.isArray(originalPrices)||originalPrices.length!==scope.rows.length||new Set(originalPrices.map(item=>item.draftId)).size!==scope.rows.length){issues.push('缺少分类之前本批每件商品的完整原始价格证据');return {ready:false,issues:[...new Set(issues)]};}
  for(const member of state.members){
    const matches=originalPrices.filter(item=>item.draftId===member.draftId),original=matches.length===1?matches[0]:null,evidence=original?.evidence;
    let correctUrl=false;try{const url=new URL(evidence?.url);correctUrl=url.origin==='https://www.dianxiaomi.com'&&url.pathname==='/web/sheinProduct/edit'&&url.searchParams.get('id')===member.draftId&&!url.hash&&!url.username&&!url.password;}catch{}
    if(!original||original.goodsId!==member.goodsId||evidence?.policy!=='preserve-dxm-converted'||evidence.ready!==true||evidence.goodsId!==member.goodsId||evidence.account!==scope.account||!correctUrl||!evidence.prices?.length){issues.push('分类前原始价格记录不完整或不属于该店铺草稿：'+member.draftId);continue;}
    const current=captureExistingDxmPrices(memberPrices(state,member),{platform:scope.platform,goodsId:member.goodsId}),used=new Set();issues.push(...current.issues.map(issue=>member.draftId+'：'+issue));
    for(const old of evidence.prices){
      const found=current.prices.filter(price=>priceMeaning(price)===priceMeaning(old)&&price.currencyOnly===old.currencyOnly&&samePriceRow(price.row,old.row));
      if(found.length!==1||used.has(found[0])){issues.push('分类前后的SKU价格字段无法唯一对应：'+member.draftId+' / '+(old.label||old.name));continue;}
      const now=found[0];used.add(now);
      const equal=old.currencyOnly?isDeepStrictEqual(old.expectedValue,now.expectedValue):old.blank&&now.blank||old.amount!==null&&old.amount===now.amount;
      if(!old.matched||!now.matched||!equal||old.currency!==now.currency||old.unit!==now.unit)issues.push('分类前后店小秘原有价格、币种或规格发生变化，未保存：'+member.draftId+' / '+(old.label||old.name));
    }
    if(used.size!==current.prices.length||current.prices.length!==evidence.prices.length)issues.push('分类前后的整件商品价格范围发生变化：'+member.draftId);
  }
  return {ready:!issues.length,issues:[...new Set(issues)],fxVerified:false};
}
function optionReadbackMatches(field,evidence){
  if(!['select','combobox','radio','checkbox-group'].includes(field.kind))return true;
  if(!Array.isArray(evidence)||!evidence.length)return false;
  const options=field.options?.length?field.options:field.selectedOptions||[];
  return evidence.every(previous=>{const matches=options.filter(option=>option.value===previous.value);return matches.length===1&&!matches[0].disabled&&!matches[0].placeholder&&matches[0].label===previous.label;});
}

function stateContent(state){return {scopeKey:state.scopeKey,url:state.url,account:state.account,members:state.members,groups:state.groups,fields:state.fields.map(field=>({identity:field.identity,key:field.key,selector:field.selector,shape:field.shape,language:field.language,required:field.required,kind:field.kind,options:field.options||[],targets:field.targets,unit:field.unit||'',errors:field.errors||[]}))};}
function identityIssues(current,baseline){
  const issues=[];
  if(baseline?.policy!==NATIVE_FIELD_POLICY||baseline.scopeKey!==current.scopeKey||baseline.url!==current.url||baseline.account!==current.account)return ['批量字段基线不属于当前页面或成员范围'];
  if(current.members.length!==baseline.members.length||current.groups.length!==baseline.groups.length)issues.push('本批商品或分组数量发生变化');
  for(const previous of baseline.members){
    const member=current.members.find(item=>item.draftId===previous.draftId);
    if(!member||member.goodsId!==previous.goodsId||member.sourceUrl!==previous.sourceUrl||member.storeName!==previous.storeName||member.site!==previous.site||!sameCategory(member.category,previous.category)||!isDeepStrictEqual(member.variants,previous.variants))issues.push('商品、分类或完整SKU规格发生变化：'+previous.draftId);
  }
  for(const previous of baseline.groups){const group=current.groups.find(item=>item.key===previous.key);if(!group||!isDeepStrictEqual(group.memberIds,previous.memberIds)||!sameCategory(group.category,previous.category))issues.push('原生批量分组范围或分类发生变化：'+previous.key);}
  return issues;
}

export function validateNativeBatchFieldState(snapshot,baseline,{scope:input=baseline?.scope,expectedWrites=[]}={}){
  const current=captureNativeBatchFieldState(snapshot,{scope:input,expectedUrl:baseline?.url}),issues=[...current.issues,...identityIssues(current,baseline)];
  if(!baseline?.fields||!baseline?.priceEvidence||!baseline?.memberPriceEvidence)return {...current,ready:false,issues:[...new Set([...issues,'缺少完整的原生批量保存前字段基线'])]};
  const writes=new Map();
  for(const write of expectedWrites){
    if(write.policy!==NATIVE_FIELD_POLICY||write.scopeKey!==current.scopeKey||typeof write.identity!=='string'||!Array.isArray(write.targets)){issues.push('批量填写记录缺少本批字段作用范围');continue;}
    const field=current.fields.find(item=>item.identity===write.identity)||baseline.fields.find(item=>item.identity===write.identity);
    const original=baseline.fields.find(item=>item.identity===write.identity);
    if(!field||field.protected||field.price||!isDeepStrictEqual(field.targets.map(targetId),write.targets.map(targetId))||write.targets.some(target=>!Object.hasOwn(target,'previousValue')||!empty(target.previousValue)||original&&original.targets.some(previous=>targetId(previous)===targetId(target)&&(!previous.empty||!isDeepStrictEqual(previous.value,target.previousValue))))){issues.push('填写记录尝试改动价格、已有内容或其他商品');continue;}
    if(writes.has(write.identity)&&!isDeepStrictEqual(writes.get(write.identity).value,write.value))issues.push('同一批量字段存在冲突的填写记录');
    if(!optionReadbackMatches(field,write.optionEvidence))issues.push(issueText(field,'已填写的枚举选项或含义发生变化，无法确认保存内容'));
    writes.set(write.identity,write);
  }
  const locked=new Map([...baseline.fields.map(field=>[field.identity,field]),...current.fields.filter(field=>writes.has(field.identity)).map(field=>[field.identity,baseline.fields.find(item=>item.identity===field.identity)||field])]);
  for(const [identity,previous] of locked){
    const actual=current.fields.find(field=>field.identity===identity),write=writes.get(identity),mustRemain=previous.price||previous.protected||previous.targets.some(target=>!target.empty)||!!write;
    if(!actual){if(mustRemain)issues.push(issueText(previous,'已有字段或已填写字段不再可完整回读'));continue;}
    for(const target of previous.targets){
      // Numeric formatting can change during readback; the SKU price proof
      // below compares exact decimal amounts and the observed currency.
      if(previous.price)continue;
      const now=actual.targets.find(item=>targetId(item)===targetId(target)),expectedValue=write?write.value:target.value;
      if(!now||(!target.empty||write||previous.protected)&&!isDeepStrictEqual(now.value,expectedValue))issues.push(issueText(previous,'现有内容或本次填写结果发生变化'));
    }
  }
  for(const previous of baseline.priceEvidence){
    const actual=current.priceEvidence.find(item=>item.draftId===previous.draftId&&item.variantKey===previous.variantKey);
    if(!actual){issues.push('保存前的SKU价格范围缺失：'+previous.draftId+' / '+previous.variantKey);continue;}
    const member=current.members.find(item=>item.draftId===previous.draftId),variant=member?.variants.find(item=>item.key===previous.variantKey);
    const fields=current.fields.filter(field=>field.price).flatMap(field=>field.targets.filter(target=>target.draftId===previous.draftId&&(target.variantKey===previous.variantKey||!target.variantKey&&member.variants.length===1)).map(target=>({...field,key:field.identity+'\u001f'+targetId(target),value:target.value,empty:target.empty,rowIdentity:{sku:variant.sku,attributes:variant.attributes}})));
    const checked=validateExistingDxmPrices({url:current.url,account:current.account,fields},previous.evidence,{platform:current.scope.platform,goodsId:member.goodsId});
    issues.push(...checked.issues.map(message=>`${previous.draftId} / ${previous.variantKey}：${message}`));
  }
  if(current.priceEvidence.length!==baseline.priceEvidence.length)issues.push('SKU价格范围发生变化，未继续填写或保存');
  for(const previous of baseline.memberPriceEvidence){const member=current.members.find(item=>item.draftId===previous.draftId);if(!member){issues.push('整件商品价格范围缺失：'+previous.draftId);continue;}const checked=validateExistingDxmPrices(memberPrices(current,member),previous.evidence,{platform:current.scope.platform,goodsId:member.goodsId});issues.push(...checked.issues.map(message=>`${previous.draftId}：${message}`));}
  return {...current,ready:!issues.length,issues:[...new Set(issues)]};
}

function lookup(values,field,target){
  const dictionaries=[values?.byMember?.[target.draftId]?.byVariant?.[target.variantKey],values?.byMember?.[target.draftId],values?.byGroup?.[field.groupKey],values];
  for(const dictionary of dictionaries)if(dictionary&&typeof dictionary==='object'&&!Array.isArray(dictionary))for(const key of [field.identity,field.key,field.semanticKey,field.name,field.id,field.label])if(key&&Object.hasOwn(dictionary,key)&&!empty(dictionary[key]))return dictionary[key];
}
function desiredValue(field,options){
  const configured=field.targets.map(target=>lookup(options.sourceValues,field,target)??lookup(options.defaults,field,target));
  if(configured.some(value=>value!==undefined)){
    if(configured.some(value=>value===undefined)||configured.some(value=>!isDeepStrictEqual(value,configured[0])))return {issue:'同一批量控件需要不同内容，请使用可分别填写的行控件'};
    return {value:configured[0],reason:'configured-default'};
  }
  if(!options.allowOrdinaryDefaults)return {};
  if(field.kind==='text'&&!field.numeric&&!['numeric','decimal'].includes(field.inputMode)){
    const code=language(field.language||options.targetLanguage),value=(options.defaultTexts||defaultTexts)[code];
    return value?{value,reason:'language-default',language:code}:{issue:'自由文本的目标语言尚未明确，未填写与目标语言不符的占位词'};
  }
  return {value:ordinaryFieldDefault(field),reason:'ordinary-default'};
}

function textLanguageIssue(field,value,targetLanguage){
  if(field.kind!=='text'||field.numeric||['numeric','decimal'].includes(field.inputMode))return null;
  const code=language(field.language||targetLanguage),text=String(value??'');
  if(!code)return '自由文本的目标语言尚未明确，未把来源语言直接写入';
  const incompatible=code==='en'||['fr','es','de','it','pt','nl','pl','tr','vi','id'].includes(code)?/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Thai}\p{Script=Cyrillic}]/u.test(text):code==='zh'?/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Thai}\p{Script=Cyrillic}]/u.test(text):false;
  return incompatible?'自由文本与目标字段语言不符，需要先使用已核实的翻译内容':null;
}

export function planNativeBatchFields(snapshot,{scope,baseline,expectedWrites=[],defaults={},sourceValues={},allowOrdinaryDefaults=true,fillOptional=true,targetLanguage,defaultTexts:customTexts}={}){
  const current=baseline?validateNativeBatchFieldState(snapshot,baseline,{scope,expectedWrites}):captureNativeBatchFieldState(snapshot,{scope});
  const result={version:1,policy:NATIVE_FIELD_POLICY,scopeKey:current.scopeKey,url:current.url,account:current.account,stateKey:current.stateKey,ready:false,canApply:false,writes:[],missing:[],unresolved:[],issues:[...current.issues],state:current};
  if(!current.ready)return result;
  for(const field of current.fields){
    if(field.price||field.protected||!field.required&&!fillOptional)continue;
    const missing=field.targets.filter(target=>target.empty);if(!missing.length)continue;
    result.missing.push({groupKey:field.groupKey,identity:field.identity,label:field.label,targets:clone(missing)});
    const unresolved=message=>{result.issues.push(issueText(field,message));result.unresolved.push({groupKey:field.groupKey,key:field.key,identity:field.identity,label:field.label,kind:field.kind,targets:clone(missing),message,options:clone(field.options||[])});};
    if(missing.length!==field.targets.length){unresolved('批量控件会覆盖已有内容，需要只作用于空值行的控件');continue;}
    const proposed=desiredValue(field,{defaults,sourceValues,allowOrdinaryDefaults,targetLanguage,defaultTexts:customTexts});
    if(proposed.issue){unresolved(proposed.issue);continue;}
    if(proposed.value===undefined||proposed.value===null){unresolved('没有符合当前字段约束的默认值');continue;}
    const languageIssue=textLanguageIssue(field,proposed.value,targetLanguage);if(languageIssue){unresolved(languageIssue);continue;}
    const input={...field,value:'',empty:true,required:true,protected:false,kind:field.kind==='combobox'?'select':field.kind};
    const checked=planRequiredFields({url:current.url,account:current.account,fields:[input]},{defaults:{[input.key]:proposed.value},allowNumericPlaceholders:false,allowOrdinaryDefaults:false});
    if(checked.writes.length!==1||checked.issues.length){unresolved(checked.issues.join('；')||'填写值未通过平台字段约束');continue;}
    const candidate=checked.writes[0],values=Array.isArray(candidate.value)?candidate.value:[candidate.value];
    const optionEvidence=['select','combobox','radio','checkbox-group'].includes(field.kind)?values.map(value=>({value,label:(field.options||[]).find(option=>option.value===value)?.label||''})):[];
    result.writes.push({...candidate,policy:NATIVE_FIELD_POLICY,scopeKey:current.scopeKey,identity:field.identity,groupKey:field.groupKey,kind:field.kind,reason:proposed.reason,language:proposed.language||language(field.language||targetLanguage),optionEvidence,targets:field.targets.map(target=>({draftId:target.draftId,variantKey:target.variantKey,previousValue:clone(target.value)}))});
  }
  result.issues=[...new Set(result.issues)];result.canApply=result.writes.length>0;result.ready=!result.missing.length&&!result.issues.length;return result;
}

// Re-run this immediately before actual native UI input. A prior plan grants
// no permission to act after an option, field binding or existing value changes.
export function validateNativeBatchWritePlan(snapshot,plan,{scope}={}){
  const state=captureNativeBatchFieldState(snapshot,{scope}),issues=[...state.issues],seen=new Set();
  if(plan?.policy!==NATIVE_FIELD_POLICY||plan.scopeKey!==state.scopeKey||plan.url!==state.url||plan.account!==state.account||plan.stateKey!==state.stateKey||!Array.isArray(plan.writes)||!plan.writes.length||plan.writes.length>5000)return {ready:false,issues:[...issues,'原生批量填写计划或实际控件已经变化']};
  for(const write of plan.writes){
    const field=state.fields.find(item=>item.identity===write.identity);
    if(!field||seen.has(write.identity)||write.policy!==NATIVE_FIELD_POLICY||write.scopeKey!==state.scopeKey||field.key!==write.key||field.selector!==write.selector||field.shape!==write.shape||field.kind!==write.kind||field.groupKey!==write.groupKey||field.price||field.protected||field.targets.some(target=>!target.empty)||!isDeepStrictEqual(field.targets.map(target=>({draftId:target.draftId,variantKey:target.variantKey,previousValue:target.value})),write.targets)){issues.push('原生批量计划将覆盖已有值、保护字段或其他商品');continue;}
    seen.add(write.identity);
    const input={...field,value:'',empty:true,required:true,protected:false,kind:field.kind==='combobox'?'select':field.kind},checked=planRequiredFields({url:state.url,account:state.account,fields:[input]},{defaults:{[field.key]:write.value},allowNumericPlaceholders:false,allowOrdinaryDefaults:false});
    if(checked.writes.length!==1||checked.issues.length||!isDeepStrictEqual(checked.writes[0]?.value,write.value)){issues.push(issueText(field,'计划值不再符合当前平台约束'));continue;}
    const textIssue=textLanguageIssue(field,write.value,write.language);if(textIssue)issues.push(issueText(field,textIssue));
    const values=Array.isArray(write.value)?write.value:[write.value],options=['select','combobox','radio','checkbox-group'].includes(field.kind)?values.map(value=>({value,label:(field.options||[]).find(option=>option.value===value)?.label||''})):[];
    if(!isDeepStrictEqual(options,write.optionEvidence))issues.push(issueText(field,'平台选项值或标签已经变化'));
  }
  return {ready:!issues.length,issues:[...new Set(issues)]};
}

function memberResults(state){return state.members.map(member=>({draftId:member.draftId,goodsId:member.goodsId,expectedSnapshot:{version:1,policy:NATIVE_FIELD_POLICY,scopeKey:state.scopeKey,url:state.url,account:state.account,member:clone(member),fields:state.fields.flatMap(field=>field.targets.filter(target=>target.draftId===member.draftId).map(target=>({identity:field.identity,groupKey:field.groupKey,name:field.name,label:field.label,kind:field.kind,variantKey:target.variantKey,value:clone(target.value),unit:field.unit||'',price:field.price,protected:field.protected,optionEvidence:['select','combobox','radio','checkbox-group'].includes(field.kind)?(field.options?.length?field.options:field.selectedOptions||[]).filter(option=>(Array.isArray(target.value)?target.value:[target.value]).includes(option.value)).map(option=>({value:option.value,label:option.label})):[]})))},priceEvidence:clone(state.priceEvidence.filter(item=>item.draftId===member.draftId)),memberPriceEvidence:clone(state.memberPriceEvidence.find(item=>item.draftId===member.draftId))}));}

// The reader/writer must operate the actual native form. Each invocation of
// apply receives one bounded plan, never a list of per-product edit URLs.
export async function completeNativeBatchFields({read,apply,scope,baseline,defaults,sourceValues,allowOrdinaryDefaults=true,fillOptional=true,targetLanguage,defaultTexts:customTexts,maxRounds=8,maxStableReads=6,isStopped,onProgress,afterWrite}={}){
  if(typeof read!=='function'||typeof apply!=='function')throw new Error('缺少原生批量表单读取与填写实现');
  if(!Number.isSafeInteger(maxRounds)||maxRounds<1||maxRounds>20||!Number.isSafeInteger(maxStableReads)||maxStableReads<2||maxStableReads>20)throw new Error('原生批量联动轮次无效');
  const changes=[],expectedWrites=[];let locked=baseline,snapshot,plan,rounds=0;
  const stop=()=>{if(isStopped?.())throw new Error('已暂停原生批量填写');};
  async function stableRead(){let prior;for(let readIndex=0;readIndex<maxStableReads;readIndex++){stop();const value=await read(),state=captureNativeBatchFieldState(value,{scope,expectedUrl:locked?.url});if(value?.complete===true&&!value.loading&&prior?.state.stateKey===state.stateKey)return {snapshot:value,state};prior={snapshot:value,state};}throw new Error('原生批量联动字段尚未稳定，已保留当前页面');}
  try{
    for(let round=0;round<=maxRounds;round++){
      const stable=await stableRead();snapshot=stable.snapshot;locked||=stable.state;
      plan=planNativeBatchFields(snapshot,{scope,baseline:locked,expectedWrites,defaults,sourceValues,allowOrdinaryDefaults,fillOptional,targetLanguage,defaultTexts:customTexts});
      if(plan.ready)return {completed:true,ready:true,rounds,changes,snapshot,expectedSnapshot:plan.state,priceEvidence:clone(plan.state.priceEvidence),rows:memberResults(plan.state),issues:[],missing:[]};
      if(!plan.canApply||round===maxRounds)break;
      // Lock any nonempty fields that appeared after a dependent choice; newly
      // loaded content never becomes permission for a later overwrite.
      for(const field of plan.state.fields){
        const previous=locked.fields.find(item=>item.identity===field.identity);
        if(!previous)locked.fields.push(clone(field));
        else if(!expectedWrites.some(write=>write.identity===field.identity))for(const target of previous.targets){const current=field.targets.find(item=>targetId(item)===targetId(target));if(target.empty&&current&&!current.empty){target.value=clone(current.value);target.empty=false;}}
      }
      const reread=await stableRead();if(reread.state.stateKey!==plan.stateKey)throw new Error('原生批量填写前成员、值或控件已经变化，未继续写入');
      const writeCheck=validateNativeBatchWritePlan(reread.snapshot,plan,{scope});if(!writeCheck.ready)throw new Error(writeCheck.issues.join('；'));
      stop();const applied=await apply(clone(plan));stop();
      expectedWrites.push(...clone(plan.writes));changes.push(...plan.writes.map(write=>({groupKey:write.groupKey,identity:write.identity,label:write.label,value:clone(write.value),targets:clone(write.targets)})));rounds++;
      await afterWrite?.({round:rounds,result:applied});await onProgress?.({phase:'native-fields',round:rounds,fields:changes.length,members:locked.members.length,message:'已填写本批空字段，正在回读联动后的分组表单'});
    }
    return {completed:false,ready:false,rounds,changes,snapshot,issues:[...new Set([...(plan?.issues||[]),...(rounds>=maxRounds?['已达到本轮批量联动填写上限']:[])])],missing:plan?.missing||[],unresolved:plan?.unresolved||[]};
  }catch(error){return {completed:false,ready:false,rounds,changes,snapshot,issues:[String(error.message||error)],missing:plan?.missing||[],unresolved:plan?.unresolved||[]};}
}
