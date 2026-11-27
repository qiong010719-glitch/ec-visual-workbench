import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

// Each document is sampled on animation frames, including before defer scripts
// execute. A normal DOMContentLoaded assertion cannot catch this regression.
// Only a fresh loopback service and isolated Edge contexts are used.
const baseline=process.argv.includes('--baseline');
const quick=process.argv.includes('--quick');
const live=process.argv.includes('--live');
const resume=process.argv.includes('--resume');
const output=path.resolve(process.env.FIRST_PAINT_QA_OUTPUT||'D:/agent合集/自动上架/outputs/navigation-flash-fix-20261122');
const phase=live?'live-readonly':baseline?'before':'after';
fs.mkdirSync(path.join(output,phase),{recursive:true});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-first-paint-'));
let businessCalls=0;
const denied=()=>{businessCalls++;throw new Error('First-paint verification cannot invoke external business services');};
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},provider:denied,planner:denied,sourcingClient:denied,
  collectionAdapter:{preflight:denied,resolve:denied,importProduct:denied}});
const cases=quick?[{id:'settings',url:'/settings'}]:[
  {id:'overview',url:'/cockpit.html'}, {id:'products',url:'/products'}, {id:'sourcing',url:'/sourcing'},
  {id:'content',url:'/content'}, {id:'listings',url:'/listings?mode=images'}, {id:'tasks',url:'/tasks'},
  {id:'settings',url:'/settings'}, {id:'design',url:'/design?platform=amazon'}
  ,{id:'free-sourcing',url:'/sourcing/free'}, {id:'fixed-listing',url:'/sourcing/listing'}
].filter(entry=>!live||!['overview','design'].includes(entry.id));
const prior=resume?JSON.parse(fs.readFileSync(path.join(output,phase,'first-paint-run-error.json'),'utf8')):null;
const results=prior?.completed||[],blocked=prior?.blocked||[],writes=prior?.writes||[],errors=prior?.errors||[];
const blockedUiStateWrites=prior?.blockedUiStateWrites||[];
let browser,base;
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

function instrument(theme){
  localStorage.setItem('commerce-cockpit-appearance',JSON.stringify({theme,accent:'ocean',motion:false,material:false,view:'orbit'}));
  const trace={route:location.pathname,theme,frames:[],paints:[],resources:[],done:false};
  window.__firstPaintTrace=trace;
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())trace.paints.push({name:entry.name,time:entry.startTime});});
  observer.observe({type:'paint',buffered:true});
  function visible(element){
    if(!element||!element.getClientRects().length)return false;
    for(let ancestor=element;ancestor;ancestor=ancestor.parentElement){const css=getComputedStyle(ancestor);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;}
    return true;
  }
  function rect(element){if(!element)return null;const r=element.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};}
  function sample(){
    const root=document.documentElement,body=document.body,header=document.querySelector('header.workbench-header'),main=document.querySelector('.cockpit-main,.ws-main,.listing-workspace,.purah-pad,body>main');
    if(root&&body){
      const headStyle=header?getComputedStyle(header):null;
      trace.frames.push({time:performance.now(),ready:document.readyState,theme:root.dataset.cockpitTheme||null,
        shellEnabled:root.classList.contains('workspace-shell-enabled'),rootBackground:getComputedStyle(root).backgroundColor,bodyBackground:getComputedStyle(body).backgroundColor,
        headerText:header?.innerText?.replace(/\s+/g,' ').slice(0,250)||'',headerVisible:visible(header),headerRect:rect(header),headerPosition:headStyle?.position||null,
        mainVisible:visible(main),mainRect:rect(main),bodyText:body.innerText.replace(/\s+/g,' ').slice(0,160),
        businessStyleReady:Array.from(document.styleSheets).some(sheet=>sheet.href?.includes('workspace-glass-business.css'))});
    }
    if(!trace.done)requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}

