import test from 'node:test';
import assert from 'node:assert/strict';
import {createExistingChromeConnector,defaultExistingChromeDirectory,parseExistingChromeEndpoint,isExistingChromeWorkUrl} from '../../scripts/lib/chrome-existing.mjs';
import {connect,pageById} from '../../scripts/lib/bit-cdp.mjs';

const localAppData='C:\\Users\\Fixture\\AppData\\Local';
const userDataDir=defaultExistingChromeDirectory(localAppData);
const executable='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const config={type:'chrome',connectionMode:'existing',userDataDir,executable:''};
const endpoint='51347\n/devtools/browser/fixture-browser-id\n';
const info={pid:42,name:'chrome.exe',commandLine:'"'+executable+'"',executablePath:executable,ownerSid:'S-1-5-21-1'};
const fileStat={size:endpoint.length,isDirectory:()=>false,isFile:()=>true,isSymbolicLink:()=>false};
const dirStat={...fileStat,isDirectory:()=>true,isFile:()=>false};
const responseEvent=value=>new MessageEvent('message',{data:JSON.stringify(value)});

function fixture(t,options={}){
  const calls=[],sockets=[],commands=[],targets=new Map((options.targets||[
    {targetId:'personal',type:'page',url:'https://mail.example.com/',title:'Private mail'},
    {targetId:'erp',type:'page',url:'https://www.dianxiaomi.com/web/temu/',title:'ERP',browserContextId:'daily-profile'}
  ]).map(target=>[target.targetId,{...target}]));
  let sequence=0,sessionSequence=0,content=options.content??endpoint;
  class Socket extends EventTarget{
    constructor(url){super();this.url=url;this.closed=false;this.sessions=new Map();sockets.push(this);queueMicrotask(()=>{if(options.reject) this.dispatchEvent(new Event('close'));else if(!options.hang)this.dispatchEvent(new Event('open'));});}
    send(command){
      const message=JSON.parse(command);commands.push(message);
      const {id,method,params,sessionId}=message;
      let result={};
      if(method==='Target.getTargets'){options.onGetTargets?.(targets,commands);result={targetInfos:[...targets.values()].map(target=>({...target}))};}
      else if(method==='Target.createTarget'){
        const targetId='owned-'+(++sequence);
        targets.set(targetId,{targetId,type:'page',url:params.url,browserContextId:params.browserContextId||'daily-profile'});result={targetId};
      }else if(method==='Target.closeTarget'){targets.delete(params.targetId);result={success:true};}
      else if(method==='Target.attachToTarget'){const created='session-'+(++sessionSequence);this.sessions.set(created,params.targetId);result={sessionId:created};}
      else if(method==='Target.detachFromTarget')this.sessions.delete(params.sessionId);
      else if(method==='Page.navigate'){const target=targets.get(this.sessions.get(sessionId));target.url=params.url;options.onNavigate?.(target,params);}
      else if(method==='Runtime.evaluate')result={result:{type:'string',value:'fixture-value'}};
      if(options.noResponse===method)return;
      queueMicrotask(()=>{if(!this.closed)this.dispatchEvent(responseEvent({id,result,...(sessionId?{sessionId}:{})}));});
    }
    close(){if(this.closed)return;this.closed=true;this.dispatchEvent(new Event('close'));}
    emit(method,params,sessionId){this.dispatchEvent(responseEvent({method,params,...(sessionId?{sessionId}:{})}));}
  }
  const fileSystem={
    async lstat(file){calls.push({op:'lstat',file});if(options.missing&&file.endsWith('DevToolsActivePort'))throw Object.assign(new Error('private detail'),{code:'ENOENT'});return file===userDataDir?dirStat:{...fileStat,...(options.symlink&&file.endsWith('DevToolsActivePort')?{isSymbolicLink:()=>true}:{})};},
    async realpath(file){return options.relocated&&file.endsWith('DevToolsActivePort')?'C:\\other\\DevToolsActivePort':file;},
    async readFile(file){calls.push({op:'read',file});assert.equal(file,userDataDir+'\\DevToolsActivePort');return content;}
  };
  const run=async(file,args,opts)=>{
    calls.push({op:'run',file,args,opts});
    if(options.processError)throw new Error('private command line secret');
    return {stdout:file.endsWith('netstat.exe')?(options.listeners??' TCP 127.0.0.1:51347 0.0.0.0:0 LISTENING 42\n'):JSON.stringify(options.report||{currentSid:'S-1-5-21-1',processes:[{...info,...options.process}]})};
  };
  const connector=createExistingChromeConnector({platform:'win32',localAppData,programFiles:'C:\\Program Files',programFilesX86:'C:\\Program Files (x86)',fileSystem,run,createWebSocket:url=>new Socket(url),connectTimeoutMs:options.connectTimeoutMs||50,commandTimeoutMs:options.commandTimeoutMs||200,navigationTimeoutMs:options.navigationTimeoutMs??1000});
  t.after(()=>connector.disconnect());
  return {connector,calls,sockets,commands,targets,setContent(value){content=value;}};
}

