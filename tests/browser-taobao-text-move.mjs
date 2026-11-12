// Browser + local multipart fixture. No real image service or credentials are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {createWorkbench,root} from '../src/server.mjs';
import {imageSize,encodeRgbaPng} from '../src/provider.mjs';
import {prepareTextMove,textMoveGuide} from '../src/text-move.mjs';
import {locateTextMove} from '../src/text-move-precision.mjs';

const output=path.join(root,'tests/results/taobao-text-move');
fs.mkdirSync(path.join(output,'tmp'),{recursive:true});
process.env.TEMP=path.join(output,'tmp');process.env.TMP=process.env.TEMP;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const directory=fs.mkdtempSync(path.join(output,'data-'));
const checks=[],requests=[],upstreamCalls=[],errors=[],blocked=[];
let fixture,hold,release,failNext=false,overflowNext=false;
const upstream=http.createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const form=await new Request('http://127.0.0.1'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();
    const source=Buffer.from(await form.get('image[]').arrayBuffer());
    assert.equal(form.getAll('image[]').length,2);
    const guide=Buffer.from(await form.getAll('image[]')[1].arrayBuffer());
    const mask=Buffer.from(await form.get('mask').arrayBuffer());
    const request=requests.at(-1);
    assert.equal(req.url,'/v1/images/edits');
    assert.deepEqual(await sharp(source).ensureAlpha().raw().toBuffer(),await sharp(fixture).ensureAlpha().raw().toBuffer());
    const edit=await prepareTextMove(source,request.mask_regions);
    await locateTextMove(edit,{sentence:request.text_sentence,target:request.text_target});
    assert.deepEqual(mask,edit.mask);
    assert.deepEqual(guide,textMoveGuide(edit));
    assert.match(form.get('prompt'),/输入图2只是同一张图的位置指示/);
    assert.equal(form.get('size'),'800x1000');
    upstreamCalls.push({path:req.url,model:form.get('model'),size:form.get('size'),prompt:form.get('prompt'),maskSize:imageSize(mask),maskSha256:crypto.createHash('sha256').update(mask).digest('hex')});
    fs.writeFileSync(path.join(output,'last-mask.png'),mask);
    if(hold)await hold;
    if(failNext){failNext=false;res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'intentional fixture failure'}));return;}
    // This local upstream double draws the requested move with browser canvas.
    // Production code never renders text. Its OCR checks use the real bundled
    // recognizer, including on these synthetic result pixels.
    let returned=Buffer.from((await page.evaluate(async({source,old,target})=>{
      const img=new Image();img.src=source;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1000;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
      ctx.fillStyle='#eef3f8';ctx.fillRect(old.x,old.y,old.w,old.h);
      ctx.fillStyle='#152642';ctx.font='bold 60px sans-serif';
      const m=ctx.measureText('轻便耐用');
      ctx.fillText('轻便耐用',target.x+target.w/2-(m.actualBoundingBoxRight-m.actualBoundingBoxLeft)/2,target.y+target.h/2+(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2);
      return canvas.toDataURL('image/png');
    },{source:'data:image/png;base64,'+source.toString('base64'),old:edit.boxes[0],target:edit.precision.target})).split(',')[1],'base64');
    if(overflowNext){
      overflowNext=false;
      const rgba=await sharp(returned).ensureAlpha().raw().toBuffer();
      const box=edit.boxes[1];
      for(let y=box.y+10;y<box.y+20;y++)for(let x=box.x+box.w-3;x<box.x+box.w+3;x++){const i=(y*800+x)*4;rgba.fill(0,i,i+3);rgba[i+3]=255;}
      returned=encodeRgbaPng(800,1000,rgba);
    }
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({data:[{b64_json:returned.toString('base64')}]}));
  } catch(error){errors.push(error.message);res.writeHead(500);res.end('fixture assertion failed');}
});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
const app=createWorkbench({dataDirectory:directory,configuration:{SUANZHOU_IMAGE_API_KEY:'local-fixture-only',SUANZHOU_IMAGE_BASE_URL:'http://127.0.0.1:'+upstream.address().port+'/v1'},researchOptions:{client:{configured:false}}});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const address='http://127.0.0.1:'+app.server.address().port;
assert.notEqual(app.server.address().port,4185);assert.notEqual(upstream.address().port,4185);
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{
  channel:'msedge',headless:true,viewport:{width:1440,height:1100},downloadsPath:path.join(output,'downloads'),
  env:{...process.env,LOCALAPPDATA:path.join(output,'browser-local'),APPDATA:path.join(output,'browser-roaming')}
});
await context.addInitScript(()=>{localStorage.setItem('aplus_newbie_tour_v1','true');localStorage.setItem('hyrule_result_tour_done','true');});
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==address && !['blob:','data:'].includes(url.protocol)){blocked.push(url.origin);return route.abort();}
  if(req.method()==='POST' && ['/api/generate','/api/ultra_generate','/api/agent'].includes(url.pathname)){blocked.push(url.pathname);return route.abort();}
  if(url.pathname==='/api/inpaint' && req.method()==='POST')requests.push(req.postDataJSON());
  return route.continue();
});
const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(e.message));
const click=selector=>page.locator(selector).click();
const drag=async(x,y)=>{
  const pin=page.locator('[data-taobao-text-pin="0"]');await pin.scrollIntoViewIfNeeded();await pin.hover();
  const box=await page.locator('#slot-0 .taobao-text-stage img').boundingBox();
  await page.mouse.down();await page.mouse.move(box.x+box.width*x/100,box.y+box.height*y/100,{steps:8});await page.mouse.up();
};
const submit=async()=>{
  const response=page.waitForResponse(r=>r.url()===address+'/api/inpaint' && r.request().method()==='POST');
  await click('[data-taobao-redraw="0"]');assert.equal((await response).status(),202);
  return requests.at(-1).task_id;
};
const settled=async id=>{
  await page.waitForFunction(id=>imageSlots[0]?.id===id && !activeKieTasks.some(t=>t.slot===0),id);
  await page.waitForFunction(()=>{const image=document.querySelector('#slot-0 .taobao-text-stage img');return image?.complete && image.naturalWidth===800 && image.naturalHeight===1000;});
  await page.locator('#slot-0 .taobao-text-stage img').evaluate(image=>image.decode());
  await page.waitForFunction(()=>!document.querySelector('#slot-0 .taobao-text-stage img')?.classList.contains('img-reveal'));
  const current=await page.evaluate(()=>imageSlots[0].url);
  fixture=current.startsWith('data:')?Buffer.from(current.split(',')[1],'base64'):fs.readFileSync(path.join(directory,current));
};
try {
  await page.goto(address,{waitUntil:'networkidle'});await page.locator('#taobaoShell').waitFor();
  await page.waitForFunction(()=>document.querySelector('#designScope')?.value==='custom' && window.__customLayout?.taobao?.applied);
  assert.equal(await page.locator('#designScope').inputValue(),'custom');
  assert.equal(await page.locator('#targetMarket option:not([hidden])').count(),1);
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1000;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#eef3f8';ctx.fillRect(0,0,800,1000);ctx.fillStyle='#405479';ctx.fillRect(260,330,280,430);ctx.fillStyle='#152642';ctx.font='bold 60px sans-serif';ctx.textAlign='center';ctx.fillText('轻便耐用',400,120);ctx.font='23px sans-serif';ctx.fillText('本地测试替身 · 未真实出图',400,940);
    document.querySelector('#sopText').value='【主图】\n文案：轻便耐用';
    imageSlots[0]={url:canvas.toDataURL('image/png'),id:'qa-fixture',finalPrompt:'文案：轻便耐用'};
    window.__customLayout.taobao.textPositions={};window.__customLayout.taobao.textAnchors={};
    buildGalleryLayout();renderSlot(0);switchView('adventure-log',document.querySelector('#nav-notes'));
  });
  fixture=Buffer.from((await page.evaluate(()=>imageSlots[0].url)).split(',')[1],'base64');
  await drag(50,82);
  const dragged=await page.evaluate(()=>window.__customLayout.taobao.textPositions[0]);
  assert.ok(Math.abs(dragged.x-50)<=0.2 && Math.abs(dragged.y-82)<=0.2,'card tilt must not skew image coordinates');
  await click('[data-taobao-redraw="0"]');await page.evaluate(()=>window.__taobaoTextMove);
  assert.equal(requests.length,0);checks.push('首次拖字缺旧位置时阻止请求，不退回整图生成');
  await click('[data-taobao-text-origin="0"]');
  await click('[data-taobao-text-pin="0"]');
  const pinOrigin=await page.evaluate(()=>({old:window.__customLayout.taobao.textAnchors[0],next:window.__customLayout.taobao.textPositions[0]}));
  assert.ok(Math.abs(pinOrigin.old.x-pinOrigin.next.x)<1 && Math.abs(pinOrigin.old.y-pinOrigin.next.y)<1);
  await click('[data-taobao-text-origin="0"]');
  const img=page.locator('#slot-0 .taobao-text-stage img');await img.scrollIntoViewIfNeeded();
  const box=await img.boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+box.height*.12);
  const origin=await page.evaluate(()=>window.__customLayout.taobao.textAnchors[0]);
  assert.ok(Math.abs(origin.x-50)<1 && Math.abs(origin.y-12)<1);
  await page.waitForFunction(()=>{const image=document.querySelector('#slot-0 .taobao-text-stage img').getBoundingClientRect();const actions=document.querySelector('#slot-0 .slot-actions').getBoundingClientRect();return actions.top>=image.bottom-1;});
  const layout=await page.evaluate(()=>{const image=document.querySelector('#slot-0 .taobao-text-stage img').getBoundingClientRect();const stage=document.querySelector('#slot-0 .taobao-text-stage').getBoundingClientRect();const actions=document.querySelector('#slot-0 .slot-actions').getBoundingClientRect();return {image:{x:image.x,y:image.y,w:image.width,h:image.height,bottom:image.bottom},stage:{x:stage.x,y:stage.y,w:stage.width,h:stage.height},actionsTop:actions.top};});
  assert.ok(Math.abs(layout.image.w-layout.stage.w)<1 && Math.abs(layout.image.h-layout.stage.h)<1);
  assert.ok(layout.actionsTop>=layout.image.bottom-1);checks.push('原字位置按实际图片百分比记录；按钮不遮图，图片与拖字坐标区域一致');
  await page.screenshot({path:path.join(output,'01-before-edit.png'),fullPage:true});
  hold=new Promise(resolve=>release=resolve);
  const first=await submit();
  await page.evaluate(()=>triggerGeneration(0));assert.equal(requests.length,1);
  await page.reload({waitUntil:'networkidle'});
  release();hold=null;await settled(first);
  assert.equal(requests.length,1);assert.equal(upstreamCalls.length,1);
  assert.equal(requests[0].mask_regions.length,2);assert.equal(requests[0].model,'gpt-image-2');
  const completed=await page.evaluate(()=>({anchor:window.__customLayout.taobao.textAnchors[0],target:window.__customLayout.taobao.textPositions[0],copy:imageSlots[0].taobaoText}));
  assert.deepEqual(completed.anchor,completed.target);assert.equal(completed.copy,'轻便耐用');
  checks.push('UI → 本机真实 OCR → 模拟 /v1/images/edits：原图、收紧蒙版、原尺寸、模型均正确；真实 OCR 校验模拟结果，无整图生成请求');
  checks.push('重复点击不重复提交；任务中刷新可恢复文字位置和原文');
  await page.evaluate(()=>{document.querySelector('#sopText').value='【主图】\n文案：后来改过的构思';});
  const beforeEdge=await page.evaluate(()=>imageSlots[0].url);
  await drag(1,1);const second=await submit();await page.waitForFunction(()=>!activeKieTasks.some(t=>t.slot===0));
  assert.equal(app.store.state.tasks['hyrule_tasks/'+second].phase,'edit_rejected');
  assert.equal(upstreamCalls.length,1,'edge rejection happens before paid provider');
  assert.equal(await page.evaluate(()=>imageSlots[0].url),beforeEdge);
  assert.match(requests[1].prompt,/原文：轻便耐用/);assert.doesNotMatch(requests[1].prompt,/后来改过/);
  assert.equal(requests[1].mask_regions[1].x,0);assert.equal(requests[1].mask_regions[1].y,0);
  checks.push('二次移动保留上一张原文；靠边放不下整句时，调用图片服务前拦截并保留原图');
  const previous=await page.evaluate(()=>imageSlots[0].url);
  failNext=true;await drag(50,85);const failed=await submit();
  await page.waitForFunction(()=>!activeKieTasks.some(t=>t.slot===0));
  assert.equal(app.store.state.tasks['hyrule_tasks/'+failed].status,'failed');
  assert.equal(await page.evaluate(()=>imageSlots[0].url),previous);
  await page.locator('[data-taobao-redraw="0"]').waitFor();
  const retry=await submit();await settled(retry);assert.equal(requests.length,4);
  checks.push('模拟上游失败保留原图，重试仍发局部编辑，无自动重试或整图回退');
  const beforeReject=await page.evaluate(()=>imageSlots[0].url);
  overflowNext=true;await drag(20,25);const rejected=await submit();
  await page.waitForFunction(()=>!activeKieTasks.some(t=>t.slot===0));
  assert.equal(app.store.state.tasks['hyrule_tasks/'+rejected].phase,'edit_rejected');
  assert.equal(await page.evaluate(()=>imageSlots[0].url),beforeReject);
  assert.equal(requests.length,5);assert.equal(upstreamCalls.length,4);
  await page.locator('[data-taobao-redraw="0"]').waitFor();
  checks.push('真实接收流程拦下模拟越界图片，原图可继续操作，没有自动重提');
  await page.screenshot({path:path.join(output,'02-after-mock-edit.png'),fullPage:true});
  await page.evaluate(()=>{imageSlots[0].taobaoText='';imageSlots[0].finalPrompt='';document.querySelector('#sopText').value='';document.querySelector('#prodDesc').value='';window.__customLayout.directives[0]={req:'',refs:[]};});
  await drag(50,20);await click('[data-taobao-redraw="0"]');await page.evaluate(()=>window.__taobaoTextMove);
  assert.equal(requests.length,5);checks.push('缺少原文时阻止提交，不改成整图重绘');
  await page.evaluate(()=>{imageSlots[0].url='';triggerGeneration(0);});await page.evaluate(()=>window.__taobaoTextMove);
  assert.equal(requests.length,5);checks.push('缺少原图时阻止提交，不改成整图重绘');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({status:'passed',checks,requests:requests.map(({base_image_b64,...r})=>({...r,inlineImage:!!base_image_b64})),upstreamCalls,errors,blocked,realGenerations:0},null,2));
  console.log(JSON.stringify({status:'passed',checks,realGenerations:0,report:path.join(output,'report.json')},null,2));
} catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,checks,errors,blocked,requests:requests.map(({base_image_b64,...r})=>({...r,inlineImage:!!base_image_b64})),upstreamCalls},null,2));throw error;}
finally {release?.();await context.close();app.server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>app.server.close(r)),new Promise(r=>upstream.close(r))]);}
