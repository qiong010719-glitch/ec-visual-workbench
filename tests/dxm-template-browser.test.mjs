import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browseDxmCategoryCatalog} from '../src/dxm-category-browser.mjs';
import {readTemplateCategoryPath} from '../src/dxm-listing-prepare.mjs';
import {createDxmTemplateBrowser,templateRules,templateSkuPlan,templateSkuValueIssues,fillTemplateSkuFields,resolveTemplateCandidates,templatePreservationIssues,templateRequiredPreservationIssues,templateSaveSnapshot,templateConfigurationIssues,templateEditorLoadingIssues,readTemplateList,templateUiAction,readTemplateEditDiagnostics,templateHitIsStable,readTemuCategoryCatalog} from '../src/dxm-template-browser.mjs';

const goodsId='601100000000001',sourceUrl=`https://www.temu.com/canvas-g-${goodsId}.html`;
const draftId='220114595121490272',platformEditUrl=`https://www.dianxiaomi.com/web/popTemu/edit?id=${draftId}`;
const binding={key:'shop-one',storeName:'店铺1',site:'加拿大站',warehouse:'加拿大仓',shippingTemplate:'加拿大',dispatch:'2个工作日内发货'};
const categoryPath=['家居、厨房用品','装饰字画','海报和印刷品'];
const template={id:'canvas',version:1,platform:'temu',category:{path:categoryPath,label:categoryPath.at(-1)},rules:{title:'preserve',pricing:{mode:'preserve'},attributes:{主题:'风景'}},storeBindings:[binding]};
const item=(label,value='',extra={})=>({label,controls:[],selections:value?[value]:[],checked:[],required:false,errors:[],placeholders:[],...extra});
function fixtureSnapshot(){
  return {url:platformEditUrl,account:'test-account',storeName:'店铺1',site:'加拿大站',sources:[sourceUrl],
    items:[item('产品标题','',{controls:[{name:'title',value:'Canvas  landscape'}]}),item('英文标题','',{controls:[{name:'englishTitle',value:'Canvas  landscape'}]}),item('产品分类','海报和印刷品'),item('运费模板','加拿大'),item('承诺发货时效','2个工作日内发货'),item('主题','',{controls:[{name:'theme',value:''}],required:true})],
    fields:{variationSku:['sku-1','sku-2'],price:['20','35'],skuLength:['30','60'],skuWidth:['20','40'],skuHeight:['2','3'],weight:['0.4','0.9'],stock:['10','7']},
    warehouses:['加拿大仓'],media:{main:['https://example.com/a.jpg'],detail:['https://example.com/b.jpg'],variants:['https://example.com/a.jpg']},variants:['size:30x20','size:60x40'],
    priceSnapshot:[{sku:'sku-1',declaredCurrency:'CNY',declaredPrice:'20'},{sku:'sku-2',declaredCurrency:'CNY',declaredPrice:'35'}]};
}
function requiredFixture(snapshot){
  const field=(key,name,label,value,extra={})=>({key,selector:key,shape:key,name,label,kind:'text',required:true,protected:false,value,empty:!String(value??'').trim(),options:[],errors:[],...extra});
  return {url:snapshot.url,account:snapshot.account,fields:[
    ...Object.entries(snapshot.fields).flatMap(([name,values])=>values.map((value,index)=>field(`sku:${name}:${index}`,name,name,value,{kind:name==='variationSku'?'text':'number',protected:name==='variationSku',rowIdentity:{id:String(index),sku:snapshot.fields.variationSku[index]}}))),
    ...snapshot.items.flatMap(item=>item.controls.filter(control=>!Object.hasOwn(snapshot.fields,control.name)).map((control,index)=>field(`item:${item.label}:${index}`,control.name,item.label,control.value,{required:item.required}))),
    ...(snapshot.extraRequiredFields||[]).map((value,index)=>field(`extra:${index}`,value.name,value.label,value.value,value))
  ]};
}
function environment(options={}){
  const events=[],targets=new Map(),persisted=new Map([[platformEditUrl,fixtureSnapshot()]]);let current=structuredClone(persisted.get(platformEditUrl)),url='about:blank',lastLocator,creates=0,saves=0,listPage=0,pendingPage=null,pageOverride=null,listNavigations=0,actualCategory=options.categoryPath||categoryPath,catalogPath=[];
  if(options.snapshot){persisted.set(platformEditUrl,structuredClone(options.snapshot));current=structuredClone(options.snapshot);}
  const browser={async send(method,args){events.push(method);if(method==='Target.createTarget'){const targetId='owned-'+(++creates);targets.set(targetId,{id:targetId,type:'page',url:'about:blank'});return {targetId};}if(method==='Target.getTargets')return {targetInfos:[...targets.values()].map(target=>({...target,targetId:target.id}))};if(method==='Target.activateTarget'){assert.ok(targets.has(args.targetId));events.push('activate:'+args.targetId);}if(method==='Target.closeTarget')targets.delete(args.targetId);return {};},close(){}};
  const page={async send(method,args){
    events.push(method);
    if(method==='Emulation.setFocusEmulationEnabled')events.push('focus-emulation:'+args.enabled);
    if(method==='Page.navigate'){url=args.url;if(url.endsWith('/pageList/draft')){listPage=0;pendingPage=null;pageOverride=null;listNavigations++;}for(const target of targets.values())target.url=url;if(persisted.has(url))current=structuredClone(persisted.get(url));return {};}
    if(method==='Input.insertText'){assert.equal(args.text,String(listPage+2));pendingPage=Number(args.text);events.push('page-input:'+pendingPage);}
    if(method==='Input.dispatchKeyEvent'&&args.type==='keyDown'&&args.key==='Enter'&&lastLocator?.editDraftId){events.push('edit-enter');events.push('edit-click');if(!options.editNoOpen)targets.set('child',{id:'child',type:'page',openerId:'owned-1',url:platformEditUrl});}
    else if(method==='Input.dispatchKeyEvent'&&args.type==='keyDown'&&args.key==='Enter'&&pendingPage){
      assert.equal(args.text,'\r');assert.equal(args.unmodifiedText,'\r');
      events.push('page-enter:'+pendingPage);
      if(options.pageNumberOnly)pageOverride=pendingPage;
      else if(options.pageRowsOnly){pageOverride=listPage+1;listPage=pendingPage-1;}
      else if(options.pageSkip){listPage=pendingPage;}
      else if(!options.pageNoop&&!(options.pageNoopAfterScan&&listNavigations>1))listPage=pendingPage-1;
    }
    if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'&&lastLocator?.text==='保存'){
      saves++;events.push('save-click');if(options.loseSave)return {};
      persisted.set(url,structuredClone(current));if(options.mutateAfterSave)options.mutateAfterSave(persisted.get(url));
    }
    if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'&&lastLocator?.text==='编辑'){events.push('edit-click');targets.set('child',{id:'child',type:'page',openerId:'owned-1',url:platformEditUrl});}
    if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'&&lastLocator?.text==='选择分类')events.push('category-open');
    if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'&&lastLocator?.categoryDepth!==undefined){catalogPath=[...catalogPath.slice(0,lastLocator.categoryDepth),lastLocator.text];events.push('category-browse:'+catalogPath.join(' > '));}
    if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'&&lastLocator?.paginationNext){events.push('page-next-click');if(!options.nextNoop)listPage++;}
    if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'&&lastLocator?.text==='选择'){current.items.find(item=>item.label==='产品分类').selections=[categoryPath.at(-1)];actualCategory=categoryPath;options.mutateOnCategory?.(current);}
    if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'&&lastLocator?.filterTitle){const filter=options.filters?.find(filter=>filter.title===lastLocator.filterTitle);if(filter)filter.selected=['全部'];events.push('reset-filter');}
    return {};
  },async evaluate(fn,arg){
    const name=fn.name;events.push(name||'anonymous');
    if(name==='readTemplateIdentity')return {url,account:options.wrongAccount?'other':'test-account',store:['店铺1'],site:['加拿大站'],sources:[options.wrongSource?'https://www.temu.com/x-g-601100000000099.html':sourceUrl],loaded:true};
    if(name==='readTemuListing')return structuredClone(options.editorSnapshots?.length?options.editorSnapshots.shift():current);
    if(name==='readRequiredFields')return structuredClone(requiredFixture(current));
    if(name==='fillRequiredFields'){
      const changes=[];
      for(const write of arg.plan.writes){
        const [type,key,index]=write.key.split(':');
        if(type==='sku'){current.fields[key][Number(index)]=write.value;if(key==='price')current.priceSnapshot[Number(index)].declaredPrice=write.value;}
        else if(type==='item')current.items.find(item=>item.label===key).controls[Number(index)].value=write.value;
        else if(type==='extra')current.extraRequiredFields[Number(key)].value=write.value;
        changes.push({key:write.key,label:write.label,value:write.value,reason:write.reason});events.push('required-fill:'+write.key);
      }
      options.mutateOnRequired?.(current);return {written:changes.length,changes};
    }
    if(name==='readDxmCategoryCatalog'){
      const tree=options.categoryTree||categoryPath.reduceRight((children,label,index)=>[{id:String(index+10),label,leaf:index===categoryPath.length-1,children}],[]),columns=[tree];let children=tree;
      for(const label of catalogPath){children=children.find(node=>node.label===label)?.children||[];if(children.length)columns.push(children);}
      return {path:catalogPath,columns:columns.map(column=>column.map(node=>({id:node.id||'',label:node.label,leaf:node.leaf??null,idSource:node.id?'dom:data-category-id':'observed-path'}))),loading:false,canSelect:catalogPath.length>0&&!children.length};
    }
    if(name==='readTemplateCategoryPath')return saves&&options.savedCategoryPath?options.savedCategoryPath:actualCategory;
    if(name==='readPackageUnits')return options.units||{dimension:'cm',weight:'kg'};
    if(name==='fillTemplateSkuFields'){
      assert.deepEqual(arg.plan.skus,current.fields.variationSku);events.push('sku-bulk-fill');
      for(const [name,value] of Object.entries(arg.plan.values))current.fields[name]=arg.plan.skus.map(()=>String(value));
      options.mutateOnBulk?.(current);return {written:arg.plan.skus.length*Object.keys(arg.plan.values).length};
    }
    if(name==='readCategoryDialog')return {boxes:categoryPath.map(value=>[value]),path:categoryPath};
    if(name==='readTemplateField')return {selects:0,radios:0,textInputs:1,multi:false};
    if(name==='readTemplateEditDiagnostics')return options.editDiagnostics||{draftId,pagePath:'/web/popTemu/pageList/draft',rowCopies:2,buttonCount:2,eligibleButtonCount:1,hitCount:options.editUnavailable?0:1,controls:[]};
    if(name==='templateUiAction'){
      if(arg.action==='page'){
        assert.deepEqual(arg.locator.paginationPage,{from:listPage+1,to:listPage+2,count:2});
        if(options.pageInputReadOnly)return null;
        lastLocator=arg.locator;events.push('page-select:'+arg.locator.paginationPage.to);return true;
      }
      if(arg.action==='fill'){const field=current.items.find(item=>item.label===arg.locator.formLabel);field.controls[0].value=arg.value;events.push('attribute-fill');return true;}
      lastLocator=arg.locator;
      if(arg.locator.editDraftId){events.push('edit-'+arg.action);if(options.editUnavailable)return null;if(arg.action==='focused'&&options.editCannotFocus)throw new Error('已核对的编辑按钮未取得焦点，未发送回车');}
      return arg.withGeometry?{point:{x:50,y:50},bounds:{x:20,y:30,width:60,height:40},...(arg.locator.editDraftId?{targetKey:arg.locator.editDraftId+':编辑'}:{})}:{x:50,y:50};
    }
    if(name==='readTemplateList')return {account:'test-account',rows:options.listPages?.[listPage]||options.listRows||[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl}],total:options.total??(options.listPages?.flat().length??options.listRows?.length??1),nextEnabled:!!options.listPages&&listPage<options.listPages.length-1,search:'',empty:options.total===0,filters:options.filters||[],pagerDiagnostics:options.pagerDiagnostics,pagerSelectionIssues:options.pagerSelectionIssues,...(options.numberedPages?{currentPage:options.badPageNumbers?null:pageOverride??listPage+1,pageInputCount:2,pageNumbers:options.badPageNumbers||[pageOverride??listPage+1,pageOverride??listPage+1]}:{})};
    if(fn.toString().replace(/\s/g,'')==='()=>location.href')return url;
    return true;
  },close(){}};
  const child={send:async()=>({}),async evaluate(fn,arg){if(fn.name==='readTemplateIdentity')return {url:platformEditUrl,account:'test-account',store:['店铺1'],site:['加拿大站'],sources:[sourceUrl],loaded:true};return page.evaluate(fn,arg);},close(){events.push('child-close');}};
  const transport={async connection(){return {ws:'mock',async targets(){return [...targets.values()]}};},async connect(){return browser;},async pageById(_info,id){return id==='child'?child:page;},async poll(fn){for(let i=0;i<3;i++){const result=await fn();if(result)return result;}throw Object.assign(new Error(options.pollTimeoutMessage||'test poll timeout'),{code:'ERP_WAIT_TIMEOUT'});}};
  const tabs={},args={browserConfig:{type:'chrome'},erpConnection:{expectedAccount:'test-account'},templateSnapshot:structuredClone(template),storeBinding:structuredClone(binding),row:{goodsId,sourceUrl,platformEditUrl,draftId},rows:[{goodsId,sourceUrl}],tabs,onTarget(kind,targetId){tabs[kind]=targetId;events.push('target-persist');},beforeSave(value){events.push('intent');args.preparationIntent=structuredClone(value);}};
  return {adapter:createDxmTemplateBrowser(options.configuration||{},transport),args,events,get current(){return current;},get saves(){return saves;},get creates(){return creates;},persisted};
}

