import {ReferenceLibrary, normalizeProduct, selectBrands, amazonUrl, asinFrom} from './reference-library.mjs';
import {ApifyClient} from './apify.mjs';
import {analyzeProduct,visionSettings} from './reference-analysis.mjs';
import crypto from 'node:crypto';

const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const categoryKey=url=>{const u=amazonUrl(url),p=new URL(u.url).pathname.replace(/\/ref[=/].*$/,'').replace(/\/$/,'');return u.marketplace+':'+(p.match(/\/(\d+)$/)?.[1] || p.toLowerCase());};
export class ResearchService {
  constructor({directory,mediaDirectory,configuration={},client,download,analyzer}={}) {
    this.configuration=configuration;this.library=new ReferenceLibrary(directory,mediaDirectory,{download});
    this.client=client || new ApifyClient(configuration);this.analyzer=analyzer || ((productId)=>analyzeProduct(this.library,productId,configuration));
    this.pending=[];this.active=null;this.stopped=false;
    for(const job of Object.values(this.library.state.campaigns))if(['queued','running'].includes(job.status)){job.status='paused';job.error='服务重启；可继续同步已有运行，不会自动重复提交。';}
    for(const p of Object.values(this.library.state.products))if(p.analysis?.status==='running')p.analysis.status=p.analysis.images?.length?'partial':'failed';
    this.library.save();
  }
  status() {
    const vision=visionSettings(this.configuration);
    return {...this.library.stats(),styleCollections:this.library.styleCollections(),apifyConfigured:this.client.configured,visionConfigured:!!(vision.base&&vision.key&&vision.model),active:this.active,queued:this.pending.length,defaultMarketplace:'amazon.com',focus:this.library.state.expansion?.focus||(this.library.state.expansion?'3C 多类目':'3C / 充电宝'),expansion:this.library.state.expansion?{id:this.library.state.expansion.id,scope:this.library.state.expansion.scope,budget:this.library.state.expansion.apifyBudget,collectionBlock:this.library.state.expansion.collectionBlock||null,categories:this.library.state.expansion.categories.map(c=>({id:c.id,label:c.label,observed:c.observed,verified:c.verified,brands:c.selection?.brands.length||0,products:c.selectedProductIds?.length||0,selectionComplete:c.selectionComplete,analysisStatus:c.analysisStatus||'pending'})),nextPhase:this.library.state.expansion.nextPhase}:null,rankingMethod:'同一类目榜单中按品牌汇总 1/排名，再取每品牌排名最好的 5 个不同款式；属于样本推算。'};
  }
  enqueue(job) {
    if(this.active===job.id || this.pending.includes(job.id))return;
    job.status='queued';delete job.error;this.library.save();this.pending.push(job.id);this.next();
  }
  next() {
    if(this.active || this.stopped || !this.pending.length)return;
    const job=this.library.state.campaigns[this.pending.shift()];this.active=job.id;job.status='running';this.library.save();
    this.current=this.execute(job).catch(error=>{
      job.status=error.submissionUnknown?'submission_unknown':'failed';job.error=error.message;
    }).finally(()=>{job.updatedAt=now();this.library.save();this.active=null;this.next();});
  }
  create(kind,payload={}) {
    const key=payload.requestId || id();
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(key))throw new Error('任务编号无效');
    if(this.library.state.campaigns[key])return this.library.state.campaigns[key];
    let input;
    if(kind==='collect') {
      if(!this.client.configured)throw new Error('请先在 .env.apify 填写 APIFY_API_TOKEN');
      if(!Array.isArray(payload.categoryUrls) || !payload.categoryUrls.length || payload.categoryUrls.length>50)throw new Error('每批需要 1–50 个类目畅销榜链接');
      const urls=[...new Set(payload.categoryUrls)].map(value=>{
        const u=amazonUrl(value);
        if(u.marketplace!=='amazon.com')throw new Error('本批已确定为美国站，请使用 amazon.com');
        if(!/\/(?:[^/]*Best-Sellers[^/]*\/zgbs|gp\/bestsellers)\//i.test(new URL(u.url).pathname))throw new Error('请使用具体类目的 Best Sellers 链接');
        return u.url;
      });
      const budget=Number(payload.budgetUsd),candidateLimit=Number(payload.candidateLimit ?? 100);
      if(!Number.isFinite(budget)||budget<0.1||budget>1000)throw new Error('请填写本批采集费用上限（0.1–1000 美元）');
      if(!Number.isInteger(candidateLimit)||candidateLimit<5||candidateLimit>100)throw new Error('每类目的候选数量应为 5–100');
      input={categoryUrls:urls,budgetUsd:budget,candidateLimit,category:typeof payload.category==='string'?payload.category.slice(0,200):'3C',download:payload.download!==false};
    } else if(['download','analyze'].includes(kind)) {
      const ids=[...new Set(payload.productIds || [])];
      if(!ids.length || ids.length>500 || ids.some(i=>!this.library.state.products[i]))throw new Error('请选择已存在的参考商品（最多 500 个）');
      if(kind==='analyze'&&!this.status().visionConfigured && !this.configuration.TEST_ANALYZER)throw new Error('尚未配置支持图片输入的视觉分析模型，不能把采集标成已学习。');
      input={productIds:ids};
    } else throw new Error('研究任务类型无效');
    const job={id:key,kind,input,status:'queued',createdAt:now(),updatedAt:now(),categories:[],completedProducts:[],runs:[],warnings:[]};
    this.library.state.campaigns[key]=job;this.enqueue(job);return job;
  }
  resume(jobId) {
    const job=this.library.state.campaigns[jobId];if(!job)throw new Error('任务不存在');
    if(job.status==='submission_unknown')throw new Error('上次提交结果未知，请先在 Apify 控制台核对，当前不会重新下单。');
    if(['completed','partial'].includes(job.status))return job;
    this.enqueue(job);return job;
  }
  async actor(job,stage,actor,input,cap,maxItems) {
    let record=job.runs.find(r=>r.stage===stage);
    if(!record) {
      record={stage,actor,status:'submitting',submittedAt:now(),maxTotalChargeUsd:cap,input};job.runs.push(record);this.library.save();
      try {const run=await this.client.start(actor,input,{maxTotalChargeUsd:cap,maxItems});Object.assign(record,{runId:run.id,status:run.status,datasetId:run.defaultDatasetId,usageTotalUsd:run.usageTotalUsd ?? null});this.library.save();}
      catch(error){record.status=error.submissionUnknown?'submission_unknown':'rejected';throw error;}
    }
    if(!record.runId)throw Object.assign(new Error('任务缺少运行编号，无法安全自动重提。请核对 Apify 运行记录。'),{submissionUnknown:true});
    for(;;) {
      if(this.stopped)throw new Error('本地服务已停止同步，Apify 运行记录已保留');
      const run=await this.client.run(record.runId);
      if(!run?.status)throw new Error('Apify 未返回有效运行状态');
      Object.assign(record,{status:run.status,datasetId:run.defaultDatasetId,usageTotalUsd:run.usageTotalUsd ?? null});this.library.save();
      if(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(run.status)) {
        if(run.status!=='SUCCEEDED')throw new Error(`Apify ${stage} 运行 ${run.status}；保留编号 ${record.runId}，未自动重跑。`);
        if(!record.datasetId)throw new Error('Apify 没有返回数据集编号');
        return {rows:await this.client.items(record.datasetId,maxItems),record};
      }
      await new Promise(resolve=>{this.pollResolve=resolve;this.pollTimer=setTimeout(resolve,15000);this.pollTimer.unref?.();});
      this.pollResolve=null;
    }
  }
  async execute(job) {
    if(job.kind==='collect') {
      const cap=Math.floor(job.input.budgetUsd/(job.input.categoryUrls.length*2)*10000)/10000;
      if(cap<=0)throw new Error('本批预算不足以分配给每个采集阶段');
      for(let i=0;i<job.input.categoryUrls.length;i++) {
        const categoryUrl=job.input.categoryUrls[i];
        if(job.categories.some(c=>c.categoryUrl===categoryUrl))continue;
        job.phase=`读取类目 ${i+1}/${job.input.categoryUrls.length} 榜单`;this.library.save();
        const lists=await this.actor(job,`ranking-${i}`,'junglee/amazon-bestsellers',{categoryUrls:[categoryUrl],maxItemsPerStartUrl:job.input.candidateLimit,depthOfCrawl:1,detailedInformation:false,useCaptchaSolver:false},cap,job.input.candidateLimit);
        const rankingRows=lists.rows.filter(row=>{
          try {return asinFrom(row.url) && Number(row.position)>0 && (!row.categoryUrl || categoryKey(row.categoryUrl)===categoryKey(categoryUrl));}catch{return false;}
        });
        const candidates=[...new Map([...rankingRows].sort((a,b)=>Number(b.position)-Number(a.position)).map(row=>[asinFrom(row.url),row])).values()].sort((a,b)=>a.position-b.position);
        if(candidates.length<rankingRows.length)job.warnings.push(`榜单 ${rankingRows.length} 条记录仅有 ${candidates.length} 个独立商品，重复项已去除；覆盖不足已记录。`);
        if(!candidates.length) {job.warnings.push(`${categoryUrl}：没有取得带排名的有效商品`);job.categories.push({categoryUrl,selection:null});continue;}
        job.phase=`补全类目 ${i+1} 的品牌与图片`;this.library.save();
        const urls=[...new Set(candidates.map(r=>`https://www.amazon.com/dp/${asinFrom(r.url)}`))];
        const details=await this.actor(job,`details-${i}`,'junglee/amazon-crawler',{categoryOrProductUrls:urls.map(url=>({url})),maxItemsPerStartUrl:1,maxSearchPagesPerStartUrl:1},cap,urls.length);
        const products=[];
        for(const row of candidates) {
          const asin=asinFrom(row.url),detail=details.rows.find(r=>[r.asin,r.originalAsin,asinFrom(r.url),typeof r.input==='string'?asinFrom(r.input):null].includes(asin));
          if(!detail){job.warnings.push(`ASIN ${asin} 详情未返回，无法验证品牌和全套图片`);continue;}
          try {
            const product=normalizeProduct({...detail,position:row.position,categoryUrl:row.categoryUrl||categoryUrl,category:row.category||job.input.category},{source:'apify',actor:'junglee/amazon-crawler',runId:details.record.runId,datasetId:details.record.datasetId,rankBasis:'bestsellers_list'});
            product.rankEvidence={rank:product.rank,observedAsin:asin,resolvedAsin:product.asin,categoryUrl,runId:lists.record.runId,datasetId:lists.record.datasetId,capturedAt:now()};
            if(products.some(p=>p.id===product.id))continue;
            this.library.upsert(product);products.push(product);
          }catch(error){job.warnings.push(`ASIN ${asin}：${error.message}`);}
        }
        const selection=selectBrands(products),selected=selection.brands.flatMap(g=>g.products);
        job.phase=`保存类目 ${i+1} 的参考图片`;this.library.save();
        if(job.input.download)for(const productId of selected){if(this.stopped)throw new Error('同步已停止');await this.library.downloadProduct(productId);}
        job.categories.push({categoryUrl,observed:candidates.length,verified:products.length,selection,selectedProductIds:selected,rankingSnapshot:products.map(p=>({id:p.id,asin:p.asin,brand:p.brand,rank:p.rank,url:p.url}))});this.library.save();
      }
      const gaps=job.categories.some(c=>!c.selection || c.selection.missingBrands || c.selection.brands.some(b=>b.missing));
      const ids=job.categories.flatMap(c=>c.selectedProductIds || []);
      const missingImages=ids.some(i=>{const p=this.library.state.products[i];return !p.assets.length || p.aplusStatus!=='found' || (job.input.download && p.assets.some(a=>a.status!=='downloaded'));});
      if(missingImages)job.warnings.push('部分商品图片或 A+ 未完整取得；请查看商品记录，不代表全套素材已完成。');
      job.status=gaps||job.warnings.length||missingImages?'partial':'completed';
    } else {
      for(const productId of job.input.productIds) {
        if(job.completedProducts.includes(productId))continue;
        if(this.stopped)throw new Error('同步已停止');
        job.phase=`${job.kind==='analyze'?'分析':'下载'}商品 ${job.completedProducts.length+1}/${job.input.productIds.length}`;this.library.save();
        try {
          if(job.kind==='download')await this.library.downloadProduct(productId);else await this.analyzer(productId);
          job.completedProducts.push(productId);
        }catch(error){job.warnings.push(`${productId}：${error.message}`);}
        this.library.save();
      }
      job.status=job.warnings.length || job.input.productIds.some(i=>job.kind==='analyze'?this.library.state.products[i].analysis?.status!=='completed':this.library.state.products[i].assets.some(a=>a.status!=='downloaded'))?'partial':'completed';
    }
    job.phase=job.kind==='collect'?'采集结束，视觉分析需单独执行':'任务结束';
  }
  close() {this.stopped=true;clearTimeout(this.pollTimer);this.pollResolve?.();}
}
