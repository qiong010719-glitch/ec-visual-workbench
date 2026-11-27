import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';
import {readTemuPage} from '../src/temu-front-browser.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'free-sourcing-browser-'));
const sourceUrl='https://www.temu.com/fixture-g-601105252678121.html';
let challenge='diagnostic',clicks=0,paidCalls=0,captchaCalls=0,balanceChecks=0;
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},settingsCodec:{encode:s=>Buffer.from(s).toString('base64'),decode:s=>Buffer.from(s,'base64').toString()},
  sourcingClient:async()=>{paidCalls++;throw new Error('Free flow must not use paid provider');},
  freePluginAdapter:{check:async()=>({status:'ready',message:'fixture插件已启用'})},
  freeSourcingAdapter:{search:async args=>{
    if(challenge==='diagnostic'){
      args.onCaptchaDiagnostic({code:'grid-structure-mismatch',type:'grid',probes:12,images:8,loadedImages:8,frames:0,shadowRoots:0,message:'<script>untrusted-diagnostic</script>'});
      return {status:'waiting-verification',message:'九宫格结构尚未适配，未调用 API。'};
    }
    if(challenge){const gate=args.captchaPreflight();assert.equal(gate.allowed,true);const id=args.beforeCaptcha({type:'puzzle',fingerprint:'b'.repeat(64)});captchaCalls++;args.afterCaptcha(id,{status:'answered',message:'已取得坐标'});args.afterCaptcha(id,{status:'not-passed',message:'测试验证码未放行，页面和进度已保留。',durationMs:1200});return {status:'waiting-verification',message:'测试验证码未放行，页面和进度已保留。'};}
    return {status:'ready',products:[{sourceUrl,title:'免费测试商品'}]};
  },collect:async args=>{args.beforeSubmit();clicks++;return {status:'submitted',pluginStatus:'success',receipt:{kind:'toast',text:'采集成功，可继续采集产品或者前往采集箱',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString()}};},returnToSearch:async()=>({status:'ready'})},
  freeCollectionAdapter:{check:async()=>({ready:true}),lookup:async()=>{throw new Error('UI collection must not run a duplicate lookup');},verify:async()=>({status:'verified',evidence:{sourceUrl}})}
});
app.preferences.update({revision:0,browsers:[{key:'chrome-a',type:'chrome',name:'测试浏览器',debugPort:9444}],erpConnections:[{key:'erp-a',name:'测试ERP',browserKey:'chrome-a',expectedAccount:'fixture'}],stores:[]});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// The balance button is exercised against a local fixture, never SadCaptcha.
await page.route('**/api/free-sourcing/captcha/check',route=>{assert.equal(route.request().method(),'POST');balanceChecks++;return route.fulfill({json:{configured:true,provider:'sadcaptcha',credits:40,checkedAt:'2026-11-21T01:00:00.000Z'}});});
const evidence=path.resolve('../outputs/free-sourcing-20261121');fs.mkdirSync(evidence,{recursive:true});
try{
  await page.goto(base+'/sourcing');await page.getByRole('link',{name:'进入免费选品 →'}).click();
  await page.getByText('未配置',{exact:true}).waitFor();assert.equal(await page.locator('#checkCaptcha').isDisabled(),true);assert.equal(balanceChecks,0);
  assert.equal(await page.locator('[name=captchaMaxAttempts]').inputValue(),'2');
  await page.fill('#captchaKey','fixture-browser-sadcaptcha-key');await page.click('#saveCaptcha');await page.getByText('已配置',{exact:true}).waitFor();
  assert.equal(await page.inputValue('#captchaKey'),'');assert.equal((await page.content()).includes('fixture-browser-sadcaptcha-key'),false);assert.equal(balanceChecks,0);
  const settingsResponse=await page.request.get(base+'/api/settings'),settingsJson=await settingsResponse.json();
  assert.equal(settingsJson.models.SADCAPTCHA_API_KEYConfigured,true);assert.equal(JSON.stringify(settingsJson).includes('fixture-browser-sadcaptcha-key'),false);
  await page.click('#checkCaptcha');await page.getByText(/最近查询余额：40 credits/).waitFor();assert.equal(balanceChecks,1);
  await page.locator('#startFree:not([disabled])').waitFor();await page.fill('[name=keyword]','canvas wall art');await page.fill('[name=limit]','1');await page.click('#startFree');
  await page.getByText('验证待处理',{exact:true}).waitFor();assert.equal(clicks,0);assert.equal(await page.locator('#startFree').isDisabled(),true);
  assert.equal(captchaCalls,0);assert.match(await page.locator('.captcha-result').innerText(),/0 \/ 2/);
  await page.getByText(/最近一次调用前检查（/).waitFor();assert.equal((await page.content()).includes('untrusted-diagnostic'),false);
  await page.locator('.captcha-diagnostics summary').click();assert.match(await page.locator('.captcha-diagnostics').innerText(),/搜索页/);
  await page.click('#refresh');await page.locator('#refresh:not([disabled])').waitFor();
  assert.equal(await page.locator('.captcha-diagnostics').evaluate(detail=>detail.open),true,'status refresh preserves expanded diagnostics');
  const diagnosticEvidence=path.resolve('outputs/captcha-diagnosis-20261123');fs.mkdirSync(diagnosticEvidence,{recursive:true});
  await page.screenshot({path:path.join(diagnosticEvidence,'diagnostic-fixture.png'),fullPage:true});
  await page.reload();await page.getByText(/最近一次调用前检查（/).waitFor();assert.equal(captchaCalls,0);assert.equal(clicks,0);
  challenge='api-failure';await page.getByRole('button',{name:'已处理，继续'}).click();
  await page.getByText(/最近结果：页面验证未通过/).waitFor();
  assert.equal(await page.getByText(/最近一次调用前检查（/).count(),0,'older detection stop is not presented alongside a newer API outcome');
  assert.equal(captchaCalls,1);assert.match(await page.locator('.captcha-result').innerText(),/1 \/ 2/);assert.match(await page.locator('.captcha-result').innerText(),/测试验证码未放行/);
  assert.equal(app.freeSourcing.view().jobs[0].captcha.maxAttempts,2);
  assert.equal(app.freeSourcing.view().jobs[0].collectionMode,'recording');
  await page.screenshot({path:path.join(evidence,'free-sourcing-verification.png'),fullPage:true});
  await page.reload();await page.getByRole('button',{name:'已处理，继续'}).waitFor();assert.equal(clicks,0);assert.equal(captchaCalls,1);assert.match(await page.locator('.captcha-result').innerText(),/1 \/ 2/);
  challenge=false;await page.getByRole('button',{name:'已处理，继续'}).click();
  await page.getByText('已完成',{exact:true}).waitFor();assert.equal(clicks,1);assert.equal(paidCalls,0);assert.equal(captchaCalls,1);assert.equal(balanceChecks,1);
  assert.doesNotMatch(await page.locator('.steps').innerText(),/查重/);
  assert.match(await page.locator('.steps').innerText(),/批量认领到店铺/);
  assert.match(await page.locator('.steps').innerText(),/补全至待发布/);
  const handoff=page.getByRole('link',{name:'继续本批认领、补全与待发布 →'});
  assert.match(await handoff.getAttribute('href'),/^\/sourcing\/listing\?freeJobId=/);
  await page.getByRole('button',{name:'只核对结果'}).click();await page.getByText('已完成',{exact:true}).waitFor();assert.equal(clicks,1);
  await page.screenshot({path:path.join(evidence,'free-sourcing-complete.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // Detector behavior uses fixture DOM only, never actual Temu challenges.
  const probe=await browser.newPage();await probe.goto('about:blank');
  await probe.setContent('<p>请拖动滑块完成验证</p><button>采到店小秘</button>');
  assert.equal((await probe.evaluate(readTemuPage)).status,'waiting-verification');
  await probe.setContent('<iframe title="security captcha"></iframe><button>采到店小秘</button>');
  assert.equal((await probe.evaluate(readTemuPage)).status,'waiting-verification');
  await probe.setContent('<div id="dianxiaomi"><button><span>开始采集</span></button></div>');
  assert.ok((await probe.evaluate(readTemuPage)).button);
  await probe.setContent('<div id="dianxiaomi"><button>开始采集</button><button>开始采集</button></div>');
  assert.equal((await probe.evaluate(readTemuPage)).button,null);
  await probe.setContent('<div id="dianxiaomi"><label><input type="checkbox" checked>自动认领</label><button>开始采集</button></div>');
  assert.equal((await probe.evaluate(readTemuPage)).status,'waiting-plugin');
  await probe.setContent('<div style="display:none" class="captcha">拖动滑块</div><div id="dxm"><button>开始采集</button></div>');
  assert.equal((await probe.evaluate(readTemuPage)).status,'ready');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,clicks,paidCalls,captchaCalls,balanceChecks,evidence,checks:['entry','encrypted secret save without echo','explicit POST balance check','default budget payload','captcha result card','captcha pause','reload resume without retry','one click','read-only reconcile','mobile overflow','challenge detector','ambiguous button','auto-claim guard']}));
}finally{await browser.close();await new Promise(r=>app.server.close(r));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
