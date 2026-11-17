import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {merchantFixture} from './merchant-fixture.mjs';
import {writeWorkbook} from '../src/workbook.mjs';

const f=await merchantFixture(),browser=await chromium.launch({channel:'msedge',headless:true});
const failures=[],passed=[],errors=[];
async function check(name,run){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  if(process.env.FORM_VALUES_BASELINE==='true')for(const name of ['product-workflow','temu-listings','multisets'])await page.route('**/local/'+name+'.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.resolve('../outputs/platform-form-fix-20261106/'+name+'.before.js'),'utf8')}));
  try{await run(page);passed.push(name);}catch(e){failures.push({name,error:e.message});}
  finally{await page.close();}
}
const setValue=(locator,value)=>locator.evaluate((el,v)=>{el.value=v;},value);
async function importProducts(page){
  await page.goto(f.base+'/temu/listings');await page.selectOption('#targetStore','merchant-ca');
  await page.fill('#folderPath',f.input);await page.click('#importFolder');await page.locator('[data-product="1"]').waitFor();
}
const product=(page,index,field)=>page.locator(`[data-product="${index}"] [data-field="${field}"]`);
const reviewed=(page,index,field)=>page.locator(`[data-row="${index}"] [data-field="${field}"]`);
const ready=path.join(f.dir,'成品');fs.mkdirSync(ready);
for(const code of ['READY-A','READY-B']){
  fs.mkdirSync(path.join(ready,code));
  for(const name of ['01.png','02.png'])fs.copyFileSync(path.join(f.input,'CANVAS-A','01.png'),path.join(ready,code,name));
}
writeWorkbook(['READY-A','READY-B'].map(productCode=>({productCode,title:'原始商品标题',englishTitle:'Original Canvas Art'})),path.join(ready,'商品.xlsx'));
async function importReview(page){
  await page.goto(f.base+'/temu/listings');await page.click('#folderTab');await page.selectOption('#targetStore','merchant-ca');
  await page.fill('#folderPath',ready);await page.click('#importFolder');await page.locator('[data-row="1"]').waitFor();
}
try{
  await check('原图商品提交使用当前值及母稿',async page=>{
    await importProducts(page);
    for(const [key,value] of Object.entries({productCode:'CURRENT-001',name:'输入框的新商品',description:'用户当前填写的卖点',count:'3',templateKey:'canvas-b'}))await setValue(product(page,0,key),value);
    const response=page.waitForResponse(r=>r.url()===f.base+'/api/products'&&r.request().method()==='POST');
    await page.click('#createBatch');const result=await response;assert.equal(result.status(),200);
    const saved=await result.json();const p=saved.products[0];
    assert.equal(p.productCode,'CURRENT-001');assert.equal(p.name,'输入框的新商品');assert.equal(p.description,'用户当前填写的卖点');assert.equal(p.count,3);assert.equal(p.templateKey,'canvas-b');
    await page.reload();await page.locator('#generationPanel').waitFor();assert.match(await page.locator('#batchProducts').textContent(),/CURRENT-001/);
  });
  await check('移除商品及切换店铺保留其他资料',async page=>{
    await importProducts(page);await setValue(product(page,1,'name'),'保留的第二件');
    await page.click('[data-remove="0"]');assert.equal(await product(page,0,'name').inputValue(),'保留的第二件');
    await setValue(product(page,0,'description'),'切换店铺保留当前卖点');await page.selectOption('#targetStore','merchant-other');
    assert.equal(await product(page,0,'description').inputValue(),'切换店铺保留当前卖点');
  });
  await check('保存一个产品的标题保留其他产品的未保存修改',async page=>{
    await importProducts(page);await product(page,0,'count').fill('1');await product(page,1,'count').fill('1');
    await page.selectOption('#imageCount','1');await page.click('#createBatch');await page.locator('#generationPanel').waitFor();
    await page.click('#planBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
    const products=page.locator('#batchProducts [data-id]');
    await setValue(products.nth(0).locator('[data-title="title"]'),'First Updated Canvas Art');
    await setValue(products.nth(1).locator('[data-title="title"]'),'Second Unsaved Canvas Art');
    await products.nth(0).locator('[data-save-titles]').click();
    await page.waitForFunction(()=>document.querySelector('#listingNotice').textContent==='本产品的上架标题与英文版本已保存。');
    assert.equal(await products.nth(1).locator('[data-title="title"]').inputValue(),'Second Unsaved Canvas Art');
    let attempted=0;await page.route('**/api/products/*/generate',route=>{attempted++;return route.fulfill({status:409,json:{error:'测试已拦截未保存方案生图'}});});
    await page.click('#generateBatch');await page.waitForFunction(()=>document.querySelector('#listingNotice').classList.contains('error'));
    assert.equal(attempted,0);assert.match(await page.locator('#listingNotice').textContent(),/先保存.*标题/);
    await products.nth(1).locator('[data-save-titles]').click();
    await page.waitForFunction(()=>document.querySelector('#listingNotice').textContent==='本产品的上架标题与英文版本已保存。');
    await page.reload();await page.locator('#generationPanel').waitFor();
    assert.equal(await products.nth(0).locator('[data-title="title"]').inputValue(),'First Updated Canvas Art');
    assert.equal(await products.nth(1).locator('[data-title="title"]').inputValue(),'Second Unsaved Canvas Art');
  });
  await check('核对清单提交使用当前文字及所选母稿',async page=>{
    await importReview(page);
    for(const [key,value] of Object.entries({productCode:'REVIEW-001',title:'最新核对标题',englishTitle:'Current Canvas Title',templateKey:'canvas-b'}))await setValue(reviewed(page,0,key),value);
    const response=page.waitForResponse(r=>r.url()===f.base+'/api/temu/erp/prepare'&&r.request().method()==='POST');
    await page.click('#prepareBatch');const result=await response;assert.equal(result.status(),200);const saved=await result.json();
    assert.equal(saved.rows[0].productCode,'REVIEW-001');assert.equal(saved.rows[0].title,'最新核对标题');assert.equal(saved.rows[0].englishTitle,'Current Canvas Title');assert.equal(saved.rows[0].mother.draftId,'987654322');
    await page.reload();await page.locator('#executionPanel').waitFor();assert.equal(await reviewed(page,0,'productCode').inputValue(),'REVIEW-001');
  });
  await check('设计方案当前修改必须保存后才能生图',async page=>{
    const imported=await f.api('/api/products/import-folder',{folder:f.input});
    const batch=await f.api('/api/products',{requestId:'form-values-plans',platform:'temu',storeKey:'merchant-ca',label:'设计方案检查',products:[{...imported.products[0],count:1,templateKey:'canvas-a'}],imageCount:1,ratio:'1:1',mode:'fast'});
    const route='/api/products/'+batch.id;await f.api(route+'/plan',{});
    const planned=await f.wait(route,b=>b.phase==='ready');const groupId=planned.products[0].groupId;
    await page.addInitScript(()=>localStorage.setItem('aplus_newbie_tour_v1','true'));
    await page.goto(f.base+'/temu?group='+groupId+'#multisets');
    await page.locator('.ms-set details summary').click();const plan=page.locator('[data-plan]').first();
    const current=(await plan.inputValue())+'\n补充：保留用户指定的真实商品色彩。';
    await setValue(plan,current);
    let attempted=0;page.on('dialog',dialog=>dialog.accept());
    await page.route(/\/api\/(?:temu\/)?multisets\/[^/]+\/generate$/,route=>{attempted++;return route.fulfill({status:409,json:{error:'测试拦截旧方案生图'}});});
    await page.click('#msGenerateAll');await page.waitForFunction(()=>document.querySelector('#msNotice').textContent.length>0);
    assert.equal(attempted,0);assert.match(await page.locator('#msNotice').textContent(),/先保存/);assert.equal(await plan.inputValue(),current);
    const saved=page.waitForResponse(r=>r.url().endsWith('/plan-text')&&r.request().method()==='POST');
    await page.locator('[data-action="save-plan"]').first().click();assert.equal((await saved).status(),200);
    await page.reload();await page.locator('.ms-set details summary').click();assert.equal(await plan.inputValue(),current);
  });
  await check('图片排序及切换店铺保留核对文字',async page=>{
    await importReview(page);await setValue(reviewed(page,0,'title'),'排序后仍保留的标题');
    await page.locator('[data-row="0"] [data-earlier]').nth(1).click();
    assert.equal(await reviewed(page,0,'title').inputValue(),'排序后仍保留的标题');
    await setValue(reviewed(page,0,'englishTitle'),'Retain Across Stores');await page.selectOption('#targetStore','merchant-other');
    assert.equal(await reviewed(page,0,'englishTitle').inputValue(),'Retain Across Stores');
    await page.reload();await page.locator('[data-row="1"]').waitFor();assert.equal(await reviewed(page,0,'englishTitle').inputValue(),'Retain Across Stores');
  });
  await check('刷新前保存当前核对内容',async page=>{
    await importReview(page);await setValue(reviewed(page,0,'title'),'刷新前当前标题');
    await page.reload();await page.locator('[data-row="1"]').waitFor();assert.equal(await reviewed(page,0,'title').inputValue(),'刷新前当前标题');
  });
  await check('执行前发现未同步修改时阻止旧清单执行',async page=>{
    await importReview(page);await page.click('#prepareBatch');await page.locator('#executionPanel').waitFor();
    let attempted=0;await page.route('**/api/temu/erp/batches/*/start',route=>{attempted++;return route.fulfill({status:409,json:{error:'测试已拦截旧清单执行'}});});
    await setValue(reviewed(page,0,'title'),'清单生成后的新标题');await page.click('#startBatch');
    await page.waitForFunction(()=>document.querySelector('#listingNotice').classList.contains('error'));
    assert.equal(attempted,0,'stale execution must be stopped before sending the start request');
    assert.match(await page.locator('#listingNotice').textContent(),/重新生成执行清单/);
    assert.equal(f.writes.length,0);assert.equal(await page.locator('#executionPanel').isVisible(),false);
  });
  const report={passed,failures,pageErrors:errors,realModelCalls:0,realErpWrites:0};
  console.log(JSON.stringify(report,null,2));
  const output=path.resolve('tests/results/form-values');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,process.env.FORM_VALUES_BASELINE==='true'?'before.json':'after.json'),JSON.stringify(report,null,2));
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0,'these checks must never execute ERP jobs');
  assert.deepEqual(failures,[]);
}finally{await browser.close();await f.close();}
