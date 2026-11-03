import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApifyClient} from '../src/apify.mjs';
import {BudgetedApifyRuns} from '../src/apify-budget.mjs';
import {ReferenceLibrary,normalizeProduct,selectBrands,asinFrom,hash,resolveBrand} from '../src/reference-library.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/amazon-expansion-20261101');
const planFile=path.join(directory,'category-plan.json'),plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
const detailsOnly=process.argv.includes('--details-only');
const selectOnly=process.argv.includes('--select-only');
const authorization=JSON.parse(fs.readFileSync(path.join(directory,'collection-pause.json'),'utf8'));
if(!selectOnly&&!authorization.newApifyRunsAllowedThisPhase)throw new Error('当前阶段已停止付费采集');
if(!detailsOnly&&!process.argv.includes('--select-captured')&&plan.categories.some(c=>!c.rankingFile))throw new Error('先完成各分支的公开榜单读取，或仅处理已取得的榜单详情');
const client=new ApifyClient({APIFY_TOKEN_FILE:path.join(root,'.env.apify')});
const paid=new BudgetedApifyRuns({directory,client,budgetUsd:plan.budgetUsd,priorUsd:plan.priorApifyUsd});
const library=new ReferenceLibrary(directory,path.join(root,'data/media'));
// Selection is rebuilt from saved datasets. Persist the complete result once.
const persistLibrary=library.save.bind(library);library.save=()=>{};
if(!selectOnly)for(const run of [...paid.state.runs].filter(r=>!['SUCCEEDED','rejected'].includes(r.status)))await paid.execute(run.stage,run.actor,run.input,{cap:run.maxTotalChargeUsd,maxItems:run.maxItems});
const cache=new Map();
const excludedTitle=title=>/\b(?:power banks?|portable chargers?|subscription|auto-renewal|protection plan|service plan)\b/i.test(title || '');
function addRows(rows,provenance){
  for(const row of rows){
    if(row.error||!row.title||!resolveBrand(row).brand)continue;
    for(const asin of [row.asin,row.originalAsin,asinFrom(row.url),asinFrom(row.input)].filter(Boolean))cache.set(asin,{row,provenance});
  }
}
const pilotDirectory=path.join(root,'data/research/apify-powerbanks-pilot-20261101');
const pilot=JSON.parse(fs.readFileSync(path.join(pilotDirectory,'references.json'),'utf8'));
for(const run of Object.values(pilot.campaigns).flatMap(c=>c.runs).filter(r=>r.actor==='junglee/amazon-crawler'&&r.status==='SUCCEEDED')){
  const file=path.join(pilotDirectory,'dataset-'+run.datasetId+'.json');
  if(fs.existsSync(file))addRows(JSON.parse(fs.readFileSync(file,'utf8')),{source:'apify',actor:run.actor,runId:run.runId,datasetId:run.datasetId,capturedAt:run.submittedAt,reused:true});
}
for(const run of paid.state.runs.filter(r=>r.datasetFile))addRows(JSON.parse(fs.readFileSync(path.join(directory,run.datasetFile),'utf8')),{source:'apify',actor:run.actor,runId:run.runId,datasetId:run.datasetId,capturedAt:run.submittedAt});
const snapshots=plan.categories.filter(c=>c.rankingFile).map(c=>({category:c,snapshot:JSON.parse(fs.readFileSync(path.join(directory,c.rankingFile),'utf8'))}));
const candidates=[];
for(let position=0;position<(plan.candidateLimit||50);position++)for(const {category,snapshot} of snapshots){
  const row=snapshot.rows[position];
  if(row&&!excludedTitle(row.title)&&!candidates.some(r=>r.asin===row.asin))candidates.push({...row,categoryId:category.id});
}
const initialCached=candidates.filter(r=>cache.has(r.asin)).length;
console.log(JSON.stringify({phase:'详情采集',rankedCandidates:candidates.length,reused:initialCached,budget:paid.budget()}));
const attempted=new Set(paid.state.runs.filter(r=>r.status==='SUCCEEDED').flatMap(r=>(r.input.categoryOrProductUrls||[]).map(u=>asinFrom(u.url))));
const pending=candidates.filter(r=>!cache.has(r.asin)&&!attempted.has(r.asin));
const timer=setInterval(()=>console.log(JSON.stringify({phase:'详情采集',runs:paid.state.runs.map(r=>({stage:r.stage,status:r.status,cost:r.usageTotalUsd})),budget:paid.budget()})),30000);
try{
  for(let offset=0;!selectOnly&&offset<pending.length;){
    // The live actor reported $0.004/result. The cap reserves $0.005/result to allow price variance.
    const affordable=Math.floor((paid.budget().remainingUsd-0.10)/0.005);
    if(affordable<1)break;
    const batch=pending.slice(offset,offset+Math.min(200,affordable));offset+=batch.length;
    const stage='details-'+hash(batch.map(r=>r.asin).join(',')).slice(0,12);
    const result=await paid.execute(stage,'junglee/amazon-crawler',{categoryOrProductUrls:batch.map(r=>({url:'https://www.amazon.com/dp/'+r.asin})),maxItemsPerStartUrl:1,maxSearchPagesPerStartUrl:1,useCaptchaSolver:false},{cap:batch.length*0.005,maxItems:batch.length});
    addRows(result.rows,{source:'apify',actor:result.record.actor,runId:result.record.runId,datasetId:result.record.datasetId,capturedAt:result.record.submittedAt});
    for(const candidate of batch)attempted.add(candidate.asin);
    console.log(JSON.stringify({phase:'详情批次完成',rows:result.rows.length,verified:cache.size,budget:paid.budget()}));
  }
}finally{clearInterval(timer);}
if(detailsOnly){console.log(JSON.stringify({phase:'已保存已取得榜单的详情，不修改尚在采集的类目计划',budget:paid.budget()}));process.exit(0);}

