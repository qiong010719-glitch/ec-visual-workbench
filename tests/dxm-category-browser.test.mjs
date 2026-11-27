import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readDxmCategoryCatalog,browseDxmCategoryCatalog,normalizeObservedCategoryPath,categoryPathMatches,readDxmCategorySearch,splitDxmSearchedCategoryPath,searchDxmCategoryCatalog,applyDxmSearchedCategory} from '../src/dxm-category-browser.mjs';

const url='https://www.dianxiaomi.com/web/sheinProduct/edit?id=220114602952000001',expected={url,account:'fixture-account'};
const poll=async fn=>{for(let i=0;i<8;i++){const value=await fn();if(value)return value;}throw new Error('fixture poll timeout');};

test('bilingual breadcrumbs resolve only within the current observed level',()=>{
  const columns=[[{id:'10',label:'办公和学习用品'}],[{id:'11',label:'笔记本'}]],path=['办公和学习用品(Office & School Supplies)','笔记本(Notebooks)'];
  const actual=normalizeObservedCategoryPath({path,columns});
  assert.deepEqual(actual,{path:['办公和学习用品','笔记本'],pathIds:['10','11'],issues:[]});
  assert.equal(categoryPathMatches(path,actual.path,{columns}),true);
  assert.equal(categoryPathMatches(['收纳箱(大号)'],['收纳箱']),false);
  assert.equal(categoryPathMatches(['Tools (Manual)'],['Tools']),false);
  assert.equal(categoryPathMatches(['办公和学习用品','收纳'],['办公和学习用品','笔记本']),false);
  assert.equal(categoryPathMatches(path,actual.path,{columns,pathIds:['10','11'],expectedIds:['10','12']}),false);
});

test('a label collision needs observed identity, never global translation stripping',()=>{
  const path=['办公和学习用品(Office & School Supplies)'],columns=[[{id:'10',label:'办公和学习用品'},{id:'20',label:'办公和学习用品(Office & School Supplies)'}]];
  assert.equal(normalizeObservedCategoryPath({path,columns}).issues[0].code,'ambiguous');
  assert.deepEqual(normalizeObservedCategoryPath({path,columns,pathIds:['10']}).path,['办公和学习用品']);
  assert.equal(normalizeObservedCategoryPath({path,columns,pathIds:['missing']}).issues[0].code,'unmatched');
});

