import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const help = `只读输入的店小秘现场预检报告（不联网、不启动服务、不操作浏览器）

用法：
  node tools/report-listing-live-preflight.mjs --job-json <文件|-> --source-json <来源事实文件> --out-prefix <输出前缀> [--job-origin <输入来源说明>]

--job-json     单个job对象、{job}包装或包含该任务的{jobs}数据；- 表示从stdin读取。
--job-id       读取{jobs}时指定任务ID，默认listing-live-30-20261122-01。
--source-json  来源属性JSON数组，或{rows}/{products}/{facts}包装。
--out-prefix   只写此前缀的.json和.md；不会另存完整job或binding。
--job-origin   stdin的原始读取路径，例如GET http://127.0.0.1:4185/api/listing-workflow/jobs/listing-live-30-20261122-01。

输出只说明输入快照中的事实。运行中或未完整落盘的rows按历史记录展示，
不算本轮逐行结果；SKU数值、单位分别保留，缺失值和单位不推测。
`;
const array = value => Array.isArray(value) ? value : [];
const present = value => value !== undefined && value !== null && String(value).trim() !== '';
const raw = value => present(value) ? value : null;
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const unique = values => [...new Set(values.filter(present).map(String))];
const issue = value => typeof value === 'string' ? value : value?.message || '';
const fields = {variationSku:'SKU货号',price:'申报价',skuLength:'包裹长',skuWidth:'包裹宽',skuHeight:'包裹高',weight:'重量',stock:'库存'};
const unitLabels = {dimension:'包裹尺寸单位',weight:'重量单位',priceCurrency:'申报价币种'};
const inspectionPhases = new Set(['scan','match','inspect']);
const publicationStates = ['submitted','listed','reviewing','pending-launch','online','failed','unknown','draft'];
const readFailureText = /Debugger|CDP|disconnected|unattached|导航|超时|连接失败|连接中断|尚未读取|尚未加载|仍未加载|加载未完成|未读取完成|页面已关闭/i;

function sourceRows(input) {
  const rows = Array.isArray(input) ? input : input?.rows || input?.products || input?.facts;
  if (!Array.isArray(rows)) throw new Error('来源事实必须是数组或rows/products/facts数组');
  const keys = ['goodsId','title','sourceUrl','origin','frameType','frameMaterial','surface','theme'];
  const seen = new Set();
  return rows.map(row => {
    if (!present(row.goodsId) || seen.has(String(row.goodsId))) throw new Error('来源事实含缺失或重复goodsId');
    seen.add(String(row.goodsId));
    return Object.fromEntries(keys.map(key => [key, key === 'goodsId' ? String(row[key]) : raw(row[key])]));
  });
}

function snapshotOf(row) {
  return ['reconciliation','preparation','inspection'].map((key, order) => {
    const result = row[key];
    if (!result?.snapshot || typeof result.snapshot !== 'object') return null;
    const checkedAt = result.checkedAt || result.verification?.checkedAt || result.snapshot.checkedAt || row.checkedAt || null;
    return {key, result, snapshot:result.snapshot, checkedAt, order};
  }).filter(Boolean).sort((a,b) => time(b.checkedAt)-time(a.checkedAt) || a.order-b.order)[0] || null;
}

