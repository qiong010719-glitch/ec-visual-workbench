import sharp from 'sharp';

export const isTemu = payload => payload?.platform === 'temu';
export const temuFormats = Object.freeze({
  '1:1': {width:1024, height:1024, size:'1024x1024'},
  '3:4': {width:1152, height:1536, size:'1152x1536'}
});
const invalid = message => Object.assign(new Error(message), {status:400});

export function validateTemu(payload, {editing=false}={}) {
  if (!isTemu(payload)) return;
  if (!Object.hasOwn(temuFormats, payload.image_ratio)) throw invalid('Temu 图片比例请选择 1:1 或 3:4');
  if (payload.mobile_reformat || /^ultra/.test(payload.design_scope || '') || /^ultra/.test(payload.generation_mode || payload.mode || '')) throw invalid('Temu 当前按单张生成主图，不使用合图或手机 A+ 流程');
  if (editing) return;
  if (payload.design_scope !== 'temu_main' || payload.custom_layout) throw invalid('Temu 仅生成一组主图，详情页按相同顺序复用');
  if (!Number.isInteger(payload.image_count) || payload.image_count < 1 || payload.image_count > 7) throw invalid('每套图片张数须为 1 至 7 的整数');
  if (!['fast','master'].includes(payload.generation_mode)) throw invalid('请选择快速设计或大师设计');
}

export function temuSlotPlan(payload) {
  validateTemu(payload);
  return Array.from({length:payload.image_count}, (_,slot) => ({
    slot, title:slot ? `【卖点图${slot}】` : '【主图】', ratio:payload.image_ratio,
    detail:slot ? '每张围绕一项已确认的卖点、使用情境或可见细节展开，适合手机阅读；主图和详情共用此图。'
      : 'Temu 首图：完整清楚展示当前商品，采用干净背景或符合商品用途的真实场景；不强制白底。外形、颜色、数量、结构和配件与上传素材一致。不添加促销贴纸、虚假参数或认证。'
  }));
}

// A saved plan is valid only for the exact product inputs it was built from.
export function temuPlanSignature(payload) {
  return JSON.stringify(['platform','product_name','product_desc','target_market','target_lang','category','generation_mode','visual_style','info_density','scene_intensity','strict_requirements','image_ratio','image_count','categorized_images','slot_directives','reference_ids'].map(key=>payload[key] ?? null));
}

export async function prepareTemuImage(bytes, ratio) {
  const format=temuFormats[ratio];
  if (!format) throw invalid('Temu 图片比例无效');
  const input=await sharp(bytes,{limitInputPixels:40000000}).metadata();
  const rotated=[5,6,7,8].includes(input.orientation);
  const sourceWidth=rotated?input.height:input.width,sourceHeight=rotated?input.width:input.height;
  // Contain preserves the whole product and all text if a provider ignores size.
  const image=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize(format.width,format.height,{fit:'contain',background:'#ffffff'}).png().toBuffer();
  return {bytes:image,dimensions:{width:format.width,height:format.height,ratio},sourceDimensions:{width:sourceWidth,height:sourceHeight},fitted:sourceWidth*format.height!==sourceHeight*format.width};
}

export async function verifyTemuImages(files, ratio) {
  const expected=temuFormats[ratio];
  if (!expected) throw invalid('请选择有效的 Temu 图片比例');
  for (const file of files) {
    const image=await sharp(file,{limitInputPixels:40000000}).metadata();
    if (image.width!==expected.width || image.height!==expected.height) throw invalid('图片尺寸与所选 Temu 比例不一致，请使用本套生成结果');
  }
}
