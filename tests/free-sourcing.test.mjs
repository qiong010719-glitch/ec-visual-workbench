import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createFreeSourcing} from '../src/free-sourcing.mjs';
import {productIdentity,searchUrl} from '../src/temu-front-browser.mjs';

const products=[1,2].map(n=>({sourceUrl:`https://www.temu.com/fixture-g-60110525267812${n}.html`,title:'商品'+n}));
const request={requestId:'free-test-0001',keyword:'canvas wall art',limit:2,erpKey:'erp-a'};
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'free-sourcing-test-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const account={key:'erp-a',browserKey:'chrome-a',expectedAccount:'fixture',name:'测试ERP'},events=[],saved=new Set();
  const preferences={erp:()=>({...account}),browser:()=>({key:'chrome-a',type:'chrome',debugPort:9333})};
  const adapter={search:async()=>{events.push('search');return {status:'ready',products};},collect:async args=>{args.beforeSubmit();events.push('click:'+args.goodsId);saved.add(args.goodsId);return {status:'submitted'};}};
  const collectionAdapter={check:async()=>{events.push('account');},lookup:async args=>saved.has(args.goodsId)?{status:'verified'}:{status:'absent'},verify:async args=>{events.push('verify:'+args.goodsId);return saved.has(args.goodsId)?{status:'verified',evidence:{sourceUrl:args.sourceUrl}}:{status:'needs-review',error:'等待采集箱结果'};}};
  const configuration={SADCAPTCHA_API_KEY:'fixture-secret'},options={directory,preferences,adapter,collectionAdapter,configuration,pluginAdapter:{check:async()=>({status:'ready',message:'fixture插件已启用'})}};
  return {directory,options,account,events,saved,adapter,collectionAdapter,service:createFreeSourcing(options)};
}
async function idle(service){const until=Date.now()+3000;while(service.isBusy()){if(Date.now()>until)throw new Error('fixture timeout');await new Promise(r=>setTimeout(r,2));}}

const sourceObservation=args=>({version:1,goodsId:args.goodsId,sourceUrl:args.sourceUrl,observedAt:new Date().toISOString(),categoryPath:['家居厨房用品','装饰'],priceCandidates:[{kind:'displayed-sale',text:'US$12.50'}],selectedVariant:{attributes:[{name:'颜色',value:'蓝色'}],selectionComplete:true}});

test('new collections persist Temu source facts before submission while missing facts never fake a price',async t=>{
  const f=fixture(t),collect=f.adapter.collect;
  f.adapter.collect=async args=>{
    await args.onSourceFacts(args.goodsId===productIdentity(products[0].sourceUrl)?sourceObservation(args):{...sourceObservation(args),priceCandidates:[{kind:'displayed-sale',text:'预估2,777円'}]});
    const row=JSON.parse(fs.readFileSync(path.join(f.directory,'state.json'),'utf8')).jobs[request.requestId].rows.find(item=>item.goodsId===args.goodsId);
    assert.ok(row.sourceFacts);assert.equal(row.submittedAt,undefined);
    return collect(args);
  };
  f.service.start(request);await idle(f.service);
  const job=f.service.get(request.requestId);assert.equal(job.status,'completed');
  assert.equal(job.rows[0].sourceFacts.price.amount,'12.5');assert.equal(job.rows[0].sourceFacts.variants.length,1);
  assert.equal(job.rows[1].sourceFacts.status,'incomplete');assert.equal(job.rows[1].sourceFacts.price,null);
});

test('historical source facts reread only verified rows and preserve original collection state',async t=>{
  const f=fixture(t);f.service.start(request);await idle(f.service);
  const before=f.service.get(request.requestId),eventCount=f.events.length,ids=before.rows.map(row=>row.goodsId),reads=[];
  f.adapter.readSourceFacts=async args=>{
    assert.equal(args.captchaPreflight().allowed,false);assert.throws(()=>args.beforeCaptcha(),/不调用自动验证码/);
    assert.equal(args.isStopped(),false);reads.push(args.goodsId);
    const sourceFacts=sourceObservation(args);await args.onSourceFacts(sourceFacts);return {status:'ready',sourceFacts};
  };
  const result=await f.service.readSourceFacts(before.id,{goodsIds:ids});
  assert.equal(result.status,before.status);assert.equal(result.message,before.message);assert.equal(result.stopRequested,before.stopRequested);
  assert.deepEqual(result.rows.map(row=>row.submittedAt),before.rows.map(row=>row.submittedAt));assert.deepEqual(reads,ids);
  assert.equal(result.sourceFactsRead.status,'completed');assert.equal(result.sourceFactsRead.completed,2);assert.equal(f.events.length,eventCount,'no collection, lookup, account check or claim is replayed');
  assert.deepEqual(result.captcha.attempts,before.captcha.attempts);assert.equal(f.service.isBusy(),false);
  const restored=createFreeSourcing(f.options).get(before.id);assert.deepEqual(restored.rows.map(row=>row.sourceFacts),result.rows.map(row=>row.sourceFacts));
  await assert.rejects(f.service.readSourceFacts(before.id,{goodsIds:[ids[0],ids[0]]}),/仅可补读/);
  await assert.rejects(f.service.readSourceFacts(before.id,{goodsIds:['601105252678199']}),/仅可补读/);
  f.account.expectedAccount='other-account';await assert.rejects(f.service.readSourceFacts(before.id,{goodsIds:[ids[0]]}),/绑定已变化/);
});

test('historical source challenge invalidates an older ready observation and never resumes collection',async t=>{
  const f=fixture(t);f.service.start(request);await idle(f.service);const id=f.service.get(request.requestId).rows[0].goodsId;
  f.adapter.readSourceFacts=async args=>({status:'ready',sourceFacts:sourceObservation(args)});
  await f.service.readSourceFacts(request.requestId,{goodsIds:[id]});
  const before=f.service.get(request.requestId),eventCount=f.events.length;
  f.adapter.readSourceFacts=async()=>({status:'waiting-verification',message:'Temu 出现安全验证，原页已保留。'});
  const after=await f.service.readSourceFacts(request.requestId,{goodsIds:[id]});
  assert.equal(after.status,'completed');assert.equal(after.message,before.message);assert.equal(after.sourceFactsRead.status,'incomplete');
  assert.equal(after.rows[0].sourceFacts.status,'incomplete');assert.equal(after.rows[0].sourceFacts.price,null);
  assert.equal(after.rows[0].sourceFactsHistory.at(-1).status,'ready');assert.match(after.rows[0].sourceFactsReadError,/安全验证/);
  assert.equal(f.events.length,eventCount);assert.equal(f.service.isBusy(),false);
});

