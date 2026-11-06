import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createWorkbench} from '../src/server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const layoutSource = fs.readFileSync(path.join(root, 'public/local/taobao-layout.js'), 'utf8');
const context = {window:{}};
vm.runInNewContext(layoutSource, context, {filename:'taobao-layout.js'});
const layout = context.window.TaobaoLayout;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=', 'base64');

test('taobao zones map onto existing main, gallery and A+ slots', () => {
  const spec = layout.normalize(layout.DEFAULTS);
  const slots = layout.activeSlots(spec);
  const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  same(slots.map(item => item.zone), ['main','main','main','main','main','sku','detail','detail','detail']);
  same(slots.map(item => layout.customerLabel(item.slot, spec)), [
    '淘宝主图 1','淘宝主图 2','淘宝主图 3','淘宝主图 4','淘宝主图 5','SKU图 1','详情 1','详情 2','详情 3'
  ]);
  assert.equal(layout.customerLabel(6, spec), '');
  const custom = layout.toCustomLayout(spec, {});
  same({main:custom.main, sub:custom.sub, aplus:custom.aplus, aplusType:custom.aplusType}, {main:1, sub:5, aplus:3, aplusType:'premium'});
  assert.equal(layout.countsMatch(custom), true);
  assert.equal(layout.countsMatch({...custom, sub:1}), false);
});

test('main and detail counts clamp into the existing 7+7 slot budget', () => {
  const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  same(layout.clampLayout({mainCount:5, skuCount:5, detailCount:9}), {mainCount:5, skuCount:2, detailCount:7});
  same(layout.clampLayout({mainCount:0, skuCount:0, detailCount:0}), {mainCount:1, skuCount:0, detailCount:0});
  const skuOnly = layout.activeSlots({mainCount:0, skuCount:2, detailCount:1});
  same(skuOnly.map(item => [item.slot, item.zone]), [[1,'sku'],[2,'sku'],[7,'detail']]);
  assert.equal(layout.toCustomLayout({mainCount:0, skuCount:2, detailCount:1}, {}).sub, 2);
});

test('zone sizes stay on the workbench mapping and never claim official Taobao pixels', () => {
  const spec = {mainCount:5, skuCount:1, detailCount:2, sizes:{main:'square', sku:'landscape', detail:'portrait'}};
  assert.equal(layout.ratioForTitle('【主图】', spec), '1:1');
  assert.equal(layout.ratioForTitle('【卖点图4】', spec), '1:1');
  assert.equal(layout.ratioForTitle('【卖点图5】', spec), '16:9');
  assert.equal(layout.ratioForTitle('【高级A+模块1: 横幅】', spec), '3:4');
  assert.equal(layout.ratioForZone('detail', spec), '3:4');
  for (const choice of layout.SIZE_CHOICES) {
    assert.match(choice.label, /工作台可选尺寸/);
    assert.doesNotMatch(choice.label + choice.pixels, /淘宝官方像素|800×800|750×/);
  }
  assert.equal(JSON.stringify(layout.SIZE_CHOICES.map(choice => choice.pixels)), JSON.stringify(['1024×1024','1536×1024','1024×1536']));
});

test('detail whitespace and white or transparent notes attach to one zone, and background redraw picks one slot', () => {
  const spec = layout.normalize({...layout.DEFAULTS, detailWhitespace:true, background:'white'});
  assert.match(layout.directiveNote('detail', spec), /留白/);
  assert.equal(layout.directiveNote('main', spec), '');
  assert.match(layout.directiveNote('sku', spec), /白底图/);
  assert.match(layout.backgroundNote('transparent'), /透明/);
  assert.match(layout.backgroundNote('transparent'), /不保证文件带透明通道/);
  assert.equal(layout.backgroundSlot(spec), 5);
  const dirs = [{slot:0, requirement:'主图要求'}, {slot:5, requirement:null}, {slot:7, requirement:'详情要求'}];
  const annotated = layout.annotateDirectives(dirs, spec, {slot:5, note:'只重绘这一张白底'});
  assert.equal(annotated.directives[0].requirement, '主图要求');
  assert.match(annotated.directives[1].requirement, /白底图/);
  assert.match(annotated.directives[1].requirement, /只重绘这一张白底/);
  assert.match(annotated.directives[2].requirement, /留白/);
  assert.equal(annotated.directives.filter(item => /留白/.test(item.requirement || '')).length, 1);
  assert.equal(annotated.used, true);
});

test('provider contract and Taobao publish claims stay out of this slice', () => {
  const provider = fs.readFileSync(path.join(root, 'src/provider.mjs'), 'utf8');
  assert.match(provider, /SUANZHOU_IMAGE_API_KEY/);
  assert.match(provider, /ratio === '1:1' \? '1024x1024' : \['3:4','2:3','9:16'\]\.includes\(ratio\) \? '1024x1536' : '1536x1024'/);
  assert.equal(provider.match(/没有自动更换模型/g).length, 2);
  const shell = fs.readFileSync(path.join(root, 'public/local/taobao-shell.js'), 'utf8');
  assert.match(shell, /淘宝主图/);
  assert.match(shell, /SKU图/);
  assert.match(shell, /详情底部留白/);
  assert.match(shell, /重绘这一张/);
  assert.match(shell, /不是淘宝草稿/);
  assert.doesNotMatch(shell, /SUANZHOU_IMAGE_API_KEY|images\/generations|已发布到淘宝|taobao\.com\/publish/);
  const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(page, /\/local\/taobao-shell\.js/);
});

test('one detail slot can be sent alone at a workbench portrait size', async t => {
  const captured = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-taobao-shell-'));
  const app = createWorkbench({dataDirectory:directory, configuration:{}, provider:async request => { captured.push(request); return png; }});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, {recursive:true, force:true}); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const {token} = await (await fetch(base + '/api/session')).json();
  const call = async (url, payload) => {
    const response = await fetch(base + url, {method:'POST', headers:{'Content-Type':'application/json', 'X-Workbench-Token':token}, body:JSON.stringify(payload)});
    return {response, data:await response.json()};
  };
  const spec = layout.normalize(layout.DEFAULTS);
  const custom = layout.toCustomLayout(spec, {});
  await call('/api/agent', {agent_task_id:'tb_one', product_name:'杯子', product_desc:'白色杯身', design_scope:'custom', custom_layout:{main:custom.main, sub:custom.sub, aplus:custom.aplus, aplus_type:custom.aplusType}});
  let agent;
  for (let i = 0; i < 50; i++) {
    agent = await (await fetch(base + '/api/tasks/agent_tasks/tb_one')).json();
    if (agent.status === 'completed' || agent.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(agent.status, 'completed');
  const note = '详情图底部留出一条干净留白，用来和下一卖点分开';
  const sent = await call('/api/generate', {
    agent_task_id:'tb_one', sop_text:agent.result, design_scope:'custom',
    custom_layout:{main:custom.main, sub:custom.sub, aplus:custom.aplus, aplus_type:custom.aplusType},
    firebase_tasks:[{slot:7, taskId:'tb_detail_only', aspect_ratio:'3:4'}],
    slot_directives:[{slot:7, title:'【高级A+模块1】', requirement:note, ref_images:[]}]
  });
  assert.equal(sent.response.status, 202);
  let task;
  for (let i = 0; i < 50; i++) {
    task = await (await fetch(base + '/api/tasks/hyrule_tasks/tb_detail_only')).json();
    if (task.status === 'completed' || task.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(task.status, 'completed');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ratio, '3:4');
  assert.match(captured[0].prompt, /详情图底部留出一条干净留白/);
});
