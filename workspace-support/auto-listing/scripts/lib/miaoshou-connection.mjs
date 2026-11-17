import {connection,connect} from './bit-cdp.mjs';
import {openChrome} from './chrome-cdp.mjs';

const loginUrl='https://erp.91miaoshou.com/';

export function connectionStatus(targets,browserConfig){
  const erpOpen=targets.some(t=>{try{const u=new URL(t.url);return t.type==='page'&&u.protocol==='https:'&&u.hostname==='erp.91miaoshou.com';}catch{return false;}});
  // Seeing an ERP tab does not prove either authentication or the account identity.
  return {connected:true,browserKey:browserConfig.key||browserConfig.browserId,erpOpen,loggedIn:null,accountMatched:null,loginVerificationSupported:false,listingReady:false,
    message:erpOpen?'妙手页面已打开；登录账号与自动上架尚待联调，当前仅确认浏览器连接。':'浏览器已连接，请点击“打开妙手 ERP 登录”。',checkedAt:new Date().toISOString()};
}

export async function checkConnection(browserConfig){
  const info=await connection(browserConfig);
  return connectionStatus(await info.targets(),browserConfig);
}

export async function openLogin(browserConfig){
  const info=browserConfig.type==='chrome'?await openChrome(browserConfig):await connection(browserConfig),browser=await connect(info.ws);
  try{await browser.send('Target.createTarget',{url:loginUrl});return {opened:true,message:'妙手登录页面已打开，请在该窗口完成登录。自动上架尚待联调。'};}
  finally{browser.close();}
}