function skuFacts(evidence, readComplete) {
  if (!evidence) return {skuCount:null,observedSkuRows:0,skus:[],unmappedFields:{},fieldGaps:[],unitGaps:[]};
  const snapshot = evidence.snapshot, values = snapshot.fields || {}, ids = array(values.variationSku);
  const category = array(snapshot.items).find(item=>item.label==='产品分类');
  const categoryChosen = [...array(category?.selections),...array(category?.checked),...array(category?.controls).map(control=>control.value)].some(present);
  const units = snapshot.units || snapshot.packageUnits || evidence.result.units || {};
  const dimensionUnit = raw(units.dimension), weightUnit = raw(units.weight);
  const unmappedFields = {}, fieldGaps = [], unitGaps = [];
  for (const key of Object.keys(fields)) {
    if (key !== 'variationSku' && array(values[key]).length !== ids.length && array(values[key]).length) unmappedFields[key] = values[key];
  }
  const skus = ids.map((id,index) => {
    const at = key => key === 'variationSku' ? raw(id) : array(values[key]).length === ids.length ? raw(values[key][index]) : null;
    const prices = array(snapshot.priceSnapshot);
    const price = prices[index]?.sku === id ? prices[index] : prices.filter(item=>item.sku===id).length === 1 ? prices.find(item=>item.sku===id) : null;
    const missing = Object.keys(fields).filter(key=>at(key)===null);
    if (readComplete) for (const key of missing) fieldGaps.push(key);
    const unknownUnits = [];
    if (!dimensionUnit) unknownUnits.push('dimension');
    if (!weightUnit) unknownUnits.push('weight');
    if (at('price') !== null && !present(price?.declaredCurrency)) unknownUnits.push('priceCurrency');
    if (readComplete) unitGaps.push(...unknownUnits);
    return {index:index+1,sku:at('variationSku'),price:at('price'),priceCurrency:raw(price?.declaredCurrency),
      package:{length:at('skuLength'),width:at('skuWidth'),height:at('skuHeight'),dimensionUnit,weight:at('weight'),weightUnit},
      stock:at('stock'),missing:readComplete?missing:[],unreadFields:readComplete?[]:missing,unknownUnits};
  });
  return {skuCount:readComplete&&(ids.length||categoryChosen)?ids.length:null,observedSkuRows:ids.length,skus,unmappedFields,fieldGaps,unitGaps};
}

function formFacts(snapshot) {
  if (!snapshot) return null;
  const labels = new Set(['产品分类','产地','制造地点','英文标题','产品货号','主题','材质','画框材质','画面材质','表面材质','承诺发货时效','运费模板']);
  const result = {};
  for (const item of array(snapshot.items)) if (labels.has(item.label)) result[item.label] = unique([...array(item.selections),...array(item.checked),...array(item.controls).map(control=>control.value)]);
  result.仓库 = array(snapshot.warehouses);
  return result;
}

function intentSummary(value) {
  if (!value || typeof value !== 'object') return null;
  return {status:raw(value.status),submittedAt:raw(value.submittedAt),confirmedAt:raw(value.confirmedAt),detectedAt:raw(value.detectedAt)};
}

function frequencies(rows, key) {
  const counts = new Map();
  for (const row of rows) for (const text of new Set(row[key] || [])) counts.set(text,(counts.get(text)||0)+1);
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN')).map(([name,targetCount])=>({name,targetCount}));
}

function summarize(rows, current) {
  const facts = rows.filter(row=>row.readComplete);
  const failed = rows.filter(row=>row.failed);
  return {targets:rows.length,recordedChecked:facts.length,currentChecked:current?facts.length:0,
    recordedFailed:failed.length,currentFailed:current?failed.length:0,
    unresolved:rows.filter(row=>['ambiguous','unclaimed','pending'].includes(row.locationStatus)).length,
    withoutSnapshot:rows.filter(row=>!row.snapshotEvidence).length,partialSnapshots:rows.filter(row=>row.snapshotEvidence&&!row.readComplete).length,withIssues:rows.filter(row=>row.issues.length).length,
    saveIntents:rows.filter(row=>row.intents.save).length,moveIntents:rows.filter(row=>row.intents.move).length,publishIntents:rows.filter(row=>row.intents.publish).length,
    saved:rows.filter(row=>row.saved===true).length,
    publication:Object.fromEntries(publicationStates.map(status=>[status,rows.filter(row=>row.publicationStatus===status).length])),
    publishedFlag:rows.filter(row=>row.published===true).length,
    dataIssueFrequency:frequencies(rows,'dataIssues'),readIssueFrequency:frequencies(rows,'readIssues'),otherIssueFrequency:frequencies(rows,'otherIssues'),fieldGapFrequency:frequencies(rows,'fieldGaps'),unitGapFrequency:frequencies(rows,'unitGaps')};
}

