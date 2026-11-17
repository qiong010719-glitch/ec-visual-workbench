import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const release=path.resolve(process.argv[2]);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'single-native-smoke-'));
const env={...process.env,WORKBENCH_DESKTOP_DATA:dir,WORKBENCH_DESKTOP_TEST:'true'};
delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const child=spawn(path.join(release,'win-unpacked/商品裂变工作台.exe'),[],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
let diagnostics='';child.stderr.on('data',b=>{diagnostics+=b.toString();});
try{
  const ready=path.join(dir,'desktop-ready.json');
  for(let i=0;i<120&&!fs.existsSync(ready);i++){
    if(child.exitCode!==null)throw new Error('Desktop exited: '+child.exitCode);
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(fs.existsSync(ready),'Native startup did not become ready: '+diagnostics.slice(-1500));
  const {origin,packaged}=JSON.parse(fs.readFileSync(ready));assert.equal(packaged,true);
  const html=await (await fetch(origin+'/temu')).text();assert.match(html,/local\/single-design.js/);
  const {token}=await (await fetch(origin+'/api/session')).json();
  const response=await fetch(origin+'/api/single-design',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:'{}'});
  assert.equal(response.status,400);assert.match((await response.json()).error,/任务编号/);
  const status=await (await fetch(origin+'/api/status')).json();
  assert.equal(status.singleDesignRevision,'single-design-one-click-20261115');
  assert.equal(status.imageConfigured,false);assert.equal(status.busy,false);
  const report={passed:true,packaged,release,checks:['native desktop loaded its window','isolated fresh profile without keys','single-design UI and API included','single-design backend revision verified'],paidCalls:0};
  fs.mkdirSync('tests/results/single-design',{recursive:true});
  fs.writeFileSync('tests/results/single-design/desktop-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{child.kill();}