test('the DOM reader and browse helper traverse bilingual branches without confirming the dialog',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const body=`<meta charset="utf-8"><div class="btn-user"><span class="user-name">fixture-account</span></div><div class="ant-modal"><div class="ant-modal-title">选择类目</div><div class="modal-body"><div class="w-960"></div><div id="columns"></div></div><button id="select" disabled>选择</button></div><script>
    const tree=[{id:'10',label:'办公和学习用品',translation:'Office & School Supplies',children:[{id:'11',label:'笔记本',translation:'Notebooks',leaf:true}]}];let chosen=[];window.applied=0;
    function render(){let children=tree,columns=[tree],nodes=[];for(const label of chosen){const node=children.find(node=>node.label===label);nodes.push(node);children=node.children||[];if(children.length)columns.push(children);}document.querySelector('.w-960').textContent=nodes.map(node=>node.label+'('+node.translation+')').join(' > ');document.querySelector('#select').disabled=!chosen.length||!!children.length;document.querySelector('#columns').innerHTML=columns.map((column,depth)=>'<div class="categories-box">'+column.map(node=>'<div class="categories-item" data-category-id="'+node.id+'" '+(node.leaf?'data-leaf="true"':'')+'><span class="categories-item-name" data-depth="'+depth+'">'+node.label+'</span></div>').join('')+'</div>').join('');document.querySelectorAll('.categories-item-name').forEach(node=>node.onclick=()=>{chosen=[...chosen.slice(0,Number(node.dataset.depth)),node.textContent];render();});}document.querySelector('#select').onclick=()=>window.applied++;render();
  </script>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));await page.goto(url);
  const point=async({categoryDepth,text})=>page.locator('.categories-box').nth(categoryDepth).getByText(text,{exact:true}).click();
  const root=await browseDxmCategoryCatalog({page,poll,point,expected});
  assert.equal(root.options[0].leaf,false);assert.equal(root.options[0].id,'10');
  const children=await browseDxmCategoryCatalog({page,poll,point,expected,path:['办公和学习用品']});
  assert.deepEqual(children.options,[{id:'11',label:'笔记本',path:['办公和学习用品','笔记本'],leaf:true,idSource:'dom:data-category-id'}]);
  await point({categoryDepth:1,text:'笔记本'});
  const state=await page.evaluate(readDxmCategoryCatalog,{expected});
  assert.deepEqual(state.path,['办公和学习用品','笔记本']);assert.deepEqual(state.rawPath,['办公和学习用品(Office & School Supplies)','笔记本(Notebooks)']);
  assert.deepEqual({path:state.path,pathIds:state.pathIds,issues:state.pathIssues},normalizeObservedCategoryPath({path:state.rawPath,columns:state.columns}));
  assert.equal(await page.evaluate(()=>window.applied),0);
});

test('DOM ambiguity remains blocked until an observed breadcrumb ID resolves it',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const body='<meta charset="utf-8"><div class="btn-user"><span class="user-name">fixture-account</span></div><div class="ant-modal"><div class="ant-modal-title">选择类目</div><div class="modal-body"><div class="w-960"><span>办公(Office)</span></div><div class="categories-box"><div class="categories-item" data-category-id="10"><span class="categories-item-name">办公</span></div><div class="categories-item" data-category-id="20"><span class="categories-item-name">办公(Office)</span></div></div></div><button>选择</button></div>';
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));await page.goto(url);
  assert.equal((await page.evaluate(readDxmCategoryCatalog,{expected})).pathIssues[0].code,'ambiguous');
  await assert.rejects(browseDxmCategoryCatalog({page,poll,point:()=>assert.fail('must not click ambiguous category'),expected}),/多个可见节点/);
  await page.locator('.w-960 span').evaluate(node=>node.setAttribute('data-category-id','10'));
  const state=await page.evaluate(readDxmCategoryCatalog,{expected});assert.deepEqual(state.path,['办公']);assert.deepEqual(state.pathIds,['10']);assert.deepEqual(state.pathIssues,[]);
});

const pencilA='文具(Stationery)/书写工具(Writing Tools)/铅笔(Pencils)';
const pencilB='美术用品(Art / Craft)/绘画工具(Drawing Tools)/铅笔(Pencils)';

async function searchFixture(t,{rows=[{text:pencilA},{text:pencilB}],initialSearch=false,language='初始类目',closeAfterSelect=true,unknownLeaf=false}={}){
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const body=`<meta charset="utf-8"><div class="btn-user"><span class="user-name">fixture-account</span></div>
  <div class="ant-modal"><div class="ant-modal-title">选择类目</div><div class="modal-body">
    <div class="modal-body-header"><input name="searchCategory" placeholder="搜索分类名称"><button id="search">搜索</button><div class="ant-select-selection-item">${language}</div></div>
    <div id="results"></div><div class="categories-box"><input id="columnSearch" value="unchanged"><span class="categories-item-name">文具</span></div>
  </div><div class="ant-modal-footer"><button id="confirm">选择</button><button id="back">关闭</button></div></div>
  <div class="ant-select-dropdown" style="display:none"><div class="ant-select-item-option-content">初始类目</div><div class="ant-select-item-option-content">中文类目</div></div>
  <button id="save">保存并移入待发布</button><script>
    window.searchRows=${JSON.stringify(rows)};window.events=[];window.searches=[];window.selected=[];window.saves=0;window.nativeQuery='';
    const modal=document.querySelector('.ant-modal'),resultBox=document.querySelector('#results'),input=document.querySelector('[name=searchCategory]');
    input.addEventListener('input',()=>window.nativeQuery=input.value);
    function renderResults(rows){resultBox.innerHTML='<div class="search-result"></div>';const parent=resultBox.firstElementChild;for(const row of rows){const element=document.createElement('div');element.className='search-result-item';element.innerHTML=row.text.replace(/铅笔/g,'<span class="f-red">铅笔</span>');if(row.id)element.setAttribute('data-category-id',row.id);if(row.leaf!==undefined)element.setAttribute('data-leaf',String(row.leaf));element.__vueParentComponent={props:{categoryId:'hidden-not-a-platform-id'}};element.onclick=()=>{window.selected.push(row.text);window.events.push('select:'+row.text);${closeAfterSelect?'modal.style.display="none";':''}};parent.append(element);}document.querySelector('#confirm').style.display='none';}
    document.querySelector('#back').onclick=()=>{window.events.push('back');resultBox.innerHTML='';document.querySelector('#confirm').style.display='';};
    document.querySelector('.ant-select-selection-item').onclick=()=>{window.events.push('language-open');document.querySelector('.ant-select-dropdown').style.display='';};
    document.querySelectorAll('.ant-select-item-option-content').forEach(option=>option.onclick=()=>{window.events.push('language:'+option.textContent);document.querySelector('.ant-select-selection-item').textContent=option.textContent;document.querySelector('.ant-select-dropdown').style.display='none';});
    document.querySelector('#search').onclick=()=>{window.events.push('search');window.searches.push(window.nativeQuery);renderResults(window.searchRows);};
    document.querySelector('#save').onclick=()=>window.saves++;
    ${initialSearch?'renderResults([{text:"旧分类(Old)/旧结果(Old result)"}]);':''}
    window.reopen=()=>{modal.style.display='';resultBox.innerHTML='';document.querySelector('#confirm').style.display='';};
  </script>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));await page.goto(unknownLeaf?url.replace('sheinProduct','otherProduct'):url);
  const args={page,poll,expected:{...expected,url:page.url()},point:async({selector,text})=>{
    const candidates=page.locator(selector).filter({hasText:text});
    const target=await candidates.evaluateAll((nodes,text)=>nodes.filter(node=>getComputedStyle(node).display!=='none'&&node.getClientRects().length&&node.textContent.trim()===text).map(node=>{node.setAttribute('data-fixture-hit','1');return node.textContent;}),text);
    assert.equal(target.length,1,'fixture click must be unique: '+selector+' '+text);
    await page.locator('[data-fixture-hit="1"]').click();await page.locator('[data-fixture-hit="1"]').evaluateAll(nodes=>nodes.forEach(node=>node.removeAttribute('data-fixture-hit')));
  }};
  return args;
}

