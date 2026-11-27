import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createListingTemplates,validateTemplateRules} from '../src/listing-templates.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-templates-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const preferences={erp:erpKey=>{if(erpKey!=='erp-fixture')throw new Error('ERP连接不存在');return {key:erpKey,provider:'dianxiaomi'};}};
  const options={directory,preferences};
  return {directory,options,service:createListingTemplates(options)};
}

function draft(){
  return {name:'加拿大帆布画',erpKey:'erp-fixture',platform:'temu',businessType:'半托管',site:'加拿大站',productType:'帆布画',
    category:{path:['家居、厨房用品','装饰字画','海报和印刷品']},
    rules:{attributes:[{name:'框架类型',mode:'from-product'}],pricing:{mode:'preserve'},title:{mode:'preserve'}},
    storeBindings:[
      {key:'store-one',storeId:'111',storeName:'店铺1',warehouse:{id:'warehouse-one',label:'仓库1'},shippingTemplate:{id:'shipping-one',label:'加拿大'},dispatch:'2个工作日内发货'},
      {key:'store-two',storeId:'222',storeName:'店铺2测试',warehouse:'仓库2',shippingTemplate:'加拿大模板2',dispatch:{id:'dispatch-two',label:'1个工作日内发货'},overrides:{inventory:{mode:'preserve'}}}
    ]};
}

test('fixed templates persist across restart with independent account/store bindings and no mother-draft requirement',t=>{
  const f=fixture(t),input=draft(),saved=f.service.save(input);
  assert.equal(saved.version,1);assert.equal(saved.readiness.scope,'configuration');assert.equal(saved.readiness.ready,true);
  assert.equal(saved.category.label,'海报和印刷品');assert.equal(saved.storeBindings[0].warehouse,'仓库1');assert.equal(saved.storeBindings[0].warehouseId,'warehouse-one');
  assert.equal(saved.storeBindings[0].shippingTemplateId,'shipping-one');assert.equal(saved.storeBindings[1].dispatchId,'dispatch-two');
  assert.ok(saved.storeBindings.every(binding=>binding.site==='加拿大站'));
  input.storeBindings[0].storeName='changed input';saved.storeBindings[1].warehouse='changed response';
  const restored=createListingTemplates(f.options),read=restored.get(saved.id);
  assert.equal(read.storeBindings[0].storeName,'店铺1');assert.equal(read.storeBindings[1].warehouse,'仓库2');
  assert.equal(restored.list({erpKey:'erp-fixture'}).length,1);assert.equal(restored.list({erpKey:'another-account'}).length,0);
  assert.equal(restored.list({site:'美国站'}).length,0);assert.equal(restored.view().revision,1);
  assert.equal(fs.readdirSync(f.directory).filter(name=>name.endsWith('.tmp')).length,0);
});

test('incomplete templates are saved as configuration drafts without inventing missing rules or per-store settings',t=>{
  const {service}=fixture(t),saved=service.save({name:'待配置帆布画',erpKey:'erp-fixture',platform:'temu',storeBindings:[{storeName:'新店'}]});
  assert.deepEqual(saved.rules,{});assert.deepEqual(saved.category,{id:'',label:'',path:[]});
  assert.equal(saved.readiness.ready,false);assert.ok(saved.readiness.issues.includes('缺少已确认的完整商品分类'));
  assert.ok(saved.readiness.issues.some(issue=>issue.includes('缺少仓库')));assert.equal(saved.storeBindings[0].warehouse,'');
  assert.equal(service.get(saved.id).readiness.ready,false);
});

