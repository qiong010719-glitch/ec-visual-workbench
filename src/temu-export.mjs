import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {temuFormats,verifyTemuImages} from './temu.mjs';

const fail=message=>Object.assign(new Error(message),{status:409});
const snapshot=sets=>JSON.stringify(sets.map(s=>({id:s.id,planId:s.planId,images:s.images.map(i=>[i.slot,i.task?.taskId,i.task?.status,i.task?.imageUrl])})));

// Build the complete export before writing any drafts. A concurrent regeneration
// must never silently change the images belonging to this package.
export async function exportTemuSets({group,setId,mediaDirectory,store,current}) {
  const sets=setId?group.sets.filter(s=>s.id===setId):group.sets;
  if(!sets.length)throw fail('套图不存在');
  const version=snapshot(sets),files=[],drafts=[],manifests=[];
  const now=new Date().toISOString();
  for(const set of sets) {
    if(set.planning.status!=='completed'||!set.images.length||set.images.some(i=>i.task?.status!=='completed'||!i.task.imageUrl))throw fail('请先完成所选套图的全部图片，再导出上架资料包；也可单独导出已完成的一套。');
    const urls=set.images.map(i=>i.task.imageUrl);
    const disk=urls.map(url=>{
      if(!/^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(url))throw fail('套图图片地址无效');
      const file=path.join(mediaDirectory,path.basename(url));
      if(!fs.existsSync(file))throw fail('套图图片文件缺失，请恢复图片后再导出');
      return file;
    });
    await verifyTemuImages(disk,group.source.image_ratio);
    const setIndex=group.sets.findIndex(s=>s.id===set.id)+1;
    const folder=`sets/${String(setIndex).padStart(2,'0')}-${set.id}`;
    const images=urls.map((url,index)=>{
      const file=`${folder}/images/${String(index+1).padStart(2,'0')}${path.extname(url)}`;
      const sha256=crypto.createHash('sha256').update(fs.readFileSync(disk[index])).digest('hex');
      files.push({path:file,url,sha256});
      return file;
    });
    const old=store.state.drafts.find(d=>d.platform==='temu'&&d.groupId===group.id&&d.setId===set.id);
    const draft={id:old?.id||crypto.randomUUID(),platform:'temu',groupId:group.id,setId:set.id,setIndex,
      title:group.source.product_name,description:group.source.product_desc,imageRatio:group.source.image_ratio,
      model:group.model,direction:set.direction,images:urls,mainImages:[...urls],detailImages:[...urls],
      skuPreviewPolicy:'preserve-source',skus:[],sop:set.plan.text,status:'draft',published:false,
      createdAt:old?.createdAt||now,updatedAt:now};
    drafts.push(draft);
    manifests.push({draftId:draft.id,setId:set.id,setIndex,folder,direction:set.direction,
      mainImages:images,detailImages:[...images],taskIds:set.images.map(i=>i.task.taskId),
      skuPreviewPolicy:'preserve-source',skus:[],status:'draft',published:false});
  }
  const latest=current().sets.filter(s=>sets.some(selected=>selected.id===s.id));
  if(snapshot(latest)!==version)throw fail('导出期间套图发生变化，请等任务完成后重新导出');
  for(const draft of drafts){const old=store.state.drafts.find(d=>d.id===draft.id);if(old)Object.assign(old,draft);else store.state.drafts.unshift(draft);}
  store.save();
  return {manifest:{schemaVersion:2,platform:'temu',groupId:group.id,title:group.source.product_name,
    description:group.source.product_desc,model:group.model,imageRatio:group.source.image_ratio,
    dimensions:temuFormats[group.source.image_ratio],setCount:manifests.length,batchSetCount:group.count,
    sets:manifests,files,skuPreviewPolicy:'preserve-source',status:'draft',published:false},drafts};
}
