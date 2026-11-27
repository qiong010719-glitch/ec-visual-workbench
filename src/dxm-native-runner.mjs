import {nativeBatchScope} from './dxm-native-batch.mjs';

const clone=value=>structuredClone(value);
const identity=row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,platformEditUrl:row.platformEditUrl});
const stop=args=>{if(args.isStopped?.())throw new Error('本批任务已暂停，进度已保留');};
const message=error=>String(error?.message||error||'本批结果尚未核对').slice(0,700);
function members(args){
  const scope=nativeBatchScope({platform:args.templateSnapshot?.platform,account:args.erpConnection?.expectedAccount,storeBinding:args.storeBinding,rows:args.rows});
  if(args.workflowMode!=='required-fields'||args.completionMode!=='pending'||args.templateSnapshot?.rules?.autoFillRequired!==true)throw new Error('原生批量只支持补齐资料后转入待发布');
  if(args.rows.some(row=>!row.id||!row.platformEditUrl||row.storeBindingKey!==scope.storeBinding.key)||new Set(args.rows.map(row=>row.id)).size!==args.rows.length)throw new Error('本批成员记录不完整或重复');
  return scope;
}
function exactRows(actual,rows){
  if(!Array.isArray(actual)||actual.length!==rows.length||new Set(actual.map(row=>row.draftId)).size!==rows.length)throw new Error('原生批量表单未完整回读本批成员');
  for(const row of rows){const item=actual.find(item=>item.draftId===row.draftId);if(!item||item.goodsId!==row.goodsId)throw new Error('原生批量表单来源或草稿不匹配');}
}
function blocked(args,issues,{attempted=false}={}){return {status:'needs-review',retainPage:true,ready:false,issues,rows:args.rows.map(row=>({...identity(row),status:'needs-review',saved:attempted?null:false,ready:false,published:false,submitted:false,readOnly:false,issues}))};}
function receipt(row,result){
  if(!result||result.readOnly!==true||result.published===true||result.submitted===true||Object.entries(identity(row)).some(([key,value])=>result[key]!==value))throw new Error('独立回读返回的商品身份或读写状态不一致');
  return clone(result);
}

// All writes belong to the native batch form. Independent per-item pages are
// opened only for reading after the one journalled native save.
export async function runDxmNativePreparation(args,operations){
  const scope=members(args);let committed=false,context,payload;
  if(args.rows.some(row=>row.saveIntent||row.moveIntent||row.publishIntent||row.nativeCategoryIntent&&row.nativeCategoryIntent.status!=='confirmed'))throw new Error('本批存在未核对提交，不能重复保存');
  try{
    stop(args);context=await operations.enter(scope);stop(args);
    context=await operations.categories(context,scope);stop(args);
    const completed=await operations.complete(context,scope);stop(args);
    if(completed?.ready!==true||completed.completed!==true)return blocked(args,completed?.issues?.length?completed.issues:['本批仍有未完成的分类、属性或填空']);
    exactRows(completed.rows,args.rows);
    payload={scopeKey:scope.scopeKey,rows:args.rows.map(row=>{
      const item=completed.rows.find(item=>item.draftId===row.draftId);
      if(item.expectedSnapshot?.policy!=='native-batch-preserve-fields-v1'||item.expectedSnapshot.member?.draftId!==row.draftId||item.expectedSnapshot.member?.goodsId!==row.goodsId||!Array.isArray(item.priceEvidence)||!item.priceEvidence.length||!item.memberPriceEvidence)throw new Error('原生保存缺少本商品完整字段、变种或价格证据');
      return {...identity(row),payload:{url:row.platformEditUrl,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,expectedSnapshot:clone(item.expectedSnapshot),priceEvidence:clone(item.priceEvidence),memberPriceEvidence:clone(item.memberPriceEvidence),createdAt:new Date().toISOString()}};
    })};
    await operations.save(context,completed,async()=>{
      stop(args);if(committed)throw new Error('原生批量保存已记录，不允许重复提交');
      if(typeof args.beforeSubmit!=='function')throw new Error('缺少整批保存前的持久化记录');
      await args.beforeSubmit(clone(payload));committed=true;stop(args);
    });
    if(!committed)throw new Error('原生保存未执行提交记录，不能确认完成');
  }catch(error){
    if(!committed)return blocked(args,[message(error)]);
    // Missing acknowledgements never authorize another save. Continue with
    // independent readback of the exact persisted intent instead.
    await args.onProgress?.({phase:'native-readback',message:'保存回执尚未确认，正在独立核对本批结果'});
  }
  const results=[];
  for(const row of args.rows){
    try{stop(args);const intent=payload.rows.find(item=>item.id===row.id).payload;results.push(receipt(row,await operations.verify(row,intent)));}
    catch(error){results.push({...identity(row),status:'needs-review',saved:null,ready:false,published:false,submitted:false,readOnly:true,issues:[message(error)]});}
  }
  const ready=results.every(row=>row.saved===true&&row.ready===true&&!row.issues?.length);
  return {status:ready?'prepared':'needs-review',ready,retainPage:!ready,rows:results,issues:[...new Set(results.flatMap(row=>row.issues||[]))]};
}

