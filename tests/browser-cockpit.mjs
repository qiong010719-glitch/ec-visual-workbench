import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

// Run against a fresh, temporary application service. The six destinations are
// real app pages, while this one API fixture makes the overview countable. No
// saved account, user Chrome profile, model provider or ERP is used.
const output=path.resolve(process.env.COCKPIT_QA_OUTPUT||'D:/agent合集/自动上架/outputs/tech-ui-integration-20261121/verification');
fs.mkdirSync(output,{recursive:true});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-ui-'));
let providerCalls=0,workspaceUnavailable=false,workspaceReads=0;
const failExternal=()=>{providerCalls++;throw new Error('No external business call is allowed in cockpit UI verification');};
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true',WORKBENCH_STYLE_PREVIEW:'true'},
  provider:failExternal,planner:failExternal,directionPlanner:failExternal,titlePlanner:failExternal,
  sourcingClient:failExternal,collectionAdapter:{preflight:failExternal,resolve:failExternal,importProduct:failExternal},
  settingsCodec:{encode:value=>Buffer.from(value).toString('base64'),decode:value=>Buffer.from(value,'base64').toString()}});
const image={url:'/media/fixture.png',filename:'fixture.png'};
const fixture={revision:1,context:{revision:1,productId:'',platform:'temu',storeKey:'',erpKey:''},platforms:[{id:'amazon'},{id:'temu'}],
  stores:[{key:'s1',name:'加拿大相框店',expectedSite:'加拿大站',platform:'temu',executionSupported:true},{key:'s2',name:'美国陶瓷店',expectedSite:'美国站',platform:'amazon',executionSupported:false}],
  products:[{id:'p1',name:'原木相框',description:'真实商品资料',images:[],versions:[{id:'v1',platform:'amazon',status:'completed',images:[image]},{id:'v2',platform:'temu',status:'completed',images:[image]}]},
    {id:'p2',name:'陶瓷花瓶',description:'陶瓷花瓶，保留原有尺寸',images:[],versions:[{id:'v3',platform:'temu',status:'completed',images:[image]}]}],
  tasks:[{id:'t1',title:'相框主图',type:'单品设计',platform:'amazon',status:'completed',url:'/content?product=p1&platform=amazon'},
    {id:'t2',title:'花瓶裂变',type:'图片裂变',platform:'temu',status:'running',url:'/listings?mode=images'},
    {id:'t3',title:'待核对批次',type:'店铺上架',platform:'temu',status:'attention',url:'/tasks'}]};
