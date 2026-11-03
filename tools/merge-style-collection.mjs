import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary,hash} from '../src/reference-library.mjs';
import {validateAnalysis} from '../src/reference-analysis.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const work=path.join(root,'reference/style-learning-20261101');
const source=new ReferenceLibrary(path.join(work,'learned'),path.join(work,'learned/media'));
const target=new ReferenceLibrary(path.join(root,'data/research'),path.join(root,'data/media'));
const completed=Object.values(source.state.products).filter(p=>p.analysis?.status==='completed');
if(!completed.length)throw new Error('No completed source analyses');
for(const p of completed){
  validateAnalysis(p.analysis,p.assets);
  for(const a of p.assets){
    if(!/^[a-f0-9]{64}$/.test(a.sha256))throw new Error('Invalid source hash');
    if(!p.analysis.images.some(i=>i.id===a.id&&i.sha256===a.sha256))throw new Error('Stale image analysis: '+p.id);
    const bytes=fs.readFileSync(path.join(source.mediaDirectory,path.basename(a.localUrl)));
    if(hash(bytes)!==a.sha256)throw new Error('Source file changed: '+a.id);
  }
  if(target.state.products[p.id]){
    const existing=target.state.products[p.id];
    if(JSON.stringify(existing.assets.map(a=>a.sha256))!==JSON.stringify(p.assets.map(a=>a.sha256)))throw new Error('Existing curated record differs; review before merging: '+p.id);
  }
}
const summary={validatedProducts:completed.length,validatedImages:new Set(completed.flatMap(p=>p.assets.map(a=>a.sha256))).size,excludedIncomplete:Object.values(source.state.products).filter(p=>p.analysis?.status!=='completed').map(p=>({id:p.id,status:p.analysis?.status})),existingProducts:Object.keys(target.state.products).length,newProducts:completed.filter(p=>!target.state.products[p.id]).length};
if(!process.argv.includes('--apply')){console.log(JSON.stringify({mode:'dry-run',...summary}));process.exit(0);}
let reachable=false;
try{await fetch('http://127.0.0.1:4173/api/status',{signal:AbortSignal.timeout(2000)});reachable=true;}catch(error){if(error.cause?.code!=='ECONNREFUSED')throw new Error('Cannot establish that the live service is stopped');}
if(reachable)throw new Error('Stop the idle local service before applying, to avoid overwriting its in-memory research state');
const backup=path.join(work,'before','references-'+Date.now()+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(target.file,backup);
for(const p of completed){
  for(const a of p.assets){const destination=path.join(target.mediaDirectory,path.basename(a.localUrl));
    if(fs.existsSync(destination)){if(hash(fs.readFileSync(destination))!==a.sha256)throw new Error('Destination media hash mismatch');}
    else fs.copyFileSync(path.join(source.mediaDirectory,path.basename(a.localUrl)),destination);
  }
  target.state.products[p.id] ??= p;
}
target.state.styleCollections={...target.state.styleCollections,...source.state.styleCollections};
target.state.imageAnalyses={...source.state.imageAnalyses,...target.state.imageAnalyses};
target.state.styleLearningUsage={...target.state.styleLearningUsage,'scene-advertising-20261101':source.state.analysisUsage};
target.save();
const report={mode:'applied',...summary,backup,appliedAt:new Date().toISOString(),collections:target.styleCollections()};
fs.writeFileSync(path.join(work,'merge-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