test('template rules accept object and array attributes, retain store override, refuse unimplemented writes',()=>{
  const result=templateRules(template,{overrides:{attributes:[{label:'主题',value:'植物'}]}});
  assert.deepEqual(result.attributes,[{label:'主题',value:'植物'}]);assert.deepEqual(result.issues,[]);
  assert.match(templateRules({...template,rules:{pricing:{mode:'multiply',value:2}}}).issues.join(''),/pricing/);
  assert.match(templateRules({...template,rules:{attributes:{主题:''}}}).issues.join(''),/明确/);
});

function requiredMode(f){
  f.args.templateSnapshot.workflowMode='required-fields';f.args.templateSnapshot.completionMode='pending';f.args.templateSnapshot.rules={autoFillRequired:true,attributes:{主题:'风景'}};
  f.args.pricePolicy={targetCurrency:'CNY'};
  const variants=[{skuId:'sku-1',attributes:[{name:'尺寸',value:'30x20'}],price:{amount:'20',currency:'CNY',kind:'displayed-sale'}},{skuId:'sku-2',attributes:[{name:'尺寸',value:'60x40'}],price:{amount:'35',currency:'CNY',kind:'displayed-sale'}}];
  f.args.sourceFacts={version:1,platform:'temu',goodsId,sourceUrl,observedAt:new Date(Date.now()-1000).toISOString(),status:'ready',categoryPath,price:variants[0].price,selectedVariant:{skuId:'sku-1',attributes:variants[0].attributes,selectionComplete:true},variants,issues:[]};return f;
}
test('required mode rejects legacy templates and every completion target except pending before browser access',async()=>{
  for(const modes of [{},{workflowMode:'required-fields'},{completionMode:'pending'},{workflowMode:'fixed-template',completionMode:'pending'},{workflowMode:'required-fields',completionMode:'publish'}]){
    const f=environment();f.args.templateSnapshot={...f.args.templateSnapshot,...modes,rules:{autoFillRequired:true}};
    const result=await f.adapter.prepare(f.args);assert.equal(result.saved,false);assert.equal(result.status,'needs-review');assert.match(result.issues.join(''),/仅允许/);assert.equal(f.creates,0);assert.equal(f.saves,0);assert.equal(f.events.length,0);
  }
  const conflicting=requiredMode(environment());conflicting.args.workflowMode='fixed-template';conflicting.args.completionMode='publish';
  assert.equal((await conflicting.adapter.prepare(conflicting.args)).saved,false);assert.equal(conflicting.creates,0);
});
test('required mode fills only empty fields, preserves SKU facts and verifies all dynamic values after one save',async()=>{
  const snapshot=fixtureSnapshot();snapshot.fields.weight[1]='';snapshot.fields.stock[0]='0';
  snapshot.extraRequiredFields=[{name:'capacity',label:'容量',kind:'number',value:'',min:'0.25',max:'0.75',step:'0.25'}];
  const f=requiredMode(environment({snapshot}));f.args.templateSnapshot.rules.packageDefaults={lengthCm:999,widthCm:999,heightCm:999,weightKg:999};f.args.templateSnapshot.rules.inventory={mode:'fixed',quantity:999};
  const result=await f.adapter.prepare(f.args);
  assert.equal(result.saved,true);assert.equal(result.ready,true);assert.equal(f.saves,1);assert.ok(f.creates>=2);
  assert.deepEqual(result.snapshot.fields.price,['20','35']);assert.deepEqual(result.snapshot.fields.weight,['0.4','1']);assert.deepEqual(result.snapshot.fields.stock,['0','7']);assert.deepEqual(result.snapshot.fields.skuLength,['30','60']);
  assert.equal(result.snapshot.requiredFields.fields.find(field=>field.name==='capacity').value,'0.75');assert.ok(!f.events.includes('sku-bulk-fill'));
  assert.ok(f.args.preparationIntent.expectedSnapshot.requiredFields.some(field=>field.name==='capacity'&&field.value==='0.75'));
  assert.deepEqual(result.snapshot.media,snapshot.media);assert.deepEqual(result.snapshot.fields.variationSku,snapshot.fields.variationSku);
});

test('required Temu mode preserves existing DXM price per SKU and refuses altered saved-price evidence',async()=>{
  const snapshot=fixtureSnapshot();snapshot.fields.price[0]='99';snapshot.priceSnapshot[0].declaredPrice='99';
  const f=requiredMode(environment({snapshot})),result=await f.adapter.prepare(f.args);
  assert.equal(result.ready,true);assert.deepEqual(result.snapshot.fields.price,['99','35']);assert.equal(f.args.preparationIntent.priceEvidence.prices.length,2);assert.equal(result.priceEvidence.policy,'preserve-dxm-converted');
  const stored=f.persisted.get(platformEditUrl);stored.fields.price[0]='88';stored.priceSnapshot[0].declaredPrice='88';stored.requiredFields=requiredFixture(stored);stored.categoryPath=categoryPath;
  f.args.preparationIntent.expectedSnapshot=templateSaveSnapshot(stored);
  f.args.sourceFacts.variants[0].price.amount='88';const checked=await f.adapter.verify(f.args);
  assert.equal(checked.ready,false);assert.match(checked.issues.join(''),/发生变化/);assert.equal(f.saves,1);
});

test('required Temu mode never fills a missing DXM price even with source price and numeric defaults',async()=>{
  const snapshot=fixtureSnapshot();snapshot.fields.price[0]='';snapshot.priceSnapshot[0].declaredPrice='';
  const f=requiredMode(environment({snapshot})),result=await f.adapter.prepare(f.args);
  assert.equal(result.ready,false);assert.equal(f.saves,0);assert.equal(result.snapshot.fields.price[0],'');assert.match(result.issues.join(''),/店小秘价格为空|不会.*填价/);
});

test('Temu complete category reader accepts English translations but retains Chinese qualifiers',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<div><div class="category-item"><span class="ant-select-selection-item">海报和印刷品</span></div><div>家居、厨房用品(Home) > 装饰字画(Art) > 海报和印刷品(Posters and Prints)</div></div>');
  assert.deepEqual(await page.evaluate(readTemplateCategoryPath),['家居、厨房用品(Home)','装饰字画(Art)','海报和印刷品(Posters and Prints)']);
  await page.setContent('<div><div class="category-item"><span class="ant-select-selection-item">海报和印刷品</span></div><div>家居 > 海报和印刷品(儿童用)</div></div>');assert.deepEqual(await page.evaluate(readTemplateCategoryPath),[]);
});

