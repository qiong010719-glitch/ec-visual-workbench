import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createDxmTemplatePublisher,publicationOutcome,readPublicationList,publicationRowAction} from '../src/dxm-template-publish.mjs';
import {templateSaveSnapshot} from '../src/dxm-template-browser.mjs';
import {sourcePriceEvidence} from '../src/dxm-required-platform-browser.mjs';
import {parseErpResponse,publicationReceipt,listingPublication} from '../../scripts/lib/temu-publish.mjs';

const origin='https://www.dianxiaomi.com',draftId='220114595121490272',goodsId='601234567890001',sourceUrl=`https://www.temu.com/test-g-${goodsId}.html`,editUrl=`${origin}/web/popTemu/edit?id=${draftId}`;
const clone=value=>structuredClone(value);
function fixture(t){
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'template-publish-'));t.after(()=>{assert.equal(path.dirname(output),path.resolve(os.tmpdir()));fs.rmSync(output,{recursive:true,force:true});});
  const log=[],handlers=new Map(),state={phase:'collection',url:'about:blank',account:'merchant',moves:0,publishes:0,body:`{"data":{"successList":[${draftId}]}}`,moveUnknown:false,publicationUnknown:false,menu:true,identityLoaded:true,modal:''};
  const snapshot={url:editUrl,account:'merchant',storeName:'店铺1',site:'加拿大站',sources:[sourceUrl],items:['产品分类','承诺发货时效','运费模板'].map(label=>({label,controls:[],selections:['已配置'],checked:[],required:true,errors:[],placeholders:[]})),fields:{variationSku:['SKU-A'],price:['10'],skuLength:['1'],skuWidth:['2'],skuHeight:['3'],weight:['4'],stock:['10'],identifierCode:[],skuCategoryNum:[],numberOfPiecesNew:[]},media:{main:['https://example.test/main.jpg'],variants:[],detail:[]},variants:['A'],warehouses:['仓库1'],priceSnapshot:[]};
  const page={
    send:async(name,arg={})=>{
      if(name==='Page.navigate'){state.url=arg.url;return {};}
      if(name==='Network.getResponseBody')return {body:state.body};
      if(name==='Input.dispatchMouseEvent'&&arg.type==='mouseReleased'){
        if(arg.x===20){log.push('move-click');state.moves++;if(!state.moveUnknown)state.phase='draft';}
        if(arg.x===40){log.push('publish-click');state.publishes++;if(!state.publicationUnknown){state.phase='submitted';handlers.get('Network.responseReceived')?.({requestId:'r1',response:{url:origin+'/api/popTemuProduct/batchPublishTest.json'}});handlers.get('Network.loadingFinished')?.({requestId:'r1'});}}
      }
      return {};
    },
    evaluate:async(fn,arg)=>{
      if(fn.name==='readPublicationList')return {url:state.url,account:state.account,rows:[{draftId,sourceGoodsIds:[goodsId],storeNames:['店铺1'],sites:['加拿大'],visibleCopies:2}],total:1,nextEnabled:false,filters:[],search:''};
      if(fn.name==='publicationRowAction'){assert.equal(arg.expected.draftId,draftId);assert.equal(arg.expected.goodsId,goodsId);return {x:arg.action==='move'?20:30,y:10};}
      if(fn.name==='readTemplateIdentity')return {url:editUrl,account:state.account,store:['店铺1'],site:['加拿大站'],sources:[sourceUrl],loaded:state.identityLoaded};
      if(fn.name==='readTemuListing')return clone(snapshot);
      if(fn.name==='readRequiredFields')return clone(snapshot.requiredFields);
      if(fn.name==='readTemplateCategoryPath')return clone(snapshot.categoryPath);
      if(typeof arg==='string')return arg.startsWith('https:')?state.url===arg:state.account===arg;
      if(arg?.url&&arg?.account)return state.menu?{x:40,y:10}:null;
      if(arg===undefined)return state.modal;
      throw new Error('Unexpected fixture evaluation: '+fn.name);
    },
    on:(name,fn)=>{handlers.set(name,fn);return ()=>handlers.delete(name);},close:()=>{}
  };
  const transport={connection:async()=>({ws:'fixture',targets:async()=>[]}),connect:async()=>({send:async(name)=>{assert.equal(name,'Target.createTarget');return {targetId:'fixture-target'};},close:()=>{}}),pageById:async()=>page,
    poll:async(fn,options={})=>{for(let i=0;i<8;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,1));}throw new Error(options.label+' fixture timeout');},
    publication:{parseErpResponse,publicationReceipt,listingPublication,checkPublicationOnPage:async()=>{log.push('read:'+state.phase);return {publicationStatus:state.phase==='collection'?'unknown':state.phase,published:state.phase==='online'};}}
  };
  const args={browserConfig:{type:'chrome'},erpConnection:{expectedAccount:'merchant'},templateSnapshot:{id:'template-1',version:1,platform:'temu'},storeBinding:{key:'store-one',storeName:'店铺1',site:'加拿大'},row:{draftId,goodsId,sourceUrl,storeBindingKey:'store-one',storeName:'店铺1',site:'加拿大站',platformEditUrl:editUrl,saved:true,ready:true,issues:[],saveIntent:{status:'confirmed',payload:{templateId:'template-1',templateVersion:1,storeBindingKey:'store-one',goodsId,expectedSnapshot:clone(templateSaveSnapshot(snapshot))}}},tabs:{},onTarget:async()=>{},isStopped:()=>false,
    beforeMoveToPending:async payload=>{assert.equal(payload.draftId,draftId);assert.equal(payload.goodsId,goodsId);log.push('move-intent');},
    onMovedToPending:async payload=>{assert.equal(payload.publicationStatus,'draft');log.push('move-confirmed');},
    beforePublish:async payload=>{assert.equal(payload.draftId,draftId);log.push('publish-intent');}
  };
  return {state,args,snapshot,log,output,transport,publisher:createDxmTemplatePublisher({WORKBENCH_OUTPUT_ROOT:output},transport)};
}

