import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {createTemuCaptchaSolver,readTemuPoint,translatePointChallenge} from '../src/temu-captcha.mjs';
import {readTemuPage} from '../src/temu-front-browser.mjs';

let browser,images;
const fixtureUrl='https://www.temu.com/search_result.html?search_key=point%20fixture';
const challenge='请点击距离火车最近的球';
const translated='Please click the ball closest to the train.';
const point={proportionX:0.72,proportionY:0.35};
const answer=(points=[point])=>({answer:{proportionalPoints:points},durationMs:7});

test.before(async()=>{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const png=async background=>'data:image/png;base64,'+(await sharp({create:{width:414,height:320,channels:4,background}}).png().toBuffer()).toString('base64');
  images={original:await png('#476bad'),replacement:await png('#976a42')};
});
test.after(()=>browser?.close());

async function fixture(t,{width=250,height=193.2,text=challenge,outcome='pass',duplicateSubmit=false}={}){
  const context=await browser.newContext({viewport:{width:900,height:700}});t.after(()=>context.close());
  const requests=[];
  await context.route('**/*',route=>{
    requests.push(route.request().url());
    assert.equal(route.request().url(),fixtureUrl,'all fixture requests are intercepted; no external traffic');
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body></body></html>'});
  });
  const page=await context.newPage();await page.goto(fixtureUrl);
  await page.setContent(`<!doctype html><html><head><style>
    body{margin:0}#Picture{position:absolute;left:65px;top:48px;width:340px;background:#eee;padding:12px}
    ._3Idcd4ZF{margin-bottom:12px}#captchaImg{display:block;width:${width}px;height:${height}px}
    .fixture-submit{display:flex;align-items:center;justify-content:center;width:100px;height:34px;margin-top:12px;background:#e57924;cursor:pointer}
  </style></head><body><div id="Picture"><div class="_3Idcd4ZF"></div><div><img id="captchaImg" src="${images.original}" draggable="false"></div>
    <div id="pointSubmit" class="fixture-submit"><span>提交</span></div>${duplicateSubmit?'<div class="fixture-submit"><span>提交</span></div>':''}
  </div></body></html>`);
  await page.evaluate(async({text,outcome})=>{
    document.querySelector('._3Idcd4ZF').textContent=text;
    await document.querySelector('#captchaImg').decode();
    const state=window.fixture={points:[],submissions:0,events:[],outcome};
    document.querySelector('#captchaImg').addEventListener('click',event=>{
      state.points.push({x:event.clientX,y:event.clientY});state.events.push('point');
    });
    document.querySelector('#pointSubmit').addEventListener('click',()=>{
      state.submissions++;state.events.push('submit');
      if(state.outcome==='pass'){document.querySelector('#Picture').remove();const list=document.createElement('div');list.className='js-search-goodsList';list.innerHTML='<div class="autoFitGoodsList"><a href="https://www.temu.com/fixture-g-601105252678121.html">Fixture product</a></div>';document.body.append(list);}
      if(state.outcome==='network'){
        document.body.innerHTML='<p>没有网络连接</p><p>无法连接到互联网</p>';
        history.replaceState({},'', '/bgn_no_access.html');
      }
    });
  },{text,outcome});
  const cdp=await context.newCDPSession(page),inputEvents=[];
  const f={page,context,requests,inputEvents,onInput:null};
  f.bridge={
    evaluate:(...args)=>page.evaluate(...args),
    send:async(method,parameters)=>{
      if(method==='Input.dispatchMouseEvent')inputEvents.push({...parameters});
      const result=await cdp.send(method,parameters);
      if(method==='Input.dispatchMouseEvent')await f.onInput?.(parameters);
      return result;
    },close(){}
  };
  f.state=()=>page.evaluate(()=>({...window.fixture,challenge:!!document.querySelector('#Picture')}));
  f.replaceImage=()=>page.evaluate(async source=>{const img=document.querySelector('#captchaImg');img.src=source;await img.decode();},images.replacement);
  f.replaceChallenge=(next='请点击距离汽车最近的球')=>page.evaluate(value=>{document.querySelector('._3Idcd4ZF').textContent=value;},next);
  return f;
}

