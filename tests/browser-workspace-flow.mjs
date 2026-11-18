import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';
import {prepareDesignResult} from '../src/design-platforms.mjs';

// Also applies to the unchanged legacy browser test imported below. Every
// browser is isolated and can only reach a loopback mock server.
const launch=chromium.launch.bind(chromium);
chromium.launch=async options=>{
  const browser=await launch(options),createContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await createContext(options);
    context.setDefaultNavigationTimeout(60000);context.setDefaultTimeout(60000);
    await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    return context;
  };
  return browser;
};
async function sourceTargetSync(){
  const checks=[];
  for(const busy of [false,true]){
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-source-target-'));
    const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},sourcingClient:()=>assert.fail('no external sourcing request is needed')});
    app.preferences.update({revision:0,browsers:[{key:'chrome-test',type:'chrome',name:'隔离浏览器',debugPort:9444}],
      erpConnections:['a','b'].map(key=>({key:'erp-'+key,name:'ERP '+key.toUpperCase(),provider:'dianxiaomi',browserKey:'chrome-test',expectedAccount:'fixture-'+key})),
      stores:['a','b'].map((key,index)=>({key:'store-'+key,platform:'temu',name:'店铺'+key.toUpperCase(),expectedStore:'店铺'+key.toUpperCase(),expectedSite:'加拿大站',erpKey:'erp-'+key,templates:[{key:'mother-'+key,name:'模拟母稿',draftId:String(987654321+index)}]}))});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json();
    await fetch(base+'/api/workspace/context',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify({platform:'temu',storeKey:'store-b',erpKey:'erp-b'})});
    const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050}}),errors=[];
    if(busy)await context.route('**/api/sourcing',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),busy:true}});});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto(base+'/sourcing?platform=temu',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#erp')?.options.length===2);
      if(!busy){
        await page.waitForFunction(()=>document.querySelector('#sourceStore')?.value==='store-b'&&document.querySelector('#erp').value==='erp-b');
        checks.push('首次打开：公共店铺B与原采集ERP B一致');
      }else{
        await page.waitForFunction(()=>document.querySelector('#sourceStore')?.disabled&&document.querySelector('#sourceStore').value==='');
        assert.equal(await page.locator('#erp').inputValue(),'erp-a');
        const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sourcing');
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await refreshed;
        await page.waitForFunction(()=>document.querySelector('#sourceStore').disabled&&document.querySelector('#sourceStore').value==='');
        assert.equal(await page.locator('#erp').inputValue(),'erp-a');
        checks.push('采集busy：保留原ERP A，禁用不匹配店铺切换，focus刷新也不改ERP');
      }
      assert.deepEqual(errors,[]);
    }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));}
  }
  console.log(JSON.stringify({passed:true,checks,paidCalls:0,erpWrites:0}));
}
if(process.argv.includes('--source-sync-only')){
  try{await sourceTargetSync();}finally{chromium.launch=launch;}
  process.exit(0);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-platform-flow-')),checks=[],errors=[],queries=[];
const sample=await sharp({create:{width:160,height:80,channels:3,background:'#54789a'}}).png().toBuffer();
let imageCalls=0;
const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},provider:async()=>{imageCalls++;return sample;},
  settingsCodec:{encode:value=>Buffer.from(value).toString('base64'),decode:value=>Buffer.from(value,'base64').toString()},
  sourcingClient:async(kind,params)=>{
    queries.push(kind);
    return {data:kind==='sites'?[{siteId:48,regionId:211,cnName:'美国',currency:'USD'}]:kind==='categories'?[{catId:123,catName:'测试类目',isLeaf:true}]:
      {total:params?.keyword==='empty'?0:1,list:params?.keyword==='empty'?[]:[{goodsId:'601105252678120',goodsName:'选品服务模拟商品',linkUrl:'https://www.geekbi.com/data/goods/detail?goodsId=601105252678120',siteId:48,minPrice:8.04,monthSold:1,updateTime:'2026-11-17T00:00:00.000Z'}]},chargedPoints:0,receivedAt:new Date().toISOString()};
  },collectionAdapter:{preflight:async()=>{},resolve:()=>assert.fail('must not open external product pages'),importProduct:()=>assert.fail('this test must not import to ERP')}});
