import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ReferenceLibrary,normalizeProduct,selectBrands,hash,categoryIdFrom,categoryKeyFrom} from '../src/reference-library.mjs';
import {analyzeProduct,validateAnalysis} from '../src/reference-analysis.mjs';
import {ApifyClient} from '../src/apify.mjs';
import {ResearchService} from '../src/research.mjs';
import {buildPlan,promptForSlot} from '../src/planner.mjs';
import {designPatterns} from '../src/design-patterns.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64');
const categoryUrl='https://www.amazon.com/gp/bestsellers/wireless/7073960011';
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-research-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const media=path.join(directory,'media'),library=new ReferenceLibrary(path.join(directory,'research'),media,{download:async()=>png});
  return {directory,media,library};
}
const row=(asin='B000000001',extra={})=>({url:'https://www.amazon.com/dp/'+asin,asin,title:'Power Bank',brand:'Brand A',images:['https://m.media-amazon.com/images/I/main.jpg'],aPlusContent:{rawImages:['https://m.media-amazon.com/images/I/aplus.jpg']},...extra});
const imageAnalysis=id=>({id,purpose:'外观',layout:'左右分区',camera:'俯拍',lighting:'柔光',palette:'浅色',textDensity:'少字',transferableGuidance:'留出清楚的标题区域'});

test('category identity includes ranked page-two URLs with query parameters',()=>{
  assert.equal(categoryIdFrom('https://www.amazon.com/Best-Sellers-Electronics-Headphones-Earbuds/zgbs/electronics/172541?pg=2'),'172541');
  assert.equal(categoryIdFrom('https://www.amazon.com/gp/bestsellers/electronics/172541/'),'172541');
  assert.equal(categoryIdFrom('https://www.amazon.com/gp/bestsellers/electronics/'),null);
  assert.equal(categoryIdFrom('invalid'),null);
});

test('department ranking aliases share identity without mixing numeric child categories',()=>{
  assert.equal(categoryKeyFrom('https://www.amazon.com/Best-Sellers-Home-Kitchen/zgbs/home-garden?pg=2'),'department:home-garden');
  assert.equal(categoryKeyFrom('https://www.amazon.com/gp/bestsellers/home-garden/ref=zg_bs_nav_0'),'department:home-garden');
  assert.equal(categoryKeyFrom('https://www.amazon.com/Best-Sellers/zgbs/beauty/'),'department:beauty');
  assert.equal(categoryKeyFrom('https://www.amazon.com/gp/bestsellers/home-garden/1055398?pg=2'),'1055398');
  assert.equal(categoryKeyFrom('https://www.amazon.com/dp/B000000001'),null);
  assert.equal(categoryKeyFrom('https://other.example/gp/bestsellers/beauty'),null);
});

test('imports preserve actual A+ evidence and reject unsupported product domains',()=>{
  const p=normalizeProduct(row());assert.deepEqual(p.assets.map(a=>a.role),['main','aplus']);assert.equal(p.aplusStatus,'found');assert.equal(p.rankBasis,'unverified');
  assert.equal(normalizeProduct(row('B000000002',{aPlusContent:null})).aplusStatus,'not_observed');
  const branded=normalizeProduct(row('B000000001',{thumbnailImage:'https://m.media-amazon.com/thumbnail.jpg',brandStory:{items:[{url:'https://www.amazon.com/dp/B000000002',image:{url:'https://m.media-amazon.com/story.jpg'}}]}}));
  assert.equal(branded.assets[0].sourceUrl,'https://m.media-amazon.com/images/I/main.jpg');assert.equal(branded.assets.filter(a=>a.role==='brand_story').length,1);
  for(const url of ['https://amazon.com.evil.example/dp/B000000001','http://www.amazon.com/dp/B000000001','https://user:secret@www.amazon.com/dp/B000000001'])assert.throws(()=>normalizeProduct(row('B000000001',{url})));
});