library.state.categoryCandidates={};
for(const {category,snapshot} of snapshots){
  const products=[],excluded=[];
  for(const ranked of snapshot.rows){
    if(excludedTitle(ranked.title)){excluded.push({asin:ranked.asin,reason:'本轮排除充电宝或非实物订阅服务'});continue;}
    const detail=cache.get(ranked.asin);
    if(!detail){excluded.push({asin:ranked.asin,reason:'未取得品牌和图片详情'});continue;}
    if(excludedTitle(detail.row.title)){excluded.push({asin:ranked.asin,reason:'详情确认为充电宝或非实物订阅服务'});continue;}
    const p=normalizeProduct({...detail.row,position:ranked.position,categoryName:category.label+' / '+category.name+(category.phase==='non3c'?'':' / 3C'),categoryUrl:category.url},{...detail.provenance,rankBasis:'bestsellers_list'});
    if(products.some(x=>x.id===p.id))continue;
    const rankSource=ranked.evidence||snapshot.source;
    p.rankEvidence={rank:p.rank,categoryUrl:category.url,observedAsin:ranked.asin,resolvedAsin:p.asin,source:rankSource.kind||'browser_bestsellers_list',snapshotFile:category.rankingFile,capturedAt:rankSource.captured_at,runId:rankSource.runId||null,datasetId:rankSource.datasetId||null,detailRunId:detail.provenance.runId};
    const membership={id:category.id,label:category.label,name:category.name,categoryUrl:category.url,rank:p.rank,rankBasis:p.rankBasis,capturedAt:rankSource.captured_at};
    const old=library.state.products[p.id];
    p.categoryMemberships=[...(old?.categoryMemberships||[]).filter(c=>c.id!==category.id),membership];
    library.upsert(p);products.push({...p,rank:p.rank,rankEvidence:p.rankEvidence});
  }
  const pendingDetails=snapshot.rows.filter(r=>!excludedTitle(r.title)&&!cache.has(r.asin)&&!attempted.has(r.asin)).map(r=>r.asin);
  const provisional=selectBrands(products);
  const selection=pendingDetails.length?{...provisional,brands:[],missingBrands:5,label:'候选详情尚未核实，不确定头部品牌'}:provisional;
  const ids=selection.brands.flatMap(b=>b.products);
  library.state.categoryCandidates[category.id]=products.map(p=>({id:p.id,asin:p.asin,brand:p.brand,rank:p.rank,rankBasis:p.rankBasis,parentAsin:p.parentAsin,variantAsins:p.variantAsins,rankEvidence:p.rankEvidence}));
  Object.assign(category,{selection,selectedProductIds:ids,verified:products.length,excluded,pendingDetails,status:pendingDetails.length?'details_pending':snapshot.rows.length?'collected':'ranking_empty',selectionComplete:selection.missingBrands===0&&selection.brands.every(b=>b.missing===0)});
  console.log(JSON.stringify({category:category.label,verified:products.length,selected:ids.length,brands:selection.brands.map(b=>({brand:b.brand,count:b.products.length,missing:b.missing}))}));
}
plan.apifyBudget=paid.budget();plan.initialCached=initialCached;plan.updatedAt=new Date().toISOString();plan.phase='现有数据筛选结束，等待补充和逐图分析';
persistLibrary();fs.writeFileSync(planFile,JSON.stringify(plan,null,2));
