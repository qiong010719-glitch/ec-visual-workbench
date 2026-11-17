import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connection, pageById, config, poll } from './lib/bit-cdp.mjs';
import { readPage } from './inspect-draft.mjs';

// Operate only on the independent test record created by this run, never its source.
// Default: compare only. --apply: fill the four planned fields and save if needed.
const run = JSON.parse(await readFile(new URL('../outputs/copy-test/run.json', import.meta.url), 'utf8'));
const expected = run.expected;
const apply = process.argv.includes('--apply');

function formValues(snapshot) {
  const value = label => snapshot.items.find(item => item.label === label)?.controls[0]?.value;
  return { title: value('产品标题'), englishTitle: value('英文标题'), productCode: value('产品货号'),
    sku: snapshot.variantFields.variationSku[0] };
}

async function main() {
  assert.match(run.newDraftId ?? '', /^\d+$/);
  assert.notEqual(run.newDraftId, config.draftId);
  const info = await connection();
  const target = (await info.targets()).find(target => {
    try {
      const url = new URL(target.url);
      return target.type === 'page' && ['www.dianxiaomi.com', 'dianxiaomi.com'].includes(url.hostname)
        && url.pathname === '/web/popTemu/edit' && url.searchParams.get('id') === run.newDraftId;
    } catch { return false; }
  });
  if (!target) throw new Error('请先在指定比特窗口打开本次独立测试稿。');
  const page = await pageById(info, target.id);
  try {
    const actual = formValues(await page.evaluate(readPage, { ...config, draftId: run.newDraftId }));
    const changes = Object.keys(expected).filter(key => actual[key] !== expected[key]);
    if (!apply || changes.length === 0) {
      console.log(JSON.stringify({ draftId: run.newDraftId, changed: false, pendingChanges: changes,
        reason: changes.length ? 'compare-only; use --apply for the planned update' : 'already matches; no save dispatched',
        values: actual, published: false }, null, 2));
      return;
    }
    await page.evaluate(({ draftId, sourceId, expected, store, site }) => {
      const url = new URL(location.href);
      if (url.pathname !== '/web/popTemu/edit' || url.searchParams.get('id') !== draftId || draftId === sourceId) {
        throw new Error('Refuse to change source or unrelated draft');
      }
      const item = label => [...document.querySelectorAll('.ant-form-item')]
        .find(e => e.querySelector('.ant-form-item-label')?.innerText.trim() === label);
      if (item('店铺账号')?.querySelector('.ant-select-selection-item')?.innerText !== store
        || item('经营站点')?.querySelector('.ant-select-selection-item')?.innerText !== site) throw new Error('Store/site changed');
      const set = (input, value) => {
        if (!input) throw new Error('Expected input missing');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(item('产品标题').querySelector('input[type="text"]'), expected.title);
      set(item('英文标题').querySelector('input[type="text"]'), expected.englishTitle);
      set(item('产品货号').querySelector('input[type="text"]'), expected.productCode);
      const skus = [...document.getElementsByName('variationSku')];
      if (skus.length !== 1) throw new Error('Expected exactly one SKU');
      set(skus[0], expected.sku);
    }, { draftId: run.newDraftId, sourceId: config.draftId, expected, store: config.expectedStore, site: config.expectedSite });
    assert.deepEqual(formValues(await page.evaluate(readPage, { ...config, draftId: run.newDraftId })), expected);
    await page.evaluate(({ draftId, sku }) => {
      if (new URL(location.href).searchParams.get('id') !== draftId || document.getElementsByName('variationSku')[0]?.value !== sku) throw new Error('Draft identity changed');
      const preview = document.querySelector('.sku-image img');
      if (!preview || preview.src.includes('/assets/addImg-')) throw new Error('SKU preview missing; do not save');
      const save = [...document.querySelectorAll('button')].filter(e => e.innerText.trim() === '保存').at(-1);
      if (!save || save.disabled) throw new Error('Save is unavailable');
      save.click();
    }, { draftId: run.newDraftId, sku: expected.sku });
    // No automatic save retry: an unknown outcome must be reconciled by reading the record.
    await poll(() => page.evaluate(() => document.body.innerText.includes('您的产品已保存到')
      || document.body.innerText.includes('您的产品编辑成功')
      || [...document.querySelectorAll('.ant-message')].some(e => e.innerText.includes('保存成功'))), { timeout: 20000 });
    console.log(JSON.stringify({ draftId: run.newDraftId, changed: true, saved: true, published: false,
      next: 'Run verify-test-draft.mjs to verify server persistence and source preservation.' }, null, 2));
  } finally { page.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