test('publication outcomes never turn ERP listed or an accepted submission into online success',()=>{
  for(const status of ['submitted','listed','reviewing','pending-launch','draft','unknown','failed'])assert.equal(publicationOutcome({publicationStatus:status,published:true}).published,false,status);
  assert.equal(publicationOutcome({publicationStatus:'online',published:false}).published,true);
  assert.equal(publicationOutcome({publicationStatus:'listed'}).publicationStatus,'listed');
});

test('bridge journals movement and publication separately before their single clicks',async t=>{
  const f=fixture(t),result=await f.publisher.publish(f.args);
  assert.equal(result.publicationStatus,'submitted');assert.equal(result.published,false);assert.equal(result.movedToPending,true);assert.equal(f.state.moves,1);assert.equal(f.state.publishes,1);
  assert.ok(f.log.indexOf('move-intent')<f.log.indexOf('move-click'));assert.ok(f.log.indexOf('move-click')<f.log.indexOf('move-confirmed'));assert.ok(f.log.indexOf('move-confirmed')<f.log.indexOf('publish-intent'));assert.ok(f.log.indexOf('publish-intent')<f.log.indexOf('publish-click'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.output,'listing-publications',draftId,'publication.json'))).publicationStatus,'submitted');
});

test('moveToPending verifies the persisted draft and never invokes a publication callback or click',async t=>{
  const f=fixture(t);f.args.workflowMode='required-fields';f.args.completionMode='pending';f.args.beforePublish=()=>{throw new Error('publication must not be reachable');};
  const result=await f.publisher.moveToPending(f.args);assert.equal(result.status,'pending-ready');assert.equal(result.publicationStatus,'draft');assert.equal(result.ready,true);assert.equal(result.saved,true);assert.equal(result.published,false);assert.equal(result.submitted,false);assert.equal(result.publicationNotSubmitted,true);assert.equal(f.state.moves,1);assert.equal(f.state.publishes,0);assert.ok(!f.log.includes('publish-intent'));
  assert.ok(f.log.indexOf('move-intent')<f.log.indexOf('move-click'));assert.ok(f.log.filter(event=>event==='read:draft').length>=2,'location is read independently after the move');
  await assert.rejects(f.publisher.publish(f.args),/只允许转入待发布/);assert.equal(f.state.publishes,0);
});

