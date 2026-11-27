import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {listeningOwners,matchesProfile} from './chrome-owner.mjs';

const execute=promisify(execFile);
const normalize=value=>path.win32.normalize(value).replace(/[\\/]+$/,'').toLowerCase();
const failure=(message,code='CHROME_EXISTING_UNAVAILABLE')=>Object.assign(new Error(message),{code});
const setupMessage='请在已经登录并装有店小秘插件的谷歌浏览器打开 chrome://inspect/#remote-debugging，开启远程调试，再回工作台连接并在谷歌弹窗中点击允许。无需关闭或重启谷歌。';
const disconnected=()=>failure('谷歌连接已断开或远程调试授权已撤回，任务已停止。请保留页面，重新检查连接后再继续。','CHROME_EXISTING_DISCONNECTED');
const endpointCapabilities=new WeakMap();
const pageMethods=new Set(['Runtime.evaluate','Page.enable','Page.disable','Page.navigate','Page.getFrameTree','Page.captureScreenshot','Page.bringToFront','Page.stopLoading','DOM.getDocument','DOM.querySelector','DOM.querySelectorAll','DOM.setFileInputFiles','Network.enable','Network.disable','Network.getResponseBody','Input.dispatchMouseEvent','Input.dispatchKeyEvent','Input.insertText','Emulation.setFocusEmulationEnabled']);

export function defaultExistingChromeDirectory(localAppData=process.env.LOCALAPPDATA){
  if(typeof localAppData!=='string'||!path.win32.isAbsolute(localAppData)||localAppData.startsWith('\\\\'))throw failure('无法确定当前 Windows 用户的谷歌浏览器目录。','CHROME_EXISTING_PROFILE_INVALID');
  return path.win32.join(localAppData,'Google','Chrome','User Data');
}

export function parseExistingChromeEndpoint(content){
  if(typeof content!=='string'||content.length>1024)throw failure('谷歌远程调试文件格式无效，请关闭再开启浏览器的远程调试。','CHROME_EXISTING_ENDPOINT_INVALID');
  const lines=content.trim().split(/\r?\n/);
  if(lines.length!==2||!/^\d{1,5}$/.test(lines[0])||!/^\/devtools\/browser(?:\/[A-Za-z0-9_-]{1,128})?$/.test(lines[1]))throw failure('谷歌远程调试文件格式无效，请关闭再开启浏览器的远程调试。','CHROME_EXISTING_ENDPOINT_INVALID');
  const port=Number(lines[0]);
  if(port<1||port>65535)throw failure('谷歌远程调试端口无效。','CHROME_EXISTING_ENDPOINT_INVALID');
  return {port,ws:'ws://127.0.0.1:'+port+lines[1]};
}

function businessUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['temu.com','dianxiaomi.com','91miaoshou.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host));}catch{return false;}
}

export function isExistingChromeWorkUrl(value,{allowBlank=false}={}){
  if(value==='about:blank')return allowBlank;
  if(businessUrl(value))return true;
  try{
    const url=new URL(value);
    if(url.username||url.password||url.port)return false;
    if(url.protocol==='chrome:')return url.hostname==='extensions'&&url.pathname==='/'&&!url.hash&&(!url.search||url.search==='?id=ioadaikpljilagoddljnamloiebcoopb');
    return url.protocol==='https:'&&url.hostname==='chromewebstore.google.com'&&/^\/detail\/(?:[^/]+\/)?ioadaikpljilagoddljnamloiebcoopb\/?$/.test(url.pathname);
  }catch{return false;}
}

function safeTarget(target){
  return {id:target.targetId,targetId:target.targetId,type:target.type,url:target.url,title:target.title||'',...(target.openerId?{openerId:target.openerId}:{}),...(target.browserContextId?{browserContextId:target.browserContextId}:{})};
}

