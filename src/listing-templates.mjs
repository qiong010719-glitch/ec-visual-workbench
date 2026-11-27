import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const clone=value=>structuredClone(value);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const keyPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const secretKey=/(?:api.?key|secret|password|passwd|authorization|cookie|csrf|credential|access.?token|refresh.?token|bearer.?token|^token$)/i;
const rootFields=new Set(['id','version','name','erpKey','platform','businessType','site','productType','category','rules','storeBindings','notes','createdAt','updatedAt','readiness','copiedFrom','snapshotAt']);
const bindingFields=new Set(['key','storeKey','storeId','storeName','site','warehouse','warehouseId','shippingTemplate','shippingTemplateId','dispatch','dispatchId','overrides']);

function text(value,label,max=240,{required=false}={}){
  if(value===undefined||value===null)value='';
  if(typeof value!=='string'||value.length>max)throw fail(`${label}须为不超过${max}字的文本`);
  const result=value.trim();
  if(required&&!result)throw fail(`请填写${label}`);
  return result;
}

function key(value,label,{required=true}={}){
  const result=text(value,label,100,{required});
  if(result&&!keyPattern.test(result))throw fail(`${label}只能包含英文字母、数字、短横线和下划线`);
  return result;
}

function object(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail(`${label}格式无效`);
  return value;
}

// Templates contain business rules only. Credentials remain in the existing
// encrypted settings store and never become a template or task snapshot.
function businessJson(value,label='填写规则',depth=0,budget={remaining:5000}){
  if(--budget.remaining<0||depth>8)throw fail(`${label}内容过大或层级过深`);
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw fail(`${label}包含无效数值`);
    return value;
  }
  if(typeof value==='string'){
    if(value.length>4000)throw fail(`${label}文本过长`);
    if(/\bBearer\s+[a-zA-Z0-9._~-]{8,}/i.test(value))throw fail('上架模板不能保存账号密钥、令牌或请求凭据');
    return value;
  }
  if(Array.isArray(value)){
    if(value.length>500)throw fail(`${label}列表过长`);
    return value.map(item=>businessJson(item,label,depth+1,budget));
  }
  object(value,label);
  const entries=Object.entries(value);
  if(entries.length>200)throw fail(`${label}字段过多`);
  const result={};
  for(const [name,item] of entries){
    if(['__proto__','prototype','constructor'].includes(name)||secretKey.test(name))throw fail('上架模板不能保存账号密钥、令牌或请求凭据');
    if(name.length>100)throw fail(`${label}字段名称过长`);
    result[name]=businessJson(item,label,depth+1,budget);
  }
  return result;
}

function allowedFields(value,allowed,label){
  for(const name of Object.keys(value))if(!allowed.has(name))throw fail(`${label}包含不支持的字段`);
}

// Only explicitly stored defaults may change existing SKU data. Keep other
// business rules compatible, but never coerce blanks or partial package data.
export function validateTemplateRules(value={},label='填写规则'){
  const rules=businessJson(object(value,label),label);
  if(Object.hasOwn(rules,'autoFillRequired')&&typeof rules.autoFillRequired!=='boolean')throw fail(`${label}的必填数字自动补全设置须为布尔值`);
  if(Object.hasOwn(rules,'categoryMode')&&!['match','replace'].includes(rules.categoryMode))throw fail(`${label}的分类设置须为 match 或 replace`);
  if(Object.hasOwn(rules,'saveMode')&&!['draft','ready'].includes(rules.saveMode))throw fail(`${label}的保存设置须为 draft 或 ready`);
  if(Object.hasOwn(rules,'packageDefaults')){
    const packageDefaults=object(rules.packageDefaults,`${label}的包装默认值`),keys=['lengthCm','widthCm','heightCm','weightKg'];
    allowedFields(packageDefaults,new Set(keys),`${label}的包装默认值`);
    if(keys.some(name=>typeof packageDefaults[name]!=='number'||!Number.isFinite(packageDefaults[name])||packageDefaults[name]<=0))throw fail(`${label}的包装长、宽、高（cm）和重量（kg）须全部填写大于0的数值`);
  }
  if(Object.hasOwn(rules,'inventory')){
    const inventory=object(rules.inventory,`${label}的库存规则`);
    if(inventory.mode==='preserve')allowedFields(inventory,new Set(['mode']),`${label}的保留库存规则`);
    else {
      allowedFields(inventory,new Set(['mode','quantity']),`${label}的库存规则`);
      if(inventory.mode!=='fixed'||!Number.isSafeInteger(inventory.quantity)||inventory.quantity<0)throw fail(`${label}的库存须为 fixed 模式及大于等于0的安全整数，或 preserve 模式`);
    }
  }
  return rules;
}