test('required mode re-reads dynamic newly required inputs and fills authorized ordinary text defaults',async()=>{
  const snapshot=fixtureSnapshot();snapshot.fields.weight[0]='';
  const f=requiredMode(environment({snapshot,mutateOnRequired(current){current.extraRequiredFields??=[{name:'voltage',label:'额定电压',kind:'number',value:'',min:'2',step:'2'}];}}));
  const result=await f.adapter.prepare(f.args);assert.equal(result.ready,true);assert.equal(result.requiredCompletion.rounds,2);assert.equal(result.snapshot.requiredFields.fields.find(field=>field.name==='voltage').value,'2');
  const unknown=fixtureSnapshot();unknown.extraRequiredFields=[{name:'material',label:'材质',value:''}];
  const blocked=requiredMode(environment({snapshot:unknown})),blockedResult=await blocked.adapter.prepare(blocked.args);
  assert.equal(blockedResult.saved,true);assert.equal(blocked.saves,1);assert.equal(blockedResult.snapshot.requiredFields.fields.find(field=>field.name==='material').value,'其他');
});

test('required mode preserves existing logistics even when a binding carries a different default',async()=>{
  const snapshot=fixtureSnapshot();snapshot.items.find(item=>item.label==='运费模板').selections=['已有运费模板'];
  const f=requiredMode(environment({snapshot})),result=await f.adapter.prepare(f.args);
  assert.equal(result.ready,true);assert.deepEqual(result.snapshot.items.find(item=>item.label==='运费模板').selections,['已有运费模板']);
});

test('required mode selects the approved category before filling new attributes and refuses concurrent fact changes',async()=>{
  const snapshot=fixtureSnapshot();snapshot.items.find(item=>item.label==='产品分类').selections=[];
  const f=requiredMode(environment({snapshot,mutateOnCategory(current){current.extraRequiredFields=[{name:'power',label:'功率',kind:'number',value:'',min:'1'}];}}));
  const result=await f.adapter.prepare(f.args);assert.equal(result.ready,true);assert.ok(f.events.indexOf('category-open')<f.events.findIndex(event=>event.startsWith('required-fill:')));
  const changed=requiredMode(environment({mutateOnRequired(current){current.fields.price[0]='999';}}));
  await assert.rejects(changed.adapter.prepare(changed.args),/已有商品fields/);assert.equal(changed.saves,0);
});

test('required mode refuses to save without a chosen category or when a dynamic field was not persisted',async()=>{
  const missing=requiredMode(environment());missing.args.templateSnapshot.category={path:[]};
  const missingResult=await missing.adapter.prepare(missing.args);assert.equal(missingResult.saved,false);assert.equal(missing.creates,0);
  const snapshot=fixtureSnapshot();snapshot.extraRequiredFields=[{name:'capacity',label:'容量',kind:'number',value:''}];
  const f=requiredMode(environment({snapshot,mutateAfterSave(current){current.extraRequiredFields[0].value='';}})),result=await f.adapter.prepare(f.args);
  assert.equal(result.saveOutcome,'unknown');assert.equal(result.saved,null);assert.equal(f.saves,1);assert.match(result.issues.join(''),/快照不一致/);
  const otherCategory=requiredMode(environment({savedCategoryPath:['其他根分类','海报和印刷品']})),otherResult=await otherCategory.adapter.prepare(otherCategory.args);
  assert.equal(otherResult.saveOutcome,'unknown');assert.equal(otherCategory.saves,1);assert.deepEqual(otherCategory.args.preparationIntent.expectedSnapshot.categoryPath,categoryPath);
});

test('saved Temu category readback accepts complete bilingual paths but not changed parent qualifiers',async()=>{
  const f=requiredMode(environment({savedCategoryPath:categoryPath.map(label=>label+'(English Translation)')}));
  assert.equal((await f.adapter.prepare(f.args)).ready,true);assert.equal(f.saves,1);
  const g=requiredMode(environment({savedCategoryPath:[categoryPath[0]+'(儿童用)',...categoryPath.slice(1)]}));
  const result=await g.adapter.prepare(g.args);assert.equal(result.ready,false);assert.match(result.issues.join(''),/快照不一致/);assert.equal(g.saves,1);
});

test('required preservation allows only blank completion and snapshot omits unstable DOM selectors',()=>{
  const before=fixtureSnapshot(),after=structuredClone(before);before.fields.price[0]='';before.priceSnapshot[0].declaredPrice='';after.fields.price[0]='1';after.priceSnapshot[0].declaredPrice='1';
  assert.deepEqual(templateRequiredPreservationIssues(before,after),[]);after.fields.price[1]='99';assert.ok(templateRequiredPreservationIssues(before,after).length);
  before.requiredFields=requiredFixture(before);const changed=structuredClone(before);changed.requiredFields.fields.forEach(field=>{field.key='new-key';field.selector='#new';field.shape='new';field.id='new-id';});
  assert.deepEqual(templateSaveSnapshot(before),templateSaveSnapshot(changed));
});

test('category catalog browses actual branches in a disposable tab without applying a category or saving',async()=>{
  const categoryTree=[{id:'110',label:'家电',children:[{id:'111',label:'榨汁机',leaf:true}]},{label:'装饰品',children:[]}];
  const f=requiredMode(environment({categoryTree})),result=await f.adapter.readCategories({...f.args,path:[]});
  assert.deepEqual(result.options.map(option=>({label:option.label,leaf:option.leaf})),[{label:'家电',leaf:false},{label:'装饰品',leaf:true}]);
  assert.equal(result.options[0].id,'110');assert.equal(result.options[0].idSource,'dom:data-category-id');assert.match(result.options[1].id,/^path:[a-f0-9]{64}$/);assert.equal(result.options[1].idSource,'observed-path');
  assert.equal(f.saves,0);assert.ok(!f.events.includes('intent'));assert.ok(f.events.includes('Target.closeTarget'));assert.deepEqual(f.current.items.find(item=>item.label==='产品分类').selections,['海报和印刷品']);
  const child=await f.adapter.readCategories({...f.args,path:['家电']});assert.deepEqual(child.options[0].path,['家电','榨汁机']);assert.equal(child.options[0].leaf,true);
});