test('source facts reread rejects a mismatched product observation and can be cancelled independently',async t=>{
  const f=fixture(t);f.service.start(request);await idle(f.service);const before=f.service.get(request.requestId),ids=before.rows.map(row=>row.goodsId);
  f.adapter.readSourceFacts=async args=>({status:'ready',sourceFacts:{...sourceObservation(args),goodsId:ids[1]}});
  const rejected=await f.service.readSourceFacts(before.id,{goodsIds:[ids[0]]});assert.equal(rejected.sourceFactsRead.status,'incomplete');assert.equal(rejected.rows[0].sourceFacts.price,null);assert.match(rejected.rows[0].sourceFactsReadError,/身份不一致/);
  let release;const pending=new Promise(resolve=>{release=resolve;});let reads=0;
  f.adapter.readSourceFacts=async args=>{reads++;await pending;return {status:'ready',sourceFacts:sourceObservation(args)};};
  const completion=f.service.readSourceFacts(before.id,{goodsIds:ids});assert.equal(f.service.isBusy(),true);
  await assert.rejects(f.service.readSourceFacts(before.id,{goodsIds:[ids[0]]}),/有任务正在运行/);
  f.service.stop(before.id);release();const after=await completion;
  assert.equal(reads,1);assert.equal(after.status,before.status);assert.equal(after.message,before.message);assert.equal(after.sourceFactsRead.status,'paused');assert.equal(f.service.isBusy(),false);
});

function recordingFixture(t){
  const f=fixture(t),collect=f.adapter.collect,lookup=f.collectionAdapter.lookup;
  f.adapter.collect=async args=>{const result=await collect(args);return {...result,pluginStatus:'success',receipt:{kind:'toast',text:'采集成功，可继续采集产品或者前往采集箱',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString()}};};
  f.collectionAdapter.lookup=async args=>{f.events.push('lookup:'+args.goodsId);return lookup(args);};
  f.adapter.returnToSearch=async args=>{
    const persisted=JSON.parse(fs.readFileSync(path.join(f.directory,'state.json'),'utf8')).jobs[request.requestId].rows.find(r=>r.goodsId===args.goodsId);
    assert.equal(persisted.status,'collected');assert.equal(persisted.pluginReceipt.status,'success');
    f.events.push('return:'+args.goodsId);return {status:'ready'};
  };
  return f;
}

test('recording flow collects without lookups, persists each receipt before returning, and verifies only after all clicks',async t=>{
  const f=recordingFixture(t),ids=products.map(p=>productIdentity(p.sourceUrl));
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  assert.deepEqual(f.events,['account','search','click:'+ids[0],'return:'+ids[0],'click:'+ids[1],'return:'+ids[1],...ids.map(id=>'verify:'+id)]);
  const job=f.service.get(request.requestId);assert.equal(job.status,'completed');assert.equal(job.collectionMode,'recording');assert.ok(job.rows.every(r=>r.pluginReceipt&&r.status==='verified'));
});

test('thirty recording products keep one collection tab and persist successful closures through restart',async t=>{
  const f=recordingFixture(t),collect=f.adapter.collect,verify=f.collectionAdapter.verify;
  const thirty=Array.from({length:30},(_,i)=>({sourceUrl:`https://www.temu.com/fixture-g-${601105252678100+i}.html`,title:`Product ${i+1}`}));
  const liveTabs=new Set();let collectionCreates=0,maxTabs=0;
  const track=()=>{maxTabs=Math.max(maxTabs,liveTabs.size);};
  const collectionTab=args=>{
    if(!args.tabs.collection){
      collectionCreates++;liveTabs.add('collection-owned');track();
      args.onTarget('collection','collection-owned',{owned:true,sourceUrl:'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'});
    }
    assert.equal(args.tabs.collection,'collection-owned');
    assert.equal(args.ownedTabs['collection-owned'].kind,'collection');
  };
  f.collectionAdapter.check=async args=>collectionTab(args);
  f.collectionAdapter.lookup=async args=>{collectionTab(args);return {status:'absent'};};
  f.collectionAdapter.verify=async args=>{collectionTab(args);return verify(args);};
  f.collectionAdapter.open=async args=>{collectionTab(args);return {url:'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'};};
  f.adapter.search=async args=>{
    liveTabs.add('search-owned');track();
    args.onTarget('search','search-owned',{owned:true,sourceUrl:searchUrl(args.keyword)});
    return {status:'ready',products:thirty};
  };
  f.adapter.collect=async args=>{
    assert.equal(args.tabs.product,undefined,'completed product must not remain bound');
    const targetId='product-'+args.goodsId;liveTabs.add(targetId);track();
    args.onTarget('product',targetId,{owned:true,goodsId:args.goodsId,sourceUrl:args.sourceUrl});
    return collect(args);
  };
  f.adapter.returnToSearch=async args=>{
    const persisted=JSON.parse(fs.readFileSync(path.join(f.directory,'state.json'),'utf8')).jobs[request.requestId];
    assert.equal(args.closeProduct,true);
    assert.equal(persisted.rows.find(row=>row.goodsId===args.goodsId).pluginReceipt.status,'success','receipt must survive a crash before closing');
    const targetId=args.tabs.product;
    assert.equal(persisted.ownedTabs[targetId].goodsId,args.goodsId);
    liveTabs.delete(targetId);args.onTargetClosed('product',targetId);args.onTargetClosed('product',targetId);
    return {status:'ready'};
  };
  f.service.start({...request,limit:30,collectionMode:'recording'});await idle(f.service);
  const job=f.service.get(request.requestId);
  assert.equal(job.status,'completed');assert.equal(maxTabs,3);assert.equal(liveTabs.size,2);
  assert.equal(job.closedTabs.length,30);assert.equal(job.tabs.product,undefined);
  assert.equal(Object.keys(job.ownedTabs).length,2);assert.equal(collectionCreates,1);
  const restored=createFreeSourcing(f.options);
  await restored.open(request.requestId,'collection');await restored.open(request.requestId,'collection');
  assert.equal(collectionCreates,1,'opening the completed collection box after restart reuses its saved target');
  assert.equal(restored.get(request.requestId).closedTabs.length,30);
  assert.equal(f.events.filter(event=>event.startsWith('click:')).length,30);
});

test('a broken source-URL precheck cannot block ordinary frontend collection',async t=>{
  const f=recordingFixture(t);
  f.collectionAdapter.lookup=async()=>{throw new Error('来源URL查询方式已选中超时');};
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'completed');assert.equal(f.events.filter(e=>e.startsWith('click:')).length,2);
});