test('discovers the current default profile without starting Chrome, copying profile files or disclosing WS path',async t=>{
  const f=fixture(t),state=await f.connector.inspect(config);
  assert.equal(state.state,'needs-authorization');assert.equal(state.port,51347);assert.equal(state.pid,42);
  assert.doesNotMatch(JSON.stringify(state),/fixture-browser-id|ws:\/\/|Private mail/);
  assert.equal(f.sockets.length,0);
  assert.equal(f.calls.filter(call=>call.op==='read').length,2);
  const processCall=f.calls.find(call=>call.op==='run'&&call.file.endsWith('powershell.exe'));
  const script=Buffer.from(processCall.args.at(-1),'base64').toString('utf16le');
  assert.match(script,/ProcessId = 42/);assert.match(script,/GetOwnerSid/);assert.equal(processCall.opts.windowsHide,true);
});

test('missing remote-debugging setup is actionable and never creates a socket',async t=>{
  const f=fixture(t,{missing:true}),state=await f.connector.inspect(config);
  assert.equal(state.state,'needs-authorization');assert.equal(state.code,'CHROME_EXISTING_SETUP_REQUIRED');
  assert.match(state.message,/chrome:\/\/inspect\/#remote-debugging/);
  await assert.rejects(f.connector.connect(config),{code:'CHROME_EXISTING_SETUP_REQUIRED'});assert.equal(f.sockets.length,0);
});

test('rejects path, endpoint, process and listener substitutions before connecting',async t=>{
  for(const options of [
    {content:'51347\n//remote.example/devtools/browser/x'},
    {content:'51347\n/devtools/browser/x?redirect=1'},
    {content:'51347\n/devtools/browser/x\nextra'},
    {content:'51347oops\n/devtools/browser/x'},
    {content:'65536\n/devtools/browser/x'},
    {content:'51347\n/devtools/browser/../page/x'},
    {symlink:true},{relocated:true},{listeners:''},
    {listeners:' TCP 0.0.0.0:51347 0.0.0.0:0 LISTENING 42\n'},
    {listeners:' TCP 127.0.0.1:51347 0.0.0.0:0 LISTENING 42\n TCP [::1]:51347 [::]:0 LISTENING 43\n'},
    {process:{name:'other.exe'}},{process:{ownerSid:'S-1-5-21-2'}},
    {process:{executablePath:'C:\\malware\\chrome.exe'}},
    {process:{commandLine:'chrome.exe --type=renderer'}},
    {process:{commandLine:'chrome.exe --user-data-dir=C:\\other'}},
    {processError:true},{report:{currentSid:'S-1-5-21-1',processes:[]}}
  ]){
    const f=fixture(t,options),state=await f.connector.inspect(config);
    assert.equal(state.state,'unavailable',JSON.stringify(options));
    await assert.rejects(f.connector.connect(config));assert.equal(f.sockets.length,0);
    assert.doesNotMatch(JSON.stringify(state),/private command line|secret/);
  }
  const f=fixture(t);
  for(const override of [{userDataDir:'C:\\other'},{wsEndpoint:'ws://127.0.0.1:51347/devtools/browser/injected'},{browserUrl:'http://other/'},{connectionMode:'isolated'}]){
    await assert.rejects(f.connector.connect({...config,...override}));assert.equal(f.sockets.length,0);
  }
  assert.throws(()=>parseExistingChromeEndpoint('0\n/devtools/browser/x'));
  assert.deepEqual(parseExistingChromeEndpoint('51347\n/devtools/browser'),{port:51347,ws:'ws://127.0.0.1:51347/devtools/browser'});
});

test('accepts explicit exact default user-data-dir and rejects malformed or repeated flags',async t=>{
  const f=fixture(t,{process:{commandLine:'"'+executable+'" "--user-data-dir='+userDataDir+'"'}});
  assert.equal((await f.connector.inspect(config)).state,'needs-authorization');
  for(const commandLine of ['chrome.exe "--user-data-dir='+userDataDir+'" --user-data-dir=C:\\other','chrome.exe --user-data-dir '+userDataDir]){
    const bad=fixture(t,{process:{commandLine}});assert.equal((await bad.connector.inspect(config)).state,'unavailable');
  }
});

test('reuses one approved Browser websocket and page sessions detach without closing user Chrome',async t=>{
  const f=fixture(t),a=await f.connector.connect(config),b=await f.connector.connect(config);
  const first=await connect(a.ws),second=await connect(b.ws);
  assert.equal(f.sockets.length,1);assert.equal(a.ws,b.ws);assert.equal((await f.connector.inspect(config)).state,'available');
  assert.deepEqual((await a.targets()).map(target=>target.id),['erp']);
  assert.doesNotMatch(JSON.stringify(a),/ws:\/\/|fixture-browser-id/);
  const {targetId}=await first.send('Target.createTarget',{url:'about:blank'});
  const page=await pageById(a,targetId);
  await page.send('Page.navigate',{url:'https://www.temu.com/search_result.html'});
  assert.equal(await page.evaluate(()=>document.title),'fixture-value');
  const evaluation=f.commands.find(command=>command.method==='Runtime.evaluate');assert.match(evaluation.sessionId,/^session-/);
  const events=[];const off=page.on('Network.responseReceived',event=>events.push(event));
  f.sockets[0].emit('Network.responseReceived',{name:'other'},'unrelated-session');
  f.sockets[0].emit('Network.responseReceived',{name:'ours'},evaluation.sessionId);
  assert.deepEqual(events,[{name:'ours'}]);off();
  await page.close();first.close();second.close();
  assert.equal(f.sockets[0].closed,false);assert.equal(f.sockets.length,1);
  assert.ok(f.commands.some(command=>command.method==='Target.detachFromTarget'));
  assert.ok(!f.commands.some(command=>command.method==='Browser.close'));
  assert.ok(f.targets.has(targetId));assert.ok(f.targets.has('personal'));
  await assert.rejects(page.send('Page.enable'),{code:'CHROME_EXISTING_DISCONNECTED'});
});

test('only a known duplicate confirmation on an owned Temu page can be declined',async t=>{
  const f=fixture(t),info=await f.connector.connect(config),browser=await connect(info.ws);
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),page=await pageById(info,targetId);
  await page.send('Page.navigate',{url:'https://www.temu.com/fixture-g-601103145485534.html'});await page.evaluate(()=>document.title);
  const sessionId=f.commands.find(command=>command.method==='Runtime.evaluate').sessionId;
  const dialog=message=>f.sockets[0].emit('Page.javascriptDialogOpening',{type:'confirm',message},sessionId);
  await assert.rejects(page.send('Page.handleJavaScriptDialog',{accept:false}),{code:'CHROME_EXISTING_COMMAND_DENIED'});
  dialog('是否删除商品？');await assert.rejects(page.send('Page.handleJavaScriptDialog',{accept:false}),{code:'CHROME_EXISTING_COMMAND_DENIED'});
  dialog('该产品在店小秘已有采集记录，是否继续采集？');
  await assert.rejects(page.send('Page.handleJavaScriptDialog',{accept:true}),{code:'CHROME_EXISTING_COMMAND_DENIED'});
  await page.send('Page.handleJavaScriptDialog',{accept:false});
  await assert.rejects(page.send('Page.handleJavaScriptDialog',{accept:false}),{code:'CHROME_EXISTING_COMMAND_DENIED'});
  assert.equal(f.commands.filter(command=>command.method==='Page.handleJavaScriptDialog').length,1);
  await page.close();browser.close();
});

