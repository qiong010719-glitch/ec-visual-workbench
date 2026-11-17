import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {validateTitleBrief,temuTitleContext,reviewTitleFacts} from '../src/temu-title-policy.mjs';
import {generateListingTitles} from '../src/listing-titles.mjs';
import {merchantFixture} from './merchant-fixture.mjs';

const phone={platform:'temu',target_market:'加拿大站',product_name:'透明笑脸手机壳',product_desc:'透明背板与笑脸图案。',product_fact_source:'image'};
const brief={category:'手机壳',compatibility:'iPhone 16',material:'TPU',quantity:'1只',features:'镜头加高边缘',keywords:'smiley face phone case',referenceTitles:'Other Brand Phone Case, Magnetic, Waterproof, 2-Pack'};
const english='Smiley Face Clear Phone Case for iPhone 16, TPU Cover with Raised Camera Edges, 1-Pack';
const result=setId=>({setId,title:english,englishTitle:english,chineseTitle:'适配 iPhone 16 的透明笑脸 TPU 手机壳，镜头加高边缘，单只装'});

test('title attributes are bounded text and reference claims stay separate from confirmed facts',()=>{
  assert.deepEqual(validateTitleBrief(),{});
  assert.deepEqual(validateTitleBrief({compatibility:' iPhone 16 ',material:' '}),{compatibility:'iPhone 16'});
  for(const invalid of [null,[],{category:12},{material:'a'.repeat(201)},{unknown:'anything'}])assert.throws(()=>validateTitleBrief(invalid),/标题资料/);
  const context=temuTitleContext({...phone,title_brief:brief});
  assert.equal(context.category.id,'phone-case');
  assert.equal(context.confirmedAttributes.material,'TPU');
  assert.equal(context.confirmedAttributes.referenceTitles,undefined);
  assert.equal(context.confirmedAttributes.keywords,undefined);
  assert.equal(context.referenceTitles,brief.referenceTitles);
  assert.equal(context.factSource,'visual-only');
  assert.ok(context.category.priority.indexOf('适配型号')<context.category.priority.indexOf('图案与款式'));
  assert.equal(temuTitleContext({...phone,title_brief:{category:'装饰画'}}).category.id,'wall-art');
  assert.equal(temuTitleContext({product_name:'未知商品',title_brief:{referenceTitles:'Canvas Wall Art'}}).category.id,'general');
});

test('missing facts produce actionable advisory feedback without inventing attributes or blocking titles',()=>{
  const missing=reviewTitleFacts(phone,[result('one')]);
  assert.ok(missing.warnings.some(w=>w.includes('缺少已确认的适配型号')));
  assert.ok(missing.warnings.some(w=>w.includes('仅能确认可见外观')));
  const supplied=reviewTitleFacts({...phone,title_brief:brief},[result('one')]);
  assert.ok(!supplied.warnings.some(w=>w.includes('适配型号')));
  const omitted=reviewTitleFacts({...phone,title_brief:brief},[{englishTitle:'Smiley Face Clear Phone Case'}]);
  assert.ok(omitted.warnings.some(w=>w.includes('可能遗漏')));
  assert.ok(reviewTitleFacts({product_name:'帆布装饰画',product_fact_source:'image',product_desc:'图片写着50cm'}).warnings.some(w=>w.includes('缺少明确尺寸')));
  assert.ok(!reviewTitleFacts({product_name:'帆布装饰画',product_fact_source:'user',product_desc:'50 x 100 cm，无框'}).warnings.length);
});

