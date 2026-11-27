import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createDxmTemplateBrowser} from '../src/dxm-template-browser.mjs';
import {temuGoodsId} from '../src/geekbi.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clone=value=>structuredClone(value);
const idOK=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const siteKey=value=>String(value||'').trim().replace(/站$/,'');
const secretName=/api.?key|secret|password|authorization|cookie|csrf|credential|access.?token|refresh.?token/i;
const diagnosticNames=['pagerDiagnostics','editDiagnostics'];
export const help=`单商品、单店铺只读诊断（不更新任务、不保存或发布ERP商品）

用法：
  node tools/diagnose-listing-row.mjs --base-url http://127.0.0.1:4196 --job-id <任务ID> --goods-id <Temu商品ID> --store-key <storeBindingKey>

--base-url   本机工作台HTTP地址；默认采用.env的PORT或4196。
--job-id     已存在的任务ID，必须精确指定。
--goods-id   该任务中的一个商品ID，必须精确指定。
--store-key  该任务固定模板中的一个店铺绑定key，必须精确指定。
--help       显示帮助，不联网、不连接浏览器。

先检查/api/status的busy=false及当前账号/浏览器绑定，再使用一个独立临时标签页。
只调用inspect；标签页读取结束后由适配器关闭，不复用任务或用户标签页。
stdout输出JSON诊断摘要，不输出完整job、binding或商品快照。退出码0表示身份已核实且快照已读取，1表示未完成读取或命令失败；资料缺项仍单独列出。
`;

