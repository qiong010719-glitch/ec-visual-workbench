import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createWorkbench} from '../src/server.mjs';
import {buildPlan} from '../src/planner.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const layoutSource = fs.readFileSync(path.join(root, 'public/local/taobao-layout.js'), 'utf8');
const context = {window:{}};
vm.runInNewContext(layoutSource, context, {filename:'taobao-layout.js'});
const layout = context.window.TaobaoLayout;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=', 'base64');

test('Taobao selected ratios reach planning before image generation, including plain and custom sizes', () => {
  const raw = [{slot:0, requirement:'主图'}, {slot:1}, {slot:7, requirement:'详情'}];
  const base = {mainCount:1, skuCount:1, detailCount:1, detailWhitespace:false, setStyle:'original'};
  for (const [customSizes, expected] of [[{}, ['1:1','1:1','3:4']],
    [{main:{width:800,height:1200},sku:{width:1000,height:800},detail:{width:900,height:1600}}, ['2:3','5:4','9:16']]]) {
    const slot_directives = layout.annotateDirectives(raw, {...base, customSizes}).directives;
    for (const visual_style of ['original','scene_advertising']) {
      const plan = buildPlan({design_scope:'custom',custom_layout:{main:1,sub:1,aplus:1},slot_directives,visual_style});
      assert.deepEqual(plan.sections.map(s=>s.ratio), expected);
      assert.match(plan.sections[2].detail, /竖版/);
      assert.doesNotMatch(plan.text, /21:9|横幅|宽幅/);
    }
  }
  const plain = layout.annotateDirectives(raw, base).directives;
  assert.equal(plain[1].requirement, undefined);
  assert.equal(raw[0].aspect_ratio, undefined, 'source directives are not mutated');
});

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

test('whole-set style notes land on every active Taobao slot and stay off by default', () => {
  const labels = ['不强制','场景广告','纯白棚拍','极简留白','生活方式','国潮质感','原有风格','轻奢高级','清新日系','莫兰迪低饱和','暖色氛围','冷色极简','影棚光感','胶片质感','通透阳光','暗调质感','高对比撞色'];
  assert.equal(JSON.stringify(layout.SET_STYLES.map(item => item.label)), JSON.stringify(labels));
  assert.equal(new Set(layout.SET_STYLES.map(item => item.id)).size, labels.length);
  assert.equal(layout.normalize({}).setStyle, 'off');
  assert.equal(layout.normalize({setStyle:'not-a-style'}).setStyle, 'off');
  assert.equal(layout.normalize({setStyle:''}).setStyle, 'off');
  assert.equal(layout.styleNote({setStyle:'missing'}), '');
  assert.equal(layout.styleNote(layout.DEFAULTS), '');
  for (const choice of layout.SET_STYLES) {
    assert.doesNotMatch(choice.label + choice.note, /摄影级|保证成图|官方像素|实拍成品|母婴|美食|家居/);
    if (choice.id !== 'off') assert.match(choice.note, new RegExp('整套风格：' + choice.label));
  }
  for (const choice of layout.SET_STYLES.filter(item => ['light_luxury','fresh_japanese','morandi','warm_mood','cool_minimal','studio_light','film_look','sunlit','dark_tone','high_contrast'].includes(item.id))) {
    assert.match(choice.note, /主图、SKU图和详情/);
    assert.match(choice.note, /不改商品结构/);
    assert.match(choice.note, /不是实拍承诺/);
    assert.match(choice.note, /不绑定某一品类/);
    const stamped = layout.annotateDirectives([{slot:0, requirement:'主图要求'}, {slot:1, requirement:null}, {slot:7, requirement:'详情'}], {mainCount:1, skuCount:1, detailCount:1, setStyle:choice.id});
    assert.equal(stamped.directives.length, 3);
    for (const item of stamped.directives) assert.match(item.requirement, new RegExp('整套风格：' + choice.label));
  }
  const plain = layout.annotateDirectives([{slot:0, requirement:'主图要求'}, {slot:7, requirement:'详情要求'}], layout.DEFAULTS);
  assert.equal(plain.directives[0].requirement, '主图要求');
  assert.match(plain.directives[1].requirement, /留白/);
  assert.doesNotMatch(plain.directives.map(item => item.requirement).join('\n'), /整套风格/);
  const spec = layout.normalize({...layout.DEFAULTS, setStyle:'lifestyle', detailWhitespace:true, background:'white'});
  const dirs = layout.activeSlots(spec).map(item => ({slot:item.slot, requirement:item.zone === 'main' && item.index === 1 ? '主图要求' : null}));
  dirs.push({slot:6, requirement:'闲置槽'});
  const note = layout.styleNote(spec);
  assert.match(note, /整套风格：生活方式/);
  const annotated = layout.annotateDirectives(dirs, spec, {slot:5, note:'只重绘这一张白底'});
  const active = annotated.directives.filter(item => item.slot !== 6);
  assert.equal(active.length, layout.activeSlots(spec).length);
  for (const item of active) assert.match(item.requirement, /整套风格：生活方式/);
  assert.equal(annotated.directives.find(item => item.slot === 6).requirement, '闲置槽');
  assert.match(annotated.directives.find(item => item.slot === 0).requirement, /^主图要求；整套风格：生活方式/);
  assert.match(annotated.directives.find(item => item.slot === 5).requirement, /白底图/);
  assert.match(annotated.directives.find(item => item.slot === 5).requirement, /只重绘这一张白底/);
  assert.match(annotated.directives.find(item => item.slot === 7).requirement, /留白/);
  assert.equal(annotated.used, true);
  const stored = layout.toCustomLayout(spec, {3:{req:'保留'}});
  assert.equal(stored.taobao.setStyle, 'lifestyle');
  assert.equal(stored.directives[3].req, '保留');
});

test('uploaded SKU photos map onto SKU slots and an empty upload leaves directives unchanged', () => {
  const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  const spec = layout.normalize({mainCount:1, skuCount:3, detailCount:1, setStyle:'morandi', detailWhitespace:false, background:'off'});
  const dirs = [
    {slot:0, requirement:'主图要求；整套风格：胶片质感', ref_images:['产品主体图_1']},
    {slot:1, requirement:'红', ref_images:[]},
    {slot:2, requirement:'蓝', ref_images:[]},
    {slot:3, requirement:'绿', ref_images:[]},
    {slot:7, requirement:'详情要求', ref_images:[]}
  ];
  const none = layout.attachSkuRefs(dirs, spec, []);
  assert.equal(none.attached, false);
  assert.equal(none.directives, dirs);
  assert.equal(none.directives[1].requirement, '红');
  same(none.directives[0].ref_images, ['产品主体图_1']);
  same(none.directives[1].ref_images, []);
  const noSlots = layout.attachSkuRefs([{slot:0, requirement:'主图', ref_images:[]}], {mainCount:1, skuCount:0, detailCount:0}, ['SKU图_1']);
  assert.equal(noSlots.attached, false);
  assert.equal(noSlots.directives[0].requirement, '主图');
  same(noSlots.directives[0].ref_images, []);
  const annotated = layout.annotateDirectives(dirs, spec).directives;
  const attached = layout.attachSkuRefs(annotated, spec, [{filename:'SKU图_1'}, {filename:' SKU图_2 '}, {filename:'SKU图_2'}]);
  assert.equal(attached.attached, true);
  const bySlot = Object.fromEntries(attached.directives.map(item => [item.slot, item]));
  same(bySlot[0].ref_images, ['产品主体图_1']);
  assert.match(bySlot[0].requirement, /^主图要求；整套风格：胶片质感；整套风格：莫兰迪低饱和/);
  assert.doesNotMatch(bySlot[0].requirement, /已上传的规格图/);
  same(bySlot[1].ref_images, ['SKU图_1']);
  same(bySlot[2].ref_images, ['SKU图_2']);
  same(bySlot[3].ref_images, ['SKU图_2']);
  same(bySlot[7].ref_images, []);
  assert.match(bySlot[1].requirement, /^红；整套风格：莫兰迪低饱和/);
  assert.match(bySlot[1].requirement, /规格图「SKU图_1」/);
  assert.match(bySlot[1].requirement, /不要只按产品主体图/);
  assert.match(bySlot[2].requirement, /^蓝；整套风格：莫兰迪低饱和/);
  assert.match(bySlot[2].requirement, /SKU图_2/);
  assert.match(bySlot[7].requirement, /^详情要求；整套风格：莫兰迪低饱和/);
  assert.doesNotMatch(bySlot[7].requirement, /已上传的规格图/);
  const oneSlot = layout.attachSkuRefs(
    [{slot:1, requirement:'SKU卖点原文；整套风格：胶片质感', ref_images:[]}],
    {mainCount:1, skuCount:1, detailCount:0, setStyle:'off'},
    ['SKU图_1', 'SKU图_2']
  );
  same(oneSlot.directives[0].ref_images, ['SKU图_1']);
  assert.match(oneSlot.directives[0].requirement, /^SKU卖点原文；整套风格：胶片质感/);
  assert.match(oneSlot.directives[0].requirement, /SKU图_1/);
  assert.doesNotMatch(oneSlot.directives[0].requirement, /SKU图_2/);
});

