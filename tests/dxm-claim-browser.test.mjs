import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {claimStoreKey,selectClaimStore,isClaimEditorUrl,readClaimModal,readClaimRecords,findClaimRecord,verifyNewDraftSiteInitialization,claimTitlesMatch,createDxmClaimBrowser} from '../src/dxm-claim-browser.mjs';

test('claim selection binds exact platform and store and rejects stale or duplicate choices',()=>{
  const a={platform:'temu',name:'店铺1'},b={platform:'tiktok',name:'店铺1'};
  assert.notEqual(claimStoreKey(a),claimStoreKey(b));
  const key=claimStoreKey(a);
  assert.deepEqual(selectClaimStore([a,b],{...a,key}),{...a,key});
  assert.throws(()=>selectClaimStore([a,b],{...a,key:claimStoreKey(b)}),/标识与名称不一致/);
  assert.throws(()=>selectClaimStore([a,a],a),/同平台同名/);
  assert.throws(()=>selectClaimStore([a],b),/不存在或未授权/);
  assert.throws(()=>selectClaimStore([{...a,disabled:true}],a),/停用/);
  for(const target of [{platform:'amazon',name:'店铺1'},{platform:'temu',name:''},{platform:'temu',name:'x'.repeat(241)}])assert.throws(()=>claimStoreKey(target),/无效/);
});

test('claim verification accepts only the expected platform editor on the owned ERP origin',()=>{
  assert.equal(isClaimEditorUrl('https://www.dianxiaomi.com/web/popTemu/edit?id=12345678','temu'),true);
  for(const url of ['https://www.dianxiaomi.com.evil.test/web/popTemu/edit?id=12345678','https://www.dianxiaomi.com/web/popTemu/quoteEdit?id=12345678','https://www.dianxiaomi.com/web/productCrawl/edit?id=12345678','https://www.dianxiaomi.com/web/popTemu/edit?id=abc','http://www.dianxiaomi.com/web/popTemu/edit?id=12345678'])assert.equal(isClaimEditorUrl(url,'temu'),false);
  assert.equal(isClaimEditorUrl('https://www.dianxiaomi.com/web/popTemu/edit?id=12345678','tiktok'),false);
});

test('Temu title identity only collapses repeated ASCII spaces and keeps every actual text change strict',()=>{
  assert.equal(claimTitlesMatch('Poster Print, Artwork','Poster Print,  Artwork','temu'),true);
  assert.equal(claimTitlesMatch('Poster Print,   Artwork','Poster Print,  Artwork','temu'),true);
  for(const title of ['poster Print, Artwork','Poster Print Artwork','Poster Print, Different Artwork','Poster Print,\tArtwork','Poster Print,\u00a0Artwork',' Poster Print, Artwork','Poster Print, Artwork '])assert.equal(claimTitlesMatch(title,'Poster Print,  Artwork','temu'),false);
  assert.equal(claimTitlesMatch('Poster Print, Artwork','Poster Print,  Artwork','tiktok'),false);
});

let browser;
test.before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
test.after(()=>browser?.close());

