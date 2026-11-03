import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary, hash, selectBrands, categoryKeyFrom} from '../src/reference-library.mjs';
import {validateAnalysis} from '../src/reference-analysis.mjs';
import {buildPlan, promptForSlot, splitPlan} from '../src/planner.mjs';
import {apifyBudget} from '../src/apify-budget.mjs';

// Read-only integration verification: no collection, model calls or task creation.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const batch = path.join(root, 'data/research/amazon-expansion-20261101');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const plan = read(path.join(batch, 'category-plan.json'));
const learned = read(path.join(batch, 'learning/references.json'));
const collected = read(path.join(batch, 'references.json'));
const ledger = read(path.join(batch, 'apify-runs.json'));
const pause = read(path.join(batch, 'collection-pause.json'));
const backup = plan.activeResume?.directory || path.join(root, 'data/backups/amazon-expansion-20261101');
const effectiveCheckpoint=path.join(backup,'references-effective-before-merge.json');
const original = read(fs.existsSync(effectiveCheckpoint)?effectiveCheckpoint:path.join(backup, 'references-before-merge.json'));
const baselineHash = plan.activeResume ? hash(fs.readFileSync(path.join(backup, 'workbench-before.json'))) : read(path.join(backup, 'baseline.json')).workbenchSha256;
const progress = read(path.join(batch, 'learning-progress.json'));
const library = new ReferenceLibrary(path.join(root, 'data/research'), path.join(root, 'data/media'));
const ids = [...new Set(plan.categories.flatMap(c => c.selectedProductIds || []))];
assert.ok(ids.length > 0, '本批没有选中商品');
assert.equal(ids.length, progress.products);
const rankingChecks=[];
for(const category of plan.categories.filter(c=>c.phase==='non3c')) {
  const snapshot=read(path.join(batch,category.rankingFile));
  assert.equal(categoryKeyFrom(category.url),category.id);
  assert.equal(new Set(snapshot.rows.map(r=>r.asin)).size,snapshot.rows.length);
  assert.equal(new Set(snapshot.rows.map(r=>r.position)).size,snapshot.rows.length);
  const candidates=collected.categoryCandidates[category.id];
  assert.deepEqual(selectBrands(candidates),category.selection,'品牌/商品筛选无法从保存的候选重现：'+category.label);
  for(const candidate of candidates){
    const evidence=candidate.rankEvidence,row=snapshot.rows.find(r=>r.asin===evidence.observedAsin);
    assert.ok(row,'候选缺少榜单记录');
    const source=row.evidence||snapshot.source;
    assert.equal(evidence.rank,row.position);
    assert.equal(evidence.capturedAt,source.captured_at);
    assert.equal(evidence.runId,source.runId);
    assert.ok(ledger.runs.some(r=>r.runId===evidence.runId&&r.datasetId===evidence.datasetId));
    assert.ok(ledger.runs.some(r=>r.runId===evidence.detailRunId));
  }
  rankingChecks.push({id:category.id,label:category.label,observed:snapshot.rows.length,verified:candidates.length,selectionReproduced:true,perRowSourcesVerified:true});
}
const unique = new Map();
for (const id of ids) {
  const product = learned.products[id], merged = library.state.products[id];
  assert.equal(product.analysis?.status, 'completed', id + ' 分析未完成');
  assert.equal(merged?.analysis?.status, 'completed', id + ' 尚未接入主库');
  validateAnalysis(product.analysis, product.assets);
  assert.deepEqual(merged.assets, product.assets);
  validateAnalysis(merged.analysis, merged.assets);
  for (const asset of product.assets) {
    assert.equal(asset.status, 'downloaded');
    assert.equal(product.analysis.images.find(i => i.id === asset.id)?.sha256, asset.sha256);
    const expected=product.analysis.images.find(i=>i.id===asset.id), actual=merged.analysis.images.find(i=>i.id===asset.id);
    for(const field of ['sha256','layout','camera','lighting','palette','textDensity','transferableGuidance'])assert.equal(actual?.[field],expected[field]);
    assert.ok(library.state.imageAnalyses[asset.sha256]);
    unique.set(asset.sha256, asset);
  }
}
assert.equal(unique.size, progress.expectedUnique);
assert.equal(unique.size, progress.analyzedUnique);
for (const [sha, asset] of unique) {
  assert.equal(hash(fs.readFileSync(path.join(root, 'data/media', path.basename(asset.localUrl)))), sha);
}
for (const [id, product] of Object.entries(original.products)) {
  assert.ok(library.state.products[id], '已有资料丢失：' + id);
  if(!ids.includes(id))assert.deepEqual(library.state.products[id], product, '未更新资料发生意外变化：' + id);
  else for(const asset of product.assets)assert.ok(library.state.products[id].assets.some(a=>a.sha256===asset.sha256),'已有图片丢失：'+id);
}
const workbenchSha256 = hash(fs.readFileSync(path.join(root, 'data/workbench.json')));
const beforeMergeSha256 = hash(fs.readFileSync(path.join(backup, 'workbench-before-merge.json')));
assert.equal(workbenchSha256, beforeMergeSha256, '本次接入期间任务数据发生变化');
assert.equal(pause.newApifyRunsAllowedThisPhase, false);
assert.ok(ledger.runs.every(r => !r.submittedAt || r.submittedAt <= pause.recordedAt), '暂停后出现新增采集');
const budget = apifyBudget(ledger);
assert.ok(budget.committedUsd <= budget.budgetUsd);
assert.equal(budget.budgetUsd,plan.activeResume?.budgetUsd||plan.budgetUsd);
assert.equal(budget.budgetUsd,pause.authorizedTaskBudgetUsd);

