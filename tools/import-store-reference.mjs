import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceLibrary,hash} from '../src/reference-library.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),directory=path.join(root,'data/research/charmast-us-20261028');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
const downloaded=JSON.parse(fs.readFileSync(path.join(directory,'downloads.json'),'utf8'));
const library=new ReferenceLibrary(path.join(root,'data/research'),path.join(root,'data/media'));
const groups=new Map();
for(const image of manifest.images)for(const placement of image.placements || []) {
  const store=placement.area==='店铺装修',key=store?placement.url:placement.asin;
  if(!key)continue;
  if(!groups.has(key))groups.set(key,{id:hash('charmast-store-audit:'+key).slice(0,24),asin:store?null:key,title:placement.title || (store?'Charmast 店铺页面':'Charmast '+key),brand:'charmast',marketplace:'amazon.com',category:store?'充电宝 / Power Banks / 店铺装修':'充电宝 / Power Banks',url:store?placement.url:'https://www.amazon.com/dp/'+key,categoryUrl:null,rank:null,rankBasis:'user_provided_store',assets:[],aplusStatus:'not_observed',warnings:[],provenance:{source:'user_store_archive',sourceUrl:manifest.source,runId:manifest.run.id,capturedAt:manifest.capturedAt},analysis:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  const group=groups.get(key);
  const role=store?'storefront':placement.area==='品牌故事'?'brand_story':placement.area==='A+ 图片'?'aplus':/(?:landingImage|gallery\.main|\.0$)/.test(placement.source)?'main':'gallery';
  const existing=group.assets.find(a=>a.id===image.id);
  const occurrence={area:placement.area,source:placement.source,url:placement.url,variantAsin:placement.variantAsin || null,sourceImageUrl:placement.imageUrl};
  if(existing){existing.placements.push(occurrence);if(!existing.roles.includes(role))existing.roles.push(role);if(role==='aplus')group.aplusStatus='found';continue;}
  const bytes=downloaded.images[image.id];
  group.assets.push({id:image.id,sourceUrl:new URL(image.imageUrl,'https://monitor.utopiamediaai.com').href,originalImageUrl:image.originalImageUrl,role,roles:[role],position:group.assets.length,width:image.width,height:image.height,status:bytes?.localUrl?'downloaded':'pending',...bytes,placements:[occurrence]});
  if(role==='aplus')group.aplusStatus='found';
}
for(const group of groups.values())library.upsert(group);
library.state.storeImports ||= {};
library.state.storeImports[manifest.run.id]={sourceUrl:manifest.source,uniqueImages:manifest.uniqueImages,placements:manifest.placements,expectedProducts:manifest.run.coverage.products,expectedStorePages:manifest.run.coverage.storePages,importedGroups:groups.size,downloaded:downloaded.completed,importedAt:new Date().toISOString(),productIds:[...groups.values()].map(g=>g.id)};
library.save();
console.log(JSON.stringify({groups:groups.size,storePages:[...groups.values()].filter(g=>!g.asin).length,products:[...groups.values()].filter(g=>g.asin).length,uniqueImages:manifest.uniqueImages,downloaded:downloaded.completed,stats:library.stats()}));
