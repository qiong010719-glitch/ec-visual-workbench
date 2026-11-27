import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {inspectChromeOwner as owner} from './chrome-owner.mjs';
import {connectExistingChrome} from './chrome-existing.mjs';
export {inspectExistingChrome} from './chrome-existing.mjs';

export async function chromeConnection(config){
  if(config.connectionMode==='existing')return connectExistingChrome(config);
  if(await owner(config)!=='owned')throw new Error('Chrome 专用窗口未打开或端口被其他程序占用，请在连接设置打开对应 ERP 的登录窗口');
  const http='http://127.0.0.1:'+config.debugPort;
  const get=async route=>{const r=await fetch(http+route,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Chrome 调试连接失败');return r.json();};
  const version=await get('/json/version'),u=new URL(version.webSocketDebuggerUrl);
  if(u.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||Number(u.port)!==Number(config.debugPort))throw new Error('Chrome 调试地址不匹配');
  return {http,ws:version.webSocketDebuggerUrl,targets:()=>get('/json/list')};
}
export async function openChrome(config){
  if(config.connectionMode==='existing')return connectExistingChrome(config);
  const status=await owner(config);
  if(status==='owned')return chromeConnection(config);
  if(status!=='closed')throw new Error('此 Chrome 端口已被其他窗口使用，请更换端口');
  const candidates=[config.executable,...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Google','Chrome','Application','chrome.exe'))];
  const executable=candidates.find(p=>p&&fs.existsSync(p));if(!executable)throw new Error('未找到 Chrome，请安装或填写 chrome.exe 路径');
  fs.mkdirSync(config.userDataDir,{recursive:true});
  const child=spawn(executable,['--user-data-dir='+config.userDataDir,'--remote-debugging-port='+config.debugPort,'--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,detached:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  for(let i=0;i<12;i++){try{return await chromeConnection(config);}catch{}await new Promise(r=>setTimeout(r,500));}
  throw new Error('Chrome 启动后未就绪，请检查专用窗口后重试连接');
}