const get = async route => {
  const response = await fetch('http://127.0.0.1:4173' + route);
  assert.equal(response.status, 200, route);
  return response.json();
};
const [status, runtime, products, patterns] = await Promise.all([
  get('/api/research/status'), get('/api/status'), get('/api/research/products'), get('/api/research/design-patterns')
]);
const stats = library.stats();
for (const [key, value] of Object.entries(stats)) assert.equal(status[key], value, '在线统计不匹配：' + key);
assert.equal(stats.products, new Set([...Object.keys(original.products),...ids]).size);
assert.equal(stats.uniqueImages, new Set([...Object.values(original.products).flatMap(p=>p.assets.map(a=>a.sha256)),...unique.keys()]).size);
assert.equal(stats.analyzedUnique, stats.uniqueImages);
assert.equal(stats.analyzed, stats.products);
assert.equal(runtime.active, 0);
assert.equal(runtime.queued, 0);
assert.ok(!status.active && !status.queued);
assert.equal(status.expansion.id, plan.id);
const completedBranches=plan.categories.filter(c=>(c.selectedProductIds||[]).length);
assert.equal(status.expansion.categories.filter(c => c.analysisStatus === 'completed').length, completedBranches.length);
assert.equal(status.expansion.categories.filter(c => c.selectionComplete).length, plan.categories.filter(c=>c.selectionComplete).length);
assert.deepEqual(status.expansion.collectionBlock,plan.collectionBlock||null);
assert.equal(patterns.status, 'completed');
assert.equal(patterns.analyzedUnique, stats.uniqueImages);
const storefronts=products.filter(p=>p.url?.includes('/stores/'));
const originalStorefronts=Object.values(original.products).filter(p=>p.url?.includes('/stores/'));
assert.equal(storefronts.length,originalStorefronts.length);
assert.ok(originalStorefronts.every(p=>storefronts.some(s=>s.id===p.id)));
const charmastStorefronts=originalStorefronts.filter(p=>/\bcharmast\b/i.test(p.title));
assert.equal(charmastStorefronts.length,7);
for (const id of ids) {
  assert.deepEqual(products.find(p => p.id === id)?.categoryMemberships, library.state.products[id].categoryMemberships);
}

