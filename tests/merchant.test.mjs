import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {merchantFixture} from './merchant-fixture.mjs';
import {createSettings} from '../src/settings.mjs';
import {readWorkbook} from '../src/workbook.mjs';
import {validateTitles} from '../src/listing-titles.mjs';
import {textBody,textResult} from '../src/model-wire.mjs';
import http from 'node:http';
import {planProduct,buildPlan} from '../src/planner.mjs';
import {recommendDirections,ruleDirections} from '../src/multisets.mjs';
import {generateListingTitles} from '../src/listing-titles.mjs';
import {writeWorkbook} from '../src/workbook.mjs';

test('merchant ERP bindings persist and validate dedicated Chrome profiles',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'erp-bindings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const configuration={},p=createSettings({directory:dir,configuration});
  assert.equal(configuration.TITLE_MODEL,'gpt-6.1-sol');
  const browsers=[{key:'chrome-a',type:'chrome',name:'Chrome A',debugPort:9333}],erpConnections=[{key:'account-a',name:'我的店小秘',browserKey:'chrome-a',expectedAccount:'merchant-a'}];
  const stores=[{key:'store-a',platform:'temu',expectedStore:'店铺A',expectedSite:'加拿大站',erpKey:'account-a',templates:[{key:'canvas',name:'帆布',draftId:'123456789',templateName:'帆布模板'}]}];
  const saved=p.update({revision:0,browsers,erpConnections,stores});assert.equal(saved.stores[0].browserKey,'chrome-a');assert.equal(saved.erpConnections[0].expectedAccount,'merchant-a');
  assert.equal(saved.browsers[0].userDataDir,path.join(dir,'chrome-profiles','chrome-a'));
  const restored=createSettings({directory:dir,configuration:{}});assert.deepEqual(restored.view().stores,saved.stores);
  assert.throws(()=>p.update({revision:1,erpConnections:[]}),/ERP 连接不存在/);
  assert.throws(()=>p.update({revision:1,browsers:[...browsers,{...browsers[0],key:'chrome-b'}]}),/端口不能重复/);
  assert.throws(()=>p.update({revision:1,browsers:[{...browsers[0],debugPort:80}]}),/1024/);
  assert.throws(()=>p.update({revision:1,browsers:[{...browsers[0],executable:'cmd.exe'}]}),/chrome.exe/);
});

test('Miaoshou connections persist separately and cannot bind stores or replace a bound ERP',async t=>{
  const f=await merchantFixture();t.after(f.close);
  const before=f.app.preferences.view();
  const miaoshou={key:'miaoshou-main',provider:'miaoshou',name:'妙手主账号',browserKey:before.browsers[0].key,expectedAccount:'miaoshou-user',loginUrl:'https://wrong.example/'};
  const saved=f.app.preferences.update({revision:before.revision,erpConnections:[...before.erpConnections,miaoshou]});
  const connection=saved.erpConnections.find(e=>e.key===miaoshou.key);
  assert.equal(connection.loginUrl,'https://erp.91miaoshou.com/');
  assert.deepEqual(saved.stores,before.stores);
  const restored=createSettings({directory:path.join(f.dir,'data/preferences'),configuration:{}});
  assert.equal(restored.erp(miaoshou.key).provider,'miaoshou');
  const rejected=[
    {stores:saved.stores.map(s=>({...s,erpKey:miaoshou.key}))},
    {erpConnections:saved.erpConnections.map(e=>({...e,provider:'miaoshou'}))},
    {erpConnections:[{...miaoshou,provider:'unknown'}]}
  ];
  for(const payload of rejected)assert.throws(()=>f.app.preferences.update({revision:saved.revision,...payload}),/尚未接入|不支持/);
  assert.deepEqual(f.app.preferences.view(),saved);
  const oldClient=structuredClone(saved.erpConnections);delete oldClient.find(e=>e.key===miaoshou.key).provider;
  const updated=f.app.preferences.update({revision:saved.revision,erpConnections:oldClient});
  assert.equal(updated.erpConnections.find(e=>e.key===miaoshou.key).provider,'miaoshou');
  assert.equal(f.writes.length,0);
});