function callbacks(){
  const intent=[],updates=[],control={stopped:false};
  return {intent,updates,control,args:{keyword:'point fixture',
    captchaPreflight:()=>({allowed:true}),isStopped:()=>control.stopped,
    beforeCaptcha:details=>{intent.push(details);return `point-attempt-${intent.length}`;},
    afterCaptcha:(id,update)=>updates.push({id,...update})
  }};
}
function solver(client,options={}){
  return createTemuCaptchaSolver({client,fetchImpl:()=>{throw new Error('fixture must not fetch remote images');},pause:async()=>{},...options});
}
const run=(f,c,client,options)=>solver(client,options).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
const noSolved=c=>assert.equal(c.updates.some(update=>update.status==='solved'),false);

test('point instructions translate the known relationship without changing the target',()=>{
  assert.equal(translatePointChallenge(challenge),translated);
  assert.equal(translatePointChallenge('请点击距离火车最近的红色星星'),null);
});

for(const dimensions of [{width:250,height:193.2},{width:300,height:120}])test(`point coordinates use the rendered ${dimensions.width}x${dimensions.height} image and submit once`,async t=>{
  const f=await fixture(t,dimensions),c=callbacks();let calls=0;
  const initial=await f.page.evaluate(readTemuPoint);
  assert.ok(initial);assert.equal(initial.challenge,challenge);
  assert.ok(Math.abs(initial.image.rect.width-dimensions.width)<0.05);assert.ok(Math.abs(initial.image.rect.height-dimensions.height)<0.05);
  assert.equal((await f.page.evaluate(readTemuPage)).status,'waiting-verification');
  const result=await run(f,c,{solve:async(type,payload)=>{
    calls++;assert.equal(type,'semantic-items');assert.equal(payload.challenge,translated);assert.equal(payload.image_b64,images.original.split(',')[1]);
    assert.equal(c.intent.length,1);assert.equal(c.intent[0].type,'semantic-items');assert.match(c.intent[0].fingerprint,/^[a-f0-9]{64}$/);
    assert.equal((await f.state()).points.length,0,'recognition must precede any point selection');
    return answer();
  }});
  const state=await f.state();
  assert.equal(result.status,'solved');assert.equal(calls,1);assert.equal(state.points.length,1);assert.equal(state.submissions,1);assert.equal(state.challenge,false);
  assert.deepEqual(state.events,['point','submit']);
  assert.ok(Math.abs(state.points[0].x-(initial.image.rect.x+dimensions.width*point.proportionX))<=1);
  assert.ok(Math.abs(state.points[0].y-(initial.image.rect.y+dimensions.height*point.proportionY))<=1);
  assert.equal(c.updates.at(-1).status,'solved');assert.deepEqual(f.requests,[fixtureUrl]);
});

for(const [label,points] of [
  ['empty',[]],['multiple',[point,{proportionX:0.1,proportionY:0.2}]],
  ['negative',[{proportionX:-0.1,proportionY:0.2}]],['outside image',[{proportionX:0.2,proportionY:1.1}]],
  ['non-finite',[{proportionX:NaN,proportionY:0.2}]]
])test(`a ${label} point answer cannot click the image or submit`,async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const result=await run(f,c,{solve:async()=>{calls++;return answer(points);}});
  const state=await f.state();assert.notEqual(result.status,'solved');assert.equal(calls,1);
  assert.equal(state.points.length,0);assert.equal(state.submissions,0);assert.equal(f.inputEvents.length,0);noSolved(c);
});

