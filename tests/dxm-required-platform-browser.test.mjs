import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createDxmRequiredPlatformBrowser,readRequiredPlatformList,readRequiredPlatformEditor,requiredPlatformUiPoint,requiredPlatformSnapshot,existingRequiredValuesIssues,sourcePriceEvidence,completeOrdinaryChoices} from '../src/dxm-required-platform-browser.mjs';
import {readDxmCategoryCatalog} from '../src/dxm-category-browser.mjs';
import {planSourcePrices} from '../src/listing-field-policy.mjs';

const origin='https://www.dianxiaomi.com',goodsId='601234567890001',draftId='220114602951929164';
const sourceUrl=`https://www.temu.com/juicer-g-${goodsId}.html`,editUrl=`${origin}/web/sheinProduct/edit?id=${draftId}`,draftUrl=origin+'/web/sheinProduct/draft',pendingUrl=origin+'/web/sheinProduct/offline';
const account='fixture-account',storeName='测试SHEIN店铺',categoryPath=['家用电器','厨房电器','榨汁机'];
const clone=value=>structuredClone(value);
const sourceFacts=()=>({version:1,platform:'temu',goodsId,sourceUrl,observedAt:new Date(Date.now()-1000).toISOString(),status:'ready',categoryPath,price:{amount:'12',currency:'USD',kind:'displayed-sale'},selectedVariant:{attributes:[],selectionComplete:true},variants:[{attributes:[],price:{amount:'12',currency:'USD',kind:'displayed-sale'}}],issues:[]});
const proof=f=>sourcePriceEvidence({options:{...f.args.pricePolicy,platform:'shein',goodsId,sourceFacts:f.args.sourceFacts}},f.persisted.fields);
const field=(name,value,extra={})=>({key:name,selector:'#'+name,shape:name,name,label:name,kind:'text',required:true,protected:false,value,empty:value==='',options:[],errors:[],rowIdentity:null,...extra});
function fixture(options={}){
  const events=[],targets=new Map(),pages=new Map();let created=0,saves=0,moves=0,publishes=0;
  const persisted={editor:{url:editUrl,account,storeName,site:'',siteFieldPresent:false,sources:[sourceUrl],category:['榨汁机'],categoryPath:[...categoryPath],media:['https://assets.test/main.jpg']},fields:{url:editUrl,account,fields:[field('title','原产品标题',{protected:true}),field('price','12',{kind:'number'}),field('stock','',{kind:'number'})]}};
  if(options.complete)persisted.fields.fields.find(item=>item.name==='stock').value='1';
  if(options.complete)persisted.fields.fields.find(item=>item.name==='stock').empty=false;
  const state={phase:'draft',unknownMove:false,saveNotPersisted:false,...options};
  const sourceRecord=()=>({draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:[storeName],sites:[],siteColumnPresent:false,title:'原产品标题',platformEditUrl:editUrl});
  const listRows=status=>state.listRows?clone(state.listRows(status)):(status==='offline'?state.phase==='offline':state.phase==='draft')?[sourceRecord()]:[];
  const browser={async send(method,args){
    if(method==='Target.createTarget'){const id='owned-'+(++created);targets.set(id,{id,type:'page',url:args.url});events.push('create:'+id);return {targetId:id};}
    if(method==='Target.closeTarget'){targets.delete(args.targetId);events.push('close:'+args.targetId);return {};}
    throw new Error('Unexpected browser method '+method);
  },close(){}};
  const createPage=id=>{
    const pageState={id,url:'about:blank',editor:null,fields:null,locator:null,catalogPath:[],dialog:false};pages.set(id,pageState);
    return {
      async send(method,args={}){
        if(method==='Page.navigate'){pageState.url=args.url;targets.get(id).url=args.url;events.push('navigate:'+args.url);if(args.url===editUrl){pageState.editor=clone(persisted.editor);pageState.fields=clone(persisted.fields);}return state.navigationError?{errorText:state.navigationError}:{};}
        if(['Page.enable','Emulation.setFocusEmulationEnabled','Page.bringToFront'].includes(method))return {};
        if(method==='Input.dispatchMouseEvent'){
          const locator=pageState.locator;events.push('mouse:'+args.type+':'+(locator?.text||''));
          if(args.type==='mousePressed'&&state.pressFailure&&locator?.text===state.pressFailure)throw new Error('mouse acknowledgement lost');
          if(args.type!=='mouseReleased')return {};
          if(locator?.kind==='checkbox'){state.nativeSelected=[...state.nativeSelected||[],locator.draftId];events.push('native-select:'+locator.draftId);return {};}
          if(locator?.text==='批量操作'){state.nativeMenu=true;events.push('native-menu');return {};}
          if(locator?.text==='批量编辑'){state.nativeOpened=true;state.nativeMenu=false;events.push('native-open');return {};}
          if(locator?.text==='选择分类'){pageState.dialog=true;pageState.catalogPath=[];return {};}
          if(locator?.categoryDepth!==undefined){pageState.catalogPath=[...categoryPath.slice(0,locator.categoryDepth),locator.text];return {};}
          if(locator?.text==='选择'&&pageState.dialog){pageState.dialog=false;pageState.editor.category=['榨汁机'];pageState.editor.categoryPath=state.wrongAppliedCategory?['错误父级','榨汁机']:state.bilingualCategory?categoryPath.map(label=>label+'(English Translation)'):[...categoryPath];return {};}
          if(locator?.text==='保存'){saves++;events.push('save-click');if(!state.saveNotPersisted){persisted.editor=clone(pageState.editor);persisted.fields=clone(pageState.fields);}return {};}
          if(locator?.text==='移入待发布'){moves++;events.push('move-click');if(!state.unknownMove)state.phase='offline';return {};}
          if(locator?.text==='发布'||locator?.text==='保存并移入待发布'){publishes++;throw new Error('Unexpected publish/combined action');}
          throw new Error('Unexpected fixture locator '+JSON.stringify(locator));
        }
        throw new Error('Unexpected page method '+method);
      },
      async evaluate(fn,arg){
        if(fn.name==='requiredPlatformUiPoint'){pageState.locator=clone(arg.locator);return {point:{x:10,y:10},bounds:{x:0,y:0,width:20,height:20}};}
        if(fn.name==='nativeBatchUiPoint'){pageState.locator=clone(arg.locator);return {point:{x:10,y:10},bounds:{x:0,y:0,width:20,height:20},targetKey:arg.locator.kind+':'+(arg.locator.draftId||arg.locator.text)};}
        if(fn.name==='readDxmNativeBatchPage'){
          const selectedIds=[...state.nativeSelected||[]].sort(),rows=listRows('draft').map(row=>({...row,checkboxCount:1,checked:selectedIds.includes(row.draftId),checkboxConflict:false,checkboxDisabled:false,businessModes:[],priceCurrencies:[]}));
          return {url:pageState.url,account,rows,total:rows.length,selectedCount:selectedIds.length,selectedIds,unidentifiedSelected:0,broadSelection:false,controls:['批量操作','批量编辑'].map(text=>({text,count:text==='批量操作'||state.nativeMenu?1:0,enabledCount:text==='批量操作'||state.nativeMenu?1:0})),dialogs:state.nativeOpened?[{text:'分类映射未完成',selectedCount:1,unmappedCount:1,variantLossWarning:true,buttons:['编辑分类','跳过，去编辑产品']}]:[]};
        }
        if(fn.name==='readRequiredPlatformList'){
          const status=pageState.url===pendingUrl?'offline':'draft',rows=listRows(status);
          return {url:pageState.url,account,rows,total:rows.length,nextEnabled:false,pageNumbers:[1],filters:[],search:''};
        }
        if(fn.name==='readRequiredPlatformEditor'){
          if(pageState.url!==editUrl)throw new Error('fixture editor URL mismatch');
          const result=clone(pageState.editor);if(state.wrongStore)result.storeName='other-store';
          return result;
        }
        if(fn.name==='readRequiredFields')return clone(pageState.fields);
        if(fn.name==='fillRequiredFields'){
          const changes=[];for(const write of arg.plan.writes){const target=pageState.fields.fields.find(item=>item.key===write.key);assert.ok(target);target.value=write.value;target.empty=false;changes.push({label:target.label,value:write.value});}return {changes};
        }
        if(fn.name==='readDxmCategoryCatalog'){
          if(!pageState.dialog)return null;
          const columns=pageState.catalogPath.map((_,index)=>[{id:String(10+index),label:categoryPath[index],leaf:index===2,idSource:'dom:data-category-id'}]);
          if(pageState.catalogPath.length<3)columns.push([{id:String(10+pageState.catalogPath.length),label:categoryPath[pageState.catalogPath.length],leaf:pageState.catalogPath.length===2,idSource:'dom:data-category-id'}]);
          return {path:clone(pageState.catalogPath),columns,loading:false,canSelect:pageState.catalogPath.length===3};
        }
        if(arg?.url&&arg?.account)return pageState.url===arg.url&&arg.account===account;
        if(arg===undefined)return !state.saveNotPersisted;
        throw new Error('Unexpected fixture evaluation '+fn.name);
      },close(){events.push('detach:'+id);}
    };
  };
  const transport={connection:async()=>({ws:'fixture',targets:async()=>[...targets.values()]}),connect:async()=>browser,pageById:async(_info,id)=>createPage(id),poll:async(fn,{label}={})=>{for(let index=0;index<5;index++){const value=await fn();if(value)return value;}throw new Error('fixture timeout: '+label);}};
  const binding={key:'shein-one',storeName,storeId:'shop-101',site:''};
  const args={sourceFacts:sourceFacts(),pricePolicy:{businessMode:'marketplace',targetCurrency:'USD'},browserConfig:{type:'chrome'},erpConnection:{expectedAccount:account},workflowMode:'required-fields',completionMode:'pending',templateSnapshot:{id:'required-test',version:1,platform:'shein',workflowMode:'required-fields',completionMode:'pending',rules:{autoFillRequired:true},category:{id:'12',label:'榨汁机',path:categoryPath},storeBindings:[binding]},storeBinding:binding,row:{goodsId,draftId,sourceUrl,title:'原产品标题',storeName,storeBindingKey:binding.key,site:'',platformEditUrl:editUrl},rows:[{goodsId,sourceUrl,title:'原产品标题'}],
    beforeSave:async payload=>{events.push('save-intent');args.intent=clone(payload);},beforeMoveToPending:async payload=>{events.push('move-intent');args.moveIntent=clone(payload);},onMovedToPending:async()=>{events.push('move-confirmed');},beforePublish:async()=>{throw new Error('No publication is authorized');}};
  return {args,state,persisted,events,adapter:createDxmRequiredPlatformBrowser({},transport),get saves(){return saves;},get moves(){return moves;},get publishes(){return publishes;},get openTargets(){return targets.size;}};
}

