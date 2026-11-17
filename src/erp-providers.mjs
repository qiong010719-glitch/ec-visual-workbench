export const erpProviders=Object.freeze({
  dianxiaomi:{id:'dianxiaomi',name:'店小秘',loginUrl:'https://www.dianxiaomi.com/',listingPlatforms:['temu'],status:'已接入 Temu 半托管'},
  miaoshou:{id:'miaoshou',name:'妙手 ERP',loginUrl:'https://erp.91miaoshou.com/',listingPlatforms:[],status:'可配置连接；自动上架待联调'}
});

export function erpProviderFor(id='dianxiaomi'){
  if(!Object.hasOwn(erpProviders,id))throw Object.assign(new Error('不支持的 ERP 类型'),{status:400});
  return erpProviders[id];
}

export function requireListingProvider(connection,platform='temu'){
  const provider=erpProviderFor(connection?.provider);
  if(!provider.listingPlatforms.includes(platform))throw Object.assign(new Error(`${provider.name} 的自动上架尚未接入，请先完成目标平台、店铺及母稿联调。`),{status:409});
  return provider;
}
