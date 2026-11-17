import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {buildPlan,splitPlan,planProduct} from '../src/planner.mjs';
import {readCreativeCopy,headlineField} from '../src/creative-direction.mjs';
import {reviewCopy,copyRepairTargets,applyCopyRepairs,rewriteCopy} from '../src/copy-review.mjs';
import {generateListingTitles} from '../src/listing-titles.mjs';
import {copyReviewFixture,repeatedHeadline} from './copy-review-fixture.mjs';
import {merchantFixture} from './merchant-fixture.mjs';
import {createWorkbench} from '../src/server.mjs';

const good=t=>({setId:t.setId,slot:t.slot,headline:['Inspect the Canvas Details','Explore the Artwork Up Close'][t.setIndex-2]});
async function upstream(t,respond){
  const requests=[],server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw);requests.push(data);await respond(data,res,requests.length);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  return {requests,configuration:{PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,PLANNER_API_KEY:'fixture-only',PLANNER_MODEL:'fixture',PLANNER_API_FORMAT:'responses',TITLE_API_FORMAT:'responses'}};
}
const reply=(res,text)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'completed',output_text:typeof text==='string'?text:JSON.stringify(text)}));};

test('formatted headlines share one source span; within-set and cross-set conflicts repair only title fields',()=>{
  const plain='Clear and non-yellowing';
  for(const raw of [plain,'Clear **and** non-yellowing','**Clear and non-yellowing**','“Clear **and** non-yellowing”','「Clear and non-yellowing」',"'Clear and non-yellowing'"]){
    const prefix='【卖点图1】\r\n**画面主标题：** ',suffix='；画面副文案：Keep this unchanged.\r\n镜头：保留。';
    const block=prefix+raw+suffix,field=headlineField(block);
    assert.equal(field.headline,plain);
    assert.equal(block.slice(0,field.start)+'Replacement'+block.slice(field.end),prefix+'Replacement'+suffix);
  }
  assert.equal(headlineField('画面主标题：\n画面副文案：Not a headline'),null);
  const make=(id,fields)=>{
    const sections=fields.map((_,i)=>({slot:i+1,title:`【卖点图${i+1}】`})),text=sections.map((s,i)=>s.title+'\r\n画面主标题：'+fields[i]+'\r\n画面副文案：Do not change.').join('\r\n\r\n');
    return {id,direction:{name:id},images:[],plan:{...buildPlan({generation_mode:'master',design_scope:'main_only'}),creativeVersion:'',text,sections}};
  };
  const a=make('a',[plain,'“Clear **and** non-yellowing”']),b=make('b',[plain,'Canvas Edge']);
  // Use the current version from a real directed plan.
  // Version is exported rather than tied to fixture direction IDs.
  for(const s of [a,b]){s.plan.creativeVersion=version;s.plan.copyHeadlines=readCreativeCopy(splitPlan(s.plan.text).blocks,s.plan.sections,'',{allowDuplicates:true});}
  const group={sets:[a,b]},targets=copyRepairTargets(group),before=structuredClone(group);
  assert.deepEqual(targets.map(t=>[t.setId,t.slot]),[['a',2],['b',1]]);
  const candidates=applyCopyRepairs(group,targets,[{setId:'a',slot:2,headline:'See the Clear Surface'},{setId:'b',slot:1,headline:'A View of the Finish'}]);
  assert.equal(candidates.get('a').plan.text,a.plan.text.replace('“Clear **and** non-yellowing”','See the Clear Surface'));
  assert.equal(candidates.get('b').plan.text,b.plan.text.replace(plain,'A View of the Finish'));
  assert.deepEqual(group,before);
  assert.equal(reviewCopy(group.sets.map(s=>({...s,plan:candidates.get(s.id).plan}))).issues.length,0);
});
import {CREATIVE_DIRECTION_VERSION as version} from '../src/creative-direction.mjs';

test('a real grouped planner retains an internally duplicated plan for targeted review, while single plans reject it',async t=>{
  const f=await copyReviewFixture({copyRewriter:async(g,targets)=>targets.map(good)});t.after(f.close);
  await f.api(f.route+'/plan',{});const done=await f.wait(f.route,b=>b.phase==='ready');
  const task=Object.values(f.app.store.state.tasks).find(t=>t.payload?.group_id),payload=task.payload;
  const original=task.plan,text=original.text.replace(original.copyHeadlines[1].headline,original.copyHeadlines[0].headline);
  const api=await upstream(t,(_,res)=>reply(res,text));
  const plan=await planProduct(payload,api.configuration);
  assert.equal(plan.copyHeadlines[0].normalized,plan.copyHeadlines[1].normalized);
  assert.equal(reviewCopy([{id:'one',direction:{name:'one'},plan}]).issues.length,1);
  await assert.rejects(planProduct({...payload,group_id:undefined},api.configuration),/本套画面主标题重复/);
});

