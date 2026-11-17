import * as asar from '@electron/asar';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const release=path.resolve(process.argv[2]||'dist/new-computer-20261111');
const version=process.argv[3]||'1.0.1-test.1';
const resources=path.join(release,'win-unpacked','resources'),archive=path.join(resources,'app.asar');
const executable=path.join(release,`Temu-Workbench-${version}-win-x64.exe`);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const files=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(directory,item.name)):[path.join(directory,item.name)]);
const entries=asar.listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''));
const roots=[...new Set(entries.map(name=>name.split('/')[0]))].sort();
assert.deepEqual(roots,['desktop','node_modules','package.json','public','src']);
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,version);
const compared=[];
for(const directory of ['desktop','src','public'])for(const file of files(directory)){
  if(file.endsWith('.map'))continue;
  const key=file.replaceAll('\\','/');assert.equal(hash(asar.extractFile(archive,file)),hash(fs.readFileSync(file)),key+' is not the current source');compared.push(key);
}
const bundledAdapters=files(path.join(resources,'erp-scripts'));
for(const file of bundledAdapters){
  const relative=path.relative(path.join(resources,'erp-scripts'),file);
  assert.ok(relative==='inspect-draft.mjs'||/^lib[\\/][^\\/]+\.mjs$/.test(relative),'unexpected ERP payload');
  assert.equal(hash(fs.readFileSync(file)),hash(fs.readFileSync(path.join('..','scripts',relative))),relative+' is not the current ERP source');
}
for(const required of ['lib/temu-runner.mjs','lib/temu-mothers.mjs','lib/bit-cdp.mjs','lib/chrome-cdp.mjs'])assert.ok(fs.existsSync(path.join(resources,'erp-scripts',required)));
assert.ok(fs.existsSync(executable));
const report={passed:true,auditedAt:new Date().toISOString(),version,artifact:path.basename(executable),bytes:fs.statSync(executable).size,sha256:hash(fs.readFileSync(executable)),sourceFilesCompared:compared.length,erpFilesCompared:bundledAdapters.length,archiveRoots:roots,checks:['packaged sources equal the current workspace sources','ERP modules equal current adapter sources','package metadata contains the test version','no project data, environment files, saved stores or development config in package roots'],distributionStatus:'unsigned internal test build; fresh-computer acceptance pending'};
const output=path.resolve(process.argv[4]||'tests/results/fresh-install');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'package-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