for(const changed of ['image','instruction'])test(`an answer for a stale ${changed} never clicks the current challenge`,async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const result=await run(f,c,{solve:async()=>{calls++;await (changed==='image'?f.replaceImage():f.replaceChallenge());return answer();}});
  const state=await f.state();assert.notEqual(result.status,'solved');assert.equal(calls,1);
  assert.equal(state.points.length,0);assert.equal(state.submissions,0);assert.equal(f.inputEvents.length,0);noSolved(c);
});

test('a challenge replaced after point selection cannot receive a submit click',async t=>{
  const f=await fixture(t),c=callbacks();let replaced=false;
  f.onInput=async event=>{if(event.type==='mouseReleased'&&(await f.state()).points.length===1&&!replaced){replaced=true;await f.replaceImage();}};
  const result=await run(f,c,{solve:async()=>answer()});
  const state=await f.state();assert.notEqual(result.status,'solved');assert.equal(replaced,true);
  assert.equal(state.points.length,1);assert.equal(state.submissions,0);noSolved(c);
});

test('stopping while recognition is pending does not select or submit the returned point',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const result=await run(f,c,{solve:async()=>{calls++;c.control.stopped=true;return answer();}});
  const state=await f.state();assert.notEqual(result.status,'solved');assert.equal(calls,1);
  assert.equal(state.points.length,0);assert.equal(state.submissions,0);noSolved(c);
});

test('stopping after point selection prevents the submit button from being clicked',async t=>{
  const f=await fixture(t),c=callbacks();
  f.onInput=async event=>{if(event.type==='mouseReleased'&&(await f.state()).points.length===1)c.control.stopped=true;};
  const result=await run(f,c,{solve:async()=>answer()});
  const state=await f.state();assert.notEqual(result.status,'solved');assert.equal(c.control.stopped,true);
  assert.equal(state.points.length,1);assert.equal(state.submissions,0);noSolved(c);
});

test('stopping while the submit button is pressed cancels the click before mouse release',async t=>{
  const f=await fixture(t),c=callbacks(),initial=await f.page.evaluate(readTemuPoint);
  f.onInput=event=>{if(event.type==='mousePressed'&&Math.abs(event.x-initial.submit.x)<1&&Math.abs(event.y-initial.submit.y)<1)c.control.stopped=true;};
  const result=await run(f,c,{solve:async()=>answer()});
  const state=await f.state();assert.equal(c.control.stopped,true);assert.notEqual(result.status,'solved');
  assert.equal(state.points.length,1);assert.equal(state.submissions,0);noSolved(c);
});

test('a network error after point submission is not a solved verification',async t=>{
  const f=await fixture(t,{outcome:'network'}),c=callbacks();
  const result=await run(f,c,{solve:async()=>answer()});
  const state=await f.state();assert.notEqual(result.status,'solved');assert.equal(state.points.length,1);assert.equal(state.submissions,1);
  assert.equal((await f.page.evaluate(readTemuPage)).status,'waiting-network');noSolved(c);
});

test('unknown Chinese instructions do not make a recognition request or move the mouse',async t=>{
  const f=await fixture(t,{text:'请找出符合图中复杂规则的物体'}),c=callbacks();let calls=0;
  const result=await run(f,c,{solve:async()=>{calls++;return answer();}});
  assert.notEqual(result.status,'solved');assert.equal(calls,0);assert.equal(c.intent.length,0);assert.equal(f.inputEvents.length,0);
  assert.equal((await f.state()).submissions,0);noSolved(c);
});

test('ambiguous submit controls cannot consume a recognition request or select a point',async t=>{
  const f=await fixture(t,{duplicateSubmit:true}),c=callbacks();let calls=0;
  const result=await run(f,c,{solve:async()=>{calls++;return answer();}});
  assert.notEqual(result.status,'solved');assert.equal(calls,0);assert.equal(c.intent.length,0);assert.equal(f.inputEvents.length,0);
  assert.equal((await f.state()).submissions,0);noSolved(c);
});
