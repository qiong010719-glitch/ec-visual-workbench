import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const text=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const clone=value=>structuredClone(value);
const validPath=path=>Array.isArray(path)&&path.length>0&&path.length<=16&&path.every(part=>typeof part==='string'&&text(part)&&part.length<=240);
const key=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Catalog semantics cannot be inferred from a stripped parenthetical. Only
// the DOM reader may resolve a bilingual breadcrumb against observed nodes.
const samePath=(actual,expected)=>isDeepStrictEqual(actual.map(text),expected.map(text));

export function categoryMappingScope(value={}){
  const scope={account:text(value.account),platform:text(value.platform).toLowerCase(),mode:text(value.mode||value.businessMode||'default'),storeBindingKey:text(value.storeBindingKey||value.storeKey),site:text(value.site)};
  if(!scope.account||!scope.platform||!scope.storeBindingKey)throw new Error('分类映射缺少账号、平台或店铺身份');
  return scope;
}

function sourcePathOf({sourcePath,sourceFacts}={}){
  const path=sourcePath??sourceFacts?.categoryPath;
  return validPath(path)?path.map(text):null;
}

function leaves(options){
  if(!Array.isArray(options))return [];
  return options.filter(option=>option?.leaf===true&&typeof option.id==='string'&&option.id&&validPath(option.path)&&text(option.label)===text(option.path.at(-1))).map(option=>({id:option.id,label:option.label,path:clone(option.path)}));
}

const targetEquals=(one,two)=>one?.id===two?.id&&one?.label===two?.label&&isDeepStrictEqual(one?.path,two?.path);

// The source category number is deliberately unused: IDs belong to the target
// platform's observed catalog. A same-leaf-name match is only a suggestion.
export function suggestListingCategory({sourceFacts,sourcePath,scope,options=[],mappings=[]}={}){
  const source=sourcePathOf({sourceFacts,sourcePath}),identity=categoryMappingScope(scope),available=leaves(options);
  const pending=(reason,candidates=[],status='needs-category')=>({status,category:null,candidates:clone(candidates),reason,sourcePath:source||[],scope:identity});
  if(!source)return pending('尚未读取 Temu 前端分类路径，请先补读来源资料');
  const confirmed=mappings.filter(mapping=>mapping?.version===1&&mapping.confirmedAt&&isDeepStrictEqual(mapping.scope,identity)&&isDeepStrictEqual(mapping.sourcePath,source));
  const targets=[...new Map(confirmed.map(mapping=>[JSON.stringify(mapping.targetCategory),mapping.targetCategory])).values()];
  if(targets.length>1)return pending('此来源分类存在多个已确认映射，请重新确认当前分类',targets,'ambiguous');
  if(targets.length===1){
    const matched=available.filter(option=>targetEquals(option,targets[0]));
    if(matched.length===1)return {status:'matched',category:clone(matched[0]),candidates:clone(matched),reason:'已确认的来源分类映射仍在本店当前目录中',sourcePath:source,scope:identity,method:'confirmed-mapping'};
    return pending('已确认的目标分类不在本店当前目录中，请重新读取并确认分类');
  }
  const exact=available.filter(option=>samePath(source,option.path));
  if(exact.length===1)return {status:'matched',category:clone(exact[0]),candidates:clone(exact),reason:'来源完整分类路径与本店当前末级目录唯一对应',sourcePath:source,scope:identity,method:'exact-observed-path'};
  if(exact.length>1)return pending('来源完整路径对应多个目标分类，请确认具体分类',exact,'ambiguous');
  const candidates=available.filter(option=>samePath([source.at(-1)],[option.path.at(-1)]));
  return pending(candidates.length?'已找到同名末级分类，完整路径不同，请确认对应关系':'目标平台分类路径不同，请确认对应的末级分类',candidates,candidates.length>1?'ambiguous':'needs-category');
}

export function createConfirmedCategoryMapping({sourceFacts,sourcePath,scope,category,options=[],confirmedAt=new Date().toISOString()}={}){
  const source=sourcePathOf({sourceFacts,sourcePath}),identity=categoryMappingScope(scope);
  if(!source)throw new Error('缺少 Temu 前端完整分类路径，不能建立来源分类映射');
  const matched=leaves(options).filter(option=>targetEquals(option,category));
  if(matched.length!==1)throw new Error('确认的分类不在本店当前唯一末级目录中');
  if(typeof confirmedAt!=='string'||!Number.isFinite(Date.parse(confirmedAt)))throw new Error('分类确认时间无效');
  return {version:1,id:key([identity,source]),scope:identity,sourcePath:source,targetCategory:clone(matched[0]),confirmedAt};
}
