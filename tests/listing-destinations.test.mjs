import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSettings} from '../src/settings.mjs';
import {normalizeCollectionStores,collectionDestinationGroup} from '../src/listing-destinations.mjs';

const browsers=[{key:'chrome',type:'chrome',name:'测试浏览器',debugPort:9456}];
const erpConnections=[{key:'dxm',provider:'dianxiaomi',name:'测试ERP',browserKey:'chrome',expectedAccount:'fixture'}];
const destination=(overrides={})=>({key:'shein-a',erpKey:'dxm',platform:'shein',storeName:'希音测试店',...overrides});
const binding={erpConnections,browsers};

test('collection destinations accept independently bound SHEIN and TikTok stores, while Temu requires a site',()=>{
  assert.deepEqual(normalizeCollectionStores([destination()],binding),[{...destination(),site:''}]);
  assert.equal(normalizeCollectionStores([destination({platform:'tiktok'})],binding)[0].site,'');
  assert.throws(()=>normalizeCollectionStores([destination({platform:'temu'})],binding),/经营站点/);
  const [temu]=normalizeCollectionStores([destination({platform:'temu',site:' 加拿大站 ',storeId:' 12345 '})],binding);
  assert.equal(temu.site,'加拿大站');assert.equal(temu.storeId,'12345');assert.equal(Object.hasOwn(temu,'templates'),false);
  assert.equal(collectionDestinationGroup(temu),collectionDestinationGroup({...temu,site:'加拿大'}));
});

test('ambiguous bindings and disconnected accounts are rejected before persistence',()=>{
  assert.throws(()=>normalizeCollectionStores([destination(),destination({key:'other'})],binding),/不能重复绑定/);
  assert.throws(()=>normalizeCollectionStores([destination({storeId:'77'}),destination({key:'other',storeName:'其他名称',storeId:'77'})],binding),/店铺ID/);
  assert.throws(()=>normalizeCollectionStores([destination({erpKey:'missing'})],binding),/店小秘账号/);
  assert.throws(()=>normalizeCollectionStores([destination()],{...binding,browsers:[]}),/Chrome/);
  assert.throws(()=>normalizeCollectionStores([destination({platform:'amazon'})],binding),/Temu、SHEIN/);
  assert.throws(()=>normalizeCollectionStores([destination({templates:[]})],binding),/无效字段/);
});

test('collection bindings persist without mother drafts and survive independent settings changes',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collection-destinations-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const configuration={},settings=createSettings({directory,configuration,codec:{encode:value=>value,decode:value=>value}});
  const initial=settings.update({revision:0,browsers,erpConnections,stores:[],collectionStores:[destination()]});
  assert.equal(initial.stores.length,0);assert.equal(initial.collectionStores.length,1);
  const changed=settings.update({revision:initial.revision,models:{PLANNER_API_KEY:'fixture-key'}});
  assert.deepEqual(changed.collectionStores,initial.collectionStores);
  const before=fs.readFileSync(path.join(directory,'settings.json'),'utf8');
  assert.throws(()=>settings.update({revision:changed.revision,erpConnections:[]}),/店小秘账号/);
  assert.throws(()=>settings.update({revision:changed.revision,collectionStores:null}),/数量无效/);
  assert.equal(fs.readFileSync(path.join(directory,'settings.json'),'utf8'),before);
  const restored=createSettings({directory,configuration:{},codec:{encode:value=>value,decode:value=>value}});
  assert.deepEqual(restored.collectionStore('shein-a'),initial.collectionStores[0]);
  assert.deepEqual(restored.view().collectionPlatforms.map(platform=>platform.id),['temu','shein','tiktok']);
});
