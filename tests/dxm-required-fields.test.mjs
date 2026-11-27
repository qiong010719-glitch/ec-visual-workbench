import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readRequiredFields,fillRequiredFields,planRequiredFields,requiredNumericPlaceholder,completeRequiredFields} from '../src/dxm-required-fields.mjs';
import {planSourcePrices} from '../src/listing-field-policy.mjs';

const url='https://www.dianxiaomi.com/web/sheinx/edit?id=220114595121490272';
const expected={url,account:'fixture-account'};
let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
after(async()=>{await browser?.close();});
async function fixture(t,html){
  const context=await browser.newContext();t.after(()=>context.close());
  const page=await context.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><div class="btn-user"><span class="user-name">fixture-account</span></div><form id="product">${html}</form>`}));
  await page.goto(url);return page;
}
const read=page=>page.evaluate(readRequiredFields,{expected});
const fill=(page,plan)=>page.evaluate(fillRequiredFields,{expected,plan});
const values=page=>page.locator('input,textarea,select').evaluateAll(elements=>Object.fromEntries(elements.filter(e=>e.id).map(e=>[e.id,e.type==='checkbox'||e.type==='radio'?e.checked:e.value])));

test('numeric placeholders obey min/max and step, including zero and negative-only ranges',()=>{
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'0.05',max:'0.09',step:'0.1'}),'0.05');
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'2.5',max:'8',step:'2'}),'2.5');
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'0',max:'0.1',step:'0.001'}),'0.1');
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'0',max:'0.3',step:'any'}),'0.3');
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'0',max:'0',step:'1'}),'0');
  assert.equal(requiredNumericPlaceholder({kind:'number',name:'stock',min:'0',max:'0',step:'1'}),'0');
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'-10',max:'-2',step:'2'}),'-2');
  assert.equal(requiredNumericPlaceholder({kind:'number',name:'price',min:'0',max:'0',step:'1'}),null);
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'3',max:'2',step:'1'}),null);
  assert.equal(requiredNumericPlaceholder({kind:'number',min:'0',max:'2',step:'3'}),'0');
});

test('numeric controls whose only valid values are zero or negative are filled within their constraints',async t=>{
  const page=await fixture(t,`<label for="stock">库存</label><input id="stock" name="stock" type="number" required min="0" max="0"><label for="temperature">温度</label><input id="temperature" type="number" required min="-10" max="-2" step="2">`);
  const plan=planRequiredFields(await read(page));await fill(page,plan);
  assert.deepEqual(await values(page),{stock:'0',temperature:'-2'});assert.equal(await page.locator('form').evaluate(form=>form.checkValidity()),true);
});

test('visible required numeric blanks are filled and existing and optional values are retained',async t=>{
  const page=await fixture(t,`
    <label for="length">包装长 cm</label><input id="length" name="length" required type="number" min="2.5" max="20" step="2">
    <label for="weight">重量 kg</label><input id="weight" name="weight" required type="number" min="0.05" max="0.09" step="0.1">
    <label for="stock">库存</label><input id="stock" name="stock" required type="number" value="0">
    <label for="price">价格</label><input id="price" name="price" type="number">
    <label for="note">备注</label><textarea id="note"></textarea>
    <script>window.changed=[];document.addEventListener('input',e=>changed.push('input:'+e.target.id));document.addEventListener('change',e=>changed.push('change:'+e.target.id));</script>`);
  const snapshot=await read(page),plan=planRequiredFields(snapshot);
  assert.deepEqual(plan.writes.map(write=>write.label),['包装长 cm','重量 kg']);
  assert.deepEqual(plan.issues,[]);assert.equal((await fill(page,plan)).written,2);
  assert.deepEqual(await values(page),{length:'2.5',weight:'0.05',stock:'0',price:'',note:''});
  assert.deepEqual(await page.evaluate(()=>window.changed),['input:length','change:length','input:weight','change:weight']);
});

test('Ant labels, bootstrap errors and verified SKU numeric controls mark required fields',async t=>{
  const page=await fixture(t,`
    <div class="ant-form-item"><div class="ant-form-item-label"><label class="ant-form-item-required">材质</label></div><input name="material" id="material"></div>
    <div class="form-group"><label class="control-label" for="capacity">容量 *</label><input id="capacity" name="capacity" inputmode="decimal"></div>
    <div class="control-group"><label class="control-label" for="description">产品描述</label><textarea id="description" name="description"></textarea><span class="help-block error">请填写产品描述</span></div>
    <table><thead><tr><th>SKU货号</th><th>SKU价格</th><th>SKU库存</th></tr></thead><tbody><tr rowid="one"><td><input name="variationSku" value="sku-A"></td><td><input id="skuPrice" name="price"></td><td><input id="skuStock" name="stock"></td></tr></tbody></table>`);
  const snapshot=await read(page),plan=planRequiredFields(snapshot,{sourceValues:{material:'不锈钢',description:'来源说明'}});
  assert.deepEqual(plan.writes.map(write=>write.value),['不锈钢','1','来源说明','1']);
  assert.equal(snapshot.fields.find(field=>field.name==='price').requiredBy,'sku-field');
  assert.equal(snapshot.fields.find(field=>field.name==='price').protected,false);
  await fill(page,plan);
  assert.equal((await values(page)).skuPrice,'');
  assert.match(plan.issues.join(''),/价格不使用默认值/);
  assert.equal(await page.locator('[name="variationSku"]').inputValue(),'sku-A');
});

test('identity, secrets, agreement, hidden, disabled and readonly fields never become writes',async t=>{
  const page=await fixture(t,`
    <label for="storeId">店铺</label><input id="storeId" name="storeId" required>
    <label for="categoryId">产品分类</label><input id="categoryId" name="categoryId" required>
    <label for="sourceUrl">来源URL</label><input id="sourceUrl" name="sourceUrl" required>
    <label for="agreement">同意协议</label><input type="checkbox" id="agreement" required>
    <label for="secret">api key</label><input id="secret" name="api_key" required value="do-not-read-secret">
    <input type="password" name="password" value="password-secret" required>
    <input type="hidden" name="csrf_token" value="token-secret" required>
    <input type="file" id="file" required>
    <input type="number" id="invisible" style="display:none" required>
    <input type="number" id="disabled" disabled required>
    <input type="number" id="readonly" readonly required>
    <label for="quantity">数量</label><input type="number" id="quantity" required>`);
  const snapshot=await read(page),plan=planRequiredFields(snapshot,{defaults:{storeId:'999',categoryId:'111',sourceUrl:'https://example.test',agreement:true}});
  assert.deepEqual(plan.writes.map(write=>write.selector),['#quantity']);
  assert.equal(snapshot.fields.length,5);assert.doesNotMatch(JSON.stringify(snapshot),/do-not-read-secret|password-secret|token-secret/);
  assert.equal(plan.unresolved.length,4);await fill(page,plan);
  assert.equal((await values(page)).agreement,false);
});

test('native selects use explicit values or unique valid options, not arbitrary alternatives',async t=>{
  const page=await fixture(t,`
    <label for="unit">单位</label><select id="unit" name="unit" required><option value="">请选择</option><option value="kg">千克</option><option value="lb" disabled>磅</option></select>
    <label for="color">颜色</label><select id="color" name="color" required><option value="">请选择</option><option value="white">白色</option><option value="blue">蓝色</option></select>
    <label for="material">材质</label><select id="material" name="material" required><option value="">请选择</option><option value="steel">不锈钢</option><option value="plastic">塑料</option></select>`);
  const plan=planRequiredFields(await read(page),{sourceValues:{material:'不锈钢'}});
  assert.deepEqual(plan.writes.map(write=>[write.selector,write.value]),[['#unit','kg'],['#material','steel']]);
  assert.equal(plan.unresolved[0].label,'颜色');await fill(page,plan);
  assert.deepEqual(await values(page),{unit:'kg',color:'',material:'steel'});
});

test('radio groups honor required on later members and checkboxes need explicit values',async t=>{
  const page=await fixture(t,`
    <fieldset class="form-group"><legend>方向</legend><label><input id="left" type="radio" name="direction" value="left">左</label><label><input id="right" type="radio" name="direction" value="right" required>右</label></fieldset>
    <div class="form-group"><label for="wrapped">单独包装</label><input id="wrapped" name="wrapped" type="checkbox" required></div>`);
  const snapshot=await read(page);assert.equal(snapshot.fields.find(field=>field.name==='direction').required,true);
  assert.equal(planRequiredFields(snapshot).writes.length,0);
  const plan=planRequiredFields(snapshot,{sourceValues:{direction:'right',wrapped:true}});
  await fill(page,plan);assert.deepEqual(await values(page),{left:false,right:true,wrapped:true});
});

test('custom select search inputs are not filled as if selected product attributes',async t=>{
  const page=await fixture(t,`<div class="ant-form-item"><div class="ant-form-item-label"><label class="ant-form-item-required">产地</label></div><div class="ant-select"><input id="country-search" role="combobox" readonly aria-controls="countries"><span class="ant-select-selection-placeholder">请选择</span></div></div><div id="countries" role="listbox"><div role="option" id="cn">中国</div><div role="option" id="ca">加拿大</div></div>`);
  const snapshot=await read(page);assert.equal(snapshot.fields[0].kind,'combobox');assert.equal(snapshot.fields[0].empty,true);
  const plan=planRequiredFields(snapshot,{defaults:{产地:'中国'}});assert.equal(plan.writes.length,0);assert.match(plan.issues.join(''),/平台选择框/);
  assert.equal(await page.locator('#country-search').inputValue(),'');
});

test('writer validates all fields before first write and preserves concurrent edits',async t=>{
  const page=await fixture(t,`<label for="a">长度</label><input id="a" required type="number"><label for="b">宽度</label><input id="b" required type="number">`);
  const plan=planRequiredFields(await read(page));await page.locator('#b').fill('7');
  await assert.rejects(fill(page,plan),/已变化或已填写/);
  assert.deepEqual(await values(page),{a:'',b:'7'});
});

test('writer detects changed options and changed SKU identity before writing',async t=>{
  const page=await fixture(t,`<table><thead><tr><th>SKU</th><th>重量</th></tr></thead><tbody><tr rowid="one"><td><input id="sku" name="variationSku" value="A"></td><td><input id="weight" name="weight"></td></tr></tbody></table><label for="unit">单位</label><select id="unit" required><option value="">请选择</option><option value="g">克</option></select>`);
  const plan=planRequiredFields(await read(page));await page.locator('#sku').fill('B');
  await assert.rejects(fill(page,plan),/已变化/);assert.equal((await values(page)).weight,'');
  await page.locator('#sku').fill('A');await page.locator('#unit').evaluate(e=>e.add(new Option('千克','kg')));
  await assert.rejects(fill(page,plan),/已变化/);assert.equal((await values(page)).weight,'');
});

test('writer rejects invalid injected values and account changes without altering blanks',async t=>{
  const page=await fixture(t,`<label for="a">长度</label><input id="a" required type="number" min="1" max="4">`);
  const plan=planRequiredFields(await read(page));plan.writes[0].value='9';
  await assert.rejects(fill(page,plan),/平台校验规则/);assert.equal((await values(page)).a,'');
  await page.locator('.user-name').evaluate(e=>e.textContent='other-account');
  await assert.rejects(read(page),/账号已变化/);
});

test('iterative completion discovers fields made required after earlier input',async t=>{
  const page=await fixture(t,`
    <label for="length">长度</label><input id="length" name="length" required type="number">
    <label for="weight">重量</label><input id="weight" name="weight" type="number" style="display:none" min="0.2" max="0.5" step="0.1">
    <script>document.getElementById('length').addEventListener('input',()=>{const weight=document.getElementById('weight');weight.required=true;weight.style.display='';});</script>`);
  let identityChecks=0;
  const result=await completeRequiredFields({page,expected,validateIdentity(){identityChecks++;}});
  assert.equal(result.completed,true);assert.equal(result.rounds,2);assert.equal(result.changes.length,2);assert.ok(identityChecks>=5);
  assert.deepEqual(await values(page),{length:'1',weight:'0.5'});
});

test('iterative completion reports unresolved facts and never substitutes fabricated text',async t=>{
  const page=await fixture(t,`<label for="material">材质 *</label><input id="material" name="material"><label for="stock">库存</label><input id="stock" name="stock" required type="number">`);
  const result=await completeRequiredFields({page,expected});
  assert.equal(result.completed,false);assert.equal(result.changes.length,1);assert.match(result.issues.join(''),/材质/);
  assert.deepEqual(await values(page),{material:'',stock:'1'});
});

test('completion stops when a controlled input rejects changes and when cancellation is requested',async t=>{
  const page=await fixture(t,`<label for="length">长度</label><input id="length" required type="number"><script>document.getElementById('length').addEventListener('input',event=>event.target.value='');</script>`);
  const result=await completeRequiredFields({page,expected,maxRounds:6});
  assert.equal(result.completed,false);assert.equal(result.rounds,1);assert.match(result.issues.join(''),/没有产生可核实/);
  await assert.rejects(completeRequiredFields({page,expected,isStopped:()=>true}),/已暂停/);
});

test('explicit optional fields, unsupported text patterns and unavailable numeric values remain untouched',async t=>{
  const page=await fixture(t,`<label for="optional">可选数字 *</label><input id="optional" type="number" aria-required="false"><label for="count">数量</label><input id="count" type="number" required min="2" max="1"><label for="code">展示文字</label><input id="code" name="displayText" required pattern="[A-Z]{3}" maxlength="3">`);
  const plan=planRequiredFields(await read(page),{sourceValues:{displayText:'abc'}});
  assert.equal(plan.writes.length,0);assert.equal(plan.missing.length,2);assert.match(plan.issues.join(''),/数值/);assert.match(plan.issues.join(''),/格式/);
});

const priceFacts={version:1,platform:'temu',goodsId:'601099601603935',sourceUrl:'https://www.temu.com/goods.html?goods_id=601099601603935',observedAt:'2026-11-25T00:00:00Z',status:'ready',categoryPath:['工具'],selectedVariant:{skuId:'A',attributes:[{name:'规格',value:'单件'}],selectionComplete:true},variants:[{skuId:'A',attributes:[{name:'规格',value:'单件'}],price:{kind:'displayed-sale',amount:'12.35',currency:'USD'}}],issues:[]};
const makePricePlan=snapshot=>planSourcePrices(snapshot,{platform:'shein',businessMode:'marketplace',goodsId:priceFacts.goodsId,sourceFacts:priceFacts,clock:()=>Date.parse('2026-11-25T01:00:00Z')});

test('verified source price corrects an existing price and is rechecked after writing',async t=>{
  const page=await fixture(t,`<table><thead><tr><th>SKU</th><th>售价 USD</th></tr></thead><tbody><tr rowid="one"><td><input id="sku" name="variationSku" value="A"></td><td><input type="number" step="0.01" name="price" id="price" value="1"></td></tr></tbody></table><label for="stock">库存</label><input id="stock" required type="number">`);
  const result=await completeRequiredFields({page,expected,allowOrdinaryDefaults:true,defaults:{price:'3'},pricePlanFor:makePricePlan});
  assert.equal(result.ready,true);assert.equal((await values(page)).price,'12.35');assert.equal((await values(page)).stock,'1');
  const change=result.changes.find(item=>item.reason==='verified-source-price');assert.equal(change.previousValue,'1');assert.equal(change.sourcePrice.source.skuId,'A');
});

test('verified source price writer rejects concurrent price or currency changes before any write',async t=>{
  const page=await fixture(t,`<div class="form-group"><label for="stock">库存</label><input id="stock" required type="number"></div><table><thead><tr><th>SKU</th><th>售价 USD</th></tr></thead><tbody><tr rowid="one"><td><input name="variationSku" value="A"></td><td><input name="price" id="price" type="number" step="0.01" value="1"></td></tr></tbody></table>`);
  const s=await read(page),plan=planRequiredFields(s,{pricePlan:makePricePlan(s)});await page.locator('#price').fill('5');
  await assert.rejects(fill(page,plan),/已变化/);assert.equal((await values(page)).stock,'');assert.equal((await values(page)).price,'5');
  await page.locator('#price').fill('1');await page.locator('th').last().evaluate(node=>node.textContent='售价 CNY');
  await assert.rejects(fill(page,plan),/已变化/);assert.equal((await values(page)).stock,'');
});

test('ordinary native options are filled while brand and certificate remain protected',async t=>{
  const page=await fixture(t,`<label for="material">材质</label><select id="material" required><option value="">请选择</option><option value="steel">钢</option><option value="other">其他</option></select><label for="brand">品牌</label><input id="brand" name="brand" required><label for="certificate">认证</label><input id="certificate" name="certificate" required><label for="note">样式</label><input id="note" required>`);
  const plan=planRequiredFields(await read(page),{allowOrdinaryDefaults:true,defaults:{brand:'随意品牌',certificate:'123'}});await fill(page,plan);
  assert.deepEqual(await values(page),{material:'other',brand:'',certificate:'',note:'其他'});assert.equal(plan.unresolved.length,2);
});

test('visible SKU attributes match renamed merchant SKUs without copying stock into specs',async t=>{
  const page=await fixture(t,`<table><thead><tr><th>规格</th><th>SKU</th><th>售价 USD</th><th>库存</th></tr></thead><tbody><tr rowid="one"><td>单件</td><td><input name="variationSku" value="merchant-A"></td><td><input name="price" id="price" type="number" step="0.01" value="1"></td><td><input name="stock" value="5"></td></tr></tbody></table>`);
  const snapshot=await read(page),price=snapshot.fields.find(field=>field.name==='price');assert.deepEqual(price.rowIdentity.attributes,[{name:'规格',value:'单件'}]);
  const plan=planRequiredFields(snapshot,{pricePlan:makePricePlan(snapshot)});assert.equal(plan.issues.length,0);await fill(page,plan);assert.equal((await values(page)).price,'12.35');
});
