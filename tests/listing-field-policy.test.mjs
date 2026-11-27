import test from 'node:test';
import assert from 'node:assert/strict';
import {planSourcePrices,validateSourcePrices,resolvePriceSemantic,isPriceField,variantSignature,captureExistingDxmPrices} from '../src/listing-field-policy.mjs';
import {planRequiredFields} from '../src/dxm-required-fields.mjs';
import {ECB_RATES_URL,convertDisplayedSalePrice,normalizeMoneyAmount} from '../src/sourcing-fx.mjs';

const goodsId='601099601603935',now=Date.parse('2026-11-25T06:00:00Z');
const price={amount:'1000',currency:'JPY',kind:'displayed-sale'};
const attributes=[{name:'颜色',value:'白色'},{name:'规格',value:'单件'}];
const sourceFacts=()=>({version:1,platform:'temu',goodsId,sourceUrl:`https://www.temu.com/goods.html?goods_id=${goodsId}`,observedAt:'2026-11-25T05:00:00Z',status:'ready',categoryPath:['办公用品'],price,selectedVariant:{skuId:'source-1',attributes,selectionComplete:true},variants:[{skuId:'source-1',attributes,price}],issues:[]});
const field=(overrides={})=>({key:'#p',selector:'#p',shape:'fixture-shape',kind:'number',name:'price',label:'售价 USD',unit:'USD',required:true,protected:false,value:'',empty:true,options:[],step:'0.01',rowIdentity:{id:'row-1',sku:'source-1'},errors:[],...overrides});
const snapshot=(fields=[field()])=>({url:'https://www.dianxiaomi.com/web/sheinx/edit?id=123',account:'fixture-account',fields});
const quote={from:'JPY',to:'USD',source:'欧洲央行 ECB',sourceUrl:ECB_RATES_URL,date:'2026-11-24',fetchedAt:'2026-11-25T04:00:00Z',sourcePerEur:'160',targetPerEur:'1.1'};
const options=(overrides={})=>({platform:'shein',businessMode:'marketplace',sourceFacts:sourceFacts(),goodsId,fxQuote:quote,clock:()=>now,...overrides});

test('DXM price readiness requires actual SKU amounts, not currency or optional recommendation controls',()=>{
  const currency=field({name:'priceCurrency',label:'价格币种',kind:'select',value:'CNY',empty:false});
  const recommendation=field({name:'suggestedPrice',label:'建议零售价',required:false,value:'99',empty:false});
  for(const fields of [[],[currency],[recommendation],[currency,recommendation]]){
    const plan=captureExistingDxmPrices(snapshot(fields),{platform:'shein',goodsId});
    assert.equal(plan.ready,false);assert.match(plan.issues.join(''),/实际SKU价格/);
  }
  const amount=field({key:'#actual',name:'amount',label:'价格',required:false});
  assert.match(captureExistingDxmPrices(snapshot([currency,amount]),{platform:'shein',goodsId}).issues.join(''),/价格为空/);
  assert.equal(captureExistingDxmPrices(snapshot([currency,{...amount,value:'12.30',empty:false}]),{platform:'shein',goodsId}).ready,true);
});

test('price conversion uses decimal half-up and retains the exact FX snapshot',()=>{
  const result=convertDisplayedSalePrice(price,'USD',quote,{clock:()=>now});
  assert.equal(result.amount,'6.88');assert.equal(result.originalAmount,'1000');assert.equal(result.conversion.sourcePerEur,'160');assert.equal(result.conversion.rounding,'half-up:2');
  assert.equal(convertDisplayedSalePrice({amount:'1.00',currency:'EUR'},'USD',{...quote,from:'EUR',sourcePerEur:'1',targetPerEur:'1.005'},{clock:()=>now}).amount,'1.01');
  assert.equal(convertDisplayedSalePrice({amount:'100.10',currency:'USD'},'USD',null,{clock:()=>now}).amount,'100.10');
  assert.equal(normalizeMoneyAmount('6.8800','USD'),'6.88');
  assert.throws(()=>normalizeMoneyAmount('1.1','JPY'),/小数位/);
  assert.throws(()=>convertDisplayedSalePrice(price,'XYZ',quote,{clock:()=>now}),/币种/);
});

