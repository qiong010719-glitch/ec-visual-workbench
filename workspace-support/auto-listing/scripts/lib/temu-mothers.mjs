import {isDeepStrictEqual as equal} from 'node:util';
import {connection,connect,pageById,poll} from './bit-cdp.mjs';
import {readPage} from '../inspect-draft.mjs';
import {fill} from './draft-ui.mjs';
import {motherSkuPreviewPolicy,readSkuPreviewImage,validateMotherSkuPreview} from './erp-image-rules.mjs';
import {navigateAndWait} from './erp-page-state.mjs';

const field=(s,label)=>s.items.find(i=>i.label===label);
const values=i=>i&&({selections:i.selections,checked:i.checked,controls:i.controls});
export function readMotherExtras(){
  return {
    account:document.querySelector('.btn-user .user-name')?.textContent.trim()||'',
    variants:[...document.querySelectorAll('.theme-value-add')].map(e=>{const b=e.parentElement.parentElement;return {kind:b.querySelector('.ant-select-selection-item')?.textContent.trim(),values:[...b.querySelectorAll('.theme-value-text')].map(x=>x.textContent.trim())};}),
    warehouses:[...document.querySelectorAll('.in-selector.ant-select-multiple.ant-select-allow-clear .ant-select-selection-item')].map(e=>e.getAttribute('title')||e.querySelector('[title]')?.getAttribute('title')||e.textContent.trim()),
    description:{images:[...document.querySelectorAll('#wirelessDescContentBox img:not(.smt-page-empty)')].map(e=>e.src),text:document.querySelector('#wirelessDescContentBox')?.innerText.trim()||''}
  };
}
export function checkMother(mother,extra){
  const issues=[];
  for(const label of ['产品分类','承诺发货时效','运费模板']){
    const i=field(mother,label);if(!i||![...i.selections,...i.checked,...i.controls.map(c=>c.value)].some(v=>String(v).trim()))issues.push(`母稿未填写${label}`);
  }
  if(mother.variantFields.variationSku.length!==1||!mother.variantFields.variationSku[0]||mother.media.skuPreviewImages.length!==1)issues.push('当前支持单 SKU 母稿，且需要一张 SKU 预览图');
  for(const name of ['price','skuLength','skuWidth','skuHeight','weight','stock']){
    const v=mother.variantFields[name];if(v?.length!==1||!String(v[0]).trim()||!Number.isFinite(Number(v[0]))||Number(v[0])<=0)issues.push(`母稿${({price:'价格',skuLength:'包裹长度',skuWidth:'包裹宽度',skuHeight:'包裹高度',weight:'重量',stock:'库存'})[name]}需大于 0`);
  }
  if(!equal(extra.variants.map(v=>v.kind),['风格','颜色'])||extra.variants[0]?.values.length!==1||extra.variants[1]?.values.length)issues.push('当前支持一个风格规格、颜色为空的母稿');
  if(extra.warehouses.length!==1||extra.warehouses[0].includes('...'))issues.push('母稿需选择一个可完整识别的仓库');
  return issues;
}
export function checkMotherCopy(mother,copy,extra,copiedExtra){
  const issues=[];
  for(const i of mother.items)if(!equal(values(i),values(field(copy,i.label))))issues.push(`引用副本的${i.label}与母稿不一致`);
  if(!equal(mother.variantFields,copy.variantFields))issues.push('引用副本的 SKU 规格、价格或库存与母稿不一致');
  if(!equal(mother.media,copy.media))issues.push('引用副本的图片与母稿不一致');
  for(const key of ['variants','warehouses','description'])if(!equal(extra[key],copiedExtra[key]))issues.push(`引用副本的${{variants:'变种',warehouses:'仓库',description:'描述'}[key]}与母稿不一致`);
  return issues;
}
export async function readMother(page,store){
  if(!/^\d{6,30}$/.test(store.draftId))throw new Error('母稿 ID 无效');
  await navigateAndWait(page,'https://www.dianxiaomi.com/web/popTemu/edit?id='+store.draftId,id=>location.pathname==='/web/popTemu/edit'&&new URL(location.href).searchParams.get('id')===id&&document.getElementsByName('variationSku').length>0&&!!document.querySelector('#wirelessDescContentBox')&&document.querySelectorAll('[name="stock"]').length>0,store.draftId,{label:'母稿类目、SKU 和库存加载'});
  const extra=await page.evaluate(readMotherExtras);
  if(!extra.account)throw new Error('请先登录关联的店小秘账号');
  if(store.erpConnection?.expectedAccount&&store.erpConnection.expectedAccount!==extra.account)throw new Error('母稿所在店小秘登录账号与绑定账号不一致');
  const mother=await page.evaluate(readPage,store),issues=checkMother(mother,extra);
  if(issues.length)throw new Error(issues.join('；'));
  const policy=motherSkuPreviewPolicy(mother);
  if(policy)extra.skuPreviewCheck=validateMotherSkuPreview(await page.evaluate(readSkuPreviewImage,{url:mother.media.skuPreviewImages[0],maximumBytes:policy.maximumBytes}),policy);
  return {mother,extra};
}

