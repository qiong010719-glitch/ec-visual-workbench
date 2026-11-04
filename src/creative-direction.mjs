import {genericHeadlines} from './rich-storytelling.mjs';
export const CREATIVE_DIRECTION_VERSION=2;
const style = (id,label,palette,lighting,layout,tone) => ({id,label,palette,lighting,layout,tone});
export const creativeStyles = Object.freeze([
  style('natural','温暖自然','米白、木色背景，强调色从产品提取','柔和侧光与自然接触阴影','宽松留白、生活照片与细节交替','亲切、具体、日常'),
  style('minimal','清爽简约','浅灰与白色背景，少量产品强调色','清晰柔光，保持材质层次','克制网格、单一焦点、明确对齐','简短、直接、易读'),
  style('editorial','杂志质感','低饱和中性色背景与产品色呼应','有方向的光线，明暗层次清楚','不对称留白、大小照片组合、现代无衬线标题','有节奏、重视细节'),
  style('bold','鲜明活力','背景采用与产品协调的鲜明辅色，最多两种','明快光线，清楚的轮廓和接触阴影','大标题与有动势的对角构图，文字不遮产品','积极、简洁、具体'),
  style('precise','理性清晰','冷中性色背景配产品强调色','均匀光线与可辨识的表面纹理','精确网格、外观定位线、实物细节与事实配对','客观、清楚，完整保留数字单位'),
  style('calm','舒缓柔和','柔和低饱和背景，保持产品原色','漫射日光、柔和阴影','舒展留白、圆润信息区域与自然照片','平和、温暖，不暗示未证实功效'),
  style('urban','都市利落','石灰、墨色背景与产品主色协调','有层次的都市环境光或干净棚拍光','明确线条、非对称照片分区、紧凑信息层级','利落、简练、面向实际使用'),
  style('organic','自然肌理','纸、石、织物等背景肌理，配色服从产品','自然侧光突出真实表面','有机留白、近景肌理与完整产品交替','朴实、关注可见细节，不虚构环保属性'),
  style('playful','轻快创意','背景轻快配色，辅色不超过两种','明亮柔光，物体接触关系真实','轻快分区、变化的照片比例、统一无衬线字','轻松易懂；风格不代表商品适合儿童'),
  style('classic','沉稳经典','稳重中性色背景，少量产品强调色','柔和定向光与稳定色温','稳定阅读轴线、大小图呼应、克制标题','稳重、明确，不虚构品牌历史')
]);
// These control the actual photograph and page, rather than appending a style name to one template.
const systems={
  natural:{type:'圆润人文无衬线，中等字重、小标题，以自然阅读大小融入照片；不使用占据半幅的黑体大口号',camera:['50mm平视环境远景，完整动作与空间关系','85mm自然侧光局部，真实接触和浅景深','45度观察视角，从前景物件看向实际使用位置'],layouts:['一张暖色生活照片铺满画面，短文案贴近下方自然留白；不用左右两栏大标题模板','同一照片中用前后景解释整体与细节，细节不装入重复圆框','照片占约85%，其余用窄幅柔和色带承接一句事实说明'],scale:'约30–45%，产品与真实环境共同构图',scene:'真实用途空间，木色与暖自然光，保留空间纵深'},
  minimal:{type:'清爽细字重无衬线，大小写自然，标题不超过两行；不使用粗重全大写口号',camera:['正面平视静物，单一视觉焦点','90度俯拍单件实物与一处局部','70mm正侧面，清楚的轮廓和接触阴影'],layouts:['浅灰整体背景，完整产品偏下，细字标题沿上缘对齐，一处小标签','偏心单件实物与一处开放式局部，充分负空间，不拼人物照片','产品与必要事实以一条清楚阅读轴排布，不加徽章与装饰线'],scale:'约45–60%，单一产品视觉焦点',scene:'连续浅灰摄影背景，均匀柔光，不安排完整人物',studio:true},
  editorial:{type:'现代衬线标题搭配克制无衬线正文，采用杂志的字号反差与短图注',camera:['50mm侧向观察，非对称人物或实物取景','85mm紧凑局部与一幅远景对应','35mm从门口或环境边缘观察，保留叙事情境'],layouts:['一幅竖向主照片占三分之二，窄栏图注，跨栏衬线短标题','主照片与一幅不等宽细节形成上下节奏，标题沿杂志阅读轴排列','不对称大照片与留白图注区，使用小型栏目标签而非重复巨型口号'],scale:'约25–45%，服从编辑叙事',scene:'具有方向光和低饱和色彩的实际用途环境'},
  bold:{type:'粗窄无衬线、短促动词标题、明确字号反差；只有一处鲜明强调色',camera:['低机位斜向中近景，让实物与接触动作形成对角线','斜向近景突出真实表面和轮廓','高位斜俯拍，实物形成有张力的对角构图'],layouts:['对角线照片铺满画面，标题沿相反方向平衡，鲜明色块只承接一句文案','大幅真实局部与斜切小幅整体定位，文字沿斜边留白排布','完整实物、短标题和一个重点形成三角关系，不做规则三栏说明卡'],scale:'约45–65%，保留完整外形和动作关系',scene:'与已知用途相符的明快空间，以最多两种鲜明辅色组织背景'},
  precise:{type:'清晰无衬线中等字重，局部标签用等宽小字；采用句式标题，不用生活方式大口号',camera:['90度正俯拍完整实物，严格对齐可见边缘','100mm真实表面微距，等比例的小幅整体定位','70mm正侧面静物，准确呈现整体与局部对应'],layouts:['完整实物占左侧约55%，右侧窄列以已有事实和实物局部一一对应；不出现人物','整体与两个可见局部组成规则网格，细直线只指向真实部位，不画虚构测试图','两行实物摄影与事实索引，采用克制分隔线；不虚构刻度、数据或技术结构'],scale:'约45–60%，实物证据是主体',scene:'冷灰连续摄影背景，均匀清晰光线；不安排人物使用情境',studio:true},
  calm:{type:'细字重现代衬线、短句与宽行距，文字面积克制，避免黑体口号',camera:['70mm安静中景，轻微俯视','100mm漫射光微距，保留柔和接触阴影','50mm侧后方观察，实物与空间形成舒缓关系'],layouts:['大幅柔光照片延伸至四边，短标题置于一侧宽松自然留白','一幅安静整体与窄幅局部上下呼应，信息不使用硬边卡片','产品与环境以柔和水平线组织，极简细字图注承接已有事实'],scale:'约25–40%，安静空间与产品平衡',scene:'低饱和柔光的已知用途空间'},
  urban:{type:'窄体高字重无衬线，紧凑的街头编辑式标题，文字沿画面边缘与场景线条排布',camera:['24mm低机位侧向环境镜头，强烈空间透视','85mm硬侧光局部特写，强调真实表面','35mm高位斜角纪实取景，以建筑或环境线条组织动作'],layouts:['满版城市纪实照片，窄体标题沿底边或侧边组织，明暗区域承担文字；不用浅色右上大标题模板','斜向大幅局部与窄幅环境照片形成不等宽切分，短标题贴近真实动作','前景实物与背景环境线条形成纵深，暗部反白文字，不用圆框和规则信息三栏'],scale:'约30–55%，产品与实际动作形成视觉重心',scene:'与商品已知用途相符的城市或利落现代环境，墨色与冷灰、硬侧光和真实阴影'},
  organic:{type:'朴实衬线标题与细无衬线图注，字体保持平面可读，不制造环保标志',camera:['100mm擦边侧光纹理微距','90度俯拍实物与一处天然背景肌理','85mm浅景深局部，触感只按可见外观表达'],layouts:['真实纹理占大幅，整体实物用一处小图定位，短图注不套圆框','完整实物与不规则裁幅的局部交替，文字依附纹理自然留白','纸、石或织物背景与实物形成材质对照，不将背景属性写成商品属性'],scale:'细节约65–80%，完整产品仅作准确定位',scene:'以实际表面为主的静物摄影空间，背景肌理只作布景',studio:true},
  playful:{type:'圆润几何无衬线、混合字重、短而轻快的标题；不用儿童适用性暗示',camera:['45度俯视实物，物件空间关系清楚','正面微距与小比例完整产品呼应','90度俯拍，真实物件在两种辅色间交错'],layouts:['真实实物照片与两块不等大的圆角色域交错，标题形成轻快阅读节奏','一幅整体与两个不同大小的局部组成错位照片墙，短标签靠近依据','完整实物放于偏心位置，短标题与简单几何背景形成平衡，不虚构随附配件'],scale:'约40–60%，真实产品为视觉主体',scene:'明亮的两色摄影布景，接触阴影真实',studio:true},
  classic:{type:'稳重衬线标题、克制大写与细无衬线正文，不增加品牌历史或传承宣称',camera:['70mm正面平视，稳定中轴','100mm定向柔光局部，材质层次清楚','50mm对称环境中景，产品放在可信接触位置'],layouts:['中轴实物或场景照片，下方短衬线标题，深浅层次稳定','一幅大图与下方双细节，统一基线，小字说明与实物对应','稳定水平三段阅读轴，整体、局部、事实各有明确位置，不使用巨型口号'],scale:'约35–55%，稳定且克制的主体比例',scene:'稳重中性色背景与柔和定向光的已知用途环境'}
};
export const creativeSystem=value=>({...creativeStyles.find(s=>s.id===value.styleId),...systems[value.styleId]});
const fail = message => Object.assign(new Error(message),{status:400});
function field(value,label,max=240) {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(`${label}需填写 1–${max} 个字符`);
  return value.trim();
}
export function normalizeDirection(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('每套需要完整的人群与风格方向');
  if(!creativeStyles.some(s=>s.id===value.styleId))throw fail('请选择支持的视觉风格');
  return {name:field(value.name,'方案名称',80),audience:field(value.audience,'目标人群'),motivation:field(value.motivation,'购买关注点'),scene:field(value.scene,'场景方向'),styleId:value.styleId};
}
export function directionGuide(value) {
  if(!value)return '';
  const d=normalizeDirection(value),s=creativeSystem(d);
  return [`本套独立创意方向：${d.name}。目标人群：${d.audience}。购买关注点：${d.motivation}。`,
    `本套场景方向：${d.scene}。仅在已知用途和本图展示方式允许时采用；无人物、仅手部、微距等分镜安排继续生效。`,
    `本套视觉风格：${s.label}。背景与配色：${s.palette}。光线：${s.lighting}。版式：${s.layouts.join('；')}。字体：${s.type}。文案语气：${s.tone}。`,
    '以下本套视觉系统决定镜头、版式与字体。参考库只贡献内容组织方法，不覆盖本套视觉系统；不能仅在相同模板中换背景色、人物服装或标题位置。',
    '该方向影响本套的购买问题、视觉表达和文案语气；逐图仍须有不同镜头和信息增量。产品身份、产品原色、参数、配件和适用范围只能来自原始资料。目标人群是营销角度，不构成新增适用性或性能证据。品牌已有规范及用户明确要求优先。'].join('\n');
}
export function directStoryboard(board,value,payload={},slot=1) {
  if(!value)return board;
  const d=normalizeDirection(value),s=creativeSystem(d),index=Math.max(0,slot>=7?slot-7:slot-1);
  const noPeople=board.humanPresence==='none'||s.studio;
  const hands=board.humanPresence==='hands';
  const humanPresence=hands?'hands':noPeople?'none':board.humanPresence;
  const {headline,...original}=board;
  return {...original,
    buyerQuestion:`从“${d.audience}”的“${d.motivation}”关注点理解：${board.buyerQuestion}`,
    scene:noPeople?s.scene+'；本图只拍实物和真实局部，不出现完整人物或房间生活全景':`${s.scene}；结合${d.scene}，仅选择符合商品已知用途的地点`,
    action:noPeople?'以整体、真实局部和已有事实之间的对应关系说明本图主题，不安排完整人物；需要说明操作时仅保留必要手部':board.action,
    sceneType:noPeople?'studio_detail':board.sceneType,
    humanPresence,
    camera:humanPresence==='hands'?`${s.camera[index%s.camera.length]}；镜头裁切到手部与实际接触点，不出现完整人物`:noPeople?`${board.intent==='detail'?'100mm真实表面微距':s.studio?s.camera[index%s.camera.length]:'实物斜俯拍中近景，整体和可见局部共同构图'}；实物为主，不出现人物`:s.camera[index%s.camera.length],
    productScale:s.scale,
    composition:`${s.layouts[index%s.layouts.length]}。本图内容职责仍为：${board.informationIncrement}。${slot>=7?'按宽幅完整编排，展开整体与细节关系，不是方图加宽。':''}字体：${s.type}；光线：${s.lighting}。保留${humanPresence==='hands'?'仅手部':humanPresence==='none'?'无人物':'合理人物情境'}安排。`,
    copy:`面向${d.audience}，回应${d.motivation}，针对本图事实独立创作 ${payload.target_lang||'English'} 的简短标题和必要说明。采用${s.tone}的语气与${s.type}。标题应点明本产品或本图具体问题，不套固定通用口号，不把人群需求写成产品事实。数字、单位与事实可以重复，营销标题应有本套自己的表达。设计说明不印入图片。`,
    informationIncrement:board.informationIncrement+` 用已有依据回应“${d.motivation}”，不能把人群需求写成商品已经具备的能力。`
  };
}

