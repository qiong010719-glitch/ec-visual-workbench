import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createFreeSourcing} from '../src/free-sourcing.mjs';
import {createWorkbench} from '../src/server.mjs';

const sourceUrl='https://www.temu.com/fixture-g-601105252678121.html';
const request={requestId:'plugin-preflight-fixture',erpKey:'erp-a',keyword:'fixture product',limit:1,captchaMaxAttempts:0};
const statusText={ready:'店小秘插件已启用。',missing:'请在采集窗口安装店小秘插件。',disabled:'请在采集窗口启用店小秘插件。','browser-closed':'请打开绑定的采集窗口。',unknown:'插件状态尚未确认。'};
async function idle(service){const deadline=Date.now()+4000;while(service.isBusy()){if(Date.now()>deadline)throw new Error('fixture did not settle');await new Promise(r=>setTimeout(r,2));}}
function adapters(){
  const state={pluginStatus:'missing',calls:[],verified:false,throwPlugin:false,hold:null};
  const pluginAdapter={
    async check(bound){state.calls.push({kind:'plugin-check',bound:structuredClone(bound)});if(state.hold)await state.hold;if(state.throwPlugin)throw new Error('private credential must not leak');return {status:state.pluginStatus,message:statusText[state.pluginStatus],name:'店小秘助手',version:'2.9.9',private:'not-for-client'};},
    async openSetup(bound){state.calls.push({kind:'plugin-open',bound:structuredClone(bound)});return {message:'已在绑定的采集窗口打开插件页面。'};}
  };
  const adapter={search:async()=>{state.calls.push({kind:'search'});return {status:'ready',products:[{sourceUrl,title:'Fixture product'}]};},collect:async args=>{state.calls.push({kind:'collect'});args.beforeSubmit();return {status:'submitted'};}};
  const collectionAdapter={check:async()=>{state.calls.push({kind:'account'});},lookup:async()=>({status:'absent'}),verify:async()=>{state.calls.push({kind:'verify'});return state.verified?{status:'verified',evidence:{sourceUrl}}:{status:'needs-review',error:'等待已有提交结果'};}};
  return {state,pluginAdapter,adapter,collectionAdapter};
}
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'free-plugin-preflight-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const account={key:'erp-a',browserKey:'chrome-a',name:'Fixture ERP',expectedAccount:'fixture-account'},browser={key:'chrome-a',type:'chrome',name:'专用采集窗口',debugPort:9444};
  const preferences={erp:key=>{assert.equal(key,'erp-a');return {...account};},browser:key=>{assert.equal(key,account.browserKey);return {...browser,key};}};
  const f=adapters(),busy={other:false};
  const service=createFreeSourcing({directory,preferences,...f,isOtherBusy:()=>busy.other});
  return {...f,service,account,browser,busy,directory};
}

test('missing plugin blocks account, search, captcha and submission; setup and resume keep the same browser',async t=>{
  const f=fixture(t);f.service.start(request);await idle(f.service);
  let job=f.service.get(request.requestId);
  assert.equal(job.status,'waiting-plugin');assert.equal(job.rows.length,0);assert.equal(job.captcha.attempts.length,0);
  assert.deepEqual(f.state.calls.map(c=>c.kind),['plugin-check']);
  const result=await f.service.openPlugin({jobId:job.id,view:'install'});
  assert.equal(result.browserKey,'chrome-a');
  assert.deepEqual(f.state.calls.at(-1).bound.browserConfig,job.binding.browserConfig);
  assert.equal(f.state.calls.at(-1).bound.view,'install');
  assert.equal(f.service.view().pluginChecks.length,0,'opening settings invalidates the previous check');
  f.state.pluginStatus='ready';f.state.verified=true;
  const checked=await f.service.checkPlugin({jobId:job.id});assert.equal(checked.status,'ready');
  assert.equal(JSON.stringify(checked).includes('not-for-client'),false);
  f.service.resume(job.id);await idle(f.service);job=f.service.get(job.id);
  assert.equal(job.status,'completed');assert.equal(job.rows.length,1);
  assert.equal(f.state.calls.filter(c=>c.kind==='collect').length,1);
  assert.deepEqual(f.state.calls.slice(-5).map(c=>c.kind),['plugin-check','account','search','collect','verify']);
});

test('disabled, closed, unknown and failed inspections never proceed to any business adapter',async t=>{
  const f=fixture(t);
  for(const status of ['disabled','browser-closed','unknown']){
    f.state.pluginStatus=status;
    if(!f.service.view().jobs.length)f.service.start(request);else f.service.resume(request.requestId);
    await idle(f.service);assert.equal(f.service.get(request.requestId).status,'waiting-plugin');
    assert.equal(f.service.view().pluginChecks[0].status,status);
  }
  f.state.throwPlugin=true;f.service.resume(request.requestId);await idle(f.service);
  assert.equal(f.service.view().pluginChecks[0].status,'unknown');
  assert.doesNotMatch(JSON.stringify(f.service.view()),/private credential/);
  assert.ok(f.state.calls.every(c=>c.kind==='plugin-check'));
});

