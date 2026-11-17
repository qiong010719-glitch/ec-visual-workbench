import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {copyReviewFixture,repeatedHeadline} from './copy-review-fixture.mjs';
import {applyCopyRepairs,copyRepairTargets,rewriteCopy} from '../src/copy-review.mjs';
import {createWorkbench} from '../src/server.mjs';
import path from 'node:path';

const replacement=t=>({setId:t.setId,slot:t.slot,headline:t.setIndex===2?'Inspect the Canvas Details':'Explore the Artwork Up Close'});
test('automatic repair changes only conflicting headlines, blocks images while checking, and checks before ready',async t=>{
  let release,started;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r);let calls=0;
  const f=await copyReviewFixture({copyRewriter:async(g,targets)=>{calls++;started();await gate;return targets.map(replacement);}});
  t.after(f.close);t.after(()=>release());
  await f.api(f.route+'/plan',{});await entered;
  let b=await f.api(f.route),g=b.products[0].group,groupRoute='/api/temu/multisets/'+g.id;
  assert.equal(b.phase,'planning');assert.equal(g.phase,'planning');assert.equal(g.quality.issues.length,2);
  await assert.rejects(f.api(groupRoute+'/generate',{}),/检查/);
  await assert.rejects(f.api(groupRoute+'/plan-text',{setId:g.sets[0].id,text:g.sets[0].plan.text}),/修正文案/);
  await f.api(groupRoute+'/repair-copy',{});assert.equal(calls,1,'duplicate repair action is idempotent while busy');
  assert.equal(Object.keys(f.app.store.state.tasks).filter(k=>k.startsWith('hyrule_tasks/')).length,0);
  release();b=await f.wait(f.route,b=>b.phase!=='planning');g=b.products[0].group;
  assert.equal(b.phase,'ready');assert.equal(g.copyRepair.changedHeadlines,2);assert.deepEqual(g.quality.issues,[]);
  for(const [i,set] of g.sets.entries()){
    const original=f.originals.get(set.id),expected=i?original.text.replace(repeatedHeadline,replacement({setIndex:i+1}).headline):original.text;
    assert.equal(set.plan.text,expected,'all non-conflicting text and whitespace must be unchanged');
    assert.deepEqual(set.plan.sections,original.sections);
    if(i)assert.equal(f.app.store.state.tasks['agent_tasks/'+set.planId].copyRepairHistory.length,1);
  }
  assert.equal(g.completedImages,0);assert.equal(f.writes.length,0);
  await f.api(f.route+'/plan',{});await f.wait(f.route,b=>b.phase==='ready');assert.equal(calls,1,'successful repair is not repeated');
  await f.api(f.route+'/generate',{});b=await f.wait(f.route,b=>b.phase!=='generating');assert.equal(b.phase,'completed');assert.equal(b.products[0].group.completedImages,9);
});

test('failed recheck keeps every original plan and reports exact positions, including stale ready batches',async t=>{
  let calls=0;
  const f=await copyReviewFixture({copyRewriter:async(g,targets)=>{calls++;return targets.map(t=>({...replacement(t),headline:repeatedHeadline}));}});t.after(f.close);
  await f.api(f.route+'/plan',{});let b=await f.wait(f.route,b=>b.phase!=='planning'),g=b.products[0].group;
  assert.equal(b.phase,'attention');assert.equal(g.copyRepair.status,'failed');assert.equal(calls,2);
  assert.match(b.products[0].error,/第 1 套.*卖点图1.*第 2 套/);assert.match(b.products[0].error,/仍有重复/);
  for(const set of g.sets)assert.deepEqual(set.plan,f.originals.get(set.id));
  const saved=f.app.store.state.productBatches[b.id];saved.phase='ready';saved.products[0].status='ready';
  f.app.store.state.listingTitles[g.id]=g.sets.map((s,i)=>({setId:s.id,title:'帆布画',englishTitle:'Canvas '+i}));
  b=await f.api(f.route);assert.equal(b.phase,'attention');assert.equal(b.products[0].status,'attention');
  assert.equal((await f.api('/api/products'))[0].phase,'attention');
  await assert.rejects(f.api(f.route+'/generate',{}),/第 1 套/);assert.equal(calls,2,'reads and blocked generation must not retry text calls');
  for(const [i,set] of g.sets.entries())if(i)await f.api('/api/temu/multisets/'+g.id+'/plan-text',{setId:set.id,text:set.plan.text.replace(repeatedHeadline,replacement({setIndex:i+1}).headline)});
  b=await f.api(f.route);assert.equal(b.phase,'ready');assert.equal(b.products[0].error,null);assert.equal(b.products[0].group.copyRepair.error,null);
});