test('navigation waits for a committed business URL without evaluating the transient empty page',async t=>{
  let navigating=false,reads=0;
  const destination='https://www.dianxiaomi.com/web/sheinProduct/draft';
  const f=fixture(t,{
    onNavigate(target){navigating=target.targetId;target.url='';},
    onGetTargets(targets,commands){
      if(!navigating)return;
      if(++reads<3){assert.equal(commands.some(command=>command.method==='Runtime.evaluate'),false);return;}
      targets.get(navigating).url=destination;
    }
  });
  const info=await f.connector.connect(config),browser=await connect(info.ws),{targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),page=await pageById(info,targetId);
  await page.send('Page.navigate',{url:destination});
  assert.equal(await page.evaluate(()=>document.title),'fixture-value');
  assert.ok(reads>=3);assert.equal(f.commands.filter(command=>command.method==='Page.navigate').length,1);
  assert.equal(f.commands.filter(command=>command.method==='Runtime.evaluate').length,1);
  await page.close();await browser.send('Target.closeTarget',{targetId});
});

test('an empty URL wait still rejects navigation escapes, closed targets and different profiles',async t=>{
  for(const change of ['escape','closed','profile'])await t.test(change,async t=>{
    let navigating=false,reads=0;
    const f=fixture(t,{
      onNavigate(target){navigating=target.targetId;target.url='';},
      onGetTargets(targets){
        if(!navigating||++reads<2)return;
        if(change==='closed')targets.delete(navigating);
        else if(change==='profile')targets.get(navigating).browserContextId='another-profile';
        else targets.get(navigating).url='https://mail.example.com/';
      }
    });
    const info=await f.connector.connect(config),browser=await connect(info.ws),{targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),page=await pageById(info,targetId);
    await page.send('Page.navigate',{url:'https://www.dianxiaomi.com/web/sheinProduct/draft'});
    await assert.rejects(page.evaluate(()=>document.title),{code:'CHROME_EXISTING_TARGET_DENIED'});
    assert.equal(f.commands.some(command=>command.method==='Runtime.evaluate'),false);
    assert.equal(f.commands.some(command=>command.method==='Target.closeTarget'),false);
    await page.close();
  });
});

