import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {createWorkspace} from '../src/workspace.mjs';
import {createSettings} from '../src/settings.mjs';
import {createErpService} from '../src/erp.mjs';
import {requireListingProvider} from '../src/erp-providers.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'shared-workspace-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new Store(directory),configuration={};
  const preferences=createSettings({directory:path.join(directory,'preferences'),configuration});
  const browsers=[{key:'chrome-one',type:'chrome',name:'商家专用浏览器',debugPort:9344}];
  const erpConnections=[{key:'dxm-one',provider:'dianxiaomi',name:'店小秘账号',browserKey:'chrome-one'}];
  const shops=[{key:'temu-one',platform:'temu',expectedStore:'Temu 店铺',expectedSite:'加拿大站',erpKey:'dxm-one',templates:[{key:'mother',name:'原商品母稿',draftId:'123456789'}]},{key:'amazon-one',platform:'amazon',expectedStore:'Amazon 店铺',expectedSite:'美国站',erpKey:'dxm-one',templates:[]}];
  preferences.update({revision:0,browsers,erpConnections,stores:shops});
  return {directory,store,preferences,configuration,browsers,erpConnections,shops};
}

test('Amazon binds without Temu mothers while the original execution boundary stays closed',t=>{
  const f=fixture(t),saved=f.preferences.view();
  assert.equal(saved.stores.find(s=>s.key==='amazon-one').templates.length,0);
  const reopened=createSettings({directory:path.join(f.directory,'preferences'),configuration:{}});
  assert.deepEqual(reopened.view().stores,saved.stores);
  assert.throws(()=>requireListingProvider(saved.erpConnections[0],'amazon'),e=>e.status===409);
  let executed=0;
  const erp=createErpService({directory:path.join(f.directory,'erp'),mediaDirectory:path.join(f.directory,'media'),store:f.store,preferences:f.preferences,multisets:{list:()=>[]},adapter:{runDraft(){executed++;}},configuration:{}});
  assert.throws(()=>erp.storeConnection('amazon-one'),e=>e.status===409);
  const before=f.preferences.view();
  assert.throws(()=>f.preferences.update({revision:before.revision,stores:before.stores.map(s=>s.platform==='temu'?{...s,templates:[]}:s)}),/母稿/);
  assert.throws(()=>f.preferences.update({revision:before.revision,erpConnections:[{...before.erpConnections[0],provider:'miaoshou'}]}),/尚未接入/);
  assert.deepEqual(f.preferences.view(),before);
  assert.equal(erp.storeConnection('temu-one').target.draftId,'123456789');
  assert.equal(executed,0);
});

