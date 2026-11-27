import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {dispatchDxmNativeSave} from '../src/dxm-required-platform-browser.mjs';
import {nativeBatchScope} from '../src/dxm-native-batch.mjs';

const poll=async fn=>{for(let i=0;i<3;i++){const value=await fn();if(value)return value;}throw new Error('fixture point timeout');};

test('native save controller consumes the real DOM point and journals before exactly one click',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),account='neutral-fixture',draftId='220114600000000001',goodsId='601234567890001';
  const scope=nativeBatchScope({platform:'shein',account,storeBinding:{key:'neutral-shop',storeName:'家居测试店'},rows:[{draftId,goodsId,sourceUrl:`https://www.temu.com/storage-g-${goodsId}.html`}]});
  const url=`https://www.dianxiaomi.com/web/sheinProduct/batchEdit?ids=${draftId}&dxmState=offline`,expected={url,account,scope};
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="btn-user"><span class="user-name">${account}</span></div><div class="shein-batch-edit-table-page"><div class="action"><button class="button btn-orange">保存</button></div></div><script>window.saved=0;document.querySelector('button').onclick=()=>window.saved++;</script>`}));
  await page.goto(url);const cdp=await page.context().newCDPSession(page),events=[];
  const transport={evaluate:(...args)=>page.evaluate(...args),send:async(method,args)=>{assert.equal(method,'Input.dispatchMouseEvent');assert.ok(Number.isFinite(args.x)&&Number.isFinite(args.y));assert.equal(events[0],'intent');events.push(args.type);return cdp.send(method,args);}};
  await dispatchDxmNativeSave({page:transport,poll,expected,beforeDispatch:async()=>{assert.equal(await page.evaluate(()=>window.saved),0);events.push('intent');}});
  assert.equal(await page.evaluate(()=>window.saved),1);
  assert.deepEqual(events,['intent','mouseMoved','mousePressed','mouseReleased']);
});

test('invalid or changed native save points never dispatch a business click',async()=>{
  let intents=0,sends=0;
  await assert.rejects(dispatchDxmNativeSave({page:{evaluate:async()=>({point:{x:10,y:10}}),send:async()=>sends++},poll,expected:{},beforeDispatch:async()=>intents++}),/坐标无效/);
  assert.equal(intents,0);assert.equal(sends,0);
  let reads=0;
  await assert.rejects(dispatchDxmNativeSave({page:{evaluate:async()=>({x:++reads>2?20:10,y:10,selector:'#save'}),send:async()=>sends++},poll,expected:{},beforeDispatch:async()=>intents++}),/入口已变化/);
  assert.equal(intents,1);assert.equal(sends,0);
});
