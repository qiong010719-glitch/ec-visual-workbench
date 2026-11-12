import sharp from 'sharp';
import {Worker} from 'node:worker_threads';

// Bundled Chinese data and WASM only: no download, cloud OCR or persistent cache.
// Each job owns its worker so concurrent image tasks cannot change its settings.
export async function recognizeText(bytes, box) {
  const scale = Math.min(2, 4096 / Math.max(box.w, box.h));
  const crop = await sharp(bytes).extract({left:box.x, top:box.y, width:box.w, height:box.h})
    .resize({width:Math.round(box.w * scale)}).png().toBuffer();
  const worker = new Worker(new URL('./text-recognition-worker.mjs',import.meta.url),{workerData:crop});
  let timer;
  try {
    const lines=await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('本机文字识别超时')),30000);
      worker.once('message',message=>message.error?reject(new Error(message.error)):resolve(message.lines));
      worker.once('error',reject);
      worker.once('exit',()=>reject(new Error('本机文字识别进程退出')));
    });
    return lines.map(line=>({text:line.text,confidence:line.confidence,
      box:{x:box.x+Math.floor(line.bbox.x0/scale),y:box.y+Math.floor(line.bbox.y0/scale),
        w:Math.ceil(line.bbox.x1/scale)-Math.floor(line.bbox.x0/scale),h:Math.ceil(line.bbox.y1/scale)-Math.floor(line.bbox.y0/scale)}}));
  } finally {clearTimeout(timer);await worker.terminate();}
}

// Normalize OCR spacing/full-width punctuation, but never discard punctuation,
// confuse similar characters, or accept a substring as the entire sentence.
export const sameText = (a, b) => String(a).normalize('NFKC').replace(/\s/gu, '') === String(b).normalize('NFKC').replace(/\s/gu, '');
