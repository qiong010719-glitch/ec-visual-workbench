import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {createTemuCaptchaSolver,readTemuSlider,isTemuVerificationReturn} from '../src/temu-captcha.mjs';
import {createTemuFrontBrowser,readTemuPage} from '../src/temu-front-browser.mjs';

let browser,images;
const fixtureUrl='https://www.temu.com/search_result.html?search_key=fixture';
const sourceUrl='https://www.temu.com/fixture-g-601105252678121.html';
test.before(async()=>{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const png=async(width,height,background)=>'data:image/png;base64,'+(await sharp({create:{width,height,channels:4,background}}).png().toBuffer()).toString('base64');
  images={puzzle:await png(200,120,'#4667a1'),piece:await png(20,20,'#d36b46'),replacement:await png(200,120,'#51945d'),
    linearPuzzle:await png(414,230,'#315d8a'),linearPiece:await png(72,72,'#c78a4b'),linearNewPiece:await png(72,72,'#b35896')};
});
test.after(()=>browser?.close());

async function fixture(t,{pass=true,text=true}={}){
  const context=await browser.newContext({viewport:{width:900,height:700}});
  t.after(()=>context.close());
  const requests=[];
  await context.route('**/*',async route=>{
    requests.push(route.request().url());
    assert.equal(route.request().url(),fixtureUrl,'all fixture requests are intercepted; no external traffic');
    await route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body></body></html>'});
  });
  const page=await context.newPage();await page.goto(fixtureUrl);
  await page.setContent(`<!doctype html><html><head><style>
    body{margin:0}#verification{position:absolute;left:40px;top:40px;width:220px}
    #slider{position:relative;width:200px;height:120px}#slider>img{width:200px;height:120px;display:block}
    #img-button{position:absolute;left:10px;top:30px;width:20px;height:20px;transform-origin:center}
    #img-button>img{width:20px;height:20px;display:block;pointer-events:none}
    .handleBar{position:relative;width:40px;height:22px;margin-top:15px;background:#aaa}
    #slide-button{position:absolute;left:0;top:1px;width:20px;height:20px;background:#333;user-select:none}
  </style></head><body><div id="verification">${text?'<p id="instructions">请拖动滑块完成验证</p>':''}
    <div id="slider"><img src="${images.puzzle}" draggable="false"><div id="img-button" style="transform:rotate(-12deg)"><img src="${images.piece}" draggable="false"></div></div>
    <div class="handleBar"><div id="slide-button"></div></div>
  </div></body></html>`);
  await page.evaluate(async({pass,sourceUrl})=>{
    await Promise.all([...document.images].map(img=>img.decode()));
    const handle=document.querySelector('#slide-button'),piece=document.querySelector('#img-button');
    const state=window.fixture={held:false,startX:0,distance:0,events:[],submissions:0,target:7,pass};
    handle.addEventListener('mousedown',event=>{
      event.preventDefault();state.held=true;state.startX=event.clientX;state.events.push({type:'press',distance:state.distance});
    });
    document.addEventListener('mousemove',event=>{
      if(!state.held||state.ignoreDrag)return;
      const distance=Math.max(0,Math.min(20,Math.round(event.clientX-state.startX)));
      state.distance=distance;handle.style.left=`${distance}px`;
      piece.style.left=`${10+0.55*distance}px`;piece.style.top=`${30-8*Math.sin(distance/20*Math.PI/2)}px`;
      piece.style.transform=`rotate(${-12-0.75*distance}deg)`;
      state.events.push({type:'move',distance,buttons:event.buttons});
    });
    document.addEventListener('mouseup',()=>{
      if(!state.held)return;
      state.held=false;state.events.push({type:'release',distance:state.distance});
      if(state.distance>0)state.submissions++;
      if(state.pass&&state.distance===state.target){
        document.querySelector('#verification')?.remove();
        const link=document.createElement('a');link.href=sourceUrl;link.textContent='fixture product';
        const list=document.createElement('div');list.className='js-search-goodsList';const grid=document.createElement('div');grid.className='autoFitGoodsList';grid.append(link);list.append(grid);document.body.append(list);
      }
    });
  },{pass,sourceUrl});
  const cdp=await context.newCDPSession(page),inputEvents=[];
  const f={page,context,requests,inputEvents,evaluations:0,onInput:null};
  f.bridge={
    evaluate:(...args)=>{f.evaluations++;return page.evaluate(...args);},
    send:async(method,parameters)=>{
      if(method==='Input.dispatchMouseEvent')inputEvents.push({...parameters});
      const result=await cdp.send(method,parameters);
      if(method==='Input.dispatchMouseEvent')await f.onInput?.(parameters);
      return result;
    },close(){}
  };
  f.state=()=>page.evaluate(()=>({held:window.fixture.held,distance:window.fixture.distance,events:window.fixture.events,submissions:window.fixture.submissions,challenge:!!document.querySelector('#verification')}));
  f.replaceImage=()=>page.evaluate(async source=>{const img=document.querySelector('#slider>img');img.src=source;await img.decode();},images.replacement);
  return f;
}

