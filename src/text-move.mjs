import sharp from 'sharp';
import {editMask, encodeRgbaPng, pixelBox} from './provider.mjs';

const options = {limitInputPixels: 16777216, failOn: 'warning'};
const rejected = message => Object.assign(new Error(`${message} 已保留原图，未自动重试出图。`), {code:'TEXT_MOVE_REJECTED'});
const inside = (box, x, y) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;

async function pixels(bytes) {
  const image = sharp(bytes, options);
  const metadata = await image.metadata();
  if ((metadata.pages || 1) !== 1) throw new Error('局部改字只支持静态图片');
  const {data, info} = await image.autoOrient().toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
  return {data, width:info.width, height:info.height, orientation:metadata.orientation};
}

// Decode before any paid request; use displayed orientation for both image and mask.
export async function prepareTextMove(bytes, regions) {
  let original;
  try {original = await pixels(bytes);} catch {throw new Error('无法读取局部改字的原图；请使用完整的静态 PNG、JPEG 或 WebP，像素总数不超过 16777216。本次未发起新的出图请求。');}
  const {width, height, data, orientation} = original;
  const source = orientation && orientation !== 1 ? encodeRgbaPng(width, height, data) : bytes;
  return {...original, source, regions, boxes:regions.map(region => pixelBox(region, width, height)), mask:editMask(source, regions)};
}

export function textMoveBoundsNote(edit) {
  const box = edit.boxes[1];
  const margin = Math.max(1, Math.round(Math.min(box.w, box.h) * .12));
  return `新文字必须全部放进新位方框：左上角 (${box.x}, ${box.y})，右下角 (${box.x + box.w - 1}, ${box.y + box.h - 1})，单位像素，原图 ${edit.width}×${edit.height}。所有字和标点都要在框内至少留 ${margin} 像素空隙，整句居中。空间不足可缩小字号或换行，不能为了避开物品把文字移到框外；不要省略文字。`;
}

// A conservative seam check, not OCR. Strong changes touching the paint box's
// cut boundary can be clipped by compositing, so reject rather than cut them off.
// It can reject changed objects too, and cannot prove spelling or text placement.
export function assertSafeTextBoundary(edit, result) {
  const {width, height, data:original, boxes} = edit;
  const [erase, paint] = boxes;
  const radius = Math.max(1, Math.round(Math.min(width, height) / 600));
  const changed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    // An overlapping erase area is editable; it is not a compositing seam.
    if (inside(erase, x, y)) return false;
    const i = (y * width + x) * 4;
    return Math.max(...[0,1,2,3].map(c => Math.abs(original[i+c] - result[i+c]))) > 48;
  };
  const sides = [
    {vertical:true, fixed:paint.x, start:paint.y, length:paint.h},
    {vertical:true, fixed:paint.x+paint.w-1, start:paint.y, length:paint.h},
    {vertical:false, fixed:paint.y, start:paint.x, length:paint.w},
    {vertical:false, fixed:paint.y+paint.h-1, start:paint.x, length:paint.w}
  ];
  for (const side of sides) {
    let run = 0;
    for (let along = side.start; along < side.start + side.length; along++) {
      let touched = false;
      for (let across = side.fixed-radius; across <= side.fixed+radius; across++) {
        if (changed(side.vertical ? across : along, side.vertical ? along : across)) {touched=true;break;}
      }
      run = touched ? run+1 : 0;
      if (run >= 3) throw rejected('新文字区域的边界有明显变化，直接裁回可能截字；请调整位置后再试。');
    }
  }
}

export async function finishTextMove(edit, resultBytes) {
  let result;
  try {result = await pixels(resultBytes);} catch {throw rejected('无法校验局部改字返回的图片。');}
  if (result.width !== edit.width || result.height !== edit.height) throw rejected('局部改字返回的尺寸与原图不一致。');
  assertSafeTextBoundary(edit, result.data);
  // Copy only editable pixels. Opaque-mask RGBA is always the decoded original,
  // including transparency; lossless PNG avoids changing it during re-encoding.
  const merged = Buffer.from(edit.data);
  for (const box of edit.boxes) for (let y = box.y; y < box.y + box.h; y++) {
    const start = (y * edit.width + box.x) * 4;
    result.data.copy(merged, start, start, start + box.w * 4);
  }
  return encodeRgbaPng(edit.width, edit.height, merged);
}
