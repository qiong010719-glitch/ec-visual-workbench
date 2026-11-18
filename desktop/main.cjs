const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {desktopProfile}=require('./profile.cjs');
let window,workbench,origin,quitting=false;
if(process.env.WORKBENCH_DESKTOP_DATA)app.setPath('userData',path.resolve(process.env.WORKBENCH_DESKTOP_DATA));
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(async()=>{
    const root=path.resolve(__dirname,'..');
    const profile=desktopProfile({root,packaged:app.isPackaged,resourcesPath:process.resourcesPath,userDataPath:app.getPath('userData')});
    const {dataDirectory,configuration,port}=profile;
    const {createWorkbench,WORKSPACE_REVISION}=await import(pathToFileURL(path.join(root,'src/server.mjs')).href);
    const {ERP_AUTOMATION_REVISION}=await import(pathToFileURL(path.join(root,'src/erp.mjs')).href);
    const {SINGLE_DESIGN_REVISION}=await import(pathToFileURL(path.join(root,'src/single-design.mjs')).href);
    const {TEMU_DESIGN_REVISION}=await import(pathToFileURL(path.join(root,'src/image-scope.mjs')).href);
    const {COPY_REPAIR_REVISION}=await import(pathToFileURL(path.join(root,'src/copy-review.mjs')).href);
    const {SOURCING_REVISION}=await import(pathToFileURL(path.join(root,'src/sourcing.mjs')).href);
    let reused=false;
    if(profile.reuseService){try{const r=await fetch('http://127.0.0.1:'+port+'/api/status',{signal:AbortSignal.timeout(1200)});const s=await r.json();if(s.workbenchVersion==='merchant-1'&&s.workspaceRevision===WORKSPACE_REVISION&&s.sourcingRevision===SOURCING_REVISION&&s.copyRepairRevision===COPY_REPAIR_REVISION&&s.erpAutomationRevision===ERP_AUTOMATION_REVISION&&s.singleDesignRevision===SINGLE_DESIGN_REVISION&&s.temuDesignRevision===TEMU_DESIGN_REVISION){reused=true;origin='http://127.0.0.1:'+port;}else throw new Error('旧版本工作台服务仍在运行，请完成当前任务并关闭旧工作台及旧服务，再启动新版。');}catch(e){if(e.message.startsWith('旧版本'))throw e;}}
    if(!reused){
      workbench=createWorkbench({dataDirectory,configuration});
      await new Promise((resolve,reject)=>{workbench.server.once('error',error=>reject(profile.isolated&&error.code==='EADDRINUSE'?new Error('测试工作台端口 '+port+' 已被占用。请关闭占用该端口的程序后重开；本次没有连接其他工作台。'):error));workbench.server.listen(port,'127.0.0.1',resolve);});
      origin='http://127.0.0.1:'+workbench.server.address().port;
    }
    const trusted=e=>e.sender===window?.webContents&&e.senderFrame?.url?.startsWith(origin+'/');
    ipcMain.handle('choose-folder',async e=>{if(!trusted(e))throw new Error('无效窗口');const r=await dialog.showOpenDialog(window,{title:'选择素材或导出文件夹',properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];});
    window=new BrowserWindow({width:1440,height:1000,minWidth:1000,minHeight:720,show:false,title:profile.title,backgroundColor:'#f8fafc',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    if(profile.isolated)window.on('page-title-updated',event=>{event.preventDefault();window.setTitle(profile.title);});
    const external=async url=>{try{const u=new URL(url);if(['http:','https:'].includes(u.protocol))await shell.openExternal(url);}catch{}};
    window.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith(origin+'/media/')){const child=new BrowserWindow({width:900,height:900,parent:window,autoHideMenuBar:true,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});child.loadURL(url);}else external(url);return {action:'deny'};});
    window.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(origin+'/')){e.preventDefault();external(url);}});
    window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    window.on('close',e=>{
      if(quitting)return;
      if(workbench?.isBusy()){e.preventDefault();dialog.showMessageBox(window,{type:'info',message:'任务还在运行',detail:'请在工作台暂停任务并等当前商品完成，再关闭窗口。',buttons:['继续查看']});return;}
      quitting=true;workbench?.server.close();
    });
    await window.loadURL(origin+'/products');window.show();
    if(process.env.WORKBENCH_DESKTOP_TEST==='true')fs.writeFileSync(path.join(dataDirectory,'desktop-ready.json'),JSON.stringify({origin,packaged:app.isPackaged}));
  }).catch(error=>{dialog.showErrorBox('工作台启动失败',error.message);quitting=true;app.quit();});
  app.on('window-all-closed',()=>{if(!workbench?.isBusy())app.quit();});
}
