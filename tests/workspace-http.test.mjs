import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';

async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-http-')),calls={images:0,plans:0,erpWrites:0,publications:0,collections:0};
  const unexpected=name=>async()=>{calls[name]++;throw new Error('Unexpected external operation: '+name);};
  const app=createWorkbench({dataDirectory:path.join(directory,'data'),configuration:{WORKBENCH_FRESH:'true'},provider:unexpected('images'),planner:unexpected('plans'),sourcingClient:unexpected('collections'),collectionAdapter:{preflight:unexpected('collections'),importProduct:unexpected('collections')},erpAdapter:{runDraft:unexpected('erpWrites'),publishDraft:unexpected('publications')}});
  app.preferences.update({revision:0,browsers:[{key:'browser-one',type:'chrome',name:'独立浏览器',debugPort:9355}],erpConnections:[{key:'erp-one',provider:'dianxiaomi',name:'店小秘',browserKey:'browser-one'}],stores:[{key:'temu-one',platform:'temu',expectedStore:'Temu 店',expectedSite:'加拿大站',erpKey:'erp-one',templates:[{key:'mother-one',name:'已验证原母稿',draftId:'123456789'}]},{key:'amazon-one',platform:'amazon',expectedStore:'Amazon 店',expectedSite:'美国站',erpKey:'erp-one',templates:[]}]});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const session=await fetch(base+'/api/session').then(r=>r.json());
  const request=async(route,{method='GET',data,token=session.token,headers={}}={})=>{
    const response=await fetch(base+route,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{'X-Workbench-Token':token}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const body=response.headers.get('content-type')?.includes('json')?await response.json():await response.text();
    return {status:response.status,body};
  };
  const post=(route,data,options={})=>request(route,{method:'POST',data,...options});
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  return {app,directory,calls,request,post,base};
}
const noExternalCalls=calls=>assert.deepEqual(calls,{images:0,plans:0,erpWrites:0,publications:0,collections:0});

