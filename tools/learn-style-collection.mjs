import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary,normalizeProduct,hash} from '../src/reference-library.mjs';
import {analyzeProduct} from '../src/reference-analysis.mjs';
import {imageType} from '../src/provider.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const work=path.join(root,'reference/style-learning-20261101');
const priorRoot=path.join(root,'reference/style-study-20261101');
const collection={id:'scene-advertising-20261101',label:'场景广告风格 · 跨类目精选',styleProfileId:'scene_advertising',capturedAt:'2026-11-01',selectionBasis:'根据用户提供的风格，对 Amazon 实际图库与 A+ 进行目的性选样；不是全站占比统计。'};
const library=new ReferenceLibrary(path.join(work,'learned'),path.join(work,'learned/media'));
library.state.styleCollections={...library.state.styleCollections,[collection.id]:collection};
const source=process.argv.includes('--new')?'new':'prior';
let samples;
if(source==='new'){
  const specified=process.argv.find(arg=>arg.startsWith('--manifest='))?.slice('--manifest='.length);
  const manifest=JSON.parse(fs.readFileSync(specified?path.resolve(root,specified):path.join(work,'new-samples',process.argv.includes('--partial')?'partial-manifest.json':'manifest.json'),'utf8'));
  samples=Array.isArray(manifest)?manifest:manifest.products;
  if(!Array.isArray(samples))throw new Error('Manifest must contain a products array');
}
else {
  const assets=JSON.parse(fs.readFileSync(path.join(priorRoot,'assets.json'),'utf8'));
  const groups=[['zesty','Zesty Paws','宠物营养'],['cosrx','COSRX','护肤'],['ninja','Ninja','厨房电器'],['bedsure','Bedsure','家居床品'],['olly','OLLY','营养补充剂'],['dewalt','DEWALT','工具'],['anker','Anker','充电宝'],['owala','Owala','户外饮水']];
  samples=groups.map(([key,brand,category])=>{
    const page=JSON.parse(fs.readFileSync(path.join(priorRoot,key+'.json'),'utf8'));
    const list=assets.filter(a=>a.sample===key&&a.status==='downloaded');
    // Previously viewed source set: four secondary gallery examples + two A+ modules.
    const selected=[...list.filter(a=>a.role==='gallery'&&a.position>0).slice(0,4),...list.filter(a=>a.role==='aplus').slice(0,2)];
    return {key,url:page.url,title:page.productTitle || page.title,brand,category,capturedAt:page.observedAt,assets:selected.map(a=>({...a,sourceUrl:a.url,file:path.join(priorRoot,a.file)}))};
  });
}
const ids=[];
const categoryLabels={pethonesty:'宠物营养',larocheposay:'护肤',bissell:'家居清洁',coleman:'户外露营',keurig:'厨房电器',momcozy:'母婴用品',scotts:'园艺',simplemodern:'户外包袋'};
for(const sample of samples){
  const product=normalizeProduct({url:sample.url,title:sample.title,brand:sample.brand,category:categoryLabels[sample.key] || sample.category,images:sample.assets.filter(a=>a.role!=='aplus').map(a=>a.sourceUrl),aPlusImages:sample.assets.filter(a=>a.role==='aplus').map(a=>a.sourceUrl),styleProfileIds:['scene_advertising'],collectionIds:[collection.id]},{source:'browser_style_study',capturedAt:sample.capturedAt});
  // Keep this curated snapshot separate from existing broad research records for the same ASIN.
  product.id=hash(collection.id+':'+product.id).slice(0,24);
  product.assets=sample.assets.map((asset,position)=>{
    const bytes=fs.readFileSync(asset.file),sha256=hash(bytes),[mime,ext]=imageType(bytes);
    if(asset.sha256&&asset.sha256!==sha256)throw new Error('Source hash mismatch: '+sample.key);
    const filename=sha256+ext,destination=path.join(library.mediaDirectory,filename);
    if(!fs.existsSync(destination))fs.writeFileSync(destination,bytes);
    return {id:hash(asset.sourceUrl).slice(0,24),sourceUrl:asset.sourceUrl,role:asset.role,roles:[asset.role],position,status:'downloaded',localUrl:'/media/'+filename,sha256,mime,bytes:bytes.length};
  });
  product.styleNotes=sample.styleNotes || [];
  product.provenance.sourceCategory=sample.category;
  product.provenance.evidenceFolder=path.relative(root,source==='new'?path.join(work,'new-samples'):priorRoot).replaceAll('\\','/');
  library.upsert(product);ids.push(product.id);
}
library.save();
console.log(JSON.stringify({phase:'imported',source,products:ids.length,images:ids.reduce((n,id)=>n+library.state.products[id].assets.length,0)}));
if(process.argv.includes('--analyze')){
  if(fs.existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
  let cursor=0;
  const worker=async()=>{while(cursor<ids.length){const id=ids[cursor++],product=library.state.products[id];
    if(product.analysis?.status==='completed')continue;
    // An interrupted or failed request is retained for inspection, never silently retried.
    if(product.analysis?.status){console.log(JSON.stringify({phase:'skipped_existing_attempt',brand:product.brand,status:product.analysis.status}));continue;}
    try{await analyzeProduct(library,id,process.env);console.log(JSON.stringify({phase:'analyzed',brand:product.brand,images:product.analysis.images.length,status:product.analysis.status}));}
    catch(error){console.log(JSON.stringify({phase:'analysis_failed',brand:product.brand,error:error.message}));}
  }};
  await Promise.all([worker(),worker()]);
}
const report={observedAt:new Date().toISOString(),collections:library.styleCollections(),usage:library.state.analysisUsage || {},products:Object.values(library.state.products).map(p=>({id:p.id,brand:p.brand,asin:p.asin,category:p.category,images:p.assets.length,analyzed:p.analysis?.images.length || 0,status:p.analysis?.status || 'pending',method:p.analysis?.method || 'image_input_vision_api',model:p.analysis?.model || null,error:p.analysis?.error || null,previousErrors:(p.analysis?.previousAttempts || []).map(a=>a.error).filter(Boolean)}))};
fs.writeFileSync(path.join(work,'learning-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({phase:'finished',...library.stats(),usage:report.usage}));
