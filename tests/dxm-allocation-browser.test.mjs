import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {COLLECTION_URL} from '../src/collection-browser.mjs';
import {allocationSources,allocationDestinationKeys,assertAllocationDestinations,assertAllocationSelection,createDxmAllocationBrowser,readAllocationCollectionPage,readAllocationModal,allocationUiPoint,readAllocationDiagnostics,allocationHitIsStable,allocationTemplateControl,allocationTemplateEventProbe,directAllocationDestinations,assertDirectAllocationDestinations} from '../src/dxm-allocation-browser.mjs';

const source=(goodsId,id)=>({goodsId,sourceUrl:`https://www.temu.com/canvas-g-${goodsId}.html`,collectionEditUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=${id}`});
const sources=[source('601234567890001','220123456789001'),source('601234567890002','220123456789002')];
const destinations=[{platform:'temu',storeName:'店铺1',site:'加拿大'},{platform:'temu',storeName:'店铺2测试',site:'加拿大'}];
const snapshot={id:'4915',name:'画板',destinations};
const record=row=>({commonId:new URL(row.collectionEditUrl).searchParams.get('id'),editUrl:row.collectionEditUrl,rowId:new URL(row.collectionEditUrl).searchParams.get('id'),sourceUrls:[row.sourceUrl],goodsIds:[row.goodsId],checked:false,checkboxCount:1});

function environment(options={}){
  const events=[],mouseCommands=[],targets=new Map(),tabs={},selected=new Set(),catalog=[{id:'4913',name:'电器',destinations:[]},{id:'4915',name:'画板',destinations:[]}];
  let url='about:blank',pageIndex=0,lastPoint=null,modal=null,creates=0,confirms=0,closed=0,receipt=null,dropdownExpanded=false,keyboardOpened=false,templateGeometryReads=0,probeInstalled=false,pressTime=0;
  const pages=clone(options.pages||[sources.map(record)]);
  const browser={async send(method,args){
    if(method==='Target.createTarget'){const targetId='owned-'+(++creates);targets.set(targetId,{id:targetId,type:'page',url:args.url});events.push('create');return {targetId};}
    if(method==='Target.activateTarget'){assert.ok(targets.has(args.targetId));events.push('activate-'+args.targetId);return {};}
    if(method==='Target.closeTarget'){targets.delete(args.targetId);closed++;events.push('close-target');return {};}
    throw new Error('Unexpected browser command '+method);
  },close(){}};
  const page={async send(method,args){
    if(method==='Page.navigate'){
      url=args.url;pageIndex=0;modal=null;receipt=null;dropdownExpanded=false;keyboardOpened=false;selected.clear();events.push('navigate');for(const target of targets.values())target.url=url;return {};
    }
    if(method==='Input.dispatchMouseEvent'){
      events.push('mouse-'+lastPoint?.kind+'-'+args.type);
      mouseCommands.push({kind:lastPoint?.kind,...args,at:performance.now()});
      if(args.type==='mousePressed')pressTime=performance.now();
      if(lastPoint?.kind==='confirm'&&args.type==='mousePressed'&&options.uncertainPress){events.push('press-unknown');throw new Error('connection lost after press');}
      if(lastPoint?.kind==='templates'&&args.type==='mousePressed'&&options.templatePressError)throw new Error('template press acknowledgement failed');
      if(lastPoint?.kind==='templates'&&args.type==='mouseReleased'&&options.templateReleaseError)throw new Error('template release acknowledgement failed');
      if(lastPoint?.kind===options.pressErrorKind&&args.type==='mousePressed')throw new Error('control press acknowledgement failed');
      if(args.type!=='mouseReleased')return {};
      if(options.minimumPressMs&&performance.now()-pressTime<options.minimumPressMs)return {};
      const {kind,value,commonId}=lastPoint;events.push('click-'+kind);
      if(kind==='page'){pageIndex+=value==='下一页'?1:-1;if(options.lostSelection)selected.clear();}
      if(kind==='row')selected.add(commonId);
      if(kind==='batch'){modal={selectedNames:options.initialTemplate?['旧模板']:[],destinations:[],issues:[],skipDuplicates:false,loading:false,...(options.directShops?{shops:clone(options.directShops),siteOptions:clone(options.directSites||[])}:{})};dropdownExpanded=options.initialExpanded===true;}
      if(kind==='store'){const shop=modal.shops.find(item=>item.groupName===value.groupName&&item.storeName===value.storeName&&item.storeId===value.storeId);assert.equal(shop.checked,value.expectedChecked);shop.checked=!shop.checked;}
      if(kind==='site'){const site=modal.siteOptions.find(item=>item.groupName===value.groupName&&item.site===value.site);assert.equal(site.checked,value.expectedChecked);site.checked=!site.checked;}
      if(kind==='clear-template')modal.selectedNames=[];
      if(kind==='templates'&&!options.mouseLeavesCollapsed)dropdownExpanded=true;
      if(kind==='option')modal={...modal,selectedNames:[value],destinations:clone(options.changedDestinations||destinations),issues:options.modalIssues||[]};
      if(kind==='skip')modal.skipDuplicates=true;
      if(kind==='confirm'){confirms++;receipt=options.unknownResult?null:{status:'claimed',messages:['认领成功']};if(!options.unknownResult)modal=null;}
      if(kind==='close')modal=null;
      return {};
    }
    if(method==='Input.dispatchKeyEvent'){
      events.push('key-'+args.type+'-'+args.key);
      if(args.type==='rawKeyDown'&&args.key==='ArrowDown'&&!options.keyboardLeavesCollapsed){dropdownExpanded=true;keyboardOpened=true;}
      return {};
    }
    if(['Page.enable','Emulation.setFocusEmulationEnabled'].includes(method))return {};
    throw new Error('Unexpected page command '+method);
  },async evaluate(fn,arg){
    if(fn.name==='readAllocationCollectionPage')return {url,account:options.wrongAccount?'other-account':'fixture-account',rows:pages[pageIndex].map(row=>({...row,checked:selected.has(row.commonId)})),selectedCount:selected.size,total:pages.flat().length,previousEnabled:pageIndex>0,nextEnabled:pageIndex<pages.length-1,pageToken:String(pageIndex),search:options.search||'',allSelected:true};
    if(fn.name==='readAllocationModal'){
      if(modal?.shops){
        modal.destinations=modal.shops.filter(shop=>shop.checked).flatMap(shop=>(shop.platform==='temu'?modal.siteOptions.filter(site=>site.groupName===shop.groupName&&site.checked).map(site=>site.site):['']).map(site=>({platform:shop.platform,storeName:shop.storeName,storeId:shop.storeId,site})));
        modal.issues=modal.shops.some(shop=>shop.checked&&shop.platform==='temu'&&!modal.siteOptions.some(site=>site.groupName===shop.groupName&&site.checked))?['Temu模板未选择站点']:[];
      }
      return clone(modal);
    }
    if(fn.name==='readAllocationCatalog'){
      if(options.catalogError)throw new Error(options.catalogError);
      return options.catalogTimeout||(options.mouseLeavesCollapsed&&!keyboardOpened)?null:{templates:clone(options.changedCatalog||catalog),catalogComplete:!options.clipped};
    }
    if(fn.name==='allocationTemplateControl'){
      const control={selectorCount:1,comboboxCount:1,expanded:String(dropdownExpanded),canFocus:true,...options.templateControl};
      if(arg.focusIfCollapsed){assert.equal(control.expanded,'false');assert.equal(control.comboboxCount,1);assert.equal(control.selectorCount,1);assert.equal(control.canFocus,true);events.push('focus-template');}
      return {...control,focused:!!arg.focusIfCollapsed};
    }
    if(fn.name==='allocationTemplateEventProbe'){
      if(arg.action==='install'){assert.equal(probeInstalled,false);probeInstalled=true;events.push('probe-install');return {installed:true};}
      if(arg.action==='arm-pointer'){assert.equal(probeInstalled,true);events.push('probe-arm');return {armed:true};}
      if(arg.action==='after-pointer-down'){events.push('probe-after-press');if(options.templatePostPressError)throw new Error('template post-press read failed');return {safeToContinue:!options.templateControlChanged,...(options.templateOverlay?{hit:{targetRelation:'outside',targetTag:'DIV',targetRole:null,targetClasses:[]}}:{})};}
      if(arg.action==='finish-pointer'){events.push('probe-finish');return {finished:true};}
      if(arg.action==='remove'){assert.equal(probeInstalled,true);probeInstalled=false;events.push('probe-remove');return {installed:true,documentHasFocus:true,visibilityState:'visible',events:[]};}
      throw new Error('Unexpected event probe action');
    }
    if(fn.name==='readAllocationDiagnostics'){
      events.push('diagnostic');if(options.diagnosticFailure)throw new Error('diagnostic connection failure');
      return {pageTitle:'数据采集',pagePath:'/web/productCrawl/dataAcquisition',scroll:{x:0,y:900},modalCount:modal?1:0,selectedNames:modal?.selectedNames||[],visibleDropdownCount:0,dropdowns:[]};
    }
    if(fn.name==='readAllocationReceipt')return clone(receipt);
    if(fn.name==='allocationUiPoint'){
      if(arg.account!=='fixture-account')throw new Error('Unexpected expected account');lastPoint=arg;
      let y=10;if(arg.kind==='templates'){templateGeometryReads++;if(options.movingTemplate&&templateGeometryReads===1)y=110;events.push('geometry-template-'+y);}
      const point={x:40,y:y+10};return arg.withGeometry?{point,bounds:{x:20,y,width:40,height:20}}:point;
    }
    return true;
  },close(){}};
  const transport={async connection(){return {ws:'fixture',async targets(){return [...targets.values()];}};},async connect(){return browser;},async pageById(){return page;},async poll(fn,{label}={}){for(let i=0;i<4;i++){const result=await fn();if(result)return result;}throw Object.assign(new Error('timeout '+label),{code:'ERP_WAIT_TIMEOUT'});}};
  const args={browserConfig:{type:'chrome',key:'fixture-browser'},erpConnection:{key:'fixture-erp',expectedAccount:'fixture-account'},sourceRows:clone(sources),allocationSnapshot:clone(snapshot),tabs,onTarget(kind,id){tabs[kind]=id;events.push('persist-target');},beforeClaim(payload){events.push('intent');args.intent=clone(payload);options.afterIntent?.({selected,modal,pages,args});}};
  return {adapter:createDxmAllocationBrowser({},transport),args,events,mouseCommands,targets,selected,catalog,pages,get creates(){return creates;},get confirms(){return confirms;},get closed(){return closed;},get modal(){return modal;}};
}
const clone=value=>structuredClone(value);

function readRenderedRows(specs){
  const visibleNode=extra=>({getClientRects:()=>[{}],...extra});
  const rows=specs.map(spec=>visibleNode({
    getClientRects:()=>spec.hidden?[]:[{}],getAttribute:name=>name==='rowid'?spec.rowId||null:null,
    querySelectorAll(selector){
      if(selector==='a[href]')return (spec.links||[]).map(href=>visibleNode({href}));
      if(selector==='td.col--checkbox input[type="checkbox"]')return spec.checkbox?[visibleNode({checked:spec.checked===true,closest:()=>visibleNode({})})]:[];
      return [];
    }
  }));
  const document={body:{innerText:'共2条记录'},
    querySelector:selector=>selector==='.btn-user .user-name'?{textContent:'fixture-account'}:null,
    querySelectorAll(selector){
      if(['tr.vxe-body--row,tr','tr.vxe-body--row'].includes(selector))return rows;
      if(selector==='[role="tab"][aria-selected="true"]')return [{id:'collection-tab-'}];
      return [];
    }};
  return JSON.parse(JSON.stringify(runInNewContext('('+readAllocationCollectionPage.toString()+')()',{document,location:{href:COLLECTION_URL},URL,getComputedStyle:()=>({visibility:'visible',display:'block'})})));
}

test('rendered common rows join source, edit and checkbox VXE copies before identifying the product',()=>{
  const first=sources[0],second=sources[1],page=readRenderedRows([
    {rowId:'first',links:[first.sourceUrl]},
    {rowId:'first',links:[first.collectionEditUrl]},
    {rowId:'first',checkbox:true},
    {rowId:'first',hidden:true,links:[second.sourceUrl]},
    {rowId:'second',links:[second.sourceUrl,second.collectionEditUrl],checkbox:true}
  ]);
  assert.equal(page.rows.length,2);assert.equal(page.rows[0].commonId,new URL(first.collectionEditUrl).searchParams.get('id'));
  assert.deepEqual(page.rows[0].sourceUrls,[first.sourceUrl]);assert.deepEqual(page.rows[0].goodsIds,[first.goodsId]);
  assert.equal(page.rows[0].editUrl,first.collectionEditUrl);assert.equal(page.rows[0].checkboxCount,1);assert.equal(page.rows[0].checked,false);
  assert.deepEqual(page.rows[1].goodsIds,[second.goodsId]);assert.equal(page.selectedCount,0);
});

test('conflicting visible source IDs across copies remain blocked before claim intent',async()=>{
  const page=readRenderedRows([{rowId:'first',links:[sources[0].sourceUrl],checkbox:true},{rowId:'first',links:[sources[1].sourceUrl,sources[0].collectionEditUrl]}]);
  assert.deepEqual(page.rows[0].goodsIds,sources.map(source=>source.goodsId));
  const f=environment({pages:[[page.rows[0],record(sources[1])]]});
  await assert.rejects(f.adapter.claim(f.args),error=>error.message.includes('通用采集记录的来源编号与本批不一致')&&error.message.includes(sources[0].goodsId)&&error.message.includes(sources[1].goodsId));
  assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));assert.ok(!f.events.includes('click-row'));
});

test('rendered copies cannot bind different common record IDs or merge different rows by edit URL',()=>{
  assert.throws(()=>readRenderedRows([{rowId:'same',links:[sources[0].collectionEditUrl]},{rowId:'same',links:[sources[1].collectionEditUrl]}]),/多个商品记录/);
  assert.throws(()=>readRenderedRows([{rowId:'one',links:[sources[0].collectionEditUrl]},{rowId:'two',links:[sources[0].collectionEditUrl]}]),/不同列表行/);
});

test('source scope requires exact Temu identity and distinct verified common edit records',()=>{
  assert.equal(allocationSources(sources)[0].commonId,'220123456789001');
  for(const rows of [[],[sources[0],sources[0]],[{...sources[0],goodsId:sources[1].goodsId}],[{...sources[0],collectionEditUrl:'https://www.dianxiaomi.com.evil.test/web/productCrawl/edit?id=220123456789001'}],[{...sources[0],collectionEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=220123456789001'}]])assert.throws(()=>allocationSources(rows));
});

function directEnvironment(overrides={}){
  const shops=[{platform:'shein',groupName:'shein',storeName:'测试SHEIN店铺',storeId:'shop-101',checked:false,disabled:false},{platform:'temu',groupName:'popTemu',storeName:'无关店铺',storeId:'shop-999',checked:true,disabled:false}],sites=[{platform:'temu',groupName:'popTemu',site:'加拿大',checked:true,disabled:false},{platform:'temu',groupName:'popTemu',site:'美国',checked:false,disabled:false}];
  const f=environment({directShops:shops,directSites:sites,...overrides});f.args.destinations=[{platform:'shein',storeName:'测试SHEIN店铺',storeId:'shop-101',site:''}];delete f.args.allocationSnapshot;return f;
}

test('direct SHEIN allocation clears unrelated stores and records the exact batch without an ERP template',async()=>{
  const f=directEnvironment({initialTemplate:true}),result=await f.adapter.claimDestinations(f.args);
  assert.equal(result.status,'claimed');assert.equal(f.confirms,1);assert.ok(f.events.includes('click-clear-template'));assert.equal(f.events.filter(event=>event==='click-store').length,2);assert.ok(!f.events.includes('click-templates'));assert.ok(!f.events.includes('click-option'));
  assert.deepEqual(f.args.intent.destinations,f.args.destinations);assert.deepEqual(f.args.intent.goodsIds,sources.map(row=>row.goodsId));assert.equal(f.args.intent.skipDuplicates,true);assert.equal(f.args.intent.templateId,undefined);assert.ok(f.events.indexOf('intent')<f.events.indexOf('click-confirm'));
  await assert.rejects(f.adapter.claimDestinations(f.args),/不能重复提交/);assert.equal(f.confirms,1);
});

test('direct Temu allocation selects one observed site and retains exact configured store IDs',async()=>{
  const f=directEnvironment();f.args.destinations=[{platform:'temu',storeName:'无关店铺',storeId:'shop-999',site:'美国站'}];
  const result=await f.adapter.claimDestinations(f.args);assert.equal(result.status,'claimed');assert.deepEqual(f.args.intent.destinations,[{platform:'temu',storeName:'无关店铺',storeId:'shop-999',site:'美国'}]);assert.equal(f.events.filter(event=>event==='click-site').length,2);assert.equal(f.confirms,1);
});

test('SHEIN native checkbox default is read and selected without inventing a store ID',async t=>{
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="btn-user"><span class="user-name">fixture-account</span></div><div class="ant-modal"><div class="ant-modal-title">选择店铺-认领到采集箱</div><div class="shop-div" name="shein"><div class="shop-label-box"><label><input type="checkbox">测试SHEIN店铺</label></div></div></div>`}));
  await page.goto(COLLECTION_URL);
  assert.equal(await page.locator('input').inputValue(),'on');
  const before=await page.evaluate(readAllocationModal);
  assert.equal(before.shops[0].storeName,'测试SHEIN店铺');assert.equal(before.shops[0].storeId,'');
  const point=await page.evaluate(allocationUiPoint,{account:'fixture-account',kind:'store',value:{...before.shops[0],expectedChecked:false}});
  await page.mouse.click(point.x,point.y);
  const selected=await page.evaluate(readAllocationModal);
  assert.deepEqual(selected.destinations,[{platform:'shein',storeName:'测试SHEIN店铺',site:''}]);
  const expected=[{...selected.destinations[0],storeId:'legacy-manual-id'}];
  assert.throws(()=>assertDirectAllocationDestinations(selected.destinations,expected),/店铺编号/);
  assert.doesNotThrow(()=>assertDirectAllocationDestinations(selected.destinations,expected,{account:'fixture-account',pageUrl:COLLECTION_URL,shops:selected.shops},'fixture-account'));
});

