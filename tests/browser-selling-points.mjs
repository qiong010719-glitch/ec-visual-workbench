import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {merchantFixture} from './merchant-fixture.mjs';
let recognized=0;const titleSources=[];
const f=await merchantFixture({productRecognizer:async()=>{recognized++;return {productName:'蓝金街景装饰画',points:[{visualFeature:'蓝色街景与金色灯光',sellingPoint:'冷暖色彩对比的街景图案',imageIndexes:[1]}]};},titlePlanner:async g=>{titleSources.push(g.source);return g.sets.map(s=>({setId:s.id,title:'Blue and Gold Street Scene Decorative Art Print',englishTitle:'Blue and Gold Street Scene Decorative Art Print'}));}});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],out=path.resolve('tests/results/selling-points');fs.mkdirSync(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(f.base+'/temu/listings');await page.selectOption('#targetStore','merchant-ca');await page.fill('#folderPath',f.input);await page.click('#importFolder');await page.locator('[data-product="1"]').waitFor();
  const provided='突出原图花朵图案与暖色搭配';
  await page.locator('[data-product="0"] [data-field="description"]').fill(provided);await page.locator('[data-product="1"] [data-field="description"]').fill('');
  for(const index of [0,1])await page.locator(`[data-product="${index}"] [data-field="count"]`).fill('1');await page.selectOption('#imageCount','1');
  assert.equal(await page.getByText('商品卖点与资料（选填）',{exact:false}).count(),2);await page.screenshot({path:path.join(out,'optional-input.png'),fullPage:true});
  await page.click('#createBatch');await page.locator('#generationPanel').waitFor();assert.equal(recognized,0);await page.click('#planBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
  assert.equal(recognized,1);assert.equal(titleSources[0].product_desc,provided);assert.equal(titleSources[0].product_fact_source,'user');assert.equal(titleSources[1].product_fact_source,'image');
  assert.equal(await page.locator('.recognized-points').count(),1);await page.locator('.recognized-points summary').click();await page.getByText('冷暖色彩对比的街景图案',{exact:false}).waitFor();
  await page.click('#generateBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='素材已完成');assert.ok(fs.existsSync((await page.locator('#workbookLocation').textContent()).trim()));
  await page.screenshot({path:path.join(out,'recognized-result.png'),fullPage:true});await page.reload();await page.locator('#generationPanel').waitFor();assert.equal(recognized,1);assert.equal(await page.locator('.recognized-points').count(),1);
  await page.click('#reviewGenerated');await page.locator('.listing-row').nth(1).waitFor();assert.equal(f.writes.length,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,recognitionCalls:recognized,realModelCalls:0,realErpWrites:0,checks:['filled input remains authoritative','blank input saves successfully','recognition feeds image plan and titles','visible recognized points','export to Excel and image folders','reload preserves recognition','enter listing review'],errors},null,2));console.log('Selling-points browser flow passed with injected models and no real ERP writes.');
}finally{await browser.close();await f.close();}
