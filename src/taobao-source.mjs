// Adapted from the independent LinkToListing project's OneBound and Taobao adapters.
// Credentials remain in its existing OS-local credential store; no .env is read here.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const itemHosts=new Set(['item.taobao.com','h5.m.taobao.com','detail.tmall.com','detail.m.tmall.com','world.taobao.com']);
const shortHosts=new Set(['e.tb.cn','m.tb.cn']);
export function taobaoLink(input) {
  const matches=String(input || '').match(/https?:\/\/[^\s<>「」【】"']+/gi) || [];
  if(matches.length!==1)throw Error('请一次粘贴一个淘宝／天猫商品链接，或包含一个链接的分享文案。');
  let url;try{url=new URL(matches[0].replace(/[，。；！、）》]+$/,''));}catch{throw Error('商品链接格式无效。');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!itemHosts.has(url.hostname)&&!shortHosts.has(url.hostname))throw Error('目前支持淘宝／天猫商品链接及 e.tb.cn、m.tb.cn 分享链接。');
  url.protocol='https:';url.hash='';
  if(shortHosts.has(url.hostname))return {url:url.href,itemId:null};
  const id=url.searchParams.get('id') || url.pathname.match(/\/item\/(\d+)\.htm/)?.[1];
  if(!/^\d{5,30}$/.test(id || ''))throw Error('链接中没有有效商品编号，请复制完整商品链接。');
  return {itemId:id,url:`https://${url.hostname.includes('tmall')?'detail.tmall.com':'item.taobao.com'}/item.htm?id=${id}`};
}
async function limitedText(response,limit) {
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('返回内容过大，已停止读取。');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks).toString('utf8');
}
export async function resolveTaobaoLink(input,fetcher=fetch) {
  let current=taobaoLink(input);const signal=AbortSignal.timeout(20000);
  for(let hop=0;hop<5;hop++){
    if(current.itemId)return current;
    let response;try{response=await fetcher(current.url,{redirect:'manual',signal});}catch{throw Error('分享链接无法连接，请复制完整商品链接。');}
    if(response.status>=300&&response.status<400){
      const target=response.headers.get('location');await response.body?.cancel();
      if(!target)break;current=taobaoLink(new URL(target,current.url).href);continue;
    }
    if(!response.ok)throw Error(`分享链接读取失败（HTTP ${response.status}）。`);
    const html=(await limitedText(response,3*1024*1024)).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/\\\//g,'/');
    const candidates=new Map();
    for(const match of html.matchAll(/https?:\/\/[^\s"'<>]+/g)){try{const c=taobaoLink(match[0]);if(c.itemId)candidates.set(c.itemId,c);}catch{}}
    if(candidates.size===1)return [...candidates.values()][0];
    if(candidates.size>1)throw Error('分享页面包含多个商品，请使用完整商品链接。');
    break;
  }
  throw Error('分享链接未解析出商品编号，请复制完整商品链接。');
}
export function taobaoImageUrl(raw) {
  try{
    const u=new URL(String(raw || '').replaceAll('&amp;','&').replace(/^\/\//,'https://'));
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!['alicdn.com','tbcdn.cn'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return null;
    u.protocol='https:';return u.href;
  }catch{return null;}
}
const list=x=>Array.isArray(x)?x:x==null?[]:[x];
const urls=x=>list(x).map(v=>typeof v==='string'?v:v?.url||v?.src||v?.image_url).filter(Boolean);
function detailImages(value,depth=0){
  if(depth>6||!value)return [];
  if(typeof value==='string')return /^(?:https?:)?\/\/\S+$/.test(value)?[value]:[...value.matchAll(/<img\b[^>]*\b(?:src|data-src)=["']([^"']+)["']/gi)].map(m=>m[1]);
  if(Array.isArray(value))return value.flatMap(v=>detailImages(v,depth+1));
  return typeof value==='object'?Object.entries(value).flatMap(([k,v])=>/image|modules?|content|html|^(url|src|link)$/i.test(k)?detailImages(v,depth+1):[]):[];
}
export function referenceGroups(item){
  const raw={main:[...urls(item.item_imgs?.item_img??item.item_imgs??item.images),item.pic_url],
    detail:[...urls(item.desc_img),...detailImages(item.detail_images),...detailImages(item.desc)],
    sku:[...urls(item.sku_images),...urls(item.prop_imgs?.prop_img??item.prop_imgs)]};
  return Object.fromEntries(Object.entries(raw).map(([group,values])=>[group,[...new Set(values.map(taobaoImageUrl).filter(Boolean))].slice(0,20)]));
}
export function createTaobaoSource({configuration={},fetcher=fetch,keyReader}={}){
  const credentials=keyReader || (async()=>{
    if(configuration.ONEBOUND_API_KEY&&configuration.ONEBOUND_API_SECRET)return {key:configuration.ONEBOUND_API_KEY,secret:configuration.ONEBOUND_API_SECRET};
    const file=path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'LinkToListing','onebound.json');
    try{const saved=JSON.parse(await fs.readFile(file,'utf8'));return {key:saved.key,secret:saved.secret};}
    catch{return {};}
  });
  return {
    async configured(){const c=await credentials();return !!(c.key&&c.secret);},
    resolve:input=>resolveTaobaoLink(input,fetcher),
    async getItem(itemId){
      if(!/^\d{5,30}$/.test(itemId))throw Error('商品编号无效。');
      const {key,secret}=await credentials();if(!key||!secret)throw Error('未找到现有万邦本机配置，请先配置抓取服务；没有提交采集请求。');
      const url=new URL('https://api-gw.onebound.cn/taobao/item_get_pro/');
      url.search=new URLSearchParams({key,secret,num_iid:itemId,result_type:'json',cache:'no',lang:'zh-CN'}).toString();
      let response,raw;
      try{response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(60000)});raw=await limitedText(response,12*1024*1024);}
      catch{throw Error('万邦请求失败或结果未知；未自动重试，请先核对供应商调用记录。');}
      if(!response.ok)throw Error(`万邦返回 HTTP ${response.status}，未自动重试。`);
      for(const value of [key,secret])for(const token of new Set([value,encodeURIComponent(value),JSON.stringify(value).slice(1,-1)]))if(token)raw=raw.split(token).join('[REDACTED]');
      let data;try{data=JSON.parse(raw,(_k,v,c)=>typeof v==='number'&&Number.isInteger(v)&&!Number.isSafeInteger(v)?c.source:v);}catch{throw Error('万邦没有返回有效JSON。');}
      if(String(data.error_code)==='4013')throw Error('万邦调用次数已达上限（4013）。请在万邦检查淘宝高级详情接口的调用配额；未自动重试，也未启动视觉分析或生图。');
      if(data.error_code!=null&&!['','0','0000','200'].includes(String(data.error_code)))throw Error(`万邦业务错误 ${String(data.error_code).replace(/[^\w-]/g,'').slice(0,20)}；请检查接口权限、额度或商品状态。`);
      if(!data.item||typeof data.item!=='object'||Array.isArray(data.item))throw Error('万邦没有返回商品数据。');
      return {title:String(data.item.title||'淘宝对标商品').slice(0,300),groups:referenceGroups(data.item)};
    }
  };
}