test('an owned navigation that stays empty times out without sending page commands or closing it',async t=>{
  const f=fixture(t,{navigationTimeoutMs:30,onNavigate(target){target.url='';}});
  const info=await f.connector.connect(config),browser=await connect(info.ws),{targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),page=await pageById(info,targetId);
  await page.send('Page.navigate',{url:'https://www.dianxiaomi.com/web/sheinProduct/draft'});
  await assert.rejects(page.evaluate(()=>document.title),{code:'CHROME_EXISTING_NAVIGATION_TIMEOUT'});
  assert.equal(f.commands.some(command=>command.method==='Runtime.evaluate'),false);
  assert.equal(f.targets.has(targetId),true);await page.close();
});

test('an empty URL alone does not authorize a pre-existing page',async t=>{
  const f=fixture(t),info=await f.connector.connect(config),page=await pageById(info,'erp');
  f.targets.get('erp').url='';
  await assert.rejects(page.evaluate(()=>document.title),{code:'CHROME_EXISTING_TARGET_DENIED'});
  assert.equal(f.commands.some(command=>command.method==='Runtime.evaluate'),false);await page.close();
});

test('a newly created target may finish committing about:blank before attaching',async t=>{
  let reads=0;
  const f=fixture(t,{onGetTargets(targets,commands){
    const created=targets.get('owned-1');if(!created)return;
    created.url=++reads<3?'':'about:blank';
    if(reads<3)assert.equal(commands.some(command=>command.method==='Target.attachToTarget'),false);
  }});
  const info=await f.connector.connect(config),browser=await connect(info.ws),{targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
  const page=await pageById(info,targetId);assert.ok(reads>=3);await page.close();
  await browser.send('Target.closeTarget',{targetId});
});

test('first created page opens a work window in the existing profile and subsequent work pages reuse it',async t=>{
  const f=fixture(t),info=await f.connector.connect(config),browser=await connect(info.ws);
  const first=await browser.send('Target.createTarget',{url:'https://www.dianxiaomi.com/'});
  await browser.send('Target.createTarget',{url:'https://erp.91miaoshou.com/',background:true});
  const created=f.commands.filter(command=>command.method==='Target.createTarget');
  assert.equal(created[0].params.newWindow,true);assert.equal(created[1].params.newWindow,false);
  assert.equal(created[0].params.browserContextId,'daily-profile');
  assert.ok(f.commands.some(command=>command.method==='Target.activateTarget'&&command.params.targetId===first.targetId));
  await browser.send('Target.closeTarget',{targetId:first.targetId});assert.equal(f.targets.has(first.targetId),false);
});

test('concurrent connection requests share one approval and an initially blank browser binds the created profile',async t=>{
  const f=fixture(t,{targets:[]}),connections=await Promise.all([f.connector.connect(config),f.connector.connect(config),f.connector.connect(config)]);
  assert.equal(f.sockets.length,1);assert.ok(connections.every(info=>info.ws===connections[0].ws));
  const browser=await connect(connections[0].ws);await browser.send('Target.createTarget',{url:'chrome://extensions/'});
  f.targets.set('foreign',{targetId:'foreign',type:'page',url:'https://www.dianxiaomi.com/',browserContextId:'another-profile'});
  assert.ok(!(await connections[0].targets()).some(target=>target.id==='foreign'));
  await assert.rejects(pageById(connections[0],'foreign'),{code:'CHROME_EXISTING_TARGET_DENIED'});
});

test('rejects unrelated pages, browser-wide operations, navigation escapes and closing pre-existing business tabs',async t=>{
  const f=fixture(t),info=await f.connector.connect(config),browser=await connect(info.ws);
  await assert.rejects(pageById(info,'personal'),{code:'CHROME_EXISTING_TARGET_DENIED'});
  for(const [method,params] of [['Browser.close',{}],['Target.createBrowserContext',{}],['Target.createTarget',{url:'https://mail.example.com'}],['Target.activateTarget',{targetId:'personal'}],['Target.closeTarget',{targetId:'erp'}]])await assert.rejects(browser.send(method,params));
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),page=await pageById(info,targetId);
  await assert.rejects(page.send('Page.navigate',{url:'https://example.com'}));
  await assert.rejects(page.send('Network.getAllCookies'));
  f.targets.get(targetId).url='https://mail.example.com/';
  await assert.rejects(page.evaluate(()=>document.title),{code:'CHROME_EXISTING_TARGET_DENIED'});
  await assert.rejects(browser.send('Target.closeTarget',{targetId}),{code:'CHROME_EXISTING_TARGET_DENIED'});
  assert.ok(f.targets.has('personal'));assert.ok(f.targets.has('erp'));assert.ok(f.targets.has(targetId));
  assert.ok(!f.commands.some(command=>command.method==='Browser.close'));
  assert.ok(!f.commands.some(command=>command.method==='Target.closeTarget'));
});

