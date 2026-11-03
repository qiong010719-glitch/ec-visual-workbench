import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {resolveImageModel} from './image-models.mjs';

export function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image/png', '.png'];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', '.jpg'];
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return ['image/webp', '.webp'];
  throw new Error('仅接受 PNG、JPEG、WebP 图片');
}

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 ||
      p[0] === 192 && p[1] === 168 || p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  // Pin public IPv4 addresses. IPv6-only sites are reported as unsupported.
  return false;
}

const networkError = (message, code = 'ETIMEDOUT') => Object.assign(new Error(message), {code});
const retryable = error => ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH'].includes(error.code) || error.status === 408 || error.status === 429 || error.status >= 500;

function imageProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  let proxy;
  try {proxy = new URL(proxyUrl);} catch {throw new Error('IMAGE_DOWNLOAD_PROXY 不是有效的代理地址');}
  if (!['http:','https:'].includes(proxy.protocol) || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error('图片下载代理必须是 HTTP 或 HTTPS 代理地址');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 5) throw new Error('图片代理下载需要 Node.js 24.5 或更新版本');
  return new https.Agent({keepAlive:false,proxyEnv:{HTTPS_PROXY:proxy.href}});
}

async function downloadOnce(address, {agent, deadline, idleTimeoutMs}, redirects = 0) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || !['', '443'].includes(url.port)) throw new Error('图片地址必须是公共 HTTPS 地址');
  let dnsTimer;
  const addresses = await Promise.race([
    dns.lookup(url.hostname, {all:true,family:4}),
    new Promise((_,reject) => {dnsTimer=setTimeout(()=>reject(networkError('图片下载解析地址超时')),Math.max(1,deadline-Date.now()));})
  ]).finally(()=>clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('不允许访问内网图片地址');
  const record = addresses[0];
  return new Promise((resolve, reject) => {
    let settled=false,timer;
    const finish=(error,bytes)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(bytes);};
    // CONNECT uses the validated IP as well; a proxy must not re-resolve an unchecked target.
    // SNI and Host retain the original hostname for certificate verification and virtual hosting.
    const request = https.get({hostname:record.address,port:443,path:url.pathname+url.search,servername:url.hostname,headers:{Host:url.host},agent}, response => {
      response.on('error',finish);
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 3) return finish(new Error('图片重定向过多'));
        if (!response.headers.location) return finish(new Error('图片重定向缺少地址'));
        let redirected;
        try {redirected=new URL(response.headers.location,url).href;} catch(error){return finish(error);}
        clearTimeout(timer);
        downloadOnce(redirected,{agent,deadline,idleTimeoutMs},redirects+1).then(bytes=>finish(null,bytes),finish);
        return;
      }
      if (response.statusCode !== 200) {response.resume(); return finish(Object.assign(new Error(`图片下载 HTTP ${response.statusCode}`),{status:response.statusCode}));}
      const declared=Number(response.headers['content-length']);
      if(declared>25*1024*1024){response.destroy();return finish(new Error('图片超过 25 MB'));}
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) {finish(new Error('图片超过 25 MB'));response.destroy();}
        else chunks.push(chunk);
      });
      response.on('end', () => declared && declared!==size ? finish(networkError('图片下载不完整','ECONNRESET')) : finish(null,Buffer.concat(chunks)));
      response.on('aborted',()=>finish(networkError('图片下载中断','ECONNRESET')));
    });
    timer=setTimeout(()=>{const error=networkError('图片下载超时');finish(error);request.destroy(error);},Math.max(1,deadline-Date.now()));
    request.setTimeout(idleTimeoutMs, () => request.destroy(networkError('图片下载超时')));
    request.on('error', finish);
  });
}

export async function downloadImage(address, {proxyUrl='',attempts=1,timeoutMs=90000,idleTimeoutMs=60000,retryDelayMs=1000,onAttempt} = {}) {
  const agent=imageProxyAgent(proxyUrl);
  try {
    for(let attempt=1;attempt<=attempts;attempt++) {
      await onAttempt?.(attempt);
      try {return await downloadOnce(address,{agent,deadline:Date.now()+timeoutMs,idleTimeoutMs});}
      catch(error) {
        if(attempt===attempts || !retryable(error))throw error;
        await new Promise(resolve=>setTimeout(resolve,retryDelayMs*attempt));
      }
    }
    throw new Error('图片下载尝试次数无效');
  } finally {agent?.destroy();}
}

