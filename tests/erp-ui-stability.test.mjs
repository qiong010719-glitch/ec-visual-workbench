import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {openDescriptionEditor,waitAndClick} from '../../scripts/lib/draft-ui.mjs';
import {navigateAndWait,readAutomationState} from '../../scripts/lib/erp-page-state.mjs';
import {createDraftSession} from '../../scripts/lib/draft-session.mjs';

let sharedBrowser;
test.before(async()=>{sharedBrowser=await chromium.launch({channel:'msedge',headless:true});});
test.after(()=>sharedBrowser?.close());
async function fixture(t,html) {
  const browser=sharedBrowser,context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><style>body{margin:20px}button{width:100px;height:40px}#wirelessDescBox{width:500px;height:180px;background:#eee}.smt-content-center{display:none;width:300px;height:100px}</style>${html}`}));
  const page=await context.newPage();await page.goto('https://www.dianxiaomi.com/web/popTemu/quoteEdit?id=12345678');
  await page.evaluate(()=>{document.documentElement.dataset.workbenchMotherId='12345678';});
  const cdp=await context.newCDPSession(page);
  return {browser,context,page,adapter:{send:(...args)=>cdp.send(...args),evaluate:(...args)=>page.evaluate(...args)}};
}

test('a laid-out but hidden/disabled description button waits; delayed editor opens exactly once',async t=>{
  const f=await fixture(t,`<div id="wirelessDescBox"><div id="baiduStatisticsSmtNewEditorEditClickNum" style="visibility:hidden"><button disabled>编辑描述</button></div></div><div class="smt-content-center">编辑器</div>
    <script>window.clicks=0;const box=document.querySelector('#wirelessDescBox'),wrap=document.querySelector('#baiduStatisticsSmtNewEditorEditClickNum'),button=wrap.firstElementChild;
    box.onmouseenter=()=>{setTimeout(()=>wrap.style.visibility='visible',250);setTimeout(()=>button.disabled=false,500)};
    button.onclick=()=>{window.clicks++;setTimeout(()=>document.querySelector('.smt-content-center').style.display='block',250)};</script>`);
  assert.ok(await f.page.locator('button').evaluate(e=>e.getClientRects().length));
  await openDescriptionEditor(f.adapter);
  assert.equal(await f.page.evaluate(()=>window.clicks),1);
  await openDescriptionEditor(f.adapter);assert.equal(await f.page.evaluate(()=>window.clicks),1,'already-open editor is not clicked again');
});

test('lost first hover recovers with a bounded re-hover; the successful click is never replayed',async t=>{
  const f=await fixture(t,`<div id="wirelessDescBox"><div id="baiduStatisticsSmtNewEditorEditClickNum" style="visibility:hidden"><button>编辑描述</button></div></div><div class="smt-content-center">编辑器</div>
    <script>window.hovers=0;window.clicks=0;document.querySelector('#wirelessDescBox').onmouseenter=()=>{if(++window.hovers===2)document.querySelector('#baiduStatisticsSmtNewEditorEditClickNum').style.visibility='visible'};
    document.querySelector('button').onclick=()=>{window.clicks++;document.querySelector('.smt-content-center').style.display='block'};</script>`);
  await openDescriptionEditor(f.adapter);
  assert.equal(await f.page.evaluate(()=>window.hovers),2);assert.equal(await f.page.evaluate(()=>window.clicks),1);
});

test('covered buttons are not clicked through; duplicate visible buttons fail closed',async t=>{
  const f=await fixture(t,`<button id="action" onclick="window.clicks++">操作</button><div id="cover" style="position:fixed;inset:0;background:#aaa"></div><script>window.clicks=0;</script>`);
  await assert.rejects(waitAndClick(f.adapter,{selector:'#action'},{timeout:250,label:'遮挡测试'}),e=>e.code==='ERP_WAIT_TIMEOUT'&&e.waitLabel==='遮挡测试');
  assert.equal(await f.page.evaluate(()=>window.clicks),0);
  await f.page.evaluate(()=>{document.querySelector('#cover').remove();document.body.appendChild(document.querySelector('#action').cloneNode(true));});
  await assert.rejects(waitAndClick(f.adapter,{selector:'button'}),/exactly once.*\(2\)/);assert.equal(await f.page.evaluate(()=>window.clicks),0);
});

test('editor-open timeout names the failed state, captures safe structure and does not re-click',async t=>{
  const f=await fixture(t,`<input type="password" value="SECRET-NOT-FOR-LOGS"><div id="wirelessDescBox"><div id="baiduStatisticsSmtNewEditorEditClickNum"><button onclick="window.clicks++">编辑描述</button></div></div><script>window.clicks=0;</script>`);
  await assert.rejects(openDescriptionEditor(f.adapter,{editorTimeout:250}),e=>e.waitLabel==='描述编辑器打开'&&e.waitMs>=250&&e.message.includes('超时'));
  assert.equal(await f.page.evaluate(()=>window.clicks),1);
  const state=await f.adapter.evaluate(readAutomationState);assert.equal(state.controls.find(c=>c.selector==='.smt-content-center').total,0);
  assert.ok(!JSON.stringify(state).includes('SECRET-NOT-FOR-LOGS'));
});