test('version conflicts prevent stale overwrites across instances and every saved version can be read after restart',t=>{
  const f=fixture(t),first=f.service.save(draft()),another=createListingTemplates(f.options);
  const second=another.save({...first,notes:'下次使用新配置',storeBindings:first.storeBindings.map(binding=>({...binding,dispatch:'1个工作日内发货'}))});
  assert.equal(second.version,2);assert.equal(second.createdAt,first.createdAt);
  assert.throws(()=>f.service.save({...first,name:'stale overwrite'}),error=>error.status===409);
  const restored=createListingTemplates(f.options);
  assert.equal(restored.get(first.id).version,2);assert.equal(restored.get(first.id,{version:1}).storeBindings[0].dispatch,'2个工作日内发货');
  assert.equal(restored.get(first.id,{version:2}).storeBindings[0].dispatch,'1个工作日内发货');
  assert.throws(()=>restored.get(first.id,{version:3}),error=>error.status===404);
  assert.throws(()=>restored.get(first.id,{version:'2'}),/版本无效/);
});

test('task snapshots freeze a selected version and store subset without modifying the persistent template',t=>{
  const {service}=fixture(t),saved=service.save(draft()),snapshot=service.snapshot(saved.id,{version:1,storeKeys:['store-two']});
  assert.equal(snapshot.version,1);assert.deepEqual(snapshot.storeBindings.map(binding=>binding.key),['store-two']);assert.ok(snapshot.snapshotAt);
  const changed=service.save({...saved,name:'新名称',storeBindings:saved.storeBindings.map(binding=>({...binding,warehouse:'新仓库'}))});
  assert.equal(changed.version,2);assert.equal(snapshot.storeBindings[0].warehouse,'仓库2');assert.equal(snapshot.name,'加拿大帆布画');
  assert.equal(service.get(saved.id).storeBindings.length,2);
  snapshot.rules.attributes[0].mode='changed';assert.equal(service.get(saved.id,{version:1}).rules.attributes[0].mode,'from-product');
  assert.throws(()=>service.snapshot(saved.id,{storeKeys:['foreign-store']}),/不属于/);
  assert.throws(()=>service.snapshot(saved.id,{storeKeys:[]}),/选择无效/);
  assert.throws(()=>service.snapshot(saved.id,{storeKeys:['store-one','store-one']}),/选择无效/);
});

test('copying a template preserves its settings but creates an independent version history',t=>{
  const {service}=fixture(t),first=service.save(draft());
  service.save({...first,name:'更新后的方案'});
  const copied=service.copy(first.id,{name:'帆布画另一组',version:1});
  assert.notEqual(copied.id,first.id);assert.equal(copied.version,1);assert.deepEqual(copied.copiedFrom,{id:first.id,version:1});
  assert.equal(copied.storeBindings[0].shippingTemplate,'加拿大');assert.equal(service.get(first.id).name,'更新后的方案');
  service.save({...copied,notes:'只修改副本'});
  assert.equal(service.get(first.id).notes,'');assert.equal(service.list().length,2);
});

test('bulk category, package and per-SKU stock defaults persist through versions, copies and frozen snapshots',t=>{
  const f=fixture(t),input=draft(),packageDefaults={lengthCm:45.5,widthCm:35,heightCm:4,weightKg:.8};
  input.rules={...input.rules,categoryMode:'replace',saveMode:'draft',packageDefaults,inventory:{mode:'fixed',quantity:10000}};
  input.storeBindings[0].overrides={packageDefaults:{lengthCm:46,widthCm:36,heightCm:5,weightKg:1},inventory:{mode:'fixed',quantity:0}};
  const first=f.service.save(input),snapshot=f.service.snapshot(first.id,{storeKeys:['store-one']});
  const second=f.service.save({...first,rules:{...first.rules,inventory:{mode:'fixed',quantity:500}}});
  const restored=createListingTemplates(f.options),copied=restored.copy(first.id,{version:1});
  assert.equal(second.version,2);assert.equal(restored.get(first.id).rules.inventory.quantity,500);
  assert.equal(snapshot.rules.inventory.quantity,10000);assert.equal(snapshot.storeBindings[0].overrides.inventory.quantity,0);
  assert.deepEqual(copied.rules,first.rules);assert.deepEqual(copied.storeBindings,first.storeBindings);
  assert.deepEqual(restored.get(first.id,{version:1}).rules.packageDefaults,packageDefaults);
  assert.deepEqual(restored.get(first.id,{version:1}).storeBindings[1].overrides.inventory,{mode:'preserve'});
  copied.rules.packageDefaults.lengthCm=999;snapshot.storeBindings[0].overrides.inventory.quantity=999;
  assert.equal(restored.get(first.id,{version:1}).rules.packageDefaults.lengthCm,45.5);
  assert.equal(restored.get(first.id,{version:1}).storeBindings[0].overrides.inventory.quantity,0);
});

