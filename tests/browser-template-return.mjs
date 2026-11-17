import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {merchantFixture} from './merchant-fixture.mjs';
import {sourceStep,storeIdle} from './merchant-ui.mjs';
let hold,release,fail=false;
const f=await merchantFixture({erpAdapter:{validateMother:async({store})=>{if(hold)await hold;if(fail)throw Error('模拟连接中断');return {valid:true,issues:[],sourceMode:'product',draftId:store.draftId,sourceTitle:'读取到的商品',shippingTemplate:'加拿大',checkedAt:new Date().toISOString()};}}}),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();
try{
 await page.goto(f.base+'/settings');await page.click('[data-store-edit="merchant-ca"]');await page.click('#addTemplate');const row=page.locator('[data-template="2"]'),field=n=>row.locator(`[data-field="${n}"]`);
 const link='https://www.dianxiaomi.com/web/popTemu/edit?id=220114595118926212';await field('name').fill('尚未保存');await field('draftId').fill(link);await row.locator('[data-open-template]').click();await storeIdle(page);
 await page.reload();await row.waitFor();assert.equal(await field('draftId').inputValue(),link);assert.equal(await field('name').inputValue(),'尚未保存');assert.equal(await row.locator('select').count(),0);
 hold=new Promise(r=>release=r);await row.locator('[data-check-template]').click();await page.waitForFunction(()=>document.querySelector('#storeForm').inert);
 await field('draftId').evaluate(el=>{el.value='220114595117160176';});release();hold=null;await storeIdle(page);assert.equal(await field('draftId').inputValue(),'220114595117160176');assert.equal(await row.locator('[data-binding-state]').textContent(),'待校验','stale response cannot validate another input');
 fail=true;await row.locator('[data-check-template]').click();await storeIdle(page);assert.match(await row.locator('[data-template-status]').textContent(),/模拟连接中断/);assert.equal(await field('draftId').inputValue(),'220114595117160176');
 fail=false;await field('name').fill('');await row.locator('[data-check-template]').click();await storeIdle(page);assert.equal(await field('name').inputValue(),'读取到的商品');assert.match(await row.locator('[data-binding-state]').textContent(),/已校验.*待保存/);
 assert.equal((await f.api('/api/settings')).stores[0].templates.length,2);assert.equal(f.writes.length,0);console.log('母稿重开/重读回归通过：保留未保存链接、旧响应不误绑、连接失败可重试、按源商品自动命名。');
}finally{await browser.close();await f.close();}
