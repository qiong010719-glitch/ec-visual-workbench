import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Read the existing edit tab only. No navigation, form input, save, or publish.
const root = new URL('../', import.meta.url);
const config = await readFile(new URL('config/test-draft.json', root), 'utf8').then(JSON.parse).catch(()=>null);
const outputDir = new URL('outputs/', root);
const outputFile = new URL('draft-inspection.json', outputDir);

function assertLocal(url) {
  const parsed = new URL(url);
  if (!['http:', 'ws:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('仅允许连接本机比特接口。');
  }
  return parsed;
}

async function localRequest(url, options = {}) {
  assertLocal(url);
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`本地接口 HTTP ${response.status}`);
  return response.json();
}

async function bit(path, body = {}) {
  const result = await localRequest(`${config.localApi}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (result.success !== true) throw new Error(`比特接口 ${path} 未成功；未执行后续操作。`);
  return result.data;
}

export function readPage(expected) {
  const locationUrl = new URL(location.href);
  const pageMatches = expected.isNew === true
    ? (locationUrl.pathname === '/web/popTemu/add' && !locationUrl.searchParams.has('id'))
      || (locationUrl.pathname === '/web/popTemu/quoteEdit' && /^\d{6,30}$/.test(expected.quoteSourceId || '') && locationUrl.searchParams.get('id') === expected.quoteSourceId)
    : locationUrl.pathname === '/web/popTemu/edit' && locationUrl.searchParams.get('id') === expected.draftId;
  if (!['www.dianxiaomi.com', 'dianxiaomi.com'].includes(locationUrl.hostname)
    || !pageMatches) {
    throw new Error('草稿页面已变化，停止读取。');
  }
  const visible = el => el.getClientRects().length > 0;
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const items = [...document.querySelectorAll('.ant-form-item')].filter(visible).map(item => {
    const label = clean(item.querySelector('.ant-form-item-label')?.textContent).replace(/[：:*]/g, '').trim();
    if (!label || /token|password|secret|cookie|csrf|密码|密钥/i.test(label)) return null;
    const belongs = el => visible(el) && el.closest('.ant-form-item') === item;
    const controls = [...item.querySelectorAll('input,textarea,select')].filter(belongs)
      .filter(el => !['hidden', 'password', 'search', 'checkbox', 'radio', 'file'].includes(el.type))
      .filter(el => !/token|password|secret|cookie|csrf/i.test(`${el.name} ${el.id}`))
      .map(el => ({ name: el.name || null, value: el.value }));
    const selections = [...item.querySelectorAll('.ant-select-selection-item')].filter(belongs).map(el => clean(el.textContent));
    const checked = [...item.querySelectorAll('input:checked')].filter(belongs).map(el => clean(el.closest('label')?.textContent));
    const placeholders = [...item.querySelectorAll('.ant-select-selection-placeholder')].filter(belongs).map(el => clean(el.textContent));
    return { label, controls, selections, checked, placeholders };
  }).filter(Boolean);
  const getSelections = label => items.filter(item => item.label === label).flatMap(item => item.selections);
  const store = getSelections('店铺账号');
  const site = getSelections('经营站点');
  if (!store.includes(expected.expectedStore) || !site.includes(expected.expectedSite)) {
    throw new Error(`母稿属于“${store.join('、') || '未选择店铺'} · ${site.join('、') || '未选择站点'}”，当前配置为“${expected.expectedStore} · ${expected.expectedSite}”；请使用对应店铺的母稿。`);
  }
  const fieldNames = ['variationSku', 'identifierCode', 'price', 'skuLength', 'skuWidth', 'skuHeight', 'weight', 'stock', 'skuCategoryNum', 'numberOfPiecesNew'];
  const variantFields = Object.fromEntries(fieldNames.map(name => [name,
    [...document.getElementsByName(name)].filter(visible).map(el => el.value),
  ]));
  const imageDimensions = [...document.querySelectorAll('img')].filter(visible)
    .filter(el => el.naturalWidth >= 800 && el.naturalHeight >= 800)
    .map(el => ({ width: el.naturalWidth, height: el.naturalHeight }));
  const warehouseContext = [...document.querySelectorAll('table')].filter(visible)
    .map(el => clean(el.innerText)).filter(text => text.includes('库存')).map(text => text.slice(0, 700));
  const imageUrls = selector => [...document.querySelectorAll(selector)].map(el => el.src)
    .filter(src => /^https:\/\/wxalbum-10001658-file\.dianxiaomi\.com\//.test(src));
  const media = { mainImages: imageUrls('.mainImage .img-list img'),
    skuPreviewImages: imageUrls('.sku-image img'), detailImages: imageUrls('#wirelessDescContentBox img') };
  return { draftId: expected.isNew ? null : expected.draftId, url: location.origin + location.pathname + (expected.isNew ? '' : '?id=' + expected.draftId),
    title: document.title, store, site, items, variantFields, imageDimensions, warehouseContext, media };
}

async function evaluateReadOnly(wsUrl, expression) {
  assertLocal(wsUrl);
  const ws = new WebSocket(wsUrl);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP 连接超时。')), 15000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 连接失败。')); }, { once: true });
    });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('草稿读取超时。')), 15000);
      ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('浏览器连接已关闭。')); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 读取连接异常。')); }, { once: true });
      ws.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error('草稿 DOM 读取或店铺/站点校验失败；没有修改页面。'));
        } else resolve(message.result?.result?.value);
      });
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    if (!result) throw new Error('没有获得草稿数据。');
    return result;
  } finally {
    ws.close(); // Disconnect only; leave the user's browser and tab open.
  }
}

async function main() {
  await bit('/health');
  const listed = await bit('/browser/list', { page: 0, pageSize: 10, seq: config.browserSequence });
  const profiles = (listed?.list ?? []).filter(item => item.id === config.browserId);
  if (profiles.length !== 1) throw new Error('未找到指定的比特窗口，停止。');
  const pids = await bit('/browser/pids', { ids: [config.browserId] });
  if (!pids?.[config.browserId]) throw new Error('请先打开指定的比特窗口；此脚本不创建新环境。');
  // Official BitBrowser API returns the connection endpoint for this already-open profile.
  const opened = await bit('/browser/open', { id: config.browserId });
  const endpoint = opened.http?.startsWith('http:') ? opened.http : `http://${opened.http}`;
  const targets = await localRequest(`${endpoint}/json/list`);
  const matching = targets.filter(target => {
    if (target.type !== 'page') return false;
    try {
      const url = new URL(target.url);
      return ['www.dianxiaomi.com', 'dianxiaomi.com'].includes(url.hostname)
        && url.pathname === '/web/popTemu/edit' && url.searchParams.get('id') === config.draftId;
    } catch { return false; }
  });
  if (matching.length !== 1) throw new Error('请在指定比特窗口中保留一个目标草稿编辑页；脚本不会自行跳转。');
  const expression = `(${readPage.toString()})(${JSON.stringify({ draftId: config.draftId, expectedStore: config.expectedStore, expectedSite: config.expectedSite })})`;
  const page = await evaluateReadOnly(matching[0].webSocketDebuggerUrl, expression);
  const snapshot = {
    capturedAt: new Date().toISOString(), mode: 'read-only', source: 'existing-browser-edit-page',
    browser: { id: config.browserId, name: profiles[0].name, sequence: profiles[0].seq }, page,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  const selected = label => page.items.filter(item => item.label === label);
  console.log(JSON.stringify({ success: true, draftId: page.draftId, store: page.store, site: page.site,
    titleFields: selected('产品标题').concat(selected('英文标题')),
    shippingTemplate: selected('运费模板'), variantFields: page.variantFields,
    output: fileURLToPath(outputFile), modified: false, published: false }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
