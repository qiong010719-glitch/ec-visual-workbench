import sharp from 'sharp';
import {editMask, encodeRgbaPng, pixelBox} from './provider.mjs';
import {checkTextMove} from './text-move-precision.mjs';

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

function paintArea(edit) {
  if(edit.precision)return edit.precision.target;
  const box = edit.boxes[1];
  const margin = Math.max(1, Math.round(Math.min(box.w, box.h) * .12));
  return {x:box.x+margin,y:box.y+margin,w:Math.max(1,box.w-margin*2),h:Math.max(1,box.h-margin*2)};
}

// A separate visual instruction image. Never alter the edit target, paint
// glyphs locally, or composite this guide into the user's output.
function visitGuide(edit, visit) {
  const {width, height, boxes} = edit;
  const thickness = Math.max(1, Math.round(Math.min(width,height)/400));
  const pixel = (x,y,color) => {
    if(x<0||y<0||x>=width||y>=height)return;
    visit((y*width+x)*4,color);
  };
  const rect = (box,color) => {
    for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++) {
      if(x<box.x+thickness||x>=box.x+box.w-thickness||y<box.y+thickness||y>=box.y+box.h-thickness)pixel(x,y,color);
    }
  };
  rect(boxes[0],[235,40,65]);
  const area=paintArea(edit), blue=[0,105,255];
  rect(area,blue);
  const cx=Math.round(area.x+(area.w-1)/2),cy=Math.round(area.y+(area.h-1)/2);
  const arm=Math.max(3,thickness*5);
  for(let d=-arm;d<=arm;d++)for(let t=0;t<thickness;t++) {
    pixel(cx+d,cy+t,blue);pixel(cx+t,cy+d,blue);
  }
}

export function textMoveGuide(edit) {
  const data = Buffer.from(edit.data);
  visitGuide(edit,(i,color)=>{for(let c=0;c<3;c++)data[i+c]=color[c];data[i+3]=255;});
  return encodeRgbaPng(edit.width,edit.height,data);
}

function assertGuideRemoved(edit,result) {
  let marked=0,copied=0;
  visitGuide(edit,(i,color)=>{
    if(Math.max(...color.map((v,c)=>Math.abs(edit.data[i+c]-v)))<=70)return;
    marked++;
    if(Math.max(...color.map((v,c)=>Math.abs(result[i+c]-v)))<=35)copied++;
  });
  if(copied>=Math.max(12,marked*.2))throw rejected('返回图片残留了位置参考标记。');
}

export function textMoveBoundsNote(edit) {
  const area = paintArea(edit);
  return [
    '输入图1是唯一编辑底图。输入图2只是同一张图的位置指示，不是要合成进结果的素材。红框标出要擦去原文的区域；蓝框标出新文案必须完整落入的范围，蓝色十字标出整句的中心。',
    `严格按图2的蓝色十字居中绘制原文。蓝框像素范围：左上角 (${area.x}, ${area.y})，右下角 (${area.x+area.w-1}, ${area.y+area.h-1})，原图 ${edit.width}×${edit.height}。所有字和标点都必须在蓝框以内。`,
    edit.precision ? '保留原句的单行排版、字号和宽高。严格在蓝框原样绘制整句，不要缩小、换行、删字或偏移。允许文字覆盖原物体，但不要删除、搬动或重画物体来腾位置。' : '位置优先于自动排版。允许文案在指定位置覆盖原有物体，但不要搬动、删除或重画物体来腾位置。不要为了避让植物、商品或其他画面内容把文字移向旁边空白；空间不足时缩小字号或在框内换行，不能删字。',
    '仅从图1恢复背景和绘制原文。输出中必须完全没有图2的红框、蓝框、十字或其他指示线。'
  ].join('\n');
}

// A conservative seam check, not OCR. Strong changes touching the paint box's
// cut boundary can be clipped by compositing, so reject rather than cut them off.
// It can reject changed objects too, and cannot prove spelling or text placement.
export function assertSafeTextBoundary(edit, result) {
  const {width, height, data:original, boxes} = edit;
  const [erase, paint] = boxes;
  const radius = Math.max(1, Math.round(Math.min(width, height) / 600));
  const alignmentRadius = Math.min(3,radius+1);
  const differs = (i,j) => Math.max(...[0,1,2,3].map(c=>Math.abs(original[i+c]-result[j+c])))>48;
  const changed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    // An overlapping erase area is editable; it is not a compositing seam.
    if (inside(erase, x, y)) return false;
    const i = (y * width + x) * 4;
    if(!differs(i,i))return false;
    // Model output can shift an existing leaf/outline by a few pixels. Require
    // a genuinely new local colour, not just a mismatched edge at one pixel.
    // This remains a heuristic: nearby same-colour details can hide small ink.
    for(let sy=Math.max(0,y-alignmentRadius);sy<=Math.min(height-1,y+alignmentRadius);sy++) {
      for(let sx=Math.max(0,x-alignmentRadius);sx<=Math.min(width-1,x+alignmentRadius);sx++) {
        if(!differs((sy*width+sx)*4,i))return false;
      }
    }
    return true;
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

export async function finishTextMove(edit, resultBytes, recognize) {
  let result;
  try {result = await pixels(resultBytes);} catch {throw rejected('无法校验局部改字返回的图片。');}
  if (result.width !== edit.width || result.height !== edit.height) throw rejected('局部改字返回的尺寸与原图不一致。');
  assertGuideRemoved(edit,result.data);
  await checkTextMove(edit,encodeRgbaPng(edit.width,edit.height,result.data),recognize);
  assertSafeTextBoundary(edit, result.data);
  // Copy only editable pixels. Opaque-mask RGBA is always the decoded original,
  // including transparency; lossless PNG avoids changing it during re-encoding.
  const merged = Buffer.from(edit.data);
  for (const box of edit.boxes) for (let y = box.y; y < box.y + box.h; y++) {
    const start = (y * edit.width + box.x) * 4;
    result.data.copy(merged, start, start, start + box.w * 4);
  }
  const output=encodeRgbaPng(edit.width, edit.height, merged);
  // Recheck the actual delivered pixels too: compositing must not leave a
  // readable raw result as a clipped or broken sentence in the final image.
  if(edit.precision)await checkTextMove(edit,output,recognize);
  return output;
}
