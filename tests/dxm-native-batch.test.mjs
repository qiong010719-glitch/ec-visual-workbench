import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {DXM_NATIVE_BATCH_CAPABILITIES,nativeBatchScope,readDxmNativeBatchPage,nativeBatchReadiness,nativeBatchUiPoint,nativeBatchOpenIntent,readbackDxmNativeBatch,openDxmNativeBatchSelection,moveDxmNativeBatchSelection,continueDxmNativeCategoryMapping} from '../src/dxm-native-batch.mjs';

const url='https://www.dianxiaomi.com/web/sheinProduct/draft',account='fixture-account',storeName='fixture-neutral-store';
const rows=[1,2,3].map(value=>({draftId:'22011460295192916'+value,goodsId:'60123456789000'+value,sourceUrl:`https://www.temu.com/neutral-appliance-g-60123456789000${value}.html`,storeName,storeBindingKey:'fixture-store'}));
const binding={key:'fixture-store',storeName,site:'美国站',businessMode:'OBM'};
const scope=()=>nativeBatchScope({platform:'shein',account,storeBinding:binding,rows:[rows[0],rows[2]]});
const expected={url,account};

test('native batch scope fixes draft, full source link, account and store identities',()=>{
  const value=scope();assert.equal(value.rows.length,2);assert.equal(value.scopeKey.length,64);
  assert.deepEqual(nativeBatchScope(value),value);
  assert.equal(DXM_NATIVE_BATCH_CAPABILITIES.nativePrepare,false);assert.equal(DXM_NATIVE_BATCH_CAPABILITIES.nativeSave,false);assert.equal(DXM_NATIVE_BATCH_CAPABILITIES.nativePending,false);
  for(const override of [{platform:'tiktok'},{rows:[rows[0],rows[0]]},{rows:[{...rows[0],sourceUrl:rows[1].sourceUrl}]},{rows:[{...rows[0],storeName:'other'}]},{rows:[{...rows[0],platformEditUrl:'https://evil.test/web/sheinProduct/edit?id='+rows[0].draftId}]}])assert.throws(()=>nativeBatchScope({platform:'shein',account,storeBinding:binding,rows,...override}));
});

let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND']});});
after(async()=>{await browser?.close();});
async function fixture(t,{warning=true,prechecked=[],declaredCount=null,visibleRows=rows,fixedCopy=false}={}){
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<body></body>'}));
  const page=await context.newPage();await page.goto(url);
  await page.setContent(`<style>body{margin:24px;font:14px Arial}td,th{padding:8px}button{padding:7px;margin:5px}label{display:inline-block;padding:6px}.ant-modal{position:fixed;inset:80px 80px auto;background:white;padding:25px;border:2px solid;z-index:10}</style><div class="btn-user"><span class="user-name">${account}</span></div><p>共 ${rows.length} 条记录</p><p id="selected-count">已选中${declaredCount??prechecked.length}条数据</p><label><input id="select-all" type="checkbox" onclick="events.push('select-all')">全选</label><button onclick="events.push('menu');document.querySelector('#menu').hidden=false">批量操作</button><div id="menu" role="menu" hidden><button role="menuitem" onclick="openNative()">批量编辑</button><button role="menuitem" onclick="events.push('move')">批量移入待发布</button><button role="menuitem" onclick="events.push('all-attributes')">全属性修改</button></div><table><thead><tr><th>选择</th><th>产品信息</th><th colid="price">供货价 CNY</th></tr></thead><tbody>${visibleRows.map(row=>`<tr class="vxe-body--row" rowid="${row.draftId}"><td class="col--checkbox"><label><input type="checkbox" ${prechecked.includes(row.draftId)?'checked':''} onchange="updateSelection('${row.draftId}')"></label></td><td><a href="${row.sourceUrl}">Temu</a><span>「${storeName}」</span><b>OBM</b><a href="/web/sheinProduct/edit?id=${row.draftId}">编辑</a></td><td colid="price">CNY 81.93</td></tr>`).join('')}${fixedCopy?`<tr class="vxe-body--row" rowid="${rows[0].draftId}"><td class="fixed--hidden" style="visibility:hidden"><label><input type="checkbox"></label><a href="https://www.temu.com/wrong-g-601234567890999.html">隐藏</a>「其他店铺」</td><td>固定列副本</td></tr>`:''}</tbody></table><script>window.events=[];window.savedFields={title:'Neutral appliance',price:'81.93',category:''};function updateSelection(id){events.push('select:'+id);document.querySelector('#selected-count').textContent='已选中'+document.querySelectorAll('td.col--checkbox input:checked').length+'条数据';}function openNative(){events.push('edit');document.querySelector('#menu').hidden=true;const modal=document.createElement('div');modal.className='ant-modal';modal.setAttribute('role','dialog');modal.innerHTML=${JSON.stringify(warning?'<div>共选择2个产品，有2个产品未自动识别出分类，需要手动对应分类</div><div>注：若跳过编辑分类，直接编辑产品，将丢失变种信息</div><button onclick="events.push(\'map-category\')">编辑分类</button><button onclick="events.push(\'skip-category\')">跳过，去编辑产品</button>':'<h2>批量编辑</h2><input value=""><button onclick="events.push(\'save\')">保存</button><button onclick="events.push(\'publish\')">发布</button>')};document.body.append(modal);}</script>`);
  const cdp=await context.newCDPSession(page),events=[];
  const wrapped={evaluate:(fn,arg)=>page.evaluate(fn,arg),send:(method,args)=>{events.push(method);return cdp.send(method,args);}};
  const poll=async(fn,{label}={})=>{const end=Date.now()+1000;do{const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<end);throw new Error('fixture timeout: '+label);};
  return {page,wrapped,events,poll,read:()=>page.evaluate(readDxmNativeBatchPage,expected)};
}