test('DOM category reader uses observed arrows, IDs and visible empty-state evidence without applying categories',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const body=`<meta charset="utf-8"><div class="btn-user"><span class="user-name">test-account</span></div><div class="ant-modal"><div class="ant-modal-title">选择类目</div><div class="modal-body"><div class="w-960"></div><div id="columns"></div></div><button id="select" disabled>选择</button></div><script>
    const tree=[{label:'办公和学习用品',children:[{label:'笔记本',id:'431',leaf:true}]},{label:'小家电'}];let chosen=[];window.applied=0;
    function render(){let children=tree,columns=[tree];for(const label of chosen){children=children.find(node=>node.label===label)?.children||[];if(children.length)columns.push(children);}document.querySelector('.w-960').textContent=chosen.join(' > ');document.querySelector('#select').disabled=!chosen.length||!!children.length;document.querySelector('#columns').innerHTML=columns.map((column,depth)=>'<div class="categories-box">'+column.map(node=>'<div class="categories-item" '+(node.id?'data-category-id="'+node.id+'"':'')+' '+(node.leaf?'data-leaf="true"':'')+'><span class="categories-item-name" data-depth="'+depth+'">'+node.label+'</span>'+(node.children?'<i class="iconfont icon_right"></i>':'')+'</div>').join('')+'</div>').join('');document.querySelectorAll('.categories-item-name').forEach(node=>node.onclick=()=>{chosen=[...chosen.slice(0,Number(node.dataset.depth)),node.textContent];render();});}document.querySelector('#select').onclick=()=>window.applied++;render();
  </script>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));await page.goto(platformEditUrl);
  const expected={url:platformEditUrl,account:'test-account'},snapshot=await page.evaluate(readTemuCategoryCatalog,{expected});
  assert.equal(snapshot.columns[0][0].leaf,false);assert.equal(snapshot.columns[0][1].leaf,null);assert.equal(snapshot.columns[0][0].id,'');
  const poll=async fn=>{for(let i=0;i<8;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('fixture poll timeout');};
  const point=async({categoryDepth,text})=>page.locator('.categories-box').nth(categoryDepth).getByText(text,{exact:true}).click();
  const root=await browseDxmCategoryCatalog({page,poll,point,expected,path:[]});assert.equal(root.options[0].leaf,false);assert.equal(root.options[1].leaf,true);assert.equal(await page.evaluate(()=>window.applied),0);
  const children=await browseDxmCategoryCatalog({page,poll,point,expected,path:['办公和学习用品']});assert.deepEqual(children.options,[{id:'431',label:'笔记本',path:['办公和学习用品','笔记本'],leaf:true,idSource:'dom:data-category-id'}]);assert.equal(await page.evaluate(()=>window.applied),0);
  await assert.rejects(page.evaluate(readTemuCategoryCatalog,{expected:{...expected,account:'other'}}),/账号发生变化/);
  await page.locator('.modal-body').evaluate(element=>{element.innerHTML='<div class="w-960"></div><div class="categories-box"></div><div class="ant-empty-description" style="display:none">暂无数据</div>';});
  assert.deepEqual((await page.evaluate(readTemuCategoryCatalog,{expected})).emptyEvidence,[]);
  await assert.rejects(browseDxmCategoryCatalog({page,poll,point,expected,path:[]}),/fixture poll timeout/);
  await page.locator('.ant-empty-description').evaluate(element=>element.style.display='block');
  assert.deepEqual((await page.evaluate(readTemuCategoryCatalog,{expected})).emptyEvidence,['暂无数据']);
  const empty=await browseDxmCategoryCatalog({page,poll,point,expected,path:[]});assert.deepEqual(empty,{path:[],options:[]});assert.equal(await page.evaluate(()=>window.applied),0);
  await page.locator('.modal-body').evaluate(element=>{element.insertAdjacentHTML('beforeend','<div class="ant-spin-spinning">加载中</div>');});
  await assert.rejects(browseDxmCategoryCatalog({page,poll,point,expected,path:[]}),/fixture poll timeout/);
});

test('candidate resolution separates stores and sites and requires explicit duplicate selection',()=>{
  const base={goodsId,storeName:'店铺1',site:'加拿大',draftId,platformEditUrl};
  const second={...base,draftId:'220114595121490273',platformEditUrl:platformEditUrl.replace(draftId,'220114595121490273')};
  const candidates=[base,base,{...base,site:'美国站'},second,{...base,storeName:'店铺2'}];
  assert.equal(resolveTemplateCandidates(candidates,{goodsId},binding).status,'ambiguous');
  assert.equal(resolveTemplateCandidates(candidates,{goodsId},binding,{draftId,platformEditUrl}).candidate.draftId,draftId);
  assert.equal(resolveTemplateCandidates(candidates,{goodsId},binding,{draftId:'missing',platformEditUrl}).status,'needs-review');
  assert.equal(resolveTemplateCandidates([],{goodsId},binding).status,'unclaimed');
});

test('product protection preserves different SKU dimensions, weights, stock, prices, media and titles',()=>{
  const original=fixtureSnapshot();
  for(const mutate of [s=>s.fields.weight[1]='0.4',s=>s.fields.stock[0]='100',s=>s.fields.price[1]='20',s=>s.items[0].controls[0].value='Other',s=>s.media.main=[]]){
    const changed=structuredClone(original);mutate(changed);assert.ok(templatePreservationIssues(original,changed).length);
  }
  const changed=structuredClone(original);changed.items.at(-1).controls[0].value='风景';assert.deepEqual(templatePreservationIssues(original,changed),[]);
});

test('save comparison normalizes only known product-title ASCII space behavior',()=>{
  const before=fixtureSnapshot(),after=structuredClone(before);after.items[0].controls[0].value='Canvas landscape';
  assert.deepEqual(templateSaveSnapshot(before),templateSaveSnapshot(after));
  after.items[1].controls[0].value='Canvas landscape';assert.notDeepEqual(templateSaveSnapshot(before),templateSaveSnapshot(after));
});

test('configuration verification does not accept a previous nonempty logistics value',()=>{
  const snapshot=fixtureSnapshot();snapshot.items.find(item=>item.label==='运费模板').selections=['美国'];
  assert.ok(templateConfigurationIssues(snapshot,templateRules(template),binding).some(issue=>issue.includes('运费模板')));
});

test('editor loading assessment distinguishes unread category and not-yet-read SKUs',()=>{
  const snapshot=fixtureSnapshot();snapshot.items.find(item=>item.label==='产品分类').selections=[];
  assert.match(templateEditorLoadingIssues(snapshot,categoryPath.join(' > ')).join(''),/分类尚未读取/);
  snapshot.items.find(item=>item.label==='产品分类').controls=[{name:'category',value:categoryPath.at(-1)}];
  assert.deepEqual(templateEditorLoadingIssues(snapshot,categoryPath.join(' > ')),[]);
  snapshot.fields.variationSku=[];
  assert.match(templateEditorLoadingIssues(snapshot).join(''),/SKU尚未读取完成/);
});

test('inspect waits for list-backed category and SKU loading before reporting field readiness',async()=>{
  const stale=fixtureSnapshot();stale.items.find(item=>item.label==='产品分类').selections=[];stale.fields.variationSku=[];
  const category=categoryPath.join(' > '),f=environment({editorSnapshots:[stale],listRows:[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl,category}]});
  const result=await f.adapter.inspect(f.args),row=result.rows[0];
  assert.equal(row.status,'located');assert.equal(row.listEvidence.category,category);assert.deepEqual(row.snapshot.fields.variationSku,['sku-1','sku-2']);
  assert.ok(!row.issues.some(issue=>/SKU为空|缺少产品分类/.test(issue)));assert.ok(f.events.filter(event=>event==='readTemuListing').length>=2);assert.equal(f.saves,0);
});

test('prepare does not overwrite category or save when list and editor loading disagree',async()=>{
  const stale=fixtureSnapshot();stale.items.find(item=>item.label==='产品分类').selections=[];stale.fields.variationSku=[];
  const f=environment({snapshot:stale});f.args.row.inspection={listEvidence:{category:categoryPath.join(' > ')}};
  const result=await f.adapter.prepare(f.args);
  assert.equal(result.status,'needs-review');assert.equal(result.saved,false);assert.match(result.issues.join(''),/分类尚未读取/);assert.equal(result.snapshot.fields.variationSku.length,0);
  assert.ok(!f.events.includes('category-open'));assert.ok(!f.events.includes('attribute-fill'));assert.ok(!f.events.includes('intent'));assert.equal(f.saves,0);
});

test('prepare recognizes an existing category control value without reopening category selection',async()=>{
  const snapshot=fixtureSnapshot(),category=snapshot.items.find(item=>item.label==='产品分类');category.selections=[];category.controls=[{name:'category',value:categoryPath.at(-1)}];
  const f=environment({snapshot}),result=await f.adapter.prepare(f.args);
  assert.equal(result.saved,true);assert.equal(result.ready,true);assert.equal(f.saves,1);assert.ok(!f.events.includes('category-open'));
});

test('inspect reads real source identity and retains duplicate candidate IDs without editing',async()=>{
  const f=environment({listRows:[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl},{draftId:'220114595121490273',sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl:platformEditUrl.replace(draftId,'220114595121490273')}]});
  const result=await f.adapter.inspect(f.args);assert.equal(result.rows[0].status,'ambiguous');assert.equal(result.rows[0].storeBindingKey,binding.key);assert.equal(result.rows[0].candidates.length,2);assert.equal(f.saves,0);assert.ok(!f.events.includes('attribute-fill'));
  f.args.resolvedTargets=[{goodsId,storeBindingKey:binding.key,draftId,platformEditUrl}];
  const resolved=await f.adapter.inspect(f.args);assert.equal(resolved.rows[0].status,'located');assert.equal(resolved.rows[0].draftId,draftId);assert.equal(f.creates,1);
});

test('inspect scan-only returns dated candidates without choosing a record or opening editors',async()=>{
  const record={draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl:null,createdAt:'2026-11-21 16:56:56',updatedAt:'2026-11-21 16:57:02',category:'家居、厨房用品 > 装饰字画 > 海报和印刷品'};
  const second={...record,draftId:'220114595121490273',createdAt:'2026-11-22 09:01:05'};
  const f=environment({listRows:[record,second]});f.args.scanOnly=true;
  const result=await f.adapter.inspect(f.args);
  assert.equal(result.scanOnly,true);assert.equal(result.rows[0].status,'ambiguous');assert.equal(result.rows[0].listOnly,true);
  assert.deepEqual(result.rows[0].candidates.map(candidate=>candidate.createdAt),[record.createdAt,second.createdAt]);
  assert.equal(result.rows[0].candidates[0].updatedAt,record.updatedAt);assert.equal(result.rows[0].candidates[0].category,record.category);
  assert.equal(result.rows[0].draftId,undefined);assert.ok(!f.events.includes('readTemplateIdentity'));assert.ok(!f.events.includes('readTemuListing'));assert.ok(!f.events.includes('edit-click'));assert.equal(f.saves,0);
  f.args.resolvedTargets=[{goodsId,storeBindingKey:binding.key,draftId,platformEditUrl}];
  const selected=await f.adapter.inspect(f.args);assert.equal(selected.rows[0].status,'needs-review');assert.equal(selected.rows[0].candidates.length,1);assert.equal(selected.rows[0].candidates[0].draftId,draftId);assert.equal(selected.rows[0].snapshot,undefined);
  assert.ok(!f.events.includes('readTemplateIdentity'));assert.equal(f.creates,1);
});

test('inspect scan-only does not declare unclaimed when a target list row has no visible source',async()=>{
  const f=environment({listRows:[{draftId,sourceUrls:[],goodsIds:[],storeNames:['店铺1'],site:'加拿大',platformEditUrl:null}]});f.args.scanOnly=true;
  const result=await f.adapter.inspect(f.args);
  assert.equal(result.rows[0].status,'needs-review');assert.equal(result.unresolvedListRecords,1);assert.match(result.rows[0].issues.join(''),/缺少来源链接/);
  assert.ok(!f.events.includes('readTemplateIdentity'));assert.ok(!f.events.includes('edit-click'));assert.equal(f.saves,0);
});

test('inspect refuses an incomplete paginated list rather than reporting unclaimed',async()=>{
  const f=environment({total:100});await assert.rejects(f.adapter.inspect(f.args),/分页未完整/);assert.equal(f.saves,0);
});

test('inspect reports bounded page, match and ordered per-target progress without exposing snapshots',async()=>{
  const secondGoodsId='601100000000002',outsideGoodsId='601100000000003';
  const f=environment({listPages:[[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl}],[{draftId:'220114595121490273',sourceUrls:[`https://www.temu.com/other-g-${outsideGoodsId}.html`],goodsIds:[outsideGoodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl:platformEditUrl.replace(draftId,'220114595121490273')}]]});
  f.args.rows.push({goodsId:secondGoodsId,sourceUrl:`https://www.temu.com/canvas-g-${secondGoodsId}.html`});
  const progress=[];f.args.onProgress=async event=>{await Promise.resolve();progress.push(event);};
  const result=await f.adapter.inspect(f.args);
  assert.deepEqual(progress.map(event=>event.stage),['page','page','matched','row-start','row-complete','row-start','row-complete']);
  assert.deepEqual(progress.slice(0,2).map(({page,scanned,total})=>({page,scanned,total})),[{page:1,scanned:1,total:2},{page:2,scanned:2,total:2}]);
  assert.deepEqual(progress[2].counts,{sources:2,stores:1,candidates:1,located:1,ambiguous:0,unclaimed:1,needsReview:0});
  assert.equal(progress[3].goodsId,goodsId);assert.equal(progress[3].rowIndex,1);assert.equal(progress[3].inspected,0);
  assert.equal(progress[4].result.status,'located');assert.equal(progress[4].result.draftId,draftId);assert.equal(progress[4].storeBindingKey,binding.key);
  assert.equal(progress.at(-1).goodsId,secondGoodsId);assert.equal(progress.at(-1).result.status,'unclaimed');assert.equal(progress.at(-1).inspected,2);
  assert.ok(!JSON.stringify(progress).includes('test-account'));assert.ok(progress.every(event=>!event.result?.snapshot&&!event.result?.platformEditUrl));assert.ok(progress.filter(event=>event.result).every(event=>event.result.issues.length<=10));
  assert.equal(result.rows[0].snapshot.account,'test-account');assert.equal(f.saves,0);
});

function numberedListPages(){
  const outsideId='601100000000099';return [[{draftId:'220114595121499999',sourceUrls:[`https://www.temu.com/other-g-${outsideId}.html`],goodsIds:[outsideId],storeNames:['店铺1'],site:'加拿大',platformEditUrl:platformEditUrl.replace(draftId,'220114595121499999')}],[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl:null}]];
}

