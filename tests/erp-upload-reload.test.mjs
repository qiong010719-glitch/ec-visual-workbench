import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from 'playwright';
import {uploadMainImages} from '../../scripts/lib/temu-runner.mjs';

const host='https://wxalbum-10001658-file.dianxiaomi.com/';
const bytes=Buffer.from('fixture-upload-bytes');
const identity={motherId:'12345678',attemptToken:'attempt-1',sku:'ITEM-SKU1'};
let browser;
test.before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
test.after(()=>browser?.close());
async function fixture(t,mode){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'erp-upload-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'first.jpg');fs.writeFileSync(file,bytes);
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>new URL(route.request().url()).hostname===new URL(host).hostname
    ?route.fulfill({body:bytes}):route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8">
    <style>.mainImage{margin:30px}.trigger{position:relative;width:150px;height:50px}.menu{display:none;position:absolute;top:25px;width:140px;height:30px;background:#ddd}.trigger:hover .menu{display:block}</style>
    <input name="variationSku" value="ITEM-SKU1"><input type="file" id="localFileUploadInp" hidden>
    <div class="mainImage"><div class="trigger"><button>选择图片</button><div role="menuitem" class="menu" onclick="choose()">本地图片</div></div><div class="img-list"></div></div>
    <script>function choose(){const input=document.querySelector('#localFileUploadInp');input.click();input.onchange=()=>setTimeout(()=>{${mode==='reload'?'location.reload()':`document.querySelector('.img-list').innerHTML='<img src="${host}first.jpg">'`}},150)}</script>`}));
  const page=await context.newPage();await page.goto('https://www.dianxiaomi.com/web/popTemu/quoteEdit?id=12345678');
  await page.evaluate(({motherId,attemptToken,sku})=>Object.assign(document.documentElement.dataset,{workbenchMotherId:motherId,workbenchAttempt:attemptToken,workbenchAttemptSku:sku}),identity);
  const cdp=await context.newCDPSession(page);
  const original=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(String(url),host+'first.jpg');return new Response(bytes);};
  t.after(()=>{globalThis.fetch=original;});
  return {page,adapter:{evaluate:(...a)=>page.evaluate(...a),send:(...a)=>cdp.send(...a)},images:[{file,name:'first.jpg',sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]};
}
test('an actual same-URL reload during upload is reported as a reset, not an upload timeout',async t=>{
  const f=await fixture(t,'reload');
  await assert.rejects(uploadMainImages(f.adapter,f.images,identity,{timeout:5000}),e=>e.code==='ERP_EDITOR_RESET'&&e.message.includes('刷新'));
  assert.equal(await f.page.evaluate(()=>document.documentElement.dataset.workbenchAttempt),undefined);
});
test('an intact editor accepts the uploaded image only after checking its bytes',async t=>{
  const f=await fixture(t,'success');
  assert.deepEqual(await uploadMainImages(f.adapter,f.images,identity,{timeout:5000}),[host+'first.jpg']);
});
test('a changed SKU is rejected before selecting or uploading any file',async t=>{
  const f=await fixture(t,'success');await f.page.locator('[name=variationSku]').fill('OTHER-SKU');
  await assert.rejects(uploadMainImages(f.adapter,f.images,identity),e=>e.code==='ERP_EDITOR_RESET');
  assert.equal(await f.page.evaluate(()=>document.querySelector('#localFileUploadInp').files.length),0);
});
