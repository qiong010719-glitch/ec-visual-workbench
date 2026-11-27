import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {COLLECTION_URL,createCollectionBrowser,readCollectionNotice} from '../src/collection-browser.mjs';

let browser;
test.before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});});
test.after(()=>browser?.close());

const goodsId='601102827259469';
const canonical=`https://www.temu.com/goods.html?goods_id=${goodsId}`;
const longUrl=`https://www.temu.com/canvas-%E5%A2%99%E7%94%BB-g-${goodsId}.html?refer_page_name=search_result&search_key=canvas%20art`;
const decodedLongUrl=decodeURI(longUrl);
async function fixture(t,{stuck=false,resetQuery=false,resetValue=false,ignoreSourceClick=false,sourceUrl=canonical,records,requiredQuery=null,lateImage=false,appearAfterQueries=1,foregroundOnly=false,notice='',ignoreNoticeClose=false,sourceControl='normal'}={}){
  const context=await browser.newContext();t.after(()=>context.close());
  const events=[],controls=[],focusEvents=[],queries=[],targets=new Map(),createdIds=[],closedIds=[],activatedIds=[],broughtToFrontIds=[],foregroundTargets=new Set(),navigations=[];let sequence=0;
  records??=[{sourceUrl}];
  const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const rows=records.map((record,index)=>`<tr><td>${(record.links||[record.sourceUrl]).map(url=>`<a href="${escape(url)}">Temu</a>`).join('')}<img src="/fixture-image.svg"><div class="no-new-line4">Stale old result</div></td><td>采集成功</td><td>${record.editUrl===null?'':`<a href="${escape(record.editUrl||'/web/productCrawl/edit?id='+String(219835794625863300n+BigInt(index)))}">编辑</a>`}</td></tr>`).join('');
  const notices=notice?Array.from({length:notice==='multiple'?2:1},(_,index)=>`<div class="ant-modal-mask" id="notice-mask-${index}"></div><div class="ant-modal-wrap ${notice==='unknown'?'':'bullet-layer bullet-layer-auto notice-list-modal notice-list-modal--feature'}" id="notice-${index}"><div class="ant-modal" role="dialog"><div class="ant-modal-title">${notice==='unknown'?'确认发布':notice==='wrong-title'?'授权提示':'功能更新'}</div><p>Fixture announcement body must not escape the diagnostic</p>${Array.from({length:notice==='duplicate-close'?2:1},(_,button)=>`<button type="button" class="ant-modal-close" aria-label="Close" style="right:${12+button*70}px" onclick="closeNotice(${index})">×</button>`).join('')}${notice==='covered-close'?'<div class="close-cover"></div>':''}<button onclick="window.fixtureControl(\'dangerous-confirm\')">确定</button></div></div>`).join(''):'';
  await context.exposeFunction('fixtureEvent',event=>events.push(event));
  await context.exposeFunction('fixtureControl',value=>controls.push(value));
  await context.exposeFunction('fixtureQuery',query=>queries.push(query));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.origin,'https://www.dianxiaomi.com');
    if(url.pathname==='/fixture-image.svg'&&lateImage&&url.searchParams.has('late'))await new Promise(r=>setTimeout(r,900));
    if(url.pathname==='/fixture-image.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>'});
    assert.equal(url.pathname,'/web/productCrawl/dataAcquisition');
    const targetId=[...targets].find(([,target])=>target.page===route.request().frame().page())?.[0];
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><style>button,.search-item,a{display:inline-block;padding:12px}.d-page-loading{position:fixed;inset:0;z-index:100;background:white}.ant-modal-mask{position:fixed;inset:0;z-index:200;background:#0008}.ant-modal-wrap{position:fixed;inset:0;z-index:201}.ant-modal{position:absolute;left:15%;top:80px;width:70%;height:300px;background:white;padding:20px;box-sizing:border-box}.ant-modal-close{position:absolute;top:8px}.close-cover{position:absolute;right:0;top:0;width:80px;height:80px;z-index:3;background:#eee}</style>
      <div class="btn-user"><span class="user-name">fixture</span></div>
      <button role="tab" id="fixture-tab-" aria-selected="false">全部</button><button role="tab" id="fixture-tab-no" aria-selected="false">未认领</button><button role="tab" id="fixture-tab-FAILED" aria-selected="false">采集失败</button>
      <div class="flex jcsb" data-content="数据来源"><div class="m-right12 m-top5">数据来源：</div><div class="flex-1"><span class="search-item active">全部</span><span class="search-item">Temu</span></div></div>
      <div class="flex jcsb" ${sourceControl==='missing-group'?'':'data-content="搜索类型"'}><div class="m-right12 m-top5">搜索类型：</div><div class="flex-1"><span class="search-item ${sourceControl==='selected-unclickable'?'':'active'}" id="title-mode"> 标题 </span><span style="display:inline-block;position:relative"><span class="search-item ${['selected-unclickable','dual-active'].includes(sourceControl)?'active':''}" id="source-mode" style="${sourceControl==='selected-unclickable'?'pointer-events:none':''}" onclick="window.fixtureControl('source-mode');if(!${ignoreSourceClick}){this.classList.add('active');document.querySelector('#title-mode').classList.remove('active');}"> 来源URL </span>${sourceControl==='covered'?'<span style="position:absolute;inset:0;z-index:2"></span>':''}</span>${['hidden-duplicate','aria-hidden-duplicate','inert-duplicate','ambiguous'].includes(sourceControl)?`<span class="search-item" ${sourceControl==='hidden-duplicate'?'style="visibility:hidden"':sourceControl==='aria-hidden-duplicate'?'aria-hidden="true"':sourceControl==='inert-duplicate'?'inert':''}>来源URL</span>`:''}</div></div>
      ${sourceControl==='duplicate-group'?'<div class="flex jcsb" data-content="搜索类型"><div>搜索类型：</div><div><span class="search-item active">标题</span><span class="search-item">来源URL</span></div></div>':''}
      <div class="flex jcsb" data-content="采集时间"><div class="m-right12 m-top5">采集时间：</div><div class="flex-1"><span class="search-item active">全部</span><span class="search-item">今天</span></div></div>
      ${sourceControl==='outside-group-active'?'<div data-content="其他条件"><span class="search-item active">来源URL</span></div>':''}
      <input id="c-searchValue"><button onclick="searchProducts()">搜索</button>
      <button role="tab" onclick="window.fixtureEvent('import-form')">导入采集</button>
      <table><tbody>${rows}</tbody></table><div class="ant-empty-description" style="display:${records.length?'none':'block'}">暂无数据</div>
      ${notices}
      <script>
      ${foregroundOnly?`window.fixtureVisible=${foregroundTargets.has(targetId)};Object.defineProperty(document,'hidden',{get:()=>!window.fixtureVisible});Object.defineProperty(document,'visibilityState',{get:()=>window.fixtureVisible?'visible':'hidden'});`:''}
      document.querySelectorAll('[id^=fixture-tab-]').forEach(tab=>tab.onclick=()=>{document.querySelectorAll('[id^=fixture-tab-]').forEach(e=>e.setAttribute('aria-selected',String(e===tab)));});
      function closeNotice(index){window.fixtureControl('notice-close');if(${ignoreNoticeClose})return;document.querySelector('#notice-'+index+' .ant-modal-close').disabled=true;setTimeout(()=>{document.querySelector('#notice-'+index)?.remove();document.querySelector('#notice-mask-'+index)?.remove();},80);}
      let queryCount=0;function searchProducts(){queryCount++;const query=document.querySelector('#c-searchValue').value;window.fixtureQuery(query);const mask=document.createElement('div');mask.className='d-page-loading';document.body.appendChild(mask);if(!${stuck})setTimeout(()=>{document.querySelectorAll('.no-new-line4').forEach(el=>el.textContent='Fresh search result');if(${lateImage})document.querySelectorAll('table img').forEach(img=>img.src='/fixture-image.svg?late='+Date.now());const queryMatches=(${JSON.stringify(requiredQuery)}===null||query===${JSON.stringify(requiredQuery)})&&queryCount>=${appearAfterQueries};document.querySelector('table').style.display=queryMatches?'table':'none';document.querySelector('.ant-empty-description').style.display=${records.length}&&queryMatches?'none':'block';if(${resetQuery}){document.querySelector('#source-mode').classList.remove('active');document.querySelector('#title-mode').classList.add('active');}if(${resetValue})document.querySelector('#c-searchValue').value='other query';mask.remove();},160);}
      </script>`});
  });
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[...targets].map(([id,{page}])=>({id,type:'page',url:page.url()}))}),
    connect:async()=>({send:async(method,args)=>{
      if(method==='Target.createTarget'){const targetId=String(++sequence),page=await context.newPage(),cdp=await context.newCDPSession(page);targets.set(targetId,{page,cdp});createdIds.push(targetId);return {targetId};}
      if(method==='Target.closeTarget'){await targets.get(args.targetId).page.close();targets.delete(args.targetId);closedIds.push(args.targetId);return {};}
      if(method==='Target.activateTarget'){assert.ok(targets.has(args.targetId));activatedIds.push(args.targetId);return {};}
      throw new Error('Unexpected browser action '+method);
    },close(){}}),
    pageById:async(_info,id)=>({evaluate:(...args)=>targets.get(id).page.evaluate(...args),send:(...args)=>{assert.notEqual(args[0],'DOM.setFileInputFiles','no upload may follow an unresolved search');if(args[0]==='Emulation.setFocusEmulationEnabled')focusEvents.push(args[1].enabled);if(args[0]==='Page.bringToFront'){broughtToFrontIds.push(id);foregroundTargets.add(id);}if(args[0]==='Page.navigate')navigations.push({targetId:id,url:args[1].url});return targets.get(id).cdp.send(...args);},close(){}}),
    poll:async(fn,{timeout=2000,label}={})=>{const end=Date.now()+Math.min(timeout,stuck?200:2000);while(true){const result=await fn();if(result)return result;if(Date.now()>=end)throw new Error('timeout '+label);await new Promise(r=>setTimeout(r,20));}}
  };
  return {adapter:createCollectionBrowser({},transport),transport,targets,createdIds,closedIds,activatedIds,broughtToFrontIds,foregroundTargets,navigations,events,controls,focusEvents,queries,args:{browserConfig:{type:'chrome'},erpConnection:{expectedAccount:'fixture'},goodsId,sourceUrl,beforeSubmit:()=>events.push('upload-intent')}};
}

function taskArgs(f){
  const tabs={},ownership=[];
  return {...f.args,tabs,ownership,onTarget:(kind,id,details)=>{tabs[kind]=id;ownership.push({kind,id,...details});}};
}

test('thirty free-sourcing receipt checks and open reuse one persisted target and leave user tabs untouched',async t=>{
  const f=await fixture(t),chrome=await f.transport.connect(),{targetId:userTarget}=await chrome.send('Target.createTarget');
  const userPage=f.targets.get(userTarget).page;await userPage.goto(COLLECTION_URL);await userPage.fill('#c-searchValue','user working query');
  const args=taskArgs(f);await f.adapter.check(args);const targetId=args.tabs.collection;
  for(let i=0;i<30;i++)assert.equal((await f.adapter.verify(args)).status,'verified');
  await f.adapter.open(args);
  assert.deepEqual(f.createdIds,[userTarget,targetId]);assert.deepEqual(f.closedIds,[]);assert.deepEqual(f.activatedIds,[targetId]);
  assert.equal(f.targets.size,2);assert.equal(await userPage.inputValue('#c-searchValue'),'user working query');
  assert.deepEqual(args.ownership,[{kind:'collection',id:targetId,owned:true,sourceUrl:COLLECTION_URL}]);
  assert.equal(f.queries.length,30);assert.ok(f.navigations.every(n=>n.targetId===targetId&&n.url===COLLECTION_URL));assert.deepEqual(f.events,[]);
});

test('a new adapter reuses the persisted collection target after restart',async t=>{
  const f=await fixture(t),args=taskArgs(f);await f.adapter.check(args);
  const restored=createCollectionBrowser({},f.transport);
  assert.equal((await restored.lookup(args)).status,'verified');assert.equal(f.createdIds.length,1);assert.equal(args.ownership.length,1);assert.deepEqual(f.closedIds,[]);
});

test('existing Chrome restores only its saved collection target to the foreground before a later lookup',async t=>{
  const f=await fixture(t,{foregroundOnly:true}),chrome=await f.transport.connect(),{targetId:userTarget}=await chrome.send('Target.createTarget');
  const userPage=f.targets.get(userTarget).page;await userPage.goto(COLLECTION_URL);await userPage.fill('#c-searchValue','user working query');
  const args=taskArgs(f);args.browserConfig={type:'chrome',connectionMode:'existing'};
  await f.adapter.check(args);const collectionTarget=args.tabs.collection,page=f.targets.get(collectionTarget).page;
  f.foregroundTargets.delete(collectionTarget);await page.evaluate(()=>{window.fixtureVisible=false;});
  assert.equal(await page.evaluate(()=>document.hidden),true);
  const result=await f.adapter.lookup(args);
  assert.equal(result.status,'verified');assert.equal(await page.evaluate(()=>document.hidden),false);
  assert.deepEqual(f.activatedIds,[collectionTarget,collectionTarget]);assert.deepEqual(f.broughtToFrontIds,[collectionTarget,collectionTarget]);
  assert.deepEqual(f.createdIds,[userTarget,collectionTarget]);assert.deepEqual(f.closedIds,[]);
  assert.equal(await userPage.inputValue('#c-searchValue'),'user working query');assert.deepEqual(f.events,[]);
});

test('a uniquely identified feature announcement is closed once before source search and leaves the user tab untouched',async t=>{
  const f=await fixture(t,{notice:'feature',foregroundOnly:true}),chrome=await f.transport.connect(),{targetId:userTarget}=await chrome.send('Target.createTarget');
  const userPage=f.targets.get(userTarget).page;await userPage.goto(COLLECTION_URL);
  const args=taskArgs(f);args.browserConfig={type:'chrome',connectionMode:'existing'};
  await f.adapter.check(args);const taskPage=f.targets.get(args.tabs.collection).page;
  const diagnostic=await taskPage.evaluate(readCollectionNotice);
  assert.equal(diagnostic.status,'feature-notice');assert.deepEqual(Object.keys(diagnostic).sort(),['closePoint','maskCount','modalCount','status','title']);
  assert.doesNotMatch(JSON.stringify(diagnostic),/Fixture|fixture|announcement body/);
  const result=await f.adapter.lookup(args);
  assert.equal(result.status,'verified');assert.deepEqual(f.queries,[canonical,canonical]);
  assert.deepEqual(f.controls,['notice-close','source-mode']);assert.deepEqual(f.events,[]);
  assert.equal(await taskPage.locator('.ant-modal-wrap,.ant-modal-mask').count(),0);
  assert.equal(await userPage.locator('.notice-list-modal--feature').count(),1,'the original user page is never adopted or dismissed');
  assert.ok(f.activatedIds.every(id=>id===args.tabs.collection));assert.ok(f.broughtToFrontIds.every(id=>id===args.tabs.collection));assert.deepEqual(f.closedIds,[]);
});

test('unknown or ambiguous dialogs and close controls block querying without any dialog or source click',async t=>{
  for(const notice of ['unknown','multiple','wrong-title','duplicate-close','covered-close']){
    const f=await fixture(t,{notice});
    await assert.rejects(f.adapter.lookup(f.args),error=>error.code==='COLLECTION_QUERY_BLOCKED'&&/弹窗遮挡/.test(error.message));
    assert.deepEqual(f.controls,[],notice);assert.deepEqual(f.queries,[],notice);assert.deepEqual(f.events,[],notice);assert.deepEqual(f.closedIds,[],notice);
    assert.equal(f.targets.size,1,'failed task page remains available for diagnosis');
  }
});

test('an announcement that ignores its close click is retained and never clicked or queried again',async t=>{
  const f=await fixture(t,{notice:'feature',ignoreNoticeClose:true});
  await assert.rejects(f.adapter.lookup(f.args),error=>error.code==='COLLECTION_QUERY_BLOCKED'&&/公告关闭后仍遮挡/.test(error.message));
  assert.deepEqual(f.controls,['notice-close']);assert.deepEqual(f.queries,[]);assert.deepEqual(f.events,[]);assert.deepEqual(f.closedIds,[]);
});

test('a closed task collection tab is replaced once and the new target is persisted',async t=>{
  const f=await fixture(t),args=taskArgs(f);await f.adapter.check(args);const first=args.tabs.collection;
  await (await f.transport.connect()).send('Target.closeTarget',{targetId:first});
  assert.equal((await f.adapter.verify(args)).status,'verified');const replacement=args.tabs.collection;
  assert.notEqual(replacement,first);await f.adapter.check(args);
  assert.deepEqual(f.createdIds,[first,replacement]);assert.deepEqual(f.closedIds,[first]);assert.equal(f.targets.size,1);assert.equal(args.ownership.length,2);
});

test('a task collection tab navigated into an editor is preserved without navigation or a replacement tab',async t=>{
  const f=await fixture(t),args=taskArgs(f);await f.adapter.check(args);const targetId=args.tabs.collection,page=f.targets.get(targetId).page;
  await page.evaluate(()=>history.replaceState({},'', '/web/productCrawl/edit?id=219835794628444620'));
  const before=f.navigations.length;
  await assert.rejects(f.adapter.verify(args),/专用采集箱标签已跳转到其他页面/);
  assert.equal(f.navigations.length,before);assert.equal(f.createdIds.length,1);assert.deepEqual(f.closedIds,[]);assert.match(page.url(),/\/edit\?id=/);assert.deepEqual(f.queries,[]);
});

test('a failed account check preserves one reusable diagnosis tab for a subsequent corrected binding',async t=>{
  const f=await fixture(t),args=taskArgs(f);
  await assert.rejects(f.adapter.check({...args,erpConnection:{expectedAccount:'wrong'}}),/账号与绑定不一致/);
  const targetId=args.tabs.collection;assert.ok(f.targets.has(targetId));
  assert.equal((await f.adapter.check(args)).ready,true);assert.equal(f.createdIds.length,1);assert.deepEqual(f.closedIds,[]);
});

test('failure to persist new collection ownership closes only the newly created blank tab',async t=>{
  const f=await fixture(t),args={...f.args,tabs:{},onTarget:()=>{throw new Error('disk unavailable');}};
  await assert.rejects(f.adapter.check(args),/disk unavailable/);
  assert.equal(f.targets.size,0);assert.deepEqual(f.closedIds,f.createdIds);assert.deepEqual(f.navigations,[]);
});

test('XLSX lookup opts out of free-sourcing target reuse even when a tabs bag is present',async t=>{
  const f=await fixture(t,{sourceUrl:longUrl,records:[{sourceUrl:longUrl,editUrl:null}],requiredQuery:longUrl}),args=taskArgs(f);
  await f.adapter.check(args);const collectionTarget=args.tabs.collection;
  const result=await f.adapter.lookup({...args,product:{sourceUrl:longUrl}});
  assert.equal(result.status,'needs-review');assert.match(result.error,/编辑页地址无法确认/);
  assert.equal(f.createdIds.length,2);assert.deepEqual(f.closedIds,[f.createdIds[1]]);assert.ok(f.targets.has(collectionTarget));assert.equal(args.ownership.length,1);assert.deepEqual(f.events,[]);
});

test('collection verification waits for the full-page query mask instead of accepting matching stale rows',async t=>{
  const f=await fixture(t),result=await f.adapter.verify(f.args);
  assert.equal(result.status,'verified');assert.equal(result.evidence.title,'Fresh search result');assert.deepEqual(f.events,[]);assert.deepEqual(f.focusEvents,[true,false]);
});

test('a stalled collection query stops import before the upload form or persistent submission intent',async t=>{
  const f=await fixture(t,{stuck:true});
  await assert.rejects(f.adapter.importProduct(f.args),/timeout 采集箱查询加载完成/);assert.deepEqual(f.events,[]);assert.deepEqual(f.focusEvents,[true,false]);
});

test('an ignored source-mode click cannot issue a title search or treat its result as an empty collection box',async t=>{
  const f=await fixture(t,{ignoreSourceClick:true});
  await assert.rejects(f.adapter.importProduct(f.args),/timeout 来源URL查询方式已选中/);assert.deepEqual(f.events,[]);
});

test('an already selected source mode is verified without clicking its noninteractive label',async t=>{
  const f=await fixture(t,{sourceControl:'selected-unclickable'});
  assert.equal((await f.adapter.lookup(f.args)).status,'verified');
  assert.deepEqual(f.controls,[]);assert.deepEqual(f.queries,[canonical,canonical]);assert.deepEqual(f.events,[]);
});

test('independent data-source and collection-time active filters do not block the source URL search group',async t=>{
  const f=await fixture(t),result=await f.adapter.lookup(f.args);
  assert.equal(result.status,'verified');assert.deepEqual(f.controls,['source-mode']);
  assert.deepEqual(f.queries,[canonical,canonical]);assert.deepEqual(f.events,[]);
});

test('a double-active, duplicate or missing search-type group rejects queries without guessing or changing the mode',async t=>{
  for(const sourceControl of ['dual-active','duplicate-group','missing-group']){
    const f=await fixture(t,{sourceControl});
    await assert.rejects(f.adapter.lookup(f.args),/搜索类型|查询方式|来源URL|不唯一|控件/);
    assert.deepEqual(f.controls,[],sourceControl);assert.deepEqual(f.queries,[],sourceControl);assert.deepEqual(f.events,[],sourceControl);
  }
});

test('hidden source controls do not make the visible source selector ambiguous',async t=>{
  for(const sourceControl of ['hidden-duplicate','aria-hidden-duplicate','inert-duplicate']){
    const f=await fixture(t,{sourceControl});
    assert.equal((await f.adapter.lookup(f.args)).status,'verified',sourceControl);
    assert.deepEqual(f.controls,['source-mode'],sourceControl);assert.deepEqual(f.queries,[canonical,canonical],sourceControl);assert.deepEqual(f.events,[],sourceControl);
  }
});

test('covered or visibly ambiguous source controls still block all queries and uploads',async t=>{
  for(const sourceControl of ['covered','ambiguous']){
    const f=await fixture(t,{sourceControl});
    await assert.rejects(f.adapter.lookup(f.args),sourceControl==='covered'?/timeout 可操作的“来源URL”控件/:/搜索类型控件不唯一|状态不明确/);
    assert.deepEqual(f.controls,[],sourceControl);assert.deepEqual(f.queries,[],sourceControl);assert.deepEqual(f.events,[],sourceControl);
  }
});

test('a query mode reset after search is rejected before reusing stale rows or uploading another product',async t=>{
  const f=await fixture(t,{resetQuery:true});
  await assert.rejects(f.adapter.importProduct(f.args),/查询方式或来源链接发生变化/);assert.deepEqual(f.events,[]);
});

test('an outside-group active source label cannot hide the real search mode resetting to title',async t=>{
  const f=await fixture(t,{sourceControl:'outside-group-active',resetQuery:true,records:[]});
  await assert.rejects(f.adapter.lookup(f.args),/查询方式或来源链接发生变化/);
  assert.deepEqual(f.controls,['source-mode']);assert.deepEqual(f.queries,[canonical]);assert.deepEqual(f.events,[]);
});

test('a changed source input after search cannot reuse a matching old row',async t=>{
  const f=await fixture(t,{resetValue:true});
  await assert.rejects(f.adapter.verify(f.args),/查询方式或来源链接发生变化/);assert.deepEqual(f.events,[]);assert.deepEqual(f.focusEvents,[true,false]);
});

test('free sourcing queries the decoded full source URL and verifies the actual encoded link without importing',async t=>{
  const f=await fixture(t,{sourceUrl:longUrl,records:[{sourceUrl:decodedLongUrl}],requiredQuery:decodedLongUrl});
  const result=await f.adapter.lookup(f.args);
  assert.equal(result.status,'verified');assert.equal(result.evidence.sourceUrl,longUrl);
  assert.equal(result.evidence.requestedSourceUrl,longUrl);assert.equal(result.evidence.matchBy,'temu-goods-id');
  assert.deepEqual(f.queries,[decodedLongUrl,decodedLongUrl]);assert.ok(f.queries.every(query=>query!==goodsId&&query!==longUrl));assert.deepEqual(f.events,[]);
});

test('free sourcing accepts a long source for a canonical request and deduplicates links only within one row',async t=>{
  const f=await fixture(t,{records:[{links:[longUrl,longUrl]}],requiredQuery:canonical});
  const result=await f.adapter.verify(f.args);
  assert.equal(result.status,'verified');assert.equal(result.evidence.sourceUrl,longUrl);assert.equal(result.evidence.requestedSourceUrl,canonical);
  assert.deepEqual(f.queries,[canonical]);assert.deepEqual(f.events,[]);
});

test('multiple free-sourcing rows for the same ID remain ambiguous even without distinct edit URLs',async t=>{
  const f=await fixture(t,{sourceUrl:longUrl,records:[{sourceUrl:canonical,editUrl:null},{sourceUrl:canonical,editUrl:null}]});
  const result=await f.adapter.verify(f.args);
  assert.equal(result.status,'needs-review');assert.match(result.error,/多条/);assert.deepEqual(f.events,[]);
});

test('free matching ignores lookalike hosts, credentials, invalid IDs and unrelated product IDs',async t=>{
  const invalid=[
    `https://www.temu.com.evil.test/goods.html?goods_id=${goodsId}`,
    `http://www.temu.com/goods.html?goods_id=${goodsId}`,
    `https://user@www.temu.com/goods.html?goods_id=${goodsId}`,
    `https://www.temu.com:8443/goods.html?goods_id=${goodsId}`,
    `https://www.temu.com/search_result.html?goods_id=${goodsId}`,
    'https://www.temu.com/goods.html?goods_id=bad-id',
    `https://www.temu.com/goods.html?goods_id=9${goodsId}`
  ];
  const f=await fixture(t,{sourceUrl:longUrl,records:[...invalid.map(sourceUrl=>({sourceUrl})),{sourceUrl:canonical}]});
  const result=await f.adapter.verify(f.args);
  assert.equal(result.status,'verified');assert.equal(result.evidence.sourceUrl,canonical);assert.deepEqual(f.events,[]);
});

