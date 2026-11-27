import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crossborder-ui-'));
const output=path.resolve('tests/results/crossborder-sync');fs.mkdirSync(output,{recursive:true});
let businessCalls=0;
const denied=()=>{businessCalls++;throw new Error('Business execution is forbidden in this fixture');};
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},chromeInspector:async()=>({listeners:[],processes:[]}),
  provider:denied,planner:denied,erpAdapter:{validateMother:denied,runDraft:denied},listingWorkflowAdapter:{prepare:denied,publish:denied}});
app.preferences.update({revision:0,browsers:[{key:'fixture-chrome',type:'chrome',name:'Fixture Chrome',debugPort:9444}],erpConnections:[{key:'fixture-erp',name:'Fixture ERP',provider:'dianxiaomi',browserKey:'fixture-chrome',expectedAccount:'fixture-account'}],stores:[]});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[];
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
try{
  await page.goto(base+'/settings');await page.locator('#resetStore').click();
  const form=page.locator('#storeForm');
  await form.locator('[name="platform"]').selectOption('amazon');
  await form.locator('[name="expectedStore"]').fill('Amazon fixture store');
  await form.locator('[name="expectedSite"]').fill('美国站');
  await form.locator('[name="erpKey"]').selectOption('fixture-erp');
  assert.equal(await page.locator('#templateInputs').isVisible(),false);
  await page.locator('#saveStore').click();await page.locator('#storeList').getByText('Amazon fixture store · 美国站').waitFor();
  let saved=app.preferences.view().stores.find(store=>store.platform==='amazon');
  assert.ok(saved);assert.deepEqual(saved.templates,[]);assert.equal(businessCalls,0);
  await page.reload();await page.locator('[data-store-edit="'+saved.key+'"]').click();
  assert.equal(await form.locator('[name="platform"]').inputValue(),'amazon');
  await form.locator('[name="expectedStore"]').fill('Amazon fixture updated');
  await page.locator('#saveStore').click();await page.locator('#storeList').getByText('Amazon fixture updated · 美国站').waitFor();
  assert.equal(app.preferences.view().stores.filter(store=>store.platform==='amazon').length,1);
  assert.equal(businessCalls,0);
  await page.locator('#resetStore').click();
  assert.equal(await form.locator('[name="platform"]').inputValue(),'temu');
  await form.locator('[name="expectedStore"]').fill('Temu fixture');await form.locator('[name="expectedSite"]').fill('加拿大站');
  await form.locator('[name="erpKey"]').selectOption('fixture-erp');await page.locator('#continueStore').click();
  assert.equal(await page.locator('#templateInputs').isVisible(),true);

  // New pages must retain the same shell, active entry, theme and mobile layout.
  for(const theme of ['dark','light'])for(const [route,entry,ready] of [['/sourcing/free','sourcing','#startFree'],['/sourcing/listing?mode=template','listings','#saveTemplate']]){
    await page.evaluate(theme=>localStorage.setItem('commerce-cockpit-appearance',JSON.stringify({theme,motion:false,material:false})),theme);
    await page.goto(base+route);await page.locator(ready).waitFor();
    await page.waitForFunction(entry=>document.querySelector('.workspace-shell [data-workspace-entry="'+entry+'"]')?.getAttribute('aria-current')==='page',entry,{timeout:5000});
    assert.equal(await page.locator('html').getAttribute('data-workspace-entry'),entry);
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===390?844:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' '+theme+' '+width);
      await page.screenshot({path:path.join(output,entry+'-'+theme+'-'+width+'.png'),fullPage:true});
    }
  }
  assert.equal(businessCalls,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Crossborder UI integration passed: Amazon store creation/edit without Temu validation, switching back to Temu, active navigation, both themes and 390/1440px pages. No real business calls.');
}finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
