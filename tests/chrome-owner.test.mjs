import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectChromeOwner,listeningOwners,matchesProfile} from '../../scripts/lib/chrome-owner.mjs';

const config={debugPort:9222,userDataDir:'C:\\用户 数据\\Chrome Profile'};
const processInfo={pid:42,name:'chrome.exe',commandLine:'"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" "--user-data-dir=C:\\用户 数据\\Chrome Profile" --remote-debugging-port=9222'};
const tcp='  TCP    127.0.0.1:9222    0.0.0.0:0   LISTENING   42\r\n';
const fake=(stdout,processes=[processInfo])=>async(file,args,options)=>({stdout:file.endsWith('netstat.exe')?stdout:JSON.stringify(processes)});
const inspect=(run,c=config)=>inspectChromeOwner(c,{run,platform:'win32',systemRoot:'C:\\Windows'});

test('accepts the exact Chrome profile on IPv4/IPv6 loopback, ignoring established and other ports',async()=>{
  const output=tcp+' TCP [::1]:9222 [::]:0 LISTENING 42\n TCP 127.0.0.1:49222 0.0.0.0:0 LISTENING 7\n TCP 127.0.0.1:9222 127.0.0.1:12345 ESTABLISHED 7\n';
  assert.equal(await inspect(fake(output)),'owned');
  assert.deepEqual(listeningOwners(output,9222),[{address:'127.0.0.1',pid:42},{address:'::1',pid:42}]);
  assert.equal(await inspect(fake(tcp.replace('LISTENING','侦听'))),'owned');
});
test('quoted Unicode/space profiles match exactly and cannot match an adjacent path or conflicting switch',()=>{
  for(const flag of ['"--user-data-dir=C:\\用户 数据\\Chrome Profile"','--user-data-dir="C:\\用户 数据\\Chrome Profile\\"'])assert.equal(matchesProfile({...processInfo,commandLine:'chrome.exe '+flag},config.userDataDir),true);
  for(const commandLine of ['chrome.exe --user-data-dir=C:\\用户 数据\\Chrome Profile','chrome.exe "--user-data-dir=C:\\用户 数据\\Chrome Profile-other"',processInfo.commandLine+' --user-data-dir=C:\\other','chrome.exe --other="--user-data-dir=C:\\用户 数据\\Chrome Profile"'])assert.equal(matchesProfile({...processInfo,commandLine},config.userDataDir),false);
});
test('rejects foreign browsers, missing process info, wrong profiles and any wildcard listener',async()=>{
  for(const processes of [[],[{...processInfo,name:'notepad.exe'}],[{...processInfo,commandLine:null}],[{...processInfo,pid:99}],[processInfo,processInfo]])assert.equal(await inspect(fake(tcp,processes)),'wrong');
  assert.equal(await inspect(fake(tcp),{...config,userDataDir:'C:\\other'}),'wrong');
  for(const address of ['0.0.0.0','[::]','192.168.1.2']){
    let calls=0;const run=async()=>{calls++;return {stdout:tcp.replace('127.0.0.1',address)};};
    assert.equal(await inspect(run),'wrong');assert.equal(calls,1,'a non-loopback listener must be rejected before process lookup');
  }
});
test('a closed port does not query processes and malformed listener records never become closed',async()=>{
  let calls=0;assert.equal(await inspect(async()=>{calls++;return {stdout:''};}),'closed');assert.equal(calls,1);
  await assert.rejects(inspect(fake(tcp.replace('42','?'))),{code:'CHROME_OWNER_INVALID'});
});
test('timeouts and system failures are actionable and do not expose command lines or raw output',async()=>{
  for(const error of [Object.assign(new Error('Command failed: secret'),{killed:true,signal:'SIGTERM'}),Object.assign(new Error('secret'),{code:'ENOENT'})]){
    let calls=0;await assert.rejects(inspect(async()=>{calls++;throw error;}),e=>e.code==='CHROME_PORT_CHECK_FAILED'&&!e.message.includes('secret'));assert.equal(calls,1);
    const run=async file=>{if(file.endsWith('netstat.exe'))return {stdout:tcp};throw error;};
    await assert.rejects(inspect(run),e=>e.code.startsWith('CHROME_OWNER_')&&!e.message.includes('secret'));
  }
  await assert.rejects(inspect(async file=>({stdout:file.endsWith('netstat.exe')?tcp:'bad response secret'})),{code:'CHROME_OWNER_CHECK_FAILED'});
});
test('process query batches exact owning PIDs using encoded PowerShell and a bounded timeout',async()=>{
  const calls=[];await inspect(async(file,args,options)=>{calls.push({file,args,options});return {stdout:calls.length===1?tcp:JSON.stringify([processInfo])};});
  assert.equal(calls.length,2);assert.match(calls[0].file,/System32\\netstat.exe$/);assert.deepEqual(calls[0].args,['-ano','-p','tcp']);
  const script=Buffer.from(calls[1].args.at(-1),'base64').toString('utf16le');assert.match(script,/ProcessId = 42/);assert.doesNotMatch(script,/Get-NetTCPConnection|Chrome Profile/);
  assert.equal(calls[1].options.windowsHide,true);assert.equal(calls[1].options.timeout,30000);
});
