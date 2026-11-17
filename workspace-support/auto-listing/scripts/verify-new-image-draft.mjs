import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connection, pageById, config, poll } from './lib/bit-cdp.mjs';
import { readPage } from './inspect-draft.mjs';

const output = new URL('../outputs/new-images-test/', import.meta.url);
const run = JSON.parse(await readFile(new URL('run.json', output), 'utf8'));
const baselines = JSON.parse(await readFile(new URL('baselines.json', output), 'utf8'));
const expectedMedia = JSON.parse(await readFile(new URL('media-before-save.json', output), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('images/manifest.json', output), 'utf8'));
const rules = JSON.parse(await readFile(new URL('../config/image-rules.json', import.meta.url), 'utf8'));
const correction = JSON.parse(await readFile(new URL('image-correction-plan.json', output), 'utf8'));
const correctionBefore = JSON.parse(await readFile(new URL('image-correction-before.json', output), 'utf8'));
const value = (page, label) => page.items.find(item => item.label === label)?.controls[0]?.value;
const substantive = page => ({ store: page.store, site: page.site, items: page.items.map(({ label, controls, selections, checked }) => ({ label, controls, selections, checked })), variantFields: page.variantFields });

async function loadDraft(page, id, title) {
  await page.send('Page.navigate', { url: `https://www.dianxiaomi.com/web/popTemu/edit?id=${id}` });
  await poll(() => page.evaluate(({ id, title }) => {
    const item = label => [...document.querySelectorAll('.ant-form-item')].find(el => el.querySelector('.ant-form-item-label')?.innerText.trim() === label);
    return new URL(location.href).searchParams.get('id') === id
      && item('产品标题')?.querySelector('input')?.value === title
      && Boolean(item('框架类型')?.querySelector('.ant-select-selection-item'))
      && Boolean(item('产品分类')?.querySelector('.ant-select-selection-item'))
      && document.getElementsByName('variationSku').length === 1
      && document.getElementsByName('stock').length === 1;
  }, { id, title }), { timeout: 30000 });
  return page.evaluate(readPage, { ...config, draftId: id });
}