test('verified numbered jumps bypass a no-op next button in both scan and observed-editor lookup',async()=>{
  const f=environment({listPages:numberedListPages(),numberedPages:true,nextNoop:true}),result=await f.adapter.inspect(f.args);
  assert.equal(result.scannedRecords,2);assert.equal(result.rows[0].status,'located');assert.equal(result.rows[0].draftId,draftId);
  assert.equal(f.events.filter(event=>event==='page-input:2').length,2);assert.equal(f.events.filter(event=>event==='page-enter:2').length,2);assert.equal(f.events.filter(event=>event==='page-next-click').length,0);assert.equal(f.events.filter(event=>event==='edit-click').length,1);assert.equal(f.saves,0);
  assert.ok(f.events.indexOf('page-select:2')<f.events.indexOf('page-input:2'));assert.ok(f.events.indexOf('page-input:2')<f.events.indexOf('page-enter:2'));
  assert.ok(f.events.includes('activate:owned-1'));assert.ok(f.events.indexOf('focus-emulation:true')<f.events.indexOf('page-select:2'));assert.equal(f.events.at(-1),'focus-emulation:false');
});

test('uneditable numbered input falls back to one next click and still verifies the page number',async()=>{
  const f=environment({listPages:numberedListPages(),numberedPages:true,pageInputReadOnly:true});f.args.scanOnly=true;
  const result=await f.adapter.inspect(f.args);assert.equal(result.scannedRecords,2);assert.equal(f.events.filter(event=>event==='page-next-click').length,1);assert.ok(!f.events.some(event=>event.startsWith('page-enter:')));
});

test('each operation activates its existing owned tab and releases focus emulation afterwards',async()=>{
  const f=environment();f.args.scanOnly=true;await f.adapter.inspect(f.args);await f.adapter.inspect(f.args);
  assert.equal(f.creates,1);assert.equal(f.events.filter(event=>event==='activate:owned-1').length,2);
  assert.deepEqual(f.events.filter(event=>event.startsWith('focus-emulation:')),['focus-emulation:true','focus-emulation:false','focus-emulation:true','focus-emulation:false']);
});

test('page-number mismatch, stale rows, stale page number, skipped pages and repeats never complete a scan',async()=>{
  for(const mode of ['badPageNumbers','pageNumberOnly','pageRowsOnly','pageSkip','pageNoop']){
    const options={listPages:numberedListPages(),numberedPages:true,[mode]:mode==='badPageNumbers'?[1,2]:true},f=environment(options);f.args.scanOnly=true;
    await assert.rejects(f.adapter.inspect(f.args),/不一致|跳过|timeout/,mode);assert.equal(f.saves,0);assert.ok(!f.events.includes('edit-click'));assert.ok(f.events.filter(event=>event.startsWith('page-enter:')).length<=1);
  }
  const pages=numberedListPages();pages.push(structuredClone(pages[0]));const repeated=environment({listPages:pages,numberedPages:true});repeated.args.scanOnly=true;
  await assert.rejects(repeated.adapter.inspect(repeated.args),/重复返回已读取页面/);assert.equal(repeated.saves,0);
});

test('pagination errors retain bounded input diagnostics and ambiguous inputs never trigger a click',async()=>{
  const pagerDiagnostics={pagerCount:2,pageInputCount:2,selectionIssues:[],inputs:[{pagerIndex:0,type:'text',title:'页数',ariaLabel:'',className:'vxe-pager--goto',value:'1',selected:true,pageSize:false}]};
  const f=environment({listPages:numberedListPages(),numberedPages:true,pageNoop:true,pagerDiagnostics});f.args.scanOnly=true;
  await assert.rejects(f.adapter.inspect(f.args),error=>{assert.equal(error.code,'ERP_WAIT_TIMEOUT');assert.deepEqual(error.data.pagerDiagnostics,{...pagerDiagnostics,initialPage:1,currentPage:1,targetPage:2});return true;});
  assert.equal(f.events.at(-1),'focus-emulation:false');
  const ambiguous=environment({listPages:numberedListPages(),pagerSelectionIssues:['分页区域存在多个页码候选输入框'],pagerDiagnostics});ambiguous.args.scanOnly=true;
  await assert.rejects(ambiguous.adapter.inspect(ambiguous.args),error=>{assert.ok(error.data.pagerDiagnostics);return /无法确认/.test(error.message);});
  assert.ok(!ambiguous.events.includes('page-next-click'));assert.ok(!ambiguous.events.some(event=>event.startsWith('page-enter:')));
});

test('per-row editor pagination failures retain only bounded redacted pager diagnostics and never become located',async()=>{
  const sensitive='fixture-secret test-account https://example.com/private?token=x ',pagerDiagnostics={pagerCount:2,pageInputCount:2,documentHasFocus:true,activeElementIsPageInput:true,rangeText:'第1-1条，共2条记录',selectionIssues:[],inputs:Array.from({length:20},(_,pagerIndex)=>({pagerIndex,type:'text',title:'页数',value:sensitive+'x'.repeat(400),selected:true,password:'private'})),account:'must-not-copy',snapshot:{private:true},other:'must-not-copy'};
  const f=environment({listPages:numberedListPages(),numberedPages:true,pageNoopAfterScan:true,pagerDiagnostics,pollTimeoutMessage:sensitive+'timeout '+'x'.repeat(400),configuration:{SADCAPTCHA_API_KEY:'fixture-secret'}}),progress=[];f.args.onProgress=event=>progress.push(event);
  const result=await f.adapter.inspect(f.args),row=result.rows[0],diagnostics=row.pagerDiagnostics,summary=progress.find(event=>event.stage==='row-complete').result;
  assert.equal(row.status,'needs-review');assert.equal(row.snapshot,undefined);assert.equal(f.saves,0);assert.ok(!f.events.includes('edit-click'));
  assert.equal(diagnostics.initialPage,1);assert.equal(diagnostics.targetPage,2);assert.equal(diagnostics.inputs.length,10);assert.ok(diagnostics.inputs.every(input=>input.value.length<=120&&!Object.hasOwn(input,'password')));assert.equal(diagnostics.account,undefined);assert.equal(diagnostics.snapshot,undefined);assert.equal(diagnostics.other,undefined);
  for(const value of [diagnostics,summary]){const text=JSON.stringify(value);assert.ok(!text.includes('fixture-secret'));assert.ok(!text.includes('test-account'));assert.ok(!text.includes('https://'));assert.ok(!text.includes('must-not-copy'));}
  assert.equal(summary.status,'needs-review');assert.equal(summary.issueCount,1);assert.equal(summary.issues.length,1);assert.ok(summary.issues[0].length<=300);assert.equal(summary.platformEditUrl,undefined);assert.equal(summary.snapshot,undefined);
});

test('edit activation uses focused native Enter once and unavailable or failed-open controls keep bounded diagnostics',async()=>{
  const rows=[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl:null}];
  const success=environment({listRows:rows}),result=await success.adapter.inspect(success.args);assert.equal(result.rows[0].status,'located');assert.equal(success.events.filter(value=>value==='edit-enter').length,1);assert.ok(success.events.indexOf('edit-focus')<success.events.indexOf('edit-focused'));assert.ok(success.events.includes('child-close'));
  for(const mode of ['editUnavailable','editCannotFocus','editNoOpen']){
    const f=environment({listRows:rows,[mode]:true,configuration:{API_KEY:'fixture-secret'},editDiagnostics:{draftId,rowCopies:2,hitCount:mode==='editUnavailable'?0:1,controls:Array.from({length:20},()=>({className:'fixture-secret test-account',bounds:{x:1,y:2,width:3,height:4}})),snapshot:{private:true},account:'test-account',url:platformEditUrl}});
    const failed=(await f.adapter.inspect(f.args)).rows[0];assert.equal(failed.status,'needs-review');assert.equal(failed.snapshot,undefined);assert.equal(failed.editDiagnostics.stage,mode==='editNoOpen'?'open-edit':'locate-edit');assert.equal(failed.editDiagnostics.controls.length,8);assert.equal(failed.editDiagnostics.snapshot,undefined);assert.equal(failed.editDiagnostics.account,undefined);assert.equal(failed.editDiagnostics.url,undefined);assert.ok(!JSON.stringify(failed.editDiagnostics).includes('fixture-secret'));assert.ok(!JSON.stringify(failed.editDiagnostics).includes('test-account'));assert.equal(f.events.filter(value=>value==='edit-enter').length,mode==='editNoOpen'?1:0);assert.equal(f.saves,0);
  }
});

test('hit stability rejects moving bounds, different targets and missing or invalid points',()=>{
  const a={point:{x:20,y:30},bounds:{x:10,y:20,width:20,height:20},targetKey:'draft:编辑'};assert.equal(templateHitIsStable(a,structuredClone(a)),true);
  assert.equal(templateHitIsStable(a,{...a,bounds:{...a.bounds,y:22}}),false);assert.equal(templateHitIsStable(a,{...a,targetKey:'other:编辑'}),false);assert.equal(templateHitIsStable(a,null),false);assert.equal(templateHitIsStable(a,{...a,point:{x:NaN,y:30}}),false);
});

test('inspect resets remembered filters and resolves a button-only editor through the actual child tab',async()=>{
  const f=environment({filters:[{title:'店铺账号:',selected:['店铺1']},{title:'站点:',selected:['加拿大']}],listRows:[{draftId,sourceUrls:[sourceUrl],goodsIds:[goodsId],storeNames:['店铺1'],site:'加拿大',platformEditUrl:null}]});
  const result=await f.adapter.inspect(f.args);assert.equal(result.rows[0].status,'located');assert.equal(result.rows[0].platformEditUrl,platformEditUrl);
  assert.equal(f.events.filter(event=>event==='reset-filter').length,2);assert.equal(f.events.filter(event=>event==='edit-click').length,1);assert.ok(f.events.includes('child-close'));assert.equal(f.saves,0);
});

test('prepare persists intent before one save and verifies after navigation, preserving SKU facts',async()=>{
  const f=environment(),original=fixtureSnapshot();
  const result=await f.adapter.prepare(f.args);
  assert.equal(result.saved,true);assert.equal(result.ready,true);assert.equal(result.published,false);assert.equal(f.saves,1);
  assert.ok(f.events.indexOf('intent')<f.events.indexOf('save-click'));
  assert.deepEqual(result.snapshot.fields,original.fields);
  assert.equal(result.snapshot.items.at(-1).controls[0].value,'风景');
  const verified=await f.adapter.verify(f.args);assert.equal(verified.saved,true);assert.equal(f.saves,1);assert.equal(f.creates,2,'one reusable task tab plus one closed readback tab');
});

