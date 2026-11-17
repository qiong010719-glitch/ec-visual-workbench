import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const failure=(message,code)=>Object.assign(new Error(message),{code});
const timedOut=error=>error.killed||error.code==='ETIMEDOUT'||error.signal==='SIGTERM';

export function listeningOwners(output,port){
  const listeners=[];
  for(const line of output.split(/\r?\n/)){
    const fields=line.trim().split(/\s+/);
    if(fields[0]!=='TCP')continue;
    const endpoint=/^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(fields[1]||'');
    if(!endpoint||Number(endpoint[2])!==port)continue;
    // LISTENING rows have a zero remote endpoint. Established connections do not.
    // Recognize that endpoint as well so translated Windows state labels are safe.
    if(fields[3]!=='LISTENING'&&!['0.0.0.0:0','[::]:0'].includes(fields[2]))continue;
    const pid=Number(fields[4]);
    if(fields.length!==5||!Number.isSafeInteger(pid)||pid<=0)throw failure('无法识别 Chrome 端口占用信息，请稍后重新检查连接。','CHROME_OWNER_INVALID');
    listeners.push({address:endpoint[1].replace(/^\[|\]$/g,''),pid});
  }
  return listeners;
}

export function matchesProfile(processInfo,directory){
  if(processInfo?.name?.toLowerCase()!=='chrome.exe'||typeof processInfo.commandLine!=='string')return false;
  const command=processInfo.commandLine;
  const switches=[...command.matchAll(/(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+))(?=\s|$)/gi)];
  const count=[...command.matchAll(/(?:^|\s)"?--user-data-dir(?:=|\s|$)/gi)].length;
  if(count!==1||switches.length!==1)return false;
  const actual=switches[0].slice(1).find(Boolean);
  return path.win32.isAbsolute(actual)&&path.win32.normalize(actual).replace(/[\\/]+$/,'').toLowerCase()===path.win32.normalize(directory).replace(/[\\/]+$/,'').toLowerCase();
}

export async function inspectChromeOwner(config,{run=execute,platform=process.platform,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
  if(platform!=='win32')throw new Error('当前 Chrome 专用窗口支持 Windows');
  const port=Number(config.debugPort),directory=config.userDataDir;
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Chrome 端口无效');
  if(typeof directory!=='string'||!path.win32.isAbsolute(directory))throw new Error('Chrome 专用数据目录无效，请检查连接设置');
  const netstat=path.win32.join(systemRoot,'System32','netstat.exe');
  let output;
  try{({stdout:output}=await run(netstat,['-ano','-p','tcp'],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024,encoding:'utf8'}));}
  catch(error){throw failure(timedOut(error)?'读取 Chrome 端口超时，本次尚未连接 ERP。请稍后重新检查连接。':'无法读取 Chrome 端口，请检查 Windows 网络服务后重试。','CHROME_PORT_CHECK_FAILED');}
  const listeners=listeningOwners(output,port);
  if(!listeners.length)return 'closed';
  if(listeners.some(l=>!['127.0.0.1','::1'].includes(l.address)))return 'wrong';
  const pids=[...new Set(listeners.map(l=>l.pid))];
  // netstat avoids the slow NetTCPIP/CIM provider initialization. CIM is only used
  // once for the exact owning PIDs; no credentials or process arguments are logged.
  const filter=pids.map(pid=>'ProcessId = '+pid).join(' OR ');
  const script=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $rows=@(Get-CimInstance Win32_Process -Filter '${filter}' -ErrorAction Stop | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;name=$_.Name;commandLine=$_.CommandLine} }); ConvertTo-Json -InputObject $rows -Compress`;
  const powershell=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  let processes;
  try{
    const result=await run(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,maxBuffer:1024*1024,encoding:'utf8'});
    processes=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
    if(!Array.isArray(processes))throw new Error('Invalid process response');
  }catch(error){throw failure(timedOut(error)?'核对 Chrome 进程超时，本次尚未连接 ERP。请稍后重新检查连接。':'无法核对 Chrome 所属配置，请检查专用浏览器是否仍在运行后重试。',timedOut(error)?'CHROME_OWNER_TIMEOUT':'CHROME_OWNER_CHECK_FAILED');}
  return pids.every(pid=>{const matches=processes.filter(p=>p.pid===pid);return matches.length===1&&matchesProfile(matches[0],directory);})?'owned':'wrong';
}
