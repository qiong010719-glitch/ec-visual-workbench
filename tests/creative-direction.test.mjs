import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {buildPlan,planProduct,promptForSlot,splitPlan} from '../src/planner.mjs';
import {readCreativeCopy} from '../src/creative-direction.mjs';

const base={product_name:'滑板砂纸',product_desc:'特殊材质；经久耐用；高性价比',generation_mode:'master',visual_style:'scene_advertising',design_scope:'custom',custom_layout:{main:1,sub:6,aplus:5},target_lang:'English'};
const direction=styleId=>({name:'测试方向',audience:'关注滑板用品的用户',motivation:'了解实物外观及已知材质信息',scene:'适合本商品用途的空间',styleId});

test('creative styles change actual cameras, people, composition and typography without generic copy',()=>{
  const plans=['natural','precise','urban'].map(styleId=>buildPlan({...base,creative_direction:direction(styleId)}));
  const first=plans.map(p=>p.sections[1].storyboard);
  assert.equal(new Set(first.map(b=>b.camera)).size,3);
  assert.equal(new Set(first.map(b=>b.composition)).size,3);
  assert.equal(first[0].humanPresence,'person');assert.equal(first[1].humanPresence,'none');
  assert.match(first[1].scene,/摄影背景/);assert.match(first[2].camera,/低机位/);
  for(const plan of plans){
    assert.doesNotMatch(plan.text,/SEE IT IN YOUR DAY|TAKE A CLOSER LOOK|THE BIGGER PICTURE/);
    assert.doesNotMatch(plan.styleGuide,/Inter \/ Helvetica/);
    assert.equal(plan.sections[2].storyboard.humanPresence,'none');
    assert.equal(plan.sections[3].storyboard.humanPresence,'hands');
    assert.match(promptForSlot({},plan.sections[0],plan),/白底、产品完整入镜/);
    assert.ok(promptForSlot({},plan.sections[1],plan).includes(plan.sections[1].storyboard.camera));
    assert.deepEqual(plan.sections[2].storyboard.supportingFacts,plans[0].sections[2].storyboard.supportingFacts);
  }
  assert.match(buildPlan(base).text,/SEE IT IN YOUR DAY/,'single-set behavior is unchanged');
});

test('copy validation rejects inherited generic headlines and duplicated marketing copy but allows explicit shared text',()=>{
  const plan=buildPlan({...base,creative_direction:direction('natural')});
  const text=plan.sections.map(s=>s.title+'\n内容'+(s.outputConstraint?'':`\n画面主标题：Product detail ${s.slot}\n画面副文案：Visible details.`)).join('\n');
  assert.equal(readCreativeCopy(splitPlan(text).blocks,plan.sections).length,11);
  const generic=text.replace('Product detail 1','SEE IT IN YOUR DAY');
  assert.throws(()=>readCreativeCopy(splitPlan(generic).blocks,plan.sections),/通用模板标题/);
  assert.throws(()=>readCreativeCopy(splitPlan(text.replace('Product detail 2','Product detail 1')).blocks,plan.sections),/主标题重复/);
  assert.doesNotThrow(()=>readCreativeCopy(splitPlan(generic).blocks,plan.sections,'每套第一张必须使用标题 SEE IT IN YOUR DAY'));
  const inline=text.replaceAll('\n画面主标题：','。**画面主标题：**');
  assert.deepEqual(readCreativeCopy(splitPlan(inline).blocks,plan.sections).map(c=>c.headline),readCreativeCopy(splitPlan(text).blocks,plan.sections).map(c=>c.headline));
});

test('configured creative planning requires printable copy and retains incomplete output for explicit repair',async t=>{
  const payload={...base,custom_layout:{main:0,sub:1,aplus:0},creative_direction:direction('precise')};
  let result='【卖点图1】\n完整设计方案\n画面主标题：Material in Focus\n画面副文案：A visible surface, clearly shown.';
  const server=http.createServer(async(request,response)=>{for await(const chunk of request){}response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:result},finish_reason:'stop'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const config={PLANNER_BASE_URL:'http://127.0.0.1:'+server.address().port,PLANNER_API_KEY:'fixture-key',PLANNER_MODEL:'fixture-model'};
  const plan=await planProduct(payload,config);assert.equal(plan.copyHeadlines[0].headline,'Material in Focus');
  result='【卖点图1】\n完整设计方案，但没有印刷文案。';
  await assert.rejects(()=>planProduct(payload,config),error=>error.code==='PLANNER_COPY'&&error.partialPlanText===result);
});
