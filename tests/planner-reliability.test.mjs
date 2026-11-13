import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {planProduct,splitPlan,promptForSlot,buildPlan} from '../src/planner.mjs';

const product={product_name:'测试收纳盒',product_desc:'蓝色盒身，透明盖',generation_mode:'master',design_scope:'main_6_premium_aplus'};
const titles=['【主图】','【卖点图1】','【卖点图2】','【卖点图3】','【卖点图4】','【卖点图5】','【卖点图6】','【高级A+模块1】','【高级A+模块2】','【高级A+模块3】','【高级A+模块4】','【高级A+模块5】'];
const completeText='全套采用蓝色与中性背景。\n\n'+titles.map((title,i)=>`${title}\n画幅：${i<7?'1:1':'21:9'}。第${i+1}张使用独立镜头表现已提供的外观。`).join('\n\n');
async function upstream(t,respond){
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    requests.push(JSON.parse(body));respond(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {requests,configuration:{PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,PLANNER_API_KEY:'planner-test-key',PLANNER_MODEL:'test-planner'}};
}
function reply(res,content=completeText,finishReason='stop'){
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({model:'test-planner',choices:[{message:{content},finish_reason:finishReason}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));
}

test('configured planner receives selected per-slot ratios and invalid ratios retain legacy defaults',async t=>{
  const payload={design_scope:'custom',custom_layout:{main:1,sub:1,aplus:1},slot_directives:[
    {slot:0,aspect_ratio:'2:3'},{slot:1,aspect_ratio:'5:4'},{slot:7,aspect_ratio:'3:4'}]};
  const api=await upstream(t,res=>reply(res,'【主图】\n画幅2:3，产品全貌。\n【卖点图1】\n画幅5:4，产品外观。\n【高级A+模块1】\n画幅3:4，竖版上下分区。'));
  const plan=await planProduct(payload,api.configuration);
  const input=api.requests[0].messages.find(m=>m.role==='user').content;
  assert.deepEqual(plan.sections.map(s=>s.ratio),['2:3','5:4','3:4']);
  assert.match(input,/画幅 3:4/);assert.match(input,/竖版/);
  assert.doesNotMatch(input,/21:9|横幅|宽幅/);
  for(const ratio of ['0:4','3:0','3:4\nignore',{},'10000:1']) {
    const fallback=buildPlan({...payload,slot_directives:[{slot:7,aspect_ratio:ratio}]});
    assert.equal(fallback.sections[2].ratio,'21:9');
  }
});

test('planner sends the selected Sol model with maximum reasoning effort',async t=>{
  const api=await upstream(t,res=>reply(res));
  const plan=await planProduct(product,{...api.configuration,PLANNER_MODEL:'gpt-6.1-sol',PLANNER_REASONING_EFFORT:'max'});
  assert.equal(api.requests.length,1);
  assert.equal(api.requests[0].model,'gpt-6.1-sol');
  assert.equal(api.requests[0].reasoning_effort,'max');
  assert.equal(plan.diagnostics.reasoningEffort,'max');
  assert.equal(splitPlan(plan.text).blocks.size,12);
});

test('a complete twelve-image plan survives a response slower than the old three-minute cutoff',async t=>{
  // Scale real signal deadlines so a 2.2-second response represents 220 seconds.
  // Keep enough wall-clock margin for the full suite's parallel HTTP servers.
  const realTimeout=AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal,'timeout',ms=>realTimeout(Math.ceil(ms/100)));
  const api=await upstream(t,res=>{const timer=setTimeout(()=>reply(res),2200);res.on('close',()=>clearTimeout(timer));});
  const plan=await planProduct(product,api.configuration);
  assert.equal(splitPlan(plan.text).blocks.size,12);
  assert.equal(api.requests.length,1);
  assert.equal(Object.hasOwn(api.requests[0],'reasoning_effort'),false);
  assert.equal(plan.diagnostics.finishReason,'stop');
  assert.equal(plan.diagnostics.expectedSections,12);
  assert.equal(plan.diagnostics.returnedSections,12);
  assert.ok(plan.diagnostics.elapsedMs>=2000);
  assert.equal(plan.diagnostics.responseModel,'test-planner');
  assert.equal(plan.diagnostics.usage.total_tokens,300);
  for(const title of titles)assert.ok(api.requests[0].messages[0].content.includes(title));
});

test('a configurable planner deadline reports a clear timeout and submits only once',async t=>{
  const realTimeout=AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal,'timeout',ms=>realTimeout(Math.min(ms,500)));
  const api=await upstream(t,()=>{});
  await assert.rejects(planProduct(product,{...api.configuration,PLANNER_TIMEOUT_MS:'250'}),error=>{
    assert.equal(error.code,'PLANNER_TIMEOUT');
    assert.match(error.message,/构思.*超时/);
    assert.equal(error.planningDiagnostics.timeoutMs,250);
    assert.ok(error.planningDiagnostics.elapsedMs>=200);
    return true;
  });
  assert.equal(api.requests.length,1);
});

