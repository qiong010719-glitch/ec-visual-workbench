import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {hash} from '../src/reference-library.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/amazon-expansion-20261101');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const plan=read(path.join(directory,'category-plan.json')),resume=plan.activeResume.directory;
const report=read(path.join(directory,'expansion-report.json'));
const progress=read(path.join(directory,'learning-progress.json'));
const learned=read(path.join(directory,'learning/references.json'));
const before=read(path.join(resume,'main-references-before.json'));
const previousProgress=read(path.join(resume,'learning-progress.json'));
const integration=read(path.join(root,'tests/results/expansion-integration-report.json'));
const ui=read(path.join(root,'tests/results/live-reference-report.json'));
const quality=read(path.join(resume,'asset-quality.json'));
const samples=read(path.join(resume,'visual-sample-check-non3c.json'));
const fallback=read(path.join(resume,'vision-fallback-diagnostic.json'));
const code=read(path.join(resume,'code-checks.json'));
const billing=read(path.join(resume,'apify-cost-verification.json'));
assert.equal(integration.passed,true);assert.equal(ui.passed,true);
assert.equal(progress.analyzedUnique,progress.expectedUnique);
assert.equal(integration.stats.uniqueImages,report.library.uniqueImages);
assert.equal(ui.uniqueImages,report.library.uniqueImages);
assert.ok(samples.images.every(s=>s.analysisMatchesVisibleDesign===true));
assert.ok(samples.images.every(s=>!s.corrections?.length||s.correctionsAppliedAt));
assert.equal(fallback.analysisMatchesVisibleDesign,true);
assert.equal(quality.invalidImages.length,0);
assert.equal(billing.allFinal,true);
assert.equal(billing.budget.committedUsd,report.budget.committedUsd);
for(const item of code.files)assert.equal(hash(fs.readFileSync(path.join(root,item.file))),item.sha256,'测试后源文件发生变化：'+item.file);
const oldHashes=new Set(Object.values(before.products).flatMap(p=>p.assets.map(a=>a.sha256)));
const ids=[...new Set(plan.categories.flatMap(c=>c.selectedProductIds))];
const newHashes=[...new Set(ids.flatMap(id=>learned.products[id].assets.map(a=>a.sha256)))].filter(sha=>!oldHashes.has(sha));
const models={};for(const sha of newHashes){const model=learned.imageAnalyses[sha].model;models[model]=(models[model]||0)+1;}
const usage=Object.fromEntries(['calls','promptTokens','completionTokens'].map(k=>[k,progress.usage[k]-(previousProgress.usage?.[k]||0)]));
const checkedAt=new Date().toISOString();
const final={verifiedAt:checkedAt,resume:report.resume,integration,ui,visualSamplesThisResume:samples.images.length+1,visualSampleEvidence:[path.relative(directory,path.join(resume,'visual-sample-check-non3c.json')),path.relative(directory,path.join(resume,'vision-fallback-diagnostic.json'))],automatedTests:{passed:code.passed,failed:code.failed,checkedAt:code.checkedAt},sourceChecks:{checkedScripts:code.checkedScripts},analysisProgress:progress,newImageModels:models,newAnalysisUsage:usage,assetQuality:quality,apifyCostVerification:billing,apifyCallsAfterPause:0,imageGenerationQualityTested:false,browserSessionClosed:read(path.join(resume,'browser-session.json')).closed===true,limitations:['八个新增部门均有五个样本领先品牌，但均未达到每品牌五款；目前完整满足配额的仍只有耳机。','七个新增部门取得 100 条榜单候选，母婴为 98 条；部门覆盖不代表全部下级类目覆盖。','品牌依据已观察榜单推算，不是官方品牌销量榜。','学习是逐图设计分析与检索，没有模型微调；没有验证本轮接入后的实际生图效果。','部分图片是低分辨率比较卡和关联商品组件；A+ 未观察到不代表不存在。']};
assert.equal(final.browserSessionClosed,true);
fs.writeFileSync(path.join(directory,'final-verification.json'),JSON.stringify(final,null,2));

