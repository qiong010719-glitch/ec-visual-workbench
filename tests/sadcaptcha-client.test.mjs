import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {createSadCaptchaClient} from '../src/sadcaptcha-client.mjs';

const key='fake-key-only-for-tests';
const puzzle={puzzleImageB64:'cHV6emxl',pieceImageB64:'cGllY2U='};
const trajectory={
  puzzle_image_b64:puzzle.puzzleImageB64,piece_image_b64:puzzle.pieceImageB64,
  slide_piece_trajectory:[
    {pixels_from_slider_origin:0,piece_rotation_angle:0,piece_center:{proportionX:0.1,proportionY:0.2}},
    {pixels_from_slider_origin:1,piece_rotation_angle:-0.8,piece_center:{proportionX:0.12,proportionY:0.19}}
  ]
};
const points=[{proportionX:0.25,proportionY:0.5},{proportionX:0.75,proportionY:0.9}];
const response=(data,status=200)=>({status,json:async()=>data});
const fixture=fetchImpl=>createSadCaptchaClient({SADCAPTCHA_API_KEY:key},{fetchImpl});

function safeError(error,code,isUnknown,httpStatus){
  assert.equal(error.code,code);
  assert.equal(error.isUnknown,isUnknown);
  assert.equal(error.httpStatus,httpStatus);
  assert.equal(error.cause,undefined);
  const rendered=inspect(error,{depth:10})+JSON.stringify(error);
  for(const forbidden of [key,encodeURIComponent(key),'licenseKey','provider-secret-body','private-image'])assert.ok(!rendered.includes(forbidden));
  return true;
}

test('credits uses the official HTTPS endpoint and reads the key live',async()=>{
  const config={SADCAPTCHA_API_KEY:key,SADCAPTCHA_BASE_URL:'http://untrusted.invalid'};
  const requests=[];
  const client=createSadCaptchaClient(config,{fetchImpl:async(url,options)=>{requests.push({url,options});return response({credits:17,licenseKey:key});}});
  assert.deepEqual(await client.credits(),{credits:17});
  config.SADCAPTCHA_API_KEY='changed-key';
  assert.deepEqual(await client.credits(),{credits:17});
  assert.equal(requests.length,2);
  for(const {url,options} of requests){
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://www.sadcaptcha.com');
    assert.equal(parsed.pathname,'/api/v1/license/credits');
    assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(new URL(requests[0].url).searchParams.get('licenseKey'),key);
  assert.equal(new URL(requests[1].url).searchParams.get('licenseKey'),'changed-key');
});

test('puzzle sends the documented schema and exposes only its validated answer',async()=>{
  let calls=0;
  const client=fixture(async(url,options)=>{
    calls++;
    assert.equal(new URL(url).pathname,'/api/v1/puzzle');
    assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'application/json');
    assert.deepEqual(JSON.parse(options.body),puzzle);
    return response({slideXProportion:0.625,licenseKey:key,debug:'private-image'});
  });
  const result=await client.solve('puzzle',{...puzzle,licenseKey:'do-not-forward'});
  assert.deepEqual(result.answer,{slideXProportion:0.625});
  assert.equal(Object.keys(result).sort().join(','),'answer,durationMs');
  assert.ok(Number.isInteger(result.durationMs)&&result.durationMs>=0);
  assert.equal(calls,1);
});

test('arced slide preserves snake_case request fields with camelCase normalized centers',async()=>{
  const client=fixture(async(url,options)=>{
    assert.equal(new URL(url).pathname,'/api/v1/temu-arced-slide');
    assert.deepEqual(JSON.parse(options.body),trajectory);
    return response({pixelsFromSliderOrigin:123});
  });
  assert.deepEqual((await client.solve('temu-arced-slide',trajectory)).answer,{pixelsFromSliderOrigin:123});
});

