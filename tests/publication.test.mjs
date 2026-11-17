import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {publicationReceipt,listingPublication,publishDraftOnPage,checkPublicationOnPage,parseErpResponse} from '../../scripts/lib/temu-publish.mjs';

test('publication receipts and online statuses must name the exact draft',()=>{
  assert.equal(publicationReceipt({success:true,msg:'success'},'123456789'),null);
  assert.equal(publicationReceipt({bor:{successList:['987654321']}},'123456789'),null);
  assert.equal(publicationReceipt({data:{successList:[{idStr:'123456789'}]}},'123456789').publicationStatus,'submitted');
  assert.equal(publicationReceipt({bor:{failList:[{idStr:'123456789',msg:'invalid price'}]}},'123456789').error,'invalid price');
  assert.equal(listingPublication({data:{list:[{idStr:'123456789',dxmState:'online',productStatus:'PENDING_APPROVAL'}]}},'123456789').publicationStatus,'reviewing');
  assert.equal(listingPublication({list:[{idStr:'123456789',productStatus:'ONLINE'}]},'123456789').published,true);
  assert.equal(listingPublication({list:[]},'123456789'),null);
  assert.equal(listingPublication({list:[{idStr:'123456789',dxmState:'offline',dxmOfflineState:'waitPublish'}]},'123456789').publicationStatus,'draft');
});

test('ERP receipts retain long numeric IDs and online records without lifecycle are not pending drafts',()=>{
  const id='220114595121490272';
  assert.equal(publicationReceipt(parseErpResponse('{"data":{"bor":{"successList":[220114595121490272]}}}'),id).publicationStatus,'submitted');
  assert.equal(publicationReceipt(parseErpResponse('{"data":{"successList":[220114595121490273]}}'),id),null);
  assert.equal(publicationReceipt({successList:[Number(id)]},String(Number(id))),null);
  const response={data:{list:[{idStr:id,dxmState:'online',dxmOfflineState:'publishSuccess',productIdStr:'46641240544'}]}};
  const result=listingPublication(response,id);
  assert.equal(result.publicationStatus,'listed');assert.equal(result.published,false);assert.equal(result.platformProductId,'46641240544');
  assert.equal(listingPublication(response,'220114595121493090'),null);
});

test('real browser fixture verifies exact-row publication, journals before click and preserves ambiguous results',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publish-ui-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const page=await browser.newPage(),session=await page.context().newCDPSession(page),events=[];
  let response={bor:{successList:[{idStr:'123456789'}]}},account='merchant',writes=0,paginate=false,draftId='123456789',showDialog=true;
  // All navigation and HTTP traffic are fulfilled locally. No real ERP requests.
  await page.route('**/*',async route=>{
    if(new URL(route.request().url()).pathname==='/api/popTemuProduct/pageList.json')return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{list:[{idStr:draftId,dxmState:'offline',dxmOfflineState:'waitPublish'}]}})});
    if(new URL(route.request().url()).pathname.startsWith('/api/')){writes++;assert.equal(events.at(-1),'publishing');return route.fulfill({contentType:'application/json',body:typeof response==='string'?response:JSON.stringify(response)});}
    await route.fulfill({contentType:'text/html; charset=utf-8',body:`<script>fetch('/api/popTemuProduct/pageList.json')</script><div class="btn-user"><span class="user-name">${account}</span></div><p>共 2 条记录</p><table><tr rowid="987654321"><td>OTHER-SKU1 「店铺B」 加拿大</td><td><button class="ant-dropdown-trigger">发布</button></td></tr><tr rowid="${draftId}" style="display:${paginate?'none':'table-row'}"><td>CANVAS-SKU1 「店铺A」 加拿大</td><td><button class="ant-dropdown-trigger" onmouseover="document.getElementById('menu').hidden=false">发布</button></td></tr></table>${paginate?`<button class="ant-pagination-next" onclick="document.querySelectorAll('tr')[1].style.display='table-row';this.classList.add('ant-pagination-disabled')">下一页</button>`:''}<div id="menu" hidden><div role="menuitem" onclick="fetch('/api/popTemuProduct/batchPublishTest.json',{method:'POST'}).then(r=>r.json()).then(()=>{document.getElementById('notice').hidden=${!showDialog}})">发布</div><div role="menuitem">定时发布</div></div><div id="notice" class="ant-modal" hidden>请确认商品价格</div>`});
  });
  const cdp={send:(...args)=>session.send(...args),evaluate:(...args)=>page.evaluate(...args),on:(name,fn)=>{session.on(name,fn);return ()=>session.off(name,fn);}};
  const args={store:{draftId:'999999999',expectedStore:'店铺A',expectedSite:'加拿大站',erpConnection:{expectedAccount:'merchant'}},row:{draftId:'123456789',sku:'CANVAS-SKU1',verifiedAt:new Date().toISOString()},evidenceDirectory:dir,onProgress:phase=>events.push(phase)};
  const result=await publishDraftOnPage(cdp,args,{receiptTimeout:1500});assert.equal(result.publicationStatus,'submitted');assert.equal(writes,1);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'publication.json'))).published,false);
  paginate=true;assert.equal((await publishDraftOnPage(cdp,args,{receiptTimeout:1500})).publicationStatus,'submitted');assert.equal(writes,2);paginate=false;
  account='wrong-account';await assert.rejects(publishDraftOnPage(cdp,args,{receiptTimeout:1500}),/账号不匹配/);assert.equal(writes,2);
  account='merchant';response={bor:{successList:[{idStr:'987654321'}]}};
  await assert.rejects(publishDraftOnPage(cdp,args,{receiptTimeout:1500}),e=>/发布结果待核对/.test(e.message)&&e.keepReviewPage===true);assert.equal(writes,3);
  await assert.rejects(publishDraftOnPage(cdp,{...args,row:{...args.row,draftId:args.store.draftId}}),/新草稿/);assert.equal(writes,3);
  draftId='220114595121490272';response='{"data":{"successList":[220114595121490272]}}';
  assert.equal((await publishDraftOnPage(cdp,{...args,row:{...args.row,draftId}},{receiptTimeout:1500})).publicationStatus,'submitted');assert.equal(writes,4);
  response={code:0};showDialog=false;let reads=0;
  assert.equal((await publishDraftOnPage(cdp,{...args,row:{...args.row,draftId}},{receiptTimeout:500,readPublication:async()=>{reads++;return {publicationStatus:'listed',published:false};}})).publicationStatus,'listed');
  assert.equal(writes,5);assert.equal(reads,1);
});

