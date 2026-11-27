import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createTemuFrontBrowser,readTemuPage,searchUrl,productIdentity} from '../src/temu-front-browser.mjs';

let browser;
test.before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND']});});
test.after(()=>browser?.close());
const searchMarkup=content=>`<div class="js-search-goodsList"><div class="autoFitGoodsList">${content}</div></div>`;

test('search keywords use percent-encoded spaces and preserve literal plus signs',()=>{
  for(const [keyword,encoded] of [['canvas wall art','canvas%20wall%20art'],['C++ wall art','C%2B%2B%20wall%20art'],['canvas+wall+art','canvas%2Bwall%2Bart']]){
    const url=searchUrl(keyword);
    assert.equal(url,`https://www.temu.com/search_result.html?search_key=${encoded}&search_method=user`);
    assert.equal(new URL(url).searchParams.get('search_key'),keyword);
  }
});

for(const foreignRedirect of [false,true])test(foreignRedirect?'automatic verification redirects are checked before navigating or using the page':'automatic verification returns to the existing search page without redundant navigation',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const keyword='canvas wall art',sourceUrl='https://www.temu.com/fixture-g-601105252678121.html',requests=[];
  const destination=foreignRedirect?'https://unrelated.example/search_result.html':searchUrl(keyword);
  await context.route('**/*',route=>{
    requests.push(route.request().url());
    const body=new URL(route.request().url()).pathname==='/bgn_verification.html'?'<p>Verify you are human</p>':searchMarkup(`<a href="${sourceUrl}">商品</a>`);
    return route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const page=await context.newPage();await page.goto('https://www.temu.com/bgn_verification.html');
  const cdp=await context.newCDPSession(page);let navigations=0,solveCalls=0;const focus=[];
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[{id:'existing',type:'page',url:page.url()}]}),
    connect:async()=>({send:async()=>{throw new Error('must reuse the existing task page');},close(){}}),
    pageById:async()=>({send:(method,args)=>{if(method==='Page.navigate')navigations++;if(method==='Emulation.setFocusEmulationEnabled')focus.push(args.enabled);return cdp.send(method,args);},evaluate:(fn,arg)=>page.evaluate(fn,arg),close(){}}),
    poll:async fn=>{const value=await fn();if(!value)throw new Error('fixture page should already be ready');return value;}
  };
  const adapter=createTemuFrontBrowser({},transport,{captchaSolver:{solve:async()=>{solveCalls++;await page.goto(destination);return {status:'solved'};}}});
  const args={browserConfig:{type:'chrome'},tabs:{search:'existing'},keyword,limit:1,onTarget:()=>{throw new Error('must retain the existing target');}};
  if(foreignRedirect)await assert.rejects(adapter.search(args),/已跳转到其他网站/);
  else{
    const result=await adapter.search(args);
    assert.equal(result.status,'ready');assert.deepEqual(result.products,[{sourceUrl,title:'商品'}]);assert.equal(page.url(),searchUrl(keyword));
  }
  assert.equal(solveCalls,1);assert.equal(navigations,0);assert.equal(requests.length,2);assert.deepEqual(focus,[true,false]);
});

test('Temu access-failure page is distinct from a CAPTCHA challenge',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<p>没有网络连接</p><p>无法连接到互联网。请切换到其他网络。</p>'}));
  const page=await context.newPage();await page.goto('https://www.temu.com/bgn_no_access.html');
  const result=await page.evaluate(readTemuPage);assert.equal(result.status,'waiting-network');assert.match(result.message,/尚未进入验证码/);
});

test('real adapter preserves human verification tab and clicks the plugin once after intent',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const targets=new Map(),events=[],tabs={};let sequence=0,navigations=0,challenge=true;
  const sourceUrl='https://www.temu.com/fixture-g-601105252678121.html';
  await context.exposeFunction('clicked',ready=>{assert.equal(ready,true,'product detail must load before collection');events.push('click');});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());assert.equal(u.hostname,'www.temu.com');navigations++;
    const body=u.pathname==='/search_result.html'?(challenge?'<p>请拖动滑块完成验证</p>':searchMarkup(`<a href="${sourceUrl}">商品</a>`)):'<div id="dianxiaomi" style="position:fixed;right:20px;top:20px"><span>采集到店小秘</span><button onclick="clicked(!!document.querySelector(\'#goodsDetail\'));this.textContent=\'采集中...\';setTimeout(()=>this.textContent=\'采集成功\',60)">开始采集</button></div><script>setTimeout(()=>{const h=document.createElement(\'h1\');h.textContent=\'Fixture product\';document.body.append(h);const d=document.createElement(\'div\');d.id=\'goodsDetail\';d.textContent=\'Fixture details\';document.body.append(d);},400);</script>';
    return route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[...targets].map(([id,{page}])=>({id,type:'page',url:page.url()}))}),
    connect:async()=>({send:async(method,args)=>{
      if(method==='Target.createTarget'){const id=String(++sequence),page=await context.newPage(),cdp=await context.newCDPSession(page);targets.set(id,{page,cdp});return {targetId:id};}
      if(method==='Target.activateTarget'){events.push('activate:'+args.targetId);return {};}
      throw new Error('Unexpected browser call '+method);
    },close(){}}),
    pageById:async(info,id)=>({send:(method,args)=>targets.get(id).cdp.send(method,args),evaluate:(fn,arg)=>targets.get(id).page.evaluate(fn,arg),close(){}}),
    poll:async(fn)=>{const until=Date.now()+1000;do{const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}while(Date.now()<until);throw new Error('fixture wait timeout');}
  };
  const adapter=createTemuFrontBrowser({},transport),args={browserConfig:{type:'chrome'},keyword:'canvas art',limit:1,tabs,onTarget:(kind,id)=>{tabs[kind]=id;}};
  assert.equal((await adapter.search(args)).status,'waiting-verification');const original=tabs.search;assert.equal(navigations,1);
  challenge=false;await targets.get(original).page.setContent(searchMarkup(`<a href="${sourceUrl}">商品</a><a href="${sourceUrl}">重复图片</a>`));
  assert.equal((await adapter.search(args)).products.length,1);assert.equal(tabs.search,original);assert.equal(navigations,1);
  const result=await adapter.collect({...args,keyword:undefined,sourceUrl,goodsId:'601105252678121',beforeSubmit:()=>events.push('intent')});
  assert.equal(result.status,'submitted');assert.equal(result.pluginStatus,'success');await transport.poll(()=>events.includes('click'));assert.deepEqual(events,['intent','click']);
  await targets.get(tabs.product).page.setContent('<p>Verify you are human</p><div id="dxm"><button>开始采集</button></div>');
  assert.equal((await adapter.collect({...args,keyword:undefined,sourceUrl,goodsId:'601105252678121',beforeSubmit:()=>events.push('extra-intent')})).status,'waiting-verification');
  assert.deepEqual(events,['intent','click']);
  await adapter.open({...args,kind:'product',sourceUrl});assert.equal(events.at(-1),'activate:'+tabs.product);
  const oldSearch=targets.get(original);await oldSearch.page.close();targets.delete(original);
  await adapter.open({...args,kind:'search'});assert.notEqual(tabs.search,original);assert.equal(targets.get(tabs.search).page.url(),searchUrl(args.keyword));
});

const pluginClones=()=>Array.from({length:30},()=>'<div class="dxm-link-next" style="position:absolute;left:32px;top:4px"><span>采到店小秘</span></div>').join('');

