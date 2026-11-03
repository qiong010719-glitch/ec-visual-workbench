import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from '../src/reference-library.mjs';
import {imageType} from '../src/provider.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),directory=path.join(root,'data/research/charmast-us-20261028');
const media=path.join(root,'data/media');fs.mkdirSync(media,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
const file=path.join(directory,'downloads.json'),state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{images:{},startedAt:new Date().toISOString()};
const session=process.argv[2],limit=Number(process.argv[3]) || manifest.images.length;
if(!session)throw new Error('需要素材网站的 browser-skill 会话编号');
const pending=manifest.images.filter(x=>!state.images[x.id]?.localUrl).slice(0,limit);
for(let offset=0;offset<pending.length;offset+=2) {
  const batch=pending.slice(offset,offset+2).map(x=>({id:x.id,url:x.imageUrl}));
  const expression=`Promise.all(${JSON.stringify(batch)}.map(async x=>{try{const r=await fetch(x.url);if(!r.ok)throw new Error('HTTP '+r.status);const blob=await r.blob();if(blob.size>25*1024*1024)throw new Error('文件超过25MB');const data=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(blob)});return {id:x.id,data}}catch(e){return {id:x.id,error:String(e.message)}}}))`;
  const result=JSON.parse(execFileSync('bsk',['evaluate',expression,'--session',session,'--json','--timeout','60s'],{encoding:'utf8',maxBuffer:80*1024*1024}));
  if(!result.ok || !Array.isArray(result.value))throw new Error('浏览器图片读取失败；下载状态已保存，可继续');
  for(const item of result.value) {
    if(item.error){state.images[item.id]={error:item.error};continue;}
    const bytes=Buffer.from(item.data.split(',')[1],'base64'),[mime,ext]=imageType(bytes),sha256=hash(bytes),name=sha256+ext;
    if(!fs.existsSync(path.join(media,name)))fs.writeFileSync(path.join(media,name),bytes);
    state.images[item.id]={localUrl:'/media/'+name,sha256,mime,bytes:bytes.length,sourceHashMatches:sha256===item.id};
  }
  state.updatedAt=new Date().toISOString();state.completed=Object.values(state.images).filter(x=>x.localUrl).length;state.total=manifest.images.length;
  fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2));fs.renameSync(file+'.tmp',file);
  if(offset%40===0 || offset+2>=pending.length)console.log(JSON.stringify({downloaded:state.completed,total:state.total,bytes:Object.values(state.images).reduce((s,x)=>s+(x.bytes||0),0)}));
}
