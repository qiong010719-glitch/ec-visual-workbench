import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {nativeBatchScope} from '../src/dxm-native-batch.mjs';
import {completeNativeBatchFields,planNativeBatchFields} from '../src/dxm-native-fields.mjs';
import {readNativeEditor,nativeEditorUiPoint,readNativeChoiceOptions,ensureNativeChoiceOptions,applyNativeWrites,verifyNativeBatchMemberReadback,NATIVE_EDITOR_CAPABILITIES} from '../src/dxm-native-editor.mjs';

const clone=value=>structuredClone(value),account='native-editor-fixture',storeName='家居测试店铺';
const sourceRows=[1,2].map(n=>({draftId:'22011460000000000'+n,goodsId:'60123456789000'+n,sourceUrl:`https://www.temu.com/storage-g-60123456789000${n}.html`}));
const scope=nativeBatchScope({platform:'shein',account,storeBinding:{key:'fixture',storeName,site:'美国站'},rows:sourceRows});
const url='https://www.dianxiaomi.com/web/sheinProduct/batchEdit?ids='+sourceRows.map(row=>row.draftId).join(',')+'&dxmState=offline';
const expected={url,account,scope};
let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
after(async()=>{await browser?.close();});
function rowHtml(row,index){
  const col=(name,content)=>`<td data-row-index="${index}"><div class="batch-edit-cell-renderer batch-edit-cell-renderer--${name}">${content}</div></td>`;
  const variants=content=>content.map(value=>`<div class="variation-item"><span>${value}</span></div>`).join('');
  return `<tr>${col('mainImage',`<div class="source-image-container"><a href="${row.sourceUrl}">Temu</a></div>`)}${col('name',`<div>Neutral storage product ${index+1}</div><div class="shop-name">「${storeName}」</div><span class="mode mode2">OBM</span>`)}${col('sku',variants([`SKU-${index}-A`,`SKU-${index}-B`]))}${col('variantName',variants(['White','Black']))}${col('price',variants(['--','--']))}${col('supplyPrice',variants(['12.00CNY','18.50CNY']))}${col('quantity',variants(['3','4']))}${col('weight',variants(['100','120']))}${col('packageSize',variants(['10*20*30','10*20*30']))}</tr>`;
}
async function fixture(t,{rows=sourceRows,extra='',routeUrl=url}={}){
  const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><div class="btn-user"><span class="user-name">${account}</span></div><div class="shein-batch-edit-table-page"><div class="action"><button class="button btn-orange">保存</button></div><div class="batch-table-wrap"><table><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>${extra}</div>`}));
  await page.goto(routeUrl);return page;
}

test('public native-table DOM binds source URLs and SKU prices while preserving explicit attribute coverage blocker',async t=>{
  const page=await fixture(t),snapshot=await page.evaluate(readNativeEditor,expected);
  assert.equal(snapshot.members.length,2);assert.equal(snapshot.members[0].draftId,sourceRows[0].draftId);
  assert.equal(snapshot.members[0].variants.length,2);assert.equal(snapshot.members[0].variants[0].sku,'SKU-0-A');
  const prices=snapshot.groups[0].fields.filter(field=>field.name==='supplyPrice');assert.deepEqual(prices.map(field=>[field.value,field.unit]),[['12.00','CNY'],['18.50','CNY']]);
  assert.equal(snapshot.groups[0].fields.find(field=>field.name==='name').value,'Neutral storage product 1');
  assert.equal(snapshot.groups[0].fields.some(field=>field.name==='price'),false);
  assert.equal(snapshot.complete,false);assert.equal(snapshot.coverage.requiredAttributesComplete,false);assert.equal(snapshot.coverage.categoryPathsComplete,false);assert.match(snapshot.issues.join(''),/未覆盖完整分类/);
  assert.equal(NATIVE_EDITOR_CAPABILITIES.nativePrepare,false);assert.equal(NATIVE_EDITOR_CAPABILITIES.nativeSave,false);
  const plan=planNativeBatchFields(snapshot,{scope,targetLanguage:'en'});assert.equal(plan.canApply,false);assert.equal(plan.writes.length,0);assert.match(plan.issues.join(''),/未覆盖完整分类/);
});

test('native member matching uses exact sources, never query order or visible product title',async t=>{
  const page=await fixture(t,{rows:[...sourceRows].reverse()}),snapshot=await page.evaluate(readNativeEditor,expected);
  assert.equal(snapshot.members[0].draftId,sourceRows[1].draftId);
  await page.locator('.source-image-container a').first().evaluate(anchor=>anchor.href='https://www.temu.com/another-g-601234567899999.html');
  const changed=await page.evaluate(readNativeEditor,expected);assert.equal(changed.members.length,1);assert.match(changed.issues.join(''),/未按行号猜测/);
});

test('query scope, account, duplicate SKU and outstanding dialog are explicit blockers',async t=>{
  const page=await fixture(t,{routeUrl:url.replace(sourceRows[1].draftId,'220114600000009999')});
  const wrong=await page.evaluate(readNativeEditor,{...expected,url:page.url()});assert.match(wrong.issues.join(''),/草稿集合/);
  await assert.rejects(page.evaluate(readNativeEditor,{...expected,url:page.url(),account:'other'}),/账号/);
  await page.goto(url);await page.locator('.batch-edit-cell-renderer--sku').first().locator('.variation-item').nth(1).evaluate(node=>node.textContent='SKU-0-A');
  assert.match((await page.evaluate(readNativeEditor,expected)).issues.join(''),/完整SKU/);
  await page.evaluate(()=>{const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.textContent='fixture dialog';document.body.append(modal);});
  await assert.rejects(page.evaluate(nativeEditorUiPoint,{expected,locator:{text:'保存'}}),/弹窗/);
});

test('savepoint is exact, modal-aware and only returns a location',async t=>{
  const page=await fixture(t);await page.evaluate(()=>{window.fixtureSaves=0;document.querySelector('button').addEventListener('click',()=>window.fixtureSaves++);});
  const point=await page.evaluate(nativeEditorUiPoint,{expected,locator:{text:'保存'}});assert.equal(point.text,'保存');assert.ok(point.x>0);assert.equal(await page.evaluate(()=>window.fixtureSaves),0);
  await assert.rejects(page.evaluate(nativeEditorUiPoint,{expected,locator:{text:'确认'}}),/尚无已观察/);
  await page.evaluate(()=>document.querySelector('.action').append(document.querySelector('button').cloneNode(true)));
  await assert.rejects(page.evaluate(nativeEditorUiPoint,{expected,locator:{text:'保存'}}),/唯一/);
});

test('option reader retains actual platform value and refuses to invent one from generated DOM id',async t=>{
  const page=await fixture(t,{extra:'<div><input id="choice" role="combobox" aria-controls="choices"><div id="choices" role="listbox"><div role="option" data-value="raw-其他">其他</div><div role="option" data-value="raw-塑料">塑料</div></div></div>'});
  const found=await page.evaluate(readNativeChoiceOptions,{expected,locator:{selector:'#choice'}});assert.deepEqual(found.options.map(option=>[option.value,option.label]),[['raw-其他','其他'],['raw-塑料','塑料']]);
  await page.locator('[role="option"]').first().evaluate(option=>{option.removeAttribute('data-value');option.id='generated-option-3';});
  const missing=await page.evaluate(readNativeChoiceOptions,{expected,locator:{selector:'#choice'}});assert.equal(missing.options.length,0);assert.match(missing.issues.join(''),/原始平台选项值/);
});

test('incomplete native schema never opens variant choices or writes fields',async t=>{
  const page=await fixture(t);await page.evaluate(()=>{window.fixtureMutations=0;for(const event of ['click','input','change'])document.addEventListener(event,()=>window.fixtureMutations++);});
  const state=await ensureNativeChoiceOptions({page,expected});assert.equal(state.choiceOptionsReady,false);
  await assert.rejects(applyNativeWrites({page,expected,plan:{writes:[{value:'1'}]}}),/未覆盖完整分类/);
  assert.equal(await page.evaluate(()=>window.fixtureMutations),0);
});

async function savedFixture(){
  const member={...sourceRows[0],storeName,site:'美国站',category:{id:'100',path:['家居用品','收纳用品'],leaf:true},variants:[{key:'v-a',sku:'SKU-A',attributes:[{name:'颜色',value:'白色'}]},{key:'v-b',sku:'SKU-B',attributes:[{name:'颜色',value:'黑色'}]}]};
  const oneScope=nativeBatchScope({platform:'shein',account,storeBinding:scope.storeBinding,rows:[sourceRows[0]]});
  const field=(name,label,value,variantKey='',extra={})=>({key:name+variantKey,selector:'#'+name+variantKey,shape:name+variantKey,name,label,kind:'text',value,empty:false,required:true,options:[],targets:[{draftId:member.draftId,variantKey,value}],...extra});
  const nativeFields=[field('name','产品标题','Neutral storage set'),field('material','材质','raw-other','',{kind:'combobox',options:[{value:'raw-other',label:'其他'}]}),...member.variants.flatMap((variant,index)=>[field('supplyPrice','供货价 CNY',index?'18.50':'12.00',variant.key,{kind:'number',unit:'CNY'}),field('quantity','库存',index?'4':'3',variant.key,{kind:'number'}),field('sku','变种SKU',variant.sku,variant.key,{protected:true})])];
  const native={version:1,surface:'native-batch',platform:'shein',url,account,scopeKey:oneScope.scopeKey,complete:true,members:[member],groups:[{key:'group',memberIds:[member.draftId],category:member.category,complete:true,fields:nativeFields}]};
  const completed=await completeNativeBatchFields({scope:oneScope,targetLanguage:'en',read:()=>clone(native),apply:()=>{throw Error('already complete');}});assert.equal(completed.ready,true);
  const row=completed.rows[0],singleUrl='https://www.dianxiaomi.com/web/sheinProduct/edit?id='+member.draftId;
  const editor={url:singleUrl,account,storeName,site:'',siteFieldPresent:false,sources:[member.sourceUrl],platformCategoryId:'100',categoryPath:['家居用品(Home Supplies)','收纳用品(Storage Supplies)']};
  const fields={url:singleUrl,account,fields:nativeFields.map((field,index)=>{const variant=member.variants.find(item=>item.key===field.targets[0].variantKey);return {...clone(field),key:'#different-'+index,selector:'#different-'+index,shape:'single-editor-shape-'+index,name:field.name==='name'?'productTitle':field.name==='supplyPrice'?'price':field.name==='sku'?'variationSku':field.name,value:field.name==='material'?'其他':field.value,options:field.name==='material'?[]:field.options,rowIdentity:variant?{id:'single-row-'+variant.key,sku:variant.sku,attributes:clone(variant.attributes)}:null};})};
  fields.variantEvidence={version:1,policy:'visible-sku-table-v1',url:singleUrl,account,complete:true,priceFieldsComplete:true,count:member.variants.length,variants:member.variants.map(variant=>({sku:variant.sku,attributes:clone(variant.attributes),rowId:'single-row-'+variant.key})),issues:[]};
  return {...row,editor,fields};
}

test('independent member readback matches semantic fields, original enum labels and SKU identity without old selectors',async()=>{
  const saved=await savedFixture(),result=verifyNativeBatchMemberReadback(saved);assert.deepEqual(result.issues,[]);assert.equal(result.ready,true);assert.equal(result.readOnly,true);assert.equal(result.fxVerified,false);assert.equal(Object.hasOwn(result,'saved'),false);
  const price=saved.fields.fields.find(field=>field.name==='price');price.value='12';assert.equal(verifyNativeBatchMemberReadback(saved).ready,true);
});

test('independent readback detects every SKU price, currency, original content and enum drift',async()=>{
  for(const mutate of [saved=>saved.fields.fields.find(field=>field.name==='price').value='1',saved=>saved.fields.fields.find(field=>field.name==='price').unit='USD',saved=>saved.fields.fields.find(field=>field.name==='productTitle').value='Changed title',saved=>saved.fields.fields.find(field=>field.name==='material').value='塑料',saved=>saved.fields.fields.find(field=>field.name==='quantity').value='99']){
    const saved=await savedFixture();mutate(saved);const result=verifyNativeBatchMemberReadback(saved);assert.equal(result.ready,false);assert.ok(result.issues.length);
  }
});

test('independent readback rejects missing, extra, duplicate or changed SKU members and extra product prices',async()=>{
  for(const mutate of [saved=>saved.fields.fields=saved.fields.fields.filter(field=>field.rowIdentity?.sku!=='SKU-B'),saved=>{const field=clone(saved.fields.fields.find(field=>field.name==='price'));field.rowIdentity.sku='EXTRA';saved.fields.fields.push(field);},saved=>saved.fields.fields.find(field=>field.name==='price').rowIdentity.id='duplicate-sku-row',saved=>saved.fields.fields.find(field=>field.name==='price').rowIdentity.attributes[0].value='红色',saved=>saved.fields.fields.push({key:'extra',name:'productPrice',label:'商品价格 CNY',kind:'number',value:'88',unit:'CNY'})]){
    const saved=await savedFixture();mutate(saved);assert.equal(verifyNativeBatchMemberReadback(saved).ready,false);
  }
});

test('independent readback requires exact member, category and both whole-product and per-SKU price evidence',async()=>{
  for(const mutate of [saved=>saved.editor.sources[0]+='?changed=1',saved=>saved.editor.storeName='other',saved=>saved.editor.url=saved.editor.url.replace(sourceRows[0].draftId,sourceRows[1].draftId),saved=>saved.editor.categoryPath=['家居用品','收纳用品(其他)'],saved=>saved.editor.categoryPath=[],saved=>delete saved.editor.platformCategoryId,saved=>delete saved.memberPriceEvidence,saved=>saved.priceEvidence.pop(),saved=>saved.priceEvidence[0].evidence.ready=false,saved=>saved.fields.fields.find(field=>field.name==='material').value='']){
    const saved=await savedFixture();mutate(saved);assert.equal(verifyNativeBatchMemberReadback(saved).ready,false);
  }
});

test('unmatched or duplicated semantic controls report unknown instead of claiming saved',async()=>{
  const saved=await savedFixture();saved.fields.fields.find(field=>field.name==='material').name='unobserved';saved.fields.fields.find(field=>field.name==='unobserved').label='不同字段';
  const result=verifyNativeBatchMemberReadback(saved);assert.equal(result.ready,false);assert.match(result.issues.join(''),/无法.*唯一对应/);assert.equal(Object.hasOwn(result,'saved'),false);
  const duplicate=await savedFixture();duplicate.fields.fields.push(clone(duplicate.fields.fields.find(field=>field.name==='material')));assert.equal(verifyNativeBatchMemberReadback(duplicate).ready,false);
});

test('visible matching fields cannot substitute for complete SKU and price-control coverage',async()=>{
  for(const mutate of [saved=>delete saved.fields.variantEvidence,saved=>saved.fields.variantEvidence.complete=false,saved=>saved.fields.variantEvidence.priceFieldsComplete=false,saved=>delete saved.fields.variantEvidence.priceFieldsComplete,saved=>saved.fields.variantEvidence.url=url,saved=>saved.fields.variantEvidence.account='other',saved=>saved.fields.variantEvidence.issues=['存在隐藏或disabled价格列'],saved=>saved.fields.variantEvidence.variants.pop(),saved=>saved.fields.variantEvidence.variants[1]=clone(saved.fields.variantEvidence.variants[0]),saved=>saved.fields.variantEvidence.variants[0].sku='unobserved']){
    const saved=await savedFixture();mutate(saved);const result=verifyNativeBatchMemberReadback(saved);assert.equal(result.ready,false);assert.match(result.issues.join(''),/SKU|价格控件/);
  }
});
