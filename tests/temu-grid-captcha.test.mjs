import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {readTemuGrid,gridObjects} from '../src/temu-grid-captcha.mjs';
import {createTemuCaptchaSolver} from '../src/temu-captcha.mjs';
import {readTemuPage} from '../src/temu-front-browser.mjs';

let browser,image;
const sourceUrl='https://www.temu.com/fixture-g-601105252678121.html';
const challenge="请按以下顺序点击相应的图片： '桌子','床','棒球','鹿','小提琴'";
test.before(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});image='data:image/png;base64,'+(await sharp({create:{width:80,height:80,channels:3,background:'#aabbee'}}).png().toBuffer()).toString('base64');});
test.after(()=>browser?.close());
async function fixture(t){
  const context=await browser.newContext({viewport:{width:900,height:700}});t.after(()=>context.close());
  await context.route('**/*',route=>{assert.equal(route.request().url(),sourceUrl);return route.fulfill({contentType:'text/html',body:'<body></body>'});});
  const page=await context.newPage();await page.goto(sourceUrl);
  await page.setContent(`<style>#imageSemantics{display:grid;grid-template-columns:repeat(3,64px)}.tile{width:60px;height:60px;position:relative}.tile img{width:60px;height:60px}.tile span{position:absolute;inset:0;pointer-events:none}[role=dialog]{position:absolute;top:30px;left:40px;width:500px}</style><div role="dialog"><div>安全验证</div><div id="instruction"></div><div id="imageSemantics">${Array.from({length:9},(_,i)=>`<div class="tile" role="none" data-index="${i}"><img src="${image}"></div>`).join('')}</div><button id="submit">提交</button></div>`);
  await page.evaluate(async text=>{
    document.querySelector('#instruction').textContent=text;await Promise.all([...document.images].map(i=>i.decode()));
    window.clicks=[];window.submits=0;
    document.querySelectorAll('.tile').forEach(e=>e.onclick=()=>{window.clicks.push(Number(e.dataset.index));const count=document.createElement('span');const marker=document.createElement('img');marker.src=e.querySelector('img').src;count.append(marker);e.append(count);});
    document.querySelector('#submit').onclick=()=>{window.submits++;document.querySelector('[role=dialog]').remove();const panel=document.createElement('div');panel.style.cssText='position:fixed;right:10px;bottom:20px';panel.innerHTML='采集到店小秘<button>开始采集</button>';document.body.append(panel);};
  },challenge);
  const cdp=await context.newCDPSession(page),updates=[],intents=[];
  const args={goodsId:'601105252678121',captchaPreflight:()=>({allowed:true}),isStopped:()=>false,beforeCaptcha:value=>{intents.push(value);return 'test-intent';},afterCaptcha:(_id,value)=>updates.push(value)};
  const bridge={evaluate:(...args)=>page.evaluate(...args),send:(...args)=>cdp.send(...args)};
  return {page,args,bridge,updates,intents};
}
async function run(f,solve){return createTemuCaptchaSolver({client:{solve},pause:async()=>{},fetchImpl:()=>{throw new Error('No network allowed');}}).solve({page:f.bridge,args:f.args,readPage:readTemuPage});}
test('grid nouns retain exact requested order and unknown labels stop',()=>{
  assert.deepEqual(gridObjects(challenge),['table','bed','baseball','deer','violin']);
  assert.equal(gridObjects("请按以下顺序点击相应的图片： '未适配东西'"),null);
});
test('nine loaded tiles are sent once and clicked in the returned order before submit',async t=>{
  const f=await fixture(t);let calls=0;
  const result=await run(f,async(type,payload)=>{calls++;assert.equal(type,'temu-three-by-three');assert.equal(payload.images.length,9);assert.deepEqual(payload.objectsOfInterest,['table','bed','baseball','deer','violin']);return {answer:{solutionIndices:[4,0,8,2,6]},durationMs:1};});
  assert.equal(result.status,'solved');assert.equal(calls,1);assert.equal(f.intents.length,1);
  assert.deepEqual(await f.page.evaluate(()=>({clicks:window.clicks,submits:window.submits})),{clicks:[4,0,8,2,6],submits:1});
  assert.equal(f.updates.at(-1).status,'solved');
});
test('duplicate grid indices cannot click or submit',async t=>{
  const f=await fixture(t);const result=await run(f,async()=>({answer:{solutionIndices:[0,0,1,2,3]},durationMs:1}));
  assert.notEqual(result.status,'solved');assert.deepEqual(await f.page.evaluate(()=>window.clicks),[]);assert.equal(await f.page.evaluate(()=>window.submits),0);
});
test('changed grid instruction discards an answer before any click',async t=>{
  const f=await fixture(t);const result=await run(f,async()=>{await f.page.locator('#instruction').evaluate(e=>e.textContent="请按以下顺序点击相应的图片： '鹿'");return {answer:{solutionIndices:[0,1,2,3,4]},durationMs:1};});
  assert.notEqual(result.status,'solved');assert.deepEqual(await f.page.evaluate(()=>window.clicks),[]);
});