for(const beforeClick of [true,false])test(`frontend duplicate ${beforeClick?'before':'after'} a click is skipped and the next product is collected`,async t=>{
  const f=recordingFixture(t),collect=f.adapter.collect,ids=products.map(p=>productIdentity(p.sourceUrl));
  const replacement={sourceUrl:'https://www.temu.com/fixture-g-601105252678123.html',title:'补充商品'};
  f.adapter.search=async args=>({status:'ready',products:args.excludeGoodsIds?[...products,replacement]:products});
  f.collectionAdapter.lookup=async()=>{throw new Error('ordinary collection must never query for duplicates');};
  f.adapter.collect=async args=>{
    if(args.goodsId!==ids[0])return collect(args);
    if(!beforeClick){args.beforeSubmit();f.events.push('click:'+args.goodsId);}
    return {status:'skipped-duplicate',pluginStatus:'duplicate',receipt:{status:'duplicate',kind:'duplicate-dialog',text:'该产品在店小秘已有采集记录，是否继续采集？',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString()}};
  };
  f.adapter.returnToSearch=async args=>{
    const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'state.json'),'utf8')).jobs[request.requestId].rows.find(row=>row.goodsId===args.goodsId);
    assert.equal(saved.status,args.goodsId===ids[0]?'skipped-duplicate':'collected');
    f.events.push('return:'+args.goodsId);return {status:'ready'};
  };
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  const job=f.service.get(request.requestId);
  assert.equal(job.status,'completed');assert.deepEqual(job.rows.map(row=>row.status),['skipped-duplicate','verified','verified']);
  assert.equal(job.rows.filter(row=>row.status==='verified').length,request.limit);
  assert.match(job.message,/1 件前端提示重复已跳过/);
  assert.ok(f.events.indexOf('return:'+ids[0])<f.events.indexOf('click:'+ids[1]));
  assert.ok(!f.events.includes('verify:'+ids[0]));assert.equal(f.events.filter(e=>e==='click:'+ids[1]).length,1);
  const before=f.events.length,restored=createFreeSourcing(f.options);restored.resume(request.requestId);await idle(restored);
  assert.equal(f.events.length,before,'completed duplicate skips must survive restart');
});

test('all frontend duplicates pause below target when no new candidates remain, without replay on resume',async t=>{
  const f=recordingFixture(t);
  f.adapter.collect=async args=>({status:'skipped-duplicate',pluginStatus:'duplicate',receipt:{status:'duplicate',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString()}});
  f.adapter.returnToSearch=async()=>({status:'ready'});
  f.collectionAdapter.verify=async()=>{throw new Error('skipped duplicates are not new claim candidates');};
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  const job=f.service.get(request.requestId);assert.equal(job.status,'paused');assert.match(job.message,/已确认 0 件.*2 件前端提示重复已跳过/);assert.match(job.message,/尚缺 2 件/);
  assert.ok(job.rows.every(row=>row.status==='skipped-duplicate'&&!row.evidence));
  f.adapter.collect=async()=>{throw new Error('duplicates must not be collected again');};
  const restored=createFreeSourcing(f.options);restored.resume(request.requestId);await idle(restored);
  assert.equal(restored.get(request.requestId).status,'paused');assert.equal(restored.get(request.requestId).rows.length,2);
});

test('many consecutive duplicates refill the original keyword until exactly the requested new successes',async t=>{
  const f=recordingFixture(t),normal=f.adapter.collect,all=Array.from({length:37},(_,i)=>({sourceUrl:`https://www.temu.com/fixture-g-${601105252678200+i}.html`,title:'候选'+i})),attempts=[],searches=[];
  const duplicates=new Set(all.slice(0,34).map(p=>productIdentity(p.sourceUrl)));
  f.adapter.search=async args=>{searches.push({keyword:args.keyword,limit:args.limit,excluded:[...args.excludeGoodsIds||[]]});return {status:'ready',products:all.filter(p=>!args.excludeGoodsIds?.includes(productIdentity(p.sourceUrl))).slice(0,args.limit)};};
  f.adapter.collect=async args=>{attempts.push(args.goodsId);return duplicates.has(args.goodsId)?{status:'skipped-duplicate',pluginStatus:'duplicate',receipt:{status:'duplicate',kind:'repeat-action',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString()}}:normal(args);};
  f.adapter.returnToSearch=async()=>({status:'ready'});
  f.collectionAdapter.lookup=async()=>{throw new Error('no box deduplication before collection');};
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  const job=f.service.get(request.requestId);assert.equal(job.status,'completed');assert.equal(job.rows.filter(row=>row.status==='verified').length,2);
  assert.equal(job.rows.filter(row=>row.status==='skipped-duplicate').length,34);assert.equal(attempts.length,36);assert.equal(new Set(attempts).size,36);
  assert.ok(!attempts.includes(productIdentity(all[36].sourceUrl)));assert.ok(searches.every(search=>search.keyword===request.keyword&&search.limit<=request.limit));
  assert.ok(searches.slice(1).every(search=>search.excluded.length>0));assert.equal(f.events.filter(e=>e.startsWith('verify:')).length,2);
});

test('a stopped refill resumes the saved queue without replaying duplicates or successful receipts',async t=>{
  const f=recordingFixture(t),normal=f.adapter.collect,first=productIdentity(products[0].sourceUrl),replacement={sourceUrl:'https://www.temu.com/fixture-g-601105252678123.html',title:'补充商品'};
  let pauseRefill=true,duplicates=0;
  f.adapter.search=async args=>args.excludeGoodsIds&&pauseRefill?{status:'waiting-verification',message:'补充候选时出现验证'}:{status:'ready',products:[...products,replacement]};
  f.adapter.collect=async args=>{if(args.goodsId!==first)return normal(args);duplicates++;return {status:'skipped-duplicate',pluginStatus:'duplicate',receipt:{status:'duplicate',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString()}};};
  f.adapter.returnToSearch=async()=>({status:'ready'});
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'waiting-verification');
  assert.deepEqual(f.service.get(request.requestId).rows.map(row=>row.status),['skipped-duplicate','collected']);
  pauseRefill=false;const restored=createFreeSourcing(f.options);restored.resume(request.requestId);await idle(restored);
  assert.equal(restored.get(request.requestId).status,'completed');assert.equal(duplicates,1);assert.equal(f.events.filter(e=>e.startsWith('click:')).length,2);
});

test('a previous verified batch does not trigger a new pre-collection lookup',async t=>{
  const f=fixture(t);f.service.start(request);await idle(f.service);
  f.collectionAdapter.lookup=async()=>{throw new Error('must let frontend report duplicates');};
  f.service.start({...request,requestId:'free-test-new-batch'});await idle(f.service);
  assert.equal(f.service.get('free-test-new-batch').status,'completed');assert.equal(f.events.filter(e=>e.startsWith('click:')).length,4);
});