test('SHEIN DOM readers merge fixed-column copies and verify the actual store/source editor fields',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<body></body>'}));
  await page.goto(draftUrl);await page.setContent(`<div class="btn-user"><span class="user-name">${account}</span></div><p>共 1 条记录</p><table><tbody><tr rowid="${draftId}"><td><a href="${sourceUrl}">来源</a><span class="no-new-line3">原产品标题</span></td></tr><tr rowid="${draftId}"><td>「${storeName}」<a href="${editUrl}">编辑</a><button>移入待发布</button></td></tr><tr rowid="${draftId}" style="display:none"><td><a href="https://www.temu.com/other-g-601234567890999.html">隐藏来源</a>「其他店铺」</td></tr></tbody></table>`);
  const listExpected={url:draftUrl,account,editPath:'/web/sheinProduct/edit'},list=await page.evaluate(readRequiredPlatformList,listExpected);assert.equal(list.rows.length,1);assert.deepEqual(list.rows[0].goodsIds,[goodsId]);assert.deepEqual(list.rows[0].storeNames,[storeName]);assert.equal(list.rows[0].platformEditUrl,editUrl);
  await assert.rejects(page.evaluate(readRequiredPlatformList,{...listExpected,account:'other-account'}),/账号不一致/);
  const moveExpected={...listExpected,goodsId,storeName,site:''},moveLocator={draftId,text:'移入待发布'};assert.ok(await page.evaluate(requiredPlatformUiPoint,{expected:moveExpected,locator:moveLocator}));
  await page.locator(`a[href="${sourceUrl}"]`).evaluate(element=>{element.href='https://www.temu.com/other-g-601234567890999.html';});await assert.rejects(page.evaluate(requiredPlatformUiPoint,{expected:moveExpected,locator:moveLocator}),/移动前草稿的来源或店铺/);
  await page.goto(editUrl);await page.setContent(`<div class="btn-user"><span class="user-name">${account}</span></div><form class="ant-form"><div class="ant-form-item"><label class="ant-form-item-label">选择店铺：</label><span class="ant-select-selection-item" title="${storeName}">${storeName}</span></div><div class="ant-form-item"><label class="ant-form-item-label">来源URL：</label><input value="${sourceUrl}"></div><div class="ant-form-item"><label class="ant-form-item-label">产品分类：</label><span class="ant-select-selection-item">榨汁机</span><div>${categoryPath.join(' > ')}</div><button type="button">选择分类</button></div><img src="https://assets.test/main.jpg"><button type="button">保存</button><button type="button">保存并移入待发布</button><button type="button">发布</button></form>`);
  const expected={url:editUrl,account,storeName,site:'',goodsId},editor=await page.evaluate(readRequiredPlatformEditor,expected);assert.equal(editor.storeName,storeName);assert.deepEqual(editor.sources,[sourceUrl]);assert.deepEqual(editor.categoryPath,categoryPath);
  await page.locator('.ant-form-item').last().locator('div').evaluate(node=>node.textContent='家用电器(Home Appliances) > 厨房电器(Kitchen Appliances) > 榨汁机(Juicers)');
  assert.deepEqual((await page.evaluate(readRequiredPlatformEditor,expected)).categoryPath,['家用电器(Home Appliances)','厨房电器(Kitchen Appliances)','榨汁机(Juicers)']);
  const save=await page.evaluate(requiredPlatformUiPoint,{expected,locator:{selector:'button',text:'保存',first:true}});assert.ok(save?.point);assert.ok(await page.evaluate(({point})=>document.elementFromPoint(point.x,point.y).textContent==='保存',save));
  await assert.rejects(page.evaluate(readRequiredPlatformEditor,{...expected,storeName:'另一家店'}),/店铺不匹配/);
  await page.locator('input').fill('https://www.temu.com/other-g-601234567890999.html');await assert.rejects(page.evaluate(readRequiredPlatformEditor,expected),/来源与本批/);
  await page.setContent(`<div class="btn-user"><span class="user-name">${account}</span></div><div class="ant-modal"><div class="ant-modal-title">选择类目</div><div class="modal-body"><div class="w-960">家用电器</div><div class="categories-box"><div class="categories-item" data-category-id="10"><span class="categories-item-name">家用电器</span><i class="icon_right"></i></div></div><div class="categories-box"><div class="categories-item" data-category-id="11"><span class="categories-item-name">厨房电器</span><i class="icon_right"></i></div></div></div><button disabled>选择</button></div>`);
  const catalog=await page.evaluate(readDxmCategoryCatalog,{expected:{url:editUrl,account}});assert.equal(catalog.columns[0][0].id,'10');assert.equal(catalog.columns[0][0].leaf,false);assert.equal(catalog.columns[1][0].leaf,false);assert.equal(catalog.canSelect,false);
});

