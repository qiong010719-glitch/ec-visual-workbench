import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export async function productReferenceImages(references,mediaDirectory,{limit=8}={}){
  const urls=[...new Set((references||[]).map(im=>im.url))].slice(0,limit);
  if(!urls.length)return [];
  if(!mediaDirectory)throw new Error('缺少商品原图读取位置');
  const root=await fs.realpath(mediaDirectory),images=[];
  for(const url of urls){
    if(typeof url!=='string'||!/^\/media\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/.test(url))throw new Error('商品识别必须使用本批原图');
    const file=await fs.realpath(path.join(root,path.basename(url))),relative=path.relative(root,file);
    if(relative.startsWith('..')||path.isAbsolute(relative)||(await fs.stat(file)).size>25*1024*1024)throw new Error('商品参考图路径或大小无效');
    const bytes=await sharp(file,{limitInputPixels:50000000}).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
    images.push('data:image/jpeg;base64,'+bytes.toString('base64'));
  }
  return images;
}
