import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBatchScope} from '../src/dxm-native-batch.mjs';
import {NATIVE_FIELD_POLICY,captureNativeBatchFieldState,planNativeBatchFields,validateNativeBatchFieldState,validateNativeBatchWritePlan,validateNativeBatchOriginalPrices,completeNativeBatchFields} from '../src/dxm-native-fields.mjs';
import {captureExistingDxmPrices,isPriceField} from '../src/listing-field-policy.mjs';

const clone=value=>structuredClone(value),account='native-fixture',storeName='fixture-shop',url='https://www.dianxiaomi.com/web/sheinProduct/batchEdit';
const sourceRows=[1,2].map(number=>({draftId:'22011460295192916'+number,goodsId:'60123456789000'+number,sourceUrl:`https://www.temu.com/appliance-g-60123456789000${number}.html`,storeName,storeBindingKey:'fixture-store'}));
const scope=nativeBatchScope({platform:'shein',account,storeBinding:{key:'fixture-store',storeName,site:'美国站'},rows:sourceRows});
const categories=[{id:'100',path:['家用电器','厨房电器'],leaf:true},{id:'200',path:['家居用品','收纳'],leaf:true}];
const field=(key,name,value,targets,extra={})=>({key,selector:'#'+key,shape:'shape-'+key,name,label:name,kind:'text',required:true,protected:false,value,empty:value==='',options:[],errors:[],targets:targets.map(target=>({...target,value})),...extra});
const target=(member=0,variantKey='')=>({draftId:sourceRows[member].draftId,variantKey});
function fixture(){
  return {version:1,surface:'native-batch',platform:'shein',url,account,scopeKey:scope.scopeKey,complete:true,
    members:sourceRows.map((row,index)=>({...clone(row),site:'美国站',category:clone(categories[index]),variants:index===0?[{key:'sku-a',sku:'A',attributes:[{name:'颜色',value:'白色'}]},{key:'sku-b',sku:'B',attributes:[{name:'颜色',value:'黑色'}]}]:[{key:'sku-c',sku:'C',attributes:[]}]})),
    groups:[{key:'cat100',memberIds:[sourceRows[0].draftId],category:clone(categories[0]),complete:true,fields:[
      field('price-a','price','12.00',[target(0,'sku-a')],{kind:'number',label:'供货价 CNY',unit:'CNY'}),field('price-b','price','18.50',[target(0,'sku-b')],{kind:'number',label:'供货价 CNY',unit:'CNY'}),
      field('stock-a','stock','',[target(0,'sku-a')],{kind:'number',min:'1',max:'5',step:'1'}),field('stock-b','stock','7',[target(0,'sku-b')],{kind:'number'}),
      field('material','material','',[target()],{kind:'combobox',label:'材质',options:[{value:'原始值-1',label:'塑料'},{value:'原始值-2',label:'其他'}]}),
      field('description','description','',[target()],{label:'英文描述',language:'en'}),field('title','title','Existing title',[target()]),
    ]},{key:'cat200',memberIds:[sourceRows[1].draftId],category:clone(categories[1]),complete:true,fields:[
      field('price-c','price','25',[target(1,'sku-c')],{kind:'number',label:'供货价 CNY',unit:'CNY'}),
      field('weight','weight','',[target(1,'sku-c')],{kind:'number',min:'0.1',max:'0.9',step:'0.2'}),
      field('usage','usage','',[target(1)],{kind:'select',label:'用途',options:[{value:'123',label:'日常'},{value:'456',label:'其他'}]}),
    ]}]
  };
}
function applyPlan(snapshot,plan){
  for(const write of plan.writes){const group=snapshot.groups.find(item=>item.key===write.groupKey),control=group.fields.find(item=>item.key===write.key);assert.ok(control);assert.equal(control.shape,write.shape);control.value=clone(write.value);control.empty=false;for(const item of control.targets){assert.ok(write.targets.some(target=>target.draftId===item.draftId&&target.variantKey===item.variantKey));item.value=clone(write.value);}if(control.kind==='checkbox')control.checked=true;}
}

