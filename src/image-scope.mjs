// Main-image-only sets may extend beyond the legacy seven gallery slots.
export const isAplusSlot = (payload, slot) => slot >= 7 && payload.design_scope !== 'main_count';
export const isSharedTemuDesign = payload => payload.platform === 'temu' && payload.image_workflow === 'shared';
export const TEMU_DESIGN_REVISION = 'single-design-parity-20261115';

export function mainImageCount(payload) {
  if (!Number.isInteger(payload.image_count) || payload.image_count < 1 || payload.image_count > 10) {
    throw Object.assign(new Error('每套主图张数须为 1 至 10 的整数'), {status:400});
  }
  if (!['fast','master'].includes(payload.generation_mode) || payload.custom_layout) {
    throw Object.assign(new Error('仅生成主图请使用快速或大师模式，不混用自定义 A+ 方案'), {status:400});
  }
  return payload.image_count;
}