test('the unique fixed plugin action takes priority over its title and thirty hover clones',async t=>{
  const context=await browser.newContext({viewport:{width:1000,height:700}});t.after(()=>context.close());
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();
  await page.setContent(`<div style="position:fixed;right:40px;top:80px;padding:16px;background:white">
    <span>采集到店小秘</span><button data-fixture="real" onclick="window.fixtureClicks.push('real')"><span>开始采集</span></button>
    </div><div id="dxm"><button onclick="window.fixtureClicks.push('fallback')">开始采集</button></div>${pluginClones()}`);
  await page.evaluate(()=>{window.fixtureClicks=[];});
  const result=await page.evaluate(readTemuPage);
  assert.equal(result.status,'ready');assert.equal(result.buttonCount,1);assert.ok(result.button);
  const real=await page.locator('[data-fixture="real"]').boundingBox();
  assert.ok(Math.abs(result.button.x-(real.x+real.width/2))<0.1);
  assert.ok(Math.abs(result.button.y-(real.y+real.height/2))<0.1);
  await page.mouse.click(result.button.x,result.button.y);
  assert.deepEqual(await page.evaluate(()=>window.fixtureClicks),['real']);
});

test('two fixed-panel collection actions remain ambiguous despite a fallback button',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();
  await page.setContent(`<div style="position:fixed;right:40px;top:80px"><span>采集到店小秘</span><button>开始采集</button><button>开始采集</button></div>
    <div id="dxm"><button>开始采集</button></div>${pluginClones()}`);
  const result=await page.evaluate(readTemuPage);
  assert.equal(result.status,'ready');assert.equal(result.buttonCount,2);assert.equal(result.button,null);
});

test('native dxm fallback remains available while plain title and action spans never qualify',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();
  await page.setContent(`<div id="dxm"><span>采集到店小秘</span><button><span>开始采集</span></button></div>${pluginClones()}`);
  let result=await page.evaluate(readTemuPage);
  assert.equal(result.buttonCount,1);assert.ok(result.button);
  await page.setContent(`<div id="dxm"><span>采集到店小秘</span><span>开始采集</span></div>${pluginClones()}`);
  result=await page.evaluate(readTemuPage);
  assert.equal(result.buttonCount,0);assert.equal(result.button,null);
});

const productOrder=Array.from({length:40},(_,i)=>(i*7)%97+1);
const listingProduct=(n,rank)=>({sourceUrl:`https://www.temu.com/fixture-g-6011052526${String(n).padStart(5,'0')}.html?source=search&rank=${rank}&campaign=fixture%2Btag`,title:'商品'+n});
async function searchFixture(t,{initial=8,scope=true,captchaSolver}={}){
  const context=await browser.newContext({viewport:{width:900,height:600}});t.after(()=>context.close());
  const keyword='canvas wall art',requests=[],focus=[];let scrollCalls=0,navigations=0;
  await context.route('**/*',route=>{requests.push(route.request().url());return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><body></body>'});});
  const page=await context.newPage();await page.goto(searchUrl(keyword));
  const sidebar=Array.from({length:35},(_,i)=>`<a href="${listingProduct(500+i,i).sourceUrl}">侧边推荐${i}</a>`).join('');
  await page.setContent(`<aside style="position:fixed;right:0;top:0;width:80px;height:500px;overflow:auto"><div class="autoFitGoodsList">${sidebar}</div></aside>
    <div ${scope?'class="js-search-goodsList"':''}><div ${scope?'class="autoFitGoodsList"':''} id="fixture-results"></div></div><div style="height:20000px"></div>`);
  const products=productOrder.map((n,i)=>listingProduct(n,i+1));
  const f={page,context,keyword,products,requests,focus,onScroll:null,loaded:0,stats:()=>({scrollCalls,navigations})};
  f.load=async count=>{
    await page.evaluate(({products,start,end})=>{
      const list=document.querySelector('#fixture-results');
      for(const product of products.slice(start,end)){
        const card=document.createElement('article');card.style.cssText='height:42px;width:500px';card.dataset.tooltip='goodContainer-'+new URL(product.sourceUrl).pathname.match(/-g-(\d+)\.html/)[1];
        for(const [i,source] of [product.sourceUrl,product.sourceUrl+'&image=duplicate'].entries()){
          const link=document.createElement('a');link.href=source;link.textContent=i?'重复图片':product.title;card.append(link);
        }
        list.append(card);
      }
    },{products,start:f.loaded,end:count});
    f.loaded=count;
  };
  await f.load(initial);
  await page.exposeFunction('fixtureSearchScrolled',async()=>{await f.onScroll?.();});
  await page.evaluate(()=>addEventListener('scroll',()=>{window.fixtureSearchScrolled();}));
  const cdp=await context.newCDPSession(page);
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[{id:'search-task',type:'page',url:page.url()}]}),
    connect:async()=>({send:async()=>{throw new Error('must reuse the assigned task tab');},close(){}}),
    pageById:async()=>({
      evaluate:async(fn,arg)=>{if(fn.name==='scrollTemuSearchPage')scrollCalls++;return page.evaluate(fn,arg);},
      send:(method,args)=>{if(method==='Page.navigate')navigations++;if(method==='Emulation.setFocusEmulationEnabled')focus.push(args.enabled);return cdp.send(method,args);},close(){}
    }),
    poll:async(fn,{timeout=1000}={})=>{
      const end=Date.now()+Math.min(timeout,180);
      while(true){const result=await fn();if(result)return result;if(Date.now()>=end)throw Object.assign(new Error('fixture polling timed out'),{code:'ERP_WAIT_TIMEOUT'});await new Promise(resolve=>setTimeout(resolve,8));}
    }
  };
  f.adapter=createTemuFrontBrowser({},transport,{captchaSolver});
  f.args={browserConfig:{type:'chrome'},tabs:{search:'search-task'},keyword,limit:30,onTarget:()=>{throw new Error('must keep the existing task target');}};
  return f;
}

test('the first thirty products come from main-list DOM order with duplicate identities and original queries preserved',async t=>{
  const f=await searchFixture(t,{initial:35});
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'ready');assert.deepEqual(result.products,f.products.slice(0,30));
  assert.equal(result.searchSummary.requested,30);assert.equal(result.searchSummary.scrolls,0);
  assert.equal(f.stats().scrollCalls,0);assert.equal(f.stats().navigations,0);assert.deepEqual(f.focus,[true,false]);
});

test('bounded forward scrolling loads enough main-list products without counting duplicate links',async t=>{
  const f=await searchFixture(t,{initial:8});
  f.onScroll=()=>f.load(Math.min(35,f.loaded+12));
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'ready');assert.deepEqual(result.products,f.products.slice(0,30));
  // Browser scroll anchoring can produce another load from a single explicit scroll.
  assert.ok(result.searchSummary.scrolls>=1&&result.searchSummary.scrolls<=12);
  assert.equal(result.searchSummary.scrolls,f.stats().scrollCalls);
  assert.equal(f.stats().navigations,0);assert.deepEqual(f.requests,[searchUrl(f.keyword)]);assert.deepEqual(f.focus,[true,false]);
});

