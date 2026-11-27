import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[root],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,
  WORKBENCH_DESKTOP_DATA:process.env.WORKBENCH_DESKTOP_DATA||path.resolve(root,'../desktop-preview-data'),
  WORKBENCH_DESKTOP_PORT:process.env.WORKBENCH_DESKTOP_PORT||'4196',WORKBENCH_DESKTOP_PRIMARY:'true'}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
