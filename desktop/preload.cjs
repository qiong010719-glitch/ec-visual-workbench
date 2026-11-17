const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',Object.freeze({chooseFolder:()=>ipcRenderer.invoke('choose-folder')}));
