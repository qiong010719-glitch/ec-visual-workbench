import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ReferenceLibrary,hash} from '../src/reference-library.mjs';
const bytes=Buffer.from('fixture-image-bytes'),sha=hash(bytes);
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'style-sidecar-')),media=path.join(dir,'media');fs.mkdirSync(media);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(media,sha+'.jpg'),bytes);const lib=new ReferenceLibrary(dir,media);lib.state.products.keep={id:'keep',assets:[],analysis:null};lib.save();return {dir,media,lib};}
function collection(){const asset={id:'a',status:'downloaded',role:'gallery',localUrl:'/media/'+sha+'.jpg',sha256:sha};return {version:1,collection:{id:'test-style',label:'Test style',styleProfileId:'scene_advertising'},products:[{id:'new-reference',styleProfileIds:['scene_advertising'],collectionIds:['test-style'],assets:[asset],analysis:{status:'completed',images:[{id:'a',sha256:sha,layout:'layout',camera:'camera',lighting:'light',palette:'palette',textDensity:'density',transferableGuidance:'guidance'}]}}]};}
test('validated sidecar is loaded on startup without losing existing reference records',t=>{
  const {dir,media}=fixture(t);fs.writeFileSync(path.join(dir,'curated-style-collection.json'),JSON.stringify(collection()));
  const loaded=new ReferenceLibrary(dir,media);assert.ok(loaded.state.products.keep);assert.equal(loaded.state.products['new-reference'].analysis.status,'completed');assert.equal(loaded.styleCollections()[0].analyzedImages,1);
  loaded.save();const again=new ReferenceLibrary(dir,media);assert.equal(Object.keys(again.state.products).length,2);
});
test('stale sidecar images and incomplete analysis cannot be silently activated',t=>{
  const {dir,media}=fixture(t);const file=path.join(dir,'curated-style-collection.json'),value=collection();
  value.products[0].analysis.images[0].sha256='stale';fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>new ReferenceLibrary(dir,media),/校验/);
  value.products[0].analysis.images[0].sha256=sha;value.products[0].analysis.status='partial';fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>new ReferenceLibrary(dir,media),/校验/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'references.json'),'utf8')).products),['keep']);
});
