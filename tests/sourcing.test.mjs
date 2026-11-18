import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {signGeekbi,createGeekbiClient,normalizeSearch,temuGoodsId,GEEKBI_ROUTES} from '../src/geekbi.mjs';
import {createSourcing} from '../src/sourcing.mjs';
import {createSettings} from '../src/settings.mjs';
import {createWorkbench} from '../src/server.mjs';

const goodsId='601105252678120',original=`https://www.temu.com/jp-zh-Hans/canvas-g-${goodsId}.html`;
const sample={goodsId,goodsName:'Original title',minPrice:8.04,monthSold:1,siteId:48,linkUrl:`https://www.geekbi.com/data/goods/detail?goodsId=${goodsId}&siteId=48`};
const sites=[{siteId:48,regionId:211,cnName:'美国',currency:'USD'}];
const configuration={WORKBENCH_FRESH:'true',GB_APP_KEY:'test-key',GB_APP_SECRET:'test-secret'};
const prefs={erp:()=>({key:'erp-a',provider:'dianxiaomi',browserKey:'chrome-a',expectedAccount:'account-a',name:'店小秘A'}),browser:()=>({key:'chrome-a',type:'chrome',debugPort:9333})};
const codec={encode:s=>Buffer.from(s).toString('base64'),decode:s=>Buffer.from(s,'base64').toString()};
function folder(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function idle(service){const deadline=Date.now()+3000;while(service.isBusy()){if(Date.now()>deadline)throw new Error('test did not settle');await new Promise(r=>setTimeout(r,5));}}
async function fixture(t,extras={}){
  const directory=folder(t),calls=[];
  const client=async(kind,params)=>{calls.push({kind,params});return {data:kind==='sites'?sites:{list:[sample],total:1},receivedAt:'2026-11-17T00:00:00.000Z',chargedPoints:kind==='sites'?0:10};};
  const options={directory,configuration:{...configuration},preferences:prefs,client,...extras};
  const service=createSourcing(options);await service.sites();return {directory,options,service,calls};
}
const query={requestId:'search-0001',keywords:'canvas art',siteId:48,size:3};

test('GeekBI signature matches the documented canonical GET and refuses non-allowlisted routes',()=>{
  const r=signGeekbi(GEEKBI_ROUTES.search,{size:3,siteId:48,page:1,keyword:'canvas art',catIds:[10,20]},'test-key','test-secret',{timestamp:'1700000000',nonce:'test-nonce'});
  assert.equal(r.headers['X-GB-Signature'],'Yb4ihPP+EcMmdmvdPL0Dhoqon7DE42oYHBXE9HLU0Bk=');
  assert.match(r.url,/catIds=10%2C20&keyword=canvas\+art/);
  assert.throws(()=>signGeekbi('/api/admin',{},'a','b'),/未开放/);
  assert.equal(temuGoodsId(sample.linkUrl),null);assert.equal(temuGoodsId(original),goodsId);
  assert.equal(temuGoodsId('https://www.temu.com.evil.test/canvas-g-'+goodsId+'.html'),null);
  assert.equal(temuGoodsId('https://www.temu.com/search_result.html?search_key='+goodsId),null);
  assert.throws(()=>normalizeSearch({...query,priceMin:10,priceMax:5}),/下限/);
});

test('API timeout sends once and redacts service errors',async()=>{
  let attempts=0;const request=createGeekbiClient(configuration,{fetcher:async()=>{attempts++;throw new Error('timeout');}});
  await assert.rejects(request('search'),e=>e.uncertain&&/不会自动重发/.test(e.message));assert.equal(attempts,1);
  const denied=createGeekbiClient(configuration,{fetcher:async()=>new Response(JSON.stringify({message:'bad test-secret test-key'}),{status:403})});
  await assert.rejects(denied('search'),e=>!e.message.includes('test-secret')&&!e.message.includes('test-key'));
});

test('search preserves provider fields, does not use the GeekBI page as a Temu source, and is idempotent',async t=>{
  const {service,calls,directory}=await fixture(t);service.startSearch(query);await idle(service);
  const s=service.getSearch(query.requestId);assert.equal(s.status,'completed');assert.deepEqual(s.rows[0].raw,sample);assert.equal(s.rows[0].sourceUrl,null);
  assert.ok(fs.existsSync(path.join(directory,'search-0001-1.json')));
  service.startSearch(query);assert.equal(calls.filter(c=>c.kind==='search').length,1);
  assert.throws(()=>service.startSearch({...query,keywords:'changed'}),/同一个查询编号/);
});

test('keyword and explicit match mode reach the signed API independently for consecutive searches',async t=>{
  const sent=[];
  const client=createGeekbiClient(configuration,{fetcher:async url=>{
    const u=new URL(url),params=Object.fromEntries(u.searchParams);sent.push(params);
    const data=u.pathname===GEEKBI_ROUTES.sites?sites:{total:params.keyword==='missing'?0:1,list:params.keyword==='missing'?[]:[{...sample,goodsId:params.keyword==='帆布画'?goodsId:'601105252678121',goodsName:params.keyword}]};
    return new Response(JSON.stringify({code:0,data}),{headers:{'x-gb-price-points':'0'}});
  }});
  const f=await fixture(t,{client});
  f.service.startSearch({...query,keywords:'帆布画'});await idle(f.service);
  f.service.startSearch({...query,requestId:'search-0002',keywords:'电水壶',matchMode:'2'});await idle(f.service);
  f.service.startSearch({...query,requestId:'search-0003',keywords:'missing'});await idle(f.service);
  assert.deepEqual(sent.filter(x=>x.keyword).map(x=>[x.keyword,x.matchMode]),[['帆布画','1'],['电水壶','2'],['missing','1']]);
  assert.equal(f.service.getSearch('search-0001').rows[0].raw.goodsName,'帆布画');
  assert.equal(f.service.getSearch('search-0002').rows[0].raw.goodsName,'电水壶');
  assert.deepEqual(f.service.getSearch('search-0003').rows,[]);
  assert.equal(f.service.getSearch('search-0003').status,'completed');
  assert.throws(()=>normalizeSearch({...query,matchMode:3}),/严格匹配/);
});

test('legacy fuzzy search replay returns its original receipt without another paid request',async t=>{
  const f=await fixture(t);f.service.startSearch(query);await idle(f.service);
  const file=path.join(f.directory,'state.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));
  delete saved.searches[query.requestId].filters.matchMode;
  saved.searches[query.requestId].fingerprint=JSON.stringify(saved.searches[query.requestId].filters);
  fs.writeFileSync(file,JSON.stringify(saved));
  let calls=0;const restored=createSourcing({...f.options,client:async()=>{calls++;throw new Error('must not call');}});
  assert.equal(restored.startSearch(query).rows.length,1);
  assert.equal(restored.getSearch(query.requestId).filters.matchMode,undefined);
  assert.throws(()=>restored.startSearch({...query,matchMode:1}),/同一个查询编号/);
  assert.equal(calls,0);
});

test('uncertain search cannot be silently reissued after restart',async t=>{
  let count=0;const f=await fixture(t);const client=async kind=>{if(kind==='sites')return {data:sites};count++;throw Object.assign(new Error('timeout'),{uncertain:true});};
  const s=createSourcing({...f.options,client});s.startSearch(query);await idle(s);assert.equal(s.getSearch(query.requestId).status,'needs-review');
  const restored=createSourcing({...f.options,client});restored.startSearch(query);assert.equal(count,1);
});

test('collection binds account, preserves original URL, stops on failure and prevents duplicate submission',async t=>{
  const attempts=[];const adapter={resolve:async()=>({sourceUrl:original}),collect:async args=>{assert.equal(args.erpConnection.expectedAccount,'account-a');assert.equal(args.sourceUrl,original);args.beforeSubmit();attempts.push(args.goodsId);return {status:'failed',error:'插件采集更可靠'};}};
  const f=await fixture(t,{adapter});f.service.startSearch(query);await idle(f.service);
  const payload={requestId:'batch-0001',searchId:query.requestId,erpKey:'erp-a',goodsIds:[goodsId]};f.service.startBatch(payload);await idle(f.service);
  assert.equal(f.service.getBatch(payload.requestId).rows[0].status,'failed');assert.equal(attempts.length,1);
  f.service.startBatch(payload);assert.equal(attempts.length,1);
  assert.throws(()=>f.service.startBatch({...payload,requestId:'batch-0002'}),/已有提交记录/);
  const restored=createSourcing(f.options);assert.throws(()=>restored.startBatch({...payload,requestId:'batch-0003'}),/已有提交记录/);
});

test('browser failure after write intent requires review; reconcile performs no new submit',async t=>{
  let submissions=0;const adapter={resolve:async()=>({sourceUrl:original}),collect:async args=>{args.beforeSubmit();submissions++;throw new Error('connection lost');},verify:async()=>({status:'verified',evidence:{tab:'未认领',sourceUrl:original}})};
  const f=await fixture(t,{adapter});f.service.startSearch(query);await idle(f.service);
  f.service.startBatch({requestId:'batch-0001',searchId:query.requestId,erpKey:'erp-a',goodsIds:[goodsId]});await idle(f.service);
  assert.equal(f.service.getBatch('batch-0001').rows[0].status,'needs-review');
  const checked=await f.service.reconcile('batch-0001');assert.equal(checked.status,'completed');assert.equal(submissions,1);
});

test('saved GeekBI credentials are hidden in settings and persist through the secret codec',t=>{
  const directory=folder(t),config={};const p=createSettings({directory,configuration:config,codec});p.update({revision:0,models:{GB_APP_KEY:'key-secret',GB_APP_SECRET:'real-secret'}});
  assert.equal(p.view().models.GB_APP_KEYConfigured,true);assert.equal(p.view().models.GB_APP_SECRETConfigured,true);assert.ok(!JSON.stringify(p.view()).includes('real-secret'));
  assert.ok(!fs.readFileSync(path.join(directory,'secrets.json'),'utf8').includes('real-secret'));
  const restored={};createSettings({directory,configuration:restored,codec});assert.equal(restored.GB_APP_SECRET,'real-secret');
});

test('workbench serves new module and rejects cross-site collection requests',async t=>{
  const dataDirectory=folder(t);const app=createWorkbench({dataDirectory,configuration,settingsCodec:codec,sourcingClient:async()=>({data:sites})});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));const base='http://127.0.0.1:'+app.server.address().port;
  assert.match(await (await fetch(base+'/sourcing')).text(),/自动选品上架/);
  assert.equal((await fetch(base+'/api/sourcing/sites',{method:'POST',body:'{}'})).status,403);
  const {token}=await (await fetch(base+'/api/session')).json();const response=await fetch(base+'/api/sourcing/sites',{method:'POST',headers:{'X-Workbench-Token':token,'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),sites);
  const status=await (await fetch(base+'/api/status')).json();assert.ok(status.sourcingRevision);
});
