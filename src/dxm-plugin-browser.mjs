import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const DXM_EXTENSION_ID='ioadaikpljilagoddljnamloiebcoopb';
export const DXM_PLUGIN_URLS=Object.freeze({
  install:'https://chromewebstore.google.com/detail/'+DXM_EXTENSION_ID,
  manage:'chrome://extensions/?id='+DXM_EXTENSION_ID,
  help:'https://help.dianxiaomi.com/article/productManagement/170'
});

// Observe only rendered Chrome controls. No extension storage, private Chrome
// APIs, component data objects, login cookies or account credentials are read.
export async function readDxmExtensionsPage({extensionId}){
  const foreground=()=>!document.hidden&&document.visibilityState==='visible';
  if(!foreground())return {status:'unknown',reason:'background'};
  // Chrome initially renders only a small batch of extension cards. Its
  // remaining cards are appended on animation frames, which can stop in a
  // background or minimized page. Confirm actual painting before reading DOM.
  const painted=await new Promise(resolve=>{
    let frame,frames=0,finished=false;
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timeout);cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibilityChanged);resolve(value);};
    const visibilityChanged=()=>{if(!foreground())finish(false);};
    const timeout=setTimeout(()=>finish(false),1000);
    const tick=()=>{if(!foreground())return finish(false);if(++frames===2)return finish(true);frame=requestAnimationFrame(tick);};
    document.addEventListener('visibilitychange',visibilityChanged);
    frame=requestAnimationFrame(tick);
  });
  if(!painted||!foreground())return {status:'unknown',reason:'not-painted'};
  const roots=[document];
  for(let index=0;index<roots.length;index++)for(const element of roots[index].querySelectorAll('*'))if(element.shadowRoot)roots.push(element.shadowRoot);
  const all=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)]);
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none';
  const text=element=>visible(element)?element.textContent.trim().slice(0,160):'';
  const managers=all('extensions-manager').filter(visible),lists=all('extensions-item-list').filter(visible);
  if(managers.length!==1||lists.length!==1||document.readyState!=='complete'||all('[aria-busy="true"],cr-spinner[active]').some(visible)||all('input[type="search"],input#searchInput').some(element=>visible(element)&&element.value.trim()))return {status:'unknown'};
  const items=all('extensions-item').filter(visible);
  const matches=items.filter(element=>element.id===extensionId);
  const localRoots=element=>{const result=[element];for(let index=0;index<result.length;index++){if(result[index].shadowRoot)result.push(result[index].shadowRoot);for(const child of result[index].querySelectorAll('*'))if(child.shadowRoot&&!result.includes(child.shadowRoot))result.push(child.shadowRoot);}return result;};
  const values=element=>{const scopes=localRoots(element),find=selector=>scopes.flatMap(root=>[...root.querySelectorAll(selector)]).find(visible);return {name:text(find('#name')),version:text(find('#version')),find};};
  if(matches.length>1)return {status:'unknown'};
  if(!matches.length){
    if(items.some(item=>values(item).name.replace(/\s/g,'')==='店小秘助手'))return {status:'unknown',reason:'different-id'};
    const empty=all('#no-items').some(element=>!!text(element));
    if(!items.length&&!empty||items.some(item=>!/^[a-p]{32}$/.test(item.id)||!values(item).name))return {status:'unknown'};
    return {status:'missing',fingerprint:items.map(item=>item.id).sort().join(',')||'empty'};
  }
  const {name,version,find}=values(matches[0]);
  if(name.replace(/\s/g,'')!=='店小秘助手')return {status:'unknown'};
  const toggle=find('cr-toggle#enableToggle'),pressed=toggle?.getAttribute('aria-pressed'),checked=toggle?.getAttribute('aria-checked');
  const states=[pressed,checked].filter(value=>value==='true'||value==='false');
  if(new Set(states).size>1)return {status:'unknown',name,version};
  const enabled=states.length?states[0]==='true':toggle?.hasAttribute('checked')?true:null;
  if(enabled===null)return {status:'unknown',name,version};
  const warning=['#corrupted-warning','#suspicious-warning','#blocklisted-warning','#unsupported-developer-extension-warning','#mv2-deprecation-warning'].some(selector=>!!text(find(selector)));
  return {status:enabled&&!warning?'ready':'disabled',name,version};
}