const cases = [
  {name: '无线蓝牙耳机', category: '172541'},
  {name: '车载手机支架', category: '1077068'},
  {name: '手机钢化保护膜', category: '2811119011'},
  {name: '便携充电宝', category: null},
  {name: '床单四件套', category: 'department:home-garden'},
  {name: '不锈钢水杯', category: 'department:kitchen'},
  {name: '身体乳', category: 'department:beauty'},
  {name: '宠物猫粮', category: 'department:pet-supplies'},
  {name: '户外净水吸管', category: 'department:sporting-goods'},
  {name: '电子蜡烛', category: 'department:hi'},
  {name: '软胶捏捏玩具', category: 'department:toys-and-games'},
  {name: '婴儿纸尿裤', category: 'department:baby-products'}
];
const planning = [], plans = [];
function verifyReferenceEvidence(design,references,prompts) {
  let referencedSlots=0,categoryReferencedSlots=0;
  for(const [index,section] of design.sections.entries()) {
    const role=section.slot>=7?'aplus':section.slot===0?'main':'gallery';
    const available=references.flatMap(reference=>reference.images.filter(image=>(image.roles||[image.role]).includes(role)).map(image=>({reference,image})));
    if(!available.length){assert.equal(section.referenceEvidence,null);continue;}
    const evidence=section.referenceEvidence;
    assert.ok(evidence,'图位未引用可用设计观察：'+section.title);
    const source=available.find(({reference,image})=>reference.id===evidence.productId&&image.id===evidence.imageId);
    assert.ok(source,'图位引用无法追溯到所选参考：'+section.title);
    assert.equal(evidence.matchType,source.reference.matchType);
    if(available.some(({reference})=>reference.matchType==='category'))assert.equal(evidence.matchType,'category','有同类素材时必须优先使用：'+section.title);
    if(evidence.matchType==='category') {
      assert.ok(section.detail.includes(source.image.layout));
      assert.ok(prompts[index].includes(source.image.layout),'同类设计观察未进入独立提示词');
      categoryReferencedSlots++;
    } else {
      assert.match(section.detail,/跨类目风格观察/);
      assert.match(prompts[index],/跨类目风格观察/);
    }
    referencedSlots++;
  }
  return {referencedSlots,categoryReferencedSlots};
}
for (const item of cases) {
  const payload = {product_name: item.name, product_desc: '仅作策划验证，商品参数以用户资料为准', custom_layout: {main: 1, sub: 6, aplus: 3, aplus_type: 'old'}};
  const refs = library.retrieve(payload);
  assert.ok(refs.length, '自动检索未命中：' + item.name);
  assert.ok(refs.some(r=>r.matchType==='category'),'未命中同类商品：'+item.name);
  if (item.category) assert.ok(refs.some(r => r.matchType==='category'&&library.state.products[r.id].categoryMemberships?.some(c => c.id === item.category)), '未命中对应类目：' + item.name);
  const design = buildPlan(payload, refs);
  assert.equal(design.source, 'reference-rules');
  assert.equal(design.sections.length, 10);
  const prompts = design.sections.map(section => promptForSlot(payload, section, design));
  for (let i = 0; i < prompts.length; i++) {
    const blocks = splitPlan(prompts[i]).blocks;
    assert.equal(blocks.size, 1, '逐图提示词混入其他图位');
    assert.ok(blocks.has(design.sections[i].title));
  }
  assert.equal(new Set(prompts).size, prompts.length);
  assert.ok(design.sections.filter(s => s.detail.includes('参考库设计观察')).length >= 7, '设计观察未进入各图位');
  const evidence=verifyReferenceEvidence(design,refs,prompts);
  const explicitIds = refs.slice(0, 2).map(r => r.id);
  assert.deepEqual(library.retrieve({...payload, reference_ids: explicitIds}).map(r => r.id), explicitIds);
  const result = {productName: item.name, references: design.references, slots: design.sections.length, distinctPrompts: new Set(prompts).size, ...evidence};
  planning.push(result);
  plans.push({payload, ...result, planText: design.text, slotPrompts: prompts});
}
const categoryPlanning=completedBranches.map(category=>{
  const chosen=category.selectedProductIds.slice(0,3);
  const payload={product_name:category.label+'策划检查',reference_ids:chosen,custom_layout:{main:1,sub:6,aplus:3,aplus_type:'old'}};
  const refs=library.retrieve(payload),design=buildPlan(payload,refs);
  assert.deepEqual(refs.map(r=>r.id),chosen);
  const prompts=design.sections.map(section=>promptForSlot(payload,section,design));
  assert.equal(new Set(prompts).size,10);
  // A department label does not identify a specific product. Explicit choices
  // still contribute traceable style observations without claiming type identity.
  const evidence=verifyReferenceEvidence(design,refs,prompts);
  assert.ok(evidence.referencedSlots>0,'明确选择的参考未进入策划：'+category.label);
  return {id:category.id,label:category.label,references:refs.length,distinctPrompts:10,...evidence};
});
const report = {passed: true, checkedAt: new Date().toISOString(), selectedProductRecords: ids.length, selectedUniqueImages: unique.size, sha256Verified: unique.size, stats, storefrontPages: storefronts.length, charmastStorefrontPagesPreserved:charmastStorefronts.length, completedSelectedBranches: completedBranches.length, fullQuotaBranches: plan.categories.filter(c=>c.selectionComplete).length, budget, collectionPaused: !pause.newApifyRunsAllowedThisPhase, workbenchDataPreserved: true, workbenchSha256, taskDataChangedBeforeIntegration: workbenchSha256 !== baselineHash, rankingChecks, planning, categoryPlanning, imageGenerationInvoked: false, externalModelCallsInvoked: false};
const output = path.join(root, 'tests/results');
fs.writeFileSync(path.join(output, 'expansion-plan-evidence.json'), JSON.stringify(plans, null, 2));
fs.writeFileSync(path.join(output, 'expansion-integration-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({...report, planning: planning.map(p => ({productName: p.productName, references: p.references.length, slots: p.slots, distinctPrompts: p.distinctPrompts, referencedSlots: p.referencedSlots}))}, null, 2));