test('two-image and swap-two use the official schema and preserve ordered points',async()=>{
  const pending=[
    {type:'temu-two-image',payload:{challenge:'Click matching letters',images_b64:[puzzle.puzzleImageB64,puzzle.pieceImageB64]}},
    {type:'temu-swap-two',payload:{image_b64:puzzle.puzzleImageB64}}
  ];
  let calls=0;
  const client=fixture(async(url,options)=>{
    const expected=pending[calls++];
    assert.equal(new URL(url).pathname,`/api/v1/${expected.type}`);
    assert.deepEqual(JSON.parse(options.body),expected.payload);
    return response({proportionalPoints:points.map(p=>({...p,licenseKey:key}))});
  });
  for(const {type,payload} of pending)assert.deepEqual((await client.solve(type,payload)).answer,{proportionalPoints:points});
  assert.equal(calls,2);
});

test('semantic-items sends the verified English challenge schema and returns normalized points',async()=>{
  let calls=0;
  const payload={challenge:'Please click the ball closest to the train.',image_b64:puzzle.puzzleImageB64};
  const client=fixture(async(url,options)=>{
    calls++;assert.equal(new URL(url).origin,'https://www.sadcaptcha.com');
    assert.equal(new URL(url).pathname,'/api/v1/semantic-items');
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    assert.deepEqual(JSON.parse(options.body),payload);
    return response({proportionalPoints:[{...points[0],licenseKey:key}],debug:'private-image'});
  });
  const result=await client.solve('semantic-items',{...payload,challenge:'  '+payload.challenge+'  ',licenseKey:'do-not-forward'});
  assert.deepEqual(result.answer,{proportionalPoints:[points[0]]});
  assert.ok(Number.isInteger(result.durationMs)&&result.durationMs>=0);assert.equal(calls,1);
});

test('semantic-items validates its required image and challenge before requesting a solution',async()=>{
  let calls=0;
  const client=fixture(async()=>{calls++;throw new Error('unexpected API request');});
  for(const payload of [
    {image_b64:puzzle.puzzleImageB64},
    {challenge:'  ',image_b64:puzzle.puzzleImageB64},
    {challenge:'Please click the ball closest to the train.'},
    {challenge:'Please click the ball closest to the train.',image_b64:'https://example.invalid/image.png'}
  ])await assert.rejects(client.solve('semantic-items',payload),e=>safeError(e,'SADCAPTCHA_INVALID_INPUT',false));
  assert.equal(calls,0);
  for(const data of [{proportionalPoints:[]},{proportionalPoints:[{proportionX:-0.1,proportionY:0.5}]}]){
    const invalidClient=fixture(async()=>{calls++;return response(data);});
    await assert.rejects(invalidClient.solve('semantic-items',{challenge:'Please click the ball closest to the train.',image_b64:puzzle.puzzleImageB64}),e=>safeError(e,'SADCAPTCHA_INVALID_RESPONSE',true));
  }
  assert.equal(calls,2,'invalid successful responses must not be retried');
});

const gridPayload={objectsOfInterest:['train','ball','chair'],images:Array.from({length:9},(_,i)=>Buffer.from('tile-'+i).toString('base64'))};
test('three-by-three sends only ordered objects and nine raw images, preserving solution order',async()=>{
  let calls=0;
  const client=fixture(async(url,options)=>{
    calls++;assert.equal(new URL(url).origin,'https://www.sadcaptcha.com');assert.equal(new URL(url).pathname,'/api/v1/temu-three-by-three');
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),gridPayload);
    return response({solutionIndices:[8,0,4],licenseKey:key,debug:'private-image'});
  });
  const result=await client.solve('temu-three-by-three',{...gridPayload,objectsOfInterest:[' train ','ball','chair'],baseImageB64:'must-not-be-sent',challengeText:'must-not-be-sent'});
  assert.deepEqual(result.answer,{solutionIndices:[8,0,4]});assert.ok(Number.isInteger(result.durationMs)&&result.durationMs>=0);assert.equal(calls,1);
});

