const path=require('node:path');

function desktopProfile({env=process.env,root,packaged,resourcesPath,userDataPath}){
  const isolated=!!env.WORKBENCH_DESKTOP_DATA;
  const dataDirectory=isolated?path.resolve(env.WORKBENCH_DESKTOP_DATA):packaged?path.join(userDataPath,'workspace'):path.join(root,'data');
  const test=env.WORKBENCH_DESKTOP_TEST==='true';
  const port=test?0:Number(env.WORKBENCH_DESKTOP_PORT||(isolated?4191:4185));
  if(!test&&(!Number.isInteger(port)||port<1024||port>65535))throw new Error('工作台端口应为 1024—65535');
  // An isolated profile must not inherit API keys or legacy stores from the host.
  const configuration=packaged||isolated?{
    WORKBENCH_FRESH:'true',
    WORKBENCH_ADAPTER_ROOT:packaged?path.join(resourcesPath,'erp-scripts'):path.resolve(root,'../scripts')
  }:{...env};
  const primary=env.WORKBENCH_DESKTOP_PRIMARY==='true';
  return {dataDirectory,configuration,port,test,isolated,reuseService:(!isolated||primary)&&port!==0,
    title:isolated&&!primary?'独立预览 · 跨境电商工作台':'跨境电商工作台'};
}

module.exports={desktopProfile};
