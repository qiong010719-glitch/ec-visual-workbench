import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {merchantFixture} from './merchant-fixture.mjs';

import {sourceStep,bindingStep,storeIdle} from './merchant-ui.mjs';
const f=await merchantFixture();
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const firstId='220114595118926212',secondId='220114595116064422',thirdId='220114595116854972';
const link=id=>'https://www.dianxiaomi.com/web/popTemu/edit?id='+id;
const field=(row,name)=>page.locator(`[data-template="${row}"] [data-field="${name}"]`);
async function save(){
  const response=page.waitForResponse(r=>r.url()===f.base+'/api/settings'&&r.request().method()==='POST');
  await page.locator('#saveStore').click();
  assert.equal((await response).status(),200);
  await storeIdle(page);
}
async function savedTemplates(){return (await f.api('/api/settings')).stores.find(s=>s.key==='merchant-ca').templates;}
try{
  await page.goto(f.base+'/settings');
  await page.locator('[data-store-edit="merchant-ca"]').click();
  await sourceStep(page,0);await field(0,'draftId').fill(firstId);
  await sourceStep(page,1);await field(1,'draftId').fill(link(secondId));
  await save();
  assert.deepEqual((await savedTemplates()).map(t=>t.draftId),[firstId,secondId]);

  await page.reload();await page.locator('[data-store-edit="merchant-ca"]').click();
  // A restored/autofilled field can differ from the last input event's value.
  await field(1,'draftId').evaluate((el,value)=>{
    el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));
  },link(thirdId));
  await save();
  assert.deepEqual((await savedTemplates()).map(t=>t.draftId),[firstId,thirdId],
    'saving must use the visible fields, even without an input event');

  await page.reload();await page.locator('[data-store-edit="merchant-ca"]').click();
  await field(1,'draftId').evaluate((el,value)=>{el.value=value;},link(secondId));
  await page.locator('#addTemplate').click();
  assert.equal(await field(1,'draftId').inputValue(),link(secondId),'adding a row must preserve visible values');
  await field(2,'name').fill('第三份母稿');await field(2,'draftId').fill(thirdId);
  await field(1,'name').evaluate(el=>{el.value='第二份改名';});
  await page.locator('[data-remove-template="0"]').click();
  assert.equal(await field(0,'name').inputValue(),'第二份改名','removing a row must preserve other visible fields');
  await save();
  assert.deepEqual((await savedTemplates()).map(t=>({draftId:t.draftId,name:t.name})),[
    {draftId:secondId,name:'第二份改名'},{draftId:thirdId,name:'第三份母稿'}
  ]);
  await page.reload();await page.locator('[data-store-edit="merchant-ca"]').click();
  assert.equal(await field(0,'draftId').inputValue(),secondId);
  assert.equal(await field(1,'draftId').inputValue(),thirdId);
  const before=await f.api('/api/settings');
  await sourceStep(page,0);await field(0,'draftId').fill('https://www.dianxiaomi.com/web/popTemu/edit');
  await page.locator('#saveStore').click();
  await page.locator('#notice.error').waitFor();
  assert.equal(await field(0,'draftId').inputValue(),'https://www.dianxiaomi.com/web/popTemu/edit');
  assert.deepEqual(await f.api('/api/settings'),before,'invalid links must not alter saved configuration');
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  console.log('母稿设置浏览器回归通过：不同长 ID、当前输入值保存、增删行保留、刷新回读、无效链接不覆盖；未写入 ERP。');
}finally{await browser.close();await f.close();}