test('setup checks reserve the shared browser and respect another active workflow',async t=>{
  const f=fixture(t);let release;f.state.hold=new Promise(resolve=>{release=resolve;});
  const pending=f.service.checkPlugin({erpKey:'erp-a'});
  assert.equal(f.service.isBusy(),true);
  await assert.rejects(f.service.openPlugin({erpKey:'erp-a'}),e=>e.status===409);
  assert.throws(()=>f.service.start(request),e=>e.status===409);
  await assert.rejects(f.service.checkPlugin({erpKey:'erp-a'}),e=>e.status===409);
  release();await pending;assert.equal(f.service.isBusy(),false);
  f.busy.other=true;
  await assert.rejects(f.service.openPlugin({erpKey:'erp-a'}),e=>e.status===409);
  await assert.rejects(f.service.checkPlugin({erpKey:'erp-a'}),e=>e.status===409);
  assert.equal(f.state.calls.length,1);
});

test('stopping while the plugin is checked preserves progress without starting search',async t=>{
  const f=fixture(t);let release;f.state.hold=new Promise(resolve=>{release=resolve;});f.state.pluginStatus='ready';
  f.service.start(request);f.service.stop(request.requestId);release();await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'paused');
  assert.deepEqual(f.state.calls.map(c=>c.kind),['plugin-check']);
});

test('a task cannot redirect plugin setup to a changed account or browser binding',async t=>{
  const f=fixture(t);f.service.start(request);await idle(f.service);
  const count=f.state.calls.length;f.account.browserKey='chrome-other';
  await assert.rejects(f.service.openPlugin({jobId:request.requestId}),/绑定已变化/);
  await assert.rejects(f.service.checkPlugin({jobId:request.requestId}),/绑定已变化/);
  assert.equal(f.state.calls.length,count);assert.equal(f.service.view().pluginChecks.length,0);
});

test('uncertain submissions remain reconcilable while the plugin is missing, without another click',async t=>{
  const f=fixture(t);f.state.pluginStatus='ready';f.service.start(request);await idle(f.service);
  const original=f.service.get(request.requestId);assert.equal(original.status,'needs-review');assert.ok(original.rows[0].submittedAt);
  f.state.pluginStatus='missing';f.state.verified=true;const before=f.state.calls.length;
  f.service.resume(request.requestId,{reconcileOnly:true});await idle(f.service);
  assert.equal(f.service.get(request.requestId).status,'completed');
  assert.equal(f.service.get(request.requestId).rows[0].submittedAt,original.rows[0].submittedAt);
  assert.deepEqual(f.state.calls.slice(before).map(c=>c.kind),['account','verify']);
  assert.equal(f.state.calls.filter(c=>c.kind==='collect').length,1);
});

test('plugin HTTP endpoints require the local session and reject arbitrary setup destinations',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'free-plugin-http-')),f=adapters();
  const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},freePluginAdapter:f.pluginAdapter,freeSourcingAdapter:f.adapter,freeCollectionAdapter:f.collectionAdapter});
  app.preferences.update({revision:0,browsers:[{key:'chrome-a',type:'chrome',name:'专用采集窗口',debugPort:9444}],erpConnections:[{key:'erp-a',name:'Fixture ERP',expectedAccount:'fixture-account',browserKey:'chrome-a'}],stores:[]});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port,{token}=await fetch(base+'/api/session').then(r=>r.json());
  const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  for(const route of ['/api/free-sourcing/plugin/check','/api/free-sourcing/plugin/open'])assert.equal((await post(route,{erpKey:'erp-a'})).status,403);
  assert.equal(f.state.calls.length,0);
  assert.equal((await post('/api/free-sourcing/plugin/open',{erpKey:'erp-a',view:'https://untrusted.invalid/'},{'X-Workbench-Token':token})).status,400);
  assert.equal(f.state.calls.length,0);
  const check=await post('/api/free-sourcing/plugin/check',{erpKey:'erp-a'},{'X-Workbench-Token':token});assert.equal(check.status,200);assert.equal((await check.json()).status,'missing');
  const open=await post('/api/free-sourcing/plugin/open',{erpKey:'erp-a',view:'manage'},{'X-Workbench-Token':token});assert.equal(open.status,200);
  assert.equal(f.state.calls.at(-1).bound.view,'manage');assert.equal(f.state.calls.at(-1).bound.browserConfig.key,'chrome-a');
  const checks=await fetch(base+'/api/free-sourcing').then(r=>r.json());assert.deepEqual(checks.pluginChecks,[]);
});