export function createImageDownloader(configuration) {
  const proxyUrl=configuration.IMAGE_DOWNLOAD_PROXY || '';
  // Validate configuration before submitting any paid generation request.
  imageProxyAgent(proxyUrl)?.destroy();
  return (address,options={})=>downloadImage(address,{proxyUrl,attempts:3,...options});
}

export async function resolveImage(source, mediaDirectory) {
  if (typeof source !== 'string') throw new Error('图片地址无效');
  if (source.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(source);
    if (!match) throw new Error('不支持的图片数据');
    const bytes = Buffer.from(match[1], 'base64'); imageType(bytes); return bytes;
  }
  const url = new URL(source, 'http://127.0.0.1');
  if (['127.0.0.1','localhost'].includes(url.hostname) && /^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(url.pathname)) {
    return fs.readFile(path.join(mediaDirectory, path.basename(url.pathname)));
  }
  const bytes = await downloadImage(source); imageType(bytes); return bytes;
}

export function createImageProvider(configuration, mediaDirectory, {download=createImageDownloader(configuration)} = {}) {
  return async ({prompt, references = [], ratio = '1:1', model:requestedModel, onProgress}) => {
    const key = configuration.SUANZHOU_IMAGE_API_KEY;
    if (!key) throw new Error('未配置专用图片密钥；没有提交生图请求。');
    const base = (configuration.SUANZHOU_IMAGE_BASE_URL || 'https://api.suanzhou.vip/v1').replace(/\/$/, '');
    const model = resolveImageModel(requestedModel,configuration);
    const preferInline = configuration.SUANZHOU_IMAGE_RESPONSE_FORMAT === 'b64_json';
    const size = ratio === '1:1' ? '1024x1024' : ['3:4','2:3','9:16'].includes(ratio) ? '1024x1536' : '1536x1024';
    const completePrompt = `${prompt}\n输出画幅目标：${ratio}。保持提供的产品外形、颜色、结构、品牌标识一致；不得凭空增加产品信息。`;
    const headers = {Authorization: `Bearer ${key}`};
    let body, endpoint;
    if (references.length) {
      const form = new FormData();
      form.set('model', model); form.set('prompt', completePrompt); form.set('size', size); form.set('quality', 'auto');
      if (preferInline) form.set('response_format', 'b64_json');
      for (let i = 0; i < Math.min(references.length, 8); i++) {
        const bytes = await resolveImage(references[i], mediaDirectory);
        const [mime, extension] = imageType(bytes);
        form.append('image[]', new Blob([bytes], {type: mime}), `reference-${i}${extension}`);
      }
      body = form; endpoint = '/images/edits';
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({model, prompt: completePrompt, size, quality: 'auto', ...(preferInline ? {response_format: 'b64_json'} : {})}); endpoint = '/images/generations';
    }
    await onProgress?.({phase:'generating',model});
    // Never automatically repeat generation: a timeout may still have incurred charges.
    const response = await fetch(base + endpoint, {method: 'POST', headers, body, signal: AbortSignal.timeout(480000)});
    await onProgress?.({providerHttpStatus:response.status,providerRequestId:response.headers.get('x-request-id') || null});
    if (!response.ok) throw new Error(`${model} 图片接口 HTTP ${response.status}。请检查专用图片密钥、余额及模型权限；没有自动更换模型。`);
    const json = await response.json();
    const providerModel = typeof json.model === 'string' ? json.model : null;
    await onProgress?.({providerModel});
    if (providerModel && providerModel !== model && !new RegExp('^'+model.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-\\d{4}-\\d{2}-\\d{2}$').test(providerModel)) throw new Error('图片接口返回的模型与所选模型不一致，已停止接收结果；没有自动更换模型。');
    const item = json.data?.[0];
    if (!item) throw new Error('图片接口未返回图片；没有使用占位图替代');
    let bytes;
    if(item.b64_json)bytes=Buffer.from(item.b64_json,'base64');
    else {
      if(typeof item.url!=='string' || !item.url)throw new Error('图片接口未返回有效图片地址');
      await onProgress?.({phase:'downloading',resultUrl:item.url,generationCompletedAt:new Date().toISOString()});
      bytes=await download(item.url,{onAttempt:attempt=>onProgress?.({phase:'downloading',downloadAttempt:attempt})});
    }
    imageType(bytes);
    return bytes;
  };
}
