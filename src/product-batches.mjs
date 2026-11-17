import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {platformFor} from './platforms.mjs';
import {resolveImageModel} from './image-models.mjs';
import {readWorkbook,writeWorkbook} from './workbook.mjs';
import {generateListingTitles,translateChineseTitles,validateChineseTitle,validateGeneratedTitles,validateTitles} from './listing-titles.mjs';
import {marketLanguage} from './market-language.mjs';
import {recognizeProduct,validateRecognition} from './product-recognition.mjs';
import {validateTitleBrief,reviewTitleFacts} from './temu-title-policy.mjs';

const fail=message=>Object.assign(new Error(message),{status:400});
const code=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/.test(v);
const imageExt=/\.(png|jpe?g|webp|avif)$/i;
const busy=g=>['recommending','planning','generating'].includes(g.phase);
const inside=(root,file)=>{const r=path.relative(root,file);return r&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
export function createProductBatches({store,mediaDirectory,saveImage,multisets,erp,preferences,configuration,titlePlanner=generateListingTitles,chineseTranslator=translateChineseTitles,productRecognizer=recognizeProduct,imageAvailable=()=>!!configuration.SUANZHOU_IMAGE_API_KEY}){
  store.state.productBatches??={};store.state.listingTitles??={};
  const batches=store.state.productBatches;
  for(const b of Object.values(batches))if(['planning','generating'].includes(b.phase)){b.phase='interrupted';b.error='上次执行被中断；已完成的图片和标题已保留，请检查后继续。';}
  for(const b of Object.values(batches))if(b.titlesRegenerating){b.titlesRegenerating=false;b.titleError='上次标题重写被中断，请检查已有标题后重试。';}
  for(const b of Object.values(batches))for(const p of b.products)if(['running','checking'].includes(p.titleRepair?.status))p.titleRepair={...p.titleRepair,status:'failed',error:'上次商品标题修正被中断，已完成的标题已保留，请重试。'};
  store.save();let closed=false;
  const active=new Set();
  const find=id=>{if(!Object.hasOwn(batches,id))throw fail('商品批次不存在');return batches[id];};
  const save=b=>{b.updatedAt=new Date().toISOString();store.save();};
  const titleContext=(b,p,g,titleBrief=p.titleBrief)=>({...g,source:{...g.source,target_market:b.site,title_brief:validateTitleBrief(titleBrief)}});
  const qualityError=g=>!g?'':[
    ...(g.quality.issues.length&&g.copyRepair?.error?[g.copyRepair.error]:[]),
    ...g.quality.issues.map(issue=>issue.message),
    ...(g.quality.legacySets.length?['有旧版图片方案，请重新构思后再生图。']:[])
  ].join('\n');
  const view=b=>{
    const products=b.products.map(p=>{
      const group=p.groupId?multisets.get(p.groupId):null,titles=store.state.listingTitles[p.groupId]||[];
      const checking=group&&['recommending','planning'].includes(group.phase),problem=checking?'':qualityError(group);
      const recovered=p.qualityBlocked&&!problem&&group?.phase==='ready'&&titles.length===group.sets.length;
      const titleReview=group?reviewTitleFacts(titleContext(b,p,group).source,titles):null;
      const failures=group?.sets.flatMap((s,i)=>s.planning.status==='failed'?[`第 ${i+1} 套构思失败：${s.planning.error||'未取得完整方案'}`]:[])||[];
      const error=recovered?null:failures.length?failures.join('\n'):checking?null:(p.qualityBlocked?problem:p.error||problem)||null;
      const {pendingTitles,...visible}=p;
      return {...visible,group,titles,titleReview,status:checking?'planning':problem&&!active.has(b.id)?'attention':recovered?'ready':p.status,error};
    });
    let phase=b.phase;
    if(!active.has(b.id)){
      if(products.some(p=>p.group&&busy(p.group)))phase='planning';
      else if(products.some(p=>qualityError(p.group)))phase='attention';
      else if(phase==='attention'&&products.every(p=>p.status==='ready'))phase='ready';
    }
    let titleLanguage;try{titleLanguage=marketLanguage(b.site);}catch{}
    return {...b,phase,products,titleLanguage,totalListings:b.products.reduce((n,p)=>n+p.count,0)};
  };
  async function planTitles(b,p,context,{fresh=false}={}){
    if(fresh){delete p.pendingTitles;delete p.titleRepair;}
    const titles=await titlePlanner(context,{...configuration},{mediaDirectory,resumeTitles:p.pendingTitles,onProgress:({titles,...progress})=>{p.pendingTitles=titles;p.titleRepair=progress;save(b);}});
    const validated=validateGeneratedTitles(titles,context);
    delete p.pendingTitles;delete p.titleRepair;return validated;
  }
  const imageFiles=entries=>entries.filter(e=>e.isFile()&&imageExt.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}));
  const resolved=file=>fs.existsSync(file)?fs.realpathSync(file):path.resolve(file);
  const isOutput=folder=>fs.existsSync(path.join(folder,'.workbench-output-root'))||Object.values(batches).some(b=>b.outputParent&&resolved(b.outputParent)===folder);
  function validateOutput(source,output){
    if(typeof output!=='string'||!path.isAbsolute(output)||output.startsWith('\\\\'))throw fail('请填写本机生成结果文件夹的完整路径');
    const target=resolved(output);
    if(source===target)throw fail('生成结果保存位置不能与素材文件夹相同，请选择独立的结果文件夹，例如“裂变”。');
    if(source&&inside(source,target)){
      const branch=path.join(source,path.relative(source,target).split(path.sep)[0]);
      if(fs.existsSync(branch)&&!isOutput(branch)){
        const entries=fs.readdirSync(branch,{withFileTypes:true});
        if(imageFiles(entries).length||entries.some(e=>e.isFile()&&e.name==='商品资料.txt'))throw fail('生成结果保存位置位于产品原图文件夹内，请另选独立的结果文件夹，例如“裂变”。');
      }
    }
    return target;
  }
  async function importFolder({folder,outputParent}){
    if(typeof folder!=='string'||!path.isAbsolute(folder)||folder.startsWith('\\\\'))throw fail('请选择本机素材文件夹：可直接选择放图片的产品文件夹，或包含多个产品的上一级文件夹。');
    if(!fs.existsSync(folder)||!fs.statSync(folder).isDirectory())throw fail('素材文件夹不存在，请检查路径或重新选择。');
    const root=fs.realpathSync(folder),entries=fs.readdirSync(root,{withFileTypes:true});
    const output=validateOutput(root,outputParent||path.join(root,'_工作台生成结果')),ignoredFolders=[];
    const dirs=entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()).flatMap(e=>{
      const base=path.join(root,e.name);
      if(base===output||inside(output,base)||isOutput(base)){ignoredFolders.push({name:e.name,reason:'生成结果目录'});return [];}
      return [{name:e.name,base,entries:fs.readdirSync(base,{withFileTypes:true})}];
    });
    const books=entries.filter(e=>e.isFile()&&/\.xlsx?$/i.test(e.name)&&!e.name.startsWith('~$'));
    if(books.length>1)throw fail('请只保留一份商品 Excel');
    const rows=books.length?readWorkbook(path.join(root,books[0].name),{products:true}).rows:[];
    const direct=imageFiles(entries),candidates=dirs.filter(d=>{
      if(imageFiles(d.entries).length||d.entries.some(e=>e.isFile()&&e.name==='商品资料.txt')||rows.some(r=>r.productCode===d.name))return true;
      ignoredFolders.push({name:d.name,reason:'未找到直接存放的原图'});return false;
    });
    if(direct.length&&candidates.length)throw fail('当前文件夹和产品子文件夹中都有原图，请直接选择一个产品文件夹，或将各产品原图分别放入子文件夹后读取。');
    const sources=direct.length?[{name:path.basename(root),base:root,entries}]:candidates;
    if(!sources.length)throw fail('未找到产品原图。请选择直接放有图片的文件夹，或其上一级目录；支持 PNG、JPG、WebP、AVIF，每个产品 1—8 张。');
    if(sources.length>20)throw fail(`找到 ${sources.length} 个产品，单批最多读取 20 个，请分批选择。`);
    if(direct.length&&rows.length>1)throw fail('直接选择单个产品文件夹时，Excel 只能填写该产品的一行资料。');
    if(!direct.length&&rows.some(r=>!sources.some(d=>d.name===r.productCode)))throw fail('表格货号必须与产品子文件夹名一致，且不能指向生成结果目录');
    const products=[];
    for(const [i,dir] of sources.entries()){
      const base=dir.base,row=direct.length?rows[0]:rows.find(r=>r.productCode===dir.name);
      if(rows.length&&!row)continue;
      const files=imageFiles(dir.entries);
      if(!files.length||files.length>8)throw fail(`产品「${dir.name}」找到 ${files.length} 张原图，每个产品需有 1—8 张（PNG、JPG、WebP、AVIF）。`);
      const images=[];
      for(const [n,f] of files.entries()){
        const file=fs.realpathSync(path.join(base,f.name));if(!inside(root,file)||fs.statSync(file).size>25*1024*1024)throw fail('图片超出目录或超过 25 MB');
        const bytes=await sharp(file,{limitInputPixels:50000000}).rotate().png().toBuffer();
        images.push({filename:`${n?'参考图':'产品主体图'}-${n+1}.png`,category:n?'功能展示图':'产品主体图',url:saveImage(bytes)});
      }
      const info=path.join(base,'商品资料.txt');let description=row?.metadata['商品资料']||'';
      if(!description&&fs.existsSync(info)){const real=fs.realpathSync(info);if(!inside(root,real)||fs.statSync(real).size>100000)throw fail('商品资料文件无效');description=fs.readFileSync(real,'utf8').replace(/^\uFEFF/,'');}
      products.push({id:crypto.randomUUID(),productCode:row?.productCode||(code(dir.name)?dir.name:'P'+String(i+1).padStart(3,'0')),name:row?.title||dir.name,description,count:Number(row?.metadata['裂变数量'])||2,templateKey:row?.metadata['母稿编号']||'',images});
    }
    return {label:path.basename(root),sourceFolder:root,outputParent:output,products,ignoredFolders};
  }
  function create(payload){
    const platform=platformFor(payload.platform||'temu'),{target,binding}=erp.storeConnection(payload.storeKey,payload);
    if(target.platform!==platform.id)throw fail('店铺与平台不匹配');
    marketLanguage(target.expectedSite);
    if(typeof payload.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(payload.requestId))throw fail('创建请求编号无效');
    const id='pb_'+payload.requestId;
    const signature=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');if(batches[id]){if(batches[id].signature!==signature)throw fail('同一创建请求的商品资料已变化，请新建批次');return view(batches[id]);}
    if(!Array.isArray(payload.products)||!payload.products.length||payload.products.length>platform.maxProducts)throw fail('请选择 1—20 个产品');
    if(payload.ratio!=='1:1')throw fail('新生成的商品图统一使用 1:1 方图，请重新选择');
    if(!['fast','master'].includes(payload.mode)||!Number.isInteger(payload.imageCount)||payload.imageCount<1||payload.imageCount>platform.maxImages)throw fail('请选择有效的模式和主图张数');
    const seen=new Set();
    const products=payload.products.map(p=>{
      if(!code(p.productCode)||seen.has(p.productCode))throw fail('产品货号须唯一，使用不超过 36 位字母、数字、横线或下划线');seen.add(p.productCode);
      if(typeof p.name!=='string'||!p.name.trim())throw fail('请填写每个产品的名称');
      const description=p.description??'';
      if(typeof description!=='string'||description.length>30000)throw fail('商品卖点须为文字，且不超过 30000 字');
      if(!Number.isInteger(p.count)||p.count<1||p.count>20)throw fail('每个产品可裂变 1—20 套');
      const templateKey=p.templateKey||target.templates[0]?.key;if(!target.templates.some(t=>t.key===templateKey))throw fail('请为每个产品选择该店铺的母稿');
      if(!Array.isArray(p.images)||!p.images.length||p.images.length>8)throw fail('每个产品需有 1—8 张原图');
      const images=p.images.map((im,i)=>{if(!/^\/media\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/.test(im.url)||!fs.existsSync(path.join(mediaDirectory,path.basename(im.url))))throw fail('原图不存在，请重新导入');return {url:im.url,filename:`${i?'参考图':'产品主体图'}-${i+1}.png`,category:i?'功能展示图':'产品主体图'};});
      return {id:crypto.randomUUID(),productCode:p.productCode,name:p.name.trim(),description:description.trim(),titleBrief:validateTitleBrief(p.titleBrief),count:p.count,templateKey,images,status:'pending'};
    });
    if(products.reduce((n,p)=>n+p.count,0)>platform.maxListings)throw fail('单批次最多生成 100 条商品，请分批处理');
    const sourceFolder=payload.sourceFolder?fs.realpathSync(payload.sourceFolder):null;
    const outputParent=validateOutput(sourceFolder,payload.outputParent||(sourceFolder?path.join(sourceFolder,'_工作台生成结果'):path.resolve(mediaDirectory,'../exports')));
    const b=batches[id]={id,signature,sourceFolder,outputParent,platform:platform.id,storeKey:target.key,storeName:target.expectedStore,site:target.expectedSite,erpKey:target.erpKey,browserKey:target.browserKey,connectionBinding:binding,products,imageCount:payload.imageCount,ratio:payload.ratio,mode:payload.mode,model:resolveImageModel(payload.model,configuration),label:String(payload.label||'商品批次').slice(0,150),phase:'draft',createdAt:new Date().toISOString()};save(b);return view(b);
  }
  async function settle(groupId){
    const deadline=Date.now()+45*60*1000;
    while(!closed){const g=multisets.get(groupId);if(!busy(g))return g;if(Date.now()>deadline)throw fail('任务等待超时，请在套图页面查看已有任务');await new Promise(r=>setTimeout(r,300));}
    throw fail('工作台正在退出');
  }
  function launch(b,phase,work){
    if(active.has(b.id))return view(b);
    active.add(b.id);b.phase=phase;b.error=null;b.stopRequested=false;save(b);
    Promise.resolve().then(work).catch(e=>{b.phase='attention';b.error=String(e.message).slice(0,700);}).finally(()=>{active.delete(b.id);save(b);});return view(b);
  }
  function plan(id){
    const b=find(id);if(active.has(id))return view(b);
    if(titlePlanner===generateListingTitles&&!configuration.PLANNER_API_KEY)throw fail('请先在连接设置中填写文本模型密钥');
    return launch(b,'planning',async()=>{
      for(const p of b.products){
        if(b.stopRequested){b.phase='paused';return;}
        try{
          p.status='planning';p.error=null;p.qualityBlocked=false;save(b);
          if(!p.groupId){
            if(!p.description&&!p.recognition){p.status='recognizing';save(b);p.recognition=validateRecognition(await productRecognizer(p,{...configuration},{mediaDirectory}),p.images.length);save(b);}
            if(b.stopRequested){b.phase='paused';return;}
            const group=multisets.create({request_id:'product_'+p.id,source:{platform:b.platform,image_workflow:'shared',design_scope:'main_count',image_count:b.imageCount,image_ratio:b.ratio,generation_mode:b.mode,visual_style:'scene_advertising',info_density:'high',scene_intensity:'high',product_name:p.description?p.name:p.recognition.productName,product_desc:p.description||p.recognition.description,product_fact_source:p.description?'user':'image',target_market:b.site,target_lang:'English',categorized_images:p.images},count:p.count,variation:'style',sharedAudience:'关注本产品已确认用途与外观的用户',model:b.model});p.groupId=group.id;save(b);
          }
          let g=await settle(p.groupId);if(g.recommendation.status==='failed'){multisets.recommend(p.groupId);g=await settle(p.groupId);}
          if(g.recommendation.status!=='completed')throw fail(g.recommendation.error||'方向推荐未完成');
          multisets.plan(p.groupId);g=await settle(p.groupId);
          if(g.sets.some(s=>s.planning.status!=='completed'))throw fail(g.sets.flatMap((s,i)=>s.planning.status!=='completed'?[`第 ${i+1} 套构思失败：${s.planning.error||'图片方案未完成'}`]:[]).join('\n'));
          if(qualityError(g)){p.qualityBlocked=true;throw fail(qualityError(g));}
          if(!store.state.listingTitles[p.groupId]){p.status='titles';save(b);store.state.listingTitles[p.groupId]=await planTitles(b,p,titleContext(b,p,g));b.titleRevision??=1;save(b);}
          p.status='ready';save(b);
        }catch(e){p.status='failed';p.error=e.message;save(b);}
      }
      b.phase=b.products.every(p=>p.status==='ready')?'ready':'attention';
    });
  }
  function editTitles(id,payload){
    const b=find(id);if(active.has(id))throw fail('任务正在运行，请完成后修改标题');
    const p=b.products.find(p=>p.id===payload.productId);if(!p?.groupId)throw fail('请先完成构思');
    const previous=store.state.listingTitles[p.groupId]||[];
    const next=validateTitles(payload.titles,multisets.get(p.groupId).sets,b.platform,b.site);
    const onlyChinese=next.every(t=>previous.some(old=>old.setId===t.setId&&old.title===t.title&&old.englishTitle===t.englishTitle));
    if(!onlyChinese&&erp.list().some(e=>e.previewId===b.previewId))throw fail('已创建执行清单，不能修改上架标题；中文核对版本可单独保存');
    store.state.listingTitles[p.groupId]=next;
    if(!onlyChinese)b.previewId=null;save(b);if(!onlyChinese&&b.phase==='completed')syncPackage(b);return view(b);
  }
  async function addChineseTitles(id,{productId}={}){
    const b=find(id);if(active.has(id)||b.products.some(p=>p.groupId&&busy(multisets.get(p.groupId))))throw fail('任务正在运行，请完成后补全中文标题');
    const selected=productId?b.products.filter(p=>p.id===productId):b.products;
    if(!selected.length||selected.some(p=>!store.state.listingTitles[p.groupId]?.length))throw fail('请先生成商品标题');
    active.add(id);b.titlesRegenerating=true;save(b);
    try{
      const candidates=[];
      for(const p of selected){const prior=store.state.listingTitles[p.groupId],missing=prior.filter(t=>!t.chineseTitle);if(!missing.length)continue;
        const translated=await chineseTranslator(missing,{...configuration});
        if(!Array.isArray(translated)||translated.length!==missing.length||new Set(translated.map(t=>t?.setId)).size!==missing.length)throw fail('中文标题编号不匹配');
        const values=new Map(missing.map(t=>[t.setId,validateChineseTitle(translated.find(r=>r?.setId===t.setId)?.chineseTitle)]));
        candidates.push({groupId:p.groupId,titles:prior.map(t=>values.has(t.setId)?{...t,chineseTitle:values.get(t.setId)}:t)});
      }
      for(const c of candidates)store.state.listingTitles[c.groupId]=c.titles;
      b.titleError=null;
    }catch(e){b.titleError=e.message;throw e;}finally{active.delete(id);b.titlesRegenerating=false;save(b);}
    return view(b);
  }
  function setMothers(id,{templateKey}){
    const b=find(id);
    if(active.has(id)||b.products.some(p=>p.groupId&&busy(multisets.get(p.groupId))))throw fail('任务正在运行，请完成或暂停后选择母稿');
    if(erp.list().some(e=>e.previewId===b.previewId))throw fail('已创建执行清单，请在商品核对页检查母稿；已执行商品不可更换母稿');
    const target=preferences.store(b.storeKey);
    if(!target.templates.some(t=>t.key===templateKey))throw fail('请选择当前店铺的母稿');
    for(const p of b.products)p.templateKey=templateKey;
    b.previewId=null;save(b);return view(b);
  }
  async function regenerateTitles(id,{productId,titleBrief}={}){
    const b=find(id),executions=erp.list().filter(e=>b.previewId&&e.previewId===b.previewId);
    if(active.has(id)||b.products.some(p=>p.groupId&&busy(multisets.get(p.groupId)))||executions.some(e=>e.status==='running'))throw fail('任务正在运行，请暂停或完成后重新撰写标题');
    const selected=productId?b.products.filter(p=>p.id===productId):b.products;
    if(!selected.length||selected.some(p=>!p.groupId))throw fail('请先完成商品方案');
    if(titleBrief!==undefined&&!productId)throw fail('补充标题资料时请选择一个产品');
    const nextBrief=titleBrief===undefined?undefined:validateTitleBrief(titleBrief);
    marketLanguage(b.site);active.add(id);b.titlesRegenerating=true;b.titleError=null;save(b);
    try{
      const candidates=[];
      for(const p of selected){const g=multisets.get(p.groupId),context=titleContext(b,p,g,nextBrief??p.titleBrief);candidates.push({p,titles:await planTitles(b,p,context,{fresh:true})});}
      b.titleHistory??=[];b.titleHistory.push({at:new Date().toISOString(),products:candidates.map(({p})=>({groupId:p.groupId,titleBrief:p.titleBrief||{},titles:store.state.listingTitles[p.groupId]||[]}))});
      for(const {p,titles} of candidates){store.state.listingTitles[p.groupId]=titles;if(nextBrief!==undefined)p.titleBrief=nextBrief;}
      b.titleRevision=(b.titleRevision||0)+1;
      if(executions.length){b.titleUpdateWarning='新标题已保存到本批和新结果文件包，未执行条目已同步新标题。已保存到店小秘的商品仍保留原回执，其标题需另行更新，请勿重复创建商品。';}
      else b.previewId=null;
      save(b);if(b.phase==='completed')syncPackage(b);if(executions.length)erp.updatePendingTitles(b.previewId,outputRows(b));
    }catch(e){b.titleError=e.message;throw e;}
    finally{active.delete(id);b.titlesRegenerating=false;save(b);}
    return view(b);
  }
  const outputRows=b=>b.products.flatMap(p=>{
    const group=multisets.get(p.groupId),titles=store.state.listingTitles[p.groupId];
    return group.sets.map((s,i)=>{
      if(!s.images.length||s.images.some(im=>im.task?.status!=='completed'))throw fail('尚有图片未完成');
      const title=titles?.find(t=>t.setId===s.id);if(!title)throw fail('尚有商品标题未完成');
      const productCode=p.productCode+'-'+b.id.slice(-8)+'-'+String(i+1).padStart(2,'0');
      return {rowId:s.id,productCode,...title,templateKey:p.templateKey,folder:productCode,files:s.images.map(im=>path.join(mediaDirectory,path.basename(im.task.imageUrl)))};
    });
  });
  async function prepare(id){
    const b=find(id);if(active.has(id))throw fail('请等图片生成完成');
    if(b.titleUpdateWarning)throw fail(b.titleUpdateWarning);
    if(!b.previewId){const result=syncPackage(b),rows=outputRows(b);const preview=await erp.importFolder({folder:result.folder,source:{kind:'product-batch',batchId:b.id,sourceFolder:b.sourceFolder,resultFolder:result.folder},templateByCode:Object.fromEntries(rows.map(r=>[r.productCode,r.templateKey]))});b.previewId=preview.id;save(b);}
    return {batch:view(b),previewId:b.previewId,url:'/temu/listings?preview='+b.previewId+'&store='+encodeURIComponent(b.storeKey)};
  }
  function generate(id,{retryFailed=false}={}){
    const b=find(id);if(active.has(id))return view(b);
    if(!imageAvailable())throw fail('请先在连接设置中配置图片模型密钥');
    for(const p of b.products){if(!p.groupId||!store.state.listingTitles[p.groupId])throw fail('请先完成所有产品的构思与标题');const g=multisets.get(p.groupId);if(busy(g))throw fail('正在构思或检查文案，请稍候再生图。');if(g.sets.some(s=>s.planning.status!=='completed'))throw fail('图片方案未完成，请先完成构思。');if(qualityError(g))throw fail(qualityError(g));}
    return launch(b,'generating',async()=>{
      for(const p of b.products){
        if(b.stopRequested){b.phase='paused';return;}
        try{p.status='generating';p.error=null;save(b);let g=await settle(p.groupId);
          if(retryFailed)for(const s of g.sets)for(const im of s.images)if(im.task?.status==='failed')multisets.retry(p.groupId,{setId:s.id,slot:im.slot,mode:im.task.canRetryDownload?'download':'regenerate',request_id:crypto.randomUUID()});
          multisets.generate(p.groupId);g=await settle(p.groupId);if(g.phase!=='completed')throw fail('部分图片未完成，请查看套图中的失败原因，再重试失败项');p.status='completed';save(b);
        }catch(e){p.status='failed';p.error=e.message;save(b);}
      }
      b.phase=b.products.every(p=>p.status==='completed')?'completed':'attention';
      if(b.phase==='completed')syncPackage(b);
    });
  }
  async function exportFolder(id,{folder}){
    const b=find(id);if(active.has(id))throw fail('请等任务完成后导出');
    if(typeof folder!=='string'||!path.isAbsolute(folder)||!fs.statSync(folder).isDirectory())throw fail('请选择导出的父文件夹');
    return writePackage(b,fs.realpathSync(folder));
  }
  function writePackage(b,parent){
    const rows=outputRows(b),destination=path.join(parent,'Temu-'+b.id+'-'+Date.now()+'-'+crypto.randomUUID().slice(0,8));fs.mkdirSync(destination);
    for(const row of rows){const sub=path.join(destination,row.productCode);fs.mkdirSync(sub);row.files.forEach((f,i)=>fs.copyFileSync(f,path.join(sub,String(i+1).padStart(2,'0')+path.extname(f))));}
    writeWorkbook(rows,path.join(destination,'商品.xlsx'));
    fs.writeFileSync(path.join(destination,'说明.txt'),'每个子文件夹名对应 Excel 货号。主图与详情同图同序，SKU 预览图保留母稿原图。此文件包未执行发布。\n');
    return {folder:destination,count:rows.length};
  }
  function syncPackage(b,force=false){
    const rows=outputRows(b),signature=crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>({...r,files:r.files.map(f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'))})))).digest('hex');
    if(!force&&b.resultPackage?.signature===signature){if(!fs.existsSync(path.join(b.resultPackage.folder,'商品.xlsx')))throw fail('已生成的 Excel 已移动或删除，请点击重新整理结果');return b.resultPackage;}
    const parent=b.outputParent||path.resolve(mediaDirectory,'../exports');fs.mkdirSync(parent,{recursive:true});
    if(path.basename(parent)==='_工作台生成结果'||b.sourceFolder&&inside(b.sourceFolder,parent))fs.writeFileSync(path.join(parent,'.workbench-output-root'),'workbench-generated-output');
    const result=writePackage(b,fs.realpathSync(parent));b.resultPackage={...result,signature,workbook:path.join(result.folder,'商品.xlsx')};save(b);return b.resultPackage;
  }
  function materialize(id){const b=find(id);if(active.has(id)||erp.list().some(e=>e.previewId===b.previewId))throw fail('正在执行或已创建执行清单，不能重新整理结果');syncPackage(b,true);b.previewId=null;b.phase='completed';b.error=null;save(b);return view(b);}
  function setOutput(id,{folder,sourceFolder}){
    const b=find(id),executions=erp.list().filter(e=>b.previewId&&e.previewId===b.previewId);
    if(active.has(id)||['planning','generating'].includes(view(b).phase)||executions.some(e=>e.status==='running'))throw fail('任务正在运行，请完成或暂停后修改保存位置');
    const source=sourceFolder?fs.realpathSync(sourceFolder):b.sourceFolder||null;
    if(source&&!fs.statSync(source).isDirectory())throw fail('原始素材位置必须是文件夹');
    const parent=validateOutput(source,folder),old=b.resultPackage;
    if(fs.existsSync(parent)&&!fs.statSync(parent).isDirectory())throw fail('结果保存位置必须是文件夹');
    if(old&&(parent===resolved(old.folder)||inside(resolved(old.folder),parent)))throw fail('请选择本批结果文件夹以外的位置');
    fs.mkdirSync(parent,{recursive:true});const realParent=fs.realpathSync(parent);let result=old;
    if(old&&(realParent===resolved(old.folder)||inside(resolved(old.folder),realParent)))throw fail('请选择本批结果文件夹以外的位置');
    if(old&&realParent!==resolved(path.dirname(old.folder))){
      if(!fs.existsSync(old.workbook||path.join(old.folder,'商品.xlsx')))throw fail('已有结果文件不完整，请先重新整理结果');
      const destination=path.join(realParent,path.basename(old.folder)+'-copy-'+crypto.randomUUID().slice(0,8));
      // Preserve disk edits to Excel; changing the save location must never generate or publish again.
      fs.cpSync(old.folder,destination,{recursive:true,errorOnExist:true,force:false,filter:file=>{if(fs.lstatSync(file).isSymbolicLink())throw fail('结果文件包包含链接，请选择普通文件');return true;}});
      result={...old,folder:destination,workbook:path.join(destination,'商品.xlsx')};
    }
    if(path.basename(parent)==='_工作台生成结果'||source&&inside(source,parent))fs.writeFileSync(path.join(parent,'.workbench-output-root'),'workbench-generated-output');
    b.sourceFolder=source;b.outputParent=realParent;if(result)b.resultPackage=result;
    // Keep existing execution receipts attached to their preview so reopening cannot duplicate drafts.
    if(!executions.length)b.previewId=null;
    save(b);return view(b);
  }
  return {importFolder,create,plan,generate,editTitles,addChineseTitles,setMothers,regenerateTitles,prepare,exportFolder,materialize,setOutput,get:id=>view(find(id)),list:()=>Object.values(batches).reverse().map(b=>({id:b.id,label:b.label,storeName:b.storeName,phase:view(b).phase,products:b.products.length,createdAt:b.createdAt})),stop:id=>{const b=find(id);b.stopRequested=true;save(b);return view(b);},isBusy:()=>active.size>0,close:()=>{closed=true;}};
}
