import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {locateTemplate,applyTemplate} from '../../scripts/lib/draft-ui.mjs';

test('template lookup requires a unique full name, checks all search pages and never references missing or ambiguous templates',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),session=await page.context().newCDPSession(page);
  const cdp={send:(...args)=>session.send(...args),evaluate:(...args)=>page.evaluate(...args),on:(name,fn)=>{session.on(name,fn);return ()=>session.off(name,fn);}};
  let pages=[['旧模板20261103']],delay=0;const requests=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(route.request().method(),'GET','No ERP save/publish requests are allowed');
    if(url.pathname==='/api/userTemplate/quotePageList.json'){
      const no=Number(url.searchParams.get('pageNo'));requests.push({page:no,search:url.searchParams.get('searchValue')});
      if(delay)await new Promise(r=>setTimeout(r,delay));
      return route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data:{page:{list:(pages[no-1]||[]).map((name,i)=>({name,id:String(100+no*10+i)})),pageNo:no,pageSize:1,totalSize:pages.flat().length}}})});
    }
    await route.fulfill({contentType:'text/html; charset=utf-8',body:`<button style="margin:50px" onmouseenter="document.querySelector('[role=menuitem]').hidden=false" onmouseleave="if(!event.relatedTarget?.closest('[role=menuitem]'))document.querySelector('[role=menuitem]').hidden=true">引用产品</button><div role="menuitem" hidden onclick="document.querySelector('.ant-modal').hidden=false">引用产品模板</div>
      <div class="ant-modal" ${url.searchParams.has('closed')?'hidden':''}><h2>引用模版</h2><input name="productModuleSearchValue"><button onclick="load(1)">搜索</button><table><tbody><tr><td>旧模板</td><td>狮子山</td><td><span>引用</span></td></tr></tbody></table><div class="vxe-pager"><button title="首页" onclick="load(1)">首页</button><button title="下一页" onclick="load(current+1)">下一页</button><input placeholder="页数" value="1"></div></div><div id="form"></div>
      <script>let current=1;window.referenceCount=0;window.lastReferenced=null;
      async function load(n){const name=document.querySelector('[name=productModuleSearchValue]').value;
      const q=new URLSearchParams({pageNo:n,searchValue:name.replaceAll('%','\\\\%').replaceAll('_','\\\\_')});const r=await fetch('/api/userTemplate/quotePageList.json?'+q).then(r=>r.json()),p=r.data.page;current=n;
      document.querySelector('tbody').replaceChildren(...p.list.map(item=>{const row=document.createElement('tr'),name=document.createElement('td'),details=document.createElement('td'),action=document.createElement('td'),button=document.createElement('span');name.textContent=item.name;details.textContent='狮子山';button.textContent='引用';button.onclick=()=>{window.referenceCount++;window.lastReferenced=item.name;document.querySelector('.ant-modal').hidden=true;document.querySelector('#form').innerHTML='<div class="ant-form-item"><label class="ant-form-item-label">框架类型</label><span class="ant-select-selection-item">木框</span></div><div class="theme-value-add"></div><div class="theme-value-add"></div>';};action.append(button);row.append(name,details,action);return row;}));document.querySelector('[placeholder=页数]').value=n;
      document.querySelector('[title=首页]').disabled=n===1;document.querySelector('[title=下一页]').disabled=n>=Math.ceil(p.totalSize/p.pageSize);}
      </script>`});
  });
  const open=()=>page.goto('https://www.dianxiaomi.com/web/popTemu/add');
  await open();await assert.rejects(locateTemplate(cdp,'狮子山',{timeout:1500}),/未找到店小秘模板“狮子山”/);
  await open();await assert.rejects(locateTemplate(cdp,'1',{timeout:1500}),/未找到店小秘模板“1”/);
  pages=[];await open();await assert.rejects(locateTemplate(cdp,'狮子山',{timeout:1500}),/存为模板/);
  pages=[['狮子山'],['狮子山-副本']];delay=200;await open();assert.equal((await locateTemplate(cdp,'狮子山',{timeout:1500})).page,1);assert.equal(await page.locator('[placeholder=页数]').inputValue(),'1');
  pages=[['狮子山-副本'],['狮子山']];await open();assert.equal((await locateTemplate(cdp,'狮子山',{timeout:1500})).page,2);
  pages=[['狮子山'],['狮子山']];await open();await assert.rejects(locateTemplate(cdp,'狮子山',{timeout:1500}),/多个同名模板/);assert.equal(await page.evaluate(()=>window.referenceCount),0);
  pages=[['模板A'],['模板B']];delay=0;await open();assert.deepEqual((await locateTemplate(cdp,'',{catalog:true})).map(t=>[t.name,t.id]),[['模板A','110'],['模板B','120']]);
  await open();await assert.rejects(locateTemplate(cdp,'模板B',{templateId:'999'}),/已被替换/);assert.equal(await page.evaluate(()=>window.referenceCount),0);
  pages=[['100%_狮子山']];await open();assert.equal((await locateTemplate(cdp,'100%_狮子山',{timeout:1500})).name,'100%_狮子山');assert.equal(requests.at(-1).search,'100\\%\\_狮子山');
  pages=[['狮子山']];delay=0;await page.goto('https://www.dianxiaomi.com/web/popTemu/add?closed=1');await applyTemplate(cdp,'狮子山');assert.equal(await page.evaluate(()=>window.referenceCount),1);assert.equal(await page.evaluate(()=>window.lastReferenced),'狮子山');
  await page.goto('https://www.dianxiaomi.com/web/popTemu/edit?id=123456789');await assert.rejects(locateTemplate(cdp,'狮子山',{timeout:100}),/未打开|新建/);
});
