import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

// UI-only fixture: no model, real account, source folder or ERP is contacted.
const root=path.resolve('public'),pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII=','base64');
const media={url:'/media/fixture.png',filename:'frame.png'},writes=[],errors=[];
const state={revision:1,context:{revision:1,productId:'p1',platform:'amazon',storeKey:'',erpKey:''},platforms:[{id:'amazon'},{id:'temu'}],stores:[{key:'temu-ca',name:'加拿大店',expectedSite:'加拿大站',platform:'temu',erpKey:'erp1',executionSupported:true},{key:'amazon-us',name:'亚马逊美国店',expectedSite:'美国站',platform:'amazon',erpKey:'erp1',executionSupported:false}],products:[{id:'p1',name:'实木相框',description:'8 × 10 英寸，保留实木纹理',images:[media],versions:[{id:'v-a',platform:'amazon',status:'completed',images:[media,media],createdAt:'2026-11-19T02:00:00Z'},{id:'v-t',platform:'temu',status:'completed',images:[media],createdAt:'2026-11-19T03:00:00Z'}]}],tasks:[{id:'t1',title:'相框主图',type:'单品设计',platform:'amazon',status:'completed',productId:'p1',url:'/content?product=p1&platform=amazon',createdAt:'2026-11-19T02:00:00Z'},{id:'t2',title:'图片裂变',type:'图片裂变',platform:'temu',status:'running',url:'/listings?mode=images'},{id:'t3',title:'待核对批次',type:'店铺上架',platform:'temu',status:'attention',url:'/listings?mode=images'}]};
let nextId=1,conflictNext=false;
const shell=html=>html.replace('</head>','<link rel="stylesheet" href="/local/workspace-shell.css"><script src="/local/workspace-shell.js" defer></script></head>');
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    if(req.method==='POST') {
      assert.equal(req.headers['x-workbench-token'],'fixture-token');
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks),body=url.pathname==='/api/media/up'?null:JSON.parse(raw);
      writes.push({url:url.pathname,body});
      if(url.pathname==='/api/media/up')return send(200,{url:media.url});
      if(url.pathname==='/api/workspace/context'){
        if(conflictNext){conflictNext=false;state.context={...state.context,revision:state.context.revision+1,platform:'amazon',storeKey:'',erpKey:''};return send(409,{error:'工作台选择已更新'});}
        if(body.revision!==state.context.revision)return send(409,{error:'工作台选择已更新'});
        state.context={...state.context,...body,revision:state.context.revision+1};return send(200,state.context);
      }
      if(url.pathname==='/api/workspace/products'){const product={id:'created-'+nextId++,...body,versions:[]};state.products.push(product);return send(200,product);}
      if(url.pathname.startsWith('/api/workspace/products/')){const product=state.products.find(item=>item.id===decodeURIComponent(url.pathname.split('/').at(-1)));Object.assign(product,body);return send(200,product);}
      if(url.pathname==='/api/workspace/import-folder'){assert.equal(body.folder,'C:\\Fixture\\Products');const product={id:'imported-1',name:'导入商品',description:'从商品资料读取',images:[media],versions:[]};state.products.push(product);return send(200,{products:[product],sourceFolder:body.folder,ignoredFolders:[{name:'_工作台生成结果'}]});}
      return send(501,{error:'禁止未实现的执行请求'});
    }
    if(url.pathname==='/api/session')return send(200,{token:'fixture-token'});
    if(url.pathname==='/api/workspace')return send(200,state);
    if(url.pathname==='/media/fixture.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(pixel);}
    if(['/products','/content','/tasks'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html'});return res.end(shell(fs.readFileSync(path.join(root,'workspace.html'),'utf8')));}
    if(url.pathname==='/listings'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><title>上架中心测试接收</title><h1>已接收工作台成品</h1>');}
    if(url.pathname==='/design'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(shell('<!doctype html><html class="temu-theme"><head><link rel="stylesheet" href="/local/navigation.css"></head><body><header id="macTitlebar" class="workbench-header"></header><div class="purah-pad"><main class="main-content">设计业务区域</main></div></body></html>'));}
    const file=path.join(root,url.pathname);if(file.startsWith(root)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/css'});return res.end(fs.readFileSync(file));}
    res.writeHead(404);res.end();
  } catch(error){errors.push(error.message);send(500,{error:error.message});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1366,height:1000}}),page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
const idle=()=>page.waitForFunction(()=>!document.getElementById('contentPlatform')?.disabled);
try {
  await page.goto(base+'/content?product=p1&platform=amazon');
  await page.locator('#contentPage:not([hidden])').waitFor();
  assert.deepEqual(await page.locator('.workbench-nav a').allTextContents(),['商品库','选品与采集','内容制作','上架中心','任务记录','连接设置']);
  assert.equal(await page.inputValue('#contentPlatform'),'amazon');
  assert.deepEqual(await page.locator('#contentStore option').allTextContents(),['暂不关联店铺','亚马逊美国店 · 美国站']);
  assert.equal(await page.locator('[data-action="list-version"][data-platform="amazon"]').isEnabled(),true);
  assert.match(await page.getAttribute('#openBatchDesign','href'),/^\/design\?platform=amazon&view=multisets&product=p1$/);
  assert.equal(await page.locator('[data-action="list-version"][data-platform="temu"]').isEnabled(),false);
  await page.locator('[data-action="preview-version"][data-platform="amazon"]').click();
  assert.equal(await page.locator('#versionImages figure').count(),2);await page.locator('[data-close="imagesDialog"]').first().click();
  await page.locator('#contentProductSummary [data-action="edit-product"]').click();
  await page.fill('#editProductDescription','尚未保存的改动');
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/workspace')),page.evaluate(()=>document.dispatchEvent(new CustomEvent('workspace:refresh')))]);
  assert.equal(await page.inputValue('#editProductDescription'),'尚未保存的改动');
  await page.locator('[data-close="productDialog"]').first().click();
  await page.selectOption('#contentPlatform','temu');await idle();
  await page.selectOption('#contentStore','temu-ca');await idle();
  assert.equal(state.context.storeKey,'temu-ca');assert.equal(state.context.platform,'temu');
  const temuVersion=state.products[0].versions[1];
  const refreshVersions=()=>page.evaluate(()=>new Promise(resolve=>{document.addEventListener('workspace:changed',()=>resolve(true),{once:true});document.dispatchEvent(new CustomEvent('workspace:refresh'));}));
  assert.equal(await page.locator('[data-action="list-version"][data-platform="temu"]').isEnabled(),true);
  for(const incomplete of ['generating','failed','attention','ready','draft']){
    temuVersion.status=incomplete;await refreshVersions();
    assert.equal(await page.locator('[data-action="list-version"][data-platform="temu"]').isEnabled(),false,'unfinished '+incomplete+' output must not be listed');
    assert.match(await page.locator('#platformVersions').innerText(),/本套图片尚未全部完成/);
  }
  temuVersion.source={kind:'draft',id:'legacy-draft'};await refreshVersions();
  assert.equal(await page.locator('[data-action="list-version"][data-platform="temu"]').isEnabled(),true,'saved legacy drafts remain reviewable');
  temuVersion.status='completed';delete temuVersion.source;await refreshVersions();
  const second=await context.newPage();await second.goto(base+'/content');await second.locator('#contentPage:not([hidden])').waitFor();assert.equal(await second.inputValue('#contentStore'),'temu-ca');await second.close();
  conflictNext=true;await page.selectOption('#contentPlatform','amazon');await idle();assert.match(await page.textContent('#workspaceNotice'),/其他页面更新/);assert.equal(await page.inputValue('#contentPlatform'),'amazon');
  await page.goto(base+'/products');await page.locator('.ws-product-card').waitFor();
  await page.locator('[data-action="new-product"]').first().click();await page.fill('#editProductName','新商品');await page.fill('#editProductDescription','共用商品资料');
  await page.setInputFiles('#productImageFiles',{name:'fixture.png',mimeType:'image/png',buffer:pixel});
  await page.click('#saveProduct');await page.locator('#productDialog').waitFor({state:'hidden'});
  assert.equal(state.products.length,2);assert.equal(state.products[1].images[0].url,media.url);assert.equal(state.context.productId,state.products[1].id);
  await page.locator('[data-action="import"]').first().click();await page.fill('#importFolder','C:\\Fixture\\Products');await page.click('#importProducts');await page.locator('#importDialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('.ws-product-card').count(),3);assert.match(await page.textContent('#workspaceNotice'),/已导入 1 个商品/);
  await page.goto(base+'/content?product=p1&platform=amazon');await page.waitForFunction(()=>document.getElementById('contentProduct').value==='p1'&&document.getElementById('contentPlatform').value==='amazon'&&!document.getElementById('contentPlatform').disabled);
  await page.locator('[data-action="list-version"][data-platform="amazon"]').click();await page.waitForURL('**/listings?**');
  const handoff=new URL(page.url());assert.equal(handoff.searchParams.get('workspaceProduct'),'p1');assert.equal(handoff.searchParams.get('platform'),'amazon');assert.equal(handoff.searchParams.get('source'),'generated');assert.equal(handoff.searchParams.get('version'),'v-a');assert.equal(handoff.searchParams.has('product'),false);
  await page.goto(base+'/tasks');await page.locator('#taskRows tr').first().waitFor();assert.equal(await page.locator('#taskRows tr').count(),3);
  await page.selectOption('#taskStatusFilter','active');assert.equal(await page.locator('#taskRows tr').count(),1);assert.match(await page.textContent('#taskRows'),/图片裂变/);
  await page.selectOption('#taskStatusFilter','attention');assert.equal(await page.locator('#taskRows tr').count(),1);assert.match(await page.textContent('#taskRows'),/待核对批次/);
  await page.goto(base+'/design');await page.locator('.workspace-shell').waitFor();assert.equal(await page.locator('#macTitlebar').count(),1);assert.equal(await page.locator('.purah-pad .main-content').count(),1);assert.equal(await page.evaluate(()=>getComputedStyle(document.body).paddingTop),'0px');
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/content');await page.locator('#contentPage:not([hidden])').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile content must not overflow horizontally');
  assert.equal(await page.locator('.workbench-nav a').count(),6);
  state.products=[];state.context={...state.context,productId:'',platform:'amazon',storeKey:'',erpKey:'',revision:state.context.revision+1};
  await page.goto(base+'/content');await page.locator('#contentPage:not([hidden])').waitFor();assert.equal(await page.isEnabled('#startSingleDesign'),true);
  await page.click('#startSingleDesign');await page.waitForURL('**/design?platform=amazon');
  assert.deepEqual(errors,[]);
  assert.ok(writes.every(write=>write.url.startsWith('/api/workspace/')||write.url==='/api/media/up'));
  console.log('Workspace UI passed: shared context, conflict refresh, draft retention, create/upload/import, platform handoff, task filters, original header preservation, mobile layout. No generation or ERP calls.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