test('workspace mutation routes require a same-origin local session, including import and listing handoff',async t=>{
  const f=await fixture(t);
  for(const [route,data] of [
    ['/api/workspace/products',{name:'拒绝保存'}],
    ['/api/workspace/context',{platform:'temu'}],
    ['/api/workspace/design-state?key=blank:amazon',{data:{name:'拒绝保存'}}],
    ['/api/workspace/ui-state?key=listing:intake',{data:{products:[]}}],
    ['/api/workspace/import-folder',{folder:'C:\\missing'}],
    ['/api/workspace/listing-source',{productId:'missing',platform:'temu'}]
  ])assert.equal((await f.post(route,data,{token:null})).status,403,route);
  assert.equal((await f.post('/api/workspace/products',{name:'拒绝保存'},{headers:{Origin:'https://untrusted.invalid'}})).status,403);
  assert.equal((await f.request('/api/workspace',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
  assert.equal((await f.request('/api/workspace')).body.products.length,0);
  noExternalCalls(f.calls);
});

test('shared HTTP selections and page drafts reject stale writes and immediately observe connection changes',async t=>{
  const f=await fixture(t);
  const created=await f.post('/api/workspace/products',{name:'共享商品',description:'商品事实',images:[]});assert.equal(created.status,201);
  const selected=await f.post('/api/workspace/context',{revision:0,productId:created.body.id,storeKey:'amazon-one'});assert.equal(selected.status,200);assert.equal(selected.body.platform,'amazon');
  const stale=await f.post('/api/workspace/context',{revision:0,platform:'temu'});assert.equal(stale.status,409);
  const designKey=encodeURIComponent(created.body.id+':amazon');
  assert.equal((await f.post('/api/workspace/design-state?key='+designKey,{revision:0,data:{design_scope:'main_6_old_aplus'}})).status,200);
  assert.equal((await f.post('/api/workspace/design-state?key='+designKey,{revision:0,data:{design_scope:'main_only'}})).status,409);
  assert.equal((await f.post('/api/workspace/ui-state?key=listing:intake',{revision:0,data:{products:[{productCode:'ONE'}]}})).status,200);
  assert.equal((await f.post('/api/workspace/ui-state?key=listing:intake',{revision:0,data:{products:[]}})).status,409);
  const before=(await f.request('/api/settings')).body;
  const stores=before.stores.map(s=>s.key==='amazon-one'?{...s,expectedStore:'已重命名 Amazon 店',expectedSite:'加拿大站'}:s);
  const saved=await f.post('/api/settings',{revision:before.revision,stores});assert.equal(saved.status,200,JSON.stringify(saved.body));
  const view=(await f.request('/api/workspace')).body,shop=view.stores.find(s=>s.key==='amazon-one');
  assert.equal(shop.expectedStore,'已重命名 Amazon 店');assert.equal(shop.expectedSite,'加拿大站');assert.equal(shop.executionSupported,false);
  assert.equal(view.context.storeKey,'amazon-one');assert.equal(view.context.productId,created.body.id);
  const key='listing:review:550e8400-e29b-41d4-a716-446655440000';
  assert.equal((await f.post('/api/workspace/ui-state?key='+key,{data:{rows:[],GB_APP_KEY:'do-not-store'}})).status,400);
  assert.ok(!fs.readFileSync(f.app.store.file,'utf8').includes('do-not-store'));
  noExternalCalls(f.calls);
});

test('reading the shared library and opening historical content never mutates or resubmits old work',async t=>{
  const f=await fixture(t),at='2026-11-19T00:00:00.000Z';
  f.app.store.state.productBatches.legacy={id:'legacy',label:'旧成功批次',platform:'temu',phase:'completed',site:'加拿大站',createdAt:at,connectionBinding:{browserConfig:{key:'historic-browser'}},products:[{id:'legacy-product',name:'桌面商品',description:'原始商品事实',images:[],count:1,status:'completed'}]};
  f.app.store.state.tasks['agent_tasks/history']={status:'running',payload:{agent_task_id:'history',product_name:'历史单品',product_desc:'正在运行记录',platform:'amazon'},createdAt:at};
  f.app.store.state.drafts.push({id:'legacy-draft',title:'旧图草稿',platform:'amazon',images:[],createdAt:at});
  f.app.store.save();
  const before=fs.readFileSync(f.app.store.file),erpBefore=fs.readFileSync(path.join(f.directory,'data/erp/state.json'));
  for(let i=0;i<2;i++){
    const response=await f.request('/api/workspace');assert.equal(response.status,200);
    assert.equal(response.body.tasks.find(row=>row.id==='product-batch:legacy').status,'completed');
    assert.equal(response.body.tasks.find(row=>row.id==='design:history').status,'running');
    assert.equal(response.body.tasks.find(row=>row.id==='product-batch:legacy').url,'/temu/listings?product=legacy');
    assert.equal((await f.request('/design?platform=amazon&product='+encodeURIComponent('single-design:history'))).status,200);
  }
  assert.deepEqual(fs.readFileSync(f.app.store.file),before);assert.deepEqual(fs.readFileSync(path.join(f.directory,'data/erp/state.json')),erpBefore);
  noExternalCalls(f.calls);
});

test('listing handoff reuses local Temu results idempotently without generating, billing, or submitting ERP',async t=>{
  const f=await fixture(t),png=await sharp({create:{width:1024,height:1024,channels:3,background:'#ead9c3'}}).png().toBuffer(),image=f.app.saveImage(png);
  const created=(await f.post('/api/workspace/products',{name:'统一上架商品',description:'已完成图片',images:[image]})).body;
  const version={id:'single:completed-temu',platform:'temu',status:'completed',images:[{url:image,slot:0,kind:'main'}],source:{kind:'single-design',id:'completed-temu'}};
  assert.equal((await f.post('/api/workspace/products/'+created.id,{version})).status,200);
  const first=await f.post('/api/workspace/listing-source',{productId:created.id,platform:'temu'});assert.equal(first.status,200,JSON.stringify(first.body));
  const repeated=await f.post('/api/workspace/listing-source',{productId:created.id,platform:'temu'});assert.equal(repeated.status,200);assert.equal(repeated.body.draftId,first.body.draftId);
  assert.equal(f.app.store.state.drafts.length,1);assert.deepEqual(f.app.store.state.drafts[0].images,[image]);assert.equal(f.app.store.state.drafts[0].published,false);
  assert.equal((await f.request('/api/workspace')).body.products.find(p=>p.id===created.id).versions.length,1);
  assert.equal(f.app.store.state.charges.length,0);assert.equal(f.app.erp.list().length,0);
  // The existing runner remains the gate even if callers bypass the UI selector.
  const preview=await f.post('/api/temu/erp/import-generated',{draftId:first.body.draftId});assert.equal(preview.status,200);
  const refused=await f.post('/api/temu/erp/prepare',{previewId:preview.body.id,storeKey:'amazon-one',rows:[]});assert.equal(refused.status,409);
  const productBatch=await f.post('/api/products',{platform:'amazon',storeKey:'amazon-one'});assert.equal(productBatch.status,409);
  noExternalCalls(f.calls);
});

test('Amazon versions never become Temu drafts or enter the Temu executor through platform selection',async t=>{
  const f=await fixture(t),png=await sharp({create:{width:1464,height:600,channels:3,background:'#aaaaff'}}).png().toBuffer(),image=f.app.saveImage(png);
  const created=(await f.post('/api/workspace/products',{name:'Amazon A+',images:[image]})).body;
  await f.post('/api/workspace/products/'+created.id,{version:{id:'single:amazon-finished',platform:'amazon',status:'completed',images:[{url:image,kind:'aplus',originalImageUrl:image}]}});
  const before=fs.readFileSync(f.app.store.file);
  const handoff=await f.post('/api/workspace/listing-source',{productId:created.id,platform:'amazon'});assert.equal(handoff.status,200);assert.equal(handoff.body.executionSupported,false);assert.equal(handoff.body.draftId,undefined);
  assert.deepEqual(fs.readFileSync(f.app.store.file),before);
  assert.equal((await f.post('/api/workspace/listing-source',{productId:created.id,platform:'temu',versionId:'single:amazon-finished'})).status,400);
  await f.post('/api/workspace/products/'+created.id,{version:{id:'wrong-shape',platform:'temu',status:'completed',images:[image]}});
  assert.equal((await f.post('/api/workspace/listing-source',{productId:created.id,platform:'temu',versionId:'wrong-shape'})).status,400);
  assert.equal(f.app.store.state.drafts.length,0);assert.equal(f.app.erp.list().length,0);noExternalCalls(f.calls);
});

test('a saved single design and its live task share one version while retaining original exports and slot zero',async t=>{
  const f=await fixture(t),created=(await f.post('/api/workspace/products',{name:'共享版本商品',images:[]})).body;
  f.app.store.state.tasks['agent_tasks/single-live']={status:'completed',payload:{agent_task_id:'single-live',workspace_product_id:created.id,product_name:created.name,product_desc:'同一商品',platform:'amazon'},singleDesign:{phase:'generating',tasks:[{taskId:'image-live',slot:0}]}};
  f.app.store.state.tasks['hyrule_tasks/image-live']={status:'completed',imageUrl:'/media/output.png',originalImageUrl:'/media/original.png'};
  const live=(await f.request('/api/workspace')).body.products.find(p=>p.id===created.id);
  assert.equal(live.versions[0].id,'single:single-live');assert.equal(live.versions[0].images[0].slot,'0');
  const version={id:'single:single-live',platform:'amazon',status:'completed',source:{kind:'single-design',id:'single-live'},images:[{url:'/media/output.png',originalImageUrl:'/media/original.png',kind:'aplus',slot:0,width:1464,height:600}]};
  assert.equal((await f.post('/api/workspace/products/'+created.id,{version})).status,200);
  const saved=(await f.request('/api/workspace')).body.products.find(p=>p.id===created.id);
  assert.equal(saved.versions.length,1);assert.equal(saved.versions[0].images[0].kind,'aplus');assert.equal(saved.versions[0].images[0].slot,'0');assert.equal(saved.versions[0].images[0].originalImageUrl,'/media/original.png');
  noExternalCalls(f.calls);
});

test('listing source checks the actual group platform before returning a Temu handoff',async t=>{
  const f=await fixture(t),created=(await f.post('/api/workspace/products',{name:'跨平台引用检查',images:[]})).body;
  f.app.store.state.multisets['amazon-group']={id:'amazon-group',source:{platform:'amazon',product_name:'Amazon旧套图'},count:1,slots:[{slot:0}],sets:[],recommendation:{status:'completed'},createdAt:'2026-11-19T00:00:00Z'};
  await f.post('/api/workspace/products/'+created.id,{version:{id:'wrong-source-platform',platform:'temu',status:'completed',images:['/media/reference.png'],source:{kind:'multiset',id:'amazon-group'}}});
  const result=await f.post('/api/workspace/listing-source',{productId:created.id,platform:'temu',versionId:'wrong-source-platform'});
  assert.equal(result.status,400,JSON.stringify(result.body));assert.equal(f.app.store.state.drafts.length,0);noExternalCalls(f.calls);
});

test('partial or failed single-design results cannot enter listing, while saved legacy image drafts remain usable',async t=>{
  const f=await fixture(t),png=await sharp({create:{width:1024,height:1024,channels:3,background:'#ccbbaa'}}).png().toBuffer(),first=f.app.saveImage(png),second=f.app.saveImage(png);
  const created=(await f.post('/api/workspace/products',{name:'两张图片的完整商品',images:[first]})).body;
  f.app.store.state.tasks['agent_tasks/incomplete']={status:'completed',payload:{agent_task_id:'incomplete',workspace_product_id:created.id,product_name:created.name,platform:'temu'},singleDesign:{phase:'generating',tasks:[{taskId:'first-image',slot:0},{taskId:'second-image',slot:1}]}};
  f.app.store.state.tasks['hyrule_tasks/first-image']={status:'completed',imageUrl:first};
  f.app.store.state.tasks['hyrule_tasks/second-image']={status:'running'};
  const handoff=()=>f.post('/api/workspace/listing-source',{productId:created.id,platform:'temu',versionId:'single:incomplete'});
  const partial=(await f.request('/api/workspace')).body.products.find(p=>p.id===created.id).versions[0];
  assert.equal(partial.images.length,1);assert.equal(partial.status,'generating');assert.equal((await handoff()).status,409);
  // A client-side status alone cannot override the authoritative child tasks.
  await f.post('/api/workspace/products/'+created.id,{version:{id:'single:incomplete',platform:'temu',status:'completed',images:[first],source:{kind:'single-design',id:'incomplete'}}});
  assert.equal((await handoff()).status,409);
  f.app.store.state.tasks['hyrule_tasks/second-image']={status:'failed'};assert.equal((await handoff()).status,409);
  f.app.store.state.tasks['hyrule_tasks/second-image']={status:'completed',imageUrl:second};assert.equal((await handoff()).status,409,'a partial saved export must not become complete just because the second task finished');
  assert.equal(f.app.store.state.drafts.length,0);
  await f.post('/api/workspace/products/'+created.id,{version:{id:'single:incomplete',platform:'temu',status:'completed',images:[first,second],source:{kind:'single-design',id:'incomplete'}}});
  assert.equal((await handoff()).status,200);
  f.app.store.state.drafts.push({id:'legacy-saved',title:'旧版图片草稿',platform:'temu',status:'draft',images:[first],createdAt:'2026-11-18T00:00:00Z'});
  assert.equal((await f.post('/api/workspace/listing-source',{productId:'draft:legacy-saved',platform:'temu',versionId:'legacy-saved'})).status,200);
  assert.equal(f.app.store.state.charges.length,0);assert.equal(f.app.erp.list().length,0);noExternalCalls(f.calls);
});

test('Amazon multiset history opens its existing design and bound product without redirecting to the product index',async t=>{
  const f=await fixture(t),created=(await f.post('/api/workspace/products',{name:'历史套图商品',images:[]})).body;
  const group={id:'amazon-history',source:{platform:'amazon',workspace_product_id:created.id,product_name:created.name},count:1,slots:[{slot:0}],sets:[],recommendation:{status:'completed'},createdAt:'2026-11-19T00:00:00Z'};
  f.app.store.state.multisets[group.id]=group;
  const view=(await f.request('/api/workspace')).body,task=view.tasks.find(t=>t.id==='multiset:'+group.id),version=view.products.find(p=>p.id===created.id).versions.find(v=>v.id===group.id);
  assert.equal(task.url,version.url);
  const destination=new URL(task.url,f.base);assert.equal(destination.pathname,'/design');assert.equal(destination.searchParams.get('platform'),'amazon');assert.equal(destination.searchParams.get('group'),group.id);assert.equal(destination.searchParams.get('product'),created.id);assert.equal(destination.searchParams.has('view'),false);assert.equal(destination.hash,'#multisets');
  const page=await fetch(destination,{redirect:'manual'});assert.equal(page.status,200);assert.equal(page.headers.get('location'),null);assert.match(await page.text(),/WorkspaceDesignBoot/);
  noExternalCalls(f.calls);
});

test('display branding never rewrites product titles or local folder paths inside shared page boot data',async t=>{
  const f=await fixture(t),png=await sharp({create:{width:100,height:100,channels:3,background:'#dddddd'}}).png().toBuffer(),image=f.app.saveImage(png);
  const folder='C:\\Users\\merchant\\Desktop\\极鲸云素材',title='极鲸云商品 原始标题';
  const preview=await f.app.erp.makePreview({label:title,rows:[{rowId:'row-one',productCode:'ONE',title,folder:'images'}],folders:[{name:'images',files:[path.join(f.app.mediaDirectory,path.basename(image))]}]});
  const intake={folderPath:folder,generation:{sourceFolder:folder,products:[{name:title}]}},review={storeKey:'temu-one',rows:[{rowId:'row-one',title}]};
  assert.equal((await f.post('/api/workspace/ui-state?key=listing:intake',{data:intake})).status,200);
  assert.equal((await f.post('/api/workspace/ui-state?key='+encodeURIComponent('listing:review:'+preview.id),{data:review})).status,200);
  const response=await f.request('/temu/listings');assert.equal(response.status,200);
  const encodedBoot=response.body.match(/window\.WorkspacePageBoot=(.+?)<\/script>/s)?.[1];assert.ok(encodedBoot);
  const boot=JSON.parse(encodedBoot);
  assert.deepEqual(boot.uiStates['listing:intake'].data,intake);
  assert.deepEqual(boot.uiStates['listing:review:'+preview.id].data,review);
  noExternalCalls(f.calls);
});

test('legacy sourcing and settings bookmarks keep their query and enter the shared shell',async t=>{
  const f=await fixture(t);
  for(const [alias,destination] of [['/sourcing.html?platform=temu&search=history','/sourcing?platform=temu&search=history'],['/merchant.html?newStore=1','/settings?newStore=1']]){
    const redirect=await fetch(f.base+alias,{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),destination);
    const response=await f.request(destination);assert.equal(response.status,200);assert.match(response.body,/\/local\/workspace-shell\.js/);assert.match(response.body,/window\.WorkspacePageBoot=/);
  }
  noExternalCalls(f.calls);
});
