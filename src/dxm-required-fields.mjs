import {isPriceField,SOURCE_PRICE_POLICY,DXM_PRICE_POLICY} from './listing-field-policy.mjs';

// These DOM functions are serialized into an owned ERP page. Keep their shared
// implementation inside the serialized function; never read hidden credentials.
function requiredFieldsRuntime({action='read',expected={},rootSelector,plan,requiredNames=[]}={}){
  const tidy=value=>String(value??'').replace(/\s+/g,' ').trim();
  const labelText=value=>tidy(value).replace(/^[*＊\s]+|[：:＊*\s]+$/g,'');
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none'&&!element.closest('[inert],[aria-hidden="true"]');
  const secret=/(?:password|passwd|secret|cookie|csrf|credential|authorization|token|api.?key|密码|密钥|令牌)/i;
  const protectedName=/^(?:id|(?:product|goods|item|shop|store|category|cate|warehouse|account|site|seller|user|variant|variation|sku)(?:_?id|Id|ID)|(?:shop|store|account|site|category|cate)(?:name|path|_name|_path)?|variationSku|sku(?:code|Code|_code)?|sourceUrl|source_url|url)$/i;
  const protectedLabel=/(?:店铺|账号|帐号|账户|站点|分类|类目|来源(?:地址|链接|URL)?|货号|条(?:形)?码|商品编号|商品编码|(?:^|\s)SKU(?:\s*(?:编号|编码|货号))?(?:$|[:：])|密码|密钥|品牌|商标|认证|资质|声明|协议|同意|隐私|验证码|brand|trademark|certificat|licen[cs]e)/i;
  const numericNames=new Set(['price','skuLength','skuWidth','skuHeight','weight','stock','quantity','inventory','length','width','height','packageLength','packageWidth','packageHeight','packageWeight']);
  const root=rootSelector?document.querySelector(rootSelector):document.body;
  if(!root||(rootSelector&&document.querySelectorAll(rootSelector).length!==1))throw new Error('必填项检查范围不唯一或不存在');
  function identity(){
    const url=location.href,account=tidy(document.querySelector('.btn-user .user-name,[data-account-name],#loginUserName')?.textContent);
    if(expected.url&&url!==expected.url)throw new Error('必填项填写页面已变化');
    if(expected.account&&account!==expected.account)throw new Error('必填项填写账号已变化');
    return {url,account};
  }
  function selector(element){
    if(element.id&&document.querySelectorAll('#'+CSS.escape(element.id)).length===1)return '#'+CSS.escape(element.id);
    const pieces=[];let current=element;
    while(current&&current!==document.documentElement){
      const tag=current.tagName.toLowerCase(),siblings=current.parentElement?[...current.parentElement.children].filter(e=>e.tagName===current.tagName):[];
      pieces.unshift(tag+':nth-of-type('+(siblings.indexOf(current)+1)+')');
      if(current.parentElement?.id&&document.querySelectorAll('#'+CSS.escape(current.parentElement.id)).length===1){pieces.unshift('#'+CSS.escape(current.parentElement.id));break;}
      current=current.parentElement;
    }
    return pieces.join(' > ');
  }
  const groupOf=element=>element.closest('.ant-form-item,.form-group,.control-group,.form-item,[data-field]')||element.closest('td')||element.parentElement;
  function labels(element,group){
    const linked=[...(element.labels||[])].filter(visible);
    const labelled=tidy(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean).map(id=>document.getElementById(id)).filter(visible);
    const header=element.closest('td')&&element.closest('table')?.querySelectorAll('thead th')[element.closest('td').cellIndex];
    const own=group?.querySelector('.ant-form-item-label,.control-label,.form-label,legend,[data-field-label]');
    const nearby=group?.previousElementSibling;
    const first=own||labelled[0]||linked[0]||header||(nearby?.matches('label,th,dt')?nearby:null);
    return {node:first,label:labelText(first?.textContent||element.getAttribute('aria-label')||element.getAttribute('data-label')||element.getAttribute('placeholder')||element.name||element.id)};
  }
  const optionValue=option=>({value:String(option.value??option.getAttribute('data-value')??''),label:tidy(option.label||option.textContent),disabled:!!option.disabled||option.getAttribute('aria-disabled')==='true'||!!option.closest('optgroup:disabled')});
  const emptyOption=option=>option.value===''||/^(?:请选择.*|选择.*|please\s+select.*|select(?:\s+(?:an?|one|option))?.*|[-—]+)$/i.test(option.label);
  function skuIdentity(row,skuInput){
    if(!row)return null;
    const result={id:row.getAttribute('rowid')||row.getAttribute('data-row-key')||row.getAttribute('data-id')||row.id||'',sku:skuInput?.value||''};
    const headers=[...row.closest('table')?.querySelectorAll('thead th')||[]],cells=[...row.cells],skuIndex=skuInput?.closest('td')?.cellIndex;
    if(!Number.isInteger(skuIndex)||headers.length!==cells.length||headers.some(header=>header.colSpan!==1||header.rowSpan!==1))return result;
    const attributes=[];
    // Variation columns precede the merchant SKU. Read only named, visible
    // attribute columns; stock, price and package dimensions are never specs.
    for(let index=0;index<skuIndex;index++){
      const name=labelText(headers[index]?.textContent);
      if(!/^(?:颜色|色号|尺寸|尺码|规格(?:[一二三1-3])?|款式|型号|材质|容量|color|colour|size|style|model|material|capacity|variation(?:\s*[1-3])?|variant(?:\s*[1-3])?)$/i.test(name))continue;
      const cell=cells[index];if(!visible(cell))return result;
      const inputs=[...cell.querySelectorAll('input,select')].filter(visible).filter(input=>!['hidden','checkbox','radio'].includes(input.type));
      if(inputs.length>1)return result;
      const input=inputs[0],value=tidy(input?.tagName==='SELECT'?[...input.selectedOptions].map(option=>option.textContent).join('、'):input?input.value:cell.textContent);
      if(!value||/^(?:请选择|please\s+select)/i.test(value))return result;
      attributes.push({name,value});
    }
    if(attributes.length&&new Set(attributes.map(item=>item.name)).size===attributes.length)result.attributes=attributes;
    return result;
  }
  function collect(){
    const currentIdentity=identity(),fields=[],handled=new Set();
    const controls=[...root.querySelectorAll('input,textarea,select,[role="combobox"]')];
    if(controls.length>2000)throw new Error('商品表单控件过多，未截断必填项检查');
    for(const element of controls){
      if(handled.has(element)||!visible(element)||element.disabled||element.readOnly&&!element.matches('[role="combobox"]')||element.matches(':disabled')||element.getAttribute('aria-disabled')==='true')continue;
      const type=element.tagName==='INPUT'?element.type:element.tagName.toLowerCase();
      if(['hidden','password','file','button','submit','reset','image','search','range','color'].includes(type))continue;
      const customSelect=element.closest('.ant-select,.select2-container,.bootstrap-select');
      if(customSelect&&element.tagName==='INPUT'&&!element.matches('[role="combobox"]'))continue;
      if(customSelect&&[...handled].some(item=>customSelect.contains(item)))continue;
      const group=groupOf(element),label=labels(element,group),name=element.name||'',id=element.id||'';
      if(secret.test([name,id,label.label,element.autocomplete].join(' ')))continue;
      let kind=element.matches('[role="combobox"]')&&element.tagName!=='SELECT'?'combobox':type==='textarea'?'text':type;
      if(!['text','number','tel','url','email','date','datetime-local','time','month','week','select','combobox','radio','checkbox'].includes(kind))continue;
      const errors=[...group?.querySelectorAll('.ant-form-item-explain-error,.help-block.error,.field-error,.error-message,[role="alert"],.invalid-feedback')||[]].filter(visible).map(e=>tidy(e.textContent)).filter(Boolean);
      const declared=element.required||element.getAttribute('aria-required')==='true'||element.getAttribute('data-required')==='true';
      const optional=element.getAttribute('aria-required')==='false'||element.getAttribute('data-required')==='false';
      const marker=!!label.node?.matches('.ant-form-item-required,.required,[required],[aria-required="true"]')||!!label.node?.querySelector('.required,.red-star,.text-danger,.ant-form-item-required')||/[*＊]/.test(label.node?.textContent||'');
      const declaredNames=Array.isArray(requiredNames)&&requiredNames.includes(name);
      // Temu's SKU table uses name-based numeric controls without HTML required.
      const skuRow=element.closest('tr'),skuInput=skuRow?.querySelector('input[name="variationSku"],input[name="sku"],input[data-sku]');
      const knownSkuNumber=!!skuInput&&numericNames.has(name)&&!optional;
      let required=!!declared||(!optional&&(marker||declaredNames||knownSkuNumber||errors.some(error=>/必填|不能为空|请填写|请选择|required|must\s+(?:enter|select)/i.test(error))));
      let requiredBy=declared?'attribute':optional?'optional':marker?'label':declaredNames?'adapter':knownSkuNumber?'sku-field':required?'validation':null;
      const protectedField=protectedName.test(name)||protectedName.test(id)||protectedLabel.test(label.label)||/consent|agreement|terms|privacy|captcha|verification|brand|trademark|certificat|licen[cs]e/i.test(name);
      let members=[element],options=[],value='',checked=null;
      if(kind==='radio'||kind==='checkbox'){
        if(name)members=controls.filter(item=>item.tagName==='INPUT'&&item.type===type&&item.name===name&&item.form===element.form&&visible(item)&&!item.disabled&&!item.matches(':disabled'));
        if(members.some(item=>item.required||item.getAttribute('aria-required')==='true')){required=true;requiredBy='attribute';}
        if(kind==='checkbox'&&members.length===1){checked=!!element.checked;value=checked?String(element.value):'';}
        else {kind=kind==='checkbox'?'checkbox-group':'radio';value=members.filter(item=>item.checked).map(item=>String(item.value));}
        options=members.map(item=>({...optionValue(item),label:labelText([...item.labels||[]][0]?.textContent||item.getAttribute('aria-label')||item.value),selector:selector(item)}));
      }else if(kind==='select'){
        options=[...element.options].map(optionValue).map(option=>({...option,placeholder:emptyOption(option)}));
        value=element.multiple?[...element.selectedOptions].map(option=>option.value).filter(val=>options.some(option=>option.value===val&&!option.placeholder)):String(element.value||'');
        if(!element.multiple&&options.some(option=>option.value===value&&option.placeholder))value='';
      }else if(kind==='combobox'){
        const box=customSelect||element,selected=[...box.querySelectorAll('.ant-select-selection-item,.select2-selection__rendered,[data-selected-label]')].map(e=>tidy(e.getAttribute('title')||e.textContent)).filter(Boolean);
        value=selected.join('、')||(!element.matches('input')?tidy(element.getAttribute('aria-valuetext')):'');
        const listId=element.getAttribute('aria-controls')||element.getAttribute('aria-owns');
        const list=listId?document.getElementById(listId):null;
        if(list&&visible(list))options=[...list.querySelectorAll('[role="option"]')].filter(visible).map(option=>({value:option.getAttribute('data-value')??option.id,label:tidy(option.getAttribute('aria-label')||option.textContent),disabled:option.getAttribute('aria-disabled')==='true',selector:selector(option)}));
      }else value=String(element.value??'');
      members.forEach(item=>handled.add(item));
      const controlSelector=selector(element),unit=tidy(group?.querySelector('.input-group-addon,.ant-input-suffix,.ant-input-number-group-addon,[data-unit]')?.textContent||label.node?.textContent.match(/(?:\b(?:cm|mm|kg|g|USD|CNY|JPY|EUR|GBP|CAD|AUD|SGD|MYR|THB|PHP|VND|IDR|MXN|BRL)\b|厘米|毫米|千克|公斤|克)/i)?.[0]||'');
      const constraints={min:element.getAttribute('min'),max:element.getAttribute('max'),step:element.getAttribute('step'),pattern:element.getAttribute('pattern'),minLength:element.getAttribute('minlength'),maxLength:element.getAttribute('maxlength'),inputMode:element.getAttribute('inputmode'),multiple:!!element.multiple};
      const rowIdentity=skuIdentity(skuRow,skuInput);
      const shape=JSON.stringify({selector:controlSelector,kind,name,id,label:label.label,required,requiredBy,protected:protectedField,constraints,options,unit,rowIdentity,members:members.map(selector)});
      const empty=Array.isArray(value)?value.length===0:tidy(value)==='';
      fields.push({key:controlSelector,selector:controlSelector,kind,type,name,id,label:label.label,required,requiredBy,protected:protectedField,value,empty,checked,options,...constraints,unit,rowIdentity,shape,errors});
    }
    if(fields.length>500)throw new Error('商品表单可编辑字段超过500个，未截断检查');
    return {...currentIdentity,fields};
  }
  if(action==='read')return collect();
  if(action!=='fill'||!plan||!Array.isArray(plan.writes)||plan.writes.length>500)throw new Error('必填项填写计划无效');
  const initial=collect();
  if(plan.url!==initial.url||plan.account!==initial.account)throw new Error('必填项计划所属页面或账号已变化');
  if(new Set(plan.writes.map(write=>write.key)).size!==plan.writes.length)throw new Error('必填项填写计划包含重复控件');
  const resolve=write=>{
    const field=collect().fields.find(item=>item.key===write.key);
    const priceLike=/(?:price|售价|价格|供货价|申报价|金额|单价|零售价|原价|特价|促销价|折扣价)/i.test([field?.name,field?.id,field?.label].join(' '));
    const sourcePrice=write.reason==='verified-source-price'&&plan.sourcePricePolicy==='temu-source-price-v1'&&priceLike&&write.sourcePrice?.expectedValue===write.value&&write.sourcePrice?.source?.kind==='displayed-sale';
    if(priceLike&&!sourcePrice)throw new Error('价格只能使用已核实的 Temu 同规格直接售价：'+write.label);
    if(!field||(!sourcePrice&&!field.required)||field.protected||(!sourcePrice&&!field.empty)||(sourcePrice&&JSON.stringify(field.value)!==JSON.stringify(write.previousValue))||field.shape!==write.shape||field.selector!==write.selector)throw new Error('必填项已变化或已填写，未覆盖：'+write.label);
    const matches=document.querySelectorAll(field.selector);
    if(matches.length!==1||!visible(matches[0])||!root.contains(matches[0]))throw new Error('必填项控件不唯一或已失效：'+write.label);
    const element=matches[0];
    if(field.kind==='combobox')throw new Error('自定义选择框需使用实际选项交互：'+field.label);
    if(['select','radio','checkbox-group'].includes(field.kind)){
      const values=Array.isArray(write.value)?write.value:[String(write.value)],eligible=field.options.filter(option=>!option.disabled&&!option.placeholder);
      if(!values.length||new Set(values).size!==values.length||values.some(value=>eligible.filter(option=>option.value===value).length!==1)||(!field.multiple&&field.kind!=='checkbox-group'&&values.length!==1))throw new Error('必填选项已变化或选择无效：'+field.label);
    }else if(field.kind==='checkbox'){
      if(write.value!==true)throw new Error('必填复选框只接受明确确认值：'+field.label);
    }else{
      if(typeof write.value!=='string'||!tidy(write.value))throw new Error('必填项计划包含空值：'+field.label);
      const probe=element.cloneNode(true);probe.value=write.value;probe.required=true;
      if(probe.value!==write.value||!probe.checkValidity())throw new Error('必填项计划不符合当前平台校验规则：'+field.label);
      if(field.minLength!==null&&write.value.length<Number(field.minLength)||field.maxLength!==null&&write.value.length>Number(field.maxLength))throw new Error('必填项计划不符合文本长度要求：'+field.label);
    }
    return {field,element};
  };
  // Validate all current targets before making the first change.
  plan.writes.forEach(resolve);
  const changes=[];
  for(const write of plan.writes){
    const {field,element}=resolve(write);
    const event=control=>{control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));};
    if(field.kind==='combobox')throw new Error('自定义选择框需使用实际选项交互：'+field.label);
    if(['select','radio','checkbox-group'].includes(field.kind)){
      const values=Array.isArray(write.value)?write.value:[String(write.value)],eligible=field.options.filter(option=>!option.disabled&&!option.placeholder);
      if(!values.length||new Set(values).size!==values.length||values.some(value=>eligible.filter(option=>option.value===value).length!==1)||(!field.multiple&&field.kind!=='checkbox-group'&&values.length!==1))throw new Error('必填选项已变化或选择无效：'+field.label);
      if(field.kind==='select'){
        for(const option of element.options)option.selected=values.includes(option.value);
        event(element);
      }else{
        for(const option of field.options){const control=document.querySelector(option.selector);if(!control||control.disabled||!visible(control))throw new Error('必填选项控件失效：'+field.label);if(values.includes(option.value)&&!control.checked)control.click();}
      }
    }else if(field.kind==='checkbox'){
      if(write.value!==true)throw new Error('必填复选框只接受明确确认值：'+field.label);
      element.click();
    }else{
      if(typeof write.value!=='string'||!tidy(write.value))throw new Error('必填项计划包含空值：'+field.label);
      const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,write.value);
      event(element);
    }
    changes.push({key:write.key,label:write.label,value:write.value,reason:write.reason,...(write.sourcePrice?{previousValue:write.previousValue,sourcePrice:write.sourcePrice}:{})});
  }
  return {written:changes.length,changes};
}

