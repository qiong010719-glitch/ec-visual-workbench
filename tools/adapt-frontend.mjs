import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file=path.join(root,'public/original/original-01.js');
let source=fs.readFileSync(file,'utf8').replace(/\r\n?/g,'\n');
source=source.replace("const APP_CHANNEL = 'official'", "const APP_CHANNEL = 'local'");
source=source.replace('const confirmed = confirm(`⚠️ 本次构思将扣除 ${agentCost} 点\\n\\n构思完成后请务必点击【开始生成】生图，否则构思点数不退。\\n\\n确认开始调和？`);',
  'const confirmed = confirm(`将提交当前方案的图片生成任务，使用算舟账户额度。\\n\\n确认开始生成？`);');
source=source.replaceAll('✅ 评价已同步飞书','✅ 评价已保存在本机');
source=source.replaceAll('n8n Webhook 无响应','图片任务未受理，请查看通道状态和错误提示');
source=source.replaceAll('生成失败，点数已退回，可直接再点一次重试。','生成失败；测试点数已退回。真实扣费请在算舟账户核对。');
source=source.replaceAll('默认通道（速度快、成本低）','算舟专用图片通道');
source=source.replaceAll('5-7分钟。适合卖点繁杂','适合卖点繁杂').replaceAll('11-14分钟。适合高客单价产品','适合高客单价产品').replaceAll('2–3 分钟一次成型','整套合图一次生成');
source=source.replace('img.src = CN_IMG_HOSTS.test(data.url) ? cnImg(data.url, 0) : "https://wsrv.nl/?url=" + encodeURIComponent(data.url);',
  'img.src = data.url.startsWith("/media/") ? data.url : "/api/imgproxy?url=" + encodeURIComponent(data.url);');
if(!source.includes('// Do not overwrite stored state during startup.')) source=source.replace('function saveAppState() {\n', 'function saveAppState() {\n            if (!__idbRestored) return; // Do not overwrite stored state during startup.\n');
source=source.replace("if (state.generationMode && state.generationMode !== 'ultra_fast') {", 'if (state.generationMode) {');
source=source.replace("if (state.imageSlots) { imageSlots = state.imageSlots; imageSlots.forEach((img, idx) => { if (img && typeof renderSlot === 'function') renderSlot(idx); }); }",
  "if (state.imageSlots) { imageSlots = state.imageSlots; if (state.generationMode === 'ultra_fast') { buildUltraGalleryLayout(); imageSlots.forEach((img, idx) => { if (img) renderUltraSlot(idx); }); } else { imageSlots.forEach((img, idx) => { if (img && typeof renderSlot === 'function') renderSlot(idx); }); } }");
source=source.replace("if (state.activeKieTasks && state.activeKieTasks.length > 0 && typeof resumeKieListener === 'function') { activeKieTasks = state.activeKieTasks; switchView('adventure-log', document.getElementById('nav-notes')); activeKieTasks.forEach(task => { resumeKieListener(task.slot, task.taskId); }); }",
  "if (state.activeKieTasks && state.activeKieTasks.length > 0) { activeKieTasks = state.activeKieTasks; const ultra = state.generationMode === 'ultra_fast'; switchView(ultra ? 'ultra-log' : 'adventure-log', document.getElementById(ultra ? 'nav-ultra' : 'nav-notes')); activeKieTasks.forEach(task => { if (ultra) resumeUltraKieListener(task.slot, task.taskId); else resumeKieListener(task.slot, task.taskId, !!task.isInpaint); }); }");
source=source.replaceAll('每次生成 3 点，失败自动退回。','生成使用算舟账户额度；本地测试点数仅用于流程记录。');
source=source.replace('本次生成 ${targets.length} 张手机版，将扣 ${targets.length} 点（每张 1 点；生成失败或超时会自动按张退回）。继续？',
  '本次生成 ${targets.length} 张手机版，使用算舟账户额度。测试点数仅用于记录。继续？');
source=source.replace('if (!kieUrl || /firebasestorage|googleusercontent|\\/hyrule_persisted\\//.test(kieUrl)) return;',
  "if (!kieUrl || kieUrl.startsWith('/media/') || /firebasestorage|googleusercontent|\\/hyrule_persisted\\//.test(kieUrl)) return;");
fs.writeFileSync(file,source);
const htmlFile=path.join(root,'public/index.html');
let html=fs.readFileSync(htmlFile,'utf8');
html=html.replaceAll('5–7 分钟 · 卖点信息密集','卖点信息密集').replaceAll('11–14 分钟 · 光影质感场景','光影质感场景').replaceAll('2–3 分钟 · 铺货专用，不追求质量','合图输出 · 铺货专用').replaceAll('⚡ 极速模式 · 5 点/次','⚡ 极速模式 · 合图生成');
html=html.replace(/(<(?:p|span)\b[^>]*>)因为最近默认通道出现问题[\s\S]*?(<\/(?:p|span)>)/g,'$1任务和图片保存在本机。生成通过算舟图片通道处理，费用以算舟账户为准；出错原因会显示在任务提示中。$2');
html=html.replace(/(<span\b[^>]*>)可以切换<strong[\s\S]*?<\/span>/g,'$1工作台的「通道状态」会显示实际图片通道。未受理的任务可检查配置后重试。</span>');
html=html.replace(/(<p\b[^>]*>)通道每次生成前都可自由切换[\s\S]*?<\/p>/g,'$1当前使用算舟专用图片通道；耗时和费用以实际服务响应为准。</p>');
html=html.replaceAll('📢 公告','📢 原站公告');
fs.writeFileSync(htmlFile,html);
console.log('本地适配已应用；reference/original.html 保留清除服务凭据后的上游代码。');
