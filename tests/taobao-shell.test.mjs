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