async function runCase(theme,entry,mode){
  let delayed=false;
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addInitScript(instrument,theme);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base){blocked.push({url:url.origin,route:entry.url});return route.abort();}
    if(!['GET','HEAD'].includes(request.method())){
      // The design editor may checkpoint local UI state on pagehide. Keep it
      // blocked and recorded separately from generation/ERP/business writes.
      const record={path:url.pathname,method:request.method()};
      if(url.pathname==='/api/workspace/design-state')blockedUiStateWrites.push(record);else writes.push(record);
      return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Read-only first-paint test"}'});
    }
    if(delayed){
      if(url.pathname==='/local/workspace-shell.js')await wait(900);
      else if(url.pathname==='/local/workspace-glass-business.css')await wait(1200);
      else if(/^\/local\/(workspace|merchant|sourcing|temu-listings|product-workflow|platform-flow|cockpit|workspace-branding)\.js$/.test(url.pathname))await wait(1200);
    }
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push({case:entry.id,mode,theme,message:error.message}));
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  const prefix=[theme,mode,entry.id].join('-');
  try{
    if(mode==='navigation'){
      await page.goto(base+(entry.id==='free-sourcing'?'/sourcing':entry.id==='fixed-listing'?'/sourcing/free':'/cockpit.html'),{waitUntil:'load'});
      await page.locator('.workspace-shell .workbench-nav').waitFor();
    }
    delayed=true;
    const navigate=mode==='navigation'&&entry.id!=='design'
      ?Promise.all([page.waitForNavigation({waitUntil:'commit'}),page.locator('a[href]').evaluateAll((links,target)=>{const found=links.find(link=>new URL(link.href).pathname===new URL(target,location.origin).pathname);if(!found)throw new Error('Navigation link missing');found.click();},entry.url)])
      :page.goto(base+entry.url,{waitUntil:'commit'});
    await navigate;
    await page.bringToFront();
    await page.waitForFunction(()=>window.__firstPaintTrace?.paints.some(entry=>entry.name==='first-contentful-paint'),null,{timeout:45000});
    await page.screenshot({path:path.join(output,phase,prefix+'-first.png'),fullPage:false});
    await page.waitForLoadState('load',{timeout:30000});
    await page.waitForFunction(()=>document.querySelector('.workspace-shell .workbench-nav a')&&Array.from(document.styleSheets).some(sheet=>sheet.href?.includes('workspace-glass-business.css')),null,{timeout:15000});
    await page.locator('.workspace-shell .workbench-nav a').first().waitFor({state:'visible'});
    await page.locator('.cockpit-main,.ws-main,.listing-workspace,.purah-pad,body>main').first().waitFor({state:'visible'});
    assert.match(await page.locator('.workspace-shell .workbench-brand').innerText(),/跨境工作台/);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const trace=await page.evaluate(()=>{window.__firstPaintTrace.done=true;window.__firstPaintTrace.resources=performance.getEntriesByType('resource').filter(entry=>/workspace-shell|workspace-glass-business|workspace\.js|merchant\.js|sourcing\.js|temu-listings\.js/.test(entry.name)).map(entry=>({name:new URL(entry.name).pathname,start:entry.startTime,end:entry.responseEnd}));return window.__firstPaintTrace;});
    const fcp=trace.paints.find(entry=>entry.name==='first-contentful-paint')?.time;
    const rendered=trace.frames.filter(frame=>frame.time>=fcp);
    const oldBrand=rendered.filter(frame=>frame.headerVisible&&/Temu\s*工作台|商品裂变工作台/i.test(frame.headerText));
    const unthemed=rendered.filter(frame=>(frame.headerVisible||frame.mainVisible)&&(!frame.shellEnabled||frame.theme!==theme));
    const oldLayout=rendered.filter(frame=>frame.headerVisible&&frame.headerRect&&(frame.headerRect.width>400||frame.headerRect.x>30));
    const wrongBackground=rendered.filter(frame=>{
      if(!frame.headerVisible&&!frame.mainVisible)return false;
      const numbers=(frame.bodyBackground!=='rgba(0, 0, 0, 0)'?frame.bodyBackground:frame.rootBackground).match(/\d+/g)?.map(Number)||[];
      if(numbers.length<3||numbers.length===4&&numbers[3]===0)return true;
      const avg=(numbers[0]+numbers[1]+numbers[2])/3;return theme==='dark'?avg>80:avg<160;
    });
    const noBusinessStyles=rendered.filter(frame=>frame.mainVisible&&!frame.businessStyleReady);
    const result={id:entry.id,route:entry.url,theme,mode,firstContentfulPaint:fcp,frameCount:trace.frames.length,
      violations:{oldBrand:oldBrand.length,unthemed:unthemed.length,oldLayout:oldLayout.length,wrongBackground:wrongBackground.length,businessVisibleBeforeStyles:noBusinessStyles.length},
      firstViolation:oldBrand[0]||unthemed[0]||oldLayout[0]||wrongBackground[0]||noBusinessStyles[0]||null,
      finalFrame:trace.frames.at(-1),traceFile:prefix+'-trace.json'};
    fs.writeFileSync(path.join(output,phase,result.traceFile),JSON.stringify(trace,null,2));
    await page.screenshot({path:path.join(output,phase,prefix+'-settled.png'),fullPage:false});
    results.push(result);
    console.log(JSON.stringify({case:prefix,fcp:Math.round(fcp),frames:result.frameCount,violations:result.violations}));
  }finally{await context.close();}
}

try{
  if(live)base='http://127.0.0.1:4196';
  else{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const theme of quick||live?['dark']:['dark','light'])for(const mode of quick?['cold']:['cold','navigation'])for(const entry of cases){
    if(results.some(result=>result.id===entry.id&&result.theme===theme&&result.mode===mode))continue;
    await runCase(theme,entry,mode);
  }
  const failed=results.filter(result=>Object.values(result.violations).some(Boolean));
  const report={passed:failed.length===0&&errors.length===0&&blocked.length===0&&writes.length===0&&businessCalls===0,baseline,liveReadOnly:live,resumed:resume,checkedAt:new Date().toISOString(),results,failedCases:failed.map(result=>[result.theme,result.mode,result.id].join('-')),errors,blocked,writes,blockedUiStateWrites,businessCalls};
  fs.writeFileSync(path.join(output,phase,'first-paint-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,baseline,cases:results.length,failedCases:report.failedCases,businessCalls,errors:errors.length,output:path.join(output,phase)}));
  if(!baseline){assert.equal(failed.length,0,'First paint displayed legacy branding, theme or layout: '+report.failedCases.join(', '));assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(writes,[]);assert.equal(businessCalls,0);}
}catch(error){
  fs.writeFileSync(path.join(output,phase,'first-paint-run-error.json'),JSON.stringify({error:error.stack,completed:results,errors,blocked,writes,blockedUiStateWrites,businessCalls},null,2));
  throw error;
}finally{
  if(browser)await browser.close();
  if(app.server.listening){app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'workspace-first-paint-'));
  fs.rmSync(directory,{recursive:true,force:true});
}
