import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench, WORKSPACE_REVISION} from '../src/server.mjs';

test('unified workspace exposes latest Temu pages, APIs and read-only task summaries', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crossborder-sync-'));
  const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},chromeInspector:async()=>({listeners:[],processes:[]})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  const get=async route=>{const response=await fetch(base+route);assert.equal(response.status,200,route);return response.json();};
  const status=await get('/api/status');
  assert.equal(status.workspaceRevision,WORKSPACE_REVISION);
  assert.equal(status.listingWorkflowRevision,'dxm-chinese-category-search-20261127-v1');
  assert.equal(status.freeSourcingRevision,'plugin-source-facts-20261125-v24');
  for(const route of ['/api/free-sourcing','/api/listing-workflow','/api/listing-templates'])await get(route);
  for(const route of ['/sourcing/free','/sourcing/listing','/settings']){
    const response=await fetch(base+route),html=await response.text();
    assert.equal(response.status,200);assert.match(html,/data-workspace-shell="glass"/);
    assert.match(html,/workspace-appearance.js/);assert.match(html,/workspace-shell.js/);
    assert.equal((html.match(/<header\b/g)||[]).length,1);
  }
  const root=await fetch(base+'/');assert.ok(root.url.endsWith('/cockpit.html'));
  app.freeSourcing.view=()=>({jobs:[{id:'free-test',keyword:'隔离测试采集',status:'waiting-verification',createdAt:'2026-11-23',binding:{private:'must-not-leak'},captcha:{attempts:[{secret:'must-not-leak'}]}}]});
  app.listingWorkflow.view=()=>({jobs:[{id:'listing-test',keyword:'隔离测试上架',status:'submitted',createdAt:'2026-11-23',templateSnapshot:{platform:'temu',private:'must-not-leak'}}]});
  const workspace=await get('/api/workspace');
  assert.equal(workspace.tasks.find(task=>task.id==='free-sourcing:free-test').status,'waiting-verification');
  assert.equal(workspace.tasks.find(task=>task.id==='listing-workflow:listing-test').status,'submitted');
  assert.equal(JSON.stringify(workspace).includes('must-not-leak'),false);
  assert.ok(workspace.tasks.find(task=>task.id==='listing-workflow:listing-test').url.startsWith('/sourcing/listing#job-'));

  const {token}=await get('/api/session');
  const before=app.preferences.view().revision;
  for(const service of [app.freeSourcing,app.listingWorkflow]){
    const original=service.isBusy;service.isBusy=()=>true;
    assert.equal((await get('/api/status')).busy,true);
    for(const route of ['/api/workspace/context','/api/settings/chrome/save']){
      const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:'{}'});
      assert.equal(response.status,409,route);
    }
    service.isBusy=original;
  }
  assert.equal(app.preferences.view().revision,before);
});
