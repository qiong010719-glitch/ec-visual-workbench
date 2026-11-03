export const ROLE_LABELS={main:'主图',gallery:'商品副图',aplus:'A+',brand_story:'品牌故事',storefront:'店铺装修'};
const features=[
  ['white-background','白底与干净背景',/白底|纯白|白色背景/],
  ['diagonal','斜向与三分之四视角',/斜向|对角|三分之四/],
  ['split-layout','分区图文',/左右分|上下分|分区|分栏/],
  ['detail','局部细节',/特写|局部放大|近景|细节区/],
  ['lifestyle','人物与生活场景',/人物|手持|手部|生活|居家|户外|旅行|办公/],
  ['series','系列陈列与网格',/陈列|网格|宫格|阵列|矩阵|并排/],
  ['negative-space','留白',/留白|负空间|空白/],
  ['icons','图标与引导标记',/图标|箭头|引导线/],
  ['soft-light','柔光与细腻阴影',/柔光|柔和|柔影|漫射/],
  ['dark-tone','深色视觉',/深色背景|黑色背景|暗色|暗调/],
  ['pastel','浅色与低饱和配色',/低饱和|浅蓝|薄荷|淡紫|浅色/],
  ['illustration','插画与几何元素',/插画|几何|抽象/]
];
export function designPatterns(state,{productIds}={}) {
  const products=Object.values(state.products).filter(p=>!p.id.startsWith('analysis-batch-')&&(!productIds||productIds.includes(p.id)));
  const observations=new Map(),expected=new Set();
  for(const p of products)for(const asset of p.assets) {
    const key=asset.sha256 || asset.sourceUrl || asset.id;expected.add(key);
    const analysis=state.imageAnalyses?.[asset.sha256] || p.analysis?.images?.find(i=>i.id===asset.id&&i.sha256===asset.sha256);
    if(!analysis)continue;
    if(!observations.has(key))observations.set(key,{sha256:asset.sha256,id:asset.id,localUrl:asset.localUrl,roles:[],productIds:[],analysis});
    const record=observations.get(key);record.roles=[...new Set([...record.roles,...(asset.roles || [asset.role])])];record.productIds.push(p.id);
  }
  const all=[...observations.values()];
  const roles=Object.entries(ROLE_LABELS).map(([role,label])=>{
    const images=all.filter(a=>a.roles.includes(role));
    return {role,label,analyzedUnique:images.length,patterns:features.map(([id,name,pattern])=>{
      const matches=images.filter(a=>pattern.test([a.analysis.layout,a.analysis.camera,a.analysis.lighting,a.analysis.palette,a.analysis.textDensity].join(' ')));
      const samples=[...new Set([0,Math.floor(matches.length/3),Math.floor(2*matches.length/3),matches.length-1])].filter(i=>i>=0&&i<matches.length).map(i=>matches[i]);
      return {id,name,mentions:matches.length,evidence:matches.map(a=>a.sha256),examples:samples.map(a=>({sha256:a.sha256,localUrl:a.localUrl,layout:a.analysis.layout,guidance:a.analysis.transferableGuidance}))};
    }).filter(p=>p.mentions).sort((a,b)=>b.mentions-a.mentions)};
  });
  return {version:1,method:'从逐图视觉观察提取的可检索设计特征；次数是分析文本提及数，不是转化率、销量或人工标注',createdAt:new Date().toISOString(),expectedUnique:expected.size,analyzedUnique:all.length,status:all.length===expected.size?'completed':'partial',roles};
}
