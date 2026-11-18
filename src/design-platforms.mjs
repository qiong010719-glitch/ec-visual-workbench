import sharp from 'sharp';
import {mainImageCount,isAplusSlot} from './image-scope.mjs';
import {validateTemu,temuPlanSignature} from './temu.mjs';

const fail=message=>Object.assign(new Error(message),{status:400});
const format=(id,width,height,ratio,generationRatio)=>Object.freeze({id,width,height,ratio,generationRatio});
const amazonFormats=Object.freeze({
  main:format('main',1024,1024,'1:1','1:1'),
  old_aplus:format('old_aplus',970,600,'97:60','16:9'),
  premium_aplus:format('premium_aplus',1464,600,'61:25','21:9'),
  mobile:format('mobile',1200,900,'4:3','4:3')
});
export const designPlatformSpecs=Object.freeze({
  amazon:Object.freeze({id:'amazon',label:'Amazon 亚马逊',formats:amazonFormats,fit:'contain',preserveOriginal:true}),
  temu:Object.freeze({id:'temu',label:'Temu',formats:Object.freeze({main:format('main',1024,1024,'1:1','1:1')}),fit:'contain'})
});
const amazonScopes=new Set(['main_count','main_only','main_and_6','main_6_old_aplus','main_6_premium_aplus','old_aplus_only','premium_aplus_only','thd_only','custom']);

// This validator is for the new one-click endpoint only. Legacy endpoints retain
// their historical behavior; an unknown platform must never become Amazon.
export function validateSingleDesignPlatform(payload) {
  if(!['fast','master'].includes(payload.generation_mode))throw fail('一体化生成仅支持单品快速或大师模式');
  if(payload.platform==='temu') {
    if(payload.image_workflow!=='shared')throw fail('Temu 单品生成请使用通用做图入口');
    validateTemu(payload);return;
  }
  if(payload.platform!=='amazon')throw fail('单品设计请选择 Amazon 或 Temu');
  if(payload.image_workflow!==undefined&&payload.image_workflow!=='platform')throw fail('Amazon 单品设计须按主图和 A+ 各自尺寸生成');
  if(payload.image_ratio!==undefined&&payload.image_ratio!==null&&payload.image_ratio!=='')throw fail('Amazon 图片比例由主图和 A+ 输出范围决定');
  if(!amazonScopes.has(payload.design_scope))throw fail('请选择有效的 Amazon 图文输出范围');
  if(payload.design_scope==='main_count')mainImageCount(payload);
  // The original editor maps custom scopes to a legacy scope name while
  // retaining the exact custom_layout. Preserve that established contract.
  if(payload.design_scope==='custom'||payload.custom_layout) {
    const c=payload.custom_layout;
    if(!c||!Number.isInteger(c.main)||c.main<0||c.main>1||!Number.isInteger(c.sub)||c.sub<0||c.sub>6||!Number.isInteger(c.aplus)||c.aplus<0||c.aplus>7||!['old','premium'].includes(c.aplus_type)||c.main+c.sub+c.aplus<1)throw fail('请确认有效的 Amazon 自定义图片方案');
  }
}

export function singleDesignPlanSignature(payload) {
  // Keep existing Temu IDs replayable after this upgrade.
  const original=JSON.stringify([temuPlanSignature(payload),payload.model]);
  return payload.platform==='amazon'?JSON.stringify([original,payload.workspace_product_id??null]):original;
}

export function designResultFormat(task) {
  if(task?.platform!=='amazon')return null;
  if(task.mobile_reformat)return amazonFormats.mobile;
  if(/^ultra/.test(task.design_scope||'')||/^ultra/.test(task.generation_mode||''))return null;
  const slot=task.slot??task.slot_idx;
  if(!Number.isInteger(slot)||slot<0||slot>13||!amazonScopes.has(task.design_scope))return null;
  if(!isAplusSlot(task,slot))return amazonFormats.main;
  return task.custom_layout?.aplus_type==='old'||/old_aplus/.test(task.design_scope)?amazonFormats.old_aplus:amazonFormats.premium_aplus;
}

// The caller persists originalBytes separately before publishing imageUrl. A
// contain fit preserves the complete product and text even if the model returns
// a different aspect ratio. No behavior is added to implicit/legacy requests.
export async function prepareDesignResult(bytes,task) {
  const output=designResultFormat(task);
  if(!output)return null;
  const input=await sharp(bytes,{limitInputPixels:50000000}).metadata();
  const rotated=[5,6,7,8].includes(input.orientation);
  const sourceDimensions={width:rotated?input.height:input.width,height:rotated?input.width:input.height};
  const normalized=await sharp(bytes,{limitInputPixels:50000000}).rotate().flatten({background:'#ffffff'})
    .resize(output.width,output.height,{fit:'contain',background:'#ffffff'}).png().toBuffer();
  return {bytes:normalized,originalBytes:bytes,formatId:output.id,
    dimensions:{width:output.width,height:output.height,ratio:output.ratio},sourceDimensions,
    fitted:sourceDimensions.width*output.height!==sourceDimensions.height*output.width};
}
