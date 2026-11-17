import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count=0;
for(const folder of ['public/original','public/local']) for(const name of fs.readdirSync(path.join(root,folder))) {
  if(!name.endsWith('.js'))continue;
  new vm.Script(fs.readFileSync(path.join(root,folder,name),'utf8'),{filename:name});count++;
}
for(const page of ['index.html','temu.html','temu-listings.html','merchant.html']) {
const html=fs.readFileSync(path.join(root,'public',page),'utf8');
for(const match of html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="([^"#]+)"/g)) {
  if(/^(https?:|data:|blob:)/.test(match[1]))continue;
  if(!fs.existsSync(path.join(root,'public',match[1])))throw new Error('Missing asset: '+match[1]);
}
}
console.log(`已检查 ${count} 个页面脚本语法，静态资源引用齐全。`);
