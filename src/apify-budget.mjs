import fs from 'node:fs';
import path from 'node:path';

const terminal=new Set(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT']);
const round=value=>Math.round(value*1e6)/1e6;
const billingPending=run=>terminal.has(run.status)&&Number.isFinite(Date.parse(run.finishedAt))&&Date.now()-Date.parse(run.finishedAt)<60000;

// Unknown or running charges reserve their full cap. An unknown POST is never repeated.
export function apifyBudget({budgetUsd,priorUsd=0,runs=[]}) {
  if(!Number.isFinite(budgetUsd)||budgetUsd<=0||!Number.isFinite(priorUsd)||priorUsd<0)throw new Error('费用上限或历史费用无效');
  const committedUsd=round(priorUsd+runs.reduce((sum,r)=>sum+(r.status==='rejected'?0:terminal.has(r.status)&&!r.billingPending&&Number.isFinite(r.usageTotalUsd)&&r.usageTotalUsd>0?r.usageTotalUsd:r.maxTotalChargeUsd),0));
  if(!Number.isFinite(committedUsd))throw new Error('运行缺少费用或预留上限，不能继续计费采集');
  return {budgetUsd,priorUsd,committedUsd,remainingUsd:round(Math.max(0,budgetUsd-committedUsd))};
}

export class BudgetedApifyRuns {
  constructor({directory,client,budgetUsd,priorUsd}) {
    fs.mkdirSync(directory,{recursive:true});this.directory=directory;this.client=client;
    this.file=path.join(directory,'apify-runs.json');
    this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{budgetUsd,priorUsd,runs:[]};
    if(this.state.budgetUsd!==budgetUsd||this.state.priorUsd!==priorUsd)throw new Error('历史预算与本次授权不同，需要先核对记录');
    this.save();
  }
  save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.state,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  budget(){return apifyBudget(this.state);}
  async reconcile(){
    const finished=this.state.runs.filter(r=>r.runId&&terminal.has(r.status));
    const current=await Promise.all(finished.map(r=>this.client.run(r.runId)));
    current.forEach((run,index)=>{
      const record=finished[index];
      Object.assign(record,{status:run.status,usageTotalUsd:Math.max(record.usageTotalUsd||0,run.usageTotalUsd||0),finishedAt:run.finishedAt||null,billingPending:billingPending(run),checkedAt:new Date().toISOString()});
    });
    this.save();
  }
  async execute(stage,actor,input,{cap,maxItems}) {
    // A completed run may initially report zero before billing catches up.
    await this.reconcile();
    let record=this.state.runs.find(r=>r.stage===stage);
    if(record?.status==='submission_unknown'||(record&&!record.runId))throw new Error('已有提交结果未知，先核对 Apify 运行，不会重新下单：'+stage);
    if(!record){
      if(!Number.isFinite(cap)||cap<=0||round(cap)>this.budget().remainingUsd)throw new Error('该运行会超出已授权 Apify 总额');
      if(!Number.isInteger(maxItems)||maxItems<1)throw new Error('必须限制结果数量');
      record={stage,actor,input,maxTotalChargeUsd:round(cap),maxItems,status:'submitting',submittedAt:new Date().toISOString()};
      this.state.runs.push(record);this.save();
      try {
        const run=await this.client.start(actor,input,{maxTotalChargeUsd:record.maxTotalChargeUsd,maxItems});
        Object.assign(record,{runId:run.id,datasetId:run.defaultDatasetId,status:run.status,usageTotalUsd:run.usageTotalUsd??null});this.save();
      } catch(error){record.status=error.submissionUnknown?'submission_unknown':'rejected';record.error={message:error.message,httpStatus:error.httpStatus||null};this.save();throw error;}
    }
    if(record.status==='SUCCEEDED'&&record.datasetFile&&fs.existsSync(path.join(this.directory,record.datasetFile)))return {record,rows:JSON.parse(fs.readFileSync(path.join(this.directory,record.datasetFile),'utf8'))};
    for(;;){
      const run=await this.client.run(record.runId);
      Object.assign(record,{status:run.status,datasetId:run.defaultDatasetId,usageTotalUsd:run.usageTotalUsd??null,finishedAt:run.finishedAt||null,billingPending:billingPending(run),checkedAt:new Date().toISOString()});this.save();
      if(terminal.has(run.status)){
        if(run.status!=='SUCCEEDED')throw new Error('Apify 运行 '+run.status+'，保留编号 '+record.runId+'，不自动重跑');
        const rows=await this.client.items(record.datasetId,record.maxItems);
        record.datasetFile='dataset-'+record.datasetId+'.json';
        fs.writeFileSync(path.join(this.directory,record.datasetFile),JSON.stringify(rows,null,2));this.save();
        return {record,rows};
      }
      await new Promise(resolve=>setTimeout(resolve,15000));
    }
  }
}