function originalPrices(snapshot){return snapshot.members.map(member=>({draftId:member.draftId,goodsId:member.goodsId,evidence:captureExistingDxmPrices({url:'https://www.dianxiaomi.com/web/sheinProduct/edit?id='+member.draftId,account,fields:snapshot.groups.flatMap(group=>group.fields.filter(isPriceField).flatMap(field=>field.targets.filter(target=>target.draftId===member.draftId).map(target=>{const variant=member.variants.find(item=>item.key===target.variantKey);return {...clone(field),key:field.key+'-'+target.variantKey,value:target.value,rowIdentity:variant?{sku:variant.sku,attributes:clone(variant.attributes)}:null};})))},{platform:'shein',goodsId:member.goodsId})}));}

test('category transitions preserve the original single-editor amounts rather than rebasing prices afterwards',()=>{
  const before=fixture(),original=originalPrices(before),after=clone(before);
  // The UI adapter may use another control name for the same visible semantic.
  after.groups[0].fields[0].name='supplyPrice';after.groups[0].fields[0].targets[0].value='12';
  assert.deepEqual(validateNativeBatchOriginalPrices(after,{scope,originalPrices:original}).issues,[]);
  after.groups[0].fields[0].targets[0].value='1';
  const changed=validateNativeBatchOriginalPrices(after,{scope,originalPrices:original});assert.equal(changed.ready,false);assert.match(changed.issues.join(''),/分类前后.*价格/);
  // Capturing a new baseline after the category mutation would incorrectly pass.
  assert.equal(captureNativeBatchFieldState(after,{scope}).ready,true);
});

test('original price proof requires exact all-member, all-SKU and whole-product price scope',()=>{
  const before=fixture(),original=originalPrices(before);
  for(const mutate of [snapshot=>snapshot.groups[0].fields[0].unit='USD',snapshot=>snapshot.members[0].variants[0].attributes[0].value='红色',snapshot=>snapshot.groups[0].fields.splice(0,1),snapshot=>snapshot.groups[0].fields.push(field('global-price','productPrice','10',[target()],{kind:'number',label:'商品价格 CNY',unit:'CNY'}))]){const after=clone(before);mutate(after);assert.equal(validateNativeBatchOriginalPrices(after,{scope,originalPrices:original}).ready,false);}
  for(const mutate of [proof=>proof.pop(),proof=>proof[0].evidence.url='https://www.dianxiaomi.com/web/sheinProduct/edit?id='+sourceRows[1].draftId,proof=>proof[0].evidence.account='other',proof=>proof[0].evidence.ready=false,proof=>proof[0].goodsId='wrong']){const evidence=clone(original);mutate(evidence);assert.equal(validateNativeBatchOriginalPrices(before,{scope,originalPrices:evidence}).ready,false);}
});

test('native category identity retains true platform IDs and never downgrades them to path-only matching',()=>{
  const snapshot=fixture();
  for(const category of [snapshot.members[0].category,snapshot.groups[0].category]){category.id='';category.platformCategoryId='platform-100';category.idKind='platform';category.candidateId='dxm-search:visible';}
  const baseline=captureNativeBatchFieldState(snapshot,{scope});assert.equal(baseline.ready,true);assert.equal(baseline.members[0].category.platformCategoryId,'platform-100');assert.equal(baseline.members[0].category.candidateId,'dxm-search:visible');
  const missing=clone(snapshot);for(const category of [missing.members[0].category,missing.groups[0].category])delete category.platformCategoryId;
  assert.equal(validateNativeBatchFieldState(missing,baseline,{scope}).ready,false);
  const pathOnly=fixture();for(const category of [pathOnly.members[0].category,pathOnly.groups[0].category]){category.id='dxm-search:path-only';category.idKind='observed-path';}
  const pathState=captureNativeBatchFieldState(pathOnly,{scope});assert.equal(pathState.ready,true);assert.equal(pathState.members[0].category.platformCategoryId,null);assert.equal(pathState.members[0].category.candidateId,'dxm-search:path-only');
  pathOnly.members[0].category.id='dxm-search:refreshed';pathOnly.groups[0].category.id='dxm-search:refreshed';assert.equal(validateNativeBatchFieldState(pathOnly,pathState,{scope}).ready,true);
  pathOnly.members[0].category.platformCategoryId='path:unsafe';assert.match(captureNativeBatchFieldState(pathOnly,{scope}).issues.join(''),/分类/);
});

