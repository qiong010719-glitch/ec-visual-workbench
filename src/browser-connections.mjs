import crypto from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const execute=promisify(execFile);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const validKey=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const unavailable='暂时无法核对 Chrome 端口和专用窗口，请稍后重试；尚未修改配置或打开浏览器。';

// Keep these pure checks inside the packaged app. The ERP runner's equivalent
// helpers live outside app.asar, so a relative import would break desktop startup.
function matchesProfile(processInfo,directory){
  if(processInfo?.name?.toLowerCase()!=='chrome.exe'||typeof processInfo.commandLine!=='string')return false;
  const command=processInfo.commandLine;
  const switches=[...command.matchAll(/(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+))(?=\s|$)/gi)];
  const count=[...command.matchAll(/(?:^|\s)"?--user-data-dir(?:=|\s|$)/gi)].length;
  if(count!==1||switches.length!==1)return false;
  const actual=switches[0].slice(1).find(Boolean);
  return path.win32.isAbsolute(actual)&&path.win32.normalize(actual).replace(/[\\/]+$/,'').toLowerCase()===path.win32.normalize(directory).replace(/[\\/]+$/,'').toLowerCase();
}

// Inspect operating-system metadata only. Never connect to a debugging endpoint or
// return process command lines, which can contain URLs and other private data.
export async function readChromeSnapshot({run=execute,platform=process.platform,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
  if(platform!=='win32')throw fail(503,'当前 Chrome 专用窗口检查支持 Windows。');
  try{
    const result=await run(path.win32.join(systemRoot,'System32','netstat.exe'),['-ano','-p','tcp'],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024,encoding:'utf8'});
    const listeners=[];
    for(const line of result.stdout.split(/\r?\n/)){
      const fields=line.trim().split(/\s+/);
      if(fields[0]!=='TCP'||fields[3]!=='LISTENING'&&!['0.0.0.0:0','[::]:0'].includes(fields[2]))continue;
      const endpoint=/^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(fields[1]||'');
      const port=Number(endpoint?.[2]);
      const pid=Number(fields[4]);
      if(!endpoint||!Number.isInteger(port)||port<1||port>65535||fields.length!==5||!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid listener');
      listeners.push({address:endpoint[1].replace(/^\[|\]$/g,''),pid,port});
    }
    // Query all Chrome processes, including profiles without an active debug
    // listener: a running profile cannot safely switch to a different port.
    const script="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $rows=@(Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" -ErrorAction Stop | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;name=$_.Name;commandLine=$_.CommandLine} }); ConvertTo-Json -InputObject $rows -Compress";
    const response=await run(path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,maxBuffer:8*1024*1024,encoding:'utf8'});
    const processes=JSON.parse(response.stdout.replace(/^\uFEFF/,''));
    return checkedSnapshot({listeners,processes});
  }catch{throw fail(503,unavailable);}
}

function checkedSnapshot(snapshot){
  if(!snapshot||!Array.isArray(snapshot.listeners)||!Array.isArray(snapshot.processes))throw fail(503,unavailable);
  for(const listener of snapshot.listeners)if(!Number.isInteger(listener.port)||listener.port<1||listener.port>65535||!Number.isSafeInteger(listener.pid)||listener.pid<=0||typeof listener.address!=='string')throw fail(503,unavailable);
  const pids=new Set();
  for(const process of snapshot.processes){
    // An unreadable Chrome process might own this profile. Fail closed rather
    // than assuming that a profile with hidden arguments is unused.
    if(!Number.isSafeInteger(process.pid)||process.pid<=0||pids.has(process.pid)||typeof process.name!=='string'||process.name.toLowerCase()!=='chrome.exe'||typeof process.commandLine!=='string'||!process.commandLine.trim())throw fail(503,unavailable);
    pids.add(process.pid);
  }
  return snapshot;
}

function freePort(snapshot,browsers,browserKey){
  const reserved=new Set([...snapshot.listeners.map(listener=>listener.port),...browsers.filter(browser=>browser.type==='chrome'&&browser.key!==browserKey).map(browser=>Number(browser.debugPort))]);
  for(let port=9232;port<=65535;port++)if(!reserved.has(port))return port;
  throw fail(503,'未找到未占用的 Chrome 端口，请关闭不需要的专用窗口后重试。');
}