test('SHEIN claim with an old configured ID uses fresh unique-name evidence and never fabricates an observed ID',async()=>{
  const shops=[{platform:'shein',groupName:'shein',storeName:'测试SHEIN店铺',storeId:'',checked:false,disabled:false}];
  const f=directEnvironment({directShops:shops});f.args.destinations[0].site='美国站';
  assert.equal((await f.adapter.claimDestinations(f.args)).status,'claimed');assert.equal(f.confirms,1);
  assert.equal(f.args.intent.destinations[0].storeId,'');assert.equal(f.args.destinations[0].storeId,'shop-101');
  assert.equal(f.args.intent.storeIdentityEvidence.account,'fixture-account');assert.deepEqual(f.args.intent.storeIdentityEvidence.shops,shops.map(({groupName,checked,...shop})=>shop));
  for(const change of [
    modal=>modal.shops.push({...modal.shops[0],checked:false}),
    modal=>{modal.shops[0].disabled=true;},
    modal=>{modal.shops[0].storeId='shop-101';}
  ]){
    const changed=directEnvironment({directShops:shops,afterIntent:({modal})=>change(modal)});
    await assert.rejects(changed.adapter.claimDestinations(changed.args),/重名|停用|编号发生变化/);assert.equal(changed.confirms,0);
  }
  const disappeared=directEnvironment({afterIntent:({modal})=>{modal.shops.find(shop=>shop.platform==='shein').storeId='';}});
  await assert.rejects(disappeared.adapter.claimDestinations(disappeared.args),/编号发生变化/);assert.equal(disappeared.confirms,0);
});

