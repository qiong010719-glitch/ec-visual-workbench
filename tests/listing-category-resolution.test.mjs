import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCategoryCandidateCatalog,validateCategoryCandidateCatalog,confirmListingCategory,
  resolveListingCategory,resolveListingCategoryBatch,categoryResolutionCacheKey,
  createCategoryRanker,validateCategoryRanking
} from '../src/listing-category-resolution.mjs';

const now=Date.now();
const scope={jobId:'job-1',account:'fixture',platform:'shein',mode:'marketplace',storeBindingKey:'store-a',site:'美国站',catalogKey:'store-a-catalog'};
const product={id:'source-1',title:'便携式果汁机，用于水果榨汁',usage:'水果榨汁',sourcePath:['家用电器','厨房小电器'],productType:'便携式果汁机',productTypeConfirmed:true};
const juice={candidateId:'observed-juice',platformCategoryId:'shein-101',label:'榨汁机',path:['家居','厨房电器','榨汁机'],leaf:true,source:'store-search'};
const mixer={candidateId:'observed-mixer',platformCategoryId:'shein-102',label:'搅拌机',path:['家居','厨房电器','搅拌机'],leaf:true,source:'store-recommendation'};
const catalog=(overrides={})=>createCategoryCandidateCatalog({scope,productId:product.id,candidates:[juice,mixer],observedAt:new Date(now).toISOString(),...overrides},{now});
const confirm=(current=catalog(),currentProduct=product,extra={})=>confirmListingCategory({catalog:current,catalogDigest:current.digest,candidateId:juice.candidateId,product:currentProduct,confirmedAt:new Date(now).toISOString(),...extra},{now});

test('catalog accepts only observed leaf references and never manufactures a platform ID',()=>{
  const opaque=catalog({candidates:[{...juice,platformCategoryId:undefined,candidateId:'path:observed-ui-token'}]});
  assert.equal(opaque.candidates[0].candidateId,'path:observed-ui-token');
  assert.equal(opaque.candidates[0].platformCategoryId,null);
  assert.equal(opaque.candidates[0].idKind,'candidate');
  assert.equal(Object.hasOwn(opaque.candidates[0],'id'),false);
  for(const bad of [
    {...juice,candidateId:undefined,platformCategoryId:undefined},
    {...juice,platformCategoryId:'path:made-up-platform-id'},
    {...juice,leaf:false},
    {...juice,path:[]},
    {...juice,label:'不存在的标签'},
    {...juice,source:'model-generated'}
  ])assert.throws(()=>catalog({candidates:[bad]}));
  assert.throws(()=>catalog({candidates:[juice,{...mixer,candidateId:juice.candidateId}]}),/不同分类/);
  assert.throws(()=>catalog({candidates:[juice,{...mixer,platformCategoryId:juice.platformCategoryId}]}),/不同路径/);
  assert.equal(catalog({candidates:[juice,juice]}).candidates.length,1);
});

test('catalog snapshot binds job, shop, product, complete path and expiry',()=>{
  const current=catalog();
  assert.deepEqual(validateCategoryCandidateCatalog(current,{scope,productId:product.id,now}),current);
  for(const changes of [{jobId:'other-job'},{account:'other-account'},{platform:'tiktok'},{mode:'semi-managed'},{storeBindingKey:'store-b'},{site:'英国站'},{catalogKey:'other-directory'}]){
    assert.throws(()=>validateCategoryCandidateCatalog(current,{scope:{...scope,...changes},now}),/不属于当前任务或店铺/);
  }
  assert.throws(()=>validateCategoryCandidateCatalog(current,{productId:'other-product',now}),/不属于当前商品/);
  const modified=structuredClone(current);modified.candidates[0].path[0]='错误父分类';
  assert.throws(()=>validateCategoryCandidateCatalog(modified,{now}),/快照已变化/);
  assert.throws(()=>validateCategoryCandidateCatalog(current,{now:now+16*60*1000}),/过期/);
  assert.throws(()=>catalog({expiresAt:new Date(now+16*60*1000).toISOString()}),/过期/);
});