test('recording final verification checks later receipts even when an earlier record is not yet visible',async t=>{
  const f=recordingFixture(t),verify=f.collectionAdapter.verify;
  f.collectionAdapter.verify=async args=>{
    if(args.goodsId.endsWith('1')){f.events.push('verify:'+args.goodsId);return {status:'needs-review',error:'第一件仍在入箱处理中'};}
    return verify(args);
  };
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  const job=f.service.get(request.requestId);
  assert.equal(job.status,'needs-review');assert.deepEqual(job.rows.map(r=>r.status),['needs-review','verified']);
  assert.equal(f.events.filter(e=>e.startsWith('verify:')).length,2);assert.equal(f.events.filter(e=>e.startsWith('click:')).length,2);
  f.service.resume(request.requestId);await idle(f.service);assert.equal(f.events.filter(e=>e.startsWith('click:')).length,2);
});

test('recording flow never treats missing, failed, stale, or wrong-product receipts as permission for the next product',async t=>{
  for(const receiptType of ['missing','failed','stale','wrong-product']){
    const f=recordingFixture(t),collect=f.adapter.collect;
    f.adapter.collect=async args=>{
      const result=await collect(args);
      if(receiptType==='missing')delete result.receipt;
      if(receiptType==='failed')result.pluginStatus='failed';
      if(receiptType==='stale')result.receipt.observedAt='2000-01-01T00:00:00Z';
      if(receiptType==='wrong-product')result.receipt.sourceUrl=products[1].sourceUrl;
      return result;
    };
    f.service.start({...request,collectionMode:'recording'});await idle(f.service);
    assert.equal(f.service.get(request.requestId).status,'needs-review',receiptType);
    assert.equal(f.events.filter(e=>e.startsWith('click:')).length,1,receiptType);assert.ok(!f.events.some(e=>e.startsWith('return:')));
    assert.ok(f.service.get(request.requestId).rows[0].submittedAt);
  }
});

test('a crash after a saved green receipt is reconciled after restart without replaying that product',async t=>{
  const f=recordingFixture(t),returnToSearch=f.adapter.returnToSearch;
  f.adapter.returnToSearch=async args=>{await returnToSearch(args);throw new Error('CDP disconnected while returning');};
  f.service.start({...request,collectionMode:'recording'});await idle(f.service);
  const first=f.service.get(request.requestId).rows[0];assert.equal(first.pluginReceipt.status,'success');assert.equal(first.status,'needs-review');
  f.adapter.returnToSearch=returnToSearch;
  const restored=createFreeSourcing(f.options);restored.resume(request.requestId);await idle(restored);
  assert.equal(restored.get(request.requestId).status,'completed');assert.equal(f.events.filter(e=>e==='click:'+first.goodsId).length,1);
});

test('changing an interrupted task to recording mode keeps its intent and does not replay an unknown submission',async t=>{
  const f=recordingFixture(t);
  f.adapter.collect=async args=>{args.beforeSubmit();f.events.push('click:'+args.goodsId);throw new Error('unknown write result');};
  f.service.start(request);await idle(f.service);
  const before=f.service.get(request.requestId);
  f.service.resume(request.requestId,{collectionMode:'recording'});await idle(f.service);
  const after=f.service.get(request.requestId);
  assert.equal(after.collectionMode,'recording');assert.equal(after.status,'needs-review');assert.equal(after.rows[0].submittedAt,before.rows[0].submittedAt);assert.equal(f.events.filter(e=>e.startsWith('click:')).length,1);
  assert.deepEqual(after.captcha,before.captcha);
  assert.throws(()=>f.service.resume(request.requestId,{collectionMode:'recording',reconcileOnly:true}),/只核对/);
  assert.throws(()=>f.service.start({...request,collectionMode:'invalid'}),/执行方式/);
});

test('search CAPTCHA pauses before plugin writes and resumes same request exactly once',async t=>{
  const f=fixture(t);let challenge=true;
  f.adapter.search=async()=>challenge?{status:'waiting-verification',message:'请手动验证'}:{status:'ready',products};
  f.service.start(request);await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'waiting-verification');assert.equal(f.events.filter(x=>x.startsWith('click:')).length,0);
  f.service.start(request);assert.equal(f.service.get(request.requestId).status,'waiting-verification');
  challenge=false;f.service.resume(request.requestId);await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'completed');assert.equal(f.events.filter(x=>x.startsWith('click:')).length,2);
  f.service.resume(request.requestId);assert.equal(f.events.filter(x=>x.startsWith('click:')).length,2);
});

test('product CAPTCHA keeps completed rows and resumes only remaining product',async t=>{
  const f=fixture(t),collect=f.adapter.collect;let challenge=true;
  f.adapter.collect=async args=>args.goodsId.endsWith('2')&&challenge?{status:'waiting-verification',message:'请手动验证'}:collect(args);
  f.service.start(request);await idle(f.service);
  let job=f.service.get(request.requestId);assert.equal(job.status,'waiting-verification');assert.deepEqual(job.rows.map(r=>r.status),['verified','pending']);
  challenge=false;f.service.resume(request.requestId);await idle(f.service);
  assert.equal(f.events.filter(x=>x.startsWith('click:')).length,2);assert.equal(f.service.get(request.requestId).status,'completed');
});

test('uncertain click survives restart; neither resume nor a new job replays it',async t=>{
  const f=fixture(t);f.adapter.collect=async args=>{args.beforeSubmit();f.events.push('click:'+args.goodsId);throw new Error('CDP disconnected');};
  f.service.start(request);await idle(f.service);assert.equal(f.service.get(request.requestId).status,'needs-review');
  const restored=createFreeSourcing(f.options);restored.resume(request.requestId);await idle(restored);
  assert.equal(f.events.filter(x=>x.startsWith('click:')).length,1);
  restored.stop(request.requestId);restored.start({...request,requestId:'free-test-0002'});await idle(restored);
  assert.equal(restored.get('free-test-0002').status,'needs-review');assert.equal(f.events.filter(x=>x.startsWith('click:')).length,1);
  f.saved.add(productIdentity(products[0].sourceUrl));restored.resume('free-test-0002',{reconcileOnly:true});await idle(restored);
  assert.equal(restored.get('free-test-0002').rows[0].status,'verified');assert.equal(f.events.filter(x=>x.startsWith('click:')).length,1);
});

test('legacy mode also leaves duplicate detection to the frontend plugin',async t=>{
  const f=fixture(t);f.collectionAdapter.lookup=async()=>({status:'needs-review',error:'查询未完成'});
  f.service.start(request);await idle(f.service);assert.equal(f.service.get(request.requestId).status,'completed');assert.equal(f.events.filter(x=>x.startsWith('click:')).length,2);
});

test('reconcile does not search or submit pending products',async t=>{
  const f=fixture(t);f.adapter.search=async()=>({status:'waiting-plugin',message:'检查插件'});
  f.service.start(request);await idle(f.service);const before=[...f.events];
  f.service.resume(request.requestId,{reconcileOnly:true});await idle(f.service);
  assert.deepEqual(f.events.slice(before.length),['account']);assert.equal(f.service.get(request.requestId).status,'paused');
});

