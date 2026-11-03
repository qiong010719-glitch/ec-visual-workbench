import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApifyClient} from '../src/apify.mjs';
import {BudgetedApifyRuns} from '../src/apify-budget.mjs';
import {asinFrom,categoryKeyFrom,hash} from '../src/reference-library.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/amazon-expansion-20261101');
const file=path.join(directory,'category-plan.json'),plan=JSON.parse(fs.readFileSync(file,'utf8'));
const authorization=JSON.parse(fs.readFileSync(path.join(directory,'collection-pause.json'),'utf8'));
if(!authorization.newApifyRunsAllowedThisPhase||!plan.activeResume)throw new Error('当前阶段不允许新增采集');
const category=plan.categories.find(c=>c.id===process.argv[2]&&c.phase==='non3c');
if(!category?.rankingFile)throw new Error('需要已取得榜单的非 3C 部门 ID');
const previousRankingFile=category.rankingFile;
const previous=JSON.parse(fs.readFileSync(path.join(directory,previousRankingFile),'utf8'));
const paid=new BudgetedApifyRuns({directory,client:new ApifyClient({APIFY_TOKEN_FILE:path.join(root,'.env.apify')}),budgetUsd:plan.budgetUsd,priorUsd:plan.priorApifyUsd});
if(paid.state.runs.some(r=>!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT','rejected'].includes(r.status)))throw new Error('先同步已有远端运行');
// Page-two URLs were observed in the saved ranking dataset; keep their exact source.
const raw=paid.state.runs.filter(r=>r.actor==='junglee/amazon-bestsellers'&&r.datasetFile).flatMap(r=>JSON.parse(fs.readFileSync(path.join(directory,r.datasetFile),'utf8')));
const pageTwo=raw.find(r=>categoryKeyFrom(r.categoryUrl)===category.id&&new URL(r.categoryUrl).searchParams.get('pg')==='2')?.categoryUrl;
if(!pageTwo)throw new Error('没有观察到第二页链接');
const stage='ranking-page2-'+hash(category.id).slice(0,10)+'-'+plan.activeResume.id;
const timer=setInterval(()=>console.log(JSON.stringify({phase:'补采第二页',category:category.label,budget:paid.budget(),status:paid.state.runs.at(-1)?.status})),30000);
try{
  const result=await paid.execute(stage,'junglee/amazon-bestsellers',{categoryUrls:[pageTwo],maxItemsPerStartUrl:50,depthOfCrawl:1,detailedInformation:false,useCaptchaSolver:false},{cap:0.25,maxItems:50});
  const source={kind:'apify_bestsellers_list',page_url:pageTwo,captured_at:result.record.submittedAt,runId:result.record.runId,datasetId:result.record.datasetId};
  const matches=result.rows.filter(r=>categoryKeyFrom(r.categoryUrl)===category.id&&asinFrom(r.url)&&Number(r.position)>0&&Number(r.position)<=100);
  const fresh=[...new Map(matches.map(r=>[asinFrom(r.url),{asin:asinFrom(r.url),position:Number(r.position),rank:'#'+r.position,title:r.name||r.title,url:r.url,thumbnail:r.thumbnailUrl||r.thumbnail,categoryUrl:category.url,evidence:source}])).values()];
  const newAsins=new Set(fresh.map(r=>r.asin)),newRanks=new Set(fresh.map(r=>r.position));
  const older=previous.rows.filter(r=>!newAsins.has(r.asin)&&!newRanks.has(r.position)).map(r=>({...r,evidence:r.evidence||previous.source}));
  const rows=[...older,...fresh].sort((a,b)=>a.position-b.position);
  const improved=rows.length>previous.rows.length;
  const output={category,source,previousRankingFile,rows,rawRecords:matches.length,coverage:{requested:50,rows_returned:fresh.length,combined_rows:rows.length,multiple_observation_times:true,improved}};
  const rankingFile='ranking-'+category.id.replace(/[^a-z0-9_-]/gi,'_')+'-page2-'+plan.activeResume.id+'.json';
  fs.writeFileSync(path.join(directory,rankingFile),JSON.stringify(output,null,2));
  if(improved)Object.assign(category,{rankingFile,observed:rows.length,rankMin:Math.min(...rows.map(r=>r.position)),rankMax:Math.max(...rows.map(r=>r.position)),capturedAt:source.captured_at,status:'ranking_captured',rankingObservationMode:'merged_per_row_sources'});
  category.rankingSupplement={file:rankingFile,runId:result.record.runId,improved,previousRows:previous.rows.length,combinedRows:rows.length};
  plan.apifyBudget=paid.budget();plan.updatedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(plan,null,2));
  console.log(JSON.stringify({category:category.label,improved,old:previous.rows.length,new:rows.length,returned:fresh.length,ranks:fresh.map(r=>r.position),budget:paid.budget()}));
}finally{clearInterval(timer);}
