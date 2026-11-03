import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {designPatterns} from '../src/design-patterns.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),directory=path.join(root,'data/research/charmast-us-20261028');
const state=JSON.parse(fs.readFileSync(path.join(root,'data/research/references.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
const downloads=JSON.parse(fs.readFileSync(path.join(directory,'downloads.json'),'utf8'));
const source=state.storeImports[manifest.run.id],patterns=designPatterns(state,{productIds:source.productIds});
if(patterns.status!=='completed'||patterns.analyzedUnique!==manifest.uniqueImages)throw new Error('全店图片尚未全部分析，不能生成完成报告');
const report={...patterns,sourceUrl:manifest.source,sourceRun:manifest.run.id,downloaded:downloads.completed,hashesMatch:Object.values(downloads.images).filter(a=>a.sourceHashMatches).length,products:source.productIds.filter(id=>state.products[id].asin).length,storePages:source.productIds.filter(id=>!state.products[id].asin).length,placements:manifest.placements,model:[...new Set(source.productIds.flatMap(id=>state.products[id].analysis.images.map(a=>a.model)))],coverage:'所提供的 2026-10-28 归档全部图片。未把归档外的实时 Amazon 页面、视频或未保存的素材纳入完成声明。'};
fs.writeFileSync(path.join(directory,'design-patterns.json'),JSON.stringify(report,null,2));
const sections=patterns.roles.map(r=>{
  const used=new Set();
  return `## ${r.label}：${r.analyzedUnique} 张独立图片\n\n`+r.patterns.slice(0,7).map(p=>{
    const example=p.examples.find(e=>!used.has(e.sha256)) || p.examples[0];used.add(example.sha256);
    return `### ${p.name}\n\n在 ${p.mentions} 张图片的分析记录中提及。\n\n${example.guidance}\n\n示例：[原图](${path.join(root,'data',example.localUrl.replace(/^\//,'')).replaceAll('\\','/')})；哈希 \`${example.sha256}\`。`;
  }).join('\n\n');
}).join('\n\n');
const pages=source.productIds.map(id=>state.products[id]).filter(p=>!p.asin).map(p=>`| [${p.title.replaceAll('|',' ')}](${p.url}) | ${p.assets.length} | ${p.analysis.status} |`).join('\n');
const markdown=`# Charmast US 全店图片学习记录\n\n归档来源：[店铺素材网站](${manifest.source})。本地完成时间：${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）。\n\n已下载并校验 **${report.downloaded} 张独立原图**；已完成 **${report.analyzedUnique} 张逐图视觉分析**，覆盖 **${report.products} 个商品/变体、${report.storePages} 个装修页面**。同一图片在不同位置的使用关系均保留。\n\n这里的“学习”是实际图片输入后的视觉分析、结构化设计参考库和策划检索，没有训练或微调模型权重。逐图记录包括构图、镜头、光影、配色、文字层级和可迁移方法。参考库用于设计，商品参数和宣传事实仍以新商品资料为准。\n\n## 覆盖与限制\n\n- 完整覆盖用户提供的 2026-10-28 归档，不代表实时网站所有内容。\n- 装修页面保存了图片与所属页面关系；归档未提供完整页面 DOM 排版顺序，因此不宣称还原了店铺导航、交互或响应式布局。\n- 下方特征次数来自视觉分析文本检索，不能当作转化效果证明。角色之间可能共用图片，各角色张数不应直接相加。\n- 装修图片素材已入库；装修图生成功能按用户要求留待之后制作。\n\n## 装修页面覆盖\n\n| 页面 | 图片数 | 分析状态 |\n|---|---:|---|\n${pages}\n\n${sections}\n\n## 后端使用\n\n打开工作台的“设计参考库”，可逐图查看分析、选择参考并重新构思。策划按主图、副图与 A+ 角色检索，每个生成槽位只使用自己的设计段落。图片生成请求只携带当前商品的素材。\n\n机器记录：\`data/research/charmast-us-20261028/design-patterns.json\`；全量逐图分析：\`data/research/references.json\`；原始分页与清单：\`data/research/charmast-us-20261028/\`。\n`;
const document=path.join(root,'docs/Charmast全店图片学习记录-20261101.md');fs.writeFileSync(document,markdown);console.log(JSON.stringify({document,analyzedUnique:report.analyzedUnique,roles:patterns.roles.map(r=>({role:r.role,images:r.analyzedUnique}))}));