test('missing, ambiguous, disabled and conflicting stores produce distinct failures before any submission intent',async()=>{
  const shop={platform:'shein',groupName:'shein',storeName:'测试SHEIN店铺',storeId:'',checked:false,disabled:false};
  for(const [shops,message] of [[[],/未找到店铺/],[[shop,{...shop}],/重名/],[[{...shop,disabled:true}],/停用/],[[{...shop,storeId:'different-id'}],/编号.*不一致/]]){
    const f=directEnvironment({directShops:shops});await assert.rejects(f.adapter.claimDestinations(f.args),message);
    assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
  }
});

test('SHEIN accepts a configured site but journals only the actual store destination',async()=>{
  const f=directEnvironment();f.args.destinations[0].site='美国站';
  const result=await f.adapter.claimDestinations(f.args);
  assert.equal(result.status,'claimed');assert.equal(f.confirms,1);
  assert.equal(f.args.destinations[0].site,'美国站');assert.equal(f.args.intent.destinations[0].site,'');
  assert.equal(f.args.intent.destinations[0].storeId,'shop-101');assert.ok(!f.events.includes('click-site'));
  f.args.destinations[0].site='加拿大站';
  await assert.rejects(f.adapter.claimDestinations(f.args),/不能重复提交/);assert.equal(f.confirms,1);
});

