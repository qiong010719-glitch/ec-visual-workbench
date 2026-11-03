// Read-only verification of the running service after a validated collection merge.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createClickPacer} from './interaction.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),work=path.join(root,'reference/style-learning-20261101');
const output=path.join(work,'verification');fs.mkdirSync(output,{recursive:true});
const base=process.env.STYLE_PREVIEW_URL || 'http://127.0.0.1:4173';
const source=JSON.parse(fs.readFileSync(path.join(work,'learned/references.json'),'utf8'));
const expected=Object.values(source.products).filter(p=>p.analysis?.status==='completed');
const [status,research,products]=await Promise.all(['/api/status','/api/research/status','/api/research/products'].map(async endpoint=>{const r=await fetch(base+endpoint);assert.ok(r.ok);return r.json();}));
for(const p of expected)assert.ok(products.some(item=>item.id===p.id&&item.analysisStatus==='completed'&&item.collectionIds.includes('scene-advertising-20261101')));
assert.equal(status.publishEnabled,false);
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{localStorage.setItem('aplus_newbie_tour_v1','true');});
const page=await context.newPage(),pacer=createClickPacer(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const act=(selector,method='click',value)=>pacer.perform(()=>page.locator(selector)[method](value),{kind:method,target:selector});
try{
  await page.goto(base);await page.locator('#localVisualStyle').waitFor();assert.equal(await page.locator('#localVisualStyle').inputValue(),'scene_advertising');
  await page.waitForFunction(()=>typeof __idbRestored!=='undefined'&&__idbRestored);
  await act('#modeBtn_master');assert.equal(await page.locator('#infoDensity').isDisabled(),true);assert.match(await page.locator('#localVisualStyleHint').innerText(),/摄影叙事/);
  await page.waitForFunction(()=>document.querySelector('#generationMode').value==='master'&&document.querySelector('#modeBtn_master').classList.contains('mode-active'));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:path.join(output,'live-master-style.png'),animations:'disabled'});
  await act('#localReferenceButton');await page.locator('#referenceStats').filter({hasText:'场景广告风格'}).waitFor();
  await act('#referenceCollectionFilter','selectOption','scene-advertising-20261101');
  assert.equal(await page.locator('#referenceProducts article:visible').count(),expected.length);
  await page.screenshot({path:path.join(output,'live-style-library.png')});
  assert.deepEqual(errors,[]);
  const report={passed:true,verifiedAt:new Date().toISOString(),base,products:products.length,collection:research.styleCollections.find(c=>c.id==='scene-advertising-20261101'),checks:['已分析参考集已载入运行中的服务','默认场景广告风格','大师与快速控制分离','参考集筛选与来源可见','未调用生图或更改商品数据'],errors,interaction:pacer.metrics()};
  fs.writeFileSync(path.join(output,'live-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