function nativeTransport(ws,{connectTimeoutMs,commandTimeoutMs}){
  const pending=new Map(),handlers=new Map();
  let sequence=0,dead=false,opened=false;
  let rejectOpening;
  const fail=error=>{
    if(dead)return;
    dead=true;
    rejectOpening?.(error);
    for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}
    pending.clear();
    handlers.clear();
  };
  ws.addEventListener('message',event=>{
    if(dead)return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.method){
      for(const fn of handlers.get((message.sessionId||'')+'|'+message.method)||[]){try{fn(message.params);}catch{}}
      return;
    }
    const task=pending.get(message.id);
    if(!task||task.sessionId!==(message.sessionId||''))return;
    pending.delete(message.id);clearTimeout(task.timer);
    if(message.error)task.reject(failure('谷歌页面操作失败，请检查当前页面后再继续。','CHROME_EXISTING_CDP_ERROR'));else task.resolve(message.result||{});
  });
  const approvalError=()=>failure('谷歌尚未允许工作台连接。请在谷歌浏览器的远程调试弹窗中点击允许，再回工作台重新连接。','CHROME_EXISTING_APPROVAL_REQUIRED');
  ws.addEventListener('close',()=>fail(opened?disconnected():approvalError()));
  ws.addEventListener('error',()=>{fail(opened?disconnected():approvalError());try{ws.close();}catch{}});
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{fail(approvalError());try{ws.close();}catch{}},connectTimeoutMs);
    rejectOpening=error=>{clearTimeout(timer);reject(error);};
    ws.addEventListener('open',()=>{if(dead){try{ws.close();}catch{}return;}clearTimeout(timer);opened=true;rejectOpening=null;resolve();},{once:true});
  });
  return {
    ready,
    get alive(){return opened&&!dead;},
    send(method,params={},sessionId=''){
      if(!opened||dead)return Promise.reject(disconnected());
      return new Promise((resolve,reject)=>{
        const id=++sequence;
        const timer=setTimeout(()=>{fail(failure('谷歌页面操作超时，连接已停止。请先核对页面结果，再重新检查连接，避免重复提交。','CHROME_EXISTING_CDP_TIMEOUT'));try{ws.close();}catch{}},commandTimeoutMs);
        pending.set(id,{resolve,reject,timer,sessionId});
        try{ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}catch{fail(disconnected());try{ws.close();}catch{}}
      });
    },
    on(method,fn,sessionId=''){
      if(dead)throw disconnected();
      const key=sessionId+'|'+method;
      if(!handlers.has(key))handlers.set(key,new Set());
      handlers.get(key).add(fn);
      return ()=>handlers.get(key)?.delete(fn);
    },
    disconnect(){fail(disconnected());try{ws.close();}catch{}}
  };
}