const domFunction=(name,action)=>new Function(`return function ${name}(args){return (${requiredFieldsRuntime.toString()})({...args,action:${JSON.stringify(action)}});}`)();
export const readRequiredFields=domFunction('readRequiredFields','read');
export const fillRequiredFields=domFunction('fillRequiredFields','fill');

const empty=value=>value===undefined||value===null||Array.isArray(value)&&value.length===0||typeof value==='string'&&!value.trim();
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const getValue=(values,field)=>{
  if(!values||typeof values!=='object'||Array.isArray(values))return undefined;
  for(const key of [field.key,field.name,field.id,field.label])if(key&&Object.hasOwn(values,key)&&!empty(values[key]))return values[key];
};

// Prefer a positive value on the declared step lattice. This is a draft
// placeholder, not an assertion about actual product dimensions or inventory.
export function requiredNumericPlaceholder(field){
  if(isPriceField(field))return null;
  const minimum=finite(field.min)?Number(field.min):null,maximum=finite(field.max)?Number(field.max):null;
  const step=field.step==='any'?null:finite(field.step)&&Number(field.step)>0?Number(field.step):field.kind==='number'?1:/integer|库存|数量|件数/.test(field.label||'')?1:0.01;
  if(minimum!==null&&maximum!==null&&minimum>maximum)return null;
  const base=minimum??0,target=Math.max(minimum??0,maximum!==null&&maximum<1?maximum:1);
  let value=step===null?target:base+Math.ceil((target-base)/step-1e-10)*step;
  if(maximum!==null&&value>maximum+1e-9)value=step===null?maximum:base+Math.floor((maximum-base)/step+1e-10)*step;
  value=Number(value.toPrecision(14));
  const positive=/^(?:price|skuLength|skuWidth|skuHeight|weight|length|width|height|packageLength|packageWidth|packageHeight|packageWeight)$/.test(field.name||'');
  if(!Number.isFinite(value)||positive&&value<=0||(minimum!==null&&value<minimum-1e-9)||(maximum!==null&&value>maximum+1e-9))return null;
  return String(value);
}