test('native field capture binds all groups, members and variant prices without certifying FX',()=>{
  const state=captureNativeBatchFieldState(fixture(),{scope});assert.equal(state.ready,true);assert.equal(state.members.length,2);assert.equal(state.groups.length,2);assert.equal(state.priceEvidence.length,3);assert.equal(state.priceEvidence[0].evidence.fxVerified,false);assert.deepEqual(state.priceEvidence[0].evidence.conversions,[]);
  for(const mutate of [snapshot=>snapshot.complete=false,snapshot=>snapshot.members.pop(),snapshot=>snapshot.groups[1].memberIds=[sourceRows[0].draftId],snapshot=>snapshot.groups[0].fields[0].targets[0].draftId=sourceRows[1].draftId]){const snapshot=fixture();mutate(snapshot);assert.equal(captureNativeBatchFieldState(snapshot,{scope}).ready,false);}
});

test('every variant must expose an actual price, not just price currency or recommended price',()=>{
  for(const replacement of [[],[field('currency','priceCurrency','CNY',[target(0,'sku-a')],{kind:'select'})],[field('recommend','suggestedPrice','',[target(0,'sku-a')],{kind:'number',required:false,label:'建议零售价 CNY',unit:'CNY'})]]){
    const snapshot=fixture();snapshot.groups[0].fields=snapshot.groups[0].fields.filter(item=>item.key!=='price-a').concat(replacement);
    const state=captureNativeBatchFieldState(snapshot,{scope});assert.equal(state.ready,false);assert.match(state.issues.join(''),/实际SKU价格/);assert.equal(planNativeBatchFields(snapshot,{scope,targetLanguage:'en'}).writes.length,0);
  }
  const blank=fixture();blank.groups[0].fields[0].targets[0].value='';assert.match(captureNativeBatchFieldState(blank,{scope}).issues.join(''),/价格为空/);
});

test('native defaults use platform option values, target-language text and valid numeric constraints while preserving prices',()=>{
  const snapshot=fixture(),plan=planNativeBatchFields(snapshot,{scope,targetLanguage:'en',defaults:{price:'1'}});
  assert.equal(plan.issues.length,0);assert.equal(plan.canApply,true);assert.equal(plan.ready,false);
  assert.deepEqual(plan.writes.map(write=>[write.key,write.value]).sort(),[['description','Other'],['material','原始值-2'],['stock-a','1'],['usage','456'],['weight','0.9']].sort());
  const choice=plan.writes.find(write=>write.key==='material');assert.equal(choice.kind,'combobox');assert.deepEqual(choice.optionEvidence,[{value:'原始值-2',label:'其他'}]);
  assert.ok(plan.writes.every(write=>!write.key.startsWith('price-')&&write.key!=='title'&&write.key!=='stock-b'));
  const baseline=captureNativeBatchFieldState(snapshot,{scope});applyPlan(snapshot,plan);assert.equal(validateNativeBatchFieldState(snapshot,baseline,{scope,expectedWrites:plan.writes}).ready,true);
  assert.equal(planNativeBatchFields(snapshot,{scope,baseline,expectedWrites:plan.writes,targetLanguage:'en'}).ready,true);
});

test('mixed existing values never allow a shared default to overwrite a populated SKU',()=>{
  const snapshot=fixture();snapshot.groups[0].fields.push(field('shared-stock','stock','',[target(0,'sku-a'),target(0,'sku-b')],{kind:'number',semanticKey:'sharedStock',targets:[{...target(0,'sku-a'),value:''},{...target(0,'sku-b'),value:'3'}]}));
  const plan=planNativeBatchFields(snapshot,{scope,targetLanguage:'en'});assert.ok(!plan.writes.some(write=>write.key==='shared-stock'));assert.match(plan.issues.join(''),/覆盖已有内容/);
  const shared=snapshot.groups[0].fields.at(-1);delete shared.targets[1].value;assert.match(captureNativeBatchFieldState(snapshot,{scope}).issues.join(''),/每个受影响商品/);
});

