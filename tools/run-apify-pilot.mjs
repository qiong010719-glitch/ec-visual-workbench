import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchService} from '../src/research.mjs';
import {ApifyClient} from '../src/apify.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=path.join(root,'data/research/apify-powerbanks-pilot-20261101');
fs.mkdirSync(directory,{recursive:true});
const client=new ApifyClient({APIFY_TOKEN_FILE:path.join(root,'.env.apify')});
const getItems=client.items.bind(client);
client.items=async(id,maximum)=>{const rows=await getItems(id,maximum);fs.writeFileSync(path.join(directory,'dataset-'+id+'.json'),JSON.stringify(rows,null,2));return rows;};
const service=new ResearchService({directory,mediaDirectory:path.join(root,'data/media'),client});
const requestId='us-powerbanks-pilot-20261101';
let job=service.library.state.campaigns[requestId];
if(job) {if(!['completed','partial','submission_unknown'].includes(job.status))service.resume(job.id);}
else job=service.create('collect',{requestId,categoryUrls:['https://www.amazon.com/gp/bestsellers/wireless/7073960011'],category:'充电宝 / Power Banks / 3C',budgetUsd:5,candidateLimit:100,download:true});
const report=()=>console.log(JSON.stringify({id:job.id,status:job.status,phase:job.phase,runs:job.runs.map(r=>({stage:r.stage,runId:r.runId,status:r.status,cap:r.maxTotalChargeUsd,cost:r.usageTotalUsd})),products:Object.keys(service.library.state.products).length,warnings:job.warnings,error:job.error}));
const timer=setInterval(report,30000);report();
try {if(service.current)await service.current;report();}finally{clearInterval(timer);service.close();}
if(['failed','submission_unknown'].includes(job.status))process.exitCode=1;
