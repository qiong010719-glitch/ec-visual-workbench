import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

// Persistence-only fixture. No image model, source account or ERP is reachable.
const publicRoot=path.resolve('public'),writes=[],errors=[];
const design={key:'p1:amazon',revision:1,data:{appState:{prodName:'服务端设计',materialMeta:[]},adapter:null,pending:null}};
const blankDesign={key:'blank:amazon',revision:0,data:null};
const ui={key:'listing:intake',revision:1,data:{folder:'server-folder'}};
const selection={key:'listing:selection',revision:1,data:{items:{}}};
let failDesign=true,failUi=true,raceDesign=false,raceUi=false;
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const designHtml=(record=design)=>`<!doctype html><html><head><meta charset="utf-8"><script>window.WorkspaceDesignBoot=${json({key:record.key,productId:record===blankDesign?'':'p1',platform:'amazon',revision:record.revision,data:record.data})}</script><script src="/local/design-bootstrap.js"></script></head><body><nav><a id="navigateFixture" href="/destination">选品与采集</a></nav><main><div class="ws-header"><h2>设计</h2><p class="ws-subtitle"></p></div><div class="workspace-grid"><input id="prodName"><button id="saveFixture">保存</button></div></main><script>window.__idbRestored=true;document.getElementById('prodName').value=JSON.parse(localStorage.getItem(WorkspaceDesignStorageKey))?.prodName||'';window.saveAppState=function(){localStorage.setItem(WorkspaceDesignStorageKey,JSON.stringify({prodName:document.getElementById('prodName').value,materialMeta:[]}));};document.getElementById('saveFixture').onclick=()=>window.saveAppState();</script><script src="/local/design-state.js"></script></body></html>`;
const listingHtml=()=>`<!doctype html><html><head><meta charset="utf-8"><script>window.WorkspacePageBoot=${json({page:'listings',platform:'temu',context:{productId:'p2'},uiStates:{'listing:intake':ui,'listing:selection':selection}})}</script><script src="/local/workspace-state.js"></script></head><body><main><input id="folder"><button id="saveFixture">保存</button><select id="historySelect"><option value="">无任务</option><option value="execution-1">历史执行批次</option></select><p id="activeTask"></p></main><script>document.getElementById('folder').value=JSON.parse(localStorage.getItem('listing-intake-v1')).folder;document.getElementById('saveFixture').onclick=()=>localStorage.setItem('listing-intake-v1',JSON.stringify({folder:document.getElementById('folder').value}));document.getElementById('historySelect').onchange=event=>localStorage.setItem('listing-active-task',JSON.stringify({kind:'execution',id:event.target.value}));document.getElementById('activeTask').textContent=localStorage.getItem('listing-active-task')||'';</script></body></html>`;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
    if(url.pathname==='/api/session')return send(200,{token:'fixture-token'});
    if(url.pathname==='/api/workspace/design-state'||url.pathname==='/api/workspace/ui-state'){
      const isDesign=url.pathname.endsWith('/design-state'),record=isDesign?(url.searchParams.get('key')==='blank:amazon'?blankDesign:design):url.searchParams.get('key')==='listing:selection'?selection:ui;
      if(req.method==='GET'){
        const copy=structuredClone(record);
        if(isDesign?raceDesign:raceUi){if(isDesign)raceDesign=false;else raceUi=false;record.revision++;record.data=isDesign?{appState:{prodName:'其他窗口的新设计',materialMeta:[]},adapter:null,pending:null}:{folder:'other-window-folder'};}
        return send(200,copy);
      }
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));writes.push({path:url.pathname,...body});
      if(!isDesign)assert.equal(req.headers['x-workbench-token'],'fixture-token');
      if(isDesign?failDesign:failUi)return send(503,{error:'模拟暂时无法同步'});
      if(body.revision!==record.revision)return send(409,{error:'其他页面已更新，请核对后恢复'});
      record.revision++;record.data=body.data;return send(200,record);
    }
    if(url.pathname==='/design-recovery'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(designHtml());}
    if(url.pathname==='/design-blank'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(designHtml(blankDesign));}
    if(url.pathname==='/destination'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><title>Destination</title><p>Navigation completed</p>');}
    if(url.pathname==='/listing-recovery'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(listingHtml());}
    const file=path.join(publicRoot,url.pathname);if(file.startsWith(publicRoot)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end(fs.readFileSync(file));}
    res.writeHead(404);res.end();
  }catch(error){errors.push(error.message);send(500,{error:error.message});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
let dialogCount=0;page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{dialogCount++;return dialog.accept();});
const recoveries=(kind)=>page.evaluate(kind=>Object.keys(localStorage).filter(key=>key.startsWith('workspace-recovery:'+kind+':')).map(key=>JSON.parse(localStorage.getItem(key))),kind);
try{
  await page.goto(base+'/design-recovery');await page.fill('#prodName','未同步设计');await page.click('#saveFixture');
  await page.waitForFunction(()=>document.getElementById('designSyncState').textContent.includes('模拟暂时无法同步'));
  let copies=await recoveries('design');assert.equal(copies.length,1);assert.equal(copies[0].productId,'p1');assert.equal(copies[0].platform,'amazon');assert.equal(copies[0].baseRevision,1);assert.equal(copies[0].data.appState.prodName,'未同步设计');assert.ok(copies[0].updatedAt);
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true,'unsaved design must prompt on leaving');
  await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('workspace-recovery:design:')),record=JSON.parse(localStorage.getItem(key));record.storageKey='workspace-recovery:design:other-window';record.updatedAt='2020-01-01T00:00:00Z';record.data.appState.prodName='另一窗口未同步副本';localStorage.setItem(record.storageKey,JSON.stringify(record));});
  await page.reload();await page.locator('#designRecoveryPanel:not([hidden])').waitFor();
  assert.equal(await page.inputValue('#prodName'),'未同步设计','unchanged server checkpoint must preserve unsent local edits');
  assert.equal(design.data.appState.prodName,'服务端设计','loading local pending state must not silently overwrite server');
  assert.ok((await recoveries('design')).some(record=>record.data.appState.prodName==='另一窗口未同步副本'));
  const download=page.waitForEvent('download');await page.click('#downloadDesignRecovery');assert.match((await download).suggestedFilename(),/未同步设计草稿/);
  failDesign=false;raceDesign=true;await page.click('#restoreDesignRecovery');
  await page.waitForFunction(()=>document.getElementById('designSyncState').textContent.includes('其他页面已更新'));
  assert.equal(design.data.appState.prodName,'其他窗口的新设计');assert.ok((await recoveries('design')).filter(record=>record.data.appState.prodName==='未同步设计').length,'new server conflict must preserve the recovery copy');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#restoreDesignRecovery')]);assert.equal(await page.inputValue('#prodName'),'未同步设计');
  assert.equal(design.data.appState.prodName,'未同步设计');copies=await recoveries('design');assert.ok(copies.some(record=>record.data.appState.prodName==='另一窗口未同步副本'),'successful restore must not consume other windows copies');
  await page.fill('#prodName','正常已同步');await page.click('#saveFixture');await page.waitForFunction(()=>document.getElementById('designSyncState').textContent.includes('已保存到工作台'));
  assert.equal(design.data.appState.prodName,'正常已同步');assert.ok((await recoveries('design')).some(record=>record.data.appState.prodName==='另一窗口未同步副本'),'normal save must preserve unrelated copies');

  await page.goto(base+'/listing-recovery');await page.fill('#folder','local-unsynced-folder');await page.click('#saveFixture');
  await page.waitForFunction(()=>document.getElementById('sharedStateMessage')?.textContent.includes('模拟暂时无法同步'));
  copies=await recoveries('ui');assert.equal(copies.length,1);assert.equal(copies[0].productId,'p2');assert.equal(copies[0].platform,'temu');assert.equal(copies[0].baseRevision,1);assert.equal(copies[0].data.folder,'local-unsynced-folder');
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
  await page.reload();await page.locator('#listingRecoveryControls:not([hidden])').waitFor();assert.equal(await page.inputValue('#folder'),'local-unsynced-folder');assert.equal(ui.data.folder,'server-folder');assert.equal((await recoveries('ui'))[0].data.folder,'local-unsynced-folder');
  failUi=false;raceUi=true;await page.click('#restoreListingRecovery');await page.waitForFunction(()=>document.getElementById('sharedStateMessage').textContent.includes('其他页面已更新'));
  assert.equal(ui.data.folder,'other-window-folder');assert.ok((await recoveries('ui')).some(record=>record.data.folder==='local-unsynced-folder'));
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#restoreListingRecovery')]);assert.equal(await page.inputValue('#folder'),'local-unsynced-folder');
  assert.equal(ui.data.folder,'local-unsynced-folder');assert.equal(await page.locator('#listingRecoveryControls').isVisible(),false);
  failUi=true;await page.selectOption('#historySelect','execution-1');await page.reload();await page.locator('#activeTask').waitFor();
  assert.match(await page.textContent('#activeTask'),/execution-1/,'selecting history then immediately reloading must keep unsent local selection');
  assert.ok((await recoveries('ui')).some(record=>record.key==='listing:selection'&&record.data.items['listing-active-task']?.includes('execution-1')));
  failDesign=false;await page.goto(base+'/design-blank');await page.locator('#designPlatform').waitFor();const dialogsBeforeNavigation=dialogCount;
  await page.click('#navigateFixture');await page.waitForURL('**/destination');
  assert.equal(dialogCount,dialogsBeforeNavigation,'first navigation from untouched blank design must not show beforeunload confirmation');
  assert.equal(blankDesign.data.appState.prodName,'','default snapshot must be saved before navigation');
  await page.goto(base+'/design-blank');failDesign=true;await page.fill('#prodName','真实未同步修改');await page.click('#navigateFixture');
  await page.waitForFunction(()=>document.getElementById('designSyncState').textContent.includes('页面尚未跳转'));
  assert.match(page.url(),/design-blank$/);assert.ok((await recoveries('design')).some(record=>record.data.appState.prodName==='真实未同步修改'));
  assert.deepEqual(errors,[]);assert.ok(writes.every(write=>['/api/workspace/design-state','/api/workspace/ui-state'].includes(write.path)));
  console.log('Recovery UI passed: failed saves retained, reload preserves copies, downloads, leave prompts, explicit restore with current revision, renewed conflict protection, and unrelated-window copy retention. No model/ERP calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
