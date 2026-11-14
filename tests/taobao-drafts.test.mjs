import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createWorkbench} from '../src/server.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
async function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'taobao-drafts-'));
  let modelCalls=0;const app=createWorkbench({dataDirectory:directory,configuration:{},researchOptions:{client:{configured:false}},provider:async()=>{modelCalls++;return png;}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await(await fetch(base+'/api/session')).json();
  const call=async(route,body)=>{const r=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  const url=app.saveImage(png),payload={title:'本品',description:'确认的外观',platform:'淘宝',skus:[],images:[url],sop:'已有方案',workbench:{version:1,visualStyle:'original',app:{generationMode:'fast',designScope:'custom',prodName:'本品',prodDesc:'确认的外观',sopText:'已有方案',customLayout:{main:1,sub:0,aplus:0,aplusType:'premium',directives:{0:{req:'本张要求',refs:['own']}},taobao:{mainCount:1,skuCount:0,detailCount:0}},materialMeta:[{id:'own',filename:'产品主体图_1',category:'产品主体图',url,base64:'must-not-persist'}],imageSlots:[{url,id:'done'}],activeAgentTask:'must-not-resume',activeKieTasks:[{taskId:'must-not-resume'}]},benchmark:{}}};
  return {...app,call,payload,url,calls:()=>modelCalls};
}
test('complete drafts retain editable requirements and local material hashes without active jobs or image bytes',async t=>{
  const app=await fixture(t),saved=await app.call('/api/drafts',app.payload);assert.equal(saved.status,200);
  const restored=await app.call('/api/drafts/'+saved.data.id);
  assert.equal(restored.status,200);assert.equal(restored.data.workbench.app.customLayout.directives[0].req,'本张要求');
  assert.equal(restored.data.workbench.app.materialMeta[0].base64,undefined);
  assert.equal(restored.data.workbench.app.activeAgentTask,null);assert.deepEqual(restored.data.workbench.app.activeKieTasks,[]);
  assert.match(restored.data.workbench.media[app.url],/^[a-f0-9]{64}$/);assert.equal(app.calls(),0);
});
test('deleted or changed draft assets stop restoration while preserving the saved record',async t=>{
  const app=await fixture(t),saved=(await app.call('/api/drafts',app.payload)).data;
  const file=path.join(app.mediaDirectory,path.basename(app.url));fs.appendFileSync(file,'changed');
  assert.match((await app.call('/api/drafts/'+saved.id)).data.error,/已变化/);
  fs.unlinkSync(file);assert.match((await app.call('/api/drafts/'+saved.id)).data.error,/已丢失/);
  assert.equal((await app.call('/api/drafts')).data.length,1);assert.equal(app.calls(),0);
});
test('snapshots reject external or nonexistent image paths and unusable benchmark bindings',async t=>{
  const app=await fixture(t);
  for(const url of ['https://example.com/image.png','/media/../private.png','/media/aaaaaaaa.png']){
    const bad=structuredClone(app.payload);bad.workbench.app.materialMeta[0].url=url;
    assert.equal((await app.call('/api/drafts',bad)).status,400);
  }
  const bad=structuredClone(app.payload);bad.workbench.benchmark={jobId:'not_saved',mapping:{}};
  assert.equal((await app.call('/api/drafts',bad)).status,404);assert.equal((await app.call('/api/drafts')).data.length,0);
});
test('legacy draft edits keep complete snapshots, while legacy-only drafts remain exportable',async t=>{
  const app=await fixture(t),saved=(await app.call('/api/drafts',app.payload)).data;
  const {workbench,...legacy}=app.payload;
  const updated=(await app.call('/api/drafts',{...legacy,id:saved.id})).data;assert.deepEqual(updated.workbench,saved.workbench);
  const old=(await app.call('/api/drafts',legacy)).data;assert.equal((await app.call('/api/drafts/'+old.id)).status,404);
  assert.deepEqual(old.images,[app.url]);assert.equal(app.calls(),0);
});
