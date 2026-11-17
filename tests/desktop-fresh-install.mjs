import {_electron as electron, chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {writeWorkbook} from '../src/workbook.mjs';

// Exercise the shipped runtime without the developer's PATH, configuration or data.
// This is an isolated local test, not evidence from a second physical computer.
const argument=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const executable=path.resolve(argument('--executable')||'dist/new-computer-20261111/win-unpacked/商品裂变工作台.exe');
const portable=process.argv.includes('--portable'),expectedVersion=argument('--version')||'1.0.1-test.1';
const output=path.resolve(argument('--output')||'tests/results/fresh-install',portable?'portable':'unpacked');
fs.mkdirSync(output,{recursive:true});assert.ok(fs.existsSync(executable),'build the executable first');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-fresh-'));
const data=path.join(directory,'全新用户 数据'),cwd=path.join(directory,'无开发工具 空目录');
fs.mkdirSync(data);fs.mkdirSync(cwd);
const allowed=/^(systemroot|windir|comspec|pathext|systemdrive|userprofile|appdata|localappdata|temp|tmp|programfiles|programfiles\(x86\)|programw6432|programdata|allusersprofile|public|username|userdomain|homedrive|homepath|os|number_of_processors|processor_architecture)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key)));
const windows=process.env.SystemRoot||'C:\\Windows';
env.PATH=[path.join(windows,'System32'),windows,path.join(windows,'System32','WindowsPowerShell','v1.0')].join(path.delimiter);
env.WORKBENCH_DESKTOP_TEST='true';env.WORKBENCH_DESKTOP_DATA=data;
const errors=[],checks=[],requests=[];let running;
const mock=http.createServer((req,res)=>{
  requests.push(req.url);req.resume();
  const values={'/health':{},'/browser/list':{list:[{id:'fresh-install-fixture'}]},'/browser/pids':{}};
  res.writeHead(Object.hasOwn(values,req.url)?200:500,{'Content-Type':'application/json'});
  res.end(JSON.stringify({success:Object.hasOwn(values,req.url),data:values[req.url]}));
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
const mockUrl='http://127.0.0.1:'+mock.address().port;
const readyFile=path.join(data,'desktop-ready.json');
async function until(fn,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){const result=await fn();if(result)return result;await delay(200);}throw new Error('Desktop startup/shutdown timed out');}
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function start(){
  fs.rmSync(readyFile,{force:true});
  if(!portable){
    const app=await electron.launch({executablePath:executable,env,cwd,timeout:60000});
    running={app};running.page=await app.firstWindow();
    const runtime=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,appPath:app.getAppPath(),path:process.env.PATH}));
    assert.equal(runtime.version,expectedVersion);assert.equal(runtime.packaged,true);assert.equal(runtime.path,env.PATH);
  }else{
    const port=await freePort();
    const child=spawn(executable,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{env,cwd,windowsHide:true,stdio:'ignore'});
    running={child};child.on('error',error=>errors.push(error.message));
    await until(()=>fs.existsSync(readyFile));
    running.browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
    running.page=running.browser.contexts()[0].pages().find(p=>p.url().includes('/temu/listings'));
    assert.ok(running.page,'portable launcher opened the workbench window');
  }
  // A settings save may wait for the Windows DPAPI helper (15s deadline).
  // Leave time for its response and UI rendering before declaring a click timeout.
  running.page.setDefaultTimeout(30000);running.page.setDefaultNavigationTimeout(30000);
  await running.page.locator('#intake').waitFor();
  running.page.on('pageerror',error=>errors.push(error.message));
  await until(()=>fs.existsSync(readyFile));
  const ready=JSON.parse(fs.readFileSync(readyFile,'utf8'));assert.equal(ready.packaged,true);
  const base=new URL(running.page.url()).origin;assert.equal(base,ready.origin);assert.notEqual(new URL(base).port,'4185');
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  running.api=async(route,payload)=>{const response=await fetch(base+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});return {status:response.status,value:await response.json()};};
  return running;
}
async function stop(){
  if(!running)return;
  if(running.app)await running.app.close();
  else if(running.browser){
    const browser=running.browser,session=await browser.newBrowserCDPSession();let disconnected=false;
    browser.once('disconnected',()=>{disconnected=true;});
    // Electron exits before acknowledging Browser.close; wait for disconnection instead.
    session.send('Browser.close').catch(()=>{});
    await until(()=>disconnected,15000);await until(()=>running.child.exitCode!==null,30000);
  }
  else if(running.child)running.child.kill();
  running=null;
}
try{
  let session=await start(),{page,api}=session;
  let settings=(await api('/api/settings')).value;
  assert.deepEqual(settings.stores,[]);assert.deepEqual(settings.browsers,[]);assert.deepEqual(settings.erpConnections,[]);
  for(const [key,value] of Object.entries(settings.models))if(key.endsWith('Configured'))assert.equal(value,false,key);
  const initial=JSON.parse(fs.readFileSync(path.join(data,'workbench.json'),'utf8'));
  assert.deepEqual(initial.tasks,{});assert.deepEqual(initial.batches,{});assert.deepEqual(initial.drafts,[]);
  checks.push('packaged startup from unrelated Chinese/space path with Windows-only PATH','fresh profile has no developer keys, stores, browsers or jobs');
  assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof desktop.chooseFolder),'function');
  assert.equal(await page.locator('#batchMother').count(),1);assert.equal(await page.locator('#storeSyncStatus').count(),1);
  checks.push('renderer isolation and current sidebar mother/store-sync UI');
  const material=path.join(directory,'中文素材 空格'),product=path.join(material,'FRESH-001');fs.mkdirSync(product,{recursive:true});
  await sharp({create:{width:800,height:800,channels:3,background:'#decbab'}}).png().toFile(path.join(product,'01.png'));
  fs.writeFileSync(path.join(product,'商品资料.txt'),'独立电脑验收测试素材，不执行付费生成或发布。');
  writeWorkbook([{productCode:'FRESH-001',title:'新电脑导入测试',englishTitle:'Fresh Computer Import Test'}],path.join(material,'商品.xlsx'));
  if(session.app){await session.app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},material);await page.click('#browseFolder');assert.equal(await page.inputValue('#folderPath'),material);checks.push('folder-picker IPC bridge with simulated dialog return');}
  else await page.fill('#folderPath',material);
  await page.click('#importFolder');await page.locator('[data-product="0"]').waitFor();
  assert.equal(await page.locator('#productInputs [data-field="productCode"]').inputValue(),'FRESH-001');
  assert.equal(await page.locator('#productInputs [data-field="name"]').inputValue(),'新电脑导入测试');
  checks.push('bundled image/Excel readers import Chinese-path material');
  await page.getByRole('link',{name:'连接设置',exact:true}).click();await page.locator('#modelForm').waitFor();
  await page.fill('input[name="PLANNER_API_KEY"]','fresh-install-fixture-secret');await page.locator('#modelForm button').click();
  await page.getByText('配置已保存在本机。',{exact:true}).waitFor();
  assert.equal(await page.inputValue('input[name="PLANNER_API_KEY"]'),'');
  assert.ok(!fs.readFileSync(path.join(data,'preferences','secrets.json'),'utf8').includes('fresh-install-fixture-secret'));
  settings=(await api('/api/settings')).value;
  const saved=await api('/api/settings',{revision:settings.revision,browsers:[{key:'fresh-browser',browserId:'fresh-install-fixture',browserSequence:1,name:'隔离验收浏览器',localApi:mockUrl}],erpConnections:[{key:'fresh-erp',provider:'dianxiaomi',name:'隔离验收ERP',browserKey:'fresh-browser'}]});assert.equal(saved.status,200,JSON.stringify(saved.value));
  const connection=await api('/api/temu/erp/connection',{erpKey:'fresh-erp'});
  assert.notEqual(connection.status,200);assert.match(connection.value.error,/Required BitBrowser profile is closed/);
  assert.deepEqual(requests,['/health','/browser/list','/browser/pids']);
  checks.push('Windows DPAPI protects saved fixture key','bundled ERP adapter loads and rejects a closed fixture browser without opening it');
  await page.locator('#resetStore').click();assert.equal(await page.locator('#storeEditorTitle').textContent(),'新增店铺');assert.equal(await page.locator('#storeMothers').isVisible(),false);
  assert.equal(await page.locator('#storeSaveStatus').count(),1);checks.push('current separate new-store flow and explicit save status');
  await page.screenshot({path:path.join(output,'settings.png'),fullPage:true});
  console.log('Initial desktop checks passed; closing and relaunching.');
  await stop();session=await start();page=session.page;api=session.api;
  settings=(await api('/api/settings')).value;
  assert.equal(settings.models.PLANNER_API_KEYConfigured,true);assert.equal(settings.browsers[0].name,'隔离验收浏览器');assert.equal(settings.erpConnections[0].key,'fresh-erp');assert.deepEqual(settings.stores,[]);
  await page.getByRole('link',{name:'连接设置',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#modelStatus')?.textContent.includes('文本密钥：已配置'));
  assert.equal(await page.inputValue('input[name="PLANNER_API_KEY"]'),'');checks.push('close/relaunch preserves browser/ERP configuration and decrypts the fixture key');
  for(const route of ['/temu','/temu/listings','/settings']){await page.locator(`.workbench-nav a[href="${route}"]`).click();await page.locator(`.workbench-nav a[href="${route}"][aria-current="page"]`).waitFor();}
  checks.push('three workbench pages render after relaunch');assert.deepEqual(errors,[]);
  const report={passed:true,testedAt:new Date().toISOString(),executable,expectedVersion,portable,hostOS:os.release(),hostArch:os.arch(),checks,errors,limitations:['Same physical computer; not a clean Windows installation','No real ERP login, mother reading, save or publication','No paid image/video generation or membership test','Native folder selection dialog requires manual acceptance']};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){
  const modelStatus=await running?.page?.locator('#modelStatus').textContent({timeout:3000}).catch(()=>null);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:false,portable,checks,errors,modelStatus,error:error.stack},null,2));throw error;
}
finally{
  await stop();await new Promise(resolve=>mock.close(resolve));
  const relative=path.relative(os.tmpdir(),directory);assert.ok(relative.startsWith('workbench-fresh-')&&!relative.includes(path.sep));
  fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:500});
}
