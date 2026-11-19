import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSettings} from '../src/settings.mjs';
import {createBrowserConnections,readChromeSnapshot} from '../src/browser-connections.mjs';

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chrome-connections-'));
  const preferences=createSettings({directory,configuration:{},legacyDirectory:null});
  preferences.update({revision:0,browsers:[{key:'one',type:'chrome',name:'现有窗口',debugPort:9222},{key:'two',type:'chrome',name:'其他窗口',debugPort:9233},{key:'bit',browserId:'legacy',name:'保留旧比特配置',browserSequence:1,localApi:'http://127.0.0.1:54346'}],erpConnections:[{key:'erp-one',provider:'dianxiaomi',name:'店小秘',browserKey:'one'}],stores:[{key:'temu-store',platform:'temu',expectedStore:'已跑通的店铺',expectedSite:'加拿大站',erpKey:'erp-one',templates:[{key:'mother',name:'原母稿',draftId:'123456789'}]},{key:'amazon-store',platform:'amazon',expectedStore:'Amazon 店',expectedSite:'美国站',erpKey:'erp-one',templates:[]}]});
  const state={snapshot:{listeners:[],processes:[]},busy:false,probes:0};
  const service=createBrowserConnections({preferences,inspector:async()=>{state.probes++;return state.inspect?state.inspect():state.snapshot;},isBusy:()=>state.busy});
  const browser=()=>({...preferences.browser('one'),debugPort:9232});
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return {preferences,state,service,browser,directory};
}
const processFor=(browser,pid=42)=>({pid,name:'chrome.exe',commandLine:'chrome.exe "--user-data-dir='+browser.userDataDir+'" --remote-debugging-port='+browser.debugPort});
const listener=(port,pid=42,address='127.0.0.1')=>({port,pid,address});

test('inspect distinguishes free, owned, foreign, reserved and already-running profiles without changing settings',async t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.directory,'settings.json'));
  assert.equal((await f.service.inspect({browser:f.browser()})).state,'available');
  const current=f.preferences.browser('one');
  f.state.snapshot={listeners:[listener(9222)],processes:[processFor(current)]};
  assert.equal((await f.service.inspect({browser:current})).state,'owned');
  assert.equal((await f.service.inspect({browser:f.browser()})).state,'profile_running','an empty target port cannot move a running profile');
  f.state.snapshot={listeners:[],processes:[processFor(current)]};
  assert.equal((await f.service.inspect({browser:f.browser()})).state,'profile_running','a Chrome profile without a listener is still running');
  f.state.snapshot={listeners:[listener(9232)],processes:[processFor({...current,userDataDir:current.userDataDir+'-other'})]};
  const foreign=await f.service.inspect({browser:f.browser()});assert.equal(foreign.state,'occupied');assert.equal(foreign.suggestedPort,9234);
  f.state.snapshot={listeners:[],processes:[]};
  const reserved=await f.service.inspect({browser:{...f.browser(),debugPort:9233}});assert.equal(reserved.state,'occupied');assert.equal(reserved.suggestedPort,9232);
  f.state.snapshot={listeners:[listener(9222,42,'0.0.0.0')],processes:[processFor(current)]};
  assert.notEqual((await f.service.inspect({browser:current})).state,'owned','a wildcard listener is never accepted');
  assert.deepEqual(fs.readFileSync(path.join(f.directory,'settings.json')),before);
});

test('save merges only the named browser and preserves ERP, stores, other browsers and its existing profile',async t=>{
  const f=fixture(t),before=f.preferences.view();
  const saved=await f.service.save({revision:before.revision,browser:{...f.browser(),name:'用户命名窗口'}});
  assert.equal(saved.revision,before.revision+1);
  assert.deepEqual(saved.erpConnections,before.erpConnections);assert.deepEqual(saved.stores,before.stores);
  assert.deepEqual(saved.browsers.filter(b=>b.key!=='one'),before.browsers.filter(b=>b.key!=='one'));
  assert.equal(saved.browsers[0].userDataDir,before.browsers[0].userDataDir);assert.equal(saved.browsers[0].localApi,'http://127.0.0.1:9232');
  assert.equal(saved.browsers[0].name,'用户命名窗口');
  const added=await f.service.save({revision:saved.revision,browser:{key:'new-window',type:'chrome',name:'新窗口',debugPort:9240,executable:''}});
  assert.deepEqual(added.erpConnections,saved.erpConnections);assert.equal(added.browsers.length,4);
  assert.notEqual(added.browsers.at(-1).userDataDir,saved.browsers[0].userDataDir);
});

test('save rejects occupied or running profiles and fails closed on unavailable process metadata',async t=>{
  const f=fixture(t),before=f.preferences.view(),request={revision:before.revision,browser:f.browser()};
  for(const snapshot of [
    {listeners:[listener(9232,77)],processes:[]},
    {listeners:[listener(9222)],processes:[processFor(before.browsers[0])]},
    {listeners:[],processes:[processFor(before.browsers[0])]},
  ]){f.state.snapshot=snapshot;await assert.rejects(f.service.save(request),error=>error.status===409);}
  f.state.snapshot={listeners:[],processes:[{pid:42,name:'chrome.exe',commandLine:null}]};
  assert.equal((await f.service.inspect({browser:f.browser()})).state,'unavailable');
  await assert.rejects(f.service.save(request),error=>error.status===503);
  f.state.inspect=async()=>{throw new Error('private command line and token');};
  const unavailable=await f.service.inspect({browser:f.browser()});assert.equal(unavailable.state,'unavailable');assert.doesNotMatch(unavailable.message,/private|token/);
  assert.deepEqual(f.preferences.view(),before);
});