test('missing top-level brand uses only explicit consistent brand attributes',()=>{
  const p=normalizeProduct(row('B000000001',{brand:'',title:'Samsung microSD for Nintendo Switch',attributes:[{key:'Brand',value:'Nintendo'},{key:'Manufacturer',value:'Nintendo'}]}));
  assert.equal(p.brand,'Nintendo');
  assert.equal(p.brandEvidence.field,'attributes.Brand');
  assert.equal(normalizeProduct(row('B000000002',{brand:'',attributes:[{key:'Brand Name',value:'Xbox'},{key:'Manufacturer',value:'Microsoft'}]})).brand,'Xbox');
  assert.equal(normalizeProduct(row('B000000003',{brand:'',title:'Famous Brand Headphones',attributes:[{key:'Manufacturer',value:'Factory Name'}]})).brand,'');
  const conflict=normalizeProduct(row('B000000004',{brand:'',attributes:[{key:'Brand',value:'First'}],productOverview:[{key:'Brand',value:'Second'}]}));
  assert.equal(conflict.brand,'');assert.match(conflict.warnings.join(' '),/品牌字段冲突/);
});
test('ranking deduplicates parent families, excludes unverified rows and reports missing quotas',()=>{
  const products=[
    {id:'a1',asin:'A1',parentAsin:'F1',brand:'Brand A',rank:1,rankBasis:'bestsellers_list'},
    {id:'a2',asin:'A2',parentAsin:'F1',brand:'brand a',rank:2,rankBasis:'bestsellers_list'},
    {id:'b1',asin:'B1',brand:'Brand B',rank:3,rankBasis:'bestsellers_list'},
    {id:'bad',asin:'C1',brand:'',rank:4,rankBasis:'bestsellers_list'},
    {id:'unverified',asin:'D1',brand:'Brand D',rank:1,rankBasis:'unverified'}
  ];
  const result=selectBrands(products);assert.equal(result.brands.length,2);assert.deepEqual(result.brands[0].products,['a1']);assert.equal(result.brands[0].missing,4);assert.equal(result.missingBrands,3);assert.equal(result.excluded.length,2);
});
test('refresh promotes newly downloaded files and invalidates stale analysis when image bytes change',async t=>{
  const {library}=fixture(t);const p=library.upsert(normalizeProduct(row()));
  const refreshed=structuredClone(p);Object.assign(refreshed.assets[0],{status:'downloaded',localUrl:'/media/first.png',sha256:'first'});
  library.upsert(refreshed);assert.equal(library.state.products[p.id].assets[0].status,'downloaded');
  refreshed.analysis={status:'completed',images:[]};library.save();
  const metadata=normalizeProduct(row());metadata.title='New title';library.upsert(metadata);
  assert.equal(library.state.products[p.id].title,'New title');assert.equal(library.state.products[p.id].assets[0].sha256,'first');assert.equal(library.state.products[p.id].analysis.status,'completed');
  const changed=normalizeProduct(row());Object.assign(changed.assets[0],{status:'downloaded',localUrl:'/media/next.png',sha256:'next'});library.upsert(changed);assert.equal(library.state.products[p.id].analysis,null);
});
test('vision sends real image bytes, caches by hash and reassigns roles per occurrence',async t=>{
  const {library}=fixture(t);const p=library.upsert(normalizeProduct(row()));await library.downloadProduct(p.id);
  let calls=0;
  const transport=async(url,init)=>{
    calls++;const request=JSON.parse(init.body),content=request.messages[1].content;
    assert.equal(url,'https://vision.example/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer vision-only');
    const images=content.filter(c=>c.type==='image_url');assert.equal(images.length,2);assert.equal(images[0].image_url.url,'data:image/png;base64,'+png.toString('base64'));
    return Response.json({choices:[{message:{content:JSON.stringify({images:p.assets.map(a=>imageAnalysis(a.id)),tags:['Power Banks']})}}],usage:{prompt_tokens:100,completion_tokens:50}});
  };
  const config={VISION_BASE_URL:'https://vision.example/v1',VISION_API_KEY:'vision-only',VISION_MODEL:'test-vision',SUANZHOU_IMAGE_API_KEY:'must-not-be-used'};
  await analyzeProduct(library,p.id,config,transport);assert.equal(p.analysis.status,'completed');assert.equal(library.state.analysisUsage.calls,1);
  const other=library.upsert(normalizeProduct(row('B000000002')));await library.downloadProduct(other.id);other.assets[0].role='storefront';
  await analyzeProduct(library,other.id,config,()=>{throw new Error('cache should prevent request');});assert.equal(calls,1);assert.equal(other.analysis.images[0].role,'storefront');assert.equal(library.stats().analyzedUnique,1);
});
test('missing vision config or incomplete provider output cannot mark analysis complete',async t=>{
  const {library}=fixture(t);const p=library.upsert(normalizeProduct(row()));await library.downloadProduct(p.id);
  await assert.rejects(analyzeProduct(library,p.id,{}),/尚未配置/);
  assert.throws(()=>validateAnalysis({images:[imageAnalysis(p.assets[0].id)]},p.assets),/全部图片/);
  const config={VISION_BASE_URL:'https://vision.example',VISION_API_KEY:'test',VISION_MODEL:'test'};
  await assert.rejects(analyzeProduct(library,p.id,config,async()=>Response.json({choices:[{message:{content:'{"images":[]}'}}]})),/全部图片/);
  assert.equal(p.analysis.status,'failed');assert.deepEqual(library.retrieve({product_name:'Power Bank'}),[]);
});
test('library retrieval returns design fields without competitor factual metadata or image bytes',t=>{
  const {library}=fixture(t);const p=normalizeProduct(row('B000000001',{title:'Power Bank SECRET BRAND 50000mAh',description:'SECRET WARRANTY'}));
  p.analysis={status:'completed',analyzedAt:'now',images:[{...imageAnalysis(p.assets[0].id),role:'main',sourceUrl:'https://competitor.example/secret.jpg'}],tags:['充电宝']};library.upsert(p);
  const refs=library.retrieve({product_name:'充电宝'});assert.equal(refs.length,1);assert.equal(refs[0].images[0].sourceUrl,undefined);
  const plan=buildPlan({product_name:'我的充电宝',product_desc:'蓝色',custom_layout:{main:1,sub:1}},refs);
  assert.match(plan.text,/左右分区/);assert.doesNotMatch(plan.text,/SECRET BRAND|50000mAh|SECRET WARRANTY|competitor\.example/);
  assert.equal(library.retrieve({product_name:'充电宝',reference_ids:['missing']}).length,0);
});
test('per-slot SOP preserves common requirements without copying another slot',()=>{
  const payload={product_name:'测试',custom_layout:{main:1,sub:2}};const plan=buildPlan(payload);
  const edited={...payload,sop_text:'全局规则\n\n【主图】\nONLY_MAIN\n\n【卖点图1】\nONLY_ONE\n\n【卖点图2】\nONLY_TWO'};
  const prompt=promptForSlot(edited,plan.sections[1],plan);assert.match(prompt,/全局规则/);assert.match(prompt,/ONLY_ONE/);assert.doesNotMatch(prompt,/ONLY_MAIN|ONLY_TWO/);
  assert.throws(()=>promptForSlot({...edited,sop_text:'【主图】\nx'},plan.sections[1],plan),/缺少/);
  const oldPlan=buildPlan({custom_layout:{main:1,aplus:1,aplus_type:'old'}});
  const oldPrompt=promptForSlot({sop_text:'全局\n【主图: 商品白底展示】\nMAIN_ONLY\n【老版A+模块1: 顶部品牌画册横幅 (Hero Banner)】\nAP_ONLY'},oldPlan.sections[1],oldPlan);
  assert.match(oldPrompt,/AP_ONLY/);assert.doesNotMatch(oldPrompt,/MAIN_ONLY/);
});

