import path from 'node:path';
import net from 'node:net';
import {createWorkbench,root} from '../src/server.mjs';

// Check the port before initializing services, which recover local task state.
const port=4196;
const occupied=await new Promise(resolve=>{
  const socket=net.connect({host:'127.0.0.1',port});
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',()=>resolve(false));
});
if(occupied)throw new Error('Port 4196 is occupied; no workspace data has been opened.');
const app=createWorkbench({dataDirectory:path.resolve(root,'../desktop-preview-data'),configuration:{WORKBENCH_FRESH:'true',WORKBENCH_ADAPTER_ROOT:path.resolve(root,'../scripts')}});
app.server.listen(port,'127.0.0.1',()=>console.log('Crossborder workspace: http://127.0.0.1:4196/cockpit.html'));