test('direct destinations reject unavailable identity, duplicate names, missing sites and changed pre-submit selections',async()=>{
  for(const change of [f=>{f.args.destinations[0].storeId='wrong-id';},f=>{f.args.destinations[0].storeName='wrong-name';},f=>{f.args.destinations=[{platform:'temu',storeName:'无关店铺',storeId:'shop-999',site:'不存在站点'}];}]){
    const f=directEnvironment();change(f);await assert.rejects(f.adapter.claimDestinations(f.args));assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
  }
  const duplicated=directEnvironment({directShops:[{platform:'shein',groupName:'shein',storeName:'测试SHEIN店铺',storeId:'shop-101',checked:false},{platform:'shein',groupName:'shein',storeName:'测试SHEIN店铺',storeId:'shop-102',checked:false}]});delete duplicated.args.destinations[0].storeId;await assert.rejects(duplicated.adapter.claimDestinations(duplicated.args),/重名/);assert.equal(duplicated.confirms,0);
  const changed=directEnvironment({afterIntent({modal}){modal.shops.find(shop=>shop.platform==='shein').storeId='replaced-id';}});await assert.rejects(changed.adapter.claimDestinations(changed.args),/店铺编号/);assert.equal(changed.confirms,0);assert.equal(changed.events.filter(event=>event==='intent').length,1);
  const failedJournal=directEnvironment();failedJournal.args.beforeClaim=()=>{throw new Error('journal unavailable');};await assert.rejects(failedJournal.adapter.claimDestinations(failedJournal.args),/journal unavailable/);assert.equal(failedJournal.confirms,0);
});

test('direct allocation preserves unknown submission evidence and never automatically replays it',async()=>{
  for(const options of [{unknownResult:true},{uncertainPress:true}]){
    const f=directEnvironment(options),result=await f.adapter.claimDestinations(f.args);assert.equal(result.submitted,true);assert.equal(result.status,'needs-review');assert.match(result.issues.join(),/不能重复提交/);assert.equal(f.events.filter(event=>event==='intent').length,1);
    await assert.rejects(f.adapter.claimDestinations(f.args),/不能重复提交/);assert.ok(f.confirms<=1);
  }
});

test('SHEIN destination reading keeps the real checkbox ID and allows no invented station',()=>{
  const visible=extra=>({getClientRects:()=>[{}],...extra}),label={textContent:'测试SHEIN店铺'},input={value:'101',checked:true,disabled:false,closest:selector=>selector==='label'?label:null};
  const group={getAttribute:()=> 'shein',querySelectorAll:selector=>selector==='.shop-label-box input[type="checkbox"]'?[input]:[]};
  const modal=visible({querySelector:()=>({textContent:'选择店铺-认领到采集箱'}),querySelectorAll:selector=>selector==='.shop-div[name]'?[group]:[]});
  const document={querySelectorAll:selector=>selector==='.ant-modal'?[modal]:[]};
  const result=JSON.parse(JSON.stringify(runInNewContext('('+readAllocationModal.toString()+')()',{document,getComputedStyle:()=>({visibility:'visible',display:'block'})})));
  assert.deepEqual(result.destinations,[{platform:'shein',storeName:'测试SHEIN店铺',storeId:'101',site:''}]);assert.deepEqual(result.issues,[]);assert.equal(result.shops[0].groupName,'shein');
  assert.equal(directAllocationDestinations(result.destinations)[0].storeId,'101');assert.deepEqual(directAllocationDestinations([{...result.destinations[0],site:'美国站'}]),result.destinations);
  assert.throws(()=>directAllocationDestinations([result.destinations[0],{...result.destinations[0],site:'美国站'}]),/重复/);
  assert.throws(()=>assertDirectAllocationDestinations([{...result.destinations[0],storeId:'102'}],result.destinations),/店铺编号/);
});

test('allocation hit testing measures coordinates after instant scrolling',()=>{
  let scrollOptions,position={x:20,y:1000,width:40,height:20};
  const element={getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,querySelector:()=>null,contains:target=>target===element,
    scrollIntoView(options){scrollOptions=JSON.parse(JSON.stringify(options));if(options.behavior==='instant')position={...position,y:10};},getBoundingClientRect:()=>position};
  const modal={getClientRects:()=>[{}],closest:()=>null,querySelector:()=>({textContent:'选择店铺-认领到采集箱'}),querySelectorAll:()=>[element]};
  const document={querySelector:()=>({textContent:'fixture-account'}),querySelectorAll:selector=>selector==='.ant-modal'?[modal]:[],elementFromPoint:(x,y)=>x===40&&y===20?element:null};
  const point=runInNewContext('('+allocationUiPoint.toString()+')({account:"fixture-account",kind:"templates"})',{document,location:{href:COLLECTION_URL},getComputedStyle:()=>({visibility:'visible',display:'block'})});
  assert.deepEqual(scrollOptions,{block:'center',inline:'nearest',behavior:'instant'});assert.deepEqual(JSON.parse(JSON.stringify(point)),{x:40,y:20});
});

test('click stability rejects modal movement and missing geometry while accepting subpixel rounding',()=>{
  const first={point:{x:40,y:20},bounds:{x:20,y:10,width:40,height:20}};
  assert.equal(allocationHitIsStable(first,{point:{x:40.2,y:20.2},bounds:{x:20.2,y:10.2,width:40,height:20}}),true);
  assert.equal(allocationHitIsStable(first,{point:{x:40,y:120},bounds:{x:20,y:110,width:40,height:20}}),false);
  assert.equal(allocationHitIsStable(first,{point:first.point}),false);assert.equal(allocationHitIsStable(first,null),false);
});