test('three-by-three rejects malformed object lists and image counts before an API request',async()=>{
  let calls=0;
  const client=fixture(async()=>{calls++;throw new Error('unexpected API request');});
  for(const payload of [
    {images:gridPayload.images},{...gridPayload,objectsOfInterest:[]},{...gridPayload,objectsOfInterest:Array(10).fill('ball')},
    {...gridPayload,objectsOfInterest:[' ']},{...gridPayload,objectsOfInterest:[3]},
    {objectsOfInterest:gridPayload.objectsOfInterest},{...gridPayload,images:gridPayload.images.slice(0,8)},
    {...gridPayload,images:[...gridPayload.images,gridPayload.images[0]]},
    {...gridPayload,images:[...gridPayload.images.slice(0,8),'https://example.invalid/tile.png']}
  ])await assert.rejects(client.solve('temu-three-by-three',payload),e=>safeError(e,'SADCAPTCHA_INVALID_INPUT',false));
  assert.equal(calls,0);
});

test('three-by-three rejects empty, noninteger and out-of-grid solutions without retrying',async()=>{
  for(const data of [{solutionIndices:[]},{solutionIndices:[-1]},{solutionIndices:[9]},{solutionIndices:[1.5]},{solutionIndices:['1']},{pixelsFromSliderOrigin:4}]){
    let calls=0;
    const client=fixture(async()=>{calls++;return response(data);});
    await assert.rejects(client.solve('temu-three-by-three',gridPayload),e=>safeError(e,'SADCAPTCHA_INVALID_RESPONSE',true));
    assert.equal(calls,1);
  }
});

test('missing keys, unsupported types and malformed payloads do not contact the provider',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw new Error('unexpected request');};
  const client=fixture(fetchImpl);
  await assert.rejects(createSadCaptchaClient({}, {fetchImpl}).credits(),e=>safeError(e,'SADCAPTCHA_MISSING_KEY',false));
  await assert.rejects(client.solve('https://evil.invalid',puzzle),e=>safeError(e,'SADCAPTCHA_UNSUPPORTED_TYPE',false));
  for(const [type,payload] of [
    ['puzzle',{}],['puzzle',{...puzzle,pieceImageB64:'https://evil.invalid/piece.png'}],
    ['puzzle',{...puzzle,pieceImageB64:'data:image/png;base64,cGllY2U='}],
    ['puzzle',{...puzzle,pieceImageB64:'x'}],
    ['temu-arced-slide',{...trajectory,slide_piece_trajectory:[]}],
    ['temu-arced-slide',{...trajectory,slide_piece_trajectory:[{...trajectory.slide_piece_trajectory[0],pixels_from_slider_origin:0.5}]}],
    ['temu-arced-slide',{...trajectory,slide_piece_trajectory:[{...trajectory.slide_piece_trajectory[0],piece_center:{proportion_x:0.1,proportion_y:0.2}}]}],
    ['temu-two-image',{challenge:'test',images_b64:[puzzle.puzzleImageB64]}],
    ['temu-swap-two',{}]
  ])await assert.rejects(client.solve(type,payload),e=>safeError(e,'SADCAPTCHA_INVALID_INPUT',false));
  assert.equal(calls,0);
});

test('HTTP failures carry a numeric status without exposing response bodies or retrying',async()=>{
  let calls=0,reads=0,cancelled=0;
  const client=fixture(async()=>{
    calls++;
    return {status:403,statusText:`licenseKey=${key}`,body:{cancel:async()=>{cancelled++;}},json:async()=>{reads++;return {message:'provider-secret-body '+key};}};
  });
  await assert.rejects(client.solve('puzzle',puzzle),e=>safeError(e,'SADCAPTCHA_HTTP_ERROR',false,403));
  assert.equal(calls,1);assert.equal(reads,0);assert.equal(cancelled,1);
});

test('network failure is uncertain and never forwards upstream messages or causes',async()=>{
  let calls=0;
  const client=fixture(async()=>{calls++;throw new Error(`https://www.sadcaptcha.com/api/v1/puzzle?licenseKey=${key}`,{cause:new Error('provider-secret-body')});});
  await assert.rejects(client.solve('puzzle',puzzle),e=>safeError(e,'SADCAPTCHA_NETWORK_ERROR',true));
  assert.equal(calls,1);
});