export function buildPreflightReport(job, inputFacts, provenance = {}) {
  if (!job || !Array.isArray(job.rows) || !job.id) throw new Error('输入不包含有效单个job及rows');
  const facts = sourceRows(inputFacts), factIds = new Set(facts.map(row=>row.goodsId));
  const progress = job.progress || {}, running = job.status === 'running' || progress.active === true || !!job.action;
  // inspect() updates progress during its loop, but persists its complete rows only after it returns.
  const incompleteInspection = inspectionPhases.has(progress.phase) && (!time(job.inspectedAt) || time(job.inspectedAt) < time(progress.updatedAt));
  const current = !running && !incompleteInspection;
  const freshness = running ? '当前执行仍在运行；逐行结果仅为历史留存，不计作本轮最终结果' : incompleteInspection ? '本轮核对尚未完整落盘；逐行结果仅为历史留存' : '已持久化快照；具体事实时间以每行checkedAt为准';
  const rows = job.rows.map(row => {
    const evidence = snapshotOf(row);
    const result = evidence?.result || row.inspection || {};
    const issues = unique([...array(row.issues),...array(result.issues),row.error,result.error].map(issue));
    const unresolved = ['ambiguous','unclaimed','pending'].includes(result.status || row.locationStatus) || result.listOnly === true;
    const readComplete = !!evidence && !issues.some(text=>readFailureText.test(text)) && (evidence.key!=='inspection'||['located','claimed','verified','prepared'].includes(result.status));
    const failed = !unresolved && (!readComplete && (!!evidence || result.status==='failed' || issues.length>0 && result.status==='needs-review') || issues.some(text=>readFailureText.test(text)));
    const dataIssues = readComplete ? issues : [], readIssues = failed ? issues : [], otherIssues = !readComplete&&!failed ? issues : [];
    const sku = skuFacts(evidence,readComplete);
    return {goodsId:String(row.goodsId),storeBindingKey:raw(row.storeBindingKey),storeName:raw(row.storeName),site:raw(row.site),
      draftId:raw(row.draftId || result.draftId || row.resolvedTarget?.draftId),status:raw(row.status),locationStatus:raw(row.locationStatus),
      checkedAt:raw(evidence?.checkedAt || row.inspection?.checkedAt || row.checkedAt),snapshotEvidence:evidence?.key || null,
      evidenceScope:current?'persisted-observation':'historical-during-unfinished-run',readComplete,failed,issues,dataIssues,readIssues,otherIssues,sourceFactsAvailable:factIds.has(String(row.goodsId)),
      formFacts:formFacts(evidence?.snapshot),...sku,intents:{save:intentSummary(row.saveIntent),move:intentSummary(row.moveIntent),publish:intentSummary(row.publishIntent)},
      saved:row.saved===true,published:row.published===true,publicationStatus:raw(row.publicationStatus)};
  });
  const sourceIds = unique(job.goodsIds?.length ? job.goodsIds : rows.map(row=>row.goodsId));
  const groups = new Map();
  for (const row of rows) {const key=JSON.stringify([row.storeBindingKey,row.storeName,row.site]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const stores = [...groups.values()].map(group=>({storeBindingKey:group[0].storeBindingKey,storeName:group[0].storeName,site:group[0].site,...summarize(group,current)}));
  const safeProgress = Object.fromEntries(['phase','stage','active','startedAt','updatedAt','finishedAt','page','scanned','total','targets','matched','rowIndex','rowCount','inspected','message'].filter(key=>progress[key]!==undefined).map(key=>[key,progress[key]]));
  return {schemaVersion:1,generatedAt:new Date().toISOString(),provenance,
    job:{id:job.id,freeJobId:raw(job.freeJobId),status:job.status,action:raw(job.action),message:raw(job.message),updatedAt:raw(job.updatedAt),inspectedAt:raw(job.inspectedAt),reconciledAt:raw(job.reconciledAt),
      template:{id:raw(job.templateSnapshot?.id),name:raw(job.templateSnapshot?.name),version:job.templateSnapshot?.version??null}},
    scope:{sourceProducts:sourceIds.length,targetRows:rows.length,stores:stores.length,sourceFactRecords:facts.length,matchedSourceFacts:sourceIds.filter(id=>factIds.has(id)).length,running,currentRowsUsable:current,freshness,
      finalWorkflowConclusion:'这是有限信息预检，不构成全流程已完成声明；保存、发布提交及平台在售分别统计'},
    progress:safeProgress,claimIntent:intentSummary(job.claimIntent),totals:summarize(rows,current),stores,
    sourceFacts:facts.filter(row=>sourceIds.includes(row.goodsId)),rows,
    notes:['核对数指已有完整读取的页面snapshot，不等于商品必填资料完整；未完成加载的部分snapshot及无snapshot读取失败单列。列表候选预览、未认领等不算浏览器读取失败。','资料缺项只统计完整读取后的issues与字段缺值；读取失败或加载未完成行的空值不计作商品缺资料，SKU总数保持未知。','缺项频次按受影响目标记录数去重统计，不等于SKU数量；汇总已有issues与字段缺值，不替代全字段合法性验证。','saved只统计服务端saved=true；意图不等于提交成功。submitted、店小秘在线listed、审核reviewing、待上架pending-launch与平台在售online分列。','运行中进度是有界摘要，不能按行序反推出各店本轮成功数。','尺寸、重量、库存、价格仅取页面snapshot；来源属性保持逐商品差异，不由规格推算包裹尺寸或重量。','缺失单位显示未核实，即使数值非空也不推定cm、g、kg或币种；字段数量与SKU数量不一致时保留原值并停止按下标配对。']};
}

const cell = value => String(value??'—').replaceAll('|','\\|').replace(/\r?\n/g,' / ').replaceAll('<','&lt;').replaceAll('>','&gt;');
const quantity = value => value === null || value === undefined ? '待补/未读取' : String(value);
const unit = value => present(value) ? String(value) : '单位未核实';
const table = (headers, rows) => `| ${headers.join(' | ')} |\n| ${headers.map(()=>'---').join(' | ')} |\n${rows.map(row=>`| ${row.map(cell).join(' | ')} |`).join('\n')}`;
const issueTable = rows => rows.length ? table(['缺项或待核对问题','目标记录数'],rows.map(item=>[item.name,item.targetCount])) : '输入快照没有此类已记录问题；未读取项仍不能据此判定完整。';

export function renderPreflightMarkdown(report) {
  const totals=report.totals, blocks=[`# 店小秘固定模板现场预检\n\n生成时间：${report.generatedAt}\n\n**${report.scope.freshness}。** ${report.scope.finalWorkflowConclusion}。`,
    `## 输入与范围\n\n- 任务输入：${cell(report.provenance.jobInput)}\n- 输入原始来源：${cell(report.provenance.jobOrigin)}\n- 来源事实文件：${cell(report.provenance.sourceInput)}\n- 任务：${cell(report.job.id)}；来源批次：${cell(report.job.freeJobId)}。\n- 固定模板：${cell(report.job.template.name)} v${cell(report.job.template.version)}。\n- ${report.scope.sourceProducts}件来源商品 → ${report.scope.stores}店、${report.scope.targetRows}条目标记录；来源事实匹配${report.scope.matchedSourceFacts}/${report.scope.sourceProducts}。\n- 服务端状态：${cell(report.job.status)}；${cell(report.job.message)}。`,
    `## 本轮进度与逐店核对\n\n进度摘要：${cell(report.progress.message)}；已核对进度值${report.progress.inspected??'未提供'}/${report.progress.rowCount??report.scope.targetRows}，扫描${report.progress.scanned??'未提供'}/${report.progress.total??'未提供'}；进度更新时间${cell(report.progress.updatedAt)}。进度数字不是完整逐行快照。\n\n`+table(['店铺 / 站点','目标数','留存完整读取','本轮可统计读取','留存读取失败','本轮失败','部分快照','未取得快照'],report.stores.map(store=>[`${store.storeName} / ${store.site}`,store.targets,store.recordedChecked,report.scope.currentRowsUsable?store.currentChecked:'待本轮结果落盘',store.recordedFailed,report.scope.currentRowsUsable?store.currentFailed:'待本轮结果落盘',store.partialSnapshots,store.withoutSnapshot])),
    `## 意图、保存与发布分别统计\n\n`+table(['范围','保存意图','移入待发布意图','发布意图','saved=true','已提交submitted','店小秘在线listed','审核中','待上架','平台在售online','published标志'],[['合计',totals.saveIntents,totals.moveIntents,totals.publishIntents,totals.saved,totals.publication.submitted,totals.publication.listed,totals.publication.reviewing,totals.publication['pending-launch'],totals.publication.online,totals.publishedFlag],...report.stores.map(store=>[store.storeName,store.saveIntents,store.moveIntents,store.publishIntents,store.saved,store.publication.submitted,store.publication.listed,store.publication.reviewing,store.publication['pending-launch'],store.publication.online,store.publishedFlag])])+`\n\n整批认领意图：${report.claimIntent?cell(report.claimIntent.status):'未记录'}。以上来自输入已留存状态，不能用意图数替代成功数。`,
    `## 实际读到的资料缺项\n\n${report.scope.currentRowsUsable?'以下统计已持久化逐行结果。':'以下只统计历史留存结果，不是本轮最终缺项汇总。'}\n\n${issueTable(totals.dataIssueFrequency)}\n\n字段缺值：\n\n${issueTable(totals.fieldGapFrequency.map(item=>({...item,name:fields[item.name]||item.name})))}\n\n单位待核实：\n\n${issueTable(totals.unitGapFrequency.map(item=>({...item,name:unitLabels[item.name]||item.name})))}`,
    `## 浏览器读取失败或加载未完成\n\n这些问题不计作商品资料缺项。\n\n${issueTable(totals.readIssueFrequency)}\n\n未定位、候选或其他待核对问题：\n\n${issueTable(totals.otherIssueFrequency)}`];
  for (const store of report.stores) blocks.push(`### ${cell(store.storeName)} / ${cell(store.site)}\n\n实际资料缺项：\n\n${issueTable(store.dataIssueFrequency)}\n\n读取失败或加载问题：\n\n${issueTable(store.readIssueFrequency)}`);
  blocks.push(`## 来源属性（逐商品保留）\n\n这些是来源文件原值，不替代店铺草稿实际已填写值。\n\n`+table(['商品ID','标题','产地','框架类型','框架材质','画面材质','主题'],report.sourceFacts.map(fact=>[fact.goodsId,fact.title,quantity(fact.origin),quantity(fact.frameType),quantity(fact.frameMaterial),quantity(fact.surface),quantity(fact.theme)])));
  blocks.push('## 每条目标与SKU事实\n\n数值与单位分开展示；“待补/未读取”不等于零。SKU字段长度不匹配时不推断对应关系。');
  for (const row of report.rows) {
    let body=`### ${cell(row.storeName)} / ${cell(row.goodsId)}\n\n草稿：${cell(row.draftId)}；站点：${cell(row.site)}；状态：${cell(row.status)}；checkedAt：${cell(row.checkedAt)}。\n\n快照来源：${cell(row.snapshotEvidence)}；证据范围：${row.evidenceScope==='persisted-observation'?'持久化观察':'历史留存，非本轮结果'}；SKU总数：${row.skuCount??'未知（分类或SKU尚未核实）'}；实际读到SKU行：${row.observedSkuRows}。\n\n资料问题：${row.dataIssues.length?row.dataIssues.map(cell).join('；'):'未记录；读取未完成时不能判断'}。\n\n读取问题：${row.readIssues.length?row.readIssues.map(cell).join('；'):'未记录'}。${row.otherIssues.length?'\n\n其他问题：'+row.otherIssues.map(cell).join('；')+'。':''}`;
    const missingLabel=row.readComplete?'待补/空值':'未读取/未核实';
    const actual=value=>value===null||value===undefined?missingLabel:String(value);
    if(row.formFacts)body+='\n\n表单事实：'+Object.entries(row.formFacts).map(([label,values])=>`${cell(label)}=${values.length?values.map(cell).join('、'):missingLabel}`).join('；')+'。';
    const skuRows=row.skus.map(sku=>[sku.index,actual(sku.sku),`${actual(sku.price)} / ${unit(sku.priceCurrency)}`,`${actual(sku.package.length)} × ${actual(sku.package.width)} × ${actual(sku.package.height)} / ${unit(sku.package.dimensionUnit)}`,`${actual(sku.package.weight)} / ${unit(sku.package.weightUnit)}`,actual(sku.stock)]);
    body+='\n\n'+(skuRows.length?table(['序号','实际SKU货号','申报价 / 币种','包裹长×宽×高 / 单位','重量 / 单位','库存'],skuRows):'未取得可按SKU展示的页面数据；不以来源规格补造。');
    if(Object.keys(row.unmappedFields).length)body+='\n\n未配对字段原值（数量与SKU数不同）：'+Object.entries(row.unmappedFields).map(([key,values])=>`${cell(fields[key]||key)}=${cell(JSON.stringify(values))}`).join('；')+'。';
    blocks.push(body);
  }
  blocks.push('## 统计边界\n\n'+report.notes.map(note=>'- '+note).join('\n'));
  return blocks.join('\n\n')+'\n';
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {console.log(help);return;}
  const options={};
  for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];if(!['--job-json','--source-json','--out-prefix','--job-origin','--job-id'].includes(key)||!value||value.startsWith('--'))throw new Error('参数无效；使用--help查看用法');options[key.slice(2)]=value;}
  for(const key of ['job-json','source-json','out-prefix'])if(!options[key])throw new Error(`缺少--${key}；使用--help查看用法`);
  let text='';
  if(options['job-json']==='-'){for await(const chunk of process.stdin)text+=chunk;}else text=fs.readFileSync(options['job-json'],'utf8');
  const input=JSON.parse(text.replace(/^\uFEFF/,'')),jobId=options['job-id']||'listing-live-30-20261122-01';
  const job=input.job||input.jobs?.[jobId]||(Array.isArray(input.jobs)?input.jobs.find(item=>item.id===jobId):null)||input;
  const sourcePath=path.resolve(options['source-json']),factInput=JSON.parse(fs.readFileSync(sourcePath,'utf8').replace(/^\uFEFF/,''));
  const prefix=path.resolve(options['out-prefix']),outputs=[prefix+'.json',prefix+'.md'];
  const inputs=[sourcePath,...(options['job-json']==='-'?[]:[path.resolve(options['job-json'])])];
  if(outputs.some(output=>inputs.some(input=>input.toLowerCase()===output.toLowerCase())))throw new Error('输出路径不能覆盖输入文件');
  const report=buildPreflightReport(job,factInput,{jobInput:options['job-json']==='-'?'stdin（完整job未另存）':path.resolve(options['job-json']),jobOrigin:options['job-origin']||'仅提供输入文件，未声明原始读取地址',sourceInput:sourcePath});
  fs.mkdirSync(path.dirname(prefix),{recursive:true});
  fs.writeFileSync(outputs[0],JSON.stringify(report,null,2)+'\n');fs.writeFileSync(outputs[1],renderPreflightMarkdown(report));
  console.log(JSON.stringify({json:outputs[0],markdown:outputs[1],sources:report.scope.sourceProducts,targets:report.scope.targetRows,running:report.scope.running,currentRowsUsable:report.scope.currentRowsUsable,recordedChecked:report.totals.recordedChecked,currentChecked:report.totals.currentChecked}));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
