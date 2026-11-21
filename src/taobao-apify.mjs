import {ApifyClient} from './apify.mjs';
import {resolveTaobaoLink,taobaoImageUrl} from './taobao-source.mjs';

export const TAOBAO_ACTOR='zen-studio/taobao-detail-scraper';
export const TAOBAO_CAPTURE_CAP_USD=0.05;
const terminal=new Set(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT']);
const list=value=>Array.isArray(value)?value:[];
const image=value=>typeof value==='string'?value:value?.url||value?.src||value?.imageUrl;
const clean=values=>[...new Set(values.map(image).map(taobaoImageUrl).filter(Boolean))].slice(0,20);
export function apifyTaobaoProduct(row,itemId){
  if(!row||String(row.itemId??row.id)!==itemId)throw Error('Apify 返回的商品编号与本次链接不一致，未使用其图片。');
  const props=row.propsImages&&typeof row.propsImages==='object'?Object.values(row.propsImages):[];
  const skus=list(row.skus).flatMap(s=>[s.imageUrl,s.skuImage,s.image]);
  return {title:String(row.titleOriginal||row.title||'淘宝对标商品').slice(0,300),groups:{
    main:clean([...list(row.pictures),row.mainPictureUrl]),
    sku:clean([...props,...skus]),
    detail:clean(list(row.descriptionImages))
  }};
}
export function createApifyTaobaoSource({configuration={},client,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const api=client||new ApifyClient({...configuration,APIFY_API_TOKEN:configuration.APIFY_API_TOKEN||configuration.APIFY_TOKEN});
  return {
    provider:'apify',api:TAOBAO_ACTOR,maxChargeUsd:TAOBAO_CAPTURE_CAP_USD,
    configured:async()=>api.configured,
    resolve:resolveTaobaoLink,
    async getItem(itemId,{record,checkpoint=()=>{}}={}){
      if(!/^\d{5,30}$/.test(itemId))throw Error('商品编号无效。');
      if(!api.configured)throw Error('Apify 尚未配置。请在本机配置 APIFY_API_TOKEN 或复用 APIFY_TOKEN；没有提交付费抓取。');
      if(record&&(record.actor!==TAOBAO_ACTOR||record.itemId!==itemId))throw Error('已有 Apify 任务与当前商品不符，未重新提交。');
      if(record&&!record.runId)throw Error('已有 Apify 提交结果未知，请核对控制台运行记录，未重复提交。');
      if(!record){
        record={provider:'apify',actor:TAOBAO_ACTOR,itemId,status:'submitting',maxChargeUsd:TAOBAO_CAPTURE_CAP_USD,submittedAt:new Date().toISOString()};
        checkpoint({...record});
        try{
          const run=await api.start(TAOBAO_ACTOR,{items:[itemId],fetchReviews:false},{maxTotalChargeUsd:TAOBAO_CAPTURE_CAP_USD,maxItems:1});
          Object.assign(record,{runId:run.id,datasetId:run.defaultDatasetId,status:run.status});checkpoint({...record});
        }catch(error){record.status=error.submissionUnknown?'submission_unknown':'rejected';checkpoint({...record});throw error;}
      }
      for(let i=0;i<100;i++){
        const run=await api.run(record.runId);
        if(!run?.status)throw Error('Apify 未返回运行状态，请同步已有任务；不会重新提交。');
        Object.assign(record,{status:run.status,datasetId:run.defaultDatasetId||record.datasetId,usageTotalUsd:Number.isFinite(run.usageTotalUsd)?run.usageTotalUsd:null,finishedAt:run.finishedAt||null,checkedAt:new Date().toISOString()});checkpoint({...record});
        if(terminal.has(run.status)){
          if(run.status!=='SUCCEEDED')throw Error(`Apify 抓取 ${run.status}，保留原运行编号，未自动重跑。`);
          if(!record.datasetId)throw Error('Apify 缺少数据集编号，请核对原任务。');
          const rows=await api.items(record.datasetId,2);
          record.resultCount=rows.length;
          record.resultCode=rows.length===0?'EMPTY_RESULT':rows.length>1?'MULTIPLE_RESULTS':'ONE_RESULT';
          checkpoint({...record});
          if(!rows.length)throw Error('Apify 任务已结束，但没有抓到这个商品（返回0条商品记录），因此没有取得图片。链接已解析成功；可能是商品暂时不可访问、地区限制或已下架，当前结果无法区分原因。同步已有抓取只核对原任务，不会重新抓取；没有启动分析或生图。');
          if(rows.length>1)throw Error('Apify 返回了多条商品记录，无法唯一确认本次商品，未使用其中任何图片；没有启动分析或生图。');
          return apifyTaobaoProduct(rows[0],itemId);
        }
        await sleep(10000);
      }
      throw Error('Apify 仍在运行，可同步已有任务；不会重新提交。');
    }
  };
}
