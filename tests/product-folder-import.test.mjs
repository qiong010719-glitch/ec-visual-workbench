import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import {merchantFixture} from './merchant-fixture.mjs';

const payload=(imported,requestId)=>({requestId,platform:'temu',storeKey:'merchant-ca',label:'目录兼容验证',sourceFolder:imported.sourceFolder,outputParent:imported.outputParent,products:imported.products,imageCount:1,ratio:'1:1',mode:'fast'});
function workbook(file,rows){
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['货号','标题','商品资料'],...rows]));
  fs.writeFileSync(file,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
}

test('single AVIF product and its parent both import while excluding the selected result folder',async t=>{
  const f=await merchantFixture({titlePlanner:async g=>g.sets.map((s,i)=>({setId:s.id,title:'Canvas Wall Art Design '+(i+1),englishTitle:'Canvas Wall Art Design '+(i+1)}))});t.after(f.close);
  const root=path.join(f.dir,'油画'),product=path.join(root,'产品'),output=path.join(root,'裂变');
  fs.mkdirSync(product,{recursive:true});fs.mkdirSync(output);
  const avif=await sharp({create:{width:40,height:30,channels:3,background:'#f0b070'}}).avif().toBuffer();
  for(let i=1;i<=3;i++)fs.writeFileSync(path.join(product,i+'.avif'),avif);
  fs.writeFileSync(path.join(product,'商品资料.txt'),'无框帆布画，一幅。');
  for(const folder of [product,root]){
    const imported=await f.api('/api/products/import-folder',{folder,outputParent:output});
    assert.equal(imported.products.length,1);assert.equal(imported.products[0].name,'产品');
    assert.equal(imported.products[0].images.length,3);assert.equal(imported.outputParent,output);
    if(folder===root)assert.deepEqual(imported.ignoredFolders,[{name:'裂变',reason:'生成结果目录'}]);
    for(const im of imported.products[0].images){
      const r=await fetch(f.base+im.url);assert.equal(r.status,200);
      assert.equal((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).format,'png');
    }
  }
  const imported=await f.api('/api/products/import-folder',{folder:root,outputParent:output});
  let b=await f.api('/api/products',payload(imported,'custom-output-test'));
  const route='/api/products/'+b.id;
  await f.api(route+'/plan',{});b=await f.wait(route,b=>b.phase!=='planning');assert.equal(b.phase,'ready',JSON.stringify(b.products.map(p=>p.error)));
  await f.api(route+'/generate',{});b=await f.wait(route,b=>b.phase!=='generating');assert.equal(b.phase,'completed');
  assert.ok(b.resultPackage.folder.startsWith(output+path.sep));
  assert.ok(fs.existsSync(path.join(output,'.workbench-output-root')));
  const reread=await f.api('/api/products/import-folder',{folder:root});
  assert.equal(reread.products.length,1);assert.equal(reread.products[0].images.length,3);
  for(let i=1;i<=3;i++)assert.deepEqual(fs.readFileSync(path.join(product,i+'.avif')),avif);
  assert.deepEqual(f.writes,[],'import and image preparation must not publish or create ERP drafts');
});

test('empty unrelated folders are reported and do not count toward the product limit',async t=>{
  const f=await merchantFixture();t.after(f.close);
  for(let i=0;i<21;i++)fs.mkdirSync(path.join(f.input,'空目录'+i));
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  assert.equal(imported.products.length,2);assert.equal(imported.ignoredFolders.length,21);
  const output=path.join(f.input,'旧结果');fs.mkdirSync(output);
  fs.copyFileSync(path.join(f.input,'CANVAS-A','01.png'),path.join(output,'01.png'));
  fs.writeFileSync(path.join(output,'.workbench-output-root'),'workbench-generated-output');
  assert.equal((await f.api('/api/products/import-folder',{folder:f.input})).products.length,2);
});

test('missing and excessive reference images remain actionable errors, including workbook-selected products',async t=>{
  const f=await merchantFixture();t.after(f.close);
  const empty=path.join(f.dir,'空素材');fs.mkdirSync(empty);
  await assert.rejects(f.api('/api/products/import-folder',{folder:empty}),/未找到产品原图/);
  await assert.rejects(f.api('/api/products/import-folder',{folder:path.join(f.dir,'不存在')}),/素材文件夹不存在/);
  const product=path.join(f.input,'CANVAS-A');
  for(let i=2;i<=9;i++)fs.copyFileSync(path.join(product,'01.png'),path.join(product,i+'.png'));
  await assert.rejects(f.api('/api/products/import-folder',{folder:product}),/找到 9 张原图/);
  await assert.rejects(f.api('/api/products/import-folder',{folder:f.input}),/CANVAS-A.*9 张/);
  const missing=path.join(empty,'MISSING');fs.mkdirSync(missing);
  workbook(path.join(empty,'商品.xlsx'),[['MISSING','缺图商品','无框画']]);
  await assert.rejects(f.api('/api/products/import-folder',{folder:empty}),/MISSING.*0 张/);
  const mixed=path.join(f.input,'CANVAS-B');
  fs.copyFileSync(path.join(mixed,'01.png'),path.join(f.input,'loose.png'));
  await assert.rejects(f.api('/api/products/import-folder',{folder:f.input}),/当前文件夹和产品子文件夹中都有原图/);
});

test('single-product workbook metadata is retained and output cannot target source images',async t=>{
  const f=await merchantFixture();t.after(f.close);
  const product=path.join(f.input,'CANVAS-A');
  workbook(path.join(product,'商品.xlsx'),[['CUSTOM-001','画作标题','真实资料']]);
  const imported=await f.api('/api/products/import-folder',{folder:product});
  assert.equal(imported.products[0].productCode,'CUSTOM-001');assert.equal(imported.products[0].name,'画作标题');assert.equal(imported.products[0].description,'真实资料');
  await assert.rejects(f.api('/api/products/import-folder',{folder:product,outputParent:product}),/不能与素材文件夹相同/);
  await assert.rejects(f.api('/api/products/import-folder',{folder:f.input,outputParent:product}),/位于产品原图文件夹内/);
  const batchInput=await f.api('/api/products/import-folder',{folder:f.input});
  await assert.rejects(f.api('/api/products',{...payload(batchInput,'bad-output-test'),outputParent:path.join(product,'裂变')}),/位于产品原图文件夹内/);
  const saved=await f.api('/api/products',{...payload(batchInput,'good-output-test'),outputParent:path.join(f.input,'新裂变')});
  assert.equal(saved.phase,'draft');assert.equal(saved.outputParent,path.join(f.input,'新裂变'));
});
