import {createDxmListingPreparer} from './dxm-listing-prepare.mjs';

export function createDxmListingDispatcher(configuration={}){
  const temu=createDxmListingPreparer(configuration);
  let tiktok;
  const adapter=async platform=>{
    if(platform==='temu')return temu;
    if(platform==='tiktok')return tiktok??=await import('./dxm-tiktok-prepare.mjs').then(m=>m.createDxmTiktokPreparer(configuration));
    throw new Error('当前目标平台尚未接入自动补全');
  };
  return {
    readDefaults:async args=>(await adapter(args.store?.platform||args.targetStore?.platform)).readDefaults(args),
    prepare:async args=>(await adapter(args.targetStore?.platform)).prepare(args),
    verify:async args=>{const instance=await adapter(args.targetStore?.platform);return instance.verify?instance.verify(args):{status:'needs-review',ready:false,saved:false,published:false,issues:['该平台暂不能只读确认上次保存结果，未重新保存']};}
  };
}
