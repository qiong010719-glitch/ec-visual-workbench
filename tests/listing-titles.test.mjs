import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {marketLanguage,validateMarketTitle} from '../src/market-language.mjs';
import {readWorkbook} from '../src/workbook.mjs';
import {generateListingTitles,validateGeneratedTitles,validateTitles} from '../src/listing-titles.mjs';
import {merchantFixture} from './merchant-fixture.mjs';

const group={source:{platform:'temu',target_market:'加拿大站',product_name:'雪夜街景装饰画',product_desc:'材质：帆布；画面：雪夜街景；尺寸：50×100cm；包装：1幅；不含画框。'},sets:[{id:'set-a',direction:{name:'街景氛围',audience:'家居装饰买家',scene:'客厅墙面'}}]};
const composed=[{setId:'set-a',chineseTitle:'雪夜街景帆布装饰画，50×100厘米，单幅无框',title:'Canvas Wall Art, Snowy Street Scene, 50 x 100 cm, 1 Unframed Print',englishTitle:'Canvas Wall Art, Snowy Street Scene, 50 x 100 cm, 1 Unframed Print'}];
async function titleServer(t,reply){
  const requests=[],server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push({url:req.url,body});
    const content=JSON.stringify({titles:reply});
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(req.url==='/responses'?{status:'completed',output_text:content}:{choices:[{finish_reason:'stop',message:{content}}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  return {requests,configuration:{PLANNER_API_KEY:'local-test',PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,TITLE_MODEL:'test-titles'}};
}

test('both title transports carry product facts, platform and market with independent bilingual writing instructions',async t=>{
  const {requests,configuration}=await titleServer(t,composed),before=structuredClone(group);
  for(const format of ['responses','chat']){
    assert.deepEqual(await generateListingTitles(group,{...configuration,TITLE_API_FORMAT:format}),composed);
    const request=requests.at(-1),system=format==='responses'?request.body.instructions:request.body.messages[0].content;
    const input=JSON.parse(format==='responses'?request.body.input:request.body.messages[1].content);
    assert.equal(input.platform.id,'temu');assert.equal(input.platform.name,'Temu 半托管');
    assert.equal(input.market,'加拿大站');assert.equal(input.facts,group.source.product_desc);
    assert.equal(input.product,group.source.product_name);assert.deepEqual(input.sets,[{id:'set-a'}]);
    assert.match(system,/先提炼/);assert.match(system,/英文标题都不能逐句翻译资料/);assert.match(system,/推断随附商品/);
    assert.equal(request.url,format==='responses'?'/responses':'/chat/completions');
  }
  assert.deepEqual(group,before);
});

test('generated titles reject wholesale input copying and punctuation-only changes in either language',()=>{
  const source='Canvas art, winter street scene, durable decorative wall art';
  const englishGroup={...group,source:{...group.source,product_name:'Canvas Art',product_desc:source}};
  for(const title of [source,source.toUpperCase().replace(/,/g,' '),'Art '+source,'Canvas Art'])assert.throws(()=>validateGeneratedTitles([{...composed[0],title}],englishGroup),/英语标题照搬/);
  assert.throws(()=>validateGeneratedTitles([{...composed[0],title:'帆布装饰画'}],group),/应使用英语/);
  const englishFacts='Material: canvas; scene: snowy street; size: 50 x 100 cm; package: one unframed print';
  assert.throws(()=>validateGeneratedTitles([{...composed[0],englishTitle:englishFacts.toUpperCase().replace(/;/g,',')}],{...group,source:{...group.source,product_desc:englishFacts}}),/英文标题照搬/);
  assert.deepEqual(validateGeneratedTitles(composed,group),composed,'sharing truthful factual phrases is valid');
  assert.deepEqual(validateGeneratedTitles(composed,{...group,source:{...group.source,product_desc:'50×100cm'}}),composed,'a short factual attribute is not a copied paragraph');
  assert.equal(validateTitles([{...composed[0],title:group.source.product_desc}],group.sets)[0].title,group.source.product_desc,'the AI-copy guard does not rewrite manual title edits');
});

test('copied service output is rejected without automatic model resubmission',async t=>{
  const {requests,configuration}=await titleServer(t,[{...composed[0],title:group.source.product_desc}]);
  await assert.rejects(generateListingTitles(group,configuration),/应使用英语/);
  assert.equal(requests.length,1);
});

test('copied generated titles are not persisted or exported; a retry preserves source facts and uses a rewritten title',async t=>{
  let copying=true,calls=0,seenSource;
  const f=await merchantFixture({titlePlanner:async g=>{
    calls++;seenSource=structuredClone(g.source);
    return g.sets.map(s=>({setId:s.id,title:copying?g.source.product_desc:composed[0].title,englishTitle:composed[0].englishTitle}));
  }});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  const product={...imported.products[0],name:group.source.product_name,description:group.source.product_desc,count:1};
  let b=await f.api('/api/products',{requestId:'title-facts-001',storeKey:'merchant-ca',sourceFolder:imported.sourceFolder,products:[product],imageCount:2,ratio:'1:1',mode:'fast'});
  const route='/api/products/'+b.id;
  await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');
  assert.equal(b.phase,'attention');assert.match(b.products[0].error,/应使用英语/);
  assert.deepEqual(b.products[0].titles,[]);assert.equal(f.app.store.state.listingTitles[b.products[0].groupId],undefined);
  assert.equal(b.resultPackage,undefined);await assert.rejects(f.api(route+'/generate',{}),/先完成所有产品的构思与标题/);
  assert.equal(seenSource.product_desc,product.description);assert.equal(seenSource.platform,'temu');assert.equal(seenSource.target_market,'加拿大站');
  copying=false;await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');
  assert.equal(b.phase,'ready',JSON.stringify(b.products.map(p=>p.error)));assert.equal(calls,2);
  assert.equal(b.products[0].titles[0].title,composed[0].title);assert.equal(b.products[0].description,product.description);
  assert.deepEqual(f.writes,[]);
});

test('store country resolves language without silently defaulting unknown markets to English',()=>{
  for(const [site,code] of [['加拿大站','en-CA'],['Japan','ja-JP'],['日本站','ja-JP'],['德国站','de-DE'],['法国','fr-FR'],['MX','es-MX'],['巴西站','pt-BR']])assert.equal(marketLanguage(site).code,code);
  for(const site of ['', '全球站', '未接入国家'])assert.throws(()=>marketLanguage(site),/无法确定/);
  validateMarketTitle('キャンバスアート 雪の街並み',marketLanguage('日本站'));
  assert.throws(()=>validateMarketTitle('Canvas wall art',marketLanguage('日本站')),/日语/);
  assert.throws(()=>validateMarketTitle('帆布装饰画',marketLanguage('加拿大站')),/英语/);
});

test('Japanese title generation preserves Japanese script with a separate English ERP title',async t=>{
  const japanese=[{setId:'set-a',chineseTitle:'雪景街道帆布装饰画，50×100厘米，无框',title:'キャンバスアート 雪の街並み 50×100cm フレームなし',englishTitle:composed[0].englishTitle}];
  const {requests,configuration}=await titleServer(t,japanese);
  const result=await generateListingTitles({...group,source:{...group.source,target_market:'日本站'}},configuration);
  assert.deepEqual(result,japanese);assert.equal(JSON.parse(requests[0].body.input).languages.title,'Japanese');
  assert.match(requests[0].body.instructions,/主上架标题 title 必须使用 Japanese/);
});

test('both model transports receive the actual original images instead of design-direction labels',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'title-images-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bytes=await sharp({create:{width:15,height:20,channels:3,background:'#184a80'}}).png().toBuffer();fs.writeFileSync(path.join(dir,'original.png'),bytes);
  const visual={...group,source:{...group.source,categorized_images:[{url:'/media/original.png'}]}};
  const {requests,configuration}=await titleServer(t,composed);
  for(const format of ['responses','chat']){
    await generateListingTitles(visual,{...configuration,TITLE_API_FORMAT:format},{mediaDirectory:dir});
    const body=requests.at(-1).body,content=format==='responses'?body.input[0].content:body.messages[1].content;
    assert.equal(content.length,2);assert.deepEqual(JSON.parse(content[0].text).sets,[{id:'set-a'}]);
    const image=format==='responses'?content[1].image_url:content[1].image_url.url;
    const metadata=await sharp(Buffer.from(image.split(',')[1],'base64')).metadata();assert.equal(metadata.width,15);assert.equal(metadata.height,20);
  }
  assert.deepEqual(fs.readFileSync(path.join(dir,'original.png')),bytes);
  await assert.rejects(generateListingTitles(visual,configuration),/缺少商品原图/);
  assert.equal(requests.length,2,'missing images must not silently submit only vague product notes');
});

test('title-only rewriting preserves images and receipts, exports local-language titles and updates only pending rows',async t=>{
  let revision=0,calls=0,f,job;const writes=[];
  f=await merchantFixture({titlePlanner:async g=>{calls++;return g.sets.map((s,i)=>({setId:s.id,title:(revision?'Snowy Street Canvas Wall Art ':'Canvas Wall Art ')+(i+1),englishTitle:(revision?'Snowy Street Canvas Wall Art ':'Canvas Wall Art ')+(i+1)}));},erpAdapter:{runDraft:async({row})=>{writes.push(row.productCode);f.app.erp.stop(job.id);return {draftId:'SAVED-001',verifiedAt:new Date().toISOString()};}}});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  let b=await f.api('/api/products',{requestId:'title-rewrite-001',storeKey:'merchant-ca',sourceFolder:f.input,products:[imported.products[0]],imageCount:1,ratio:'1:1',mode:'fast'});
  const route='/api/products/'+b.id;await f.api(route+'/plan',{});await f.wait(route,b=>b.phase!=='planning');await f.api(route+'/generate',{});b=await f.wait(route,b=>b.phase!=='generating');assert.equal(b.phase,'completed');
  const pictureState=JSON.stringify(b.products[0].group.sets),oldPackage=b.resultPackage;
  const prep=await f.api(route+'/prepare',{}),preview=f.app.erp.previews().find(p=>p.id===prep.previewId);
  job=await f.api('/api/temu/erp/prepare',{previewId:prep.previewId,storeKey:'merchant-ca',browserKey:'merchant-browser',rows:preview.rows});
  // Stop after the first mocked write, leaving the second product pending.
  await f.api('/api/temu/erp/batches/'+job.id+'/start',{});
  job=await f.wait('/api/temu/erp/batches/'+job.id,b=>b.status!=='running');
  const before=structuredClone(job),writeCount=writes.length;assert.equal(job.rows[0].status,'verified');assert.equal(job.rows[1].status,'pending');
  revision=1;b=await f.api(route+'/regenerate-titles',{});
  assert.equal(calls,2);assert.equal(b.titleLanguage.code,'en-CA');assert.equal(b.previewId,prep.previewId);assert.match(b.titleUpdateWarning,/未执行条目已同步/);
  assert.equal(JSON.stringify(b.products[0].group.sets),pictureState);assert.notEqual(b.resultPackage.folder,oldPackage.folder);
  const book=readWorkbook(b.resultPackage.workbook);assert.ok(book.rows.every(r=>r.title.startsWith('Snowy Street')));
  assert.equal(writes.length,writeCount);job=await f.api('/api/temu/erp/batches/'+job.id);
  for(const row of job.rows){const old=before.rows.find(r=>r.rowId===row.rowId);if(old.draftId)assert.deepEqual(row,old);else assert.match(row.title,/Snowy Street/);}
  await assert.rejects(f.api(route+'/prepare',{}),/已有|回执/);
});

test('Japanese primary titles survive the workbook round trip into the correct ERP field',async t=>{
  const japanese='キャンバスアート 雪景色の街並み';
  const f=await merchantFixture({titlePlanner:async g=>g.sets.map(s=>({setId:s.id,title:japanese,englishTitle:'Canvas Wall Art, Snowy Street Scene'}))});t.after(f.close);
  const config=f.app.preferences.view();config.stores[0].expectedSite='日本站';f.app.preferences.update({revision:config.revision,stores:config.stores});
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  let b=await f.api('/api/products',{requestId:'japan-title-001',storeKey:'merchant-ca',sourceFolder:f.input,products:[{...imported.products[0],count:1}],imageCount:1,ratio:'1:1',mode:'fast'});
  const route='/api/products/'+b.id;await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');assert.equal(b.phase,'ready');
  await f.api(route+'/generate',{});b=await f.wait(route,b=>b.phase!=='generating');assert.equal(b.phase,'completed');
  assert.equal(b.titleLanguage.label,'日语');assert.equal(readWorkbook(b.resultPackage.workbook).rows[0].title,japanese);
  const prepared=await f.api(route+'/prepare',{}),preview=f.app.erp.previews().find(p=>p.id===prepared.previewId);
  const job=await f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'merchant-ca',browserKey:'merchant-browser',rows:preview.rows});
  assert.equal(job.rows[0].title,japanese);assert.equal(job.rows[0].englishTitle,'Canvas Wall Art, Snowy Street Scene');assert.equal(job.store.expectedSite,'日本站');
  await assert.rejects(f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'merchant-ca',browserKey:'merchant-browser',rows:preview.rows.map(r=>({...r,title:'English cannot replace Japanese'}))}),/应使用日语/);
});