test('fresh merchant configuration has no test stores, stores secrets encrypted and rejects stale updates',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'merchant-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const codec={encode:v=>Buffer.from(v).toString('base64'),decode:v=>Buffer.from(v,'base64').toString()},configuration={};
  const p=createSettings({directory:dir,configuration,codec});assert.equal(p.view().stores.length,0);
  const saved=p.update({revision:0,models:{PLANNER_API_KEY:'test-secret-only',TITLE_API_FORMAT:'responses'}});
  assert.equal(configuration.PLANNER_API_KEY,'test-secret-only');assert.equal(saved.models.PLANNER_API_KEYConfigured,true);
  assert.ok(!JSON.stringify(saved).includes('test-secret-only'));assert.ok(!fs.readFileSync(path.join(dir,'secrets.json'),'utf8').includes('test-secret-only'));
  assert.throws(()=>p.update({revision:0,models:{}}),/刷新/);
  const next={};createSettings({directory:dir,configuration:next,codec});assert.equal(next.PLANNER_API_KEY,'test-secret-only');
});

test('Excel xls and xlsx preserve product codes and block formulas; title validation keeps set identity',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'merchant-books-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['货号','标题','英文标题'],['00123','画','Canvas Art']]));
  for(const ext of ['xls','xlsx']){const file=path.join(dir,'商品.'+ext);fs.writeFileSync(file,XLSX.write(book,{type:'buffer',bookType:ext==='xls'?'biff8':'xlsx'}));assert.equal(readWorkbook(file).rows[0].productCode,'00123');}
  book.Sheets.Sheet1.B2={t:'s',f:'"title"',v:'title'};const bad=path.join(dir,'bad.xlsx');fs.writeFileSync(bad,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));assert.throws(()=>readWorkbook(bad),/公式/);
  const sets=[{id:'s1'},{id:'s2'}];assert.throws(()=>validateTitles([{setId:'s1',title:'画',englishTitle:'Canvas'},{setId:'s2',title:'画',englishTitle:'Canvas'}],sets),/重复/);
  assert.throws(()=>validateTitles([null,null],sets),/格式/);
  const c={PLANNER_API_FORMAT:'responses'},body=JSON.parse(textBody({model:'m',messages:[{role:'system',content:'rules'},{role:'user',content:'facts'}],reasoning_effort:'high'},c));
  assert.equal(body.instructions,'rules');assert.equal(body.reasoning.effort,'high');assert.equal(textResult({status:'incomplete',output_text:'cut'},c).choices[0].finish_reason,'length');
});

