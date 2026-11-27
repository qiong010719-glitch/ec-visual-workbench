import crypto from 'node:crypto';
import {platforms,platformFor} from './platforms.mjs';
import {erpProviderFor} from './erp-providers.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const text=(value,max=30000)=>typeof value==='string'?value.trim().slice(0,max):'';
const own=(value,key)=>Object.hasOwn(value,key);
const platform=value=>value==='temu'?'temu':'amazon';
const contentUrl=(id,target='amazon')=>'/content?product='+encodeURIComponent(id)+'&platform='+target;
const badKeys=new Set(['__proto__','prototype','constructor','password','cookie','authorization','token','access_token','accesstoken','refresh_token','refreshtoken','api_key','apikey','api_token','apitoken','secret','secret_key','client_secret','clientsecret','private_key','credentials']);

// Persist only JSON application data. Provider/account credentials remain in settings.
function jsonData(value,maxBytes=2*1024*1024){
  function check(item,depth=0){
    if(depth>25)throw fail('保存内容层级过深');
    if(item===null||['string','boolean'].includes(typeof item))return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(Array.isArray(item)){for(const child of item)check(child,depth+1);return;}
    if(item&&typeof item==='object'&&Object.getPrototypeOf(item)===Object.prototype){
      for(const [key,child] of Object.entries(item)){if(badKeys.has(key.toLowerCase())||/_(?:api_key|app_secret|app_key|token)$/i.test(key))throw fail('不能在工作台资料中保存凭据或特殊对象字段');check(child,depth+1);}return;
    }
    throw fail('保存内容须为有效 JSON');
  }
  check(value);
  const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>maxBytes)throw fail('保存内容过大，请使用已上传图片的引用');
  return JSON.parse(encoded);
}
function mediaUrl(value){
  if(typeof value!=='string'||value.length>3000)return false;
  if(/^\/(?:media\/|api\/research\/assets\/|api\/temu\/erp\/images\/)[a-zA-Z0-9_./%?=&-]+$/.test(value)){
    try{return !decodeURIComponent(value).split(/[/?]/).includes('..')&&!value.includes('\\');}catch{return false;}
  }
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}
function imagesFor(input,{strict=true}={}){
  if(!Array.isArray(input)){if(strict)throw fail('图片列表格式无效');return [];}
  if(input.length>300)throw fail('单份图片列表最多保存 300 张');
  return input.flatMap(image=>{
    const item=typeof image==='string'?{url:image}:image;
    if(!item||!mediaUrl(item.url)){if(strict)throw fail('图片须引用已上传的本地图片或有效 HTTPS 地址');return [];}
    const result={url:item.url};
    for(const key of ['filename','category','kind','slot','ratio'])if(typeof item[key]==='string')result[key]=text(item[key],300);
    if(Number.isSafeInteger(item.slot))result.slot=String(item.slot);
    if(item.originalImageUrl){if(!mediaUrl(item.originalImageUrl))throw fail('原图地址无效');result.originalImageUrl=item.originalImageUrl;}
    for(const key of ['width','height'])if(Number.isFinite(item[key])&&item[key]>0)result[key]=item[key];
    return [result];
  });
}
function versionsFor(input){
  if(!Array.isArray(input)||input.length>200)throw fail('平台版本列表无效');
  return input.map(value=>{
    if(!value||typeof value!=='object')throw fail('平台版本格式无效');
    platformFor(value.platform);
    const source=value.source?jsonData(value.source,10000):undefined;
    const result={id:text(value.id||source?.id||'current',240),platform:value.platform,status:text(value.status||'draft',100),images:imagesFor(value.images||[])};
    if(source)result.source=source;
    if(typeof value.url==='string'&&/^\/(?!\/)/.test(value.url)&&!value.url.includes('\\'))result.url=value.url.slice(0,3000);
    if(value.createdAt)result.createdAt=text(value.createdAt,50);
    result.updatedAt=now();
    return result;
  });
}
function mergeVersions(previous=[],next=[]){
  const result=copy(previous);
  for(const version of next){const index=result.findIndex(v=>v.platform===version.platform&&v.id===version.id);if(index<0)result.push(copy(version));else result[index]=copy(version);}
  return result;
}