const checks=[],errors=[],requests=[],blockedExternal=[];
let browser,base;
const mark=message=>{checks.push(message);console.log(message);};
const selectedId=page=>page.locator('#moduleOrbit [data-module-id][aria-pressed="true"]').getAttribute('data-module-id');
const readNumber=async(page,id)=>Number((await page.locator('#'+id).innerText()).replace(/[^\d]/g,''));
const ready=async page=>{
  await page.locator('#moduleOrbit [data-module-id]').first().waitFor();
  await page.waitForFunction(()=>document.getElementById('metricProducts')?.textContent.trim()==='2');
  // The async 3D startup can open the intro after the data becomes ready.
  // Finish that UI flow before sending keys to the module cards; otherwise
  // Enter may activate "skip intro" and leave the default product selected.
  await page.waitForFunction(()=>['ready','fallback'].includes(document.getElementById('orbitStage')?.dataset.scene));
  if(await page.locator('#cockpitIntro').isVisible())await page.locator('#introSkip').click();
  await page.waitForFunction(()=>document.getElementById('cockpitIntro').hidden&&!document.getElementById('cockpitMain').inert);
};
const gotoHome=async page=>{await page.goto(base+'/cockpit.html',{waitUntil:'domcontentloaded'});await ready(page);};
const makeContext=async(options={},disableWebGL=false)=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000},...options});
  context.setDefaultTimeout(15000);
  if(disableWebGL)await context.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return /^(webgl2?|experimental-webgl)$/.test(type)?null:original.call(this,type,...args);};
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base){blockedExternal.push(url.origin);return route.abort();}
    requests.push({path:url.pathname,method:request.method(),page:request.frame().url()});
    if(!['GET','HEAD'].includes(request.method()))return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'UI verification blocks business writes'})});
    if(url.pathname==='/api/workspace'){
      workspaceReads++;
      return route.fulfill({status:workspaceUnavailable?503:200,contentType:'application/json',body:JSON.stringify(workspaceUnavailable?{error:'测试连接暂时不可用'}:fixture)});
    }
    if(url.pathname==='/media/fixture.png')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII=','base64')});
    return route.continue();
  });
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  return context;
};
try{
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;
  for(const route of ['/','/app']){
    const response=await fetch(base+route+'?entry=fixture',{redirect:'manual'});
    assert.equal(response.status,302);
    assert.equal(response.headers.get('location'),'/cockpit.html?entry=fixture');
  }
  mark('根路径与/app重定向到总览并保留查询参数');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await makeContext(),page=await context.newPage();
  await gotoHome(page);
  assert.equal(await readNumber(page,'metricProducts'),2);
  assert.equal(await readNumber(page,'metricVersions'),3);
  assert.equal(await readNumber(page,'metricStores'),2);
  assert.equal(await readNumber(page,'metricTasks'),2,'pending work includes running and attention, but excludes completed tasks');
  assert.equal(await page.locator('#moduleOrbit [data-module-id]').count(),6);
  assert.equal(await page.locator('#moduleOrbit [data-module-id][aria-pressed="true"]').count(),1);
  await page.screenshot({path:path.join(output,'cockpit-desktop-dark.png'),fullPage:true});
  mark('首页指标对应真实返回资料：2商品、2待办、3版本、2店铺');

  const first=await selectedId(page);
  await page.locator('#orbitNext').click();
  await page.waitForFunction(id=>document.querySelector('#moduleOrbit [aria-pressed="true"]')?.dataset.moduleId!==id,first);
  await page.locator('#orbitPrev').click();
  assert.equal(await selectedId(page),first);
  await page.locator('#moduleOrbit [aria-pressed="true"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(id=>document.querySelector('#moduleOrbit [aria-pressed="true"]')?.dataset.moduleId!==id,first);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await selectedId(page),first);
  const orbit=await page.locator('#moduleOrbit').boundingBox(),beforeDrag=await selectedId(page);
  await page.mouse.move(orbit.x+orbit.width*.65,orbit.y+orbit.height*.5);
  await page.mouse.down();await page.mouse.move(orbit.x+orbit.width*.3,orbit.y+orbit.height*.5,{steps:8});await page.mouse.up();
  await page.waitForFunction(id=>document.querySelector('#moduleOrbit [aria-pressed="true"]')?.dataset.moduleId!==id,beforeDrag);
  mark('环形导航：前后按钮、方向键、拖拽均更新选中模块和可见详情');

  const modules=[['products','商品库','/products'],['sourcing','选品与采集','/sourcing'],['content','内容制作','/content'],['listings','上架中心','/listings'],['tasks','任务记录','/tasks'],['settings','设置','/settings']];
  for(const [id,label,url] of modules){
    await page.locator('#moduleOrbit [data-module-id="'+id+'"]').focus();await page.keyboard.press('Enter');
    assert.equal(await selectedId(page),id);
    assert.equal((await page.locator('#detailTitle').innerText()).trim(),label);
    assert.equal(new URL(await page.locator('#detailAction').getAttribute('href'),base).pathname,url);
  }
  await page.locator('#orbitView').click();
  assert.equal(await page.locator('#orbitView').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#moduleOrbit [data-module-id]').count(),6);
  for(const [id] of modules)assert.equal(await page.locator('#moduleOrbit [data-module-id="'+id+'"]').isVisible(),true);
  await page.locator('#orbitView').click();
  assert.equal(await page.locator('#orbitView').getAttribute('aria-pressed'),'false');
  const beforePlay=await selectedId(page);
  await page.locator('#orbitPlay').click();
  assert.equal(await page.locator('#orbitPlay').getAttribute('aria-pressed'),'true');
  await page.waitForFunction(id=>document.querySelector('#moduleOrbit [aria-pressed="true"]')?.dataset.moduleId!==id,beforePlay,{timeout:15000});
  await page.locator('#orbitPlay').click();
  assert.equal(await page.locator('#orbitPlay').getAttribute('aria-pressed'),'false');
  mark('6模块选择仅更新详情和目标链接，平面列表保留所有入口');
  mark('自动浏览仅在用户点击后开始，可暂停，不进入业务页面');

  await page.locator('#appearanceOpen').click();await page.locator('#appearanceDialog[open]').waitFor();
  await page.locator('#appearanceDialog [data-theme="dark"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.cockpitTheme==='dark');
  await page.keyboard.press('Escape');
  await page.reload();await ready(page);
  assert.equal(await page.locator('html').getAttribute('data-cockpit-theme'),'dark');
  await page.locator('#appearanceOpen').click();
  await page.locator('#appearanceDialog [data-theme="light"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.cockpitTheme==='light');
  await page.locator('#appearanceDialog [data-accent="violet"]').click();
  await page.locator('#motionToggle').uncheck();
  await page.locator('#materialToggle').uncheck();
  await page.keyboard.press('Escape');
  await page.reload();await ready(page);
  assert.equal(await page.locator('html').getAttribute('data-cockpit-theme'),'light');
  assert.equal(await page.locator('html').getAttribute('data-cockpit-accent'),'violet');
  assert.equal(await page.locator('body').getAttribute('data-motion'),'off');
  assert.equal(await page.locator('body').getAttribute('data-material'),'off');
  await page.locator('#appearanceOpen').click();
  assert.equal(await page.locator('#motionToggle').isChecked(),false);
  assert.equal(await page.locator('#materialToggle').isChecked(),false);
  await page.locator('#motionToggle').check();await page.locator('#materialToggle').check();
  await page.locator('#appearanceDialog [data-accent="ocean"]').click();
  await page.locator('#appearanceDone').click();
  mark('外观对话框支持键盘关闭，深浅主题、强调色、动效和材质偏好跨刷新持久保存');

  await page.locator('#globalSearch').fill('陶瓷');
  await page.locator('#searchResults').waitFor({state:'visible'});
  assert.match(await page.locator('#searchResults').innerText(),/陶瓷花瓶/);
  await page.locator('#globalSearch').fill('花瓶裂变');
  assert.match(await page.locator('#searchResults').innerText(),/花瓶裂变/);
  await page.locator('#globalSearch').fill('内容制作');
  assert.match(await page.locator('#searchResults').innerText(),/内容制作/);
  await page.locator('#globalSearch').fill('');
  mark('全局搜索覆盖真实商品、任务与模块');

  workspaceUnavailable=true;
  await page.reload();
  await page.locator('#retryLoad').waitFor();
  assert.doesNotMatch(await page.locator('#metricProducts').innerText(),/^0$/,'unavailable data must not look like an empty account');
  const readsBeforeRetry=workspaceReads;workspaceUnavailable=false;
  await page.locator('#retryLoad').click();await ready(page);
  assert.ok(workspaceReads>readsBeforeRetry);
  mark('接口失败显示可重试状态；重试恢复资料，失败未冒充零商品');

  await page.screenshot({path:path.join(output,'cockpit-desktop-light.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'390px overview must not overflow horizontally');
  await page.screenshot({path:path.join(output,'cockpit-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  assert.deepEqual(requests.filter(request=>!['GET','HEAD'].includes(request.method)),[],'overview controls must not initiate business writes');
  mark('390px窄屏无横向溢出；首页交互、搜索、外观和重试均未发业务写请求');

  for(const [id,label,url] of modules){
    await gotoHome(page);await page.locator('#moduleOrbit [data-module-id="'+id+'"]').focus();await page.keyboard.press('Enter');
    assert.equal(await selectedId(page),id,'the requested module must receive the selection key');
    assert.equal(new URL(await page.locator('#detailAction').getAttribute('href'),base).pathname,url);
    await page.locator('#detailAction').click();
    await page.waitForURL(location=>location.pathname===url);
    assert.equal(new URL(page.url()).pathname,url);
    await page.locator('.workbench-nav a[aria-current="page"]').waitFor();
    assert.equal(new URL(await page.locator('.workbench-nav a[aria-current="page"]').getAttribute('href'),base).pathname,url);
    assert.ok((await page.locator('body').innerText()).includes(label));
    await page.screenshot({path:path.join(output,'destination-'+id+'.png'),fullPage:true});
  }
  mark('6个入口实际导航到现有商品、采集、制作、上架、任务、设置页面');
  await page.goto(base+'/design?platform=amazon',{waitUntil:'domcontentloaded'});
  await page.locator('.purah-pad .main-content').waitFor();
  const designBox=await page.locator('.purah-pad').boundingBox();
  assert.ok(designBox&&designBox.width>700&&designBox.height>400,'legacy design workspace must retain its full working area');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'desktop design workspace must not overflow horizontally');
  await page.screenshot({path:path.join(output,'destination-single-design.png'),fullPage:true});
  const contextBar=await page.locator('.design-platform-bar').boundingBox();
  assert.ok(contextBar&&contextBar.height<180,'platform context must not consume the main design working area');
  const designPanels=await page.locator('.workspace-grid > .panel-glass').evaluateAll(elements=>elements.map(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height})).filter(box=>box.width>0&&box.height>0));
  assert.equal(designPanels.length,2);
  assert.ok(designPanels.every(box=>box.width>250&&box.height>250),'product information and reference image panels must remain usable');
  mark('原单品设计工作区保留可用宽高且无横向溢出');
  await gotoHome(page);await page.locator('#appearanceOpen').click();
  await page.locator('#appearanceDialog [data-theme="dark"]').click();await page.locator('#appearanceDone').click();
  for(const [url,name,readySelector] of [['/settings','settings','#setupSummary'],['/design?platform=amazon','single-design','.design-platform-bar']]){
    await page.goto(base+url,{waitUntil:'domcontentloaded'});await page.locator(readySelector).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-cockpit-theme'),'dark');
    await page.screenshot({path:path.join(output,'destination-'+name+'-dark.png'),fullPage:true});
  }
  mark('设计和设置页继承深色主题，保留独立截图用于视觉复核');

  const reduced=await makeContext({reducedMotion:'reduce'},true),fallback=await reduced.newPage();
  await gotoHome(fallback);
  assert.equal(await fallback.locator('#moduleOrbit [data-module-id]').count(),6);
  assert.equal(await fallback.locator('.metric-fluid[data-fluid-state="fallback"]').count(),4);
  const initialReduced=await selectedId(fallback);
  assert.equal(await fallback.locator('#orbitPlay').getAttribute('aria-pressed'),'false');
  await fallback.locator('#orbitNext').click();
  assert.notEqual(await selectedId(fallback),initialReduced);
  assert.equal(await fallback.locator('#detailAction').isVisible(),true);
  await fallback.screenshot({path:path.join(output,'cockpit-reduced-motion-fallback.png'),fullPage:true});
  mark('减少动态效果与WebGL不可用环境下保留全部导航、详情和按钮');

  assert.equal(providerCalls,0);assert.deepEqual(blockedExternal,[]);assert.deepEqual(errors,[]);
  const report={passed:true,checkedAt:new Date().toISOString(),checks,providerCalls,externalRequests:blockedExternal,workspaceReads,
    businessWrites:requests.filter(request=>!['GET','HEAD'].includes(request.method)),errors,evidenceDirectory:output};
  fs.writeFileSync(path.join(output,'cockpit-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}catch(error){
  fs.writeFileSync(path.join(output,'cockpit-verification.json'),JSON.stringify({passed:false,checkedAt:new Date().toISOString(),checks,error:error.stack,providerCalls,blockedExternal,errors},null,2));
  throw error;
}finally{
  if(browser)await browser.close();
  if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));
  const checkedDirectory=path.resolve(directory);
  assert.ok(checkedDirectory.startsWith(path.resolve(os.tmpdir())+path.sep+'cockpit-ui-'));
  fs.rmSync(checkedDirectory,{recursive:true,force:true});
}
