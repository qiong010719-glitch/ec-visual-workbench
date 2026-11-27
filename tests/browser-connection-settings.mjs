import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';

// Every ERP operation is injected. Browsers may request this fixture's origin only.
const output=path.resolve('tests/results/connection-settings');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[],reports=[];
const storeIdentity=settings=>settings.stores.map(store=>({
  key:store.key,platform:store.platform,erpKey:store.erpKey,
  expectedStore:store.expectedStore,expectedSite:store.expectedSite,
  templates:store.templates.map(template=>({key:template.key,name:template.name,draftId:template.draftId}))
}));

async function harness(kind){
  const calls={open:[],checks:[],settings:[],unexpected:[],blocked:[],errors:[],chromeProbes:0,existingChromeProbes:0};
  const control={modes:new Map(),openDelay:0,checkDelay:0,failNextOpen:false};
  const fixture=await merchantFixture({chromeInspector:async()=>{calls.chromeProbes++;return {listeners:[],processes:[]};},chromeExistingInspector:async()=>{calls.existingChromeProbes++;return {state:'needs-authorization',connected:false,message:'隔离验收：等待原 Chrome 授权'};},erpAdapter:{
    async openLogin(config){
      calls.open.push({browserKey:config.key,connectionMode:config.connectionMode||'dedicated'});
      if(control.openDelay)await delay(control.openDelay);
      if(control.failNextOpen){control.failNextOpen=false;throw new Error('隔离验收：登录窗口暂时无法打开');}
      return {opened:true,message:'隔离验收：登录窗口已打开，请完成登录后检查'};
    },
    async checkConnection(config,erp){
      const mode=control.modes.get(erp?.key)||'matched';
      calls.checks.push({browserKey:config.key,connectionMode:config.connectionMode||'dedicated',erpKey:erp?.key,mode});
      if(control.checkDelay)await delay(control.checkDelay);
      if(mode==='error')throw new Error('隔离验收：浏览器连接失败');
      if(mode==='logged-out')return {connected:true,erpOpen:true,loggedIn:false,account:'',accountMatched:false};
      if(mode==='unverified')return {connected:true,erpOpen:true,loggedIn:true,account:erp?.expectedAccount||'',accountMatched:null};
      return {connected:true,erpOpen:true,loggedIn:true,
        account:mode==='mismatch'?'fixture-wrong-account':erp?.expectedAccount||'fixture-account',
        accountMatched:mode!=='mismatch'};
    },
    async openMotherSource(){calls.unexpected.push('openMotherSource');throw new Error('This connection test must not open mother drafts');},
    async validateMother(){calls.unexpected.push('validateMother');throw new Error('This connection test must not read mother drafts');},
    async runDraft(){calls.unexpected.push('runDraft');throw new Error('This connection test must not write ERP products');}
  }});
  const original=fixture.app.preferences.view();
  if(kind==='fresh')fixture.app.preferences.update({revision:original.revision,stores:[],erpConnections:[],browsers:[]});
  else fixture.app.preferences.update({revision:original.revision,
    browsers:[{key:original.browsers[0].key,type:'chrome',name:'隔离浏览器 A',debugPort:9331},
      {key:'fixture-browser-b',type:'chrome',name:'隔离浏览器 B',debugPort:9332}],
    erpConnections:[{...original.erpConnections[0],name:'隔离账号 A',expectedAccount:'fixture-existing-a'},
      {key:'fixture-erp-b',provider:'dianxiaomi',name:'隔离账号 B',expectedAccount:'fixture-existing-b',browserKey:'fixture-browser-b'}]
  });
  const initial=await fixture.api('/api/settings');
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  page.on('pageerror',error=>calls.errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==fixture.base){calls.blocked.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
    if(request.method()==='POST'){
      if(url.pathname==='/api/settings'||url.pathname==='/api/settings/chrome/save')calls.settings.push(request.postDataJSON());
      else if(!['/api/temu/erp/connection','/api/temu/erp/open-login'].includes(url.pathname)){
        calls.unexpected.push(url.pathname);return route.abort('blockedbyclient');
      }
    }
    return route.continue();
  });
  return {kind,fixture,page,context,calls,control,initial};
}