function callbacks(){
  const intent=[],updates=[];
  const control={stopped:false};
  const args={
    keyword:'fixture',
    captchaPreflight:()=>({allowed:true}),isStopped:()=>control.stopped,
    beforeCaptcha:details=>{intent.push(details);return `attempt-${intent.length}`;},
    afterCaptcha:(id,update)=>updates.push({id,...update})
  };
  return {args,intent,updates,control};
}

function solver(client,options={}){
  return createTemuCaptchaSolver({client,fetchImpl:()=>{throw new Error('fixture must not fetch remote images');},pause:async()=>{},...options});
}

test('arced trajectory samples every pixel and keeps the mouse down until the API answer',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const client={solve:async(type,payload)=>{
    calls++;assert.equal(type,'temu-arced-slide');
    assert.equal((await f.state()).held,true);assert.equal(f.inputEvents.some(e=>e.type==='mouseReleased'),false);
    assert.equal(c.intent.length,1);assert.match(c.intent[0].fingerprint,/^[a-f0-9]{64}$/);
    const samples=payload.slide_piece_trajectory;
    assert.equal(samples.length,21);assert.deepEqual(samples.map(s=>s.pixels_from_slider_origin),Array.from({length:21},(_,i)=>i));
    for(const [i,sample] of samples.entries()){
      assert.equal(sample.piece_rotation_angle,-12-0.75*i);
      assert.ok(Math.abs(sample.piece_center.proportionX-(20+0.55*i)/200)<0.001);
      assert.ok(Math.abs(sample.piece_center.proportionY-(40-8*Math.sin(i/20*Math.PI/2))/120)<0.001);
    }
    const puzzle=await sharp(Buffer.from(payload.puzzle_image_b64,'base64')).metadata();assert.equal(puzzle.width,200);
    assert.equal(payload.piece_image_b64,images.piece.split(',')[1]);
    await wait(15);assert.equal((await f.state()).held,true);
    return {answer:{pixelsFromSliderOrigin:7},durationMs:15};
  }};
  const result=await solver(client).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'solved');assert.equal(calls,1);
  const state=await f.state();assert.equal(state.held,false);assert.equal(state.challenge,false);assert.equal(state.submissions,1);
  assert.deepEqual(state.events.filter(e=>e.type==='release'),[{type:'release',distance:7}]);
  assert.deepEqual(c.updates.map(u=>u.status),['answered','solved']);
  assert.deepEqual(f.requests,[fixtureUrl]);
});

test('visible slider DOM is verification even when challenge instructions are absent',async t=>{
  const f=await fixture(t,{text:false});
  assert.equal((await f.page.evaluate(readTemuPage)).status,'waiting-verification');
});

