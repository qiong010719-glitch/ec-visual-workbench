import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench} from '../src/server.mjs';
export async function merchantFixture(options={}){
  const {erpAdapter:customAdapter,...workbenchOptions}=options;
  const templateCatalog=['帆布模板A','帆布模板B','模板三','独立模板二'].map((name,i)=>({id:String(501+i),name})),templateReads=[],motherOpens=[];
  const invalidMothers=new Set();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'merchant-check-')),writes=[];
  const png=await sharp({create:{width:120,height:120,channels:3,background:'#dfc4ab'}}).png().toBuffer();
  const app=createWorkbench({dataDirectory:path.join(dir,'data'),configuration:{WORKBENCH_FRESH:'true'},provider:async()=>png,
    titlePlanner:async g=>g.sets.map((s,i)=>({setId:s.id,chineseTitle:'无框帆布装饰画，第'+(i+1)+'款',title:g.source.product_name+' Canvas Wall Art Design '+(i+1),englishTitle:g.source.product_name+' Canvas Wall Art Design '+(i+1)})),
    erpAdapter:{
      openMotherSource:async({store})=>{motherOpens.push(store);return {message:'已在关联浏览器打开母稿'};},
      validateMother:async({store})=>{templateReads.push(store);return invalidMothers.has(store.draftId)?{valid:false,issues:['母稿不属于当前店铺或库存未填写']}:{valid:true,issues:[],sourceMode:'product',draftId:store.draftId,actualStore:store.expectedStore,actualSite:store.expectedSite,sourceTitle:'源商品 '+store.draftId,category:'海报和印刷品',shippingTemplate:'加拿大',checkedAt:new Date().toISOString()};},
      checkConnection:async(browser,erp)=>({connected:true,erpOpen:true,loggedIn:true,account:erp?.expectedAccount||'fixture-merchant',accountMatched:true}),openLogin:async()=>({message:'测试登录窗口已打开'}),runDraft:async args=>{writes.push({store:args.store.key,mother:args.store.draftId,browser:args.browserConfig.browserId,code:args.row.productCode});args.onProgress('saving');return {draftId:'FIXTURE-'+writes.length,url:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456',published:false};},...customAdapter},...workbenchOptions});
  const browsers=[{key:'merchant-browser',browserId:'independent-profile',browserSequence:9,name:'商家浏览器',localApi:'http://127.0.0.1:54346'}];
  const templates=[{key:'canvas-a',name:'母稿 A',draftId:'987654321',templateName:'帆布模板A'},{key:'canvas-b',name:'母稿 B',draftId:'987654322',templateName:'帆布模板B'}];
  const stores=['merchant-ca','merchant-other'].map((key,i)=>({key,platform:'temu',expectedStore:'独立店铺'+(i+1),expectedSite:'加拿大站',browserKey:browsers[0].key,templates:templates.map(t=>({...t,draftId:String(Number(t.draftId)+i*10)}))}));
  app.preferences.update({revision:0,browsers,stores});
  const input=path.join(dir,'原始商品');fs.mkdirSync(input);
  for(const name of ['CANVAS-A','CANVAS-B']){const sub=path.join(input,name);fs.mkdirSync(sub);fs.writeFileSync(path.join(sub,'01.png'),png);fs.writeFileSync(path.join(sub,'商品资料.txt'),'无框帆布装饰画，50×100cm，一幅。仅根据素材和这些已确认事实制作。');}
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  const {token}=await fetch(base+'/api/session').then(r=>r.json());
  const api=async(url,payload)=>{const r=await fetch(base+url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});const value=await r.json();if(!r.ok)throw new Error(value.error);return value;};
  const wait=async(url,predicate)=>{for(let i=0;i<600;i++){const v=await api(url);if(predicate(v))return v;await new Promise(r=>setTimeout(r,50));}throw new Error('Fixture timeout');};
  return {app,dir,input,base,api,wait,writes,stores,browsers,templateCatalog,templateReads,motherOpens,invalidMothers,close:async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};
}