const erpRow=(page,key)=>page.locator('#erpList .config-row').filter({has:page.locator(`[data-erp-check="${key}"]`)});
async function settled(page){
  await page.waitForFunction(()=>!document.querySelector('#saveErp')?.disabled&&!document.querySelector('#storeForm')?.inert&&!document.querySelector('#settingsPage')?.inert);
}
async function reveal(page,selector){
  const ancestors=page.locator(selector).locator('xpath=ancestor::details');
  for(let index=0;index<await ancestors.count();index++){
    const details=ancestors.nth(index);
    if(!await details.evaluate(element=>element.open))await details.locator(':scope > summary').click();
  }
}
async function checked(h,key,mode){
  const {page,calls,control}=h,previous=calls.checks.length;
  control.modes.set(key,mode);
  const response=page.waitForResponse(response=>response.url()===h.fixture.base+'/api/temu/erp/connection'&&response.request().method()==='POST');
  await erpRow(page,key).locator('[data-erp-check]').click();
  await response;
  await settled(page);
  await page.waitForFunction(key=>!document.querySelector(`[data-erp-check="${key}"]`)?.disabled,key);
  assert.equal(calls.checks.length,previous+1,'one explicit check must issue one fixture check');
  const status=erpRow(page,key).locator('.last-check');
  await status.waitFor();
  if(mode==='matched')assert.equal(await status.locator('xpath=self::*[contains(concat(" ",normalize-space(@class)," ")," success ")]').count(),1,'matching login must be visibly verified');
  else assert.equal(await erpRow(page,key).locator('.last-check.success').count(),0,`${mode} must not show verified login`);
}
async function screenshotSizes(h,label){
  for(const width of [390,1024,1440]){
    await h.page.setViewportSize({width,height:width===390?844:1000});
    await h.page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    assert.ok(await h.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}: horizontal overflow at ${width}px`);
    await h.page.screenshot({path:path.join(output,`${h.kind}-${label}-${width}.png`),fullPage:true});
  }
}
async function closeHarness(h){
  assert.deepEqual(h.calls.blocked,[],'settings must not contact external sites on its own');
  assert.deepEqual(h.calls.unexpected,[],'connection settings must not invoke mother/product operations');
  assert.deepEqual(h.calls.errors,[],'settings page must not throw renderer errors');
  assert.equal(h.fixture.writes.length,0);
  reports.push({kind:h.kind,loginOpens:h.calls.open.length,loginChecks:h.calls.checks.length,settingsSaves:h.calls.settings.length,realErpWrites:0,errors:h.calls.errors});
  await h.context.close();
  await h.fixture.close();
}

let current;
try{
  current=await harness('fresh');
  {
    const h=current,{page,fixture,calls,control}=h;
    await page.goto(fixture.base+'/settings');
    await page.locator('#browserDefault').waitFor();
    assert.equal(await page.locator('#setupNext').isHidden(),true,'fresh setup has one primary start action');
    assert.equal(await page.locator('#browserEditor').evaluate(element=>element.open),false);
    assert.equal(await page.locator('#storeEditor').isHidden(),true);
    assert.equal(calls.open.length+calls.checks.length+calls.settings.length,0,'opening settings must not save or connect');
    await screenshotSizes(h,'initial');
    checks.push('fresh settings makes no connection or configuration request and folds advanced/editor controls');

    await page.click('#browserDefault');
    await fixture.wait('/api/settings',settings=>settings.browsers.length===1);
    await settled(page);
    const defaultChrome=(await fixture.api('/api/settings')).browsers[0];
    assert.equal(defaultChrome.type,'chrome');assert.equal(defaultChrome.connectionMode,'existing','first use must reuse the logged-in Chrome profile');
    assert.equal(Object.hasOwn(defaultChrome,'debugPort'),false,'existing Chrome must not inherit a dedicated port');
    assert.equal(calls.chromeProbes+calls.existingChromeProbes,0,'saving the default connection does not probe or authorize Chrome');
    assert.equal(calls.open.length+calls.checks.length,0,'saving a browser is not a login check');
    await page.click('#resetErp');
    await page.locator('#erpForm [name="expectedAccount"]').fill('fixture-new-account');
    assert.equal(await page.locator('#erpForm [name="expectedAccount"]').evaluate(element=>element.required),true);
    assert.match(await page.locator('#saveErp').textContent(),/保存并打开登录/);
    assert.equal(await page.locator('#erpAdvanced').evaluate(element=>element.open),false);
    control.openDelay=200;
    await page.locator('#erpForm').evaluate(form=>{const button=form.querySelector('#saveErp');form.requestSubmit(button);form.requestSubmit(button);});
    const first=(await fixture.wait('/api/settings',settings=>settings.erpConnections.length===1)).erpConnections[0];
    await erpRow(page,first.key).waitFor();
    await settled(page);
    assert.equal(calls.open.length,1,'rapid repeated submit must open login once');
    assert.deepEqual(calls.open[0],{browserKey:defaultChrome.key,connectionMode:'existing'},'ERP login must use the saved existing-Chrome connection');
    assert.equal((await fixture.api('/api/settings')).erpConnections.length,1,'rapid submit must not create duplicate accounts');
    assert.ok(first.name.trim(),'optional alias must get a usable name');
    assert.equal(first.expectedAccount,'fixture-new-account');
    assert.equal(await erpRow(page,first.key).locator('.last-check.success').count(),0,'saved/opened is not verified');
    checks.push('first use saves existing Chrome without probes or a port; new ERP uses that binding and repeated submit saves/opens once');

    for(const mode of ['matched','mismatch','unverified','logged-out','error'])await checked(h,first.key,mode);
    assert.ok(calls.checks.every(call=>call.browserKey===defaultChrome.key&&call.connectionMode==='existing'),'login checks must retain the existing-Chrome binding');
    await checked(h,first.key,'matched');
    await page.reload();await erpRow(page,first.key).waitFor();
    assert.equal(await erpRow(page,first.key).locator('.last-check.success').count(),0,'refresh cannot restore login verification');
    checks.push('explicit check distinguishes matched login, wrong account, logged out and connection failure; reload expires proof');

    await page.click('#resetErp');
    await page.locator('#erpForm [name="expectedAccount"]').fill('fixture-open-failure');
    control.failNextOpen=true;
    await page.click('#saveErp');
    const afterFailure=await fixture.wait('/api/settings',settings=>settings.erpConnections.length===2);
    const second=afterFailure.erpConnections.find(erp=>erp.expectedAccount==='fixture-open-failure');
    await page.locator('#notice.error').waitFor();
    await settled(page);
    assert.ok(second,'open failure must preserve successfully saved ERP');
    const beforeRetry=calls.open.length;
    await erpRow(page,second.key).locator('[data-erp-open]').click();
    await page.waitForFunction(key=>!document.querySelector(`[data-erp-open="${key}"]`)?.disabled,second.key);
    assert.equal(calls.open.length,beforeRetry+1);
    assert.equal((await fixture.api('/api/settings')).erpConnections.length,2,'retry open must not create another ERP');
    checks.push('failed login opening preserves saved account; explicit retry opens it without rebuilding');

    await checked(h,first.key,'matched');
    const browserKey=afterFailure.browsers[0].key;
    await page.locator(`[data-browser-edit="${browserKey}"]`).click();
    assert.equal(await page.locator('#chromeConnectionMode').inputValue(),'existing');
    assert.equal(await page.locator('#browserForm [name="debugPort"]').isHidden(),true,'existing Chrome does not expose a dedicated port');
    await page.selectOption('#chromeConnectionMode','dedicated');
    await reveal(page,'#browserForm [name="debugPort"]');
    await page.locator('#browserForm [name="debugPort"]').fill('9344');
    await page.locator('#browserForm button.primary').click();
    await fixture.wait('/api/settings',settings=>settings.browsers[0].debugPort===9344);
    assert.equal((await fixture.api('/api/settings')).browsers[0].connectionMode,'dedicated','port editing is an explicit switch to a dedicated profile');
    assert.equal(await erpRow(page,first.key).locator('.last-check.success').count(),0,'browser change must invalidate login proof');
    assert.deepEqual(storeIdentity(await fixture.api('/api/settings')),[]);
    await screenshotSizes(h,'configured');
    checks.push('explicit switch to a dedicated profile and port change expire login proof and create no stores or mother bindings');
  }
  await closeHarness(current);current=null;

  current=await harness('existing');
  {
    const h=current,{page,fixture,calls,control}=h;
    const before=storeIdentity(h.initial),erpA=h.initial.erpConnections[0],erpB=h.initial.erpConnections[1];
    await page.goto(fixture.base+'/settings');
    await erpRow(page,erpA.key).waitFor();
    assert.equal(await page.locator('#storeEditor').isHidden(),true);
    assert.equal(await page.locator('#erpEditor').evaluate(element=>element.open),false);
    assert.equal(calls.open.length+calls.checks.length+calls.settings.length,0,'existing settings also must not auto-connect');
    await checked(h,erpA.key,'matched');
    assert.equal(await erpRow(page,erpB.key).locator('.last-check.success').count(),0,'one account proof cannot verify another account');
    await checked(h,erpB.key,'mismatch');
    assert.equal(calls.checks.at(-1).browserKey,'fixture-browser-b','checking B must use B browser');
    await screenshotSizes(h,'accounts');
    checks.push('existing accounts stay independent and each check uses its own bound browser');

    await page.click('#resetStore');
    await page.locator('#storeForm [name="expectedStore"]').fill('尚未保存的新店铺');
    await page.locator('#storeForm [name="expectedSite"]').fill('加拿大站');
    await page.locator('#storeForm [name="erpKey"]').selectOption(erpB.key);
    await page.click('#continueStore');
    await page.locator('[data-template="0"] [data-field="name"]').fill('尚未保存的母稿');
    await page.locator('[data-template="0"] [data-field="draftId"]').fill('220114595118926212');
    await page.click('#cancelStore');
    assert.equal(await page.locator('#storeEditor').isHidden(),true,'collapse must hide the editor');
    await page.click('#resumeStore');
    assert.equal(await page.inputValue('#storeForm [name="expectedStore"]'),'尚未保存的新店铺','resume must keep the store name');
    assert.equal(await page.inputValue('#storeForm [name="erpKey"]'),erpB.key,'resume must keep the chosen ERP');
    assert.equal(await page.inputValue('[data-template="0"] [data-field="draftId"]'),'220114595118926212','resume must keep mother draft input');
    await page.reload();
    await page.locator('#storeEditor:not([hidden])').waitFor();
    assert.equal(await page.inputValue('#storeForm [name="expectedStore"]'),'尚未保存的新店铺');
    assert.equal(await page.inputValue('#storeForm [name="erpKey"]'),erpB.key);
    assert.equal(await page.inputValue('[data-template="0"] [data-field="draftId"]'),'220114595118926212');
    assert.equal(await page.locator('.last-check.success').count(),0,'draft restore must not restore login success');

    await page.locator(`[data-browser-edit="${erpA.browserKey}"]`).click();
    assert.equal(await page.locator('#chromeConnectionMode').inputValue(),'dedicated','legacy saved profiles retain their dedicated mode');
    await page.selectOption('#chromeConnectionMode','dedicated');
    await reveal(page,'#browserForm [name="debugPort"]');
    await page.locator('#browserForm [name="debugPort"]').fill('9341');
    await page.locator('#browserForm button.primary').click();
    await fixture.wait('/api/settings',settings=>settings.browsers.find(browser=>browser.key===erpA.browserKey)?.debugPort===9341);
    assert.equal(await page.inputValue('#storeForm [name="erpKey"]'),erpB.key,'saving another browser cannot switch the unsaved store ERP');
    assert.equal(await page.inputValue('[data-template="0"] [data-field="draftId"]'),'220114595118926212');
    await page.reload();await page.locator('#storeEditor:not([hidden])').waitFor();
    assert.equal(await page.inputValue('#storeForm [name="expectedStore"]'),'尚未保存的新店铺','unrelated configuration save must preserve store draft across refresh');
    assert.equal(await page.inputValue('#storeForm [name="erpKey"]'),erpB.key);
    checks.push('store draft survives refresh and unrelated connection changes without being rebound');

    await reveal(page,`[data-erp-remove="${erpB.key}"]`);
    await erpRow(page,erpB.key).locator('[data-erp-remove]').click();
    await fixture.wait('/api/settings',settings=>!settings.erpConnections.some(erp=>erp.key===erpB.key));
    await page.waitForFunction(key=>!document.querySelector(`[data-erp-check="${key}"]`),erpB.key);
    assert.equal(await page.inputValue('#storeForm [name="erpKey"]'),'','removed ERP must require explicit selection instead of choosing A');
    assert.equal(await page.inputValue('#storeForm [name="expectedStore"]'),'尚未保存的新店铺');
    assert.equal(await page.inputValue('[data-template="0"] [data-field="draftId"]'),'220114595118926212');
    await page.reload();await page.locator('#storeEditor:not([hidden])').waitFor();
    assert.equal(await page.inputValue('#storeForm [name="erpKey"]'),'','refresh must not replace an invalid ERP selection with the first account');
    assert.deepEqual(storeIdentity(await fixture.api('/api/settings')),before,'connection-only operations must preserve existing store and mother identity');
    assert.ok(calls.settings.every(payload=>!Object.hasOwn(payload,'stores')),'connection changes must not post store edits');
    await screenshotSizes(h,'draft-restored');
    checks.push('removing draft-selected ERP leaves selection empty and preserves saved stores and mother IDs');
  }
  await closeHarness(current);current=null;
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,source:'isolated merchantFixture with injected ERP adapter',checks,reports,realErpWrites:0,realGenerationCalls:0},null,2));
  for(const file of ['failure.json','fresh-failure.png','existing-failure.png'])fs.rmSync(path.join(output,file),{force:true});
  console.log('Connection-settings browser regression passed: fresh/existing, async duplicate prevention, login proof, draft recovery, account isolation and 390/1024/1440px layouts. No real ERP operations.');
}catch(error){
  if(current)await current.page.screenshot({path:path.join(output,`${current.kind}-failure.png`),fullPage:true}).catch(()=>{});
  fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({passed:false,error:error.stack,checks,reports,current:current?{kind:current.kind,calls:current.calls}:null},null,2));
  throw error;
}finally{
  if(current){await current.context.close().catch(()=>{});await current.fixture.close().catch(()=>{});}
  await browser.close();
}