test('missing preflight does not inspect the page, move the mouse or call the client',async t=>{
  const f=await fixture(t),c=callbacks();delete c.args.captchaPreflight;let calls=0;
  const result=await solver({solve:async()=>{calls++;throw new Error('unexpected API request');}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'waiting-verification');assert.equal(f.evaluations,0);assert.equal(f.inputEvents.length,0);assert.equal(calls,0);assert.equal(c.intent.length,0);
});

test('unsupported slider structure consumes no recognition request and leaves the mouse untouched',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  await f.page.evaluate(()=>{document.querySelector('#img-button').style.transform='';});
  assert.equal(await f.page.evaluate(readTemuSlider),null);
  const result=await solver({solve:async()=>{calls++;}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'waiting-verification');assert.equal(calls,0);assert.equal(c.intent.length,0);assert.equal(f.inputEvents.length,0);
});

test('a handle moved away from origin during image preparation is not sampled or billed',async t=>{
  const f=await fixture(t),c=callbacks();let reads=0,calls=0;
  const evaluate=f.bridge.evaluate;
  f.bridge.evaluate=async(fn,...args)=>{
    const result=await evaluate(fn,...args);
    if(fn===readTemuSlider&&++reads===1)await f.page.evaluate(()=>{document.querySelector('#slide-button').style.left='10px';window.fixture.distance=10;});
    return result;
  };
  const result=await solver({solve:async()=>{calls++;return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'waiting-verification');assert.equal(calls,0);assert.equal(c.intent.length,0);assert.equal(f.inputEvents.length,0);
});

test('ignored drag events cannot bill a stationary trajectory',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  await f.page.evaluate(()=>{window.fixture.ignoreDrag=true;});
  const instance=solver({solve:async()=>{calls++;return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}},{pause:()=>f.replaceImage()});
  const result=await instance.solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'waiting-verification');assert.equal(calls,0);assert.equal(c.intent.length,0);assert.equal((await f.state()).held,false);
});

test('an unknown request result is recorded once and a closed gate prevents a second attempt',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const instance=solver({solve:async()=>{calls++;throw Object.assign(new Error('fixture network result unknown'),{code:'SADCAPTCHA_NETWORK_ERROR',isUnknown:true});}});
  const result=await instance.solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'waiting-verification');assert.equal(calls,1);assert.deepEqual(c.updates.map(u=>u.status),['unknown']);
  assert.equal((await f.state()).held,false);assert.equal((await f.state()).submissions,0);
  const inputs=f.inputEvents.length,evaluations=f.evaluations;
  c.args.captchaPreflight=()=>({allowed:false,message:'previous request has an unknown result'});
  await instance.solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(calls,1);assert.equal(f.inputEvents.length,inputs);assert.equal(f.evaluations,evaluations);
});