/** A shared index over the existing services, never a second execution engine.
 * Historical records are projected by stable reference; no batch is recreated,
 * migrated, resumed or submitted when this service is opened or read.
 */
export function createWorkspace({store,preferences,products,multisets,erp,sourcing,freeSourcing,listingWorkflow}){
  if(!store?.state||typeof store.save!=='function')throw new TypeError('Workspace requires the existing Store');
  if(!store.state.workspace){
    store.state.workspace={version:1,revision:0,products:{},edits:{},requests:{},context:{revision:0,productId:'',platform:'amazon',storeKey:'',erpKey:''},designStates:{},uiStates:{}};
    store.save();
  }
  const state=store.state.workspace;
  const save=()=>{state.revision++;store.save();};
  const settings=()=>preferences?.view?.()||{stores:[],erpConnections:[]};
  function storeViews(){
    const configured=settings();
    return (configured.stores||[]).map(s=>{
      const connection=configured.erpConnections?.find(e=>e.key===s.erpKey);
      const executionSupported=!!connection&&erpProviderFor(connection.provider).listingPlatforms.includes(s.platform);
      return {key:s.key,name:s.expectedStore,expectedStore:s.expectedStore,expectedSite:s.expectedSite,platform:s.platform,erpKey:s.erpKey||'',executionSupported,capabilities:{design:true,listing:executionSupported}};
    });
  }
  function groupView(group){return multisets?.get?multisets.get(group.id):group;}
  function groupUrl(group,productId){
    if(platform(group.source?.platform)==='temu')return '/temu?group='+encodeURIComponent(group.id)+'#multisets';
    const query=new URLSearchParams({platform:'amazon',group:group.id,...(productId?{product:productId}:{})});
    return '/design?'+query+'#multisets';
  }
  function groupImages(group){
    return (group?.sets||[]).flatMap(set=>(set.images||[]).flatMap(image=>{
      const task=image.task||store.state.tasks?.['hyrule_tasks/'+image.taskId];
      return task?.status==='completed'&&task.imageUrl?imagesFor([{url:task.imageUrl,originalImageUrl:task.originalImageUrl,slot:image.slot??task.slot,kind:'generated'}],{strict:false}):[];
    }));
  }
  function catalog(){
    const result=new Map(Object.values(state.products).map(p=>[p.id,copy(p)])),claimedGroups=new Set(),pendingOwners=[];
    const attach=(existing,record)=>{
      // Explicit saved exports retain their main/A+/mobile classifications and
      // original-image metadata when a live task projects the same version.
      const previous=existing.versions||[];
      existing.versions=mergeVersions(previous,(record.versions||[]).filter(v=>!previous.some(old=>old.platform===v.platform&&old.id===v.id)));
      existing.sources=[...(existing.sources||[existing.source]),...(record.sources||[record.source])].filter(Boolean);
    };
    const add=(record,owner)=>{
      if(owner&&result.has(owner)){
        attach(result.get(owner),record);return;
      }
      result.set(record.id,record);
      if(owner&&owner!==record.id)pendingOwners.push([record.id,owner]);
    };
    for(const stored of Object.values(store.state.productBatches||{})){
      const batch=products?.get?products.get(stored.id):stored;
      for(const p of batch.products||[]){
        if(p.groupId)claimedGroups.add(p.groupId);
        const id='product-batch:'+batch.id+':'+p.id,target=platform(batch.platform),source={kind:'product-batch',id:p.id,batchId:batch.id,...(p.groupId?{groupId:p.groupId}:{})};
        const group=p.group||(p.groupId&&store.state.multisets?.[p.groupId]?groupView(store.state.multisets[p.groupId]):null);
        add({id,name:p.name||p.productCode||'未命名商品',description:p.description||'',productCode:p.productCode,images:imagesFor(p.images||[],{strict:false}),source,sources:[source],versions:[{id:p.groupId||batch.id,platform:target,status:group?.phase||p.status||batch.phase,source,images:groupImages(group),url:'/temu/listings?product='+encodeURIComponent(batch.id)}],url:contentUrl(id,target),createdAt:batch.createdAt,updatedAt:batch.updatedAt||batch.createdAt},p.workspaceProductId);
      }
    }
    for(const raw of Object.values(store.state.multisets||{})){
      if(claimedGroups.has(raw.id))continue;
      const group=groupView(raw),target=platform(group.source?.platform),id='multiset:'+group.id,source={kind:'multiset',id:group.id,groupId:group.id};
      add({id,name:group.source?.product_name||'历史套图',description:group.source?.product_desc||'',images:imagesFor(group.source?.categorized_images||[],{strict:false}),source,sources:[source],versions:[{id:group.id,platform:target,status:group.phase||'draft',source,images:groupImages(group),url:groupUrl(group,id)}],url:contentUrl(id,target),createdAt:group.createdAt,updatedAt:group.updatedAt||group.createdAt},group.source?.workspace_product_id||group.source?.workspaceProductId);
    }
    for(const draft of store.state.drafts||[]){
      const id='draft:'+draft.id,target=platform(draft.platform),source={kind:'draft',id:draft.id,draftId:draft.id};
      add({id,name:draft.title||'商品草稿',description:draft.description||'',images:imagesFor(draft.images||[],{strict:false}),source,sources:[source],versions:[{id:draft.workspaceVersionId||draft.id,platform:target,status:draft.status||'draft',source,images:imagesFor(draft.images||[],{strict:false})}],url:contentUrl(id,target),createdAt:draft.createdAt,updatedAt:draft.updatedAt||draft.createdAt},draft.workspaceProductId||draft.workspace_product_id);
    }
    for(const [key,task] of Object.entries(store.state.tasks||{})){
      if(!key.startsWith('agent_tasks/')||!task.payload?.product_name||task.payload.group_id)continue;
      const payload=task.payload,taskId=payload.agent_task_id||key.slice('agent_tasks/'.length),id='single-design:'+taskId,target=platform(payload.platform),source={kind:'single-design',id:taskId};
      const outputs=(task.singleDesign?.tasks||payload.firebase_tasks||[]).flatMap(ref=>{
        const image=store.state.tasks['hyrule_tasks/'+ref.taskId];
        return image?.status==='completed'&&image.imageUrl?imagesFor([{url:image.imageUrl,originalImageUrl:image.originalImageUrl,slot:ref.slot,kind:'generated'}],{strict:false}):[];
      });
      add({id,name:payload.product_name,description:payload.product_desc||'',images:imagesFor(payload.categorized_images||[],{strict:false}),source,sources:[source],versions:[{id:'single:'+taskId,platform:target,status:singleStatus(task),source,images:outputs}],url:contentUrl(id,target),createdAt:task.createdAt,updatedAt:task.updatedAt||task.createdAt},payload.workspace_product_id||payload.workspaceProductId);
    }
    // Only selected collection rows enter the library; viewing never requests a
    // paid product detail or changes the independent sourcing implementation.
    for(const summary of sourcing?.view?.().batches||[]){
      const batch=sourcing.getBatch?sourcing.getBatch(summary.id):summary;
      const search=batch.searchId&&sourcing.getSearch?sourcing.getSearch(batch.searchId):null;
      for(const row of batch.rows||[]){
        const id='sourcing:'+batch.id+':'+row.goodsId,source={kind:'sourcing',id:row.goodsId,batchId:batch.id,...(row.sourceUrl?{url:row.sourceUrl}:{})};
        const original=search?.rows?.find(r=>r.goodsId===row.goodsId),images=imagesFor(original?.raw?.thumbnail?[{url:original.raw.thumbnail,category:'来源缩略图'}]:[],{strict:false});
        add({id,name:row.title||original?.raw?.goodsName||row.goodsId,description:'',images,source,sources:[source],versions:[{id:batch.id,platform:'temu',status:row.status,source,images:[],url:'/sourcing?batch='+encodeURIComponent(batch.id)}],url:contentUrl(id,'temu'),createdAt:batch.createdAt,updatedAt:row.checkedAt||batch.createdAt});
      }
    }
    for(const [id,owner] of pendingOwners)if(result.has(id)&&result.has(owner)){attach(result.get(owner),result.get(id));result.delete(id);}
    for(const [id,record] of result){const edits=state.edits[id];if(edits)result.set(id,{...record,...copy(edits),id,source:record.source,sources:record.sources,versions:mergeVersions(record.versions,edits.versions)});}
    for(const record of result.values())for(const version of record.versions||[]){
      const group=version.source?.kind==='multiset'&&store.state.multisets?.[version.source.groupId||version.source.id];
      if(group)version.url=groupUrl(group,record.id);
    }
    return [...result.values()].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  }
  function singleStatus(task){
    if(task.status==='failed')return 'failed';
    const flow=task.singleDesign;if(!flow)return task.status;
    const children=(flow.tasks||[]).map(t=>store.state.tasks['hyrule_tasks/'+t.taskId]?.status||'not_started');
    if(flow.phase==='generating'&&children.length&&children.every(s=>['completed','failed'].includes(s)))return children.every(s=>s==='completed')?'completed':'failed';
    return flow.phase||task.status;
  }
  function taskViews(){
    const result=[],groupOwners=new Map(catalog().flatMap(p=>(p.sources||[p.source]).filter(s=>s?.groupId).map(s=>[s.groupId,p.id])));
    for(const raw of Object.values(store.state.productBatches||{})){
      const batch=products?.get?products.get(raw.id):raw;
      result.push({id:'product-batch:'+batch.id,title:batch.label||'商品裂变批次',type:'图片裂变',platform:platform(batch.platform),status:batch.phase,url:'/temu/listings?product='+encodeURIComponent(batch.id),createdAt:batch.createdAt});
    }
    for(const raw of Object.values(store.state.multisets||{})){
      const group=groupView(raw),target=platform(group.source?.platform);
      const productId=groupOwners.get(group.id)||'multiset:'+group.id;
      result.push({id:'multiset:'+group.id,title:group.source?.product_name||'套图制作',type:'套图制作',platform:target,status:group.phase||'draft',url:groupUrl(group,productId),productId,createdAt:group.createdAt});
    }
    for(const [key,task] of Object.entries(store.state.tasks||{})){
      if(!key.startsWith('agent_tasks/')||task.payload?.group_id)continue;
      const taskId=task.payload?.agent_task_id||key.slice('agent_tasks/'.length),target=platform(task.payload?.platform||task.platform);
      result.push({id:'design:'+taskId,title:task.payload?.product_name||'单品设计',type:'单品设计',platform:target,status:singleStatus(task),url:contentUrl(task.payload?.workspace_product_id||task.payload?.workspaceProductId||'single-design:'+taskId,target),createdAt:task.createdAt});
    }
    // Only public summaries are copied: browser/account bindings never enter this index.
    for(const batch of erp?.list?.()||[])result.push({id:'erp:'+batch.id,title:batch.label||'店铺上架',type:'店铺上架',platform:platform(batch.store?.platform),status:batch.status,url:'/temu/listings?batch='+encodeURIComponent(batch.id),createdAt:batch.createdAt});
    const source=sourcing?.view?.();
    for(const search of source?.searches||[])result.push({id:'sourcing-search:'+search.id,title:(search.filters?.keywords||[]).join(' / ')||'自动选品',type:'自动选品',platform:'temu',status:search.status,url:'/sourcing?search='+encodeURIComponent(search.id),createdAt:search.createdAt});
    for(const batch of source?.batches||[])result.push({id:'sourcing-batch:'+batch.id,title:'采集批次 · '+(batch.erpName||batch.id),type:'选品采集',platform:'temu',status:batch.status,url:'/sourcing?batch='+encodeURIComponent(batch.id),createdAt:batch.createdAt});
    for(const job of freeSourcing?.view?.().jobs||[])result.push({id:'free-sourcing:'+job.id,title:job.keyword||'免费选品',type:'免费选品',platform:'temu',status:job.status,url:'/sourcing/free#job-'+encodeURIComponent(job.id),createdAt:job.createdAt});
    for(const job of listingWorkflow?.view?.().jobs||[])result.push({id:'listing-workflow:'+job.id,title:job.keyword||'固定模板上架',type:'固定模板上架',platform:job.templateSnapshot?.platform||'temu',status:job.status,url:'/sourcing/listing#job-'+encodeURIComponent(job.id),createdAt:job.createdAt});
    return result.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  }
  function getProduct(id){const value=catalog().find(p=>p.id===id);if(!value)throw fail('商品不存在，请从商品库重新选择',404);return value;}
  function productFields(input,existing){
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('商品资料格式无效');
    const result={};
    if(own(input,'name')||!existing){if(!text(input.name,240))throw fail('请填写商品名称');result.name=text(input.name,240);}
    if(own(input,'description')||!existing)result.description=text(input.description);
    if(own(input,'images')||!existing)result.images=imagesFor(input.images||[]);
    if(own(input,'productCode'))result.productCode=text(input.productCode,80);
    if(own(input,'count')){if(!Number.isInteger(input.count)||input.count<1||input.count>20)throw fail('裂变数量须为 1—20');result.count=input.count;}
    if(own(input,'templateKey'))result.templateKey=text(input.templateKey,100);
    if(own(input,'source')&&!existing)result.source=jsonData(input.source,20000);
    if(own(input,'versions')&&!Array.isArray(input.versions))throw fail('平台版本列表无效');
    if(own(input,'versions')||own(input,'version'))result.versions=mergeVersions(existing?.versions||[],versionsFor([...(input.versions||[]),...(input.version?[input.version]:[])]));
    return result;
  }
  function createProduct(input){
    const fields=productFields(input),requestId=input.requestId;
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[\w-]{8,100}$/.test(requestId)))throw fail('商品创建请求编号无效');
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if(requestId&&state.requests[requestId]){const previous=state.requests[requestId];if(previous.fingerprint!==fingerprint)throw fail('该请求编号已用于另一份商品资料',409);return getProduct(previous.id);}
    const id='product_'+crypto.randomUUID(),at=now();
    state.products[id]={id,...fields,source:fields.source||{kind:'manual'},versions:fields.versions||[],url:contentUrl(id,input.platform?platformFor(input.platform).id:context().platform),createdAt:at,updatedAt:at};
    if(requestId)state.requests[requestId]={id,fingerprint};save();return getProduct(id);
  }
  function updateProduct(id,input){
    const existing=getProduct(id),fields=productFields(input,existing);
    if(state.products[id])Object.assign(state.products[id],fields,{updatedAt:now()});
    else state.edits[id]={...state.edits[id],...fields,updatedAt:now()};
    save();return getProduct(id);
  }
  function context(input){
    if(input===undefined){
      const current=copy(state.context),bound=storeViews().find(s=>s.key===current.storeKey);
      if(current.storeKey&&!bound){current.storeKey='';current.erpKey='';}
      if(bound&&(bound.platform!==current.platform||bound.erpKey!==current.erpKey)){current.storeKey='';current.erpKey='';}
      return current;
    }
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('当前工作上下文格式无效');
    if(input.revision!==undefined&&input.revision!==state.context.revision)throw fail('当前选择已在其他页面更新，请刷新后重试',409);
    const next=context();
    if(own(input,'productId')){next.productId=text(input.productId,400);if(next.productId)getProduct(next.productId);}
    if(own(input,'platform'))next.platform=platformFor(input.platform).id;
    if(own(input,'storeKey'))next.storeKey=text(input.storeKey,100);
    if(own(input,'erpKey'))next.erpKey=text(input.erpKey,100);
    const bound=storeViews().find(s=>s.key===next.storeKey);
    if(next.storeKey&&!bound)throw fail('店铺不存在，请先在连接设置中绑定店铺');
    if(bound){
      if(own(input,'platform')&&bound.platform!==next.platform){if(own(input,'storeKey')&&input.storeKey)throw fail('店铺与所选平台不一致');next.storeKey='';next.erpKey='';}
      else {if(own(input,'erpKey')&&next.erpKey&&next.erpKey!==bound.erpKey)throw fail('店铺与 ERP 连接不一致');next.platform=bound.platform;next.erpKey=bound.erpKey;}
    }
    if(next.erpKey&&!settings().erpConnections?.some(e=>e.key===next.erpKey))throw fail('ERP 连接不存在，请重新选择');
    state.context={...next,revision:state.context.revision+1};save();return context();
  }
  function designState(key,input){
    if(typeof key!=='string'||key.length>500||!/^.+:(amazon|temu)$/.test(key)||/[\u0000-\u001f]/.test(key)||badKeys.has(key))throw fail('设计草稿编号无效');
    const target=key.endsWith(':temu')?'temu':'amazon',productId=key.slice(0,-target.length-1);
    if(productId!=='blank')getProduct(productId);
    const current=state.designStates[key]||{key,revision:0,data:null};
    if(input===undefined)return copy(current);
    if(!input||typeof input!=='object'||!own(input,'data'))throw fail('请提供需要保存的设计草稿 data');
    if(input.revision!==undefined&&input.revision!==current.revision)throw fail('设计草稿已在其他页面更新，请刷新后重试',409);
    const next={key,revision:current.revision+1,data:jsonData(input.data),updatedAt:now()};state.designStates[key]=next;save();return copy(next);
  }
  function uiState(key,input){
    if(typeof key!=='string'||!['listing:intake','listing:selection','sourcing:form','settings:editor'].includes(key)&&!/^listing:review:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key))throw fail('页面草稿编号无效');
    const current=state.uiStates?.[key]||{key,revision:0,data:null};
    if(input===undefined)return copy(current);
    if(!input||typeof input!=='object'||!own(input,'data'))throw fail('请提供需要保存的页面草稿 data');
    if(input.revision!==undefined&&input.revision!==current.revision)throw fail('页面草稿已在其他页面更新，请刷新后重试',409);
    const next={key,revision:current.revision+1,data:jsonData(input.data),updatedAt:now()};
    state.uiStates??={};state.uiStates[key]=next;save();return copy(next);
  }
  async function importFolder(input){
    if(!products?.importFolder)throw fail('当前环境没有本地素材导入功能',503);
    const result=await products.importFolder({...input,folder:input.folder||input.folderPath||input.path});
    const imported=[];
    for(const item of result.products||[]){
      const identity=result.sourceFolder+'\n'+item.productCode,id='local_'+crypto.createHash('sha256').update(identity).digest('hex').slice(0,24),existing=state.products[id];
      const fields=productFields(item,existing),at=now();
      state.products[id]={...existing,id,...fields,source:{kind:'local-folder',folder:result.sourceFolder,productCode:item.productCode},versions:existing?.versions||[],url:contentUrl(id,context().platform),createdAt:existing?.createdAt||at,updatedAt:at};
      imported.push(id);
    }
    if(imported.length)save();
    return {...result,products:imported.map(getProduct),revision:state.revision};
  }
  function view(){return {revision:state.revision,products:catalog(),tasks:taskViews(),context:context(),platforms:copy(Object.values(platforms)),stores:storeViews()};}
  return {view,createProduct,updateProduct,context,designState,uiState,importFolder};
}
