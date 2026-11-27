import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createDxmPluginBrowser,readDxmExtensionsPage,DXM_EXTENSION_ID,DXM_PLUGIN_URLS} from '../src/dxm-plugin-browser.mjs';

let browser;
test.before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND']});});
test.after(()=>browser?.close());
const config={key:'fixture-browser',type:'chrome',name:'采集窗口',debugPort:9233,userDataDir:'C:\\fixture\\owned-profile'};

async function fixture(t,{items=[{id:DXM_EXTENSION_ID,name:'店小秘助手',state:'true',version:'2.9.9'}],empty=false,unknown=false,search='',owner='owned',failRead=false,failAttach=false,existing=[],browserConfig=config,failConnection=false,failOpen=false,onFront}={}){
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',()=>{throw new Error('Fixtures must not access a network endpoint');});
  const page=await context.newPage();await page.setContent('<extensions-manager></extensions-manager>');
  await page.evaluate(({items,empty,unknown,search})=>{
    const manager=document.querySelector('extensions-manager');
    const root=manager.attachShadow({mode:'open'});root.innerHTML='<style>:host{display:block}</style><input id="searchInput" type="search"><extensions-item-list></extensions-item-list>';
    root.querySelector('input').value=search;
    const list=root.querySelector('extensions-item-list').attachShadow({mode:'open'});list.innerHTML='<style>:host{display:block}extensions-item{display:block}</style>';
    if(empty){const p=document.createElement('p');p.id='no-items';p.textContent='您尚未安装任何扩展程序';list.append(p);}
    for(const data of items){const item=document.createElement('extensions-item');item.id=data.id;list.append(item);const content=item.attachShadow({mode:'open'});content.innerHTML='<style>:host{display:block}cr-toggle{display:block;width:30px;height:20px}</style><div id="name"></div><span id="version"></span><cr-toggle id="enableToggle"></cr-toggle>';content.querySelector('#name').textContent=data.name;content.querySelector('#version').textContent=data.version||'';const toggle=content.querySelector('cr-toggle');if(data.state!==undefined)toggle.setAttribute('aria-pressed',data.state);if(data.hidden)toggle.style.display='none';if(data.warning){const warning=document.createElement('p');warning.id='corrupted-warning';warning.textContent='扩展程序损坏';content.append(warning);}}
    if(unknown)manager.remove();
  },{items,empty,unknown,search});
  const calls=[],owned='check-owned-tab',targets=[...existing];let current='chrome://extensions/';
  const transport={
    inspectChromeOwner:async received=>{assert.deepEqual(received,browserConfig);calls.push('inspect');return owner;},
    connection:async received=>{assert.deepEqual(received,browserConfig);calls.push('connection');if(failConnection)throw new Error('connection refused or consent missing SECRET');return {ws:'fixture-bound-browser',targets:async()=>targets};},
    openChrome:async received=>{assert.deepEqual(received,browserConfig);calls.push('open');if(failOpen)throw new Error('Existing Chrome consent is required');return {ws:'fixture-bound-browser',targets:async()=>targets};},
    connect:async ws=>{assert.equal(ws,'fixture-bound-browser');return {send:async(method,args)=>{calls.push({method,args});if(method==='Target.createTarget'){current=args.url;targets.push({id:owned,type:'page',url:current});return {targetId:owned};}if(method==='Target.closeTarget'){assert.equal(args.targetId,owned,'existing user tabs must never be closed');return {success:true};}if(method==='Target.activateTarget')return {};throw new Error('Unexpected action '+method);},close(){calls.push('browser-socket-close');}};},
    pageById:async(_info,id)=>{assert.equal(id,owned);if(failAttach)throw new Error('attachment failed SECRET');return {send:async(method,args)=>{calls.push({method,args});assert.equal(method,'Page.bringToFront');await page.bringToFront();await onFront?.(page);return {};},evaluate:async(fn,arg)=>{if(failRead)throw new Error('read failed SECRET');return fn===readDxmExtensionsPage?page.evaluate(fn,arg):current;},close(){calls.push('page-socket-close');}};},
    poll:async(fn)=>{for(let attempt=0;attempt<12;attempt++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,120));}throw new Error('Readiness timeout SECRET');}
  };
  return {adapter:createDxmPluginBrowser({},transport),transport,page,calls};
}