test('body cleanup failures cannot replace a definite HTTP rejection',async()=>{
  const client=fixture(async()=>({status:429,body:{cancel:()=>{throw new Error('provider-secret-body '+key);}}}));
  await assert.rejects(client.solve('puzzle',puzzle),e=>safeError(e,'SADCAPTCHA_HTTP_ERROR',false,429));
});

test('a disconnected response body is an uncertain network error without retry',async()=>{
  let calls=0;
  const client=fixture(async()=>{calls++;return {status:200,json:async()=>{throw new TypeError('provider-secret-body '+key);}};});
  await assert.rejects(client.solve('puzzle',puzzle),e=>safeError(e,'SADCAPTCHA_NETWORK_ERROR',true));
  assert.equal(calls,1);
});

test('an aborted fetch is uncertain and is not retried',async()=>{
  let calls=0;
  const client=fixture(async()=>{calls++;throw new DOMException(`licenseKey=${key}`,'AbortError');});
  await assert.rejects(client.solve('puzzle',puzzle),e=>safeError(e,'SADCAPTCHA_TIMEOUT',true));
  assert.equal(calls,1);
});

test('the 30 second deadline aborts a fetch that ignores its signal',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0,signal;
  const client=fixture(async(_url,options)=>{calls++;signal=options.signal;return new Promise(()=>{});});
  const pending=client.solve('puzzle',puzzle);
  const checked=assert.rejects(pending,e=>safeError(e,'SADCAPTCHA_TIMEOUT',true));
  t.mock.timers.tick(29_999);assert.equal(signal.aborted,false);
  t.mock.timers.tick(1);await checked;
  assert.equal(signal.aborted,true);assert.equal(calls,1);
});

test('the same deadline covers a response whose JSON body never completes',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0,signal;
  const client=fixture(async(_url,options)=>{calls++;signal=options.signal;return {status:200,json:()=>new Promise(()=>{})};});
  const pending=client.solve('puzzle',puzzle);
  const checked=assert.rejects(pending,e=>safeError(e,'SADCAPTCHA_TIMEOUT',true));
  await Promise.resolve();await Promise.resolve();
  t.mock.timers.tick(30_000);await checked;
  assert.equal(signal.aborted,true);assert.equal(calls,1);
});

test('malformed success responses are uncertain instead of authorizing unsafe mouse actions',async()=>{
  const cases=[
    ['puzzle',puzzle,{slideXProportion:-0.1}],['puzzle',puzzle,{slideXProportion:1.01}],
    ['puzzle',puzzle,{slideXProportion:`licenseKey=${key}`}],
    ['temu-arced-slide',trajectory,{pixelsFromSliderOrigin:1.2}],
    ['temu-arced-slide',trajectory,{pixelsFromSliderOrigin:-1}],
    ['temu-two-image',{challenge:'test',images_b64:[puzzle.puzzleImageB64,puzzle.pieceImageB64]},{proportionalPoints:[{proportionX:2,proportionY:0.5}]}],
    ['temu-swap-two',{image_b64:puzzle.puzzleImageB64},{proportionalPoints:points.slice(0,1)}]
  ];
  for(const [type,payload,data] of cases){
    let calls=0;
    const client=fixture(async()=>{calls++;return response(data);});
    await assert.rejects(client.solve(type,payload),e=>safeError(e,'SADCAPTCHA_INVALID_RESPONSE',true));
    assert.equal(calls,1);
  }
  await assert.rejects(fixture(async()=>response({credits:-1})).credits(),e=>safeError(e,'SADCAPTCHA_INVALID_RESPONSE',true));
  await assert.rejects(fixture(async()=>({status:200,json:async()=>{throw new SyntaxError('provider-secret-body '+key);}})).solve('puzzle',puzzle),e=>safeError(e,'SADCAPTCHA_INVALID_RESPONSE',true));
});
