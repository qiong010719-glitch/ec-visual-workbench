import fs from 'node:fs';
import path from 'node:path';
import {createWorkbench,root} from '../src/server.mjs';
const directory=path.join(root,'reference/style-learning-20261101/preview-data');
if(!fs.existsSync(path.join(directory,'workbench.json')))throw new Error('Prepare the isolated preview first');
if(fs.existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
const app=createWorkbench({dataDirectory:directory,configuration:{...process.env,WORKBENCH_STYLE_PREVIEW:'true',SUANZHOU_IMAGE_RESPONSE_FORMAT:'b64_json'}});
app.server.listen(4174,'127.0.0.1',()=>console.log('场景风格更新预览：http://127.0.0.1:4174（独立数据副本）'));
