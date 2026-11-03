import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary,hash} from '../src/reference-library.mjs';
import {apifyBudget} from '../src/apify-budget.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/amazon-expansion-20261101');
const plan=JSON.parse(fs.readFileSync(path.join(directory,'category-plan.json'),'utf8'));
const learned=JSON.parse(fs.readFileSync(path.join(directory,'learning/references.json'),'utf8'));
const ledger=JSON.parse(fs.readFileSync(path.join(directory,'apify-runs.json'),'utf8'));
const ids=[...new Set(plan.categories.flatMap(c=>c.selectedProductIds||[]))];
if(!ids.length||ids.some(id=>learned.products[id]?.analysis?.status!=='completed'))throw new Error('尚未完成全部已选商品的图片分析，不能标记学习完成');
if(process.argv.includes('--offline')){
  let reachable=true;
  try{await fetch('http://127.0.0.1:4173/api/status',{signal:AbortSignal.timeout(2000)});}
  catch(error){if(error.cause?.code==='ECONNREFUSED')reachable=false;else throw error;}
  if(reachable)throw new Error('离线合并要求原服务已经停止');
}else{
  const live=await fetch('http://127.0.0.1:4173/api/research/status').then(r=>r.json());
  if(live.active||live.queued)throw new Error('工作台正在写入参考库，等待其任务结束后再合并');
  const runtime=await fetch('http://127.0.0.1:4173/api/status').then(r=>r.json());
  if(runtime.active||runtime.queued)throw new Error('工作台仍有作图任务，等待其结束后再合并和重启');
}
const library=new ReferenceLibrary(path.join(root,'data/research'),path.join(root,'data/media'));
const backup=plan.activeResume?.directory||path.join(root,'data/backups/amazon-expansion-20261101');fs.mkdirSync(backup,{recursive:true});
const checkpoint=path.join(backup,'references-before-merge.json');if(!fs.existsSync(checkpoint))fs.copyFileSync(library.file,checkpoint);
// Preserve validated startup collections added by concurrent workspace work.
const effectiveCheckpoint=path.join(backup,'references-effective-before-merge.json');
if(!fs.existsSync(effectiveCheckpoint))fs.writeFileSync(effectiveCheckpoint,JSON.stringify(library.state,null,2));
const workbenchHash=hash(fs.readFileSync(path.join(root,'data/workbench.json')));
const taskCheckpoint=path.join(backup,'workbench-before-merge.json');
if(!fs.existsSync(taskCheckpoint))fs.copyFileSync(path.join(root,'data/workbench.json'),taskCheckpoint);
const newlySelectedIds=ids.filter(id=>!library.state.products[id]);
const newlyAnalyzedHashes=new Set(ids.flatMap(id=>learned.products[id].assets).filter(a=>!library.state.imageAnalyses?.[a.sha256]).map(a=>a.sha256));
const persistLibrary=library.save.bind(library);library.save=()=>{};
for(const id of ids)library.upsert(learned.products[id]);
library.state.imageAnalyses={...learned.imageAnalyses,...library.state.imageAnalyses};
plan.apifyBudget=apifyBudget(ledger);plan.updatedAt=new Date().toISOString();
plan.nextPhase=plan.collectionStop?.message||(plan.collectionBlock?'按用户要求先完成已有图片，后续采集暂停。继续时先补齐 3C 分支和品牌款数，再扩展其他大类；任务总额仍为 5 美元。':'先补齐未完成的 3C 分支、品牌款数和更细子类，再扩展其他大类；未完成部分保留在计划中。');
if(plan.activeResume){
  const resumeRunCostUsd=Number(ledger.runs.filter(r=>r.runId&&r.submittedAt>=plan.activeResume.authorizedAt).reduce((sum,r)=>sum+Number(r.usageTotalUsd||0),0).toFixed(6));
  Object.assign(plan.activeResume,{status:'integrated',completedAt:plan.updatedAt,newlySelectedProducts:newlySelectedIds.length,newlyAnalyzedImages:newlyAnalyzedHashes.size,costAfterUsd:plan.apifyBudget.committedUsd,resumeRunCostUsd,priorBillingAdjustmentUsd:Number((plan.apifyBudget.committedUsd-plan.activeResume.costBeforeUsd-resumeRunCostUsd).toFixed(6))});
}
library.state.expansion=plan;
library.state.campaigns[plan.id]={id:plan.id,kind:'collect',status:'partial',phase:'已选图片分析并接入；采样数量缺口保留',createdAt:plan.createdAt,updatedAt:plan.updatedAt,input:{budgetUsd:plan.budgetUsd,category:plan.focus||'3C 多类目',categoryUrls:plan.categories.map(c=>c.url)},runs:ledger.runs,categories:plan.categories,warnings:plan.categories.filter(c=>!c.selectionComplete).map(c=>`${c.label}：${c.selection?.brands.length||0}/5 品牌，${c.selectedProductIds?.length||0}/25 款`),completedProducts:ids,analysisStatus:'completed'};
persistLibrary();
if(hash(fs.readFileSync(path.join(root,'data/workbench.json')))!==workbenchHash)throw new Error('工作台任务数据在合并期间发生变化，请核对');
const images=ids.flatMap(id=>learned.products[id].assets),uniqueImages=new Set(images.map(a=>a.sha256)).size;
const report={id:plan.id,scope:plan.scope,budget:plan.apifyBudget,collectionBlock:plan.collectionBlock||null,collectionStop:plan.collectionStop||null,resume:plan.activeResume||null,categories:plan.categories.map(c=>({id:c.id,label:c.label,url:c.url,observed:c.observed,verified:c.verified,selection:c.selection,selectionComplete:c.selectionComplete,analysisStatus:c.analysisStatus,selectedProducts:c.selectedProductIds?.length||0,pendingDetails:c.pendingDetails?.length||0})),selectedDistinctProducts:ids.length,uniqueImages,analysisStatus:'completed',analysisUsage:learned.analysisUsage,library:library.stats(),workbenchDataPreserved:true,runs:ledger.runs.filter(r=>r.runId).map(r=>({stage:r.stage,actor:r.actor,runId:r.runId,datasetId:r.datasetId,cost:r.usageTotalUsd,status:r.status})),rejectedSubmissions:ledger.runs.filter(r=>!r.runId).map(r=>({stage:r.stage,status:r.status,error:r.error||null})),updatedAt:new Date().toISOString()};
fs.writeFileSync(path.join(directory,'expansion-report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(directory,'category-plan.json'),JSON.stringify(plan,null,2));
const table=report.categories.map(c=>`| ${c.label} | ${c.observed||0} | ${c.verified||0} | ${c.selection?.brands.length||0}/5 | ${c.selectedProducts}/25 | ${c.selectionComplete?'已满足':'未满足'} | ${c.analysisStatus==='completed'?'所选图片已分析':'待完成'} |`).join('\n');
const brands=report.categories.map(c=>`### ${c.label}\n\n榜单：[${c.label}](${c.url})。${c.selection?.brands.map(b=>`${b.brand} ${b.products.length}/5 款`).join('；')||'尚未完成品牌筛选'}。\n\n${(c.selection?.brands||[]).flatMap(b=>b.products.map(id=>{const p=learned.products[id],m=p.categoryMemberships.find(m=>m.id===c.id);return `- ${p.brand}：[${p.asin}](${p.url})，类目排名 ${m?.rank??'未记录'}，${p.assets.length} 个图片记录，${p.aplusStatus==='found'?'取得 A+':'A+ 未观察到'}。`;})).join('\n')}`).join('\n\n');
const browserCount=plan.categories.filter(c=>c.observed>0&&c.rankingSource!=='apify').length,actorCount=plan.categories.filter(c=>c.observed>0&&c.rankingSource==='apify').length;
const covered=report.categories.filter(c=>c.selectedProducts>0),quotaComplete=report.categories.filter(c=>c.selectionComplete);
const supplemented=plan.categories.filter(c=>c.rankingObservationMode==='merged_per_row_sources');
const observationNote=supplemented.length?`${supplemented.map(c=>c.label).join('、')}的榜单合并了首次采集与第二页补采两个时点。每条排名保留自己的来源运行、数据集和采集时间；合并结果不作为同一瞬间的完整榜单。`:'';
const resumeText=report.resume?`本轮续采新增 **${report.resume.newlySelectedProducts} 条商品资料、${report.resume.newlyAnalyzedImages} 张独立图片分析**。本次新运行费用 $${report.resume.resumeRunCostUsd.toFixed(4)}；旧运行账单校正 $${report.resume.priorBillingAdjustmentUsd.toFixed(4)}，已计入总额。`:'本批包含之前已完成的扩类资料，不能全部算作本次新增。';
const text=`# ${plan.reportTitle||'美国站 3C 扩类采集与学习'}

截至 ${report.updatedAt}，本次扩类活动累计选中 **${ids.length} 条按 ASIN 去重的商品记录**，${uniqueImages} 张独立图片已完成视觉分析并接入后端。全库现有 **${report.library.products} 组商品/店铺资料、${report.library.uniqueImages} 张独立图片**。

${resumeText}

## 范围与费用

${plan.scope}

用户要求每类目 5 个头部品牌、每品牌 5 款。品牌以同一类目采集时已观察榜单的排名倒数之和推算，不是官方品牌榜，也不是精确销量。类目内根据 parent ASIN 或显式关联变体集合去重；缺口不以其他品牌或颜色变体填充。跨类目汇总按 ASIN 去重，不代表全库已按商品家族去重。

当前 ${covered.length}/${report.categories.length} 个已列入计划的分支/部门有学习资料；完整达到 5×5 配额的有 ${quotaComplete.length} 个：${quotaComplete.map(c=>c.label).join('、')||'暂无'}。其余品牌款数、更细子类和尚未列入计划的大类仍未完成，不能称为所有品类均已学完。

${browserCount} 个分支/部门的现用榜单由浏览器免费读取，${actorCount} 个由 Apify 取得。覆盖数量和排名区间以各快照为准，不能从“最多前 100 名”的请求推断实际取得 100 条。此前充电宝试采 $${plan.priorApifyUsd.toFixed(4)}，扩类累计 $${(plan.apifyBudget.committedUsd-plan.priorApifyUsd).toFixed(4)}，本任务合计 **$${plan.apifyBudget.committedUsd.toFixed(4)} / $${plan.budgetUsd.toFixed(2)}**。视觉模型费用另计，本轮没有生成图片。

## 分支进度

| 分支 | 榜单候选 | 已核实详情 | 品牌 | 商品 | 5×5 配额 | 学习 |
|---|---:|---:|---:|---:|---|---|
${table}

“所选图片已分析”仅指成功取得并选中的图片，不表示每品牌 5 款、完整前 100 名、全部下级子类或全部 A+ 已取得。A+ 未观察到的商品不能断言原页面不存在 A+。同一商品可出现在多个分支，分支商品数不能直接相加作为独立商品数。

${observationNote}

${plan.nextPhase}

## 后端应用

工作台“设计参考库”可按类目筛选、查看逐图分析并选择参考；构图、镜头、光影、配色和文字层级进入每个图位的独立策划。商品事实和生图主体继续来自当前商品资料。这里的学习是视觉分析和检索，没有微调模型。

本次接入验收覆盖常规主图、副图及 A+ 的新建策划。已保存的旧方案不会自动改写，需要重新构思才能使用新增参考。极速合图、THD 和店铺装修图生成未包含在本轮接入验收中。

采集文件包含 A+ 比较卡、关联商品小图及品牌故事组件，不能将全部图片都称为高清主视觉。逐图设计分析与实际成图质量分别验收；本次没有调用生图模型验证接入后的成图质量。

## 品牌、商品及排名证据

${brands}

## Apify 运行记录

${report.runs.map(r=>`- [${r.stage}](https://console.apify.com/actors/runs/${r.runId})：${r.status}，$${Number(r.cost||0).toFixed(4)}，数据集 ${r.datasetId}。`).join('\n')}
`;
const blocker=plan.collectionBlock?`\n\n## 采集阻塞\n\n${plan.collectionBlock.message||'Apify 账户额度限制，尚未恢复采集。'}\n`:'';
const document=path.join(root,plan.reportDocument||'docs/美国站3C扩类学习-20261101.md');fs.writeFileSync(document,text+blocker);
console.log(JSON.stringify({document,...report,budget:report.budget,categories:report.categories.map(c=>({label:c.label,products:c.selectedProducts,complete:c.selectionComplete})),runs:report.runs}));
