import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantFixture} from './merchant-fixture.mjs';
import {readWorkbook} from '../src/workbook.mjs';
import {validateChineseTitle,translateChineseTitles} from '../src/listing-titles.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

test('Chinese translation matches IDs and rejects missing or non-Chinese output without retries',async t=>{
  let response=[{setId:'b',chineseTitle:'雪夜街景装饰画'},{setId:'a',chineseTitle:'金色路灯装饰画'}],calls=0;
  const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls++;const body=JSON.parse(raw);assert.match(body.instructions,/不增加|不补充/);res.end(JSON.stringify({output_text:JSON.stringify({titles:response})}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const cfg={PLANNER_API_KEY:'fixture',PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port},input=[{setId:'a',title:'Gold Lantern Art',englishTitle:'Gold Lantern Art'},{setId:'b',title:'Snowy Street Art',englishTitle:'Snowy Street Art'}];
  const result=await translateChineseTitles(input,cfg);assert.equal(result[0].chineseTitle,'金色路灯装饰画');assert.equal(result[0].title,input[0].title);assert.equal(input[0].chineseTitle,undefined);
  response=[{setId:'a',chineseTitle:'English only'},{setId:'b',chineseTitle:'装饰画'}];await assert.rejects(translateChineseTitles(input,cfg),/包含中文/);
  response=[{setId:'a',chineseTitle:'装饰画'},{setId:'a',chineseTitle:'街景'}];await assert.rejects(translateChineseTitles(input,cfg),/编号不匹配/);assert.equal(calls,3);
  assert.throws(()=>validateChineseTitle('纯英文 English\n换行'),/不换行/);
});

test('Chinese review can be added to a legacy executed batch without changing titles, images, files or receipts',async t=>{
  let translated=0;
  const f=await merchantFixture({titlePlanner:async g=>g.sets.map((s,i)=>({setId:s.id,title:'Snowy Canvas Wall Art '+(i+1),englishTitle:'Snowy Canvas Wall Art '+(i+1)})),chineseTranslator:async rows=>{translated++;return rows.map(r=>({...r,title:'MUST NOT REPLACE',englishTitle:'MUST NOT REPLACE',chineseTitle:'雪夜帆布装饰画'}));}});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});let b=await f.api('/api/products',{requestId:'chinese-review-legacy',storeKey:'merchant-ca',sourceFolder:f.input,products:[{...imported.products[0],count:1}],imageCount:1,ratio:'1:1',mode:'fast'});const route='/api/products/'+b.id;
  await f.api(route+'/plan',{});await f.wait(route,b=>b.phase!=='planning');await f.api(route+'/generate',{});b=await f.wait(route,b=>b.phase!=='generating');assert.equal(b.phase,'completed');
  const prep=await f.api(route+'/prepare',{}),preview=f.app.erp.previews().find(p=>p.id===prep.previewId);let job=await f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'merchant-ca',browserKey:'merchant-browser',rows:preview.rows});await f.api('/api/temu/erp/batches/'+job.id+'/start',{});job=await f.wait('/api/temu/erp/batches/'+job.id,b=>b.status!=='running');
  const erpFile=path.join(f.dir,'data','erp','state.json'),state=fs.readFileSync(erpFile,'utf8'),old=structuredClone(b),writes=f.writes.length;
  b=await f.api(route+'/chinese-titles',{});assert.equal(translated,1);const title=b.products[0].titles[0];assert.equal(title.chineseTitle,'雪夜帆布装饰画');assert.equal(title.title,old.products[0].titles[0].title);assert.equal(title.englishTitle,old.products[0].titles[0].englishTitle);assert.deepEqual(b.products[0].group,old.products[0].group);assert.deepEqual(b.resultPackage,old.resultPackage);assert.equal(f.writes.length,writes);assert.equal(fs.readFileSync(erpFile,'utf8'),state);
  assert.equal(f.app.erp.previews().find(p=>p.id===prep.previewId).rows[0].chineseTitle,'雪夜帆布装饰画');
  b=await f.api(route+'/titles',{productId:b.products[0].id,titles:[{...title,chineseTitle:'雪夜街景帆布画'}]});assert.equal(b.previewId,prep.previewId);assert.equal((await f.api('/api/temu/erp/batches/'+job.id)).rows[0].draftId,job.rows[0].draftId);
  await f.api(route+'/chinese-titles',{});assert.equal(translated,1,'existing Chinese text does not invoke the model again');
  await assert.rejects(f.api(route+'/mothers',{templateKey:'canvas-b'}),/执行清单/);
});

test('saved batch mother choice persists and Chinese workbook column stays separate from the listing title',async t=>{
  const f=await merchantFixture();t.after(f.close);const imported=await f.api('/api/products/import-folder',{folder:f.input});
  let b=await f.api('/api/products',{requestId:'mother-chinese-new',storeKey:'merchant-ca',products:[{...imported.products[0],count:1}],imageCount:1,ratio:'1:1',mode:'fast'});const route='/api/products/'+b.id;
  await assert.rejects(f.api(route+'/mothers',{templateKey:'not-this-store'}),/当前店铺/);b=await f.api(route+'/mothers',{templateKey:'canvas-b'});assert.equal(b.products[0].templateKey,'canvas-b');
  await f.api(route+'/plan',{});await f.wait(route,b=>b.phase!=='planning');await f.api(route+'/generate',{});b=await f.wait(route,b=>b.phase!=='generating');
  const row=readWorkbook(b.resultPackage.workbook).rows[0];assert.match(row.chineseTitle,/帆布/);assert.match(row.title,/Canvas/);
  const prep=await f.api(route+'/prepare',{}),preview=f.app.erp.previews().find(p=>p.id===prep.previewId);const job=await f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'merchant-ca',browserKey:'merchant-browser',rows:preview.rows});assert.equal(job.rows[0].mother.draftId,'987654322');assert.equal(job.rows[0].title,row.title);assert.equal(f.writes.length,0);
});
