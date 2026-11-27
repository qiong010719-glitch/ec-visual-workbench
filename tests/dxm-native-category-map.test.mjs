import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {nativeBatchScope} from '../src/dxm-native-batch.mjs';
import {readRequiredFields} from '../src/dxm-required-fields.mjs';
import {readRequiredPlatformEditor} from '../src/dxm-required-platform-browser.mjs';
import {captureExistingDxmPrices} from '../src/listing-field-policy.mjs';
import {NATIVE_CATEGORY_POLICY,readDxmNativeCategoryMapPage,readDxmCategoryVariantEvidence,nativeCategoryMapReadiness,mapDxmNativeCategories,verifyNativeCategoryReadback,verifyNativeCategoryMemberReadback} from '../src/dxm-native-category-map.mjs';

const account='fixture-account',store={key:'fixture-store',storeName:'中性商品测试店铺',site:'美国站',businessMode:'OBM'},sourcePath=['家用电器','厨房电器','榨汁机'];
const category={candidateId:'dxm-search:fixture-blender',platformCategoryId:null,idKind:'candidate',path:['家用电器(Home Appliances)','厨房电器(Kitchen Appliances)','榨汁机(Juicers)'],label:'榨汁机(Juicers)',leaf:true,source:'store-search'};
const rows=[1,2].map(value=>({id:'member-'+value,draftId:'22011460295192916'+value,goodsId:'60123456789000'+value,sourceUrl:`https://www.temu.com/neutral-blender-g-60123456789000${value}.html`,platformEditUrl:`https://www.dianxiaomi.com/web/sheinProduct/edit?id=220114602951929161`.replace(/1$/,''+value),storeBindingKey:store.key,title:`便携榨汁机 ${value}`,categorySelection:{category:structuredClone(category),searchQuery:'榨汁机',selectedAt:new Date().toISOString()},productTypeConfirmation:{productType:'便携榨汁机',sourcePath,confirmedAt:new Date().toISOString()}}));
const scopeFor=members=>nativeBatchScope({platform:'shein',account,storeBinding:store,rows:members});
const mapUrl=scope=>'https://www.dianxiaomi.com/web/modifyCategory?platform=shein&type=1&ids='+scope.rows.map(row=>row.draftId).join(',');
const batchUrl=scope=>'https://www.dianxiaomi.com/web/sheinProduct/batchEdit?ids='+scope.rows.map(row=>row.draftId).join(',')+'&dxmState=draft';
let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND']});});
after(async()=>{await browser?.close();});