test('a stalled short list pauses with its actual count instead of completing below thirty',async t=>{
  const f=await searchFixture(t,{initial:8});
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'paused');assert.equal(result.searchSummary.found,8);assert.equal(result.searchSummary.requested,30);
  assert.equal(result.products.length,8);assert.match(result.message,/8 件.*30 件/);assert.ok(result.searchSummary.scrolls>0&&result.searchSummary.scrolls<=12);
  assert.deepEqual(f.focus,[true,false]);
});

test('replacement search excludes all processed IDs and loads the next products in main-list order',async t=>{
  const f=await searchFixture(t,{initial:8});f.onScroll=()=>f.load(20);
  const result=await f.adapter.search({...f.args,limit:3,excludeGoodsIds:f.products.slice(0,8).map(p=>productIdentity(p.sourceUrl)),allowPartial:true});
  assert.equal(result.status,'ready');assert.deepEqual(result.products,f.products.slice(8,11));assert.ok(f.stats().scrollCalls>0);assert.equal(f.stats().navigations,0);
  const tail=await f.adapter.search({...f.args,limit:3,excludeGoodsIds:f.products.slice(0,19).map(p=>productIdentity(p.sourceUrl)),allowPartial:true});
  assert.equal(tail.status,'ready');assert.deepEqual(tail.products,[f.products[19]]);
  const empty=await f.adapter.search({...f.args,limit:2,excludeGoodsIds:f.products.slice(0,20).map(p=>productIdentity(p.sourceUrl)),allowPartial:true});
  assert.equal(empty.status,'paused');assert.deepEqual(empty.products,[]);assert.match(empty.message,/仍需补充 2 件/);
});

test('a verification appearing during loading uses the existing solver and resumes the same search list',async t=>{
  let calls=0,f;
  f=await searchFixture(t,{initial:8,captchaSolver:{solve:async()=>{
    calls++;assert.equal(await f.page.locator('#verification').count(),1);
    await f.page.locator('#verification').evaluate(element=>element.remove());await f.load(35);return {status:'solved'};
  }}});
  f.onScroll=async()=>{f.onScroll=null;await f.page.evaluate(()=>{const challenge=document.createElement('div');challenge.id='verification';challenge.textContent='请拖动滑块完成验证';document.body.append(challenge);});};
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'ready');assert.equal(calls,1);assert.deepEqual(result.products,f.products.slice(0,30));
  assert.equal(f.stats().navigations,0);assert.deepEqual(f.focus,[true,false]);
});

test('changing the keyword while scrolling pauses without navigating back or accepting a different search',async t=>{
  let solveCalls=0;
  const f=await searchFixture(t,{initial:8,captchaSolver:{solve:async()=>{solveCalls++;throw new Error('must not solve a different search');}}});
  f.onScroll=async()=>{f.onScroll=null;await f.page.evaluate(()=>{history.replaceState({},'', '/search_result.html?search_key=different');const challenge=document.createElement('div');challenge.id='verification';challenge.textContent='请完成验证';document.body.append(challenge);});};
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'paused');assert.match(result.message,/关键词.*变化/);
  assert.equal(f.stats().navigations,0);assert.equal(f.stats().scrollCalls,1);assert.equal(solveCalls,0);assert.deepEqual(f.focus,[true,false]);
});

test('stopping during a loading wait prevents further scrolling and releases focus emulation',async t=>{
  const f=await searchFixture(t,{initial:8});let stopped=false;
  f.args.isStopped=()=>stopped;f.onScroll=()=>{stopped=true;};
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'paused');assert.match(result.message,/暂停/);assert.equal(f.stats().scrollCalls,1);assert.deepEqual(f.focus,[true,false]);
});

test('an unrecognized main list does not substitute sidebar recommendations to reach the target',async t=>{
  const f=await searchFixture(t,{initial:35,scope:false});
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'paused');assert.match(result.message,/主搜索结果列表/);assert.deepEqual(result.products,[]);
  assert.equal(f.stats().scrollCalls,0);assert.deepEqual(f.focus,[true,false]);
});


test('the observed load-more control expands twenty results to the first thirty',async t=>{
  const f=await searchFixture(t,{initial:20});let clicks=0;
  await f.page.exposeFunction('fixtureLoadMore',async()=>{clicks++;await f.load(35);});
  await f.page.evaluate(()=>{
    const button=document.createElement('div');button.setAttribute('role','button');button.textContent='查看更多';button.style.cssText='width:200px;height:50px;background:#ddd;cursor:pointer';
    button.onclick=()=>window.fixtureLoadMore();document.querySelector('.js-search-goodsList').append(button);
  });
  const result=await f.adapter.search(f.args);
  assert.equal(result.status,'ready');assert.deepEqual(result.products,f.products.slice(0,30));assert.equal(clicks,1);
  assert.equal(f.stats().navigations,0);assert.deepEqual(f.focus,[true,false]);
});


test('collection status is read only from the plugin panel and excludes page recommendations',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
  await page.setContent('<p>推荐商品采集成功</p><div style="position:fixed;right:10px;top:10px">采集到店小秘<button>开始采集</button></div>');
  assert.equal((await page.evaluate(readTemuPage)).pluginStatus,null);
  await page.evaluate(()=>document.querySelector('button').textContent='采集成功');
  assert.equal((await page.evaluate(readTemuPage)).pluginStatus,'success');
});

test('duplicate receipt detection excludes product text, hidden notices and ambiguous dialogs',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
  const text='该产品在店小秘已有采集记录，是否继续采集？';
  for(const markup of [`<p>${text}</p>`,`<div role="dialog" hidden>${text}</div>`,`<div role="dialog">${text}</div><div role="dialog">${text}</div>`]){
    await page.setContent(markup);assert.equal((await page.evaluate(readTemuPage)).pluginReceipts.some(item=>item.status==='duplicate'),false);
  }
  await page.setContent(`<div role="dialog"><p>${text}</p><button>取消</button><button>继续采集</button></div>`);
  const result=await page.evaluate(readTemuPage);assert.equal(result.pluginStatus,'duplicate');assert.equal(result.pluginReceipts.filter(item=>item.status==='duplicate').length,1);
});

test('repeat-collection controls are duplicate receipts only inside one visible DXM panel',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
  const panel=content=>`<div style="position:fixed;bottom:10px;left:10px">采集到店小秘${content}</div>`;
  for(const markup of ['<button>重复采集</button>',panel('<button hidden>重复采集</button><button>开始采集</button>'),panel('<button>重复采集</button>')+panel('<button>重复采集</button>')]){
    await page.setContent(markup);assert.ok(!(await page.evaluate(readTemuPage)).pluginReceipts.some(item=>item.status==='duplicate'));
  }
  for(const control of ['<button>重复采集</button>','<a href="#">重复采集</a>','<div role="button">重复采集</div>']){
    await page.setContent(panel(control));const result=await page.evaluate(readTemuPage);
    assert.equal(result.pluginStatus,'duplicate');assert.equal(result.pluginReceipts[0].kind,'repeat-action');assert.equal(result.button,null);
  }
});