test('invalid free-sourcing request identity is rejected before any search or import',async t=>{
  const f=await fixture(t);
  for(const sourceUrl of [`https://www.temu.com.evil.test/goods.html?goods_id=${goodsId}`,'https://www.temu.com/goods.html?goods_id=bad-id','https://www.temu.com/goods.html?goods_id=601102827259470']){
    await assert.rejects(f.adapter.lookup({...f.args,sourceUrl}),/来源链接与商品ID不一致/);
  }
  assert.deepEqual(f.queries,[]);assert.deepEqual(f.events,[]);
});

test('free-sourcing absence requires the visible empty state for the decoded full source URL',async t=>{
  const f=await fixture(t,{sourceUrl:longUrl,records:[],requiredQuery:decodedLongUrl});
  const result=await f.adapter.lookup(f.args);
  assert.equal(result.status,'absent');assert.deepEqual(f.queries,[decodedLongUrl]);assert.notEqual(f.queries[0],goodsId);assert.notEqual(f.queries[0],longUrl);assert.deepEqual(f.events,[]);
});

test('XLSX product lookup keeps full-URL search and rejects a normalized same-ID source',async t=>{
  const f=await fixture(t,{sourceUrl:longUrl,records:[{sourceUrl:canonical}],requiredQuery:longUrl});
  const result=await f.adapter.lookup({...f.args,product:{sourceUrl:longUrl}});
  assert.equal(result.status,'needs-review');assert.deepEqual(f.queries,[longUrl]);assert.deepEqual(f.events,[]);
});

