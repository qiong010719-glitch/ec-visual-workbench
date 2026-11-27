import test from 'node:test';
import assert from 'node:assert/strict';
import {TIKTOK_POSTER_PATH,tiktokSourceFacts,tiktokListingReadiness,retainedTiktokListing,createDxmTiktokPreparer,tiktokSaveAcknowledged,settleTiktokSave,comparableTiktokSaveSnapshot,unchangedTiktokMedia,waitTiktokMediaBaseline} from '../src/dxm-tiktok-prepare.mjs';

const defaults={packageDefaults:{lengthCm:10,widthCm:10,heightCm:10,weightKg:0.01},warehouse:'本店仓库'};
const source='https://img.kwcdn.com/product/example.jpg';
const product={
  title:'Solid Wood Framed Flower Poster, 2D Flat',
  description:'Frame Type：Wrapped Canvas\nArtwork Surface Material：Canvas\nOrigin：Zhejiang, China',
  sourceCategory:{platform:'temu',categoryId:'12869',breadcrumbs:[{name:'Home & Kitchen'},{name:'Wall Art'}]},
  images:[source],detailImages:[source],
  skus:[{id:'17606613128563',price:12.31,stock:944,specs:[{name:'Size',value:'40*60cm with frame'}],image:source}]
};
function readySnapshot(){return {
  categoryPath:[...TIKTOK_POSTER_PATH],title:product.title,descriptionPresent:true,
  units:{dimension:'cm',weight:'kg'},packageDefaults:{lengthCm:'10',widthCm:'10',heightCm:'10',weightKg:'0.01'},warehouse:'本店仓库',
  items:[
    {label:'原产地 (原産国)',required:true,attribute:true,controls:[{value:'中国',searchOnly:false}],checked:[],selections:[],errors:[]},
    {label:'材质 (梱包材)',required:true,attribute:true,controls:[{value:'帆布',searchOnly:true}],checked:['帆布(キャンバス)'],selections:[],errors:[]},
    {label:'品牌',required:false,attribute:true,controls:[],checked:[],selections:[],errors:[]},
    {label:'产品图片',required:true,controls:[],checked:[],selections:[],errors:[]},
    {label:'产品描述',required:true,controls:[],checked:[],selections:[],errors:[]}
  ],
  currency:'JPY',skus:[{id:product.skus[0].id,price:'1957',stock:'944',specs:structuredClone(product.skus[0].specs),preSaleDays:null}],
  images:[{url:source.replace('img.kwcdn.com','img.cdnfe.com'),loaded:true}],detailImages:[source],variantImages:[{url:source,loaded:true}],selectedImageCount:1
};}

test('source evidence supports the exact poster category and China/Canvas without transferring numeric Temu category IDs',()=>{
  const facts=tiktokSourceFacts(product);
  assert.deepEqual(facts.issues,[]);assert.deepEqual(facts.categoryPath,TIKTOK_POSTER_PATH);
  assert.equal(facts.origin,'中国');assert.equal(facts.material,'帆布(キャンバス)');
  for(const changed of [
    {...product,title:'Hand-painted original oil painting poster'},
    {...product,sourceCategory:{...product.sourceCategory,categoryId:'9'}},
    {...product,description:'Frame Type：Wrapped Canvas\nArtwork Surface Material：Metal\nOrigin：Zhejiang, China'}
  ])assert.ok(tiktokSourceFacts(changed).issues.length);
  assert.ok(tiktokSourceFacts({...product,description:product.description.replace('\nOrigin：Zhejiang, China','')}).issues.some(x=>x.includes('原产地')));
});