test('enabled official plugin is detected from rendered shadow DOM without reporting login success',async t=>{
  const f=await fixture(t),result=await f.adapter.check({browserConfig:config});
  assert.equal(result.status,'ready');assert.equal(result.version,'2.9.9');assert.equal(result.name,'店小秘助手');assert.ok(Date.parse(result.checkedAt));assert.match(result.message,/不代表登录或采集成功/);
  assert.deepEqual(f.calls.slice(0,2),['inspect','connection']);assert.ok(!f.calls.includes('open'));
  assert.deepEqual(f.calls.filter(call=>typeof call==='object').map(call=>call.method),['Target.createTarget','Target.activateTarget','Page.bringToFront','Target.closeTarget']);
  assert.equal(f.calls.find(call=>call?.method==='Target.createTarget').args.background,false);
});

test('foreground detection waits for extension cards appended after the initial six on later animation frames',async t=>{
  const items=Array.from({length:6},(_,index)=>({id:String.fromCharCode(97+index).repeat(32),name:'Fixture extension '+index,state:'true'}));
  const f=await fixture(t,{items,existing:[{id:'user-extension-page',type:'page',url:'chrome://extensions/'}],onFront:async page=>page.evaluate(()=>{window.fixtureVisible=true;document.dispatchEvent(new Event('visibilitychange'));window.fixtureRenderRemaining();})});
  await f.page.evaluate(extensionId=>{
    window.fixtureVisible=false;window.fixturePaints=0;
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>!window.fixtureVisible});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixtureVisible?'visible':'hidden'});
    window.fixtureRenderRemaining=()=>{
      const paint=()=>{
        if(++window.fixturePaints<8)return requestAnimationFrame(paint);
        const list=document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot;
        const item=document.createElement('extensions-item');item.id=extensionId;
        item.attachShadow({mode:'open'}).innerHTML='<style>:host{display:block}cr-toggle{display:block;width:30px;height:20px}</style><div id="name">店小秘助手</div><span id="version">2.9.9</span><cr-toggle id="enableToggle" aria-pressed="true"></cr-toggle>';
        list.append(item);
      };
      requestAnimationFrame(paint);
    };
  },DXM_EXTENSION_ID);
  assert.equal(await f.page.evaluate(()=>document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelectorAll('extensions-item').length),6);
  const result=await f.adapter.check({browserConfig:config});
  assert.equal(result.status,'ready','a partial list must not become a missing-plugin verdict');
  assert.equal(result.version,'2.9.9');assert.ok(await f.page.evaluate(()=>window.fixturePaints>=8));
  for(const method of ['Target.activateTarget','Target.closeTarget'])assert.deepEqual(f.calls.filter(call=>call?.method===method).map(call=>call.args.targetId),['check-owned-tab'],'only the new check page may be activated or closed');
});

test('a hidden or non-visible extensions document cannot report the plugin missing or enabled',async t=>{
  for(const options of [{items:[],empty:true},{}]){
    const f=await fixture(t,{...options,existing:[{id:'user-page',type:'page',url:'https://www.temu.com/'}]});
    await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});});
    assert.equal((await f.page.evaluate(readDxmExtensionsPage,{extensionId:DXM_EXTENSION_ID})).status,'unknown');
    const result=await f.adapter.check({browserConfig:config});
    assert.equal(result.status,'unknown');assert.doesNotMatch(result.message,/未检测到官方|已启用/);assert.match(result.message,/前台/);assert.match(result.message,/重新检测/);
    assert.deepEqual(f.calls.filter(call=>call?.method==='Target.closeTarget').map(call=>call.args.targetId),['check-owned-tab']);
  }
  const f=await fixture(t);await f.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});});
  assert.equal((await f.page.evaluate(readDxmExtensionsPage,{extensionId:DXM_EXTENSION_ID})).status,'unknown');
});

