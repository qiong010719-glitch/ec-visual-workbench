import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createErpService} from '../src/erp.mjs';
import {createWorkbench} from '../src/server.mjs';
import {createSettings} from '../src/settings.mjs';
import {connectionStatus} from '../../scripts/lib/miaoshou-connection.mjs';

function configureFixture(preferences){
  // Keep these tests independent of the user's legacy config and browser login.
  return preferences.update({revision:preferences.view().revision,
    browsers:[{key:'fixture-browser',type:'chrome',name:'ERP 测试专用浏览器',debugPort:9388}],
    erpConnections:[{key:'fixture-erp',provider:'dianxiaomi',name:'ERP 测试连接',browserKey:'fixture-browser',expectedAccount:'fixture-account'}],
    stores:[1,2].map(number=>({key:`store${number}-ca`,platform:'temu',expectedStore:`店铺${number}测试`,expectedSite:'加拿大站',erpKey:'fixture-erp',templates:[{key:'fixture-mother',name:'测试母稿',draftId:String(123456789+number)}]}))
  });
}

async function fixture(t,adapter){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'erp-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const media=path.join(dir,'media');fs.mkdirSync(media);
  for(let i=0;i<3;i++)await sharp({create:{width:80,height:100,channels:3,background:{r:i*80,g:60,b:100}}}).png().toFile(path.join(media,`sample-${i}.png`));
  const store={state:{drafts:[{id:'draft1',title:'测试画',platform:'temu',images:['/media/sample-0.png','/media/sample-1.png','/media/sample-2.png']}]}};
  // Persist once, then let each service instance reload from disk. Several
  // recovery tests intentionally modify this file before recreating the service.
  configureFixture(createSettings({directory:path.join(dir,'erp/preferences'),configuration:{},legacyDirectory:null}));
  const options={directory:path.join(dir,'erp'),mediaDirectory:media,store,multisets:{list:()=>[],get:()=>({source:{platform:'temu'},sets:[{images:[{task:{status:'failed'}}]}]})},adapter};
  const service=createErpService(options),preview=await service.importGenerated({draftId:'draft1'}),cfg=service.settings();
  const payload={previewId:preview.id,storeKey:cfg.stores[1].key,browserKey:cfg.browsers[0].key,rows:preview.rows.map(r=>({...r,englishTitle:'Canvas art',imageIds:preview.folders[0].images.map(i=>i.id)}))};
  return {service,preview,payload,dir,options,media};
}
async function terminal(service,id){for(let i=0;i<100;i++){const b=service.get(id);if(b.status!=='running')return b;await new Promise(r=>setTimeout(r,10));}throw new Error('test timed out');}

test('Miaoshou tab detection never claims authentication or accepts lookalike domains',()=>{
  const status=connectionStatus([{type:'page',url:'https://erp.91miaoshou.com/'}],{key:'browser-a'});
  assert.equal(status.erpOpen,true);assert.equal(status.loggedIn,null);assert.equal(status.accountMatched,null);assert.equal(status.listingReady,false);
  for(const url of ['https://erp.91miaoshou.com.evil.example/','https://evil.example/?erp.91miaoshou.com','https://www.dianxiaomi.com/','http://erp.91miaoshou.com/','invalid'])assert.equal(connectionStatus([{type:'page',url}],{key:'browser-a'}).erpOpen,false);
});

test('unsupported ERP cannot fall through to the Temu writer after restart or hand-edited settings',async t=>{
  let writes=0;const f=await fixture(t,{runDraft:async()=>{writes++;return {draftId:'123456789'};}});
  const b=f.service.prepare(f.payload),file=path.join(f.dir,'erp/preferences/settings.json'),settings=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const e of settings.erpConnections)e.provider='miaoshou';fs.writeFileSync(file,JSON.stringify(settings));
  const restarted=createErpService(f.options);
  assert.throws(()=>restarted.prepare(f.payload),/妙手 ERP 的自动上架尚未接入/);
  assert.throws(()=>restarted.start(b.id),/妙手 ERP 的自动上架尚未接入/);
  assert.equal(writes,0);assert.equal(restarted.get(b.id).status,'ready');
});

