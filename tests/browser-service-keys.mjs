import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';

const output=path.resolve('tests/results/service-keys');fs.mkdirSync(output,{recursive:true});
const codec={encode:v=>Buffer.from(v).toString('base64'),decode:v=>Buffer.from(v,'base64').toString()};
const fixture=await merchantFixture({configuration:{WORKBENCH_FRESH:'true',APIFY_TOKEN_FILE:path.join(os.tmpdir(),'service-key-fixture-no-token-file')},settingsCodec:codec});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
const errors=[],external=[],writes=[];let rejectNext=false;
const keys={SUANZHOU_IMAGE_API_KEY:'fixture-image-secret',PLANNER_API_KEY:'fixture-text-secret',SUANZHOU_VIDEO_API_KEY:'fixture-video-secret',APIFY_API_TOKEN:'fixture-link-secret'};
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==fixture.base){external.push(url.origin+url.pathname);return route.abort();}
  if(request.method()==='POST'){
    writes.push(url.pathname);
    if(url.pathname==='/api/settings'&&rejectNext){rejectNext=false;return route.fulfill({status:409,json:{error:'隔离验收：配置已更新，请刷新后再保存'}});}
  }
  return route.continue();
});
const field=name=>page.locator(`#modelForm [name="${name}"]`);
const idle=()=>page.waitForFunction(()=>!document.querySelector('#settingsPage').inert);
try{
  await page.goto(fixture.base+'/settings');await page.locator('[data-secret-status="APIFY_API_TOKEN"]').filter({hasText:'未配置'}).waitFor();
  assert.equal(await page.locator('.workbench-nav [data-workspace-entry="settings"]').innerText(),'设置');
  assert.equal(await page.locator('#nav-rating,#nav-partners,#view-partners').count(),0);
  assert.deepEqual(await page.locator('.service-key-heading h3').allTextContents(),['生图密钥','文字密钥','视频密钥','链接分析密钥']);
  assert.deepEqual(await page.locator('#modelForm [name]').evaluateAll(elements=>elements.map(e=>e.name)),Object.keys(keys));
  assert.match(await page.locator('#serviceConfigHint').innerText(),/对应服务的网站.*网站内置.*用户无法修改/s);
  assert.match(await page.locator('#videoKeyTitle').locator('..').locator('..').innerText(),/视频生成接入准备中/);
  assert.deepEqual(writes,[],'opening settings must not save or call providers');
  assert.equal(fixture.app.research.client.configured,false);
  for(const [name,value] of Object.entries(keys))await field(name).fill(value);
  rejectNext=true;await page.locator('#modelForm button[type="submit"]').click();await page.locator('#notice.error').waitFor();await idle();
  for(const [name,value] of Object.entries(keys))assert.equal(await field(name).inputValue(),value,'failed save preserves typed key');
  await page.locator('#modelForm button[type="submit"]').click();await page.locator('#notice').filter({hasText:'配置已保存在本机。'}).waitFor();await idle();
  for(const name of Object.keys(keys)){
    assert.equal(await field(name).inputValue(),'');assert.equal(await page.locator(`[data-secret-status="${name}"]`).innerText(),'已保存');
  }
  assert.equal(fixture.app.research.client.token,keys.APIFY_API_TOKEN,'saving immediately configures the existing link-grab client');
  const settings=await fixture.api('/api/settings');
  for(const [name,value] of Object.entries(keys)){
    assert.equal(settings.models[name+'Configured'],true);assert.equal(JSON.stringify(settings).includes(value),false);
    for(const file of ['settings.json','secrets.json'])assert.equal(fs.readFileSync(path.join(fixture.dir,'data/preferences',file),'utf8').includes(value),false);
  }
  const bindings={browsers:settings.browsers,erpConnections:settings.erpConnections,stores:settings.stores};
  await field('SUANZHOU_IMAGE_API_KEY').fill('fixture-replacement-image');
  await page.locator('#modelForm button[type="submit"]').click();await idle();
  assert.equal(fixture.app.research.client.token,keys.APIFY_API_TOKEN,'blank link key preserves saved token');
  await assert.rejects(fixture.api('/api/settings',{revision:(await fixture.api('/api/settings')).revision,models:{PLANNER_BASE_URL:'https://changed.invalid',PLANNER_API_KEY:'must-not-save'}}),/网站内置/);
  const after=await fixture.api('/api/settings');assert.equal(after.revision,settings.revision+1);assert.deepEqual({browsers:after.browsers,erpConnections:after.erpConnections,stores:after.stores},bindings);
  await page.reload();await page.locator('[data-secret-status="APIFY_API_TOKEN"]').filter({hasText:'已保存'}).waitFor();
  for(const name of Object.keys(keys))assert.equal(await field(name).inputValue(),'');
  const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
  for(const value of Object.values(keys))assert.equal(storage.includes(value),false);
  for(const theme of ['dark','light']){
    await page.evaluate(theme=>{localStorage.setItem('commerce-cockpit-appearance',JSON.stringify({theme,accent:'ocean'}));},theme);await page.reload();
    await page.locator('[data-secret-status="APIFY_API_TOKEN"]').filter({hasText:'已保存'}).waitFor();
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1100});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${theme} ${width}px horizontal overflow`);
      await page.locator('#modelSettings').screenshot({path:path.join(output,`${theme}-${width}.png`)});
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(fixture.writes.length,0);
  assert.ok(writes.every(route=>route==='/api/settings'),'only explicit key saves are posted');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks:['four key sections','fixed settings enforced by server','secret save/reload/blank preservation','failure preserves inputs','encrypted fixture storage and no browser cache','live link client update','existing connections preserved','dark/light desktop/mobile'],errors,externalRequests:external,realProviderCalls:0},null,2));
  console.log('Service-key browser checks passed; no real provider or ERP calls.');
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await browser.close();await fixture.close();}
