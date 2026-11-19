import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

// Only in-memory settings and port replies are used. No Chrome profile, login,
// generation provider or ERP endpoint is opened by this test.
const publicRoot=path.resolve('public'),requests=[],errors=[];
const settings={revision:5,models:{SUANZHOU_IMAGE_BASE_URL:'https://image.example/v1',PLANNER_BASE_URL:'https://text.example/v1',PLANNER_MODEL:'planner',TITLE_MODEL:'title',PLANNER_API_FORMAT:'responses',TITLE_API_FORMAT:'responses',SUANZHOU_IMAGE_API_KEYConfigured:true,PLANNER_API_KEYConfigured:true},browsers:[{key:'chrome-main',type:'chrome',name:'主账号窗口',debugPort:9222,executable:''},{key:'chrome-spare',type:'chrome',name:'备用窗口',debugPort:9333,executable:''}],erpProviders:[{id:'dianxiaomi',name:'店小秘',loginUrl:'https://www.dianxiaomi.com/',listingPlatforms:['temu'],status:'已接入 Temu 半托管'},{id:'miaoshou',name:'妙手 ERP',loginUrl:'https://erp.91miaoshou.com/',listingPlatforms:[],status:'自动上架待接入'}],erpConnections:[{key:'erp-main',name:'主 ERP',provider:'dianxiaomi',browserKey:'chrome-main',expectedAccount:'fixture-account'}],stores:[{key:'shop-main',platform:'temu',expectedStore:'相框店',expectedSite:'加拿大站',erpKey:'erp-main',templates:[]}]};
let nextPort=9232,saveMode='success',inspectUnavailable=false,releaseInspection,inspectionStarted;
const slowInspection=new Promise(resolve=>{inspectionStarted=resolve;});
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
    if(url.pathname==='/api/session')return send(200,{token:'fixture-token'});
    if(url.pathname==='/api/settings'&&req.method==='GET')return send(200,settings);
    if(req.method==='POST'){
      assert.equal(req.headers['x-workbench-token'],'fixture-token');const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push({path:url.pathname,body});
      if(url.pathname==='/api/settings/chrome/inspect'){
        if(inspectUnavailable)return send(404,{error:'该后台尚未提供端口接口'});
        const b=body.browser,state=b.debugPort===9444?'occupied':b.debugPort===9555?'profile_running':b.debugPort===9666?'unavailable':settings.browsers.some(saved=>saved.key===b.key&&saved.debugPort===b.debugPort)?'owned':'available';
        const message={occupied:'端口 9444 已被其他程序占用。',profile_running:'该窗口仍在旧端口运行，请先关闭对应窗口。',unavailable:'无法核对当前端口，请检查后台环境。',owned:'此端口属于选中的谷歌窗口，可以继续使用。',available:'端口可用，保存后生效。'}[state];
        if(b.debugPort===9777){releaseInspection=()=>send(200,{state,debugPort:b.debugPort,message});inspectionStarted();return;}
        return send(200,{state,debugPort:b.debugPort,message});
      }
      if(url.pathname==='/api/settings/chrome/suggest')return send(200,{debugPort:nextPort++,message:'已找到空闲端口。'});
      if(url.pathname==='/api/settings/chrome/save'){
        if(saveMode==='conflict'){settings.revision++;settings.browsers[0].debugPort=9888;return send(409,{error:'配置已在其他页面更新，请读取最新配置。'});}
        if(saveMode==='busy')return send(409,{error:'任务正在运行，请完成后再修改浏览器连接。'});
        if(saveMode==='unavailable')return send(503,{error:'后台暂时无法只读核对端口，请稍后重试。'});
        if(body.revision!==settings.revision)return send(409,{error:'配置版本已变化'});
        if(body.browser.debugPort===9444)return send(409,{error:'端口被占用'});
        assert.equal(body.browser.type,'chrome');assert.ok(Number.isInteger(body.browser.debugPort));
        const index=settings.browsers.findIndex(browser=>browser.key===body.browser.key);if(index<0)settings.browsers.push(body.browser);else settings.browsers[index]=body.browser;
        settings.revision++;return send(200,settings);
      }
      if(url.pathname==='/api/settings'){
        if(body.revision!==settings.revision)return send(409,{error:'配置版本已变化'});
        for(const key of ['models','browsers','erpConnections','stores'])if(Object.hasOwn(body,key))settings[key]=body[key];settings.revision++;return send(200,settings);
      }
      throw new Error('禁止调用真实连接或执行接口：'+url.pathname);
    }
    if(url.pathname==='/settings'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});return res.end(fs.readFileSync(path.join(publicRoot,'merchant.html')));}
    const file=path.join(publicRoot,url.pathname);if(file.startsWith(publicRoot)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/css'});return res.end(fs.readFileSync(file));}
    res.writeHead(404);res.end();
  }catch(error){errors.push(error.message);send(500,{error:error.message});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1366,height:1000}});
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{window.fixtureSettingsEvents=[];window.addEventListener('workbench-settings-changed',event=>window.fixtureSettingsEvents.push(event.detail));});
const input=(form,name)=>page.locator('#'+form+' [name="'+name+'"]');
const idle=()=>page.waitForFunction(()=>!document.getElementById('savedChromeWindow').disabled);
try{
  await page.goto(base+'/settings');await page.waitForFunction(()=>document.getElementById('savedChromeWindow').value==='chrome-main');
  assert.equal(await input('browserForm','debugPort').inputValue(),'9222');assert.match(await page.textContent('#erpList'),/主账号窗口 · 端口 9222/);
  await input('modelForm','SUANZHOU_IMAGE_BASE_URL').fill('https://unsaved.example/v1');await input('modelForm','SUANZHOU_IMAGE_API_KEY').fill('fixture-only-unsaved-key');
  await input('erpForm','name').fill('未保存 ERP 草稿');await input('erpForm','browserKey').selectOption('chrome-spare');await input('erpForm','expectedAccount').fill('unsaved-account');
  await input('storeForm','expectedStore').fill('未保存店铺资料');
  await page.selectOption('#savedChromeWindow','chrome-spare');assert.equal(await input('browserForm','debugPort').inputValue(),'9333');assert.equal(await input('browserForm','key').inputValue(),'chrome-spare');
  await input('browserForm','debugPort').fill('9444');await page.click('#inspectChromePort');await idle();assert.match(await page.textContent('#chromePortStatus'),/占用/);assert.equal(await page.isEnabled('#saveChromeWindow'),false);
  await input('browserForm','debugPort').fill('9445');assert.match(await page.textContent('#chromePortStatus'),/重新检查/);assert.equal(await page.isEnabled('#saveChromeWindow'),true);
  await input('browserForm','debugPort').fill('9777');await page.click('#inspectChromePort');await slowInspection;await input('browserForm','debugPort').fill('9778');releaseInspection();await idle();assert.match(await page.textContent('#chromePortStatus'),/检测结果已失效/);
  await page.click('#newChromeWindow');await idle();const addedKey=await input('browserForm','key').inputValue();assert.ok(!['chrome-main','chrome-spare'].includes(addedKey));assert.equal(await input('browserForm','debugPort').inputValue(),'9232');assert.equal(settings.browsers.length,2);
  await input('browserForm','name').fill('采集独立窗口');await page.click('#saveChromeWindow');await idle();
  assert.equal(settings.browsers.length,3);assert.equal(settings.browsers[0].debugPort,9222);assert.equal(settings.browsers[1].debugPort,9333);assert.equal(settings.browsers[2].key,addedKey);
  assert.equal(await page.inputValue('#savedChromeWindow'),addedKey);assert.match(await page.textContent('#chromePortStatus'),/已保存并应用/);assert.equal(await input('erpForm','browserKey').inputValue(),'chrome-spare','saving a window must not rebind an existing ERP selection');
  assert.match(await input('erpForm','browserKey').textContent(),/采集独立窗口 · 端口 9232/);
  const assertOtherDrafts=async()=>{assert.equal(await input('modelForm','SUANZHOU_IMAGE_BASE_URL').inputValue(),'https://unsaved.example/v1');assert.equal(await input('modelForm','SUANZHOU_IMAGE_API_KEY').inputValue(),'fixture-only-unsaved-key');assert.equal(await input('erpForm','name').inputValue(),'未保存 ERP 草稿');assert.equal(await input('erpForm','expectedAccount').inputValue(),'unsaved-account');assert.equal(await input('storeForm','expectedStore').inputValue(),'未保存店铺资料');};
  await assertOtherDrafts();assert.equal(settings.models.SUANZHOU_IMAGE_BASE_URL,'https://image.example/v1');assert.ok(await page.evaluate(()=>window.fixtureSettingsEvents.length>0));
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('workbench-settings-changed'))).revision,settings.revision);
  settings.browsers.find(browser=>browser.key===addedKey).debugPort=9991;settings.revision++;
  await input('browserForm','debugPort').fill('9992');await page.click('#resetBrowser');await idle();assert.equal(await input('browserForm','debugPort').inputValue(),'9991','restore must fetch current server values');await assertOtherDrafts();
  saveMode='conflict';await input('browserForm','debugPort').fill('9993');await page.click('#saveChromeWindow');await idle();assert.equal(await input('browserForm','debugPort').inputValue(),'9993');assert.match(await page.textContent('#chromePortStatus'),/其他页面更新/);assert.equal(await page.isVisible('#refreshChromeRevision'),true);
  await page.click('#refreshChromeRevision');await idle();assert.equal(await input('browserForm','debugPort').inputValue(),'9993');await assertOtherDrafts();
  saveMode='success';await page.click('#saveChromeWindow');await idle();assert.equal(settings.browsers.find(browser=>browser.key===addedKey).debugPort,9993);assert.equal(settings.browsers[0].debugPort,9888);
  saveMode='busy';const beforeBusy=settings.revision;await input('browserForm','debugPort').fill('9994');await page.click('#saveChromeWindow');await idle();assert.match(await page.textContent('#chromePortStatus'),/任务正在运行/);assert.equal(await input('browserForm','debugPort').inputValue(),'9994');assert.equal(settings.revision,beforeBusy);
  saveMode='unavailable';await page.click('#saveChromeWindow');await idle();assert.match(await page.textContent('#chromePortStatus'),/无法只读核对/);assert.equal(await input('browserForm','debugPort').inputValue(),'9994');await assertOtherDrafts();
  inspectUnavailable=true;await page.click('#inspectChromePort');await idle();assert.match(await page.textContent('#chromePortStatus'),/后台尚未提供/);assert.equal(await input('browserForm','debugPort').inputValue(),'9994');
  saveMode='success';await input('erpForm','name').fill('绑定采集窗口');await input('erpForm','browserKey').selectOption(addedKey);await input('erpForm','expectedAccount').fill('fixture-new-account');await page.locator('#erpForm button.primary').click();await page.waitForFunction(()=>document.getElementById('erpList').textContent.includes('绑定采集窗口'));
  const savedErp=settings.erpConnections.find(erp=>erp.name==='绑定采集窗口');assert.equal(savedErp.browserKey,addedKey);assert.match(await page.textContent('#erpList'),/采集独立窗口 · 端口 9993/);
  assert.deepEqual(errors,[]);assert.ok(requests.every(request=>request.path.startsWith('/api/settings')));
  console.log('Chrome settings UI passed: multiple windows, independent new key, port inspection/stale responses/suggestions, conflict and failure retention, fresh restore, unrelated draft preservation, settings events and ERP window binding. No login, generation or ERP calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
