import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench,root} from '../src/server.mjs';

const output=path.join(root,'tests/results/erp');fs.mkdirSync(output,{recursive:true});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'erp-browser-'));let calls=0;const errors=[];
const app=createWorkbench({dataDirectory:directory,configuration:{},erpAdapter:{checkConnection:async()=>({connected:true,erpOpen:true,loggedIn:true,account:'fixture'}),runDraft:async({row,onProgress})=>{
  calls++;onProgress('building');await new Promise(r=>setTimeout(r,350));onProgress('saving');onProgress('reading-back',{draftId:'TEST-'+row.productCode});
  return {draftId:'TEST-'+row.productCode,url:'https://www.dianxiaomi.com/web/popTemu/edit?id=123',published:false,sourceUnchanged:true};
}}});
for(let i=0;i<3;i++)await sharp(Buffer.from(`<svg width="200" height="260" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="260" fill="${['#abc3d9','#dfb48b','#a8c4b7'][i]}"/><text x="20" y="130" font-size="25">TEST IMAGE ${i+1}</text></svg>`)).png().toFile(path.join(app.mediaDirectory,`sample-${i}.png`));
app.store.state.drafts.push({id:'test-local-draft',platform:'temu',title:'界面流程测试素材',images:[0,1,2].map(i=>`/media/sample-${i}.png`)});app.store.save();
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base+'/temu/listings');await page.locator('#targetStore option[value="store2-ca"]').waitFor({state:'attached'});
  await page.locator('#checkConnection').click();await page.getByText('店小秘已登录：fixture',{exact:true}).waitFor();
  await page.locator('#generatedTab').click();await page.selectOption('#generatedChoice','draft:test-local-draft');await page.locator('#importGenerated').click();await page.locator('.listing-row').waitFor();
  await page.selectOption('#targetStore','store2-ca');await page.locator('#prepareBatch').click();await page.getByText('请填写 1—250 字的产品标题和英文标题').waitFor();
  await page.getByLabel('商品1英文标题').fill('Explicit UI test fixture');await page.getByLabel('商品1货号').fill('UI-TEST-001');
  await page.locator('[data-earlier="i3"]').click();assert.equal(await page.locator('.listing-thumb').nth(1).locator('input').getAttribute('data-image'),'i3');
  await page.locator('input[data-image="i2"]').uncheck();await page.screenshot({path:path.join(output,'01-review.png'),fullPage:true});
  await page.reload();await page.getByLabel('商品1英文标题').waitFor();assert.equal(await page.getByLabel('商品1英文标题').inputValue(),'Explicit UI test fixture');assert.equal(await page.inputValue('#targetStore'),'store2-ca');assert.equal(await page.locator('input[data-image="i2"]').isChecked(),false);
  await page.locator('#prepareBatch').click();await page.locator('#executionPanel').waitFor();assert.match(await page.locator('#executionSummary').innerText(),/店铺2测试/);assert.match(await page.locator('#executionRows').innerText(),/UI-TEST-001/);
  await page.locator('#startBatch').click();await page.reload();await page.getByText('待发布 · 已核验',{exact:true}).count();
  await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');assert.equal(calls,1);
  assert.equal(await page.locator('#targetStore').inputValue(),'store2-ca');assert.equal(await page.getByLabel('商品1货号').inputValue(),'UI-TEST-001');
  assert.equal(await page.locator('#executionRows a').count(),1);assert.equal(await page.locator('#startBatch').isDisabled(),true);
  await page.screenshot({path:path.join(output,'02-result.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'03-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert.equal((await fetch(base+'/api/temu/erp/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,backend:'explicit-ERP-test-double',realErpWrites:0,calls,errors,checks:['generated source import','required titles','store/mother mapping','image reordering and exclusion','prepare and execute','reload recovery without duplicate','mobile layout','CSRF required']},null,2));console.log('ERP browser checks passed (test double, no real ERP write)');
}catch(e){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw e;}
finally{await browser.close();await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
