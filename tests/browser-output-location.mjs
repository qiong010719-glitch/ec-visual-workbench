import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {merchantFixture} from './merchant-fixture.mjs';
const f=await merchantFixture(),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
const evidence=path.resolve('tests/results/output-location');fs.mkdirSync(evidence,{recursive:true});
page.on('pageerror',e=>errors.push(e.message));
try{
  const source=await f.api('/api/products/import-folder',{folder:f.input});
  let b=await f.api('/api/products',{requestId:'browser-output-001',storeKey:'merchant-ca',label:'历史批次位置验证',products:[{...source.products[0],count:1}],imageCount:1,ratio:'1:1',mode:'fast'}),route='/api/products/'+b.id;
  delete f.app.store.state.productBatches[b.id].sourceFolder;delete f.app.store.state.productBatches[b.id].outputParent;f.app.store.save();
  await f.api(route+'/plan',{});await f.wait(route,b=>b.phase==='ready');await f.api(route+'/generate',{});await f.wait(route,b=>b.phase==='completed');
  await page.addInitScript(id=>localStorage.setItem('listing-active-task',JSON.stringify({kind:'product',id,mode:'raw'})),b.id);
  await page.goto(f.base+'/temu/listings');await page.locator('#generationPanel').waitFor();
  assert.match(await page.locator('#sourceLocation').textContent(),/未记录原始文件夹/);
  assert.equal(await page.locator('#savedOutputEditor').evaluate(e=>e.open),true);
  const output=path.join(f.dir,'商家选择的结果目录');await page.fill('#savedOutputParent',output);await page.click('#saveOutputParent');
  await page.waitForFunction(()=>document.querySelector('#listingNotice').textContent.includes('已有图片和 Excel 已同步到'));
  b=await f.api(route);assert.equal(b.outputParent,output);assert.ok(fs.existsSync(b.resultPackage.workbook));
  assert.equal(await page.locator('#resultLocation').textContent(),b.resultPackage.folder);
  await page.reload();await page.locator('#generationPanel').waitFor();await page.locator('#savedOutputEditor summary').click();assert.equal(await page.inputValue('#savedOutputParent'),output);
  assert.equal(await page.locator('#resultLocation').textContent(),b.resultPackage.folder);await page.screenshot({path:path.join(evidence,'saved-output.png'),fullPage:true});
  await page.click('#reviewGenerated');await page.locator('.listing-row').waitFor();assert.equal(await page.locator('#savedOutputEditor').isVisible(),false);
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({passed:true,checks:['legacy missing path visible','choose result directory','copy existing Excel and images','reload persistence','review uses copied package'],realGenerationCalls:0,realErpWrites:0,errors},null,2));
  console.log('Output location browser verification passed. Fixture images only; no real generation or ERP writes.');
}finally{await browser.close();await f.close();}