test('SHEIN snapshot and preservation guard retain prices, inventory, source identity and category path',()=>{
  const f=fixture({complete:true}),snapshot=requiredPlatformSnapshot(f.persisted.editor,f.persisted.fields);assert.deepEqual(snapshot.categoryPath,categoryPath);assert.equal(snapshot.fields.find(item=>item.name==='price').value,'12');
  const changed=clone(f.persisted.fields);changed.fields.find(item=>item.name==='price').value='99';assert.deepEqual(existingRequiredValuesIssues(f.persisted.fields,changed),['已有内容发生变化：price']);
  changed.fields=changed.fields.filter(item=>item.name!=='title');assert.ok(existingRequiredValuesIssues(f.persisted.fields,changed).includes('已有内容发生变化：title'));
});

test('SHEIN native adapter opens only this batch, journals once, and retains the category warning page',async()=>{
  const f=fixture(),args={...f.args,rows:[clone(f.args.row)],requestId:'native-adapter-01',beforeOpen:intent=>{assert.equal(f.events.includes('native-open'),false);f.events.push('native-intent');f.args.nativeIntent=clone(intent);}};
  const result=await f.adapter.openNativeBatch(args);
  assert.equal(result.status,'needs-review');assert.equal(result.phase,'category-mapping-required');assert.equal(result.retainPage,true);assert.equal(f.openTargets,1);
  assert.deepEqual(f.events.filter(event=>event.startsWith('native-')),['native-select:'+draftId,'native-menu','native-intent','native-open']);
  assert.equal(f.saves,0);assert.equal(f.moves,0);assert.equal(f.publishes,0);assert.ok(f.events.some(event=>event.startsWith('detach:')));assert.ok(!f.events.some(event=>event.startsWith('close:')));
  assert.deepEqual(f.adapter.capabilities.nativeOpenPlatforms,['shein']);assert.equal(f.adapter.capabilities.nativePrepare,false);assert.equal(f.adapter.capabilities.nativeSave,false);
  const replay=await f.adapter.openNativeBatch({...args,existingIntent:f.args.nativeIntent,beforeOpen:()=>assert.fail('opening must not repeat')});
  assert.equal(replay.status,'needs-review');assert.equal(f.events.filter(event=>event==='native-open').length,1);assert.equal(f.openTargets,2);
});