// quoteEdit is the ERP's own "create with existing content" route. It loads the
// exact product ID with an empty save ID; /edit is never authorized for mutation.
export async function copyMother(page,store,mother,extra){
  await navigateAndWait(page,'https://www.dianxiaomi.com/web/popTemu/quoteEdit?id='+store.draftId,id=>location.pathname==='/web/popTemu/quoteEdit'&&new URL(location.href).searchParams.get('id')===id&&document.getElementsByName('variationSku').length===1&&document.getElementsByName('stock').length===1&&!!document.querySelector('#wirelessDescContentBox'),store.draftId,{label:'引用副本的类目、SKU 和库存加载'});
  const expected={...store,isNew:true,quoteSourceId:store.draftId};
  await page.evaluate(readPage,expected); // check actual shop/site before allowing any input
  const copiedExtra=await page.evaluate(readMotherExtras);
  if(copiedExtra.account!==extra.account)throw new Error('引用母稿期间店小秘账号发生变化');
  if(!equal(copiedExtra.warehouses,extra.warehouses))throw new Error('引用副本的仓库与母稿不一致');
  await page.evaluate(id=>{if(location.pathname!=='/web/popTemu/quoteEdit'||new URL(location.href).searchParams.get('id')!==id)throw new Error('引用页面已变化');document.documentElement.dataset.workbenchMotherId=id;},store.draftId);
  // ERP deliberately clears inventory on quote; restore only the source's stock.
  const stocks=await page.evaluate(()=>[...document.getElementsByName('stock')].map(e=>e.value));
  if(stocks.length!==1)throw new Error('引用副本库存字段数量异常');
  if(stocks[0]!==mother.variantFields.stock[0]){
    if(stocks[0]!=='')throw new Error('引用副本库存不符合预期');
    await fill(page,{selector:'input[name="stock"]'},mother.variantFields.stock[0]);
  }
  // The ERP attaches inherited images asynchronously after the form appears.
  await poll(async()=>equal((await page.evaluate(readPage,expected)).media,mother.media),{timeout:30000,label:'引用副本完整继承母稿图片'});
  const copy=await page.evaluate(readPage,expected),issues=checkMotherCopy(mother,copy,extra,await page.evaluate(readMotherExtras));
  if(issues.length)throw new Error(issues.join('；'));
  return copy;
}
export async function validateMother({store,browserConfig}){
  const info=await connection(browserConfig),browser=await connect(info.ws),pages=[],targets=[];
  const open=async()=>{const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});targets.push(targetId);const p=await pageById(info,targetId);pages.push(p);return p;};
  try{
    const source=await open(),{mother,extra}=await readMother(source,store);
    await copyMother(await open(),store,mother,extra);
    const after=await source.evaluate(readPage,store);
    if(!equal(mother.items,after.items)||!equal(mother.variantFields,after.variantFields)||!equal(mother.media,after.media))throw new Error('校验期间母稿发生变化，请重新读取');
    return {valid:true,issues:[],sourceMode:'product',draftId:store.draftId,account:extra.account,actualStore:mother.store.join('、'),actualSite:mother.site.join('、'),sourceTitle:field(mother,'产品标题')?.controls[0]?.value||'',category:field(mother,'产品分类')?.selections.join('、')||'',shippingTemplate:field(mother,'运费模板')?.selections.join('、')||'',skuPreviewCheck:extra.skuPreviewCheck||{checked:false,reason:'该类目图片规则尚未纳入自动校验'},checkedAt:new Date().toISOString()};
  }finally{for(const p of pages)p.close();for(const targetId of targets)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
}
export async function openMotherSource({store,browserConfig}){
  const info=await connection(browserConfig),browser=await connect(info.ws);
  try{await browser.send('Target.createTarget',{url:'https://www.dianxiaomi.com/web/popTemu/edit?id='+store.draftId});return {message:'已打开母稿。修改后请在店小秘保存商品，再返回工作台点击“读取并校验母稿”。'};}
  finally{browser.close();}
}