test('pending-only movement refuses changed snapshots and unknown movement never repeats',async t=>{
  const f=fixture(t);f.state.moveUnknown=true;const uncertain=await f.publisher.moveToPending(f.args);assert.equal(uncertain.publicationStatus,'unknown');assert.equal(uncertain.publicationNotSubmitted,true);assert.equal(f.state.moves,1);assert.equal(f.state.publishes,0);
  await assert.rejects(f.publisher.moveToPending({...f.args,row:{...f.args.row,moveIntent:{status:'unknown'}}}),/先只读核对/);assert.equal(f.state.moves,1);
  f.state.phase='draft';f.snapshot.fields.price[0]='99';const changed=await f.publisher.moveToPending(f.args);assert.equal(changed.status,'needs-review');assert.match(changed.issues.join(),/保存前快照不一致/);assert.equal(f.state.moves,1);assert.equal(f.state.publishes,0);
});

test('pending movement independently compares dynamic required fields captured by automatic completion',async t=>{
  const f=fixture(t);f.snapshot.requiredFields={url:editUrl,account:'merchant',fields:[{name:'leadTime',label:'备货天数',kind:'number',value:'1',required:true,empty:false,options:[],rowIdentity:{sku:'SKU-A'}}]};
  f.args.row.saveIntent.payload.expectedSnapshot=clone(templateSaveSnapshot(f.snapshot));
  f.snapshot.requiredFields.fields[0].value='9';const blocked=await f.publisher.moveToPending(f.args);assert.match(blocked.issues.join(),/保存前快照不一致/);assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);
  f.snapshot.requiredFields.fields[0].value='1';const ready=await f.publisher.moveToPending(f.args);assert.equal(ready.status,'pending-ready');assert.equal(ready.ready,true);assert.equal(f.state.moves,1);assert.equal(f.state.publishes,0);
});

test('pending movement independently validates committed source-price evidence after restart',async t=>{
  const f=fixture(t);f.args.templateSnapshot.workflowMode='required-fields';f.args.templateSnapshot.completionMode='pending';
  f.snapshot.requiredFields={url:editUrl,account:'merchant',fields:[{key:'#price',selector:'#price',shape:'price-shape',name:'price',label:'申报价格 CNY',unit:'CNY',kind:'text',value:'10',required:true,empty:false,options:[],rowIdentity:{sku:'SKU-A'},errors:[]}]};
  const price={amount:'10',currency:'CNY',kind:'displayed-sale'},facts={version:1,platform:'temu',goodsId,sourceUrl,observedAt:new Date(Date.now()-1000).toISOString(),status:'ready',categoryPath:['工具'],price,selectedVariant:{skuId:'SKU-A',attributes:[],selectionComplete:true},variants:[{skuId:'SKU-A',attributes:[],price}],issues:[]};
  const options={platform:'temu',goodsId,sourceFacts:facts,targetCurrency:'CNY'},proof=sourcePriceEvidence({options},f.snapshot.requiredFields);
  f.args.row.saveIntent.payload.priceEvidence=proof;
  f.snapshot.fields.price[0]='99';f.snapshot.requiredFields.fields[0].value='99';f.args.row.saveIntent.payload.expectedSnapshot=templateSaveSnapshot(f.snapshot);
  const blocked=await f.publisher.moveToPending(f.args);assert.equal(blocked.ready,undefined);assert.match(blocked.issues.join(''),/发生变化/);assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);
  f.snapshot.fields.price[0]='10';f.snapshot.requiredFields.fields[0].value='10';f.args.row.saveIntent.payload.expectedSnapshot=templateSaveSnapshot(f.snapshot);
  const ready=await f.publisher.moveToPending(f.args);assert.equal(ready.ready,true);assert.equal(f.state.moves,1);assert.equal(f.state.publishes,0);
});