test('framed canvas prints retain Guangdong source facts while nonprints and unknown countries remain blocked',async()=>{
  const framed={...product,title:'3pcs Framed Funny Cats Wall Arts, Modern Art Prints, Whimsical Poster Print',description:'Frame Type：Framed\nArtwork Surface Material：Canvas\nOrigin：Guangdong,China'};
  const facts=tiktokSourceFacts(framed);
  assert.deepEqual(facts.issues,[]);assert.deepEqual(facts.categoryPath,TIKTOK_POSTER_PATH);
  assert.equal(facts.origin,'中国');assert.equal(facts.material,'帆布(キャンバス)');
  assert.equal(facts.sourceEvidence.origin,'Guangdong,China');assert.equal(facts.sourceEvidence.frameType,'Framed');
  const snapshot=readySnapshot();snapshot.title=framed.title;
  assert.equal(tiktokListingReadiness(snapshot,framed,defaults).ready,true);
  const adapter=createDxmTiktokPreparer({WORKBENCH_ADAPTER_ROOT:'Z:/must-not-open'});
  for(const changed of [
    {...framed,title:'Framed Funny Cats Canvas Wall Art'},
    {...framed,title:'Hand-painted original oil painting poster'},
    {...framed,title:'Framed Sculpture Poster'},
    {...framed,description:framed.description.replace('Frame Type：Framed','Frame Type：Unknown')},
    {...framed,sourceCategory:{...product.sourceCategory,categoryId:'9'}},
    {...framed,sourceCategory:{...product.sourceCategory,breadcrumbs:[{name:'Other'}]}},
    {...framed,description:framed.description.replace('Artwork Surface Material：Canvas','Artwork Surface Material：Metal')}
  ]){
    assert.ok(tiktokSourceFacts(changed).issues.length);
    const result=await adapter.prepare({product:changed,defaults});
    assert.equal(result.status,'needs-configuration');assert.equal(result.saved,false);
  }
  for(const origin of ['', 'Origin：Unknown', 'Origin：Guangdong,USA']){
    const changed={...framed,description:framed.description.replace('Origin：Guangdong,China',origin)},unknown=tiktokSourceFacts(changed);
    assert.equal(unknown.origin,null);assert.ok(unknown.issues.some(x=>x.includes('原产地')));
    const result=await adapter.prepare({product:changed,defaults});
    assert.equal(result.status,'needs-configuration');assert.equal(result.saved,false);
  }
});

test('readiness preserves a JPY platform price rather than writing USD source price',()=>{
  const snapshot=readySnapshot(),baseline=[{id:product.skus[0].id,price:'1957'}];
  assert.equal(tiktokListingReadiness(snapshot,product,defaults,{platformPrices:baseline}).ready,true);
  snapshot.skus[0].price='1957.00';assert.equal(tiktokListingReadiness(snapshot,product,defaults,{platformPrices:baseline}).ready,true);
  snapshot.skus[0].price='12.31';
  assert.ok(tiktokListingReadiness(snapshot,product,defaults,{platformPrices:baseline}).issues.some(x=>x.includes('本地展示价在补全期间发生变化')));
  snapshot.currency='USD';assert.ok(tiktokListingReadiness(snapshot,product,defaults,{platformCurrency:'JPY'}).issues.some(x=>x.includes('币种在补全期间发生变化')));
  snapshot.currency=null;assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('币种')));
});

test('required material checks the checked option, never merely the search query or false ERP defaults',()=>{
  const snapshot=readySnapshot();snapshot.items[1].checked=[];
  let result=tiktokListingReadiness(snapshot,product,defaults);
  assert.equal(result.ready,false);assert.ok(result.issues.some(x=>x.includes('缺少材质')));
  snapshot.items[1].checked=['帆布(キャンバス)','亚麻布(リネン)'];
  assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('不能保留')));
  snapshot.items[1].checked=['帆布(キャンバス)'];snapshot.items[0].controls[0].value='美国';
  assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('原产地与原始详情不一致')));
});

test('all four positive package values and exact store warehouse are required',()=>{
  const snapshot=readySnapshot();snapshot.packageDefaults.weightKg='0';
  assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('weightKg')));
  assert.equal(tiktokListingReadiness(readySnapshot(),product,{...defaults,packageDefaults:{lengthCm:10}}).ready,false);
  snapshot.packageDefaults.weightKg='0.01';snapshot.warehouse='其他店铺仓库';
  assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('仓库')));
  snapshot.units.weight='g';assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('单位')));
});

test('disabled presale requires no invented lead time; enabled presale and SKU identity stay strict',()=>{
  const snapshot=readySnapshot();assert.equal(tiktokListingReadiness(snapshot,product,defaults).ready,true);
  snapshot.skus[0].preSaleDays='';assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('预售天数')));
  snapshot.skus[0].preSaleDays='3';assert.equal(tiktokListingReadiness(snapshot,product,defaults).ready,true);
  snapshot.skus[0].specs[0].value='One Size';assert.ok(tiktokListingReadiness(snapshot,product,defaults).issues.some(x=>x.includes('规格、库存')));
  snapshot.skus=[];assert.equal(tiktokListingReadiness(snapshot,product,defaults).ready,false);
});

test('category leaf, original media, selection counts and image load state are verified',()=>{
  for(const mutate of [
    s=>s.categoryPath=['日用雑貨(家居用品)','その他'],
    s=>s.images[0].loaded=false,
    s=>s.images[0].url='https://img.kwcdn.com/product/another.jpg',
    s=>s.selectedImageCount=0,
    s=>s.detailImages=[],
    s=>s.variantImages=[]
  ]){const snapshot=readySnapshot();mutate(snapshot);assert.equal(tiktokListingReadiness(snapshot,product,defaults).ready,false);}
});

