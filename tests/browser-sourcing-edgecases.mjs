// Isolated UI contract checks: no real browser profile, ERP, or paid provider.
// Each failure reports an actual missing behavior; this is not a fixture that
// treats known defects as passing expectations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve('public'),out=path.resolve('tests/results/sourcing-edgecases');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname,file=path.resolve(root,pathname==='/sourcing'?'sourcing.html':'.'+pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});response.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const shopA={key:'temu:shop-a',name:'Temu目标店',platform:'temu'},shopB={key:'tiktok:shop-b',name:'TikTok目标店',platform:'tiktok'};
const goodsId='601105252678120';
const packageDefaults={lengthCm:10,widthCm:10,heightCm:10,weightKg:0.01};
const profileFor=store=>({targetStore:store,checkedAt:'2026-11-19T00:00:00Z',issues:[],defaults:{ready:true,platform:store.platform,packageDefaults,warehouse:'测试仓库',shippingTemplate:'测试运费',dispatch:'2个工作日',category:{path:['家居','海报']},source:{url:'https://www.dianxiaomi.com/web/popTemu/edit?id=987654321'}}});
function environment(){
  const search={id:'fixture-search-a',status:'completed',createdAt:'2026-11-19T00:00:00Z',site:{siteId:48,cnName:'美国',currency:'USD'},filters:{keywords:['canvas'],siteId:48,size:10,catIds:[],sort:'monthSold',order:'desc',matchMode:1},estimatedPoints:10,calls:[],rows:[{goodsId,siteId:48,raw:{goodsName:'隔离测试商品',minPrice:10,monthSold:100,updateTime:'2026-11-19T00:00:00Z'}}]};
  return {searches:[search],stores:[shopA,shopB],profiles:{[shopA.key]:profileFor(shopA),[shopB.key]:profileFor(shopB)},details:{},reusableImports:{},batches:[],busy:false,otherBusy:false,requests:[],errors:[],onApi:null,
    view(){return {configured:true,busy:this.busy,otherBusy:this.otherBusy,sites:[search.site],prices:{rawDetail:50},details:this.details,reusableImports:this.reusableImports,batches:this.batches,searches:this.searches.map(s=>({id:s.id,status:s.status,createdAt:s.createdAt,filters:s.filters,count:s.rows.length}))};}};
}
function pending(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function open(env){
  const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',error=>env.errors.push(error.message));
  await page.addInitScript(()=>{const intervals=[];window.setInterval=fn=>{intervals.push(fn);return intervals.length;};window.__tick=async()=>{for(const fn of intervals)await fn();};});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==base){await route.abort();return;}
    if(!url.pathname.startsWith('/api/')){await route.continue();return;}
    const entry={path:url.pathname,method:request.method(),payload:request.method()==='POST'?request.postDataJSON():null};env.requests.push(entry);
    if(await env.onApi?.(route,entry))return;
    let value;
    if(entry.path==='/api/session')value={token:'fixture'};
    else if(entry.path==='/api/settings')value={revision:0,browsers:[{key:'chrome-a',type:'chrome',name:'隔离浏览器'}],erpConnections:[{key:'erp-a',name:'测试ERP',expectedAccount:'fixture',browserKey:'chrome-a',provider:'dianxiaomi'}]};
    else if(entry.path==='/api/sourcing')value=env.view();
    else if(entry.path==='/api/sourcing/stores')value={stores:env.stores,profiles:env.profiles,observedAt:'2026-11-19T00:00:00Z'};
    else if(entry.path.startsWith('/api/sourcing/searches/'))value=env.searches.find(s=>s.id===entry.path.split('/').at(-1));
    else if(entry.path==='/api/sourcing/store-defaults'){const store=env.stores.find(s=>s.key===entry.payload.targetStoreKey);value=profileFor(store);env.profiles[store.key]=value;}
    else if(entry.path==='/api/sourcing/batches')value={id:entry.payload.requestId,status:'running'};
    else throw new Error('Unmocked endpoint '+entry.path);
    await route.fulfill({json:value});
  });
  await page.goto(base+'/sourcing');await page.locator('[data-goods]').waitFor();await page.locator('[data-store]').first().waitFor();return page;
}
const checkbox=(page,store)=>page.locator(`[data-store="${store.key}"]`);
async function choose(page,stores=[shopA]){await page.locator('[data-goods]').check();for(const store of stores)await checkbox(page,store).check();}
const reports=[];
async function check(name,fn){const env=environment();let page;try{page=await open(env);await fn(page,env);assert.deepEqual(env.errors,[]);reports.push({name,passed:true});console.log('PASS '+name);}catch(error){reports.push({name,passed:false,error:error.message,requests:env.requests.map(r=>({path:r.path,method:r.method}))});console.log('FAIL '+name+': '+error.message);if(page)await page.screenshot({path:path.join(out,name+'.png'),fullPage:true}).catch(()=>{});}finally{await page?.close();}}
try{
  await check('legacy-match-mode',async(page,env)=>{
    delete env.searches[0].filters.matchMode;await page.reload();await page.locator('[data-goods]').waitFor();
    assert.equal(await page.locator('#draftNotice').isVisible(),false,'Restoring untouched old search must not mark filters dirty');
    assert.equal(await page.locator('[data-goods]').isDisabled(),false);
    assert.equal(await page.inputValue('#matchMode'),'2','Legacy missing matchMode was a fuzzy search');
  });
  await check('lost-batch-response',async(page,env)=>{
    env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/batches')return false;env.busy=true;env.batches=[{id:entry.payload.requestId,status:'running',erpName:'测试ERP',targetStores:[shopA],createdAt:'2026-11-19T00:00:00Z',rows:[{goodsId,title:'隔离测试商品',status:'fetching-detail',storeResults:[{storeKey:shopA.key,targetStore:shopA,status:'pending'}]}]}];await route.abort('failed');return true;};
    await choose(page);await page.click('#collect');await page.locator('[data-batch]').waitFor();await page.evaluate(()=>window.__tick());
    assert.equal(await page.locator('[data-batch]').count(),1,'Accepted batch must be recovered after response loss without another POST');
    assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/batches').length,1);
  });
  await check('lost-search-response',async(page,env)=>{
    env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/searches')return false;env.busy=true;env.searches.unshift({...structuredClone(env.searches[0]),id:entry.payload.requestId,status:'running',filters:{...env.searches[0].filters,keywords:['new keyword']},rows:[]});await route.abort('failed');return true;};
    await page.fill('[name=keywords]','new keyword');await page.click('#searchButton');await page.locator('#resultCount').getByText('0件 · 运行中',{exact:true}).waitFor();await page.evaluate(()=>window.__tick());
    assert.equal(await page.locator(`#searchHistory option[value="${env.searches[0].id}"]`).count(),1,'Accepted paid search must appear after response loss; manually searching again is a new charge');
    assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/searches').length,1);
  });
  await check('pending-submit-lock',async(page,env)=>{
    const gate=pending();let submitted;
    env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/batches')return false;submitted=entry;await gate.promise;await route.fulfill({json:{id:entry.payload.requestId,status:'running'}}).catch(()=>{});return true;};
    await choose(page);await page.click('#collect');
    try{assert.ok(submitted);assert.equal(await page.locator('#collect').isDisabled(),true);assert.equal(await checkbox(page,shopB).isDisabled(),true);await checkbox(page,shopB).evaluate(input=>{input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await page.locator('#collect').isDisabled(),true,'Changing selected shops must not unlock an in-flight batch POST');assert.equal(await checkbox(page,shopB).isChecked(),false);}
    finally{gate.resolve();}
  });
  await check('disabled-store',async(page,env)=>{
    env.stores=[{...shopA,disabled:true},shopB];await page.reload();await checkbox(page,shopA).waitFor();
    assert.equal(await checkbox(page,shopA).isDisabled(),true,'Disabled shop remains selectable despite backend rejecting it');
  });
  await check('reused-import-cost',async(page,env)=>{
    env.batches=[{id:'old-import',status:'completed',method:'geekbi-product-data',erpName:'测试ERP',targetStores:[shopA],createdAt:'2026-11-19T00:00:00Z',rows:[{goodsId,title:'隔离测试商品',status:'prepared',importStatus:'verified',fileName:'fixture.xlsx',storeResults:[{storeKey:shopA.key,targetStore:shopA,status:'prepared',preparation:{ready:true,saved:true,published:false}}]}]}];
    env.reusableImports={'erp-a':[goodsId]};
    await page.reload();await page.locator('[data-goods]').waitFor();await choose(page);
    assert.match(await page.textContent('#importCost'),/预计 0 点/,'Existing verified import is reused by backend even when its raw-detail cache is absent');
    env.details[goodsId]={status:'ready'};await page.click('#refresh');assert.match(await page.textContent('#importCost'),/预计 0 点/,'A detail cache and a reusable import must not count the same product twice');
  });
  await check('other-account-import-cost',async(page,env)=>{
    env.reusableImports={'erp-b':[goodsId]};await page.click('#refresh');await choose(page);
    assert.match(await page.textContent('#importCost'),/预计 50 点/,'Other account imports do not establish a reusable import for the selected account');
  });
  await check('first-tiktok-defaults-order',async(page,env)=>{
    env.profiles={};env.stores=[shopB,shopA];const gate=pending(),started=pending();
    env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/store-defaults'||entry.payload.targetStoreKey!==shopB.key)return false;if(!env.profiles[shopA.key]){started.resolve();await gate.promise;await route.fulfill({status:400,json:{error:'需要先确定一组统一包裹参数，请先读取已配置店铺的模板默认值'}});return true;}return false;};
    await page.reload();await page.locator('[data-goods]').waitFor();await page.locator('[data-goods]').check();await checkbox(page,shopB).check();await started.promise;await checkbox(page,shopA).check();gate.resolve();
    await page.locator('[data-store-default="temu:shop-a"]').getByText('默认值已就绪',{exact:true}).waitFor();await page.locator('[data-store-default="tiktok:shop-b"]').getByText('默认值已就绪',{exact:true}).waitFor();await page.locator('#loadStoreDefaults:not([disabled])').waitFor();
    assert.equal(await page.locator('#collect').isDisabled(),false,'Both selected stores can be ready, but first TikTok dependency error remains cached after Temu defaults arrive');
    assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/store-defaults'&&r.payload.targetStoreKey===shopB.key).length,2);
  });
  await check('dependency-retry-is-bounded',async(page,env)=>{
    env.profiles={[shopA.key]:profileFor(shopA)};env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/store-defaults'||entry.payload.targetStoreKey!==shopB.key)return false;await route.fulfill({status:400,json:{error:'需要先确定一组统一包裹参数，请先读取已配置店铺的模板默认值'}});return true;};
    await page.reload();await page.locator('[data-goods]').waitFor();await choose(page,[shopA,shopB]);await page.locator('#storeIssues').getByText(/需要先确定一组统一包裹参数/).waitFor();await page.locator('#loadStoreDefaults:not([disabled])').waitFor();await page.evaluate(()=>window.__tick());
    assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/store-defaults').length,2,'The missing package dependency receives at most one automatic re-read, not a retry loop');assert.equal(await page.locator('#collect').isDisabled(),true);
  });
  await check('unresolved-submission-stays-read-only',async(page,env)=>{
    let requestId;env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/batches')return false;requestId=entry.payload.requestId;await route.abort('failed');return true;};
    await choose(page);await page.click('#collect');await page.locator('#notice.error').waitFor();await page.evaluate(()=>window.__tick());assert.equal(await page.locator('#collect').isDisabled(),true);assert.equal(await page.locator('#searchButton').isDisabled(),true);
    await page.reload();await page.locator('[data-goods]').waitFor();assert.equal(await page.locator('#searchButton').isDisabled(),true,'Reload must preserve an unresolved submission lock');
    env.batches=[{id:requestId,status:'completed',erpName:'测试ERP',targetStores:[shopA],createdAt:'2026-11-19T00:00:00Z',rows:[]}];await page.click('#refresh');await page.locator('[data-batch]').waitFor();await page.locator('#searchButton:not([disabled])').waitFor();assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/batches').length,1,'All recovery attempts are read-only, including after reload');
  });
  await check('explicit-rejection-releases-submit-lock',async(page,env)=>{
    env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/batches')return false;await route.fulfill({status:400,json:{error:'测试店铺已停用'}});return true;};
    await choose(page);await page.click('#collect');await page.getByText('测试店铺已停用',{exact:true}).waitFor();await page.locator('#collect:not([disabled])').waitFor();assert.equal(await page.locator('#searchButton').isDisabled(),false);assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/batches').length,1);
  });
  await check('other-task-busy-recovers-with-selection',async(page,env)=>{
    await choose(page,[shopA,shopB]);env.otherBusy=true;await page.click('#refresh');await page.locator('#otherTaskStatus:visible').waitFor();
    assert.match(await page.textContent('#otherTaskStatus'),/做图或其他上架任务.*结束后会自动恢复/);
    for(const id of ['collect','searchButton','syncStores','loadStoreDefaults','openCollection','parse','loadSites','rootCategories','childCategories'])assert.equal(await page.locator('#'+id).isDisabled(),true,id+' must be disabled while other workbench tasks run');
    assert.equal(await checkbox(page,shopA).isDisabled(),true);assert.equal(await page.locator('#refresh').isDisabled(),false);
    const writes=env.requests.filter(r=>r.method==='POST').length;env.otherBusy=false;await page.evaluate(()=>window.__tick());await page.locator('#collect:not([disabled])').waitFor();
    assert.equal(await page.locator('#searchButton').isDisabled(),false);assert.equal(await page.locator('#otherTaskStatus').isVisible(),false);assert.equal(await checkbox(page,shopA).isChecked(),true);assert.equal(await checkbox(page,shopB).isChecked(),true);assert.equal(await page.locator('[data-goods]').isChecked(),true);assert.equal(env.requests.filter(r=>r.method==='POST').length,writes,'Recovery polls must not submit or reread defaults');
  });
  await check('other-task-busy-on-load',async(page,env)=>{
    env.otherBusy=true;await page.reload();await page.locator('[data-goods]').waitFor();await page.locator('#otherTaskStatus:visible').waitFor();assert.equal(await page.locator('#searchButton').isDisabled(),true);
    env.otherBusy=false;await page.evaluate(()=>window.__tick());await page.locator('#searchButton:not([disabled])').waitFor();assert.equal(await page.locator('#otherTaskStatus').isVisible(),false);
    assert.equal(env.requests.filter(r=>['/api/sourcing/searches','/api/sourcing/batches','/api/sourcing/store-defaults'].includes(r.path)).length,0);
  });
  await check('other-task-started-before-post',async(page,env)=>{
    env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/batches')return false;env.otherBusy=true;await route.fulfill({status:409,json:{error:'有任务正在运行，请等当前任务结束。'}});return true;};
    await choose(page);await page.click('#collect');await page.getByText('有任务正在运行，请等当前任务结束。',{exact:true}).waitFor();assert.equal(await page.locator('#collect').isDisabled(),true);assert.equal(await page.locator('#otherTaskStatus').isVisible(),true);
    env.otherBusy=false;await page.evaluate(()=>window.__tick());await page.locator('#collect:not([disabled])').waitFor();assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/batches').length,1,'Busy rejection recovery must not retry the rejected write');
  });
  await check('other-task-finished-keeps-unknown-submission-lock',async(page,env)=>{
    let requestId;env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/batches')return false;requestId=entry.payload.requestId;env.otherBusy=true;await route.abort('failed');return true;};
    await choose(page);await page.click('#collect');await page.locator('#notice.error').waitFor();env.otherBusy=false;await page.evaluate(()=>window.__tick());assert.equal(await page.locator('#collect').isDisabled(),true,'Finishing an unrelated task cannot resolve an unknown submission');assert.equal(await page.locator('#otherTaskStatus').isVisible(),false);
    env.batches=[{id:requestId,status:'completed',erpName:'测试ERP',targetStores:[shopA],createdAt:'2026-11-19T00:00:00Z',rows:[]}];await page.evaluate(()=>window.__tick());await page.locator('[data-batch]').waitFor();await page.locator('#searchButton:not([disabled])').waitFor();assert.equal(env.requests.filter(r=>r.path==='/api/sourcing/batches').length,1);
  });
  await check('completed-batch-survives-final-search-read-failure',async(page,env)=>{
    await choose(page);env.busy=true;env.batches=[{id:'last-tick',status:'running',erpName:'测试ERP',targetStores:[shopA],createdAt:'2026-11-19T00:00:00Z',rows:[]}];await page.click('#refresh');await page.locator('[data-batch="last-tick"] .batch-head .state').getByText('运行中',{exact:true}).waitFor();assert.equal(await page.locator('#collect').isDisabled(),true);
    let failures=0;env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/searches/fixture-search-a'||failures)return false;failures++;await route.abort('failed');return true;};
    const writes=env.requests.filter(r=>r.method==='POST').length;env.busy=false;env.batches[0].status='completed';await page.evaluate(()=>window.__tick());
    assert.equal(failures,1);assert.equal(await page.locator('[data-batch="last-tick"] .batch-head .state').textContent(),'完成','A successful completed batch snapshot must render even when the independent search GET fails');assert.equal(await page.locator('#collect').isDisabled(),false);assert.equal(await page.locator('#searchButton').isDisabled(),false);assert.equal(await page.locator('#notice.error').isVisible(),true);assert.equal(env.requests.filter(r=>r.method==='POST').length,writes);
  });
  await check('other-task-release-survives-final-search-read-failure',async(page,env)=>{
    await choose(page);env.otherBusy=true;await page.click('#refresh');await page.locator('#otherTaskStatus:visible').waitFor();
    let failures=0;env.onApi=async(route,entry)=>{if(entry.path!=='/api/sourcing/searches/fixture-search-a'||failures)return false;failures++;await route.abort('failed');return true;};
    const writes=env.requests.filter(r=>r.method==='POST').length;env.otherBusy=false;await page.evaluate(()=>window.__tick());
    assert.equal(failures,1);assert.equal(await page.locator('#otherTaskStatus').isVisible(),false,'The unrelated task busy banner must clear using the confirmed idle snapshot');assert.equal(await page.locator('#collect').isDisabled(),false);assert.equal(await page.locator('#searchButton').isDisabled(),false);assert.equal(await checkbox(page,shopA).isChecked(),true);assert.equal(env.requests.filter(r=>r.method==='POST').length,writes);
  });
  await check('partial-feedback-control',async(page,env)=>{
    env.batches=[{id:'partial-record',status:'paused',method:'geekbi-product-data',erpName:'测试ERP',targetStores:[shopA,shopB],createdAt:'2026-11-19T00:00:00Z',rows:[{goodsId,title:'隔离测试商品',status:'partial',storeResults:[{storeKey:shopA.key,targetStore:shopA,status:'prepared',preparation:{ready:true,saved:true,url:'https://www.dianxiaomi.com/web/popTemu/edit?id=987654321'}},{storeKey:shopB.key,targetStore:shopB,status:'claimed',preparation:{ready:false,saved:false,issues:['材质缺少映射'],url:'https://www.dianxiaomi.com/web/tiktokProduct/edit?id=987654322'}}]}]}];
    await page.click('#refresh');await page.getByText('部分店铺未完成',{exact:true}).waitFor();assert.match(await page.locator('[data-store-result="temu:shop-a"]').textContent(),/草稿准备完成.*尚未实际发布/);assert.match(await page.locator('[data-store-result="tiktok:shop-b"]').textContent(),/材质缺少映射/);
    env.batches[0].rows[0].storeResults[0].status='verifying-reuse';await page.click('#refresh');await page.getByText('核对该店已有草稿',{exact:true}).waitFor();
  });
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));}
console.log(JSON.stringify({checks:reports.length,passed:reports.filter(r=>r.passed).length,failed:reports.filter(r=>!r.passed).map(r=>r.name)}));
if(reports.some(r=>!r.passed))process.exitCode=1;
