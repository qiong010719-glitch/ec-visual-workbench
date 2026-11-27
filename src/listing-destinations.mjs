const fail=message=>Object.assign(new Error(message),{status:400});
const keyPattern=/^[a-zA-Z0-9_-]{1,100}$/;
export const collectionPlatforms=Object.freeze([
  {id:'temu',name:'Temu 半托管'},
  {id:'shein',name:'SHEIN 希音'},
  {id:'tiktok',name:'TikTok'}
]);
const fields=new Set(['key','erpKey','platform','storeName','storeId','site']);
const value=(input,label,max=240)=>{
  if(input===undefined||input===null)return '';
  if(typeof input!=='string'||input.length>max)throw fail(`${label}格式无效`);
  return input.trim();
};
export const collectionDestinationGroup=destination=>JSON.stringify([destination.erpKey,destination.platform,String(destination.site||'').trim().replace(/站$/,'')]);
// SHEIN's collection dialog selects a store, not a sales site. Keep the
// configured site on the binding; only project the actual claim destination.
export const collectionClaimDestination=destination=>({...destination,site:destination.platform==='shein'?'':String(destination.site||'').trim()});

// A SHEIN checkbox can expose only the native default value "on". An absent
// DOM ID is not a different ID: use the unique exact platform/name in that
// account's dialog, while continuing to reject any observed ID conflict.
export function resolveCollectionClaimStore(target,shops){
  if(!Array.isArray(shops))throw fail('未读取认领弹窗的店铺列表');
  const named=shops.filter(shop=>shop.platform===target.platform&&shop.storeName===target.storeName);
  if(!named.length)throw fail('当前账号的目标平台下未找到店铺：'+target.storeName);
  let matches=target.storeId?named.filter(shop=>shop.storeId===target.storeId):named;
  if(target.storeId&&!matches.length){
    if(named.some(shop=>shop.storeId))throw fail('店铺编号与工作台绑定不一致：'+target.storeName+'；请核对绑定的店小秘店铺 ID');
    if(target.platform!=='shein')throw fail('已找到店铺，但当前页面未提供可核对的店铺编号：'+target.storeName);
    matches=named;
  }
  if(matches.length!==1)throw fail('目标平台存在重名店铺，无法唯一识别：'+target.storeName);
  if(matches[0].disabled)throw fail('目标店铺已停用：'+target.storeName);
  return matches[0];
}

export function assertCollectionClaimIdentities(actual,expected,evidence,account){
  if(evidence&&(!account||evidence.account!==account||evidence.pageUrl!=='https://www.dianxiaomi.com/web/productCrawl/dataAcquisition'||!Array.isArray(evidence.shops)))throw fail('认领店铺核对证据的账号或页面不一致');
  const siteKey=site=>String(site||'').trim().replace(/站$/,'');
  for(const target of expected){
    const matches=actual.filter(item=>item.platform===target.platform&&item.storeName===target.storeName&&siteKey(item.site)===siteKey(target.site));
    if(matches.length!==1)throw fail('认领店铺目的地不一致');
    const observed=matches[0],shop=evidence?resolveCollectionClaimStore(target,evidence.shops):null;
    if(shop&&String(shop.storeId||'')!==String(observed.storeId||''))throw fail('认领店铺编号与弹窗核对证据不一致');
    if(target.storeId&&target.storeId!==observed.storeId){
      if(target.platform!=='shein'||observed.storeId||!shop||shop.storeId)throw fail('认领店铺编号与工作台绑定不一致，未提交');
    }
  }
}
export function normalizeCollectionStores(input,{erpConnections=[],browsers=[]}={}){
  if(!Array.isArray(input)||input.length>500)throw fail('采集箱店铺绑定数量无效');
  const stores=input.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(name=>!fields.has(name)))throw fail('采集箱店铺绑定包含无效字段');
    const key=value(item.key,'采集箱店铺编号',100),erpKey=value(item.erpKey,'ERP账号编号',100);
    if(!keyPattern.test(key)||!keyPattern.test(erpKey))throw fail('请选择有效的采集箱店铺编号和ERP账号');
    const platform=value(item.platform,'目标平台',40),storeName=value(item.storeName,'店铺名称'),storeId=value(item.storeId,'店铺ID',100),site=value(item.site,'经营站点',160);
    if(!collectionPlatforms.some(candidate=>candidate.id===platform))throw fail('采集箱店铺支持 Temu、SHEIN 和 TikTok');
    if(!storeName)throw fail('请填写店小秘中的完整店铺名称');
    if(platform==='temu'&&!site)throw fail('Temu 采集箱店铺需要填写经营站点');
    const erp=erpConnections.find(connection=>connection.key===erpKey);
    if(!erp||(erp.provider||'dianxiaomi')!=='dianxiaomi')throw fail('采集箱店铺需要绑定已配置的店小秘账号');
    if(!browsers.some(browser=>browser.key===erp.browserKey&&browser.type==='chrome'))throw fail('采集箱店铺的店小秘账号需要绑定 Chrome');
    return {key,erpKey,platform,storeName,...(storeId?{storeId}:{}),site};
  });
  if(new Set(stores.map(store=>store.key)).size!==stores.length)throw fail('采集箱店铺编号重复');
  const identities=stores.map(store=>JSON.stringify([store.erpKey,store.platform,store.storeName,store.site.replace(/站$/,'')]));
  if(new Set(identities).size!==identities.length)throw fail('同一账号的平台、店铺和站点不能重复绑定');
  const idIdentities=stores.filter(store=>store.storeId).map(store=>JSON.stringify([store.erpKey,store.platform,store.storeId,store.site.replace(/站$/,'')]));
  if(new Set(idIdentities).size!==idIdentities.length)throw fail('同一平台店铺ID和站点不能重复绑定');
  return stores;
}