function editorHtml(row,{hideSecond=false,virtual=false}={}){return `<style>body{font:14px Arial;margin:15px}td,th{padding:8px}input{width:150px}</style><div class="btn-user"><span class="user-name">${account}</span></div><form><div class="ant-form-item"><label class="ant-form-item-label">店铺</label><div class="ant-select-selection-item">${store.storeName}</div></div><div class="ant-form-item"><label class="ant-form-item-label">来源URL</label><input name="sourceUrl" value="${row.sourceUrl}"></div><div class="sku-wrapper ${virtual?'is--virtual-y':''}"><table><thead><tr><th>颜色</th><th>SKU</th><th>售价 CNY</th></tr></thead><tbody>${['白色','粉色'].map((color,index)=>`<tr rowid="v${index}" ${hideSecond&&index?'style="display:none"':''}><td>${color}</td><td><input name="variationSku" value="B${row.goodsId}-${index}"></td><td><input name="price" value="81.${index?'96':'93'}"></td></tr>`).join('')}</tbody></table></div></form>`;}
async function fixture(t,{members=[rows[0]],groups,variantless=false}={}){
  const context=await browser.newContext();t.after(()=>context.close());await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<body></body>'}));
  const baseline={rows:[]};
  for(const row of members){const page=await context.newPage();await page.goto(row.platformEditUrl);await page.setContent(editorHtml(row));const expected={url:row.platformEditUrl,account,storeName:store.storeName,site:store.site,goodsId:row.goodsId};const fields=await page.evaluate(readRequiredFields,{expected}),editor=await page.evaluate(readRequiredPlatformEditor,expected),variantEvidence=await page.evaluate(readDxmCategoryVariantEvidence,{expected,fields}),originalPriceEvidence=captureExistingDxmPrices(fields,{platform:'shein',goodsId:row.goodsId});assert.equal(variantEvidence.complete,true,variantEvidence.issues.join(';'));baseline.rows.push({...row,editor,fields,variantEvidence,originalPriceEvidence});await page.close();}
  const scope=scopeFor(members),url=mapUrl(scope),expected={url,account},page=await context.newPage();await page.goto(url);
  const list=groups||[{count:members.length,title:members[0].title,sourcePath,store:store.storeName}];
  await page.setContent(`<style>body{font:14px Arial;margin:20px}td,th{padding:8px;border:1px solid #aaa}button,select{padding:7px;margin:5px}.ant-modal{position:fixed;inset:50px;background:white;padding:20px}</style><div class="btn-user"><span class="user-name">${account}</span></div><button id="save" onclick="events.push('save-next')">保存，下一步</button><button id="skip" onclick="events.push('skip')">跳过，去编辑产品</button><div class="table-container"><div class="vxe-table"><table><thead><tr><th colid="product">产品信息</th><th colid="correspondence">分类对应</th><th colid="category">SHEIN分类</th></tr></thead><tbody>${list.map((group,index)=>`<tr id="group-${index}"><td colid="product"><div class="product-info"><div class="flex justify-between gap-10"><div class="flex-1 fw600 gray-c">(${group.count})个${group.sourcePath.join(' > ')||'无分类'}</div><div class="flex-shrink-0 max-w-120">来源:Temu</div></div><div class="flex gap-10 m-t10"><div><p>${group.title}</p><div class="color-#999 m-t5">「${group.store}」</div></div></div></div></td><td colid="correspondence">&gt;&gt;</td><td colid="category"><button onclick="openCategory(${index})">选择分类</button><div id="path-${index}" class="mt10 color-#a0a3a6"></div>${variantless?'':`<div class="mt10"><table><thead><tr><th>Temu变种主题</th><th>对应SHEIN变种主题</th></tr></thead><tbody><tr><td>颜色</td><td><select id="axis-${index}" onchange="events.push('axis:'+this.value)"><option value="">请选择</option><option value="color">颜色</option><option value="size">尺码</option></select><label><input type="radio" name="main-${index}" checked>设为主规格</label></td></tr></tbody></table></div>`}</td></tr>`).join('')}</tbody></table></div></div><script>window.events=[];function openCategory(index){window.currentGroup=index;events.push('open-category:'+index);const modal=document.createElement('div');modal.className='ant-modal';modal.textContent='选择类目';document.body.appendChild(modal);}</script>`);
  const poll=async(fn,{label}={})=>{const end=Date.now()+300;do{const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}while(Date.now()<end);throw new Error('fixture timeout: '+label);};
  const point=async({selector,text})=>{const target=page.locator(selector);assert.equal(await target.count(),1);if(text)assert.equal((await target.innerText()).trim(),text);await target.click();};
  const applyCategory=async({query,category:selected})=>{assert.equal(query,'榨汁机');await page.evaluate(path=>{events.push('choose-category:'+currentGroup);document.querySelector('#path-'+currentGroup).textContent=path.join(' > ');document.querySelector('.ant-modal').remove();},selected.path);return {selected:true,dialogClosed:true,requiresReadback:true};};
  return {context,page,poll,point,applyCategory,scope,url,expected,members,baseline,read:()=>page.evaluate(readDxmNativeCategoryMapPage,{expected}),run:options=>mapDxmNativeCategories({page,poll,point,applyCategory,expected,scope,rows:members,baseline,...options})};
}

test('public product-info and nested theme DOM are read without hidden state or invented data IDs',async t=>{
  const f=await fixture(t),snapshot=await f.read();assert.equal(snapshot.groups.length,1);assert.equal(snapshot.groups[0].count,1);assert.equal(snapshot.groups[0].title,rows[0].title);assert.deepEqual(snapshot.groups[0].sourceCategoryPath,sourcePath);assert.deepEqual(snapshot.groups[0].draftIds,[]);assert.deepEqual(snapshot.groups[0].sourceUrls,[]);assert.equal(snapshot.groups[0].axes[0].source,'颜色');assert.equal(snapshot.groups[0].axes[0].target,'');assert.equal(snapshot.save[0].text,'保存，下一步');assert.equal(nativeCategoryMapReadiness(snapshot,f.scope,f.members).ready,true);
  await assert.rejects(f.page.evaluate(readDxmNativeCategoryMapPage,{expected:{...f.expected,account:'other'}}),/账号已变化/);
});