test('XLSX product lookup still matches its exact source and proceeds to detailed validation',async t=>{
  const f=await fixture(t,{sourceUrl:longUrl,records:[{sourceUrl:longUrl,editUrl:null}],requiredQuery:longUrl});
  const result=await f.adapter.lookup({...f.args,product:{sourceUrl:longUrl}});
  assert.equal(result.status,'needs-review');assert.match(result.error,/编辑页地址无法确认/);
  assert.deepEqual(f.queries,[longUrl,longUrl]);assert.deepEqual(f.events,[]);
});


test('free sourcing waits for a newly collected thumbnail without repeating the query or submitting',async t=>{
  const f=await fixture(t,{lateImage:true}),result=await f.adapter.verify(f.args);
  assert.equal(result.status,'verified');assert.equal(result.evidence.hasImage,true);
  assert.deepEqual(f.queries,[canonical]);assert.deepEqual(f.events,[]);
});


test('a submitted item waits for delayed unclaimed indexing using only receipt queries',async t=>{
  const f=await fixture(t,{appearAfterQueries:2});
  const result=await f.adapter.verify({...f.args,submittedAt:new Date().toISOString()});
  assert.equal(result.status,'verified');assert.equal(result.evidence.hasImage,true);
  assert.deepEqual(f.queries,[canonical,canonical]);assert.deepEqual(f.events,[]);
});
