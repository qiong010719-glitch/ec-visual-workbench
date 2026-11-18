import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench} from '../src/server.mjs';
import {rawFixture} from './fixtures/geekbi-raw.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-ui-')),out=path.resolve('tests/results/sourcing');fs.mkdirSync(out,{recursive:true});
let submitted=0;const queries=[];
const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},settingsCodec:{encode:s=>Buffer.from(s).toString('base64'),decode:s=>Buffer.from(s,'base64').toString()},
  sourcingClient:async(kind,params)=>{
    if(kind==='rawDetail')return rawFixture(params.goodsId,'UI 测试商品（非真实选品结果）');
    if(kind==='search')queries.push(params);
    const empty=params?.keyword==='empty fixture',kettle=params?.keyword==='electric kettle';
    return {data:kind==='sites'?[{siteId:48,regionId:211,cnName:'美国',currency:'USD'},{siteId:6,cnName:'加拿大',currency:'CAD'}]:kind==='categories'?[{catId:123,catName:'测试类目',isLeaf:true}]:{total:empty?0:1,list:empty?[]:[{goodsId:kettle?'601105252678121':'601105252678120',goodsName:kettle?'电水壶测试商品（非真实结果）':'UI 测试商品（非真实选品结果）',linkUrl:'https://www.geekbi.com/data/goods/detail?goodsId=601105252678120',siteId:params?.siteId||48,minPrice:8.04,monthSold:1,updateTime:'2026-11-17T00:00:00.000Z'}]},chargedPoints:0,receivedAt:new Date().toISOString()};
  },
  collectionAdapter:{preflight:async()=>{},resolve:()=>assert.fail('must not open Temu'),importProduct:async args=>{assert.ok(fs.existsSync(args.filePath));args.beforeSubmit();submitted++;return {status:'verified',evidence:{tab:'未认领',sourceUrl:args.sourceUrl}};}}});
app.preferences.update({revision:0,browsers:[{key:'chrome-a',type:'chrome',name:'隔离测试浏览器',debugPort:9444}],erpConnections:[{key:'erp-a',name:'测试ERP',browserKey:'chrome-a',expectedAccount:'test-account'}]});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base+'/sourcing');await page.locator('#credentials[open]').waitFor();
  await page.fill('[name=GB_APP_KEY]','fixture-app-key');await page.fill('[name=GB_APP_SECRET]','fixture-app-secret');await page.getByRole('button',{name:'保存并检查连接'}).click();
  await page.getByText('极鲸云连接成功，已读取站点列表。').waitFor();assert.equal(await page.inputValue('[name=GB_APP_SECRET]'),'');
  assert.equal(await page.inputValue('#matchMode'),'1');
  await page.fill('[name=keywords]','canvas wall art');await page.selectOption('#site','48');await page.click('#searchButton');
  await page.locator('[data-goods]').waitFor();await page.locator('[data-goods]').check();await page.locator('#collect:not([disabled])').waitFor();
  const firstId=await page.inputValue('#searchHistory');assert.equal(queries[0].matchMode,1);assert.match(await page.textContent('#executedFilters'),/canvas wall art.*严格匹配/);
  await page.route('**/api/sourcing/parse',route=>route.fulfill({json:{keywords:['parsed painting'],notes:'隔离解析测试'}}));
  await page.fill('#prompt','帆布画');await page.click('#parse');await page.getByText('隔离解析测试',{exact:true}).waitFor();assert.equal(await page.locator('#collect').isDisabled(),true);assert.equal(await page.locator('#draftNotice').isVisible(),true);
  await page.fill('[name=keywords]','electric kettle');await page.locator('#draftNotice:visible').waitFor();assert.equal(await page.locator('#collect').isDisabled(),true);
  await page.click('#searchButton');await page.getByText('电水壶测试商品（非真实结果）',{exact:true}).waitFor();
  const secondId=await page.inputValue('#searchHistory');assert.notEqual(firstId,secondId);assert.equal(queries[1].keyword,'electric kettle');assert.equal(await page.locator('[data-goods="601105252678120"]').count(),0);
  await page.fill('[name=keywords]','empty fixture');await page.click('#searchButton');await page.getByText('极鲸云未返回符合以上全部条件的商品。可调整关键词、类目，或清空数值限制后重新查询。').waitFor();assert.equal(await page.locator('[data-goods]').count(),0);
  await page.selectOption('#searchHistory',firstId);await page.getByText('UI 测试商品（非真实选品结果）',{exact:true}).waitFor();assert.equal(await page.inputValue('[name=keywords]'),'canvas wall art');assert.equal(await page.locator('#draftNotice').isVisible(),false);
  await page.selectOption('#site','6');assert.match(await page.textContent('#priceMinLabel'),/CAD/);await page.fill('[name=priceMin]','20');await page.fill('[name=monthSoldMin]','500');const beforeClear=queries.length;await page.click('#clearNumericFilters');assert.equal(await page.inputValue('[name=priceMin]'),'');assert.equal(await page.inputValue('[name=monthSoldMin]'),'');assert.equal(queries.length,beforeClear);
  await page.selectOption('#site','48');await page.locator('[data-goods]').check();await page.locator('#collect:not([disabled])').waitFor();
  assert.match(await page.textContent('#importCost'),/预计 50 点/);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'selected.png'),fullPage:true});await page.click('#collect');await page.getByText('已确认入箱',{exact:true}).waitFor();assert.equal(submitted,1);
  await page.reload();await page.getByText('已确认入箱',{exact:true}).waitFor();assert.equal(await page.locator('[data-goods]:checked').count(),0);
  assert.match(await page.textContent('#batches'),/极鲸云详情 \/ 文件导入/);assert.match(await page.textContent('#batches'),/详情扣点回执：50 点/);
  const file=await page.locator('a:has-text("下载导入文件")').getAttribute('href');const download=await page.request.get(base+file);assert.equal(download.status(),200);assert.match(download.headers()['content-type'],/spreadsheetml/);
  await page.setViewportSize({width:700,height:900});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('Sourcing UI: strict keyword changes, empty results, history, stale selections, currency, filter clearing, collection and restart passed (isolated fixtures; no live API or ERP calls).');
}finally{await browser.close();await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
