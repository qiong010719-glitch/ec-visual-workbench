import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createClickPacer} from './interaction.mjs';
const session=process.argv[2];if(!session)throw new Error('需要独立的 browser-skill 会话');
const status=await fetch('http://127.0.0.1:4173/api/research/status').then(r=>r.json());
const products=await fetch('http://127.0.0.1:4173/api/research/products').then(r=>r.json());
const bsk=(...args)=>JSON.parse(execFileSync('bsk',[...args,'--session',session,'--json'],{encoding:'utf8',maxBuffer:16*1024*1024}));
const observe=()=>bsk('observe');
const pacer=createClickPacer();
const ref=(snapshot,label,type='button')=>{
  const line=snapshot.text.split('\n').find(s=>s.replace(' [has-submenu]','').includes(type+' "'+label+'"'));
  const id=line?.match(/@e\d+/)?.[0];if(!id)throw new Error('没有找到控件：'+label);return id;
};
const click=async label=>pacer.perform(()=>bsk('click',ref(observe(),label)),{target:label});
const wait=selector=>{const r=bsk('wait-for-element',selector,'--state','visible','--timeout','15s');if(!r.satisfied)throw new Error('页面未就绪：'+selector);};
if(!observe().text.includes(status.analyzed+' 组完整分析')) {
  bsk('navigate','http://127.0.0.1:4173/');
  await click('工作台：填写产品信息、上传参考图、生成');wait('#localReferenceButton');
  await click('设计参考库');wait('[data-analysis]');
}
const library=observe();
if(!library.text.includes(status.downloadedUnique+'/'+status.uniqueImages) || !library.text.includes(status.analyzed+' 组完整分析'))throw new Error('线上参考库统计不匹配');
await pacer.perform(()=>bsk('select',ref(observe(),'资料类型','combobox'),'--value','storefront'),{kind:'select',target:'店铺装修页面'});
const storefront=observe();const pages=storefront.text.split('\n').filter(s=>s.includes('button "查看图片与设计分析"'));
const expectedStorefronts=products.filter(p=>p.url?.includes('/stores/')).length;
if(pages.length!==expectedStorefronts)throw new Error('装修页面筛选数量不符：'+pages.length+'/'+expectedStorefronts);
bsk('screenshot','--out','tests/results/real-reference-storefront.png');
await click('查看图片与设计分析');wait('#referenceAnalysis');
const detail=observe();if(!detail.text.includes('可迁移方法'))throw new Error('没有显示实际设计分析');
bsk('screenshot','--out','tests/results/real-reference-analysis.png');
await click('关闭分析');
const categoryChecks=[];
if(status.expansion){
  await pacer.perform(()=>bsk('select',ref(observe(),'资料类型','combobox'),'--value','product'),{kind:'select',target:'商品资料'});
  for(const category of [{id:'172541',label:'耳机',file:'earphones'},{id:'department:kitchen',label:'厨房与餐饮',file:'kitchen'},{id:'department:beauty',label:'美妆与个护',file:'beauty'},{id:'department:pet-supplies',label:'宠物用品',file:'pet'},{id:'department:baby-products',label:'母婴用品',file:'baby'}]){
    const expected=products.filter(p=>p.categoryMemberships?.some(c=>c.id===category.id)).length;
    if(!expected)continue;
    const before=observe();if(!before.text.includes(category.label))throw new Error('页面没有提供类目选项：'+category.label);
    await pacer.perform(()=>bsk('select',ref(before,'商品类目','combobox'),'--value',category.id),{kind:'select',target:category.label});
    const filtered=observe(),visible=filtered.text.split('\n').filter(s=>s.includes('button "查看图片与设计分析"')).length;
    if(visible!==expected)throw new Error(category.label+'类目筛选数量不符：'+visible+'/'+expected);
    bsk('screenshot','--out','tests/results/real-reference-'+category.file+'.png');
    await click('查看图片与设计分析');wait('#referenceAnalysis');
    if(!observe().text.includes('可迁移方法'))throw new Error(category.label+'的实际分析未显示');
    bsk('screenshot','--out','tests/results/real-reference-'+category.file+'-analysis.png');
    categoryChecks.push({id:category.id,label:category.label,expected,visible,analysisVisible:true});
    await click('关闭分析');
  }
}
const report={passed:true,base:'http://127.0.0.1:4173/',groups:status.products,uniqueImages:status.uniqueImages,storefrontPages:pages.length,categoryCheck:categoryChecks[0]||null,categoryChecks,actualAnalysisVisible:true,imageGenerationInvoked:false,interaction:pacer.metrics()};
fs.writeFileSync('tests/results/live-reference-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
