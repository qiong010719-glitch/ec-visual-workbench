import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench} from '../src/server.mjs';

test('captcha HTTP reads have no supplier side effect and balance POST requires the local session and same origin',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sadcaptcha-http-'));
  const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},settingsCodec:{encode:s=>Buffer.from(s).toString('base64'),decode:s=>Buffer.from(s,'base64').toString()}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;let checks=0;
  // Replace only the service boundary; no provider API is used by this test.
  app.freeSourcing.checkCaptcha=async()=>{checks++;return {configured:true,provider:'sadcaptcha',credits:31};};
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  const unconfiguredResponse=await fetch(base+'/api/free-sourcing/captcha');assert.equal(unconfiguredResponse.status,200);
  const unconfigured=await unconfiguredResponse.json();assert.equal(unconfigured.configured,false);assert.equal(unconfigured.credits,null);assert.equal(checks,0);
  const post=(route,payload={},extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token,...extra},body:JSON.stringify(payload)});
  const settings=await fetch(base+'/api/settings').then(r=>r.json());
  const savedResponse=await post('/api/settings',{revision:settings.revision,models:{SADCAPTCHA_API_KEY:'fixture-http-key'}});
  assert.equal(savedResponse.status,200);const saved=await savedResponse.json();assert.equal(saved.models.SADCAPTCHA_API_KEYConfigured,true);assert.equal(JSON.stringify(saved).includes('fixture-http-key'),false);
  for(let i=0;i<3;i++){const status=await fetch(base+'/api/free-sourcing/captcha').then(r=>r.json());assert.equal(status.configured,true);assert.equal(status.provider,'sadcaptcha');}
  assert.equal(checks,0);
  const noToken=await fetch(base+'/api/free-sourcing/captcha/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noToken.status,403);assert.equal(checks,0);
  const crossOrigin=await post('/api/free-sourcing/captcha/check',{},{Origin:'https://untrusted.example'});assert.equal(crossOrigin.status,403);assert.equal(checks,0);
  const wrongMethod=await fetch(base+'/api/free-sourcing/captcha/check');assert.equal(wrongMethod.status,404);assert.equal(checks,0);
  const checked=await post('/api/free-sourcing/captcha/check');assert.equal(checked.status,200);assert.equal((await checked.json()).credits,31);assert.equal(checks,1);
  assert.equal(fs.readFileSync(path.join(directory,'preferences','settings.json'),'utf8').includes('fixture-http-key'),false);
  assert.equal(fs.readFileSync(path.join(directory,'preferences','secrets.json'),'utf8').includes('fixture-http-key'),false);
});