test('provider contract and Taobao publish claims stay out of this slice', () => {
  const provider = fs.readFileSync(path.join(root, 'src/provider.mjs'), 'utf8');
  assert.match(provider, /SUANZHOU_IMAGE_API_KEY/);
  assert.match(provider, /ratio === '1:1' \? '1024x1024' : \['3:4','2:3','9:16'\]\.includes\(ratio\) \? '1024x1536' : '1536x1024'/);
  assert.equal(provider.match(/没有自动更换模型/g).length, 2);
  const shell = fs.readFileSync(path.join(root, 'public/local/taobao-shell.js'), 'utf8');
  assert.match(shell, /淘宝主图/);
  assert.match(shell, /上传 SKU 图/);
  assert.match(shell, /id="tbSkuUpload"/);
  assert.match(shell, /id="tbSkuFile" type="file" accept="image\/\*" multiple/);
  assert.match(shell, /SKU图/);
  assert.match(shell, /详情底部留白/);
  assert.match(shell, /整套风格/);
  assert.match(shell, /tbSetStyle/);
  assert.match(shell, /重绘这一张/);
  assert.match(shell, /不是淘宝草稿/);
  assert.doesNotMatch(shell, /SUANZHOU_IMAGE_API_KEY|images\/generations|已发布到淘宝|taobao\.com\/publish|qianniu/);
  const original = fs.readFileSync(path.join(root, 'public/original/original-01.js'), 'utf8');
  assert.match(original, /window\.__workbenchMaterials = \(\) => globalMaterials/);
  assert.doesNotMatch(shell, /亚马逊主副图|THD要求图/);
  assert.match(shell, /option\.hidden = true/);
  assert.match(shell, /中国大陆/);
  const popup = fs.readFileSync(path.join(root, 'public/original/original-05.js'), 'utf8');
  assert.match(popup, /node\.hidden/);
  assert.match(popup, /optionShown/);
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
  assert.doesNotMatch(captured[0].prompt, /整套风格/);
});