function normalizeCategory(value={}){
  object(value,'商品分类');
  allowedFields(value,new Set(['id','label','path']),'商品分类');
  const categoryPath=value.path??[];
  if(!Array.isArray(categoryPath)||categoryPath.length>16)throw fail('商品分类路径无效');
  const labels=categoryPath.map(item=>text(item,'分类名称',240,{required:true}));
  const label=text(value.label,'末级分类名称')||labels.at(-1)||'';
  if(labels.length&&label!==labels.at(-1))throw fail('末级分类名称与分类路径不一致');
  return {id:text(value.id,'商品分类编号',100),label,path:labels};
}

function normalizeBinding(value,templateSite){
  object(value,'店铺配置');
  allowedFields(value,bindingFields,'店铺配置');
  const storeKey=key(value.storeKey,'店铺配置编号',{required:false});
  const selection=(name,label)=>{
    const input=value[name];
    if(input&&typeof input==='object'){
      object(input,label);allowedFields(input,new Set(['id','label']),label);
      const id=text(input.id,`${label}编号`,100),separateId=text(value[`${name}Id`],`${label}编号`,100);
      if(id&&separateId&&id!==separateId)throw fail(`${label}编号不一致`);
      return {label:text(input.label,label),id:id||separateId};
    }
    return {label:text(input,label),id:text(value[`${name}Id`],`${label}编号`,100)};
  };
  const warehouse=selection('warehouse','仓库'),shipping=selection('shippingTemplate','运费模板'),dispatch=selection('dispatch','发货时效');
  const result={key:key(value.key||storeKey||randomUUID(),'模板店铺编号'),storeKey,
    storeId:text(value.storeId,'平台店铺编号',100),storeName:text(value.storeName,'店铺名称',240,{required:true}),
    site:text(value.site,'店铺站点')||templateSite,
    warehouse:warehouse.label,warehouseId:warehouse.id,shippingTemplate:shipping.label,shippingTemplateId:shipping.id,
    dispatch:dispatch.label,dispatchId:dispatch.id,overrides:validateTemplateRules(value.overrides??{},'店铺差异设置')};
  if(templateSite&&result.site!==templateSite)throw fail('店铺站点与上架模板站点不一致');
  return result;
}

export function listingTemplateReadiness(template){
  const issues=[];
  if(!template.site)issues.push('缺少销售站点');
  if(!template.productType)issues.push('缺少适用商品类型');
  if(!template.category?.path?.length)issues.push('缺少已确认的完整商品分类');
  if(!template.storeBindings?.length)issues.push('尚未绑定适用店铺');
  try{validateTemplateRules(template.rules??{});}catch(error){issues.push(error.message);}
  for(const binding of template.storeBindings||[]){
    const prefix=`${binding.storeName} / ${binding.site||'未选站点'}`;
    for(const [field,label] of [['site','站点'],['warehouse','仓库'],['shippingTemplate','运费模板'],['dispatch','发货时效']])if(!binding[field])issues.push(`${prefix}：缺少${label}`);
    try{validateTemplateRules(binding.overrides??{},'店铺差异设置');}catch(error){issues.push(`${prefix}：${error.message}`);}
  }
  // This is configuration completeness, not a claim that any product can be
  // published. The executor must check each product's real required fields.
  return {scope:'configuration',ready:issues.length===0,issues};
}

