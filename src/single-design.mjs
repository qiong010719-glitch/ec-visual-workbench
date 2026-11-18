import {slotPlan} from './planner.mjs';
import {validateSingleDesignPlatform,singleDesignPlanSignature} from './design-platforms.mjs';
import {resolveImageModel} from './image-models.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export const SINGLE_DESIGN_REVISION='single-design-one-click-20261115';

// The server owns the continuation. Reloads only observe the same task IDs.
export function createSingleDesign({store,configuration,imageAvailable,submitPlan,submitImages}) {
  for(const task of Object.values(store.state.tasks)) {
    if(task.singleDesign?.phase==='planning'&&task.status==='completed') {
      store.task('agent_tasks/'+task.payload.agent_task_id,{singleDesign:{...task.singleDesign,phase:'failed',error:'服务曾中断，尚未提交图片；请核对方案后手动生成。'}});
    }
  }
  function start(input) {
    const payload={...input};
    if(!/^single_[a-zA-Z0-9_-]{1,90}$/.test(payload.agent_task_id||''))throw fail(400,'单品任务编号无效');
    validateSingleDesignPlatform(payload);
    if(payload.mobile_reformat||payload.group_id||payload.set_id||payload.firebase_tasks)throw fail(400,'单品任务不能混入其他生成流程');
    const signature=singleDesignPlanSignature(payload);
    const known=store.state.tasks['agent_tasks/'+payload.agent_task_id];
    if(known){
      if(known.singleDesign?.signature!==signature)throw fail(409,'任务编号已用于另一份资料，请核对已有任务');
      return known.requestId;
    }
    if(!payload.product_name?.trim()||!payload.product_desc?.trim()||!payload.categorized_images?.length)throw fail(400,'请填写商品名称、资料并上传主体图');
    if(!imageAvailable())throw fail(503,'尚未配置图片服务，本次未提交构思或生图');
    payload.model=resolveImageModel(payload.model,configuration);
    const tasks=slotPlan(payload).map(s=>({slot:s.slot,taskId:payload.agent_task_id+'_'+s.slot,aspect_ratio:payload.platform==='amazon'?s.ratio:payload.image_ratio}));
    if(!tasks.length||tasks.length>14)throw fail(400,'请选择有效的图片输出范围');
    return submitPlan(payload,{phase:'planning',tasks,signature});
  }
  function planSettled(id) {
    const key='agent_tasks/'+id,task=store.state.tasks[key];
    if(!task?.singleDesign||task.singleDesign.phase!=='planning'||task.status!=='completed')return;
    try {
      const requestId=submitImages({...task.payload,sop_text:task.result,firebase_tasks:task.singleDesign.tasks},'generate');
      store.task(key,{singleDesign:{...task.singleDesign,phase:'generating',requestId}});
    } catch(error) {
      store.task(key,{singleDesign:{...task.singleDesign,phase:'failed',error:error.message}});
    }
  }
  function progress(task) {
    const flow=task.singleDesign;
    const images=flow.tasks.map(({taskId,slot})=>{
      const image=store.state.tasks['hyrule_tasks/'+taskId];
      return {taskId,slot,status:image?.status||'not_started',imageUrl:image?.imageUrl,originalImageUrl:image?.originalImageUrl,dimensions:image?.dimensions,formatId:image?.formatId,error:image?.error,phase:image?.phase};
    });
    let phase=flow.phase,error=flow.error;
    if(task.status==='failed'){phase='failed';error=task.error;}
    else if(phase==='generating'&&images.every(i=>['completed','failed'].includes(i.status))) {
      phase=images.every(i=>i.status==='completed')?'completed':'failed';
      error=images.find(i=>i.status==='failed')?.error;
    }
    return {phase,error,tasks:flow.tasks,images};
  }
  return {start,planSettled,progress};
}
