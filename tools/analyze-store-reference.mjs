import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary} from '../src/reference-library.mjs';
import {analyzeProduct,visionSettings} from '../src/reference-analysis.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const library=new ReferenceLibrary(path.join(root,'data/research'),path.join(root,'data/media'));
const limit=Number(process.argv[2]) || Infinity;
const concurrency=Math.min(8,Math.max(1,Number(process.argv[3]) || 4));
const source=library.state.storeImports?.['store-audit-2026-10-28'];if(!source)throw new Error('请先导入店铺图片');
// Each source image is analyzed once. Product/page analyses reuse hashes and retain their own placement roles.
const unique=[...new Map(source.productIds.flatMap(id=>library.state.products[id].assets).filter(a=>a.status==='downloaded').map(a=>[a.sha256,a])).values()];
const pending=unique.filter(a=>!library.state.imageAnalyses?.[a.sha256]).slice(0,limit);
const progressFile=path.join(root,'data/research/charmast-us-20261028/analysis-progress.json');
let failed=0,cursor=0,consecutiveFailures=0,stop=false;
const writeProgress=()=>{
  const progress={total:source.uniqueImages,downloadedUnique:unique.length,analyzedUnique:Object.keys(library.state.imageAnalyses || {}).length,failed,usage:library.state.analysisUsage || {},updatedAt:new Date().toISOString()};
  fs.writeFileSync(progressFile,JSON.stringify(progress,null,2));
  console.log(JSON.stringify(progress));
};
async function worker() {
  while(!stop && cursor<pending.length) {
    const offset=cursor;cursor+=4;
    const assets=pending.slice(offset,offset+4),jobId='analysis-batch-'+offset;
    library.state.products[jobId]={id:jobId,title:'Charmast 充电宝整店参考图片',category:'充电宝 / Power Banks / 消费电子 / 3C',assets,analysis:null};
    try {await analyzeProduct(library,jobId,process.env);consecutiveFailures=0;}
    catch(error){failed+=assets.length;consecutiveFailures++;console.log(JSON.stringify({batch:offset,error:error.message}));if(consecutiveFailures>=2)stop=true;}
    finally {delete library.state.products[jobId];library.save();writeProgress();}
  }
}
await Promise.all(Array.from({length:concurrency},()=>worker()));
for(const productId of source.productIds) {
  const p=library.state.products[productId];
  const images=p.assets.filter(a=>library.state.imageAnalyses?.[a.sha256]).map(a=>({...library.state.imageAnalyses[a.sha256],id:a.id,role:a.role,roles:a.roles || [a.role]}));
  p.analysis={status:images.length===p.assets.length?'completed':images.length?'partial':'pending',images,tags:['充电宝','Power Banks','Portable Charger','消费电子','3C'],analyzedAt:new Date().toISOString(),model:visionSettings(process.env).model};
}
library.save();console.log(JSON.stringify({stats:library.stats(),analyzedUnique:Object.keys(library.state.imageAnalyses || {}).length}));
if(stop)throw new Error('视觉服务连续两批失败，已停止派发新批次；成功结果保留，可按缺口继续。');