test('omitted bulk defaults do not retroactively add stock or overwrite mode to existing templates',t=>{
  const f=fixture(t),first=f.service.save(draft()),restored=createListingTemplates(f.options),copied=restored.copy(first.id);
  for(const item of [first,restored.get(first.id),restored.snapshot(first.id),copied]){
    assert.equal(Object.hasOwn(item.rules,'categoryMode'),false);
    assert.equal(Object.hasOwn(item.rules,'saveMode'),false);
    assert.equal(Object.hasOwn(item.rules,'packageDefaults'),false);
    assert.equal(Object.hasOwn(item.rules,'inventory'),false);
    assert.deepEqual(item.storeBindings[1].overrides.inventory,{mode:'preserve'});
  }
});

test('malformed bulk defaults are rejected before any template revision is written',t=>{
  const f=fixture(t),saved=f.service.save(draft()),file=path.join(f.directory,'listing-templates.json'),before=fs.readFileSync(file,'utf8');
  const packageDefaults={lengthCm:40,widthCm:30,heightCm:3,weightKg:.5};
  const invalid=[
    {categoryMode:'auto'},{categoryMode:null},{categoryMode:true},
    {saveMode:'publish'},{saveMode:null},{saveMode:false},
    {packageDefaults:{}},{packageDefaults:{lengthCm:40}},{packageDefaults:null},{packageDefaults:[]},
    ...['',null,true,'40',0,-1].map(lengthCm=>({packageDefaults:{...packageDefaults,lengthCm}})),
    {packageDefaults:{...packageDefaults,units:'mm'}},{packageDefaults:{...packageDefaults,weightKg:Infinity}},
    {inventory:{}},{inventory:null},{inventory:{mode:'fixed'}},{inventory:{mode:'automatic',quantity:10000}},
    ...['',null,true,'10000',-.1,-1,1.5,Number.MAX_SAFE_INTEGER+1].map(quantity=>({inventory:{mode:'fixed',quantity}})),
    {inventory:{mode:'fixed',quantity:10000,unit:'product'}},{inventory:{mode:'preserve',quantity:10000}}
  ];
  for(const rules of invalid)assert.throws(()=>f.service.save({...saved,rules}),error=>error.status===400,JSON.stringify(rules));
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(f.service.get(saved.id).version,1);
});

test('store overrides require complete explicit package data while preserving independent business rules',t=>{
  const {service}=fixture(t),input=draft();
  input.rules.packageDefaults={lengthCm:40,widthCm:30,heightCm:3,weightKg:.5};
  input.storeBindings[0].overrides={packageDefaults:{weightKg:1}};
  assert.throws(()=>service.save(input),/店铺差异设置.*全部填写/);
  input.storeBindings[0].overrides={inventory:{mode:'fixed',quantity:'10000'}};
  assert.throws(()=>service.save(input),/店铺差异设置.*库存/);
  input.storeBindings[0].overrides={categoryMode:'replace',saveMode:'ready',inventory:{mode:'preserve'},otherBusinessRule:{keep:['a',true,2]}};
  const saved=service.save(input);
  assert.deepEqual(saved.storeBindings[0].overrides,input.storeBindings[0].overrides);
  const value={inventory:{mode:'fixed',quantity:0},otherBusinessRule:{keep:['a',true,2]}},normalized=validateTemplateRules(value);
  normalized.otherBusinessRule.keep.push('changed');assert.equal(value.otherBusinessRule.keep.length,3);
});