test('nested hover recovery reaches the submenu without resetting its parent hover',async t=>{
  const f=await fixture(t,`<style>#root{position:relative;width:100px;height:50px;background:#ddd}#sub{display:none;position:absolute;left:0;top:30px;width:130px;height:60px;background:#bbb}#leaf{display:none;position:absolute;left:100px;top:0;width:120px;height:50px;background:#999}#root:hover #sub{display:block}#sub:hover #leaf{display:block}</style><div id="root">批量操作<div id="sub">清空描述<div id="leaf" onclick="window.clicks++">清空图片</div></div></div><script>window.clicks=0;</script>`);
  await waitAndClick(f.adapter,{selector:'#leaf'},{hoverPath:[{selector:'#root'},{selector:'#sub'}],label:'清空图片'});
  assert.equal(await f.page.evaluate(()=>window.clicks),1);
});

test('navigation ignores the old loader and retries only destroyed read contexts',async()=>{
  let frames=0,checks=0;
  const page={send:async method=>method==='Page.navigate'?{loaderId:'new'}:{frameTree:{frame:{loaderId:++frames<2?'old':'new'}}},evaluate:async(fn,arg)=>{
    if(typeof arg==='string')return true;
    if(++checks===1)throw new Error('Execution context was destroyed');return true;
  }};
  await navigateAndWait(page,'https://www.dianxiaomi.com/web/popTemu/pageList/offline',()=>true,undefined,{label:'新列表加载',timeout:3000});
  assert.equal(frames,3);assert.equal(checks,2);
  await assert.rejects(navigateAndWait({send:async()=>({errorText:'net::ERR_CONNECTION_RESET'})},'https://www.dianxiaomi.com/',()=>true,undefined,{label:'新列表加载'}),/新列表加载.*ERR_CONNECTION_RESET/);
});

test('three products reuse two owned tabs; failed retry retires only the identified unsaved editor',async t=>{
  const f=await fixture(t,'<input name="variationSku" value="SKU1">');const userPage=f.page;
  const targets=new Map(),created=[],closed=[],activity=[];let seq=0;
  const transport={connection:async()=>({ws:'test',targets:async()=>[...targets].map(([id])=>({id,type:'page'}))}),connect:async()=>({
    send:async(method,params)=>{
      if(method==='Target.createTarget'){const id=String(++seq),p=await f.context.newPage();targets.set(id,p);created.push(params);return {targetId:id};}
      if(method==='Target.closeTarget'){closed.push(params.targetId);await targets.get(params.targetId).close();targets.delete(params.targetId);return {success:true};}
      throw new Error('unexpected '+method);
    },close(){}
  }),pageById:async(_info,id)=>{const p=targets.get(id),cdp=await f.context.newCDPSession(p);return {evaluate:(...args)=>p.evaluate(...args),send:(method,params)=>{if(method==='Emulation.setFocusEmulationEnabled')activity.push({id,enabled:params.enabled});return cdp.send(method,params);},close(){cdp.detach().catch(()=>{});}};}};
  const store={draftId:'12345678'},session=await createDraftSession({},transport);let failure;
  for(let i=1;i<=3;i++){
    session.begin();const inspector=await session.page('inspector'),editor=await session.page('editor');
    await targets.get(editor.targetId).goto('https://www.dianxiaomi.com/web/popTemu/quoteEdit?id=12345678');
    await editor.page.evaluate(()=>{document.documentElement.dataset.workbenchMotherId='12345678';});
    const row={sku:'SKU'+i};row.attemptToken=await session.claim(editor.page,store,row);row.targetId=editor.targetId;
    assert.notEqual(editor.targetId,inspector.targetId);
    if(i===3){session.keepEditor();failure=row;}
  }
  assert.equal(created.length,2);assert.equal(created[0].background,true);assert.equal(created[1].background,false);
  assert.deepEqual(activity,[{id:'1',enabled:true},{id:'2',enabled:true}],'only the two owned pages are kept active');
  await session.close();assert.equal(targets.size,1);assert.equal(userPage.isClosed(),false);
  assert.deepEqual(activity.slice(-2),[{id:'1',enabled:false},{id:'2',enabled:false}],'activity is restored even for the retained failed editor');
  const resumed=await createDraftSession({},transport);await resumed.retireFailure(failure,store);assert.equal(targets.size,0);
  const editor=await resumed.page('editor');await targets.get(editor.targetId).goto('https://www.dianxiaomi.com/web/popTemu/edit?id=87654321');
  await assert.rejects(resumed.retireFailure({...failure,targetId:editor.targetId},store),/已跳转或身份已变化/);
  assert.equal(targets.size,1,'saved/mismatched page must not be closed by retry');
  await resumed.close();assert.equal(targets.size,0);assert.equal(userPage.isClosed(),false);
});