test('same labels in different full paths and IDs remain distinct candidates requiring confirmation',async()=>{
  const sameLabel={...juice,candidateId:'commercial-juice',platformCategoryId:'shein-999',path:['商用设备','榨汁机']};
  const result=await resolveListingCategory({product,catalog:catalog({candidates:[juice,sameLabel]})},{now});
  assert.equal(result.status,'needs-confirmation');assert.equal(result.category,null);
  assert.equal(result.candidates.length,2);assert.equal(result.proposedCandidate,null);
  const single=await resolveListingCategory({product,catalog:catalog({candidates:[juice]})},{now});
  assert.equal(single.status,'needs-confirmation');assert.equal(single.category,null);
  assert.equal(single.proposedCandidate.platformCategoryId,juice.platformCategoryId);
});

test('confirmation can only reference the frozen snapshot and a real candidate',()=>{
  const current=catalog(),result=confirm(current);
  assert.equal(result.status,'resolved');assert.equal(result.category.platformCategoryId,juice.platformCategoryId);
  assert.equal(result.mapping.version,2);assert.equal(result.mapping.productType,product.productType);
  assert.equal(result.mapping.evidence.catalogDigest,current.digest);
  assert.equal(Object.hasOwn(result.category,'id'),false);
  assert.throws(()=>confirm(current,product,{catalogDigest:'stale'}),/已更新/);
  assert.throws(()=>confirm(current,product,{candidateId:'invented-id'}),/不在本店/);
  assert.throws(()=>confirm(current,{...product,id:'source-2'}),/当前商品/);
});

test('unconfirmed concrete type or missing source path allows single confirmation without reusable cache',async()=>{
  for(const input of [{...product,productTypeConfirmed:false},{...product,productType:''},{...product,sourcePath:[]}]){
    assert.equal(confirm(catalog(),input).mapping,null);
    assert.equal(categoryResolutionCacheKey({scope,product:input}),null);
    const result=await resolveListingCategory({product:input,catalog:catalog(),mappings:[confirm().mapping]},{now});
    assert.equal(result.status,'needs-confirmation');
  }
});

test('confirmed mappings reuse across jobs only for same concrete type, source path and catalog namespace',async()=>{
  const mapping=confirm().mapping,newProduct={...product,id:'source-2',title:'另一款便携式果汁机'};
  const next=catalog({scope:{...scope,jobId:'job-2'},productId:newProduct.id,candidates:[{...juice,candidateId:'new-search-reference'},mixer]});
  const found=await resolveListingCategory({product:newProduct,catalog:next,mappings:[mapping]},{now});
  assert.equal(found.status,'resolved');assert.equal(found.method,'confirmed-product-type-mapping');
  assert.equal(found.category.candidateId,'new-search-reference');
  for(const input of [{...newProduct,productType:'料理搅拌机'},{...newProduct,sourcePath:['家用电器','商用设备']}]){
    assert.notEqual(categoryResolutionCacheKey({scope,product:input}),mapping.id);
    assert.notEqual((await resolveListingCategory({product:input,catalog:next,mappings:[mapping]},{now})).status,'resolved');
  }
  for(const changes of [{account:'another'},{platform:'tiktok'},{mode:'semi-managed'},{storeBindingKey:'store-b'},{site:'英国站'},{catalogKey:'new-directory'}]){
    const other=catalog({scope:{...scope,...changes},productId:newProduct.id});
    assert.notEqual((await resolveListingCategory({product:newProduct,catalog:other,mappings:[mapping]},{now})).status,'resolved');
  }
});