test('second copy pass receives the rejected answer and stops after two duplicate responses',async t=>{
  const calls=[];
  const f=await copyReviewFixture({copyRewriter:async(g,targets)=>{calls.push(g.repairFeedback);return targets.map(t=>calls.length===2?good(t):{setId:t.setId,slot:t.slot,headline:repeatedHeadline});}});t.after(f.close);
  await f.api(f.route+'/plan',{});let b=await f.wait(f.route,b=>b.phase!=='planning');
  assert.equal(b.phase,'ready');assert.equal(calls.length,2);assert.match(calls[1].error,/仍有重复/);assert.equal(calls[1].replacements.length,2);
  assert.equal(b.products[0].group.copyRepair.attempt,2);
  assert.equal(Object.keys(f.app.store.state.tasks).filter(k=>k.startsWith('hyrule_tasks/')).length,0);
});

test('a failed plan remains visible alongside duplicate pending plans; successful plans are not regenerated on retry',async t=>{
  let n=0,release;const gate=new Promise(r=>release=r);
  const f=await copyReviewFixture({planner:async payload=>{
    const index=++n;if(index===3){await gate;throw new Error('构思服务请求超时');}
    const plan=buildPlan(payload),text=plan.sections.map(s=>s.title+'\n镜头保持。'+(s.outputConstraint?'':`\n画面主标题：${s.slot===1?repeatedHeadline:'Canvas '+payload.creative_direction.styleId}`)).join('\n\n');
    return {...plan,text,copyHeadlines:readCreativeCopy(splitPlan(text).blocks,plan.sections)};
  },copyRewriter:async(g,targets)=>targets.map(good)});t.after(f.close);t.after(()=>release());
  await f.api(f.route+'/plan',{});
  let b=await f.wait(f.route,b=>b.products[0].group?.sets.filter(s=>s.planning.status==='completed').length===2);
  assert.equal(b.phase,'planning');assert.equal(b.products[0].error,null,'a pending duplicate is not a fatal error');
  release();b=await f.wait(f.route,b=>b.phase==='attention');
  assert.match(b.products[0].error,/第 3 套构思失败.*超时/);assert.doesNotMatch(b.products[0].error,/画面标题重复/);
  const ids=b.products[0].group.sets.map(s=>s.planId);
  await f.api(f.route+'/plan',{});b=await f.wait(f.route,b=>b.phase==='ready');
  assert.equal(n,4);assert.deepEqual(b.products[0].group.sets.slice(0,2).map(s=>s.planId),ids.slice(0,2));
});

test('copy repair body timeout gives an actionable message and is submitted only once',async t=>{
  const api=await upstream(t,(_,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();res.write('{');});
  const group={source:{},sets:[{id:'b',direction:{},plan:{text:'【卖点图1】\n画面主标题：Clear',copyHeadlines:[{headline:'Clear'}]}}]};
  await assert.rejects(rewriteCopy(group,[{setId:'b',slot:1,title:'【卖点图1】',headline:'Clear'}],{...api.configuration,PLANNER_TIMEOUT_MS:'1000'}),/文案修正请求超时.*未自动重复提交/);
  assert.equal(api.requests.length,1);
});

const titleGroup={source:{platform:'temu',target_market:'加拿大站',product_name:'装饰画',product_desc:'蓝色图案；无框帆布画'},sets:[{id:'a'},{id:'b'},{id:'c'}]};
const row=(id,text)=>({setId:id,title:text,englishTitle:text,chineseTitle:'蓝色图案无框帆布装饰画'});
const originalTitles=[row('a','Blue Pattern Canvas Wall Art'),row('b','Blue Pattern Canvas Wall Art'),row('c','Unframed Blue Pattern Art Print')];
const input=body=>{const content=body.input??body.messages[1].content;return JSON.parse(typeof content==='string'?content:Array.isArray(body.input)?content[0].content[0].text:content[0].text);};
test('listing repair changes only duplicate rows, validates bilingual fields, and bounds repeated conflicts to two attempts',async t=>{
  let mode='success';const progress=[];
  const api=await upstream(t,(body,res)=>{const data=input(body);reply(res,{titles:data.existingTitles?data.sets.map(s=>row(s.id,mode==='success'?'Decorative Canvas Print with Blue Pattern':'Blue Pattern Canvas Wall Art')):originalTitles});});
  let result=await generateListingTitles(titleGroup,api.configuration,{onProgress:p=>progress.push(p)});
  assert.deepEqual(result[0],originalTitles[0]);assert.deepEqual(result[2],originalTitles[2]);assert.notEqual(result[1].englishTitle,originalTitles[1].englishTitle);
  assert.deepEqual(input(api.requests[1]).sets,[{id:'b'}]);assert.equal(api.requests.length,2);
  mode='duplicate';const before=api.requests.length;
  await assert.rejects(generateListingTitles(titleGroup,api.configuration,{onProgress:p=>progress.push(p)}),/两轮修正仍有重复/);
  assert.equal(api.requests.length-before,3);assert.equal(progress.at(-1).status,'failed');assert.deepEqual(progress.at(-1).titles,originalTitles);
});