test('draft mode never publishes; publish mode saves once then obtains an explicit receipt',async t=>{
  const calls=[];const f=await fixture(t,{runDraft:async()=>{calls.push('save');return {draftId:'123456789',verifiedAt:new Date().toISOString()};},publishDraft:async({onProgress})=>{calls.push('publish');onProgress('publishing',{publicationAttemptedAt:new Date().toISOString()});return {publicationStatus:'submitted',published:false};}});
  const draft=f.service.prepare(f.payload);f.service.start(draft.id);await terminal(f.service,draft.id);assert.deepEqual(calls,['save']);
  const payload=structuredClone(f.payload);payload.executionMode='publish';payload.rows[0].productCode='PUBLISH-1';
  const b=f.service.prepare(payload);f.service.start(b.id);const result=await terminal(f.service,b.id);assert.equal(result.rows[0].status,'submitted');assert.equal(result.published,false);assert.deepEqual(calls,['save','save','publish']);
  f.service.start(b.id);assert.deepEqual(calls,['save','save','publish']);
});
test('ambiguous publication blocks retry and restart; readback cannot infer failure from missing product',async t=>{
  let writes=0,publishes=0,status='unknown';const f=await fixture(t,{runDraft:async()=>{writes++;return {draftId:'123456789',verifiedAt:new Date().toISOString()};},publishDraft:async({onProgress})=>{publishes++;onProgress('publishing',{publicationAttemptedAt:new Date().toISOString()});throw new Error('disconnected after publication');},checkPublication:async()=>({publicationStatus:status,published:false})});
  const b=f.service.prepare({...f.payload,executionMode:'publish'});f.service.start(b.id);assert.equal((await terminal(f.service,b.id)).rows[0].status,'publication-unknown');
  const restarted=createErpService(f.options);assert.throws(()=>restarted.start(b.id),/发布结果待核对/);
  await restarted.publicationStatus(b.id,{rowId:b.rows[0].rowId});assert.throws(()=>restarted.start(b.id),/发布结果待核对/);
  status='draft';await restarted.publicationStatus(b.id,{rowId:b.rows[0].rowId});assert.throws(()=>restarted.start(b.id),/发布结果待核对/);
  status='submitted';assert.equal((await restarted.publicationStatus(b.id,{rowId:b.rows[0].rowId})).status,'completed');restarted.start(b.id);assert.equal(writes,1);assert.equal(publishes,1);
});
test('explicit publication failure retries the same draft only after a fresh content check',async t=>{
  let writes=0,publishes=0,reads=0;const f=await fixture(t,{runDraft:async()=>{writes++;return {draftId:'123456789',verifiedAt:new Date().toISOString()};},publishDraft:async({onProgress})=>{onProgress('publishing',{publicationAttemptedAt:new Date().toISOString()});return {publicationStatus:++publishes===1?'failed':'submitted',error:publishes===1?'price required':null};},reconcileDraft:async({draftId})=>{reads++;return {draftId,verifiedAt:new Date().toISOString()};}});
  const b=f.service.prepare({...f.payload,executionMode:'publish'});f.service.start(b.id);assert.equal((await terminal(f.service,b.id)).rows[0].status,'publication-failed');
  f.service.start(b.id);assert.equal((await terminal(f.service,b.id)).status,'completed');assert.equal(writes,1);assert.equal(reads,1);assert.equal(publishes,2);
});

test('manual publication recovery clears stale errors and resumes only the remaining product after restart',async t=>{
  const writes=[],publishes=[];let resolved=false;
  const f=await fixture(t,{runDraft:async({row})=>{writes.push(row.productCode);return {draftId:row.productCode==='FIRST'?'220114595121490272':'220114595121490273',verifiedAt:new Date().toISOString()};},publishDraft:async({row,onProgress})=>{publishes.push(row.productCode);onProgress('publishing',{publicationAttemptedAt:new Date().toISOString()});if(row.productCode==='FIRST')throw new Error('lost publication receipt');return {publicationStatus:'submitted',published:false};},checkPublication:async()=>({publicationStatus:resolved?'listed':'unknown',published:false,erpState:resolved?'online':null})});
  const preview=await f.service.makePreview({label:'two products',rows:[{rowId:'first',productCode:'FIRST',title:'First',folder:'shared'},{rowId:'second',productCode:'SECOND',title:'Second',folder:'shared'}],folders:[{name:'shared',files:[path.join(f.media,'sample-0.png')]}]});
  const payload={...f.payload,previewId:preview.id,executionMode:'publish',rows:preview.rows.map(r=>({...r,englishTitle:r.title,imageIds:[preview.folders[0].images[0].id]}))};
  const b=f.service.prepare(payload);f.service.start(b.id);assert.equal((await terminal(f.service,b.id)).rows[0].status,'publication-unknown');
  await f.service.publicationStatus(b.id,{rowId:'first'});assert.throws(()=>f.service.start(b.id),/发布结果待核对/);
  resolved=true;const recovered=await f.service.publicationStatus(b.id,{rowId:'first'});
  assert.equal(recovered.error,null);assert.equal(recovered.rows[0].error,null);assert.equal(recovered.rows[0].status,'listed');assert.equal(recovered.rows[1].status,'pending');assert.equal(recovered.status,'paused');
  const restarted=createErpService(f.options);restarted.start(b.id);assert.equal((await terminal(restarted,b.id)).status,'completed');
  assert.deepEqual(writes,['FIRST','SECOND']);assert.deepEqual(publishes,['FIRST','SECOND']);
});