for(const alreadyCollected of [true,false])test(`repeat button ${alreadyCollected?'before':'after'} collection does not cause a duplicate click or lose a new success`,async t=>{
  const context=await browser.newContext();t.after(()=>context.close());const sourceUrl='https://www.temu.com/fixture-g-601103145485534.html';
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>Fixture product</h1><div id="goodsDetail">Details</div><div style="position:fixed;bottom:20px;left:20px">采集到店小秘<button>${alreadyCollected?'重复采集':'开始采集'}</button></div>`}));
  const page=await context.newPage();await page.goto(sourceUrl);const cdp=await context.newCDPSession(page);let intents=0;
  await page.evaluate(()=>{window.clicks=0;document.querySelector('button').onclick=()=>{window.clicks++;document.querySelector('button').textContent='重复采集';document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;top:20px;left:20px">采集成功，可继续采集产品或者<a href="https://www.dianxiaomi.com/web/productCrawl/dataAcquisition">前往采集箱</a></div>');};});
  const transport={connection:async()=>({ws:'fixture',targets:async()=>[{id:'product',type:'page',url:sourceUrl}]}),connect:async()=>({send:async()=>{throw new Error('unexpected target command');},close(){}}),pageById:async()=>({evaluate:(...args)=>page.evaluate(...args),send:(...args)=>cdp.send(...args),close(){}}),poll:async fn=>{const value=await fn();if(!value)throw new Error('missing fixture state');return value;}};
  const result=await createTemuFrontBrowser({},transport).collect({tabs:{product:'product'},sourceUrl,goodsId:productIdentity(sourceUrl),beforeSubmit:()=>intents++});
  assert.equal(result.status,alreadyCollected?'skipped-duplicate':'submitted');assert.equal(result.pluginStatus,alreadyCollected?'duplicate':'success');
  assert.equal(intents,alreadyCollected?0:1);assert.equal(await page.evaluate(()=>window.clicks),alreadyCollected?0:1);
});

for(const native of [false,true])test(`${native?'native':'DOM'} duplicate confirmation skips without accepting another collection`,async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const sourceUrl='https://www.temu.com/fixture-g-601103145485534.html',text='该产品在店小秘已有采集记录，是否继续采集？';
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Fixture product</h1><div id="goodsDetail">Details</div><div id="dxm" style="position:fixed;right:20px;top:20px">采集到店小秘<button>开始采集</button></div>'}));
  const page=await context.newPage();page.on('dialog',()=>{});await page.goto(sourceUrl);const cdp=await context.newCDPSession(page);
  await page.evaluate(({native,text})=>{window.clicks=0;window.accepted=false;document.querySelector('button').onclick=()=>{window.clicks++;if(native)window.accepted=confirm(text);else document.body.insertAdjacentHTML('beforeend',`<div role="dialog">${text}<button onclick="window.accepted=true">继续采集</button><button>取消</button></div>`);};},{native,text});
  const commands=[];let intents=0;
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[{id:'product',type:'page',url:sourceUrl}]}),
    connect:async()=>({send:async()=>{throw new Error('must reuse task product');},close(){}}),
    pageById:async()=>({evaluate:(...args)=>page.evaluate(...args),send:(method,args)=>{commands.push({method,args});return cdp.send(method,args);},on:(method,handler)=>{cdp.on(method,handler);return ()=>cdp.off(method,handler);},close(){}}),
    poll:async fn=>{const until=Date.now()+1000;do{const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<until);throw new Error('duplicate fixture timed out');}
  };
  const adapter=createTemuFrontBrowser({},transport),result=await adapter.collect({tabs:{product:'product'},sourceUrl,goodsId:'601103145485534',beforeSubmit:()=>intents++});
  assert.equal(result.status,'skipped-duplicate');assert.equal(result.receipt.status,'duplicate');assert.equal(result.receipt.targetId,'product');
  assert.equal(intents,1);assert.deepEqual(await page.evaluate(()=>({clicks:window.clicks,accepted:window.accepted})),{clicks:1,accepted:false});
  assert.equal(commands.filter(item=>item.method==='Page.handleJavaScriptDialog').length,native?1:0);
  assert.ok(!commands.some(item=>item.method==='Page.handleJavaScriptDialog'&&item.args.accept));
  assert.equal(cdp.listenerCount('Page.javascriptDialogOpening'),0);
});

const collectionToast=(href='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition',style='position:fixed;left:200px;top:12px;background:#e7f8ec')=>`<div data-fixture="toast" style="${style}"><span>采集成功，可继续采集产品或者 <a href="${href}">前往采集箱</a>（已启用采集设置）</span></div>`;

test('the visible top receipt requires the full recorded copy and the bound collection destination',async t=>{
  const context=await browser.newContext({viewport:{width:1000,height:700}});t.after(()=>context.close());
  await context.route('**/*',route=>route.abort());const page=await context.newPage();
  await page.setContent(collectionToast());
  const accepted=await page.evaluate(readTemuPage);
  assert.equal(accepted.pluginStatus,'success');assert.equal(accepted.pluginReceipts.length,1);assert.equal(accepted.pluginReceipts[0].kind,'toast');
  assert.match(accepted.pluginReceipts[0].text,/前往采集箱（已启用采集设置）$/);
  await page.setContent(collectionToast().replace('（已启用采集设置）','(已启用采集设置)'));
  assert.equal((await page.evaluate(readTemuPage)).pluginStatus,'success');
  for(const markup of [
    collectionToast(undefined,'position:static'),
    collectionToast('https://www.dianxiaomi.com.evil.example/web/productCrawl/dataAcquisition'),
    collectionToast('http://www.dianxiaomi.com/web/productCrawl/dataAcquisition'),
    collectionToast('https://www.dianxiaomi.com/other'),
    collectionToast(undefined,'position:fixed;top:12px;opacity:0'),
    collectionToast(undefined,'position:fixed;top:500px'),
    `<div aria-hidden="true">${collectionToast()}</div>`,
    collectionToast().replace('采集成功，可继续采集产品或者','推荐商品采集成功')
  ]){
    await page.setContent(markup);const rejected=await page.evaluate(readTemuPage);
    assert.equal(rejected.pluginStatus,null,markup);assert.deepEqual(rejected.pluginReceipts,[],markup);
  }
});

for(const scenario of ['new-toast','stale-toast','replaced-toast','toast-and-panel','failed-panel','conflicting-panel'])test(`post-click receipt is bound to the current submission (${scenario})`,async t=>{
  const context=await browser.newContext({viewport:{width:1000,height:700}});t.after(()=>context.close());
  const sourceUrl='https://www.temu.com/fixture-g-601103145485534.html';
  const initiallyVisible=['stale-toast','replaced-toast'].includes(scenario);
  const body=`<h1>Fixture product</h1><div id="goodsDetail">Product details</div>${initiallyVisible?collectionToast():''}<div style="position:fixed;right:20px;bottom:20px"><span>采集到店小秘</span><button>开始采集</button><span id="panel-result"></span></div>`;
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));
  const page=await context.newPage();await page.goto(sourceUrl);const cdp=await context.newCDPSession(page);
  await page.evaluate(({scenario,toast})=>{
    window.collectionClicks=0;document.querySelector('button').onclick=()=>{
      window.collectionClicks++;
      if(scenario==='stale-toast')return;
      setTimeout(()=>{
        if(scenario==='failed-panel'){document.querySelector('#panel-result').textContent='采集失败';return;}
        if(scenario==='replaced-toast')document.querySelector('[data-fixture="toast"]').remove();
        document.body.insertAdjacentHTML('beforeend',toast);
        if(scenario==='toast-and-panel')document.querySelector('#panel-result').textContent='采集成功';
        if(scenario==='conflicting-panel')document.querySelector('#panel-result').textContent='采集失败';
      },30);
    };
  },{scenario,toast:collectionToast()});
  let intents=0;const focus=[];
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[{id:'product',type:'page',url:page.url()}]}),
    connect:async()=>({send:async()=>{throw new Error('no other browser target may be changed');},close(){}}),
    pageById:async()=>({evaluate:(...args)=>page.evaluate(...args),send:(method,args)=>{if(method==='Emulation.setFocusEmulationEnabled')focus.push(args.enabled);return cdp.send(method,args);},close(){}}),
    poll:async fn=>{const deadline=Date.now()+250;while(true){const result=await fn();if(result)return result;if(Date.now()>=deadline)throw Object.assign(new Error('fixture receipt deadline'),{code:'ERP_WAIT_TIMEOUT'});await new Promise(resolve=>setTimeout(resolve,10));}}
  };
  const adapter=createTemuFrontBrowser({},transport,{captchaSolver:{solve:async()=>{throw new Error('receipt fixtures must not solve CAPTCHA');}}});
  const result=await adapter.collect({tabs:{product:'product'},sourceUrl,goodsId:'601103145485534',beforeSubmit:()=>{intents++;}});
  assert.equal(intents,1);assert.equal(await page.evaluate(()=>window.collectionClicks),1);assert.deepEqual(focus,[true,false]);
  if(scenario==='stale-toast'){
    assert.equal(result.status,'needs-review');assert.equal(result.receipt,undefined);assert.match(result.message,/原提交记录已保留.*未重复点击/);
  }else if(['failed-panel','conflicting-panel'].includes(scenario)){
    assert.equal(result.status,'needs-review');assert.equal(result.pluginStatus,'failed');assert.match(result.message,/采集失败/);assert.equal(result.receipt,undefined);
  }else{
    assert.equal(result.status,'submitted');assert.equal(result.pluginStatus,'success');assert.equal(result.receipt.kind,'toast');
    assert.equal(result.receipt.sourceUrl,sourceUrl);assert.ok(Number.isFinite(Date.parse(result.receipt.observedAt)));
    assert.equal(result.message,result.receipt.text);assert.match(result.message,/采集成功，可继续采集产品或者 前往采集箱/);
  }
});

for(const completes of [false,true])test(completes?'post-click receipt waits for genuine asynchronous plugin success without a second click':'post-click pending timeout reports needs-review and preserves the single submission intent',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const sourceUrl='https://www.temu.com/fixture-g-601103145485534.html';
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>Fixture product</h1><div id="goodsDetail">Fixture details</div><div style="position:fixed;right:20px;top:20px"><span>采集到店小秘</span><button onclick="window.clicks++;this.textContent='采集中...';${completes?"setTimeout(()=>this.textContent='采集成功',60)":""}">开始采集</button></div><script>window.clicks=0;</script>`}));
  const page=await context.newPage();await page.goto(sourceUrl);const cdp=await context.newCDPSession(page);
  const focus=[],waits=[];let intents=0;
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[{id:'product',type:'page',url:sourceUrl}]}),
    connect:async()=>({send:async()=>{throw new Error('must reuse the task product');},close(){}}),
    pageById:async()=>({evaluate:(...args)=>page.evaluate(...args),send:(method,args)=>{if(method==='Emulation.setFocusEmulationEnabled')focus.push(args.enabled);return cdp.send(method,args);},close(){}}),
    poll:async(fn,options)=>{
      waits.push(options);const deadline=Date.now()+300;
      while(true){const value=await fn();if(value)return value;if(Date.now()>=deadline)throw Object.assign(new Error('fixture pending deadline'),{code:'ERP_WAIT_TIMEOUT'});await new Promise(resolve=>setTimeout(resolve,10));}
    }
  };
  const adapter=createTemuFrontBrowser({},transport,{captchaSolver:{solve:async()=>{throw new Error('no fixture captcha');}}});
  const result=await adapter.collect({browserConfig:{type:'chrome'},tabs:{product:'product'},sourceUrl,goodsId:'601103145485534',beforeSubmit:()=>{intents++;}});
  assert.equal(result.status,completes?'submitted':'needs-review');assert.equal(result.pluginStatus,completes?'success':'pending');
  if(!completes)assert.match(result.message,/90 秒.*采集中.*原提交记录已保留.*未重复点击/);
  assert.equal(intents,1);assert.equal(await page.evaluate(()=>window.clicks),1);assert.deepEqual(focus,[true,false]);
  assert.equal(waits.find(wait=>wait.label==='店小秘插件采集完成').timeout,90000);
});