export const normalizeHeadline=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function readCreativeCopy(blocks,sections,requirements='') {
  const headlines=[];
  for(const section of sections.filter(s=>!s.outputConstraint)){
    const block=(blocks.get(section.title)||'').replace(/\*\*/g,'');
    const match=block.match(/画面主标题\s*[：:]\s*([^\r\n]+?)(?=\r?\n|(?:[。；;]\s*)?(?:画面副文案|参考素材用途|事实边界)\s*[：:]|$)/);
    if(!match)throw Object.assign(new Error(section.title+'缺少明确的“画面主标题”，请补齐本套专属文案后再生图'),{status:400});
    const headline=match[1].trim().replace(/^[“「"]|[”」"]$/g,'');
    if(/^(无|无文字|不加文字|none|no text)$/i.test(headline))continue;
    if(headline.length>160)throw Object.assign(new Error(section.title+'的画面主标题过长，请只保留最终印刷文字'),{status:400});
    const normalized=normalizeHeadline(headline),explicit=normalizeHeadline(requirements).includes(normalized);
    if(!explicit&&genericHeadlines.some(text=>normalizeHeadline(text)===normalized))throw Object.assign(new Error(section.title+'仍沿用通用模板标题，请围绕本套人群与商品事实重新构思'),{status:400});
    headlines.push({slot:section.slot,title:section.title,headline,normalized,explicit});
  }
  const seen=new Set();
  for(const item of headlines.filter(item=>!item.explicit)){if(seen.has(item.normalized))throw Object.assign(new Error('本套画面主标题重复：'+item.headline+'。请逐图写出不同内容。'),{status:400});seen.add(item.normalized);}
  return headlines;
}