const marker='\n## 本轮完成核对\n';
const document=path.join(root,plan.reportDocument);
const original=fs.readFileSync(document,'utf8').split(marker)[0];
const extra=`${marker}

本轮选中 ${quality.newProductRecordsSinceResume} 条新商品资料，分析了相对本轮开始时新增的 ${quality.newUniqueImageFilesSinceResume} 张独立图片。其中 ${quality.newUniqueImageFilesSinceResume-report.resume.newlyAnalyzedImages} 张与同步加入的精选风格参考集重合，合并时向全库新增 ${report.resume.newlyAnalyzedImages} 张独立图片。上述 ${quality.newUniqueImageFilesSinceResume} 张图片主角色：主图 ${quality.newPrimaryRoles.main}、副图 ${quality.newPrimaryRoles.gallery}、A+ ${quality.newPrimaryRoles.aplus}、品牌故事 ${quality.newPrimaryRoles.brand_story}；同一图片仍保留多个实际使用角色。其中 ${quality.newSmallImagesUnder500pxLongEdge} 张的长边小于 500 像素。所有文件通过完整性检查。

实际模型分析按图片哈希统计：${Object.entries(models).map(([m,n])=>m+' '+n+' 张').join('；')}。原视觉模型上游返回 502/503 后，先用已配置的 gpt-5.6-luna 完成一张真实图片的输入与视觉核对，再仅继续缺失分析。未更改网站默认视觉模型配置。有效分析响应累计增加 ${usage.calls} 次，记录输入 ${usage.promptTokens}、输出 ${usage.completionTokens} tokens；这些用量不等于供应商账单，视觉费用不计入 Apify 上限。

直接查看并核对了八个新部门的八张 A+ 原图及一张备用模型分析图。修正一处瓶盖裁切描述，原始模型文本与修正证据均保留；这属于抽样核对，不代表全部图片都经过第二遍人工复核。

本轮 ${code.passed} 项自动测试通过，${code.checkedScripts} 个页面脚本检查通过。只读接入验证检查全部 ${integration.sha256Verified} 张本活动独立图片的哈希、逐图分析、排名来源和筛选可重现性；验证 ${integration.planning.length} 个商品名称自动检索、${integration.categoryPlanning.length} 个类目的明确参考选择及逐图策划。页面核对覆盖新增类目筛选、真实分析展示与 ${integration.storefrontPages} 个既有装修页面，其中 Charmast 的七个装修页面均保留。商品任务与原有资料保留。

新增中文检索包括床单、身体乳、猫粮、净水吸管、电子蜡烛、捏捏玩具和纸尿裤。具体商品类型优先匹配，配件及跨商品类型只提供通用设计观察。

接入检查中修正了车载手机支架的同义词误判，阻止身体喷雾通过分析标签变成身体乳参考，并区分婴儿与宠物尿裤。每个图位先选择同类商品的对应角色素材，仅在同类素材缺少该角色时使用通用风格参考。上述行为已纳入回归测试。

Apify 累计 **$${report.budget.committedUsd.toFixed(4)} / $${report.budget.budgetUsd.toFixed(2)}**，已授权剩余 **$${report.budget.remainingUsd.toFixed(4)}**。本轮采集已关闭，可在后续补采中继续使用剩余额度。
`;
fs.writeFileSync(document,original+extra);
const readmeFile=path.join(root,'README.md');
let readme=fs.readFileSync(readmeFile,'utf8');
readme=readme.replace('当前总上限仍为 5 美元，累计 $4.9395。`collection-pause.json` 记录本轮采集已经结束；继续补采需要新的采集预算。',`用户已将累计上限提高到 15 美元，本轮核对累计 $${report.budget.committedUsd.toFixed(4)}，剩余 $${report.budget.remainingUsd.toFixed(4)}。\`collection-pause.json\` 记录当前采集阶段已结束，剩余额度可供后续补采使用。`);
readme=readme.replace('2026-11-01 充值后续采新增 83 条商品资料','前一轮 2026-11-01 3C 续采新增 83 条商品资料');
const readmeMarker='\n<!-- non3c-learning-status -->\n';
const statusBlock=`${readmeMarker}\n本轮新增家居、厨具、美妆个护、宠物、运动户外、工具、玩具和母婴八个部门的参考：新增 **${report.resume.newlySelectedProducts} 条商品资料、${report.resume.newlyAnalyzedImages} 张独立图片分析**，已接入常规主副图和 A+ 的新策划。全库当前为 **${report.library.products} 组资料、${report.library.uniqueImages} 张独立图片**。每品牌五款的缺口仍保留。图片分析因上游服务故障使用了两个模型；具体数据、费用、抽样修正和验收见 [非 3C 扩类学习记录](${plan.reportDocument})。\n<!-- /non3c-learning-status -->\n`;
readme=readme.includes(readmeMarker)?readme.replace(/\n<!-- non3c-learning-status -->[\s\S]*?<!-- \/non3c-learning-status -->\n/,statusBlock):readme+statusBlock;
fs.writeFileSync(readmeFile,readme);
const planDoc=path.join(root,'docs/superpowers/plans/2026-11-01-amazon-non3c-expansion.md');
fs.writeFileSync(planDoc,fs.readFileSync(planDoc,'utf8').replaceAll('- [ ]','- [x]'));
console.log(JSON.stringify({verifiedAt:checkedAt,library:report.library,newProducts:report.resume.newlySelectedProducts,newImages:newHashes.length,models,tests:code.passed,budget:report.budget,document}));
