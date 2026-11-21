import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {generatedModelIdentity} from './taobao-model-generation.mjs';

export const MODEL_IDENTITY_VERSION=1;
export const MODEL_PLACEMENT_VERSION=1;
const fail=message=>{throw Object.assign(Error(message),{status:400});};

export function hydrateModelIdentity(value,mediaDirectory,{draft=false,tasks}={}) {
  if(value===undefined)return undefined;
  if(!value||typeof value.enabled!=='boolean'||(value.version!==undefined&&value.version!==1))fail('模特设置无效，请重新选择是否出镜。');
  if(!value.enabled&&!draft)return {version:1,enabled:false};
  const refs=value.references || [];
  if(!Array.isArray(refs))fail('模特参考格式无效。');
  // A draft may remember an unfinished choice, but generation must still reject it.
  if(draft&&!refs.length&&!value.id)return {version:1,enabled:value.enabled};
  if(!value.enabled&&!refs.length)return {version:1,enabled:false};
  if(!/^[\w-]{1,120}$/.test(value.id || '')||!Array.isArray(refs)||refs.length!==1)fail('选择模特出镜后，请先上传或生成并选定一张固定模特参考图。');
  const references=refs.map(ref=>{
    if(!/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(ref?.url || ''))fail('模特参考必须是已上传到本项目的图片。');
    let bytes;try{bytes=fs.readFileSync(path.join(mediaDirectory,path.basename(ref.url)));}catch{fail('模特参考图已丢失，请重新上传；没有提交生成。');}
    const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
    if(ref.sha256!==sha256)fail('模特参考图已变化，请重新上传并构思；没有提交生成。');
    return {url:ref.url,sha256,filename:typeof ref.filename==='string'?ref.filename.slice(0,255):'模特参考图'};
  });
  if(value.source!==undefined&&!['upload','generated'].includes(value.source))fail('模特来源无效。');
  if(value.source==='generated'){
    const original=generatedModelIdentity(tasks?.['hyrule_tasks/'+value.generationTaskId]);
    if(!original||original.id!==value.id||original.references[0].url!==references[0].url||original.references[0].sha256!==references[0].sha256)fail('系统模特与已完成的生成任务不一致，请重新选择原结果。');
  }
  return {version:1,enabled:value.enabled,id:value.id,name:typeof value.name==='string'?value.name.slice(0,100):'固定模特',references,
    ...(value.source?{source:value.source}:{}),...(value.source==='generated'?{generationTaskId:value.generationTaskId}:{})};
}

export function hydrateModelPayload(payload,mediaDirectory,tasks) {
  const identity=hydrateModelIdentity(payload.model_identity,mediaDirectory,{tasks});
  if(!identity)return payload;
  if(identity.enabled&&/^thd|^ultra/.test(payload.design_scope || ''))fail('固定模特用于淘宝主图、SKU与详情，请使用快速或大师模式。');
  return {...payload,model_identity:identity};
}

// Casting fixes the identity of a person, not the content of every shot.
export function modelPresence(payload,section) {
  if(!payload.model_identity?.enabled||section.outputRole==='sku'||section.outputConstraint)return 'none';
  const board=section.storyboard;
  if(['none','hands','person'].includes(board?.humanPresence))return board.humanPresence;
  if(board)return board.sceneType==='lifestyle'&&board.productRole!=='detail'?'person':'none';
  // The hero can introduce the chosen model. Other unstructured layouts keep
  // their original product/detail purpose; only scene/process slots use people.
  if([0,3,7,9].includes(section.slot))return 'person';
  if([10,12].includes(section.slot))return 'hands';
  return 'none';
}

export function modelDirection(payload,section) {
  const identity=payload.model_identity;
  if(!identity)return '';
  if(!identity.enabled)return '模特出镜：否。本张只展示商品、物件或无人环境，不出现人物、脸、身体、手部或人物倒影。此设置优先于风格、对标和自动分镜中的人物安排。';
  if(!section)return '模特出镜：是，按逐图分镜安排。固定模特只约束人物身份，不要求每张有人；保留无人静物、商品微距、结构图、仅手部操作与人物场景的不同用途。SKU规格图不添加模特。只有人物或手部镜头使用绑定的人物参考，图片与后续视频共用同一人物身份，不借用对标人物。不得为展示人脸而改变原镜头、商品比例或信息版式。';
  const presence=modelPresence(payload,section);
  if(presence==='none')return '本图人物安排：不出镜。保持本图的商品、微距、结构或规格用途，不出现人物、脸、身体、手部或人物倒影；即使整套启用了固定模特，本图也不添加人物，不采用人物参考或其他图的人物构图。参考图片里附带的人物不复刻。本图安排优先于通用风格和文字方案中的人物建议，已有商品画面中的印刷人像不作人物出镜处理。';
  return [
    presence==='hands'?'本图人物安排：仅手部。只保留原分镜需要的操作手部，肤色、袖口与绑定模特一致；不出现脸部、全身或人物肖像，不为识别人脸而拉远镜头。':'本图人物安排：人物出镜。使用所绑定参考图中的同一位模特，保持其脸型、五官、发型、肤色、体态与服装，不随机换人，不借用对标人物，不增加第二位模特。人物服从本图的场景与动作，不强制正面看镜头或全身展示。',
    '模特参考只定义人物身份，本品/SKU参考只定义商品。人物自然展示或配合商品的已知用途，不让商品被人体遮挡或变形，不凭空演示未知功能。',
    '保留本图原定镜头、商品比例、版式和信息重点，不改成统一的人物站在商品旁的海报；人物身份一致不等于构图一致。不得把规则、参考编号或文件名印到画面上。'
  ].join('\n');
}

export function modelStoryboard(board,payload) {
  if(!board||!payload.model_identity)return board;
  const enabled=payload.model_identity.enabled;
  if(!enabled&&board.humanPresence==='none')return board;
  if(enabled)return board;
  return {...board,humanPresence:'none',
    scene:'与本品已知用途相符的无人环境或静物背景，只安排商品与必要物件',
    camera:'完整商品与真实局部构成视觉层次，不出现人物和手部',
    action:'以商品静置、可见结构和物件关系表达当前信息',
    composition:'以商品和已有事实组织图文层级，不使用人物、手部和人像装饰',
    productScale:'完整商品清晰可识别，不被人物、道具和文字遮挡'};
}

export function modelStyleGuide(guide,payload) {
  if(!payload.model_identity)return guide;
  return guide.replace('不反复使用同一女性、','不反复使用同一人物构图、')+'\n'+modelDirection(payload);
}

const binding=value=>value?JSON.stringify({enabled:value.enabled,...(value.enabled?{id:value.id,references:value.references?.map(({url,sha256})=>({url,sha256}))}:{})}):'legacy';
export function assertModelPlan(payload,plan) {
  if(binding(payload.model_identity)!==binding(plan.modelIdentity))throw Object.assign(Error('模特出镜设置或人物参考已改变，请重新构思后再生成；已有图片保留。'),{status:409});
  if(payload.model_identity?.enabled&&plan.modelPlacementVersion!==MODEL_PLACEMENT_VERSION)throw Object.assign(Error('模特分镜规则已更新，请重新构思后再生成；旧方案会让每张图都带人，已有图片和已选模特保留。'),{status:409});
}
