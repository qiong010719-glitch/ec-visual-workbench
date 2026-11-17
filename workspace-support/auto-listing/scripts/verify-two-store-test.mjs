import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connection, connect, pageById, poll, root } from './lib/bit-cdp.mjs';
import { readPage } from './inspect-draft.mjs';

const load = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const stores = (await load('config/temu-stores.json')).stores;
const job = await load('config/two-store-snow-test.json');
const run = await load('outputs/two-store-test/run.json');
const before = await load('outputs/two-store-test/source-inspection.json');
const prepared = await load('outputs/two-store-test/store2-before-save.json');
const store = stores.find(s => s.key === job.storeKey);
const controlStore = stores.find(s => s.key === job.controlDraft.storeKey);
const stable = s => ({ store: s.store, site: s.site, items: s.items, variantFields: s.variantFields,
  media: s.media, warehouseContext: s.warehouseContext.map(text => text.replaceAll('内计共含', '共计内含')) });

async function main() {
  assert.match(run.newDraftId ?? '', /^\d+$/);
  assert.ok(!stores.some(s => s.draftId === run.newDraftId), 'Test ID must not be a mother draft');
  assert.equal(run.jobId, job.jobId);
  const info = await connection();
  const browser = await connect(info.ws);
  let page;
  try {
    // Always own the inspection tab. Never navigate a user tab or reuse a stale tab ID.
    const target = await browser.send('Target.createTarget', { url: 'about:blank' });
    page = await pageById(info, target.targetId);
    async function readDraft(s, draftId) {
      await page.send('Page.navigate', { url: `https://www.dianxiaomi.com/web/popTemu/edit?id=${draftId}` });
      await poll(() => page.evaluate(id => location.pathname === '/web/popTemu/edit'
        && new URL(location.href).searchParams.get('id') === id
        && document.getElementsByName('variationSku').length === 1
        && document.querySelectorAll('.mainImage .img-list img').length >= 3
        && [...document.querySelectorAll('.ant-form-item')].some(el =>
          el.querySelector('.ant-form-item-label')?.innerText.trim() === '框架类型'
          && el.querySelector('.ant-select-selection-item'))
        && document.querySelectorAll('input[name="stock"]').length === 1, draftId), { timeout: 30000 });
      return page.evaluate(readPage, { ...s, draftId });
    }
    const originals = [];
    for (const s of stores) {
      const actual = await readDraft(s, s.draftId);
      const baseline = before.captures.find(c => c.form.draftId === s.draftId)?.form;
      assert.ok(baseline, `Missing baseline for ${s.key}`);
      assert.deepEqual(stable(actual), stable(baseline), `Mother changed: ${s.key}`);
      originals.push(actual);
    }
    const control = await readDraft(controlStore, job.controlDraft.draftId);
    const actual = await readDraft(store, run.newDraftId);
    assert.deepEqual(stable(actual), stable(prepared), 'Persisted fields differ from prepared fields');
    for (const [s, draft] of [[controlStore, control], [store, actual]]) {
      const mother = originals.find(x => x.draftId === s.draftId);
      assert.deepEqual(draft.media.mainImages, job.mainImages, `Main images: ${s.key}`);
      assert.deepEqual(draft.media.detailImages, job.mainImages, `Detail images/order: ${s.key}`);
      assert.deepEqual(draft.media.skuPreviewImages, mother.media.skuPreviewImages, `SKU preview: ${s.key}`);
    }
    assert.deepEqual(actual.variantFields.variationSku, [job.sku]);
    await page.send('Page.navigate', { url: 'https://www.dianxiaomi.com/web/popTemu/pageList/offline' });
    await poll(() => page.evaluate(id => document.querySelector(`tr[rowid="${id}"]`), run.newDraftId).then(Boolean));
    const list = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('tr[rowid]')].map(el => ({ id: el.getAttribute('rowid'), text: el.innerText })),
      total: Number(document.body.innerText.match(/共\s*(\d+)\s*条记录/)?.[1] ?? NaN),
    }));
    assert.equal(list.rows.length, list.total, 'Paginated list requires a complete scan before asserting uniqueness');
    for (const draft of [control, actual]) {
      assert.equal(list.rows.filter(r => r.id === draft.draftId).length, 1);
      const sku = draft.variantFields.variationSku[0];
      assert.equal(list.rows.filter(r => r.text.split(/\s+/).includes(sku)).length, 1, `Duplicate SKU ${sku}`);
    }
    const report = {
      verifiedAt: new Date().toISOString(), jobId: job.jobId, sourceUnchanged: true, published: false,
      checks: { storeAndSite: true, mainImages: true, detailImagesMatchMainInOrder: true,
        skuImagesMatchEachStoreMother: true, serverPersistence: true, uniquePendingSku: true },
      drafts: [control, actual].map(s => ({ draftId: s.draftId, url: s.url, store: s.store[0], site: s.site[0],
        sku: s.variantFields.variationSku[0], mainImageCount: s.media.mainImages.length,
        shippingTemplate: s.items.find(i => i.label === '运费模板')?.selections,
        stock: s.variantFields.stock, state: '待发布' })),
      limitations: ['店铺1测试稿运费模板为空', '店铺2测试稿库存为空',
        '尺寸、重量、价格及分类属性沿用母稿测试值；本次没有验证 Temu 平台发布'],
      originals, control, actual, pendingList: list,
    };
    await writeFile(new URL('outputs/two-store-test/verification.json', root), JSON.stringify(report, null, 2) + '\n');
    run.stage = 'verified'; run.verifiedAt = report.verifiedAt;
    await writeFile(new URL('outputs/two-store-test/run.json', root), JSON.stringify(run, null, 2) + '\n');
    // Leave a useful result open in this inspection tab; all original tabs are untouched.
    await page.send('Page.navigate', { url: actual.url });
    console.log(JSON.stringify({ success: true, drafts: report.drafts, checks: report.checks,
      sourceUnchanged: true, published: false, limitations: report.limitations }, null, 2));
  } finally { page?.close(); browser.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
