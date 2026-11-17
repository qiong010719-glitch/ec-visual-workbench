import test from 'node:test';
import assert from 'node:assert/strict';
import {mainImageLimits,validateMainImageCount,motherSkuPreviewPolicy,validateMotherSkuPreview,readSkuPreviewImage} from '../../scripts/lib/erp-image-rules.mjs';
import {chromium} from 'playwright';
import sharp from 'sharp';

test('uses the live category image limits and rejects too few images before saving',()=>{
  const text='「产品轮播图最多选用10张，最少选用3张 已经选用了2张」';
  assert.deepEqual(mainImageLimits(text),{minimum:3,maximum:10});
  assert.throws(()=>validateMainImageCount(2,text),/至少需要 3 张.*尚未点击保存/);
  assert.doesNotThrow(()=>validateMainImageCount(3,text));
  assert.throws(()=>validateMainImageCount(11,text),/最多允许 10 张/);
});

test('does not assume a minimum from unrelated image dimensions or another category',()=>{
  assert.deepEqual(mainImageLimits('不少于800*800，大小2M以内'),{minimum:null,maximum:null});
  assert.doesNotThrow(()=>validateMainImageCount(1,'最多选用 8 张，最少选用 1 张'));
});

test('poster SKU checks reject portrait, undersized and oversized originals without applying the rule to apparel',()=>{
  const policy=motherSkuPreviewPolicy({items:[{label:'产品分类',selections:['海报和印刷品']}]});
  assert.ok(policy);for(const category of ['服装','女装','未知类目','海报和印刷品配件'])assert.equal(motherSkuPreviewPolicy({items:[{label:'产品分类',selections:[category]}]}),null);
  assert.throws(()=>validateMotherSkuPreview({width:1280,height:1949,bytes:287454},policy),/1280×1949.*方图/);
  assert.throws(()=>validateMotherSkuPreview({width:799,height:799,bytes:1000},policy),/至少 800/);
  assert.throws(()=>validateMotherSkuPreview({width:900,height:900,bytes:2*1024*1024+1},policy),/超过 2 MB/);
  assert.doesNotThrow(()=>validateMotherSkuPreview({width:800,height:800,bytes:2*1024*1024},policy));
});

test('SKU inspection decodes original bytes, bounds downloads and fails clearly on unavailable images',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();await page.route('https://www.dianxiaomi.com/**',r=>r.fulfill({contentType:'text/html',body:'<p>read-only fixture</p>'}));
  const url='https://wxalbum-10001658-file.dianxiaomi.com/source.jpg',maximumBytes=2*1024*1024;
  let bytes=await sharp({create:{width:1280,height:1949,channels:3,background:'#eee'}}).jpeg().toBuffer(),mode='ok';const requests=[];
  await page.route(url,async route=>{requests.push(route.request());if(mode==='abort')return route.abort();if(mode==='timeout')return;return route.fulfill({status:mode==='missing'?404:200,headers:{'access-control-allow-origin':'*'},body:bytes});});
  await page.goto('https://www.dianxiaomi.com/web/popTemu/edit?id=123456789');
  const result=await page.evaluate(readSkuPreviewImage,{url,maximumBytes});assert.equal(result.width,1280);assert.equal(result.height,1949);assert.equal(result.bytes,bytes.length);
  bytes=Buffer.alloc(maximumBytes+1);assert.equal((await page.evaluate(readSkuPreviewImage,{url,maximumBytes})).tooLarge,true);
  for(mode of ['missing','abort','timeout'])await assert.rejects(page.evaluate(readSkuPreviewImage,{url,maximumBytes,timeoutMs:100}),/无法核验母稿 SKU 预览图/);
  const before=requests.length;for(const url of ['http://127.0.0.1/a','https://wxalbum-10001658-file.dianxiaomi.com.evil.example/a','https://user:password@img.kwcdn.com/a'])await assert.rejects(page.evaluate(readSkuPreviewImage,{url,maximumBytes}),/地址不受支持/);
  assert.equal(requests.length,before);assert.ok(requests.every(r=>r.method()==='GET'&&!r.headers().cookie));
});