test('binding drift, idempotency mismatch, invalid input and other busy tasks are rejected',async t=>{
  const f=fixture(t);f.adapter.search=async()=>({status:'waiting-verification',message:'等待验证'});
  assert.throws(()=>f.service.start({...request,limit:31}),/1—30/);
  f.service.start(request);await idle(f.service);
  assert.throws(()=>f.service.start({...request,keyword:'changed'}),/其他参数/);
  assert.throws(()=>f.service.start({...request,requestId:'free-test-0002'}),/未完成/);
  f.account.expectedAccount='changed';assert.throws(()=>f.service.resume(request.requestId),/绑定已变化/);
  f.service.stop(request.requestId);const busy=createFreeSourcing({...f.options,isOtherBusy:()=>true});assert.throws(()=>busy.start({...request,requestId:'free-test-0002'}),/正在运行/);
});

test('stop during search prevents plugin submission without a collection precheck',async t=>{
  const f=fixture(t);let release;f.adapter.search=()=>new Promise(resolve=>{release=resolve;});
  f.service.start(request);while(!release)await new Promise(r=>setTimeout(r,2));f.service.stop(request.requestId);release({status:'ready',products});await idle(f.service);
  assert.equal(f.events.filter(x=>x.startsWith('click:')).length,0);assert.equal(f.service.get(request.requestId).status,'paused');
});

test('only real Temu product links qualify and keywords are URL encoded',()=>{
  assert.equal(productIdentity(products[0].sourceUrl),'601105252678121');
  for(const url of ['https://temu.com.evil.test/item-g-601105252678121.html','https://user@www.temu.com/goods.html?goods_id=601105252678121','http://www.temu.com/goods.html?goods_id=601105252678121','https://www.temu.com/search_result.html?goods_id=601105252678121'])assert.equal(productIdentity(url),null);
  assert.equal(new URL(searchUrl('画 & 中文')).searchParams.get('search_key'),'画 & 中文');
});

test('captcha calls share one persisted task budget across search, product pages, resume, and restart',async t=>{
  const f=fixture(t),collect=f.adapter.collect;let sequence=0,charged=0;
  const solve=args=>{
    const gate=args.captchaPreflight();if(!gate.allowed)return {status:'waiting-verification',message:gate.message};
    const id=args.beforeCaptcha({type:'puzzle',fingerprint:(++sequence).toString(16).padStart(64,'0')});
    // The durable intent must exist before a request that could consume credits.
    const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'state.json'),'utf8')).jobs[request.requestId];
    assert.equal(saved.captcha.attempts.at(-1).id,id);assert.equal(saved.captcha.attempts.at(-1).status,'requesting');
    charged++;args.afterCaptcha(id,{status:'solved',durationMs:800,message:'测试验证已通过'});return null;
  };
  f.adapter.search=async args=>solve(args)||{status:'ready',products};
  f.adapter.collect=async args=>solve(args)||collect(args);
  f.service.start({...request,captchaMaxAttempts:2});await idle(f.service);
  let job=f.service.get(request.requestId);
  assert.equal(charged,2);assert.equal(job.status,'waiting-verification');assert.equal(job.captcha.attempts.length,2);
  assert.deepEqual(job.rows.map(r=>r.status),['verified','pending']);
  f.service.start({...request,captchaMaxAttempts:2});assert.equal(charged,2);
  assert.throws(()=>f.service.start({...request,captchaMaxAttempts:3}),/其他参数/);
  const restored=createFreeSourcing(f.options);restored.resume(request.requestId);await idle(restored);
  job=restored.get(request.requestId);assert.equal(charged,2);assert.equal(job.captcha.maxAttempts,2);assert.match(job.message,/上限/);
  assert.equal(f.events.filter(x=>x.startsWith('click:')).length,1);
});

test('the same challenge image is not requested again after an answered but rejected solution',async t=>{
  const f=fixture(t);let charged=0;
  f.adapter.search=async args=>{
    const id=args.beforeCaptcha({type:'puzzle',fingerprint:'a'.repeat(64)});charged++;
    args.afterCaptcha(id,{status:'answered',message:'已取得坐标'});
    args.afterCaptcha(id,{status:'not-passed',durationMs:900,message:'页面未放行'});
    return {status:'waiting-verification',message:'页面未放行'};
  };
  f.service.start({...request,captchaMaxAttempts:5});await idle(f.service);
  f.service.resume(request.requestId);await idle(f.service);
  const job=f.service.get(request.requestId);assert.equal(charged,1);assert.equal(job.captcha.attempts.length,1);assert.equal(job.captcha.attempts[0].status,'not-passed');assert.match(job.message,/未重复扣费/);
  assert.equal(f.events.filter(x=>x.startsWith('click:')).length,0);
});

test('requesting captcha becomes unknown on restart and cannot be retried even for a new image',async t=>{
  const f=fixture(t);let charged=0,sequence=0;
  f.adapter.search=async args=>{
    const gate=args.captchaPreflight();if(!gate.allowed)return {status:'waiting-verification',message:gate.message};
    args.beforeCaptcha({type:'temu-arced-slide',fingerprint:(++sequence).toString(16).padStart(64,'0')});charged++;
    throw new Error('fixture connection lost before billing response');
  };
  f.service.start({...request,captchaMaxAttempts:5});await idle(f.service);
  assert.equal(f.service.get(request.requestId).captcha.attempts[0].status,'requesting');
  const restored=createFreeSourcing(f.options);assert.equal(restored.get(request.requestId).captcha.attempts[0].status,'unknown');
  restored.resume(request.requestId);await idle(restored);
  assert.equal(charged,1);assert.equal(restored.get(request.requestId).captcha.attempts.length,1);assert.match(restored.get(request.requestId).message,/未知/);
  restored.resume(request.requestId,{reconcileOnly:true});await idle(restored);assert.equal(charged,1);
});

test('explicit unknown billing result prevents another request without requiring a restart',async t=>{
  const f=fixture(t);let charged=0;
  f.adapter.search=async args=>{
    const gate=args.captchaPreflight();if(!gate.allowed)return {status:'waiting-verification',message:gate.message};
    const id=args.beforeCaptcha({type:'puzzle',fingerprint:'c'.repeat(64)});charged++;
    args.afterCaptcha(id,{status:'unknown',code:'TIMEOUT',message:'响应超时，计费未知'});
    return {status:'waiting-verification',message:'响应超时'};
  };
  f.service.start(request);await idle(f.service);f.service.resume(request.requestId);await idle(f.service);
  assert.equal(charged,1);assert.equal(f.service.get(request.requestId).captcha.attempts[0].code,'TIMEOUT');assert.match(f.service.get(request.requestId).message,/未知/);
});

