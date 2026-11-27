import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// Resolve translations only against the nodes observed at the same depth. A
// bracketed Chinese qualifier is part of a category name, not a translation.
export function normalizeObservedCategoryPath({path=[],columns=[],pathIds=[]}={}){
  const tidy=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
  const translated=value=>{const text=tidy(value),match=text.match(/^(.*?)\s*\(([^()]*)\)$/);return match&&/[\u3400-\u9fff]/.test(match[1])&&/^[\x20-\x7e]+$/.test(match[2])&&/[A-Za-z]/.test(match[2])?tidy(match[1]):text;};
  const result=[],ids=[],issues=[];
  for(const [depth,raw] of path.entries()){
    const text=tidy(raw),nodes=columns[depth]||[],hint=String(pathIds[depth]||'');
    const matches=nodes.filter(node=>{const label=tidy(node.label);return label===text||translated(text)===label||translated(label)===text;});
    let found=hint?matches.filter(node=>String(node.id||'')===hint):matches;
    if(found.length>1){const selected=found.filter(node=>node.selected===true);if(selected.length===1&&selected[0].id&&found.filter(node=>node.id===selected[0].id).length===1)found=selected;}
    if(found.length!==1){issues.push({depth,code:found.length>1?'ambiguous':'unmatched',text,message:found.length>1?`第 ${depth+1} 级分类路径对应多个可见节点，未猜测选择`:`第 ${depth+1} 级分类路径尚未对应当前可见节点`});result.push(String(raw));ids.push('');continue;}
    result.push(found[0].label);ids.push(String(found[0].id||''));
  }
  return {path:result,pathIds:ids,issues};
}

export function categoryPathMatches(actual,expected,{columns,pathIds=[],expectedIds=[]}={}){
  if(!Array.isArray(actual)||!Array.isArray(expected)||actual.length!==expected.length)return false;
  const normalized=normalizeObservedCategoryPath({path:actual,pathIds,columns:columns||expected.map((label,index)=>[{label,id:expectedIds[index]||''}])});
  return !normalized.issues.length&&isDeepStrictEqual(normalized.path,expected)&&expectedIds.every((id,index)=>!id||!normalized.pathIds[index]||String(id)===normalized.pathIds[index]);
}