test('keyboard targeting focuses only the sole visible collapsed native template combobox',()=>{
  function fixture({expanded='false',duplicate=false,account='fixture-account',type='text'}={}){
    const combo={tagName:'INPUT',type,disabled:false,getClientRects:()=>[{}],getAttribute:key=>key==='aria-expanded'?expanded:null,
      focus(options){assert.equal(options.preventScroll,true);document.activeElement=combo;}};
    Object.defineProperty(combo,'value',{get(){throw new Error('input value must not be read');}});
    const selector={getClientRects:()=>[{}],querySelectorAll:()=>duplicate?[combo,combo]:[combo]};
    const modal={getClientRects:()=>[{}],querySelector:()=>({textContent:'选择店铺-认领到采集箱'}),querySelectorAll:()=>[selector]};
    const document={activeElement:null,querySelector:()=>({textContent:account}),querySelectorAll:()=>[modal]};
    return focus=>JSON.parse(JSON.stringify(runInNewContext('('+allocationTemplateControl.toString()+')({account:"fixture-account",focusIfCollapsed:'+focus+'})',{document,location:{href:COLLECTION_URL},getComputedStyle:()=>({visibility:'visible',display:'block'})})));
  }
  assert.deepEqual(fixture()(true),{selectorCount:1,comboboxCount:1,expanded:'false',canFocus:true,focused:true});
  for(const options of [{expanded:'true'},{expanded:null},{duplicate:true},{type:'password'}])assert.throws(()=>fixture(options)(true),/未确认唯一且未展开/);
  assert.throws(()=>fixture({account:'other'})(true),/登录账号已变化/);
});

test('template event diagnostics observe only the bound control and allowed keys, cap events, and fully clean up',()=>{
  const handlers=new Map(),documentHandlers=new Map(),frames=new Map();let sequence=0,expanded='false';
  let rootOpen=false,rootDisabled=false;
  const root={classList:{contains:token=>token==='ant-select-open'?rootOpen:token==='ant-select-disabled'?rootDisabled:false}};
  const combo={isConnected:true,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:20,width:80,height:20}),getAttribute:key=>key==='aria-expanded'?expanded:null,closest:selector=>selector==='.ant-select'?root:null};
  Object.defineProperty(combo,'value',{get(){throw new Error('never read input values');}});
  const unrelated={value:'private-input-value'},child={};
  const selector={isConnected:true,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:10,width:100,height:40}),querySelectorAll:()=>[combo],contains:node=>[selector,combo,child].includes(node),
    addEventListener(type,handler,capture){assert.equal(capture,true);handlers.set(type,handler);},removeEventListener(type,handler,capture){assert.equal(capture,true);assert.equal(handlers.get(type),handler);handlers.delete(type);}};
  const modal={getClientRects:()=>[{}],querySelector:()=>({textContent:'选择店铺-认领到采集箱'}),querySelectorAll:()=>[selector]};
  const document={visibilityState:'visible',hasFocus:()=>true,querySelector:()=>({textContent:'fixture-account'}),querySelectorAll:()=>[modal],
    addEventListener(type,handler,capture){assert.equal(capture,true);documentHandlers.set(type,handler);},removeEventListener(type,handler,capture){assert.equal(capture,true);assert.equal(documentHandlers.get(type),handler);documentHandlers.delete(type);}};
  const window={requestAnimationFrame(callback){frames.set(++sequence,callback);return sequence;},cancelAnimationFrame(id){frames.delete(id);}};
  const invoke=action=>JSON.parse(JSON.stringify(runInNewContext('('+allocationTemplateEventProbe.toString()+')({account:"fixture-account",action:"'+action+'"})',{window,document,location:{href:COLLECTION_URL},getComputedStyle:()=>({visibility:'visible',display:'block'})})));
  const emit=(type,target,key)=>{const event={type,target,key,isTrusted:true,keyCode:40,which:key?40:1,button:0,buttons:type==='mousedown'?1:0,defaultPrevented:false};handlers.get(type)?.(event);return event;};
  const flush=()=>{for(const [id,callback] of [...frames]){frames.delete(id);callback();}};
  assert.equal(invoke('install').installed,true);assert.equal(handlers.size,5);assert.equal(documentHandlers.size,2);assert.equal(Object.getOwnPropertySymbols(window).length,1);
  assert.throws(()=>invoke('install'),/未重复安装/);
  emit('keydown',unrelated,'ArrowDown');emit('keydown',combo,'secret');emit('keydown',child,'Enter');emit('click',unrelated);
  assert.equal(invoke('read').events.length,0);
  const down=emit('mousedown',selector);down.defaultPrevented=true;expanded='true';rootOpen=true;rootDisabled=true;flush();
  emit('keydown',combo,'ArrowDown');emit('keyup',combo,'Enter');emit('keyup',combo,'Escape');flush();
  const read=invoke('read');assert.equal(read.events.length,4);assert.equal(read.documentHasFocus,true);assert.equal(read.visibilityState,'visible');
  assert.equal(read.events[0].targetIsSelector,true);assert.equal(read.events[0].targetIsCombo,false);assert.equal(read.events[0].ariaExpanded,'false');assert.equal(read.events[0].nextFrameAriaExpanded,'true');
  assert.equal(read.events[0].buttons,1);assert.equal(read.events[0].defaultPrevented,false);assert.equal(read.events[0].nextFrameDefaultPrevented,true);
  assert.equal(read.events[0].nextFrameRootOpen,true);assert.equal(read.events[0].nextFrameRootDisabled,true);
  assert.equal(read.events[0].nextFrameControls.selectorConnected,true);assert.equal(read.events[0].nextFrameControls.sameCombo,true);assert.deepEqual(read.events[0].nextFrameControls.freshComboBounds,{x:10,y:20,width:80,height:20});
  assert.equal(read.events[1].key,'ArrowDown');assert.equal(read.events[1].keyCode,40);assert.equal(read.events[1].which,40);assert.equal(read.events[1].isTrusted,true);assert.equal(read.events[1].targetIsCombo,true);
  for(let index=0;index<20;index++)emit('click',child);
  const result=invoke('remove');assert.equal(result.events.length,12);assert.equal(handlers.size,0);assert.equal(documentHandlers.size,0);assert.equal(frames.size,0);assert.equal(Object.getOwnPropertySymbols(window).length,0);
  assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('private-input-value'));assert.ok(!JSON.stringify(result).includes('fixture-account'));assert.equal(invoke('read'),null);
  selector.querySelectorAll=()=>[combo,combo];assert.equal(invoke('install').installed,false);assert.equal(handlers.size,0);invoke('remove');assert.equal(Object.getOwnPropertySymbols(window).length,0);
});

