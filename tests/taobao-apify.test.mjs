import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apifyTaobaoProduct,createApifyTaobaoSource,TAOBAO_ACTOR} from '../src/taobao-apify.mjs';
const itemId='1089295452516';
const row={itemId,title:'对标商品',pictures:['//img.alicdn.com/main.jpg'],mainPictureUrl:'https://img.alicdn.com/main.jpg',propsImages:{red:'https://img.alicdn.com/red.jpg'},descriptionImages:['https://img.alicdn.com/detail.jpg']};
const run={id:'run1',status:'SUCCEEDED',defaultDatasetId:'data1',usageTotalUsd:0.019,finishedAt:'2026-11-14T07:00:00Z'};

test('Apify keeps main, SKU and description images separate and verifies the item identity',()=>{
  assert.deepEqual(apifyTaobaoProduct(row,itemId).groups,{main:['https://img.alicdn.com/main.jpg'],sku:['https://img.alicdn.com/red.jpg'],detail:['https://img.alicdn.com/detail.jpg']});
  assert.deepEqual(apifyTaobaoProduct({...row,descriptionImages:[]},itemId).groups.detail,[]);
  assert.throws(()=>apifyTaobaoProduct({...row,itemId:'999999999'},itemId),/编号/);
  assert.deepEqual(apifyTaobaoProduct({...row,pictures:['http://127.0.0.1/private'],mainPictureUrl:null},itemId).groups.main,[]);
});

test('Apify captures one product without reviews with a fixed cap and saves the run before polling',async()=>{
  const snapshots=[];let starts=0;
  const client={configured:true,start:async(actor,input,limits)=>{
    starts++;assert.equal(snapshots.at(-1).status,'submitting');assert.equal(actor,TAOBAO_ACTOR);
    assert.deepEqual(input,{items:[itemId],fetchReviews:false});assert.deepEqual(limits,{maxTotalChargeUsd:0.05,maxItems:1});return {...run,status:'RUNNING'};
  },run:async id=>{assert.equal(id,'run1');assert.equal(snapshots.at(-1).runId,'run1');return run;},items:async(id,max)=>{assert.equal(id,'data1');assert.equal(max,2);return [row];}};
  const result=await createApifyTaobaoSource({client}).getItem(itemId,{checkpoint:r=>snapshots.push(r)});
  assert.equal(starts,1);assert.equal(result.title,row.title);assert.equal(snapshots.at(-1).usageTotalUsd,0.019);
});

test('a failed status read resumes by saved run ID and never starts a second paid run',async()=>{
  let starts=0,reads=0,record;
  const client={configured:true,start:async()=>{starts++;return {...run,status:'RUNNING'};},run:async()=>{reads++;if(reads===1)throw Error('temporary read failure');return run;},items:async()=>[row]};
  const source=createApifyTaobaoSource({client});
  await assert.rejects(source.getItem(itemId,{checkpoint:r=>record=r}),/temporary/);
  assert.equal(record.runId,'run1');
  assert.equal((await source.getItem(itemId,{record,checkpoint:r=>record=r})).title,row.title);assert.equal(starts,1);
});

test('unknown submission remains blocked instead of being silently retried',async()=>{
  let starts=0,record;
  const source=createApifyTaobaoSource({client:{configured:true,start:async()=>{starts++;throw Object.assign(Error('unknown'),{submissionUnknown:true});}}});
  await assert.rejects(source.getItem(itemId,{checkpoint:r=>record=r}),/unknown/);
  assert.equal(record.status,'submission_unknown');
  await assert.rejects(source.getItem(itemId,{record}),/结果未知/);assert.equal(starts,1);
});

test('missing credentials stop before submission and terminal failures retain the run',async()=>{
  let starts=0;const source=createApifyTaobaoSource({client:{configured:false,start:async()=>starts++}});
  await assert.rejects(source.getItem(itemId),/尚未配置/);assert.equal(starts,0);
  let record;const failed=createApifyTaobaoSource({client:{configured:true,start:async()=>run,run:async()=>({...run,status:'FAILED'})}});
  await assert.rejects(failed.getItem(itemId,{checkpoint:r=>record=r}),/FAILED/);assert.equal(record.runId,'run1');
});

test('successful Actor with empty data reports zero results and resync never starts or charges another run',async()=>{
  let starts=0,record,reads=0;
  const source=createApifyTaobaoSource({client:{configured:true,start:async()=>{starts++;return run;},run:async()=>{reads++;return run;},items:async()=>[]}});
  await assert.rejects(source.getItem(itemId,{checkpoint:r=>record=r}),/返回0条商品记录/);
  assert.equal(record.resultCount,0);assert.equal(record.resultCode,'EMPTY_RESULT');assert.equal(record.runId,run.id);
  assert.equal(record.usageTotalUsd,0.019);
  await assert.rejects(source.getItem(itemId,{record,checkpoint:r=>record=r}),/同步已有抓取只核对原任务/);
  assert.equal(starts,1);assert.equal(reads,2);
});

test('multiple results stay distinct from an empty capture and never use an arbitrary product',async()=>{
  let record;
  const source=createApifyTaobaoSource({client:{configured:true,start:async()=>run,run:async()=>run,items:async()=>[row,{...row,itemId:'999999'}]}});
  await assert.rejects(source.getItem(itemId,{checkpoint:r=>record=r}),/多条商品记录/);
  assert.equal(record.resultCount,2);assert.equal(record.resultCode,'MULTIPLE_RESULTS');
});