test('known incomplete native attribute coverage blocks before category save or any browser mutation',async()=>{
  const f=fixture(),args={...f.args,rows:[{...f.args.row,id:'neutral-row'}],beforeSubmit:()=>assert.fail('no submission is allowed')};
  for(const action of ['prepareBatch','moveToPendingBatch']){const result=await f.adapter[action](args);assert.equal(result.ready,false);assert.equal(result.rows[0].saved,false);assert.ok(result.issues.length);}
  assert.deepEqual(f.events,[]);assert.equal(f.saves,0);assert.equal(f.moves,0);
});

test('native adapter never selects across stores or platforms and preserves a blocked page',async()=>{
  const f=fixture(),args={...f.args,rows:[clone(f.args.row)],requestId:'native-adapter-02',beforeOpen:()=>assert.fail('unverified selection must not open')};
  await assert.rejects(f.adapter.openNativeBatch({...args,templateSnapshot:{...args.templateSnapshot,platform:'tiktok'}}),/尚未适配/);
  await assert.rejects(f.adapter.openNativeBatch({...args,rows:[{...args.rows[0],storeBindingKey:'another-store'}]}),/不能跨店铺/);assert.equal(f.openTargets,0);
  f.state.nativeSelected=['220114602951929999'];const result=await f.adapter.openNativeBatch(args);
  assert.equal(result.status,'blocked');assert.equal(result.retainPage,true);assert.equal(f.openTargets,1);assert.ok(!f.events.some(event=>event.startsWith('mouse:')));assert.equal(f.saves,0);
});

test('SHEIN independent save verification ignores rebuilt DOM identifiers but retains exact SKU identity',async()=>{
  const f=fixture({complete:true}),stock=f.persisted.fields.fields.find(item=>item.name==='stock');stock.rowIdentity={id:'table-row-before',sku:'SKU-A'};
  const intent={url:editUrl,goodsId,storeBindingKey:'shein-one',expectedSnapshot:requiredPlatformSnapshot(f.persisted.editor,f.persisted.fields),priceEvidence:proof(f)};
  for(const item of f.persisted.fields.fields){item.key='rebuilt-'+item.key;item.selector='#rendered-'+item.name;item.shape='rebuilt-'+item.shape;if(item.rowIdentity)item.rowIdentity.id='table-row-after';}
  const saved=await f.adapter.verify({...f.args,preparationIntent:intent});assert.equal(saved.saved,true);assert.equal(saved.ready,true);assert.equal(f.saves,0);
  stock.rowIdentity.sku='SKU-B';const changed=await f.adapter.verify({...f.args,preparationIntent:intent});assert.equal(changed.saved,null);assert.equal(changed.ready,false);assert.equal(f.moves,0);assert.equal(f.publishes,0);
});

