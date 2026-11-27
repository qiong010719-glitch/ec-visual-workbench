import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const {desktopProfile}=createRequire(import.meta.url)('../desktop/profile.cjs');
const context={root:path.resolve('.'),packaged:false,resourcesPath:path.resolve('resources'),userDataPath:path.resolve('user-data')};

test('isolated startup ignores host secrets and never attaches to another service',()=>{
  const profile=desktopProfile({...context,env:{WORKBENCH_DESKTOP_DATA:'fresh-profile',WORKBENCH_DESKTOP_PORT:'4185',PLANNER_API_KEY:'host-only-key',SUANZHOU_IMAGE_API_KEY:'host-only-image-key',WORKBENCH_FRESH:'false'}});
  assert.equal(profile.reuseService,false);
  assert.equal(profile.port,4185);
  assert.equal(profile.dataDirectory,path.resolve('fresh-profile'));
  assert.equal(profile.configuration.WORKBENCH_FRESH,'true');
  assert.deepEqual(Object.keys(profile.configuration).sort(),['WORKBENCH_ADAPTER_ROOT','WORKBENCH_FRESH']);
});

test('isolated profiles use a fixed separate default port; normal startup is preserved',()=>{
  const isolated=desktopProfile({...context,env:{WORKBENCH_DESKTOP_DATA:'fresh-profile'}});
  assert.equal(isolated.port,4191);
  const normal=desktopProfile({...context,env:{PLANNER_API_KEY:'development-only'}});
  assert.equal(normal.port,4185);assert.equal(normal.reuseService,true);
  assert.equal(normal.configuration.PLANNER_API_KEY,'development-only');
  assert.equal(normal.dataDirectory,path.join(context.root,'data'));
});

test('packaged profiles use bundled adapters and persistent merchant data without host keys',()=>{
  const profile=desktopProfile({...context,packaged:true,env:{PLANNER_API_KEY:'host-only'}});
  assert.equal(profile.dataDirectory,path.join(context.userDataPath,'workspace'));
  assert.equal(profile.configuration.WORKBENCH_ADAPTER_ROOT,path.join(context.resourcesPath,'erp-scripts'));
  assert.equal(profile.configuration.PLANNER_API_KEY,undefined);
});

test('primary crossborder desktop reuses only its version-checked local service and keeps its data',()=>{
  const profile=desktopProfile({...context,env:{WORKBENCH_DESKTOP_PRIMARY:'true',WORKBENCH_DESKTOP_DATA:'desktop-preview-data',WORKBENCH_DESKTOP_PORT:'4196',PLANNER_API_KEY:'host-only'}});
  assert.equal(profile.port,4196);assert.equal(profile.reuseService,true);
  assert.equal(profile.dataDirectory,path.resolve('desktop-preview-data'));
  assert.equal(profile.title,'跨境电商工作台');
  assert.equal(profile.configuration.PLANNER_API_KEY,undefined);
});

test('invalid manual ports fail; automated tests may use an ephemeral port',()=>{
  for(const port of ['0','NaN','4191.1','65536'])assert.throws(()=>desktopProfile({...context,env:{WORKBENCH_DESKTOP_PORT:port}}),/端口/);
  assert.equal(desktopProfile({...context,env:{WORKBENCH_DESKTOP_TEST:'true'}}).port,0);
});