test('native list reader merges fixed rows and reports only visible scope, checkboxes and menu items',async t=>{
  const f=await fixture(t,{fixedCopy:true}),snapshot=await f.read();assert.equal(snapshot.rows.length,3);assert.equal(snapshot.selectedCount,0);
  assert.deepEqual(snapshot.rows[0].sourceUrls,[rows[0].sourceUrl]);assert.deepEqual(snapshot.rows[0].storeNames,[storeName]);assert.deepEqual(snapshot.rows[0].businessModes,['OBM']);assert.deepEqual(snapshot.rows[0].priceCurrencies,['CNY']);
  assert.equal(snapshot.rows[0].checkboxCount,1);assert.equal(snapshot.controls.find(control=>control.text==='批量编辑').count,0);
  const ready=nativeBatchReadiness(snapshot,scope());assert.equal(ready.canSelect,true);assert.equal(ready.ready,false);assert.equal(ready.capabilities.nativePrepare,false);
  await assert.rejects(f.page.evaluate(readDxmNativeBatchPage,{...expected,account:'other'}),/账号已变化/);
});

test('native batch opening selects only explicit members, persists intent, then stops at variant-loss category warning',async t=>{
  const f=await fixture(t),intents=[],readbacks=[],progress=[],before=await f.page.evaluate(()=>({...savedFields}));
  const result=await openDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),requestId:'native-test-01',beforeOpen:async intent=>{assert.equal((await f.page.evaluate(()=>events)).includes('edit'),false);intents.push(intent);},onReadback:value=>readbacks.push(value),onProgress:value=>progress.push(value)});
  assert.equal(result.status,'needs-review');assert.equal(result.phase,'category-mapping-required');assert.equal(result.retainPage,true);assert.equal(result.businessWrite,false);
  assert.equal(intents.length,1);assert.deepEqual(intents[0].selectedIds,[rows[0].draftId,rows[2].draftId]);assert.equal(intents[0].operation,'open-native-batch-editor');assert.equal(intents[0].businessWrite,false);
  assert.deepEqual(await f.page.evaluate(()=>events),['select:'+rows[0].draftId,'select:'+rows[2].draftId,'menu','edit']);
  assert.deepEqual(await f.page.evaluate(()=>savedFields),before);assert.ok(result.blockers.some(blocker=>blocker.code==='NATIVE_CATEGORY_MAPPING_REQUIRED'));assert.ok(result.blockers.some(blocker=>blocker.code==='NATIVE_BATCH_FORM_UNVERIFIED'));
  assert.equal(readbacks.length,1);assert.equal(progress.at(-1).selected,2);assert.equal((await f.read()).dialogs[0].buttons.includes('跳过，去编辑产品'),true);
});

test('observed decorative trigger and generic visible menu labels work without invented data selectors',async t=>{
  const f=await fixture(t);
  await f.page.evaluate(()=>{
    [...document.querySelectorAll('button')].find(button=>button.textContent==='批量操作').textContent+=' \uE007';
    for(const button of document.querySelectorAll('#menu button')){const label=document.createElement('span');label.textContent=button.textContent;label.style='display:inline-block;padding:10px;margin:5px';label.setAttribute('onclick',button.getAttribute('onclick'));button.replaceWith(label);}
    const unrelated=document.createElement('span');unrelated.textContent='批量编辑';document.querySelector('tbody td:nth-child(2)').append(unrelated);
  });
  const result=await openDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),requestId:'native-visible-01',beforeOpen:()=>{}});
  assert.equal(result.phase,'category-mapping-required');assert.deepEqual(await f.page.evaluate(()=>events),['select:'+rows[0].draftId,'select:'+rows[2].draftId,'menu','edit']);
});

