import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {normalizeTemuSourceFacts,parseVisibleTemuPrice,readTemuSourceFacts} from '../src/temu-source-facts.mjs';
import {createTemuFrontBrowser} from '../src/temu-front-browser.mjs';

const goodsId='601105252678121',sourceUrl=`https://www.temu.com/fixture-g-${goodsId}.html`;
const observation=overrides=>({goodsId,sourceUrl,observedAt:'2026-11-25T12:00:00.000Z',categoryPath:['家居厨房用品','装饰'],priceCandidates:[{kind:'displayed-sale',text:'US$ 12.50'}],selectedVariant:{attributes:[{name:'颜色',value:'蓝色'},{name:'尺寸',value:'30 x 45 cm'}],selectionComplete:true},...overrides});

test('visible prices preserve exact currency and reject estimates, crossed-out labels and ranges',()=>{
  for(const [text,amount,currency] of [['US$ 12.50','12.5','USD'],['CA$1,234.50','1234.5','CAD'],['A$2.99','2.99','AUD'],['S$3.25','3.25','SGD'],['3,702円','3702','JPY'],['1.234,50 €','1234.5','EUR'],['售价 GBP 12.34','12.34','GBP']]){
    assert.deepEqual(parseVisibleTemuPrice(text),{amount,currency,kind:'displayed-sale',displayText:text});
  }
  for(const text of ['预估2,777円','券后价3,702円','建议零售价6,041円','US$ 10–20','US$ 12.50 50% OFF','US$ 12.50 50','US$ 12.','US$ 1.234','US$ 0','US$ 10 shipping','$4.51','¥3702','USD 12 CAD 12','JPY 3.50'])assert.equal(parseVisibleTemuPrice(text),null,text);
  assert.equal(parseVisibleTemuPrice('$4.51',['USD']).currency,'USD');
  assert.equal(parseVisibleTemuPrice('¥3702',['JPY']).amount,'3702');
  assert.equal(parseVisibleTemuPrice('$4.51',['USD','CAD']),null);
  assert.equal(parseVisibleTemuPrice('US$4.51',['CAD']),null,'conflicting visible currency controls cannot be silently ignored');
});

test('source facts bind price to only the observed selected variant and exact product',()=>{
  const facts=normalizeTemuSourceFacts(observation(),{goodsId,sourceUrl});
  assert.equal(facts.status,'ready');assert.equal(facts.variants.length,1);
  assert.deepEqual(facts.variants[0].attributes,observation().selectedVariant.attributes);
  assert.equal(facts.price.amount,'12.5');assert.equal(facts.price.currency,'USD');
  assert.deepEqual(normalizeTemuSourceFacts(facts,{goodsId,sourceUrl}),facts,'stored normalized facts remain valid');
  assert.throws(()=>normalizeTemuSourceFacts(observation({sourceUrl:sourceUrl.replace(goodsId,'601105252678122')}),{goodsId,sourceUrl}),/身份不一致/);
  assert.throws(()=>normalizeTemuSourceFacts(observation({observedAt:'not a date'}),{goodsId,sourceUrl}),/读取时间/);
  for(const raw of [observation({selectedVariant:{attributes:[],selectionComplete:false}}),observation({priceCandidates:[{kind:'displayed-sale',text:'预估2,777円'}]}),observation({categoryPath:[]}),observation({priceCandidates:[{kind:'displayed-sale',text:'US$1.00'},{kind:'displayed-sale',text:'US$2.00'}]})]){
    const result=normalizeTemuSourceFacts(raw,{goodsId,sourceUrl});assert.equal(result.status,'incomplete');assert.ok(result.issues.length);
    if(!raw.selectedVariant.selectionComplete||!result.price)assert.deepEqual(result.variants,[]);
  }
});

test('normalization never promotes malformed or previously incomplete evidence on another persistence pass',()=>{
  for(const overrides of [{categoryPath:Array.from({length:17},(_,i)=>'分类'+i)},{categoryPath:[{name:'不是已读分类'}]},{categoryPath:['分类…']},{unavailable:true},{status:'incomplete',issues:[]},{selectedVariant:{selectionComplete:true}},{selectedVariant:{selectionComplete:true,attributes:[{name:'颜色',value:{guessed:'蓝色'}}]}}]){
    const once=normalizeTemuSourceFacts(observation(overrides),{goodsId,sourceUrl}),twice=normalizeTemuSourceFacts(once,{goodsId,sourceUrl});
    assert.equal(once.status,'incomplete');assert.equal(twice.status,'incomplete');assert.deepEqual(twice.issues,once.issues);
  }
  assert.throws(()=>normalizeTemuSourceFacts(observation({observedAt:0}),{goodsId,sourceUrl}),/读取时间/);
});