test('SHEIN category browsing uses the real branch directory and never saves or submits a product',async()=>{
  const f=fixture(),root=await f.adapter.readCategories({...f.args,path:[]});assert.equal(root.platform,'shein');assert.equal(root.account,account);assert.equal(root.storeBindingKey,'shein-one');assert.deepEqual(root.options,[{id:'10',label:'家用电器',path:['家用电器'],leaf:false,idSource:'dom:data-category-id'}]);
  const leaf=await f.adapter.readCategories({...f.args,path:categoryPath.slice(0,-1)});assert.equal(leaf.options[0].id,'12');assert.equal(leaf.options[0].leaf,true);assert.deepEqual(leaf.options[0].path,categoryPath);assert.equal(f.saves,0);assert.equal(f.moves,0);assert.equal(f.publishes,0);assert.equal(f.openTargets,0);
});

test('SHEIN preparation fills an empty numeric field, journals one save, and independently reads it back',async()=>{
  const f=fixture(),result=await f.adapter.prepare(f.args);assert.equal(result.status,'prepared');assert.equal(result.saved,true);assert.equal(result.ready,true);assert.equal(f.saves,1);assert.equal(f.publishes,0);assert.equal(f.moves,0);assert.ok(f.events.indexOf('save-intent')<f.events.indexOf('save-click'));assert.equal(f.persisted.fields.fields.find(item=>item.name==='stock').value,'1');assert.equal(f.persisted.fields.fields.find(item=>item.name==='price').value,'12');
  const checked=await f.adapter.verify({...f.args,preparationIntent:f.args.intent});assert.equal(checked.ready,true);assert.equal(f.saves,1);assert.equal(f.openTargets,0);
});

test('SHEIN preserves DXM converted price, defaults ordinary attributes, and locks price evidence',async()=>{
  const f=fixture();f.persisted.fields.fields.find(item=>item.name==='price').value='99';
  f.persisted.fields.fields.push(field('material','',{kind:'select',options:[{value:'steel',label:'钢'},{value:'other',label:'其他'}]}));
  const result=await f.adapter.prepare(f.args);assert.equal(result.ready,true);assert.equal(f.saves,1);assert.equal(f.persisted.fields.fields.find(item=>item.name==='price').value,'99');assert.equal(f.persisted.fields.fields.find(item=>item.name==='material').value,'other');
  assert.equal(f.args.intent.priceEvidence.policy,'preserve-dxm-converted');assert.equal(f.args.intent.priceEvidence.options.goodsId,goodsId);assert.equal(f.args.intent.priceEvidence.fxVerified,false);assert.equal(f.args.intent.priceEvidence.options.sourceFacts,undefined);
  f.persisted.fields.fields.find(item=>item.name==='price').value='88';
  f.args.intent.expectedSnapshot=requiredPlatformSnapshot(f.persisted.editor,f.persisted.fields);
  const replacedSource=sourceFacts();replacedSource.variants[0].price.amount='88';
  const verified=await f.adapter.verify({...f.args,sourceFacts:replacedSource,preparationIntent:f.args.intent});
  assert.equal(verified.ready,false);assert.match(verified.issues.join(''),/发生变化/);assert.equal(f.saves,1);assert.equal(f.moves,0);
});

test('SHEIN missing source, mode or currency never authorizes filling an empty DXM price',async()=>{
  for(const omit of ['sourceFacts','businessMode','targetCurrency']){
    const f=fixture();if(omit==='sourceFacts')delete f.args.sourceFacts;else delete f.args.pricePolicy[omit];
    f.persisted.fields.fields.find(item=>item.name==='price').value='';f.persisted.fields.fields.find(item=>item.name==='price').empty=true;
    const result=await f.adapter.prepare(f.args);assert.equal(result.ready,false);assert.equal(f.saves,0);assert.ok(result.issues.length);assert.equal(f.persisted.fields.fields.find(item=>item.name==='price').value,'');
  }
});

test('SHEIN valid DXM prices do not require Temu price evidence or another FX request',async()=>{
  const f=fixture();delete f.args.sourceFacts;f.args.pricePolicy={};f.args.quotePrice=()=>assert.fail('DXM already converts currency');
  const result=await f.adapter.prepare(f.args);assert.equal(result.ready,true);assert.equal(f.persisted.fields.fields.find(item=>item.name==='price').value,'12');assert.equal(result.priceEvidence.fxVerified,false);assert.deepEqual(result.priceEvidence.conversions,[]);assert.equal(result.priceEvidence.prices[0].currencyStatus,'not-confirmed');
});

test('SHEIN bilingual category breadcrumbs are accepted only for the same complete path',async()=>{
  const f=fixture({bilingualCategory:true}),result=await f.adapter.prepare(f.args);assert.equal(result.ready,true);assert.equal(f.saves,1);assert.equal(f.args.intent.expectedSnapshot.categoryPath[0],'家用电器(English Translation)');
  f.persisted.editor.categoryPath=[...categoryPath];assert.equal((await f.adapter.verify({...f.args,preparationIntent:f.args.intent})).ready,true);
  f.persisted.editor.categoryPath[0]='家用电器(儿童用)';assert.equal((await f.adapter.verify({...f.args,preparationIntent:f.args.intent})).ready,false);
});

