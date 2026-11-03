export const imageModels = Object.freeze([
  Object.freeze({id:'gpt-image-2',label:'GPT Image 2'}),
  Object.freeze({id:'gpt-image-2.5-sunburst',label:'GPT Image 2.5 Sunburst'})
]);

export function resolveImageModel(requested, configuration = {}) {
  const value = requested === undefined ? configuration.SUANZHOU_IMAGE_MODEL || 'gpt-image-2' : requested;
  const legacy = {'gpt-image-2-image-to-image':'gpt-image-2','gpt-image-2-5-sunburst-image-to-image':'gpt-image-2.5-sunburst'};
  const model = typeof value === 'string' ? legacy[value] || value : '';
  if (!imageModels.some(option => option.id === model)) throw Object.assign(new Error('不支持所选生图模型，请选择 GPT Image 2 或 GPT Image 2.5 Sunburst。'), {status:400});
  return model;
}
