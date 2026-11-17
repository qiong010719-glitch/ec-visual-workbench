import {isDeepStrictEqual} from 'node:util';
import {connection,connect,pageById,poll} from './bit-cdp.mjs';
import {readPage} from '../inspect-draft.mjs';
import {readyNewDraft,select,menu,locateTemplate,applyTemplate} from './draft-ui.mjs';

const field=(snapshot,label)=>snapshot.items.find(item=>item.label===label);
const comparable=item=>item&&({selections:item.selections,checked:item.checked,values:item.controls.map(c=>c.value)});
export function checkTemplateFields(mother,template){
  const issues=[];
  for(const [name,snapshot] of [['母稿',mother],['店小秘模板',template]]){
    for(const label of ['产品分类','承诺发货时效','运费模板']){
      const item=field(snapshot,label);
      if(!item||![...item.selections,...item.checked,...item.controls.map(c=>c.value)].some(v=>String(v).trim()))issues.push(`${name}未填写${label}`);
    }
  }
  if(mother.variantFields.variationSku.length!==1||mother.media.skuPreviewImages.length!==1)issues.push('母稿须为单 SKU，并保留一张 SKU 预览图');
  for(const label of ['产品分类','框架类型','框架材质','艺术品表面材料','主题','产地','制造地点','承诺发货时效','运费模板','敏感属性','定制产品']){
    if(!isDeepStrictEqual(comparable(field(mother,label)),comparable(field(template,label))))issues.push(`模板与母稿的${label}不一致`);
  }
  return issues;
}

async function ownedPage(browserConfig,work){
  const info=await connection(browserConfig),browser=await connect(info.ws);let page,targetId;
  try{({targetId}=await browser.send('Target.createTarget',{url:'about:blank'}));page=await pageById(info,targetId);return await work(page);}
  finally{page?.close();if(targetId)await browser.send('Target.closeTarget',{targetId}).catch(()=>{});browser.close();}
}
async function newDraft(page,store){
  await page.send('Page.navigate',{url:'https://www.dianxiaomi.com/web/popTemu/add'});await readyNewDraft(page);
  const account=await page.evaluate(()=>document.querySelector('.btn-user .user-name')?.textContent.trim()||'');
  if(!account)throw new Error('请先在关联的浏览器中登录店小秘');
  if(store.erpConnection?.expectedAccount&&store.erpConnection.expectedAccount!==account)throw new Error('店小秘登录账号与关联 ERP 账号不一致');
  await select(page,{formLabel:'店铺账号',descendant:'.ant-select-selector'},store.expectedStore);
  await select(page,{formLabel:'经营站点',descendant:'.ant-select-selector'},store.expectedSite);
  return account;
}
export async function listTemplates({store,browserConfig}){
  return ownedPage(browserConfig,async page=>{
    const account=await newDraft(page,store);
    await menu(page,{selector:'button',text:'引用产品',index:0},'引用产品模板');
    const templates=await locateTemplate(page,'',{catalog:true});
    if(templates.some(t=>!/^\d{1,30}$/.test(t.id)))throw new Error('店小秘未返回有效模板编号，请重新读取');
    return {account,templates,checkedAt:new Date().toISOString()};
  });
}
export async function validateTemplate({store,browserConfig}){
  return ownedPage(browserConfig,async page=>{
    await page.send('Page.navigate',{url:'https://www.dianxiaomi.com/web/popTemu/edit?id='+store.draftId});
    await poll(()=>page.evaluate(()=>document.getElementsByName('variationSku').length>0&&document.getElementsByName('stock').length>0),{timeout:30000}).catch(()=>{throw new Error('母稿未加载完整，请确认关联账号已登录、母稿已保存且包含 SKU 与仓库库存');});
    const mother=await page.evaluate(readPage,store);
    const account=await newDraft(page,store),match=await applyTemplate(page,store.templateName,{templateId:store.templateId});
    const template=await page.evaluate(readPage,{...store,isNew:true}),issues=checkTemplateFields(mother,template);
    return {valid:issues.length===0,issues,account,templateId:match.id,templateName:match.name,draftId:store.draftId,shippingTemplate:field(mother,'运费模板')?.selections.join('、')||'',checkedAt:new Date().toISOString()};
  });
}
export async function openTemplateSource({store,browserConfig}){
  const info=await connection(browserConfig),browser=await connect(info.ws);
  try{await browser.send('Target.createTarget',{url:'https://www.dianxiaomi.com/web/popTemu/edit?id='+store.draftId});return {message:'已在关联浏览器打开母稿。请补齐资料并点击“存为模板”，完成后回工作台读取模板。'};}
  finally{browser.close();}
}