test('stop after a successful captcha preflight is checked again before the paid request intent',async t=>{
  const f=fixture(t);let release,charged=0;
  f.adapter.search=async args=>{
    assert.equal(args.captchaPreflight().allowed,true);
    await new Promise(resolve=>{release=resolve;});
    args.beforeCaptcha({type:'puzzle',fingerprint:'d'.repeat(64)});charged++;
    return {status:'ready',products};
  };
  f.service.start(request);while(!release)await new Promise(r=>setTimeout(r,2));
  f.service.stop(request.requestId);release();await idle(f.service);
  const job=f.service.get(request.requestId);assert.equal(charged,0);assert.equal(job.captcha.attempts.length,0);assert.equal(job.status,'paused');assert.match(job.message,/暂停/);
});

test('manual mode, absent key, unsupported challenge, and invalid budgets never consume a captcha request',async t=>{
  const f=fixture(t);let gate;
  f.adapter.search=async args=>{gate=args.captchaPreflight();return {status:'waiting-verification',message:gate.message||'需要验证'};};
  for(const budget of [-1,31,1.5,'invalid'])assert.throws(()=>f.service.start({...request,captchaMaxAttempts:budget}),/0—30/);
  f.service.start({...request,captchaMaxAttempts:0});await idle(f.service);assert.equal(gate.allowed,false);assert.match(gate.message,/未启用/);assert.equal(f.service.get(request.requestId).captcha.attempts.length,0);
  f.service.stop(request.requestId);delete f.options.configuration.SADCAPTCHA_API_KEY;
  f.service.start({...request,requestId:'free-test-no-key',captchaMaxAttempts:2});await idle(f.service);assert.equal(gate.allowed,false);assert.match(gate.message,/API Key/);
  f.service.stop('free-test-no-key');f.options.configuration.SADCAPTCHA_API_KEY='fixture-secret';
  f.adapter.search=async args=>{assert.throws(()=>args.beforeCaptcha({type:'unknown-type',fingerprint:'e'.repeat(64)}),/类型/);assert.throws(()=>args.beforeCaptcha({type:'puzzle',fingerprint:'invalid'}),/标识/);return {status:'waiting-verification',message:'暂不支持'};};
  f.service.start({...request,requestId:'free-test-unsupported'});await idle(f.service);assert.equal(f.service.get('free-test-unsupported').captcha.attempts.length,0);
});

test('legacy tasks without captcha settings recover in manual mode rather than acquire a new paid budget',async t=>{
  const f=fixture(t);f.adapter.search=async()=>({status:'waiting-verification',message:'legacy verification'});
  f.service.start(request);await idle(f.service);
  const file=path.join(f.directory,'state.json'),disk=JSON.parse(fs.readFileSync(file,'utf8'));delete disk.jobs[request.requestId].captcha;fs.writeFileSync(file,JSON.stringify(disk));
  let gate;f.adapter.search=async args=>{gate=args.captchaPreflight();return {status:'waiting-verification',message:gate.message};};
  const restored=createFreeSourcing(f.options);restored.resume(request.requestId);await idle(restored);
  assert.equal(restored.get(request.requestId).captcha.maxAttempts,0);assert.equal(gate.allowed,false);assert.equal(restored.get(request.requestId).captcha.attempts.length,0);
});

test('captcha detection failures persist separately from billing and remain after another pause or restart',async t=>{
  const f=fixture(t);
  f.adapter.search=async args=>{
    for(let i=0;i<25;i++)args.onCaptchaDiagnostic({code:'loading-images',type:'grid',probes:i+1,images:9,loadedImages:8,frames:0,shadowRoots:0,message:'fixture-secret',url:'https://example.invalid/?apiKey=fixture-secret',image:'fixture-secret'});
    args.onCaptchaDiagnostic({code:'untrusted-code',message:'fixture-secret'});
    return {status:'waiting-verification',message:'图片尚未加载'};
  };
  f.service.start(request);await idle(f.service);
  const job=f.service.get(request.requestId);
  assert.equal(job.status,'waiting-verification');assert.equal(job.captcha.attempts.length,0);
  assert.equal(job.captcha.diagnostics.length,20);assert.equal(job.captcha.diagnostics[0].probes,6);
  assert.equal(job.captcha.diagnostics.at(-1).stage,'search');assert.equal(job.captcha.diagnostics.at(-1).attemptsAtObservation,0);
  assert.ok(Number.isFinite(Date.parse(job.captcha.diagnostics.at(-1).observedAt)));
  const disk=fs.readFileSync(path.join(f.directory,'state.json'),'utf8');assert.equal(disk.includes('fixture-secret'),false);
  const restored=createFreeSourcing(f.options);
  assert.deepEqual(restored.get(request.requestId).captcha.diagnostics,job.captcha.diagnostics);
  f.adapter.search=async()=>({status:'ready',products});
  f.adapter.collect=async args=>{
    args.onCaptchaDiagnostic({code:'slider-blocked',type:'slider',probes:12,images:2,loadedImages:2,frames:0,shadowRoots:0});
    return {status:'waiting-plugin',message:'测试采集按钮不可用'};
  };
  restored.resume(request.requestId);await idle(restored);
  const after=restored.get(request.requestId),last=after.captcha.diagnostics.at(-1);
  assert.equal(after.status,'waiting-plugin');assert.equal(after.captcha.attempts.length,0);assert.equal(after.captcha.maxAttempts,2);
  assert.equal(after.captcha.diagnostics.length,20);assert.equal(last.stage,'product');assert.equal(last.goodsId,productIdentity(products[0].sourceUrl));
  assert.equal(f.events.some(event=>event.startsWith('click:')),false);
});

test('reading captcha status never queries the provider and explicit balance check queries once',async t=>{
  const f=fixture(t);let calls=0;
  const service=createFreeSourcing({...f.options,captchaClient:{credits:async()=>{calls++;return {credits:42};}}});
  assert.equal(service.captchaStatus().configured,true);service.captchaStatus();assert.equal(calls,0);
  const balance=await service.checkCaptcha();assert.equal(balance.credits,42);assert.equal(calls,1);
  assert.equal(service.captchaStatus().credits,42);assert.equal(calls,1);
  f.options.configuration.SADCAPTCHA_API_KEY='replacement-fixture-secret';assert.equal(service.captchaStatus().credits,null);assert.equal(calls,1);
});


