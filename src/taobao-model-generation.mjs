import crypto from 'node:crypto';

export const MODEL_GENERATION_VERSION=1;
export const MODEL_GENERATION_MODEL='gpt-image-2';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export const imageHash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function generatedModelIdentity(task){
  if(task?.purpose!=='model-reference'||task.status!=='completed'||!task.imageUrl||!task.imageSha256)return null;
  return {version:1,enabled:true,id:'model_'+imageHash(task.taskId).slice(0,24),name:'系统生成模特',source:'generated',generationTaskId:task.taskId,
    references:[{url:task.imageUrl,sha256:task.imageSha256,filename:'系统生成模特'+task.imageUrl.slice(task.imageUrl.lastIndexOf('.'))}]};
}

// One confirmed request creates one candidate. It never changes the selected person.
export function createModelGeneration({store,enqueue,imageProvider,saveImage,configured,publicTask}){
  const get=taskId=>{
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(taskId))fail(400,'模特任务编号无效。');
    const task=store.state.tasks['hyrule_tasks/'+taskId];
    if(task?.purpose!=='model-reference')fail(404,'模特任务不存在；未重新提交生成。');
    return {...publicTask(task),candidateIdentity:generatedModelIdentity(task)};
  };
  const create=payload=>{
    if(!payload||!/^modelgen_[a-zA-Z0-9_-]{1,100}$/.test(payload.task_id||''))fail(400,'模特任务编号无效。');
    if(payload.confirmed!==true)fail(400,'请先确认单张模特生成会使用图片服务额度。');
    const description=typeof payload.description==='string'?payload.description.trim():'';
    if(!description||description.length>1200)fail(400,'请填写1200字以内的模特外观与服装要求。');
    const key='hyrule_tasks/'+payload.task_id,prior=store.state.tasks[key];
    if(prior){
      if(prior.purpose!=='model-reference'||prior.description!==description)fail(409,'任务编号已用于其他要求，请先核对原任务。');
      return get(payload.task_id);
    }
    if(!configured)fail(503,'尚未配置图片服务，未提交模特生成。');
    const prompt=['生成一张原创虚拟成年电商模特的身份参考照片，画面中仅有这一位成年人。',
      '单幅写实摄影，正面或轻微侧身，脸部五官与发型清楚，眼睛看向镜头，自然光，简洁纯色背景，中景至膝部，服装完整可辨。',
      '不要商品、文字、水印、品牌、拼图、多个角度或第二个人。本图将作为商品图片与后续视频中同一位人物的固定参考。',
      '外观与服装要求（只用于人物设计）：'+description].join('\n');
    store.task(key,{taskId:payload.task_id,purpose:'model-reference',status:'pending',phase:'queued',description,prompt,model:MODEL_GENERATION_MODEL,referenceImages:[],createdAt:new Date().toISOString()});
    enqueue(async()=>{
      store.task(key,{status:'running',phase:'generating'});
      try{
        const bytes=await imageProvider({prompt,references:[],ratio:'3:4',model:MODEL_GENERATION_MODEL,kind:'model-reference',onProgress:patch=>store.task(key,patch)});
        store.task(key,{status:'completed',phase:'completed',imageUrl:saveImage(bytes),imageSha256:imageHash(bytes),error:null});
      }catch(error){
        store.task(key,{status:'failed',phase:store.state.tasks[key].resultUrl?'download_failed':'generation_failed',error:String(error.message).slice(0,500)});
      }
    });
    return get(payload.task_id);
  };
  return {get,create};
}
