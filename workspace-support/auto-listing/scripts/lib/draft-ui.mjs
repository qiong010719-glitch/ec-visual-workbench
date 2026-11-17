import { poll } from './bit-cdp.mjs';
import {parseErpResponse} from './temu-publish.mjs';

// Locators come from the observed ERP UI. Mutations are restricted to new, unsaved drafts.
export function domAction({ locator, action = 'inspect', value }) {
  const id = new URL(location.href).searchParams.get('id');
  const isCopy = location.pathname === '/web/popTemu/quoteEdit' && /^\d{6,30}$/.test(id || '')
    && document.documentElement.dataset.workbenchMotherId === id;
  if (!['www.dianxiaomi.com', 'dianxiaomi.com'].includes(location.hostname)
    || !(isCopy || location.pathname === '/web/popTemu/add' && !new URL(location.href).searchParams.has('id'))) {
    throw new Error('This operation requires a new unsaved Temu draft');
  }
  const visible = el => {
    if(!el.getClientRects().length)return false;
    if(['hidden','collapse'].includes(getComputedStyle(el).visibility))return false;
    for(let node=el;node instanceof Element;node=node.parentElement){
      const style=getComputedStyle(node);
      if(Number(style.opacity)===0)return false;
    }
    return true;
  };
  let candidates;
  if (locator.formLabel) {
    candidates = [...document.querySelectorAll('.ant-form-item')]
      .filter(el => el.querySelector('.ant-form-item-label')?.innerText.trim() === locator.formLabel);
  } else if (locator.variantIndex !== undefined) {
    const block = document.querySelectorAll('.theme-value-add')[locator.variantIndex];
    candidates = block ? [block.parentElement.parentElement] : [];
  } else candidates = [...document.querySelectorAll(locator.selector)];
  if (locator.descendant) candidates = candidates.flatMap(el => [...el.querySelectorAll(locator.descendant)]);
  candidates = candidates.filter(visible);
  if (locator.text !== undefined) candidates = candidates.filter(el => el.innerText.trim() === locator.text);
  if (locator.index !== undefined) candidates = candidates[locator.index] ? [candidates[locator.index]] : [];
  if (!candidates.length && ['ready','tryClick','hoverPoint'].includes(action)) return null;
  if (candidates.length !== 1) throw new Error(`Locator must match exactly once: ${JSON.stringify(locator)} (${candidates.length})`);
  const el = candidates[0];
  if(['ready','tryClick','hoverPoint'].includes(action)&&(!el.getBoundingClientRect().width||!el.getBoundingClientRect().height))return null;
  if(['ready','tryClick','hoverPoint'].includes(action)&&(el.disabled||el.getAttribute('aria-disabled')==='true'))return null;
  if(action==='ready')return true;
  if (action === 'fill') {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }
  if (action === 'click' || action === 'tryClick') {
    if (el.disabled||el.getAttribute('aria-disabled')==='true') throw new Error('Target is disabled');
    if(action==='tryClick'){
      let r=el.getBoundingClientRect();
      if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth){el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});r=el.getBoundingClientRect();}
      if(!visible(el)||!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return null;
    }
    el.click(); return true;
  }
  if(action==='hoverPoint'){
    let r=el.getBoundingClientRect();
    if(r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth){el.scrollIntoView({block:'center',behavior:'instant'});r=el.getBoundingClientRect();}
    const left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
    if(right<=left||bottom<=top)return null;
    const point={x:(left+right)/2,y:(top+bottom)/2};
    return el.contains(document.elementFromPoint(point.x,point.y))?point:null;
  }
  if (action === 'scroll') { el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; }
  if (action === 'point') {
    const r = el.getBoundingClientRect();
    const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || !el.contains(hit)) throw new Error('Control is covered or outside viewport');
    return point;
  }
  return { text: el.innerText, value: el.value, disabled: el.disabled };
}

export const fill = (page, locator, value) => page.evaluate(domAction, { locator, action: 'fill', value });
export const click = (page, locator) => page.evaluate(domAction, { locator, action: 'click' });