export function createDxmPluginBrowser(configuration={},transport){
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const library=async()=>{
    if(transport)return transport;
    const directory=path.join(configuration.WORKBENCH_ADAPTER_ROOT||path.join(project,'scripts'),'lib');
    const modules=await Promise.all(['bit-cdp.mjs','chrome-cdp.mjs','chrome-owner.mjs'].map(file=>import(pathToFileURL(path.join(directory,file)).href)));
    return Object.assign({},...modules);
  };
  const result=(status,message,observed={})=>({status,message,name:observed.name||'店小秘助手',version:observed.version||'',checkedAt:new Date().toISOString()});
  const isExisting=browserConfig=>browserConfig?.connectionMode==='existing';
  const label=browserConfig=>isExisting(browserConfig)?'已有谷歌窗口':'专用谷歌窗口';
  const unknown=(browserConfig,reason)=>result('unknown',['background','not-painted'].includes(reason)?'插件列表尚未完成显示。请将采集绑定的谷歌窗口恢复并置于前台，再点击“重新检测”，检查期间保持该窗口可见。原任务保留，尚未继续采集。':isExisting(browserConfig)?'暂时无法确认已有谷歌窗口的店小秘插件状态，请先确认 Chrome 远程调试授权，再打开插件管理重新检测；原任务保留，尚未继续采集。':'暂时无法确认这个专用窗口的店小秘插件状态，请打开插件管理检查后重新检测；尚未开始采集。');
  const valid=browserConfig=>browserConfig?.type==='chrome';

  async function check({browserConfig}={}){
    if(!valid(browserConfig))return unknown(browserConfig);
    let chrome,page,targetId,lastReadReason='';
    try{
      const lib=await library();
      if(!isExisting(browserConfig)){
        const owner=await lib.inspectChromeOwner(browserConfig);
        if(owner==='closed')return result('browser-closed','采集专用谷歌窗口尚未打开，请先打开插件安装或管理入口。');
        if(owner!=='owned')return unknown(browserConfig);
      }
      // connection verifies ownership and consent for existing Chrome through
      // its dedicated adapter. The --user-data-dir owner check applies only to
      // workbench-created profiles and must not be used for normal Chrome.
      // Never fall back to creating a fresh profile if consent is unavailable.
      const info=await lib.connection(browserConfig);chrome=await lib.connect(info.ws);
      ({targetId}=await chrome.send('Target.createTarget',{url:'chrome://extensions/',background:false}));
      await chrome.send('Target.activateTarget',{targetId});
      page=await lib.pageById(info,targetId);
      await page.send('Page.bringToFront');
      let previous='',stableSince=0;
      const observed=await lib.poll(async()=>{
        if(await page.evaluate(()=>location.href)!=='chrome://extensions/'){previous='';stableSince=0;lastReadReason='';return false;}
        const current=await page.evaluate(readDxmExtensionsPage,{extensionId:DXM_EXTENSION_ID});
        lastReadReason=current?.status==='unknown'?current.reason||'':'';
        if(['ready','disabled'].includes(current?.status))return current;
        if(current?.status!=='missing'){previous='';stableSince=0;return false;}
        // Each read has witnessed foreground animation frames. Also require a
        // stable, unfiltered list; a hidden/stalled read resets this evidence.
        if(current.fingerprint!==previous){previous=current.fingerprint;stableSince=Date.now();}
        return Date.now()-stableSince>=1000?current:false;
      },{timeout:8000,interval:250,label:'店小秘插件状态'});
      if(observed.status==='ready')return result('ready','已检测到店小秘助手已启用。请保持在此窗口登录绑定账号并关闭自动认领；插件检测不代表登录或采集成功。',observed);
      if(observed.status==='disabled')return result('disabled','此'+label(browserConfig)+'已安装店小秘助手，但插件未启用或被浏览器阻止。请在插件管理中启用并确认浏览器提示的权限，再重新检测。',observed);
      if(observed.status==='missing')return result('missing',isExisting(browserConfig)?'当前连接的已有谷歌窗口未检测到官方店小秘助手。请确认连接的是已经安装插件的正确浏览器资料，并在插件管理中核对。':'此专用窗口未检测到官方店小秘助手。请在这个窗口安装插件；平常谷歌窗口里已有的插件不会自动带入。');
      return unknown(browserConfig,lastReadReason);
    }catch{return unknown(browserConfig,lastReadReason);}
    finally{
      page?.close();
      if(chrome&&targetId)await chrome.send('Target.closeTarget',{targetId}).catch(()=>{});
      chrome?.close();
    }
  }

  async function openSetup({browserConfig,view='install'}={}){
    if(!valid(browserConfig))throw Object.assign(new Error('请选择绑定的谷歌浏览器。'),{status:400});
    if(!Object.hasOwn(DXM_PLUGIN_URLS,view))throw Object.assign(new Error('插件设置入口无效。'),{status:400});
    const lib=await library(),info=await lib.openChrome(browserConfig),chrome=await lib.connect(info.ws),url=DXM_PLUGIN_URLS[view];
    try{
      const existing=(await info.targets()).find(target=>target.type==='page'&&target.url===url);
      const targetId=existing?.id||(await chrome.send('Target.createTarget',{url})).targetId;
      await chrome.send('Target.activateTarget',{targetId});
      const instruction=view==='install'?(isExisting(browserConfig)?'已安装时无需重复安装；请按商店显示的状态核对。':'请点击“添加至 Chrome”并确认安装权限。'):view==='manage'?'请确认店小秘助手已启用，并处理浏览器的权限提示。':(isExisting(browserConfig)?'请按照官方教程核对插件安装与启用状态。':'请按照官方教程在此窗口安装店小秘助手。');
      return {opened:true,view,browserName:browserConfig.name||label(browserConfig),message:'已在采集绑定的'+label(browserConfig)+'打开插件'+(view==='install'?'安装页':view==='manage'?'管理页':'教程')+'。'+instruction+'完成后返回工作台重新检测，已保存的插件会在以后继续使用。'};
    }finally{chrome.close();}
  }
  return {check,openSetup};
}