test('keeps popup ownership tied to owned openers and refuses ambiguous Chrome profiles',async t=>{
  const f=fixture(t),info=await f.connector.connect(config),browser=await connect(info.ws),{targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
  f.targets.set('popup',{targetId:'popup',type:'page',url:'https://www.dianxiaomi.com/web/edit',browserContextId:'daily-profile',openerId:targetId});
  f.targets.set('user-popup',{targetId:'user-popup',type:'page',url:'https://www.dianxiaomi.com/',browserContextId:'daily-profile',openerId:'erp'});
  await info.targets();await browser.send('Target.closeTarget',{targetId:'popup'});
  await assert.rejects(browser.send('Target.closeTarget',{targetId:'user-popup'}),{code:'CHROME_EXISTING_TARGET_NOT_OWNED'});
  const ambiguous=fixture(t,{targets:[{targetId:'a',type:'page',url:'https://www.temu.com/',browserContextId:'first'},{targetId:'b',type:'page',url:'https://www.dianxiaomi.com/',browserContextId:'second'}]});
  const secondInfo=await ambiguous.connector.connect(config);
  await assert.rejects(secondInfo.targets(),{code:'CHROME_EXISTING_PROFILE_AMBIGUOUS'});
  await assert.rejects((await connect(secondInfo.ws)).send('Target.createTarget',{url:'about:blank'}),{code:'CHROME_EXISTING_PROFILE_AMBIGUOUS'});
  assert.equal(ambiguous.commands.some(command=>command.method==='Target.createTarget'),false);
});

test('connection denial and silent timeouts fail closed without retrying or starting another browser',async t=>{
  for(const options of [{reject:true},{hang:true,connectTimeoutMs:10}]){
    const f=fixture(t,options);await assert.rejects(f.connector.connect(config),{code:'CHROME_EXISTING_APPROVAL_REQUIRED'});assert.equal(f.sockets.length,1);
  }
  const f=fixture(t),info=await f.connector.connect(config),browser=await connect(info.ws);
  f.sockets[0].close();
  await assert.rejects(info.targets(),{code:'CHROME_EXISTING_DISCONNECTED'});
  await assert.rejects(browser.send('Target.createTarget',{url:'about:blank'}),{code:'CHROME_EXISTING_DISCONNECTED'});
  assert.equal(f.sockets.length,1,'old handles never reconnect');
  assert.equal((await f.connector.inspect(config)).state,'needs-authorization');assert.equal(f.sockets.length,1,'inspection never reconnects');
  await f.connector.connect(config);assert.equal(f.sockets.length,2,'only a fresh explicit action may reconnect');
  const timeout=fixture(t,{noResponse:'Target.getTargets',commandTimeoutMs:10}),timedInfo=await timeout.connector.connect(config);
  await assert.rejects(timedInfo.targets(),{code:'CHROME_EXISTING_CDP_TIMEOUT'});assert.equal(timeout.sockets[0].closed,true);
  await assert.rejects(timedInfo.targets(),{code:'CHROME_EXISTING_DISCONNECTED'});assert.equal(timeout.sockets.length,1);
});

test('only the fixed work domains and official extension setup URLs are admitted',()=>{
  for(const url of ['https://www.temu.com/','https://www.dianxiaomi.com/','https://erp.91miaoshou.com/','chrome://extensions/','chrome://extensions/?id=ioadaikpljilagoddljnamloiebcoopb','https://chromewebstore.google.com/detail/ioadaikpljilagoddljnamloiebcoopb'])assert.equal(isExistingChromeWorkUrl(url),true,url);
  for(const url of ['http://www.temu.com/','https://temu.com.attacker.example/','https://user:secret@www.temu.com/','https://www.temu.com:777/','chrome://settings/','chrome://extensions/?id=another-extension','file:///private','javascript:alert(1)','about:blank'])assert.equal(isExistingChromeWorkUrl(url),false,url);
});
