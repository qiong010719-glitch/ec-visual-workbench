import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary,hash} from '../src/reference-library.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),work=path.join(root,'reference/style-learning-20261101');
const live=path.join(root,'data'),preview=path.join(work,'preview-data');
if(fs.existsSync(preview))throw new Error('Preview already exists; preserve its data');
const learned=JSON.parse(fs.readFileSync(path.join(work,'learned/references.json'),'utf8'));
const products=Object.values(learned.products);if(products.some(p=>p.analysis?.status!=='completed'))throw new Error('All selected records must have completed analysis');
const collection=Object.values(learned.styleCollections)[0];
const sidecar={version:1,collection,products,analysisUsage:learned.analysisUsage};
// New immutable media only. Never rewrite an existing user image.
for(const product of products)for(const asset of product.assets){
  const bytes=fs.readFileSync(path.join(work,'learned/media',path.basename(asset.localUrl)));
  if(hash(bytes)!==asset.sha256)throw new Error('Source image changed');
  const destination=path.join(live,'media',path.basename(asset.localUrl));
  if(fs.existsSync(destination)){if(hash(fs.readFileSync(destination))!==asset.sha256)throw new Error('Existing image hash mismatch');}
  else fs.writeFileSync(destination,bytes,{flag:'wx'});
}
fs.mkdirSync(path.join(preview,'research'),{recursive:true});fs.mkdirSync(path.join(preview,'media'));
fs.copyFileSync(path.join(live,'workbench.json'),path.join(preview,'workbench.json'));
fs.copyFileSync(path.join(live,'research/references.json'),path.join(preview,'research/references.json'));
// Image files are immutable in this app; links avoid duplicating the existing library.
for(const entry of fs.readdirSync(path.join(live,'media'),{withFileTypes:true}))if(entry.isFile()){
  const from=path.join(live,'media',entry.name),to=path.join(preview,'media',entry.name);
  try{fs.linkSync(from,to);}catch{fs.copyFileSync(from,to);}
}
fs.writeFileSync(path.join(preview,'research/curated-style-collection.json'),JSON.stringify(sidecar,null,2));
const verified=new ReferenceLibrary(path.join(preview,'research'),path.join(preview,'media'));verified.save();
// The running process does not read this file. The updated source loads it on its next normal start.
const activationFile=path.join(live,'research/curated-style-collection.json');
if(fs.existsSync(activationFile))throw new Error('A startup collection already exists; preserve it for review');
fs.writeFileSync(activationFile,JSON.stringify(sidecar,null,2),{flag:'wx'});
const report={preparedAt:new Date().toISOString(),previewDataDirectory:preview,activationFile,liveReferencesUnchanged:true,previewProducts:verified.stats().products,collection:verified.styleCollections()[0],liveWorkbenchSha256:hash(fs.readFileSync(path.join(live,'workbench.json'))),liveReferencesSha256:hash(fs.readFileSync(path.join(live,'research/references.json'))),activation:'The original service loads the validated collection on its next normal restart; preview uses a separate data directory.'};
fs.writeFileSync(path.join(work,'activation-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
