import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary} from '../src/reference-library.mjs';
import {analyzeProduct,visionSettings} from '../src/reference-analysis.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),directory=path.join(root,'data/research/apify-powerbanks-pilot-20261101');
try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const library=new ReferenceLibrary(directory,path.join(root,'data/media'));
const job=library.state.campaigns['us-powerbanks-pilot-20261101'];
if(!['partial','completed'].includes(job?.status))throw new Error('采集尚未结束');
const ids=job.categories.flatMap(c=>c.selectedProductIds || []);
const assets=ids.flatMap(id=>library.state.products[id].assets);
if(assets.some(a=>a.status!=='downloaded'))throw new Error('先补齐选中商品的图片下载');
const unique=[...new Map(assets.map(a=>[a.sha256,a])).values()];
const store=JSON.parse(fs.readFileSync(path.join(root,'data/research/references.json'),'utf8'));
library.state.imageAnalyses ||= {};
for(const a of unique)if(store.imageAnalyses?.[a.sha256])library.state.imageAnalyses[a.sha256] ||= store.imageAnalyses[a.sha256];
const pending=unique.filter(a=>!library.state.imageAnalyses[a.sha256]);
const cached=unique.length-pending.length;let cursor=0,failures=0,consecutive=0,stop=false;
const progress=()=>{
  const result={expected:unique.length,analyzed:unique.filter(a=>library.state.imageAnalyses[a.sha256]).length,reused:cached,failures,usage:library.state.analysisUsage || {},updatedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(directory,'analysis-progress.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
};
async function worker(){while(!stop&&cursor<pending.length){
  const offset=cursor;cursor+=4;const batch=pending.slice(offset,offset+4),id='analysis-batch-pilot-'+offset;
  library.state.products[id]={id,title:'美国站充电宝设计参考',category:'充电宝 / Power Banks / 3C',assets:batch,analysis:null};
  try{await analyzeProduct(library,id,process.env);consecutive=0;}catch(e){failures+=batch.length;consecutive++;console.log(JSON.stringify({batch:offset,error:e.message}));if(consecutive>=2)stop=true;}
  finally{delete library.state.products[id];library.save();progress();}
}}
await Promise.all(Array.from({length:4},()=>worker()));
for(const id of ids){const p=library.state.products[id];const images=p.assets.filter(a=>library.state.imageAnalyses[a.sha256]).map(a=>({...library.state.imageAnalyses[a.sha256],id:a.id,role:a.role,roles:a.roles || [a.role]}));p.analysis={status:images.length===p.assets.length?'completed':'partial',images,tags:['充电宝','Power Banks','Portable Charger','消费电子','3C'],analyzedAt:new Date().toISOString(),model:visionSettings(process.env).model};}
job.analysisStatus=ids.every(id=>library.state.products[id].analysis.status==='completed')?'completed':'partial';library.save();progress();
if(job.analysisStatus!=='completed')process.exitCode=1;
