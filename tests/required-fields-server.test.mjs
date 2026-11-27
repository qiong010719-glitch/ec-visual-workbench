import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench,createListingWorkflowDispatcher} from '../src/server.mjs';

const goodsIds=['601234567890001','601234567890002'];
const product=goodsId=>({goodsId,title:'Fixture juicer '+goodsId,sourceUrl:`https://www.temu.com/fixture-g-${goodsId}.html`});
const sourceCategoryFacts=args=>({goodsId:args.goodsId,sourceUrl:args.sourceUrl,observedAt:new Date().toISOString(),categoryPath:['家居','榨汁机'],selectedVariant:{selectionComplete:false,attributes:[]},priceCandidates:[]});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
test('default workflow dispatcher routes by platform and protects non-Temu legacy and all automatic publishing',async()=>{
  const calls=[],adapter=name=>({inspect:async()=>{calls.push(name+':inspect');return name;},prepare:async()=>{calls.push(name+':prepare');return name;},moveToPending:async()=>{calls.push(name+':pending');return name;},publish:async()=>{calls.push(name+':publish');return name;},capabilities:{publish:name==='temu',platforms:name==='temu'?['temu']:['shein','tiktok']}});
  const dispatch=createListingWorkflowDispatcher({temu:adapter('temu'),requiredFields:adapter('required')});
  assert.deepEqual(dispatch.capabilities.platforms,['temu','shein','tiktok']);
  assert.equal(await dispatch.inspect({templateSnapshot:{platform:'temu'}}),'temu');
  for(const platform of ['shein','tiktok']){
    const args={workflowMode:'required-fields',completionMode:'pending',templateSnapshot:{platform}};
    assert.equal(await dispatch.prepare(args),'required');assert.equal(await dispatch.moveToPending(args),'required');
    await assert.rejects(dispatch.publish(args),/不能提交平台发布/);
    await assert.rejects(dispatch.prepare({templateSnapshot:{platform}}),/尚未接入/);
  }
  await assert.rejects(dispatch.publish({workflowMode:'required-fields',completionMode:'pending',templateSnapshot:{platform:'temu'}}),/不能提交平台发布/);
  assert.equal(await dispatch.publish({templateSnapshot:{platform:'temu'}}),'temu');
  assert.equal(calls.filter(call=>call==='required:publish').length,0);
});
async function fixture(t,{readCategories,skipDuplicate=false,claimNeeded=false,site=''}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'required-fields-server-')),calls=[];let claimed=!claimNeeded;
  const adapter={
    capabilities:{platforms:['temu','shein','tiktok'],readCategories:true,categorySearchPlatforms:['shein'],moveToPending:true,publish:true},
    inspect:async args=>({rows:args.rows.flatMap((row,index)=>args.templateSnapshot.storeBindings.map((store,storeIndex)=>{const draftId=String(220114595120000000n+BigInt(index*10+storeIndex)),platform=args.templateSnapshot.platform,segment={temu:'popTemu',shein:'sheinProduct',tiktok:'tiktok'}[platform];return {goodsId:row.goodsId,sourceUrl:row.sourceUrl,storeBindingKey:store.key,storeName:store.storeName,site:store.site,platform,status:'located',draftId,platformEditUrl:`https://www.dianxiaomi.com/web/${segment}/edit?id=${draftId}`,requiredFields:[{label:'产品分类',missing:true},{label:'重量',missing:true}],issues:[]};}))}),
    readCategories:async args=>{calls.push({kind:'readCategories',path:args.path});if(readCategories)return readCategories(args);return {platform:args.templateSnapshot.platform,account:args.erpConnection.expectedAccount,storeBindingKey:args.storeBinding.key,path:args.path,options:args.path.length?[{id:'juicer',label:'榨汁机',path:[...args.path,'榨汁机'],leaf:true}]:[{id:'home',label:'家居',path:['家居'],leaf:false}]};},
    searchCategories:async args=>{calls.push({kind:'searchCategories',query:args.query});return {platform:args.templateSnapshot.platform,account:args.erpConnection.expectedAccount,storeBindingKey:args.storeBinding.key,query:args.query,candidates:[{candidateId:'fixture-juicer',platformCategoryId:'juicer',label:'榨汁机',path:['家居','榨汁机'],leaf:true,source:'store-search'}]};},
    prepare:async args=>{assert.equal(args.templateSnapshot.category.id,'juicer');await args.beforeSave({url:args.row.platformEditUrl,goodsId:args.row.goodsId,storeBindingKey:args.storeBinding.key,templateId:args.templateSnapshot.id,templateVersion:1,expectedSnapshot:{url:args.row.platformEditUrl}});calls.push({kind:'prepare',goodsId:args.row.goodsId});return {platformEditUrl:args.row.platformEditUrl,saved:true,ready:true,published:false,issues:[]};},
    verify:async args=>({platformEditUrl:args.row.platformEditUrl,saved:true,ready:true,published:false,issues:[]}),
    moveToPending:async args=>{await args.beforeMoveToPending({draftId:args.row.draftId,goodsId:args.row.goodsId,storeBindingKey:args.row.storeBindingKey,url:args.row.platformEditUrl,sourceUrl:args.row.sourceUrl,from:'collection',to:'pending-publication'});calls.push({kind:'pending',goodsId:args.row.goodsId});return {platformEditUrl:args.row.platformEditUrl,publicationStatus:'draft',movedToPending:true,publicationNotSubmitted:true,saved:true,ready:true,published:false,submitted:false,issues:[]};},
    verifyPublication:async args=>({platformEditUrl:args.row.platformEditUrl,publicationStatus:'draft',movedToPending:true,publicationNotSubmitted:true,readOnly:true,saved:true,ready:true,published:false,issues:[]}),
    publish:async()=>{calls.push({kind:'publish'});throw new Error('required-fields task must never publish');}
  };
  const inspect=adapter.inspect;
  adapter.inspect=async args=>claimed?inspect(args):{rows:args.rows.flatMap(row=>args.templateSnapshot.storeBindings.map(store=>({goodsId:row.goodsId,sourceUrl:row.sourceUrl,storeBindingKey:store.key,storeName:store.storeName,site:store.site,platform:args.templateSnapshot.platform,status:'unclaimed',issues:[]})))};
  const allocationAdapter={claimDestinations:async args=>{
    await args.beforeClaim({goodsIds:args.sourceRows.map(row=>row.goodsId),destinations:args.destinations.map(item=>item.platform==='shein'?{...item,site:''}:item),skipDuplicates:true});
    calls.push({kind:'claim',goodsIds:args.sourceRows.map(row=>row.goodsId),destinations:args.destinations});claimed=true;return {status:'claimed',submitted:true};
  }};
  const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},settingsCodec:{encode:value=>value,decode:value=>value},listingWorkflowAdapter:adapter,allocationAdapter,
    freePluginAdapter:{check:async()=>({status:'ready',message:'fixture'})},
    freeSourcingAdapter:{search:async()=>({status:'ready',products:goodsIds.map(product)}),collect:async args=>{await args.onSourceFacts(sourceCategoryFacts(args));args.beforeSubmit();calls.push({kind:'collect',goodsId:args.goodsId});if(skipDuplicate&&args.goodsId===goodsIds[0])return {status:'skipped-duplicate',pluginStatus:'duplicate',receipt:{status:'duplicate',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString(),text:'该产品在店小秘已有采集记录'}};return {status:'submitted',pluginStatus:'success',receipt:{kind:'toast',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString(),text:'fixture采集成功'}};},returnToSearch:async()=>({status:'ready'})},
    freeCollectionAdapter:{check:async()=>({ready:true}),lookup:async()=>{throw new Error('ordinary collection must not precheck source URLs');},verify:async args=>({status:'verified',evidence:{sourceUrl:args.sourceUrl,editUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=${219835794620000000n+BigInt(goodsIds.indexOf(args.goodsId))}`}})}
  });
  app.preferences.update({revision:0,browsers:[{key:'chrome',type:'chrome',name:'测试浏览器',debugPort:9456}],erpConnections:[{key:'dxm',name:'测试ERP',browserKey:'chrome',expectedAccount:'fixture'}],stores:[],collectionStores:[{key:'shein-a',erpKey:'dxm',platform:'shein',storeName:'希音测试店A',site,storeId:'shop-a'},{key:'shein-b',erpKey:'dxm',platform:'shein',storeName:'希音测试店B',site,storeId:'shop-b'},{key:'tiktok-a',erpKey:'dxm',platform:'tiktok',storeName:'TikTok测试店'},{key:'temu-ca',erpKey:'dxm',platform:'temu',storeName:'Temu测试店',site:'加拿大站'}]});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port,{token}=await fetch(base+'/api/session').then(response=>response.json());
  t.after(async()=>{if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const request=async(route,payload)=>{const response=await fetch(base+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:response.status,data:await response.json()};};
  const ok=async(route,payload,status)=>{const result=await request(route,payload);assert.equal(result.status,status??(payload===undefined?200:200),JSON.stringify(result.data));return result.data;};
  const idle=async()=>{const deadline=Date.now()+4000;while(app.isBusy()){if(Date.now()>deadline)throw new Error('fixture did not settle');await tick();}};
  const seed=async()=>{await ok('/api/free-sourcing/jobs',{requestId:'free-fixture',erpKey:'dxm',keyword:'榨汁机',limit:skipDuplicate?1:2,captchaMaxAttempts:0,collectionMode:'recording'},202);await idle();};
  const create=async(destinationKeys=['shein-a'])=>ok('/api/listing-workflow/jobs',{requestId:'required-fixture',sourceJobId:'free-fixture',goodsIds,destinationKeys},201);
  const run=async(id,action)=>{await ok(`/api/listing-workflow/jobs/${id}/${action}`,{},202);await idle();return ok(`/api/listing-workflow/jobs/${id}`);};
  return {app,base,token,calls,request,ok,idle,seed,create,run};
}

test('frontend duplicate skip flows through SHEIN claim with a configured site, category fill and pending',async t=>{
  const f=await fixture(t,{skipDuplicate:true,claimNeeded:true,site:'美国站'});await f.seed();
  const source=await f.ok('/api/free-sourcing');assert.equal(source.jobs[0].status,'completed');assert.deepEqual(source.jobs[0].rows.map(row=>row.status),['skipped-duplicate','verified']);
  assert.equal(source.jobs[0].rows.filter(row=>row.status==='verified').length,source.jobs[0].limit);
  assert.equal(f.calls.filter(call=>call.kind==='collect').length,2);
  const rejected=await f.request('/api/listing-workflow/jobs',{requestId:'cannot-claim-skipped',sourceJobId:'free-fixture',goodsIds,destinationKeys:['shein-a']});assert.equal(rejected.status,400);
  const selectedIds=[goodsIds[1]],job=await f.ok('/api/listing-workflow/jobs',{requestId:'after-frontend',sourceJobId:'free-fixture',goodsIds:selectedIds,destinationKeys:['shein-a','shein-b']},201);
  const inspected=await f.run(job.id,'inspect');assert.ok(inspected.availableActions.includes('claim'));
  const claimed=await f.run(job.id,'claim');assert.equal(claimed.totals.located,2);
  assert.equal(claimed.claimIntent.destinations[0].site,'美国站');assert.equal(claimed.claimIntent.payload.destinations[0].site,'');
  const claim=f.calls.find(call=>call.kind==='claim');assert.deepEqual(claim.goodsIds,selectedIds);assert.equal(claim.destinations.length,2);
  const base=`/api/listing-workflow/jobs/${job.id}`;
  for(const key of ['shein-a','shein-b']){
    await f.ok(base+'/categories/read',{goodsId:goodsIds[1],storeBindingKey:key,path:[]});
    const catalog=await f.ok(base+'/categories/read',{goodsId:goodsIds[1],storeBindingKey:key,path:['家居']});
    await f.ok(base+'/categories/select',{goodsIds:selectedIds,storeBindingKeys:[key],catalogId:catalog.catalogId,category:catalog.options[0]});
  }
  await f.run(job.id,'prepare');const result=await f.run(job.id,'pending');
  assert.equal(result.status,'pending-ready');assert.equal(result.totals.pending,2);assert.equal(result.totals.published,0);
  assert.equal(f.calls.filter(call=>call.kind==='claim').length,1);assert.equal(f.calls.filter(call=>call.kind==='prepare').length,2);
  assert.equal(f.calls.filter(call=>call.kind==='publish').length,0);assert.equal((await f.request(base+'/publish',{})).status,409);
});

test('HTTP required-field jobs use bound SHEIN stores, observed leaf categories and stop at pending',async t=>{
  const f=await fixture(t);await f.seed();
  const settings=await f.ok('/api/settings');assert.equal(settings.stores.length,0);assert.equal(settings.collectionStores.length,4);
  const mixed=await f.request('/api/listing-workflow/jobs',{requestId:'mixed-fixture',sourceJobId:'free-fixture',goodsIds,destinationKeys:['shein-a','temu-ca']});assert.equal(mixed.status,400);
  const job=await f.create();assert.equal(job.workflowMode,'required-fields');assert.equal(job.completionMode,'pending');assert.equal((await f.ok('/api/listing-templates')).templates.length,0);
  const base=`/api/listing-workflow/jobs/${job.id}`;
  assert.equal((await f.request(base+'/publish',{})).status,409);
  await f.run(job.id,'inspect');
  assert.equal((await f.request(base+'/prepare',{})).status,409);
  const root=await f.ok(base+'/categories/read',{goodsId:goodsIds[0],storeBindingKey:'shein-a',path:[]});assert.ok(root.catalogId);assert.equal(root.options[0].leaf,false);
  const branch=await f.request(base+'/categories/select',{goodsIds,storeBindingKeys:['shein-a'],catalogId:root.catalogId,category:root.options[0]});assert.equal(branch.status,409);
  const catalog=await f.ok(base+'/categories/read',{goodsId:goodsIds[0],storeBindingKey:'shein-a',path:['家居']});
  const category={id:'juicer',label:'榨汁机',path:['家居','榨汁机']};
  const forged=await f.request(base+'/categories/select',{goodsIds,storeBindingKeys:['shein-a'],catalogId:catalog.catalogId,category:{...category,id:'invented'}});assert.equal(forged.status,409);
  const unconfirmed=await f.request(base+'/categories/select',{goodsIds,storeBindingKeys:['shein-a'],catalogId:catalog.catalogId,category});
  assert.equal(unconfirmed.status,400);assert.match(JSON.stringify(unconfirmed.data),/已确认的具体商品类型/);
  assert.ok((await f.ok(base)).rows.every(row=>row.categoryRequired&&!row.productTypeConfirmation));
  const searched=await f.ok(base+'/categories/search',{goodsId:goodsIds[0],storeBindingKey:'shein-a',query:'便携榨汁机',productType:'便携榨汁机'});
  assert.equal(searched.resolution.status,'needs-confirmation');assert.equal(searched.product.productTypeConfirmed,false);
  const confirmed=await f.ok(base+'/categories/resolve',{catalogId:searched.catalogId,catalogDigest:searched.catalogDigest,candidateId:searched.candidates[0].candidateId,goodsIds,storeBindingKey:'shein-a',productType:'便携榨汁机',confirmProductType:true});
  assert.ok(confirmed.rows.every(row=>row.productTypeConfirmation?.productType==='便携榨汁机'&&Number.isFinite(Date.parse(row.productTypeConfirmation.confirmedAt))));
  for(const row of confirmed.rows)assert.deepEqual(row.productTypeConfirmation.sourcePath,['家居','榨汁机']);
  const selected=await f.ok(base+'/categories/select',{goodsIds,storeBindingKeys:['shein-a'],catalogId:catalog.catalogId,category});assert.ok(selected.rows.every(row=>row.category.id==='juicer'));assert.ok(selected.availableActions.includes('prepare'));
  const prepared=await f.run(job.id,'prepare');assert.ok(prepared.availableActions.includes('pending'));assert.ok(!prepared.availableActions.includes('publish'));
  const pending=await f.run(job.id,'pending');assert.equal(pending.status,'pending-ready');assert.equal(pending.totals.pending,2);assert.ok(pending.rows.every(row=>row.publicationStatus==='draft'&&row.published===false));
  assert.equal((await f.request(base+'/pending',{})).status,409);assert.equal((await f.request(base+'/publish',{})).status,409);
  assert.equal(f.calls.filter(call=>call.kind==='pending').length,2);assert.equal(f.calls.filter(call=>call.kind==='publish').length,0);
});

test('HTTP category reads hold the browser busy guard and protect settings and competing writes',async t=>{
  let release,started=false;
  const gate=new Promise(resolve=>release=resolve);
  const f=await fixture(t,{readCategories:async args=>{started=true;await gate;return {platform:'shein',account:'fixture',storeBindingKey:args.storeBinding.key,path:args.path,options:[]};}});
  await f.seed();const job=await f.create();await f.run(job.id,'inspect');const base=`/api/listing-workflow/jobs/${job.id}`;
  const reading=f.request(base+'/categories/read',{goodsId:goodsIds[0],storeBindingKey:'shein-a',path:[]});
  const deadline=Date.now()+2000;while(!started){if(Date.now()>deadline)throw new Error('category read did not start');await tick();}
  try{
    assert.equal((await f.request(base+'/categories/read',{goodsId:goodsIds[1],storeBindingKey:'shein-a',path:[]})).status,409);
    assert.equal((await f.request(base+'/categories/select',{goodsIds,storeBindingKeys:['shein-a'],category:{id:'x',label:'x',path:['x']}})).status,409);
    assert.equal((await f.request(base+'/pending',{})).status,409);
    assert.equal((await f.request('/api/settings',{revision:f.app.preferences.view().revision,collectionStores:[]})).status,409);
    assert.equal((await f.ok('/api/listing-workflow')).busy,true);
  }finally{release();}
  assert.equal((await reading).status,200);await f.idle();assert.equal(f.app.preferences.view().collectionStores.length,4);
});

test('HTTP category evidence cannot cross stores or accept a different account',async t=>{
  const f=await fixture(t,{readCategories:async args=>({platform:'shein',account:'other-account',storeBindingKey:args.storeBinding.key,path:args.path,options:[{id:'x',label:'家居',path:['家居'],leaf:true}]})});
  await f.seed();const job=await f.create(['shein-a','shein-b']);await f.run(job.id,'inspect');
  const base=`/api/listing-workflow/jobs/${job.id}`;
  assert.equal((await f.request(base+'/categories/read',{goodsId:goodsIds[0],storeBindingKey:'shein-a',path:[]})).status,400);
  assert.equal((await f.request(base+'/categories/select',{goodsIds,storeBindingKeys:['shein-a','shein-b'],category:{id:'x',label:'家居',path:['家居']}})).status,400);
  assert.ok((await f.ok(base)).rows.every(row=>row.categoryRequired===true));assert.equal(f.calls.filter(call=>call.kind==='prepare').length,0);
});