test('pointer diagnostics distinguish replaced nodes and only record the matching outside release during one click',()=>{
  const localHandlers=new Map(),documentHandlers=new Map(),frames=new Map();let frameId=0,comboY=20;
  const root={classList:{contains:()=>false}},bounds=()=>({x:0,y:10,width:100,height:40});
  const combo={tagName:'INPUT',isConnected:true,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:comboY,width:80,height:20}),closest:()=>root,getAttribute:()=>null};let freshCombo=combo;
  const selector={tagName:'DIV',isConnected:true,getClientRects:()=>[{}],getBoundingClientRect:bounds,querySelectorAll:()=>[freshCombo],contains:node=>[selector,combo,freshCombo].includes(node),
    addEventListener:(type,handler)=>localHandlers.set(type,handler),removeEventListener:type=>localHandlers.delete(type)};
  const modal={getClientRects:()=>[{}],querySelector:()=>({textContent:'选择店铺-认领到采集箱'}),querySelectorAll:()=>[selector]};
  const outside={tagName:'BUTTON',classList:{contains:token=>token==='ant-btn'},getAttribute:name=>name==='role'?'button':null};
  Object.defineProperty(outside,'value',{get(){throw new Error('private-value');}});Object.defineProperty(outside,'textContent',{get(){throw new Error('private-text');}});
  const document={visibilityState:'visible',hasFocus:()=>true,querySelector:()=>({textContent:'fixture-account'}),querySelectorAll:()=>[modal],elementFromPoint:()=>freshCombo,
    addEventListener:(type,handler)=>documentHandlers.set(type,handler),removeEventListener:type=>documentHandlers.delete(type)};
  const window={requestAnimationFrame(callback){frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id)};
  const invoke=(action,point)=>JSON.parse(JSON.stringify(runInNewContext('('+allocationTemplateEventProbe.toString()+')(args)',{args:{account:'fixture-account',action,point},window,document,location:{href:COLLECTION_URL},getComputedStyle:()=>({visibility:'visible',display:'block'})})));
  const emitOutside=(type,x=50)=>documentHandlers.get(type)?.({type,target:outside,clientX:x,clientY:30,button:0,buttons:0,isTrusted:true,defaultPrevented:false,which:1});
  invoke('install');emitOutside('mouseup');assert.equal(invoke('read').events.length,0);invoke('arm-pointer',{x:50,y:30});assert.equal(invoke('after-pointer-down').safeToContinue,true);
  document.elementFromPoint=()=>outside;const overlay=invoke('after-pointer-down');assert.equal(overlay.safeToContinue,true);assert.equal(overlay.hit.targetRelation,'outside');assert.equal(overlay.sameCombo,true);document.elementFromPoint=()=>freshCombo;
  localHandlers.get('mousedown')({type:'mousedown',target:combo,isTrusted:true,button:0,buttons:1,which:1,defaultPrevented:false});
  comboY=100;assert.equal(invoke('after-pointer-down').safeToContinue,false);
  freshCombo={...combo,isConnected:true};combo.isConnected=false;for(const [id,callback] of [...frames]){frames.delete(id);callback();}
  assert.equal(invoke('after-pointer-down').sameCombo,false);assert.equal(invoke('read').events[0].nextFrameControls.comboConnected,false);assert.equal(invoke('read').events[0].nextFrameControls.sameCombo,false);
  emitOutside('mouseup',400);assert.equal(invoke('read').events.length,2);emitOutside('mouseup');emitOutside('click');
  const observed=invoke('read');assert.equal(observed.events.length,3);assert.equal(observed.events[1].scope,'document');assert.equal(observed.events[1].targetRelation,'outside');assert.equal(observed.events[1].targetTag,'BUTTON');assert.equal(observed.events[1].targetRole,'button');assert.deepEqual(observed.events[1].targetClasses,['ant-btn']);
  invoke('finish-pointer');emitOutside('mouseup');assert.equal(invoke('read').events.length,3);invoke('remove');assert.equal(documentHandlers.size,0);assert.equal(localHandlers.size,0);assert.equal(frames.size,0);assert.equal(Object.getOwnPropertySymbols(window).length,0);
});

test('visible allocation diagnostics are bounded and exclude hidden labels and input values',()=>{
  const node=(text,{hidden=false,title,aria}={})=>({textContent:text,getClientRects:()=>hidden?[]:[{}],getAttribute:name=>name==='title'?title:name==='aria-label'?aria:null});
  const selected=[node('画板'),node('hidden-secret',{hidden:true})];
  const options=Array.from({length:30},(_,index)=>node(index===0?'长'.repeat(200):'模板'+index));options.push(node('hidden-secret',{hidden:true}));
  const root={className:'ant-select ant-select-disabled '+ 'x'.repeat(200),getAttribute:key=>key==='aria-disabled'?'true':null};
  const combos=Array.from({length:5},()=>({...node(''),tagName:'INPUT',type:'search',disabled:false,readOnly:true,closest:selector=>selector==='.ant-select'?root:null,getAttribute:key=>({role:'combobox','aria-expanded':'false','aria-controls':'template-options'})[key]||null,getBoundingClientRect:()=>({x:1500,y:210,width:180,height:30})}));
  for(const combo of combos)Object.defineProperty(combo,'value',{get(){throw new Error('input value must not be read');}});
  const modal={...node(''),querySelector:()=>node('选择店铺-认领到采集箱'),querySelectorAll:selector=>selector==='.ant-select-selection-item'?selected:selector==='.ant-select-selector [role="combobox"]'?combos:[]};
  const holder={...node(''),scrollTop:5,scrollHeight:1000,clientHeight:300};
  const dropdown={...node(''),querySelectorAll:selector=>selector==='.ant-select-item-option'?options:selector==='[role="option"][aria-label]'?[node('4915',{aria:'画板'})]:[holder]};
  const document={title:'数据采集 · 店小秘',querySelectorAll:selector=>selector==='.ant-modal'?[modal]:selector==='.ant-select-dropdown'?[dropdown]:[]};
  const result=JSON.parse(JSON.stringify(runInNewContext('('+readAllocationDiagnostics.toString()+')()',{document,location:{pathname:'/web/productCrawl/dataAcquisition',search:'?secret=never-read'},window:{scrollX:0,scrollY:900},getComputedStyle:()=>({visibility:'visible',display:'block'})})));
  assert.equal(result.modalCount,1);assert.deepEqual(result.selectedNames,['画板']);assert.equal(result.visibleDropdownCount,1);
  assert.equal(result.dropdowns[0].optionCount,30);assert.equal(result.dropdowns[0].optionLabels.length,12);assert.equal(result.dropdowns[0].optionLabels[0].length,120);assert.deepEqual(result.dropdowns[0].ariaOptionLabels,['画板']);
  assert.equal(result.comboboxCount,5);assert.equal(result.comboboxes.length,3);assert.equal(result.comboboxes[0].ariaExpanded,'false');assert.equal(result.comboboxes[0].ariaControls,'template-options');assert.deepEqual(result.comboboxes[0].bounds,{x:1500,y:210,width:180,height:30});
  assert.equal(result.comboboxes[0].rootClassName.length,160);assert.equal(result.comboboxes[0].rootAriaDisabled,'true');assert.equal(result.comboboxes[0].disabled,false);
  assert.equal(result.dropdowns[0].scrollTop,5);assert.equal(result.scroll.y,900);assert.ok(!JSON.stringify(result).includes('secret'));
});

test('the complete destination set includes store, site and TikTok mode; ordering and a site suffix do not change it',()=>{
  assert.doesNotThrow(()=>assertAllocationDestinations(destinations,[...destinations].reverse().map(item=>({...item,site:item.site+'站'}))));
  for(const changed of [[destinations[0]],[...destinations,{platform:'temu',storeName:'另一店',site:'加拿大'}],[{...destinations[0],site:'美国'},destinations[1]]])assert.throws(()=>assertAllocationDestinations(changed,destinations),/完整目的地/);
  assert.throws(()=>allocationDestinationKeys([destinations[0],destinations[0]]),/重复/);
  assert.throws(()=>assertAllocationDestinations([{platform:'tiktok',storeName:'日本店',site:'日本',mode:'0'}],[{platform:'tiktok',storeName:'日本店',site:'日本',mode:'1'}]),/完整目的地/);
});