test('malformed title repairs stop once and preserve candidate rows',async t=>{
  const api=await upstream(t,(_,res)=>reply(res,{titles:[row('wrong','Another Canvas Artwork')]}));
  const progress=[];
  await assert.rejects(generateListingTitles(titleGroup,api.configuration,{resumeTitles:originalTitles,onProgress:p=>progress.push(p)}),/位置或数量不匹配/);
  assert.equal(api.requests.length,1);assert.deepEqual(progress.at(-1).titles,originalTitles);
});

test('title transport failure preserves pending titles across restart; explicit retry repairs them without replanning',async t=>{
  let failRepair=true;const requests=[];
  const api=await upstream(t,(body,res)=>{
    const data=input(body);requests.push(data);
    if(data.existingTitles&&failRepair){res.writeHead(503);res.end('{}');return;}
    reply(res,{titles:data.sets.map((s,i)=>row(s.id,data.existingTitles?'Blue Canvas Wall Print for Room Decor':'Canvas Artwork with a Blue Pattern'))});
  });
  const f=await merchantFixture({configuration:{WORKBENCH_FRESH:'true',...api.configuration},directionPlanner:async g=>({source:'rules',directions:ruleDirections(g)}),planner:async p=>buildPlan(p),titlePlanner:generateListingTitles});t.after(f.close);
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  const b=await f.api('/api/products',{requestId:'duplicate-title-restart',storeKey:'merchant-ca',products:[{...imported.products[0],count:2}],imageCount:1,ratio:'1:1',mode:'fast'}),route='/api/products/'+b.id;
  await f.api(route+'/plan',{});let value=await f.wait(route,v=>v.phase==='attention');
  assert.match(value.products[0].error,/HTTP 503/);assert.equal(requests.length,2);assert.equal(value.products[0].pendingTitles,undefined);
  const saved=f.app.store.state.productBatches[b.id].products[0],pending=structuredClone(saved.pendingTitles),planIds=value.products[0].group.sets.map(s=>s.planId);
  assert.equal(pending.length,2);assert.deepEqual(value.products[0].titles,[]);
  f.app.store.save();failRepair=false;
  const restarted=createWorkbench({dataDirectory:path.join(f.dir,'data'),configuration:{WORKBENCH_FRESH:'true',...api.configuration},titlePlanner:generateListingTitles,planner:async()=>{throw new Error('must not regenerate valid plans');},erpAdapter:{validateMother:async({store})=>({valid:true,issues:[],sourceMode:'product',draftId:store.draftId,actualStore:store.expectedStore,actualSite:store.expectedSite})}});
  await new Promise(r=>restarted.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>restarted.server.close(r)));
  const base='http://127.0.0.1:'+restarted.server.address().port,{token}=await fetch(base+'/api/session').then(r=>r.json());
  const started=await fetch(base+route+'/plan',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:'{}'});assert.equal(started.status,200);
  for(let i=0;i<150;i++){value=await fetch(base+route).then(r=>r.json());if(value.phase!=='planning')break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(value.phase,'ready',value.products[0].error);assert.equal(requests.length,3);assert.equal(requests[2].existingTitles.length,2);
  assert.deepEqual(value.products[0].titles[0],pending[0]);assert.deepEqual(value.products[0].group.sets.map(s=>s.planId),planIds);
  assert.equal(restarted.store.state.productBatches[b.id].products[0].pendingTitles,undefined);
  assert.equal(Object.keys(restarted.store.state.tasks).filter(k=>k.startsWith('hyrule_tasks/')).length,0);
});
import {ruleDirections} from '../src/multisets.mjs';
