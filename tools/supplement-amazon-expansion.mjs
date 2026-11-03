import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApifyClient} from '../src/apify.mjs';
import {BudgetedApifyRuns} from '../src/apify-budget.mjs';
import {asinFrom, resolveBrand, hash, categoryIdFrom} from '../src/reference-library.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/amazon-expansion-20261101');
const planFile=path.join(directory,'category-plan.json');
const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
const authorization=JSON.parse(fs.readFileSync(path.join(directory,'collection-pause.json'),'utf8'));
if(!authorization.newApifyRunsAllowedThisPhase||!plan.activeResume)throw new Error('本阶段未授权新增采集');
const category=plan.categories.find(c=>c.id==='172541');
const paid=new BudgetedApifyRuns({directory,client:new ApifyClient({APIFY_TOKEN_FILE:path.join(root,'.env.apify')}),budgetUsd:plan.budgetUsd,priorUsd:plan.priorApifyUsd});
const timer=setInterval(()=>console.log(JSON.stringify({phase:'补充耳机榜单与详情',budget:paid.budget(),run:paid.state.runs.at(-1)?.status})),30000);
try{
  // The preceding 60-result ranking run charged $0.246 ($0.0041/result).
  const result=await paid.execute('ranking-expand-172541-100-'+plan.activeResume.id,'junglee/amazon-bestsellers',{
    categoryUrls:[category.url],maxItemsPerStartUrl:100,depthOfCrawl:1,detailedInformation:false,useCaptchaSolver:false
  },{cap:0.42,maxItems:100});
  const matches=result.rows.filter(r=>categoryIdFrom(r.categoryUrl)===category.id&&asinFrom(r.url)&&Number(r.position)>0);
  const rows=[...new Map([...matches].sort((a,b)=>Number(b.position)-Number(a.position)).map(r=>[asinFrom(r.url),{
    asin:asinFrom(r.url),position:Number(r.position),rank:'#'+r.position,title:r.name||r.title,url:r.url,thumbnail:r.thumbnailUrl||r.thumbnail,categoryUrl:category.url
  }])).values()].sort((a,b)=>a.position-b.position);
  if(rows.length<category.observed)throw new Error('新榜单覆盖少于已有观察，保留原快照');
  const previousRankingFile=category.rankingFile;
  const rankingFile='ranking-172541-expanded-'+plan.activeResume.id+'.json';
  const snapshot={category:{id:category.id,name:category.name,label:category.label,url:category.url},source:{kind:'apify_bestsellers_list',page_url:category.url,captured_at:result.record.submittedAt,runId:result.record.runId,datasetId:result.record.datasetId},rows,rawRecords:matches.length,previousRankingFile,coverage:{requested:100,rows_returned:rows.length,dataset_complete:'partial'}};
  fs.writeFileSync(path.join(directory,rankingFile),JSON.stringify(snapshot,null,2));
  Object.assign(category,{rankingFile,rankingSource:'apify',observed:rows.length,rankMin:Math.min(...rows.map(r=>r.position)),rankMax:Math.max(...rows.map(r=>r.position)),capturedAt:result.record.submittedAt,status:'ranking_captured'});
  const verified=new Set();
  for(const run of paid.state.runs.filter(r=>r.actor==='junglee/amazon-crawler'&&r.datasetFile)){
    for(const row of JSON.parse(fs.readFileSync(path.join(directory,run.datasetFile),'utf8'))){
      if(row.error||!row.title||!resolveBrand(row).brand)continue;
      for(const asin of [row.asin,row.originalAsin,asinFrom(row.url),asinFrom(row.input)].filter(Boolean))verified.add(asin);
    }
  }
  const missing=rows.filter(r=>!verified.has(r.asin));
  // Current detail runs charged $0.0035/result; each run still has its own cap.
  const affordable=Math.floor((paid.budget().remainingUsd-0.01)/0.004);
  const selected=missing.slice(0,Math.max(0,affordable));
  console.log(JSON.stringify({observed:rows.length,range:[category.rankMin,category.rankMax],missing:missing.length,affordable:selected.length,budget:paid.budget()}));
  if(selected.length)await paid.execute('details-headphones-'+hash(selected.map(r=>r.asin).join(',')).slice(0,12),'junglee/amazon-crawler',{
    categoryOrProductUrls:selected.map(r=>({url:'https://www.amazon.com/dp/'+r.asin})),maxItemsPerStartUrl:1,maxSearchPagesPerStartUrl:1,useCaptchaSolver:false
  },{cap:Number((selected.length*0.004).toFixed(6)),maxItems:selected.length});
  plan.apifyBudget=paid.budget();plan.updatedAt=new Date().toISOString();fs.writeFileSync(planFile,JSON.stringify(plan,null,2));
  console.log(JSON.stringify({phase:'耳机补充结束',budget:paid.budget(),unrequested:missing.length-selected.length}));
}finally{clearInterval(timer);}