test('stale, future, malformed or mismatched FX cannot be applied to prices',()=>{
  for(const change of [{date:'2026-11-01'},{date:'2026-11-26'},{fetchedAt:'2026-11-26T01:00:00Z'},{date:'2026-02-31'},{targetPerEur:'0'},{from:'CNY'},{to:'GBP'},{sourceUrl:'https://wrong.test'}])assert.throws(()=>convertDisplayedSalePrice(price,'USD',{...quote,...change},{clock:()=>now}));
});

test('platform price semantics distinguish Temu declaration, SHEIN mode and TikTok local price',()=>{
  assert.equal(resolvePriceSemantic(field({label:'申报价格 CNY'}),{platform:'temu'}).semantic,'temu-declared-price');
  assert.equal(resolvePriceSemantic(field(),{platform:'shein',businessMode:'OBM'}).semantic,'shein-supply-price');
  assert.equal(resolvePriceSemantic(field(),{platform:'shein',businessMode:'marketplace'}).semantic,'shein-local-sale-price');
  assert.match(resolvePriceSemantic(field(),{platform:'shein'}).issue,/经营模式/);
  assert.equal(resolvePriceSemantic(field(),{platform:'tiktok'}).semantic,'tiktok-local-sale-price');
  assert.match(resolvePriceSemantic(field({label:'申报价格 CNY'}),{platform:'tiktok'}).issue,/不是 TikTok/);
  assert.match(resolvePriceSemantic(field({name:'suggestedPrice',label:'建议零售价'}),{platform:'temu'}).issue,/不是 Temu/);
  assert.equal(isPriceField({label:'出厂单价'}),true);
  for(const label of ['原价','特价','促销价','折扣价'])assert.equal(isPriceField({name:'input',label}),true);
  assert.equal(resolvePriceSemantic(field({name:'salePrice',label:'特价'}),{platform:'shein',businessMode:'OBM'}).semantic,null);
  assert.equal(resolvePriceSemantic(field({name:'supplyPrice',label:'供货价 CNY'}),{platform:'shein',businessMode:'OBM'}).semantic,'shein-supply-price');
});

test('existing incorrect price is planned for correction and cannot be overridden by defaults',()=>{
  const s=snapshot([field({value:'1.00',empty:false})]),pricePlan=planSourcePrices(s,options());
  assert.equal(pricePlan.ready,true);assert.equal(pricePlan.prices[0].expectedValue,'6.88');
  const plan=planRequiredFields(s,{pricePlan,defaults:{price:'9'},sourceValues:{price:'8'},allowOrdinaryDefaults:true});
  assert.equal(plan.writes.length,1);assert.equal(plan.writes[0].value,'6.88');assert.equal(plan.writes[0].reason,'verified-source-price');assert.equal(plan.writes[0].previousValue,'1.00');
  assert.match(validateSourcePrices(s,options()).issues.join(''),/不一致/);
  const updated=snapshot([field({value:'6.88',empty:false})]);assert.equal(validateSourcePrices(updated,options()).ready,true);assert.equal(planRequiredFields(updated,{pricePlan:planSourcePrices(updated,options())}).writes.length,0);
});

test('price fields never receive generic numeric, configured or source-value defaults',()=>{
  for(const f of [field(),field({name:'salePrice'}),field({name:'x',label:'单价',kind:'text'})]){
    const plan=planRequiredFields(snapshot([f]),{defaults:{[f.name]:'1'},sourceValues:{[f.name]:'2'},allowOrdinaryDefaults:true});
    assert.equal(plan.writes.length,0);assert.match(plan.issues.join(''),/不使用默认值/);
  }
});

test('unknown currency and target currency conflict stop price planning',()=>{
  assert.match(planSourcePrices(snapshot([field({label:'售价 ¥',unit:''})]),options()).issues.join(''),/明确币种/);
  assert.match(planSourcePrices(snapshot(),options({targetCurrency:'CNY'})).issues.join(''),/不一致/);
  assert.match(planSourcePrices(snapshot([field({label:'售价 XYZ',unit:'XYZ'})]),options()).issues.join(''),/币种/);
});

test('source product identity, source time and directly displayed price are required',()=>{
  for(const mutate of [facts=>facts.goodsId='999',facts=>facts.sourceUrl='https://other.test',facts=>facts.observedAt='2026-11-26T01:00:00Z',facts=>facts.selectedVariant.selectionComplete=false,facts=>facts.variants[0].price={...price,kind:'coupon-price'}]){
    const facts=sourceFacts();mutate(facts);const plan=planSourcePrices(snapshot(),options({sourceFacts:facts}));assert.equal(plan.ready,false);assert.ok(plan.issues.length);
  }
});

