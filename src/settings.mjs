import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {platformFor,platforms} from './platforms.mjs';
import {erpProviders,erpProviderFor,requireListingProvider} from './erp-providers.mjs';
import {collectionPlatforms,normalizeCollectionStores} from './listing-destinations.mjs';

const fail=message=>Object.assign(new Error(message),{status:400});
const secrets=['SUANZHOU_IMAGE_API_KEY','PLANNER_API_KEY','SUANZHOU_VIDEO_API_KEY','APIFY_API_TOKEN','GB_APP_KEY','GB_APP_SECRET','SADCAPTCHA_API_KEY'];
const fields=['SUANZHOU_IMAGE_BASE_URL','SUANZHOU_IMAGE_MODEL','PLANNER_BASE_URL','PLANNER_API_FORMAT','PLANNER_MODEL','PLANNER_REASONING_EFFORT','PLANNER_TIMEOUT_MS','TITLE_MODEL','TITLE_API_FORMAT'];
const defaults={SUANZHOU_IMAGE_BASE_URL:'https://api.suanzhou.vip/v1',SUANZHOU_IMAGE_MODEL:'gpt-image-2',PLANNER_BASE_URL:'https://api.suanzhou.vip/v1',PLANNER_API_FORMAT:'responses',PLANNER_MODEL:'gpt-6.1-sol',PLANNER_TIMEOUT_MS:'600000',TITLE_MODEL:'gpt-6.1-sol',TITLE_API_FORMAT:'responses'};
const text=(v,max=240)=>typeof v==='string'?v.trim().slice(0,max):'';
const validKey=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const atomic=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);};
function protect(value,decode=false){
  if(process.platform!=='win32')throw fail('密钥持久化当前支持 Windows；其他系统请使用环境变量');
  const script=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${decode?'[Convert]::FromBase64String($v)':'[Text.Encoding]::UTF8.GetBytes($v)'}; $r=[Security.Cryptography.ProtectedData]::${decode?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write(${decode?'[Text.Encoding]::UTF8.GetString($r)':'[Convert]::ToBase64String($r)'})`;
  try{return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:value,encoding:'utf8',windowsHide:true,timeout:15000}).trim();}
  catch{throw fail('无法使用 Windows 账户加密或解密模型密钥');}
}
export function createSettings({directory,configuration,legacyDirectory,codec={encode:v=>protect(v),decode:v=>protect(v,true)}}){
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'settings.json'),secretFile=path.join(directory,'secrets.json');
  const inherited={...configuration};
  let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,revision:0,browsers:[],stores:[],models:{}};
  if(!fs.existsSync(file)&&legacyDirectory&&fs.existsSync(path.join(legacyDirectory,'temu-stores.json'))){
    const b=JSON.parse(fs.readFileSync(path.join(legacyDirectory,'test-draft.json'),'utf8'));
    state.browsers=[{key:b.browserId,browserId:b.browserId,name:'原测试比特窗口',localApi:b.localApi,browserSequence:b.browserSequence}];
    state.stores=JSON.parse(fs.readFileSync(path.join(legacyDirectory,'temu-stores.json'),'utf8')).stores.map(s=>({...s,platform:'temu',browserKey:b.browserId,templates:[{key:'default',name:'默认母稿',draftId:s.draftId,templateName:s.templateName}]}));
    atomic(file,state);
  }
  // Upgrade older browser/store bindings without losing merchant data.
  if(!state.erpConnections){
    state.erpConnections=state.browsers.map(b=>({key:'erp-'+b.key,name:b.name+' · 店小秘',browserKey:b.key,expectedAccount:'',loginUrl:'https://www.dianxiaomi.com/'}));
    for(const s of state.stores)s.erpKey=state.erpConnections.find(e=>e.browserKey===s.browserKey)?.key;
    atomic(file,state);
  }
  state.collectionStores??=[];
  let storedSecrets=fs.existsSync(secretFile)?JSON.parse(codec.decode(JSON.parse(fs.readFileSync(secretFile,'utf8')).protected)):{};
  const apply=()=>{for(const k of [...fields,...secrets]){const value=secrets.includes(k)?storedSecrets[k]??inherited[k]:state.models[k]??inherited[k]??defaults[k];if(value)configuration[k]=value;else delete configuration[k];}};
  apply();
  const view=()=>({...structuredClone(state),erpProviders:structuredClone(Object.values(erpProviders)),platforms:Object.values(platforms),collectionPlatforms:structuredClone(collectionPlatforms),models:{...Object.fromEntries(fields.map(k=>[k,configuration[k]||''])),...Object.fromEntries(secrets.map(k=>[k+'Configured',!!configuration[k]]))}});
  function update(payload,{verifiedTemplates=new Map(),dryRun=false}={}){
    if(payload.revision!==state.revision)throw fail('配置已更新，请刷新后再保存');
    if(payload.models!==undefined){
      if(!payload.models||typeof payload.models!=='object'||Array.isArray(payload.models))throw fail('密钥配置格式无效');
      if(Object.keys(payload.models).some(k=>!secrets.includes(k)))throw fail('服务地址、模型和调用方式由网站内置，不支持修改；请只填写对应服务的密钥。');
      if(Object.values(payload.models).some(v=>typeof v!=='string'||v.length>4000))throw fail('密钥格式无效，请填写不超过 4000 字符的文本');
    }
    const next=structuredClone(state);
    if(payload.browsers!==undefined){
      if(!Array.isArray(payload.browsers)||payload.browsers.length>100)throw fail('浏览器配置数量无效');
      next.browsers=payload.browsers.map(b=>{
        if(!validKey(b.key))throw fail('浏览器编号无效');
        if(b.type==='chrome'){
          if(!text(b.name))throw fail('请填写浏览器名称');
          const connectionMode=b.connectionMode??'dedicated';
          if(!['dedicated','existing'].includes(connectionMode))throw fail('Chrome 连接方式无效');
          if(connectionMode==='existing'){
            const localAppData=process.env.LOCALAPPDATA;
            if(process.platform!=='win32'||!localAppData||!path.isAbsolute(localAppData))throw fail('当前 Chrome 会话连接需要 Windows 本机用户目录。');
            // Only discover Chrome's own endpoint file. Never adopt a path,
            // debugging URL, cookie store, or port supplied by a web request.
            return {key:b.key,type:'chrome',name:text(b.name),connectionMode:'existing',userDataDir:path.join(localAppData,'Google','Chrome','User Data')};
          }
          const port=Number(b.debugPort||9222);if(!Number.isInteger(port)||port<1024||port>65535)throw fail('Chrome 连接端口应为 1024—65535');
          const executable=text(b.executable,1000);if(executable&&(!path.isAbsolute(executable)||path.basename(executable).toLowerCase()!=='chrome.exe'||!fs.existsSync(executable)))throw fail('请选择已安装的 chrome.exe 完整路径，或留空自动查找');
          return {key:b.key,type:'chrome',name:text(b.name),...(b.connectionMode?{connectionMode:'dedicated'}:{}),debugPort:port,localApi:'http://127.0.0.1:'+port,executable,userDataDir:path.resolve(directory,'chrome-profiles',b.key)};
        }
        if(b.type&&b.type!=='bit')throw fail('不支持的浏览器类型');
        if(!validKey(b.browserId))throw fail('比特窗口 ID 无效');
        const u=new URL(b.localApi);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw fail('比特接口须为本机 HTTP 地址，例如 http://127.0.0.1:54346');
        if(!text(b.name))throw fail('请填写浏览器名称');
        const seq=Number(b.browserSequence);if(!Number.isSafeInteger(seq)||seq<1)throw fail('请填写比特窗口序号');
        return {key:b.key,browserId:b.browserId,name:text(b.name),localApi:u.origin,browserSequence:seq};
      });
      if(new Set(next.browsers.map(b=>b.key)).size!==next.browsers.length)throw fail('浏览器编号重复');
      const ports=next.browsers.filter(b=>b.type==='chrome'&&b.connectionMode!=='existing').map(b=>b.debugPort);if(new Set(ports).size!==ports.length)throw fail('Chrome 专用窗口的端口不能重复');
      if(next.browsers.filter(b=>b.type==='chrome'&&b.connectionMode==='existing').length>1)throw fail('当前 Chrome 已有连接配置，请复用该连接绑定 ERP。');
    }
    if(payload.erpConnections!==undefined){
      if(!Array.isArray(payload.erpConnections))throw fail('ERP 连接列表无效');
      next.erpConnections=payload.erpConnections.map(e=>{
        if(!validKey(e.key)||!text(e.name)||!next.browsers.some(b=>b.key===e.browserKey))throw fail('请填写 ERP 连接名称并选择浏览器');
        const provider=erpProviderFor(e.provider??state.erpConnections.find(old=>old.key===e.key)?.provider);
        return {key:e.key,provider:provider.id,name:text(e.name),browserKey:e.browserKey,expectedAccount:text(e.expectedAccount),loginUrl:provider.loginUrl};
      });
      if(new Set(next.erpConnections.map(e=>e.key)).size!==next.erpConnections.length)throw fail('ERP 连接编号重复');
    }
    if(payload.stores!==undefined){
      if(!Array.isArray(payload.stores)||payload.stores.length>500)throw fail('店铺配置数量无效');
      next.stores=payload.stores.map(s=>{
        platformFor(s.platform);if(!validKey(s.key)||!text(s.expectedStore)||!text(s.expectedSite))throw fail('请填写店铺名称、站点和唯一编号');
        // A configured content destination is independent of an implemented ERP runner.
        // Temu retains its complete mother-product validation and execution binding.
        const inputTemplates=s.templates??(s.platform==='amazon'?[]:undefined);
        if(!Array.isArray(inputTemplates)||(s.platform==='temu'&&!inputTemplates.length)||inputTemplates.length>100)throw fail('每家 Temu 店至少配置一个商品母稿');
        const templates=inputTemplates.map(t=>{const draftId=text(t.draftId);if(!validKey(t.key)||!/^\d{6,30}$/.test(draftId)||!text(t.name))throw fail('请填写母稿名称和有效的母稿链接或数字 ID');
          const result={key:t.key,name:text(t.name),draftId};
          const verified=verifiedTemplates.get(s.key+':'+t.key),oldStore=state.stores.find(old=>old.key===s.key),old=oldStore?.templates.find(old=>old.key===t.key);
          // Retain old metadata for history, but it never selects the source product.
          for(const k of ['templateName','templateId'])if(old?.[k])result[k]=old[k];
          const proof=verified?.sourceMode==='product'&&verified.draftId===draftId?verified:oldStore?.platform===s.platform&&oldStore?.erpKey===s.erpKey&&oldStore?.expectedStore===s.expectedStore&&oldStore?.expectedSite===s.expectedSite&&old?.draftId===draftId&&old?.sourceMode==='product'?old:null;
          if(proof){result.sourceMode='product';result.verifiedAt=proof.checkedAt||proof.verifiedAt;for(const k of ['shippingTemplate','sourceTitle','category','actualStore','actualSite'])if(proof[k])result[k]=proof[k];}
          return result;
        });
        if(new Set(templates.map(t=>t.key)).size!==templates.length)throw fail('母稿编号重复');
        let erp=next.erpConnections.find(e=>e.key===s.erpKey);
        if(s.erpKey&&!erp)throw fail('ERP 连接不存在');
        if(!erp){erp=next.erpConnections.find(e=>e.browserKey===s.browserKey&&(e.provider||'dianxiaomi')==='dianxiaomi');if(!erp){erp={key:'erp-'+s.browserKey,name:'店小秘连接',browserKey:s.browserKey,expectedAccount:'',loginUrl:'https://www.dianxiaomi.com/'};if(next.erpConnections.some(e=>e.key===erp.key))throw fail('请明确选择店小秘连接');next.erpConnections.push(erp);}}
        return {key:s.key,platform:s.platform,expectedStore:text(s.expectedStore),expectedSite:text(s.expectedSite),erpKey:erp.key,browserKey:erp.browserKey,templates,...(templates[0]?{draftId:templates[0].draftId}:{}),...(templates[0]?.templateName?{templateName:templates[0].templateName}:{})};
      });
      if(new Set(next.stores.map(s=>s.key)).size!==next.stores.length)throw fail('店铺编号重复');
    }
    next.collectionStores=normalizeCollectionStores(payload.collectionStores===undefined?next.collectionStores:payload.collectionStores,{erpConnections:next.erpConnections,browsers:next.browsers});
    for(const e of next.erpConnections)if(!next.browsers.some(b=>b.key===e.browserKey))throw fail('ERP 关联的浏览器不存在，请先调整 ERP 连接');
    for(const s of next.stores){const e=next.erpConnections.find(e=>e.key===s.erpKey);if(!e)throw fail('店铺关联的 ERP 连接不存在');if(s.platform==='temu')requireListingProvider(e,s.platform);s.browserKey=e.browserKey;
      const before=state.erpConnections.find(old=>old.key===s.erpKey),browser=next.browsers.find(b=>b.key===e.browserKey),oldBrowser=state.browsers.find(b=>b.key===before?.browserKey);
      if(JSON.stringify(before)!==JSON.stringify(e)||JSON.stringify(browser)!==JSON.stringify(oldBrowser))for(const t of s.templates)if(!verifiedTemplates.has(s.key+':'+t.key)){delete t.verifiedAt;delete t.shippingTemplate;delete t.sourceMode;}
    }
    const nextSecrets={...storedSecrets};
    if(payload.models){
      for(const k of secrets)if(Object.hasOwn(payload.models,k)&&payload.models[k])nextSecrets[k]=text(payload.models[k],4000);
      for(const k of payload.clearSecrets||[])if(secrets.includes(k))nextSecrets[k]='';
    }
    if(dryRun)return next;
    // Encrypt before modifying settings, so a failed encryption cannot partially apply configuration.
    const encrypted=JSON.stringify(nextSecrets)!==JSON.stringify(storedSecrets)?codec.encode(JSON.stringify(nextSecrets)):null;
    if(encrypted)atomic(secretFile,{version:1,protected:encrypted});
    next.revision++;atomic(file,next);state=next;storedSecrets=nextSecrets;apply();return view();
  }
  const browser=key=>{const b=state.browsers.find(b=>b.key===key);if(!b)throw fail('请选择已配置的浏览器');return structuredClone(b);};
  const erp=key=>{const e=state.erpConnections.find(e=>e.key===key);if(!e)throw fail('请选择 ERP 连接');return structuredClone(e);};
  const store=key=>{const s=state.stores.find(s=>s.key===key);if(!s)throw fail('请选择已配置的店铺');return structuredClone(s);};
  const collectionStore=key=>{const s=state.collectionStores.find(s=>s.key===key);if(!s)throw fail('请选择已绑定的采集箱店铺');return structuredClone(s);};
  return {view,update,preview:payload=>update(payload,{dryRun:true}),browser,store,collectionStore,erp};
}
