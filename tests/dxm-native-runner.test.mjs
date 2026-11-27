import test from 'node:test';
import assert from 'node:assert/strict';
import {runDxmNativePreparation,runDxmNativePending,nativeOwnedDescendants} from '../src/dxm-native-runner.mjs';

const copy=value=>structuredClone(value),origin='https://www.dianxiaomi.com';
function fixture(){
  const events=[],storeBinding={key:'neutral-shop',storeName:'测试电器店',site:'美国站'},rows=['601234567890101','601234567890102'].map((goodsId,index)=>({id:'row-'+index,goodsId,draftId:'2201146029519291'+(10+index),storeBindingKey:storeBinding.key,storeName:storeBinding.storeName,site:storeBinding.site,sourceUrl:`https://www.temu.com/juicer-g-${goodsId}.html`,platformEditUrl:`${origin}/web/sheinProduct/edit?id=2201146029519291${10+index}`}));
  const args={workflowMode:'required-fields',completionMode:'pending',erpConnection:{expectedAccount:'fixture'},templateSnapshot:{platform:'shein',rules:{autoFillRequired:true}},storeBinding,rows,beforeSubmit:payload=>{events.push('journal');args.journal=copy(payload);}};
  const completed={ready:true,completed:true,rows:rows.map(row=>({draftId:row.draftId,goodsId:row.goodsId,expectedSnapshot:{policy:'native-batch-preserve-fields-v1',member:{draftId:row.draftId,goodsId:row.goodsId}},priceEvidence:[{draftId:row.draftId,variantKey:'sku-a'}],memberPriceEvidence:{draftId:row.draftId}}))};
  const readback=row=>({...row,readOnly:true,saved:true,ready:true,published:false,submitted:false,issues:[]});
  const ops={enter:async()=>{events.push('native-open');return {};},categories:async context=>{events.push('classification');return context;},complete:async()=>{events.push('select-attributes');events.push('fill-dependent-blanks');return copy(completed);},save:async(context,result,before)=>{await before();events.push('one-native-save');},verify:async row=>{events.push('read:'+row.id);return readback(row);},move:async(scope,before)=>{await before();events.push('one-native-pending');},verifyPending:async row=>({...readback(row),movedToPending:true,publicationStatus:'draft',publicationNotSubmitted:true})};
  return {args,ops,events,completed};
}
test('native sequence connects categories, attributes, dependent blanks, one save and exact independent readbacks',async()=>{
  const {args,ops,events}=fixture(),result=await runDxmNativePreparation(args,ops);
  assert.equal(result.status,'prepared');assert.equal(result.rows.length,2);
  assert.deepEqual(events,['native-open','classification','select-attributes','fill-dependent-blanks','journal','one-native-save','read:row-0','read:row-1']);
  assert.equal(args.journal.rows.length,2);assert.equal(args.journal.rows[1].payload.memberPriceEvidence.draftId,args.rows[1].draftId);
});
test('a save acknowledgement timeout only reads back, never sends a second save',async()=>{
  const {args,ops,events}=fixture();ops.save=async(ctx,result,before)=>{await before();events.push('one-native-save');throw new Error('reply timeout');};
  const result=await runDxmNativePreparation(args,ops);assert.equal(result.ready,true);assert.equal(events.filter(e=>e==='one-native-save').length,1);assert.equal(events.filter(e=>e.startsWith('read:')).length,2);
});
test('missing fields or a foreign member cannot reach the batch save journal',async()=>{
  for(const mode of ['missing','foreign']){const {args,ops,events,completed}=fixture();if(mode==='missing'){completed.ready=false;completed.issues=['必填项未完成'];}else completed.rows[1].goodsId='601234567890999';ops.complete=async()=>completed;
    const result=await runDxmNativePreparation(args,ops);assert.equal(result.ready,false);assert.ok(!events.includes('journal'));assert.ok(!events.includes('one-native-save'));
  }
});
test('journal rejection blocks save and an uncertain prior save blocks entry',async()=>{
  const {args,ops,events}=fixture();args.beforeSubmit=()=>{throw new Error('persist failed');};const result=await runDxmNativePreparation(args,ops);assert.equal(result.ready,false);assert.ok(!events.includes('one-native-save'));
  args.rows[0].saveIntent={status:'unknown'};await assert.rejects(runDxmNativePreparation(args,ops),/未核对提交/);
});
test('partial independent readback preserves unknown member and never reports complete',async()=>{
  const {args,ops}=fixture(),verify=ops.verify;ops.verify=async row=>row.id==='row-1'?{...row,readOnly:true,saved:null,ready:false,published:false,submitted:false,issues:['持久化内容不一致']}:verify(row);
  const result=await runDxmNativePreparation(args,ops);assert.equal(result.ready,false);assert.equal(result.rows[0].saved,true);assert.equal(result.rows[1].saved,null);assert.equal(result.retainPage,true);
});
test('pending moves one native batch only after every member save was read back',async()=>{
  const {args,ops,events}=fixture();args.rows.forEach(row=>row.saveIntent={status:'confirmed',payload:{url:row.platformEditUrl}});
  const result=await runDxmNativePending(args,ops);assert.equal(result.ready,true);assert.deepEqual(events,['read:row-0','read:row-1','journal','one-native-pending']);assert.equal(args.journal.rows.length,2);
});
test('unknown pending acknowledgement is reconciled without a second move; wrong identity never succeeds',async()=>{
  const {args,ops,events}=fixture();args.rows.forEach(row=>row.saveIntent={status:'confirmed',payload:{url:row.platformEditUrl}});ops.move=async(scope,before)=>{await before();events.push('one-native-pending');throw new Error('ack timeout');};
  ops.verifyPending=async row=>({...row,draftId:'220114602951999999',readOnly:true,ready:true,movedToPending:true});
  const result=await runDxmNativePending(args,ops);assert.equal(result.ready,false);assert.equal(events.filter(e=>e==='one-native-pending').length,1);
});
test('popup adoption follows owned opener lineage and ignores user tabs with the same URL',()=>{
  const url=origin+'/web/modifyCategory',targets=[{targetId:'mine',type:'page',url:origin+'/web/sheinProduct/draft'},{targetId:'user',type:'page',url},{targetId:'child',type:'page',url,openerId:'mine'},{targetId:'outside',type:'page',url:'https://example.com/web/modifyCategory',openerId:'mine'}];
  assert.deepEqual(nativeOwnedDescendants(targets,['mine'],['/web/modifyCategory']).map(item=>item.targetId),['child']);
});