test('required product facts missing after template fill prevent save without blanket defaults',async()=>{
  const snapshot=fixtureSnapshot();snapshot.fields.weight=['',''];const f=environment({snapshot});
  const result=await f.adapter.prepare(f.args);assert.equal(result.saved,false);assert.equal(f.saves,0);assert.ok(result.issues.some(issue=>issue.includes('weight')));assert.ok(!f.events.includes('intent'));
});

test('category selected without loaded SKUs returns an actionable missing-data result and snapshot',async()=>{
  const snapshot=fixtureSnapshot();snapshot.items.find(item=>item.label==='产品分类').selections=[];
  for(const name of Object.keys(snapshot.fields))snapshot.fields[name]=[];
  const f=environment({snapshot}),result=await f.adapter.prepare(f.args);
  assert.equal(result.status,'needs-review');assert.equal(result.saved,false);assert.equal(result.saveOutcome,'not-saved');assert.equal(result.ready,false);
  assert.ok(result.issues.some(issue=>issue.includes('已选择模板分类，但SKU仍未加载')));assert.equal(result.snapshot.fields.variationSku.length,0);
  assert.deepEqual(result.snapshot.items.find(item=>item.label==='产品分类').selections,[categoryPath.at(-1)]);
  assert.equal(f.saves,0);assert.ok(!f.events.includes('intent'));assert.ok(!f.events.includes('attribute-fill'));
});

test('an uncertain save never clicks twice and remains unknown on readback mismatch',async()=>{
  const f=environment({loseSave:true});const result=await f.adapter.prepare(f.args);
  assert.equal(result.saved,null);assert.equal(result.saveOutcome,'unknown');assert.equal(f.saves,1);
  const verified=await f.adapter.verify(f.args);assert.equal(verified.saved,null);assert.equal(f.saves,1);
});

test('source mismatch, missing intent, and a stop do not submit a save',async()=>{
  const wrong=environment({wrongSource:true});await assert.rejects(wrong.adapter.prepare(wrong.args),/来源商品/);assert.equal(wrong.saves,0);
  const noHook=environment();delete noHook.args.beforeSave;await assert.rejects(noHook.adapter.prepare(noHook.args),/持久化钩子/);assert.equal(noHook.saves,0);
  const stopped=environment();stopped.args.isStopped=()=>true;await assert.rejects(stopped.adapter.prepare(stopped.args),/已暂停/);assert.equal(stopped.creates,0);
});

test('unsupported platform has no browser side effects and publish is not exposed',async()=>{
  const f=environment();f.args.templateSnapshot.platform='tiktok';const result=await f.adapter.inspect(f.args);
  assert.equal(result.rows[0].status,'unsupported');assert.equal(f.creates,0);assert.equal(f.adapter.capabilities.publish,false);assert.equal(typeof f.adapter.publish,'undefined');
});

test('bulk plan converts kg to grams and requires every SKU and the exact warehouse',()=>{
  const rules=templateRules({...template,rules:{packageDefaults:{lengthCm:32,widthCm:22,heightCm:4,weightKg:.45},inventory:{mode:'fixed',quantity:10000}}});
  const snapshot=fixtureSnapshot(),plan=templateSkuPlan(snapshot,rules,binding,{dimension:'cm',weight:'g'});
  assert.deepEqual(plan.issues,[]);assert.deepEqual(plan.values,{skuLength:32,skuWidth:22,skuHeight:4,weight:450,stock:10000});
  assert.match(templateSkuPlan(snapshot,rules,binding,{dimension:null,weight:null}).issues.join(),/单位/);
  snapshot.fields.stock.pop();assert.match(templateSkuPlan(snapshot,rules,binding,{dimension:'cm',weight:'kg'}).issues.join(),/stock/);
  snapshot.warehouses=['其他仓'];assert.match(templateSkuPlan(snapshot,rules,binding,{dimension:'cm',weight:'kg'}).issues.join(),/仓库/);
  const kept=templateRules({...template,rules:{inventory:{mode:'fixed',quantity:10000}}},{overrides:{inventory:{mode:'preserve'}}});assert.equal(kept.inventory,null);
  const bad=templateRules({...template,rules:{packageDefaults:{lengthCm:1}}});assert.ok(bad.issues.length);assert.equal(bad.packageDefaults,null);
});

test('bulk defaults persist all SKU values while prices variants media and titles remain intact',async()=>{
  for(const quantity of [10000,0]){
    const f=environment({units:{dimension:'cm',weight:'g'}}),before=fixtureSnapshot();
    f.args.templateSnapshot.rules={...f.args.templateSnapshot.rules,packageDefaults:{lengthCm:32,widthCm:22,heightCm:4,weightKg:.45},inventory:{mode:'fixed',quantity}};
    const result=await f.adapter.prepare(f.args);assert.equal(result.saved,true);assert.equal(result.ready,true);assert.equal(f.saves,1);
    assert.deepEqual(result.snapshot.fields.stock,[String(quantity),String(quantity)]);assert.deepEqual(result.snapshot.fields.weight,['450','450']);assert.deepEqual(result.snapshot.fields.skuLength,['32','32']);
    assert.deepEqual(result.snapshot.fields.price,before.fields.price);assert.deepEqual(result.snapshot.variants,before.variants);assert.deepEqual(result.snapshot.media,before.media);
    assert.equal(f.args.preparationIntent.expectedSnapshot.fields.stock[0],String(quantity));assert.ok(f.events.indexOf('sku-bulk-fill')<f.events.indexOf('intent'));
  }
});

test('bulk writes refuse unknown units missing stock controls and unintended price changes before save',async()=>{
  const units=environment({units:{dimension:'cm',weight:null}});units.args.templateSnapshot.rules.packageDefaults={lengthCm:1,widthCm:2,heightCm:3,weightKg:1};
  const failed=await units.adapter.prepare(units.args);assert.equal(failed.saved,false);assert.match(failed.issues.join(),/单位/);assert.equal(units.saves,0);assert.ok(!units.events.includes('sku-bulk-fill'));
  const snapshot=fixtureSnapshot();snapshot.fields.stock=['1'];const missing=environment({snapshot});missing.args.templateSnapshot.rules.inventory={mode:'fixed',quantity:10000};
  assert.match((await missing.adapter.prepare(missing.args)).issues.join(),/stock/);assert.equal(missing.saves,0);
  const price=environment({mutateOnBulk:s=>s.fields.price[0]='1'});price.args.templateSnapshot.rules.inventory={mode:'fixed',quantity:10000};price.args.templateSnapshot.rules.saveMode='draft';
  assert.match((await price.adapter.prepare(price.args)).issues.join(),/price/);assert.equal(price.saves,0);
});

test('explicit category replace changes full path and rejects category-induced SKU or price loss',async()=>{
  const other=['家居、厨房用品','装饰字画','绘画作品'];
  const legacy=environment({categoryPath:other});assert.match((await legacy.adapter.prepare(legacy.args)).issues.join(),/未覆盖/);assert.equal(legacy.saves,0);
  const enabled=environment({categoryPath:other});enabled.args.templateSnapshot.rules.categoryMode='replace';const result=await enabled.adapter.prepare(enabled.args);
  assert.equal(result.saved,true);assert.ok(enabled.events.includes('category-open'));assert.deepEqual(result.snapshot.fields,fixtureSnapshot().fields);
  const loss=environment({categoryPath:other,mutateOnCategory:s=>{s.fields.price=['1'];}});loss.args.templateSnapshot.rules.categoryMode='replace';loss.args.templateSnapshot.rules.saveMode='draft';
  await assert.rejects(loss.adapter.prepare(loss.args),/price/);assert.equal(loss.saves,0);assert.ok(!loss.events.includes('sku-bulk-fill'));
});

test('draft mode saves packaging omissions once but does not mark the product ready to publish',async()=>{
  const snapshot=fixtureSnapshot();snapshot.fields.weight=['',''];const f=environment({snapshot});f.args.templateSnapshot.rules.saveMode='draft';f.args.templateSnapshot.rules.inventory={mode:'fixed',quantity:10000};
  const result=await f.adapter.prepare(f.args);assert.equal(result.saved,true);assert.equal(result.ready,false);assert.equal(result.published,false);assert.equal(f.saves,1);assert.match(result.issues.join(),/weight/);
  assert.equal(f.args.preparationIntent.saveMode,'draft');assert.match(f.args.preparationIntent.readinessIssues.join(),/weight/);
  const dry=environment({snapshot});dry.args.templateSnapshot.rules.saveMode='draft';dry.args.dryRun=true;
  const preview=await dry.adapter.prepare(dry.args);assert.equal(preview.readyToSave,true);assert.equal(preview.saved,false);assert.equal(dry.saves,0);
  const nonPackage=fixtureSnapshot();nonPackage.items.push(item('产地','',{required:true,placeholders:['请选择省份']}));
  const blocked=environment({snapshot:nonPackage});blocked.args.templateSnapshot.rules.saveMode='draft';
  const blockedResult=await blocked.adapter.prepare(blocked.args);assert.equal(blockedResult.saved,false);assert.match(blockedResult.issues.join(),/产地/);assert.equal(blocked.saves,0);
});

test('manual package correction reads persisted values without saving or accepting unrelated edits',async()=>{
  const f=environment();await f.adapter.prepare(f.args);const original=structuredClone(f.args.preparationIntent.expectedSnapshot);
  f.persisted.get(platformEditUrl).fields.weight[1]='1.2';f.persisted.get(platformEditUrl).fields.skuHeight[1]='5';
  const accepted=await f.adapter.reviewCorrections(f.args);assert.equal(accepted.reviewAccepted,true);assert.equal(accepted.readOnly,true);assert.equal(accepted.ready,true);assert.equal(accepted.expectedSnapshot.fields.weight[1],'1.2');assert.equal(f.saves,1);assert.deepEqual(f.args.preparationIntent.expectedSnapshot,original);
  f.persisted.get(platformEditUrl).fields.stock[0]='999';const denied=await f.adapter.reviewCorrections(f.args);assert.equal(denied.reviewAccepted,false);assert.match(denied.issues.join(),/其他资料/);assert.equal(f.saves,1);
});