test('automatic retrieval matches Chinese category phrases and varies equally relevant brands',t=>{
  const {library}=fixture(t);
  for(let i=1;i<=4;i++) {
    const p=normalizeProduct(row('B00000000'+i,{brand:i<3?'Brand A':'Brand '+i,category:'充电宝 / Power Banks'}));
    p.analysis={status:'completed',images:[{...imageAnalysis(p.assets[0].id),role:'main'}],tags:['充电宝']};library.upsert(p);
  }
  const refs=library.retrieve({product_name:'磁吸充电宝'});assert.equal(refs.length,3);assert.equal(new Set(refs.map(r=>library.state.products[r.id].brand)).size,3);
  assert.deepEqual(library.retrieve({product_name:'无关的家具'}),[]);
});

test('one product retains distinct category memberships across imports and can be retrieved from either',t=>{
  const {library}=fixture(t);const p=normalizeProduct(row('B000000001',{title:'Bluetooth Speaker',category:'Audio'}));
  p.categoryMemberships=[{id:'audio',label:'蓝牙音箱',name:'Speakers',rank:2}];
  p.analysis={status:'completed',images:[{...imageAnalysis(p.assets[0].id),role:'main'}],tags:[]};library.upsert(p);
  const next=normalizeProduct(row('B000000001',{title:'Bluetooth Speaker',category:'Other'}));
  next.categoryMemberships=[{id:'portable',label:'便携音频',name:'Portable Audio',rank:4}];library.upsert(next);
  assert.equal(library.state.products[p.id].categoryMemberships.length,2);
  assert.equal(library.retrieve({product_name:'户外蓝牙音箱'}).length,1);
  assert.equal(library.retrieve({product_name:'便携音频设备'}).length,1);
});