test('fresh editor waits past empty CKEditor and unloaded main images before freezing its media baseline',async()=>{
  const complete=readySnapshot(),emptyEditor=structuredClone(complete),unloaded=structuredClone(complete),noSelection=structuredClone(complete);
  emptyEditor.detailImages=[];emptyEditor.descriptionPresent=false;unloaded.images[0].loaded=false;noSelection.selectedImageCount=0;
  const samples=[emptyEditor,{...emptyEditor,descriptionPresent:true},unloaded,noSelection,complete,structuredClone(complete)];let reads=0;
  const result=await waitTiktokMediaBaseline({product,readSnapshot:async()=>samples[reads++],poll:async fn=>{for(let i=0;i<samples.length;i++){const value=await fn();if(value)return value;}throw new Error('fixture timeout');}});
  assert.equal(reads,6);assert.deepEqual(result.detailImages,product.detailImages);assert.ok(unchangedTiktokMedia(result,complete));
  assert.equal(unchangedTiktokMedia(emptyEditor,complete),false,'The old empty baseline would incorrectly flag a loaded description as a mutation');
});

test('media initialization waits for a stable sequence and times out when the description stays incomplete',async()=>{
  const complete=readySnapshot(),different=structuredClone(complete);different.images[0].url='https://img.cdnfe.com/product/another.jpg';
  const samples=[complete,different,complete,structuredClone(complete)];let reads=0;
  const baseline=await waitTiktokMediaBaseline({product,readSnapshot:async()=>samples[reads++],poll:async fn=>{for(let i=0;i<samples.length;i++){const value=await fn();if(value)return value;}throw new Error('fixture timeout');}});
  assert.equal(reads,4);assert.ok(unchangedTiktokMedia(baseline,complete));
  const missing=structuredClone(complete);missing.detailImages=[];reads=0;
  await assert.rejects(waitTiktokMediaBaseline({product,readSnapshot:async()=>{reads++;return missing;},poll:async fn=>{for(let i=0;i<3;i++)assert.equal(await fn(),null);throw new Error('fixture timeout');}}),/fixture timeout/);
  assert.equal(reads,3);
});

test('the initialized baseline still rejects exact media URL changes, image replacement, reordering and removal',()=>{
  const before=readySnapshot();before.images.push({url:'https://img.cdnfe.com/product/second.jpg',loaded:true});before.detailImages.push('https://img.kwcdn.com/product/second.jpg');
  for(const mutate of [
    s=>s.images[0].url+='?imageView2=changed',
    s=>s.images[0].url=s.images[0].url.replace('img.cdnfe.com','img.kwcdn.com'),
    s=>s.images[0].url='https://img.cdnfe.com/product/replaced.jpg',
    s=>s.images.reverse(),s=>s.images.pop(),s=>s.detailImages.reverse(),s=>s.detailImages.pop()
  ]){const after=structuredClone(before);mutate(after);assert.equal(unchangedTiktokMedia(before,after),false);}
  const missingSource=structuredClone(before);missingSource.images[0].url='https://img.cdnfe.com/product/replaced.jpg';
  assert.equal(tiktokListingReadiness(missingSource,product,defaults).ready,false,'The post-edit source check independently rejects changed image content');
});

test('recovery snapshot covers SKU, local currency, exact attributes and warehouse while allowing an equivalent media CDN',()=>{
  const before=readySnapshot();Object.assign(before,{url:'https://www.dianxiaomi.com/web/tiktokProduct/edit?id=123456789',account:'fixture',storeName:'fixture',sourceUrls:['https://www.temu.com/goods.html?goods_id=123456789']});
  const equal=structuredClone(before);equal.images[0].url=source;equal.packageDefaults.weightKg='0.010';equal.skus[0].price='1957.00';equal.skus[0].stock=944;
  assert.deepEqual(retainedTiktokListing(before),retainedTiktokListing(equal));
  for(const mutate of [s=>s.sourceUrls.push('another'),s=>s.skus[0].price='1',s=>s.currency='USD',s=>s.warehouse='another',s=>s.items[1].checked=['纸(紙)'],s=>s.packageDefaults.heightCm='1']){
    const after=structuredClone(before);mutate(after);assert.notDeepEqual(retainedTiktokListing(before),retainedTiktokListing(after));
  }
});