export function createListingTemplates({directory,preferences,clock=()=>new Date().toISOString()}={}){
  if(typeof directory!=='string'||!directory)throw fail('缺少上架模板保存目录');
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'listing-templates.json');
  const empty=()=>({schemaVersion:1,revision:0,templates:{}});
  function read(){
    if(!fs.existsSync(file))return empty();
    let state;
    try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw fail('上架模板文件无法读取，请保留文件并检查，未覆盖原配置',500);}
    if(state?.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!state.templates||typeof state.templates!=='object'||Array.isArray(state.templates))throw fail('上架模板文件格式不兼容，未覆盖原配置',500);
    for(const [id,record] of Object.entries(state.templates)){
      if(!keyPattern.test(id)||!Array.isArray(record?.versions)||!record.versions.length||!Number.isSafeInteger(record.currentVersion)||record.currentVersion!==record.versions.length||record.versions.some((template,index)=>template?.id!==id||template.version!==index+1))throw fail('上架模板版本记录不完整，未覆盖原配置',500);
    }
    return state;
  }
  function write(state){
    const temporary=`${file}.${randomUUID()}.tmp`;
    try{fs.writeFileSync(temporary,JSON.stringify(state,null,2),{flag:'wx'});fs.renameSync(temporary,file);}
    catch(error){if(fs.existsSync(temporary))fs.unlinkSync(temporary);throw error;}
  }
  function find(state,id,version){
    key(id,'上架模板编号');
    const record=Object.hasOwn(state.templates,id)?state.templates[id]:null;
    if(!record)throw fail('上架模板不存在',404);
    if(version!==undefined&&(!Number.isSafeInteger(version)||version<1))throw fail('模板版本无效');
    const result=record.versions[(version??record.currentVersion)-1];
    if(!result)throw fail('上架模板的指定版本不存在',404);
    return result;
  }
  const present=template=>({...clone(template),readiness:listingTemplateReadiness(template)});

  function normalize(payload){
    object(payload,'上架模板');
    businessJson(payload,'上架模板');
    allowedFields(payload,rootFields,'上架模板');
    const erpKey=key(payload.erpKey,'ERP账号编号'),platform=text(payload.platform,'目标平台',40,{required:true});
    if(!['temu','tiktok'].includes(platform))throw fail('当前固定上架模板支持 Temu 半托管和 TikTok');
    if(preferences?.erp){const erp=preferences.erp(erpKey);if((erp.provider||'dianxiaomi')!=='dianxiaomi')throw fail('固定上架模板需要店小秘连接');}
    const site=text(payload.site,'销售站点'),bindings=payload.storeBindings??[];
    if(!Array.isArray(bindings)||bindings.length>500)throw fail('模板绑定店铺数量无效');
    const storeBindings=bindings.map(value=>normalizeBinding(value,site));
    if(new Set(storeBindings.map(value=>value.key)).size!==storeBindings.length)throw fail('模板店铺编号重复');
    if(new Set(storeBindings.map(value=>JSON.stringify([value.storeName,value.site]))).size!==storeBindings.length)throw fail('同一店铺及站点不能重复绑定');
    return {name:text(payload.name,'上架模板名称',160,{required:true}),erpKey,platform,
      businessType:text(payload.businessType,'业务类型',100),site,productType:text(payload.productType,'商品类型',160),
      category:normalizeCategory(payload.category),rules:validateTemplateRules(payload.rules??{}),storeBindings,notes:text(payload.notes,'模板备注',2000)};
  }

  function save(payload){
    const normalized=normalize(payload),state=read(),id=payload.id?key(payload.id,'上架模板编号'):randomUUID();
    const previous=payload.id?find(state,id):null;
    if(previous&&payload.version!==previous.version)throw fail('上架模板已更新，请刷新后再保存',409);
    if(!previous&&payload.version!==undefined&&payload.version!==0)throw fail('新上架模板不能指定已有版本');
    if(!previous&&Object.keys(state.templates).length>=1000)throw fail('上架模板数量已达上限');
    const timestamp=clock(),template={id,...normalized,version:previous?previous.version+1:1,createdAt:previous?.createdAt||timestamp,updatedAt:timestamp};
    if(previous?.copiedFrom)template.copiedFrom=clone(previous.copiedFrom);
    if(previous)state.templates[id].versions.push(template);
    else state.templates[id]={currentVersion:0,versions:[template]};
    state.templates[id].currentVersion=template.version;state.revision++;write(state);
    return present(template);
  }
  function list(filters={}){
    object(filters,'模板筛选');
    return Object.values(read().templates).map(record=>record.versions.at(-1))
      .filter(template=>['erpKey','platform','site'].every(field=>!filters[field]||template[field]===filters[field]))
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.name.localeCompare(b.name)).map(present);
  }
  function get(id,{version}={}){return present(find(read(),id,version));}
  function copy(id,{name,version}={}){
    const state=read(),source=find(state,id,version),timestamp=clock(),newId=randomUUID();
    if(Object.keys(state.templates).length>=1000)throw fail('上架模板数量已达上限');
    const template={...normalize({...source,name:name??`${source.name.slice(0,156)}（副本）`}),id:newId,version:1,createdAt:timestamp,updatedAt:timestamp,copiedFrom:{id:source.id,version:source.version}};
    state.templates[newId]={currentVersion:1,versions:[template]};state.revision++;write(state);
    return present(template);
  }
  function snapshot(id,{version,storeKeys}={}){
    const template=get(id,{version});
    if(storeKeys!==undefined){
      if(!Array.isArray(storeKeys)||!storeKeys.length||storeKeys.length>500||storeKeys.some(value=>typeof value!=='string')||new Set(storeKeys).size!==storeKeys.length)throw fail('本次处理店铺选择无效');
      if(storeKeys.some(value=>!template.storeBindings.some(binding=>binding.key===value)))throw fail('本次处理店铺不属于所选上架模板');
      template.storeBindings=template.storeBindings.filter(binding=>storeKeys.includes(binding.key));
      template.readiness=listingTemplateReadiness(template);
    }
    return {...template,snapshotAt:clock()};
  }
  function view(){const state=read();return {revision:state.revision,templates:Object.values(state.templates).map(record=>present(record.versions.at(-1)))};}
  return {list,get,save,copy,snapshot,view};
}