test('Chinese product names retrieve matching English titles without unrelated accessories',t=>{
  const {library}=fixture(t);
  const examples=[
    ['B000000001','Car Phone Holder with Suction Cup, Cell Phone Mount for Dashboard','车载电子 / Car Electronics'],
    ['B000000002','Faraday Pouch for Car Keys, RFID Signal Blocking Holder','车载电子 / Car Electronics'],
    ['B000000003','Screen Protector for iPhone 17, Tempered Glass','手机与配件 / Cell Phones & Accessories'],
    ['B000000004','Full-Body iPhone 17 Case with Built-in Glass Screen Protector','手机与配件 / Cell Phones & Accessories'],
    ['B000000005','Screen Protector for iPad A16 11 inch','电脑与配件 / Computers & Accessories']
  ];
  for(const [asin,title,category] of examples){
    const p=normalizeProduct(row(asin,{title,category}));
    p.analysis={status:'completed',images:[{...imageAnalysis(p.assets[0].id),role:'main'}],tags:[category]};library.upsert(p);
  }
  const asins=name=>library.retrieve({product_name:name}).map(r=>library.state.products[r.id].asin);
  assert.deepEqual(asins('车载手机支架'),['B000000001']);
  assert.deepEqual(asins('手机钢化保护膜'),['B000000003']);
  const caseId=Object.values(library.state.products).find(p=>p.asin==='B000000004').id;
  assert.equal(library.retrieve({product_name:'手机钢化保护膜',reference_ids:[caseId]})[0]?.id,caseId);
});

