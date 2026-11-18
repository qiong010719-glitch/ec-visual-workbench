import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan} from '../src/planner.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'design-platform-ui-'));
const sample=await sharp({create:{width:160,height:80,channels:3,background:'#54789a'}}).png().toBuffer();
let imageCalls=0;
const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},planner:async p=>buildPlan(p,[]),provider:async()=>{imageCalls++;return sample;}});
const source=app.saveImage(sample);
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const {token}=await(await fetch(base+'/api/session')).json();
const api=async(url,payload)=>{const response=await fetch(base+url,payload?{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)}:{});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],checks=[];
try{
  const sentinel=await api('/api/workspace/products',{name:'不要覆盖的商品',description:'来自另一个页面',images:[{url:source}]});
  for(const platform of ['amazon','temu']){
    await api('/api/workspace/context',{platform,productId:sentinel.id});
    const appState={generationMode:'fast',designScope:platform==='amazon'?'custom':'main_count',mainImageCount:1,
      customLayout:platform==='amazon'?{main:1,sub:0,aplus:1,aplusType:'old'}:null,
      prodName:platform+'平台新商品',prodDesc:'蓝色画作，保留完整画框与原始颜色',modelChoice:'gpt-image-2',
      materialMeta:[{id:'source',filename:'产品主体图.png',category:'产品主体图',url:source}],imageSlots:Array(14).fill(null),activeKieTasks:[]};
    await api('/api/workspace/design-state?key='+encodeURIComponent('blank:'+platform),{data:{appState}});
    const context=await browser.newContext({viewport:{width:1440,height:1050}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await context.addInitScript(()=>{for(const key of ['aplus_newbie_tour_v1','hyrule_result_tour_done','hyrule_veteran'])localStorage.setItem(key,'true');});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/design?platform='+platform);
    await page.waitForFunction(()=>typeof __idbRestored!=='undefined'&&__idbRestored&&document.querySelector('#generateReviewedPlan')&&!document.querySelector('#mainBtn').disabled);
    assert.equal(await page.locator('#prodName').inputValue(),appState.prodName);
    if(platform==='amazon')assert.match(await page.locator('#amazonImageDimensions').textContent(),/970 × 600/);
    const before=imageCalls;await page.locator('#mainBtn').click();
    try{await page.waitForFunction(()=>document.querySelector('#singleGenerationStatus')?.textContent.includes('已保存到商品库'),null,{timeout:30000});}
    catch(error){console.error(JSON.stringify({platform,errors,imageCalls,status:await page.locator('#singleGenerationStatus').textContent(),taskCount:Object.keys(app.store.state.tasks).length},null,2));throw error;}
    assert.equal(imageCalls-before,platform==='amazon'?2:1);
    const productId=await page.evaluate(()=>WorkspaceDesignBoot.productId);
    assert.notEqual(productId,sentinel.id);
    const product=(await api('/api/workspace')).products.find(product=>product.id===productId);
    assert.equal(product.name,appState.prodName);
    const versions=product.versions.filter(version=>version.platform===platform&&version.id.startsWith('single:'));
    assert.equal(versions.length,1);
    assert.equal(versions[0].images.length,platform==='amazon'?2:1);
    if(platform==='amazon'){
      assert.deepEqual(versions[0].images.map(image=>image.kind),['main','aplus']);
      assert.ok(versions[0].images.every(image=>image.originalImageUrl));
    }else{
      await page.evaluate(()=>openLocalDraftEditor());await page.waitForSelector('#temuSharedDialog');
      assert.equal(app.store.state.drafts.at(-1).images.length,1);
      await page.locator('#temuSharedDialog [data-close]').click();
    }
    assert.equal((await api('/api/workspace')).products.find(product=>product.id===sentinel.id).name,'不要覆盖的商品');
    await page.evaluate(()=>WorkspaceSaveDesign());await page.reload();
    await page.waitForFunction(()=>typeof __idbRestored!=='undefined'&&__idbRestored&&document.querySelector('[data-open-design-listing]'));
    assert.equal(await page.locator('#prodName').inputValue(),appState.prodName);
    assert.equal(new URL(page.url()).searchParams.get('product'),productId);
    assert.equal(imageCalls-before,platform==='amazon'?2:1);
    await page.locator('#nav-notes').click();
    await page.locator('[data-open-design-listing]').click();
    try{await page.waitForURL(url=>url.pathname==='/listings'&&url.searchParams.get('workspaceProduct')===productId);}
    catch(error){console.error(JSON.stringify({platform,errors,url:page.url(),status:await page.locator('[data-design-library-status]').textContent(),sync:await page.locator('#designSyncState').textContent()},null,2));throw error;}
    assert.equal(new URL(page.url()).searchParams.get('source'),'generated');
    checks.push(platform+': restored scope, one-click generation, shared product version, reload without regeneration, listing handoff');
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks,imageCalls,paidCalls:0,errors}));
}finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));}
