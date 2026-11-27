import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {readTemuCaptchaDiagnostic,sanitizeCaptchaDiagnostic,getCaptchaDiagnosticMessage,CAPTCHA_DIAGNOSTIC_CODES} from '../src/temu-captcha-diagnostics.mjs';
import {createTemuCaptchaSolver,readTemuSlider,readTemuPoint} from '../src/temu-captcha.mjs';
import {readTemuGrid} from '../src/temu-grid-captcha.mjs';

let browser,image;
const summary=(code,extra={})=>({code,type:'unknown',probes:0,frames:0,shadowRoots:0,images:0,loadedImages:0,...extra});
test.before(async()=>{
  browser=await chromium.launch({channel:'msedge',headless:true});
  image='data:image/png;base64,'+(await sharp({create:{width:80,height:80,channels:3,background:'#88aacc'}}).png().toBuffer()).toString('base64');
});
test.after(()=>browser?.close());

async function fixture(t,html){
  const context=await browser.newContext({viewport:{width:900,height:700}});t.after(()=>context.close());
  const requests=[],pending=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());requests.push(url.href);
    assert.equal(url.origin,'https://www.temu.com','all requests are fixtures, never external calls');
    if(url.pathname==='/pending-image.png'){pending.push(route);return;}
    assert.equal(url.pathname,'/diagnostic-fixture');
    return route.fulfill({contentType:'text/html',body:'<body></body>'});
  });
  const page=await context.newPage();await page.goto('https://www.temu.com/diagnostic-fixture');
  await page.setContent(html,{waitUntil:'domcontentloaded'});
  return {page,requests,pending};
}

const pointHtml=()=>`<div id="Picture"><p>请点击距离火车最近的球</p><img id="captchaImg" src="${image}" style="width:200px;height:100px"><button>提交</button></div>`;

test('diagnostic sanitization drops arbitrary data and bounds every persisted count',()=>{
  const safe=sanitizeCaptchaDiagnostic({code:'loading-images',type:'point',probes:200,frames:-4,shadowRoots:50,images:500,loadedImages:700,message:'fixture-secret',url:'https://secret.invalid',image_b64:'fixture-secret'});
  assert.deepEqual(safe,summary('loading-images',{type:'point',probes:40,frames:0,shadowRoots:20,images:100,loadedImages:100}));
  assert.equal(JSON.stringify(safe).includes('secret'),false);
  assert.equal(sanitizeCaptchaDiagnostic({code:'not-allow-listed',type:'slider'}),null);
  assert.equal(sanitizeCaptchaDiagnostic(null),null);
  assert.deepEqual(sanitizeCaptchaDiagnostic({code:'unsupported-layout',type:'fixture-secret',probes:NaN,images:Infinity,frames:'20'}),summary('unsupported-layout'));
  for(const code of CAPTCHA_DIAGNOSTIC_CODES)assert.match(getCaptchaDiagnosticMessage(code),/未调用 SadCaptcha/);
  assert.equal(getCaptchaDiagnosticMessage({code:'unsupported-layout',message:'fixture-secret'}),getCaptchaDiagnosticMessage('unsupported-layout'));
});

test('loaded point and grid summaries contain only fixed fields and image counts',async t=>{
  const f=await fixture(t,pointHtml());await f.page.locator('img').evaluate(img=>img.decode());
  const point=await f.page.evaluate(readTemuCaptchaDiagnostic,{probes:12});
  assert.deepEqual(point,summary('point-structure-mismatch',{type:'point',probes:12,images:1,loadedImages:1}));
  assert.equal(JSON.stringify(point).includes('火车'),false);assert.equal(JSON.stringify(point).includes('base64'),false);
  await f.page.setContent(`<div role="dialog"><div id="imageSemantics">${Array.from({length:9},()=>`<img src="${image}">`).join('')}</div></div>`);
  assert.deepEqual(await f.page.evaluate(readTemuCaptchaDiagnostic),summary('grid-structure-mismatch',{type:'grid',images:9,loadedImages:9}));
});

test('pending captcha images are distinguished from loaded layout mismatches',async t=>{
  const f=await fixture(t,'<div id="verification"><img src="https://www.temu.com/pending-image.png" width="120" height="80"></div>');
  assert.deepEqual(await f.page.evaluate(readTemuCaptchaDiagnostic),summary('loading-images',{type:'slider',images:1}));
  assert.equal(f.requests.filter(url=>url.includes('pending-image')).length,1);
});