test('online readback during submission finishes without forcing a second submission',async t=>{
  let publishes=0;const f=await fixture(t,{runDraft:async()=>({draftId:'220114595121490272',verifiedAt:new Date().toISOString()}),publishDraft:async({onProgress})=>{publishes++;onProgress('publishing',{publicationAttemptedAt:new Date().toISOString()});return {publicationStatus:'listed',published:false};}});
  const b=f.service.prepare({...f.payload,executionMode:'publish'});f.service.start(b.id);const result=await terminal(f.service,b.id);
  assert.equal(result.status,'completed');assert.equal(result.rows[0].status,'listed');f.service.start(b.id);assert.equal(publishes,1);
});

test('ERP import snapshots images and preserves explicit order without editing source files',async t=>{
  const f=await fixture(t);const source=fs.readFileSync(path.join(f.media,'sample-0.png'));
  f.payload.rows[0].imageIds.reverse();const batch=f.service.prepare(f.payload);
  assert.deepEqual(batch.rows[0].images.map(i=>i.id),f.payload.rows[0].imageIds);assert.equal(batch.published,false);
  assert.equal(batch.store.expectedStore,'店铺2测试');assert.equal(batch.rows[0].sku,batch.rows[0].productCode+'-SKU1');
  assert.deepEqual(fs.readFileSync(path.join(f.media,'sample-0.png')),source);
  assert.ok(batch.rows[0].images.every(i=>!('file' in i)&&i.url.startsWith('/api/temu/erp/images/')));
  await assert.rejects(f.service.importGenerated({groupId:'unfinished'}),/尚有图片未完成/);
});
test('ERP refuses unknown stores, missing English titles, folder mismatches and cross-folder image IDs',async t=>{
  const f=await fixture(t);assert.throws(()=>f.service.prepare({...f.payload,storeKey:'wrong'}),/店铺/);
  const p=structuredClone(f.payload);p.rows[0].englishTitle='';assert.throws(()=>f.service.prepare(p),/英文标题/);
  p.rows[0].englishTitle='Art';p.rows[0].folder='wrong';assert.throws(()=>f.service.prepare(p),/文件夹/);
  p.rows[0].folder=f.payload.rows[0].folder;p.rows[0].imageIds=['other'];assert.throws(()=>f.service.prepare(p),/不属于/);
});
test('identical prepare/start and restart do not duplicate an already verified draft',async t=>{
  let calls=0;const f=await fixture(t,{runDraft:async()=>{calls++;await new Promise(r=>setTimeout(r,25));return {draftId:'123',url:'https://www.dianxiaomi.com/web/popTemu/edit?id=123'};}});
  const b=f.service.prepare(f.payload);assert.equal(f.service.prepare(f.payload).id,b.id);
  f.service.start(b.id);f.service.start(b.id);assert.equal((await terminal(f.service,b.id)).status,'completed');
  const restarted=createErpService(f.options);restarted.start(b.id);assert.equal(calls,1);
  const changed=structuredClone(f.payload);changed.rows[0].title='Changed';assert.throws(()=>restarted.prepare(changed),/已有执行记录/);
});
test('unknown save result is journaled and cannot be automatically retried',async t=>{
  let calls=0;const f=await fixture(t,{runDraft:async({onProgress})=>{calls++;onProgress('saving');throw new Error('Disconnected after Save');}});
  const b=f.service.prepare(f.payload);f.service.start(b.id);const failed=await terminal(f.service,b.id);
  assert.equal(failed.rows[0].status,'needs-review');assert.throws(()=>f.service.start(b.id),/待核对/);
  const restarted=createErpService(f.options);assert.throws(()=>restarted.start(b.id),/待核对/);assert.equal(calls,1);
});

