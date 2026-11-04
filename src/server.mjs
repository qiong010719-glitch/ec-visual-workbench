import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
import {planProduct, buildPlan, slotPlan, promptForSlot} from './planner.mjs';
import {createImageProvider, createImageDownloader, imageType, resolveImage} from './provider.mjs';
import {ResearchService} from './research.mjs';
import {designPatterns} from './design-patterns.mjs';
import {generationMode} from './visual-style.mjs';
import {SCENE_STYLE_VERSION} from './rich-storytelling.mjs';
import {imageModels,resolveImageModel} from './image-models.mjs';
import {isTemu,temuFormats,validateTemu,temuPlanSignature,prepareTemuImage,verifyTemuImages} from './temu.mjs';
import {createMultiSetService,MAX_SETS} from './multisets.mjs';
import {stylesForPlatform} from './creative-direction.mjs';
import {TEMU_MAX_SETS} from './temu.mjs';
import {exportTemuSets} from './temu-export.mjs';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mimes = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
const uuid = () => crypto.randomUUID();
const fail = (status, message) => Object.assign(new Error(message), {status});

export function createWorkbench({dataDirectory = path.join(root, 'data'), configuration = process.env, provider, download, planner, directionPlanner, researchOptions = {}} = {}) {
  const store = new Store(dataDirectory);
  const mediaDirectory = path.join(dataDirectory, 'media');
  fs.mkdirSync(mediaDirectory, {recursive: true});
  const imageDownloader = download || createImageDownloader(configuration);
  const imageProvider = provider || createImageProvider(configuration, mediaDirectory, {download:imageDownloader});
  const research = new ResearchService({directory:path.join(dataDirectory,'research'),mediaDirectory,configuration:{...configuration,APIFY_TOKEN_FILE:configuration.APIFY_TOKEN_FILE || path.join(root,'.env.apify')},...researchOptions});
  const designPlanner = planner || (p => planProduct(p, configuration, research.library.retrieve(p)));
  const queue = []; let active = 0;
  const concurrency = Math.min(4, Math.max(1, Number(configuration.IMAGE_CONCURRENCY) || 2));
  const csrf = crypto.randomBytes(24).toString('hex');
  const saveImage = bytes => {
    const [, extension] = imageType(bytes);
    const name = uuid() + extension;
    fs.writeFileSync(path.join(mediaDirectory, name), bytes);
    return '/media/' + name;
  };
  const saveResult = async (bytes, task) => {
    if (!isTemu(task)) return {imageUrl:saveImage(bytes)};
    const prepared=await prepareTemuImage(bytes,task.image_ratio);
    return {imageUrl:saveImage(prepared.bytes),dimensions:prepared.dimensions,sourceDimensions:prepared.sourceDimensions,fitted:prepared.fitted};
  };
  const runNext = () => {
    while (queue.length && active < concurrency) {
      const work = queue.shift(); active++;
      Promise.resolve().then(work).catch(() => {}).finally(() => {active--; runNext();});
    }
  };
  const enqueue = work => {queue.push(work); runNext();};
  const publicTask = task => {
    if(!task)return null;
    const {resultUrl,partialPlanText,...visible}=task;
    return {...visible,...(visible.error?{error:String(visible.error).replace(/算舟|suanzhou/gi,'图片服务')} : {}),
      ...(visible.provider==='suanzhou'?{provider:'configured-image-api'}:{}),canRetryDownload:!!resultUrl && task.status==='failed'};
  };
  function retryDownload(taskId) {
    const key='hyrule_tasks/'+taskId,task=store.state.tasks[key];
    if(!task)throw fail(404,'图片任务不存在');
    if(task.status==='completed')return {task:publicTask(task),accepted:false};
    if(!task.resultUrl)throw fail(409,'该任务没有保存生成结果地址，无法只重试下载');
    if(['pending','running'].includes(task.status))return {task:publicTask(task),accepted:true};
    store.task(key,{status:'pending',phase:'download_queued',error:null,downloadRecoveryRequestedAt:new Date().toISOString(),downloadAttempt:0});
    enqueue(async()=>{
      store.task(key,{status:'running',phase:'downloading'});
      try {
        const bytes=await imageDownloader(task.resultUrl,{onAttempt:attempt=>store.task(key,{downloadAttempt:attempt})});
        store.task(key,{status:'completed',phase:'completed',...await saveResult(bytes,task),error:null,downloadRecoveredAt:new Date().toISOString()});
      } catch(error) {store.task(key,{status:'failed',phase:'download_failed',error:String(error.message).slice(0,500)});}
    });
    return {task:publicTask(store.state.tasks[key]),accepted:true};
  }
  const createCharge = (id, taskIds, unit) => {
    if (store.state.charges.some(c => c.request_id === id)) return;
    const amount = taskIds.length * unit;
    store.state.balance -= amount;
    store.state.charges.push({request_id:id, task_ids:taskIds, amount, unit, refunded:[], created_at:new Date().toISOString(), simulated:true});
    store.save();
  };
  const refund = (requestId, taskId) => {
    const charge = store.state.charges.find(c => c.request_id === requestId);
    const task = store.state.tasks['hyrule_tasks/' + taskId] || store.state.tasks['agent_tasks/' + taskId];
    if (!charge || !charge.task_ids.includes(taskId) || charge.refunded.includes(taskId) || task?.status !== 'failed') return 0;
    charge.refunded.push(taskId); store.state.balance += charge.unit; store.save(); return charge.unit;
  };
  for (const c of store.state.charges) for (const t of c.task_ids) refund(c.request_id, t);

  const json = (response, status, value, headers = {}) => {
    response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
    response.end(JSON.stringify(value));
  };
  async function body(request, limit = 35 * 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of request) {size += chunk.length; if (size > limit) throw fail(413, '请求超过大小限制'); chunks.push(chunk);}
    const bytes = Buffer.concat(chunks);
    if (request.headers['content-type']?.includes('application/json')) {
      try {return JSON.parse(bytes.toString('utf8') || '{}');} catch {throw fail(400, 'JSON 格式错误');}
    }
    return bytes;
  }
  function references(payload) {
    return [...new Set([
      payload.annotated_image_url, payload.base_image_b64, payload.source_image_url, payload.image_url,
      ...(payload.material_image_urls || []), ...(payload.material_images_b64 || []),
      ...(payload.images || []), ...(payload.categorized_images || []).map(x => x.url),
      ...(payload.local_images_base64 || [])
    ].filter(v => typeof v === 'string' && v))].slice(0,8);
  }
  function submitImages(payload, kind) {
    const tasks = payload.mobile_reformat
      ? (Array.isArray(payload.tasks) ? payload.tasks.map((task,index) => ({...task,slot:index,aspect_ratio:'4:3'})) : [])
      : kind === 'inpaint' ? [{taskId:payload.task_id,slot:payload.slot_idx ?? 0,aspect_ratio:payload.aspect_ratio || '1:1'}] : payload.firebase_tasks;
    const maximumTasks = payload.mobile_reformat ? 20 : 14;
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > maximumTasks || tasks.some(t => !validId(t.taskId) || !Number.isInteger(t.slot) || t.slot < -1 || t.slot >= maximumTasks) || new Set(tasks.map(t => t.taskId)).size !== tasks.length) throw fail(400, '无效的图片任务列表');
    if (!payload.prompt && !payload.sop_text && !payload.product_name && !payload.mobile_reformat) throw fail(400, '请填写生成要求');
    if (!provider && !configuration.SUANZHOU_IMAGE_API_KEY) throw fail(503, '缺少专用图片密钥；请求未提交，也未扣点');
    const known = tasks.map(t => store.state.tasks['hyrule_tasks/' + t.taskId]);
    if (known.every(Boolean)) return known[0].requestId;
    if (known.some(Boolean)) throw fail(409, '任务编号部分重复，请核对任务状态');
    // Capture the choice before enqueueing; later UI changes cannot change this batch.
    const model = resolveImageModel(payload.model,configuration);
    const requestId = uuid();
    const agent = store.state.tasks['agent_tasks/' + payload.agent_task_id];
    const merged = {...agent?.payload,...payload};
    if (isTemu(merged)) {
      validateTemu(merged,{editing:kind==='inpaint'});
      if(kind==='ultra')throw fail(400,'Temu 当前只支持逐张主图生成');
      if(kind==='generate') {
        if(!agent?.plan || agent.status!=='completed' || !isTemu(agent.payload))throw fail(409,'请先完成 Temu 构思再生成图片');
        if(temuPlanSignature(merged)!==temuPlanSignature(agent.payload))throw fail(409,'商品资料、比例或张数已改变，请重新构思');
        if(tasks.some(t=>t.slot<0 || t.slot>=merged.image_count) || new Set(tasks.map(t=>t.slot)).size!==tasks.length)throw fail(400,'Temu 图片槽位无效或重复');
      }
      if(tasks.some(t=>t.aspect_ratio && t.aspect_ratio!==merged.image_ratio))throw fail(400,'所有 Temu 图片必须使用本套选定的比例');
    }
    if(['generate','ultra'].includes(kind)&&!payload.mobile_reformat&&agent?.plan?.visualStyle?.id==='scene_advertising'&&agent.plan.visualStyle.version!==SCENE_STYLE_VERSION)throw fail(409,'场景广告风格已更新，请重新构思后再生成图片；原方案和已生成图片已保留。');
    if(kind==='generate'&&!payload.mobile_reformat&&agent?.plan?.visualStyle &&
      ((payload.generation_mode&&generationMode(payload)!==agent.plan.generationMode)||(payload.visual_style&&payload.visual_style!==agent.plan.visualStyle.id)))throw fail(409,'设计模式或风格已经改变，请重新构思后再生成图片。');
    const design = agent?.plan || (isTemu(merged) && kind==='inpaint'?{sections:[],text:payload.prompt,references:[]}:buildPlan(merged,research.library.retrieve(merged)));
    const plan = design.sections || slotPlan(merged);
    const prepared = tasks.map(task=>{
      const section=plan.find(s=>s.slot===task.slot);
      const directive=Array.isArray(payload.slot_directives)?payload.slot_directives.find(d=>Number(d.slot ?? d.index)===task.slot):null;
      const ordinary=kind==='generate' && !payload.mobile_reformat;
      if(ordinary&&!section)throw fail(400,'找不到图片槽位的独立设计要求');
      const prompt=[payload.mobile_reformat?`将这张 A+ 图片重新排版为适合手机阅读的 4:3 单张图。保留产品和所有已提供的文案，文字清晰，版面简洁，不添加新卖点。标题：${task.title || ''}`:
        ordinary?promptForSlot(payload,section,design):kind==='ultra'?[payload.prompt || payload.sop_text,design.styleGuide,section?.detail || design.text].filter(Boolean).join('\n\n'):payload.prompt || payload.sop_text || design.text,
        ordinary?'':payload.strict_requirements || '',directive?JSON.stringify(directive):''].filter(Boolean).join('\n');
      const names=directive?.ref_images?.length?directive.ref_images:ordinary?section?.ref_images:[];
      const selected=names?.length?(merged.categorized_images || []).filter(m=>names.includes(m.filename)).map(m=>m.url):references(merged);
      if(directive?.ref_images?.length && selected.length!==new Set(directive.ref_images).size)throw fail(400,'逐张要求引用了不存在的产品参考图');
      const refs=payload.mobile_reformat?[task.source_image_url]:selected.length?selected:references(merged);
      if(refs.some(r=>typeof r!=='string' || !r.trim()))throw fail(400,'图片参考地址无效，未提交生成任务');
      return {task,section,prompt,refs};
    });
    createCharge(requestId, tasks.map(t => t.taskId), payload.mobile_reformat ? 1 : 2);
    for (const {task,section,prompt,refs} of prepared) {
      const key = 'hyrule_tasks/' + task.taskId;
      store.task(key, {status:'pending', phase:'queued', taskId:task.taskId, slot:task.slot, requestId, model, prompt,...(isTemu(merged)?{platform:'temu',image_ratio:merged.image_ratio}:{}),referenceImages:refs.filter(r=>!r.startsWith('data:')),designReferences:design.references || [],visualStyle:design.visualStyle || null,generationMode:design.generationMode || null,...(payload.group_id?{groupId:payload.group_id,setId:payload.set_id,creativeDirection:design.creativeDirection}:{}),promptVersion:design.visualStyle?.id==='scene_advertising'&&design.visualStyle.version===SCENE_STYLE_VERSION?'per-slot-v5':design.visualStyle?'per-slot-v3':'per-slot-v2',createdAt:new Date().toISOString()});
      enqueue(async () => {
        store.task(key, {status:'running',phase:'generating'});
        try {
          const bytes = await imageProvider({prompt, references:refs, ratio:isTemu(merged)?merged.image_ratio:task.aspect_ratio || section?.ratio || '1:1', ...(isTemu(merged)?{platform:'temu'}:{}), model, kind,onProgress:patch=>store.task(key,patch)});
          store.task(key, {status:'completed',phase:'completed', ...await saveResult(bytes,store.state.tasks[key]), provider:provider ? 'test-provider' : 'suanzhou', model});
        } catch (error) {
          store.task(key, {status:'failed',phase:store.state.tasks[key].resultUrl?'download_failed':'generation_failed', error: String(error.message).slice(0,500)});
          refund(requestId, task.taskId);
        }
      });
    }
    store.state.batches[requestId] = {requestId, tasks:tasks.map(t => t.taskId), kind, model, createdAt:new Date().toISOString()}; store.save();
    return requestId;
  }

  function submitPlan(payload){
    validateTemu(payload);
    if(!validId(payload.agent_task_id)||!payload.product_name||!payload.product_desc)throw fail(400,'需要产品名称、卖点和有效任务编号');
    const key='agent_tasks/'+payload.agent_task_id;
    if(store.state.tasks[key])return store.state.tasks[key].requestId;
    const requestId=uuid();
    store.task(key,{status:'pending',payload,requestId,createdAt:new Date().toISOString()});
    createCharge(requestId,[payload.agent_task_id],0);
    enqueue(async()=>{
      store.task(key,{status:'running'});
      try{const plan=await designPlanner(payload);store.task(key,{status:'completed',result:plan.text,plan});}
      catch(error){
        store.task(key,{status:'failed',error:String(error.message).slice(0,500),
          ...(error.planningDiagnostics?{errorCode:error.code,planningDiagnostics:error.planningDiagnostics}:{}),
          ...(typeof error.partialPlanText==='string'?{partialPlanText:error.partialPlanText.slice(0,200000)}:{})});
        refund(requestId,payload.agent_task_id);
      }
    });
    return requestId;
  }
  const multisets=createMultiSetService({store,configuration,mediaDirectory,enqueue,submitPlan,submitImages,publicTask,retryDownload,directionPlanner});

  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw fail(403, '本服务只允许本机访问');
      const url = new URL(request.url, `http://${host}`);
      if (request.headers.origin && request.headers.origin !== url.origin) throw fail(403, '不允许跨站请求');
      const pathname = decodeURIComponent(url.pathname);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'same-origin');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
      if (pathname === '/api/session' && request.method === 'GET') return json(response,200,{token:csrf,user:{id:'local-owner',email:'local@workbench.local'}});
      if (pathname === '/api/temu/config' && request.method === 'GET') return json(response,200,{platform:'temu',formats:temuFormats,maxImages:7,maxSets:TEMU_MAX_SETS,detailImages:'same-as-main-images-in-order',fissionEnabled:true,publishEnabled:false});
      if (pathname.startsWith('/api/') && !['GET','HEAD'].includes(request.method) && request.headers['x-workbench-token'] !== csrf) throw fail(403, '本地会话已过期，请刷新页面');
      if(['/api/multisets/config','/api/temu/multisets/config'].includes(pathname)&&request.method==='GET'){
        const platform=pathname.includes('/temu/')?'temu':'amazon';
        return json(response,200,{maxSets:platform==='temu'?TEMU_MAX_SETS:MAX_SETS,styles:stylesForPlatform(platform).map(({id,label})=>({id,label})),aiRecommendations:!!(configuration.PLANNER_BASE_URL&&configuration.PLANNER_API_KEY&&configuration.PLANNER_MODEL)});
      }
      const multiRoute=/^\/api\/(temu\/)?multisets(?:\/([a-zA-Z0-9_-]+))?(?:\/(directions|recommend|plan|generate|retry|plan-text|export))?$/.exec(pathname);
      if(multiRoute){
        const [,temuPrefix,groupId,action]=multiRoute,platform=temuPrefix?'temu':'amazon';
        if(groupId&&isTemu(multisets.get(groupId).source)!==!!temuPrefix)throw fail(404,'裂变批次不存在');
        if(request.method==='GET'&&!action)return json(response,200,groupId?multisets.get(groupId):multisets.list(platform));
        if(request.method!=='POST')throw fail(405,'不支持该方法');
        const payload=await body(request,2*1024*1024);
        if(!groupId){
          if(isTemu(payload.source)!==!!temuPrefix)throw fail(400,'请使用对应平台的裂变入口');
          return json(response,202,multisets.create(payload));
        }
        if(action==='export'&&temuPrefix)return json(response,200,await exportTemuSets({group:multisets.get(groupId),setId:payload.setId,mediaDirectory,store,current:()=>multisets.get(groupId)}));
        const operations={directions:'update',recommend:'recommend',plan:'plan',generate:'generate',retry:'retry','plan-text':'editPlan'};
        if(!operations[action])throw fail(404,'接口不存在');
        return json(response,['directions','plan-text'].includes(action)?200:202,multisets[operations[action]](groupId,payload));
      }
      if (pathname === '/api/status') return json(response,200,{mode:'local', isolatedPreview:configuration.WORKBENCH_STYLE_PREVIEW==='true', imageProvider:provider ? 'test-fixture' : 'configured-image-api', imageConfigured:!!provider || !!configuration.SUANZHOU_IMAGE_API_KEY, model:resolveImageModel(undefined,configuration), imageModels, planner:configuration.PLANNER_API_KEY ? 'configured' : 'local-rules', active, queued:queue.length,downloadProxyConfigured:!!configuration.IMAGE_DOWNLOAD_PROXY,downloadRecoveryEnabled:true,recoverableDownloads:Object.values(store.state.tasks).filter(t=>t.resultUrl&&t.status==='failed').length, defaultProductStatus:'draft', paymentEnabled:false, publishEnabled:false});
      if (pathname === '/api/research/status' && request.method === 'GET') return json(response,200,research.status());
      if (pathname === '/api/research/design-patterns' && request.method === 'GET') return json(response,200,designPatterns(research.library.state));
      if (pathname === '/api/research/products' && request.method === 'GET') return json(response,200,Object.values(research.library.state.products).map(p=>({id:p.id,title:p.title,brand:p.brand,asin:p.asin,url:p.url,category:p.category,categoryMemberships:p.categoryMemberships||[],styleProfileIds:p.styleProfileIds||[],collectionIds:p.collectionIds||[],rank:p.rank,rankBasis:p.rankBasis,provenance:p.provenance,aplusStatus:p.aplusStatus,images:p.assets.length,downloaded:p.assets.filter(a=>a.status==='downloaded').length,analysisStatus:p.analysis?.status || 'pending',analysisError:p.analysis?.error || null,thumbnail:p.assets.find(a=>a.localUrl)?.localUrl || null,warnings:p.warnings})));
      if (pathname === '/api/research/jobs' && request.method === 'GET') return json(response,200,Object.values(research.library.state.campaigns).reverse());
      if (pathname.startsWith('/api/research/products/') && request.method === 'GET') {
        const product=research.library.state.products[pathname.slice('/api/research/products/'.length)];
        if(!product)throw fail(404,'参考资料不存在');
        return json(response,200,product);
      }
      if (pathname === '/api/research/export' && request.method === 'GET') return json(response,200,research.library.state,{'Content-Disposition':'attachment; filename="reference-library.json"'});
      if (pathname === '/api/research/import' && request.method === 'POST') {
        const payload=await body(request);return json(response,200,research.library.importRows(payload.products,{source:'user_dataset',category:payload.category || ''}));
      }
      if (pathname === '/api/research/import-folder' && request.method === 'POST') {
        const payload=await body(request,8192);return json(response,200,research.library.importFolder(payload));
      }
      if (pathname === '/api/research/jobs' && request.method === 'POST') {
        const payload=await body(request,100000);return json(response,202,research.create(payload.kind,payload));
      }
      if (pathname === '/api/research/resume' && request.method === 'POST') {
        const payload=await body(request,4096);return json(response,202,research.resume(payload.id));
      }
      if (pathname === '/api/orders' && request.method === 'GET') return json(response,200,{email:'local@workbench.local', balance:store.state.balance, orders:[], pending:[], paid:[], records:[], charges:store.state.charges, simulated:true});
      if (pathname === '/api/alipay/create') return json(response,501,{error:'本地复刻版没有连接支付宝；此处不收款。'});
      if (pathname === '/api/media/up' && request.method === 'POST') {
        const bytes = await body(request,25*1024*1024);
        if (!Buffer.isBuffer(bytes)) throw fail(400,'需要图片二进制');
        return json(response,200,{ok:true,url:saveImage(bytes)});
      }
      if (pathname === '/api/media/import' && request.method === 'POST') {
        const payload = await body(request,4096);
        const bytes = await resolveImage(payload.url,mediaDirectory);
        return json(response,200,{ok:true,url:saveImage(bytes)});
      }
      if (['/api/imgproxy','/api/media/img'].includes(pathname)) {
        const bytes = await resolveImage(url.searchParams.get('url'),mediaDirectory);
        response.writeHead(200, {'Content-Type':imageType(bytes)[0]}); response.end(bytes); return;
      }
      if (pathname.startsWith('/api/tasks/') && request.method === 'GET') {
        const key = pathname.slice('/api/tasks/'.length);
        if (!/^(agent_tasks|hyrule_tasks)\/[a-zA-Z0-9_-]{1,120}$/.test(key)) throw fail(400,'任务编号无效');
        return json(response,200,publicTask(store.state.tasks[key]));
      }
      if(pathname==='/api/downloads' && request.method==='GET')return json(response,200,Object.values(store.state.tasks).filter(t=>t.resultUrl&&(t.status==='failed'||t.downloadRecoveryRequestedAt)).reverse().map(publicTask));
      if(pathname==='/api/downloads/retry' && request.method==='POST'){
        const payload=await body(request,4096);
        if(!validId(payload.taskId))throw fail(400,'任务编号无效');
        const result=retryDownload(payload.taskId);
        return json(response,result.accepted?202:200,result.task);
      }
      if (pathname === '/api/agent' && request.method === 'POST') {
        const payload=await body(request);
        const known=store.state.tasks['agent_tasks/'+payload.agent_task_id];
        const requestId=submitPlan(payload);
        return json(response,known?200:202,{ok:true,task_id:payload.agent_task_id},{'X-Request-Id':requestId});
      }
      if (['/api/generate','/api/ultra_generate','/api/inpaint'].includes(pathname) && request.method === 'POST') {
        const payload = await body(request);
        const kind = pathname.endsWith('inpaint') ? 'inpaint' : pathname.includes('ultra') ? 'ultra' : 'generate';
        const requestId = submitImages(payload,kind);
        return json(response,202,{ok:true,request_id:requestId},{'X-Request-Id':requestId});
      }
      if (pathname === '/api/refund' && request.method === 'POST') {
        const payload = await body(request); return json(response,200,{refunded:refund(payload.request_id,payload.refund_key),simulated:true});
      }
      if (pathname === '/api/feedback' && request.method === 'POST') {
        const payload = await body(request,2*1024*1024);
        if (!['rating','downvote','archive','report'].includes(payload.action)) throw fail(400,'反馈类型无效');
        store.state.feedback.push({...payload,id:uuid(),createdAt:new Date().toISOString(),destination:'local-only'}); store.save();
        return json(response,200,{ok:true,savedLocally:true});
      }
      if (pathname === '/api/drafts' && request.method === 'GET') return json(response,200,store.state.drafts.filter(d=>url.searchParams.get('platform')==='temu'?isTemu(d):!isTemu(d)));
      if (pathname === '/api/drafts' && request.method === 'POST') {
        const payload = await body(request);
        if (!payload.title?.trim()) throw fail(400,'请填写商品标题');
        if (payload.status && payload.status !== 'draft') throw fail(400,'仅允许保存草稿');
        if (!Array.isArray(payload.skus) || payload.skus.some(s => !s.code || !s.name || !Number.isFinite(s.price) || s.price < 0 || !Number.isInteger(s.stock) || s.stock < 0)) throw fail(400,'SKU 编码、名称、价格或库存无效');
        if (new Set(payload.skus.map(s => s.code)).size !== payload.skus.length) throw fail(400,'SKU 编码不能重复');
        const media = (payload.images || []).filter(x => typeof x === 'string');
        if (media.some(x => !/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(x) || !fs.existsSync(path.join(mediaDirectory,path.basename(x))))) throw fail(400,'草稿引用了不存在的本地图片');
        const existing = payload.id ? store.state.drafts.find(d => d.id === payload.id) : null;
        if (payload.id && !existing) throw fail(404,'草稿不存在');
        if(existing && isTemu(existing)!==isTemu(payload))throw fail(400,'不能跨平台覆盖商品草稿');
        if(isTemu(payload))await verifyTemuImages(media.map(x=>path.join(mediaDirectory,path.basename(x))),payload.image_ratio);
        const draft = {id:existing?.id || uuid(),title:payload.title.trim(),description:payload.description || '',platform:payload.platform || '通用',skus:payload.skus,images:media,sop:payload.sop || '',status:'draft',published:false,createdAt:existing?.createdAt || new Date().toISOString(),updatedAt:new Date().toISOString()};
        if(isTemu(payload))Object.assign(draft,{imageRatio:payload.image_ratio,mainImages:[...media],detailImages:[...media],skuPreviewPolicy:'preserve-source',imageRules:{detailImages:'same-as-main-images-in-order',skuPreview:'preserve-source'}});
        if (existing) Object.assign(existing,draft); else store.state.drafts.unshift(draft);
        store.save(); return json(response,200,draft);
      }
      if (pathname.startsWith('/api/')) throw fail(404,'接口不存在');
      if (!['GET','HEAD'].includes(request.method)) throw fail(405,'不支持该方法');
      const base = pathname.startsWith('/media/') ? mediaDirectory : path.join(root,'public');
      const relative = pathname.startsWith('/media/') ? pathname.slice(7) : pathname === '/' ? 'index.html' : ['/temu','/temu/'].includes(pathname)?'temu.html':pathname.slice(1);
      const file = path.resolve(base,relative);
      if (!file.startsWith(path.resolve(base) + path.sep)) throw fail(403,'路径不可访问');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw fail(404,'文件不存在');
      response.writeHead(200, {'Content-Type':mimes[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
      if (request.method === 'HEAD') response.end(); else fs.createReadStream(file).pipe(response);
    } catch(error) {json(response,error.status || 400,{error:error.message || '请求失败'});}
  });
  server.on('close',()=>research.close());
  return {server,store,mediaDirectory,saveImage,research};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {process.loadEnvFile(path.join(root,'.env'));} catch(error) {if(error.code !== 'ENOENT') throw error;}
  const app = createWorkbench();
  const port = Number(process.env.PORT || 4173);
  app.server.listen(port,'127.0.0.1',() => console.log(`电商视觉工作台：http://127.0.0.1:${port}（本地草稿模式）`));
}
