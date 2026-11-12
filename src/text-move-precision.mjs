import {encodeRgbaPng} from './provider.mjs';
import {recognizeText, sameText} from './text-recognition.mjs';

const reject = message => Object.assign(new Error(`${message} 已保留原图，未自动重试出图。`), {code:'TEXT_MOVE_REJECTED'});
const contains = (a,b) => b.x>=a.x && b.y>=a.y && b.x+b.w<=a.x+a.w && b.y+b.h<=a.y+a.h;
const overlaps = (a,b) => a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h;
const pad = (box,n,width,height) => {
  const x=Math.max(0,box.x-n),y=Math.max(0,box.y-n);
  return {x,y,w:Math.min(width,box.x+box.w+n)-x,h:Math.min(height,box.y+box.h+n)-y};
};
const validBox = (box,width,height) => box && ['x','y','w','h'].every(k=>Number.isInteger(box[k])) && box.w>0 && box.h>0 && contains({x:0,y:0,w:width,h:height},box);

export function installPrecision(edit, precision) {
  if(precision?.version!==1 || typeof precision.sentence!=='string' || !precision.sentence.trim() || !Array.isArray(precision.boxes) || precision.boxes.length!==2 ||
    ![precision.original,precision.target,...precision.boxes].every(b=>validBox(b,edit.width,edit.height)) ||
    !contains(precision.boxes[0],precision.original) || !contains(precision.boxes[1],precision.target)) throw reject('局部改字定位记录无效。');
  const rgba=Buffer.alloc(edit.width*edit.height*4,255);
  for(const box of precision.boxes)for(let y=box.y;y<box.y+box.h;y++)rgba.fill(0,(y*edit.width+box.x)*4,(y*edit.width+box.x+box.w)*4);
  edit.precision=precision;edit.boxes=precision.boxes;edit.mask=encodeRgbaPng(edit.width,edit.height,rgba);
  return edit;
}

export async function locateTextMove(edit, {sentence,target}, recognize=recognizeText) {
  let lines;
  try {lines=await recognize(edit.source,edit.boxes[0]);} catch {throw reject('无法完成本机原字识别；本次未提交出图。');}
  const matched=lines.filter(line=>sameText(line.text,sentence));
  if(matched.length!==1 || !Number.isFinite(matched[0].confidence) || matched[0].confidence<85 || !validBox(matched[0].box,edit.width,edit.height) || !contains(edit.boxes[0],matched[0].box))
    throw reject('未能在原字范围内可靠识别这句原文（目前支持单行）；请核对文案和原字位置。本次未提交出图。');
  const original=matched[0].box;
  // The user's pin is the sentence center. Never substitute the center of a
  // large UI search rectangle, which is clamped differently near image edges.
  const moved={x:Math.round(target.x/100*edit.width-original.w/2),y:Math.round(target.y/100*edit.height-original.h/2),w:original.w,h:original.h};
  const margin=Math.max(2,Math.min(8,Math.ceil(original.h*.15)));
  if(!validBox(moved,edit.width,edit.height) || moved.x<margin || moved.y<margin || moved.x+moved.w+margin>edit.width || moved.y+moved.h+margin>edit.height)
    throw reject('新位置离图片边缘太近，整句放不下；请把位置向图内移动。本次未提交出图。');
  const boxes=[pad(original,margin,edit.width,edit.height),pad(moved,margin,edit.width,edit.height)];
  return installPrecision(edit,{version:1,sentence,original,target:moved,boxes});
}

export async function checkTextMove(edit, bytes, recognize=recognizeText) {
  const p=edit.precision;
  if(!p)return;
  try {
    const lines=await recognize(bytes,pad(p.target,Math.max(16,p.target.h),edit.width,edit.height));
    const matched=lines.filter(line=>sameText(line.text,p.sentence));
    if(matched.length!==1 || !Number.isFinite(matched[0].confidence) || matched[0].confidence<85)throw reject('返回图片中的原文未通过逐句识别检查。');
    const found=matched[0].box,tolerance=Math.max(3,Math.round(p.target.h*.1));
    if(!validBox(found,edit.width,edit.height) || !contains(p.boxes[1],found) ||
      Math.abs(found.x+found.w/2-p.target.x-p.target.w/2)>tolerance ||
      Math.abs(found.y+found.h/2-p.target.y-p.target.h/2)>tolerance ||
      Math.abs(found.w-p.target.w)>p.target.w*.2 || Math.abs(found.h-p.target.h)>p.target.h*.3)
      throw reject('返回文字偏离指定位置、大小或越出允许范围。');
    const oldLines=await recognize(bytes,p.boxes[0]);
    if(oldLines.some(line=>line.text.trim() && line.confidence>=50 && !overlaps(line.box,p.boxes[1])))
      throw reject('原字位置仍检测到文字残留。');
  } catch(error) {
    if(error.code==='TEXT_MOVE_REJECTED')throw error;
    throw reject('无法完成返回文字的本机核对。');
  }
}