test('an unavailable product is never submitted or solved and its task tab can collect the next product',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const goodsId='607510454995514',nextId='601103145485535';
  const sourceUrl=`https://www.temu.com/fixture-g-${goodsId}.html?source=search`,nextUrl=`https://www.temu.com/fixture-g-${nextId}.html?source=search`;
  const requests=[],focus=[],navigations=[],mouse=[];let intents=0,solves=0;
  await context.route('**/*',route=>{
    requests.push(route.request().url());
    const body=route.request().url()===sourceUrl?'<title>Original canvas wall art title</title><nav>首页 / 家居厨房用品 / 墙面装饰</nav><div><span>此商品已售罄。</span></div><button>查看类似商品</button><h2>相似商品</h2>':`<h1>Next product</h1><div id="goodsDetail">Product details</div><div style="position:fixed;right:20px;top:20px"><span>采集到店小秘</span><button onclick="window.clicks++;this.textContent='采集成功'">开始采集</button></div><script>window.clicks=0;</script>`;
    return route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  const page=await context.newPage();await page.goto(sourceUrl);const cdp=await context.newCDPSession(page);
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[{id:'product',type:'page',url:page.url()}]}),
    connect:async()=>({send:async()=>{throw new Error('must reuse the existing product task tab');},close(){}}),
    pageById:async()=>({evaluate:(...args)=>page.evaluate(...args),send:(method,args)=>{
      if(method==='Page.navigate')navigations.push(args.url);
      if(method==='Input.dispatchMouseEvent')mouse.push(args.type);
      if(method==='Emulation.setFocusEmulationEnabled')focus.push(args.enabled);
      return cdp.send(method,args);
    },close(){}}),
    poll:async(fn)=>{
      const deadline=Date.now()+1000;
      while(true){const value=await fn();if(value)return value;if(Date.now()>=deadline)throw Object.assign(new Error('fixture deadline'),{code:'ERP_WAIT_TIMEOUT'});await new Promise(resolve=>setTimeout(resolve,10));}
    }
  };
  const adapter=createTemuFrontBrowser({},transport,{captchaSolver:{solve:async()=>{solves++;throw new Error('sold-out products do not require CAPTCHA solving');}}});
  const args={browserConfig:{type:'chrome'},tabs:{product:'product'},sourceUrl,goodsId,beforeSubmit:()=>{intents++;}};
  const unavailable=await adapter.collect(args);
  assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.url,sourceUrl);assert.match(unavailable.message,/此商品已售罄。.*未显示商品标题或详情.*未点击采集/);
  assert.deepEqual(unavailable.evidence,{kind:'temu-sold-out',goodsId,text:'此商品已售罄。',titlePresent:false,detailsPresent:false});
  assert.equal(await page.title(),'Original canvas wall art title');assert.equal(page.url(),sourceUrl);
  assert.equal(intents,0);assert.equal(solves,0);assert.deepEqual(mouse,[]);assert.deepEqual(navigations,[]);assert.deepEqual(focus,[true,false]);
  const next=await adapter.collect({...args,sourceUrl:nextUrl,goodsId:nextId});
  assert.equal(next.status,'submitted');assert.equal(next.pluginStatus,'success');assert.equal(page.url(),nextUrl);
  assert.equal(intents,1);assert.equal(solves,0);assert.equal(await page.evaluate(()=>window.clicks),1);
  assert.deepEqual(mouse,['mousePressed','mouseReleased']);assert.deepEqual(navigations,[nextUrl]);assert.deepEqual(requests,[sourceUrl,nextUrl]);assert.deepEqual(focus,[true,false,true,false]);
});

