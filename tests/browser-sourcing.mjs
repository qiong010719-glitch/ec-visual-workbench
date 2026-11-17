import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench} from '../src/server.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-ui-')),out=path.resolve('tests/results/sourcing');fs.mkdirSync(out,{recursive:true});
let submitted=0;
const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},settingsCodec:{encode:s=>Buffer.from(s).toString('base64'),decode:s=>Buffer.from(s,'base64').toString()},
  sourcingClient:async kind=>({data:kind==='sites'?[{siteId:48,regionId:211,cnName:'美国',currency:'USD'}]:kind==='categories'?[{catId:123,catName:'测试类目',isLeaf:true}]:{total:1,list:[{goodsId:'601105252678120',goodsName:'UI 测试商品（非真实选品结果）',linkUrl:'https://www.geekbi.com/data/goods/detail?goodsId=601105252678120',siteId:48,minPrice:8.04,monthSold:1,updateTime:'2026-11-17T00:00:00.000Z'}]},chargedPoints:0,receivedAt:new Date().toISOString()}),
  collectionAdapter:{resolve:async()=>({sourceUrl:'https://www.temu.com/canvas-g-601105252678120.html'}),collect:async args=>{args.beforeSubmit();submitted++;return {status:'verified',evidence:{tab:'未认领',sourceUrl:args.sourceUrl}};}}});
app.preferences.update({revision:0,browsers:[{key:'chrome-a',type:'chrome',name:'隔离测试浏览器',debugPort:9444}],erpConnections:[{key:'erp-a',name:'测试ERP',browserKey:'chrome-a',expectedAccount:'test-account'}]});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base+'/sourcing');await page.locator('#credentials[open]').waitFor();
  await page.fill('[name=GB_APP_KEY]','fixture-app-key');await page.fill('[name=GB_APP_SECRET]','fixture-app-secret');await page.getByRole('button',{name:'保存并检查连接'}).click();
  await page.getByText('极鲸云连接成功，已读取站点列表。').waitFor();assert.equal(await page.inputValue('[name=GB_APP_SECRET]'),'');
  await page.fill('[name=keywords]','canvas wall art');await page.selectOption('#site','48');await page.click('#searchButton');
  await page.locator('[data-goods]').waitFor();await page.locator('[data-goods]').check();await page.locator('#collect:not([disabled])').waitFor();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'selected.png'),fullPage:true});await page.click('#collect');await page.getByText('已确认入箱',{exact:true}).waitFor();assert.equal(submitted,1);
  await page.reload();await page.getByText('已确认入箱',{exact:true}).waitFor();assert.equal(await page.locator('[data-goods]:checked').count(),0);
  await page.setViewportSize({width:700,height:900});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('Sourcing UI: credential save, filters, selection, batch results and restart passed (isolated fixtures; no live API or ERP calls).');
}finally{await browser.close();await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