// The category dialog is shared by several ERP editors. Read only visible DOM
// metadata; a label-derived key is explicitly not a platform category number.
export function readDxmCategoryCatalog({expected}={}){
  if(expected?.url&&location.href!==expected.url||expected?.account&&document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('分类目录所在商品或账号发生变化');
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none';
  const modals=[...document.querySelectorAll('.ant-modal')].filter(element=>visible(element)&&element.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');
  if(modals.length!==1)return null;
  const modal=modals[0],loading=[...modal.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')].some(visible);
  const breadcrumb=modal.querySelector('.modal-body .w-960');
  const currentPath=(breadcrumb?.textContent.trim()||'').split(/\s*>\s*/).filter(Boolean);
  const columns=[...modal.querySelectorAll('.categories-box')].filter(visible).map(box=>[...box.querySelectorAll('.categories-item-name')].filter(visible).map(element=>{
    const item=element.closest('.categories-item,li,[role="treeitem"]')||element.parentElement;
    const attr=names=>{for(const node of [element,item])for(const name of names){const value=node?.getAttribute(name);if(value!==null&&value!==undefined&&value!=='')return {value,attribute:name};}return null;};
    const identity=attr(['data-category-id','data-cate-id','categoryid','cateid','data-id']);
    const terminal=attr(['data-leaf','data-is-leaf','isleaf']),children=attr(['data-has-children','haschildren']);
    let leaf=null;
    if(terminal&&/^(true|false|0|1)$/.test(terminal.value))leaf=/^(true|1)$/.test(terminal.value);
    else if(children&&/^(true|false|0|1)$/.test(children.value))leaf=!/^(true|1)$/.test(children.value);
    else if(item?.querySelector('.anticon-right,[data-icon="right"],[aria-label="right"],.categories-item-arrow,.icon_right'))leaf=false;
    const selected=attr(['aria-selected','data-selected']);
    return {id:identity?.value||'',idSource:identity?'dom:'+identity.attribute:'observed-path',label:element.textContent.trim(),leaf,...(selected?{selected:/^(true|1)$/.test(selected.value)}:{})};
  }));
  const breadcrumbIds=[...breadcrumb?.querySelectorAll('[data-category-id],[data-cate-id],[categoryid],[cateid]')||[]].map(node=>['data-category-id','data-cate-id','categoryid','cateid'].map(name=>node.getAttribute(name)).find(Boolean)||'');
  // This reader is serialized into a browser page. Keep this small resolver
  // self-contained; regression tests compare its output with the public helper.
  const tidy=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
  const translated=value=>{const text=tidy(value),match=text.match(/^(.*?)\s*\(([^()]*)\)$/);return match&&/[\u3400-\u9fff]/.test(match[1])&&/^[\x20-\x7e]+$/.test(match[2])&&/[A-Za-z]/.test(match[2])?tidy(match[1]):text;};
  const path=[],pathIds=[],pathIssues=[];
  for(const [depth,raw] of currentPath.entries()){
    const text=tidy(raw),nodes=columns[depth]||[],hint=breadcrumbIds.length===currentPath.length?breadcrumbIds[depth]:'';
    const matches=nodes.filter(node=>{const label=tidy(node.label);return label===text||translated(text)===label||translated(label)===text;});
    let found=hint?matches.filter(node=>String(node.id||'')===hint):matches;
    if(found.length>1){const selected=found.filter(node=>node.selected===true);if(selected.length===1&&selected[0].id&&found.filter(node=>node.id===selected[0].id).length===1)found=selected;}
    if(found.length!==1){pathIssues.push({depth,code:found.length>1?'ambiguous':'unmatched',text,message:found.length>1?`第 ${depth+1} 级分类路径对应多个可见节点，未猜测选择`:`第 ${depth+1} 级分类路径尚未对应当前可见节点`});path.push(String(raw));pathIds.push('');continue;}
    path.push(found[0].label);pathIds.push(String(found[0].id||''));
  }
  const buttons=[...modal.querySelectorAll('button')].filter(button=>visible(button)&&button.textContent.trim()==='选择');
  const emptyEvidence=[...modal.querySelectorAll('.ant-empty-description,.ant-empty,.empty-data,.no-data,.d-no-data,.no-result,.no-results,.categories-empty,[data-empty-state],[role="status"]')].filter(visible).map(element=>element.textContent.replace(/\s+/g,' ').trim()).filter(text=>/^(?:暂无(?:数据|分类|类目|结果)|没有(?:可用的?)?(?:数据|分类|类目|结果)|无可用(?:分类|类目)|未(?:查询|搜索)到(?:相关|匹配的?)?(?:数据|分类|类目|结果)|no (?:data|categories|results)(?: found)?|no matching (?:categories|results)(?: found)?)[。.!！]?$/i.test(text));
  return {path,rawPath:currentPath,pathIds,pathIssues,columns,loading,emptyEvidence:[...new Set(emptyEvidence)],canSelect:buttons.length===1&&!buttons[0].disabled&&buttons[0].getAttribute('aria-disabled')!=='true'};
}

// The caller opens the category dialog in an owned page, verifies full product
// identity, and supplies native point/click handling. This helper browses rows
// only. It never confirms the dialog, saves an editor, or publishes a product.
export async function browseDxmCategoryCatalog({page,poll,point,expected,path:parent=[],isStopped}={}){
  if(!Array.isArray(parent)||parent.length>16||parent.some(label=>typeof label!=='string'||!label.trim()))throw new Error('分类路径无效');
  const stopped=()=>{if(isStopped?.())throw new Error('已暂停分类目录读取');};
  const state=async()=>{stopped();const current=await page.evaluate(readDxmCategoryCatalog,{expected});if(!current?.loading&&current?.pathIssues?.some(issue=>issue.code==='ambiguous'))throw new Error(current.pathIssues.map(issue=>issue.message).join('；'));return current;};
  const initial=await poll(async()=>{const current=await state();return current&&!current.loading&&(current.columns[0]?.length||current.emptyEvidence?.length&&!current.columns.some(column=>column.length))?current:null;},{timeout:30000,label:'平台分类目录加载'});
  if(!initial.columns[0]?.length)return {path:parent,options:[]};
  for(const [categoryDepth,text] of parent.entries()){
    await poll(async()=>{const current=await state();return !current?.loading&&current?.columns[categoryDepth]?.filter(option=>option.label===text).length===1?current:null;},{timeout:30000,label:'分类层级：'+text});
    await point({categoryDepth,text});
  }
  const catalog=await poll(async()=>{const current=await state();return !current?.loading&&!current?.pathIssues?.length&&current?.columns[parent.length]?.length&&(!parent.length||isDeepStrictEqual(current.path.slice(0,parent.length),parent))?current:null;},{timeout:30000,label:'分类子目录加载'});
  const candidates=catalog.columns[parent.length];
  if(candidates.length>500||new Set(candidates.map(option=>option.label)).size!==candidates.length)throw new Error('分类目录过大或有同名节点，未猜测选择');
  const options=[];
  for(const candidate of candidates){
    stopped();const path=[...parent,candidate.label];let leaf=candidate.leaf;
    if(leaf===null){
      await point({categoryDepth:parent.length,text:candidate.label});let previous='';
      const observed=await poll(async()=>{
        const current=await state();
        if(!current||current.loading||current.pathIssues?.length||!isDeepStrictEqual(current.path.slice(0,path.length),path))return null;
        const children=current.columns[path.length]||[],ready=children.length||current.canSelect;
        const fingerprint=JSON.stringify({path:current.path,children,canSelect:current.canSelect});
        const stable=ready&&fingerprint===previous;previous=fingerprint;return stable?current:null;
      },{timeout:30000,label:'核对分类是否末级：'+candidate.label});
      leaf=!observed.columns[path.length]?.length;
    }
    const id=candidate.id||'path:'+createHash('sha256').update(JSON.stringify(path)).digest('hex');
    if(id.length>100)throw new Error('平台分类编号超出支持长度');
    options.push({id,label:candidate.label,path,leaf,idSource:candidate.idSource});
  }
  return {path:parent,options};
}

// Read the public search UI, not Vue component state or an endpoint response.
// Search results keep their bilingual full path: removing all translations can
// merge two distinct categories that happen to have the same Chinese label.
export function readDxmCategorySearch({expected}={}){
  if(expected?.url&&location.href!==expected.url||expected?.account&&document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('分类目录所在商品或账号发生变化');
  const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none';
  const modals=[...document.querySelectorAll('.ant-modal')].filter(element=>visible(element)&&element.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');
  if(modals.length>1)throw new Error('选择类目弹窗不唯一，未操作');
  if(!modals.length)return null;
  const modal=modals[0],header=modal.querySelector('.modal-body-header');
  const inputs=[...header?.querySelectorAll('input[name="searchCategory"]')||[]].filter(visible);
  const languages=[...header?.querySelectorAll('.ant-select-selection-item')||[]].filter(visible);
  const resultBoxes=[...modal.querySelectorAll('.search-result')].filter(visible);
  if(inputs.length>1||languages.length>1||resultBoxes.length>1)throw new Error('分类搜索控件不唯一，未操作');
  const items=[...resultBoxes[0]?.querySelectorAll('.search-result-item')||[]].filter(visible).map(element=>{
    const attr=names=>{for(const name of names){const value=element.getAttribute(name);if(value!==null&&value!=='')return {attribute:name,value};}return null;};
    const identity=attr(['data-category-id','data-cate-id','categoryid','cateid']);
    const terminal=attr(['data-leaf','data-is-leaf','isleaf']),children=attr(['data-has-children','haschildren']);
    let leaf=null;
    if(terminal&&/^(true|false|0|1)$/.test(terminal.value))leaf=/^(true|1)$/.test(terminal.value);
    else if(children&&/^(true|false|0|1)$/.test(children.value))leaf=!/^(true|1)$/.test(children.value);
    return {rawText:element.textContent.trim(),platformCategoryId:identity?.value||null,idAttribute:identity?.attribute||null,leaf};
  });
  const searches=[...header?.querySelectorAll('button')||[]].filter(button=>visible(button)&&button.textContent.trim()==='搜索'&&!button.disabled&&button.getAttribute('aria-disabled')!=='true');
  return {query:inputs[0]?.value||'',canSearch:inputs.length===1&&!inputs[0].disabled&&!inputs[0].readOnly&&searches.length===1,language:languages[0]?.textContent.trim()||null,searchMode:resultBoxes.length===1,items,loading:[...modal.querySelectorAll('.ant-spin-spinning,[aria-busy="true"]')].some(visible)};
}

export function splitDxmSearchedCategoryPath(text){
  const raw=String(text??'').normalize('NFKC').trim();
  if(!raw||raw.length>4000)throw new Error('分类搜索结果缺少完整路径');
  const path=[],brackets=[];let part='';
  for(const character of raw){
    if(character==='('||character==='[')brackets.push(character);
    else if(character===')'||character===']'){
      if(brackets.pop()!==(character===')'?'(':'['))throw new Error('分类搜索结果路径括号不完整');
    }
    if((character==='/'||character==='>')&&!brackets.length){
      if(!part.trim())throw new Error('分类搜索结果包含空路径节点');
      path.push(part.replace(/\s+/g,' ').trim());part='';
    }else part+=character;
  }
  if(brackets.length||!part.trim())throw new Error('分类搜索结果路径不完整');
  path.push(part.replace(/\s+/g,' ').trim());
  if(path.length<2||path.length>16)throw new Error('分类搜索结果尚未提供完整多级路径');
  return path;
}

function searchedCandidate(item,expected){
  const path=splitDxmSearchedCategoryPath(item.rawText);
  // The observed SHEIN full-path search UI confirms a result directly. Other
  // platforms must expose terminal metadata; several use non-leaf search rows.
  const shein=expected?.platform==='shein'||/\/sheinProduct\//i.test(new URL(expected.url).pathname);
  const leaf=item.leaf??(shein?true:null);
  const platformCategoryId=item.platformCategoryId||null;
  const candidateId='dxm-search:'+createHash('sha256').update(JSON.stringify({path,platformCategoryId})).digest('hex');
  return {candidateId,platformCategoryId,idKind:platformCategoryId?'platform':'observed-path',label:path.at(-1),path,rawText:item.rawText,leaf,source:'store-search',leafEvidence:item.leaf===null?(shein?'shein-full-path-search':null):'visible-dom',...(item.idAttribute?{idAttribute:item.idAttribute}:{})};
}

function assertSearchArguments({expected,query}){
  if(!expected?.url||!expected?.account)throw new Error('分类搜索缺少已核对的商品页面和账号');
  if(typeof query!=='string'||!query.trim()||query.trim().length>999)throw new Error('请输入不超过 999 字的分类关键词');
  return query.trim();
}

// Caller opens the dialog on an already identity-checked product/store row.
// point uses the existing {selector,text} contract and performs native clicks.
// No new tab, platform category write, product save or publication occurs here.
export async function searchDxmCategoryCatalog({page,poll,point,expected,query,isStopped}={}){
  query=assertSearchArguments({expected,query});
  const stopped=()=>{if(isStopped?.())throw new Error('已暂停分类搜索');};
  const state=async()=>{stopped();return page.evaluate(readDxmCategorySearch,{expected});};
  let initial=await poll(async()=>{const current=await state();return current&&!current.loading&&current.canSearch?current:null;},{timeout:30000,label:'分类搜索弹窗加载'});
  // ShopCategoriesModal's search-mode Close returns to the tree. Starting from
  // that visible state means an old result list cannot satisfy this new search.
  if(initial.searchMode){
    stopped();await point({selector:'.ant-modal .ant-modal-footer button',text:'关闭'});
    initial=await poll(async()=>{const current=await state();return current&&!current.searchMode&&!current.loading?current:null;},{timeout:15000,label:'退出上次分类搜索结果'});
  }
  if(initial.language&&initial.language!=='中文类目'){
    stopped();await point({selector:'.ant-modal .modal-body-header .ant-select-selection-item',text:initial.language});
    stopped();await point({selector:'.ant-select-dropdown .ant-select-item-option-content',text:'中文类目'});
    await poll(async()=>{const current=await state();return current?.language==='中文类目'&&!current.loading?current:null;},{timeout:15000,label:'切换中文类目'});
  }
  stopped();
  await page.evaluate(({expected,query})=>{
    if(location.href!==expected.url||document.querySelector('.btn-user .user-name')?.textContent.trim()!==expected.account)throw new Error('分类目录所在商品或账号发生变化');
    const visible=element=>!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&getComputedStyle(element).display!=='none';
    const modals=[...document.querySelectorAll('.ant-modal')].filter(element=>visible(element)&&element.querySelector('.ant-modal-title')?.textContent.trim()==='选择类目');
    const inputs=modals.length===1?[...modals[0].querySelectorAll('.modal-body-header input[name="searchCategory"]')].filter(visible):[];
    if(inputs.length!==1||inputs[0].disabled||inputs[0].readOnly)throw new Error('分类关键词输入框不可用或不唯一');
    const input=inputs[0];input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,query);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  },{expected,query});
  const entered=await state();if(entered?.query!==query||entered.searchMode)throw new Error('分类搜索关键词或页面状态未就绪');
  stopped();await point({selector:'.ant-modal .modal-body-header button',text:'搜索'});
  let prior='';
  const result=await poll(async()=>{
    const current=await state();
    if(!current||current.loading||!current.searchMode||current.query!==query)return null;
    if(current.items.length>500)throw new Error('分类搜索候选超过 500 项，请缩小关键词范围');
    const fingerprint=JSON.stringify(current.items),stable=fingerprint===prior;prior=fingerprint;
    return stable?current:null;
  },{timeout:30000,label:'分类关键词搜索结果'});
  const candidates=[],issues=[];
  for(const item of result.items){
    let candidate;
    try{candidate=searchedCandidate(item,expected);}catch(error){issues.push({rawText:item.rawText,reason:error.message});continue;}
    if(candidate.leaf!==true){issues.push({rawText:item.rawText,reason:'尚未确认是末级分类'});continue;}
    candidates.push(candidate);
  }
  const counts=new Map();for(const candidate of candidates)counts.set(candidate.candidateId,(counts.get(candidate.candidateId)||0)+1);
  const unique=candidates.filter(candidate=>{
    if(counts.get(candidate.candidateId)===1)return true;
    issues.push({rawText:candidate.rawText,reason:'完整路径和可见编号仍对应多个结果，未猜测选择'});return false;
  });
  return {query,source:'store-search',language:result.language,observedAt:new Date().toISOString(),candidates:unique,issues};
}

// Search result selection confirms only the category dialog. The caller must
// re-read the corresponding product row before recording a successful change.
export async function applyDxmSearchedCategory({page,poll,point,expected,query,category,isStopped}={}){
  if(!category||!Array.isArray(category.path)||category.path.length<2||(!category.candidateId&&!category.platformCategoryId))throw new Error('分类选择缺少已确认候选及完整路径');
  const path=category.path.map(label=>String(label).normalize('NFKC').replace(/\s+/g,' ').trim());
  const catalog=await searchDxmCategoryCatalog({page,poll,point,expected,query:query||category.label||path.at(-1),isStopped});
  const matches=catalog.candidates.filter(candidate=>isDeepStrictEqual(candidate.path,path)&&(!category.platformCategoryId||String(category.platformCategoryId)===candidate.platformCategoryId)&&(!category.candidateId||category.candidateId===candidate.candidateId));
  if(matches.length!==1)throw new Error('已确认分类不再唯一匹配当前店铺搜索结果，请重新搜索核对');
  const selected=matches[0];if(isStopped?.())throw new Error('已暂停分类选择');
  const latest=await page.evaluate(readDxmCategorySearch,{expected});
  if(!latest?.searchMode||latest.loading||latest.query!==catalog.query)throw new Error('分类搜索结果已变化，未选择');
  const current=latest.items.filter(item=>item.rawText===selected.rawText&&item.platformCategoryId===selected.platformCategoryId);
  if(current.length!==1)throw new Error('分类搜索结果已变化或不唯一，未选择');
  const quote=value=>String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\n\r\f]/g,' ');
  const selector='.ant-modal .search-result .search-result-item'+(selected.platformCategoryId?'['+selected.idAttribute+'="'+quote(selected.platformCategoryId)+'"]':'');
  if(isStopped?.())throw new Error('已暂停分类选择');
  await point({selector,text:selected.rawText});
  await poll(async()=>{if(isStopped?.())throw new Error('已暂停分类选择回读');return await page.evaluate(readDxmCategorySearch,{expected})===null;},{timeout:30000,label:'分类结果选择完成'});
  return {selected:true,category:selected,path:[...selected.path],dialogClosed:true,requiresReadback:true};
}