test('thirty products and captcha attempts complete in order and are not replayed',async t=>{
  const f=fixture(t),collect=f.adapter.collect;
  const thirty=Array.from({length:30},(_,i)=>({sourceUrl:`https://www.temu.com/fixture-g-${601105252678100+i}.html`,title:`Product ${i+1}`}));
  f.adapter.search=async()=>({status:'ready',products:thirty});
  f.adapter.collect=async args=>{
    assert.equal(args.captchaPreflight().allowed,true);
    const id=args.beforeCaptcha({type:'puzzle',fingerprint:args.goodsId.padStart(64,'0')});
    args.afterCaptcha(id,{status:'solved',message:'Fixture only'});
    return collect(args);
  };
  f.service.start({...request,limit:30,captchaMaxAttempts:30});await idle(f.service);
  const job=f.service.get(request.requestId);
  assert.equal(job.status,'completed');assert.equal(job.rows.length,30);
  assert.equal(job.captcha.attempts.length,30);
  assert.deepEqual(job.rows.map(r=>r.sourceUrl),thirty.map(p=>p.sourceUrl));
  assert.ok(job.rows.every(r=>r.status==='verified'));
  assert.equal(f.events.filter(e=>e.startsWith('click:')).length,30);
  f.service.resume(request.requestId);
  assert.equal(f.events.filter(e=>e.startsWith('click:')).length,30);
});

test('a post-click challenge is resolved on resume without replaying collection or billing during reconcile',async t=>{
  const f=fixture(t);let solves=0;
  f.adapter.collect=async args=>{args.beforeSubmit();f.events.push('click:'+args.goodsId);return {status:'waiting-verification',message:'Post-click challenge'};};
  f.adapter.verifyChallenge=async args=>{solves++;const id=args.beforeCaptcha({type:'temu-three-by-three',fingerprint:'c'.repeat(64)});args.afterCaptcha(id,{status:'solved',message:'Fixture only'});f.saved.add(args.goodsId);return {status:'ready'};};
  f.service.start({...request,limit:1});await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'needs-review');
  f.service.resume(request.requestId,{reconcileOnly:true});await idle(f.service);assert.equal(solves,0);
  f.service.resume(request.requestId);await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'completed');assert.equal(solves,1);
  assert.equal(f.events.filter(e=>e.startsWith('click:')).length,1);
});

test('explicit one-time recovery keeps original intent and requires fresh confirmed absence',async t=>{
  const f=fixture(t),normal=f.adapter.collect;
  f.adapter.collect=async args=>{args.beforeSubmit();f.events.push('click:'+args.goodsId);throw new Error('Collection outcome unconfirmed');};
  f.service.start({...request,limit:1});await idle(f.service);
  const original=f.service.get(request.requestId).rows[0],goodsId=original.goodsId;
  f.adapter.collect=normal;f.collectionAdapter.lookup=async()=>({status:'needs-review',error:'Query uncertain'});
  f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId});await idle(f.service);
  assert.equal(f.events.filter(e=>e.startsWith('click:')).length,1);
  f.collectionAdapter.lookup=async()=>({status:'absent'});
  f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId});await idle(f.service);
  const job=f.service.get(request.requestId);assert.equal(job.status,'completed');
  assert.equal(job.rows[0].submittedAt,original.submittedAt);assert.equal(job.rows[0].retryHistory.length,1);
  assert.equal(f.events.filter(e=>e.startsWith('click:')).length,2);
});

test('explicit deferral processes remaining products without replaying or counting an unresolved submission',async t=>{
  const f=fixture(t),normal=f.adapter.collect,firstId=productIdentity(products[0].sourceUrl);
  f.adapter.collect=async args=>{if(args.goodsId!==firstId)return normal(args);args.beforeSubmit();f.events.push('click:'+args.goodsId);return {status:'submitted'};};
  f.service.start(request);await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'needs-review');
  assert.throws(()=>f.service.resume(request.requestId,{deferGoodsIds:[productIdentity(products[1].sourceUrl)]}),/不能跳过未提交/);
  f.service.resume(request.requestId,{deferGoodsIds:[firstId]});await idle(f.service);
  let job=f.service.get(request.requestId);
  assert.equal(job.status,'needs-review');assert.deepEqual(job.rows.map(r=>r.status),['needs-review','verified']);
  assert.match(job.message,/已确认 1 件.*另有 1 件/);
  assert.equal(f.events.filter(x=>x==='click:'+firstId).length,1);
  f.saved.add(firstId);f.service.resume(request.requestId,{reconcileOnly:true});await idle(f.service);
  job=f.service.get(request.requestId);assert.equal(job.status,'completed');
  assert.equal(f.events.filter(x=>x.startsWith('click:')).length,2);
});

for(const found of [true,false])test(found?'a post-click plugin timeout reads the confirmed collection record without replaying the click':'a post-click plugin timeout with no record remains unconfirmed and cannot replay the click',async t=>{
  const f=fixture(t);let challengeReads=0;
  f.adapter.verifyChallenge=async()=>{challengeReads++;throw new Error('timeout recovery must only read the collection box');};
  f.adapter.collect=async args=>{
    args.beforeSubmit();f.events.push('click:'+args.goodsId);
    if(found)f.saved.add(args.goodsId);
    return {status:'needs-review',pluginStatus:'pending',message:'Fixture plugin receipt timed out'};
  };
  f.service.start({...request,limit:1});await idle(f.service);
  const job=f.service.get(request.requestId),row=job.rows[0];
  assert.equal(job.status,found?'completed':'needs-review');assert.equal(row.status,found?'verified':'needs-review');
  assert.ok(row.submittedAt);assert.ok(row.checkedAt);assert.equal(challengeReads,0);
  assert.equal(f.events.filter(event=>event==='click:'+row.goodsId).length,1);
  assert.equal(f.events.filter(event=>event==='verify:'+row.goodsId).length,1);
  assert.equal(job.captcha.attempts.length,0);
  f.service.resume(request.requestId,{reconcileOnly:true});await idle(f.service);
  assert.equal(f.events.filter(event=>event==='click:'+row.goodsId).length,1);assert.equal(challengeReads,0);
  assert.equal(f.service.get(request.requestId).status,found?'completed':'needs-review');
});

test('a failed explicit retry cannot be repeated in the same process or after restart',async t=>{
  const f=fixture(t);
  f.adapter.collect=async args=>{args.beforeSubmit();f.events.push('click:'+args.goodsId);throw new Error('Fixture receipt remains unknown');};
  f.service.start({...request,limit:1});await idle(f.service);
  const original=f.service.get(request.requestId).rows[0],goodsId=original.goodsId;
  f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId});await idle(f.service);
  const retried=f.service.get(request.requestId);
  assert.equal(retried.status,'needs-review');assert.equal(retried.rows[0].submittedAt,original.submittedAt);
  assert.equal(retried.rows[0].retryHistory.length,1);assert.equal(f.events.filter(event=>event==='click:'+goodsId).length,2);
  assert.throws(()=>f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId}),/恢复次数已用完/);
  const restored=createFreeSourcing(f.options);
  assert.equal(restored.get(request.requestId).rows[0].retryHistory.length,1);
  assert.throws(()=>restored.resume(request.requestId,{retrySubmittedGoodsId:goodsId}),/恢复次数已用完/);
  restored.stop(request.requestId);
  const nextId='free-test-retry-new';
  restored.start({...request,requestId:nextId,limit:1});await idle(restored);
  const reused=restored.get(nextId).rows[0];
  assert.equal(reused.reusedSubmission,true);assert.equal(reused.submittedAt,original.submittedAt);assert.equal(reused.retryHistory.length,1);
  assert.throws(()=>restored.resume(nextId,{retrySubmittedGoodsId:goodsId}),/恢复次数已用完/);
  assert.equal(f.events.filter(event=>event==='click:'+goodsId).length,2);
});