test('everyday menus offer only the Taobao shell and CN, while hidden ids stay selectable in code', () => {
  const ids = new Map();
  const all = [];
  function classListFor(el) {
    const names = () => el.className ? el.className.split(/\s+/).filter(Boolean) : [];
    return {
      add(...list) { el.className = [...new Set([...names(), ...list])].join(' '); },
      remove(...list) { const drop = new Set(list); el.className = names().filter(name => !drop.has(name)).join(' '); },
      contains(name) { return names().includes(name); }
    };
  }
  function make(tag) {
    let text = '';
    let id = '';
    const el = {
      tagName: tag.toUpperCase(), className: '', hidden: false, disabled: false, checked: false, name: '', type: '',
      style: {}, children: [], parentElement: null, _attrs: {}, classList: null
    };
    el.classList = classListFor(el);
    Object.defineProperty(el, 'textContent', {
      get() { return text || el.children.map(child => child.textContent).join(''); },
      set(value) { text = String(value ?? ''); }
    });
    Object.defineProperty(el, 'text', {get() { return el.textContent; }});
    Object.defineProperty(el, 'id', {
      get() { return id; },
      set(value) { if (id) ids.delete(id); id = value || ''; if (id) ids.set(id, el); }
    });
    el.dataset = new Proxy({}, {get: (box, key) => box[key], set: (box, key, value) => {
      box[key] = String(value);
      el._attrs['data-' + String(key).replace(/[A-Z]/g, char => '-' + char.toLowerCase())] = String(value);
      return true;
    }});
    el.appendChild = child => {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
      child.parentElement = el;
      el.children.push(child);
      if (!all.includes(child)) all.push(child);
      return child;
    };
    el.insertAdjacentElement = (_where, child) => { const parent = el.parentElement; const index = parent.children.indexOf(el); parent.children.splice(index + 1, 0, child); child.parentElement = parent; if (!all.includes(child)) all.push(child); };
    el.before = sibling => { const parent = el.parentElement; const index = parent.children.indexOf(el); if (sibling.parentElement) sibling.parentElement.children = sibling.parentElement.children.filter(item => item !== sibling); parent.children.splice(index, 0, sibling); sibling.parentElement = parent; if (!all.includes(sibling)) all.push(sibling); };
    el.remove = () => { if (el.parentElement) el.parentElement.children = el.parentElement.children.filter(item => item !== el); el.parentElement = null; const index = all.indexOf(el); if (index >= 0) all.splice(index, 1); };
    el.addEventListener = (type, fn) => { (el._on ||= {})[type] ||= []; el._on[type].push(fn); };
    el.dispatchEvent = event => { for (const fn of el._on?.[event.type] || []) fn(event); };
    el.getBoundingClientRect = () => ({left: 12, top: 12, bottom: 48, width: 280, height: 36});
    Object.defineProperty(el, 'offsetWidth', {get() { return 280; }});
    Object.defineProperty(el, 'offsetHeight', {get() { return 160; }});
    el.closest = () => null;
    el.querySelectorAll = selector => descendants(el).filter(node => matches(node, selector));
    el.querySelector = selector => el.querySelectorAll(selector)[0] || null;
    if (tag === 'select') {
      let value = '';
      const options = () => { const found = []; const walk = node => { for (const child of node.children) { if (child.tagName === 'OPTION') found.push(child); else walk(child); } }; walk(el); return found; };
      Object.defineProperty(el, 'options', {get: options});
      Object.defineProperty(el, 'value', {get() { return value; }, set(next) { value = String(next ?? ''); }});
      Object.defineProperty(el, 'selectedIndex', {get() { return options().findIndex(option => option.value === value); }});
      Object.defineProperty(el, 'selectedOptions', {get() { const option = options().find(item => item.value === value); return option ? [option] : []; }});
    } else el.value = '';
    if (tag === 'option') Object.defineProperty(el, 'selected', {get() { let parent = el.parentElement; while (parent && parent.tagName !== 'SELECT') parent = parent.parentElement; return !!parent && parent.value === el.value; }});
    Object.defineProperty(el, 'innerHTML', {set(html) { el.children = []; parseHTML(String(html), el); }});
    return el;
  }
  function parseHTML(html, parent) {
    const re = /([^<]+)|<\/([a-zA-Z0-9]+)>|<([a-zA-Z0-9]+)([^>]*)>/g;
    const stack = [parent];
    let match;
    while ((match = re.exec(html))) {
      if (match[1]) { const bit = match[1].replace(/\s+/g, ' ').trim(); if (bit && stack.at(-1) !== parent) stack.at(-1).textContent = `${stack.at(-1).textContent} ${bit}`.trim(); continue; }
      if (match[2]) { const tag = match[2].toUpperCase(); while (stack.length > 1 && stack.at(-1).tagName !== tag) stack.pop(); if (stack.length > 1) stack.pop(); continue; }
      const el = make(match[3].toLowerCase());
      const attrs = match[4] || '';
      for (const attr of attrs.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
        const key = attr[1]; const val = attr[2] ?? attr[3] ?? '';
        if (key === 'id') el.id = val;
        else if (key === 'class') el.className = val;
        else if (key === 'value') el.value = val;
        else if (key === 'name') el.name = val;
        else if (key === 'type') el.type = val;
        else if (key === 'label') el.label = val;
        else if (key === 'checked' || key === 'selected') el.checked = true;
        else if (key === 'hidden') el.hidden = true;
        else if (key === 'disabled') el.disabled = true;
      }
      stack.at(-1).appendChild(el);
      if (!['input', 'br', 'img'].includes(match[3].toLowerCase()) && !/\/\s*$/.test(attrs)) stack.push(el);
    }
  }
  function matches(el, selector) {
    let rest = selector;
    const tag = rest.match(/^[a-zA-Z][\w-]*/);
    if (tag) { if (el.tagName !== tag[0].toUpperCase()) return false; rest = rest.slice(tag[0].length); }
    if (!rest) return true;
    const parts = rest.match(/(\.[^.#:[\]]+|#[^.#:[\]]+|\[[^\]]+\]|:[^.#:[\]]+)/g);
    if (!parts) return false;
    return parts.every(part => {
      if (part.startsWith('.')) return el.classList.contains(part.slice(1));
      if (part.startsWith('#')) return el.id === part.slice(1);
      if (part === ':checked') return !!el.checked;
      const attr = part.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
      if (!attr) return false;
      const actual = attr[1] === 'name' ? el.name : attr[1] === 'value' ? el.value : el._attrs[attr[1]];
      return attr[2] === undefined ? actual != null && actual !== '' : String(actual) === attr[2];
    });
  }
  function descendants(node) {
    const found = [];
    const walk = current => { for (const child of current.children || []) { found.push(child); walk(child); } };
    return found;
  }
  function queryAll(selector) {
    const steps = selector.trim().split(/\s+/);
    let pool = all.filter(el => matches(el, steps[0]));
    for (const step of steps.slice(1)) {
      const next = [];
      for (const base of pool) for (const child of descendants(base)) if (matches(child, step)) next.push(child);
      pool = next;
    }
    return pool;
  }
  const document = {
    readyState: 'complete',
    createElement: make,
    getElementById: id => ids.get(id) || null,
    querySelector: selector => queryAll(selector)[0] || null,
    querySelectorAll: selector => queryAll(selector),
    addEventListener() {}
  };
  document.head = make('head');
  document.body = make('body');
  all.push(document.head, document.body);
  const host = make('div');
  document.body.appendChild(host);
  host.innerHTML = `
    <select id="generationMode" class="hidden"><option value="fast" selected>快速设计</option></select>
    <select id="designScope" class="sheikah-input">
      <option value="" disabled>请选择图文输出范围…</option>
      <option value="main_and_6">主幅图7张</option>
      <option value="main_6_old_aplus">主幅图7张 + 5张老A+</option>
      <option value="main_6_premium_aplus">主幅图7张 + 5张高级A+</option>
      <option value="old_aplus_only">纯5张老A+ 模块</option>
      <option value="premium_aplus_only">纯5张高级A+ 模块</option>
      <option value="thd_only">THD要求图 7张 (无字/无人物)</option>
      <option value="custom">自定义方案</option>
    </select>
    <button id="customEditBtn"></button>
    <select id="targetMarket" class="sheikah-input">
      <optgroup label="北美及拉美战区 (Americas)">
        <option value='{"market":"美国", "lang":"English"}'>美国 (US / English)</option>
        <option value='{"market":"加拿大", "lang":"English"}'>加拿大 (CA / English)</option>
        <option value='{"market":"墨西哥", "lang":"Español"}'>墨西哥 (MX / Español)</option>
      </optgroup>
      <optgroup label="欧洲核心战区 (Europe)">
        <option value='{"market":"英国", "lang":"English"}'>英国 (UK / English)</option>
        <option value='{"market":"德国", "lang":"Deutsch"}'>德国 (DE / Deutsch)</option>
        <option value='{"market":"法国", "lang":"Français"}'>法国 (FR / Français)</option>
        <option value='{"market":"意大利", "lang":"Italiano"}'>意大利 (IT / Italiano)</option>
        <option value='{"market":"西班牙", "lang":"Español"}'>西班牙 (ES / Español)</option>
      </optgroup>
      <optgroup label="亚太及华语战区 (Asia & CN)">
        <option value='{"market":"日本", "lang":"日本語"}'>日本 (JP / 日本语)</option>
        <option value='{"market":"韩国", "lang":"한국어"}'>韩国 (KR / 한국어)</option>
        <option value='{"market":"中国大陆", "lang":"简体中文"}'>中国大陆 (CN / 简体中文)</option>
        <option value='{"market":"港澳台及海外华侨", "lang":"繁体中文"}'>港澳台 (HK&TW / 繁體中文)</option>
      </optgroup>
      <optgroup label="中东新兴战区 (Middle East)">
        <option value='{"market":"中东地区", "lang":"العربية"}'>中东地区 (Middle East)</option>
      </optgroup>
      <optgroup label="全球战略 (Global)">
        <option value='{"market":"全球通用(偏欧美审美)", "lang":"English"}'>全球通用 (Global / English)</option>
      </optgroup>
    </select>`;
  const sandbox = {
    console, document, Event,
    setTimeout: fn => { fn(); return 0; },
    setInterval: () => 0,
    requestAnimationFrame: fn => fn(),
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} },
    innerWidth: 1280, innerHeight: 900,
    addEventListener() {},
    __loadAppStateFrom(saved) { if (!saved) return; document.getElementById('targetMarket').value = JSON.parse(saved).targetMarket; document.getElementById('designScope').value = JSON.parse(saved).designScope; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/original/original-05.js'), 'utf8'), sandbox, {filename: 'original-05.js'});
  vm.runInNewContext(layoutSource, sandbox, {filename: 'taobao-layout.js'});
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/local/taobao-shell.js'), 'utf8'), sandbox, {filename: 'taobao-shell.js'});
  const open = id => {
    const trigger = document.querySelector(`[data-gsel-for="${id}"]`);
    const click = () => trigger.onclick({stopPropagation() {}});
    click();
    if (!document.querySelector('.gsel-pop')) click();
    const pop = document.querySelector('.gsel-pop');
    return {
      items: document.querySelectorAll('.gsel-item').filter(item => item.parentElement === pop).map(item => item.textContent),
      groups: document.querySelectorAll('.gsel-group').filter(item => item.parentElement === pop).map(item => item.textContent)
    };
  };
  document.getElementById('generationMode').value = 'fast';
  const scope = document.getElementById('designScope');
  const market = document.getElementById('targetMarket');
  assert.equal(scope.value, 'custom');
  assert.equal(JSON.parse(market.value).market, '中国大陆');
  assert.equal(JSON.parse(market.value).lang, '简体中文');
  const scopeMenu = open('designScope');
  assert.deepEqual(scopeMenu.items.map(item => item.replace('✓', '')), ['淘宝壳 · 主图 / SKU图 / 详情']);
  assert.equal(scopeMenu.items.some(item => /内部保留|主幅图|A\+|THD/.test(item)), false);
  for (const value of ['main_and_6', 'main_6_old_aplus', 'main_6_premium_aplus', 'old_aplus_only', 'premium_aplus_only', 'thd_only']) {
    const option = [...scope.options].find(item => item.value === value);
    assert.equal(option.hidden, true, value);
    assert.equal(option.disabled, false, value);
  }
  scope.value = 'thd_only';
  assert.equal(scope.value, 'thd_only');
  scope.value = 'custom';
  const marketMenu = open('targetMarket');
  assert.deepEqual(marketMenu.items.map(item => item.replace('✓', '')), ['中国大陆 (CN / 简体中文)']);
  assert.deepEqual(marketMenu.groups, []);
  const blocked = ['美国', '加拿大', '墨西哥', '英国', '德国', '法国', '意大利', '西班牙', '日本', '韩国', '港澳台', '中东', '全球通用', 'Americas', 'Europe', 'Asia', '战区'];
  assert.equal(marketMenu.items.some(item => blocked.some(word => item.includes(word))), false);
  for (const option of market.options) {
    if (option.textContent.includes('中国大陆')) assert.equal(option.hidden, false);
    else assert.equal(option.hidden, true);
  }
  const legacy = document.getElementById('taobaoLegacyScope');
  const summary = legacy.children.find(child => child.tagName === 'SUMMARY');
  assert.equal(summary.hidden, true);
  assert.equal(summary.textContent, '');
  document.getElementById('tbDetailCount').value = '2';
  document.getElementById('tbDetailCount').dispatchEvent({type: 'change'});
  document.getElementById('tbWhitespace').checked = false;
  document.getElementById('tbWhitespace').dispatchEvent({type: 'change'});
  const off = document.querySelector('input[name="tbBg"][value="off"]');
  const white = document.querySelector('input[name="tbBg"][value="white"]');
  off.checked = false; white.checked = true; white.dispatchEvent({type: 'change'});
  assert.equal(sandbox.__customLayout.taobao.detailCount, 2);
  assert.equal(sandbox.__customLayout.taobao.detailWhitespace, false);
  assert.equal(sandbox.__customLayout.taobao.background, 'white');
  assert.equal(sandbox.__customLayout.taobao.mainCount, 5);
  const style = document.getElementById('tbSetStyle');
  const styleLabels = [...style.options].map(option => option.textContent);
  assert.equal(styleLabels[0], '不强制');
  assert.equal(styleLabels.filter(label => label !== '不强制').length > 2, true);
  for (const name of ['场景广告', '纯白棚拍', '极简留白', '生活方式', '国潮质感', '原有风格', '轻奢高级', '清新日系', '莫兰迪低饱和', '暖色氛围', '冷色极简', '影棚光感', '胶片质感', '通透阳光', '暗调质感', '高对比撞色']) assert.equal(styleLabels.includes(name), true, name);
  assert.equal(JSON.stringify(styleLabels), JSON.stringify(layout.SET_STYLES.map(item => item.label)));
  assert.equal(style.value, 'off');
  assert.match(document.getElementById('tbStyleHint').textContent, /不强制/);
  sandbox.saveAppState = () => { sandbox.persistedLayout = JSON.parse(JSON.stringify(sandbox.__customLayout)); };
  style.value = 'guochao';
  style.dispatchEvent({type: 'change'});
  assert.equal(sandbox.__customLayout.taobao.setStyle, 'guochao');
  assert.equal(sandbox.persistedLayout.taobao.setStyle, 'guochao');
  assert.equal(sandbox.persistedLayout.taobao.detailCount, 2);
  assert.equal(sandbox.persistedLayout.taobao.detailWhitespace, false);
  assert.equal(sandbox.persistedLayout.taobao.background, 'white');
  assert.match(document.getElementById('tbStyleHint').textContent, /国潮质感/);
  assert.match(document.getElementById('tbStyleHint').textContent, /不承诺成图质量/);
  style.value = 'off';
  sandbox.__customLayout = JSON.parse(JSON.stringify(sandbox.persistedLayout));
  document.getElementById('generationMode').dispatchEvent({type: 'change', detail: {isRestore: true}});
  assert.equal(style.value, 'guochao');
  document.getElementById('tbBgEntry').dispatchEvent({type: 'click'});
  assert.match(sandbox.__taobaoOneShot.note, /白底图/);
  sandbox.__loadAppStateFrom(JSON.stringify({targetMarket: '{"market":"美国", "lang":"English"}', designScope: 'main_and_6'}));
  assert.equal(JSON.parse(market.value).market, '中国大陆');
  assert.equal(scope.value, 'main_and_6');
  assert.equal([...scope.options].find(option => option.value === 'main_and_6').hidden, true);
  const restored = open('designScope');
  assert.equal(restored.items.some(item => /主幅图|THD|A\+|内部保留/.test(item)), false);
  scope.innerHTML = '<option value="" disabled>请选择</option><option value="ultra_main_8">主副图 8张</option><option value="ultra_premium_aplus_5">高级A+ 5张</option><option value="thd_only">THD要求图 7张</option>';
  scope.value = 'ultra_main_8';
  document.getElementById('generationMode').dispatchEvent({type: 'change', detail: {isRestore: true}});
  assert.equal([...scope.options].find(option => option.value === 'custom').hidden, false);
  assert.equal([...scope.options].find(option => option.value === 'ultra_main_8').hidden, true);
  assert.equal([...scope.options].find(option => option.value === 'thd_only').hidden, true);
  const rewritten = open('designScope');
  assert.equal(rewritten.items.some(item => /THD|A\+|主副图|内部保留/.test(item)), false);
  assert.equal(rewritten.items.some(item => item.includes('淘宝壳')), true);
});

test('chosen set style is copied into every active slot prompt, including a one-slot redraw', async t => {
  const captured = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-taobao-style-'));
  const app = createWorkbench({dataDirectory:directory, configuration:{}, provider:async request => { captured.push(request); return png; }});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, {recursive:true, force:true}); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const {token} = await (await fetch(base + '/api/session')).json();
  const call = async (url, payload) => {
    const response = await fetch(base + url, {method:'POST', headers:{'Content-Type':'application/json', 'X-Workbench-Token':token}, body:JSON.stringify(payload)});
    return {response, data:await response.json()};
  };
  const wait = async (kind, id) => {
    let task;
    for (let i = 0; i < 50; i++) {
      task = await (await fetch(base + '/api/tasks/' + kind + '/' + id)).json();
      if (task.status === 'completed' || task.status === 'failed') return task;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return task;
  };
  const spec = layout.normalize({mainCount:1, skuCount:1, detailCount:1, sizes:{main:'square', sku:'square', detail:'portrait'}, detailWhitespace:true, background:'off', setStyle:'white_studio'});
  const custom = layout.toCustomLayout(spec, {});
  const layoutPayload = {main:custom.main, sub:custom.sub, aplus:custom.aplus, aplus_type:custom.aplusType};
  await call('/api/agent', {agent_task_id:'tb_style', product_name:'杯子', product_desc:'白色杯身', design_scope:'custom', custom_layout:layoutPayload, slot_directives:[{slot:1,taobao_role:'sku'}]});
  const agent = await wait('agent_tasks', 'tb_style');
  assert.equal(agent.status, 'completed');
  const dirs = layout.annotateDirectives([
    {slot:0, title:'【主图】', requirement:'主图要求', ref_images:[]},
    {slot:1, title:'【卖点图1】', requirement:null, ref_images:[]},
    {slot:7, title:'【高级A+模块1】', requirement:'详情要求', ref_images:[]}
  ], spec).directives;
  const sent = await call('/api/generate', {
    agent_task_id:'tb_style', sop_text:agent.result, design_scope:'custom', custom_layout:layoutPayload,
    firebase_tasks:dirs.map(item => ({slot:item.slot, taskId:'tb_style_' + item.slot, aspect_ratio:layout.ratioForZone(layout.zoneForSlot(item.slot, spec).zone, spec)})),
    slot_directives:dirs
  });
  assert.equal(sent.response.status, 202);
  for (const item of dirs) {
    const task = await wait('hyrule_tasks', 'tb_style_' + item.slot);
    assert.equal(task.status, 'completed');
    assert.match(task.prompt, /整套风格：纯白棚拍/);
  }
  assert.match((await wait('hyrule_tasks', 'tb_style_0')).prompt, /主图要求/);
  assert.match((await wait('hyrule_tasks', 'tb_style_7')).prompt, /详情图底部留出一条干净留白/);
  assert.equal(captured.length, 3);
  const redraw = await call('/api/generate', {
    agent_task_id:'tb_style', sop_text:agent.result, design_scope:'custom', custom_layout:layoutPayload,
    firebase_tasks:[{slot:1, taskId:'tb_style_redraw', aspect_ratio:'1:1'}],
    slot_directives:dirs
  });
  assert.equal(redraw.response.status, 202);
  const redrawTask = await wait('hyrule_tasks', 'tb_style_redraw');
  assert.equal(redrawTask.status, 'completed');
  assert.match(redrawTask.prompt, /整套风格：纯白棚拍/);
  assert.equal(captured.length, 4);
  assert.equal(captured.filter(item => /整套风格：纯白棚拍/.test(item.prompt)).length, 4);
});

test('custom sizes remain available while legacy text coordinates are ignored', () => {
  const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.equal(layout.parseCustomSize({width:800, height:''}), null);
  assert.equal(layout.parseCustomSize({width:63, height:100}), null);
  assert.equal(layout.parseCustomSize({width:800.5, height:1200}), null);
  assert.equal(layout.parseCustomSize({width:'2049', height:'1024'}), null);
  same(layout.parseCustomSize({width:'0800', height:'1200'}), {width:800, height:1200});
  assert.equal(layout.normalize({customSizes:{main:{width:800}}}).customSizes.main, null);
  assert.equal(layout.aspectRatioForPixels(800, 1200), '2:3');
  assert.equal(layout.aspectRatioForPixels(1000, 1000), '1:1');
  assert.equal(layout.aspectRatioForPixels(900, 1600), '9:16');
  assert.equal(layout.aspectRatioForPixels(1200, 1600), '3:4');
  assert.equal(layout.aspectRatioForPixels(1000, 800), '5:4');
  assert.equal(layout.aspectRatioForPixels(1536, 1024), '3:2');
  assert.equal(layout.aspectRatioForPixels(1920, 1080), '16:9');
  assert.equal(layout.aspectRatioForPixels(640, 1000), '2:3');
  assert.equal(layout.aspectRatioForPixels(800, 2000), '9:16');
  const shortcuts = layout.normalize({sizes:{main:'square', sku:'landscape', detail:'portrait'}});
  assert.equal(layout.ratioForZone('main', shortcuts), '1:1');
  assert.equal(layout.ratioForZone('sku', shortcuts), '16:9');
  assert.equal(layout.ratioForZone('detail', shortcuts), '3:4');
  const custom = layout.normalize({mainCount:5, skuCount:1, detailCount:3, sizes:shortcuts.sizes, customSizes:{main:{width:800, height:1200}, sku:{width:1000, height:800}, detail:{width:900, height:1600}}});
  assert.equal(custom.sizes.main, 'square');
  assert.equal(custom.sizes.detail, 'portrait');
  assert.equal(layout.ratioForZone('main', custom), '2:3');
  assert.equal(layout.ratioForZone('sku', custom), '5:4');
  assert.equal(layout.ratioForZone('detail', custom), '9:16');
  assert.equal(layout.ratioForTitle('【主图】', custom), '2:3');
  assert.equal(layout.ratioForTitle('【卖点图5】', custom), '5:4');
  assert.equal(layout.ratioForTitle('【高级A+模块1】', custom), '9:16');
  const kept = layout.annotateDirectives([
    {slot:0, requirement:'主图要求；整套风格：胶片质感'},
    {slot:7, requirement:'详情要求'}
  ], {mainCount:1, skuCount:0, detailCount:1, setStyle:'morandi', textPositions:{0:{x:73, y:18}}, customSizes:{main:{width:800, height:1200}}});
  assert.match(kept.directives[0].requirement, /^主图要求；整套风格：胶片质感/);
  assert.match(kept.directives[0].requirement, /整套风格：莫兰迪低饱和/);
  assert.match(kept.directives[0].requirement, /宽 800 像素，高 1200 像素，画幅 2:3/);
  assert.equal(kept.directives[0].text_position,undefined);
  assert.doesNotMatch(kept.directives[0].requirement,/文字位置|水平 73%|垂直 18%/);
  same(kept.directives[0].custom_size, {width:800, height:1200});
  assert.doesNotMatch(kept.directives[0].requirement, /水平 50%/);
  assert.match(kept.directives[1].requirement, /^详情要求/);
  assert.match(kept.directives[1].requirement, /整套风格：莫兰迪低饱和/);
  assert.equal(kept.directives[1].text_position, undefined);
});

test('custom width and height use generation while legacy text positions do not', async t => {
  const captured = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-taobao-place-'));
  const app = createWorkbench({dataDirectory:directory, configuration:{}, provider:async request => { captured.push(request); return png; }});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, {recursive:true, force:true}); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const {token} = await (await fetch(base + '/api/session')).json();
  const call = async (url, payload) => {
    const response = await fetch(base + url, {method:'POST', headers:{'Content-Type':'application/json', 'X-Workbench-Token':token}, body:JSON.stringify(payload)});
    return {response, data:await response.json()};
  };
  const wait = async id => {
    let task;
    for (let i = 0; i < 50; i++) {
      task = await (await fetch(base + '/api/tasks/hyrule_tasks/' + id)).json();
      if (task.status === 'completed' || task.status === 'failed') return task;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return task;
  };
  const spec = layout.normalize({
    mainCount:1, skuCount:1, detailCount:1,
    sizes:{main:'square', sku:'square', detail:'portrait'},
    customSizes:{main:{width:800, height:1200}, sku:{width:1000, height:800}, detail:{width:900, height:1600}},
    textPositions:{0:{x:73, y:18}, 1:{x:50, y:50}, 7:{x:12.5, y:91}},
    detailWhitespace:true, background:'off', setStyle:'film_look'
  });
  const custom = layout.toCustomLayout(spec, {});
  const layoutPayload = {main:custom.main, sub:custom.sub, aplus:custom.aplus, aplus_type:custom.aplusType};
  await call('/api/agent', {agent_task_id:'tb_place', product_name:'杯子', product_desc:'白色杯身', design_scope:'custom', custom_layout:layoutPayload, slot_directives:[{slot:1,taobao_role:'sku'}]});
  let agent;
  for (let i = 0; i < 50; i++) {
    agent = await (await fetch(base + '/api/tasks/agent_tasks/tb_place')).json();
    if (agent.status === 'completed' || agent.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(agent.status, 'completed');
  const dirs = layout.annotateDirectives([
    {slot:0, title:'【主图】', requirement:'主图要求：标题保持原句', ref_images:[]},
    {slot:1, title:'【卖点图1】', requirement:'SKU卖点原文', ref_images:[]},
    {slot:7, title:'【高级A+模块1】', requirement:'详情要求：已有风格句不要清掉', ref_images:[]}
  ], spec).directives;
  const sent = await call('/api/generate', {
    agent_task_id:'tb_place', sop_text:agent.result, design_scope:'custom', custom_layout:layoutPayload,
    firebase_tasks:dirs.map(item => ({slot:item.slot, taskId:'tb_place_' + item.slot, aspect_ratio:layout.ratioForZone(layout.zoneForSlot(item.slot, spec).zone, spec)})),
    slot_directives:dirs
  });
  assert.equal(sent.response.status, 202);
  for (const item of dirs) assert.equal((await wait('tb_place_' + item.slot)).status, 'completed');
  assert.equal(captured.length, 3);
  for(const request of captured)assert.doesNotMatch(request.prompt,/文字位置|text_position|水平 73%|垂直 91%/);
  const main = captured.find(item => item.ratio === '2:3');
  const sku = captured.find(item => item.ratio === '5:4');
  const detail = captured.find(item => item.ratio === '9:16');
  assert.match(main.prompt, /宽 800 像素，高 1200 像素/);
  assert.match(main.prompt, /主图要求：标题保持原句/);
  assert.match(main.prompt, /整套风格：胶片质感/);
  assert.match(main.prompt, /杯子/);
  assert.match(sku.prompt, /宽 1000 像素，高 800 像素，画幅 5:4/);
  assert.match(sku.prompt, /SKU卖点原文/);
  assert.match(sku.prompt, /整套风格：胶片质感/);
  assert.match(detail.prompt, /宽 900 像素，高 1600 像素，画幅 9:16/);
  assert.match(detail.prompt, /详情要求：已有风格句不要清掉/);
  assert.match(detail.prompt, /详情图底部留出一条干净留白/);
  assert.match(detail.prompt, /整套风格：胶片质感/);
});

test('SKU slot generate uses uploaded SKU photos and keeps the main-product path when none are attached', async t => {
  const captured = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-taobao-sku-refs-'));
  const app = createWorkbench({dataDirectory:directory, configuration:{}, provider:async request => { captured.push(request); return png; }});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, {recursive:true, force:true}); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const {token} = await (await fetch(base + '/api/session')).json();
  const call = async (url, payload) => {
    const response = await fetch(base + url, {method:'POST', headers:{'Content-Type':'application/json', 'X-Workbench-Token':token}, body:JSON.stringify(payload)});
    return {response, data:await response.json()};
  };
  const wait = async id => {
    let task;
    for (let i = 0; i < 50; i++) {
      task = await (await fetch(base + '/api/tasks/hyrule_tasks/' + id)).json();
      if (task.status === 'completed' || task.status === 'failed') return task;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return task;
  };
  const mainUrl = '/media/main-body.png';
  const red = '/media/sku-red.png';
  const blue = '/media/sku-blue.png';
  const withSku = [
    {filename:'产品主体图_1', url:mainUrl},
    {filename:'SKU图_1', url:red},
    {filename:'SKU图_2', url:blue}
  ];
  const spec = layout.normalize({mainCount:1, skuCount:2, detailCount:0, sizes:{main:'square', sku:'square', detail:'portrait'}, detailWhitespace:false, background:'off', setStyle:'film_look'});
  const custom = layout.toCustomLayout(spec, {});
  const layoutPayload = {main:custom.main, sub:custom.sub, aplus:custom.aplus, aplus_type:custom.aplusType};
  const raw = [
    {slot:0, title:'【主图】', requirement:'主图要求：标题保持原句', ref_images:[]},
    {slot:1, title:'【卖点图1】', requirement:'红色规格', ref_images:[]},
    {slot:2, title:'【卖点图2】', requirement:'蓝色规格', ref_images:[]}
  ];
  await call('/api/agent', {
    agent_task_id:'tb_sku_refs', product_name:'杯子', product_desc:'白色杯身', design_scope:'custom',
    custom_layout:layoutPayload, categorized_images:[{filename:'产品主体图_1', url:mainUrl}],
    slot_directives:[{slot:1,taobao_role:'sku'},{slot:2,taobao_role:'sku'}]
  });
  let agent;
  for (let i = 0; i < 50; i++) {
    agent = await (await fetch(base + '/api/tasks/agent_tasks/tb_sku_refs')).json();
    if (agent.status === 'completed' || agent.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(agent.status, 'completed');
  assert.equal(captured.length, 0);
  assert.deepEqual(agent.plan.sections.find(item => item.slot === 1).ref_images, ['产品主体图_1']);
  assert.deepEqual(agent.plan.sections.find(item => item.slot === 2).ref_images, ['产品主体图_1']);
  const styled = layout.annotateDirectives(raw, spec).directives;
  const old = await call('/api/generate', {
    agent_task_id:'tb_sku_refs', sop_text:agent.result, design_scope:'custom', custom_layout:layoutPayload,
    categorized_images:withSku,
    firebase_tasks:styled.map(item => ({slot:item.slot, taskId:'tb_sku_old_' + item.slot, aspect_ratio:'1:1'})),
    slot_directives:styled
  });
  assert.equal(old.response.status, 202);
  for (const item of styled) {
    const task = await wait('tb_sku_old_' + item.slot);
    assert.equal(task.status, 'completed');
    assert.deepEqual(task.referenceImages, [mainUrl]);
  }
  assert.equal(captured.length, 3);
  assert.ok(captured.every(item => JSON.stringify(item.references) === JSON.stringify([mainUrl])));
  assert.ok(captured.some(item => item.prompt.includes('红色规格')));
  assert.ok(captured.every(item => item.prompt.includes('整套风格：胶片质感')));
  assert.ok(captured.every(item => !item.prompt.includes('SKU图_')));
  const linked = layout.attachSkuRefs(styled, spec, ['SKU图_1', 'SKU图_2']).directives;
  // Changing the SKU references requires a fresh plan, so old variant text cannot leak.
  await call('/api/agent', {agent_task_id:'tb_sku_linked', product_name:'杯子', product_desc:'白色杯身',
    design_scope:'custom', custom_layout:layoutPayload, categorized_images:withSku, slot_directives:linked});
  for (let i = 0; i < 50; i++) {
    agent = await (await fetch(base + '/api/tasks/agent_tasks/tb_sku_linked')).json();
    if (agent.status === 'completed' || agent.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(agent.status, 'completed');
  const sent = await call('/api/generate', {
    agent_task_id:'tb_sku_linked', sop_text:agent.result, design_scope:'custom', custom_layout:layoutPayload,
    categorized_images:withSku,
    firebase_tasks:linked.map(item => ({slot:item.slot, taskId:'tb_sku_new_' + item.slot, aspect_ratio:'1:1'})),
    slot_directives:linked
  });
  assert.equal(sent.response.status, 202);
  for (const item of linked) assert.equal((await wait('tb_sku_new_' + item.slot)).status, 'completed');
  const fresh = captured.slice(3);
  const mainShot = fresh.find(item => item.prompt.includes('主图要求：标题保持原句'));
  const redShot = fresh.find(item => item.prompt.includes('红色规格'));
  const blueShot = fresh.find(item => item.prompt.includes('蓝色规格'));
  assert.deepEqual(mainShot.references, [mainUrl]);
  assert.deepEqual(redShot.references, [red]);
  assert.deepEqual(blueShot.references, [blue]);
  assert.match(redShot.prompt, /红色规格；整套风格：胶片质感/);
  assert.match(redShot.prompt, /规格图「SKU图_1」/);
  assert.match(redShot.prompt, /不要只按产品主体图/);
  assert.doesNotMatch(redShot.prompt, /SKU图_2/);
  assert.match(blueShot.prompt, /蓝色规格；整套风格：胶片质感/);
  assert.match(blueShot.prompt, /SKU图_2/);
  assert.doesNotMatch(mainShot.prompt, /SKU图_/);
  assert.deepEqual((await wait('tb_sku_new_1')).referenceImages, [red]);
  assert.deepEqual((await wait('tb_sku_new_2')).referenceImages, [blue]);
  const redraw = await call('/api/generate', {
    agent_task_id:'tb_sku_linked', sop_text:agent.result, design_scope:'custom', custom_layout:layoutPayload,
    categorized_images:withSku,
    firebase_tasks:[{slot:1, taskId:'tb_sku_redraw', aspect_ratio:'1:1'}],
    slot_directives:linked
  });
  assert.equal(redraw.response.status, 202);
  const redrawTask = await wait('tb_sku_redraw');
  assert.equal(redrawTask.status, 'completed');
  assert.deepEqual(redrawTask.referenceImages, [red]);
  assert.deepEqual(captured.at(-1).references, [red]);
  assert.match(captured.at(-1).prompt, /红色规格；整套风格：胶片质感/);
  assert.match(captured.at(-1).prompt, /SKU图_1/);
});

test('gallery has no text movement controls while custom sizes, SKU references and ordinary redraw remain', async () => {
  const ids = new Map();
  const all = [];
  const windowListeners = new Map();
  function classListFor(el) {
    const names = () => el.className ? el.className.split(/\s+/).filter(Boolean) : [];
    return {
      add(...list) { el.className = [...new Set([...names(), ...list])].join(' '); },
      remove(...list) { const dropNames = new Set(list); el.className = names().filter(name => !dropNames.has(name)).join(' '); },
      contains(name) { return names().includes(name); },
      toggle(name, force) {
        const on = force === undefined ? !names().includes(name) : !!force;
        if (on) this.add(name); else this.remove(name);
        return on;
      }
    };
  }
  function drop(node) {
    const index = all.indexOf(node);
    if (index >= 0) all.splice(index, 1);
    if (node.id && ids.get(node.id) === node) ids.delete(node.id);
    for (const child of [...(node.children || [])]) drop(child);
    node.children = [];
    node.parentElement = null;
  }
  function make(tag) {
    let text = '';
    let id = '';
    const el = {
      tagName: tag.toUpperCase(), className: '', hidden: false, disabled: false, checked: false, name: '', type: '',
      style: {}, children: [], parentElement: null, _attrs: {}, classList: null, _rect: null
    };
    el.classList = classListFor(el);
    Object.defineProperty(el, 'textContent', {
      get() { return text || el.children.map(child => child.textContent).join(''); },
      set(value) { text = String(value ?? ''); }
    });
    Object.defineProperty(el, 'id', {
      get() { return id; },
      set(value) { if (id && ids.get(id) === el) ids.delete(id); id = value || ''; if (id) ids.set(id, el); }
    });
    Object.defineProperty(el, 'parentNode', {get() { return el.parentElement; }});
    el.dataset = new Proxy({}, {get: (box, key) => box[key], set: (box, key, value) => {
      box[key] = String(value);
      el._attrs['data-' + String(key).replace(/[A-Z]/g, char => '-' + char.toLowerCase())] = String(value);
      return true;
    }});
    const adopt = child => {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
      child.parentElement = el;
      if (!all.includes(child)) all.push(child);
    };
    el.appendChild = child => { adopt(child); el.children.push(child); return child; };
    el.prepend = child => { adopt(child); el.children.unshift(child); return child; };
    el.insertBefore = (child, before) => {
      adopt(child);
      const at = before ? el.children.indexOf(before) : el.children.length;
      el.children.splice(at < 0 ? el.children.length : at, 0, child);
      return child;
    };
    el.before = sibling => {
      const parent = el.parentElement;
      const index = parent.children.indexOf(el);
      if (sibling.parentElement) sibling.parentElement.children = sibling.parentElement.children.filter(item => item !== sibling);
      parent.children.splice(index, 0, sibling);
      sibling.parentElement = parent;
      if (!all.includes(sibling)) all.push(sibling);
    };
    el.after = sibling => {
      const parent = el.parentElement;
      const index = parent.children.indexOf(el);
      if (sibling.parentElement) sibling.parentElement.children = sibling.parentElement.children.filter(item => item !== sibling);
      parent.children.splice(index + 1, 0, sibling); sibling.parentElement = parent;
      if (!all.includes(sibling)) all.push(sibling);
    };
    el.remove = () => drop(el);
    el.addEventListener = (type, fn) => { (el._on ||= {})[type] ||= []; el._on[type].push(fn); };
    el.dispatchEvent = event => { for (const fn of el._on?.[event.type] || []) fn(event); };
    el.getBoundingClientRect = () => el._rect || {left:0, top:0, right:200, bottom:400, width:200, height:400};
    el.closest = () => null;
    const walk = node => {
      const found = [];
      const visit = current => {
        const kids = current.children || [];
        for (let i = 0; i < kids.length; i++) { found.push(kids[i]); visit(kids[i]); }
      };
      visit(node);
      return found;
    };
    el.querySelectorAll = selector => walk(el).filter(node => matches(node, selector));
    el.querySelector = selector => el.querySelectorAll(selector)[0] || null;
    if (tag === 'select') {
      let value = '';
      const options = () => { const found = []; const walk = node => { for (const child of node.children) { if (child.tagName === 'OPTION') found.push(child); else walk(child); } }; walk(el); return found; };
      Object.defineProperty(el, 'options', {get: options});
      Object.defineProperty(el, 'value', {get() { return value; }, set(next) { value = String(next ?? ''); }});
      Object.defineProperty(el, 'selectedIndex', {get() { return options().findIndex(option => option.value === value); }});
      Object.defineProperty(el, 'selectedOptions', {get() { const option = options().find(item => item.value === value); return option ? [option] : []; }});
    } else el.value = '';
    Object.defineProperty(el, 'innerHTML', {set(html) {
      for (const child of [...el.children]) drop(child);
      el.children = [];
      parseHTML(String(html), el);
    }});
    return el;
  }
  function parseHTML(html, parent) {
    const re = /([^<]+)|<\/([a-zA-Z0-9]+)>|<([a-zA-Z0-9]+)([^>]*)>/g;
    const stack = [parent];
    let match;
    while ((match = re.exec(html))) {
      if (match[1]) { const bit = match[1].replace(/\s+/g, ' ').trim(); if (bit && stack.at(-1) !== parent) stack.at(-1).textContent = `${stack.at(-1).textContent} ${bit}`.trim(); continue; }
      if (match[2]) { const tag = match[2].toUpperCase(); while (stack.length > 1 && stack.at(-1).tagName !== tag) stack.pop(); if (stack.length > 1) stack.pop(); continue; }
      const el = make(match[3].toLowerCase());
      const attrs = match[4] || '';
      for (const attr of attrs.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
        const key = attr[1]; const val = attr[2] ?? attr[3] ?? '';
        if (key === 'id') el.id = val;
        else if (key === 'class') el.className = val;
        else if (key === 'value') el.value = val;
        else if (key === 'name') el.name = val;
        else if (key === 'type') el.type = val;
        else if (key === 'checked' || key === 'selected') el.checked = true;
        else if (key === 'hidden') el.hidden = true;
        else if (key === 'disabled') el.disabled = true;
      }
      stack.at(-1).appendChild(el);
      if (!['input', 'br', 'img'].includes(match[3].toLowerCase()) && !/\/\s*$/.test(attrs)) stack.push(el);
    }
  }
  function matches(el, selector) {
    let rest = selector;
    const tag = rest.match(/^[a-zA-Z][\w-]*/);
    if (tag) { if (el.tagName !== tag[0].toUpperCase()) return false; rest = rest.slice(tag[0].length); }
    if (!rest) return true;
    const parts = rest.match(/(\.[^.#:[\]]+|#[^.#:[\]]+|\[[^\]]+\]|:[^.#:[\]]+)/g);
    if (!parts) return false;
    return parts.every(part => {
      if (part.startsWith('.')) return el.classList.contains(part.slice(1));
      if (part.startsWith('#')) return el.id === part.slice(1);
      const attr = part.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
      if (!attr) return false;
      const actual = attr[1] === 'name' ? el.name : attr[1] === 'value' ? el.value : el._attrs[attr[1]];
      return attr[2] === undefined ? actual != null && actual !== '' : String(actual) === attr[2];
    });
  }
  function descendants(node) {
    const found = [];
    const walk = current => { for (const child of current.children || []) { found.push(child); walk(child); } };
    return found;
  }
  function queryAll(selector) {
    const steps = selector.trim().split(/\s+/);
    let pool = all.filter(el => matches(el, steps[0]));
    for (const step of steps.slice(1)) {
      const next = [];
      for (const base of pool) for (const child of descendants(base)) if (matches(child, step)) next.push(child);
      pool = next;
    }
    return pool;
  }
  const document = {
    readyState: 'complete',
    createElement: make,
    getElementById: id => ids.get(id) || null,
    querySelector: selector => queryAll(selector)[0] || null,
    querySelectorAll: selector => queryAll(selector),
    addEventListener() {}
  };
  document.head = make('head');
  document.body = make('body');
  all.push(document.head, document.body);
  const host = make('div');
  document.body.appendChild(host);
  host.innerHTML = `
    <select id="generationMode"><option value="fast" selected>快速设计</option></select>
    <select id="designScope"><option value="" disabled>请选择</option><option value="main_and_6">主幅图7张</option></select>
    <select id="targetMarket"><option value='{"market":"中国大陆", "lang":"简体中文"}'>中国大陆 (CN / 简体中文)</option></select>
    <div id="galleryContainer"></div>`;
  const imageSlots = [{url:'/media/main.png'}];
  const point = (type, x, y) => ({type, button:0, clientX:x, clientY:y, pointerId:1, preventDefault() {}, stopPropagation() {}});
  const sandbox = {
    console, document, Event,
    imageSlots,
    setTimeout: fn => { fn(); return 0; },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() {} disconnect() {} },
    addEventListener(type, fn) { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type).add(fn); },
    removeEventListener(type, fn) { windowListeners.get(type)?.delete(fn); },
    buildGalleryLayout() {
      const gallery = document.getElementById('galleryContainer');
      gallery.innerHTML = '';
      imageSlots.forEach((item, index) => {
        if (!item?.url) return;
        const slot = document.createElement('div');
        slot.id = 'slot-' + index;
        const img = document.createElement('img');
        img.src = item.url;
        slot.appendChild(img);
        gallery.appendChild(slot);
      });
    },
    renderSlot(index) {
      const slot = document.getElementById('slot-' + index);
      if (!slot) return;
      slot.innerHTML = '';
      if (!imageSlots[index]?.url) return;
      const img = document.createElement('img');
      img.src = imageSlots[index].url;
      slot.appendChild(img);
    },
    buildSlotDirectives() {
      return [
        {slot:0, title:'【主图】', requirement:'主图要求：标题保持原句', ref_images:[]},
        {slot:5, title:'【卖点图5】', requirement:'SKU卖点原文', ref_images:[]},
        {slot:7, title:'【高级A+模块1】', requirement:'详情要求：已有风格句不要清掉', ref_images:[]}
      ];
    },
    _aspectForTitle() { return '1:1'; },
    saveAppState() { sandbox.saved = true; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(layoutSource, sandbox, {filename:'taobao-layout.js'});
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/local/taobao-shell.js'), 'utf8'), sandbox, {filename:'taobao-shell.js'});
  const upload = document.getElementById('tbSkuUpload');
  assert.equal(upload.textContent, '上传 SKU 图');
  assert.equal(upload.hidden, false);
  let walk = upload;
  let inShell = false;
  let inLegacy = false;
  while (walk) {
    if (walk.id === 'taobaoShell') inShell = true;
    if (walk.id === 'taobaoLegacyScope') inLegacy = true;
    walk = walk.parentElement;
  }
  assert.equal(inShell, true);
  assert.equal(inLegacy, false);
  assert.equal(document.getElementById('taobaoShell').hidden, false);
  assert.equal(document.getElementById('tbSkuFile').type, 'file');
  assert.equal(document.getElementById('tbSkuUploadCount').textContent, '还没有 SKU 图');
  assert.match(document.getElementById('tbSkuUploadHint').textContent, /没传规格图时只按本品外观/);
  assert.match(document.getElementById('tbSkuUploadHint').textContent, /上传数量不改变出图张数/);
  const bare = sandbox.buildSlotDirectives();
  assert.equal(JSON.stringify(bare.find(item => item.slot === 5).ref_images), '[]');
  assert.equal(bare.find(item => item.slot === 5).requirement, 'SKU卖点原文');
  const typeSize = (widthId, heightId, width, height) => {
    document.getElementById(widthId).value = width;
    document.getElementById(widthId).dispatchEvent({type:'input'});
    assert.equal(sandbox.__customLayout.taobao.customSizes[widthId.includes('Main') ? 'main' : widthId.includes('Sku') ? 'sku' : 'detail'], null);
    document.getElementById(heightId).value = height;
    document.getElementById(heightId).dispatchEvent({type:'input'});
  };
  typeSize('tbMainWidth', 'tbMainHeight', '800', '1200');
  typeSize('tbSkuWidth', 'tbSkuHeight', '1000', '800');
  typeSize('tbDetailWidth', 'tbDetailHeight', '900', '1600');
  assert.equal(JSON.stringify(sandbox.__customLayout.taobao.customSizes.main), JSON.stringify({width:800, height:1200}));
  assert.equal(JSON.stringify(sandbox.__customLayout.taobao.customSizes.sku), JSON.stringify({width:1000, height:800}));
  assert.equal(JSON.stringify(sandbox.__customLayout.taobao.customSizes.detail), JSON.stringify({width:900, height:1600}));
  assert.equal(sandbox._aspectForTitle('【主图】'), '2:3');
  assert.equal(sandbox._aspectForTitle('【卖点图5】'), '5:4');
  assert.equal(sandbox._aspectForTitle('【高级A+模块1】'), '9:16');
  assert.equal(sandbox.__customLayout.taobao.sizes.main, 'square');
  assert.equal(sandbox.__customLayout.taobao.sizes.detail, 'portrait');
  document.getElementById('tbMainSize').value = 'landscape';
  document.getElementById('tbMainSize').dispatchEvent({type:'change'});
  assert.equal(sandbox.__customLayout.taobao.customSizes.main, null);
  assert.equal(document.getElementById('tbMainWidth').value, '');
  assert.equal(document.getElementById('tbMainHeight').value, '');
  assert.equal(sandbox._aspectForTitle('【主图】'), '16:9');
  assert.equal(sandbox._aspectForTitle('【卖点图5】'), '5:4');
  assert.equal(sandbox._aspectForTitle('【高级A+模块1】'), '9:16');
  assert.equal(sandbox.__customLayout.taobao.textPositions, undefined);
  document.getElementById('tbSetStyle').value = 'morandi';
  document.getElementById('tbSetStyle').dispatchEvent({type:'change'});
  const dirs = sandbox.buildSlotDirectives();
  const main = dirs.find(item => item.slot === 0);
  const detail = dirs.find(item => item.slot === 7);
  assert.match(main.requirement, /^主图要求：标题保持原句/);
  assert.match(main.requirement, /整套风格：莫兰迪低饱和/);
  assert.doesNotMatch(main.requirement, /宽 800/);
  assert.match(detail.requirement, /^详情要求：已有风格句不要清掉/);
  assert.match(detail.requirement, /整套风格：莫兰迪低饱和/);
  assert.match(detail.requirement, /宽 900 像素，高 1600 像素/);
  assert.equal(sandbox.__customLayout.taobao.setStyle, 'morandi');
  assert.equal(document.querySelector('[data-taobao-text-pin]'),null);
  assert.equal(document.querySelector('[data-taobao-text-origin]'),null);
  assert.equal(document.querySelector('.taobao-text-stage'),null);
  assert.equal(sandbox.saved, true);
  const materials = [];
  sandbox.__workbenchMaterials = () => materials;
  sandbox.processNewFiles = (files, category) => {
    sandbox.skuUpload = {category, length: files.length};
    for (const file of files) {
      if (!String(file.type || '').startsWith('image/')) continue;
      const index = materials.filter(item => item.category === category).length + 1;
      materials.push({id:'sku_' + file.name, category, filename:category + '_' + index, preview:file.preview, url:file.url});
    }
  };
  sandbox.removeMaterial = id => {
    const index = materials.findIndex(item => item.id === id);
    if (index >= 0) materials.splice(index, 1);
    sandbox.removed = id;
  };
  const input = document.getElementById('tbSkuFile');
  input.value = 'picked';
  input.files = [
    {type:'image/jpeg', name:'red.jpg', url:'/media/sku-red.jpg', preview:'data:image/jpeg;base64,red'},
    {type:'image/png', name:'blue.png', url:'/media/sku-blue.png', preview:'data:image/png;base64,blue'},
    {type:'text/plain', name:'notes.txt', url:'/media/notes.txt'}
  ];
  input.dispatchEvent({type:'change'});
  assert.equal(input.value, '');
  assert.equal(sandbox.skuUpload.category, 'SKU图');
  assert.equal(sandbox.skuUpload.length, 3);
  assert.equal(materials.length, 2);
  assert.equal(document.getElementById('tbSkuUploadCount').textContent, '已上传 2 张 SKU 图');
  assert.equal(document.getElementById('tbSkuUpload').textContent, '上传 SKU 图');
  const uploaded = sandbox.buildSlotDirectives();
  const sku = uploaded.find(item => item.slot === 5);
  assert.equal(JSON.stringify(sku.ref_images), JSON.stringify(['SKU图_1']));
  assert.match(sku.requirement, /^SKU卖点原文/);
  assert.match(sku.requirement, /整套风格：莫兰迪低饱和/);
  assert.match(sku.requirement, /宽 1000 像素，高 800 像素/);
  assert.match(sku.requirement, /SKU图_1/);
  assert.match(sku.requirement, /不要只按产品主体图/);
  assert.equal(JSON.stringify(uploaded.find(item => item.slot === 0).ref_images), '[]');
  assert.equal(JSON.stringify(uploaded.find(item => item.slot === 7).ref_images), '[]');
  assert.match(uploaded.find(item => item.slot === 0).requirement, /^主图要求：标题保持原句/);
  document.querySelector('.tb-sku-remove').dispatchEvent({type:'click'});
  assert.equal(sandbox.removed, 'sku_red.jpg');
  assert.equal(materials.length, 1);
  assert.equal(materials[0].filename, 'SKU图_2');
  assert.equal(JSON.stringify(sandbox.buildSlotDirectives().find(item => item.slot === 5).ref_images), JSON.stringify(['SKU图_2']));
  assert.equal(document.getElementById('tbSkuUploadCount').textContent, '已上传 1 张 SKU 图');
  assert.match(sandbox.buildSlotDirectives().find(item => item.slot === 0).requirement, /^主图要求：标题保持原句/);
  assert.equal(sandbox._aspectForTitle('【卖点图5】'), '5:4');
  const generated=[];
  sandbox.triggerGeneration=index=>generated.push(index);
  sandbox.__customLayout.taobao.textPositions={0:{x:12,y:91}};
  sandbox.__customLayout.taobao.textAnchors={0:{x:50,y:12}};
  document.querySelector('[data-taobao-redraw]').dispatchEvent({type:'click',preventDefault(){},stopPropagation(){}});
  assert.deepEqual(generated,[0],'old movement state cannot hijack ordinary redraw');
  assert.equal(document.querySelector('[data-taobao-text-pin]'),null);
});
