import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApifyClient} from '../src/apify.mjs';
import {BudgetedApifyRuns} from '../src/apify-budget.mjs';
import {asinFrom,hash,categoryKeyFrom} from '../src/reference-library.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),directory=path.join(root,'data/research/amazon-expansion-20261101');
const file=path.join(directory,'category-plan.json'),plan=JSON.parse(fs.readFileSync(file,'utf8'));
const retryEmpty=process.argv.includes('--retry-empty');
const retryKeyIndex=process.argv.indexOf('--retry-key');
const retryKey=retryKeyIndex<0?'':process.argv[retryKeyIndex+1];
if(retryKeyIndex>=0&&(!retryEmpty||!retryKey||!/^[a-zA-Z0-9-]{1,80}$/.test(retryKey)))throw new Error('重试标识仅用于明确授权的空榜单重试');
const pending=plan.categories.filter(c=>retryEmpty?c.status==='ranking_empty':!c.rankingFile);if(!pending.length){console.log('榜单已取得');process.exit(0);}
const authorization=JSON.parse(fs.readFileSync(path.join(directory,'collection-pause.json'),'utf8'));
if(!authorization.newApifyRunsAllowedThisPhase)throw new Error('当前阶段已停止付费采集');
const paid=new BudgetedApifyRuns({directory,client:new ApifyClient({APIFY_TOKEN_FILE:path.join(root,'.env.apify')}),budgetUsd:plan.budgetUsd,priorUsd:plan.priorApifyUsd});
if(paid.state.runs.some(r=>!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT','rejected'].includes(r.status)))throw new Error('先完成已有远端运行的同步，避免并发覆盖费用台账');
const perCategory=Number(plan.newCategoryRankingLimit||30);
if(!Number.isInteger(perCategory)||perCategory<5||perCategory>100)throw new Error('榜单候选数必须为 5 到 100');
const maxItems=pending.length*perCategory,cap=maxItems*0.005;
const stage=(retryEmpty?'ranking-empty-canonical-':'ranking-')+hash(pending.map(c=>c.id).join(',')).slice(0,12)+(retryKey?'-'+retryKey:'');
const timer=setInterval(()=>console.log(JSON.stringify({phase:'Apify 公开榜单采集',categories:pending.length,budget:paid.budget(),runs:paid.state.runs.map(r=>({stage:r.stage,status:r.status,cost:r.usageTotalUsd}))})),30000);
try{
  const result=await paid.execute(stage,'junglee/amazon-bestsellers',{categoryUrls:pending.map(c=>retryEmpty?'https://www.amazon.com/gp/bestsellers/'+new URL(c.url).pathname.split('/zgbs/').at(-1):c.url),maxItemsPerStartUrl:perCategory,depthOfCrawl:1,detailedInformation:false,useCaptchaSolver:false},{cap,maxItems});
  for(const c of pending){
    const matches=result.rows.filter(r=>categoryKeyFrom(r.categoryUrl)===c.id&&asinFrom(r.url)&&Number(r.position)>0);
    const rows=[...new Map([...matches].sort((a,b)=>Number(b.position)-Number(a.position)).map(r=>[asinFrom(r.url),{asin:asinFrom(r.url),position:Number(r.position),rank:'#'+r.position,title:r.name||r.title,url:r.url,thumbnail:r.thumbnailUrl||r.thumbnail,categoryUrl:c.url}])).values()].sort((a,b)=>a.position-b.position);
    const snapshot={category:{id:c.id,name:c.name,label:c.label,url:c.url},source:{kind:'apify_bestsellers_list',page_url:matches[0]?.categoryUrl||c.url,captured_at:result.record.submittedAt,runId:result.record.runId,datasetId:result.record.datasetId},rows,rawRecords:matches.length,coverage:{requested:perCategory,rows_returned:rows.length,dataset_complete:'partial'}};
    const rankingFile='ranking-'+c.id.replace(/[^a-z0-9_-]/gi,'_')+'.json';fs.writeFileSync(path.join(directory,rankingFile),JSON.stringify(snapshot,null,2));
    Object.assign(c,{rankingFile,rankingSource:'apify',observed:rows.length,rankMin:rows.length?Math.min(...rows.map(r=>r.position)):null,rankMax:rows.length?Math.max(...rows.map(r=>r.position)):null,capturedAt:result.record.submittedAt,status:rows.length?'ranking_captured':'ranking_empty'});
    if(matches[0]?.subcategories)c.subcategories=matches[0].subcategories.map(n=>({name:n.categoryName,url:n.categoryUrl}));
    console.log(JSON.stringify({category:c.label,observed:rows.length,range:[c.rankMin,c.rankMax]}));
  }
  plan.browserBlock={...(plan.browserBlock||{}),status:'browser_path_stopped',next:'使用已授权 Apify 公开榜单采集；useCaptchaSolver=false'};
  plan.apifyBudget=paid.budget();plan.updatedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(plan,null,2));
}finally{clearInterval(timer);}