test('legacy required-fields evidence without source-price proof cannot become ready on restart',async()=>{
  const f=fixture({complete:true}),intent={url:editUrl,goodsId,storeBindingKey:'shein-one',expectedSnapshot:requiredPlatformSnapshot(f.persisted.editor,f.persisted.fields)};
  const result=await f.adapter.verify({...f.args,preparationIntent:intent});assert.equal(result.saved,true);assert.equal(result.ready,false);assert.match(result.issues.join(''),/店小秘价格/);assert.equal(f.saves,0);
});

test('previously submitted source-price-v1 intentions keep their original readback policy',async()=>{
  const f=fixture({complete:true}),options={...f.args.pricePolicy,platform:'shein',goodsId,sourceFacts:f.args.sourceFacts},plan=planSourcePrices(f.persisted.fields,options);
  const priceEvidence={version:1,policy:'temu-source-price-v1',checkedAt:new Date().toISOString(),options,prices:plan.prices,ready:true,issues:[]};
  const intent={url:editUrl,goodsId,storeBindingKey:'shein-one',expectedSnapshot:requiredPlatformSnapshot(f.persisted.editor,f.persisted.fields),priceEvidence};
  const result=await f.adapter.verify({...f.args,sourceFacts:undefined,preparationIntent:intent});assert.equal(result.ready,true);assert.equal(result.priceEvidence.policy,'temu-source-price-v1');assert.equal(f.saves,0);
});

test('actual custom choices are clicked and read back without typing into a combobox search input',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="btn-user"><span class="user-name">${account}</span></div><div class="ant-form-item"><div class="ant-form-item-label"><label class="ant-form-item-required">材质</label></div><div class="ant-select" style="width:180px"><div class="ant-select-selector" style="height:40px;border:1px solid"><input id="material" readonly role="combobox" aria-required="true" aria-controls="options"></div></div></div><div id="options" role="listbox" style="display:none"><div id="steel" role="option" data-value="steel">钢</div><div id="other" role="option" data-value="other">其他</div></div><script>window.selected=[];document.querySelector('.ant-select-selector').onclick=()=>document.querySelector('#options').style.display='block';document.querySelectorAll('[role=option]').forEach(option=>option.onclick=()=>{selected.push(option.dataset.value);const span=document.createElement('span');span.className='ant-select-selection-item';span.textContent=option.textContent;document.querySelector('.ant-select').append(span);document.querySelector('#options').style.display='none';});</script>`}));
  await page.goto(editUrl);const cdp=await page.context().newCDPSession(page),owned={evaluate:(fn,arg)=>page.evaluate(fn,arg),send:(method,arg)=>cdp.send(method,arg)};
  const poll=async fn=>{for(let index=0;index<5;index++){const result=await fn();if(result)return result;await page.waitForTimeout(30);}throw new Error('choice fixture timeout');};
  const result=await completeOrdinaryChoices({page:owned,poll,expected:{url:editUrl,account}});
  assert.deepEqual(result.issues,[]);assert.equal(result.changes[0].value,'其他');assert.deepEqual(await page.evaluate(()=>selected),['other']);assert.equal(await page.locator('#material').inputValue(),'');
});

test('list pricing evidence reads OBM and supply CNY from the exact matched row',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="btn-user"><span class="user-name">${account}</span></div><p>共 1 条记录</p><table><thead><tr><th colid="title">产品</th><th colid="supply">供货价</th><th colid="original">原价</th></tr></thead><tbody><tr rowid="${draftId}"><td>「${storeName}」<div>OBM</div><a href="${sourceUrl}">来源</a></td><td colid="supply">CNY 12.30</td><td colid="original">USD 99.00</td></tr></tbody></table>`}));
  await page.goto(draftUrl);const result=await page.evaluate(readRequiredPlatformList,{url:draftUrl,account,editPath:'/web/sheinProduct/edit'});
  assert.deepEqual(result.rows[0].businessModes,['OBM']);assert.deepEqual(result.rows[0].priceCurrencies,['CNY']);
  const f=fixture();delete f.args.pricePolicy.businessMode;delete f.args.pricePolicy.targetCurrency;
  f.args.sourceFacts.price.currency='CNY';f.args.sourceFacts.variants[0].price.currency='CNY';
  f.args.row.inspection={pricingEvidence:{source:'matched-platform-list-row',platform:'shein',account,draftId,goodsId,storeName,businessMode:'OBM',priceCurrency:'CNY'}};
  assert.equal((await f.adapter.prepare(f.args)).ready,true);assert.equal(f.args.intent.priceEvidence.options.businessMode,'OBM');assert.equal(f.args.intent.priceEvidence.options.targetCurrency,'CNY');
});

test('SHEIN failed save readback remains unresolved and an existing intent cannot be saved again',async()=>{
  const f=fixture({saveNotPersisted:true}),result=await f.adapter.prepare(f.args);assert.equal(result.saved,null);assert.equal(result.ready,false);assert.equal(f.saves,1);assert.match(result.issues.join(),/未重复保存/);
  await assert.rejects(f.adapter.prepare({...f.args,row:{...f.args.row,saveIntent:{status:'unknown',payload:f.args.intent}}}),/保存|提交|核对/);assert.equal(f.saves,1);assert.equal(f.publishes,0);
});