test('publication readback searches queue and failed lists, handles empty lists and paginated online records',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),session=await page.context().newCDPSession(page);
  const cdp={send:(...args)=>session.send(...args),evaluate:(...args)=>page.evaluate(...args),on:(name,fn)=>{session.on(name,fn);return ()=>session.off(name,fn);}};
  const id='220114595121490272';let scenario='listed',requests=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(route.request().method(),'GET');
    if(url.pathname==='/api/popTemuProduct/pageList.json'){
      const list=url.searchParams.get('list'),second=url.searchParams.has('second');requests.push(list);
      const found=scenario==='listed'&&list==='online'||scenario==='queue'&&list==='publishing'||scenario==='failed'&&list==='publishFail'||scenario==='draft'&&list==='offline'||scenario==='paged'&&list==='online'&&second;
      const record={idStr:found?id:'220114595121493090',dxmState:list==='online'?'online':'offline',dxmOfflineState:list==='online'?'publishSuccess':list==='publishing'?'publishing':list==='publishFail'?'publishFail':'waitPublish'};
      return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{list:found||scenario==='paged'&&list==='online'?[record]:[]}})});
    }
    const list=url.searchParams.get('dxmOfflineState')||url.pathname.split('/').pop();
    const populated=scenario==='listed'&&list==='online'||scenario==='queue'&&list==='publishing'||scenario==='failed'&&list==='publishFail'||scenario==='draft'&&list==='offline';
    const paging=scenario==='paged'&&list==='online';
    await route.fulfill({contentType:'text/html; charset=utf-8',body:`<script>fetch('/api/popTemuProduct/pageList.json?list=${list}')</script>${populated||paging?`<p>共 2 条记录</p><table><tr rowid="${paging?'220114595121493090':id}"><td>SKU-SAME</td></tr></table>`:'<div class="vxe-table--empty-content">暂无数据</div>'}${paging?`<button class="ant-pagination-next" onclick="fetch('/api/popTemuProduct/pageList.json?list=online&second=1').then(r=>r.json()).then(()=>{document.querySelector('tr').setAttribute('rowid','${id}');this.classList.add('ant-pagination-disabled')})">下一页</button>`:''}`});
  });
  for(const [input,expected] of [['listed','listed'],['queue','submitted'],['failed','failed'],['draft','draft'],['missing','unknown'],['paged','listed']]){
    scenario=input;requests=[];const result=await checkPublicationOnPage(cdp,{row:{draftId:id}});assert.equal(result.publicationStatus,expected,input);
    if(input==='queue')assert.deepEqual(requests,['online','publishing']);
    if(input==='missing')assert.deepEqual(requests,['online','publishing','publishFail','offline']);
    if(input==='paged')assert.deepEqual(requests,['online','online']);
  }
});