async function fixture(t,{alreadyClaimed=false,unknownResult=false,duplicateSource=false,noStores=false,disabledStore=false,loadingSearch=false,fixedColumnCopies=false,missingHistory=false,unclaimedIdentityChanged=false,emptyHistoryLink=false,editorSite='加拿大站',historyTime=''}={}){
  const context=await browser.newContext();t.after(()=>context.close());
  const sourceUrl='https://www.temu.com/goods.html?_bg_fs=1&goods_id=601102827259469';
  const events=[],targets=new Map(),created=[],closed=[],visited=[],waits=[],queryTabs=[];let seq=0;
  await context.exposeFunction('fixtureEvent',event=>events.push(event));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());assert.equal(url.hostname,'www.dianxiaomi.com');visited.push(url.pathname);
    if(url.pathname==='/web/system/authorization/platform')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><style>body{margin:20px}.plat-auth-icon{display:inline-block;padding:12px}button{padding:10px}td,th{padding:10px}</style><div class="btn-user"><span class="user-name">fixture</span></div><button class="plat-auth-icon tiktok active" onclick="show('tiktok')">TikTok</button><button class="plat-auth-icon pddkj" onclick="show('temu')">Temu</button><main></main><script>
      function show(platform){document.querySelector('.tiktok').classList.toggle('active',platform==='tiktok');document.querySelector('.pddkj').classList.toggle('active',platform==='temu');const names=${noStores?'[]':"platform==='tiktok'?['店铺1']:['店铺1','店铺2测试']"};document.querySelector('main').innerHTML='<button role="tab" id="fixture'+(platform==='tiktok'?'-tab-site':'-tab-1')+'" aria-selected="true">'+(platform==='tiktok'?'普通店铺':'半托管店铺')+'('+names.length+')</button><table><thead><tr><th colid="shopName">店铺名称</th><th colid="site">站点</th><th>授权API</th></tr></thead><tbody>'+names.map(name=>'<tr class="vxe-body--row"><td colid="shopName"><div class="vxe-cell"><div>'+name+'</div>'+(${disabledStore}&&platform==='temu'&&name==='店铺1'?'<span>已停用</span>':'')+'</div></td><td colid="site">'+(platform==='tiktok'?'日本':'')+'</td><td>private-auth-value-do-not-return</td></tr>').join('')+'</tbody></table>'+(!names.length?'<div>未授权店铺</div>':'');}show('tiktok');
      </script>`});
    if(url.pathname==='/web/popTemu/pageList/draft')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><style>body{margin:20px}.d-tag-group-item{display:inline-block;padding:10px}button{min-width:60px;height:30px}td{padding:10px}</style><div class="btn-user"><span class="user-name">fixture</span></div><div class="in-screen-single"><div class="d-tag-group-item">店铺1</div></div><div class="d-tag-group-item">SKU</div><input name="tableSearchInput"><button>搜索</button><table><thead><tr><th colid="sku-column">SKU货号</th></tr></thead><tbody><tr class="vxe-body--row" rowid="220114595122686336"><td><a href="${sourceUrl}">Temu</a><div class="no-new-line3">Original product</div><p>「店铺1」</p></td><td colid="sku-column"><table><tbody><tr><td>17606613128563</td><td>CNY 81.93</td></tr></tbody></table></td><td><button onclick="location.href='/web/popTemu/edit?id=220114595122686336'">编辑</button></td></tr></tbody></table>`});
    if(url.pathname==='/web/popTemu/edit')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div class="btn-user"><span class="user-name">fixture</span></div><input name="sourceUrl" value="${sourceUrl}"><div class="ant-form-item"><label class="ant-form-item-label">店铺账号</label><span class="ant-select-selection-item">店铺1</span></div><div class="ant-form-item"><label class="ant-form-item-label">经营站点</label><span class="ant-select-selection-item">${editorSite}</span></div><div class="ant-form-item"><label class="ant-form-item-label">产品标题</label><input value="Original product"></div><input name="variationSku" value="17606613128563">`});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><style>body{font:14px Arial;margin:12px}button,a,label{display:inline-block;min-width:60px;min-height:24px;margin:3px}table{width:100%}.ant-modal{position:fixed;top:40px;left:30px;background:white;border:1px solid;padding:20px;z-index:10;min-width:600px}input[type=checkbox]{width:16px;height:16px}</style>
      <div class="btn-user"><span class="user-name">fixture</span></div><button role="tab" id="fixture-tab-" aria-selected="false" onclick="selectTab('')">全部</button><button role="tab" id="fixture-tab-no" aria-selected="false" onclick="selectTab('no')">未认领</button>
      <div class="flex jcsb" data-content="数据来源"><div>数据来源：</div><div><span class="search-item active">全部</span><span class="search-item">Temu</span></div></div>
      <div class="flex jcsb" data-content="搜索类型"><div>搜索类型：</div><div><span class="search-item">标题</span><span class="search-item active" onclick="this.classList.add('active')">来源URL</span></div></div>
      <div class="flex jcsb" data-content="采集时间"><div>采集时间：</div><div><span class="search-item active">全部</span><span class="search-item">今天</span></div></div>
      <input id="c-searchValue"><button onclick="searchProducts()">搜索</button>
      <table class="source-table"><tbody>${[0,...(duplicateSource?[1]:[])].map(n=>`<tr><td><a href="${sourceUrl}">Temu</a><span class="no-new-line4">Original product</span></td><td>采集成功</td><td><a href="/web/productCrawl/edit?id=${219835794625863308n+BigInt(n)}">编辑</a><a class="history-link" onclick="showHistory()">查看记录</a><a onclick="showClaim()">认领</a></td></tr>`).join('')}</tbody></table>
      <script>
      let claimed=localStorage.getItem('fixture-claimed')==='yes'||${alreadyClaimed};
      if(${missingHistory}||!claimed&&!${emptyHistoryLink})document.querySelectorAll('.history-link').forEach(e=>e.remove());
      function selectTab(kind){document.querySelectorAll('[role="tab"]').forEach(e=>e.setAttribute('aria-selected',String(e.id==='fixture-tab-'+kind)));document.querySelectorAll('.source-table').forEach(table=>table.style.display=kind==='no'&&claimed?'none':'table');if(kind==='no'&&${unclaimedIdentityChanged})document.querySelectorAll('a[href^="/web/productCrawl/edit?"]').forEach(e=>e.href='/web/productCrawl/edit?id=219835794600000000');}
      const scroll=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){if(this.closest('.fixed--hidden'))window.fixtureEvent('hidden-copy-scrolled');return scroll.call(this,options);};
      if(${fixedColumnCopies}){const table=document.querySelector('table'),clone=table.cloneNode(true);clone.className='fixed-copy';clone.querySelectorAll('td').forEach(cell=>{cell.className='fixed--hidden';cell.style.visibility='hidden';});document.body.appendChild(clone);}
      function searchProducts(){if(!${loadingSearch})return;const mask=document.createElement('div');mask.className='d-page-loading';mask.style='position:fixed;inset:0;z-index:1000;background:white';document.body.appendChild(mask);setTimeout(()=>mask.remove(),160);}
      const closeModal=()=>document.querySelector('.ant-modal')?.remove();
      function showHistory(){closeModal();const el=document.createElement('div');el.className='ant-modal';el.innerHTML='<div class="ant-modal-title">认领记录</div><table><tbody>'+(claimed?'<tr><td>Temu半托管</td><td>店铺1</td><td>认领成功</td><td>${historyTime}</td><td><a href="/web/popTemu/edit?id=220114595122686336">编辑</a></td></tr>':'<tr><td colspan="4">暂无数据</td></tr>')+'</tbody></table><button onclick="closeModal()">取消</button>';document.body.appendChild(el);}
      function showClaim(){closeModal();const el=document.createElement('div');el.className='ant-modal';el.innerHTML='<div class="ant-modal-title">选择店铺-认领到采集箱</div><section class="shop-div" name="tiktok"><div class="shop-title">TikTok <a>全选</a><label>多店铺发品</label><label>单店铺发品</label></div><div><label class="shop-label-box"><input type="checkbox" checked onchange="summary()">店铺1</label></div></section><section class="shop-div" name="popTemu"><div class="shop-title">Temu半托管 <a>全选</a></div><div><label class="shop-label-box"><input type="checkbox" onchange="summary()">店铺1</label><label class="shop-label-box"><input type="checkbox" onchange="summary()">店铺2测试</label></div></section><p id="summary">已选(1)</p><label><input type="checkbox">已认领至相同店铺的产品不再认领</label><button onclick="confirmClaim()">确定</button><button onclick="closeModal()">关闭</button>';document.body.appendChild(el);}
      function summary(){document.querySelector('#summary').textContent='已选('+document.querySelectorAll('section input:checked').length+')';}
      async function confirmClaim(){await window.fixtureEvent('confirm');${unknownResult?'return;':"claimed=true;localStorage.setItem('fixture-claimed','yes');closeModal();const cover=document.createElement('div');cover.style='position:fixed;inset:0;z-index:1000;background:white';cover.textContent='认领完成';document.body.appendChild(cover);"}}
      </script>`});
  });
  const poll=async(fn,{timeout=3000,interval=20,label}={})=>{const end=Date.now()+Math.min(timeout,3000);while(true){const result=await fn();if(result){if(label==='来源链接完全一致的已导入商品'){const page=[...targets.values()][0].page;waits.push({label,loading:await page.locator('.d-page-loading').count()});queryTabs.push(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id'));}return result;}if(Date.now()>=end)throw new Error('timeout '+label);await new Promise(r=>setTimeout(r,interval));}};
  const transport={poll,connection:async()=>({ws:'fixture'}),connect:async()=>({send:async(method,args)=>{
    if(method==='Target.createTarget'){const id=String(++seq),page=await context.newPage(),cdp=await context.newCDPSession(page);targets.set(id,{page,cdp});created.push(args);return {targetId:id};}
    if(method==='Target.closeTarget'){closed.push(args.targetId);await targets.get(args.targetId).page.close();targets.delete(args.targetId);return {};}
    if(method==='Target.getTargets')return {targetInfos:[...targets].map(([targetId,{page}])=>({targetId,type:'page',url:page.url()}))};
    throw new Error('Unexpected command '+method);
  },close(){}}),pageById:async(_info,id)=>({evaluate:(...args)=>targets.get(id).page.evaluate(...args),send:(...args)=>targets.get(id).cdp.send(...args),close(){}})};
  const bound={browserConfig:{type:'chrome'},erpConnection:{expectedAccount:'fixture'}};
  return {adapter:createDxmClaimBrowser({},transport),context,events,targets,created,closed,visited,waits,queryTabs,bound,args:{...bound,goodsId:'601102827259469',sourceUrl,product:{title:'Original product',skus:[{id:'17606613128563'}]},targetStore:{platform:'temu',name:'店铺1'},beforeClaim:async()=>events.push('intent')}};
}

test('live-store reader works before first import, separates platforms, and does not return authorization credentials',async t=>{
  const f=await fixture(t),result=await f.adapter.listStores(f.bound);
  assert.deepEqual(result.stores.map(s=>[s.platform,s.name]),[['tiktok','店铺1'],['temu','店铺1'],['temu','店铺2测试']]);
  assert.equal(new Set(result.stores.map(s=>s.key)).size,3);assert.equal(result.account,'fixture');
  assert.deepEqual(f.events,[]);assert.equal(f.created[0].background,true);assert.equal(f.targets.size,0);
  assert.deepEqual(f.visited,['/web/system/authorization/platform']);
  assert.equal(JSON.stringify(result).includes('private-auth-value'),false);
});

test('preflight rejects revoked or disabled targets before any claim and an empty authorization account has no import dependency',async t=>{
  const f=await fixture(t),ready=await f.adapter.preflightClaim(f.args);
  assert.equal(ready.status,'ready');assert.equal(ready.targetStore.key,claimStoreKey(f.args.targetStore));assert.deepEqual(f.events,[]);
  const empty=await fixture(t,{noStores:true});assert.deepEqual((await empty.adapter.listStores(empty.bound)).stores,[]);
  await assert.rejects(empty.adapter.preflightClaim(empty.args),/不存在或未授权/);assert.deepEqual(empty.events,[]);
  const disabled=await fixture(t,{disabledStore:true});await assert.rejects(disabled.adapter.preflightClaim(disabled.args),/停用/);assert.deepEqual(disabled.events,[]);
});

test('claim deselects remembered shops, persists intent before one submit, and recovers its receipt through a fresh list despite a result overlay',async t=>{
  const f=await fixture(t),result=await f.adapter.claimProduct(f.args);
  assert.equal(result.status,'claimed');assert.equal(result.evidence.targetStore.platform,'temu');
  assert.equal(result.evidence.platformEditUrl,'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595122686336');
  assert.deepEqual(f.events,['intent','confirm']);assert.equal(f.targets.size,0);
  assert.equal(f.visited.filter(p=>p==='/web/productCrawl/dataAcquisition').length,2);
  assert.deepEqual(f.queryTabs,['fixture-tab-','fixture-tab-no','fixture-tab-']);
});

test('first-import verification confirms the same product in Unclaimed without requiring a nonexistent history link or making any write',async t=>{
  const f=await fixture(t),result=await f.adapter.verifyClaim(f.args);
  assert.equal(result.status,'needs-review');assert.match(result.error,/尚未.*已成功认领/);
  assert.deepEqual(f.queryTabs,['fixture-tab-','fixture-tab-no']);assert.deepEqual(f.events,[]);assert.equal(f.targets.size,0);
});

test('a missing history control never permits a claim if the product is not actually unclaimed or its common identity changes',async t=>{
  const claimed=await fixture(t,{alreadyClaimed:true,missingHistory:true});
  await assert.rejects(claimed.adapter.claimProduct(claimed.args),/timeout.*来源链接完全一致/);assert.deepEqual(claimed.events,[]);
  const changed=await fixture(t,{unclaimedIdentityChanged:true});
  await assert.rejects(changed.adapter.claimProduct(changed.args),/未认领分类中的商品身份已变化/);assert.deepEqual(changed.events,[]);
});

test('an explicitly empty history dialog remains a supported first-claim state',async t=>{
  const f=await fixture(t,{emptyHistoryLink:true}),result=await f.adapter.claimProduct(f.args);
  assert.equal(result.status,'claimed');assert.deepEqual(f.events,['intent','confirm']);assert.deepEqual(f.queryTabs,['fixture-tab-','fixture-tab-']);
});

test('already claimed products are verified without resubmitting, and ambiguous duplicate source records stop',async t=>{
  const old=await fixture(t,{alreadyClaimed:true}),result=await old.adapter.claimProduct(old.args);
  assert.equal(result.alreadyPresent,true);assert.deepEqual(old.events,[]);
  const dup=await fixture(t,{duplicateSource:true});await assert.rejects(dup.adapter.claimProduct(dup.args),/多条同来源/);assert.deepEqual(dup.events,[]);
});

test('Temu saved row and editor accept normalized ASCII spaces while a changed source title still blocks claim verification',async t=>{
  const f=await fixture(t,{alreadyClaimed:true});f.args.product.title='Original  product';
  assert.equal((await f.adapter.verifyClaim(f.args)).status,'claimed');assert.deepEqual(f.events,[]);
  f.args.product.title='Original changed product';
  await assert.rejects(f.adapter.verifyClaim(f.args),/标题或SKU与原始商品不一致/);assert.deepEqual(f.events,[]);
});

test('read-only claim verification waits for the public search loading mask and never scrolls hidden fixed-column action copies',async t=>{
  const f=await fixture(t,{alreadyClaimed:true,loadingSearch:true,fixedColumnCopies:true}),result=await f.adapter.verifyClaim(f.args);
  assert.equal(result.status,'claimed');assert.equal(result.alreadyPresent,true);assert.deepEqual(f.events,[]);
  assert.deepEqual(f.waits,[{label:'来源链接完全一致的已导入商品',loading:0}]);assert.equal(f.targets.size,0);
});

test('unknown claim outcome retains the owned tab and never replays the confirm click',async t=>{
  const f=await fixture(t,{unknownResult:true});await assert.rejects(f.adapter.claimProduct(f.args),/timeout.*认领提交结果/);
  assert.deepEqual(f.events,['intent','confirm']);assert.equal(f.targets.size,1);
});

test('claim-history ambiguity and unsupported links cannot masquerade as a verified platform editor',()=>{
  const target={platform:'temu',name:'店铺1'},row={cells:['Temu半托管','店铺1','认领成功'],links:[],text:'Temu半托管 店铺1 认领成功'};
  assert.deepEqual(findClaimRecord({records:[],empty:true},target),null);
  assert.equal(findClaimRecord({records:[row],empty:false},target).platformEditUrl,null);
  assert.throws(()=>findClaimRecord({records:[row,row]},target),/多条认领记录/);
  assert.throws(()=>findClaimRecord({records:[{...row,text:'认领失败'}]},target),/未成功/);
});

test('new workbench claim evidence permits only its matching unsaved USA-to-Canada draft to reach preparation',async t=>{
  const f=await fixture(t,{alreadyClaimed:true,editorSite:'美国站',historyTime:'2026-11-19 20:16'});
  f.args.targetStore={...f.args.targetStore,key:claimStoreKey(f.args.targetStore),site:'加拿大站'};
  await assert.rejects(f.adapter.verifyClaim(f.args),/经营站点与目标不一致/);
  f.args.claimSubmission={version:1,source:'workbench-persisted-claim',saveState:'no-workbench-save-submission',account:'fixture',sourceUrl:f.args.sourceUrl,collectionEditUrl:'https://www.dianxiaomi.com/web/productCrawl/edit?id=219835794625863308',targetStore:{...f.args.targetStore},claimSubmittedAt:'2026-11-19T12:16:50.877Z'};
  const result=await f.adapter.verifyClaim(f.args),proof=result.evidence.newDraftSiteInitialization;
  assert.equal(result.status,'claimed');assert.equal(proof.fromSite,'美国站');assert.equal(proof.toSite,'加拿大站');assert.equal(proof.claimRecordTime,'2026-11-19T12:16:00.000Z');
  assert.deepEqual(proof.skuIds,['17606613128563']);assert.deepEqual(f.events,[]);assert.equal(f.targets.size,0);
  f.args.claimSubmission.claimSubmittedAt='2026-11-19T10:16:50.877Z';
  await assert.rejects(f.adapter.verifyClaim(f.args),/经营站点与目标不一致/);assert.deepEqual(f.events,[]);
});

test('site initialization rejects a request flag, changed bindings, mismatched receipt times, and any saved-workbench marker',()=>{
  const targetStore={platform:'temu',name:'店铺1',key:claimStoreKey({platform:'temu',name:'店铺1'}),site:'加拿大站'};
  const args={erpConnection:{expectedAccount:'fixture'},sourceUrl:'https://www.temu.com/goods.html?goods_id=601102690620218',targetStore};
  const collectionEditUrl='https://www.dianxiaomi.com/web/productCrawl/edit?id=219835794626855068';
  args.claimSubmission={version:1,source:'workbench-persisted-claim',saveState:'no-workbench-save-submission',account:'fixture',sourceUrl:args.sourceUrl,collectionEditUrl,targetStore,claimSubmittedAt:'2026-11-19T12:16:50.877Z'};
  const input={args,collectionEditUrl,claimRecord:{claimRecordTimeText:'2026-11-19 20:16'},skuIds:['17605932707560'],identity:{account:'fixture',site:['美国站'],store:['店铺1'],sources:[args.sourceUrl],url:'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595128519666'}};
  assert.ok(verifyNewDraftSiteInitialization(input));
  for(const change of [true,{...args.claimSubmission,saveState:'saved'},{...args.claimSubmission,account:'other'},{...args.claimSubmission,collectionEditUrl:collectionEditUrl+'1'},{...args.claimSubmission,targetStore:{...targetStore,site:'美国站'}},{...args.claimSubmission,claimSubmittedAt:'2026-11-19T11:16:50.877Z'}])assert.equal(verifyNewDraftSiteInitialization({...input,args:{...args,claimSubmission:change}}),null);
  assert.equal(verifyNewDraftSiteInitialization({...input,claimRecord:{claimRecordTimeText:'invalid'}}),null);
  assert.equal(verifyNewDraftSiteInitialization({...input,identity:{...input.identity,site:['英国站']}}),null);
});