test('category and exact variant axes are mapped before separate persisted SaveNext intent',async t=>{
  const f=await fixture(t),intents=[];const result=await f.run({beforeCategorySubmit:async value=>{assert.equal((await f.page.evaluate(()=>events)).includes('save-next'),false);intents.push(value);}});
  assert.equal(result.status,'submitted-for-readback',result.issues.join(';'));assert.equal(intents.length,1);assert.equal(result.rows[0].expectedSnapshot.policy,NATIVE_CATEGORY_POLICY);assert.equal(result.rows[0].expectedSnapshot.variantCount,2);assert.deepEqual(result.rows[0].expectedSnapshot.axisMapping,[{source:'颜色',target:'颜色',main:true}]);assert.deepEqual(intents[0].rows[0].payload.category,category);assert.equal(intents[0].rows[0].payload.expectedSnapshot.variants[0].sku,'B'+rows[0].goodsId+'-0');assert.deepEqual(await f.page.evaluate(()=>events),['open-category:0','choose-category:0','axis:color','save-next']);
});

test('a merged native group uses exact route membership, full source path and same confirmed type',async t=>{
  const f=await fixture(t,{members:rows}),result=await f.run({beforeCategorySubmit:()=>{}});assert.equal(result.status,'submitted-for-readback',result.issues.join(';'));assert.equal(result.rows.length,2);assert.deepEqual(await f.page.evaluate(()=>events),['open-category:0','choose-category:0','axis:color','save-next']);
  const snapshot=await f.read(),changed=structuredClone(f.members);delete changed[1].productTypeConfirmation;assert.match(nativeCategoryMapReadiness(snapshot,f.scope,changed).issues.join(';'),/具体类型/);
});

test('Ant rendered axis choices are clicked by observed text without inventing an enumeration value',async t=>{
  const f=await fixture(t);
  await f.page.evaluate(()=>{
    const select=document.querySelector('#axis-0'),box=document.createElement('div');box.className='ant-select';box.style='display:inline-block;padding:7px;border:1px solid';box.innerHTML='<input role="combobox" aria-controls="axis-list" style="width:1px"><span class="ant-select-selection-item"></span><span>请选择</span>';select.replaceWith(box);
    const dropdown=document.createElement('div');dropdown.className='ant-select-dropdown';dropdown.hidden=true;dropdown.style='position:fixed;left:50px;top:50px;z-index:100;background:white';dropdown.innerHTML='<div id="axis-list" role="listbox" style="height:0;width:0;overflow:hidden"><div role="option" id="accessibility-only">颜色</div></div><div class="ant-select-item-option" title="颜色" style="padding:15px"><span class="ant-select-item-option-content">颜色</span></div><div class="ant-select-item-option" title="尺码" style="padding:15px">尺码</div>';document.body.append(dropdown);
    box.addEventListener('click',()=>{dropdown.hidden=false;});for(const option of dropdown.querySelectorAll('.ant-select-item-option'))option.addEventListener('click',()=>{box.querySelector('.ant-select-selection-item').textContent=option.title;dropdown.hidden=true;events.push('custom-axis:'+option.title);});
  });
  const result=await f.run({beforeCategorySubmit:()=>{}});assert.equal(result.status,'submitted-for-readback',result.issues.join(';'));assert.deepEqual(await f.page.evaluate(()=>events),['open-category:0','choose-category:0','custom-axis:颜色','save-next']);assert.equal(result.rows[0].expectedSnapshot.axisMapping[0].target,'颜色');
});

test('similar titles without exact grouped identity never bind multiple native rows',async t=>{
  const f=await fixture(t,{members:rows,groups:rows.map(row=>({count:1,title:row.title,sourcePath:[],store:store.storeName}))}),result=await f.run({beforeCategorySubmit:()=>assert.fail('must not persist')});assert.equal(result.status,'needs-review');assert.match(result.issues.join(';'),/唯一对应/);assert.deepEqual(await f.page.evaluate(()=>events),[]);
});

test('foreign route IDs, wrong stores and collapsed scope cannot reach SaveNext',async t=>{
  const f=await fixture(t),snapshot=await f.read();for(const mutate of [value=>value.url=value.url.replace(rows[0].draftId,rows[1].draftId),value=>value.groups[0].storeNames=['其他店铺'],value=>value.groups[0].count=2,value=>value.expand=[{selector:'.missing',text:'+ 查看已对应的（1）个产品'}]]){const changed=structuredClone(snapshot);mutate(changed);assert.equal(nativeCategoryMapReadiness(changed,f.scope,f.members).ready,false);}
});

test('unproven baseline and a category that drops the original variant axes stop before saving',async t=>{
  const f=await fixture(t);delete f.baseline.rows[0].variantEvidence;const missing=await f.run({beforeCategorySubmit:()=>assert.fail('must not persist')});assert.match(missing.issues.join(';'),/完整变种/);assert.deepEqual(await f.page.evaluate(()=>events),[]);
  const g=await fixture(t,{variantless:true}),result=await g.run({beforeCategorySubmit:()=>assert.fail('must not persist')});assert.equal(result.status,'needs-review');assert.match(result.issues.join(';'),/变种轴不一致/);assert.equal((await g.page.evaluate(()=>events)).includes('save-next'),false);
});