test('stored invalid bulk rules are reported as incomplete without rewriting historical template data',t=>{
  const f=fixture(t),saved=f.service.save(draft()),file=path.join(f.directory,'listing-templates.json');
  const state=JSON.parse(fs.readFileSync(file,'utf8')),stored=state.templates[saved.id].versions[0];
  stored.rules.packageDefaults={lengthCm:40};stored.storeBindings[0].overrides={inventory:{mode:'fixed',quantity:'10000'}};
  fs.writeFileSync(file,JSON.stringify(state));const before=fs.readFileSync(file,'utf8');
  const read=createListingTemplates(f.options).get(saved.id);
  assert.equal(read.readiness.ready,false);
  assert.ok(read.readiness.issues.some(issue=>/包装.*全部填写/.test(issue)));
  assert.ok(read.readiness.issues.some(issue=>/店铺1.*库存/.test(issue)));
  assert.equal(fs.readFileSync(file,'utf8'),before);
});

test('credential-shaped fields and unsafe JSON cannot be persisted or returned as a template',t=>{
  const f=fixture(t),saved=f.service.save(draft()),before=fs.readFileSync(path.join(f.directory,'listing-templates.json'),'utf8');
  for(const rules of [{apiKey:'fixture-private-value'},{nested:{cookie:'fixture-private-value'}},{Authorization:'fixture-private-value'},JSON.parse('{"__proto__":{"polluted":true}}'),{text:'Bearer fixture-private-value'}]){
    assert.throws(()=>f.service.save({...saved,rules}),/不能保存/);
  }
  assert.throws(()=>f.service.save({...saved,SADCAPTCHA_API_KEY:'fixture-private-value'}),/不能保存/);
  assert.throws(()=>f.service.save({...saved,rules:{number:Infinity}}),/无效数值/);
  assert.throws(()=>f.service.save({...saved,configuration:{anything:'value'}}),/不支持的字段/);
  assert.equal(fs.readFileSync(path.join(f.directory,'listing-templates.json'),'utf8'),before);
  assert.equal(before.includes('fixture-private-value'),false);assert.equal({}.polluted,undefined);
});

test('invalid identities, duplicate stores, inconsistent labels, and mismatched sites are rejected before persistence',t=>{
  const {service}=fixture(t),input=draft();
  assert.throws(()=>service.save({...input,erpKey:'another-account'}),/ERP连接不存在/);
  assert.throws(()=>service.save({...input,platform:'unsupported'}),/当前固定上架模板支持/);
  assert.throws(()=>service.save({...input,category:{path:['父分类','末级'],label:'不匹配'}}),/分类路径不一致/);
  assert.throws(()=>service.save({...input,storeBindings:[input.storeBindings[0],input.storeBindings[0]]}),/编号重复/);
  assert.throws(()=>service.save({...input,storeBindings:[input.storeBindings[0],{...input.storeBindings[0],key:'different-key'}]}),/不能重复绑定/);
  assert.throws(()=>service.save({...input,storeBindings:[{...input.storeBindings[0],site:'美国站'}]}),/站点不一致/);
  assert.throws(()=>service.save({...input,storeBindings:[{...input.storeBindings[0],warehouseId:'conflicting-id'}]}),/仓库编号不一致/);
  assert.equal(service.list().length,0);
});

test('corrupt template storage is reported and never silently replaced',t=>{
  const f=fixture(t),file=path.join(f.directory,'listing-templates.json');
  fs.writeFileSync(file,'broken');
  assert.throws(()=>f.service.list(),error=>error.status===500);
  assert.throws(()=>f.service.save(draft()),/未覆盖原配置/);
  assert.equal(fs.readFileSync(file,'utf8'),'broken');
});