test('SHEIN readback of a still-empty required numeric field cannot become ready just because a placeholder could be filled',async()=>{
  const f=fixture();const intent={url:editUrl,goodsId,storeBindingKey:'shein-one',expectedSnapshot:requiredPlatformSnapshot(f.persisted.editor,f.persisted.fields),priceEvidence:proof(f)};
  const result=await f.adapter.verify({...f.args,preparationIntent:intent});assert.equal(result.saved,true);assert.equal(result.ready,false);assert.match(result.issues.join(),/必填项仍未完成/);assert.equal(f.saves,0);assert.equal(f.moves,0);
});

test('SHEIN a lost save mouse acknowledgement pairs its release once and only permits read-only recovery',async()=>{
  const f=fixture({pressFailure:'保存'});await assert.rejects(f.adapter.prepare(f.args),/acknowledgement lost/);assert.equal(f.events.filter(event=>event==='mouse:mousePressed:保存').length,1);assert.equal(f.events.filter(event=>event==='mouse:mouseReleased:保存').length,1);assert.equal(f.saves,1);
  const recovered=await f.adapter.verify({...f.args,row:{...f.args.row,saveIntent:{status:'unknown',payload:f.args.intent}}});assert.equal(recovered.ready,true);assert.equal(f.saves,1);assert.equal(f.moves,0);assert.equal(f.publishes,0);
});

test('SHEIN pending movement verifies exact saved content and cannot reach either publish button',async()=>{
  const f=fixture();await f.adapter.prepare(f.args);f.args.row.saveIntent={status:'confirmed',payload:f.args.intent};f.args.row.saved=true;f.args.row.ready=true;
  const result=await f.adapter.moveToPending(f.args);assert.equal(result.publicationStatus,'draft');assert.equal(result.movedToPending,true);assert.equal(result.ready,true);assert.equal(result.published,false);assert.equal(result.submitted,false);assert.equal(f.moves,1);assert.equal(f.publishes,0);assert.ok(f.events.indexOf('move-intent')<f.events.indexOf('move-click'));
  const again=await f.adapter.moveToPending({...f.args,row:{...f.args.row,moveIntent:{status:'confirmed',payload:f.args.moveIntent}}});assert.equal(again.movedToPending,true);assert.equal(f.moves,1);
});

test('SHEIN unknown movement is reconciled without repeating it and changed saved values prevent a move',async()=>{
  const f=fixture();await f.adapter.prepare(f.args);f.args.row.saveIntent={status:'confirmed',payload:f.args.intent};f.state.unknownMove=true;
  const result=await f.adapter.moveToPending(f.args);assert.equal(result.publicationStatus,'unknown');assert.equal(result.movedToPending,false);assert.equal(f.moves,1);assert.equal(f.publishes,0);
  await assert.rejects(f.adapter.moveToPending({...f.args,row:{...f.args.row,moveIntent:{status:'unknown',payload:f.args.moveIntent}}}),/不能重复移动/);assert.equal(f.moves,1);
  const checked=await f.adapter.verifyPublication({...f.args,row:{...f.args.row,moveIntent:{status:'unknown',payload:f.args.moveIntent}}});assert.equal(checked.movedToPending,false);assert.equal(f.moves,1);
  const g=fixture();await g.adapter.prepare(g.args);g.args.row.saveIntent={status:'confirmed',payload:g.args.intent};g.persisted.fields.fields.find(item=>item.name==='price').value='99';const blocked=await g.adapter.moveToPending(g.args);assert.equal(blocked.ready,false);assert.equal(g.moves,0);assert.equal(g.publishes,0);
});

test('SHEIN editor classification must match the full selected path even when another branch has the same leaf name',async()=>{
  const f=fixture({wrongAppliedCategory:true}),result=await f.adapter.prepare(f.args);assert.equal(result.saved,false);assert.equal(result.ready,false);assert.equal(f.saves,0);assert.match(result.issues.join(),/分类/);
});

test('SHEIN inspection does not mark missing-source rows as unclaimed and does not accept another store',async()=>{
  const f=fixture({listRows:()=>[{draftId,sourceUrls:[],goodsIds:[],storeNames:[storeName],sites:[],title:'未读取完整来源'}]}),result=await f.adapter.inspect(f.args);assert.equal(result.rows[0].status,'needs-review');assert.match(result.rows[0].issues.join(),/来源|核对/);
  const g=fixture({listRows:()=>[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['另一店铺'],sites:[],title:'其他店铺商品'}]}),other=await g.adapter.inspect(g.args);assert.equal(other.rows[0].status,'unclaimed');assert.equal(g.saves,0);assert.equal(g.moves,0);
});

test('SHEIN fully unidentified visible rows block an unclaimed conclusion',async()=>{
  const f=fixture({listRows:()=>[{draftId,sourceUrls:[],goodsIds:[],storeNames:[],sites:[],title:'尚未完整读取的采集箱记录'}]}),result=await f.adapter.inspect(f.args);
  assert.equal(result.rows[0].status,'needs-review');assert.match(result.rows[0].issues.join(),/身份不完整/);assert.equal(f.saves,0);assert.equal(f.moves,0);assert.equal(f.publishes,0);
  assert.equal(f.openTargets,1);assert.ok(f.events.includes('detach:owned-1'));assert.ok(!f.events.includes('close:owned-1'));
});

