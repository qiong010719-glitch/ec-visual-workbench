import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apifyBudget,BudgetedApifyRuns} from '../src/apify-budget.mjs';

test('aggregate cap reserves running and unknown submissions and releases only known final charges',()=>{
  assert.equal(apifyBudget({budgetUsd:5,priorUsd:1.056,runs:[{status:'RUNNING',maxTotalChargeUsd:1,usageTotalUsd:0.01},{status:'submission_unknown',maxTotalChargeUsd:2},{status:'SUCCEEDED',maxTotalChargeUsd:1,usageTotalUsd:0.5}]}).remainingUsd,0.444);
  assert.throws(()=>apifyBudget({budgetUsd:5,runs:[{status:'SUCCEEDED',usageTotalUsd:null}]}),/缺少/);
  assert.equal(apifyBudget({budgetUsd:5,runs:[{status:'SUCCEEDED',usageTotalUsd:0,maxTotalChargeUsd:0.42}]}).committedUsd,0.42);
  assert.equal(apifyBudget({budgetUsd:5,runs:[{status:'SUCCEEDED',usageTotalUsd:0.4,billingPending:true,maxTotalChargeUsd:0.42}]}).committedUsd,0.42);
});

test('a delayed zero charge keeps its cap reserved and cached resume refreshes the bill without resubmitting',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-budget-'));
  try{
    let starts=0,reads=0;
    const client={start:async()=>{starts++;return {id:'late',status:'RUNNING',defaultDatasetId:'data'};},run:async()=>({status:'SUCCEEDED',defaultDatasetId:'data',usageTotalUsd:++reads===1?0:0.41}),items:async()=>[{asin:'B000000001'}]};
    const runner=new BudgetedApifyRuns({directory,client,budgetUsd:5,priorUsd:4.3325});
    await runner.execute('ranking','actor',{}, {cap:0.42,maxItems:100});
    assert.equal(runner.budget().committedUsd,4.7525);
    await runner.execute('ranking','actor',{}, {cap:0.42,maxItems:100});
    assert.equal(starts,1);assert.equal(runner.budget().committedUsd,4.7425);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('budget refusal never submits and restart never repeats an uncertain paid request',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-budget-'));
  try{
    let starts=0;
    const client={start:async()=>{starts++;throw Object.assign(new Error('unknown'),{submissionUnknown:true});}};
    const config={directory,client,budgetUsd:5,priorUsd:1.056};
    const runner=new BudgetedApifyRuns(config);
    await assert.rejects(runner.execute('over','actor',{}, {cap:4,maxItems:10}),/超出/);assert.equal(starts,0);
    await assert.rejects(runner.execute('once','actor',{}, {cap:1,maxItems:10}),/unknown/);
    const resumed=new BudgetedApifyRuns(config);
    await assert.rejects(resumed.execute('once','actor',{}, {cap:1,maxItems:10}),/未知/);assert.equal(starts,1);
    assert.equal(resumed.budget().remainingUsd,2.944);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('resume retrieves the existing run and uses its real final cost',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-budget-'));
  try{
    let starts=0;const client={start:async()=>{starts++;return {id:'run1',defaultDatasetId:'d1',status:'RUNNING'};},run:async()=>({status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:0.08}),items:async()=>[{asin:'B000000001'}]};
    const config={directory,client,budgetUsd:5,priorUsd:1.056};
    await new BudgetedApifyRuns(config).execute('details','actor',{}, {cap:1,maxItems:20});
    const resumed=new BudgetedApifyRuns(config);const result=await resumed.execute('details','actor',{}, {cap:1,maxItems:20});
    assert.equal(starts,1);assert.equal(result.rows.length,1);assert.equal(resumed.budget().committedUsd,1.136);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