test('save checks busy and revision both before and after the asynchronous probe',async t=>{
  const f=fixture(t),request={revision:f.preferences.view().revision,browser:f.browser()};
  f.state.busy=true;await assert.rejects(f.service.save(request),error=>error.status===409);assert.equal(f.state.probes,0);
  f.state.busy=false;await assert.rejects(f.service.save({...request,revision:0}),error=>error.status===409);assert.equal(f.state.probes,0);
  f.state.inspect=async()=>{f.state.busy=true;return {listeners:[],processes:[]};};
  await assert.rejects(f.service.save(request),error=>error.status===409);assert.equal(f.preferences.view().revision,request.revision);
  f.state.busy=false;f.state.inspect=async()=>{const now=f.preferences.view();f.preferences.update({revision:now.revision,erpConnections:now.erpConnections.map(e=>({...e,name:'另一页面已保存'}))});return {listeners:[],processes:[]};};
  await assert.rejects(f.service.save(request),error=>error.status===409);
  assert.equal(f.preferences.browser('one').debugPort,9222);assert.equal(f.preferences.erp('erp-one').name,'另一页面已保存');
});

test('suggest skips every listener and other saved Chrome ports without saving or opening anything',async t=>{
  const f=fixture(t),before=f.preferences.view();
  f.state.snapshot={listeners:[listener(9232,99,'0.0.0.0'),listener(9234,100,'::1')],processes:[]};
  assert.equal((await f.service.suggest({browserKey:'one'})).debugPort,9235);
  assert.equal((await f.service.suggest({browserKey:'two'})).debugPort,9233,'the current non-listening port can be reused');
  assert.deepEqual(f.preferences.view(),before);
  await assert.rejects(f.service.save({revision:before.revision,browser:{key:'bit',name:'覆盖旧窗口',debugPort:9235}}),error=>error.status===400);
  for(const debugPort of ['',0,1023,65536,9232.5,true])await assert.rejects(f.service.inspect({browser:{debugPort}}),error=>error.status===400);
});

test('read-only snapshot queries netstat and all Chrome processes, including when no port is open',async()=>{
  const calls=[];
  const snapshot=await readChromeSnapshot({platform:'win32',systemRoot:'C:\\Windows',run:async(file,args,options)=>{calls.push({file,args,options});return {stdout:file.endsWith('netstat.exe')?' TCP 127.0.0.1:9232 0.0.0.0:0 LISTENING 42\n TCP [::1]:9233 [::]:0 侦听 77\n TCP 127.0.0.1:9234 127.0.0.1:1245 ESTABLISHED 88\n':JSON.stringify([{pid:42,name:'chrome.exe',commandLine:'chrome.exe "--user-data-dir=C:\\测试 窗口"'}])};}});
  assert.deepEqual(snapshot.listeners,[listener(9232),listener(9233,77,'::1')]);assert.equal(calls.length,2);
  assert.match(calls[0].file,/netstat\.exe$/);assert.match(calls[1].file,/powershell\.exe$/);
  const script=Buffer.from(calls[1].args.at(-1),'base64').toString('utf16le');assert.match(script,/Name = 'chrome\.exe'/);assert.doesNotMatch(script,/Start-Process|Stop-Process|Invoke-WebRequest/);
  assert.ok(calls.every(call=>call.options.windowsHide&&call.options.timeout<=30000));
  let count=0;await readChromeSnapshot({platform:'win32',run:async file=>{count++;return {stdout:file.endsWith('netstat.exe')?'':'[]'};}});assert.equal(count,2,'a free port alone cannot establish that the profile is closed');
  await assert.rejects(readChromeSnapshot({platform:'win32',run:async()=>{throw new Error('secret process output');}}),error=>error.status===503&&!error.message.includes('secret'));
  await assert.rejects(readChromeSnapshot({platform:'win32',run:async file=>({stdout:file.endsWith('netstat.exe')?' TCP 127.0.0.1:9232 0.0.0.0:0 LISTENING ?':'[]'})}),error=>error.status===503);
});

test('Chrome settings helper loads from a standalone desktop package without adjacent ERP scripts',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chrome-package-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const packaged=path.join(directory,'resources','app.asar','src','browser-connections.mjs');fs.mkdirSync(path.dirname(packaged),{recursive:true});
  fs.copyFileSync(new URL('../src/browser-connections.mjs',import.meta.url),packaged);
  const module=await import(pathToFileURL(packaged).href);
  assert.equal(typeof module.createBrowserConnections,'function');
  assert.deepEqual(await module.readChromeSnapshot({platform:'win32',run:async file=>({stdout:file.endsWith('netstat.exe')?'':'[]'})}),{listeners:[],processes:[]});
});
