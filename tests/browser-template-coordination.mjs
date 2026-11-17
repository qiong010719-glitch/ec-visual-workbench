import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {merchantFixture} from './merchant-fixture.mjs';
import {sourceStep,storeIdle} from './merchant-ui.mjs';
const f=await merchantFixture(),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(f.base+'/settings');await page.click('[data-store-edit="merchant-ca"]');assert.equal(await page.locator('.mother-editor:visible').count(),0);assert.equal(await page.locator('#templateInputs select').count(),0);
 await page.click('#addTemplate');const row=page.locator('[data-template="2"]'),field=n=>row.locator(`[data-field="${n}"]`);await field('name').fill('狮子山');await field('draftId').fill('https://www.dianxiaomi.com/web/popTemu/edit?id=220114595117160176');
 f.invalidMothers.add('220114595117160176');await row.locator('[data-check-template]').click();await storeIdle(page);assert.match(await row.locator('[data-template-status]').textContent(),/不属于当前店铺|库存/);assert.equal(await row.locator('.mother-editor').isVisible(),true);
 await row.locator('[data-open-template]').click();await storeIdle(page);assert.equal(f.motherOpens.at(-1).draftId,'220114595117160176');f.invalidMothers.clear();await row.locator('[data-check-template]').click();await storeIdle(page);assert.match(await row.locator('[data-binding-state]').textContent(),/已校验.*待保存/);assert.equal(await row.locator('.mother-editor').isVisible(),false);
 await sourceStep(page,2);await field('draftId').fill('220114595116064422');assert.equal(await row.locator('[data-binding-state]').textContent(),'待校验');await field('draftId').fill('220114595117160176');
 const saved=page.waitForResponse(r=>r.url()===f.base+'/api/settings'&&r.request().method()==='POST');await page.click('#saveStore');assert.equal((await saved).status(),200);await storeIdle(page);assert.equal(await row.locator('[data-binding-state]').textContent(),'已校验');
 const config=await f.api('/api/settings'),mother=config.stores.find(s=>s.key==='merchant-ca').templates[2];assert.equal(mother.draftId,'220114595117160176');assert.equal(mother.sourceMode,'product');assert.equal(mother.templateId,undefined);assert.equal(mother.templateName,undefined);
 await page.reload();await row.waitFor();assert.equal(await row.locator('[data-binding-state]').textContent(),'已校验');await page.locator('#storeForm [name="expectedSite"]').fill('美国站');assert.equal(await row.locator('[data-binding-state]').textContent(),'待校验');
 await page.setViewportSize({width:600,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);console.log('按链接配置回归通过：无模板选择、错店拦截、长 ID、源信息回显、保存恢复、上下文变化失效。');
}finally{await browser.close();await f.close();}