test('DOM bulk writes bind all inputs to their original SKU rows before any value changes',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const group=(label,value)=>`<div class="ant-form-item"><label class="ant-form-item-label">${label}</label><span class="ant-select-selection-item">${value}</span></div>`;
  const row=sku=>`<tr><td><input name="variationSku" value="${sku}"></td>${['skuLength','skuWidth','skuHeight','weight','stock'].map(name=>`<td><input name="${name}" value="1"></td>`).join('')}</tr>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div class="btn-user"><span class="user-name">test-account</span></div>${group('店铺账号','店铺1')}${group('经营站点','加拿大站')}<input value="${sourceUrl}"><div class="in-selector ant-select-multiple ant-select-allow-clear"><span class="ant-select-selection-item" title="加拿大仓">加拿大仓</span></div><table>${row('sku-1')}${row('sku-2')}</table>`}));
  await page.goto(platformEditUrl);const expected={url:platformEditUrl,account:'test-account',storeName:'店铺1',site:'加拿大站',sourceUrl},plan={skus:['sku-1','sku-2'],warehouse:'加拿大仓',values:{stock:10000,weight:.5}};
  await page.locator('input[name="stock"]').nth(1).evaluate(input=>input.readOnly=true);
  await assert.rejects(page.evaluate(fillTemplateSkuFields,{expected,plan}),/不可编辑/);assert.deepEqual(await page.locator('input[name="stock"]').evaluateAll(inputs=>inputs.map(e=>e.value)),['1','1']);
  await page.locator('input[name="stock"]').nth(1).evaluate(input=>input.readOnly=false);await page.evaluate(fillTemplateSkuFields,{expected,plan});
  assert.deepEqual(await page.locator('input[name="stock"]').evaluateAll(inputs=>inputs.map(e=>e.value)),['10000','10000']);assert.deepEqual(await page.locator('input[name="weight"]').evaluateAll(inputs=>inputs.map(e=>e.value)),['0.5','0.5']);
  await page.locator('input[name="stock"]').nth(1).evaluate(input=>{const other=document.querySelector('tr');other.append(input);});
  await assert.rejects(page.evaluate(fillTemplateSkuFields,{expected,plan:{...plan,values:{stock:0}}}),/所在规格行/);assert.deepEqual(await page.locator('input[name="stock"]').evaluateAll(inputs=>inputs.map(e=>e.value)),['10000','10000']);
  await assert.rejects(page.evaluate(fillTemplateSkuFields,{expected:{...expected,storeName:'别的店铺'},plan}),/店铺/);
});

test('DOM list reader merges VXE fixed-column copies and reads exact site/store/source with active filters',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div class="btn-user"><span class="user-name">test-account</span></div><div class="in-screen-single"><span class="title">店铺账号:</span><span class="d-tag-group-item active">店铺1</span></div><input name="tableSearchInput"><div>第1-1条，共1条记录</div><table><thead><tr><th colid="col_9">站点</th></tr></thead><tbody><tr class="vxe-body--row" rowid="${draftId}"><td><a href="${sourceUrl}">Temu</a><p>「店铺1」</p></td><td colid="col_9"><div class="no-new-line3" title="加拿大">加拿大</div><p>--</p></td></tr><tr class="vxe-body--row" rowid="${draftId}"><td><button>编辑</button><p>创建：</p><p>2026-11-21 16:56:56</p></td><td colid="col_9"><div>加拿大</div><div>家居、厨房用品 &gt; 装饰字画 &gt; 海报和印刷品</div></td></tr><tr class="vxe-body--row" rowid="${draftId}"><td><p>更新：</p><p>2026-11-21 16:57:02</p></td></tr><tr class="vxe-body--row" rowid="${draftId}" style="display:none"><td>创建：2099-01-01 00:00:00</td></tr></tbody></table><button class="vxe-pager--next-btn is--disabled" disabled>下一页</button>`}));
  await page.goto('https://www.dianxiaomi.com/web/popTemu/pageList/draft');const result=await page.evaluate(readTemplateList);
  assert.equal(result.rows.length,1);assert.deepEqual(result.rows[0].goodsIds,[goodsId]);assert.deepEqual(result.rows[0].storeNames,['店铺1']);assert.equal(result.rows[0].site,'加拿大');assert.equal(result.rows[0].draftId,draftId);assert.equal(result.nextEnabled,false);assert.deepEqual(result.filters,[{title:'店铺账号:',selected:['店铺1']}]);
  assert.equal(result.rows[0].createdAt,'2026-11-21 16:56:56');assert.equal(result.rows[0].updatedAt,'2026-11-21 16:57:02');assert.equal(result.rows[0].category,'家居、厨房用品 > 装饰字画 > 海报和印刷品');
});

test('duplicate pagination controls use the top matching pager only and reject mismatched pages',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div class="btn-user"><span class="user-name">test-account</span></div><div class="vxe-pager" id="top"><input value="1"><button class="vxe-pager--next-btn" onclick="document.body.dataset.clicked='top'">下一页</button></div><div style="height:150px">采集箱列表</div><div class="vxe-pager" id="bottom"><input value="1"><button class="vxe-pager--next-btn" onclick="document.body.dataset.clicked='bottom'">下一页</button></div><button>保存</button><button>保存</button>`}));
  const url='https://www.dianxiaomi.com/web/popTemu/pageList/draft';await page.goto(url);
  const args={expected:{url,account:'test-account'},locator:{paginationNext:true}};
  const position=await page.evaluate(templateUiAction,args);await page.mouse.click(position.x,position.y);
  assert.equal(await page.evaluate(()=>document.body.dataset.clicked),'top');
  await page.locator('#bottom input').fill('2');await assert.rejects(page.evaluate(templateUiAction,args),/当前页不一致/);
  await assert.rejects(page.evaluate(templateUiAction,{expected:args.expected,locator:{selector:'button',text:'保存'}}),/控件不唯一/);
  await page.locator('#bottom input').fill('1');await page.locator('#top button').evaluate(button=>button.disabled=true);
  const fallback=await page.evaluate(templateUiAction,args);await page.mouse.click(fallback.x,fallback.y);assert.equal(await page.evaluate(()=>document.body.dataset.clicked),'bottom');
});

test('DOM title and numeric pagers exclude page-size inputs and jump exactly one page with native Enter',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1000,height:600}});
  const otherDraftId='220114595121490273',url='https://www.dianxiaomi.com/web/popTemu/pageList/draft';
  let naming='title="页数"';const pager=id=>`<div class="vxe-pager" id="${id}"><span class="vxe-pager--sizes"><input type="text" value="50"></span><input name="pageSize" value="50"><input class="vxe-pager--goto" ${naming} value="1"><button class="vxe-pager--next-btn">下一页</button></div>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><style>html{scroll-behavior:smooth}</style><div class="btn-user"><span class="user-name">test-account</span></div><input value="outside-sensitive-value"><div style="height:1600px"></div>${pager('top')}<div id="range">第1-1条，共2条记录</div><table><tbody><tr class="vxe-body--row" rowid="${draftId}"><td><a href="${sourceUrl}">Temu</a><p>「店铺1」</p></td></tr></tbody></table>${pager('bottom')}<div style="height:1200px"></div><script>const model=new WeakMap();document.querySelectorAll('.vxe-pager--goto').forEach(input=>{model.set(input,'1');input.addEventListener('input',event=>{if(event.isTrusted){model.set(input,input.value);document.body.dataset.nativeInputs=String(Number(document.body.dataset.nativeInputs||0)+1);}});input.addEventListener('keydown',event=>{if(event.key!=='Enter'||!event.isTrusted)return;document.body.dataset.enterCount=String(Number(document.body.dataset.enterCount||0)+1);if(model.get(input)!=='2')return;document.querySelectorAll('.vxe-pager--goto').forEach(control=>control.value='2');document.querySelector('tr[rowid]').setAttribute('rowid','${otherDraftId}');document.querySelector('#range').textContent='第2-2条，共2条记录';document.querySelectorAll('.vxe-pager--next-btn').forEach(button=>button.disabled=true);});});</script>`}));
  for(naming of ['title="页数"','','aria-label="页数"']){
  await page.goto(url);const before=await page.evaluate(readTemplateList),expected={url,account:'test-account'};
  assert.equal(before.currentPage,1);assert.equal(before.pageInputCount,2);assert.deepEqual(before.pageNumbers,[1,1]);assert.equal(before.rows[0].draftId,draftId);assert.equal(before.pagerDiagnostics.rangeText,'第1-1条，共2条记录');
  assert.equal(before.pagerDiagnostics.inputs.length,6);assert.equal(before.pagerDiagnostics.inputs.filter(input=>input.selected).length,2);assert.equal(before.pagerDiagnostics.inputs.filter(input=>input.pageSize).length,4);assert.ok(!JSON.stringify(before.pagerDiagnostics).includes('outside-sensitive-value'));
  await assert.rejects(page.evaluate(templateUiAction,{expected,locator:{paginationPage:{from:1,to:3,count:2}},action:'page'}),/目标不是下一页/);
  await page.locator('#bottom .vxe-pager--goto').fill('2');const mismatch=await page.evaluate(readTemplateList);assert.equal(mismatch.currentPage,null);assert.deepEqual(mismatch.pageNumbers,[1,2]);
  await assert.rejects(page.evaluate(templateUiAction,{expected,locator:{paginationPage:{from:1,to:2,count:2}},action:'page'}),/页码不一致/);
  await page.locator('#bottom .vxe-pager--goto').fill('1');await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  const jumped=await page.evaluate(templateUiAction,{expected,locator:{paginationPage:{from:1,to:2,count:2}},action:'page'});assert.equal(jumped,true);
  const focused=await page.evaluate(()=>{const input=document.querySelector('#top .vxe-pager--goto'),rect=input.getBoundingClientRect();return {focused:document.activeElement===input,inViewport:rect.top>=0&&rect.bottom<=innerHeight,scrollY,value:input.value,selectionStart:input.selectionStart,selectionEnd:input.selectionEnd,nativeInputs:Number(document.body.dataset.nativeInputs||0)};});
  assert.equal(focused.focused,true);assert.equal(focused.inViewport,true);assert.ok(focused.scrollY>0);assert.equal(focused.value,'1');assert.equal(focused.selectionStart,0);assert.equal(focused.selectionEnd,1);
  const selected=await page.evaluate(readTemplateList);assert.equal(selected.currentPage,1);assert.equal(selected.pagerDiagnostics.documentHasFocus,true);assert.equal(selected.pagerDiagnostics.activeElementIsPageInput,true);
  await page.keyboard.insertText('2');assert.equal(await page.evaluate(()=>Number(document.body.dataset.nativeInputs)),focused.nativeInputs+1);
  const entered=await page.evaluate(readTemplateList);assert.equal(entered.currentPage,null);assert.equal(entered.rows[0].draftId,draftId);
  await page.keyboard.press('Enter');const after=await page.evaluate(readTemplateList);
  assert.equal(after.currentPage,2);assert.deepEqual(after.pageNumbers,[2,2]);assert.equal(after.rows[0].draftId,otherDraftId);assert.equal(after.nextEnabled,false);assert.equal(after.pagerDiagnostics.rangeText,'第2-2条，共2条记录');assert.equal(await page.evaluate(()=>document.body.dataset.enterCount),'1');
  }
  naming='';await page.goto(url);const expected={url,account:'test-account'};
  await page.locator('#bottom .vxe-pager--goto').evaluate(input=>input.remove());let invalid=await page.evaluate(readTemplateList);assert.equal(invalid.currentPage,null);assert.match(invalid.pagerSelectionIssues.join(''),/每个分页区域/);
  await assert.rejects(page.evaluate(templateUiAction,{expected,locator:{paginationPage:{from:1,to:2,count:2}},action:'page'}),/页码不一致/);
  await page.goto(url);await page.locator('#top').evaluate(root=>{const input=document.createElement('input');input.value='3';root.append(input);});invalid=await page.evaluate(readTemplateList);assert.equal(invalid.currentPage,null);assert.match(invalid.pagerSelectionIssues.join(''),/多个页码候选/);
  await assert.rejects(page.evaluate(templateUiAction,{expected,locator:{paginationNext:true}}),/无法确认/);
  await page.goto(url);await page.locator('#top').evaluate(root=>{for(let i=0;i<20;i++){const input=document.createElement('input');input.name='pageSize';input.value='50';input.title='x'.repeat(200);root.append(input);}});
  const bounded=await page.evaluate(readTemplateList);assert.equal(bounded.currentPage,1);assert.equal(bounded.pagerDiagnostics.inputs.length,10);assert.ok(bounded.pagerDiagnostics.inputs.every(input=>input.title.length<=120));
  naming='title="页数"';await page.goto(url);await page.locator('#bottom').evaluate(root=>root.remove());
  const single=await page.evaluate(readTemplateList);assert.equal(single.currentPage,1);assert.equal(single.pageInputCount,1);
  await page.evaluate(templateUiAction,{expected,locator:{paginationPage:{from:1,to:2,count:1}},action:'page'});await page.keyboard.insertText('2');await page.keyboard.press('Enter');
  const singleAfter=await page.evaluate(readTemplateList);assert.equal(singleAfter.currentPage,2);assert.equal(singleAfter.rows[0].draftId,otherDraftId);
});