test('a visible document that stops painting yields unknown with a bounded wait',async t=>{
  const f=await fixture(t);await f.page.evaluate(()=>{window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};});
  const result=await f.page.evaluate(readDxmExtensionsPage,{extensionId:DXM_EXTENSION_ID});
  assert.equal(result.status,'unknown');assert.equal(result.reason,'not-painted');
});

test('disabled or browser-blocked official extensions remain blocked',async t=>{
  for(const detail of [{state:'false'},{state:'true',warning:true}]){const f=await fixture(t,{items:[{id:DXM_EXTENSION_ID,name:'店小秘助手',version:'2.9.9',...detail}]});const result=await f.adapter.check({browserConfig:config});assert.equal(result.status,'disabled');assert.match(result.message,/启用|阻止/);}
});

test('a settled empty list or list of different extensions reports missing',async t=>{
  for(const options of [{items:[],empty:true},{items:[{id:'nmmhkkegccagdldgiimedpiccmgmieda',name:'Google Payments',state:'true'}]}]){const f=await fixture(t,options),result=await f.adapter.check({browserConfig:config});assert.equal(result.status,'missing');assert.match(result.message,/不会自动带入/);}
});

test('unknown, filtered, incomplete or ambiguous DOM never reports missing or ready',async t=>{
  for(const options of [{unknown:true},{search:'other extension'},{items:[],empty:false},{items:[{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',name:'店小秘助手',state:'true'}]},{items:[{id:DXM_EXTENSION_ID,name:'店小秘助手'}]},{items:[{id:DXM_EXTENSION_ID,name:'店小秘助手',state:'true',hidden:true}]}]){const f=await fixture(t,options),observed=await f.page.evaluate(readDxmExtensionsPage,{extensionId:DXM_EXTENSION_ID});assert.equal(observed.status,'unknown');}
});

test('closed or unowned browsers do not create or connect to tabs',async t=>{
  for(const owner of ['closed','wrong']){const f=await fixture(t,{owner}),result=await f.adapter.check({browserConfig:config});assert.equal(result.status,owner==='closed'?'browser-closed':'unknown');assert.deepEqual(f.calls,['inspect']);}
});

test('read and page-attachment failures redact raw errors and clean up only the created target',async t=>{
  for(const options of [{failRead:true},{failAttach:true}]){const f=await fixture(t,{...options,existing:[{id:'user-tab',type:'page',url:'https://www.temu.com/'}]}),result=await f.adapter.check({browserConfig:config});assert.equal(result.status,'unknown');assert.doesNotMatch(JSON.stringify(result),/SECRET/);assert.deepEqual(f.calls.filter(call=>call?.method==='Target.closeTarget').map(call=>call.args.targetId),['check-owned-tab']);assert.equal(f.calls.at(-1),'browser-socket-close');}
});

test('setup reuses only exact allowlisted tabs in the bound persistent browser',async t=>{
  for(const view of ['install','manage','help'])for(const reuse of [false,true]){
    const url=DXM_PLUGIN_URLS[view],f=await fixture(t,{existing:reuse?[{id:'existing-setup',type:'page',url}]:[{id:'user-page',type:'page',url:'https://www.temu.com/'}]});
    const result=await f.adapter.openSetup({browserConfig:config,view});assert.equal(result.browserName,'采集窗口');assert.equal(result.opened,true);assert.equal(f.calls[0],'open');
    const created=f.calls.filter(call=>call?.method==='Target.createTarget');assert.equal(created.length,reuse?0:1);if(!reuse)assert.equal(created[0].args.url,url);
    const activation=f.calls.find(call=>call?.method==='Target.activateTarget');assert.equal(activation.args.targetId,reuse?'existing-setup':'check-owned-tab');assert.ok(!f.calls.some(call=>call?.method==='Target.closeTarget'),'keep setup tab for the user');
  }
});

test('setup rejects arbitrary URLs and non-Chrome bindings before loading a browser',async t=>{
  const f=await fixture(t);await assert.rejects(f.adapter.openSetup({browserConfig:config,view:'https://malicious.example'}),{status:400});await assert.rejects(f.adapter.openSetup({browserConfig:{type:'bit'},view:'install'}),{status:400});assert.deepEqual(f.calls,[]);
});

const existingConfig={...config,connectionMode:'existing',userDataDir:'C:\\Users\\Fixture\\AppData\\Local\\Google\\Chrome\\User Data'};

test('existing Chrome delegates ownership and consent to connection without using the dedicated-profile owner check',async t=>{
  const f=await fixture(t,{browserConfig:existingConfig});
  f.transport.inspectChromeOwner=async()=>{throw new Error('Existing Chrome must not use --user-data-dir ownership');};
  const result=await f.adapter.check({browserConfig:existingConfig});
  assert.equal(result.status,'ready');assert.equal(f.calls[0],'connection');assert.ok(!f.calls.includes('open'));
  assert.deepEqual(f.calls.filter(call=>call?.method==='Target.closeTarget').map(call=>call.args.targetId),['check-owned-tab']);
});

test('existing Chrome connection rejection remains unknown without opening another browser or touching tabs',async t=>{
  const f=await fixture(t,{browserConfig:existingConfig,failConnection:true}),result=await f.adapter.check({browserConfig:existingConfig});
  assert.equal(result.status,'unknown');assert.match(result.message,/已有谷歌窗口/);assert.match(result.message,/远程调试授权/);assert.match(result.message,/原任务保留/);assert.doesNotMatch(JSON.stringify(result),/SECRET|专用窗口|重新安装/);assert.deepEqual(f.calls,['connection']);
});

test('existing Chrome extension-page denial stays unknown and cleans up only its own check tab',async t=>{
  const f=await fixture(t,{browserConfig:existingConfig,failAttach:true,existing:[{id:'existing-product',type:'page',url:'https://www.temu.com/'}]}),result=await f.adapter.check({browserConfig:existingConfig});
  assert.equal(result.status,'unknown');assert.doesNotMatch(result.message,/未安装|已启用/);assert.ok(!f.calls.includes('inspect'));assert.ok(!f.calls.includes('open'));
  assert.deepEqual(f.calls.filter(call=>call?.method==='Target.closeTarget').map(call=>call.args.targetId),['check-owned-tab']);
});

test('missing plugin in existing Chrome asks to check the correct profile instead of claiming a new isolated browser',async t=>{
  const f=await fixture(t,{browserConfig:existingConfig,items:[],empty:true}),result=await f.adapter.check({browserConfig:existingConfig});
  assert.equal(result.status,'missing');assert.match(result.message,/正确浏览器资料/);assert.doesNotMatch(result.message,/专用窗口|不会自动带入|重新安装/);
});

test('existing Chrome setup preserves its binding and does not fall back if authorization fails',async t=>{
  const f=await fixture(t,{browserConfig:existingConfig}),result=await f.adapter.openSetup({browserConfig:existingConfig,view:'manage'});
  assert.equal(f.calls[0],'open');assert.match(result.message,/已有谷歌窗口/);assert.doesNotMatch(result.message,/专用|独立/);
  const denied=await fixture(t,{browserConfig:existingConfig,failOpen:true});await assert.rejects(denied.adapter.openSetup({browserConfig:existingConfig,view:'manage'}),/consent/);assert.deepEqual(denied.calls,['open']);
});