let browser;
before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND']});});
after(async()=>{await browser?.close();});
const markup=({price='<div><span itemprop="price">US$ 12.50</span></div>',variants=true}={})=>`<h1>Fixture product</h1><nav aria-label="breadcrumb"><a>首页</a><a>家居厨房用品</a><a>装饰</a><span aria-current="page">Fixture product</span></nav><div id="goodsDetail">${price}${variants?'<div role="radiogroup" aria-label="颜色"><button role="radio" aria-checked="true">蓝色</button><button role="radio" aria-checked="false">红色</button></div>':''}</div><aside><span itemprop="price">US$0.01</span></aside>`;

async function pageFixture(t,body){
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));
  const page=await context.newPage();await page.goto(sourceUrl);return {context,page};
}

test('DOM reader uses visible semantic product controls without clicks, scripts or recommendations',async t=>{
  const {page}=await pageFixture(t,markup()+'<script>window.clicks=0;document.addEventListener("click",()=>window.clicks++);window.__FAKE_HIDDEN_STATE__={price:999,currency:"CAD"};</script><span aria-label="Currency" style="display:none">CAD</span>');
  const raw=await page.evaluate(readTemuSourceFacts,{goodsId}),facts=normalizeTemuSourceFacts(raw,{goodsId,sourceUrl});
  assert.equal(raw.productReady,true);assert.equal(facts.status,'ready');assert.equal(facts.price.amount,'12.5');
  assert.deepEqual(facts.categoryPath,['家居厨房用品','装饰']);assert.deepEqual(facts.selectedVariant.attributes,[{name:'颜色',value:'蓝色'}]);
  assert.equal(await page.evaluate(()=>window.clicks),0);
});

test('DOM reader rejects coupon context, line-through ancestors, hidden price and missing selected variants',async t=>{
  const {page}=await pageFixture(t,markup());
  for(const price of ['<div>预估<span itemprop="price">2,777円</span></div>','<div>券后价<span itemprop="price">3,702円</span></div>','<div style="text-decoration:line-through"><span itemprop="price">US$12</span></div>','<div style="display:none"><span itemprop="price">US$12</span></div>']){
    await page.setContent(markup({price}));const facts=normalizeTemuSourceFacts(await page.evaluate(readTemuSourceFacts,{goodsId}),{goodsId,sourceUrl});assert.equal(facts.price,null);assert.equal(facts.status,'incomplete');
  }
  await page.setContent(markup({variants:false}));const facts=normalizeTemuSourceFacts(await page.evaluate(readTemuSourceFacts,{goodsId}),{goodsId,sourceUrl});
  assert.equal(facts.selectedVariant.selectionComplete,false);assert.deepEqual(facts.variants,[]);
});

test('semantic reader supports visible schema breadcrumbs, selected native currency and labelled native variants',async t=>{
  const body=`<h1>Neutral wall decoration</h1><nav aria-label="Breadcrumb"><ol itemscope itemtype="https://schema.org/BreadcrumbList"><li><a><span itemprop="name">Home</span></a></li><li><a><span itemprop="name">Home & Kitchen</span></a></li><li><a><span itemprop="name">Wall Decor</span></a></li><li><a href="${sourceUrl}"><span itemprop="name">Neutral wall…</span></a></li></ol></nav><select aria-label="Currency"><option>USD</option><option selected>CAD</option></select><div id="goodsDetail"><div><span itemprop="price">$12.50</span></div><fieldset><legend>尺寸</legend><input id="small" type="radio" name="size" checked><label for="small">30 x 45 cm</label><input id="large" type="radio" name="size"><label for="large">60 x 90 cm</label></fieldset><div role="radiogroup" aria-labelledby="color-label"><span id="color-label">颜色</span><button role="radio" aria-checked="true" aria-labelledby="blue-label"><span id="blue-label">蓝色</span></button><button role="radio" aria-checked="false">红色</button></div></div>`;
  const {page}=await pageFixture(t,body),facts=normalizeTemuSourceFacts(await page.evaluate(readTemuSourceFacts,{goodsId}),{goodsId,sourceUrl});
  assert.equal(facts.status,'ready');assert.equal(facts.price.currency,'CAD');assert.deepEqual(facts.categoryPath,['Home & Kitchen','Wall Decor']);
  assert.deepEqual(facts.selectedVariant.attributes,[{name:'尺寸',value:'30 x 45 cm'},{name:'颜色',value:'蓝色'}]);
});

test('an unrecognized live layout cannot become ready through invented data attributes or hidden JSON',async t=>{
  const body='<h1>Neutral product</h1><nav data-testid="breadcrumb"><a>Home</a><a>Decor</a></nav><div id="goodsDetail"><span data-testid="sale-price" data-type="salePrice" data-price-type="sale">US$12.50</span><div data-variant-group="Color"><span aria-selected="true" data-value="Blue">Blue</span></div><meta itemprop="price" content="12.50"><meta itemprop="priceCurrency" content="USD"></div><script type="application/ld+json">{"offers":{"price":"12.50","priceCurrency":"USD"}}</script>';
  const {page}=await pageFixture(t,body),raw=await page.evaluate(readTemuSourceFacts,{goodsId}),facts=normalizeTemuSourceFacts(raw,{goodsId,sourceUrl});
  assert.equal(raw.productReady,true);assert.equal(facts.status,'incomplete');assert.equal(facts.price,null);assert.deepEqual(facts.categoryPath,[]);assert.equal(facts.selectedVariant.selectionComplete,false);
});