function createSession(transport,state,{navigationTimeoutMs=10000}={}){
  let contextChosen=false,browserContextId;
  let createQueue=Promise.resolve();
  const owned=state.owned;
  const currentTargets=new Map();
  const navigationDeadlines=new Map();
  const allowed=target=>target?.type==='page'&&isExistingChromeWorkUrl(target.url,{allowBlank:owned.has(target.targetId)})&&(!contextChosen||!browserContextId||target.browserContextId===browserContextId);
  const remember=targets=>{
    // Only descendants of our own work pages inherit ownership. Existing user
    // tabs are never adopted simply because their URL is a business page.
    for(let round=0;round<targets.length;round++){
      let changed=false;
      for(const target of targets)if(!owned.has(target.targetId)&&owned.has(target.openerId)&&target.type==='page'&&isExistingChromeWorkUrl(target.url,{allowBlank:true})){owned.add(target.targetId);changed=true;}
      if(!changed)break;
    }
    currentTargets.clear();for(const target of targets)currentTargets.set(target.targetId,target);
    return targets;
  };
  const allTargets=async()=>remember((await transport.send('Target.getTargets')).targetInfos||[]);
  const chooseContext=targets=>{
    if(contextChosen)return;
    const contexts=new Set(targets.filter(target=>target.type==='page'&&businessUrl(target.url)).map(target=>target.browserContextId||''));
    if(contexts.size>1)throw failure('检测到多个谷歌用户中的业务页面。请只保留本次店小秘账号所在谷歌用户的 Temu、店小秘和妙手页面，再重新检查连接。','CHROME_EXISTING_PROFILE_AMBIGUOUS');
    browserContextId=contexts.values().next().value||undefined;contextChosen=true;
  };
  const targets=async()=>{const list=await allTargets();chooseContext(list);return list.filter(allowed).map(safeTarget);};
  const requireTarget=async targetId=>{
    if(typeof targetId!=='string'||!targetId)throw failure('未指定工作页面。','CHROME_EXISTING_TARGET_DENIED');
    while(true){
      const list=await allTargets();chooseContext(list);
      const target=list.find(item=>item.targetId===targetId);
      if(allowed(target))return target;
      // Chrome can report an empty URL between navigation and document commit.
      // Wait for metadata only; never dispatch a page command to an unknown URL.
      const deadline=navigationDeadlines.get(targetId);
      if(target?.type==='page'&&target.url===''&&owned.has(targetId)&&deadline!==undefined&&(!browserContextId||target.browserContextId===browserContextId)){
        const remaining=deadline-Date.now();
        if(remaining<=0)throw failure('页面跳转后网址仍未就绪，已停止操作，请核对保留的页面。','CHROME_EXISTING_NAVIGATION_TIMEOUT');
        await new Promise(resolve=>setTimeout(resolve,Math.min(100,remaining)));
        continue;
      }
      navigationDeadlines.delete(targetId);
      throw failure('该页面已关闭或已离开本次业务范围，工作台已停止操作。','CHROME_EXISTING_TARGET_DENIED');
    }
  };
  const createTarget=params=>{
    const operation=createQueue.then(async()=>{
      const url=params.url||'about:blank';
      if(!isExistingChromeWorkUrl(url,{allowBlank:true}))throw failure('只能在日常谷歌中打开 Temu、店小秘、妙手或店小秘插件设置页面。','CHROME_EXISTING_TARGET_DENIED');
      if(Object.keys(params).some(key=>!['url','background','newWindow'].includes(key)))throw failure('工作窗口参数无效。','CHROME_EXISTING_TARGET_DENIED');
      const list=await allTargets();chooseContext(list);
      const anchor=list.find(target=>owned.has(target.targetId)&&allowed(target));
      // Chrome's createTarget has no windowId parameter. Activating an owned
      // page selects the existing work window; otherwise create a fresh window.
      if(anchor)await transport.send('Target.activateTarget',{targetId:anchor.targetId});
      const result=await transport.send('Target.createTarget',{url,background:!!params.background,newWindow:!anchor,...(browserContextId?{browserContextId}:{})});
      if(typeof result.targetId!=='string'||!result.targetId)throw failure('谷歌未返回工作页面，已停止。','CHROME_EXISTING_CDP_ERROR');
      owned.add(result.targetId);
      navigationDeadlines.set(result.targetId,Date.now()+navigationTimeoutMs);
      // With no business tab open yet, Chrome chooses its default profile. Bind
      // subsequent page access to the actual context of our first created tab.
      if(!browserContextId){const created=(await allTargets()).find(target=>target.targetId===result.targetId);browserContextId=created?.browserContextId||undefined;}
      return result;
    });
    createQueue=operation.catch(()=>{});return operation;
  };
  const browserSend=async(method,params={})=>{
    if(!transport.alive)throw disconnected();
    if(method==='Target.createTarget')return createTarget(params);
    if(method==='Target.getTargets')return {targetInfos:(await targets()).map(({id,...target})=>target)};
    if(method==='Target.getTargetInfo')return {targetInfo:safeTarget(await requireTarget(params.targetId))};
    if(method==='Target.activateTarget'){await requireTarget(params.targetId);return transport.send(method,{targetId:params.targetId});}
    if(method==='Target.closeTarget'){
      if(!owned.has(params.targetId))throw failure('工作台不会关闭用户原有的谷歌标签页。','CHROME_EXISTING_TARGET_NOT_OWNED');
      await requireTarget(params.targetId);
      const result=await transport.send(method,{targetId:params.targetId});
      if(result.success!==false){owned.delete(params.targetId);navigationDeadlines.delete(params.targetId);}
      return result;
    }
    if(method==='Browser.getVersion')return transport.send(method);
    throw failure('此操作不适用于已登录的日常谷歌浏览器。','CHROME_EXISTING_COMMAND_DENIED');
  };
  const acquire=()=>{
    if(!transport.alive)throw disconnected();
    let closed=false;
    const unsubscribers=new Set();
    return {
      send(method,params){if(closed)return Promise.reject(disconnected());return browserSend(method,params);},
      async evaluate(){throw failure('请通过具体工作页面读取或操作内容。','CHROME_EXISTING_COMMAND_DENIED');},
      on(method,fn){
        if(closed)throw disconnected();
        if(!['Target.targetCreated','Target.targetInfoChanged','Target.targetDestroyed'].includes(method))throw failure('此浏览器事件不在工作台业务范围。','CHROME_EXISTING_COMMAND_DENIED');
        const off=transport.on(method,params=>{
          const target=params.targetInfo||currentTargets.get(params.targetId);
          if(allowed(target))fn(params);
        });unsubscribers.add(off);return ()=>{off();unsubscribers.delete(off);};
      },
      close(){if(closed)return;closed=true;for(const off of unsubscribers)off();unsubscribers.clear();}
    };
  };
  const page=async targetId=>{
    await requireTarget(targetId);
    const {sessionId}=await transport.send('Target.attachToTarget',{targetId,flatten:true});
    if(typeof sessionId!=='string'||!sessionId)throw failure('无法连接工作页面。','CHROME_EXISTING_CDP_ERROR');
    let closed=false;
    const unsubscribers=new Set();
    let duplicateDialog=false;
    unsubscribers.add(transport.on('Page.javascriptDialogOpening',event=>{
      const target=currentTargets.get(targetId);
      duplicateDialog=owned.has(targetId)&&allowed(target)&&/^https:\/\/(?:www\.)?temu\.com\//.test(target?.url||'')&&['confirm','alert'].includes(event.type)&&/^(?:该|此)?(?:产品|商品)在店小秘已有采集记录[，,。.!！?\s]*(?:是否继续采集[？?]?)?$/.test(String(event.message||'').trim());
    },sessionId));
    unsubscribers.add(transport.on('Page.javascriptDialogClosed',()=>{duplicateDialog=false;},sessionId));
    const send=async(method,params={})=>{
      if(closed)throw disconnected();
      const dismissDuplicate=method==='Page.handleJavaScriptDialog'&&duplicateDialog&&params.accept===false&&Object.keys(params).length===1;
      if(!pageMethods.has(method)&&!dismissDuplicate)throw failure('此页面操作不在工作台业务范围。','CHROME_EXISTING_COMMAND_DENIED');
      await requireTarget(targetId);
      if(dismissDuplicate)duplicateDialog=false;
      if(method==='Page.navigate'){
        if(!isExistingChromeWorkUrl(params.url,{allowBlank:owned.has(targetId)}))throw failure('工作页面不能跳转到本次业务之外的网址。','CHROME_EXISTING_TARGET_DENIED');
        if(owned.has(targetId))navigationDeadlines.set(targetId,Date.now()+navigationTimeoutMs);
      }
      return transport.send(method,params,sessionId);
    };
    return {
      send,
      on(method,fn){
        if(closed)throw disconnected();
        const off=transport.on(method,params=>{if(allowed(currentTargets.get(targetId)))fn(params);},sessionId);
        unsubscribers.add(off);return ()=>{off();unsubscribers.delete(off);};
      },
      async evaluate(fn,arg){
        const expression=`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`;
        const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
        return result.result?.value;
      },
      close(){
        if(closed)return Promise.resolve();closed=true;
        for(const off of unsubscribers)off();unsubscribers.clear();
        // Detaching a CDP session never closes its page or the user's browser.
        return transport.alive?transport.send('Target.detachFromTarget',{sessionId}).catch(()=>{}):Promise.resolve();
      }
    };
  };
  const capability=Object.freeze({kind:'existing-chrome'});
  endpointCapabilities.set(capability,{acquire,page});
  return {transport,capability,targets,page};
}

