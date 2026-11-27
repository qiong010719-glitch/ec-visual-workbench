import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {writeWorkbook} from '../src/workbook.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-merchant-')),output=path.resolve('tests/results/desktop');fs.mkdirSync(output,{recursive:true});
const packaged=process.argv.includes('--packaged');
const options={env:{...process.env,WORKBENCH_DESKTOP_TEST:'true',WORKBENCH_DESKTOP_DATA:directory},timeout:60000};
if(packaged)options.executablePath=path.resolve('dist/win-unpacked/商品裂变工作台.exe');else options.args=['.'];
const app=await electron.launch(options);const errors=[];
try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('#intake').waitFor();
  assert.equal(await page.evaluate(()=>typeof window.desktop.chooseFolder),'function');assert.equal(await page.evaluate(()=>typeof require),'undefined');
  const settings=await page.evaluate(()=>fetch('/api/settings').then(r=>r.json()));assert.equal(settings.stores.length,0);assert.equal(settings.browsers.length,0);assert.equal(settings.models.PLANNER_API_KEYConfigured,false);
  const selected=path.join(directory,'新建的素材');fs.mkdirSync(selected);
  const sub=path.join(selected,'DESKTOP-001');fs.mkdirSync(sub);
  await sharp({create:{width:20,height:20,channels:3,background:'#decbab'}}).png().toFile(path.join(sub,'01.png'));
  fs.writeFileSync(path.join(sub,'商品资料.txt'),'帆布画，50×100cm，无框。');writeWorkbook([{productCode:'DESKTOP-001',title:'桌面导入测试',englishTitle:'Desktop Test'}],path.join(selected,'商品.xlsx'));
  await app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},selected);
  await page.click('#browseFolder');assert.equal(await page.inputValue('#folderPath'),selected);
  await page.click('#importFolder');await page.locator('[data-product="0"]').waitFor();assert.equal(await page.locator('[data-field="productCode"]').inputValue(),'DESKTOP-001');assert.equal(await page.locator('#productInputs [data-field="name"]').inputValue(),'桌面导入测试');
  await page.getByRole('link',{name:'设置',exact:true}).click();await page.locator('#modelForm').waitFor();
  await page.fill('input[name="PLANNER_API_KEY"]','test-desktop-secret');await page.locator('#modelForm button').click();await page.getByText('配置已保存在本机。',{exact:true}).waitFor();
  const secretText=fs.readFileSync(path.join(directory,'preferences/secrets.json'),'utf8');assert.ok(!secretText.includes('test-desktop-secret'));
  assert.equal(await page.inputValue('input[name="PLANNER_API_KEY"]'),'');await page.reload();await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('文本密钥：已配置'));
  const navigationBounds=()=>page.locator('.workbench-nav a').evaluateAll(links=>links.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  const expectedBounds=await navigationBounds();assert.equal(expectedBounds.length,3);
  for(const route of ['/temu','/temu/listings','/settings']){
    await page.locator(`.workbench-nav a[href="${route}"]`).click();await page.waitForLoadState('load');
    await page.locator(`.workbench-nav a[href="${route}"][aria-current="page"]`).waitFor();
    assert.deepEqual(await navigationBounds(),expectedBounds,'desktop navigation position: '+route);
    if(route==='/temu')assert.equal(await page.locator('#authOverlay').isVisible(),false);
  }
  await page.screenshot({path:path.join(output,packaged?'packaged-settings.png':'development-settings.png'),fullPage:true});assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,packaged?'packaged-report.json':'development-report.json'),JSON.stringify({passed:true,packaged,checks:['desktop startup','fresh merchant data','native folder picker bridge','renderer has no Node access','Windows DPAPI key encryption','settings reload','stable navigation on all three routes','no legacy login overlay'],errors},null,2));console.log('Desktop smoke passed; packaged='+packaged);
}finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
