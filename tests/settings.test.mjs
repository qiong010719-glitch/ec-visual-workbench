import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSettings} from '../src/settings.mjs';

test('four service keys persist independently while built-in connection settings reject edits atomically',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'service-key-settings-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const codec={encode:v=>Buffer.from(v).toString('base64'),decode:v=>Buffer.from(v,'base64').toString()};
  const configuration={},settings=createSettings({directory,configuration,codec});
  const keys={SUANZHOU_IMAGE_API_KEY:'fixture-image-key',PLANNER_API_KEY:'fixture-text-key',SUANZHOU_VIDEO_API_KEY:'fixture-video-key',APIFY_API_TOKEN:'fixture-link-key'};
  const saved=settings.update({revision:0,models:keys});
  for(const [name,value] of Object.entries(keys)){
    assert.equal(configuration[name],value);assert.equal(saved.models[name+'Configured'],true);
    assert.equal(JSON.stringify(saved).includes(value),false);
    for(const file of ['settings.json','secrets.json'])assert.equal(fs.readFileSync(path.join(directory,file),'utf8').includes(value),false);
  }
  const restoredConfig={},restored=createSettings({directory,configuration:restoredConfig,codec});
  for(const [name,value] of Object.entries(keys))assert.equal(restoredConfig[name],value);
  restored.update({revision:saved.revision,models:{SUANZHOU_IMAGE_API_KEY:'replacement-image',PLANNER_API_KEY:'',SUANZHOU_VIDEO_API_KEY:'',APIFY_API_TOKEN:''}});
  assert.equal(restoredConfig.SUANZHOU_IMAGE_API_KEY,'replacement-image');
  for(const name of ['PLANNER_API_KEY','SUANZHOU_VIDEO_API_KEY','APIFY_API_TOKEN'])assert.equal(restoredConfig[name],keys[name]);
  const baseline=restored.view(),files=['settings.json','secrets.json'].map(file=>fs.readFileSync(path.join(directory,file),'utf8'));
  for(const field of ['SUANZHOU_IMAGE_BASE_URL','SUANZHOU_IMAGE_MODEL','PLANNER_BASE_URL','PLANNER_MODEL','TITLE_MODEL','PLANNER_API_FORMAT','TITLE_API_FORMAT','PLANNER_REASONING_EFFORT','PLANNER_TIMEOUT_MS','APIFY_TOKEN_FILE','VIDEO_MODEL']){
    assert.throws(()=>restored.update({revision:baseline.revision,models:{PLANNER_API_KEY:'must-not-save',[field]:'changed'}}),/网站内置/);
    assert.throws(()=>restored.preview({revision:baseline.revision,models:{[field]:'changed'}}),/网站内置/);
  }
  assert.deepEqual(restored.view(),baseline);
  assert.deepEqual(['settings.json','secrets.json'].map(file=>fs.readFileSync(path.join(directory,file),'utf8')),files);
  restored.update({revision:baseline.revision,models:{},clearSecrets:['SUANZHOU_VIDEO_API_KEY']});
  assert.equal(restoredConfig.SUANZHOU_VIDEO_API_KEY,undefined);assert.equal(restoredConfig.APIFY_API_TOKEN,keys.APIFY_API_TOKEN);
});

test('SadCaptcha secret is encoded, never returned, restored, and cleared independently of existing credentials',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sadcaptcha-settings-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const calls=[],codec={encode:value=>{calls.push('encode');return Buffer.from(value).toString('base64');},decode:value=>Buffer.from(value,'base64').toString()};
  const configuration={},settings=createSettings({directory,configuration,codec});
  const saved=settings.update({revision:0,models:{SADCAPTCHA_API_KEY:'fixture-sadcaptcha-key',GB_APP_SECRET:'fixture-geekbi-key'}});
  assert.equal(configuration.SADCAPTCHA_API_KEY,'fixture-sadcaptcha-key');
  assert.equal(saved.models.SADCAPTCHA_API_KEYConfigured,true);assert.equal(saved.models.GB_APP_SECRETConfigured,true);
  assert.equal(calls.length,1);assert.equal(JSON.stringify(saved).includes('fixture-sadcaptcha-key'),false);
  for(const name of ['settings.json','secrets.json'])assert.equal(fs.readFileSync(path.join(directory,name),'utf8').includes('fixture-sadcaptcha-key'),false);
  assert.equal(Object.hasOwn(saved.models,'SADCAPTCHA_API_KEY'),false);
  const restoredConfiguration={},restored=createSettings({directory,configuration:restoredConfiguration,codec});
  assert.equal(restoredConfiguration.SADCAPTCHA_API_KEY,'fixture-sadcaptcha-key');
  restored.update({revision:saved.revision,models:{SADCAPTCHA_API_KEY:''}});
  assert.equal(restoredConfiguration.SADCAPTCHA_API_KEY,'fixture-sadcaptcha-key');
  const cleared=restored.update({revision:restored.view().revision,models:{},clearSecrets:['SADCAPTCHA_API_KEY']});
  assert.equal(cleared.models.SADCAPTCHA_API_KEYConfigured,false);assert.equal(restoredConfiguration.SADCAPTCHA_API_KEY,undefined);
  assert.equal(restoredConfiguration.GB_APP_SECRET,'fixture-geekbi-key');
});
