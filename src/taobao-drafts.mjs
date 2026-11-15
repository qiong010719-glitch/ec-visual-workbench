import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {hydrateModelIdentity} from './taobao-model.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const text=(value,max=120000)=>typeof value==='string'?value.slice(0,max):'';
const scalars=['generationMode','designScope','targetMarket','modelEthnicity','prodName','prodDesc','strictReq','sopText','lastAgentTaskId','lastAgentTask','modelChoice','infoDensity','sceneIntensity','genChannel','categoryChoice'];
export function validateTaobaoDraft(value,{mediaDirectory,benchmarks,store,verifyHashes=false}){
  if(!value||value.version!==1||!value.app||value.app.designScope!=='custom'||!['fast','master'].includes(value.app.generationMode))fail('工作台草稿格式不支持。');
  const media={};
  const image=url=>{
    if(typeof url!=='string'||!/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(url))fail('草稿图片必须是已保存的本机素材。');
    let bytes;try{bytes=fs.readFileSync(path.join(mediaDirectory,path.basename(url)));}catch{fail('草稿引用的图片已丢失，未覆盖工作台。');}
    media[url]=crypto.createHash('sha256').update(bytes).digest('hex');
    if(verifyHashes&&value.media?.[url]!==media[url])fail('草稿图片已变化，未覆盖工作台。');
    return url;
  };
  const app=Object.fromEntries(scalars.map(k=>[k,text(value.app[k])]));
  app.textDepth=!!value.app.textDepth;app.activeAgentTask=null;app.activeKieTasks=[];app.mobileSlots=[];
  const custom=value.app.customLayout;
  if(!custom?.taobao||!['main','sub','aplus'].every(k=>Number.isInteger(custom[k])&&custom[k]>=0&&custom[k]<=7))fail('草稿缺少有效的淘宝张数设置。');
  app.customLayout=JSON.parse(JSON.stringify(custom));app.categoryState=null;
  if(!Array.isArray(value.app.materialMeta)||value.app.materialMeta.length>16)fail('草稿本品素材格式无效。');
  app.materialMeta=value.app.materialMeta.map(m=>({id:text(m.id,120),filename:text(m.filename,300),category:text(m.category,80),url:image(m.url)}));
  if(!Array.isArray(value.app.imageSlots)||value.app.imageSlots.length>14)fail('草稿图片槽位无效。');
  app.imageSlots=Array.from({length:14},(_,i)=>{
    const s=value.app.imageSlots[i];if(!s)return null;
    const result={url:image(s.url),id:text(s.id,120),finalPrompt:text(s.finalPrompt)};
    if(s.history){if(!Array.isArray(s.history)||s.history.length>50||!Number.isInteger(s.currentIndex)||s.currentIndex<0||s.currentIndex>=s.history.length)fail('草稿历史图片无效。');result.history=s.history.map(image);result.currentIndex=s.currentIndex;}
    return result;
  });
  const input=value.benchmark||{},benchmark={jobId:null,mapping:{},enabled:false,sourceUrl:text(input.sourceUrl,2000),comparisons:{}};
  if(input.jobId){
    const job=benchmarks.get(input.jobId);benchmark.jobId=job.id;benchmark.sourceUrl=job.sourceUrl;benchmark.enabled=!!input.enabled;
    for(const [slot,m] of Object.entries(input.mapping||{})){
      if(!/^([0-9]|1[0-3])$/.test(slot)||!['main','sku','detail'].includes(m?.zone))fail('草稿对标槽位无效。');
      if(!m.assetId)continue;
      const asset=job.assets.find(a=>a.id===m.assetId&&a.status==='downloaded'&&a.group===m.zone);
      if(!asset||(benchmark.enabled&&!asset.layout))fail('草稿对标图片不可用，请先修复原抓取或分析任务。');
      benchmarks.bytes(asset);image(asset.localUrl);benchmark.mapping[slot]={zone:m.zone,assetId:asset.id};
    }
  }
  for(const task of Object.values(store.state.tasks))if(media[task.imageUrl]&&task.benchmark){image(task.benchmark.localUrl);benchmark.comparisons[task.imageUrl]=task.benchmark;}
  const referenceIds=Array.isArray(value.referenceIds)?value.referenceIds.filter(id=>typeof id==='string'&&/^[\w-]{1,120}$/.test(id)).slice(0,20):[];
  const modelIdentity=hydrateModelIdentity(value.modelIdentity,mediaDirectory,{draft:true}) || {version:1,enabled:false};
  for(const ref of modelIdentity.references || [])image(ref.url);
  return {version:1,app,benchmark,modelIdentity,visualStyle:value.visualStyle==='original'?'original':'scene_advertising',referenceIds,media};
}