app.preferences.update({revision:0,browsers:[{key:'chrome-test',type:'chrome',name:'隔离浏览器',debugPort:9444}],
  erpConnections:[{key:'erp-test',name:'隔离 ERP',provider:'dianxiaomi',browserKey:'chrome-test',expectedAccount:'fixture-account'}],
  stores:[{key:'temu-test',platform:'temu',name:'Temu测试店',expectedStore:'Temu测试店',expectedSite:'加拿大站',erpKey:'erp-test',templates:[{key:'mother-test',name:'模拟母稿',draftId:'987654321'}]}]});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/session')).json();
const api=async(url,payload)=>{const response=await fetch(base+url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
await context.addInitScript(()=>{for(const key of ['aplus_newbie_tour_v1','hyrule_result_tour_done','hyrule_veteran'])localStorage.setItem(key,'true');});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
const designReady=()=>page.waitForFunction(()=>typeof __idbRestored!=='undefined'&&__idbRestored&&document.querySelector('#designPlatform'));
const requirements=async text=>{await page.locator('#strictReq').click();await page.locator('#feTextarea').fill(text);await page.getByRole('button',{name:'确认填入',exact:true}).click();};
const noProviderBranding=async()=>{
  await page.waitForFunction(()=>!/极鲸云|geekbi/i.test(document.body.innerText));
  const attributes=await page.locator('[title],[aria-label],img[alt]').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length).flatMap(e=>[e.title,e.getAttribute('aria-label'),e.getAttribute('alt')]).filter(Boolean));
  assert.doesNotMatch(attributes.join('\n'),/极鲸云|geekbi/i);
};
try{
  const source=app.saveImage(sample),product=await api('/api/workspace/products',{name:'双平台画作',description:'同一商品的已确认资料',images:[{url:source,filename:'产品主体图.png',category:'产品主体图'}]});
  await page.goto(base+'/design?platform=amazon&product='+product.id,{waitUntil:'domcontentloaded'});await designReady();
  await requirements('Amazon 专属版式要求');await page.locator('#designScope').selectOption('main_6_old_aplus');
  await page.locator('#designPlatform').selectOption('temu');await page.waitForURL(url=>url.searchParams.get('platform')==='temu');await designReady();
  assert.equal(await page.locator('#prodName').inputValue(),product.name);assert.equal(await page.locator('#strictReq').inputValue(),'');
  await requirements('Temu 专属方图要求');await page.locator('#designScope').selectOption('main_count');await page.locator('#mainImageCount').selectOption('3');
  await page.locator('#designPlatform').selectOption('amazon');await page.waitForURL(url=>url.searchParams.get('platform')==='amazon');await designReady();
  assert.equal(await page.locator('#strictReq').inputValue(),'Amazon 专属版式要求');assert.equal(await page.locator('#designScope').inputValue(),'main_6_old_aplus');
  await page.locator('#designPlatform').selectOption('temu');await page.waitForURL(url=>url.searchParams.get('platform')==='temu');await designReady();
  assert.equal(await page.locator('#strictReq').inputValue(),'Temu 专属方图要求');assert.equal(await page.locator('#mainImageCount').inputValue(),'3');
  assert.equal(imageCalls,0);checks.push('同商品切换Amazon/Temu恢复各自设计状态，不串平台、不触发生图');console.log(checks.at(-1));

  await page.goto(base+'/settings?newStore=1');await page.waitForFunction(()=>document.querySelector('#storeForm [name=erpKey]').options.length>0);
  await page.locator('#storeForm [name=platform]').selectOption('amazon');
  await page.locator('#storeForm [name=expectedStore]').fill('Amazon测试店');await page.locator('#storeForm [name=expectedSite]').fill('美国站');await page.locator('#storeForm [name=erpKey]').selectOption('erp-test');
  assert.equal(await page.locator('#templateInputs').isVisible(),false);
  await page.locator('#saveStore').click();await page.waitForFunction(()=>document.querySelector('#storeList').textContent.includes('Amazon测试店'));
  const config=await api('/api/settings'),shop=config.stores.find(shop=>shop.expectedStore==='Amazon测试店');assert.ok(shop);assert.deepEqual(shop.templates,[]);
  assert.match(await page.locator('#storeList').textContent(),/Amazon.*已绑定/);
  const images=[];
  for(const slot of [0,7]){
    const result=await prepareDesignResult(sample,{platform:'amazon',design_scope:'main_6_premium_aplus',slot});
    images.push({url:app.saveImage(result.bytes),originalImageUrl:source,kind:slot?'aplus':'main',slot:String(slot),width:result.dimensions.width,height:result.dimensions.height});
  }
  const versionId='fixture-amazon-export';await api('/api/workspace/products/'+product.id,{version:{id:versionId,platform:'amazon',status:'completed',images,source:{kind:'test'}}});
  await page.goto(base+'/listings?mode=images&platform=temu');await page.waitForFunction(()=>document.querySelector('#platform').querySelector('option[value=amazon]'));
  await page.locator('#platform').selectOption('amazon');await page.waitForURL(url=>url.searchParams.get('platform')==='amazon');
  await page.waitForFunction(()=>document.querySelector('#platformStore').options.length>1);await page.locator('#platformStore').selectOption(shop.key);
  await page.waitForFunction(()=>document.querySelector('#platformConnectionHint')?.textContent.includes('Amazon测试店'));
  assert.equal((await api('/api/workspace/context')).storeKey,shop.key);
  await page.goto(base+'/listings?mode=images&platform=amazon&workspaceProduct='+product.id+'&version='+versionId+'&source=generated');await page.locator('#exportPlatformPackage').waitFor();
  assert.equal(await page.locator('.platform-result-grid img').count(),2);
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportPlatformPackage').click();const download=await downloadPromise;
  const zipPath=path.join(dir,'amazon-export.zip');await download.saveAs(zipPath);const zip=fs.readFileSync(zipPath);
  for(const filename of ['商品资料.json','images/01-main.png','images/02-aplus.png','originals/01.png','originals/02.png'])assert.ok(zip.includes(Buffer.from(filename)),filename);
  assert.ok(zip.includes(sample));assert.ok(zip.includes(Buffer.from('"published": false')));assert.equal(imageCalls,0);
  checks.push('Amazon空母稿店铺在设置绑定、上架中心可选、成品及原图ZIP导出，无生图和ERP调用');console.log(checks.at(-1));

  await page.goto(base+'/sourcing?platform=temu');await page.locator('#credentials[open]').waitFor();
  await noProviderBranding();
  await page.locator('[name=GB_APP_KEY]').fill('fixture-key');await page.locator('[name=GB_APP_SECRET]').fill('fixture-secret');await page.getByRole('button',{name:'保存并检查连接'}).click();
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('已读取站点列表'));await noProviderBranding();
  await page.locator('[name=keywords]').fill('canvas');await page.locator('#site').selectOption('48');await page.locator('#searchButton').click();await page.locator('[data-goods]').waitFor();await noProviderBranding();
  await page.locator('[data-goods]').check();await noProviderBranding();
  await page.locator('[name=keywords]').fill('empty');await page.locator('#searchButton').click();await page.waitForFunction(()=>document.querySelector('#resultCount').textContent.includes('0件'));await noProviderBranding();
  assert.ok(queries.includes('sites')&&queries.includes('search'));assert.deepEqual(errors,[]);
  checks.push('选品页面初始及动态连接、结果、扣点说明、空结果无供应商品牌文案');
  console.log(JSON.stringify({passed:true,checks,imageCalls,paidCalls:0,erpWrites:0,errors}));
}finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));}

// Execute the original end-to-end fixture test unchanged, with network blocked
// by the Chromium wrapper above. It exercises draft/publish and recovery mocks.
try{await import('./browser-single-listing.mjs');console.log('Legacy Temu single-listing compatibility passed with external browser requests blocked.');}
finally{chromium.launch=launch;}
