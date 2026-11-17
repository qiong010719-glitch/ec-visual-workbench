import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';
import {storeIdle} from './merchant-ui.mjs';

const f=await merchantFixture(),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  const initial=await f.api('/api/settings');
  f.app.preferences.update({revision:initial.revision,stores:[initial.stores[0]]});
  const before=await f.api('/api/settings'),first=before.stores[0];
  await page.goto(f.base+'/settings');
  await page.locator('[data-store-edit="merchant-ca"]').click();
  assert.match(await page.locator('#storeEditorTitle').textContent(),/编辑店铺.*独立店铺1/);
  await page.locator('#addTemplate').click();
  assert.equal(await page.locator('#storeForm [name=key]').inputValue(),first.key);
  assert.equal(await page.locator('[data-template]').count(),3,'adding a mother keeps the current store');

  await page.locator('#resetStore').click();
  assert.equal(await page.locator('#storeEditorTitle').textContent(),'新增店铺');
  assert.equal(await page.locator('#storeForm [name=key]').inputValue(),'');
  assert.equal(await page.locator('#storeForm [name=expectedStore]').inputValue(),'');
  assert.equal(await page.locator('#storeForm [name=expectedSite]').inputValue(),'');
  assert.equal(await page.locator('#storeMothers').isVisible(),false);
  assert.equal(await page.locator('#saveStore').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement.name),'expectedStore');
  assert.equal(await page.locator('#storeList .config-row').count(),1);

  await page.locator('#storeForm [name=expectedStore]').fill('第二家店铺');
  await page.locator('#continueStore').click();
  assert.equal(await page.locator('#storeMothers').isVisible(),false,'a placeholder is not a selected site');
  assert.match(await page.locator('#notice').textContent(),/经营站点/);
  await page.locator('#storeForm [name=expectedSite]').fill('加拿大站');
  await page.locator('#continueStore').click();
  assert.equal(await page.locator('#storeMothers').isVisible(),true);
  assert.equal(await page.locator('#saveStore').textContent(),'保存新店铺');
  await page.locator('[data-template="0"] [data-field=name]').fill('第二家店母稿');
  await page.locator('[data-template="0"] [data-field=draftId]').fill('https://www.dianxiaomi.com/web/popTemu/edit?id=220114595118875286');
  await page.reload();
  await page.locator('[data-template="0"] [data-field=draftId]').waitFor();
  assert.equal(await page.locator('#storeForm [name=expectedStore]').inputValue(),'第二家店铺');
  assert.equal(await page.locator('#storeEditorTitle').textContent(),'新增店铺');
  assert.equal(await page.locator('[data-field=draftId]').inputValue(),'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595118875286');

  const response=page.waitForResponse(r=>r.url()===f.base+'/api/settings'&&r.request().method()==='POST');
  await page.locator('#saveStore').click();assert.equal((await response).status(),200);await storeIdle(page);
  const saved=await f.api('/api/settings');
  assert.equal(saved.stores.length,2);assert.deepEqual(saved.stores.find(s=>s.key===first.key),first,'the first store and its mothers are unchanged');
  const second=saved.stores.find(s=>s.key!==first.key);assert.equal(second.expectedStore,'第二家店铺');assert.equal(second.templates[0].draftId,'220114595118875286');
  assert.match(await page.locator('#storeEditorTitle').textContent(),/编辑店铺.*第二家店铺/);
  await page.reload();await page.locator('[data-store-edit="'+second.key+'"]').waitFor();
  assert.equal(await page.locator('#storeForm [name=key]').inputValue(),second.key);
  await page.locator('#resetStore').click();assert.equal(await page.locator('#storeMothers').isVisible(),false);
  await page.setViewportSize({width:600,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  console.log('新增第二家店铺通过：先填店铺信息、占位文字不算输入、母稿步骤恢复、新店独立保存、原店铺与母稿保持不变。');
}finally{await browser.close();await f.close();}