function validateValue(field,value){
  if(empty(value))return '没有可用值';
  if(['select','radio','checkbox-group'].includes(field.kind)){
    const candidates=field.options.filter(option=>!option.disabled&&!option.placeholder),values=Array.isArray(value)?value:[value];
    const resolved=values.map(item=>{const exact=candidates.filter(option=>option.value===String(item));return exact.length===1?exact[0]:candidates.filter(option=>option.label===String(item)).length===1?candidates.find(option=>option.label===String(item)):null;});
    if(resolved.some(item=>!item)||new Set(resolved.map(item=>item?.value)).size!==resolved.length)return '填写值不对应唯一有效选项';
    if(!field.multiple&&field.kind!=='checkbox-group'&&resolved.length!==1)return '此字段只允许一个选项';
    return {value:field.kind==='checkbox-group'||field.multiple?resolved.map(item=>item.value):resolved[0].value};
  }
  if(field.kind==='checkbox')return value===true?{value:true}:'复选框缺少明确确认值';
  if(field.kind==='combobox')return '需要展开平台选择框并核对实际选项';
  if(!['string','number'].includes(typeof value))return '填写值类型不适用';
  const text=String(value);
  if(finite(field.minLength)&&text.length<Number(field.minLength)||finite(field.maxLength)&&text.length>Number(field.maxLength))return '填写值不符合文本长度要求';
  if(field.kind==='number'||field.numeric){
    const n=Number(text);if(!Number.isFinite(n))return '需要有效数字';
    if(finite(field.min)&&n<Number(field.min)-1e-9||finite(field.max)&&n>Number(field.max)+1e-9)return '数字超出平台范围';
    const step=field.step==='any'?null:finite(field.step)&&Number(field.step)>0?Number(field.step):field.kind==='number'?1:null;
    if(step!==null){const ratio=(n-(finite(field.min)?Number(field.min):0))/step;if(Math.abs(ratio-Math.round(ratio))>1e-7)return '数字不符合平台步长';}
  }
  if(field.pattern){try{if(!new RegExp('^(?:'+field.pattern+')$','u').test(text))return '填写值不符合平台格式';}catch{return '平台格式约束无法识别';}}
  if(field.kind==='url'){try{const url=new URL(text);if(!['http:','https:'].includes(url.protocol))return '链接格式无效';}catch{return '链接格式无效';}}
  if(field.kind==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))return '邮箱格式无效';
  if(['date','datetime-local','time','month','week'].includes(field.kind))return '日期字段需要平台专用填写规则';
  return {value:text};
}