test('mapping must still exist exactly in current shop observations and conflicting mappings do not execute',async()=>{
  const first=confirm().mapping,second=confirm(catalog(),product,{candidateId:mixer.candidateId}).mapping;
  const conflict=await resolveListingCategory({product,catalog:catalog(),mappings:[first,second]},{now});
  assert.equal(conflict.status,'unresolved');assert.equal(conflict.method,'mapping-conflict');
  for(const changed of [{...juice,platformCategoryId:'new-platform-id'},{...juice,path:['别的目录','榨汁机']}]){
    const stale=await resolveListingCategory({product,catalog:catalog({candidates:[changed]}),mappings:[first]},{now});
    assert.equal(stale.status,'unresolved');assert.equal(stale.method,'mapping-unavailable');
  }
  const oldVersion={...first,version:1};
  assert.notEqual((await resolveListingCategory({product,catalog:catalog(),mappings:[oldVersion]},{now})).status,'resolved');
});

test('a UI candidate token without a platform ID must remain unchanged before a mapping can be reused',async()=>{
  const current=catalog({candidates:[{...juice,platformCategoryId:undefined}]}),mapping=confirm(current).mapping;
  const accepted=await resolveListingCategory({product,catalog:current,mappings:[mapping]},{now});
  assert.equal(accepted.status,'resolved');assert.equal(accepted.category.platformCategoryId,null);
  const changed=catalog({candidates:[{...juice,platformCategoryId:undefined,candidateId:'different-observed-token'}]});
  assert.equal((await resolveListingCategory({product,catalog:changed,mappings:[mapping]},{now})).status,'unresolved');
});

test('ranker sees title, real use, source path and complete candidate paths; confidence never authorizes a selection',async()=>{
  let calls=0;
  const result=await resolveListingCategory({product,catalog:catalog(),ranker:async input=>{
    calls++;assert.equal(input.product.title,product.title.normalize('NFKC'));assert.equal(input.product.usage,product.usage);assert.deepEqual(input.product.sourcePath,product.sourcePath);assert.deepEqual(input.catalog.candidates[0].path,juice.path);
    input.catalog.candidates[0].label='模型试图修改候选';
    return {status:'ranked',candidateIds:[juice.candidateId,mixer.candidateId],confidence:1,confirmed:true,category:{id:'invented'},reason:'标题及用途支持水果榨汁，仍需确认完整目录'};
  }},{now});
  assert.equal(calls,1);assert.equal(result.status,'needs-confirmation');assert.equal(result.category,null);
  assert.equal(result.proposedCandidate.label,juice.label);assert.equal(Object.hasOwn(result,'confidence'),false);
  assert.deepEqual(result.rankedCandidates.map(row=>row.candidateId),[juice.candidateId,mixer.candidateId]);
});

test('foreign, duplicated, malformed and unresolved model results cannot create a category or poison peers',async()=>{
  for(const value of [
    {status:'ranked',candidateIds:['invented-id']},
    {status:'ranked',candidateIds:[juice.candidateId,juice.candidateId]},
    {status:'ranked',candidateIds:[]},
    {status:'resolved',candidateIds:[juice.candidateId]},
    {status:'unresolved',candidateIds:[juice.candidateId]}
  ]){
    assert.throws(()=>validateCategoryRanking(value,catalog()));
    const result=await resolveListingCategory({product,catalog:catalog(),ranker:async()=>value},{now});
    assert.equal(result.status,'unresolved');assert.equal(result.category,null);assert.equal(result.errorCode,'CATEGORY_RANKING_INVALID');
  }
  const result=await resolveListingCategory({product,catalog:catalog(),ranker:async()=>({status:'unresolved',candidateIds:[],reason:'用途不足'})},{now});
  assert.equal(result.status,'unresolved');assert.equal(result.method,'model-unresolved');
  const peers=await resolveListingCategoryBatch([
    {product,catalog:catalog(),mappings:[confirm().mapping]},
    {product:{...product,id:'invalid-snapshot-owner'},catalog:catalog()},
    {product,catalog:catalog(),ranker:async()=>{throw new Error('do not expose credential or raw request');}}
  ],{now});
  assert.deepEqual(peers.map(row=>row.status),['resolved','unresolved','unresolved']);
  assert.equal(JSON.stringify(peers).includes('credential'),false);
});