export async function runDxmNativePending(args,operations){
  const scope=members(args);let committed=false;
  if(args.rows.some(row=>row.moveIntent||row.publishIntent||!row.saveIntent?.payload||row.saveIntent.status!=='confirmed'))throw new Error('本批尚未完成保存核对，或已有移动记录，不能重复移入待发布');
  try{
    for(const row of args.rows){stop(args);const checked=receipt(row,await operations.verify(row,row.saveIntent.payload));if(!checked.ready||checked.saved!==true)throw new Error(checked.issues?.join('；')||'保存结果尚未通过独立核对');}
    stop(args);await operations.move(scope,async()=>{
      stop(args);if(committed)throw new Error('本批移入待发布已记录，不允许重复操作');
      if(typeof args.beforeSubmit!=='function')throw new Error('缺少整批移入待发布的持久化记录');
      const payload={scopeKey:scope.scopeKey,rows:args.rows.map(row=>({...identity(row),payload:{url:row.platformEditUrl,draftId:row.draftId,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,sourceUrl:row.sourceUrl,from:'collection',to:'pending-publication',createdAt:new Date().toISOString()}}))};
      await args.beforeSubmit(payload);committed=true;stop(args);
    });
    if(!committed)throw new Error('原生移动未执行提交记录，不能确认待发布');
  }catch(error){if(!committed)return blocked(args,[message(error)]);}
  const results=[];
  for(const row of args.rows){
    try{stop(args);results.push(receipt(row,await operations.verifyPending(row,row.saveIntent.payload)));}
    catch(error){results.push({...identity(row),status:'needs-review',ready:false,movedToPending:false,publicationStatus:'unknown',publicationNotSubmitted:true,published:false,submitted:false,readOnly:true,issues:[message(error)]});}
  }
  const ready=results.every(row=>row.movedToPending===true&&row.ready===true&&!row.issues?.length);
  return {status:ready?'pending-ready':'needs-review',ready,retainPage:!ready,rows:results,issues:[...new Set(results.flatMap(row=>row.issues||[]))]};
}

// A popup is eligible only if the browser reports it as a descendant of the
// currently owned tab. A coincidentally matching user tab is never adopted.
export function nativeOwnedDescendants(targets,ownedIds,allowedPaths){
  const allowed=url=>{try{const value=new URL(url);return value.origin==='https://www.dianxiaomi.com'&&!value.username&&!value.password&&!value.hash&&allowedPaths.includes(value.pathname);}catch{return false;}};
  const ids=new Set(ownedIds);let added=true;
  while(added){added=false;for(const item of targets)if(!ids.has(item.targetId)&&ids.has(item.openerId)&&item.type==='page'&&allowed(item.url)){ids.add(item.targetId);added=true;}}
  return targets.filter(item=>ids.has(item.targetId)&&allowed(item.url));
}
