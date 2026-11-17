import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const executable=path.resolve(process.argv[2]||'dist/listing-drafts-20261115/win-unpacked/商品裂变工作台.exe');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-draft-desktop-'));
const input=path.join(directory,'商品素材'),data=path.join(directory,'profile');fs.mkdirSync(input);
await sharp({create:{width:80,height:80,channels:3,background:'#dfc4ab'}}).png().toFile(path.join(input,'01.png'));
const output=path.resolve('tests/results/listing-drafts/desktop');fs.mkdirSync(output,{recursive:true});
const env={...process.env,WORKBENCH_DESKTOP_TEST:'true',WORKBENCH_DESKTOP_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:executable,env,timeout:60000}),errors=[];
try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('networkidle');
  const runtime=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged}));
  assert.equal(runtime.version,'1.0.3-drafts.1');assert.equal(runtime.packaged,true);
  await app.evaluate(({dialog},input)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});},input);
  await page.click('#browseFolder');assert.equal(await page.inputValue('#folderPath'),input);await page.click('#importFolder');await page.locator('[data-product="0"]').waitFor();
  await page.fill('#batchName','桌面切页保留验证');await page.selectOption('#imageCount','4');await page.selectOption('#mode','fast');
  await page.locator('[data-field="name"]').fill('Desktop navigation product');await page.locator('[data-field="count"]').fill('3');await page.locator('[data-field="description"]').fill('保留录入的商品资料');
  const snapshot=()=>page.evaluate(()=>({folder:document.querySelector('#folderPath').value,label:document.querySelector('#batchName').value,count:document.querySelector('#imageCount').value,mode:document.querySelector('#mode').value,fields:[...document.querySelectorAll('#productInputs [data-field]')].map(el=>[el.dataset.field,el.value]),images:[...document.querySelectorAll('#productInputs img')].map(el=>el.getAttribute('src'))}));
  const before=await snapshot();await page.locator('.workbench-nav a[href="/settings"]').click();await page.locator('#modelForm').waitFor();await page.locator('.workbench-nav a[href="/temu/listings"]').click();await page.waitForLoadState('networkidle');assert.deepEqual(await snapshot(),before);
  await page.reload();await page.waitForLoadState('networkidle');assert.deepEqual(await snapshot(),before);
  await page.screenshot({path:path.join(output,'restored.png'),fullPage:true});await page.click('#newBatch');await page.reload();await page.waitForLoadState('networkidle');assert.equal(await page.locator('[data-product]').count(),0);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,runtime,realErpWrites:0,realGenerationCalls:0,checks:['packaged desktop starts with an isolated profile','native folder picker imports original images','unsaved product fields survive settings round trip and reload','new batch does not resurrect old products'],errors},null,2));console.log('Packaged desktop draft recovery passed.');
}finally{
  await app.close();
  // Delete only the isolated profile and fixture directory created by this test.
  const target=fs.realpathSync(directory),tempRoot=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(target),tempRoot);assert.ok(path.basename(target).startsWith('listing-draft-desktop-'));
  fs.rmSync(target,{recursive:true,force:true});
}
