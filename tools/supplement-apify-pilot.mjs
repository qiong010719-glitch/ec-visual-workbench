import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchService} from '../src/research.mjs';
import {ApifyClient} from '../src/apify.mjs';
import {normalizeProduct,selectBrands,asinFrom} from '../src/reference-library.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),directory=path.join(root,'data/research/apify-powerbanks-pilot-20261101');
const client=new ApifyClient({APIFY_TOKEN_FILE:path.join(root,'.env.apify')});
const getItems=client.items.bind(client);
client.items=async(id,n)=>{const rows=await getItems(id,n);fs.writeFileSync(path.join(directory,'dataset-'+id+'.json'),JSON.stringify(rows,null,2));return rows;};
const service=new ResearchService({directory,mediaDirectory:path.join(root,'data/media'),client});
const job=service.library.state.campaigns['us-powerbanks-pilot-20261101'];
if(!job || job.runs.slice(0,2).some(r=>r.status!=='SUCCEEDED'))throw new Error('先完成榜单与详情采集');
const categoryUrl=job.input.categoryUrls[0];
const [ranking,details]=job.runs.slice(0,2).map(r=>JSON.parse(fs.readFileSync(path.join(directory,'dataset-'+r.datasetId+'.json'),'utf8')));
const candidates=[...new Map([...ranking].sort((a,b)=>b.position-a.position).map(r=>[asinFrom(r.url),r])).values()].sort((a,b)=>a.position-b.position);
const initial=[];
for(const item of candidates) {
  const observedAsin=asinFrom(item.url),detail=details.find(r=>[r.asin,r.originalAsin,asinFrom(r.url)].includes(observedAsin));
  if(!detail || detail.error)continue;
  const p=normalizeProduct({...detail,position:item.position,categoryUrl,category:'充电宝 / Power Banks / 3C'},{source:'apify',actor:job.runs[1].actor,runId:job.runs[1].runId,datasetId:job.runs[1].datasetId,rankBasis:'bestsellers_list'});
  if(initial.some(v=>v.id===p.id))continue;
  p.rankEvidence={rank:p.rank,categoryUrl,observedAsin,resolvedAsin:p.asin,runId:job.runs[0].runId,datasetId:job.runs[0].datasetId,capturedAt:job.runs[0].submittedAt};
  initial.push(service.library.upsert(p));
}
const selection=selectBrands(initial),missing=selection.brands.filter(b=>b.missing);
job.warnings=[`榜单返回 ${ranking.length} 条，去重后 ${candidates.length} 个商品；观察排名 ${Math.min(...candidates.map(r=>r.position))}–${Math.max(...candidates.map(r=>r.position))}，不代表完整前 100 名。`];
job.phase='按品牌补充有类目排名的商品';job.status='running';service.library.save();
const timer=setInterval(()=>console.log(JSON.stringify({phase:job.phase,runs:job.runs.map(r=>({stage:r.stage,status:r.status,cost:r.usageTotalUsd})),stats:service.library.stats()})),30000);
try {
  let extra=[];
  if(missing.length) {
    const spent=job.runs.filter(r=>r.stage!=='supplement-0').reduce((s,r)=>s+(r.usageTotalUsd || 0),0);
    const cap=Math.min(2,Math.floor((job.input.budgetUsd-spent)*100)/100);
    if(cap<=0)throw new Error('本批 5 美元预算已经用完');
    const categoryOrProductUrls=missing.map(b=>({url:'https://www.amazon.com/s?'+new URLSearchParams({i:'mobile',rh:'n:7073960011',k:b.brand+' power bank'})}));
    const result=await service.actor(job,'supplement-0','junglee/amazon-crawler',{categoryOrProductUrls,maxItemsPerStartUrl:20,maxSearchPagesPerStartUrl:1,useCaptchaSolver:false},cap,missing.length*20);
    for(const detail of result.rows) {
      if(detail.error || !missing.some(b=>b.brand.toLowerCase()===String(detail.brand).toLowerCase()))continue;
      const rank=detail.bestsellerRanks?.find(r=>/\/7073960011(?:[/?]|$)/.test(r.url || ''));
      if(!rank?.rank)continue;
      const p=normalizeProduct({...detail,position:rank.rank,categoryUrl,category:'充电宝 / Power Banks / 3C'},{source:'apify',actor:result.record.actor,runId:result.record.runId,datasetId:result.record.datasetId,rankBasis:'category_bsr'});
      if(initial.some(v=>v.id===p.id) || extra.some(v=>v.id===p.id))continue;
      p.rankEvidence={rank:p.rank,categoryUrl,source:'product_detail_category_bsr',runId:result.record.runId,datasetId:result.record.datasetId,capturedAt:new Date().toISOString()};
      extra.push(service.library.upsert(p));
    }
  }
  const all=[...initial,...extra];
  const brands=selection.brands.map(b=>selectBrands(all.filter(p=>p.brand.toLowerCase()===b.brand.toLowerCase()),{brands:1,perBrand:5}).brands[0]);
  const selected=brands.flatMap(b=>b.products);
  job.categories=[{categoryUrl,observed:candidates.length,verified:initial.length,supplemented:extra.length,selection:{...selection,brands},selectedProductIds:selected,rankingSnapshot:all.map(p=>({id:p.id,asin:p.asin,brand:p.brand,rank:p.rank,url:p.url,basis:p.rankBasis}))}];
  job.phase='下载补充后的参考图片';service.library.save();
  for(const id of selected)await service.library.downloadProduct(id);
  const partial=brands.some(b=>b.missing) || selected.some(id=>{const p=service.library.state.products[id];return p.aplusStatus!=='found'||p.assets.some(a=>a.status!=='downloaded');});
  job.status='partial';job.selectionComplete=!partial;job.phase='首轮采集结束；榜单覆盖缺口保留';job.updatedAt=new Date().toISOString();delete job.error;service.library.save();
  console.log(JSON.stringify({status:job.status,selectionComplete:job.selectionComplete,brands,cost:job.runs.reduce((s,r)=>s+(r.usageTotalUsd || 0),0),selectedProducts:selected.length,stats:service.library.stats(),warnings:job.warnings}));
}catch(error){job.status=error.submissionUnknown?'submission_unknown':'failed';job.error=error.message;service.library.save();throw error;}
finally {clearInterval(timer);service.close();}