test('pausing after the final trajectory sample releases at origin without an API request',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const initial=await f.page.evaluate(readTemuSlider);
  f.onInput=event=>{if(event.type==='mouseMoved'&&event.x===initial.handle.x+20)c.control.stopped=true;};
  const result=await solver({solve:async()=>{calls++;return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  const state=await f.state();assert.equal(result.status,'waiting-verification');assert.equal(calls,0);assert.equal(c.intent.length,0);
  assert.equal(state.held,false);assert.equal(state.submissions,0);assert.deepEqual(state.events.at(-1),{type:'release',distance:0});
});

test('pausing while an answer is pending releases without applying the returned distance',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const result=await solver({solve:async()=>{calls++;c.control.stopped=true;return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  const state=await f.state();assert.equal(result.status,'waiting-verification');assert.equal(calls,1);
  assert.equal(state.held,false);assert.equal(state.submissions,0);assert.equal(state.challenge,true);
  assert.deepEqual(state.events.at(-1),{type:'release',distance:0});assert.deepEqual(c.updates.map(u=>u.status),['answered','cancelled']);
});

test('an answer for a replaced challenge is discarded and cannot submit the new image',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0;
  const result=await solver({solve:async()=>{calls++;await f.replaceImage();return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  const state=await f.state();assert.equal(result.status,'waiting-verification');assert.equal(calls,1);
  assert.equal(state.submissions,0);assert.equal(state.held,false);assert.equal(state.challenge,true);
  assert.deepEqual(state.events.at(-1),{type:'release',distance:0});assert.deepEqual(c.updates.map(u=>u.status),['answered','not-passed']);
});

test('a returned answer is not a pass while the slider remains visible',async t=>{
  const f=await fixture(t,{pass:false}),c=callbacks();let pauses=0;
  const instance=solver({solve:async()=>({answer:{pixelsFromSliderOrigin:7},durationMs:1})},{pause:async()=>{pauses++;if(pauses===1)await f.replaceImage();}});
  const result=await instance.solve({page:f.bridge,args:c.args,readPage:()=>({status:'ready'})});
  assert.equal(result.status,'waiting-verification');assert.equal((await f.state()).challenge,true);
  assert.equal(c.updates.some(u=>u.status==='solved'),false);assert.equal(c.updates.at(-1).status,'not-passed');
});

test('a failed return-to-origin movement still releases the held mouse',async t=>{
  const f=await fixture(t),c=callbacks();
  const initial=await f.page.evaluate(readTemuSlider),send=f.bridge.send;let returnMoveFailed=false;
  f.bridge.send=async(method,event)=>{
    if(method==='Input.dispatchMouseEvent'&&event.type==='mouseMoved'&&event.x===initial.handle.x&&c.control.stopped&&!returnMoveFailed){
      returnMoveFailed=true;throw new Error('fixture failed one CDP movement');
    }
    return send(method,event);
  };
  const result=await solver({solve:async()=>{c.control.stopped=true;return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'waiting-verification');assert.equal(returnMoveFailed,true);
  assert.equal((await f.state()).held,false,'failed movement must not prevent an independent release attempt');
});

test('pausing during the final answer movement prevents mouse-up from submitting it',async t=>{
  const f=await fixture(t),c=callbacks();let answerReturned=false;
  const initial=await f.page.evaluate(readTemuSlider);
  f.onInput=event=>{if(answerReturned&&event.type==='mouseMoved'&&event.x===initial.handle.x+7)c.control.stopped=true;};
  const result=await solver({solve:async()=>{answerReturned=true;return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  const state=await f.state();assert.equal(result.status,'waiting-verification');assert.equal(state.held,false);assert.equal(state.submissions,0);assert.equal(state.challenge,true);
  assert.equal(c.updates.some(u=>u.status==='solved'),false);
});

test('a failed challenge reread is not evidence that verification disappeared',async t=>{
  const f=await fixture(t,{pass:false}),c=callbacks();let failNextRead=false,pauses=0;
  const evaluate=f.bridge.evaluate;
  f.bridge.evaluate=(fn,...args)=>{
    if(fn===readTemuSlider&&failNextRead){failNextRead=false;return Promise.reject(new Error('fixture CDP read interruption'));}
    return evaluate(fn,...args);
  };
  f.onInput=event=>{if(event.type==='mouseReleased')failNextRead=true;};
  const instance=solver({solve:async()=>({answer:{pixelsFromSliderOrigin:7},durationMs:1})},{pause:async()=>{pauses++;if(pauses===2)await f.replaceImage();}});
  const result=await instance.solve({page:f.bridge,args:c.args,readPage:()=>({status:'ready'})});
  assert.equal(result.status,'waiting-verification');assert.equal((await f.state()).challenge,true);
  assert.equal(c.updates.some(u=>u.status==='solved'),false);
});

test('front-browser search resumes the same isolated page after confirmed automatic verification',async t=>{
  const f=await fixture(t),c=callbacks();let calls=0,created=0;
  const instance=solver({solve:async()=>{calls++;return {answer:{pixelsFromSliderOrigin:7},durationMs:1};}});
  const transport={
    connection:async()=>({ws:'fixture',targets:async()=>[{id:'existing',type:'page',url:fixtureUrl}]}),
    connect:async()=>({send:async()=>{created++;throw new Error('existing task page must be reused');},close(){}}),
    pageById:async()=>f.bridge,
    poll:async callback=>{for(let i=0;i<20;i++){const value=await callback();if(value)return value;await wait(5);}throw new Error('fixture polling timeout');}
  };
  const adapter=createTemuFrontBrowser({},transport,{captchaSolver:instance});
  const result=await adapter.search({...c.args,browserConfig:{type:'chrome'},tabs:{search:'existing'},keyword:'fixture',limit:1,onTarget:()=>{throw new Error('must not replace the task page');}});
  assert.equal(result.status,'ready');assert.deepEqual(result.products,[{sourceUrl,title:'fixture product'}]);
  assert.equal(calls,1);assert.equal(created,0);assert.deepEqual(f.requests,[fixtureUrl]);
});

async function linearFixture(t,{cssPerPointer=1,replaceOnPress=false,ignoreDrag=false,networkOnRelease=false}={}){
  const context=await browser.newContext({viewport:{width:900,height:700}});
  t.after(()=>context.close());
  const requests=[];
  await context.route('**/*',async route=>{
    requests.push(route.request().url());
    assert.equal(route.request().url(),fixtureUrl,'the linear fixture must not contact an external service');
    await route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body></body></html>'});
  });
  const page=await context.newPage();await page.goto(fixtureUrl);
  const ids={scene:'scene-'+randomUUID(),piece:'piece-'+randomUUID(),handle:'handle-'+randomUUID()};
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <div id="verification"><div role="dialog" style="position:absolute;left:60px;top:50px;width:414px;transform:scale(.9);transform-origin:top left">
      <p style="margin:0 0 12px">请拖动滑块完成验证</p>
      <div id="${ids.scene}" style="position:relative;width:414px;height:230px">
        <img class="bgImg-1RpoX" src="${images.linearPuzzle}" draggable="false" style="display:block;width:414px;height:230px">
        <div id="${ids.piece}" style="position:absolute;top:140px;left:0;width:72px;height:72px">
          <img src="${images.linearPiece}" draggable="false" style="display:block;width:72px;height:72px;pointer-events:none">
        </div>
      </div>
      <div class="handleBar-vT4I5" style="position:relative;width:414px;height:44px;margin-top:18px">
        <div id="${ids.handle}" style="position:absolute;left:0;top:50%;width:72px;height:100%;cursor:pointer;transform:translateY(-50%);background:#333;z-index:2;user-select:none"></div>
        <div class="slideBtnBg" style="position:absolute;inset:0;background:#aaa;pointer-events:none"></div>
      </div>
    </div></div>
  </body></html>`);
  const ratio=0.25,expectedPointer=414*ratio/cssPerPointer;
  await page.evaluate(async config=>{
    await Promise.all([...document.images].map(image=>image.decode()));
    const handle=document.getElementById(config.ids.handle),piece=document.getElementById(config.ids.piece),pieceImage=piece.querySelector('img');
    const state=window.linearFixture={held:false,startX:0,distance:0,events:[],submissions:0,network:false};
    handle.addEventListener('mousedown',event=>{
      event.preventDefault();state.held=true;state.startX=event.clientX;state.events.push({type:'press',distance:0});
      if(config.replaceOnPress)pieceImage.src=config.newPiece;
    });
    document.addEventListener('mousemove',event=>{
      if(!state.held||config.ignoreDrag)return;
      state.distance=Math.max(0,event.clientX-state.startX);
      const left=Math.min(342,state.distance*config.cssPerPointer);
      handle.style.left=left+'px';piece.style.left=left+'px';
      state.events.push({type:'move',distance:state.distance,buttons:event.buttons});
    });
    document.addEventListener('mouseup',()=>{
      if(!state.held)return;
      state.held=false;state.events.push({type:'release',distance:state.distance});
      if(state.distance>0)state.submissions++;
      if(Math.abs(state.distance-config.expectedPointer)>1.5)return;
      document.querySelector('#verification')?.remove();
      if(config.networkOnRelease){
        state.network=true;history.replaceState({},'', '/bgn_no_access.html');document.body.append(document.createTextNode('没有网络连接'));return;
      }
      const link=document.createElement('a');link.href=config.sourceUrl;link.textContent='linear fixture product';const list=document.createElement('div');list.className='js-search-goodsList';const grid=document.createElement('div');grid.className='autoFitGoodsList';grid.append(link);list.append(grid);document.body.append(list);
    });
  },{ids,cssPerPointer,replaceOnPress,ignoreDrag,networkOnRelease,newPiece:images.linearNewPiece,expectedPointer,sourceUrl});
  const cdp=await context.newCDPSession(page),inputEvents=[];
  const f={page,context,ids,requests,inputEvents,ratio,expectedPointer};
  f.bridge={
    evaluate:(...args)=>page.evaluate(...args),
    send:async(method,parameters)=>{
      if(method==='Input.dispatchMouseEvent')inputEvents.push({...parameters});
      return cdp.send(method,parameters);
    },close(){}
  };
  f.state=()=>page.evaluate(()=>({...window.linearFixture,challenge:!!document.querySelector('#verification'),pieceSource:document.querySelector('#verification img:not([class])')?.src}));
  return f;
}

function linearSolver(f,client){
  let networkPolls=0;
  return solver(client,{pause:async()=>{
    // Permit image-load and DOM tasks to settle; failed fixtures should not spend 12 seconds polling.
    await wait(1);
    const state=await f.state();
    if(state.events.some(event=>event.type==='release')&&state.challenge)throw new Error('fixture: linear answer did not clear the challenge');
    if(state.network&&++networkPolls>1)throw new Error('fixture: network error remains after verification');
  }});
}

test('linear dynamic-ID template is detected through a scaled dialog without leaking IDs',async t=>{
  const f=await linearFixture(t),c=callbacks();let calls=0;
  assert.equal(await f.page.locator('#slider,#img-button,#slide-button').count(),0);
  const initial=await f.page.evaluate(readTemuSlider);
  assert.equal(initial?.type,'puzzle');assert.equal(initial.atOrigin,true);assert.equal(initial.usable,true);
  assert.ok(Math.abs(initial.puzzle.rect.width-372.6)<0.1);assert.ok(Math.abs(initial.puzzle.rect.height-207)<0.1);
  for(const id of Object.values(f.ids))assert.equal(JSON.stringify(initial).includes(id),false);
  const result=await linearSolver(f,{solve:async(type,payload)=>{
    calls++;assert.equal(type,'puzzle');assert.deepEqual(Object.keys(payload).sort(),['pieceImageB64','puzzleImageB64']);
    assert.equal((await f.state()).held,true);assert.equal(f.inputEvents.some(event=>event.type==='mouseReleased'),false);
    assert.equal(payload.puzzleImageB64,images.linearPuzzle.split(',')[1]);
    return {answer:{slideXProportion:f.ratio},durationMs:1};
  }}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'solved');assert.equal(calls,1);assert.equal((await f.state()).challenge,false);
  for(const id of Object.values(f.ids))assert.equal(JSON.stringify({intent:c.intent,updates:c.updates,result}).includes(id),false);
  assert.deepEqual(f.requests,[fixtureUrl]);
});

test('linear mousedown replacement uses the newly displayed piece image in the only API call',async t=>{
  const f=await linearFixture(t,{replaceOnPress:true}),c=callbacks();let calls=0;
  const result=await linearSolver(f,{solve:async(type,payload)=>{
    calls++;assert.equal(type,'puzzle');assert.equal((await f.state()).held,true);
    assert.equal(payload.pieceImageB64,images.linearNewPiece.split(',')[1]);
    assert.notEqual(payload.pieceImageB64,images.linearPiece.split(',')[1]);
    return {answer:{slideXProportion:f.ratio},durationMs:1};
  }}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'solved');assert.equal(calls,1);assert.equal(c.intent.length,1);
});

test('linear probing measures a non-unit drag mapping before calculating the answer position',async t=>{
  const f=await linearFixture(t,{cssPerPointer:0.8}),c=callbacks();let calls=0;
  const initial=await f.page.evaluate(readTemuSlider);
  const result=await linearSolver(f,{solve:async()=>{
    calls++;
    const state=await f.state();assert.equal(state.held,true);assert.equal(state.distance,0);
    assert.ok(state.events.some(event=>event.type==='move'&&Math.abs(event.distance-10)<1));
    assert.equal(state.events.some(event=>event.type==='release'),false);
    return {answer:{slideXProportion:f.ratio},durationMs:1};
  }}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'solved');assert.equal(calls,1);
  const releases=f.inputEvents.filter(event=>event.type==='mouseReleased');assert.equal(releases.length,1);
  assert.ok(Math.abs(releases[0].x-initial.handle.x-f.expectedPointer)<1,'the measured .72 rendered/pointer ratio must determine the release coordinate');
  assert.equal((await f.state()).submissions,1);
});

test('linear probe with no actual movement never creates a billable request',async t=>{
  const f=await linearFixture(t,{ignoreDrag:true}),c=callbacks();let calls=0;
  const result=await linearSolver(f,{solve:async()=>{calls++;return {answer:{slideXProportion:f.ratio},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.notEqual(result.status,'solved');assert.equal(calls,0);assert.equal(c.intent.length,0);
  const state=await f.state();assert.equal(state.held,false);assert.equal(state.submissions,0);assert.equal(state.challenge,true);
});

test('linear challenge disappearance followed by a network error is not recorded as solved',async t=>{
  const f=await linearFixture(t,{networkOnRelease:true}),c=callbacks();let calls=0;
  const result=await linearSolver(f,{solve:async()=>{calls++;return {answer:{slideXProportion:f.ratio},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.notEqual(result.status,'solved');assert.equal(calls,1);
  const state=await f.state();assert.equal(state.challenge,false);assert.equal(state.network,true);assert.equal(state.held,false);
  assert.equal((await f.page.evaluate(readTemuPage)).status,'waiting-network');assert.equal(c.updates.some(update=>update.status==='solved'),false);
});


test('verification success requires the intended usable Temu target rather than login, blank or another query',()=>{
  const ready={status:'ready',url:fixtureUrl,searchListStatus:'ready',products:[{sourceUrl}]};
  assert.equal(isTemuVerificationReturn(ready,{keyword:'fixture'}),true);
  for(const changed of [{status:'waiting-login'},{status:'waiting-plugin'},{status:'waiting-network'},{url:'about:blank'},{url:'https://www.temu.com/search_result.html?search_key=other'},{products:[]},{searchListStatus:'unavailable'}])assert.equal(isTemuVerificationReturn({...ready,...changed},{keyword:'fixture'}),false);
  assert.equal(isTemuVerificationReturn({status:'ready',url:sourceUrl,button:{x:1,y:2}},{goodsId:'601105252678121'}),true);
  assert.equal(isTemuVerificationReturn({status:'ready',url:sourceUrl,button:null},{goodsId:'601105252678121'}),false);
});

test('linear press waits for a replacement image before the sole recognition request',async t=>{
  const f=await linearFixture(t,{replaceOnPress:true}),c=callbacks(),evaluate=f.bridge.evaluate;
  let delayed=false,calls=0;
  f.bridge.evaluate=async(fn,arg)=>{
    if(fn===readTemuSlider&&(await f.state()).held&&!delayed){delayed=true;return null;}
    return evaluate(fn,arg);
  };
  const result=await linearSolver(f,{solve:async()=>{assert.equal(delayed,true);calls++;return {answer:{slideXProportion:f.ratio},durationMs:1};}}).solve({page:f.bridge,args:c.args,readPage:readTemuPage});
  assert.equal(result.status,'solved');assert.equal(calls,1);assert.equal((await f.state()).held,false);
});