export function createBrowserConnections({preferences,inspector=readChromeSnapshot,existingInspector,configuration={},isBusy=()=>false}){
  const assertIdle=()=>{if(isBusy())throw fail(409,'有任务正在运行，请完成或暂停后修改浏览器连接配置。');};
  const assertRevision=revision=>{if(!Number.isSafeInteger(revision)||revision!==preferences.view().revision)throw fail(409,'连接配置已更新，请刷新后再保存。');};
  const snapshot=async()=>{
    try{return checkedSnapshot(await inspector());}
    catch{throw fail(503,unavailable);}
  };
  const inspectExisting=async browser=>{
    try{
      const directory=configuration.WORKBENCH_ADAPTER_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../scripts');
      const inspect=existingInspector||(await import(pathToFileURL(path.join(directory,'lib/chrome-existing.mjs')).href)).inspectExistingChrome;
      const result=await inspect(browser),state=['available','needs-authorization','unavailable'].includes(result?.state)?result.state:'unavailable';
      return {state,connectionMode:'existing',connected:result?.connected===true,message:String(result?.message||'无法核对当前 Chrome，请先在日常浏览器开启远程调试后重新检查。').slice(0,700)};
    }catch{return {state:'unavailable',connectionMode:'existing',connected:false,message:'无法核对当前 Chrome，请先在日常浏览器开启远程调试后重新检查；不会另开独立浏览器。'};}
  };

  function prepare(input,{saving=false}={}){
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'请填写 Chrome 浏览器配置。');
    const before=preferences.view();
    const key=input.key===undefined||input.key===''?(saving?null:'chrome-inspect-'+crypto.randomUUID()):input.key;
    if(!validKey(key))throw fail(400,'浏览器编号无效，请重新选择或新增专用窗口。');
    const previous=before.browsers.find(browser=>browser.key===key);
    if(input.type!==undefined&&input.type!=='chrome'||previous&&previous.type!=='chrome')throw fail(400,'此入口仅支持 Chrome 专用窗口，请使用新的窗口编号。');
    const name=typeof input.name==='string'?input.name.trim():saving?'':previous?.name||'谷歌浏览器';
    if(!name)throw fail(400,'请填写浏览器名称。');
    const mode=input.connectionMode??previous?.connectionMode??'dedicated';
    if(!['existing','dedicated'].includes(mode))throw fail(400,'Chrome 连接方式无效。');
    if(mode==='existing'){
      const browser={key,type:'chrome',name,connectionMode:'existing'};
      const browsers=before.browsers.map(saved=>saved.key===key?browser:saved);if(!previous)browsers.push(browser);
      const normalized=preferences.preview({revision:before.revision,browsers}).browsers.find(saved=>saved.key===key);
      return {before,previous,browser:normalized,browsers,reserved:null};
    }
    const debugPort=typeof input.debugPort==='number'||typeof input.debugPort==='string'&&/^\d+$/.test(input.debugPort)?Number(input.debugPort):NaN;
    if(!Number.isInteger(debugPort)||debugPort<1024||debugPort>65535)throw fail(400,'Chrome 连接端口应为 1024—65535 的整数。');
    const browser={key,type:'chrome',name,...(input.connectionMode||previous?.connectionMode?{connectionMode:'dedicated'}:{}),debugPort,executable:input.executable??previous?.executable??''};
    const browsers=before.browsers.map(saved=>saved.key===key?browser:saved);
    if(!previous)browsers.push(browser);
    const reserved=before.browsers.find(saved=>saved.key!==key&&saved.type==='chrome'&&saved.connectionMode!=='existing'&&Number(saved.debugPort)===debugPort);
    // A reserved port is a useful inspection result, not a generic preview
    // validation error. All saveable candidates use the existing normalizer.
    const normalized=reserved?null:preferences.preview({revision:before.revision,browsers}).browsers.find(saved=>saved.key===key);
    return {before,previous,browser:normalized||browser,browsers,reserved};
  }

  function inspectPrepared(prepared,current){
    const {before,previous,browser,reserved}=prepared;
    const debugPort=browser.debugPort;
    if(reserved)return {state:'occupied',debugPort,message:'此端口已分配给其他已保存的 Chrome 专用窗口，请选择其他端口。',suggestedPort:freePort(current,before.browsers,browser.key)};
    const listeners=current.listeners.filter(listener=>listener.port===debugPort);
    const ownProcesses=current.processes.filter(process=>matchesProfile(process,browser.userDataDir));
    const ownPids=new Set(ownProcesses.map(process=>process.pid));
    const oldPortRunning=previous&&Number(previous.debugPort)!==debugPort&&current.listeners.some(listener=>listener.port===Number(previous.debugPort)&&ownPids.has(listener.pid));
    const owned=listeners.length>0&&listeners.every(listener=>['127.0.0.1','::1'].includes(listener.address)&&ownPids.has(listener.pid));
    if(oldPortRunning||!owned&&ownProcesses.length)return {state:'profile_running',debugPort,message:'这个专用窗口仍在运行，不能直接更换端口。请先手动关闭该专用窗口，或新增一个独立窗口后再保存。'};
    if(owned)return {state:'owned',debugPort,message:'此端口属于当前 Chrome 专用窗口，可以使用；本次检查未打开网页。'};
    if(listeners.length)return {state:'occupied',debugPort,message:'此 Chrome 端口已被其他窗口或程序使用，请选择其他端口。',suggestedPort:freePort(current,before.browsers,browser.key)};
    return {state:'available',debugPort,message:'此端口未被占用，可以保存；本次检查未打开浏览器。'};
  }

  async function inspect({browser}={}){
    const prepared=prepare(browser);
    if(prepared.browser.connectionMode==='existing')return inspectExisting(prepared.browser);
    try{return inspectPrepared(prepared,await snapshot());}
    catch(error){if(error.status!==503)throw error;return {state:'unavailable',debugPort:prepared.browser.debugPort,message:error.message};}
  }

  async function suggest({browserKey}={}){
    if(browserKey!==undefined&&!validKey(browserKey))throw fail(400,'浏览器编号无效。');
    const current=await snapshot();
    const debugPort=freePort(current,preferences.view().browsers,browserKey);
    return {debugPort,message:'已找到未占用端口 '+debugPort+'；保存时会再次检查当前专用窗口是否仍在运行。'};
  }

  async function save({revision,browser}={}){
    assertIdle();assertRevision(revision);
    const prepared=prepare(browser,{saving:true});
    // Saving an existing-Chrome binding only records the user's choice. Chrome
    // may be closed or awaiting authorization; discovery and consent belong to
    // an explicit inspection/connection, not this configuration write.
    const result=prepared.browser.connectionMode==='existing'?null:inspectPrepared(prepared,await snapshot());
    // The dedicated-profile probe is asynchronous: another page may save or
    // start a task while it runs. Recheck before the synchronous atomic write.
    assertIdle();assertRevision(revision);
    if(result&&!['available','owned'].includes(result.state))throw fail(409,result.message);
    return preferences.update({revision,browsers:prepared.browsers});
  }
  return {inspect,suggest,save};
}
