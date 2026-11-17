import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {runDraft} from '../../scripts/lib/temu-runner.mjs';
import {createDraftSession} from '../../scripts/lib/draft-session.mjs';

// Entire ERP, file upload receipt and persistence are fixtures. No live account or network.
test('real runner saves and verifies three fixture products using two tabs and no editor verification detours',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'erp-runner-stability-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const bytes=await sharp({create:{width:800,height:800,channels:3,background:'#abc'}}).png().toBuffer();
  const imageFile=path.join(directory,'image.png');fs.writeFileSync(imageFile,bytes);
  const saved=new Map(),saves=[],navigations=[],created=[];
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const context=await browser.newContext();
  const imageHost='https://wxalbum-10001658-file.dianxiaomi.com/',motherId='12345678';
  const mother={title:'Mother',englishTitle:'Mother English',code:'MOTHER',sku:'MOTHER-SKU',main:[imageHost+'source.png'],details:[]};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{assert.ok(String(url).startsWith(imageHost),'unexpected network: '+url);return new Response(bytes);};
  t.after(()=>{globalThis.fetch=originalFetch;});
  await context.exposeBinding('fixtureSave',({page},data)=>{
    assert.ok(page.url().includes('/quoteEdit?id='+motherId),'must not save a mother or an existing draft');
    const id=String(87654320+saved.size);assert.ok(!saves.includes(data.sku),'duplicate save');saved.set(id,data);saves.push(data.sku);return id;
  });
  const field=(label,content)=>`<div class="ant-form-item"><label class="ant-form-item-label">${label}</label>${content}</div>`;
  const selection=value=>`<span class="ant-select-selection-item">${value}</span>`;
  const img=url=>`<img src="${url}">`;
  const form=(data,quoted)=>`<meta charset="utf-8"><style>
    body{font:14px sans-serif;margin:12px}input{width:180px}button{min-width:90px;height:30px}img{width:35px;height:35px}#wirelessDescBox{width:500px;min-height:100px;background:#eee}.mainImage{width:600px}.mainImage .img-list{display:flex}.upload-trigger,.menu-button,.batch-trigger{position:relative;display:inline-block;min-width:130px;min-height:30px;background:#ddd}
    .popup{display:none;position:absolute;left:0;top:25px;min-width:150px;background:#eee;z-index:50;padding:6px}.upload-trigger:hover>.popup,.menu-button:hover>.popup,.batch-trigger:hover>.popup{display:block}
    .ant-modal{position:fixed;top:130px;left:40px;width:800px;min-height:240px;padding:15px;background:white;border:1px solid #999;z-index:10}.picker{top:330px;z-index:30}.batch-smt-image-content{margin-top:80px;background:#ccc;padding:15px}.smt-content-center{width:700px;min-height:150px}.img-item .label{display:inline-block;width:60px;height:45px}.selected-box{min-height:45px}
    </style><div class="btn-user"><span class="user-name">fixture</span></div>
    ${field('店铺账号',selection('店铺1'))}${field('经营站点',selection('加拿大站'))}${field('产品分类',selection('太阳镜'))}${field('承诺发货时效',selection('2天'))}${field('运费模板',selection('加拿大'))}
    ${field('产品标题',`<input id="title" value="${data.title}">`)}${field('英文标题',`<input id="englishTitle" value="${data.englishTitle}">`)}${field('产品货号',`<input id="code" value="${data.code}">`)}
    <div><span>${selection('风格')}</span><div><div class="theme-value-add"></div><span class="theme-value-text">A</span></div></div><div><span>${selection('颜色')}</span><div><div class="theme-value-add"></div></div></div>
    <div class="in-selector ant-select-multiple ant-select-allow-clear">${selection('加拿大仓')}</div>
    ${['variationSku','price','skuLength','skuWidth','skuHeight','weight','stock','identifierCode'].map(n=>`<input name="${n}" value="${n==='variationSku'?data.sku:n==='stock'&&quoted?'':'10'}">`).join('')}
    <div class="sku-image">${img(imageHost+'source.png')}</div>
    <div class="mainImage"><div class="upload-trigger"><button>选择图片</button><div class="popup" role="menuitem" onclick="chooseFile()">本地图片</div></div><div class="img-list">${data.main.map(u=>`<div>${img(u)}<a class="icon_delete" onclick="this.parentElement.remove()">删除</a></div>`).join('')}</div></div>
    <div id="wirelessDescBox"><div id="baiduStatisticsSmtNewEditorEditClickNum"><button onclick="openEditor()">编辑描述</button></div><div id="wirelessDescContentBox">${data.details.map(img).join('')}</div></div>
    <button onclick="saveProduct()">保存</button>
    <script>
    const imageHost=${JSON.stringify(imageHost)};
    const urls=selector=>Array.from(document.querySelectorAll(selector),e=>e.src);
    const images=list=>list.map(u=>'<img src="'+u+'">').join('');
    function chooseFile(){const input=document.createElement('input');input.type='file';input.id='localFileUploadInp';document.body.appendChild(input);input.onchange=()=>setTimeout(()=>{document.querySelector('.mainImage .img-list').innerHTML=images([imageHost+document.querySelector('#code').value+'.png']);input.remove()},200);}
    function openEditor(){const modal=document.createElement('div');modal.className='ant-modal editor';modal.innerHTML='<div class="smt-content-center"><div class="menu-button">批量操作<div class="popup custom-batch-btn"><li onclick="openBatch()">批量传图</li></div></div><div class="desc-img-box"></div></div><button onclick="saveDescription()">保存</button>';document.body.appendChild(modal);}
    function openBatch(){const box=document.createElement('div');box.className='batch-smt-image-content';box.innerHTML='<div class="batch-trigger"><button>选择图片</button><div class="popup" role="menuitem" onclick="openPicker()">引用产品轮播图</div></div><div class="img-list"></div>';document.querySelector('.editor').appendChild(box);document.querySelector('.editor').insertAdjacentHTML('beforeend','<button id="confirm-batch" onclick="confirmBatch()">确定</button>');}
    function openPicker(){const modal=document.createElement('div');modal.className='ant-modal picker';modal.innerHTML='引用产品图片'+urls('.mainImage .img-list img').map(u=>'<div class="img-item"><label class="label" onclick="selectImage(this)">'+images([u])+'</label></div>').join('')+'<div class="selected-box"></div><button onclick="confirmPicker()">选择</button>';document.body.appendChild(modal);}
    function selectImage(label){const u=label.querySelector('img').src;setTimeout(()=>document.querySelector('.selected-box').insertAdjacentHTML('beforeend',images([u])),100);}
    function confirmPicker(){document.querySelector('.batch-smt-image-content .img-list').innerHTML=images(urls('.selected-box img'));document.querySelector('.picker').remove();}
    function confirmBatch(){document.querySelector('.desc-img-box').innerHTML=images(urls('.batch-smt-image-content .img-list img'));document.querySelector('.batch-smt-image-content').remove();document.querySelector('#confirm-batch').remove();}
    function saveDescription(){document.querySelector('#wirelessDescContentBox').innerHTML=images(urls('.desc-img-box img'));document.querySelector('.editor').remove();}
    async function saveProduct(){const data={title:document.querySelector('#title').value,englishTitle:document.querySelector('#englishTitle').value,code:document.querySelector('#code').value,sku:document.querySelector('[name=variationSku]').value,main:urls('.mainImage .img-list img'),details:urls('#wirelessDescContentBox img')};const id=await window.fixtureSave(data);const modal=document.createElement('div');modal.className='ant-modal';modal.innerHTML='您的产品已保存到「待发布」<button>继续编辑</button>';modal.querySelector('button').onclick=()=>location.href='/web/popTemu/edit?id='+id;document.body.appendChild(modal);}
    </script>`;
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());assert.equal(route.request().method(),'GET');
    if(u.origin===new URL(imageHost).origin)return route.fulfill({contentType:'image/png',body:bytes});
    assert.equal(u.hostname,'www.dianxiaomi.com');
    navigations.push({page:route.request().frame().page(),path:u.pathname,id:u.searchParams.get('id')});
    if(u.pathname.endsWith('/offline'))return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8">共 ${saved.size} 条记录<table>${[...saved].map(([id,d])=>`<tr rowid="${id}"><td>${d.sku}</td></tr>`).join('')}</table>`});
    const id=u.searchParams.get('id');assert.ok(id===motherId||saved.has(id));
    return route.fulfill({contentType:'text/html; charset=utf-8',body:form(saved.get(id)||mother,u.pathname.endsWith('quoteEdit'))});
  });
  const targets=new Map();let sequence=0;
  const transport={connection:async()=>({ws:'fixture',targets:async()=>[...targets.keys()].map(id=>({id,type:'page'}))}),connect:async()=>({send:async(method,params)=>{
    if(method==='Target.createTarget'){const targetId=String(++sequence),page=await context.newPage(),cdp=await context.newCDPSession(page);targets.set(targetId,{page,cdp});created.push({...params,targetId,page});return {targetId};}
    if(method==='Target.closeTarget'){await targets.get(params.targetId).page.close();targets.delete(params.targetId);return {success:true};}
    throw new Error(method);
  },close(){}}),pageById:async(_info,id)=>({send:(...args)=>targets.get(id).cdp.send(...args),evaluate:(...args)=>targets.get(id).page.evaluate(...args),close(){}})};
  const draftSession=await createDraftSession({},transport);t.after(()=>draftSession.close());
  const store={draftId:motherId,expectedStore:'店铺1',expectedSite:'加拿大站'};
  for(let i=1;i<=3;i++){
    const row={productCode:'ITEM'+i,sku:'ITEM'+i+'-SKU',title:'Product '+i,englishTitle:'English '+i,images:[{file:imageFile,name:'image.png',sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]};
    const result=await runDraft({store,row,browserKey:'fixture',browserConfig:{key:'fixture'},draftSession,evidenceDirectory:path.join(directory,'runs','batch',row.productCode),onProgress:(_phase,detail)=>Object.assign(row,detail)});
    assert.equal(result.sourceUnchanged,true);assert.equal(result.published,false);assert.equal(result.checks.uniquePendingSku,true);
  }
  assert.deepEqual(saves,['ITEM1-SKU','ITEM2-SKU','ITEM3-SKU']);assert.equal(created.length,2);
  const editor=created.find(c=>!c.background).page;
  assert.ok(navigations.filter(n=>n.page===editor).every(n=>n.path.endsWith('quoteEdit')||n.path.endsWith('edit')&&n.id!==motherId),'editor must not navigate to mother/list for verification');
  await draftSession.close();assert.equal(targets.size,0);
});
