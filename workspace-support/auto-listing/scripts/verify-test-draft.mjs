import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connection, pageById, config, poll } from './lib/bit-cdp.mjs';
import { readPage } from './inspect-draft.mjs';

const root = new URL('../', import.meta.url);
const output = new URL('outputs/copy-test/', root);
const runFile = new URL('run.json', output);
const run = JSON.parse(await readFile(runFile, 'utf8'));
const baseline = JSON.parse(await readFile(new URL('source-before.json', output), 'utf8'));
const sourceImages = JSON.parse(await readFile(new URL('source-images.json', output), 'utf8'));

const value = (page, label) => page.items.find(item => item.label === label)?.controls[0]?.value;
const selections = (page, label) => page.items.find(item => item.label === label)?.selections;

async function loadDraft(page, id, expectedTitle) {
  await page.send('Page.navigate', { url: `https://www.dianxiaomi.com/web/popTemu/edit?id=${id}` });
  await poll(() => page.evaluate(({ id, title }) => {
    if (new URL(location.href).searchParams.get('id') !== id) return false;
    const item = [...document.querySelectorAll('.ant-form-item')].find(e => e.querySelector('.ant-form-item-label')?.innerText === '产品标题');
    const category = [...document.querySelectorAll('.ant-form-item')].find(e => e.querySelector('.ant-form-item-label')?.innerText === '产品分类');
    const frame = [...document.querySelectorAll('.ant-form-item')].find(e => e.querySelector('.ant-form-item-label')?.innerText.trim() === '框架类型');
    return item?.querySelector('input')?.value === title
      && Boolean(category?.querySelector('.ant-select-selection-item'))
      && Boolean(frame?.querySelector('.ant-select-selection-item'))
      && document.getElementsByName('variationSku').length === 1
      && document.getElementsByName('stock').length === 1;
  }, { id, title: expectedTitle }), { timeout: 30000 });
  return page.evaluate(readPage, { ...config, draftId: id });
}

async function main() {
  assert.match(run.newDraftId ?? '', /^\d+$/);
  assert.notEqual(run.newDraftId, config.draftId);
  const info = await connection();
  const page = await pageById(info, run.verifyTargetId);
  try {
    // A separate task tab reloads server data. Neither the original tab nor its form is touched.
    await page.send('Page.navigate', { url: 'https://www.dianxiaomi.com/web/popTemu/pageList/offline' });
    const rows = await poll(() => page.evaluate(({ sourceId, newId, sku }) => {
      const rows = [...document.querySelectorAll('tr[rowid]')].map(e => ({ id: e.getAttribute('rowid'), text: e.innerText }));
      return rows.some(r => r.id === sourceId) && rows.some(r => r.id === newId && r.text.includes(sku)) ? rows : null;
    }, { sourceId: config.draftId, newId: run.newDraftId, sku: run.expected.sku }), { timeout: 30000 });
    assert.equal(rows.filter(row => row.text.includes(run.expected.sku)).length, 1, 'Test SKU must appear exactly once');
    await writeFile(new URL('pending-list-verified.json', output), JSON.stringify(rows, null, 2));

    const sourceAfter = await loadDraft(page, config.draftId, value(baseline, '产品标题'));
    const substantive = snapshot => ({ store: snapshot.store, site: snapshot.site,
      items: snapshot.items.map(({ label, controls, selections, checked }) => ({ label, controls, selections, checked })),
      variantFields: snapshot.variantFields });
    assert.deepEqual(substantive(sourceAfter), substantive(baseline), 'Original draft fields changed');
    await writeFile(new URL('source-after.json', output), JSON.stringify(sourceAfter, null, 2));

    const saved = await loadDraft(page, run.newDraftId, run.expected.title);
    assert.equal(value(saved, '产品标题'), run.expected.title);
    assert.equal(value(saved, '英文标题'), run.expected.englishTitle);
    assert.equal(value(saved, '产品货号'), run.expected.productCode);
    assert.deepEqual(saved.variantFields.variationSku, [run.expected.sku]);
    for (const [name, values] of Object.entries(baseline.variantFields)) {
      if (name !== 'variationSku') assert.deepEqual(saved.variantFields[name], values, name);
    }
    assert.deepEqual(saved.store, [config.expectedStore]);
    assert.deepEqual(saved.site, [config.expectedSite]);
    assert.deepEqual(selections(saved, '产品分类'), selections(baseline, '产品分类'));

    const media = await page.evaluate(() => {
      const gallery = [...document.querySelectorAll('.ant-form-item')].find(e => e.querySelector('.ant-form-item-label')?.innerText === '产品轮播图');
      const images = [...gallery.querySelectorAll('img')].filter(e => !e.src.startsWith('data:') && !e.src.includes('/assets/'));
      const skuImage = document.querySelector('.sku-image img');
      const internalCategory = document.querySelector('.categories-select .select-module')?.innerText.trim();
      return { images: images.map(e => e.src), skuImage: skuImage?.src, internalCategory };
    });
    assert.deepEqual(media.images, sourceImages.map(image => image.src));
    assert.equal(media.skuImage, sourceImages[0].src);
    assert.equal(media.internalCategory, '帆布画');
    await writeFile(new URL('saved-draft-readback.json', output), JSON.stringify(saved, null, 2));

    const result = {
      verifiedAt: new Date().toISOString(), sourceDraftId: config.draftId, newDraftId: run.newDraftId,
      newDraftUrl: run.newDraftUrl, store: config.expectedStore, site: config.expectedSite,
      title: run.expected.title, englishTitle: run.expected.englishTitle, productCode: run.expected.productCode,
      sku: run.expected.sku, status: '待发布', sourceFieldsUnchanged: true, testSkuOccurrencesOnPendingPage: 1,
      productImageCount: media.images.length, skuPreviewMatchesFirstSourceImage: true,
      titleAndSkuPersistedAfterNavigation: true, published: false,
      limitations: ['运费模板为空', '继承母稿的测试尺寸、重量、价格及狮子风格', '未验证平台发布条件'],
    };
    await writeFile(new URL('verification.json', output), JSON.stringify(result, null, 2) + '\n');
    run.stage = 'verified'; run.verifiedAt = result.verifiedAt;
    await writeFile(runFile, JSON.stringify(run, null, 2));
    // Show the checked information; screenshots are optional and do not determine data correctness.
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('.ant-form-item')].find(e => e.querySelector('.ant-form-item-label')?.innerText === '产品标题');
      item.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    if (process.argv.includes('--screenshot')) {
      try {
        const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(new URL('verified-draft.png', output), Buffer.from(screenshot.data, 'base64'));
      } catch { console.warn('截图未完成；表单读回与原稿对比已通过。'); }
    }
    console.log(JSON.stringify({ ...result, report: fileURLToPath(new URL('verification.json', output)) }, null, 2));
  } finally { page.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
