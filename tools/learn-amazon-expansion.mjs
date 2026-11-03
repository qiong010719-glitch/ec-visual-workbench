import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary} from '../src/reference-library.mjs';
import {analyzeProduct,visionSettings} from '../src/reference-analysis.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/amazon-expansion-20261101');
const planFile=path.join(directory,'category-plan.json');
const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
const mode=process.argv[2]||'download';
if(!['download','analyze'].includes(mode))throw new Error('仅支持 download / analyze');
const analysisConcurrency=Number(process.env.REFERENCE_ANALYSIS_CONCURRENCY||4);
if(!Number.isInteger(analysisConcurrency)||analysisConcurrency<1||analysisConcurrency>8)throw new Error('分析并发数必须为 1 到 8');
const analysisBatchSize=Number(process.env.REFERENCE_ANALYSIS_BATCH_SIZE||4);
if(!Number.isInteger(analysisBatchSize)||analysisBatchSize<1||analysisBatchSize>4)throw new Error('每批分析图片数必须为 1 到 4');
try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const source=JSON.parse(fs.readFileSync(path.join(directory,'references.json'),'utf8'));
const ids=[...new Set(plan.categories.flatMap(c=>c.selectedProductIds||[]))];
if(!ids.length)throw new Error('没有已选参考商品');
const learningDirectory=path.join(directory,'learning');
const library=new ReferenceLibrary(learningDirectory,path.join(root,'data/media'));
const old=JSON.parse(fs.readFileSync(path.join(root,'data/research/references.json'),'utf8'));
const realSave=library.save.bind(library);let lastSave=0;
library.save=()=>{if(Date.now()-lastSave>1500){realSave();lastSave=Date.now();}};
const flush=()=>{realSave();lastSave=Date.now();};
for(const id of ids)library.upsert(structuredClone(source.products[id]));
library.state.imageAnalyses ||= {};
const assets=()=>ids.flatMap(id=>library.state.products[id].assets);
let completed=0,failedCalls=0;
function progress(){
  const all=assets(),unique=[...new Map(all.map(a=>[a.sha256||a.sourceUrl||a.id,a])).values()];
  const state={phase:mode,products:ids.length,processedProducts:completed,expectedUnique:unique.length,downloadedUnique:unique.filter(a=>a.status==='downloaded').length,analyzedUnique:unique.filter(a=>a.sha256&&library.state.imageAnalyses?.[a.sha256]).length,failedDownloads:all.filter(a=>a.status==='failed').length,failedCalls,usage:library.state.analysisUsage||{},updatedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(directory,'learning-progress.json'),JSON.stringify(state,null,2));console.log(JSON.stringify(state));return state;
}
const timer=setInterval(progress,30000);
try {
  if(mode==='download'){
    const priorSources=new Map(Object.values(old.products).flatMap(p=>p.assets).filter(a=>a.sourceUrl&&a.status==='downloaded').map(a=>[a.sourceUrl,a]));
    for(const a of assets())if(a.status!=='downloaded'&&priorSources.has(a.sourceUrl)){
      const previous=priorSources.get(a.sourceUrl);
      if(fs.existsSync(path.join(library.mediaDirectory,path.basename(previous.localUrl))))for(const k of ['status','localUrl','sha256','mime','bytes'])a[k]=previous[k];
    }
    let cursor=0;
    async function worker(){while(cursor<ids.length){const id=ids[cursor++];await library.downloadProduct(id);completed++;library.save();}}
    await Promise.all(Array.from({length:3},()=>worker()));
  } else {
    if(!visionSettings(process.env).key)throw new Error('视觉分析密钥尚未配置');
    if(assets().some(a=>a.status!=='downloaded'))throw new Error('图片下载不完整，先处理下载失败再分析');
    for(const a of assets())if(old.imageAnalyses?.[a.sha256])library.state.imageAnalyses[a.sha256] ||= old.imageAnalyses[a.sha256];
    const scheduled=new Set(Object.keys(library.state.imageAnalyses)),batches=[];
    for(const id of ids){
      const p=library.state.products[id],pending=[];
      for(const a of p.assets)if(!scheduled.has(a.sha256)){scheduled.add(a.sha256);pending.push(a);}
      for(let offset=0;offset<pending.length;offset+=analysisBatchSize)batches.push({owner:id,assets:pending.slice(offset,offset+analysisBatchSize)});
    }
    let cursor=0,consecutive=0,stop=false;
    library.state.analysisErrors ||= [];
    async function worker(){while(!stop&&cursor<batches.length){
      const index=cursor++,batch=batches[index],owner=library.state.products[batch.owner],id='analysis-expansion-'+index;
      library.state.products[id]={id,title:owner.title,category:owner.category,assets:batch.assets,analysis:null};
      try{
        const result=await analyzeProduct(library,id,process.env);consecutive=0;
        for(const a of batch.assets)library.state.imageAnalyses[a.sha256].tags=result.tags;
      }catch(error){
        failedCalls++;consecutive++;library.state.analysisErrors.push({owner:batch.owner,hashes:batch.assets.map(a=>a.sha256),error:error.message,at:new Date().toISOString()});
        console.log(JSON.stringify({batch:index,error:error.message}));if(consecutive>=3)stop=true;
      }finally{delete library.state.products[id];flush();}
    }}
    progress();await Promise.all(Array.from({length:analysisConcurrency},()=>worker()));
    for(const id of ids){
      const p=library.state.products[id];
      const images=p.assets.filter(a=>library.state.imageAnalyses[a.sha256]).map(a=>({...library.state.imageAnalyses[a.sha256],id:a.id,role:a.role,roles:a.roles||[a.role]}));
      p.analysis={status:images.length===p.assets.length?'completed':'partial',images,tags:[...new Set([...p.category.split('/').map(s=>s.trim()),...images.flatMap(i=>i.tags||[])])],model:visionSettings(process.env).model,analyzedAt:new Date().toISOString()};
      completed+=p.analysis.status==='completed'?1:0;
    }
  }
  for(const c of plan.categories){
    if(!c.selectedProductIds.length){c.downloadStatus='pending';c.analysisStatus='pending';continue;}
    c.downloadStatus=c.selectedProductIds.every(id=>library.state.products[id].assets.every(a=>a.status==='downloaded'))?'completed':'partial';
    c.analysisStatus=c.selectedProductIds.length&&c.selectedProductIds.every(id=>library.state.products[id].analysis?.status==='completed')?'completed':'partial';
  }
  plan.phase=mode==='download'?'图片下载结束，等待视觉分析':(completed===ids.length?'所选图片视觉分析完成':'部分图片尚未完成视觉分析');
  plan.updatedAt=new Date().toISOString();fs.writeFileSync(planFile,JSON.stringify(plan,null,2));
}finally{clearInterval(timer);flush();const result=progress();if(mode==='analyze'&&result.analyzedUnique!==result.expectedUnique)process.exitCode=1;}