test('scope drift after persisted category intent remains uncertain and never clicks SaveNext',async t=>{
  const f=await fixture(t);const result=await f.run({beforeCategorySubmit:async()=>{await f.page.locator('#path-0').evaluate(node=>node.textContent='家用电器 > 其他产品');}});assert.equal(result.status,'needs-review');assert.equal(result.submissionRecorded,true);assert.equal((await f.page.evaluate(()=>events)).includes('save-next'),false);
});

test('existing category intent cannot replay SaveNext even if its status is confirmed',async t=>{
  const f=await fixture(t),members=structuredClone(f.members);members[0].nativeCategoryIntent={status:'confirmed'};const result=await f.run({rows:members,beforeCategorySubmit:()=>assert.fail('no replay')});assert.equal(result.status,'needs-review');assert.match(result.issues.join(';'),/不得再次保存/);assert.deepEqual(await f.page.evaluate(()=>events),[]);
});

test('visible SKU evidence rejects hidden and virtual rows instead of claiming all variants were preserved',async t=>{
  const f=await fixture(t),page=await f.context.newPage(),row=rows[0],expected={url:row.platformEditUrl,account};await page.goto(row.platformEditUrl);
  for(const options of [{hideSecond:true},{virtual:true}]){await page.setContent(editorHtml(row,options));const fields=await page.evaluate(readRequiredFields,{expected}),evidence=await page.evaluate(readDxmCategoryVariantEvidence,{expected,fields});assert.equal(evidence.complete,false);assert.match(evidence.issues.join(';'),/隐藏|虚拟/);}
});

test('price coverage catches extra hidden, disabled, readonly and omitted amounts on otherwise complete SKU rows',async t=>{
  const f=await fixture(t),page=await f.context.newPage(),row=rows[0],expected={url:row.platformEditUrl,account};await page.goto(row.platformEditUrl);
  const cases=['disabled','readonly','css-hidden','hidden-type-price','fieldset-disabled','omitted-visible','static-price-column','hidden-price-table','pagination','aria-rowcount'];
  for(const scenario of cases){
    await page.setContent(editorHtml(row));
    await page.evaluate(scenario=>{
      const cell=document.querySelector('tbody tr td:last-child');
      if(['disabled','readonly','css-hidden','hidden-type-price','omitted-visible'].includes(scenario)){
        const extra=document.createElement('input');extra.name='specialPrice';extra.value='71.20';extra.disabled=scenario==='disabled';extra.readOnly=scenario==='readonly';if(scenario==='css-hidden')extra.style.display='none';if(scenario==='hidden-type-price')extra.type='hidden';cell.append(extra);
      }else if(scenario==='fieldset-disabled'){
        const input=cell.querySelector('input'),fieldset=document.createElement('fieldset');fieldset.disabled=true;input.replaceWith(fieldset);fieldset.append(input);
      }else if(scenario==='static-price-column'){
        const header=document.createElement('th');header.textContent='供货价 CNY';document.querySelector('thead tr').append(header);for(const tr of document.querySelectorAll('tbody tr')){const td=document.createElement('td');td.textContent='81.93';tr.append(td);}
      }else if(scenario==='hidden-price-table'){
        const table=document.createElement('table');table.hidden=true;table.innerHTML='<thead><tr><th>售价 CNY</th></tr></thead><tbody><tr><td><input name="price" value="do-not-return-hidden-price"></td></tr></tbody>';document.querySelector('form').append(table);
      }else if(scenario==='pagination'){
        const pager=document.createElement('div');pager.className='vxe-pager';pager.textContent='下一页';document.querySelector('.sku-wrapper').append(pager);
      }else if(scenario==='aria-rowcount')document.querySelector('table').setAttribute('aria-rowcount','8');
    },scenario);
    let fields=await page.evaluate(readRequiredFields,{expected});if(scenario==='omitted-visible')fields={...fields,fields:fields.fields.filter(field=>field.name!=='specialPrice')};
    const result=await page.evaluate(readDxmCategoryVariantEvidence,{expected,fields});assert.equal(result.complete,false,scenario);assert.equal(result.priceFieldsComplete,false,scenario);assert.ok(result.issues.some(issue=>/价格/.test(issue)),scenario);assert.equal(JSON.stringify(result).includes('do-not-return-hidden-price'),false);
    if(['disabled','readonly','css-hidden','hidden-type-price','omitted-visible'].includes(scenario)){assert.equal(result.count,2,scenario);assert.equal(result.observedPriceControls,3,scenario);assert.equal(result.matchedPriceControls,2,scenario);}
  }
});