export function ordinaryFieldDefault(field){
  if(field.protected||isPriceField(field)||/(?:brand|trademark|certificat|licen[cs]e|品牌|商标|认证|资质)/i.test([field.name,field.id,field.label].join(' ')))return undefined;
  if(['select','radio','checkbox-group','combobox'].includes(field.kind)){
    const eligible=(field.options||[]).filter(option=>!option.disabled&&!option.placeholder&&option.value!==''&&!/^(?:请选择|选择|please\s+select|select\b|[-—]+$)/i.test(option.label));
    const neutral=eligible.find(option=>/^(?:无|无品牌|不适用|其他|其它|通用|none|not\s+applicable|n\/?a|other|generic)$/i.test(String(option.label).trim()));
    return (neutral||eligible[0])?.value;
  }
  if(field.kind==='checkbox')return true;
  if(field.numeric||field.kind==='number'||['decimal','numeric'].includes(field.inputMode))return requiredNumericPlaceholder(field);
  if(field.kind==='text')return '其他';
  return undefined;
}

export function planRequiredFields(snapshot,{defaults={},sourceValues={},allowNumericPlaceholders=true,allowOrdinaryDefaults=false,pricePlan}={}){
  if(!snapshot||!Array.isArray(snapshot.fields)||typeof snapshot.url!=='string')throw new Error('缺少实际必填项表单快照');
  const writes=[],issues=[],unresolved=[],missing=[];
  const issue=(field,reason)=>{issues.push(`${field.label||field.name||'必填项'}：${reason}`);unresolved.push({key:field.key,label:field.label,kind:field.kind,reason,options:field.options||[]});};
  const priceBindingValid=[SOURCE_PRICE_POLICY,DXM_PRICE_POLICY].includes(pricePlan?.policy)&&pricePlan.url===snapshot.url&&pricePlan.account===(snapshot.account||'')&&Array.isArray(pricePlan.prices)&&new Set(pricePlan.prices.map(price=>price.key)).size===pricePlan.prices.length;
  if(pricePlan){
    if(!priceBindingValid)issues.push('来源价格计划所属页面、账号或字段绑定已变化');
    else if(pricePlan.issues?.length)issues.push(...pricePlan.issues);
  }
  for(const original of snapshot.fields){
    const field={...original,numeric:original.kind==='number'||['decimal','numeric'].includes(original.inputMode)||/^(?:price|skuLength|skuWidth|skuHeight|weight|stock|quantity|inventory|length|width|height|packageLength|packageWidth|packageHeight|packageWeight)$/.test(original.name||'')};
    if(isPriceField(field)){
      const price=priceBindingValid?pricePlan.prices.find(item=>item.key===field.key):undefined;
      if(pricePlan?.policy===DXM_PRICE_POLICY){
        if(field.required&&field.empty)missing.push({key:field.key,label:field.label,kind:field.kind,protected:true});
        if(!priceBindingValid||!price||!price.matched)issue(field,'店小秘价格为空、异常或已发生变化，已保留原值；不会使用默认值填价');
        continue;
      }
      if(price){
        if(field.protected||price.shape!==field.shape||price.selector!==field.selector||JSON.stringify(price.previousValue)!==JSON.stringify(field.value)){issue(field,'来源价格计划或规格已变化，需要重新读取');continue;}
        if(price.matched){if(field.errors?.length)issue(field,'已有值的校验提示：'+field.errors.join('；'));continue;}
        missing.push({key:field.key,label:field.label,kind:field.kind,protected:false});
        const checked=validateValue({...field,numeric:true},price.expectedValue);
        if(typeof checked==='string'){issue(field,'来源售价'+checked);continue;}
        writes.push({key:field.key,selector:field.selector,shape:field.shape,label:field.label,kind:field.kind,value:checked.value,reason:'verified-source-price',previousValue:field.value,sourcePrice:price});
      }else if(field.required&&field.empty){missing.push({key:field.key,label:field.label,kind:field.kind,protected:true});issue(field,'缺少已核实的 Temu 同规格直接售价，价格不使用默认值');}
      else if(field.errors?.length)issue(field,'价格校验提示：'+field.errors.join('；'));
      else if(pricePlan&&field.required&&!pricePlan.issues?.length)issue(field,'此价格字段不在当前来源售价计划中');
      continue;
    }
    if(!field.required)continue;
    if(!field.empty){if(field.errors?.length)issue(field,'已有值的校验提示：'+field.errors.join('；'));continue;}
    missing.push({key:field.key,label:field.label,kind:field.kind,protected:field.protected});
    if(field.protected){issue(field,'此项需由已绑定身份或用户选择确定，未自动填入占位值');continue;}
    let value=getValue(sourceValues,field),reason='source-value';
    if(value===undefined){value=getValue(defaults,field);reason='configured-default';}
    if(value===undefined&&field.numeric&&allowNumericPlaceholders){value=requiredNumericPlaceholder(field);reason='numeric-placeholder';}
    if(value===undefined&&allowOrdinaryDefaults){value=ordinaryFieldDefault(field);reason='ordinary-default';}
    if(value===undefined&&['select','radio','checkbox-group'].includes(field.kind)){
      const candidates=field.options.filter(option=>!option.disabled&&!option.placeholder);
      if(candidates.length===1){value=candidates[0].value;reason='only-available-option';}
    }
    if(value===undefined||value===null){issue(field,field.numeric?'无法取得符合平台范围和步长的数值':'没有可核实的填写内容或唯一可选项');continue;}
    const checked=validateValue(field,value);
    if(typeof checked==='string'){issue(field,checked);if(field.kind==='combobox'&&value!==undefined)unresolved[unresolved.length-1].suggestedValue=value;continue;}
    writes.push({key:field.key,selector:field.selector,shape:field.shape,label:field.label,kind:field.kind,value:checked.value,reason});
  }
  return {url:snapshot.url,account:snapshot.account||'',sourcePricePolicy:priceBindingValid?pricePlan.policy:undefined,writes,issues:[...new Set(issues)],unresolved,missing};
}