test('continue stays locked until session cleanup ends; a persisted cleanup flag does not block restart',async t=>{
  let release,calls=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,{createDraftSession:async()=>({close:()=>gate}),runDraft:async()=>{calls++;throw new Error('fixture wait failed');}});
  const b=f.service.prepare(f.payload);f.service.start(b.id);await terminal(f.service,b.id);
  assert.equal(f.service.get(b.id).cleaningUp,true);f.service.start(b.id);assert.equal(calls,1);
  release();while(f.service.isBusy())await new Promise(r=>setTimeout(r,5));assert.equal(f.service.get(b.id).cleaningUp,false);
  const file=path.join(f.dir,'erp/state.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));state.batches[b.id].cleaningUp=true;fs.writeFileSync(file,JSON.stringify(state));
  const restarted=createErpService(f.options);assert.equal(restarted.get(b.id).cleaningUp,false);restarted.start(b.id);await terminal(restarted,b.id);assert.equal(calls,2);
});

test('ambiguous save can be reconciled only by a successful readback, with no second write',async t=>{
  let writes=0,reads=0;const f=await fixture(t,{runDraft:async({onProgress})=>{writes++;onProgress('saving');throw new Error('save disconnected');},reconcileDraft:async({draftId})=>{reads++;if(draftId!=='123456789')throw new Error('snapshot mismatch');return {draftId,published:false};}});
  const b=f.service.prepare(f.payload);f.service.start(b.id);await terminal(f.service,b.id);
  await assert.rejects(f.service.reconcile(b.id,{rowId:b.rows[0].rowId,draftId:'987654321'}),/mismatch/);assert.equal(f.service.get(b.id).rows[0].status,'needs-review');
  const result=await f.service.reconcile(b.id,{rowId:b.rows[0].rowId,draftId:'123456789'});assert.equal(result.status,'completed');f.service.start(b.id);assert.equal(writes,1);assert.equal(reads,2);
});
test('pre-save failure can resume, and changed execution images block submission',async t=>{
  let calls=0;const f=await fixture(t,{runDraft:async()=>{if(++calls===1)throw new Error('Page missing before save');return {draftId:'456'};}});
  const b=f.service.prepare(f.payload);f.service.start(b.id);assert.equal((await terminal(f.service,b.id)).rows[0].status,'failed');
  f.service.start(b.id);const recovered=await terminal(f.service,b.id);assert.equal(recovered.status,'completed');assert.equal(recovered.rows[0].error,null);assert.equal(calls,2);
  const p=structuredClone(f.payload);p.rows[0].productCode='different';const next=f.service.prepare(p);
  fs.appendFileSync(f.service.image(f.preview.id,f.preview.folders[0].images[0].id),'changed');
  assert.throws(()=>f.service.start(next.id),/图片发生变化/);assert.equal(calls,2);
});

test('three-item batch shares a session; retry skips the completed first item and preserves precise failure details',async t=>{
  const calls=[],sessions=[];let failSecond=true;
  const f=await fixture(t,{
    createDraftSession:async()=>{const session={closed:false,async close(){this.closed=true;}};sessions.push(session);return session;},
    runDraft:async({row,onProgress,draftSession})=>{
      assert.equal(draftSession,sessions.at(-1));calls.push(row.productCode);
      onProgress('description',{step:'将主图写入详情'});
      if(row.productCode==='SECOND'&&failSecond)throw Object.assign(new Error('第二张详情图反馈超时'),{step:'将主图写入详情',waitLabel:'第 2 张详情图选中反馈',waitMs:20000});
      onProgress('saving');return {draftId:'12345678'+calls.length,verifiedAt:new Date().toISOString()};
    }
  });
  const preview=await f.service.makePreview({label:'three products',rows:['FIRST','SECOND','THIRD'].map((code,i)=>({rowId:'r'+i,productCode:code,title:code,folder:'shared'})),folders:[{name:'shared',files:[path.join(f.media,'sample-0.png')]}]});
  const batch=f.service.prepare({...f.payload,previewId:preview.id,rows:preview.rows.map(r=>({...r,englishTitle:r.title,imageIds:[preview.folders[0].images[0].id]}))});
  f.service.start(batch.id);f.service.start(batch.id);await terminal(f.service,batch.id);
  while(f.service.isBusy())await new Promise(r=>setTimeout(r,5));
  const failed=f.service.get(batch.id);assert.deepEqual(failed.rows.map(r=>r.status),['verified','failed','pending']);
  assert.equal(failed.rows[1].errorDetails.waitLabel,'第 2 张详情图选中反馈');assert.equal(sessions.length,1);assert.ok(sessions[0].closed);
  failSecond=false;f.service.start(batch.id);await terminal(f.service,batch.id);
  while(f.service.isBusy())await new Promise(r=>setTimeout(r,5));
  assert.equal(f.service.get(batch.id).status,'completed');assert.deepEqual(calls,['FIRST','SECOND','SECOND','THIRD']);assert.equal(sessions.length,2);assert.ok(sessions.every(s=>s.closed));
});