test('selected variant price is not copied into unmatched destination SKUs',()=>{
  const s=snapshot([field(),field({key:'#p2',selector:'#p2',rowIdentity:{id:'row-2',sku:'another-sku'}})]);
  const plan=planSourcePrices(s,options());assert.equal(plan.ready,false);assert.equal(plan.prices.length,1);assert.match(plan.issues.join(''),/未匹配.*规格/);
});

test('exact SKU mapping supports renamed target SKU and rejects conflicting attributes',()=>{
  const s=snapshot([field({rowIdentity:{id:'row-1',sku:'local-A'}})]);
  const mapped=planSourcePrices(s,options({skuMappings:[{targetSku:'local-A',sourceSkuId:'source-1',sourceAttributes:attributes}]}));assert.equal(mapped.ready,true);
  const wrong=planSourcePrices(s,options({skuMappings:[{targetSku:'local-A',sourceSkuId:'source-1',sourceAttributes:[{name:'颜色',value:'黑色'}]}]}));assert.equal(wrong.ready,false);assert.match(wrong.issues.join(''),/唯一已核实/);
  const conflict=planSourcePrices(snapshot([field({rowIdentity:{id:'row-1',sku:'source-1',attributes:[{name:'颜色',value:'黑色'}]}})]),options());assert.equal(conflict.ready,false);assert.match(conflict.issues.join(''),/相互冲突/);
});

test('complete attribute signatures match, partial or duplicate attributes do not',()=>{
  assert.equal(variantSignature([...attributes].reverse()),variantSignature(attributes));assert.equal(variantSignature([{name:'颜色',value:'白色'},{name:'颜色',value:'黑色'}]),null);
  assert.equal(variantSignature([{name:'Color',value:'白色'},{name:'规格',value:'单件'}]),variantSignature(attributes));assert.equal(variantSignature([{name:'Color',value:'白色'},{name:'颜色',value:'白色'}]),null);
  assert.equal(planSourcePrices(snapshot([field({rowIdentity:{id:'row-1',sku:'local-A',attributes}})]),options()).ready,true);
  assert.equal(planSourcePrices(snapshot([field({rowIdentity:{id:'row-1',sku:'local-A',attributes:attributes.slice(0,1)}})]),options()).ready,false);
});

test('unvaried product may use a single base price but never two target SKU rows',()=>{
  const facts=sourceFacts();facts.selectedVariant={attributes:[],selectionComplete:true};facts.variants=[{attributes:[],price}];
  assert.equal(planSourcePrices(snapshot([field({rowIdentity:null})]),options({sourceFacts:facts})).ready,true);
  assert.equal(planSourcePrices(snapshot([field({rowIdentity:{id:'a',sku:'a'}}),field({key:'#b',selector:'#b',rowIdentity:{id:'b',sku:'b'}})]),options({sourceFacts:facts})).ready,false);
});

test('stale price binding cannot overwrite a concurrently edited value or another page',()=>{
  const s=snapshot(),pricePlan=planSourcePrices(s,options());
  const edited=snapshot([field({value:'99',empty:false})]);assert.equal(planRequiredFields(edited,{pricePlan}).writes.length,0);assert.match(planRequiredFields(edited,{pricePlan}).issues.join(''),/已变化/);
  assert.equal(planRequiredFields({...s,url:'https://other.test'},{pricePlan}).writes.length,0);
});

test('authorized ordinary defaults prefer neutral actual options and preserve existing facts',()=>{
  const ordinary=(key,overrides={})=>({key,selector:key,shape:key,kind:'select',name:key,label:key,required:true,protected:false,value:'',empty:true,options:[{value:'known',label:'第一种'},{value:'other',label:'其他'}],errors:[],...overrides});
  const s=snapshot([ordinary('material'),ordinary('color',{value:'known',empty:false}),ordinary('brand',{label:'品牌',protected:true}),ordinary('memo',{kind:'text',options:[]}),ordinary('shape')]);
  const plan=planRequiredFields(s,{allowOrdinaryDefaults:true,sourceValues:{shape:'known'},defaults:{shape:'other'}});
  assert.deepEqual(plan.writes.map(item=>[item.key,item.value]),[['material','other'],['memo','其他'],['shape','known']]);assert.match(plan.issues.join(''),/品牌/);
});