test('full-path parsing preserves bilingual text and slash characters inside names',()=>{
  assert.deepEqual(splitDxmSearchedCategoryPath(pencilB),['美术用品(Art / Craft)','绘画工具(Drawing Tools)','铅笔(Pencils)']);
  assert.deepEqual(splitDxmSearchedCategoryPath('美术用品（Art / Craft） > 工具（Tools）'),['美术用品(Art / Craft)','工具(Tools)']);
  assert.throws(()=>splitDxmSearchedCategoryPath('只有末级'),/完整多级路径/);
  assert.throws(()=>splitDxmSearchedCategoryPath('文具//铅笔'),/空路径节点/);
  assert.throws(()=>splitDxmSearchedCategoryPath('文具(Stationery/铅笔'),/路径不完整/);
});

test('Chinese search leaves old results first and reads only visible full-path candidates',async t=>{
  const args=await searchFixture(t,{initialSearch:true});const result=await searchDxmCategoryCatalog({...args,query:'铅笔'});
  assert.equal(result.language,'中文类目');assert.equal(result.source,'store-search');assert.equal(result.candidates.length,2);assert.deepEqual(result.issues,[]);
  assert.equal(result.candidates[0].idKind,'observed-path');assert.equal(result.candidates[0].platformCategoryId,null);assert.equal(result.candidates[0].leaf,true);
  assert.equal(result.candidates[0].label,result.candidates[1].label);assert.notEqual(result.candidates[0].candidateId,result.candidates[1].candidateId);
  assert.deepEqual(result.candidates[1].path,splitDxmSearchedCategoryPath(pencilB));
  assert.equal(JSON.stringify(result).includes('hidden-not-a-platform-id'),false);
  const trace=await args.page.evaluate(()=>({events:window.events,searches:window.searches,selected:window.selected,saves:window.saves,column:document.querySelector('#columnSearch').value}));
  assert.deepEqual(trace,{events:['back','language-open','language:中文类目','search'],searches:['铅笔'],selected:[],saves:0,column:'unchanged'});
});