test('pattern coverage counts unique image bytes across roles and never hides pending assets',()=>{
  const a={id:'a',sha256:'same',roles:['main','aplus'],role:'main',localUrl:'/media/a.jpg'};
  const state={products:{one:{id:'one',assets:[a]},two:{id:'two',assets:[{...a,id:'b',role:'storefront',roles:['storefront']},{id:'pending',sourceUrl:'https://m.media-amazon.com/pending.jpg'}]}},imageAnalyses:{same:{...imageAnalysis('a'),layout:'白底，左右分区'}}};
  const report=designPatterns(state);assert.equal(report.expectedUnique,2);assert.equal(report.analyzedUnique,1);assert.equal(report.status,'partial');
  assert.equal(report.roles.find(r=>r.role==='storefront').analyzedUnique,1);assert.equal(report.roles.find(r=>r.role==='main').patterns.find(p=>p.id==='white-background').mentions,1);
});
test('Apify uses bearer auth, enforces per-run caps and paginates without URL secrets',async t=>{
  const {directory}=fixture(t);const tokenFile=path.join(directory,'.env.apify');fs.writeFileSync(tokenFile,'APIFY_API_TOKEN=test-token');
  const requests=[];
  const client=new ApifyClient({APIFY_TOKEN_FILE:tokenFile},async(url,init)=>{
    requests.push({url,init});assert.equal(init.headers.Authorization,'Bearer test-token');assert.ok(!url.includes('test-token'));
    if(init.method==='POST')return Response.json({data:{id:'run-id',status:'READY'}});
    const u=new URL(url),count=Number(u.searchParams.get('offset'))===0?250:20;return Response.json(Array.from({length:count},(_,id)=>({id})));
  });
  await assert.rejects(client.start('junglee/amazon-crawler',{},{}),/费用上限/);
  await client.start('junglee/amazon-crawler',{categoryOrProductUrls:[{url:'https://www.amazon.com/dp/B000000001'}]},{maxTotalChargeUsd:2.5,maxItems:100});
  assert.match(requests[0].url,/junglee~amazon-crawler\/runs\?/);assert.equal(new URL(requests[0].url).searchParams.get('maxTotalChargeUsd'),'2.5');assert.equal(new URL(requests[0].url).searchParams.get('restartOnError'),'false');
  assert.equal((await client.items('dataset',270)).length,270);assert.equal(requests.length,3);
});
test('ambiguous paid submissions are never retried',async()=>{
  let requests=0;const client=new ApifyClient({APIFY_API_TOKEN:'test'},async()=>{requests++;throw new Error('connection lost');});
  await assert.rejects(client.start('junglee/test',{},{maxTotalChargeUsd:1,maxItems:5}),e=>e.submissionUnknown===true);assert.equal(requests,1);
});
test('campaign accepts canonical category aliases, preserves evidence, cap and missing A+ status',async t=>{
  const {directory,media}=fixture(t);let starts=0;
  const fake={configured:true,start:async(actor,input,limits)=>{assert.equal(limits.maxTotalChargeUsd,2.5);starts++;return {id:'run'+starts,status:'SUCCEEDED',defaultDatasetId:'d'+starts};},run:async id=>({id,status:'SUCCEEDED',defaultDatasetId:'d'+id.slice(3),usageTotalUsd:0.1}),items:async id=>id==='d1'?[{url:'https://www.amazon.com/dp/B000000001',position:1,categoryUrl:'https://www.amazon.com/Best-Sellers-Cell-Phone-Portable-Power-Banks/zgbs/wireless/7073960011'}]:[row('B000000001',{aPlusContent:null})]};
  const service=new ResearchService({directory:path.join(directory,'campaign'),mediaDirectory:media,client:fake,download:async()=>png});t.after(()=>service.close());
  const input={requestId:'pilot',categoryUrls:[categoryUrl],budgetUsd:5};const job=service.create('collect',input);await service.current;
  assert.equal(job.status,'partial');assert.equal(job.categories[0].verified,1);assert.equal(job.categories[0].selection.missingBrands,4);assert.equal(job.runs.reduce((s,r)=>s+r.maxTotalChargeUsd,0),5);
  const p=Object.values(service.library.state.products)[0];assert.equal(p.rankEvidence.runId,'run1');assert.equal(p.rank,1);assert.equal(p.analysis,null);
  assert.equal(service.create('collect',input).id,job.id);assert.equal(starts,2);
});
test('restart pauses campaigns and resume reuses known run IDs',async t=>{
  const {directory,media}=fixture(t);const options={directory:path.join(directory,'campaign'),mediaDirectory:media,client:{configured:true,start:async()=>{throw new Error('must not resubmit');},run:async()=>({status:'SUCCEEDED',defaultDatasetId:'dataset'}),items:async()=>[]}};
  const first=new ResearchService(options);
  first.library.state.campaigns.recover={id:'recover',kind:'collect',status:'running',input:{categoryUrls:[categoryUrl],budgetUsd:5,candidateLimit:100,download:false},runs:[{stage:'ranking-0',runId:'existing',status:'RUNNING'}],categories:[],warnings:[],completedProducts:[]};first.library.save();first.close();
  const recovered=new ResearchService(options);assert.equal(recovered.library.state.campaigns.recover.status,'paused');recovered.resume('recover');await recovered.current;
  assert.equal(recovered.library.state.campaigns.recover.status,'partial');assert.equal(recovered.library.state.campaigns.recover.runs.length,1);recovered.close();
});
