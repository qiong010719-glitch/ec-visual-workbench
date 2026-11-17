import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMother,checkMotherCopy} from '../../scripts/lib/temu-mothers.mjs';
import {motherSkuPreviewPolicy,validateMotherSkuPreview} from '../../scripts/lib/erp-image-rules.mjs';
import {merchantFixture} from './merchant-fixture.mjs';
const snapshot=()=>({items:['产品分类','承诺发货时效','运费模板'].map(label=>({label,selections:['已填写'],checked:[],controls:[]})),variantFields:{variationSku:['A'],price:['10'],skuLength:['10'],skuWidth:['10'],skuHeight:['10'],weight:['10'],stock:['2']},media:{skuPreviewImages:['sku.jpg'],mainImages:['main.jpg'],detailImages:['detail.jpg']}});
const extra=()=>({variants:[{kind:'风格',values:['A']},{kind:'颜色',values:[]}],warehouses:['加拿大仓'],description:{images:['detail.jpg'],text:''}});
test('mother preflight rejects missing shipping, stock, multiple SKUs and changed copy fields',()=>{
 const mother=snapshot(),copy=snapshot();assert.deepEqual(checkMother(mother,extra()),[]);assert.deepEqual(checkMotherCopy(mother,copy,extra(),extra()),[]);
 copy.items[2].selections=['美国'];assert.match(checkMotherCopy(mother,copy,extra(),extra()).join(),/运费模板/);
 mother.items[2].selections=[];mother.variantFields.stock=[''];mother.variantFields.variationSku.push('B');assert.match(checkMother(mother,extra()).join(),/未填写运费模板/);assert.match(checkMother(mother,extra()).join(),/库存/);assert.match(checkMother(mother,extra()).join(),/单 SKU/);
});
test('only the link identifies a mother; legacy template names and forged proof cannot select a different source',async t=>{
 const f=await merchantFixture();t.after(()=>f.close());let s=await f.api('/api/settings');const shop=s.stores[0],payload={...shop,...shop.templates[0],templateName:'不存在',templateId:'999'};
 const read=await f.api('/api/temu/erp/mother-check',payload);assert.equal(read.valid,true);assert.equal(read.draftId,payload.draftId);assert.equal(f.templateReads.at(-1).templateName,undefined);
 await f.api('/api/temu/erp/open-mother',payload);assert.equal(f.motherOpens[0].draftId,payload.draftId);
 const invalid=structuredClone(s.stores);invalid[0].templates[0]={key:'canvas-a',name:'链接母稿',draftId:'220114595116064422',sourceMode:'product',verifiedAt:'forged'};
 f.invalidMothers.add('220114595116064422');await assert.rejects(f.api('/api/settings',{revision:s.revision,stores:invalid}),/库存/);assert.deepEqual(await f.api('/api/settings'),s);
 f.invalidMothers.clear();s=await f.api('/api/settings',{revision:s.revision,stores:invalid});const saved=s.stores[0].templates[0];assert.equal(saved.draftId,'220114595116064422');assert.equal(saved.sourceMode,'product');assert.notEqual(saved.verifiedAt,'forged');
 const reads=f.templateReads.length;await f.api('/api/settings',{revision:s.revision,stores:s.stores});assert.equal(f.templateReads.length,reads,'unchanged legacy entries do not force unrelated checks');
 f.invalidMothers.add(saved.draftId);assert.equal((await f.api('/api/temu/erp/mother-check',{...shop,...saved})).valid,false);assert.equal(f.writes.length,0);
});
test('failed mother preflight stops planning and image generation before model charges',async t=>{
 let modelCalls=0;const f=await merchantFixture({titlePlanner:async()=>{modelCalls++;return [];},provider:async()=>{modelCalls++;throw Error('must not run');}});t.after(()=>f.close());
 const imported=await f.api('/api/products/import-folder',{folder:f.input});const b=await f.api('/api/products',{requestId:'mother-preflight',platform:'temu',storeKey:'merchant-ca',label:'校验',products:[{...imported.products[0],count:1,templateKey:'canvas-a'}],imageCount:1,ratio:'1:1',mode:'fast'});
 f.invalidMothers.add('987654321');for(const action of ['plan','generate'])await assert.rejects(f.api('/api/products/'+b.id+'/'+action,{}),/母稿校验未通过/);assert.equal(modelCalls,0);assert.equal(f.writes.length,0);
});

test('changed mother SKU picture fails a fresh check before planning or generation',async t=>{
 let modelCalls=0,checks=0;
 const policy=motherSkuPreviewPolicy({items:[{label:'产品分类',selections:['海报和印刷品']}]});
 let image={width:1024,height:1024,bytes:10000};
 const f=await merchantFixture({provider:async()=>{modelCalls++;throw Error('must not run');},titlePlanner:async()=>{modelCalls++;return [];},erpAdapter:{validateMother:async({store})=>{
   checks++;validateMotherSkuPreview(image,policy);return {valid:true,sourceMode:'product',draftId:store.draftId};
 }}});t.after(()=>f.close());
 const imported=await f.api('/api/products/import-folder',{folder:f.input});
 const payload={requestId:'sku-fresh-check',storeKey:'merchant-ca',products:[{...imported.products[0],count:1,templateKey:'canvas-a'}],imageCount:1,ratio:'1:1',mode:'fast'};
 await assert.rejects(f.api('/api/products',{...payload,requestId:'reject-portrait',ratio:'3:4'}),/1:1/);
 const b=await f.api('/api/products',payload);
 const settings=await f.api('/api/settings'),shop=settings.stores[0];
 await f.api('/api/temu/erp/mother-check',{...shop,...shop.templates[0]});const before=checks;
 image={width:1280,height:1949,bytes:395177};
 for(const action of ['plan','generate'])await assert.rejects(f.api('/api/products/'+b.id+'/'+action,{}),/母稿 SKU 预览图.*1280×1949/);
 assert.equal(modelCalls,0);assert.equal(f.writes.length,0);assert.ok(checks>=before+2);
});