test('ordinary hidden backend IDs do not become price facts and fresh complete prices remain accepted',async t=>{
  const f=await fixture(t),page=await f.context.newPage(),row=rows[0],expected={url:row.platformEditUrl,account};await page.goto(row.platformEditUrl);await page.setContent(editorHtml(row));
  await page.evaluate(()=>{const cell=document.querySelector('tbody tr td:last-child');for(const name of ['productId','csrfToken']){const input=document.createElement('input');input.type='hidden';input.name=name;input.value='private-value-must-not-be-returned';cell.append(input);}});
  const fields=await page.evaluate(readRequiredFields,{expected}),result=await page.evaluate(readDxmCategoryVariantEvidence,{expected,fields});assert.equal(result.complete,true,result.issues.join(';'));assert.equal(result.priceFieldsComplete,true);assert.equal(result.observedPriceControls,2);assert.equal(result.matchedPriceControls,2);assert.equal(JSON.stringify(result).includes('private-value'),false);
  await page.locator('input[name="price"]').first().fill('99.99');const stale=await page.evaluate(readDxmCategoryVariantEvidence,{expected,fields});assert.equal(stale.complete,false);assert.equal(stale.priceFieldsComplete,false);assert.match(stale.issues.join(';'),/价格表单已变化/);
});

function nativeSnapshot(f,mapping){return {url:batchUrl(f.scope),account,scopeKey:f.scope.scopeKey,members:mapping.rows.map(member=>({draftId:member.draftId,goodsId:member.goodsId,sourceUrl:member.expectedSnapshot.sourceUrl,storeName:store.storeName,category:member.category,variants:structuredClone(member.expectedSnapshot.variants)})),issues:[]};}

test('next editor receipts require complete exact members, category paths and preserved SKU content',async t=>{
  const f=await fixture(t),mapping=await f.run({beforeCategorySubmit:()=>{}}),snapshot=nativeSnapshot(f,mapping),verify=value=>verifyNativeCategoryReadback({snapshot:value,scope:f.scope,rows:f.members,mapping});
  const result=verify(snapshot);assert.equal(result.ready,true,result.issues.join(';'));assert.equal(result.rows[0].variantsPreserved,true);assert.equal(result.rows[0].saved,undefined);assert.equal(result.rows[0].published,undefined);
  for(const mutate of [value=>value.members[0].variants.pop(),value=>value.members[0].variants[0].attributes[0].value='蓝色',value=>value.members[0].category={...category,path:['服装','其他','榨汁机']},value=>value.members.push(structuredClone(value.members[0])),value=>value.url=value.url.replace('batchEdit','edit'),value=>value.issues=['实际表单尚未完整读取']]){const changed=structuredClone(snapshot);mutate(changed);const refused=verify(changed);assert.equal(refused.ready,false);assert.deepEqual(refused.rows,[]);}
});

test('restart category-only readback compares original complete variant evidence and never claims product saved',async t=>{
  const f=await fixture(t),intents=[],mapping=await f.run({beforeCategorySubmit:value=>intents.push(value)}),row=f.members[0],base=f.baseline.rows[0],scope={scopeKey:f.scope.scopeKey,rows:f.members},intent=intents[0].rows[0].payload;
  const editor={...base.editor,categoryPath:category.path},fields={...base.fields,variantEvidence:base.variantEvidence};const read=overrides=>verifyNativeCategoryMemberReadback({editor,fields,row,scope,nativeCategoryIntent:intent,...overrides});
  const result=read();assert.equal(result.categoryConfirmed,true,result.issues.join(';'));assert.equal(result.variantsPreserved,true);assert.equal(result.saved,undefined);assert.equal(result.readOnly,true);
  assert.equal(read({fields:base.fields}).variantsPreserved,false);const changed=structuredClone(fields);changed.variantEvidence.variants.pop();changed.variantEvidence.count=1;assert.equal(read({fields:changed}).categoryConfirmed,false);assert.equal(read({scope:{...scope,rows:[...f.members,rows[1]]}}).categoryConfirmed,false);assert.equal(read({editor:{...editor,sources:[rows[1].sourceUrl]}}).categoryConfirmed,false);assert.equal(mapping.rows[0].expectedSnapshot.variants.length,2);
  const changedPrice=structuredClone(fields);changedPrice.fields.find(field=>field.name==='price').value='82.00';assert.equal(read({fields:changedPrice}).categoryConfirmed,false);assert.match(read({fields:changedPrice}).issues.join(';'),/原有价格/);
});