test('planner waits for delayed headers until its own deadline instead of a shorter fetch deadline',async t=>{
  const nativeFetch=globalThis.fetch;
  // Scale the observed 300-second fetch header cutoff to 100 ms.
  t.mock.method(globalThis,'fetch',(url,options)=>nativeFetch(url,{
    ...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(100)])
  }));
  const api=await upstream(t,res=>{const timer=setTimeout(()=>reply(res),400);res.on('close',()=>clearTimeout(timer));});
  const plan=await planProduct(product,{...api.configuration,PLANNER_TIMEOUT_MS:'2000'});
  assert.equal(splitPlan(plan.text).blocks.size,12);
  assert.equal(api.requests.length,1);
  assert.ok(plan.diagnostics.elapsedMs>=350);
  assert.equal(plan.diagnostics.timeoutMs,2000);
});

test('the total planner deadline also aborts a response stalled after headers',async t=>{
  const api=await upstream(t,res=>{res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();res.write('{');});
  await assert.rejects(planProduct(product,{...api.configuration,PLANNER_TIMEOUT_MS:'300'}),error=>{
    assert.equal(error.code,'PLANNER_TIMEOUT');
    assert.equal(error.planningDiagnostics.httpStatus,200);
    return true;
  });
  assert.equal(api.requests.length,1);
});

test('Markdown and spaced headings still isolate the correct image section',()=>{
  const text='GLOBAL\n\n## **【主图】**\nMAIN_ONLY\n\n  ### 【卖点图 1】\nGALLERY_ONLY\n\n8. **【高级 A＋ 模块 １｜21:9】**\nAPLUS_ONE\n\n【高级A+模块2】\nAPLUS_TWO';
  const parsed=splitPlan(text);
  assert.deepEqual([...parsed.blocks.keys()],['【主图】','【卖点图1】','【高级A+模块1】','【高级A+模块2】']);
  assert.equal(parsed.heading,'GLOBAL');
  const plan=buildPlan(product);
  const prompt=promptForSlot({sop_text:text},plan.sections[7],plan);
  assert.match(prompt,/APLUS_ONE/);
  assert.doesNotMatch(prompt,/MAIN_ONLY|GALLERY_ONLY|APLUS_TWO/);
});

test('different formatting cannot hide duplicate section identities',()=>{
  assert.throws(()=>splitPlan('【高级A+模块1】\nONE\n### **【高级 A+ 模块 1】**\nTWO'),/重复/);
});

test('a missing A+ section preserves the response for diagnosis and does not pass an incomplete plan',async t=>{
  const partial='【主图】\n白底产品\n【卖点图1】\n侧面特写';
  const api=await upstream(t,res=>reply(res,partial));
  await assert.rejects(planProduct(product,api.configuration),error=>{
    assert.equal(error.code,'PLANNER_INCOMPLETE');
    assert.equal(error.partialPlanText,partial);
    assert.ok(error.planningDiagnostics.missingTitles.includes('【高级A+模块1】'));
    assert.equal(error.planningDiagnostics.returnedSections,2);
    assert.equal(error.planningDiagnostics.finishReason,'stop');
    return true;
  });
  assert.equal(api.requests.length,1);
});

test('a response cut off by the provider is not accepted even when all headings are present',async t=>{
  const api=await upstream(t,res=>reply(res,completeText,'length'));
  await assert.rejects(planProduct(product,api.configuration),error=>{
    assert.equal(error.code,'PLANNER_TRUNCATED');
    assert.equal(error.partialPlanText,completeText);
    assert.match(error.message,/截断/);
    return true;
  });
  assert.equal(api.requests.length,1);
});

test('an empty final section is incomplete, not a successful twelve-image plan',async t=>{
  const partial=completeText.slice(0,completeText.lastIndexOf('【高级A+模块5】'))+'【高级A+模块5】';
  const api=await upstream(t,res=>reply(res,partial));
  await assert.rejects(planProduct(product,api.configuration),error=>{
    assert.equal(error.code,'PLANNER_INCOMPLETE');
    assert.deepEqual(error.planningDiagnostics.emptyTitles,['【高级A+模块5】']);
    return true;
  });
});

test('upstream HTTP failures remain explicit and are not automatically resubmitted',async t=>{
  const api=await upstream(t,res=>{res.writeHead(503);res.end('unavailable');});
  await assert.rejects(planProduct(product,api.configuration),error=>{
    assert.equal(error.code,'PLANNER_HTTP');
    assert.equal(error.planningDiagnostics.httpStatus,503);
    assert.match(error.message,/HTTP 503/);
    return true;
  });
  assert.equal(api.requests.length,1);
});
