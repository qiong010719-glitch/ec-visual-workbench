import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

// In-memory settings and local fixture replies only: no real browser discovery,
// Chrome permissions, ERP account or plugin installation is touched.
const publicRoot=path.resolve('public'),requests=[],errors=[];
const initial=()=>({revision:2,models:{},browsers:[{key:'chrome-old',type:'chrome',name:'原专用窗口',debugPort:9233,executable:'C:\\Fixture\\chrome.exe'}],erpProviders:[{id:'dianxiaomi',name:'店小秘',loginUrl:'https://www.dianxiaomi.com/',listingPlatforms:['temu'],status:'已接入 Temu'}],erpConnections:[{key:'erp-old',name:'原ERP',provider:'dianxiaomi',browserKey:'chrome-old',expectedAccount:'fixture-account'}],stores:[]});
let settings=initial(),inspectState='needs-authorization',denyLogin=false;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
    if(url.pathname==='/api/session')return send(200,{token:'fixture-session'});
    if(url.pathname==='/api/settings'&&req.method==='GET')return send(200,settings);
    if(url.pathname==='/api/workspace')return send(200,{products:[],tasks:[],context:{},stores:[]});
    if(req.method==='POST'){
      assert.equal(req.headers['x-workbench-token'],'fixture-session');const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push({path:url.pathname,body});
      if(url.pathname==='/api/settings/chrome/inspect')return send(200,{state:body.browser.connectionMode==='existing'?inspectState:'available',message:body.browser.connectionMode==='existing'?'请在当前 Chrome 启用远程调试；本次只读检查没有请求授权。':'测试端口可用。'});
      if(url.pathname==='/api/settings/chrome/suggest')return send(200,{debugPort:9339,message:'已找到测试空闲端口。'});
      if(url.pathname==='/api/settings/chrome/save'){
        assert.equal(body.revision,settings.revision);assert.equal(body.browser.type,'chrome');
        if(body.browser.connectionMode==='existing'){assert.ok(!Object.hasOwn(body.browser,'debugPort'));assert.ok(!Object.hasOwn(body.browser,'executable'));}
        else assert.ok(Number.isInteger(body.browser.debugPort));
        const index=settings.browsers.findIndex(b=>b.key===body.browser.key);if(index<0)settings.browsers.push(body.browser);else settings.browsers[index]=body.browser;
        settings.revision++;return send(200,settings);
      }
      if(url.pathname==='/api/settings'){
        assert.equal(body.revision,settings.revision);for(const key of ['models','browsers','erpConnections','stores'])if(Object.hasOwn(body,key))settings[key]=body[key];settings.revision++;return send(200,settings);
      }
      if(url.pathname==='/api/temu/erp/open-login'){
        const erp=settings.erpConnections.find(e=>e.key===body.erpKey);assert.ok(erp);const browser=settings.browsers.find(b=>b.key===erp.browserKey);assert.ok(browser);
        return denyLogin?send(409,{error:'Chrome 尚未授权；请在当前 Chrome 点击 Allow，不会启动隔离窗口。'}):send(200,{opened:true,message:'已在已登录的 Chrome 中打开工作窗口',browserKey:browser.key});
      }
      if(url.pathname==='/api/temu/erp/connection')return send(200,{connected:true,account:'fixture-account'});
      throw new Error('Unexpected side-effect endpoint '+url.pathname);
    }
    if(url.pathname==='/settings'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});return res.end(fs.readFileSync(path.join(publicRoot,'merchant.html')));}
    const file=path.join(publicRoot,url.pathname);if(file.startsWith(publicRoot)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/css'});return res.end(fs.readFileSync(file));}
    res.writeHead(404);res.end();
  }catch(error){errors.push(error.message);send(500,{error:error.message});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext(),page=await context.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const field=name=>page.locator('#browserForm [name="'+name+'"]'),idle=()=>page.waitForFunction(()=>!document.getElementById('savedChromeWindow').disabled);
try{
  await page.goto(base+'/settings');await page.locator('[data-browser-edit="chrome-old"]').click();
  assert.equal(await field('connectionMode').inputValue(),'dedicated','old saved configs do not silently change modes');
  assert.equal(await field('debugPort').inputValue(),'9233');assert.equal(await field('executable').inputValue(),'C:\\Fixture\\chrome.exe');
  assert.match(await page.textContent('#browserList'),/原专用窗口 · 端口 9233/);
  assert.equal(requests.length,0,'loading settings cannot discover, connect, or migrate a browser');
  await page.click('[data-browser-reuse="chrome-old"]');
  assert.equal(await field('connectionMode').inputValue(),'existing');
  assert.equal(requests.length,0,'choosing reuse only prepares the change until Save');
  assert.equal(settings.browsers[0].connectionMode,undefined);assert.equal(settings.erpConnections[0].browserKey,'chrome-old');
  assert.equal(await page.locator('#chromePortField').isHidden(),true);assert.equal(await page.locator('#browserAdvanced').isHidden(),true);assert.equal(await page.locator('#suggestChromePort').isHidden(),true);
  assert.equal(await field('debugPort').getAttribute('required'),null);assert.equal(await page.locator('#inspectChromePort').innerText(),'检查当前 Chrome');
  assert.match(await page.textContent('#chromeExistingHelp'),/chrome:\/\/inspect\/#remote-debugging/);assert.match(await page.textContent('#chromeExistingHelp'),/Allow/);
  await page.click('#inspectChromePort');await idle();
  const inspection=requests.at(-1);assert.equal(inspection.path,'/api/settings/chrome/inspect');assert.equal(inspection.body.browser.connectionMode,'existing');assert.ok(!Object.hasOwn(inspection.body.browser,'debugPort'));
  assert.equal(await page.locator('#saveChromeWindow').isEnabled(),true,'authorization is deferred until connection, not saving');
  await page.selectOption('#chromeConnectionMode','dedicated');assert.equal(await field('debugPort').inputValue(),'9233');assert.equal(await field('executable').inputValue(),'C:\\Fixture\\chrome.exe');
  assert.equal(await page.locator('#chromePortField').isVisible(),true);assert.equal(await page.locator('#inspectChromePort').innerText(),'检查端口');
  await page.click('#inspectChromePort');await idle();assert.equal(requests.at(-1).body.browser.debugPort,9233);
  await page.click('#resetErp');await page.locator('#erpAdvanced > summary').evaluate(el=>{el.parentElement.open=true;});await page.locator('#erpForm [name=expectedAccount]').fill('unsaved-account');await page.locator('#erpForm [name=browserKey]').selectOption('chrome-old');
  const beforeNew=requests.length;await page.click('#newChromeWindow');
  const addedKey=await field('key').inputValue();assert.notEqual(addedKey,'chrome-old');assert.equal(await field('connectionMode').inputValue(),'existing');assert.equal(requests.length,beforeNew,'new existing connection does not select a debug port');
  await field('name').fill('日常 Chrome');await page.selectOption('#chromeConnectionMode','dedicated');await page.click('#suggestChromePort');await idle();assert.equal(await field('debugPort').inputValue(),'9339');
  await page.selectOption('#chromeConnectionMode','existing');await page.reload();await page.locator('#chromeConnectionMode').waitFor();
  assert.equal(await field('connectionMode').inputValue(),'existing');assert.equal(await field('key').inputValue(),addedKey);assert.equal(await field('name').inputValue(),'日常 Chrome');
  assert.equal(await field('debugPort').inputValue(),'9339','hidden dedicated draft survives reload');
  assert.equal(await page.locator('#erpForm [name=expectedAccount]').inputValue(),'unsaved-account');assert.equal(await page.locator('#erpForm [name=browserKey]').inputValue(),'chrome-old');
  inspectState='unavailable';await page.click('#inspectChromePort');await idle();assert.equal(await page.locator('#saveChromeWindow').isEnabled(),true,'existing configuration can be saved before Chrome is reachable');
  await page.click('#saveChromeWindow');await idle();
  assert.equal(settings.browsers[0].connectionMode,undefined);assert.equal(settings.browsers[0].debugPort,9233);assert.equal(settings.erpConnections[0].browserKey,'chrome-old');
  const added=settings.browsers.find(b=>b.key===addedKey);assert.equal(added.connectionMode,'existing');assert.ok(!Object.hasOwn(added,'debugPort'));assert.match(await page.textContent('#browserList'),/日常 Chrome · 复用当前 Chrome/);
  assert.equal(await page.locator('#erpForm [name=browserKey]').inputValue(),'chrome-old','saving a browser does not change an ERP draft binding');
  await page.locator('#erpForm [name=browserKey]').selectOption(addedKey);denyLogin=true;await page.click('#saveErp');await page.getByText(/Chrome 尚未授权；请在当前 Chrome 点击 Allow/).waitFor();
  const newErp=settings.erpConnections.find(e=>e.expectedAccount==='unsaved-account');assert.ok(newErp);assert.equal(newErp.browserKey,addedKey);
  assert.equal(requests.at(-1).path,'/api/temu/erp/open-login');assert.equal(requests.at(-1).body.erpKey,newErp.key);
  assert.equal(settings.browsers.find(b=>b.key===addedKey).connectionMode,'existing','authorization failure cannot fall back to dedicated mode');
  const beforeRetry=requests.length;denyLogin=false;await page.click(`[data-erp-open="${newErp.key}"]`);await page.getByText(/已在已登录的 Chrome 中打开工作窗口/).waitFor();
  assert.deepEqual(requests.slice(beforeRetry).map(r=>r.path),['/api/temu/erp/open-login']);
  assert.equal(requests.at(-1).body.erpKey,newErp.key);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px overflow`);}
  await context.close();settings=initial();const migration=await browser.newPage();
  migration.on('pageerror',error=>errors.push(error.message));await migration.goto(base+'/settings');
  const beforeMigration=requests.length;await migration.click('[data-browser-reuse="chrome-old"]');
  assert.equal(requests.length,beforeMigration);assert.match(await migration.textContent('#chromeImpactHint'),/1 条 ERP/);
  await migration.click('#saveChromeWindow');await migration.waitForFunction(()=>!document.getElementById('settingsPage').inert);
  assert.deepEqual(requests.slice(beforeMigration).map(r=>r.path),['/api/settings/chrome/save']);
  assert.equal(settings.browsers.length,1);assert.equal(settings.browsers[0].key,'chrome-old');assert.equal(settings.browsers[0].connectionMode,'existing');
  assert.equal(settings.erpConnections.length,1);assert.equal(settings.erpConnections[0].browserKey,'chrome-old');
  assert.equal(await migration.locator('[data-browser-reuse]').count(),0);
  await migration.reload();await migration.locator('[data-erp-open="erp-old"]').click();await migration.waitForFunction(()=>!document.getElementById('settingsPage').inert);
  assert.deepEqual(requests.slice(beforeMigration).map(r=>r.path),['/api/settings/chrome/save','/api/temu/erp/open-login']);
  assert.equal(requests.at(-1).body.erpKey,'erp-old');
  await migration.close();settings={...initial(),browsers:[],erpConnections:[]};const fresh=await browser.newPage();
  fresh.on('pageerror',error=>errors.push(error.message));await fresh.goto(base+'/settings');await fresh.locator('#browserDefault').waitFor();const beforeDefault=requests.length;await fresh.click('#browserDefault');await fresh.getByText('当前 Chrome · 复用当前 Chrome',{exact:true}).first().waitFor();
  assert.deepEqual(requests.slice(beforeDefault).map(r=>r.path),['/api/settings/chrome/save']);assert.equal(settings.browsers.length,1);assert.equal(settings.browsers[0].connectionMode,'existing');assert.ok(!Object.hasOwn(settings.browsers[0],'debugPort'));
  assert.deepEqual(errors,[]);
  console.log('Existing Chrome UI passed: explicit legacy migration retains the ERP binding, existing defaults, dedicated compatibility, hidden port/path, correct payloads, drafts across mode changes/reload, no implicit connection or fallback, and 390/1440px widths. All connection replies are local fixtures.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