// The caller still checks the exact product/store identity before every round.
// This function never saves a product, moves a draft, or submits publication.
export async function completeRequiredFields({page,expected={},rootSelector,requiredNames=[],defaults={},sourceValues={},allowNumericPlaceholders=true,allowOrdinaryDefaults=false,pricePlan,pricePlanFor,maxRounds=6,validateIdentity,afterWrite,isStopped}={}){
  if(typeof page?.evaluate!=='function')throw new Error('缺少必填项表单页面');
  if(!Number.isSafeInteger(maxRounds)||maxRounds<1||maxRounds>20)throw new Error('必填项补全轮次无效');
  const changes=[];let previous=null,snapshot,plan;
  for(let round=1;round<=maxRounds;round++){
    if(isStopped?.())throw new Error('已暂停必填项补全');
    await validateIdentity?.();
    snapshot=await page.evaluate(readRequiredFields,{expected,rootSelector,requiredNames});
    const currentPricePlan=pricePlanFor?await pricePlanFor(snapshot):pricePlan;
    plan=planRequiredFields(snapshot,{defaults,sourceValues,allowNumericPlaceholders,allowOrdinaryDefaults,pricePlan:currentPricePlan});
    if(!plan.missing.length&&!plan.issues.length&&!plan.writes.length)return {completed:true,ready:true,rounds:round-1,changes,snapshot,issues:[],missing:[]};
    const fingerprint=JSON.stringify(snapshot.fields.map(field=>[field.key,field.shape,field.value]));
    if(!plan.writes.length||fingerprint===previous)return {completed:false,ready:false,rounds:round-1,changes,snapshot,missing:plan.missing,unresolved:plan.unresolved,issues:plan.issues.length?plan.issues:['必填项填写后没有产生可核实的变化']};
    previous=fingerprint;
    await validateIdentity?.();
    if(isStopped?.())throw new Error('已暂停必填项补全');
    const result=await page.evaluate(fillRequiredFields,{expected,rootSelector,requiredNames,plan});
    changes.push(...result.changes);
    await afterWrite?.({round,result});
  }
  await validateIdentity?.();
  snapshot=await page.evaluate(readRequiredFields,{expected,rootSelector,requiredNames});
  plan=planRequiredFields(snapshot,{defaults,sourceValues,allowNumericPlaceholders,allowOrdinaryDefaults,pricePlan:pricePlanFor?await pricePlanFor(snapshot):pricePlan});
  const completed=!plan.missing.length&&!plan.issues.length&&!plan.writes.length;
  return {completed,ready:completed,rounds:maxRounds,changes,snapshot,missing:plan.missing,unresolved:plan.unresolved,issues:completed?[]:[...plan.issues,'达到本轮必填项补全上限，仍有项目需要处理']};
}
