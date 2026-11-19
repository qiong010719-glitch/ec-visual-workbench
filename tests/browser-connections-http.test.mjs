import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench} from '../src/server.mjs';

async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chrome-settings-http-'));
  const state={snapshot:{listeners:[],processes:[]},external:0,probes:0};
  const forbidden=async()=>{state.external++;throw new Error('External operation must not run');};
  const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},chromeInspector:async()=>{state.probes++;return state.inspect?state.inspect():state.snapshot;},provider:forbidden,planner:forbidden,erpAdapter:{preflight:forbidden,verifyMother:forbidden,verifyTemplate:forbidden,open:forbidden,runDraft:forbidden,publishDraft:forbidden},sourcingClient:forbidden,collectionAdapter:{preflight:forbidden,importProduct:forbidden}});
  app.preferences.update({revision:0,browsers:[{key:'chrome-one',type:'chrome',name:'已绑定窗口',debugPort:9222},{key:'chrome-two',type:'chrome',name:'另一个窗口',debugPort:9233}],erpConnections:[{key:'erp-one',provider:'dianxiaomi',name:'店小秘',browserKey:'chrome-one'}],stores:[{key:'temu-one',platform:'temu',expectedStore:'Temu 店',expectedSite:'加拿大站',erpKey:'erp-one',templates:[{key:'mother-one',name:'原母稿',draftId:'123456789'}]}]});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port,token=(await fetch(base+'/api/session').then(r=>r.json())).token;
  const request=async(route,{data,session=token,origin}={})=>{const response=await fetch(base+route,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(session?{'X-Workbench-Token':session}:{}),...(origin?{Origin:origin}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json()};};
  const post=(route,data,options={})=>request('/api/settings/chrome/'+route,{data,...options});
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));assert.equal(state.external,0);fs.rmSync(directory,{recursive:true,force:true});});
  return {app,state,request,post};
}

test('Chrome settings APIs require a same-origin session and never bypass it for a read-only probe',async t=>{
  const f=await fixture(t),browser={key:'chrome-one',name:'窗口',debugPort:9232,executable:''};
  for(const [route,data] of [['inspect',{browser}],['suggest',{}],['save',{revision:1,browser}]])assert.equal((await f.post(route,data,{session:null})).status,403);
  assert.equal((await f.post('inspect',{browser},{origin:'https://foreign.invalid'})).status,403);assert.equal(f.state.probes,0);
  assert.equal((await f.post('inspect',{browser:{...browser,debugPort:0}})).status,400);
  assert.equal((await f.post('inspect',{browser})).body.state,'available');
  assert.equal((await f.post('suggest',{browserKey:'chrome-one'})).body.debugPort,9232);
});

test('dedicated save retains ERP links, store mother IDs, task snapshots and is visible through shared settings',async t=>{
  const f=await fixture(t),before=f.app.preferences.view(),oldBrowser=before.browsers[0];
  f.app.store.state.productBatches.previous={id:'previous',label:'历史已完成批次',platform:'temu',phase:'completed',connectionBinding:{browserConfig:oldBrowser},products:[]};f.app.store.save();
  const history=fs.readFileSync(f.app.store.file);
  const saved=await f.post('save',{revision:before.revision,browser:{key:oldBrowser.key,type:'chrome',name:'窗口新名称',debugPort:9232,executable:''}});
  assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.revision,before.revision+1);
  assert.deepEqual(saved.body.erpConnections,before.erpConnections);assert.deepEqual(saved.body.stores,before.stores);assert.deepEqual(saved.body.browsers[1],before.browsers[1]);
  assert.equal(saved.body.browsers[0].userDataDir,oldBrowser.userDataDir);assert.equal(saved.body.browsers[0].debugPort,9232);
  assert.deepEqual((await f.request('/api/settings')).body,saved.body);assert.equal((await f.request('/api/workspace')).body.stores[0].erpKey,'erp-one');
  assert.deepEqual(fs.readFileSync(f.app.store.file),history);
  assert.equal((await f.post('save',{revision:before.revision,browser:oldBrowser})).status,409);
});

test('running old profile and occupied ports block saving; inspection stays read-only during active jobs',async t=>{
  const f=await fixture(t),before=f.app.preferences.view(),old=before.browsers[0],browser={...old,debugPort:9232};
  f.state.snapshot={listeners:[{port:9222,address:'127.0.0.1',pid:42}],processes:[{pid:42,name:'chrome.exe',commandLine:'chrome.exe "--user-data-dir='+old.userDataDir+'" --remote-debugging-port=9222'}]};
  assert.equal((await f.post('inspect',{browser})).body.state,'profile_running');
  assert.equal((await f.post('save',{revision:before.revision,browser})).status,409);
  f.state.snapshot={listeners:[{port:9232,address:'0.0.0.0',pid:99}],processes:[]};
  assert.equal((await f.post('inspect',{browser})).body.state,'occupied');assert.equal((await f.post('save',{revision:before.revision,browser})).status,409);
  f.state.snapshot={listeners:[],processes:[]};f.app.sourcing.isBusy=()=>true;
  assert.equal((await f.post('inspect',{browser})).body.state,'available');assert.equal((await f.post('suggest',{})).status,200);
  assert.equal((await f.post('save',{revision:before.revision,browser})).status,409);
  f.app.sourcing.isBusy=()=>false;f.state.inspect=async()=>{f.app.products.isBusy=()=>true;return {listeners:[],processes:[]};};
  assert.equal((await f.post('save',{revision:before.revision,browser})).status,409);f.app.products.isBusy=()=>false;
  assert.deepEqual(f.app.preferences.view(),before);
});

test('a concurrent settings write during inspection wins and does not get overwritten by Chrome save',async t=>{
  const f=await fixture(t),before=f.app.preferences.view();
  f.state.inspect=async()=>{f.app.preferences.update({revision:before.revision,erpConnections:before.erpConnections.map(e=>({...e,name:'另一页的新连接名称'}))});return {listeners:[],processes:[]};};
  const response=await f.post('save',{revision:before.revision,browser:{...before.browsers[0],debugPort:9232}});
  assert.equal(response.status,409);assert.equal(f.app.preferences.browser('chrome-one').debugPort,9222);assert.equal(f.app.preferences.erp('erp-one').name,'另一页的新连接名称');
});