test('sold-out detection requires one visible exact leaf on a product URL without product content',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<body></body>'}));
  const page=await context.newPage();await page.goto('https://www.temu.com/fixture-g-607510454995514.html');
  const variants=[
    '<h1>Available product</h1><div id="goodsDetail">Details</div><aside><span>此商品已售罄。</span></aside>',
    '<div id="goodsDetail"></div><span>此商品已售罄。</span>',
    '<div style="opacity:0"><span>此商品已售罄。</span></div>',
    '<div aria-hidden="true"><span>此商品已售罄。</span></div>',
    '<div style="visibility:hidden"><span>此商品已售罄。</span></div>',
    '<p>此商品已售罄。</p><span>此商品已售罄。</span>',
    '<p>推荐商品已售罄</p><span>此商品已售罄</span>'
  ];
  for(const body of variants){await page.setContent(body);assert.notEqual((await page.evaluate(readTemuPage)).status,'unavailable',body);}
  await page.goto(searchUrl('canvas wall art'));await page.setContent('<p>此商品已售罄。</p>');
  assert.notEqual((await page.evaluate(readTemuPage)).status,'unavailable');
});

async function nativeProductFixture(t,{oldReady=false,missingSearch=false,matching=true,hoverOverlay=false,wrongDestination=false,productReadyState,products=1,closeFailure=false,ignoreClose=false}={}){
  const context=await browser.newContext({viewport:{width:1000,height:700}});t.after(()=>context.close());
  const keyword='canvas wall art',goodsId='606233155182750',otherId='606233155182751';
  const sourceUrl=`https://www.temu.com/fixture-g-${goodsId}.html?frozen=original`;
  const observedUrl=`https://www.temu.com/fixture-g-${goodsId}.html?source=main&campaign=fixture%2Bnative`;
  const otherUrl=`https://www.temu.com/fixture-g-${otherId}.html?source=main`;
  const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>');
  const records=new Map(),requests=[],events=[],navigations=[],created=[],inputs=[],bindings=[],closures=[];let sequence=0,intents=0,solves=0,stop=false;
  const register=page=>{
    for(const entry of records.values())if(entry.page===page)return entry;
    const record={id:String(++sequence),page,session:context.newCDPSession(page)};records.set(record.id,record);return record;
  };
  context.on('page',register);
  const productBody='<h1>Canvas wall art</h1><div id="goodsDetail">Native product details</div><div style="position:fixed;right:20px;top:20px"><span>采集到店小秘</span><button onclick="window.collectionClicks++;this.textContent=\'采集成功\'">开始采集</button></div><script>window.collectionClicks=0;</script>'+(productReadyState?`<script>Object.defineProperty(document,'readyState',{configurable:true,get:()=>${JSON.stringify(productReadyState)}});</script>`:'');
  await context.route('**/*',route=>{
    const request=route.request(),url=request.url(),referer=request.headers().referer||'';requests.push({url,referer});
    if(new URL(url).pathname==='/search_result.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:`
      <aside><a href="${observedUrl}&sidebar=1">同商品侧边推荐</a></aside>
      ${searchMarkup(Array.from({length:products},(_,index)=>{const url=index?`https://www.temu.com/fixture-g-${BigInt(goodsId)+BigInt(index)}.html?source=main`:matching?observedUrl:otherUrl;return `<article style="margin-top:250px"><a href="${url}" style="display:inline-block;width:150px"><img src="${image}" width="100" height="100" alt="Canvas"></a><a href="${url}&duplicate=title">商品标题</a></article>`;}).join(''))}
      <script>window.nativeClicks=[];document.addEventListener('click',event=>window.nativeClicks.push({trusted:event.isTrusted,ctrl:event.ctrlKey,tag:event.target.tagName}));
      for(const link of document.querySelectorAll('.js-search-goodsList a'))link.addEventListener('click',event=>{event.preventDefault();window.open(link.href,'_blank');});
      ${hoverOverlay?"document.querySelector('img').addEventListener('mouseenter',event=>{const r=event.target.getBoundingClientRect(),button=document.createElement('button');button.textContent='开始采集';button.style.cssText='position:fixed;left:'+r.x+'px;top:'+r.y+'px;width:'+r.width+'px;height:'+r.height+'px;z-index:9999';document.body.append(button);});":''}</script>`});
    if(wrongDestination&&url===observedUrl)return route.fulfill({status:302,headers:{location:otherUrl},body:''});
    const ready=referer===searchUrl(keyword)||oldReady&&url===sourceUrl;
    return route.fulfill({contentType:'text/html; charset=utf-8',body:ready?productBody:'<title>Original title</title><p>此商品已售罄。</p>'});
  });
  const old=await context.newPage();await old.goto(sourceUrl);const oldId=register(old).id;
  let search;
  if(!missingSearch){search=await context.newPage();await search.goto(searchUrl(keyword));}
  const tabs={product:oldId,search:search?register(search).id:'closed-search'};
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>{for(const page of context.pages())register(page);return [...records.values()].filter(record=>!record.page.isClosed()).map(record=>({id:record.id,type:'page',url:record.page.url()}));}}),
    connect:async()=>({send:async(method,args)=>{
      if(method==='Target.createTarget'){assert.equal(args.url,'about:blank');created.push(args.url);const page=await context.newPage();return {targetId:register(page).id};}
      if(method==='Target.activateTarget'){events.push('activate:'+args.targetId);await records.get(args.targetId).page.bringToFront();return {};}
      if(method==='Target.closeTarget'){events.push('close:'+args.targetId);if(closeFailure)return {success:false};if(!ignoreClose)await records.get(args.targetId).page.close();return {success:true};}
      throw new Error('Unexpected browser method '+method);
    },close(){}}),
    pageById:async(info,id)=>{
      const record=records.get(id),cdp=await record.session;
      return {evaluate:(...args)=>{
        if(args[0].toString().includes('readyState:document.readyState')&&record.page.url()===observedUrl)assert.equal(events.at(-1),'activate:'+id,'a new product tab must be foregrounded before its document readiness is checked');
        return record.page.evaluate(...args);
      },send:async(method,args)=>{
        if(method==='Page.navigate'){navigations.push(args.url);assert.equal(new URL(args.url).pathname,'/search_result.html','native collection must never Page.navigate to a product');}
        if(method==='Input.dispatchMouseEvent'){
          if(args.type==='mousePressed'&&args.modifiers===2)assert.equal(events.at(-1),'activate:'+id,'the search tab must be visible before its native card click');
          inputs.push({target:id,...args});
        }
        return cdp.send(method,args);
      },close(){}};
    },
    poll:async(fn,{timeout}={})=>{
      const deadline=Date.now()+Math.min(timeout||1000,1000);
      while(true){const value=await fn();if(value)return value;if(Date.now()>=deadline)throw Object.assign(new Error('fixture deadline'),{code:'ERP_WAIT_TIMEOUT'});await new Promise(resolve=>setTimeout(resolve,10));}
    }
  };
  const adapter=createTemuFrontBrowser({},transport,{captchaSolver:{solve:async()=>{solves++;throw new Error('no fixture challenge');}}});
  const ownedTabs={};
  const args={browserConfig:{type:'chrome'},tabs,ownedTabs,keyword,limit:1,goodsId,sourceUrl,isStopped:()=>stop,onTarget:(kind,id,metadata)=>{bindings.push({kind,id});tabs[kind]=id;if(metadata?.owned)ownedTabs[id]={kind,...metadata};},onTargetClosed:(kind,id)=>{closures.push({kind,id});if(tabs[kind]===id)delete tabs[kind];delete ownedTabs[id];},beforeSubmit:()=>{events.push('intent');intents++;}};
  return {adapter,args,old,oldId,records,requests,events,navigations,created,inputs,bindings,closures,observedUrl,sourceUrl,stats:()=>({intents,solves}),stop:()=>{stop=true;}};
}

for(const scenario of ['unavailable','force-ready','closed-search','interactive'])test(`native search entry opens the observed image link without raw product navigation (${scenario})`,async t=>{
  const f=await nativeProductFixture(t,{oldReady:scenario==='force-ready',missingSearch:scenario==='closed-search',productReadyState:scenario==='interactive'?'interactive':undefined});
  if(scenario==='force-ready')f.args.forceSearch=true;
  const result=await f.adapter.collect(f.args);
  assert.equal(result.status,'submitted',JSON.stringify({result,requests:f.requests,events:f.events,pages:[...f.records.values()].map(record=>({id:record.id,url:record.page.url()}))}));assert.equal(result.pluginStatus,'success');assert.deepEqual(f.stats(),{intents:1,solves:0});
  assert.notEqual(f.args.tabs.product,f.oldId);assert.equal(f.records.get(f.args.tabs.product).page.url(),f.observedUrl);
  assert.equal(f.old.url(),f.sourceUrl);assert.equal(await f.old.evaluate(()=>window.collectionClicks||0),0);
  const search=f.records.get(f.args.tabs.search).page;
  assert.deepEqual(await search.evaluate(()=>window.nativeClicks),[{trusted:true,ctrl:true,tag:'IMG'}]);
  assert.deepEqual(f.events,['activate:'+f.args.tabs.search,'activate:'+f.args.tabs.product,'activate:'+f.args.tabs.product,'intent']);
  assert.deepEqual(f.requests.filter(request=>request.url===f.observedUrl),[{url:f.observedUrl,referer:searchUrl(f.args.keyword)}]);
  assert.deepEqual(f.navigations,scenario==='closed-search'?[searchUrl(f.args.keyword)]:[]);
  assert.deepEqual(f.created,scenario==='closed-search'?['about:blank']:[]);
  const searchPresses=f.inputs.filter(input=>input.target===f.args.tabs.search&&input.type==='mousePressed');assert.equal(searchPresses.length,1);assert.equal(searchPresses[0].modifiers,2);
  assert.equal(f.bindings.filter(binding=>binding.kind==='product').length,1);
  if(scenario==='interactive')assert.equal(await f.records.get(f.args.tabs.product).page.evaluate(()=>document.readyState),'interactive');
});

test('a verified new product target is retained across loading timeout and resumed without another native opening',async t=>{
  const f=await nativeProductFixture(t,{productReadyState:'loading'});
  const result=await f.adapter.collect(f.args);
  assert.equal(result.status,'paused');assert.match(result.message,/已打开并保留对应商品页.*仍在加载/);
  assert.notEqual(f.args.tabs.product,f.oldId);assert.equal(f.bindings.filter(binding=>binding.kind==='product').length,1);
  assert.equal(f.inputs.filter(input=>input.modifiers===2&&input.type==='mousePressed').length,1);assert.equal(f.stats().intents,0);
  const retained=f.args.tabs.product;
  // The same tab remains bound even before its load event; the existing content/action checks take over.
  const resumed=await f.adapter.collect(f.args);
  assert.equal(resumed.status,'submitted');assert.equal(f.args.tabs.product,retained);
  assert.equal(f.inputs.filter(input=>input.modifiers===2&&input.type==='mousePressed').length,1);assert.equal(f.stats().intents,1);
  assert.equal(f.bindings.filter(binding=>binding.kind==='product').length,1);
});

test('a matching ready product is reused and only its task target is activated',async t=>{
  const f=await nativeProductFixture(t,{oldReady:true});
  const result=await f.adapter.collect(f.args);
  assert.equal(result.status,'submitted');assert.equal(f.args.tabs.product,f.oldId);assert.deepEqual(f.events,['activate:'+f.oldId,'intent']);
  assert.deepEqual(f.bindings,[]);assert.deepEqual(f.navigations,[]);assert.equal(f.inputs.filter(input=>input.modifiers===2).length,0);
});

for(const scenario of ['missing-main-link','hover-overlay','wrong-destination'])test(`native entry pauses before submission when ${scenario}`,async t=>{
  const f=await nativeProductFixture(t,{matching:scenario!=='missing-main-link',hoverOverlay:scenario==='hover-overlay',wrongDestination:scenario==='wrong-destination'});
  const result=await f.adapter.collect(f.args);
  assert.equal(result.status,'paused');assert.deepEqual(f.stats(),{intents:0,solves:0});assert.deepEqual(f.navigations,[]);assert.deepEqual(f.events,['activate:'+f.args.tabs.search]);assert.deepEqual(f.bindings,[]);
  assert.equal(f.args.tabs.product,f.oldId);
  const presses=f.inputs.filter(input=>input.type==='mousePressed');assert.equal(presses.length,scenario==='wrong-destination'?1:0);
});

test('returnToSearch activates only the bound search after a receipt without changing pages or the manifest',async t=>{
  const f=await nativeProductFixture(t);
  const result=await f.adapter.collect(f.args);assert.equal(result.status,'submitted');
  const unrelated=await f.old.context().newPage(),beforeTabs={...f.args.tabs},beforeInputs=f.inputs.length,beforeBindings=f.bindings.length;
  const urls=[...f.records.values()].map(record=>[record.id,record.page.url()]);
  const returned=await f.adapter.returnToSearch(f.args);
  assert.equal(returned.status,'ready');assert.equal(returned.url,searchUrl(f.args.keyword));
  assert.equal(f.events.at(-1),'activate:'+f.args.tabs.search);assert.equal(f.inputs.length,beforeInputs);assert.equal(f.bindings.length,beforeBindings);
  assert.deepEqual(f.args.tabs,beforeTabs);assert.deepEqual(f.navigations,[]);assert.deepEqual(f.created,[]);
  assert.deepEqual([...f.records.values()].map(record=>[record.id,record.page.url()]),urls);
  assert.equal(unrelated.isClosed(),false);assert.equal(f.old.isClosed(),false);assert.deepEqual(f.stats(),{intents:1,solves:0});
});

for(const scenario of ['changed-keyword','changed-product','closed-search','wrong-request-id','stopped'])test(`returnToSearch preserves all tabs when ${scenario}`,async t=>{
  const f=await nativeProductFixture(t,{oldReady:true});
  const search=f.records.get(f.args.tabs.search).page;
  if(scenario==='changed-keyword')await search.evaluate(()=>history.replaceState({},'','/search_result.html?search_key=different'));
  if(scenario==='changed-product')await f.old.evaluate(()=>history.replaceState({},'','/fixture-g-606233155182751.html'));
  if(scenario==='closed-search')await search.close();
  if(scenario==='wrong-request-id')f.args.goodsId='606233155182751';
  if(scenario==='stopped')f.stop();
  const beforeTabs={...f.args.tabs},beforeUrl=f.old.url();
  const result=await f.adapter.returnToSearch(f.args);
  assert.equal(result.status,'paused');assert.deepEqual(f.events,[]);assert.deepEqual(f.navigations,[]);assert.deepEqual(f.created,[]);assert.deepEqual(f.inputs,[]);
  assert.deepEqual(f.args.tabs,beforeTabs);assert.equal(f.old.url(),beforeUrl);assert.equal(f.old.isClosed(),false);assert.deepEqual(f.stats(),{intents:0,solves:0});
});

test('a saved successful receipt retires only its owned product tab after returning to the search',async t=>{
  const f=await nativeProductFixture(t),result=await f.adapter.collect(f.args);
  assert.equal(result.status,'submitted');
  const productId=f.args.tabs.product,product=f.records.get(productId).page,unrelated=await f.old.context().newPage();
  const returned=await f.adapter.returnToSearch({...f.args,closeProduct:true,pluginReceipt:{...result.receipt,status:'success'}});
  assert.equal(returned.status,'ready');assert.equal(returned.closedTargetId,productId);
  assert.equal(product.isClosed(),true);assert.equal(f.old.isClosed(),false);assert.equal(unrelated.isClosed(),false);
  assert.equal(f.records.get(f.args.tabs.search).page.isClosed(),false);
  assert.deepEqual(f.events.slice(-2),['activate:'+f.args.tabs.search,'close:'+productId]);
  assert.deepEqual(f.closures,[{kind:'product',id:productId}]);assert.equal(f.args.tabs.product,undefined);assert.equal(f.args.ownedTabs[productId],undefined);
});

test('a saved duplicate receipt retires only its owned product tab without confirming the duplicate dialog',async t=>{
  const f=await nativeProductFixture(t),result=await f.adapter.collect(f.args),productId=f.args.tabs.product,product=f.records.get(productId).page;
  await product.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div role="dialog">该产品在店小秘已有采集记录，是否继续采集？<button onclick="window.duplicateAccepted=true">继续采集</button></div>'));
  const returned=await f.adapter.returnToSearch({...f.args,closeProduct:true,pluginReceipt:{...result.receipt,status:'duplicate'}});
  assert.equal(returned.status,'ready');assert.equal(product.isClosed(),true);assert.equal(f.old.isClosed(),false);assert.equal(f.args.tabs.product,undefined);
});

for(const scenario of ['missing-receipt','wrong-receipt-product','wrong-receipt-tab','failed-receipt','invalid-receipt-time','product-challenge','search-challenge','plugin-pending','plugin-failed','changed-product','changed-keyword','stopped','close-failure','ignored-close'])test(`owned product cleanup retains recovery evidence when ${scenario}`,async t=>{
  const f=await nativeProductFixture(t,{closeFailure:scenario==='close-failure',ignoreClose:scenario==='ignored-close'}),result=await f.adapter.collect(f.args);
  const productId=f.args.tabs.product,product=f.records.get(productId).page,search=f.records.get(f.args.tabs.search).page;
  const args={...f.args,closeProduct:true,pluginReceipt:{...result.receipt,status:'success'}};
  if(scenario==='missing-receipt')delete args.pluginReceipt;
  if(scenario==='wrong-receipt-product')args.pluginReceipt.sourceUrl='https://www.temu.com/fixture-g-606233155182751.html';
  if(scenario==='wrong-receipt-tab')args.pluginReceipt.targetId=f.oldId;
  if(scenario==='failed-receipt')args.pluginReceipt.status='failed';
  if(scenario==='invalid-receipt-time')args.pluginReceipt.observedAt='unknown';
  if(scenario==='product-challenge')await product.evaluate(()=>{const el=document.createElement('div');el.id='captcha';el.textContent='完成安全验证';document.body.append(el);});
  if(scenario==='search-challenge')await search.evaluate(()=>{const el=document.createElement('div');el.id='captcha';el.textContent='完成安全验证';document.body.append(el);});
  if(scenario==='plugin-pending')await product.evaluate(()=>document.querySelector('button').textContent='采集中');
  if(scenario==='plugin-failed')await product.evaluate(()=>document.querySelector('button').textContent='采集失败');
  if(scenario==='changed-product')await product.evaluate(()=>history.replaceState({},'','/fixture-g-606233155182751.html'));
  if(scenario==='changed-keyword')await search.evaluate(()=>history.replaceState({},'','/search_result.html?search_key=different'));
  if(scenario==='stopped')f.stop();
  const returned=await f.adapter.returnToSearch(args);
  assert.notEqual(returned.status,'ready');assert.equal(product.isClosed(),false);assert.equal(search.isClosed(),false);
  assert.equal(f.args.tabs.product,productId);assert.ok(f.args.ownedTabs[productId]);assert.deepEqual(f.closures,[]);assert.equal(f.stats().solves,0);
});

for(const scenario of ['unknown-owner','wrong-owner-goods','wrong-owner-kind'])test(`cleanup never closes a matching page with ${scenario}`,async t=>{
  const f=await nativeProductFixture(t),result=await f.adapter.collect(f.args),productId=f.args.tabs.product;
  if(scenario==='unknown-owner')delete f.args.ownedTabs[productId];
  if(scenario==='wrong-owner-goods')f.args.ownedTabs[productId].goodsId='606233155182751';
  if(scenario==='wrong-owner-kind')f.args.ownedTabs[productId].kind='search';
  const returned=await f.adapter.returnToSearch({...f.args,closeProduct:true,pluginReceipt:{...result.receipt,status:'success'}});
  assert.equal(returned.status,'ready');assert.equal(f.records.get(productId).page.isClosed(),false);assert.deepEqual(f.closures,[]);
});

test('thirty native product collections keep one search and at most one active task product',async t=>{
  const f=await nativeProductFixture(t,{products:30}),baseline=f.old.context().pages().length,firstId=BigInt(f.args.goodsId);
  for(let index=0;index<30;index++){
    f.args.goodsId=String(firstId+BigInt(index));f.args.sourceUrl=`https://www.temu.com/fixture-g-${f.args.goodsId}.html`;
    const result=await f.adapter.collect(f.args);assert.equal(result.status,'submitted',`product ${index+1}: ${JSON.stringify(result)}`);
    assert.equal(f.old.context().pages().length,baseline+1);
    const returned=await f.adapter.returnToSearch({...f.args,closeProduct:true,pluginReceipt:{...result.receipt,status:'success'}});
    assert.equal(returned.status,'ready');assert.equal(f.old.context().pages().length,baseline);
  }
  assert.equal(f.closures.length,30);assert.deepEqual(f.stats(),{intents:30,solves:0});assert.equal(f.old.isClosed(),false);assert.equal(Object.keys(f.args.ownedTabs).length,0);
  assert.deepEqual(f.navigations,[]);
});