test('service errors stop after one attempt; explicit retry can recover without replacing whole plans',async t=>{
  let calls=0;
  const f=await copyReviewFixture({copyRewriter:async(g,targets)=>{if(++calls===1)throw new Error('fixture timeout');return targets.map(replacement);}});t.after(f.close);
  await f.api(f.route+'/plan',{});let b=await f.wait(f.route,b=>b.phase!=='planning');assert.match(b.products[0].error,/fixture timeout/);
  await f.api(f.route);assert.equal(calls,1);
  await f.api(f.route+'/plan',{});b=await f.wait(f.route,b=>b.phase!=='planning');assert.equal(b.phase,'ready');assert.equal(calls,2);assert.equal(f.originals.size,3);
});

test('repair targets protect submitted sets and reject malformed or out-of-scope edits atomically',async t=>{
  const f=await copyReviewFixture({copyRewriter:async()=>{throw new Error('manual check');}});t.after(f.close);
  await f.api(f.route+'/plan',{});const b=await f.wait(f.route,b=>b.phase!=='planning'),g=b.products[0].group;
  g.sets[2].images[0].attempts=['already-submitted'];
  const targets=copyRepairTargets(g);assert.deepEqual(targets.map(t=>t.setId),g.sets.slice(0,2).map(s=>s.id));
  assert.throws(()=>applyCopyRepairs(g,targets,[{setId:'wrong',slot:1,headline:'Wrong target'},replacement(targets[1])]),/位置不匹配/);
  assert.throws(()=>applyCopyRepairs(g,targets,targets.map(t=>({...replacement(t),headline:'No text'}))),/标题无效/);
  assert.throws(()=>applyCopyRepairs(g,targets,[replacement(targets[0]),replacement(targets[0])]),/位置不匹配/);
  g.sets[0].images[0].attempts=['also-submitted'];assert.throws(()=>copyRepairTargets(g),/多套已提交/);
  for(const set of g.sets)assert.deepEqual(set.plan,f.originals.get(set.id));
});

test('restart preserves interrupted repair and does not call the text service on reads',async t=>{
  let calls=0;const f=await copyReviewFixture({copyRewriter:async()=>{throw new Error('manual check');}});t.after(f.close);
  await f.api(f.route+'/plan',{});const b=await f.wait(f.route,b=>b.phase!=='planning'),id=b.products[0].group.id;
  f.app.store.state.multisets[id].copyRepair={status:'running'};f.app.store.save();
  const restarted=createWorkbench({dataDirectory:path.join(f.dir,'data'),configuration:{},copyRewriter:async()=>{calls++;return [];}});
  await new Promise(r=>restarted.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>restarted.server.close(r)));
  const g=await fetch('http://127.0.0.1:'+restarted.server.address().port+'/api/temu/multisets/'+id).then(r=>r.json());
  assert.equal(g.copyRepair.status,'failed');assert.match(g.copyRepair.error,/中断/);assert.equal(g.phase,'attention');assert.equal(calls,0);
});

test('targeted text repair supports both configured transports and sends facts plus all existing titles',async t=>{
  const seen=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);seen.push({url:req.url,body});
    const content=JSON.stringify({replacements:[{setId:'b',slot:1,headline:'Inspect the Canvas Details'}]});
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/responses'?{status:'completed',output_text:content}:{choices:[{finish_reason:'stop',message:{content}}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const group={source:{product_name:'Canvas',product_desc:'Size 30x60',target_lang:'English'},sets:[{id:'b',direction:{name:'Details'},plan:{text:'【卖点图1】\n画面主标题：Canvas Details',copyHeadlines:[{headline:'Canvas Details'}]}}]};
  for(const format of ['chat','responses'])assert.equal((await rewriteCopy(group,[{setId:'b',slot:1,title:'【卖点图1】',headline:'Canvas Details'}],{PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,PLANNER_API_KEY:'test-only',PLANNER_MODEL:'test',PLANNER_API_FORMAT:format}))[0].headline,'Inspect the Canvas Details');
  assert.deepEqual(seen.map(r=>r.url),['/chat/completions','/responses']);
  for(const {body} of seen){const input=JSON.parse(body.input?.[0].content||body.messages[1].content);assert.equal(input.facts,'Size 30x60');assert.deepEqual(input.existingHeadlines,['Canvas Details']);assert.equal(input.targets.length,1);}
});