test('DOM VXE split rows scroll the main body, exclude hidden copies and open the exact draft with trusted Enter after focus movement',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1000,height:650}}),page=await context.newPage();
  const url='https://www.dianxiaomi.com/web/popTemu/pageList/draft',expected={url,account:'test-account'},locator={editDraftId:draftId,text:'编辑'};
  const spacer=height=>`<tr><td style="height:${height}px"></td></tr>`;
  const row=(hidden,id)=>`<tr class="vxe-body--row" rowid="${draftId}" style="height:80px"><td class="${hidden?'fixed--hidden':''}"><button id="${id}" type="button">编辑</button></td></tr>`;
  const body=`<meta charset="utf-8"><style>html{scroll-behavior:smooth}table{border-collapse:collapse;width:100%}td{padding:0}button{height:32px;width:80px}.fixed--hidden{visibility:hidden}.vxe-table{position:relative;width:800px;height:300px}.vxe-table--main-wrapper{height:300px;overflow:auto}.vxe-table--fixed-right-wrapper{position:absolute;right:0;top:0;width:120px;height:300px;overflow:hidden;background:white}.fixed-body{height:300px;overflow:hidden}</style><div class="btn-user"><span class="user-name">test-account</span></div><div style="height:1100px"></div><div class="vxe-table"><div class="vxe-table--main-wrapper"><table>${spacer(900)}${row(true,'hidden-main')}${spacer(500)}</table></div><div class="vxe-table--fixed-right-wrapper"><div class="fixed-body"><table>${spacer(900)}${row(false,'actual-edit')}${spacer(500)}</table></div></div></div><div style="height:900px"></div><script>const main=document.querySelector('.vxe-table--main-wrapper'),fixed=document.querySelector('.fixed-body'),button=document.querySelector('#actual-edit');main.addEventListener('scroll',()=>requestAnimationFrame(()=>fixed.scrollTop=main.scrollTop));button.addEventListener('focus',()=>{setTimeout(()=>button.style.transform='translateY(16px)',50);},{once:true});button.addEventListener('click',event=>{if(event.isTrusted){document.body.dataset.editClicks=String(Number(document.body.dataset.editClicks||0)+1);window.open('${platformEditUrl}','_blank');}});document.querySelector('#hidden-main').addEventListener('click',()=>document.body.dataset.hiddenClicked='true');const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){if(this.closest('.fixed--hidden'))document.body.dataset.hiddenScrolled='true';return original.call(this,options);};</script>`;
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url()===url?body:'<title>fixture editor</title>'}));await page.goto(url);
  let first;
  for(let attempt=0;attempt<5&&!first;attempt++){first=await page.evaluate(templateUiAction,{expected,locator,action:'focus',withGeometry:true});if(!first)await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(first);await new Promise(resolve=>setTimeout(resolve,220));
  const shifted=await page.evaluate(templateUiAction,{expected,locator,action:'focused',withGeometry:true,scroll:false});assert.ok(shifted);assert.equal(templateHitIsStable(first,shifted),false,'focus movement must invalidate the old location');
  const current=await page.evaluate(templateUiAction,{expected,locator,action:'focus',withGeometry:true});await new Promise(resolve=>setTimeout(resolve,220));const stable=await page.evaluate(templateUiAction,{expected,locator,action:'focused',withGeometry:true,scroll:false});assert.equal(templateHitIsStable(current,stable),true);
  const diagnostic=await page.evaluate(readTemplateEditDiagnostics,{expected,draftId});assert.equal(diagnostic.rowCopies,2);assert.equal(diagnostic.buttonCount,2);assert.equal(diagnostic.eligibleButtonCount,1);assert.equal(diagnostic.hitCount,1);assert.ok(diagnostic.controls.some(control=>control.fixedHidden));assert.equal(diagnostic.controls.filter(control=>control.focused).length,1);
  assert.ok(await page.locator('.vxe-table--main-wrapper').evaluate(element=>element.scrollTop>0));assert.equal(await page.evaluate(()=>document.body.dataset.hiddenScrolled),undefined);
  const opened=page.waitForEvent('popup');await page.keyboard.press('Enter');const popup=await opened;await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),platformEditUrl);assert.equal(await page.evaluate(()=>document.body.dataset.editClicks),'1');assert.equal(await page.evaluate(()=>document.body.dataset.hiddenClicked),undefined);await popup.close();
  await page.bringToFront();await page.locator('#actual-edit').evaluate(button=>{const rect=button.getBoundingClientRect(),cover=document.createElement('div');cover.className='fixture-cover';cover.style.cssText=`position:fixed;z-index:9999;background:white;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;document.body.append(cover);});
  const covered=await page.evaluate(readTemplateEditDiagnostics,{expected,draftId});assert.equal(covered.hitCount,0);assert.ok(covered.controls.some(control=>control.hitClassName==='fixture-cover'));assert.equal(await page.evaluate(templateUiAction,{expected,locator,action:'focus',withGeometry:true,scroll:false}),null);assert.equal(await page.evaluate(()=>document.body.dataset.editClicks),'1');
});

test('DOM narrow viewport horizontally reveals the unique edit button in a wide table without fixed copies',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1036,height:817}}),page=await context.newPage();
  const url='https://www.dianxiaomi.com/web/popTemu/pageList/draft',expected={url,account:'test-account'},locator={editDraftId:draftId,text:'编辑'};
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url()===url?`<meta charset="utf-8"><style>body{margin:0;min-width:1600px}table{table-layout:fixed;min-width:1600px;border-collapse:collapse}td{padding:0}button{width:28px;height:22px;padding:0}.vxe-body--row{height:90px}</style><div class="btn-user"><span class="user-name">test-account</span></div><div style="height:7600px"></div><div class="vxe-table--main-wrapper"><table><tr class="vxe-body--row" rowid="${draftId}"><td style="width:1358px">商品</td><td><button type="button">编辑</button></td></tr></table></div><div style="height:700px"></div><script>document.querySelector('button').addEventListener('click',event=>{if(event.isTrusted){document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);window.open('${platformEditUrl}','_blank');}});</script>`:'<title>fixture editor</title>'}));
  await page.goto(url);await page.evaluate(()=>scrollTo({left:248,top:7249,behavior:'instant'}));const before=await page.evaluate(readTemplateEditDiagnostics,{expected,draftId});assert.equal(before.rowCopies,1);assert.equal(before.buttonCount,1);assert.equal(before.hitCount,0);assert.ok(before.controls[0].bounds.x>1036);
  const first=await page.evaluate(templateUiAction,{expected,locator,action:'focus',withGeometry:true});assert.ok(first);assert.ok(first.bounds.x>=0&&first.bounds.x+first.bounds.width<=1036);await new Promise(resolve=>setTimeout(resolve,220));
  const second=await page.evaluate(templateUiAction,{expected,locator,action:'focused',withGeometry:true,scroll:false});assert.equal(templateHitIsStable(first,second),true);
  const after=await page.evaluate(readTemplateEditDiagnostics,{expected,draftId});assert.equal(after.hitCount,1);assert.ok(after.scroll.x>before.scroll.x);assert.equal(after.controls[0].focused,true);
  const popupEvent=page.waitForEvent('popup');await page.keyboard.press('Enter');const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),platformEditUrl);assert.equal(await page.evaluate(()=>document.body.dataset.clicks),'1');await popup.close();
});