test('an unavailable product is retained without submission while remaining products continue',async t=>{
  const f=fixture(t),normal=f.adapter.collect,firstId=productIdentity(products[0].sourceUrl);
  f.adapter.collect=async args=>args.goodsId===firstId?{status:'unavailable',message:'此商品已售罄。',url:args.sourceUrl}:normal(args);
  f.service.start(request);await idle(f.service);
  const job=f.service.get(request.requestId);
  assert.equal(job.status,'paused');assert.deepEqual(job.rows.map(row=>row.status),['unavailable','verified']);assert.match(job.message,/尚缺 1 件/);
  assert.equal(job.rows[0].submittedAt,undefined);assert.equal(job.rows[0].sourceUrl,products[0].sourceUrl);
  assert.equal(f.events.filter(event=>event==='click:'+firstId).length,0);
  assert.equal(f.events.filter(event=>event.startsWith('click:')).length,1);
});

test('explicit unavailable recovery preserves the page observation and processes only unsubmitted unavailable rows',async t=>{
  const f=fixture(t),normal=f.adapter.collect,firstId=productIdentity(products[0].sourceUrl),calls=[];
  let recovered=false;
  f.adapter.collect=async args=>{
    calls.push({goodsId:args.goodsId,keyword:args.keyword,limit:args.limit});
    if(args.goodsId===firstId&&!recovered)return {status:'unavailable',message:'此商品已售罄。',url:args.sourceUrl,evidence:{detailState:'sold-out-fixture'}};
    if(args.goodsId===firstId){
      const persisted=JSON.parse(fs.readFileSync(path.join(f.directory,'state.json'),'utf8')).jobs[request.requestId].rows[0];
      assert.equal(persisted.submittedAt,undefined);assert.equal(persisted.pageObservations.length,1);
      assert.equal(persisted.error,null);assert.equal(persisted.evidence,undefined);
    }
    return normal(args);
  };
  f.service.start(request);await idle(f.service);
  const prior=f.service.get(request.requestId).rows[0];
  assert.equal(prior.status,'unavailable');assert.equal(prior.submittedAt,undefined);
  f.service.resume(request.requestId);await idle(f.service);
  assert.equal(calls.length,2,'ordinary resume must retain unavailable observations');
  assert.throws(()=>f.service.resume(request.requestId,{reconcileOnly:true,retryUnavailable:true}),/恢复商品入口参数无效/);
  recovered=true;f.service.resume(request.requestId,{retryUnavailable:true});await idle(f.service);
  const job=f.service.get(request.requestId),row=job.rows[0];
  assert.equal(job.status,'completed');assert.ok(job.rows.every(item=>item.status==='verified'));
  assert.deepEqual(row.pageObservations,[{checkedAt:prior.checkedAt,status:'unavailable',error:prior.error,evidence:prior.evidence}]);
  assert.deepEqual(calls.map(call=>call.goodsId),[firstId,productIdentity(products[1].sourceUrl),firstId]);
  assert.ok(calls.every(call=>call.keyword===request.keyword&&call.limit===request.limit));
  assert.equal(f.events.filter(event=>event.startsWith('click:')).length,2);
});

test('search-entry recovery adds at most one retry after the default retry and keeps the cap through restart and task reuse',async t=>{
  const f=fixture(t),calls=[],order=[];let lookupStatus='absent';
  f.collectionAdapter.lookup=async args=>{
    assert.equal(args.keyword,request.keyword);assert.equal(args.limit,1);
    order.push('lookup:'+lookupStatus);return {status:lookupStatus,error:lookupStatus==='absent'?null:'Fixture query uncertain'};
  };
  f.adapter.collect=async args=>{
    if(args.submittedAt)assert.equal(order.at(-1),'lookup:absent','every explicitly retried click requires a new confirmed empty query');
    else assert.equal(order.length,0,'ordinary first click has no duplicate lookup');
    calls.push({goodsId:args.goodsId,keyword:args.keyword,limit:args.limit,forceSearch:args.forceSearch});
    args.beforeSubmit();order.push('click');f.events.push('click:'+args.goodsId);
    throw new Error('Fixture receipt remains unknown');
  };
  f.service.start({...request,limit:1});await idle(f.service);
  const original=f.service.get(request.requestId).rows[0],goodsId=original.goodsId;
  f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId});await idle(f.service);
  assert.equal(f.service.get(request.requestId).rows[0].retryHistory.length,1);
  assert.throws(()=>f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId}),/恢复次数已用完/);
  lookupStatus='needs-review';
  f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId,reopenFromSearch:true});await idle(f.service);
  assert.equal(calls.length,2);assert.equal(f.service.get(request.requestId).rows[0].retryHistory.length,1);
  lookupStatus='absent';
  f.service.resume(request.requestId,{retrySubmittedGoodsId:goodsId,reopenFromSearch:true});await idle(f.service);
  const retried=f.service.get(request.requestId).rows[0];
  assert.equal(retried.submittedAt,original.submittedAt);assert.equal(retried.retryHistory.length,2);
  assert.ok(retried.retryHistory.every(item=>item.originalSubmittedAt===original.submittedAt));
  assert.deepEqual(calls.map(call=>call.forceSearch),[false,true,true]);
  assert.ok(calls.every(call=>call.keyword===request.keyword&&call.limit===1));
  const retry={retrySubmittedGoodsId:goodsId,reopenFromSearch:true};
  assert.throws(()=>f.service.resume(request.requestId,retry),/恢复次数已用完/);
  const restored=createFreeSourcing(f.options);
  assert.throws(()=>restored.resume(request.requestId,retry),/恢复次数已用完/);
  restored.stop(request.requestId);
  const nextId='free-search-retry-new';restored.start({...request,requestId:nextId,limit:1});await idle(restored);
  const inherited=restored.get(nextId).rows[0];
  assert.equal(inherited.reusedSubmission,true);assert.equal(inherited.submittedAt,original.submittedAt);assert.equal(inherited.retryHistory.length,2);
  assert.throws(()=>restored.resume(nextId,retry),/恢复次数已用完/);
  assert.equal(calls.length,3);assert.equal(f.events.filter(event=>event==='click:'+goodsId).length,3);
});