function localBase(value){
  let url;try{url=new URL(value);}catch{throw new Error('工作台地址无效');}
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('工作台地址必须是无路径、无凭据的本机HTTP地址');
  return url.origin;
}
export function parseArguments(argv,configuration={}){
  const options={},names=new Map([['--base-url','baseUrl'],['--job-id','jobId'],['--goods-id','goodsId'],['--store-key','storeKey']]);
  if(argv.length===1&&argv[0]==='--help')return {help:true};
  for(let i=0;i<argv.length;i++){
    const key=names.get(argv[i]);if(!key||Object.hasOwn(options,key)||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('参数无效或重复；使用--help查看用法');
    options[key]=argv[++i];
  }
  if(!idOK(options.jobId)||!idOK(options.storeKey)||!/^\d{6,32}$/.test(options.goodsId||''))throw new Error('必须指定有效的--job-id、--goods-id和--store-key');
  options.baseUrl=localBase(options.baseUrl||`http://127.0.0.1:${configuration.PORT||4196}`);return options;
}
function redactText(value,configuration,account='',limit=600){
  let text=String(value??'');
  for(const [key,secret] of Object.entries(configuration))if(secretName.test(key)&&typeof secret==='string'&&secret.length>=6)text=text.replaceAll(secret,'[已隐藏]');
  if(account)text=text.replaceAll(account,'[账号已隐藏]');
  return text.replace(/https?:\/\/[^\s<>"']+/gi,'[链接已隐藏]').replace(/((?:账号|账户|account)\s*[:：=]\s*)[^\s，；。,;]+/gi,'$1[已隐藏]').slice(0,limit);
}
function safeDiagnostics(value,redact,depth=0){
  if(depth>5)return '[层级已截断]';
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value==='string')return redact(value,160);
  if(Array.isArray(value))return value.slice(0,10).map(item=>safeDiagnostics(item,redact,depth+1));
  if(!value||typeof value!=='object')return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!secretName.test(key)&&!/(?:account|binding|snapshot|sourceUrl|platformEditUrl|href|url|html|textContent|innerText|outerHTML)/i.test(key)&&!['__proto__','constructor','prototype'].includes(key)).slice(0,40).map(([key,item])=>[key,safeDiagnostics(item,redact,depth+1)]));
}
function appendDiagnostics(target,source,redact){
  for(const key of diagnosticNames)if(source?.[key]&&typeof source[key]==='object'){
    const diagnostic=safeDiagnostics(source[key],redact);target[key]=JSON.stringify(diagnostic).length<=16384?diagnostic:{captureError:'诊断超过大小限制'};
  }
}
function validDraft(value,id){
  try{const url=new URL(value);return url.origin==='https://www.dianxiaomi.com'&&url.pathname==='/web/popTemu/edit'&&!url.username&&!url.password&&!url.hash&&/^\d{6,32}$/.test(id||'')&&url.searchParams.get('id')===id;}catch{return false;}
}
function selectScope(job,options,settings){
  if(job?.id!==options.jobId||job.bindingIssue||job.action||job.status==='running'||job.progress?.active)throw new Error('任务身份、绑定或空闲状态未通过核对');
  const template=job.templateSnapshot,erp=job.binding?.erpConnection,browser=job.binding?.browserConfig;
  if(!template||template.id!==job.templateId||template.version!==job.templateVersion||template.platform!=='temu'||template.erpKey!==job.erpKey||erp?.key!==job.erpKey||(erp.provider||'dianxiaomi')!=='dianxiaomi'||!erp.expectedAccount||browser?.type!=='chrome'||erp.browserKey!==browser.key)throw new Error('任务的固定模板、账号或浏览器绑定不完整');
  const erps=(settings?.erpConnections||[]).filter(item=>item.key===erp.key),browsers=(settings?.browsers||[]).filter(item=>item.key===browser.key);
  if(erps.length!==1||browsers.length!==1||!isDeepStrictEqual(erps[0],erp)||!isDeepStrictEqual(browsers[0],browser))throw new Error('当前账号或浏览器绑定与任务快照不一致，未连接浏览器');
  if(!job.goodsIds?.includes(options.goodsId)||!job.storeKeys?.includes(options.storeKey))throw new Error('指定商品或店铺不属于该任务');
  const sources=(job.sourceRows||[]).filter(row=>row.goodsId===options.goodsId),stores=(template.storeBindings||[]).filter(store=>store.key===options.storeKey),targets=(job.rows||[]).filter(row=>row.goodsId===options.goodsId&&row.storeBindingKey===options.storeKey);
  if(sources.length!==1||stores.length!==1||targets.length!==1)throw new Error('指定商品和店铺必须各对应唯一任务记录');
  const source=sources[0],store=stores[0],row=targets[0];
  if(temuGoodsId(source.sourceUrl)!==options.goodsId||temuGoodsId(row.sourceUrl)!==options.goodsId||row.storeName!==store.storeName||!store.site||siteKey(row.site)!==siteKey(store.site)||row.platform!==template.platform)throw new Error('任务来源商品、店铺或站点记录不一致');
  const resolved=row.resolvedTarget;
  if(resolved&&!validDraft(resolved.platformEditUrl,resolved.draftId))throw new Error('任务的显式候选草稿绑定无效');
  return {source,store,row,template,erp,browser,resolved};
}