test('unknown save recovery without a persisted expected snapshot never opens a browser or saves again',async()=>{
  const adapter=createDxmTiktokPreparer({WORKBENCH_ADAPTER_ROOT:'Z:/must-not-open'});
  const result=await adapter.verify({platformEditUrl:'https://www.dianxiaomi.com/web/tiktokProduct/edit?id=123456789'});
  assert.equal(result.ready,false);assert.equal(result.saved,null);assert.equal(result.published,false);assert.equal(result.status,'needs-review');
});

test('the real editing-success message is recognized, but only the independent readback establishes readiness',async()=>{
  const message='消息提示您的产品编辑成功！创建新产品继续编辑';
  assert.equal(tiktokSaveAcknowledged([message]),true);assert.equal(tiktokSaveAcknowledged(['保存失败']),false);
  let submits=0,reads=0;
  const result=await settleTiktokSave({url:'draft',submitOnce:async()=>{submits++;},observeReceipt:async()=>[message],verifyReadOnly:async()=>{reads++;return {status:'needs-review',ready:false,saved:null,published:false,issues:['stored values differ']};}});
  assert.equal(submits,1);assert.equal(reads,1);assert.equal(result.verification.saveReceipt.acknowledged,true);
  assert.equal(result.ready,false);assert.equal(result.saved,null);
});

test('missing, ambiguous and timed-out save receipts always perform one read-only recovery and never resubmit',async()=>{
  for(const situation of ['empty','ambiguous','receipt-timeout','submit-timeout']){
    let submits=0,receipts=0,reads=0;
    const result=await settleTiktokSave({url:'draft',submitOnce:async()=>{submits++;if(situation==='submit-timeout')throw new Error('transport timeout after click');},observeReceipt:async()=>{receipts++;if(situation==='receipt-timeout')throw new Error('receipt timeout');return situation==='empty'?[]:['状态未知，请核对'];},verifyReadOnly:async()=>{reads++;return {status:'prepared',ready:true,saved:true,published:false,issues:[],verification:{persistedValuesVerified:true,readOnly:true}};}});
    assert.equal(submits,1,situation);assert.equal(receipts,situation==='submit-timeout'?0:1,situation);assert.equal(reads,1,situation);
    assert.equal(result.ready,true,situation);assert.equal(result.published,false);assert.equal(result.verification.persistedValuesVerified,true);
    assert.equal(result.verification.saveReceipt.acknowledged,false);assert.equal(result.verification.readBackAttempted,true);
  }
});

test('a failed readback retains an unknown save outcome without a second write',async()=>{
  let submits=0,reads=0;
  const result=await settleTiktokSave({url:'draft',submitOnce:async()=>{submits++;},observeReceipt:async()=>['您的产品编辑成功！'],verifyReadOnly:async()=>{reads++;throw new Error('browser disconnected');}});
  assert.equal(submits,1);assert.equal(reads,1);assert.equal(result.status,'needs-review');assert.equal(result.ready,false);assert.equal(result.saved,null);
  assert.match(result.issues[0],/browser disconnected/);assert.equal(result.verification.saveReceipt.acknowledged,true);
});

test('read-only recovery accepts old numeric string formatting without weakening SKU or currency identity',()=>{
  const snapshot=retainedTiktokListing(readySnapshot()),older=structuredClone(snapshot);
  older.skus[0].price='1957.00';older.skus[0].stock='944';older.packageDefaults.weightKg='0.010';
  assert.deepEqual(comparableTiktokSaveSnapshot(snapshot),comparableTiktokSaveSnapshot(older));
  older.currency='USD';assert.notDeepEqual(comparableTiktokSaveSnapshot(snapshot),comparableTiktokSaveSnapshot(older));
  older.currency='JPY';older.skus[0].id='another';assert.notDeepEqual(comparableTiktokSaveSnapshot(snapshot),comparableTiktokSaveSnapshot(older));
});

test('read-only recovery rejects an incomplete or mismatched intent before opening any browser',async()=>{
  const adapter=createDxmTiktokPreparer({WORKBENCH_ADAPTER_ROOT:'Z:/must-not-open'}),url='https://www.dianxiaomi.com/web/tiktokProduct/edit?id=123456789';
  const mismatched=await adapter.verify({platformEditUrl:url,targetStore:{platform:'tiktok'},preparationIntent:{url:'https://www.dianxiaomi.com/web/tiktokProduct/edit?id=987654321',expectedSnapshot:{url}}});
  assert.equal(mismatched.ready,false);assert.match(mismatched.issues[0],/核验地址/);
  const incomplete=await adapter.verify({platformEditUrl:url,targetStore:{platform:'tiktok'},preparationIntent:{url,expectedSnapshot:{url,skus:[]}}});
  assert.equal(incomplete.saved,null);assert.match(incomplete.issues[0],/快照不完整/);
});