test('legacy products and task statuses are referenced without copying or replaying history',t=>{
  const f=fixture(t),at='2026-11-19T00:00:00.000Z';
  f.store.state.productBatches={old:{id:'old',platform:'temu',label:'已成功批次',phase:'completed',connectionBinding:{account:'private-binding'},createdAt:at,products:[{id:'p-old',name:'装饰画',description:'旧商品',images:[{url:'/media/input.png'}],groupId:'g-old',status:'completed'}]}};
  f.store.state.multisets={'g-old':{id:'g-old',phase:'completed',source:{platform:'temu',product_name:'装饰画'},createdAt:at,sets:[{images:[{taskId:'img-old',slot:'main_1'}]}]}};
  f.store.state.tasks={'hyrule_tasks/img-old':{status:'completed',imageUrl:'/media/output.png'},'agent_tasks/planning-old':{status:'running',payload:{agent_task_id:'planning-old',platform:'amazon',product_name:'正在构思',product_desc:'保留原状态'},createdAt:at}};
  f.store.state.drafts=[{id:'legacy-amazon',title:'亚马逊历史草稿',images:['/media/amazon.png'],createdAt:at}];
  const legacy=structuredClone(f.store.state);
  let writes=0;const realSave=f.store.save.bind(f.store);f.store.save=()=>{writes++;realSave();};
  const products={get:id=>structuredClone(f.store.state.productBatches[id]),create:()=>assert.fail('must never replay product creation')};
  const multisets={get:id=>structuredClone(f.store.state.multisets[id]),generate:()=>assert.fail('must never generate')};
  const batches=[{id:'erp-old',label:'已有发布记录',status:'publication-unknown',createdAt:at,store:{platform:'temu',browserKey:'private-profile'},rows:[{status:'publication-unknown'}]}];
  const erp={list:()=>structuredClone(batches),start:()=>assert.fail('must never submit')};
  const sourcing={view:()=>({searches:[{id:'search-old',status:'needs-review',filters:{keywords:['画']},createdAt:at}],batches:[]}),startBatch:()=>assert.fail('must never collect')};
  const workspace=createWorkspace({...f,products,multisets,erp,sourcing}),afterInitialization=writes;
  const first=workspace.view(),second=workspace.view();
  assert.deepEqual(first,second);assert.equal(writes,afterInitialization);
  assert.equal(first.products.filter(p=>p.name==='装饰画').length,1);
  const product=first.products.find(p=>p.id==='product-batch:old:p-old');
  assert.deepEqual(product.versions[0].images,[{url:'/media/output.png',slot:'main_1',kind:'generated'}]);
  assert.equal(first.tasks.find(t=>t.id==='product-batch:old').url,'/temu/listings?product=old');
  assert.equal(first.tasks.find(t=>t.id==='erp:erp-old').status,'publication-unknown');
  assert.equal(first.tasks.find(t=>t.id==='design:planning-old').status,'running');
  assert.equal(first.tasks.find(t=>t.id==='sourcing-search:search-old').status,'needs-review');
  assert.ok(!JSON.stringify(first).includes('private-binding'));assert.ok(!JSON.stringify(first).includes('private-profile'));
  workspace.updateProduct(product.id,{name:'新的资料备注',version:{id:'amazon-new',platform:'amazon',images:[{url:'/media/new-amazon.png'}]}});
  for(const key of Object.keys(legacy))assert.deepEqual(f.store.state[key],legacy[key],key);
  assert.equal(workspace.view().products.find(p=>p.id===product.id).versions.length,2);
  assert.equal(workspace.view().stores.find(s=>s.platform==='amazon').executionSupported,false);
  assert.equal(workspace.view().stores.find(s=>s.platform==='temu').executionSupported,true);
});

test('all pages share durable context, separate design forms, and append-only platform versions',t=>{
  const f=fixture(t),workspace=createWorkspace(f);
  const product=workspace.createProduct({requestId:'manual-product-001',name:'统一商品',description:'同一份商品事实',images:['/media/input.png']});
  const same=workspace.createProduct({requestId:'manual-product-001',name:'统一商品',description:'同一份商品事实',images:['/media/input.png']});
  assert.equal(same.id,product.id);
  assert.throws(()=>workspace.createProduct({requestId:'manual-product-001',name:'改了内容'}),e=>e.status===409);
  const selected=workspace.context({revision:0,productId:product.id,storeKey:'amazon-one'});
  assert.equal(selected.platform,'amazon');assert.equal(selected.erpKey,'dxm-one');
  assert.throws(()=>workspace.context({revision:0,platform:'temu'}),e=>e.status===409);
  assert.throws(()=>workspace.context({platform:'temu',storeKey:'amazon-one'}),/不一致/);
  const switched=workspace.context({platform:'temu'});assert.equal(switched.storeKey,'');assert.equal(switched.productId,product.id);
  const amazon={id:'single:amz',platform:'amazon',status:'completed',images:[{url:'/media/amazon.png',originalImageUrl:'/media/amazon-original.png',kind:'aplus',slot:'aplus_1',width:1464,height:600}]};
  workspace.updateProduct(product.id,{version:amazon});
  workspace.updateProduct(product.id,{version:{id:'single:temu',platform:'temu',status:'completed',images:['/media/temu.png']}});
  const updated=workspace.updateProduct(product.id,{version:amazon});assert.equal(updated.versions.length,2);
  assert.equal(updated.versions[0].images[0].originalImageUrl,'/media/amazon-original.png');
  const key=product.id+':amazon';
  const saved=workspace.designState(key,{revision:0,data:{productName:'统一商品',outputScope:'main7+premium5',imageRatio:'1464:600'}});
  assert.equal(saved.revision,1);assert.throws(()=>workspace.designState(key,{revision:0,data:{productName:'过期表单'}}),e=>e.status===409);
  workspace.designState(product.id+':temu',{data:{imageRatio:'1:1',outputScope:'main7'}});
  const persisted=new Store(f.directory),reopened=createWorkspace({...f,store:persisted});
  assert.equal(reopened.context().productId,product.id);assert.equal(reopened.context().platform,'temu');
  assert.equal(reopened.view().products[0].versions.length,2);
  assert.equal(reopened.designState(key).data.outputScope,'main7+premium5');
  assert.equal(reopened.designState(product.id+':temu').data.imageRatio,'1:1');
  const response=reopened.view();response.products[0].name='外部误改';assert.equal(reopened.view().products[0].name,'统一商品');
});