test('unlocking a rejected save requires positive ERP evidence, never just an absent draft ID',async t=>{
  let checked=false;const f=await fixture(t,{runDraft:async({onProgress})=>{onProgress('saving');throw new Error('no success signal');},checkRejectedDraft:async()=>({confirmedNotSaved:checked,reason:'Live form has too few images and complete pending list contains no matching SKU'})});
  const b=f.service.prepare(f.payload);f.service.start(b.id);await terminal(f.service,b.id);
  await assert.rejects(f.service.reconcile(b.id,{rowId:b.rows[0].rowId,checkNotSaved:true}),/足够证据/);
  assert.equal(f.service.get(b.id).rows[0].status,'needs-review');assert.throws(()=>f.service.start(b.id),/待核对/);
  checked=true;const result=await f.service.reconcile(b.id,{rowId:b.rows[0].rowId,checkNotSaved:true});
  assert.equal(result.rows[0].status,'failed');assert.equal(result.rows[0].saveRejection.confirmedNotSaved,true);
});
test('restart marks interrupted saves for review rather than enqueueing them',async t=>{
  const f=await fixture(t);const b=f.service.prepare(f.payload);const file=path.join(f.dir,'erp/state.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));
  state.batches[b.id].status='running';state.batches[b.id].rows[0].status='saving';fs.writeFileSync(file,JSON.stringify(state));
  const restarted=createErpService(f.options);assert.equal(restarted.get(b.id).status,'interrupted');assert.equal(restarted.get(b.id).rows[0].status,'needs-review');assert.throws(()=>restarted.start(b.id),/待核对/);
});

test('two generated Temu sets reach the selected store as two independent draft jobs',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'erp-generation-')),writes=[];
  const png=await sharp({create:{width:120,height:160,channels:3,background:'#abcdee'}}).png().toBuffer();
  const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},provider:async()=>png,erpAdapter:{runDraft:async({store,row,onProgress})=>{
    writes.push({store:store.key,code:row.productCode,images:row.images.map(i=>i.id)});onProgress('saving');
    return {draftId:'TEST-'+row.productCode,published:false,sourceUnchanged:true};
  }}});
  configureFixture(app.preferences);
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  const api=async(route,payload)=>{const r=await fetch(base+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
  const wait=async(route,predicate)=>{for(let i=0;i<400;i++){const data=await api(route);if(predicate(data))return data;await new Promise(r=>setTimeout(r,20));}throw new Error('Integration task timed out');};
  const group=await api('/api/temu/multisets',{request_id:'erp-integration',count:2,variation:'both',source:{platform:'temu',design_scope:'temu_main',product_name:'帆布装饰画',product_desc:'单幅帆布画',image_ratio:'1:1',image_count:2,generation_mode:'fast',visual_style:'scene_advertising',target_lang:'English',categorized_images:[{filename:'产品主体图.png',url:app.saveImage(png)}]}});
  const route='/api/temu/multisets/'+group.id;
  await wait(route,g=>g.recommendation.status==='completed');await api(route+'/plan',{});
  await wait(route,g=>g.sets.every(s=>s.planning.status==='completed'));await api(route+'/generate',{});
  await wait(route,g=>g.sets.every(s=>s.images.every(i=>i.task?.status==='completed')));
  const preview=await api('/api/temu/erp/import-generated',{groupId:group.id}),cfg=await api('/api/temu/erp/config');
  assert.equal(preview.rows.length,2);assert.ok(preview.folders.every(f=>f.images.length===2));
  const batch=await api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'store2-ca',browserKey:cfg.browsers[0].key,rows:preview.rows.map((r,i)=>({...r,englishTitle:'Canvas art set '+(i+1)}))});
  await api('/api/temu/erp/batches/'+batch.id+'/start',{});
  const result=await wait('/api/temu/erp/batches/'+batch.id,b=>b.status!=='running');
  assert.equal(result.status,'completed');assert.equal(writes.length,2);assert.ok(writes.every(w=>w.store==='store2-ca'));
  assert.equal(new Set(writes.map(w=>w.code)).size,2);assert.equal(new Set(writes.flatMap(w=>w.images)).size,4);
  await api('/api/temu/erp/batches/'+batch.id+'/start',{});assert.equal(writes.length,2);
  const missing=await fetch(base+'/api/temu/erp/images/missing/missing');assert.equal(missing.status,404);assert.match(missing.headers.get('content-type'),/json/);
});