test('empty and sole candidates do not invoke the model',async()=>{
  let calls=0;const ranker=async()=>{calls++;throw new Error('unnecessary model request');};
  const empty=await resolveListingCategory({product,catalog:catalog({candidates:[]}),ranker},{now});
  const sole=await resolveListingCategory({product,catalog:catalog({candidates:[juice]}),ranker},{now});
  const mapped=await resolveListingCategory({product,catalog:catalog(),mappings:[confirm().mapping],ranker},{now});
  assert.equal(calls,0);assert.equal(empty.status,'unresolved');assert.equal(sole.status,'needs-confirmation');assert.equal(mapped.status,'resolved');
});

test('injected configured ranker reuses chat/responses transport and omits account identity from prompt',async()=>{
  for(const format of ['chat-completions','responses']){
    let calls=0;
    const configuration={PLANNER_BASE_URL:'https://planner.invalid/v1',PLANNER_API_KEY:'isolated-fixture-key',PLANNER_MODEL:'fixture-model',PLANNER_API_FORMAT:format,PLANNER_REASONING_EFFORT:'high'};
    const ranker=createCategoryRanker(configuration,{request:async input=>{
      calls++;assert.equal(input.url.href,configuration.PLANNER_BASE_URL+(format==='responses'?'/responses':'/chat/completions'));
      const payload=JSON.parse(input.body);assert.equal(payload.model,'fixture-model');
      const prompt=format==='responses'?payload.input[0].content:payload.messages[1].content,data=JSON.parse(prompt);
      assert.equal(data.product.title,product.title.normalize('NFKC'));assert.equal(data.product.usage,product.usage);assert.deepEqual(data.product.sourcePath,product.sourcePath);assert.deepEqual(data.candidates[0].path,juice.path);
      assert.equal(Object.hasOwn(data.target,'account'),false);assert.equal(input.body.includes(configuration.PLANNER_API_KEY),false);
      const content=JSON.stringify({status:'ranked',candidateIds:[juice.candidateId],reason:'用途对应'});
      return {status:200,body:format==='responses'?{status:'completed',output:[{content:[{type:'output_text',text:content}]}]}:{choices:[{finish_reason:'stop',message:{content}}]}};
    }});
    const result=await resolveListingCategory({product,catalog:catalog(),ranker},{now});
    assert.equal(calls,1);assert.equal(result.status,'needs-confirmation');assert.equal(result.category,null);
  }
});

test('configured ranker reports failures without retries, leaking errors, or accepting truncated output',async()=>{
  const configuration={PLANNER_BASE_URL:'https://planner.invalid/v1',PLANNER_API_KEY:'isolated-fixture-key',PLANNER_MODEL:'fixture-model'};
  for(const response of [{status:503},{status:200,body:{choices:[{finish_reason:'length',message:{content:'{}'}}]}},{status:200,body:{choices:[{finish_reason:'stop',message:{content:'not json'}}]}}]){
    let calls=0;const ranker=createCategoryRanker(configuration,{request:async()=>{calls++;return response;}});
    const result=await resolveListingCategory({product,catalog:catalog(),ranker},{now});
    assert.equal(calls,1);assert.equal(result.status,'unresolved');assert.equal(result.category,null);
    assert.equal(JSON.stringify(result).includes(configuration.PLANNER_API_KEY),false);
  }
  let calls=0;
  const unconfigured=createCategoryRanker({}, {request:async()=>{calls++;}});
  const result=await resolveListingCategory({product,catalog:catalog(),ranker:unconfigured},{now});
  assert.equal(calls,0);assert.equal(result.errorCode,'CATEGORY_RANKER_CONFIG');
});
