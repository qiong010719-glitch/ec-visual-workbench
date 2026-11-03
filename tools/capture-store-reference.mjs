// Reads the already observed, user-provided store-audit pages through the existing browser session.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/charmast-us-20261028');fs.mkdirSync(directory,{recursive:true});
const session=process.argv[2];if(!session)throw new Error('请传入已打开素材网站的 browser-skill 会话编号');
const first=JSON.parse(fs.readFileSync(path.join(directory,'page-1.json'),'utf8'));
const pages=Math.ceil(first.total/first.pageSize);
for(let page=2;page<=pages;page++) {
  const file=path.join(directory,`page-${page}.json`);if(fs.existsSync(file))continue;
  const route=`/api/store-audits/runs/store-audit-2026-10-28/items?page=${page}&pageSize=24&kind=all&state=all&rule=all&q=`;
  const expression=`fetch(${JSON.stringify(route)}).then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(d=>({total:d.total,page:d.page,pageSize:d.pageSize,items:d.items.map(x=>({id:x.id,kind:x.kind,sha256:x.sha256,imageUrl:x.imageUrl,originalImageUrl:x.originalImageUrl,title:x.title,asins:x.asins,width:x.width,height:x.height,placements:x.placements,ocrContexts:x.ocrContexts}))}))`;
  const result=JSON.parse(execFileSync('bsk',['evaluate',expression,'--session',session,'--json'],{encoding:'utf8',maxBuffer:4*1024*1024}));
  if(!result.ok || result.value?.page!==page || result.value.total!==first.total)throw new Error('分页数据不完整或发生变化：'+page);
  fs.writeFileSync(file,JSON.stringify(result.value,null,2));
  if(page%10===0 || page===pages)console.log(`已保存 ${page}/${pages} 页`);
}
const items=Array.from({length:pages},(_,i)=>JSON.parse(fs.readFileSync(path.join(directory,`page-${i+1}.json`),'utf8')).items).flat();
if(items.length!==first.total || new Set(items.map(x=>x.id)).size!==first.total)throw new Error('条数或分页去重校验不通过');
const images=items.filter(x=>x.kind==='image');
const summary={source:'https://monitor.utopiamediaai.com/?view=store-audit&store=charmast-us&run=store-audit-2026-10-28',capturedAt:new Date().toISOString(),run:first.run,total:items.length,uniqueImages:images.length,placements:images.reduce((s,i)=>s+(i.placements?.length||0),0),areas:{},images};
for(const image of images)for(const p of image.placements || [])summary.areas[p.area]=(summary.areas[p.area] || 0)+1;
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({total:summary.total,images:summary.uniqueImages,placements:summary.placements,areas:summary.areas}));