async function main() {
  assert.match(run.newDraftId ?? '', /^\d+$/);
  assert(!baselines.some(page => page.draftId === run.newDraftId));
  assert.equal(rules.skuPreview, 'preserve-source');
  assert.equal(rules.detailImages, 'same-as-main-images-in-order');
  assert.equal(correction.targetId, run.newDraftId);
  assert.equal(correction.sourceId, rules.sourceDraftId);
  const page = await pageById(await connection(), run.targetId);
  try {
    await page.send('Page.navigate', { url: 'https://www.dianxiaomi.com/web/popTemu/pageList/offline' });
    const rows = await poll(() => page.evaluate(({ id, sku }) => {
      const rows = [...document.querySelectorAll('tr[rowid]')].map(row => ({ id: row.getAttribute('rowid'), text: row.innerText }));
      return rows.some(row => row.id === id && row.text.includes(sku)) ? rows : null;
    }, { id: run.newDraftId, sku: run.expected.sku }), { timeout: 30000 });
    assert.equal(rows.filter(row => row.text.includes(run.expected.sku)).length, 1);
    await writeFile(new URL('pending-list.json', output), JSON.stringify(rows, null, 2));

    const preservation = [];
    for (const before of baselines) {
      const after = await loadDraft(page, before.draftId, value(before, '产品标题'));
      assert.deepEqual(substantive(after), substantive(before), `Existing draft ${before.draftId} changed`);
      if (before.draftId === rules.sourceDraftId) {
        assert.deepEqual(after.media.skuPreviewImages, correction.expected.sku, 'Source SKU image changed');
        assert.deepEqual(after.media.mainImages, correctionBefore[0].media.gallery, 'Source main images changed');
        assert.equal(after.media.detailImages.length, 0, 'Original empty description changed');
      }
      preservation.push({ draftId: before.draftId, unchanged: true });
    }

    const saved = await loadDraft(page, run.newDraftId, run.expected.title);
    assert.deepEqual(substantive(saved), substantive(correctionBefore[1].form), 'Correction changed non-image fields');
    assert.equal(value(saved, '产品标题'), run.expected.title);
    assert.equal(value(saved, '英文标题'), run.expected.englishTitle);
    assert.equal(value(saved, '产品货号'), run.expected.productCode);
    assert.deepEqual(saved.variantFields.variationSku, [run.expected.sku]);
    for (const [name, values] of Object.entries(baselines[0].variantFields)) {
      if (name !== 'variationSku') assert.deepEqual(saved.variantFields[name], values, name);
    }
    const media = await page.evaluate(() => {
      const gallery = [...document.querySelectorAll('.ant-form-item')].find(el => el.querySelector('.ant-form-item-label')?.innerText.trim() === '产品轮播图');
      return { gallery: [...gallery.querySelectorAll('img')].filter(img => !img.src.includes('/assets/') && !img.src.startsWith('data:')).map(img => img.src),
        preview: document.querySelector('.sku-image img')?.src,
        detail: [...document.querySelectorAll('#wirelessDescContentBox img')].map(img => img.src),
        styles: [...document.querySelectorAll('.theme-value-add')].map(el => el.parentElement.parentElement.innerText),
        internalCategory: document.querySelector('.categories-select .select-module')?.innerText.trim() };
    });
    assert.deepEqual(media.gallery, expectedMedia.gallery);
    assert.equal(media.gallery.length, 3);
    assert.deepEqual([media.preview], correction.expected.sku, 'SKU preview must preserve the source image');
    assert.deepEqual(media.detail, media.gallery, 'Detail images must match main images in order');
    assert(media.styles[0].includes(run.expected.style));
    assert(!media.styles.some(text => text.includes('狮子')));
    assert.equal(media.internalCategory, '帆布画');
    await writeFile(new URL('saved-draft-readback.json', output), JSON.stringify(saved, null, 2));

    // Compare actual ERP-hosted files to our converted inputs; do not forward credentials or cookies.
    await mkdir(new URL('downloaded/', output), { recursive: true });
    const matches = [];
    for (let i = 0; i < media.gallery.length; i++) {
      const url = new URL(media.gallery[i]);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'wxalbum-10001658-file.dianxiaomi.com');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      assert(response.ok, `Image HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      assert(buffer.length < 5 * 1024 * 1024, 'Unexpected image size');
      const hash = createHash('sha256').update(buffer).digest('hex');
      const local = manifest.find(item => item.jpegSha256 === hash);
      await writeFile(new URL(`downloaded/${String(i + 1).padStart(2, '0')}.jpg`, output), buffer);
      assert(local && run.sourceIndexes.includes(local.index), 'Uploaded bytes do not match a selected source JPEG');
      matches.push({ position: i + 1, sourceIndex: local.index, sha256: hash, bytes: buffer.length });
    }
    assert.deepEqual(matches.map(item => item.sourceIndex), run.sourceIndexes);
    const result = { verifiedAt: new Date().toISOString(), draftId: run.newDraftId, url: run.newDraftUrl,
      store: config.expectedStore, site: config.expectedSite, status: '待发布', published: false,
      title: run.expected.title, englishTitle: run.expected.englishTitle, sku: run.expected.sku, style: run.expected.style,
      newSkuCount: 1, imageCount: media.gallery.length, skuPreviewPreservedFromSource: true,
      detailImageCount: media.detail.length, detailImagesMatchMainImagesInOrder: true, nonImageFieldsUnchangedByCorrection: true,
      uploadedFilesMatchLocalJpegsByteForByte: true, imageMatches: matches, existingDrafts: preservation,
      excludedSourceIndexes: run.excludedIndexes, excludedReason: run.excludedReason,
      limitations: ['运费模板为空', '价格、重量、包装尺寸沿用测试数据', '本次仅验证草稿写入，未验证发布条件'] };
    await writeFile(new URL('verification.json', output), JSON.stringify(result, null, 2));
    run.stage = 'verified'; run.verifiedAt = result.verifiedAt;
    run.imagePolicy = rules;
    await writeFile(new URL('run.json', output), JSON.stringify(run, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { page.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