export function isExistingChromeEndpoint(value){return typeof value==='object'&&value!==null&&endpointCapabilities.has(value);}
export function existingChromeHandle(value){const session=endpointCapabilities.get(value);if(!session)throw failure('谷歌连接引用无效。','CHROME_EXISTING_ENDPOINT_INVALID');return session.acquire();}
export function existingChromePage(value,targetId){const session=endpointCapabilities.get(value);if(!session)throw failure('谷歌连接引用无效。','CHROME_EXISTING_ENDPOINT_INVALID');return session.page(targetId);}

// The factory's injected filesystem, process runner and socket are only for
// isolated tests. Production calls always use the current Windows user's paths.
export function createExistingChromeConnector({platform=process.platform,localAppData=process.env.LOCALAPPDATA,programFiles=process.env.PROGRAMFILES,programFilesX86=process.env['PROGRAMFILES(X86)'],systemRoot=process.env.SystemRoot||'C:\\Windows',fileSystem=fs,run=execute,createWebSocket=url=>new WebSocket(url),connectTimeoutMs=45000,commandTimeoutMs=20000,navigationTimeoutMs=10000}={}){
  const sessions=new Map(),pendingConnections=new Map(),ownership=new Map();
  const directory=()=>defaultExistingChromeDirectory(localAppData);
  async function discover(config){
    if(platform!=='win32')throw failure('复用日常谷歌目前支持 Windows。','CHROME_EXISTING_PLATFORM_UNSUPPORTED');
    const expected=directory();
    if(config?.type!=='chrome'||config.connectionMode!=='existing'||typeof config.userDataDir!=='string'||!path.win32.isAbsolute(config.userDataDir)||normalize(config.userDataDir)!==normalize(expected)||(config.executable&&typeof config.executable!=='string'))throw failure('日常谷歌必须使用当前 Windows 用户的默认 Chrome 目录，请重新保存连接设置。','CHROME_EXISTING_PROFILE_INVALID');
    if(['ws','wsEndpoint','browserUrl','localApi'].some(key=>config[key]))throw failure('日常谷歌不接受手动指定的调试连接地址。','CHROME_EXISTING_ENDPOINT_INVALID');
    const endpointFile=path.win32.join(expected,'DevToolsActivePort');
    let content;
    try{
      const dirStat=await fileSystem.lstat(expected),stat=await fileSystem.lstat(endpointFile);
      if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>1024||normalize(await fileSystem.realpath(expected))!==normalize(expected)||normalize(await fileSystem.realpath(endpointFile))!==normalize(endpointFile))throw failure('谷歌远程调试文件位置无效。','CHROME_EXISTING_ENDPOINT_INVALID');
      content=await fileSystem.readFile(endpointFile,'utf8');
    }catch(error){
      if(error.code==='ENOENT')throw failure(setupMessage,'CHROME_EXISTING_SETUP_REQUIRED');
      if(error.code?.startsWith('CHROME_EXISTING_'))throw error;
      throw failure('无法读取谷歌远程调试状态，请确认日常谷歌正在运行并开启远程调试。','CHROME_EXISTING_ENDPOINT_UNREADABLE');
    }
    const endpoint=parseExistingChromeEndpoint(content);
    let listeners;
    try{
      const result=await run(path.win32.join(systemRoot,'System32','netstat.exe'),['-ano','-p','tcp'],{windowsHide:true,timeout:45000,maxBuffer:8*1024*1024,encoding:'utf8'});
      listeners=listeningOwners(result.stdout,endpoint.port);
    }catch{throw failure('无法核对谷歌远程调试端口，本次尚未连接。请稍后重新检查连接。','CHROME_EXISTING_OWNER_CHECK_FAILED');}
    if(!listeners.length)throw failure('谷歌远程调试当前未运行。请检查浏览器是否仍打开，然后重新开启远程调试。','CHROME_EXISTING_BROWSER_CLOSED');
    if(!listeners.some(item=>item.address==='127.0.0.1')||listeners.some(item=>!['127.0.0.1','::1'].includes(item.address))||new Set(listeners.map(item=>item.pid)).size!==1)throw failure('谷歌远程调试端口归属不明确，已停止连接。','CHROME_EXISTING_OWNER_MISMATCH');
    const pid=listeners[0].pid;
    const script=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $currentSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $rows=@(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop | ForEach-Object { $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid -ErrorAction Stop; [pscustomobject]@{pid=[int]$_.ProcessId;name=$_.Name;commandLine=$_.CommandLine;executablePath=$_.ExecutablePath;ownerSid=$owner.Sid} }); [pscustomobject]@{currentSid=$currentSid;processes=$rows} | ConvertTo-Json -Depth 4 -Compress`;
    let report;
    try{
      const result=await run(path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,maxBuffer:1024*1024,encoding:'utf8'});
      report=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
    }catch{throw failure('无法核对谷歌进程所属用户，本次尚未连接。请重新检查连接。','CHROME_EXISTING_OWNER_CHECK_FAILED');}
    const processInfo=report?.processes?.length===1?report.processes[0]:null;
    const installed=[programFiles,programFilesX86,localAppData].filter(Boolean).map(root=>path.win32.join(root,'Google','Chrome','Application','chrome.exe'));
    const executable=processInfo?.executablePath;
    if(!processInfo||processInfo.pid!==pid||processInfo.name?.toLowerCase()!=='chrome.exe'||typeof processInfo.commandLine!=='string'||!processInfo.commandLine.trim()||!/^S-1-[0-9-]+$/.test(report.currentSid)||processInfo.ownerSid!==report.currentSid||typeof executable!=='string'||!installed.some(file=>normalize(file)===normalize(executable))||(config.executable&&normalize(config.executable)!==normalize(executable)))throw failure('调试端口不属于当前用户的已安装谷歌浏览器，已停止连接。','CHROME_EXISTING_OWNER_MISMATCH');
    const command=processInfo.commandLine;
    if(/(?:^|\s)"?--type(?:=|\s|$)/i.test(command)||(/(?:^|\s)"?--user-data-dir(?:=|\s|$)/i.test(command)&&!matchesProfile(processInfo,expected)))throw failure('调试端口属于其他 Chrome 数据目录，已停止连接。','CHROME_EXISTING_OWNER_MISMATCH');
    try{
      const stat=await fileSystem.lstat(executable);
      if(!stat.isFile()||stat.isSymbolicLink()||normalize(await fileSystem.realpath(executable))!==normalize(executable))throw new Error();
      if(await fileSystem.readFile(endpointFile,'utf8')!==content)throw new Error();
    }catch{throw failure('谷歌进程或调试文件在检查时发生变化，请重新检查连接。','CHROME_EXISTING_OWNER_CHANGED');}
    return {...endpoint,pid,key:normalize(expected)+'|'+pid+'|'+endpoint.ws};
  }
  async function inspect(config){
    try{
      const found=await discover(config),connected=!!sessions.get(found.key)?.transport.alive;
      return {state:connected?'available':'needs-authorization',connected,code:connected?'CHROME_EXISTING_CONNECTED':'CHROME_EXISTING_APPROVAL_REQUIRED',message:connected?'已连接用户当前的谷歌浏览器；登录状态和插件继续使用原有配置。':'已找到日常谷歌的远程调试入口。请点击连接，并在谷歌弹窗中允许工作台连接。',port:found.port,pid:found.pid};
    }catch(error){return {state:error.code==='CHROME_EXISTING_SETUP_REQUIRED'?'needs-authorization':'unavailable',connected:false,code:error.code||'CHROME_EXISTING_UNAVAILABLE',message:error.message};}
  }
  async function connect(config){
    const found=await discover(config);
    let session=sessions.get(found.key);
    if(!session?.transport.alive){
      let pending=pendingConnections.get(found.key);
      if(!pending){
        pending=(async()=>{
          let socket;try{socket=createWebSocket(found.ws);}catch{throw failure('无法建立谷歌远程调试连接。请检查浏览器中的授权提示后重试。','CHROME_EXISTING_APPROVAL_REQUIRED');}
          const transport=nativeTransport(socket,{connectTimeoutMs,commandTimeoutMs});
          await transport.ready;
          const state=ownership.get(found.key)||{owned:new Set()};ownership.set(found.key,state);
          const created=createSession(transport,state,{navigationTimeoutMs});
          sessions.set(found.key,created);return created;
        })();
        pendingConnections.set(found.key,pending);
      }
      try{session=await pending;}finally{if(pendingConnections.get(found.key)===pending)pendingConnections.delete(found.key);}
    }
    return {source:'existing-chrome',ws:session.capability,targets:session.targets};
  }
  return {inspect,connect,disconnect(){for(const session of sessions.values())session.transport.disconnect();sessions.clear();}};
}

const connector=createExistingChromeConnector();
export const inspectExistingChrome=config=>connector.inspect(config);
export const connectExistingChrome=config=>connector.connect(config);
