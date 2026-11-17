import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Exercise the shipped Chrome adapter on a separate blank profile. Never log in.
const resources=path.resolve(process.argv[2]||'../新用户测试-20261112/程序/resources');
const {openChrome,chromeConnection}=await import(pathToFileURL(path.join(resources,'erp-scripts/lib/chrome-cdp.mjs')).href);
const output=path.resolve('tests/results/fresh-user-20261112/current-version-chrome');
fs.mkdirSync(output,{recursive:true});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-chrome-probe-'));
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const config={type:'chrome',key:'blank-profile-probe',debugPort:port,userDataDir:path.join(directory,'中文 独立浏览器')};
let socket,requestId=0;
const pending=new Map();
async function send(method){return new Promise((resolve,reject)=>{
  const id=++requestId,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);
  pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
  socket.send(JSON.stringify({id,method}));
});}
try{
  const connection=await openChrome(config);
  const targets=await connection.targets();
  assert.ok(targets.some(t=>t.type==='page'&&t.url==='about:blank'));
  assert.ok(!targets.some(t=>/dianxiaomi|91miaoshou/i.test(t.url)));
  socket=new WebSocket(connection.ws);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}});
  const {cookies}=await send('Storage.getCookies');
  assert.ok(!cookies.some(c=>/dianxiaomi|91miaoshou/i.test(c.domain)));
  // An occupied port belonging to another profile must never be reused.
  await assert.rejects(()=>chromeConnection({...config,userDataDir:path.join(directory,'不同的浏览器')}),/端口被其他程序占用/);
  const report={passed:true,checkedAt:new Date().toISOString(),checks:['bundled adapter launches installed Chrome in a new Chinese/space profile directory','CDP connects only to the configured local port and profile','new browser contains no ERP pages or ERP login cookies','wrong-profile access to the same port is rejected'],limits:['no ERP login, mother read, draft save or publication'],retainedTemporaryProfile:directory};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:false,error:error.stack},null,2));throw error;}
finally{
  if(socket?.readyState===WebSocket.OPEN){
    const closed=new Promise(resolve=>{socket.addEventListener('close',resolve,{once:true});setTimeout(resolve,5000).unref();});
    await Promise.race([send('Browser.close').catch(()=>{}),closed]);
    await closed;
  }
  for(const request of pending.values())request.reject(new Error('Probe closed'));pending.clear();
  socket?.close();
}
