import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const executablePath=process.argv[2]&&path.resolve(process.argv[2]);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-profile-isolation-'));
const output=path.resolve('tests/results/fresh-user-20261112');fs.mkdirSync(output,{recursive:true});
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const ports=[await freePort(),await freePort()],running=new Set();
const directories=['原用户 测试替身','全新用户 测试替身'].map(name=>path.join(directory,name));
async function start(index){
  const env={...process.env,WORKBENCH_DESKTOP_DATA:directories[index],WORKBENCH_DESKTOP_PORT:String(ports[index]),WORKBENCH_DESKTOP_TEST:'false',PLANNER_API_KEY:'host-key-must-not-leak',SUANZHOU_IMAGE_API_KEY:'host-image-key-must-not-leak'};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({...(executablePath?{executablePath}:{args:['.']}),env,timeout:60000});running.add(app);
  const page=await app.firstWindow();await page.locator('#intake').waitFor();
  assert.equal(new URL(page.url()).port,String(ports[index]));
  const runtime=await app.evaluate(({app,BrowserWindow})=>({userData:app.getPath('userData'),title:BrowserWindow.getAllWindows()[0].getTitle()}));
  assert.equal(runtime.userData,directories[index]);assert.equal(runtime.title,'全新用户测试 · Temu 工作台');
  const settings=await page.evaluate(()=>fetch('/api/settings').then(r=>r.json()));
  assert.deepEqual(settings.stores,[]);assert.deepEqual(settings.erpConnections,[]);
  for(const [key,value] of Object.entries(settings.models))if(key.endsWith('Configured'))assert.equal(value,false,key);
  return {app,page,settings};
}
async function close(app){await app.close();running.delete(app);}
try{
  const first=await start(0);
  await first.page.evaluate(()=>localStorage.setItem('profile-isolation-proof','first-profile'));
  const firstOrigin=new URL(first.page.url()).origin;
  const second=await start(1);
  assert.equal(await second.page.evaluate(()=>localStorage.getItem('profile-isolation-proof')),null);
  // Even cookies for the same host (ports are not cookie boundaries) must be separate.
  await first.page.context().addCookies([{name:'profile_cookie',value:'first-profile',url:firstOrigin,expires:Math.floor(Date.now()/1000)+3600}]);
  assert.equal((await second.page.context().cookies()).some(c=>c.name==='profile_cookie'),false);
  const base=new URL(second.page.url()).origin;
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  const response=await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify({revision:second.settings.revision,browsers:[{key:'new-chrome',name:'全新用户窗口',type:'chrome',debugPort:await freePort()}]})});
  assert.equal(response.status,200);
  const updated=await fetch(base+'/api/settings').then(r=>r.json());
  assert.equal(updated.browsers[0].userDataDir,path.join(directories[1],'preferences','chrome-profiles','new-chrome'));
  assert.equal((await first.page.evaluate(()=>fetch('/api/settings').then(r=>r.json()))).browsers.length,0);
  await close(second.app);await close(first.app);
  const reopened=await start(0);
  assert.equal(new URL(reopened.page.url()).origin,firstOrigin);
  assert.equal(await reopened.page.evaluate(()=>localStorage.getItem('profile-isolation-proof')),'first-profile');
  assert.equal((await reopened.page.context().cookies()).find(c=>c.name==='profile_cookie')?.value,'first-profile');
  await reopened.page.screenshot({path:path.join(output,'isolated-desktop.png'),fullPage:false});
  await close(reopened.app);
  const report={passed:true,packaged:!!executablePath,checkedAt:new Date().toISOString(),checks:['two native desktop instances coexist with different data directories and ports','host model keys are not inherited','stores and ERP connections start empty','same-host cookies and page preferences are isolated','browser profiles are confined to the new data directory','closing and reopening preserves only that profile, including its fixed origin'],limits:['same Windows installation, not a clean operating system','no paid generation or external ERP operations']};
  fs.writeFileSync(path.join(output,'profile-isolation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  for(const app of running)await app.close().catch(()=>{});
  // This unique temporary fixture contains no merchant data.
  assert.equal(path.dirname(directory),os.tmpdir());
  assert.ok(path.basename(directory).startsWith('workbench-profile-isolation-'));
  fs.rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:250});
}