test('unrelated product images do not extend captcha readiness waiting',async t=>{
  const f=await fixture(t,'<img src="https://www.temu.com/pending-image.png" width="120" height="80">');
  assert.deepEqual(await f.page.evaluate(readTemuCaptchaDiagnostic),summary('unsupported-layout'));
});

test('document readiness and slider interaction blockers have distinct diagnoses',async t=>{
  const f=await fixture(t,'<div id="verification">安全验证</div>');
  await f.page.evaluate(()=>Object.defineProperty(document,'readyState',{configurable:true,get:()=> 'loading'}));
  assert.equal((await f.page.evaluate(readTemuCaptchaDiagnostic)).code,'page-loading');
  assert.equal((await f.page.evaluate(readTemuCaptchaDiagnostic,{sliderBlocked:true})).code,'slider-blocked');
  assert.equal((await f.page.evaluate(readTemuCaptchaDiagnostic,{sliderNotOrigin:true})).code,'slider-not-origin');
});

test('point captcha in a same-origin iframe is identified as an unsupported embedding',async t=>{
  const f=await fixture(t,'<iframe style="width:600px;height:400px"></iframe>');
  await f.page.locator('iframe').evaluate(async(frame,html)=>{
    frame.contentDocument.body.innerHTML=html;
    await Promise.all([...frame.contentDocument.images].map(img=>img.decode()));
  },pointHtml());
  assert.deepEqual(await f.page.evaluate(readTemuCaptchaDiagnostic),summary('embedded-frame-unsupported',{type:'point',frames:1,images:1,loadedImages:1}));
});

test('point captcha in a shadow component is identified without returning its content',async t=>{
  const f=await fixture(t,'<div id="host"></div>');
  await f.page.evaluate(async html=>{
    const root=document.querySelector('#host').attachShadow({mode:'open'});root.innerHTML=html;
    await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode()));
  },pointHtml());
  assert.deepEqual(await f.page.evaluate(readTemuCaptchaDiagnostic),summary('shadow-root-unsupported',{type:'point',shadowRoots:1,images:1,loadedImages:1}));
});

test('a captcha image loading beyond the original probe budget reaches one normal recognition request',async t=>{
  const f=await fixture(t,pointHtml()),pendingUrl='https://www.temu.com/pending-image.png';
  await Promise.all([f.page.waitForRequest(pendingUrl),f.page.locator('#captchaImg').evaluate((img,url)=>{img.src=url;},pendingUrl)]);
  await f.page.evaluate(()=>{
    window.fixtureSubmits=0;
    document.querySelector('button').onclick=()=>{window.fixtureSubmits++;document.querySelector('#Picture').remove();};
  });
  let pauses=0,calls=0;const intents=[],updates=[],diagnostics=[];
  const bytes=Buffer.from(image.split(',')[1],'base64'),cdp=await f.page.context().newCDPSession(f.page);
  const solver=createTemuCaptchaSolver({
    client:{solve:async(type)=>{calls++;assert.equal(type,'semantic-items');assert.ok(pauses>=15);return {answer:{proportionalPoints:[{proportionX:0.4,proportionY:0.5}]},durationMs:1};}},
    fetchImpl:async url=>{assert.equal(String(url),pendingUrl);return new Response(bytes,{headers:{'content-type':'image/png'}});},
    pause:async()=>{
      if(++pauses===15){assert.equal(f.pending.length,1);await f.pending[0].fulfill({contentType:'image/png',body:bytes});await f.page.locator('#captchaImg').evaluate(img=>img.decode());}
    }
  });
  const result=await solver.solve({page:{evaluate:(...args)=>f.page.evaluate(...args),send:(...args)=>cdp.send(...args)},
    args:{keyword:'fixture',captchaPreflight:()=>({allowed:true}),isStopped:()=>false,beforeCaptcha:value=>{intents.push(value);return 'fixture-intent';},afterCaptcha:(_id,value)=>updates.push(value),onCaptchaDiagnostic:value=>diagnostics.push(value)},
    readPage:()=>({status:'ready',url:'https://www.temu.com/search_result.html?search_key=fixture',searchListStatus:'ready',products:[{sourceUrl:'https://www.temu.com/fixture-g-601105252678121.html'}]})});
  assert.equal(result.status,'solved');assert.equal(calls,1);assert.equal(intents.length,1);assert.equal(diagnostics.length,0);
  assert.equal(await f.page.evaluate(()=>window.fixtureSubmits),1);assert.equal(updates.at(-1).status,'solved');
});