test('brand, certifications, identity and category are never defaulted through native attribute controls',()=>{
  const snapshot=fixture();for(const name of ['brand','certificate','sourceUrl','category','currency'])snapshot.groups[0].fields.push(field('protected-'+name,name,'',[target()],{required:false}));
  const plan=planNativeBatchFields(snapshot,{scope,targetLanguage:'en',defaults:{brand:'Other',certificate:'Yes',category:'changed'}});
  assert.ok(!plan.writes.some(write=>write.key.startsWith('protected-')));
  snapshot.groups[0].fields.find(field=>field.name==='brand').required=true;assert.match(captureNativeBatchFieldState(snapshot,{scope}).issues.join(''),/真实资料/);
});

test('unknown text language and conflicting per-member defaults stay explicit instead of guessing',()=>{
  const snapshot=fixture();delete snapshot.groups[0].fields.find(item=>item.name==='description').language;
  const plan=planNativeBatchFields(snapshot,{scope});assert.match(plan.issues.join(''),/目标语言/);assert.ok(!plan.writes.some(write=>write.key==='description'));
  const unified=fixture();unified.groups[0].fields.push(field('two-variants','memo','',[target(0,'sku-a'),target(0,'sku-b')],{language:'en'}));
  const defaults={byMember:{[sourceRows[0].draftId]:{byVariant:{'sku-a':{memo:'A'},'sku-b':{memo:'B'}}}}};
  const conflicting=planNativeBatchFields(unified,{scope,targetLanguage:'en',defaults});assert.match(conflicting.issues.join(''),/需要不同内容/);assert.ok(!conflicting.writes.some(write=>write.key==='two-variants'));
  const untranslated=planNativeBatchFields(fixture(),{scope,targetLanguage:'en',sourceValues:{description:'原始中文描述'}});assert.match(untranslated.issues.join(''),/目标字段语言不符/);assert.ok(!untranslated.writes.some(write=>write.key==='description'));
  const translated=planNativeBatchFields(fixture(),{scope,targetLanguage:'en',sourceValues:{description:'Verified English description'}});assert.equal(translated.writes.find(write=>write.key==='description').value,'Verified English description');
});

test('native validation detects price, currency, existing title, SKU, category and member drift',()=>{
  const baseline=captureNativeBatchFieldState(fixture(),{scope});
  for(const mutate of [snapshot=>snapshot.groups[0].fields[0].targets[0].value='1',snapshot=>snapshot.groups[0].fields[0].unit='USD',snapshot=>snapshot.groups[0].fields.find(item=>item.name==='title').targets[0].value='Changed',snapshot=>snapshot.members[0].variants.pop(),snapshot=>snapshot.members[0].category.path[1]='其他分类',snapshot=>snapshot.members[0].sourceUrl+='?changed=1']){
    const snapshot=fixture();mutate(snapshot);assert.equal(validateNativeBatchFieldState(snapshot,baseline,{scope}).ready,false);
  }
  const reordered=fixture();reordered.members.reverse();reordered.members[1].variants.reverse();reordered.groups.reverse();reordered.groups[1].fields[0].targets[0].value='12';assert.equal(validateNativeBatchFieldState(reordered,baseline,{scope}).ready,true);
});

test('multi-variant products cannot hide an unbound product-level price or unidentified variants',()=>{
  const snapshot=fixture();snapshot.groups[0].fields.push(field('product-price','productPrice','88',[target()],{kind:'number',label:'商品价格 CNY',unit:'CNY'}));
  const baseline=captureNativeBatchFieldState(snapshot,{scope});assert.equal(baseline.ready,true);snapshot.groups[0].fields.at(-1).targets[0].value='1';assert.match(validateNativeBatchFieldState(snapshot,baseline,{scope}).issues.join(''),/价格.*发生变化/);
  snapshot.groups[0].fields.at(-1).targets[0].value='88.00';snapshot.groups[0].fields.at(-1).unit='USD';assert.match(validateNativeBatchFieldState(snapshot,baseline,{scope}).issues.join(''),/币种.*发生变化/);
  snapshot.groups[0].fields.at(-1).unit='CNY';assert.equal(validateNativeBatchFieldState(snapshot,baseline,{scope}).ready,true);
  const anonymous=fixture();for(const variant of anonymous.members[0].variants){variant.sku='';variant.attributes=[];}assert.match(captureNativeBatchFieldState(anonymous,{scope}).issues.join(''),/SKU缺少唯一/);
});