async function hover(page,locator,label,reset=true) {
  const point=await poll(()=>page.evaluate(domAction,{locator,action:'hoverPoint'}),{timeout:5000,interval:150,label:`${label}：悬停入口可见且未被遮挡`});
  if(reset)await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
}

// Readiness and click are atomic. A successful click is never automatically replayed.
export async function waitAndClick(page,locator,{label=locator.text||locator.selector||locator.formLabel,timeout=10000,hoverLocator,hoverPath=hoverLocator?[hoverLocator]:[],maxHovers=3}={}) {
  let hovers=0,lastHover=0;
  const reveal=async()=>{for(let i=0;i<hoverPath.length;i++)await hover(page,hoverPath[i],label,i===0);hovers++;lastHover=Date.now();};
  await poll(async()=>{
    if(hoverPath.length&&hovers===0)await reveal();
    const clicked=await page.evaluate(domAction,{locator,action:'tryClick'});
    if(clicked)return true;
    if(hoverPath.length&&hovers<maxHovers&&Date.now()-lastHover>=1500)await reveal();
    return false;
  },{timeout,interval:150,label});
}

async function unobscuredPoint(page, locator) {
  return poll(async () => {
    try { return await page.evaluate(domAction, { locator, action: 'point' }); }
    catch (error) {
      if (error.message.includes('Control is covered or outside viewport')) return null;
      throw error;
    }
  }, { timeout: 5000, interval: 150, label: `控件未被遮挡：${locator.text||locator.formLabel||locator.selector}` });
}

export async function nativeClick(page, locator) {
  await page.evaluate(domAction, { locator, action: 'scroll' });
  const point = await unobscuredPoint(page, locator);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}

export async function select(page, locator, text) {
  await nativeClick(page, locator);
  await waitAndClick(page, { selector: '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option', text },{timeout:8000,label:`下拉选项：${text}`});
}

export async function menu(page, locator, text, optionsSelector = '[role="menuitem"]') {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await poll(async()=>!await page.evaluate(domAction,{locator:{selector:optionsSelector,text},action:'ready'}),{timeout:5000,interval:100,label:`收起旧菜单：${text}`});
  await waitAndClick(page,{selector:optionsSelector,text},{hoverLocator:locator,timeout:10000,label:`菜单选项：${text}`});
}

export async function readyNewDraft(page) {
  await poll(() => page.evaluate(() => location.pathname === '/web/popTemu/add'
    && document.body?.innerText.includes('请选择店铺')
    && [...document.querySelectorAll('button')].some(el => el.innerText.trim() === '引用产品')), { timeout: 30000 });
}

function templateDialogAction({action='inspect',name}) {
  if(!['www.dianxiaomi.com','dianxiaomi.com'].includes(location.hostname)||location.pathname!=='/web/popTemu/add'||new URL(location.href).searchParams.has('id'))throw new Error('只能在新建商品页面引用模板');
  const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const modals=[...document.querySelectorAll('.ant-modal')].filter(e=>visible(e)&&/引用模[板版]/.test(e.innerText));
  if(modals.length!==1)return null;
  const modal=modals[0],rows=[...modal.querySelectorAll('tbody tr')].filter(e=>visible(e)&&e.querySelector('td'));
  const names=rows.map(r=>r.querySelector('td').textContent.trim());
  if(action==='inspect')return {names,page:Number(modal.querySelector('input[placeholder="页数"]')?.value||1)};
  if(action==='search'){
    const input=modal.querySelector('input[name="productModuleSearchValue"]');
    const buttons=[...modal.querySelectorAll('button')].filter(e=>visible(e)&&e.textContent.trim()==='搜索');
    if(!input||buttons.length!==1)throw new Error('店小秘模板搜索入口已变化，请检查引用模板窗口');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,name);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));buttons[0].click();return true;
  }
  if(action==='next'||action==='first'){
    const button=modal.querySelector(`button[title="${action==='next'?'下一页':'首页'}"]`);
    if(!button||button.disabled||button.classList.contains('is--disabled'))throw new Error('无法完整检查店小秘模板列表，请检查分页后重试');
    button.click();return true;
  }
  const matching=rows.filter((r,i)=>names[i]===name);
  if(matching.length!==1)throw new Error(`店小秘模板“${name}”不是唯一完整匹配，已停止引用`);
  const choices=[...matching[0].querySelectorAll('button,a,span')].filter(e=>visible(e)&&e.childElementCount===0&&e.textContent.trim()==='引用');
  if(choices.length!==1)throw new Error(`无法唯一定位模板“${name}”的引用按钮`);
  choices[0].click();return true;
}