test('two products -> four titled sets -> Excel/folders -> independent store templates -> verified draft jobs',async t=>{
  const f=await merchantFixture();t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  imported.products.forEach((p,i)=>p.templateKey=i?'canvas-b':'canvas-a');
  const original=fs.readFileSync(path.join(f.input,'CANVAS-A','01.png'));
  const payload={requestId:'merchant-fixture-001',platform:'temu',storeKey:'merchant-ca',label:'双产品验证',sourceFolder:imported.sourceFolder,outputParent:imported.outputParent,products:imported.products,imageCount:2,ratio:'1:1',mode:'fast'};
  let b=await f.api('/api/products',payload);const route='/api/products/'+b.id;
  assert.equal((await f.api('/api/products',payload)).id,b.id);await assert.rejects(f.api('/api/products',{...payload,label:'changed'}),/已变化/);
  await f.api(route+'/plan',{});b=await f.wait(route,b=>!['planning'].includes(b.phase));assert.equal(b.phase,'ready',JSON.stringify(b.products.map(p=>p.error)));
  await f.api(route+'/generate',{});b=await f.wait(route,b=>b.phase!=='generating');assert.equal(b.phase,'completed',JSON.stringify(b.products.map(p=>p.error)));
  assert.ok(b.products.every(p=>p.titles.length===2&&p.group.completedImages===4));
  assert.ok(b.resultPackage.folder.startsWith(path.join(f.input,'_工作台生成结果')));
  const diskBook=readWorkbook(b.resultPackage.workbook);assert.equal(diskBook.rows.length,4);
  for(const row of diskBook.rows)assert.equal(fs.readdirSync(path.join(b.resultPackage.folder,row.productCode)).length,2);
  assert.equal((await f.api('/api/products/import-folder',{folder:f.input})).products.length,2,'generated output must not become a source product');
  assert.deepEqual(fs.readFileSync(path.join(f.input,'CANVAS-A','01.png')),original);
  diskBook.rows[0].englishTitle='Edited directly in result Excel';writeWorkbook(diskBook.rows,b.resultPackage.workbook);
  const exported=await f.api(route+'/export',{folder:f.dir}),book=readWorkbook(path.join(exported.folder,'商品.xlsx'));
  assert.equal(book.rows.length,4);for(const row of book.rows)assert.equal(fs.readdirSync(path.join(exported.folder,row.productCode)).length,2);
  const reimport=await f.api('/api/temu/erp/import-folder',{folder:exported.folder});assert.ok(reimport.rows.every(r=>r.folder===r.productCode));
  let prepared=await f.api(route+'/prepare',{});const oldPreview=prepared.previewId;
  const diskPreview=(await f.api('/api/temu/erp/previews')).find(p=>p.id===oldPreview);
  assert.equal(diskPreview.rows[0].englishTitle,'Edited directly in result Excel','execution reads the actual generated Excel');
  assert.equal(diskPreview.source.resultFolder,b.resultPackage.folder);
  const titles=structuredClone(b.products[0].titles);titles[0].title+=' Revised';await f.api(route+'/titles',{productId:b.products[0].id,titles});
  prepared=await f.api(route+'/prepare',{});assert.notEqual(prepared.previewId,oldPreview);
  const preview=(await f.api('/api/temu/erp/previews')).find(p=>p.id===prepared.previewId);
  const batch=await f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'merchant-ca',browserKey:'merchant-browser',rows:preview.rows});
  await assert.rejects(f.api(route+'/titles',{productId:b.products[0].id,titles:titles.map(t=>({...t,title:t.title+' Changed after prepare'}))}),/不能修改/);
  await assert.rejects(f.api(route+'/materialize',{}),/不能重新整理/);
  await f.api('/api/temu/erp/batches/'+batch.id+'/start',{});const result=await f.wait('/api/temu/erp/batches/'+batch.id,b=>b.status!=='running');assert.equal(result.status,'completed');
  assert.deepEqual(f.writes.map(w=>w.mother),['987654321','987654321','987654322','987654322']);assert.ok(f.writes.every(w=>w.browser==='independent-profile'));
  await f.api('/api/temu/erp/batches/'+batch.id+'/start',{});assert.equal(f.writes.length,4);
  const second=await f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'merchant-other',browserKey:'merchant-browser',rows:preview.rows});assert.equal(second.rows[2].mother.draftId,'987654332');
  const cfg=f.app.preferences.view();cfg.stores[1].templates.pop();f.app.preferences.update({revision:cfg.revision,stores:cfg.stores});await assert.rejects(f.api('/api/temu/erp/batches/'+second.id+'/start',{}),/母稿配置已变化/);
});

test('Responses transport reaches image planning, creative directions and separate listing titles',async t=>{
  const payload={platform:'temu',design_scope:'temu_main',image_count:2,image_ratio:'1:1',generation_mode:'fast',product_name:'Canvas',product_desc:'无框帆布画 50×100cm',target_market:'加拿大站',visual_style:'scene_advertising'};
  const group={source:payload,count:2,variation:'both',sets:[{id:'a',direction:{name:'A'}},{id:'b',direction:{name:'B'}}]},paths=[];
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);paths.push(req.url);assert.ok(body.instructions);assert.ok(body.input);
    const content=body.model==='titles'?JSON.stringify({titles:group.sets.map((s,i)=>({setId:s.id,title:'Canvas Wall Art '+i,englishTitle:'Canvas Wall Art '+i,chineseTitle:'帆布装饰画第'+i+'款'}))}):body.instructions.includes('多套视觉方案策划')?JSON.stringify({directions:ruleDirections(group)}):buildPlan(payload).text;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:content}]}],usage:{input_tokens:10,output_tokens:30}}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const config={PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,PLANNER_API_KEY:'fixture',PLANNER_MODEL:'planner',TITLE_MODEL:'titles',PLANNER_API_FORMAT:'responses',TITLE_API_FORMAT:'responses'};
  assert.equal((await planProduct(payload,config)).source,'configured-planner');assert.equal((await recommendDirections(group,config)).directions.length,2);assert.equal((await generateListingTitles(group,config)).length,2);assert.deepEqual(paths,['/responses','/responses','/responses']);
});
