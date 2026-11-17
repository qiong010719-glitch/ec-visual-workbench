import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createSettings} from './settings.mjs';
import {readWorkbook} from './workbook.mjs';
import {pathToFileURL} from 'node:url';
import {erpProviderFor,requireListingProvider} from './erp-providers.mjs';
import {marketLanguage,validateMarketTitle} from './market-language.mjs';
import {prepareTemuUploadImage} from './temu.mjs';
import {isDeepStrictEqual} from 'node:util';
export const ERP_AUTOMATION_REVISION='active-erp-pages-20261115';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const safeId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id);
const inside=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const load=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const imageExt=/\.(png|jpe?g|webp|avif)$/i;
const publicationDone=['submitted','listed','online','reviewing','pending-launch'];
const done=(b,r)=>b.executionMode==='publish'?publicationDone.includes(r.status):r.status==='verified';

export function createErpService({directory,mediaDirectory,store,multisets,adapter,configuration={},preferences}) {
  preferences??=createSettings({directory:path.join(directory,'preferences'),configuration,legacyDirectory:path.join(project,'config')});
  const stateFile=path.join(directory,'state.json');
  fs.mkdirSync(directory,{recursive:true});
  const state=fs.existsSync(stateFile)?load(stateFile):{previews:{},batches:{}};
  for(const batch of Object.values(state.batches))batch.cleaningUp=false;
  const save=()=>{fs.writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2));fs.renameSync(stateFile+'.tmp',stateFile);};
  // Never replay a potentially submitted save after an application restart.
  for(const batch of Object.values(state.batches))if(batch.status==='running'){
    batch.status='interrupted';batch.error='运行已中断。请先核对店小秘结果，再继续未提交条目。';
    for(const row of batch.rows)if(['running','saving','publishing'].includes(row.status))row.status=row.status==='publishing'?'publication-unknown':row.status==='saving'?'needs-review':row.draftId?'verified':'failed';
  }
  for(const batch of Object.values(state.batches))for(const row of batch.rows)if(row.status==='verified')row.error=null;
  save();
  let active=null;
  const settings=()=>{
    const {stores,browsers,erpConnections}=preferences.view();
    return {stores:stores.map(s=>{let titleLanguage;try{titleLanguage=marketLanguage(s.expectedSite);}catch{}return {...s,titleLanguage,erpConnection:erpConnections.find(e=>e.key===s.erpKey),url:'https://www.dianxiaomi.com/web/popTemu/edit?id='+s.draftId};}),
      browsers,erpConnections,
      platform:'temu',erp:'店小秘',destination:'pending-draft',publishEnabled:true,maxRows:100,
      defaultFolder:''};
  };
  const moduleFor=filename=>import(pathToFileURL(path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib',filename)).href);
  const engine=async(connection,platform='temu')=>{requireListingProvider(connection,platform);return adapter||await moduleFor('temu-runner.mjs');};
  const connectionEngine=async(connection)=>erpProviderFor(connection?.provider).id==='miaoshou'?moduleFor('miaoshou-connection.mjs'):engine(connection);
  // ERP owns the browser binding. All listing entry points resolve it here.
  function storeConnection(storeKey,{erpKey,browserKey,connectionBinding,storeName,site}={}){
    const target=preferences.store(storeKey),erpConnection=preferences.erp(target.erpKey);
    requireListingProvider(erpConnection,target.platform);
    if(erpKey&&erpKey!==erpConnection.key)throw fail('所选店铺不属于这个 ERP 连接，请重新选择店铺');
    if(storeName&&storeName!==target.expectedStore||site&&site!==target.expectedSite)throw fail('任务的店铺或经营站点已变化，请核对连接设置后新建批次');
    const browserConfig=preferences.browser(erpConnection.browserKey);
    if(browserKey&&browserKey!==browserConfig.key)throw fail('任务的 ERP 浏览器绑定已变化，请核对连接设置后新建批次；已有素材和执行记录保留');
    const binding={erpConnection,browserConfig};
    if(connectionBinding&&!isDeepStrictEqual(connectionBinding,binding))throw fail('任务的 ERP 连接配置已变化，请核对连接设置后新建批次；已有素材和执行记录保留');
    return {target:{...target,browserKey:browserConfig.key,erpConnection},binding};
  }
  async function browserStatus({browserKey,erpKey}={}){
    const erp=erpKey?preferences.erp(erpKey):{};
    if(erpKey&&browserKey&&browserKey!==erp.browserKey)throw fail('ERP 与浏览器选择不一致，请刷新连接设置');
    const browser=preferences.browser(erp.browserKey||browserKey);
    return (await connectionEngine(erp)).checkConnection(browser,erp);
  }
  async function openLogin({erpKey}){if(active)throw fail('请等上架任务结束再打开登录窗口');const e=preferences.erp(erpKey);return (await connectionEngine(e)).openLogin(preferences.browser(e.browserKey));}
  const templateChecks=new Map();
  async function templateOperation(kind,payload,{cached=false,connectionSettings}={}){
    if(active)throw fail('请等当前任务结束后再读取或校验母稿');
    const connection=connectionSettings?connectionSettings.erpConnections.find(e=>e.key===payload.erpKey):preferences.erp(payload.erpKey);
    if(!connection)throw fail('请选择 ERP 连接');
    const browserConfig=connectionSettings?connectionSettings.browsers.find(b=>b.key===connection.browserKey):preferences.browser(connection.browserKey);
    if(!browserConfig)throw fail('请选择已配置的浏览器');
    requireListingProvider(connection,payload.platform||'temu');
    const store={erpConnection:connection,platform:payload.platform||'temu'};
    for(const key of ['expectedStore','expectedSite']){if(typeof payload[key]!=='string'||!payload[key].trim()||payload[key].length>240)throw fail('请先填写店小秘店铺名称和经营站点');store[key]=payload[key].trim();}
    if(kind!=='list'){
      if(typeof payload.draftId!=='string'||!/^\d{6,30}$/.test(payload.draftId))throw fail('请填写有效的母稿编辑链接或 ID');store.draftId=payload.draftId;
    }
    const key=hash(JSON.stringify({store,browserConfig})),previous=templateChecks.get(key);
    if(kind==='validate'&&cached&&previous?.valid&&Date.now()-previous.cachedAt<300000)return previous;
    active='template-check';
    try{
      if(kind==='list')templateChecks.clear();
      const runner=await engine(connection,store.platform),method={validate:'validateMother',open:'openMotherSource'}[kind];
      if(typeof runner[method]!=='function')throw fail('当前执行器不支持按母稿链接读取，请重启更新后的工作台');
      const result=await runner[method]({store,browserConfig});
      if(kind==='validate'){
        if(result.valid&&(result.sourceMode!=='product'||result.draftId!==store.draftId))throw fail('校验结果与母稿链接不一致，请重新读取');
        if(result.valid)templateChecks.set(key,{...result,cachedAt:Date.now()});
        else templateChecks.clear();
      }
      return result;
    }catch(error){if(kind==='validate'){templateChecks.clear();return {valid:false,issues:[error.message],checkedAt:new Date().toISOString()};}throw error;}
    finally{active=null;}
  }
  async function verifyStoreTemplates(target,{templateKeys,connectionSettings,cached=true}={}){
    if(!Array.isArray(target.templates)||!target.templates.length)throw fail('每家店至少配置一个商品母稿');
    const checks=[],issues=[];
    for(const template of target.templates.filter(t=>!templateKeys||templateKeys.includes(t.key))){
      const result=await templateOperation('validate',{...target,...template},{cached,connectionSettings});
      if(!result.valid)issues.push(`${template.name||template.templateName}：${(result.issues||['校验失败']).join('；')}`);
      else checks.push({key:template.key,...result});
    }
    if(issues.length)throw fail('母稿校验未通过，请在连接设置处理后继续：\n'+issues.join('\n'));
    return checks;
  }
  async function verifyProductTemplates(payload){
    const {target}=storeConnection(payload.storeKey,payload),keys=[...new Set((payload.products||[]).map(p=>p.templateKey||target.templates[0]?.key))];
    if(!keys.length||keys.some(key=>!target.templates.some(t=>t.key===key)))throw fail('请为每个产品选择该店铺的母稿');
    return verifyStoreTemplates(target,{templateKeys:keys,cached:false});
  }
  function chineseTitles(preview){
    const parent=store.state.productBatches?.[preview?.source?.batchId],values=new Map();
    if(parent)for(const p of parent.products)for(const [i,t] of (store.state.listingTitles?.[p.groupId]||[]).entries())if(t.chineseTitle)values.set(p.productCode+'-'+parent.id.slice(-8)+'-'+String(i+1).padStart(2,'0'),t.chineseTitle);
    return values;
  }
  const view=preview=>{const titles=chineseTitles(preview);return {...preview,rows:preview.rows.map(r=>titles.has(r.productCode)?{...r,chineseTitle:titles.get(r.productCode)}:r),folders:preview.folders.map(f=>({...f,images:f.images.map(({file,...im})=>({...im,url:`/api/temu/erp/images/${preview.id}/${im.id}`}))}))};};
  async function picture(source,dest){
    const raw=fs.readFileSync(source);
    if(raw.length>25*1024*1024)throw fail('图片超过 25 MB：'+path.basename(source));
    const bytes=await prepareTemuUploadImage(raw);
    const m=await sharp(bytes).metadata();fs.writeFileSync(dest,bytes);
    return {file:dest,sha256:hash(bytes),sourceSha256:hash(raw),name:path.basename(source),width:m.width,height:m.height};
  }
  async function makePreview({label,rows,folders,source}){
    const id=crypto.randomUUID(),dir=path.join(directory,'imports',id);fs.mkdirSync(dir,{recursive:true});
    const snapshot=[];let n=0;
    for(const folder of folders){
      if(!folder.files.length||folder.files.length>10)throw fail(`文件夹「${folder.name}」需要 1—10 张图片`);
      const images=[];
      for(const file of folder.files){const imageId='i'+(++n);images.push({id:imageId,...await picture(file,path.join(dir,imageId+'.jpg'))});}
      snapshot.push({name:folder.name,images});
    }
    const preview={id,label,createdAt:new Date().toISOString(),source,rows:rows.map(r=>({...r,folder:snapshot.some(f=>f.name===r.productCode)?r.productCode:r.folder||''})),folders:snapshot};
    state.previews[id]=preview;save();return view(preview);
  }
  async function importFolder({folder,workbook,source={},templateByCode}){
    if(typeof folder!=='string'||!path.isAbsolute(folder)||folder.startsWith('\\\\'))throw fail('请输入本机素材文件夹的完整路径');
    const base=fs.realpathSync(folder);
    if(!workbook){const books=fs.readdirSync(base).filter(n=>/\.xlsx?$/i.test(n)&&!n.startsWith('~$'));if(books.length!==1)throw fail('文件夹中需有一份 Excel，或填写具体表格路径');workbook=path.join(base,books[0]);}
    if(typeof workbook!=='string'||!path.isAbsolute(workbook)||!inside(base,fs.realpathSync(workbook)))throw fail('Excel 必须位于选定素材文件夹内');
    if(fs.statSync(workbook).size>10*1024*1024)throw fail('Excel 超过 10 MB');
    const parsed=readWorkbook(workbook);
    if(templateByCode){if(parsed.rows.length!==Object.keys(templateByCode).length||parsed.rows.some(r=>!Object.hasOwn(templateByCode,r.productCode)))throw fail('结果 Excel 货号与本批生成商品不一致');for(const r of parsed.rows)r.templateKey=templateByCode[r.productCode];}
    const folders=fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
    if(!folders.length||folders.length>100)throw fail('当前支持 1—100 个直接子文件夹');
    const groups=folders.map(f=>({name:f.name,files:fs.readdirSync(path.join(base,f.name),{withFileTypes:true}).filter(x=>x.isFile()&&imageExt.test(x.name)).sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true})).map(x=>{
      const file=fs.realpathSync(path.join(base,f.name,x.name));if(!inside(base,file))throw fail('图片路径超出素材文件夹');return file;
    })}));
    return makePreview({label:path.basename(base),rows:parsed.rows,folders:groups,source:{kind:'excel',folder:base,resultFolder:base,workbook,sheet:parsed.sheet,sha256:hash(fs.readFileSync(workbook)),...source}});
  }
  function sources(){return {groups:multisets.list('temu'),drafts:store.state.drafts.filter(d=>d.platform==='temu').map(d=>({id:d.id,title:d.title,count:d.images.length}))};}
  function mediaFile(url){if(typeof url!=='string'||!/^\/media\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/.test(url))throw fail('生成图片地址无效');const file=fs.realpathSync(path.join(mediaDirectory,path.basename(url)));if(!inside(fs.realpathSync(mediaDirectory),file))throw fail('图片路径无效');return file;}
  async function importGenerated({groupId,draftId}){
    const folders=[],rows=[];let label;
    if(groupId){
      const group=multisets.get(groupId);if(group.source.platform!=='temu')throw fail('请选择 Temu 裂变批次');label=group.source.product_name;
      for(const [index,set] of group.sets.entries()){
        if(!set.images.length||set.images.some(i=>i.task?.status!=='completed'||!i.task.imageUrl))throw fail('该裂变批次尚有图片未完成');
        const code='GEN-'+group.id.slice(0,8)+'-'+String(index+1).padStart(2,'0');
        folders.push({name:code,files:set.images.map(i=>mediaFile(i.task.imageUrl))});
        const title=store.state.listingTitles?.[group.id]?.find(t=>t.setId===set.id);
        rows.push({rowId:set.id,productCode:code,title:title?.title||label,englishTitle:title?.englishTitle||'',...(title?.chineseTitle?{chineseTitle:title.chineseTitle}:{}),metadata:{direction:set.direction},folder:code});
      }
    }else{
      const d=store.state.drafts.find(d=>d.id===draftId&&d.platform==='temu');if(!d)throw fail('请选择已保存的 Temu 图片草稿');label=d.title;
      const code='GEN-'+d.id.slice(0,8);folders.push({name:code,files:d.images.map(mediaFile)});
      rows.push({rowId:d.id,productCode:code,title:d.title,englishTitle:d.englishTitle||'',metadata:{},folder:code});
    }
    return makePreview({label,rows,folders,source:{kind:'generated',groupId,draftId}});
  }
  function prepare(payload){
    const preview=state.previews[payload.previewId];if(!preview)throw fail('请先导入素材');
    const {target,binding}=storeConnection(payload.storeKey,payload),browserKey=binding.browserConfig.key;
    const parent=store.state.productBatches?.[preview.source?.batchId];
    if(parent&&parent.storeKey===target.key)storeConnection(parent.storeKey,parent);
    if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>100)throw fail('请选择 1—100 条商品');
    const executionMode=payload.executionMode||'draft';if(!['draft','publish'].includes(executionMode))throw fail('请选择仅保存草稿或保存并发布');
    const codes=new Set(),rowIds=new Set();
    const rows=payload.rows.map(r=>{
      if(!preview.rows.some(p=>p.rowId===r.rowId)||rowIds.has(r.rowId))throw fail('商品行不存在或重复');rowIds.add(r.rowId);
      if(typeof r.productCode!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(r.productCode)||codes.has(r.productCode))throw fail('货号需唯一，使用 1—60 位字母、数字、横线或下划线');codes.add(r.productCode);
      for(const k of ['title','englishTitle'])if(typeof r[k]!=='string'||!r[k].trim()||r[k].trim().length>250)throw fail('请填写 1—250 字的产品标题和英文标题');
      if(preview.source?.batchId&&store.state.productBatches?.[preview.source.batchId]?.titleRevision)validateMarketTitle(r.title,marketLanguage(target.expectedSite));
      const folder=preview.folders.find(f=>f.name===r.folder);if(!folder)throw fail(`货号 ${r.productCode} 尚未对应图片文件夹`);
      const ids=r.imageIds||folder.images.map(i=>i.id);
      if(!Array.isArray(ids)||!ids.length||ids.length>10||new Set(ids).size!==ids.length)throw fail('每条商品需要 1—10 张不重复图片');
      const images=ids.map(id=>{const im=folder.images.find(i=>i.id===id);if(!im)throw fail('图片不属于所选文件夹');if(hash(fs.readFileSync(im.file))!==im.sha256)throw fail('预览后的图片发生变化，请重新导入');return {...im};});
      const template=target.templates?.find(t=>t.key===(r.templateKey||target.templates[0]?.key));
      if(target.templates&&!template)throw fail('商品母稿不存在，请重新选择');
      return {rowId:r.rowId,productCode:r.productCode,title:r.title.trim(),englishTitle:r.englishTitle.trim(),sku:r.productCode+'-SKU1',folder:folder.name,images,templateKey:template?.key,mother:template?{...target,...template,key:target.key}:target,status:'pending'};
    });
    const fingerprint=hash(JSON.stringify({executionMode,storeKey:target.key,site:target.expectedSite,storeName:target.expectedStore,erpConnection:target.erpConnection,browserConfig:binding.browserConfig,browserKey,rows:rows.map(r=>[r.productCode,r.title,r.englishTitle,r.mother.draftId,r.images.map(i=>i.sha256)])}));
    const existing=Object.values(state.batches).find(b=>b.fingerprint===fingerprint);if(existing)return publicBatch(existing);
    // A changed import cannot silently create a second ERP product with the same store/code.
    for(const old of Object.values(state.batches).filter(b=>b.store.key===target.key))for(const r of old.rows)
      if(codes.has(r.productCode)&&(r.draftId||['verified','saving','needs-review','running','publishing','publication-unknown',...publicationDone].includes(r.status)))throw fail(`货号 ${r.productCode} 已有执行记录，请从历史批次查看结果`);
    const batch={id:crypto.randomUUID(),fingerprint,previewId:preview.id,label:preview.label,store:target,browserKey,
      browserConfig:binding.browserConfig,createdAt:new Date().toISOString(),status:'ready',executionMode,destination:executionMode==='publish'?'submit-publication':'pending-draft',published:false,rows,events:[]};
    state.batches[batch.id]=batch;save();return publicBatch(batch);
  }
  const publicBatch=b=>{const titles=chineseTitles(state.previews[b.previewId]);return {...b,rows:b.rows.map(r=>({...r,...(titles.has(r.productCode)?{chineseTitle:titles.get(r.productCode)}:{}),images:r.images.map(({file,...i})=>({...i,url:`/api/temu/erp/images/${b.previewId}/${i.id}`}))}))};};
  const find=id=>{const b=state.batches[id];if(!b)throw fail('批次不存在',404);return b;};
  async function reconcile(id,{rowId,draftId,checkNotSaved=false}){
    if(active)throw fail('已有任务正在执行，请稍后核对');
    const b=find(id),row=b.rows.find(r=>r.rowId===rowId);
    if(!row||row.status!=='needs-review')throw fail('该条商品不处于保存结果待核对状态');
    if(!checkNotSaved&&(typeof draftId!=='string'||!/^\d{6,30}$/.test(draftId)))throw fail('请输入待核对草稿的数字 ID');
    active=b.id;
    try{
      const runner=await engine(b.store.erpConnection,b.store.platform);
      if(checkNotSaved){
        const result=await runner.checkRejectedDraft({row,browserConfig:b.browserConfig||preferences.browser(b.browserKey),evidenceDirectory:path.join(directory,'runs',b.id,row.productCode)});
        if(result.confirmedNotSaved!==true)throw fail('未获得足够证据确认保存失败');
        Object.assign(row,{status:'failed',error:result.reason,saveRejection:result});b.status='failed';b.error=result.reason;
        b.events.push({at:new Date().toISOString(),productCode:row.productCode,phase:'confirmed-not-saved'});save();return publicBatch(b);
      }
      const result=await runner.reconcileDraft({store:row.mother||b.store,row,draftId,browserConfig:b.browserConfig||preferences.browser(b.browserKey),evidenceDirectory:path.join(directory,'runs',b.id,row.productCode)});
      Object.assign(row,result,{status:'verified',error:null});b.error=null;b.status=b.rows.every(r=>done(b,r))?'completed':'paused';
      b.events.push({at:new Date().toISOString(),productCode:row.productCode,phase:'verified'});save();return publicBatch(b);
    }finally{active=null;}
  }
  async function publicationStatus(id,{rowId}){
    if(active)throw fail('请等当前任务结束后核对发布结果');const b=find(id),row=b.rows.find(r=>r.rowId===rowId);
    if(!row?.draftId||b.executionMode!=='publish')throw fail('请先保存并核验本批商品，再核对发布结果');active=b.id;
    try{const result=await (await engine(b.store.erpConnection,b.store.platform)).checkPublication({row,browserConfig:b.browserConfig||preferences.browser(b.browserKey)});
      if(result.publicationStatus==='draft'||result.publicationStatus==='unknown'){
        row.error=result.error||(result.publicationStatus==='draft'?'草稿仍在待发布，无法排除原请求仍在处理中；请在店小秘确认后再次核对，程序不会自动重试。':'暂未取得明确发布状态；请在店小秘核对后再次检查，程序不会自动重试。');
        row.publicationCheckedAt=result.checkedAt||new Date().toISOString();
      }else if([...publicationDone,'failed'].includes(result.publicationStatus)){
        Object.assign(row,result,{status:result.publicationStatus==='failed'?'publication-failed':result.publicationStatus,error:result.error||null});
        b.events.push({at:new Date().toISOString(),productCode:row.productCode,phase:row.status});
      }else throw fail('未取得可识别的发布状态，请稍后重新核对');
      b.error=b.rows.find(r=>r.error)?.error||null;
      b.status=b.rows.every(r=>done(b,r))?'completed':'paused';save();return publicBatch(b);
    }finally{active=null;}
  }
  function updatePendingTitles(previewId,updates){
    const affected=Object.values(state.batches).filter(b=>b.previewId===previewId);
    if(affected.some(b=>b.status==='running'))throw fail('上架清单正在执行，不能更新标题');
    for(const b of affected)for(const row of b.rows){
      const update=updates.find(u=>u.productCode===row.productCode);
      if(!update||row.draftId||!['pending','failed'].includes(row.status)||row.reviewTargetId)continue;
      row.title=update.title;row.englishTitle=update.englishTitle;
      b.events.push({at:new Date().toISOString(),productCode:row.productCode,phase:'titles-updated'});
    }
    save();
  }
  function start(id){
    const b=find(id);if(b.status==='completed'||b.status==='running'||b.cleaningUp)return publicBatch(b);
    if(active)throw fail('已有批次正在运行，请等本批完成');
    const currentStore=preferences.store(b.store.key),currentBrowser=preferences.browser(b.browserKey);
    requireListingProvider(preferences.erp(currentStore.erpKey),currentStore.platform);
    requireListingProvider(b.store.erpConnection,b.store.platform);
    if(currentStore.browserKey!==b.browserKey||currentStore.expectedStore!==b.store.expectedStore||currentStore.expectedSite!==b.store.expectedSite)throw fail('店铺配置已变化，请重新准备批次');
    if(b.store.erpConnection&&JSON.stringify(preferences.erp(currentStore.erpKey))!==JSON.stringify(b.store.erpConnection))throw fail('店小秘连接已变化，请重新准备批次');
    if(b.browserConfig&&JSON.stringify(currentBrowser)!==JSON.stringify(b.browserConfig))throw fail('浏览器配置已变化，请重新准备批次');
    for(const row of b.rows){const template=currentStore.templates?.find(t=>t.key===(row.templateKey||currentStore.templates[0]?.key));if(!template||template.draftId!==(row.mother||b.store).draftId)throw fail('母稿配置已变化，请重新准备批次');}
    if(b.rows.some(r=>['needs-review','saving'].includes(r.status)))throw fail('有保存结果待核对的条目，请先在店小秘核对，避免重复创建');
    if(b.rows.some(r=>['publication-unknown','publishing'].includes(r.status)))throw fail('有发布结果待核对的条目，请先核对发布结果，不会重复提交');
    for(const row of b.rows.filter(r=>!r.draftId))for(const im of row.images)if(hash(fs.readFileSync(im.file))!==im.sha256)throw fail('批次图片发生变化，请重新导入');
    b.status='running';b.error=null;b.stopRequested=false;active=b.id;save();
    const event=(row,phase,detail={})=>{Object.assign(row,detail);if(['saving','verified','publishing',...publicationDone,'publication-failed'].includes(phase))row.status=phase;
      b.events.push({at:new Date().toISOString(),productCode:row.productCode,phase,...(detail.step?{step:detail.step}:{})});save();};
    let draftSession;
    Promise.resolve().then(async()=>{
      const runner=await engine(b.store.erpConnection,b.store.platform);
      for(const row of b.rows){
        if(done(b,row))continue;if(b.stopRequested){b.status='paused';break;}
        const resumeSaved=!!row.draftId;
        row.status=row.draftId?'verified':'running';row.error=null;row.errorDetails=null;save();
        try{
          if(!row.draftId&&!draftSession&&runner.createDraftSession)draftSession=await runner.createDraftSession(b.browserConfig||currentBrowser);
          const args={store:row.mother||b.store,row,browserKey:b.browserKey,browserConfig:b.browserConfig||currentBrowser,draftSession,onProgress:(phase,detail)=>event(row,phase,detail),evidenceDirectory:path.join(directory,'runs',b.id,row.productCode)};
          if(!row.draftId){const result=await runner.runDraft(args);event(row,'verified',{...result,status:'verified',error:null});}
          if(b.executionMode==='publish'){
            if(resumeSaved){const verified=await runner.reconcileDraft({...args,draftId:row.draftId});event(row,'verified',{...verified,error:null});}
            const result=await runner.publishDraft(args);
            if(![...publicationDone,'failed'].includes(result.publicationStatus))throw new Error('未取得明确的发布提交结果');
            event(row,result.publicationStatus==='failed'?'publication-failed':result.publicationStatus,{...result,status:result.publicationStatus==='failed'?'publication-failed':result.publicationStatus,error:result.error||null});
            if(result.publicationStatus==='failed')throw new Error(result.error||'店小秘拒绝发布');
          }
        }catch(e){row.status=row.status==='publishing'?'publication-unknown':row.status==='publication-failed'?'publication-failed':row.status==='saving'?'needs-review':row.draftId?'verified':'failed';row.error=e.message;row.errorDetails={step:e.step||row.step,waitLabel:e.waitLabel,waitMs:e.waitMs};if(e.reviewTargetId)row.reviewTargetId=e.reviewTargetId;b.status='failed';throw e;}
      }
      if(b.rows.every(r=>done(b,r)))b.status='completed';
    }).catch(e=>{b.status='failed';b.error=e.message;}).finally(async()=>{
      b.cleaningUp=true;save();
      try{await draftSession?.close();}catch(e){b.events.push({at:new Date().toISOString(),phase:'cleanup-warning',step:'临时页回收失败：'+e.message});}
      finally{b.cleaningUp=false;active=null;b.finishedAt=new Date().toISOString();save();}
    });
    return publicBatch(b);
  }
  return {settings,storeConnection,browserStatus,openLogin,templateOperation,verifyStoreTemplates,verifyProductTemplates,importFolder,importGenerated,makePreview,sources,prepare,start,reconcile,publicationStatus,updatePendingTitles,isBusy:()=>!!active,
    previews:()=>Object.values(state.previews).reverse().map(view),
    list:()=>Object.values(state.batches).reverse().map(publicBatch),get:id=>publicBatch(find(id)),
    stop:id=>{const b=find(id);b.stopRequested=true;save();return publicBatch(b);},
    image:(previewId,imageId)=>{if(!safeId(previewId)||!safeId(imageId))throw fail('图片不存在',404);const p=state.previews[previewId];const im=p?.folders.flatMap(f=>f.images).find(i=>i.id===imageId);if(!im)throw fail('图片不存在',404);return im.file;}
  };
}
