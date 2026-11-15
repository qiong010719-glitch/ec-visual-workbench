import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MODEL_IDENTITY_VERSION=1;
const fail=message=>{throw Object.assign(Error(message),{status:400});};

export function hydrateModelIdentity(value,mediaDirectory,{draft=false}={}) {
  if(value===undefined)return undefined;
  if(!value||typeof value.enabled!=='boolean'||(value.version!==undefined&&value.version!==1))fail('模特设置无效，请重新选择是否出镜。');
  if(!value.enabled&&!draft)return {version:1,enabled:false};
  const refs=value.references || [];
  if(!value.enabled&&!refs.length)return {version:1,enabled:false};
  if(!/^[\w-]{1,120}$/.test(value.id || '')||!Array.isArray(refs)||refs.length!==1)fail('选择模特出镜后，请先上传一张固定模特参考图。');
  const references=refs.map(ref=>{
    if(!/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(ref?.url || ''))fail('模特参考必须是已上传到本项目的图片。');
    let bytes;try{bytes=fs.readFileSync(path.join(mediaDirectory,path.basename(ref.url)));}catch{fail('模特参考图已丢失，请重新上传；没有提交生成。');}
    const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
    if(ref.sha256!==sha256)fail('模特参考图已变化，请重新上传并构思；没有提交生成。');
    return {url:ref.url,sha256,filename:typeof ref.filename==='string'?ref.filename.slice(0,255):'模特参考图'};
  });
  return {version:1,enabled:value.enabled,id:value.id,name:typeof value.name==='string'?value.name.slice(0,100):'固定模特',references};
}

export function hydrateModelPayload(payload,mediaDirectory) {
  const identity=hydrateModelIdentity(payload.model_identity,mediaDirectory);
  if(!identity)return payload;
  if(identity.enabled&&/^thd|^ultra/.test(payload.design_scope || ''))fail('固定模特用于淘宝主图、SKU与详情，请使用快速或大师模式。');
  return {...payload,model_identity:identity};
}

export function modelDirection(payload,section={}) {
  const identity=payload.model_identity;
  if(!identity)return '';
  if(!identity.enabled)return '模特出镜：否。本张只展示商品、物件或无人环境，不出现人物、脸、身体、手部或人物倒影。此设置优先于风格、对标和自动分镜中的人物安排。';
  return [
    '模特出镜：是。本张必须出现所绑定参考图中的同一位模特，面部清晰可辨；保持其脸型、五官、发型、肤色、体态与服装，不随机换人，不把对标中的人当成本次模特，不增加第二位模特。',
    '模特参考只定义人物身份，本品/SKU参考只定义商品。人物自然展示或配合商品的已知用途，不让商品被人体遮挡或变形，不凭空演示未知功能。',
    section.outputRole==='sku'?'SKU图仍以完整商品及清晰规格为主，模特位于商品侧面，不遮挡尺寸、部件和规格文字，不改成小商品卖点拼版。':'本图兼顾完整商品和可辨认的模特，动作与镜头可以变化，但不通过换脸、换发型或换衣服制造多样性。',
    '图片与后续视频共用这份人物参考。此设置优先于自动分镜的无人或仅手部安排；不得把规则、参考编号或文件名印到画面上。'
  ].join('\n');
}

export function modelStoryboard(board,payload,slot=0) {
  if(!board||!payload.model_identity)return board;
  const enabled=payload.model_identity.enabled;
  if(!enabled&&board.humanPresence==='none')return board;
  if(enabled&&board.humanPresence==='person')return {...board,scene:board.scene+'；所有人物画面均使用绑定的同一位模特',action:board.action+'；不换人、不换服装'};
  const camera=['商品与同一模特脸部均清楚的环境中景，商品完整入镜','商品大图与同一模特的侧向展示关系，面部可辨，不遮挡商品','同一模特的自然使用中景，辅以本品可见细节，面部及商品均清楚'][Math.abs(slot)%3];
  return {...board,humanPresence:enabled?'person':'none',
    scene:enabled?'与本品已知用途相符的空间，同一位参考模特与商品同时入镜':'与本品已知用途相符的无人环境或静物背景，只安排商品与必要物件',
    camera:enabled?camera:'完整商品与真实局部构成视觉层次，不出现人物和手部',
    action:enabled?'同一位模特自然展示商品，不演示未经提供的功能':'以商品静置、可见结构和物件关系表达当前信息',
    composition:enabled?'商品和同一位模特共同组织画面，信息区不遮挡商品或面部':'以商品和已有事实组织图文层级，不使用人物、手部和人像装饰',
    productScale:'完整商品清晰可识别，不被人物、道具和文字遮挡'};
}

export function modelStyleGuide(guide,payload) {
  if(!payload.model_identity)return guide;
  return guide.split('\n').filter(line=>!line.startsWith('整套展示按卖点混合：')).join('\n')+'\n'+modelDirection(payload);
}

const binding=value=>value?JSON.stringify({enabled:value.enabled,...(value.enabled?{id:value.id,references:value.references?.map(({url,sha256})=>({url,sha256}))}:{})}):'legacy';
export function assertModelPlan(payload,plan) {
  if(binding(payload.model_identity)!==binding(plan.modelIdentity))throw Object.assign(Error('模特出镜设置或人物参考已改变，请重新构思后再生成；已有图片保留。'),{status:409});
}