for(const config of [{prechecked:[rows[1].draftId]},{prechecked:[rows[0].draftId],declaredCount:5},{visibleRows:[rows[0],rows[1]]}])test('preexisting unrelated, cross-page or missing members prevent every batch click '+JSON.stringify(config),async t=>{
  const f=await fixture(t,config),result=await openDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),requestId:'native-block-01',beforeOpen:()=>assert.fail('no intent expected')});
  assert.equal(result.status,'blocked');assert.deepEqual(await f.page.evaluate(()=>events),[]);assert.equal(f.events.length,0);
});

test('store, mode and exact source URL drift block native selection even with the same draft ID',async t=>{
  for(const mutation of ['store','mode','source']){
    const f=await fixture(t);await f.page.evaluate(({id,mutation})=>{const row=document.querySelector(`tr[rowid="${id}"]`);if(mutation==='store')row.querySelector('span').textContent='「other store」';else if(mutation==='mode')row.querySelector('b').textContent='OEM';else row.querySelector('a').href+='?changed=1';},{id:rows[0].draftId,mutation});
    const readiness=nativeBatchReadiness(await f.read(),scope());assert.equal(readiness.canSelect,false);assert.ok(readiness.blockers.some(blocker=>blocker.code==='NATIVE_MEMBER_IDENTITY_MISMATCH'));
  }
});

test('all-select, skip-category, save and publish controls are never exposed by the native locator',async t=>{
  const f=await fixture(t);
  for(const locator of [{kind:'all'},{kind:'menu',text:'全选'},{kind:'menu',text:'跳过，去编辑产品'},{kind:'menu',text:'保存'},{kind:'menu',text:'批量发布'}])await assert.rejects(f.page.evaluate(nativeBatchUiPoint,{expected,locator}),/不允许全选/);
  assert.deepEqual(await f.page.evaluate(()=>events),[]);
});

test('native pending action selects only explicit members and journals before one click',async t=>{
  const f=await fixture(t);let journalled=false;
  const result=await moveDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),beforeDispatch:async()=>{assert.ok(!(await f.page.evaluate(()=>events)).includes('move'));journalled=true;}});
  assert.equal(journalled,true);assert.equal(result.status,'submitted-for-readback');assert.equal(result.published,false);
  assert.deepEqual(await f.page.evaluate(()=>events),['select:'+rows[0].draftId,'select:'+rows[2].draftId,'menu','move']);
});

test('category warning continues only through edit categories for the exact selected batch',async t=>{
  const f=await fixture(t);await openDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),requestId:'native-category-01',beforeOpen:()=>{}});
  const result=await continueDxmNativeCategoryMapping({page:f.wrapped,poll:f.poll,scope:scope()});assert.equal(result.businessWrite,false);
  assert.equal((await f.page.evaluate(()=>events)).at(-1),'map-category');assert.ok(!(await f.page.evaluate(()=>events)).includes('skip-category'));
});

test('an already persisted native opening is read back without replaying selection or the opening click',async t=>{
  const f=await fixture(t,{prechecked:[rows[0].draftId,rows[2].draftId]}),intent=nativeBatchOpenIntent(await f.read(),scope(),'native-replay-01');
  const result=await openDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),existingIntent:intent,beforeOpen:()=>assert.fail('opening must not repeat')});
  assert.equal(result.status,'needs-review');assert.deepEqual(await f.page.evaluate(()=>events),[]);assert.equal(f.events.length,0);
  await assert.rejects(readbackDxmNativeBatch({page:f.wrapped,scope:scope(),intent:{...intent,scopeKey:'different'}}),/不属于本批/);
});

test('selection drift after persisting intent stops before native edit dispatch',async t=>{
  const f=await fixture(t),result=await openDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),requestId:'native-drift-01',beforeOpen:async()=>{await f.page.locator(`tr[rowid="${rows[1].draftId}"] input`).check();}});
  assert.equal(result.status,'needs-review');assert.equal(result.phase,'native-open-unconfirmed');assert.equal((await f.page.evaluate(()=>events)).includes('edit'),false);assert.ok(result.intent);
});

test('unknown native form remains unsupported and never falls back to per-item fill or save',async t=>{
  const f=await fixture(t,{warning:false}),result=await openDxmNativeBatchSelection({page:f.wrapped,poll:f.poll,scope:scope(),requestId:'native-unknown-01',beforeOpen:()=>{}});
  assert.equal(result.status,'needs-review');assert.equal(result.phase,'native-form-unverified');assert.equal(result.capabilities.nativePrepare,false);assert.equal(result.capabilities.nativeSave,false);
  assert.equal(await f.page.locator('.ant-modal input').inputValue(),'');assert.equal((await f.page.evaluate(()=>events)).some(event=>['save','publish','all-attributes','skip-category','move'].includes(event)),false);
});