export async function locateTemplate(page,templateName,{timeout=10000,catalog=false,templateId}={}) {
  const name=String(templateName||'').trim();if(!name&&!catalog)throw new Error('请填写店小秘已保存的模板名称');
  await poll(()=>page.evaluate(templateDialogAction,{}),{timeout}).catch(()=>{throw new Error('店小秘“引用模板”窗口未打开，请检查登录状态后重试');});
  await page.send('Network.enable');
  const tracked=new Map(),pending=new Set();let result,failure,expectedPage;
  const query=name.replaceAll('%','\\%').replaceAll('_','\\_');
  const offResponse=page.on('Network.responseReceived',e=>{let url;try{url=new URL(e.response.url);}catch{return;}
    if(['www.dianxiaomi.com','dianxiaomi.com'].includes(url.hostname)&&url.pathname==='/api/userTemplate/quotePageList.json'&&url.searchParams.get('searchValue')===query&&Number(url.searchParams.get('pageNo'))===expectedPage)tracked.set(e.requestId,expectedPage);
  });
  const offFinished=page.on('Network.loadingFinished',e=>{if(!tracked.has(e.requestId))return;const requestPage=tracked.get(e.requestId);tracked.delete(e.requestId);
    const work=page.send('Network.getResponseBody',{requestId:e.requestId}).then(r=>{
      const body=parseErpResponse(r.base64Encoded?Buffer.from(r.body,'base64').toString():r.body),p=body?.page||body?.data?.page||body?.bor?.page;
      if(!Array.isArray(p?.list)||!Number.isInteger(p.totalSize)||!Number.isInteger(p.pageSize)||p.pageSize<1||p.pageNo!==requestPage)throw new Error('店小秘模板列表返回异常，未引用任何模板');
      result=p;
    }).catch(e=>{failure=e;}).finally(()=>pending.delete(work));pending.add(work);
  });
  const move=async(action,pageNumber)=>{
    expectedPage=pageNumber;result=null;failure=null;
    await page.evaluate(templateDialogAction,{action,name});
    try{return await poll(async()=>{
      if(failure)throw failure;if(!result)return null;
      const view=await page.evaluate(templateDialogAction,{});
      return view?.page===pageNumber&&JSON.stringify(view.names)===JSON.stringify(result.list.map(t=>t.name.trim()))?result:null;
    },{timeout});}catch(e){if(failure)throw failure;throw new Error(`无法加载店小秘模板“${name}”的搜索结果，请检查连接后重试`);}
  };
  try{
    let current=await move('search',1),matches=[],records=[],pageNumber=1;const totalPages=Math.max(1,Math.ceil(current.totalSize/current.pageSize));
    if(totalPages>100)throw new Error('模板搜索结果过多，请使用完整且唯一的店小秘模板名称');
    while(true){records.push(...current.list);matches.push(...current.list.filter(t=>t.name.trim()===name).map(t=>({page:pageNumber,id:String(t.idStr??t.id??'')})));if(!catalog&&matches.length>1)throw new Error(`店小秘存在多个同名模板“${name}”，请改成唯一名称并更新连接设置，未引用任何模板`);if(pageNumber>=totalPages)break;current=await move('next',++pageNumber);}
    if(catalog)return records.map(t=>({id:String(t.idStr??t.id??''),name:t.name.trim(),modules:(t.moduleList||[]).map(m=>m.moduleName||m.moduleType).filter(Boolean)}));
    if(!matches.length)throw new Error(`未找到店小秘模板“${name}”。请打开对应母稿，使用“存为模板”保存同名模板，或将连接设置中的“店小秘模板名称”改为已保存的完整名称；本条尚未保存或发布。`);
    if(templateId&&matches[0].id!==templateId)throw new Error(`店小秘模板“${name}”已被替换，请在连接设置重新读取并选择模板`);
    if(matches[0].page!==pageNumber){await move('first',1);for(let i=2;i<=matches[0].page;i++)await move('next',i);}
    return {name,page:matches[0].page,id:matches[0].id};
  }finally{offResponse();offFinished();await Promise.allSettled([...pending]);}
}

