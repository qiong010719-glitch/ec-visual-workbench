import path from 'node:path';
import {createWorkbench,root} from '../src/server.mjs';
const dataDirectory=path.resolve(root,'../preview-data');
const app=createWorkbench({dataDirectory,configuration:{WORKBENCH_FRESH:'true',WORKBENCH_STYLE_PREVIEW:'true',WORKBENCH_ADAPTER_ROOT:path.resolve(root,'../scripts')}});
const port=Number(process.env.WORKBENCH_PREVIEW_PORT||4195);
app.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'预览端口已被占用，未连接或修改其他工作台。':error.message);process.exitCode=1;});
app.server.listen(port,'127.0.0.1',()=>console.log('跨境工作台独立预览：http://127.0.0.1:'+port+'/products\n数据目录：'+dataDirectory+'\n未复制原工作台密钥，也未启动生成或上架任务。'));