test('a failed platform navigation preserves its page while releasing the automation session',async()=>{
  const f=fixture({navigationError:'net::ERR_CONNECTION_RESET'});
  await assert.rejects(f.adapter.inspect(f.args),/平台页面打开失败/);
  assert.equal(f.openTargets,1);assert.ok(f.events.includes('detach:owned-1'));assert.ok(!f.events.includes('close:owned-1'));
  assert.equal(f.saves,0);assert.equal(f.moves,0);assert.equal(f.publishes,0);
});

test('SHEIN configured site survives locating, saving and pending movement on store-only pages',async()=>{
  const f=fixture();f.args.storeBinding.site='美国站';f.args.row.site='美国站';
  const inspected=await f.adapter.inspect(f.args);assert.equal(inspected.rows[0].status,'located');
  assert.deepEqual(inspected.rows[0].siteEvidence,{configuredSite:'美国站',observedSite:'',fieldPresent:false});
  const prepared=await f.adapter.prepare(f.args);assert.equal(prepared.saved,true);assert.equal(prepared.ready,true);
  f.args.row.saveIntent={status:'confirmed',payload:f.args.intent};f.args.row.saved=true;f.args.row.ready=true;
  const moved=await f.adapter.moveToPending(f.args);assert.equal(moved.movedToPending,true);assert.equal(f.moves,1);assert.equal(f.publishes,0);
  assert.equal(f.args.storeBinding.site,'美国站');assert.equal(f.persisted.editor.site,'');
});

test('explicit mismatching or unreadable sites never become an unclaimed conclusion',async()=>{
  for(const evidence of [{sites:['加拿大'],siteColumnPresent:true},{sites:[],siteColumnPresent:true},{sites:[]}]){
    const f=fixture({listRows:()=>[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:[storeName],...evidence}]});
    f.args.storeBinding.site='美国站';f.args.row.site='美国站';
    const result=await f.adapter.inspect(f.args);assert.equal(result.rows[0].status,'needs-review');assert.equal(f.saves,0);assert.equal(f.moves,0);
  }
});

test('real editor and move readers distinguish absent SHEIN site fields from conflicting fields',async t=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.route(origin+'/**',route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));await page.goto(editUrl);
  const storeForm=`<div class="btn-user"><span class="user-name">${account}</span></div><div class="ant-form-item"><label class="ant-form-item-label">店铺账号</label><span class="ant-select-selection-item">${storeName}</span></div><input value="${sourceUrl}">`;
  const expected={url:editUrl,account,storeName,site:'美国站',goodsId};
  await page.setContent(storeForm);const absent=await page.evaluate(readRequiredPlatformEditor,expected);assert.equal(absent.siteFieldPresent,false);assert.equal(absent.site,'');
  for(const site of ['加拿大','']){
    await page.setContent(storeForm+`<div class="ant-form-item"><label class="ant-form-item-label">经营站点</label><span class="ant-select-selection-item">${site}</span></div>`);
    await assert.rejects(page.evaluate(readRequiredPlatformEditor,expected),/站点未能核实/);
  }
  await page.setContent(storeForm+'<div class="ant-form-item"><label class="ant-form-item-label">经营站点</label><span class="ant-select-selection-item">美国</span></div>');
  assert.equal((await page.evaluate(readRequiredPlatformEditor,expected)).site,'美国');
  const tiktokUrl=origin+'/web/tiktokProduct/edit?id='+draftId;await page.goto(tiktokUrl);await page.setContent(storeForm);
  await assert.rejects(page.evaluate(readRequiredPlatformEditor,{...expected,url:tiktokUrl}),/站点未能核实/);
  await page.goto(draftUrl);
  const listHtml=site=>`<div class="btn-user"><span class="user-name">${account}</span></div><table><thead><tr><th colid="title">产品标题</th>${site===null?'':'<th colid="site">站点</th>'}</tr></thead><tbody><tr rowid="${draftId}"><td>「${storeName}」<a href="${sourceUrl}">来源</a><button>移入待发布</button></td>${site===null?'':`<td colid="site">${site}</td>`}</tr></tbody></table><p>共 1 条记录</p>`;
  const move={expected:{...expected,url:draftUrl},locator:{draftId,text:'移入待发布'}};
  await page.setContent(listHtml(null));assert.ok(await page.evaluate(requiredPlatformUiPoint,move));
  assert.equal((await page.evaluate(readRequiredPlatformList,{...move.expected,editPath:'/web/sheinProduct/edit'})).rows[0].siteColumnPresent,false);
  await page.setContent(listHtml('加拿大'));await assert.rejects(page.evaluate(requiredPlatformUiPoint,move),/站点发生变化/);
  await page.setContent(listHtml(''));await assert.rejects(page.evaluate(requiredPlatformUiPoint,move),/站点发生变化/);
  await page.setContent(listHtml('美国'));assert.ok(await page.evaluate(requiredPlatformUiPoint,move));
});