export async function applyTemplate(page, templateName, options={}) {
  await menu(page, { selector: 'button', text: '引用产品', index: 0 }, '引用产品模板');
  const match=await locateTemplate(page,templateName,options);
  await page.evaluate(templateDialogAction,{action:'reference',name:match.name});
  await poll(() => page.evaluate(() => [...document.querySelectorAll('.ant-form-item')]
    .some(el => el.querySelector('.ant-form-item-label')?.innerText.trim() === '框架类型'
      && el.querySelector('.ant-select-selection-item'))
    && document.querySelectorAll('.theme-value-add').length === 2), { timeout: 20000 }).catch(()=>{throw new Error(`已引用模板“${match.name}”，但类目或变种信息未加载完整；请检查模板是否包含对应模块。`);});
  return match;
}

export async function addSingleStyle(page, style) {
  await select(page, { variantIndex: 0, descendant: '.ant-select-selector' }, '风格');
  await fill(page, { variantIndex: 0, descendant: '.theme-value-add input' }, style);
  await click(page, { variantIndex: 0, descendant: '.theme-value-add button' });
  await poll(() => page.evaluate(() => document.getElementsByName('variationSku').length === 1));
  await select(page, { variantIndex: 1, descendant: '.ant-select-selector' }, '颜色');
}

// sourcePreview must come from the matching source SKU, never the new main-image list.
// Existing previews are preserved; a mismatch requires explicit correction, not silent replacement.
export async function setPreservedSkuPreview(page, sourcePreview) {
  if (!/^https:\/\/wxalbum-10001658-file\.dianxiaomi\.com\/.+/.test(sourcePreview ?? '')) {
    throw new Error('A source SKU preview URL is required');
  }
  await page.evaluate(domAction, { locator: { selector: '.sku-image' } });
  const current = await page.evaluate(() => document.querySelector('.sku-image img')?.src);
  if (current === sourcePreview) return { changed: false };
  if (current && !current.includes('/assets/addImg-')) throw new Error('Existing SKU preview differs from source; leave it unchanged');
  await menu(page, { selector: '.sku-image' }, '网络图片');
  await poll(() => page.evaluate(() => [...document.querySelectorAll('.ant-modal')]
    .some(el => el.getClientRects().length && el.innerText.startsWith('从网络地址(URL)选择图片'))));
  await fill(page, { selector: '.ant-modal textarea', index: 0 }, sourcePreview);
  await click(page, { selector: '.ant-modal button', text: '添加' });
  await poll(() => page.evaluate(url => document.querySelector('.sku-image img')?.src === url, sourcePreview));
  return { changed: true };
}

export async function openDescriptionEditor(page,{buttonTimeout=12000,editorTimeout=20000}={}) {
  if(await page.evaluate(domAction,{locator:{selector:'.smt-content-center'},action:'ready'}))return;
  await waitAndClick(page,{selector:'#baiduStatisticsSmtNewEditorEditClickNum button'},
    {hoverLocator:{selector:'#wirelessDescBox'},timeout:buttonTimeout,label:'编辑描述按钮显示并可点击'});
  await poll(()=>page.evaluate(domAction,{locator:{selector:'.smt-content-center'},action:'ready'}),{timeout:editorTimeout,label:'描述编辑器打开'});
}