test('selection verification catches another selected product even when the count is unchanged',()=>{
  const rows=sources.map(record);rows[1].checked=true;
  assert.throws(()=>assertAllocationSelection({selectedCount:1,rows},[rows[0].commonId]),/范围发生变化/);
  rows[0].checked=true;rows[1].checked=false;assert.doesNotThrow(()=>assertAllocationSelection({selectedCount:1,rows},[rows[0].commonId]));
});

test('catalog discovery closes without claiming and does not pretend unread destinations are known',async()=>{
  const f=environment({clipped:true}),result=await f.adapter.readTemplates(f.args);
  assert.equal(result.catalogComplete,false);assert.deepEqual(result.templates.map(row=>[row.id,row.name,row.destinations.length]),[['4913','电器',0],['4915','画板',0]]);
  assert.equal(f.confirms,0);assert.equal(f.modal,null);assert.ok(!f.events.includes('intent'));assert.equal(f.creates,1);
});

test('reading an exact named allocation template obtains its real destinations without submitting',async()=>{
  const f=environment(),result=await f.adapter.readTemplates({...f.args,templateName:'画板'});
  assert.deepEqual(result.templates,[snapshot]);assert.equal(result.catalogComplete,false);assert.equal(f.confirms,0);assert.equal(f.modal,null);
  assert.ok(f.events.includes('click-option'));assert.ok(!f.events.includes('intent'));assert.deepEqual(f.args.tabs,{allocation:'owned-1'});
  assert.deepEqual(f.events.filter(event=>event.startsWith('mouse-templates-')),['mouse-templates-mouseMoved','mouse-templates-mousePressed','mouse-templates-mouseReleased']);
  assert.ok(f.events.indexOf('activate-owned-1')<f.events.indexOf('navigate'));
  assert.ok(f.events.indexOf('probe-install')<f.events.indexOf('click-templates'));assert.ok(f.events.indexOf('probe-remove')<f.events.indexOf('click-option'));
});

test('template clicks wait for two matching positions after modal movement',async()=>{
  const f=environment({movingTemplate:true});await f.adapter.readTemplates(f.args);
  assert.deepEqual(f.events.filter(event=>event.startsWith('geometry-template-')),['geometry-template-110','geometry-template-10','geometry-template-10','geometry-template-10']);
  const lastGeometry=f.events.lastIndexOf('geometry-template-10');assert.ok(lastGeometry<f.events.indexOf('mouse-templates-mousePressed'));assert.equal(f.confirms,0);
});

test('changed controls and press/read/release failures pair the original release exactly once and stop subsequent input',async()=>{
  for(const [options,phase] of [[{templateControlChanged:true},'post-press-read'],[{templatePostPressError:true},'post-press-read'],[{templatePressError:true},'mouse-press'],[{templateReleaseError:true},'mouse-release']]){
    const f=environment(options);await assert.rejects(f.adapter.readTemplates(f.args),error=>{
      const diagnostics=error.data.allocationDiagnostics;assert.equal(diagnostics.pointerDelivery.phase,phase);assert.equal(diagnostics.pointerDelivery.releaseAttempted,true);
      assert.equal(diagnostics.pointerDelivery.releaseAcknowledged,!options.templateReleaseError);assert.equal(diagnostics.pointerDelivery.releaseFailed,!!options.templateReleaseError);assert.match(diagnostics.cleanupSkipped,/未再点击/);return true;
    });
    const commands=f.mouseCommands.filter(command=>command.kind==='templates');assert.deepEqual(commands.map(command=>command.type),['mouseMoved','mousePressed','mouseReleased']);
    assert.deepEqual([commands[1].x,commands[1].y],[commands[2].x,commands[2].y]);assert.ok(!f.events.includes('click-close'));assert.ok(!f.events.includes('focus-template'));assert.ok(!f.events.some(event=>event.startsWith('key-')));
    assert.ok(f.events.includes('probe-finish'));assert.ok(f.events.includes('probe-remove'));assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));assert.notEqual(f.modal,null);
  }
  const claim=environment({templateControlChanged:true});await assert.rejects(claim.adapter.claim(claim.args),/按下后发生变化/);assert.ok(!claim.events.includes('click-close'));assert.equal(claim.confirms,0);assert.ok(!claim.events.includes('intent'));
});

test('an expanded template control is read without toggling it closed',async()=>{
  const f=environment({initialExpanded:true});await f.adapter.readTemplates(f.args);
  assert.ok(!f.events.includes('click-templates'));assert.ok(!f.events.includes('focus-template'));assert.ok(!f.events.some(event=>event.startsWith('key-')));assert.equal(f.confirms,0);
});

test('a transient press overlay with unchanged controls succeeds after release without another click or keyboard input',async()=>{
  const f=environment({templateOverlay:true,minimumPressMs:25}),result=await f.adapter.readTemplates({...f.args,templateName:'画板'});
  assert.deepEqual(result.templates,[snapshot]);assert.equal(f.events.filter(event=>event==='click-templates').length,1);
  assert.ok(!f.events.some(event=>event.startsWith('key-')));assert.ok(!f.events.includes('focus-template'));assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
  for(let index=0;index<f.mouseCommands.length;index++)if(f.mouseCommands[index].type==='mousePressed'){
    const press=f.mouseCommands[index],release=f.mouseCommands[index+1];assert.equal(release.type,'mouseReleased');assert.equal(release.kind,press.kind);assert.ok(release.at-press.at>=25);assert.deepEqual([release.x,release.y],[press.x,press.y]);
  }
  assert.ok(f.events.includes('click-option'));assert.ok(f.events.includes('click-close'));
});

test('unknown or ambiguous combobox state and catalog ID errors do not trigger keyboard retries',async()=>{
  for(const options of [{templateControl:{expanded:null}},{templateControl:{comboboxCount:2}},{templateControl:{selectorCount:2}},{templateControl:{canFocus:false}},{templateControl:{expanded:'true'}},{catalogError:'认领模板编号读取失败'}]){
    const f=environment({mouseLeavesCollapsed:!options.catalogError,...options});await assert.rejects(f.adapter.readTemplates(f.args));
    assert.ok(!f.events.includes('focus-template'));assert.ok(!f.events.some(event=>event.startsWith('key-')));assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
  }
});

test('a still-collapsed catalog is diagnosed without another toggle or keyboard input',async()=>{
  const f=environment({mouseLeavesCollapsed:true});
  await assert.rejects(f.adapter.readTemplates(f.args),error=>error.data?.allocationDiagnostics?.stage==='read-catalog'&&error.data.allocationDiagnostics.templateEvents?.installed===true&&/认领分配模板目录/.test(error.message));
  assert.ok(!f.events.includes('focus-template'));assert.ok(!f.events.some(event=>event.startsWith('key-')));
  assert.ok(f.events.indexOf('probe-remove')<f.events.indexOf('diagnostic'));assert.ok(f.events.indexOf('probe-remove')<f.events.indexOf('click-close'));
  assert.equal(f.events.filter(event=>event==='click-templates').length,1);assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));assert.equal(f.modal,null);
});