test('pending movement checks the complete category path and fresh required-field rules before any movement',async t=>{
  const f=fixture(t);f.snapshot.categoryPath=['厨房电器','榨汁机'];f.snapshot.requiredFields={url:editUrl,account:'merchant',fields:[{name:'leadTime',label:'备货天数',kind:'number',value:'',required:false,empty:true,options:[],rowIdentity:{sku:'SKU-A'}}]};
  f.args.row.saveIntent.payload.expectedSnapshot=clone(templateSaveSnapshot(f.snapshot));
  f.snapshot.categoryPath=['其他家电','榨汁机'];const wrongPath=await f.publisher.moveToPending(f.args);assert.equal(wrongPath.status,'needs-review');assert.match(wrongPath.issues.join(),/保存前快照不一致/);assert.equal(f.state.moves,0);
  f.snapshot.categoryPath=['厨房电器','榨汁机'];f.snapshot.requiredFields.fields[0].required=true;
  const required=await f.publisher.moveToPending(f.args);assert.equal(required.status,'needs-review');assert.match(required.issues.join(),/必填项尚未完整/);assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);
});

test('unknown move returns without a publication attempt and cannot be replayed',async t=>{
  const f=fixture(t);f.state.moveUnknown=true;const result=await f.publisher.publish(f.args);
  assert.equal(result.publicationStatus,'unknown');assert.equal(result.publicationNotSubmitted,true);assert.equal(result.movedToPending,false);assert.equal(f.state.moves,1);assert.equal(f.state.publishes,0);assert.ok(!f.log.includes('publish-intent'));
  await assert.rejects(f.publisher.publish({...f.args,row:{...f.args.row,moveIntent:{status:'unknown'}}}),/先只读核对/);assert.equal(f.state.moves,1);
});

test('readback of a successful move independently verifies the saved snapshot and allows only the remaining publication',async t=>{
  const f=fixture(t);f.state.phase='draft';f.args.row.moveIntent={status:'unknown'};
  const checked=await f.publisher.verifyPublication(f.args);assert.equal(checked.publicationStatus,'draft');assert.equal(checked.movedToPending,true);assert.equal(checked.publicationNotSubmitted,true);assert.equal(checked.ready,true);assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);
  f.args.row.moveIntent.status='confirmed';const result=await f.publisher.publish(f.args);assert.equal(result.publicationStatus,'submitted');assert.equal(f.state.moves,0);assert.equal(f.state.publishes,1);
});

test('changed saved data prevents both direct publication and move-only recovery readiness',async t=>{
  const f=fixture(t);f.snapshot.fields.price[0]='99';
  const blocked=await f.publisher.publish(f.args);assert.match(blocked.issues.join(),/保存前快照不一致/);assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);assert.equal(blocked.publicationNotSubmitted,true);
  f.state.phase='draft';f.args.row.moveIntent={status:'unknown'};const checked=await f.publisher.verifyPublication(f.args);assert.equal(checked.movedToPending,true);assert.equal(checked.ready,false);assert.match(checked.issues.join(),/保存前快照不一致/);
});

test('missing publish callback or prior publication intent stops before a write',async t=>{
  const f=fixture(t);await assert.rejects(f.publisher.publish({...f.args,beforePublish:undefined}),/缺少发布前/);
  await assert.rejects(f.publisher.publish({...f.args,row:{...f.args.row,publishIntent:{status:'unknown'}}}),/不能再次发布/);
  assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);
});