test('ordinary required errors can be repaired by filling while errors on existing data remain blocked',async()=>{
  const snapshot=fixture(),stock=snapshot.groups[0].fields.find(item=>item.key==='stock-a');stock.errors=['请输入库存'];
  const plan=planNativeBatchFields(snapshot,{scope,targetLanguage:'en'});assert.equal(plan.writes.find(write=>write.key==='stock-a').value,'1');
  const result=await completeNativeBatchFields({scope,targetLanguage:'en',read:()=>clone(snapshot),apply:plan=>{applyPlan(snapshot,plan);stock.errors=[];}});assert.equal(result.ready,true);
  stock.errors=['库存值不符合规则'];assert.match(planNativeBatchFields(snapshot,{scope,targetLanguage:'en'}).issues.join(''),/库存值不符合规则/);
});

test('category translations retain the same complete path but meaningful qualifiers cannot change',()=>{
  const baseline=captureNativeBatchFieldState(fixture(),{scope}),snapshot=fixture();
  for(const member of snapshot.members)member.category.path=member.category.path.map(label=>label+'(English Translation)');for(const group of snapshot.groups)group.category.path=group.category.path.map(label=>label+'(English Translation)');
  assert.equal(validateNativeBatchFieldState(snapshot,baseline,{scope}).ready,true);
  snapshot.members[0].category.path[1]='厨房电器(儿童专用)';assert.equal(validateNativeBatchFieldState(snapshot,baseline,{scope}).ready,false);
});

test('expected-write evidence cannot authorize price overwrites or another product',()=>{
  const snapshot=fixture(),baseline=captureNativeBatchFieldState(snapshot,{scope}),plan=planNativeBatchFields(snapshot,{scope,targetLanguage:'en'}),write=clone(plan.writes[0]);
  write.targets[0].draftId='220114602951929999';assert.match(validateNativeBatchFieldState(snapshot,baseline,{scope,expectedWrites:[write]}).issues.join(''),/其他商品/);
  const price=baseline.fields.find(field=>field.price),forged={policy:NATIVE_FIELD_POLICY,scopeKey:scope.scopeKey,identity:price.identity,value:'1',targets:price.targets.map(target=>({...target,previousValue:''}))};
  assert.match(validateNativeBatchFieldState(snapshot,baseline,{scope,expectedWrites:[forged]}).issues.join(''),/价格/);
  const title=baseline.fields.find(field=>field.name==='title'),existing={...forged,identity:title.identity,value:'Replaced title',targets:title.targets.map(target=>({...target,previousValue:''}))};snapshot.groups[0].fields.find(field=>field.name==='title').targets[0].value=existing.value;
  assert.match(validateNativeBatchFieldState(snapshot,baseline,{scope,expectedWrites:[existing]}).issues.join(''),/已有内容/);
});

test('native multi-round filling handles newly loaded dependent fields and returns per-member save evidence',async()=>{
  const snapshot=fixture();let calls=0;
  const result=await completeNativeBatchFields({scope,targetLanguage:'en',read:async()=>clone(snapshot),apply:async plan=>{calls++;assert.equal(plan.url,url);applyPlan(snapshot,plan);if(calls===1)snapshot.groups[0].fields.push(field('dependent','dependent','',[target()],{kind:'select',options:[{value:'original-value',label:'常规'}]}));}});
  assert.equal(result.ready,true);assert.equal(result.completed,true);assert.equal(calls,2);assert.equal(result.rows.length,2);assert.equal(result.priceEvidence.length,3);assert.equal(result.saved,undefined);assert.equal(result.rows[0].expectedSnapshot.member.variants.length,2);assert.equal(snapshot.groups[0].fields[0].targets[0].value,'12.00');assert.equal(snapshot.groups[0].fields.at(-1).targets[0].value,'original-value');
});

test('native write boundary checks actual option values, targets, protected fields and concurrent contents',()=>{
  const snapshot=fixture(),plan=planNativeBatchFields(snapshot,{scope,targetLanguage:'en'});assert.equal(validateNativeBatchWritePlan(snapshot,plan,{scope}).ready,true);
  for(const mutate of [candidate=>candidate.writes[0].targets[0].draftId=sourceRows[1].draftId,candidate=>candidate.writes[0].selector='#other',candidate=>{const choice=candidate.writes.find(write=>write.kind==='combobox');choice.value='其他';},candidate=>candidate.writes.push(clone(candidate.writes[0]))]){const candidate=clone(plan);mutate(candidate);assert.equal(validateNativeBatchWritePlan(snapshot,candidate,{scope}).ready,false);}
  snapshot.groups[0].fields.find(item=>item.name==='description').targets[0].value='User supplied text';assert.equal(validateNativeBatchWritePlan(snapshot,plan,{scope}).ready,false);
});