async function adapterFixture(t,body=markup(),{ignoreClose=false}={}){
  const context=await browser.newContext();t.after(()=>context.close());
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));
  const targets=new Map(),tabs={},ownedTabs={},events=[];let sequence=0,solveCalls=0;
  const transport={
    connection:async()=>({ws:'isolated-fixture',targets:async()=>[...targets].map(([id,{page}])=>({id,type:'page',url:page.url()}))}),
    connect:async()=>({send:async(method,args)=>{
      events.push(method);
      if(method==='Target.createTarget'){const id=String(++sequence),page=await context.newPage(),cdp=await context.newCDPSession(page);targets.set(id,{page,cdp});return {targetId:id};}
      if(method==='Target.closeTarget'){if(!ignoreClose){await targets.get(args.targetId).page.close();targets.delete(args.targetId);}return {success:true};}
      throw new Error('Unexpected browser mutation '+method);
    },close(){}}),
    pageById:async(info,id)=>{const target=targets.get(id);return {evaluate:(fn,arg)=>target.page.evaluate(fn,arg),send:(method,args)=>{events.push(method);if(method.startsWith('Input.'))throw new Error('source read must not click');return target.cdp.send(method,args);},close(){}};},
    poll:async fn=>{const deadline=Date.now()+1500;do{const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<deadline);throw Object.assign(new Error('fixture wait timeout'),{code:'ERP_WAIT_TIMEOUT'});}
  };
  const adapter=createTemuFrontBrowser({},transport,{captchaSolver:{solve:async()=>{solveCalls++;throw new Error('read-only must not solve CAPTCHA');}}});
  const args={browserConfig:{type:'chrome'},goodsId,sourceUrl,tabs,ownedTabs,onTarget:(kind,id,metadata)=>{tabs[kind]=id;ownedTabs[id]={kind,...metadata};},onTargetClosed:(kind,id)=>{events.push('persist-close');delete tabs[kind];delete ownedTabs[id];},onSourceFacts:facts=>{assert.equal(facts.goodsId,goodsId);events.push('persist-facts');}};
  return {adapter,args,events,targets,solveCalls:()=>solveCalls};
}

test('read-only historical source reader persists facts before closing only its own independent tab',async t=>{
  const f=await adapterFixture(t),result=await f.adapter.readSourceFacts(f.args);
  assert.equal(result.status,'ready');assert.equal(result.sourceFacts.status,'ready');assert.equal(f.targets.size,0);assert.equal(f.solveCalls(),0);
  assert.ok(f.events.indexOf('persist-facts')<f.events.indexOf('Target.closeTarget'));assert.equal(f.args.tabs['source-facts'],undefined);
  assert.equal(f.events.filter(event=>event==='Page.navigate').length,1);assert.equal(f.events.some(event=>event.startsWith('Input.')),false);
});

test('read-only historical source reader preserves challenge page without collection or paid solving',async t=>{
  const f=await adapterFixture(t,'<p>Verify you are human</p><div id="verification">Security verification</div>');
  const result=await f.adapter.readSourceFacts(f.args);assert.equal(result.status,'waiting-verification');assert.equal(f.targets.size,1);assert.equal(f.solveCalls(),0);
  const other={...f.args,goodsId:'601105252678122',sourceUrl:sourceUrl.replace(goodsId,'601105252678122')};
  assert.equal((await f.adapter.readSourceFacts(other)).status,'paused');assert.equal(f.events.filter(event=>event==='Page.navigate').length,1);
  assert.equal(f.events.includes('persist-facts'),false);assert.equal(f.events.includes('Target.closeTarget'),false);
});

test('source reader retains ownership when a successful close response leaves the page open',async t=>{
  const f=await adapterFixture(t,markup(),{ignoreClose:true}),result=await f.adapter.readSourceFacts(f.args);
  assert.equal(result.status,'paused');assert.equal(result.sourceFacts.status,'ready');assert.equal(f.targets.size,1);
  assert.ok(f.args.ownedTabs[f.args.tabs['source-facts']]);assert.equal(f.events.includes('persist-close'),false);
});

test('source reader does not close a page that changes after the observation was persisted',async t=>{
  const f=await adapterFixture(t);f.args.onSourceFacts=async()=>{f.events.push('persist-facts');await [...f.targets.values()][0].page.goto(sourceUrl.replace(goodsId,'601105252678122'));};
  const result=await f.adapter.readSourceFacts(f.args);assert.equal(result.status,'paused');assert.equal(result.sourceFacts.status,'ready');assert.equal(f.targets.size,1);
  assert.equal(f.events.includes('Target.closeTarget'),false);assert.ok(f.args.ownedTabs[f.args.tabs['source-facts']]);
});