export async function diagnoseListingRow(options,{fetcher=globalThis.fetch,adapterFactory=createDxmTemplateBrowser,configuration={},onProgress}={}){
  if(!idOK(options?.jobId)||!idOK(options?.storeKey)||!/^\d{6,32}$/.test(options?.goodsId||''))throw new Error('诊断范围必须是一个有效任务、商品和店铺');
  const baseUrl=localBase(options.baseUrl||`http://127.0.0.1:${configuration.PORT||4173}`);
  const get=async route=>{
    let response;try{response=await fetcher(baseUrl+route,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new Error('无法读取本机工作台API，未继续诊断');}
    if(!response.ok)throw new Error(`本机工作台API返回HTTP ${response.status}，未继续诊断`);
    try{return await response.json();}catch{throw new Error('本机工作台API未返回有效JSON，未继续诊断');}
  };
  const idle=async()=>{const state=await get('/api/status');if(state?.busy!==false||state.mode!=='local')throw new Error('工作台未明确空闲，未继续连接或操作浏览器');};
  await idle();
  const job=await get('/api/listing-workflow/jobs/'+encodeURIComponent(options.jobId)),settings=await get('/api/settings'),scope=selectScope(job,options,settings);
  const redact=(value,limit)=>redactText(value,configuration,scope.erp.expectedAccount,limit);
  const report={readOnly:true,jobId:options.jobId,goodsId:options.goodsId,storeBindingKey:options.storeKey,templateId:job.templateId,templateVersion:job.templateVersion,checkedAt:new Date().toISOString()};
  await idle();
  try{
    const adapter=adapterFactory(configuration);
    if(typeof adapter?.inspect!=='function')throw new Error('只读核对适配器不可用');
    const result=await adapter.inspect({browserConfig:clone(scope.browser),erpConnection:clone(scope.erp),rows:[{goodsId:scope.source.goodsId,sourceUrl:scope.source.sourceUrl,collectionEditUrl:scope.source.collectionEditUrl}],templateSnapshot:{...clone(scope.template),storeBindings:[clone(scope.store)]},resolvedTargets:scope.resolved?[{goodsId:options.goodsId,storeBindingKey:options.storeKey,draftId:scope.resolved.draftId,platformEditUrl:scope.resolved.platformEditUrl}]:[],tabs:{},onProgress:async event=>{await idle();if(onProgress)await onProgress({phase:redact(event.phase,40),stage:redact(event.stage,80),message:redact(event.message,600)});}});
    if(!Array.isArray(result?.rows)||result.rows.length!==1)throw new Error('只读核对没有返回唯一目标记录');
    const row=result.rows[0];
    if(row.goodsId!==options.goodsId||row.storeBindingKey!==options.storeKey||row.storeName!==scope.store.storeName||siteKey(row.site)!==siteKey(scope.store.site)||temuGoodsId(row.sourceUrl)!==options.goodsId||row.draftId&&!validDraft(row.platformEditUrl,row.draftId)||scope.resolved&&row.draftId&&row.draftId!==scope.resolved.draftId)throw new Error('适配器返回了不属于该商品、店铺、站点或已选草稿的结果');
    report.status=redact(row.status,40);report.snapshotRead=!!row.snapshot&&typeof row.snapshot==='object'&&!Array.isArray(row.snapshot);report.ok=row.status==='located'&&report.snapshotRead;
    if(row.draftId)report.draftId=row.draftId;
    report.issueCount=Array.isArray(row.issues)?row.issues.length:0;report.issues=(row.issues||[]).filter(issue=>typeof issue==='string').slice(0,10).map(issue=>redact(issue,300));report.candidateCount=Array.isArray(row.candidates)?row.candidates.length:0;
    if(Number.isSafeInteger(result.scannedRecords))report.scannedRecords=result.scannedRecords;
    appendDiagnostics(report,row,redact);return report;
  }catch(error){
    report.ok=false;report.status='failed';report.error=redact(error.message,600);appendDiagnostics(report,error.data,redact);return report;
  }
}

export async function runCli(argv,{configuration={},fetcher,adapterFactory,onProgress,write=value=>process.stdout.write(value)}={}){
  try{
    const options=parseArguments(argv,configuration);if(options.help){write(help);return 0;}
    const report=await diagnoseListingRow(options,{configuration,fetcher,adapterFactory,onProgress});write(JSON.stringify(report,null,2)+'\n');return report.ok?0:1;
  }catch(error){write(JSON.stringify({ok:false,readOnly:true,status:'failed',error:redactText(error.message,configuration)},null,2)+'\n');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(!process.argv.includes('--help'))process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT'){process.stderr.write('无法加载本地环境配置\n');process.exitCode=1;}}
  if(!process.exitCode)process.exitCode=await runCli(process.argv.slice(2),{configuration:process.env});
}
