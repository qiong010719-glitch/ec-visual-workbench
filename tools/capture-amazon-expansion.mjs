import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createClickPacer} from './interaction.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/amazon-expansion-20261101');
const session=process.argv[2];
if(!session)throw new Error('需要已有 browser-skill 会话编号');
const limit=Number(process.argv[3] || 50);
const navigation=JSON.parse(fs.readFileSync(path.join(directory,'electronics-navigation.json'),'utf8'));
const labels={
  'Accessories & Supplies':'电子配件与耗材','Camera & Photo':'相机与摄影','Car Electronics':'车载电子',
  'Cell Phones & Accessories':'手机与配件','Computers & Accessories':'电脑与配件','GPS & Navigation':'GPS与导航',
  'Headphones':'耳机','Home Audio & Theater':'家庭音响','Marine Electronics':'船用电子','Office Electronics':'办公电子',
  'Portable Audio & Video':'便携音频与视频','Security & Surveillance':'安防监控','Televisions & Video':'电视与视频',
  'Video Game Consoles & Accessories':'游戏机与配件','Video Projectors':'投影仪','Wearable Technology':'智能穿戴',
  'eBook Readers & Accessories':'电子阅读器与配件'
};
const file=path.join(directory,'category-plan.json');
const plan=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{
  id:'amazon-expansion-20261101',marketplace:'amazon.com',budgetUsd:5,priorApifyUsd:1.056,
  rule:{brands:5,productsPerBrand:5,brandRanking:'category_snapshot_sum_reciprocal_rank',excludePowerBanks:true},
  scope:'Amazon Electronics 第一层的 17 个实物商品分支；更细子类尚未全覆盖。先完成 3C，再扩其他大类。',
  categories:navigation.rows.filter(r=>labels[r.name]).map((r,i)=>({id:new URL(r.url).pathname.match(/\/(\d+)\//)?.[1],name:r.name,label:labels[r.name],url:r.url.replace(/\/ref=.*$/,''),order:i,phase:'3c',status:'pending',selectedProductIds:[]})),
  excluded:[{name:'Service & Replacement Plans',reason:'非实物商品，未纳入电商商品图学习'}],createdAt:new Date().toISOString()
};
const save=()=>{plan.updatedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(plan,null,2));};
save();
const pacer=createClickPacer();
const run=(args)=>execFileSync('bsk',[...args,'--session',session],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024,timeout:60000,windowsHide:true});
const json=args=>JSON.parse(run([...args,'--json']));
const action=async args=>pacer.perform(()=>run(args),{kind:args[0],target:args[1]});
const fields={fields:[{key:'rank',selector:'.zg-bdg-text',read:'text'},{key:'asin',selector:'[data-asin]',read:'attribute',attribute:'data-asin'},{key:'title',selector:'[class*="p13n-sc-css-line-clamp"]',read:'text'},{key:'url',selector:'a[aria-hidden="true"]',read:'href'},{key:'thumbnail',selector:'img.p13n-product-image',read:'attribute',attribute:'src'}]};
const navFields={fields:[{key:'name',selector:':scope',read:'text'},{key:'url',selector:':scope',read:'href'}]};
const extract=()=>json(['extract','list','--selector','body','--item-selector','[id="gridItemRoot"]','--fields-json',JSON.stringify(fields),'--max-rows','150']);
let captured=0;
try {
  for(const category of plan.categories){
    if(category.rankingFile)continue;
    if(captured>=limit)break;
    const current=json(['evaluate','location.href']);
    if(!current.ok || !current.value.includes('/'+category.id))await action(['navigate',category.url]);
    const observation=run(['observe','--max-tokens','4000']);
    if(/verify.{0,30}human|I am human|check the box to continue|enter the characters|captcha|robot check|unusual traffic/i.test(observation))throw new Error('页面出现验证，停止浏览器采集');
    const initial=extract();
    if(!initial.rows.length)throw new Error('榜单未加载：'+category.name);
    // The observed first 30 cards load the remaining 20 when the bottom is reached.
    let loaded=initial.rows.length;
    for(let scroll=0;loaded<50&&scroll<4;scroll++){
      const ready=json(['wait-for-element',`[id="p13n-asin-index-${loaded-1}"]`,'--state','visible','--timeout','8s']);
      if(!ready.satisfied)break;
      await action(['scroll-to',`[id="p13n-asin-index-${loaded-1}"]`]);
      await action(['wheel','--delta-y','800']);
      const wait=json(['wait-for-element',`[id="p13n-asin-index-${loaded}"]`,'--state','attached','--timeout','8s']);
      const next=extract().rows.length;
      if(!wait.satisfied || next<=loaded)break;
      loaded=next;
    }
    if(loaded<50)plan.warnings=[...new Set([...(plan.warnings||[]),category.name+'：本次页面未加载满 50 条，按实际排名保留。'])];
    const snapshot=extract();
    if(snapshot.coverage.truncated)throw new Error('榜单提取被截断');
    const tree=json(['extract','list','--selector','[aria-label="Navigation Tree"]','--item-selector','a','--fields-json',JSON.stringify(navFields),'--max-rows','300']);
    const ranked=snapshot.rows.map(r=>({...r,position:Number(String(r.rank).replace('#','')),categoryUrl:category.url})).filter(r=>/^[A-Z0-9]{10}$/.test(r.asin || '')&&r.position>0);
    const rows=[...new Map(ranked.map(r=>[r.asin,r])).values()].sort((a,b)=>a.position-b.position);
    const output={...snapshot,category:{id:category.id,name:category.name,label:category.label,url:category.url},rows,loadedRecords:snapshot.rows.length,deliveryCountry:'US',deliveryZip:'10001',categoryNavigation:tree.rows};
    const rankingFile='ranking-'+category.id+'.json';
    fs.writeFileSync(path.join(directory,rankingFile),JSON.stringify(output,null,2));
    Object.assign(category,{rankingFile,observed:rows.length,rankMin:Math.min(...rows.map(r=>r.position)),rankMax:Math.max(...rows.map(r=>r.position)),capturedAt:snapshot.source.captured_at,status:'ranking_captured',subcategories:tree.rows.filter(r=>r.url!==category.url)});
    save();captured++;
    console.log(JSON.stringify({category:category.label,ranked:rows.length,range:[category.rankMin,category.rankMax],captured:plan.categories.filter(c=>c.rankingFile).length,total:plan.categories.length}));
  }
} finally {
  fs.writeFileSync(path.join(directory,'browser-interactions.json'),JSON.stringify(pacer.metrics(),null,2));save();
}