test('native field runner stops after a price side effect or lost write acknowledgement without saving',async()=>{
  for(const mutate of [snapshot=>snapshot.groups[0].fields[0].targets[0].value='1',snapshot=>snapshot.groups[0].fields.find(field=>field.name==='material').targets[0].value='']){
    const snapshot=fixture();let calls=0;const result=await completeNativeBatchFields({scope,targetLanguage:'en',read:async()=>clone(snapshot),apply:async plan=>{calls++;applyPlan(snapshot,plan);mutate(snapshot);}});
    assert.equal(result.ready,false);assert.equal(calls,1);assert.ok(result.issues.length);assert.equal(result.saved,undefined);
  }
});

test('native dependent fills preserve values auto-filled by an earlier round',async()=>{
  const snapshot=fixture();snapshot.groups[0].fields.push(field('auto','autoField','',[target()],{kind:'select',options:[]}));let calls=0;
  const result=await completeNativeBatchFields({scope,targetLanguage:'en',read:()=>clone(snapshot),apply:plan=>{calls++;applyPlan(snapshot,plan);const auto=snapshot.groups[0].fields.find(item=>item.name==='autoField');auto.targets[0].value=calls===1?'Auto A':'Auto B';auto.value=auto.targets[0].value;auto.options=[{value:auto.value,label:auto.value}];if(calls===1)snapshot.groups[0].fields.push(field('late','lateField','',[target()],{kind:'number'}));}});
  assert.equal(calls,2);assert.equal(result.ready,false);assert.match(result.issues.join(''),/现有内容/);
});

test('native enumeration readback checks actual labels, uniqueness, and disabled state',()=>{
  const original=fixture(),baseline=captureNativeBatchFieldState(original,{scope}),plan=planNativeBatchFields(original,{scope,targetLanguage:'en'});applyPlan(original,plan);
  for(const mutate of [field=>field.options.find(option=>option.value==='原始值-2').label='Different meaning',field=>field.options.push(clone(field.options[1])),field=>field.options[1].disabled=true,field=>field.options=[]]){const snapshot=clone(original);mutate(snapshot.groups[0].fields.find(item=>item.name==='material'));assert.match(validateNativeBatchFieldState(snapshot,baseline,{scope,expectedWrites:plan.writes}).issues.join(''),/枚举选项或含义/);}
  const collapsed=clone(original),field=collapsed.groups[0].fields.find(item=>item.name==='material');field.selectedOptions=[clone(field.options[1])];field.options=[];assert.equal(validateNativeBatchFieldState(collapsed,baseline,{scope,expectedWrites:plan.writes}).ready,true);
});

test('native runner detects write-time state drift and cancellation before any field action',async()=>{
  let reads=0,applied=0;const snapshot=fixture();
  const changed=await completeNativeBatchFields({scope,targetLanguage:'en',read:async()=>{reads++;if(reads>=3)snapshot.groups[0].fields.find(item=>item.name==='title').targets[0].value='Concurrent change';return clone(snapshot);},apply:async()=>{applied++;}});
  assert.equal(changed.ready,false);assert.equal(applied,0);assert.match(changed.issues.join(''),/填写前.*变化/);
  const stopped=await completeNativeBatchFields({scope,read:()=>clone(snapshot),apply:async()=>{applied++;},isStopped:()=>true});assert.equal(stopped.ready,false);assert.match(stopped.issues.join(''),/暂停/);assert.equal(applied,0);
});

test('empty native checkboxes use checked state and verify the observed result',async()=>{
  const snapshot=fixture();snapshot.groups[1].fields.push(field('ordinary-checkbox','ordinary-flag','on',[target(1)],{kind:'checkbox',checked:false}));
  const result=await completeNativeBatchFields({scope,targetLanguage:'en',read:()=>clone(snapshot),apply:plan=>applyPlan(snapshot,plan)});assert.equal(result.ready,true);assert.equal(snapshot.groups[1].fields.at(-1).checked,true);
});
