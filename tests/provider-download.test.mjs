import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {downloadImage,createImageProvider} from '../src/provider.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
const address='https://generated.example/result.png';
function network(t,respond){
  t.mock.method(dns,'lookup',async()=>[{address:'203.0.113.11',family:4}]);
  let calls=0;
  t.mock.method(https,'get',(...args)=>{
    const callback=args.at(-1),request=new EventEmitter();
    request.setTimeout=()=>request;request.destroy=error=>{queueMicrotask(()=>request.emit('error',error));return request;};
    queueMicrotask(()=>respond(++calls,request,callback));return request;
  });
  return ()=>calls;
}
function imageResponse(callback,status=200){
  const response=new PassThrough();response.statusCode=status;response.headers={'content-length':String(png.length),'content-type':'image/png'};
  callback(response);response.end(png);
}

test('transient image download failures retry the existing URL',async t=>{
  const count=network(t,(call,request,callback)=>call<3?request.emit('error',Object.assign(new Error('connection reset'),{code:'ECONNRESET'})):imageResponse(callback));
  assert.deepEqual(await downloadImage(address,{attempts:3,retryDelayMs:1}),png);
  assert.equal(count(),3);
});

test('expired image links fail without repeated downloads',async t=>{
  const count=network(t,(_call,_request,callback)=>imageResponse(callback,403));
  await assert.rejects(downloadImage(address,{attempts:3,retryDelayMs:1}),/403/);
  assert.equal(count(),1);
});

test('partial image bodies are retried instead of saved as complete images',async t=>{
  const count=network(t,(call,_request,callback)=>{
    const response=new PassThrough();response.statusCode=200;response.headers={'content-length':String(call===1?png.length+10:png.length)};
    callback(response);response.end(png);
  });
  assert.deepEqual(await downloadImage(address,{attempts:2,retryDelayMs:1}),png);assert.equal(count(),2);
});

test('a connection that never finishes is bounded by the overall download deadline',async t=>{
  network(t,()=>{});
  await assert.rejects(downloadImage(address,{timeoutMs:15}),{code:'ETIMEDOUT'});
});

test('malformed redirect URLs reject the download without an uncaught callback error',{timeout:1000},async t=>{
  network(t,(_call,_request,callback)=>{
    const response=new PassThrough();response.statusCode=302;response.headers={location:'https://['};callback(response);response.end();
  });
  await assert.rejects(downloadImage(address,{timeoutMs:50}),/URL|地址/);
});

test('configured proxy receives a CONNECT to the validated public IP',async t=>{
  t.mock.method(dns,'lookup',async()=>[{address:'203.0.113.11',family:4}]);
  const connections=[];
  const proxy=http.createServer();proxy.on('connect',(request,socket)=>{connections.push(request.url);socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');});
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>proxy.close(resolve)));
  const nativeGet=https.get;
  // A direct connection is deliberately unavailable; the real local proxy must be reached.
  t.mock.method(https,'get',(...args)=>{
    if((args[0]?.agent||args[1]?.agent))return nativeGet(...args);
    const request=new EventEmitter();request.setTimeout=()=>request;request.destroy=()=>request;
    queueMicrotask(()=>request.emit('error',Object.assign(new Error('direct route unavailable'),{code:'ECONNREFUSED'})));return request;
  });
  await assert.rejects(downloadImage(address,{proxyUrl:'http://127.0.0.1:'+proxy.address().port,attempts:1,timeoutMs:1000}));
  assert.deepEqual(connections,['203.0.113.11:443']);
});

test('provider preserves result URL before downloading and never repeats generation after a download failure',async t=>{
  let submissions=0,saved,downloads=0;
  const upstream=http.createServer(async(req,res)=>{for await(const _ of req){}submissions++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{url:address}]}));});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  network(t,(_call,request)=>request.emit('error',Object.assign(new Error('download offline'),{code:'ECONNREFUSED'})));
  const provider=createImageProvider({SUANZHOU_IMAGE_API_KEY:'image-only-test',SUANZHOU_IMAGE_BASE_URL:'http://127.0.0.1:'+upstream.address().port},'.',{download:async url=>{downloads++;assert.equal(url,address);assert.equal(saved.resultUrl,address);throw new Error('download offline');}});
  await assert.rejects(provider({prompt:'fixture',onProgress:patch=>{saved={...saved,...patch};}}),/download offline/);
  assert.equal(saved?.resultUrl,address);assert.equal(saved?.phase,'downloading');assert.ok(saved?.generationCompletedAt);
  assert.equal(submissions,1);assert.equal(downloads,1);
});

test('inline image preference is sent to both generation and edit endpoints',async t=>{
  const requests=[];
  const upstream=http.createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    requests.push({path:request.url,body:Buffer.concat(chunks).toString('utf8')});
    response.writeHead(200,{'Content-Type':'application/json'});
    response.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  const provider=createImageProvider({
    SUANZHOU_IMAGE_API_KEY:'image-only-test',
    SUANZHOU_IMAGE_BASE_URL:'http://127.0.0.1:'+upstream.address().port,
    SUANZHOU_IMAGE_RESPONSE_FORMAT:'b64_json'
  },'.',{download:()=>{throw new Error('inline result should not need a download');}});
  assert.deepEqual(await provider({prompt:'text-only'}),png);
  assert.deepEqual(await provider({prompt:'with-reference',references:['data:image/png;base64,'+png.toString('base64')]}),png);
  assert.equal(requests[0].path,'/images/generations');
  assert.equal(JSON.parse(requests[0].body).response_format,'b64_json');
  assert.equal(requests[1].path,'/images/edits');
  assert.match(requests[1].body,/name="response_format"\r\n\r\nb64_json/);
});