test('search apply restores the query and selects exactly the confirmed full path without saving',async t=>{
  const args=await searchFixture(t);const catalog=await searchDxmCategoryCatalog({...args,query:'铅笔'});
  const result=await applyDxmSearchedCategory({...args,query:catalog.query,category:catalog.candidates[1]});
  assert.equal(result.selected,true);assert.equal(result.dialogClosed,true);assert.equal(result.requiresReadback,true);assert.deepEqual(result.path,catalog.candidates[1].path);
  assert.deepEqual(await args.page.evaluate(()=>({selected:window.selected,saves:window.saves,searches:window.searches})),{selected:[pencilB],saves:0,searches:['铅笔','铅笔']});
});

test('observed real IDs disambiguate identical full paths, while unidentifiable duplicates are excluded',async t=>{
  const args=await searchFixture(t,{rows:[{text:pencilA,id:'cat-a'},{text:pencilA,id:'cat-b'},{text:pencilB},{text:pencilB}]});
  const catalog=await searchDxmCategoryCatalog({...args,query:'铅笔'});
  assert.equal(catalog.candidates.length,2);assert.equal(catalog.issues.length,2);
  assert.deepEqual(catalog.candidates.map(candidate=>candidate.platformCategoryId),['cat-a','cat-b']);
  assert.equal(catalog.candidates[0].idKind,'platform');
  await applyDxmSearchedCategory({...args,query:'铅笔',category:catalog.candidates[1]});
  assert.equal(await args.page.evaluate(()=>window.selected.length),1);
});

test('changed IDs, mismatched paths and changed account cannot silently select a result',async t=>{
  const args=await searchFixture(t,{rows:[{text:pencilA,id:'cat-a'}]});const catalog=await searchDxmCategoryCatalog({...args,query:'铅笔'});
  await args.page.evaluate(()=>window.searchRows[0].id='new-id');
  await assert.rejects(applyDxmSearchedCategory({...args,query:'铅笔',category:catalog.candidates[0]}),/不再唯一匹配/);
  await args.page.evaluate(()=>window.searchRows[0].id='cat-a');
  await assert.rejects(applyDxmSearchedCategory({...args,query:'铅笔',category:{...catalog.candidates[0],path:splitDxmSearchedCategoryPath(pencilB)}}),/不再唯一匹配/);
  await args.page.locator('.user-name').evaluate(node=>node.textContent='different-account');
  await assert.rejects(searchDxmCategoryCatalog({...args,query:'铅笔'}),/账号发生变化/);
  assert.deepEqual(await args.page.evaluate(()=>window.selected),[]);
});

test('non-leaf or unknown platform results are not offered as confirmed terminal categories',async t=>{
  const args=await searchFixture(t,{unknownLeaf:true,rows:[{text:pencilA},{text:pencilB,leaf:false},{text:'文具(Stationery)/橡皮(Erasers)',leaf:true}]});
  const catalog=await searchDxmCategoryCatalog({...args,query:'文具'});
  assert.equal(catalog.candidates.length,1);assert.equal(catalog.issues.length,2);assert.equal(catalog.candidates[0].label,'橡皮(Erasers)');
  await assert.rejects(searchDxmCategoryCatalog({...args,query:'文具',isStopped:()=>true}),/已暂停分类搜索/);
});

test('a result that does not close the category dialog is not reported selected',async t=>{
  const args=await searchFixture(t,{closeAfterSelect:false});const catalog=await searchDxmCategoryCatalog({...args,query:'铅笔'});
  await assert.rejects(applyDxmSearchedCategory({...args,query:'铅笔',category:catalog.candidates[0]}),/fixture poll timeout/);
  assert.equal(await args.page.evaluate(()=>window.saves),0);assert.equal((await args.page.evaluate(readDxmCategorySearch,{expected})).searchMode,true);
});