// Clearing is limited to the newly created copy, after comparing its inherited content.
export async function clearInheritedDescription(page, expected) {
  await page.evaluate(domAction, { locator: { selector: '#wirelessDescBox' } });
  const current = await page.evaluate(() => ({
    images: [...document.querySelectorAll('#wirelessDescContentBox img:not(.smt-page-empty)')].map(e => e.src),
    text: document.querySelector('#wirelessDescContentBox').innerText.trim(),
  }));
  if (!current.images.length && !current.text) return;
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Inherited description differs from the source; inspect before clearing');
  await openDescriptionEditor(page);
  for (const [enabled, label, confirmation] of [
    [current.images.length, '清空图片模块', '您确定清空所有图片模块吗'],
    [current.text, '清空文字模块', '您确定清空所有文字模块吗'],
  ]) {
    if (!enabled) continue;
    await waitAndClick(page,{selector:'.custom-delete-btn li',text:label},{label:`描述编辑器：${label}`,
      hoverPath:[{selector:'.ant-modal .menu-button'},{selector:'.custom-batch-btn > ul > li',text:'清空描述'}]});
    await poll(() => page.evaluate(text => [...document.querySelectorAll('.ant-modal')]
      .some(e => e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && e.innerText.includes(text)), confirmation),{label:`清空确认弹窗：${label}`});
    await waitAndClick(page, { selector: '.ant-modal button', text: '确 定' },{label:`确认${label}`});
    await poll(() => page.evaluate(text => ![...document.querySelectorAll('.ant-modal')]
      .some(e => e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && e.innerText.includes(text)), confirmation),{label:`${label}确认弹窗关闭`});
  }
  await poll(() => page.evaluate(() => [...document.querySelectorAll('.ant-modal')]
    .some(e => e.getClientRects().length && /使用中模块\s*[（(]\s*0\s*[）)]/.test(e.innerText))),{label:'旧详情模块清空',timeout:30000});
  await waitAndClick(page, { selector: '.ant-modal button', text: '保存' },{label:'保存已清空的描述'});
  await poll(() => page.evaluate(() => !document.querySelector('#wirelessDescContentBox img:not(.smt-page-empty)')
    && document.querySelector('#wirelessDescContentBox').innerText.trim() === ''),{label:'清空后的描述写回商品',timeout:30000});
}

export async function clearInheritedMainImages(page, expected) {
  await page.evaluate(domAction, {locator:{selector:'.mainImage'}});
  const urls = () => page.evaluate(() => [...document.querySelectorAll('.mainImage .img-list img')].map(e=>e.src));
  if (JSON.stringify(await urls()) !== JSON.stringify(expected)) throw new Error('新稿主图与母稿不一致，未清空图片');
  for (let i=0;i<expected.length;i++) {
    await click(page,{selector:'.mainImage .img-list .icon_delete',index:0});
    await poll(async()=>JSON.stringify(await urls())===JSON.stringify(expected.slice(i+1)),{label:`删除第 ${i+1} 张旧主图`});
  }
}

export async function addMainImagesFromUrls(page, urls) {
  if (!Array.isArray(urls) || urls.length < 3 || urls.length > 10
    || !urls.every(url => /^https:\/\/wxalbum-10001658-file\.dianxiaomi\.com\/.+/.test(url))) {
    throw new Error('Expected 3–10 already uploaded ERP image URLs');
  }
  await page.evaluate(domAction, { locator: { selector: '.mainImage' } });
  if (await page.evaluate(() => document.querySelectorAll('.mainImage .img-list img').length)) {
    throw new Error('New draft already has main images; inspect before appending');
  }
  await menu(page, { selector: '.mainImage button', text: '选择图片' }, '网络图片');
  await poll(() => page.evaluate(() => [...document.querySelectorAll('.ant-modal')]
    .some(e => e.getClientRects().length && e.innerText.startsWith('从网络地址(URL)选择图片'))));
  await fill(page, { selector: '.ant-modal textarea' }, urls.join('\n'));
  await click(page, { selector: '.ant-modal button', text: '添加' });
  await poll(() => page.evaluate(expected => JSON.stringify([...document.querySelectorAll('.mainImage .img-list img')]
    .map(e => e.src)) === JSON.stringify(expected), urls));
}