test('option and close press failures still release once at the same point without issuing another press',async()=>{
  for(const kind of ['option','close']){
    const f=environment({pressErrorKind:kind});await assert.rejects(f.adapter.readTemplates({...f.args,templateName:'画板'}),/control press acknowledgement failed/);
    const commands=f.mouseCommands.filter(command=>command.kind===kind);assert.deepEqual(commands.map(command=>command.type),['mouseMoved','mousePressed','mouseReleased']);
    assert.deepEqual([commands[1].x,commands[1].y],[commands[2].x,commands[2].y]);assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
  }
});

test('catalog failures capture visible diagnostics before closing without claiming',async()=>{
  for(const diagnosticFailure of [false,true]){
    const f=environment({catalogTimeout:true,diagnosticFailure});
    await assert.rejects(f.adapter.readTemplates({...f.args,templateName:'画板'}),error=>{
      assert.match(error.message,/认领分配模板目录/);const diagnostics=error.data.allocationDiagnostics;
      assert.equal(diagnostics.stage,'read-catalog');
      if(diagnosticFailure)assert.match(diagnostics.captureError,/诊断读取失败/);
      else{assert.equal(diagnostics.modalCount,1);assert.equal(diagnostics.visibleDropdownCount,0);assert.equal(diagnostics.pagePath,'/web/productCrawl/dataAcquisition');}
      assert.ok(!JSON.stringify(diagnostics).includes('fixture-account'));return true;
    });
    assert.ok(f.events.indexOf('diagnostic')<f.events.indexOf('click-close'));assert.equal(f.modal,null);assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
  }
});

test('batch claim selects exact source records across pages, persists the full intent before one confirm and reuses only its owned tab',async()=>{
  const unrelated=record(source('601234567899999','220123456799999'));
  const f=environment({pages:[[record(sources[0]),unrelated],[record(sources[1])]]});
  await f.adapter.readTemplates({...f.args,templateName:'画板'});const result=await f.adapter.claim(f.args);
  assert.equal(result.status,'claimed');assert.equal(result.submitted,true);assert.equal(f.confirms,1);assert.equal(f.creates,1);
  assert.equal(f.events.filter(event=>event==='activate-owned-1').length,2);
  assert.deepEqual(f.args.intent,{templateId:'4915',templateName:'画板',goodsIds:sources.map(row=>row.goodsId),collectionEditUrls:sources.map(row=>row.collectionEditUrl),destinations,skipDuplicates:true});
  assert.ok(f.events.indexOf('intent')<f.events.indexOf('click-confirm'));assert.ok(!f.selected.has(unrelated.commonId));
  await assert.rejects(f.adapter.claim(f.args),/不能重复提交/);assert.equal(f.confirms,1);
});

test('wrong account, residual filters, missing source rows and mismatched common-record identities stop before claim intent',async()=>{
  for(const options of [{wrongAccount:true},{search:'old-filter'},{pages:[[record(sources[0])]]},{pages:[[{...record(sources[0]),goodsIds:['601234567899999']},record(sources[1])]]}]){
    const f=environment(options);await assert.rejects(f.adapter.claim(f.args));assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
  }
});

test('cross-page selection loss cannot silently turn a batch into only the final page',async()=>{
  const f=environment({pages:[[record(sources[0])],[record(sources[1])]],lostSelection:true});
  await assert.rejects(f.adapter.claim(f.args),/勾选范围/);assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));
});

test('changed template identity, additional destinations and unsupported destinations never authorize a claim',async()=>{
  for(const options of [{changedCatalog:[{id:'9999',name:'画板',destinations:[]}]},{changedDestinations:[...destinations,{platform:'temu',storeName:'另一店',site:'加拿大'}]},{modalIssues:['模板包含产品开发草稿箱']}]){
    const f=environment(options);await assert.rejects(f.adapter.claim(f.args));assert.equal(f.confirms,0);assert.ok(!f.events.includes('intent'));assert.equal(f.modal,null);
  }
});

test('failed persistence or changed selections after intent prevent the final click',async()=>{
  const failed=environment();failed.args.beforeClaim=()=>{throw new Error('disk full');};await assert.rejects(failed.adapter.claim(failed.args),/disk full/);assert.equal(failed.confirms,0);
  const changed=environment({afterIntent({modal}){modal.destinations=[destinations[0]];}});await assert.rejects(changed.adapter.claim(changed.args),/完整目的地/);assert.equal(changed.confirms,0);assert.equal(changed.modal,null);
  const swapped=environment({afterIntent({selected,pages}){selected.delete(pages[0][0].commonId);pages[0].push(record(source('601234567899999','220123456799999')));selected.add('220123456799999');}});
  await assert.rejects(swapped.adapter.claim(swapped.args),/范围发生变化/);assert.equal(swapped.confirms,0);
});

test('unknown claim receipts and an interrupted mouse dispatch are not submitted twice',async()=>{
  for(const options of [{unknownResult:true},{uncertainPress:true}]){
    const f=environment(options),result=await f.adapter.claim(f.args);
    assert.equal(result.status,'needs-review');assert.equal(result.submitted,true);assert.match(result.issues.join(''),/不能重复提交/);
    await assert.rejects(f.adapter.claim(f.args),/不能重复提交/);assert.equal(f.events.filter(event=>event==='intent').length,1);assert.ok(f.confirms<=1);
  }
});

test('a stop after persistent intent and a changed owned tab both prevent any submission',async()=>{
  let stopped=false;const f=environment({afterIntent(){stopped=true;}});f.args.isStopped=()=>stopped;
  await assert.rejects(f.adapter.claim(f.args),/已暂停/);assert.equal(f.confirms,0);
  const changed=environment();await changed.adapter.readTemplates({...changed.args,templateName:'画板'});changed.targets.get('owned-1').url='https://www.dianxiaomi.com/web/popTemu/edit?id=220123456789001';
  const navigations=changed.events.filter(event=>event==='navigate').length;
  await assert.rejects(changed.adapter.claim(changed.args),/已打开其他页面/);assert.equal(changed.events.filter(event=>event==='navigate').length,navigations);assert.equal(changed.confirms,0);
});

test('a failed target-registration write closes only the newly created tab',async()=>{
  const f=environment();f.targets.set('user-tab',{id:'user-tab',type:'page',url:COLLECTION_URL});
  f.args.onTarget=()=>{throw new Error('cannot persist task tab');};
  await assert.rejects(f.adapter.readTemplates(f.args),/cannot persist/);
  assert.equal(f.closed,1);assert.deepEqual([...f.targets.keys()],['user-tab']);assert.equal(f.confirms,0);assert.ok(!f.events.includes('navigate'));
});