test('unknown publication is only read back and never inferred successful from a remaining draft',async t=>{
  const f=fixture(t);f.state.phase='draft';f.state.publicationUnknown=true;
  const result=await f.publisher.publish(f.args);assert.equal(result.publicationStatus,'unknown');assert.equal(f.state.publishes,1);assert.equal(result.published,false);
  f.args.row.publishIntent={status:'unknown'};const checked=await f.publisher.verifyPublication(f.args);assert.equal(checked.publicationStatus,'draft');assert.equal(checked.publicationNotSubmitted,false);assert.equal(checked.ready,false);assert.equal(f.state.publishes,1);
});

test('read-only existing listing discovery does not move or submit again',async t=>{
  const f=fixture(t);for(const status of ['listed','reviewing','submitted','online']){f.state.phase=status;const result=await f.publisher.publish(f.args);assert.equal(result.publicationStatus,status);assert.equal(result.readOnly,true);assert.equal(result.published,status==='online');}
  assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);assert.ok(!f.log.includes('publish-intent'));
});

test('post-submit confirmation dialog remains visible and is never automatically accepted or navigated away',async t=>{
  const f=fixture(t);f.state.phase='draft';f.state.publicationUnknown=true;f.state.modal='请确认商品价格';
  const result=await f.publisher.publish(f.args);assert.equal(result.publicationStatus,'unknown');assert.match(result.issues.join(),/请确认商品价格/);assert.equal(f.state.publishes,1);assert.equal(f.state.url,origin+'/web/popTemu/pageList/offline');assert.equal(f.log.filter(event=>event.startsWith('read:')).length,1);
});

test('wrong account and rejected movement journal prevent browser mutations',async t=>{
  const f=fixture(t);f.state.account='someone-else';const wrong=await f.publisher.publish(f.args);assert.match(wrong.issues.join(),/账号核对/);assert.equal(f.state.moves,0);
  f.state.account='merchant';f.args.beforeMoveToPending=async()=>{throw new Error('journal unavailable');};const rejected=await f.publisher.publish(f.args);assert.match(rejected.issues.join(),/journal unavailable/);assert.equal(f.state.moves,0);assert.equal(f.state.publishes,0);
});

test('real DOM merges pinned row copies but requires exact source, store, site and one unoccluded action',async t=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  // Entirely local HTML; the browser never contacts the ERP.
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="btn-user"><span class="user-name">merchant</span></div><p>共 1 条记录</p><table><thead><tr><th colid="site">站点</th></tr></thead><tbody><tr rowid="${draftId}"><td><a href="${sourceUrl}">Temu</a> 商品 「店铺1」</td><td colid="site">加拿大</td><td><button>移入待发布</button><button>发布</button></td></tr><tr rowid="${draftId}" id="fixed"><td><span>固定列副本</span></td></tr></tbody></table>`}));
  const listUrl=origin+'/web/popTemu/pageList/draft';await page.goto(listUrl);
  const expected={account:'merchant',draftId,goodsId,storeName:'店铺1',site:'加拿大站',listUrl};
  const list=await page.evaluate(readPublicationList,expected);assert.equal(list.rows.length,1);assert.equal(list.rows[0].visibleCopies,2);assert.deepEqual(list.rows[0].sourceGoodsIds,[goodsId]);
  const point=await page.evaluate(publicationRowAction,{expected,action:'move'});assert.ok(point.x>0&&point.y>0);
  await assert.rejects(page.evaluate(publicationRowAction,{expected:{...expected,goodsId:'601234567890999'},action:'move'}),/未唯一匹配/);
  await assert.rejects(page.evaluate(publicationRowAction,{expected:{...expected,storeName:'其他店铺'},action:'move'}),/未唯一匹配/);
  await assert.rejects(page.evaluate(publicationRowAction,{expected:{...expected,site:'美国'},action:'move'}),/未唯一匹配/);
  await page.locator('#fixed td').evaluate(element=>{element.innerHTML='<button>移入待发布</button>';});
  await assert.rejects(page.evaluate(publicationRowAction,{expected,action:'move'}),/不唯一/);
});
