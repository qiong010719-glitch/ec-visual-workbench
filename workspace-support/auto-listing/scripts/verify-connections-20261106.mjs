import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {openChrome,chromeConnection} from './lib/chrome-cdp.mjs';
import {config,connect} from './lib/bit-cdp.mjs';
import {checkConnection,openLogin} from './lib/temu-runner.mjs';
const directory=path.resolve('outputs/connection-folder-publish-20261106');fs.mkdirSync(directory,{recursive:true});
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const debugPort=server.address().port;await new Promise(r=>server.close(r));
const chrome={key:'chrome-check',type:'chrome',name:'Chrome验证专用',debugPort,userDataDir:path.join(directory,'chrome-profile')};
let info;const report={at:new Date().toISOString(),realErpWrites:0};
try{
  info=await openChrome(chrome);report.chromeConnected=!!info.ws;
  await openLogin(chrome);const status=await checkConnection(chrome);report.chrome={connected:status.connected,erpOpen:status.erpOpen,loggedIn:status.loggedIn};
  const again=await chromeConnection(chrome);report.chromeReusesSameProfile=info.ws===again.ws;
  const bit=await checkConnection(config);report.bit={connected:bit.connected,erpOpen:bit.erpOpen,loggedIn:bit.loggedIn};
}finally{if(info){const browser=await connect(info.ws);try{await browser.send('Browser.close').catch(()=>{});}finally{browser.close();}}fs.writeFileSync(path.join(directory,'connections.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
