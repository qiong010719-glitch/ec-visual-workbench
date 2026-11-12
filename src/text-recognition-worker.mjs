import {parentPort,workerData} from 'node:worker_threads';
import {createWorker,PSM} from 'tesseract.js';
import chinese from '@tesseract.js-data/chi_sim';

// Isolate library startup errors as well as recognition errors. The parent
// terminates this worker and its children on success, error or startup timeout.
let worker;
try {
  worker=await createWorker('chi_sim',1,{langPath:chinese.langPath,cacheMethod:'none',gzip:true,
    errorHandler:()=>parentPort.postMessage({error:'本机文字识别失败'})});
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,user_defined_dpi:'150'});
  const {data}=await worker.recognize(Buffer.from(workerData),{},{text:true,blocks:true});
  const lines=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.map(({text,confidence,bbox})=>({text,confidence,bbox}))));
  parentPort.postMessage({lines});
} catch {parentPort.postMessage({error:'本机文字识别失败'});}
finally {await worker?.terminate();}