// The description editor's batch import reuses the main-image URLs, avoiding a second upload.
// Only initializes an empty description in a new draft; it never clears existing content.
export async function fillEmptyDescriptionFromMainImages(page) {
  await page.evaluate(domAction, { locator: { selector: '#wirelessDescContentBox' } });
  const before = await page.evaluate(() => ({
    main: [...document.querySelectorAll('.mainImage .img-list img')].map(el => el.src),
    sku: [...document.querySelectorAll('.sku-image img')].map(el => el.src),
    details: [...document.querySelectorAll('#wirelessDescContentBox img:not(.smt-page-empty)')].map(el => el.src),
    text: document.querySelector('#wirelessDescContentBox').innerText.trim(),
  }));
  if (!before.main.length || before.main.length > 50) throw new Error('Main images are missing or exceed the description limit');
  if (JSON.stringify(before.details) === JSON.stringify(before.main) && !before.text) return { changed: false };
  if (before.details.length || before.text) throw new Error('Description already has content; preserve it for review');
  await openDescriptionEditor(page);
  await menu(page, { selector: '.ant-modal .menu-button' }, '批量传图', '.custom-batch-btn li');
  await poll(()=>page.evaluate(domAction,{locator:{selector:'.batch-smt-image-content'},action:'ready'}),{label:'批量传图窗口打开'});
  await menu(page, { selector: '.batch-smt-image-content button' }, '引用产品轮播图');
  await poll(() => page.evaluate(() => [...document.querySelectorAll('.ant-modal')]
    .some(el => el.getClientRects().length && getComputedStyle(el).visibility!=='hidden' && el.innerText.startsWith('引用产品图片'))),{label:'引用产品图片窗口打开'});
  await page.evaluate(expected => {
    const modal = [...document.querySelectorAll('.ant-modal')].find(el => el.getClientRects().length && el.innerText.startsWith('引用产品图片'));
    const urls = [...modal.querySelectorAll('.img-item img')].map(el => el.src);
    if (JSON.stringify(urls) !== JSON.stringify(expected) || modal.querySelectorAll('.selected-box img').length) {
      throw new Error('Unexpected image picker state');
    }
  }, before.main);
  // Separate interactions allow the checkbox group's reactive state to update between selections.
  for (let index = 0; index < before.main.length; index++) {
    await waitAndClick(page, { selector: '.ant-modal .img-item .label', index },{label:`选择第 ${index+1} 张详情图`});
    await poll(() => page.evaluate(count => [...document.querySelectorAll('.ant-modal')]
      .find(el => el.getClientRects().length && el.innerText.startsWith('引用产品图片'))
      ?.querySelectorAll('.selected-box img').length === count, index + 1),{label:`第 ${index+1} 张详情图选中反馈`});
  }
  await waitAndClick(page, { selector: '.ant-modal button', text: '选择' },{label:'确认所选详情图片'});
  await poll(() => page.evaluate(expected => JSON.stringify([...document.querySelectorAll('.batch-smt-image-content .img-list img')]
    .map(el => el.src)) === JSON.stringify(expected), before.main),{label:'所选图片进入批量传图列表',timeout:30000});
  await waitAndClick(page, { selector: '.ant-modal button', text: '确定' },{label:'导入详情图片'});
  await poll(() => page.evaluate(expected => JSON.stringify([...document.querySelectorAll('.smt-content-center .desc-img-box img')]
    .map(el => el.src)) === JSON.stringify(expected), before.main),{label:'详情图片按顺序进入编辑器',timeout:30000});
  await waitAndClick(page, { selector: '.ant-modal button', text: '保存' },{label:'保存描述内容'});
  await poll(() => page.evaluate(expected => JSON.stringify([...document.querySelectorAll('#wirelessDescContentBox img')]
    .map(el => el.src)) === JSON.stringify(expected), before.main),{label:'保存后的详情图片写回商品',timeout:30000});
  const afterSku = await page.evaluate(() => [...document.querySelectorAll('.sku-image img')].map(el => el.src));
  if (JSON.stringify(afterSku) !== JSON.stringify(before.sku)) throw new Error('SKU preview changed while filling description; do not save the draft');
  return { changed: true, imageCount: before.main.length };
}
