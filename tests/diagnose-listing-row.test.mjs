import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseListingRow,parseArguments,runCli} from '../tools/diagnose-listing-row.mjs';

const goodsId='601234567890001',sourceUrl=`https://www.temu.com/canvas-g-${goodsId}.html`,draftId='220114595121490000',platformEditUrl=`https://www.dianxiaomi.com/web/popTemu/edit?id=${draftId}`;
function fixture(){
  const erp={key:'erp-one',provider:'dianxiaomi',browserKey:'chrome-one',expectedAccount:'fixture-account'},browser={key:'chrome-one',type:'chrome',debugPort:9222},store={key:'store-one',storeName:'店铺1',site:'加拿大站',warehouse:'仓1'};
  const row={goodsId,sourceUrl,storeBindingKey:store.key,storeName:store.storeName,site:store.site,platform:'temu',resolvedTarget:{draftId,platformEditUrl}};
  const job={id:'job-one',erpKey:erp.key,templateId:'template-one',templateVersion:2,templateSnapshot:{id:'template-one',version:2,erpKey:erp.key,platform:'temu',rules:{},storeBindings:[store,{key:'store-two',storeName:'店铺2',site:'加拿大站'}]},binding:{erpConnection:erp,browserConfig:browser},goodsIds:[goodsId],storeKeys:['store-one','store-two'],sourceRows:[{goodsId,sourceUrl,collectionEditUrl:'https://www.dianxiaomi.com/web/productCrawl/edit?id=219835794628444620'}],rows:[row],tabs:{listingTemplate:'user-or-task-tab'},action:null,status:'needs-review'};
  const settings={erpConnections:[structuredClone(erp)],browsers:[structuredClone(browser)]},requests=[],calls=[];
  let busy=false,statusChecks=0,result={rows:[{...row,status:'located',draftId,platformEditUrl,issues:['缺少仓库'],snapshot:{account:erp.expectedAccount,private:'do-not-output'}}],scannedRecords:138};
  const options={baseUrl:'http://127.0.0.1:4185',jobId:job.id,goodsId,storeKey:store.key};
  const deps={configuration:{SADCAPTCHA_API_KEY:'fixture-secret'},fetcher:async(url,init)=>{requests.push({url,init});const route=new URL(url).pathname;let data;if(route==='/api/status'){statusChecks++;data={busy,mode:'local'};}else if(route==='/api/settings')data=settings;else if(route==='/api/listing-workflow/jobs/job-one')data=job;else throw new Error('unexpected route');return {ok:true,status:200,json:async()=>structuredClone(data)};},adapterFactory:()=>{calls.push('factory');return {inspect:async args=>{calls.push(args);return structuredClone(result);}};}};
  return {job,settings,options,deps,requests,calls,setBusy:value=>{busy=value;},get statusChecks(){return statusChecks;},setResult:value=>{result=value;}};
}
test('single-row diagnosis checks idle and frozen bindings, uses a temporary tab and emits only a safe summary',async()=>{
  const f=fixture(),before=structuredClone(f.job),report=await diagnoseListingRow(f.options,f.deps),args=f.calls[1];
  assert.equal(report.ok,true);assert.equal(report.snapshotRead,true);assert.equal(report.draftId,draftId);assert.deepEqual(report.issues,['缺少仓库']);assert.equal(report.scannedRecords,138);assert.equal(f.statusChecks,2);
  assert.equal(args.rows.length,1);assert.equal(args.templateSnapshot.storeBindings.length,1);assert.equal(args.templateSnapshot.version,2);assert.deepEqual(args.tabs,{});assert.equal(Object.hasOwn(args,'onTarget'),false);assert.deepEqual(args.resolvedTargets,[{goodsId,storeBindingKey:'store-one',draftId,platformEditUrl}]);assert.equal(args.beforeSave,undefined);assert.equal(args.beforePublish,undefined);
  assert.deepEqual(f.job,before);assert.ok(f.requests.every(request=>request.init.method==='GET'));assert.ok(!JSON.stringify(report).includes('fixture-account'));assert.ok(!JSON.stringify(report).includes('https://'));assert.ok(!JSON.stringify(report).includes('snapshot"'));assert.equal(report.binding,undefined);
});
test('busy or missing idle status blocks before the job is read or an adapter is created',async()=>{
  const f=fixture();f.setBusy(true);await assert.rejects(diagnoseListingRow(f.options,f.deps),/未明确空闲/);assert.equal(f.requests.length,1);assert.equal(f.calls.length,0);
  const unknown=fixture();unknown.deps.fetcher=async()=>({ok:true,status:200,json:async()=>({mode:'local'})});await assert.rejects(diagnoseListingRow(unknown.options,unknown.deps),/未明确空闲/);assert.equal(unknown.calls.length,0);
});
test('a newly busy workbench on the final check or during progress stops diagnosis',async()=>{
  const f=fixture(),fetcher=f.deps.fetcher;f.deps.fetcher=async(url,init)=>{if(new URL(url).pathname==='/api/settings')f.setBusy(true);return fetcher(url,init);};await assert.rejects(diagnoseListingRow(f.options,f.deps),/未明确空闲/);assert.equal(f.calls.length,0);
  const active=fixture();active.deps.adapterFactory=()=>({inspect:async args=>{active.setBusy(true);await args.onProgress({phase:'scan',stage:'page'});throw new Error('must not continue');}});const report=await diagnoseListingRow(active.options,active.deps);assert.equal(report.ok,false);assert.match(report.error,/未明确空闲/);
});
test('wrong scopes, ambiguous source rows, changed binding, and mismatched source identity never connect',async()=>{
  for(const mutate of [f=>f.options.goodsId='601234567890099',f=>f.options.storeKey='not-in-task',f=>f.job.sourceRows.push(structuredClone(f.job.sourceRows[0])),f=>f.settings.erpConnections[0].expectedAccount='other',f=>f.job.rows[0].sourceUrl=sourceUrl.replace(goodsId,'601234567890099'),f=>f.job.templateSnapshot.version=3,f=>f.job.rows[0].resolvedTarget.platformEditUrl='https://example.com/wrong',f=>f.job.action='inspect']){
    const f=fixture();mutate(f);await assert.rejects(diagnoseListingRow(f.options,f.deps));assert.equal(f.calls.length,0);
  }
});
test('an unexpected result cannot report another target as a successful diagnosis',async()=>{
  for(const mutate of [row=>row.goodsId='601234567890099',row=>row.storeBindingKey='store-two',row=>row.storeName='店铺2',row=>row.site='美国站',row=>row.draftId='220114595121490001']){
    const f=fixture(),row={...f.job.rows[0],status:'located',draftId,platformEditUrl,snapshot:{}};mutate(row);f.setResult({rows:[row]});const report=await diagnoseListingRow(f.options,f.deps);assert.equal(report.ok,false);assert.match(report.error,/不属于/);
  }
});
test('reading failures return nonzero and bounded redacted diagnostics without snapshots or credentials',async()=>{
  const f=fixture();f.setResult({rows:[{...f.job.rows[0],status:'needs-review',draftId,platformEditUrl,issues:['fixture-secret fixture-account https://example.com/private'],pagerDiagnostics:{currentPage:1,inputs:Array.from({length:20},()=>({title:'页数',value:'fixture-secret',password:'never-output'})),account:'fixture-account',snapshot:{private:true},url:'https://example.com/private'}}]});
  let output='';const code=await runCli(['--base-url',f.options.baseUrl,'--job-id',f.options.jobId,'--goods-id',goodsId,'--store-key','store-one'],{...f.deps,write:value=>output+=value}),report=JSON.parse(output);
  assert.equal(code,1);assert.equal(report.ok,false);assert.equal(report.snapshotRead,false);assert.equal(report.pagerDiagnostics.inputs.length,10);assert.ok(!output.includes('fixture-secret'));assert.ok(!output.includes('fixture-account'));assert.ok(!output.includes('https://'));assert.ok(!output.includes('never-output'));assert.equal(report.pagerDiagnostics.snapshot,undefined);
});
test('adapter exceptions are summarized with bounded edit diagnostics and never exposed as a stack',async()=>{
  const f=fixture();f.deps.adapterFactory=()=>({inspect:async()=>{throw Object.assign(new Error('fixture-secret fixture-account https://example.com/private failed'),{data:{editDiagnostics:{stage:'open',draftId,pagePath:'/web/popTemu/pageList/draft',buttonCount:2,captureError:'x'.repeat(500),snapshot:{private:true}},unrelated:{private:true}}});}});
  const report=await diagnoseListingRow(f.options,f.deps);assert.equal(report.ok,false);assert.equal(report.status,'failed');assert.equal(report.editDiagnostics.captureError.length,160);assert.equal(report.editDiagnostics.buttonCount,2);assert.equal(report.editDiagnostics.snapshot,undefined);assert.equal(report.unrelated,undefined);assert.ok(!JSON.stringify(report).includes('fixture-secret'));assert.equal(report.stack,undefined);
});
test('help is side-effect free and only local exact CLI arguments are accepted',async()=>{
  let output='';assert.equal(await runCli(['--help'],{fetcher:()=>{throw new Error('no fetch');},adapterFactory:()=>{throw new Error('no browser');},write:value=>output+=value}),0);assert.match(output,/只读诊断/);
  assert.throws(()=>parseArguments(['--job-id','one','--goods-id',goodsId,'--store-key','one','--base-url','https://example.com']),/本机HTTP/);
  assert.throws(()=>parseArguments(['--job-id','one','--job-id','two']),/重复/);
  assert.throws(()=>parseArguments(['--job-id','one']),/必须指定/);
});
