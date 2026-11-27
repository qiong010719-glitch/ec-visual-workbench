import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Bake navigation into the HTML the existing server reads on every request.
// This also updates an already running desktop server, without restarting user tasks.
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fragment=fs.readFileSync(path.join(root,'public/local/workspace-shell.html'),'utf8').trim().replace(/^<!--[^]*?-->\s*/,'');
const pages=['index.html','workspace.html','sourcing.html','merchant.html','temu-listings.html','platform-listings.html','cockpit.html','free-sourcing.html','listing-workflow.html'];
const bootstrap='<script src="/local/workspace-appearance.js"></script>';
const styles='<link rel="stylesheet" href="/local/workspace-shell.css"><link rel="stylesheet" href="/local/workspace-glass-business.css" data-glass-business>';
const check=process.argv.includes('--check');
for(const name of pages){
  const file=path.join(root,'public',name),original=fs.readFileSync(file,'utf8');
  let html=original.replace(/<html\b([^>]*)>/i,(_tag,attributes)=>{
    const classes=/\bclass="([^"]*)"/.exec(attributes);
    const names=new Set((classes?.[1]||'').split(/\s+/).filter(Boolean));names.add('workspace-shell-enabled');
    return '<html'+(classes?attributes.replace(/\bclass="[^"]*"/,'class="'+[...names].join(' ')+'"'):attributes+' class="'+[...names].join(' ')+'"')+'>';
  });
  html=html.replace(/<script\b[^>]*src="\/local\/workspace-appearance\.js"[^>]*><\/script>/g,'')
    .replace(/<link\b[^>]*href="\/local\/workspace-(?:shell|glass-business)\.css"[^>]*>/g,'')
    .replace(/<head>/i,'<head>'+bootstrap)
    .replace(/<\/head>/i,styles+'</head>');
  let headers=0;
  html=html.replace(/<header\b([^>]*\bclass="[^"]*\bworkbench-header\b[^"]*"[^>]*)>[^]*?<\/header>/g,(_tag,attributes)=>{
    headers++;
    const id=/\bid="([^"]*)"/.exec(attributes)?.[1];
    return id?fragment.replace('<header ','<header id="'+id+'" '):fragment;
  });
  if(headers!==1)throw new Error(name+': expected exactly one workbench header, found '+headers);
  if(check&&html!==original)throw new Error(name+': initial shell is out of sync; run node tools/sync-workspace-shell.mjs');
  if(!check&&html!==original)fs.writeFileSync(file,html);
}
console.log('Initial workspace shell '+(check?'verified':'updated')+' in '+pages.length+' pages.');