test('legacy UI draft persistence uses scoped keys and refuses stale updates and credentials',t=>{
  const f=fixture(t),workspace=createWorkspace(f),key='listing:review:550e8400-e29b-41d4-a716-446655440000';
  assert.deepEqual(workspace.uiState(key),{key,revision:0,data:null});
  workspace.uiState(key,{revision:0,data:{storeKey:'temu-one',rows:[{productCode:'A-1',title:'待核对'}]}});
  assert.throws(()=>workspace.uiState(key,{revision:0,data:{rows:[]}}),e=>e.status===409);
  assert.throws(()=>workspace.uiState('listing:review:../../settings',{data:{}}),/编号无效/);
  assert.throws(()=>workspace.uiState('settings:secrets',{data:{}}),/编号无效/);
  for(const data of [{models:{PLANNER_API_KEY:'do-not-persist'}},{password:'hidden'},JSON.parse('{"__proto__":{"polluted":true}}')])assert.throws(()=>workspace.uiState('settings:editor',{data}),/凭据|特殊/);
  assert.throws(()=>workspace.designState('blank:amazon',{data:{image:{url:'x',credentials:{token:'no'}}}}),/凭据/);
  assert.equal({}.polluted,undefined);
  const reopened=createWorkspace({...f,store:new Store(f.directory)});assert.equal(reopened.uiState(key).data.rows[0].productCode,'A-1');
  workspace.uiState('listing:intake',{data:null});assert.equal(workspace.uiState('listing:intake').data,null);
  assert.throws(()=>workspace.createProduct({name:'bad image',images:['javascript:alert(1)']}),/图片/);
  assert.throws(()=>workspace.createProduct({name:'bad image',images:['/media/%2e%2e/private.json']}),/图片/);
});

test('local folder ingestion reuses the existing importer and stable catalog identity',async t=>{
  const f=fixture(t),calls=[];
  const products={importFolder:async input=>{calls.push(input);return {sourceFolder:'C:\\Users\\merchant\\Desktop\\products',outputParent:'C:\\Users\\merchant\\Desktop\\results',label:'原图产品',ignoredFolders:[],products:[{id:'old-import-id',productCode:'CANVAS',name:'画',description:'原始事实',count:2,templateKey:'mother',images:[{url:'/media/original.png',filename:'产品主体图-1.png'}]}]};},create:()=>assert.fail('import must not create execution batch')};
  const workspace=createWorkspace({...f,products});
  const result=await workspace.importFolder({folder:'C:\\Users\\merchant\\Desktop\\products'});
  const repeat=await workspace.importFolder({folder:'C:\\Users\\merchant\\Desktop\\products'});
  assert.equal(result.products[0].id,repeat.products[0].id);assert.equal(workspace.view().products.length,1);
  assert.equal(result.products[0].productCode,'CANVAS');assert.equal(result.products[0].count,2);assert.equal(result.products[0].templateKey,'mother');
  assert.equal(result.products[0].source.kind,'local-folder');assert.equal(calls.length,2);
  assert.equal(f.store.state.productBatches,undefined);
});

test('selected sourcing records enter the catalog through read-only views without paid detail requests',t=>{
  const f=fixture(t),batch={id:'selected-batch',searchId:'search',createdAt:'2026-11-19T00:00:00Z',rows:[{goodsId:'123456789',title:'已选择商品',status:'needs-review',sourceUrl:'https://www.temu.com/g-123456789.html'}]};
  const sourcing={view:()=>({batches:[batch],searches:[]}),getBatch:()=>structuredClone(batch),getSearch:()=>({rows:[{goodsId:'123456789',raw:{thumbnail:'https://img.kwcdn.com/image.jpg'}}]}),startBatch:()=>assert.fail('must not resubmit collection')};
  const workspace=createWorkspace({...f,sourcing}),product=workspace.view().products[0];
  assert.equal(product.id,'sourcing:selected-batch:123456789');assert.equal(product.versions[0].status,'needs-review');
  assert.equal(product.images[0].category,'来源缩略图');assert.equal(product.source.batchId,batch.id);
  assert.deepEqual(batch.rows[0].status,'needs-review');
});