test('both title API formats receive category strategy and merchant attributes without treating references as facts',async t=>{
  const requests=[],server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    requests.push(JSON.parse(raw));const content=JSON.stringify({titles:[result('one')]});
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url==='/responses'?{status:'completed',output_text:content}:{choices:[{message:{content},finish_reason:'stop'}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const group={source:{...phone,title_brief:brief},sets:[{id:'one',direction:{name:'Not a product fact'}}]},before=structuredClone(group);
  for(const format of ['responses','chat']){
    const config={PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,PLANNER_API_KEY:'local-test',TITLE_MODEL:'test',TITLE_API_FORMAT:format};
    assert.deepEqual(await generateListingTitles(group,config),[result('one')]);
    const body=requests.at(-1),system=format==='responses'?body.instructions:body.messages[0].content;
    const input=JSON.parse(format==='responses'?body.input:body.messages[1].content);
    assert.equal(input.titleStrategy.confirmedAttributes.compatibility,'iPhone 16');
    assert.equal(input.titleStrategy.category.id,'phone-case');
    assert.equal(input.titleStrategy.referenceTitles,brief.referenceTitles);
    assert.equal(input.platform.titleLimit,250);
    assert.ok(!JSON.stringify(input.titleStrategy.confirmedAttributes).includes('Waterproof'));
    assert.match(system,/不能据此新增本商品/);assert.match(system,/开头先交代卖什么/);
    assert.deepEqual(input.sets,[{id:'one'}]);
  }
  assert.equal(requests.length,2);assert.deepEqual(group,before);
});

test('old batches can add title facts atomically; model failure retains titles, images, source and previous brief',async t=>{
  const seen=[];let failing=false;
  const f=await merchantFixture({titlePlanner:async group=>{seen.push(structuredClone(group));if(failing)throw Error('fixture title failure');return group.sets.map(s=>result(s.id));}});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  let b=await f.api('/api/products',{requestId:'temu-brief-test',storeKey:'merchant-ca',sourceFolder:f.input,products:[{...imported.products[0],name:phone.product_name,description:phone.product_desc,count:1,titleBrief:brief}],imageCount:1,ratio:'1:1',mode:'fast'});
  const route='/api/products/'+b.id;await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');
  assert.equal(b.phase,'ready');assert.deepEqual(seen[0].source.title_brief,brief);
  const productId=b.products[0].id,groupId=b.products[0].groupId,originalGroup=JSON.stringify(b.products[0].group);
  // Emulate a saved batch predating this feature.
  delete f.app.store.state.productBatches[b.id].products[0].titleBrief;
  b=await f.api(route);assert.ok(b.products[0].titleReview.warnings.some(w=>w.includes('适配型号')));
  b=await f.api(route+'/regenerate-titles',{productId,titleBrief:brief});
  assert.deepEqual(b.products[0].titleBrief,brief);assert.deepEqual(b.titleHistory.at(-1).products[0].titleBrief,{});
  assert.equal(JSON.stringify(b.products[0].group),originalGroup);
  assert.equal(b.products[0].description,phone.product_desc);
  const previous=structuredClone(b),calls=seen.length;
  await assert.rejects(f.api(route+'/regenerate-titles',{titleBrief:brief}),/请选择一个产品/);
  await assert.rejects(f.api(route+'/regenerate-titles',{productId,titleBrief:{features:'x'.repeat(801)}}),/资料过长/);
  assert.equal(seen.length,calls);
  failing=true;
  await assert.rejects(f.api(route+'/regenerate-titles',{productId,titleBrief:{...brief,material:'PC'}}),/fixture title failure/);
  b=await f.api(route);
  assert.deepEqual(b.products[0].titleBrief,previous.products[0].titleBrief);
  assert.deepEqual(b.products[0].titles,previous.products[0].titles);
  assert.deepEqual(b.titleHistory,previous.titleHistory);assert.equal(b.titlesRegenerating,false);
  assert.equal(JSON.stringify(b.products[0].group),originalGroup);
  assert.deepEqual(f.app.store.state.listingTitles[groupId],previous.products[0].titles);
  assert.deepEqual(f.writes,[]);
  const saved=JSON.parse(fs.readFileSync(f.app.store.file,'utf8'));
  assert.deepEqual(saved.productBatches[b.id].products[0].titleBrief,brief);
});