function detectorFixture({code='unsupported-layout',loadingUntil=0,slider,failDiagnosticAt=0}={}){
  let probes=0,pauses=0,calls=0,inputs=0,intents=0;
  const diagnostics=[];
  const page={
    evaluate:async(fn,options)=>{
      if(fn===readTemuSlider){probes++;return slider||null;}
      if(fn===readTemuPoint||fn===readTemuGrid)return null;
      if(fn===readTemuCaptchaDiagnostic){
        if(probes===failDiagnosticAt)throw new Error('fixture-secret');
        return summary(probes<=loadingUntil?'loading-images':code,{probes:options.probes,type:slider?'slider':'unknown',...(probes<=loadingUntil?{images:1}:{}),...options.sliderBlocked?{code:'slider-blocked'}:{},...options.sliderNotOrigin?{code:'slider-not-origin'}:{}});
      }
      throw new Error('unexpected fixture read');
    },
    send:async()=>{inputs++;throw new Error('detection rejection must not move the mouse');}
  };
  const args={captchaPreflight:()=>({allowed:true}),isStopped:()=>false,beforeCaptcha:()=>{intents++;return 'fixture-intent';},onCaptchaDiagnostic:value=>diagnostics.push(value)};
  const solver=createTemuCaptchaSolver({client:{solve:async()=>{calls++;throw new Error('must not call paid recognition');}},fetchImpl:()=>{throw new Error('must not fetch external images');},pause:async()=>{pauses++;}});
  return {run:()=>solver.solve({page,args,readPage:()=>({status:'waiting-verification'})}),state:()=>({probes,pauses,calls,inputs,intents,diagnostics})};
}

test('unsupported layout keeps the original probe budget and records one bounded rejection',async()=>{
  const f=detectorFixture(),result=await f.run(),state=f.state();
  assert.equal(result.code,'unsupported-layout');assert.equal(result.status,'waiting-verification');
  assert.equal(state.probes,12);assert.equal(state.pauses,11);assert.equal(state.calls+state.inputs+state.intents,0);
  assert.deepEqual(state.diagnostics,[result.diagnostic]);assert.equal(result.diagnostic.probes,12);
});

test('explicit delayed image loading extends detection and stops as soon as loading ends',async()=>{
  const f=detectorFixture({loadingUntil:15,code:'point-structure-mismatch'}),result=await f.run(),state=f.state();
  assert.equal(state.probes,16);assert.equal(state.pauses,15);assert.equal(result.code,'point-structure-mismatch');
  assert.equal(state.calls+state.inputs+state.intents,0);assert.equal(state.diagnostics.length,1);
});

test('permanent loading has a forty-probe ceiling without API requests or page refreshes',async()=>{
  const f=detectorFixture({loadingUntil:100}),result=await f.run(),state=f.state();
  assert.equal(state.probes,40);assert.equal(state.pauses,39);assert.equal(result.code,'loading-images');
  assert.equal(state.calls+state.inputs+state.intents,0);assert.equal(state.diagnostics.length,1);assert.equal(result.diagnostic.probes,40);
});

test('a diagnostic read interruption replaces stale loading and never persists its error text',async()=>{
  const f=detectorFixture({loadingUntil:100,failDiagnosticAt:13}),result=await f.run(),state=f.state();
  assert.equal(state.probes,13);assert.equal(result.code,'inspection-unavailable');assert.equal(result.diagnostic.probes,13);
  assert.equal(JSON.stringify(result).includes('fixture-secret'),false);assert.equal(state.calls+state.inputs+state.intents,0);
});

for(const [code,slider] of [['slider-blocked',{usable:false,atOrigin:true}],['slider-not-origin',{usable:true,atOrigin:false}]])test(`${code} is recorded without changing the original twelve-probe budget`,async()=>{
  const f=detectorFixture({slider}),result=await f.run(),state=f.state();
  assert.equal(result.code,code);assert.equal(state.probes,12);assert.equal(state.calls+state.inputs+state.intents,0);
});
