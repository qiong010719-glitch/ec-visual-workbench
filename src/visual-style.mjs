// Reusable design directions, not product facts or competitor artwork.
import {extractProductFacts} from './product-facts.mjs';
import {richStoryboard} from './rich-storytelling.mjs';
import {directStoryboard,creativeSystem} from './creative-direction.mjs';
export const SCENE_STYLE='scene_advertising';
export const visualStyleId=payload=>payload.visual_style==='original'?'original':SCENE_STYLE;
export const generationMode=payload=>payload.generation_mode==='master'?'master':/^ultra/.test(payload.generation_mode || payload.mode || '')?'ultra':'fast';

const categories=[
  ['pet',/宠物|犬|狗|猫|pet |dog |cat |veterinary/i,'宠物日常护理或喂食空间','按当前商品的实际用途表现人与宠物互动；仅营养食品可使用喂食动作','包装可见细节、已确认的质地或取用方式'],
  ['eyewear',/墨镜|太阳镜|眼镜|sunglasses|eyewear|spectacles/i,'有真实空间层次的城市穿搭与出门场景','按资料中的适用人群展示自然佩戴、镜腿拿取或放置，不推断防护性能与尺寸合身','镜框、镜片与镜腿的可见外观及佩戴位置'],
  ['handsoap',/洗手液|洗手皂|hand\s*(?:soap|wash)|softsoap/i,'真实浴室或厨房洗手位置','只展示洗手与已知包装的取用关系，补充装以提供的资料为准','手、泡沫、水流与实际容器的接触关系'],
  ['supplements',/营养|维生素|软糖|保健|小檗碱|褪黑素|supplement|vitamin|gummy|gummies|berberine|melatonin/i,'真实日常取用台面','按已确认的剂型展示取用，不猜剂量、不暗示医疗效果','包装、剂型、真实质地与取用动作'],
  ['beauty',/护肤|精华|乳液|美容|面霜|serum|skin care|skincare|moisturiz|cosmetic/i,'有自然侧光的梳妆台或盥洗空间','根据实际用途展示手部取用或涂抹；不得用皮肤前后对比暗示未证实功效','质地纹理、开口与手部接触区域'],
  ['kitchen',/厨房|厨具|咖啡机|搅拌|料理|锅|榨汁|blender|coffee maker|cookware|kitchen|air fryer/i,'真实厨房操作台，保留台面、背景与操作空间','只按已知操作方式展示备料、使用或取放','实际结构、工作接触位置、已知食材状态'],
  ['cleaning',/清洁|吸尘|拖把|vacuum|cleaner|mop/i,'符合商品用途的室内清洁区域','展示真实握持与工作接触位置，不编造去除率或前后测试','刷头、握柄、可见材质与接触面'],
  ['home',/家居|床|被|毯|枕|家具|沙发|bedding|blanket|pillow|sheet|furniture/i,'有完整空间层次的卧室或客厅','展示铺设、轻触、折叠或日常使用的自然动作','织物、接缝、边缘与实际尺度关系'],
  ['carrier',/婴儿背带|母婴背带|baby carrier/i,'有暖自然光的居家或外出亲子场景','穿戴、托扶或取放动作以当前素材和已知用途为依据，不推断适用月龄、承重或健康效果','面料、缝线、扣件和可见接触部位'],
  ['garden',/园艺|草坪|播撒|gardening|lawn|spreader/i,'有可见地面和植被层次的草坪或庭院','按已提供的用途展示推行、装料或手部操作，接触点清楚，不编造覆盖面积与生长效果','操作部位、颗粒或材料的可见状态、工具与地面的真实关系'],
  ['bags',/包袋|手提包|背包|beach bag|tote|backpack/i,'与当前包袋用途相符的出行、运动或日常空间','用手提、肩背、取放物品表现使用关系；清洁演示仅在当前资料支持时使用','手柄、表面纹理、开口与当前素材可见的收纳结构'],
  ['tools',/工具|电钻|螺丝|钻机|drill|tool|driver|wrench/i,'与具体工具用途相符的工作台','只展示已确认的安全握持与工作姿态，不发明工具能力','操作部位、握持关系与真实表面纹理'],
  ['outdoor',/水杯|水壶|帐篷|露营|户外|bottle|tumbler|tent|camping|outdoor/i,'与具体商品用途相符的户外或出行地点','展示携带、放置或使用；饮水与搭建动作仅用于相应产品','手部尺度、开合位置、已知材料与携带关系'],
  ['electronics',/充电|电源|线缆|手机|耳机|音箱|电子|电脑|power bank|charger|cable|phone|headphone|speaker|electronics/i,'与当前电子产品用途对应的办公或出行设备场景','按已知功能展示连接、握持或操作；充电场景必须有真实线缆路径和对应接口','可见接口、按键、线缆连接或材质细节'],
  ['food',/食品|咖啡|茶叶|零食|水果|coffee|snack|tea |food/i,'符合食品用途的餐桌或准备台面','只展示已确认的食用、冲泡或取用方式','真实色泽、质地、包装与合理食用关系']
];
export function productCategory(payload) {
  const matchType=value=>{
    // Shape descriptors and ingredients are not the product type. Preserve
    // explicit pet use and supplement forms when resolving mixed names.
    const text=String(value).replace(/cat[ -]?eye|猫眼|貓眼/gi,'');
    const pet=categories.find(c=>c[0]==='pet');
    if(pet[1].test(text))return pet;
    if(/serum|cream|lotion|moisturiz|精华|精華|面霜|乳液/i.test(text)&&!/gumm|capsule|tablet|软糖|胶囊|片剂/i.test(text))return categories.find(c=>c[0]==='beauty');
    return categories.find(c=>c[1].test(text));
  };
  const row=matchType(payload.product_name || '') || matchType([payload.reference_category,payload.category].filter(Boolean).join(' '));
  return row?.[0] || 'general';
}
function context(payload) {
  return categories.find(c=>c[0]===productCategory(payload)) || ['general',null,'与当前商品已知用途相符的真实环境；用途不明时用有空间层次的静物台面','只呈现资料明确的取放或使用动作；没有用途证据时展示可见外观','当前素材中的材质、形态和可见结构'];
}

export function styleGuideFor(payload) {
  if(visualStyleId(payload)==='original' || /^thd(?:_|$)/.test(payload.design_scope || ''))return '';
  const master=generationMode(payload)==='master';
  const creative=payload.creative_direction?creativeSystem(payload.creative_direction):null;
  return [
    '场景广告风格：每张图用真实画面解释一个购买问题，整套保持可识别的视觉语言。',
    '丰富来自内容关系：先规划购买问题，再选择可支持的事实、具体情境、人物动作、微距或外观图解。画面有主次，二至三处互相关联的细节比无关装饰更有用；不强制每张用巨大产品、图标和勋章。痛点表现为具体生活需求或选购疑问，不制造恐惧、虚假前后对比或未证实结果。',
    '主图组负责快速识别与单点理由；A+ 独立展开完整情境、整体与局部关系、连续过程和选购答案。七个 A+ 主题可各自成立，不重复前五张循环，不把方图加宽或换背景当新内容。每张明确新增信息，镜头与版式交替变化。',
    '整套展示按卖点混合：人物环境中景、无人物实物微距、仅手部的操作特写、俯拍关系图、事实信息版面、连续动作与视觉索引各有用途。副图和 A+ 达到六张时，至少安排四种展示方式，至少三张不出现完整人物；相邻图片在地点、动作、镜头距离、产品比例、版式中至少改变两项。人物不是每个卖点的默认主角，不反复使用同一女性、厨房岛台、持包装姿势和大号正面包装。统一品牌色与字体，不等于统一房间、镜头和动作。',
    master
      ? '大师模式：以摄影叙事、光影质感和材质表现组织画面；先设计完整空间、主体动作和镜头，再安排精简标题与必要说明。文字跟随摄影节奏，不套用快速模式的信息密度或场景控制。'
      : `快速设计模式：以卖点信息和清楚演示组织画面；先确定标题、说明和视觉证据，再安排产品与情境。${payload.info_density==='low'?'低信息密度：一个标题与一项解释':payload.info_density==='medium'?'中等信息密度：一个标题、短副标题与两项解释':'中高信息密度：一个大标题、短副标题与二至三组图文说明'}；每组均有明确用途。场景倾向 ${payload.scene_intensity || 'original'}；密度与场景比重分别控制。`,
    creative?`本套统一字体系统：${creative.type}。遵循这套的字体与排版，不套用其他套的粗体标题模板。文案使用目标语言，数字及单位完整保留。`:'整套统一字体家族：采用 Inter / Helvetica 风格的现代无衬线字，标题用粗体，正文用常规字重，数字沿用同一家族；图标统一细实线。标题用深墨色或场景所需的高对比反白，强调词只用整套强调色。用清晰平面字体，不逐张换成立体字、泡泡字或描边贴纸。文案使用目标语言，数字及单位完整保留。',
    creative?`本套背景与配色：${creative.palette}。商品原色保持与原始素材一致；变化的是背景和设计语言。`:'主色从当前产品或包装提取，辅色最多两种，统一中性色底与强调色。未确认颜色时保持产品原色，按当前上传素材确定主色，不照搬竞品包装颜色。',
    '真实光源、接触阴影、景深和前中后景；产品应处于可理解的空间中。镜头在全景、动作中景、微距和俯拍间有节奏地变化。',
    '每个卖点都要有视觉证据：动作、接触关系、质地或已知结构；数字不能只放在旁边充当解释。没有测试资料时不画测试结果、医学效果、虚假对比或认证章。',
    '当前商品身份、颜色、数量、结构和配件以上传素材为准。单根线不能变成多根；外部参考只提供设计方法。输入参数与产品可见标识冲突时标记待核实，不拼出互相矛盾的参数。'
  ].join('\n');
}

const galleryQuestions=['它在实际使用中怎样帮助我？','材质与细节是什么样？','我会在什么情境中使用？','结构和操作关系清楚吗？','已提供的信息如何一眼看懂？','它如何融入我的日常？'];
const galleryCompositions=['中景动作主画面与单一重点信息区','大幅微距与小幅整体定位图，不用重复的圆形放大框','保留空间前中后景的横向使用画面','有实际接触关系的俯拍或斜俯拍结构展示','两至三组带真实图像的信息分区','不同于前面场景的完整环境收尾'];
const aplusQuestions=['这个产品适合怎样的日常？','已知特点分别有什么直观依据？','关键细节值得怎样看？','怎样理解已确认的使用方式？','购买前需要记住哪些已知信息？'];
const aplusCompositions=['宽幅生活场景开篇，产品和动作形成明确视线中心','横向二至三组图文，分别解释不同已知事实','横幅质地微距，完整产品小比例定位','按已提供步骤展示动作关系，无步骤资料时展示不同已知用途','宽幅整体收尾与已知信息索引，不虚构品牌历史'];
export function storyboardFor(payload,slot,primaryFact) {
  const [, ,scene,action,proof]=context(payload);
  const aplus=slot>=7,i=aplus?(slot-7)%5:(Math.max(1,slot)-1)%6;
  const master=generationMode(payload)==='master';
  const baseLayout=aplus?aplusCompositions[i]:galleryCompositions[i];
  const sceneIndexes=payload.scene_intensity==='low'?[2]:payload.scene_intensity==='medium'?[0,2,5]:payload.scene_intensity==='high'?[0,1,2,3,4,5]:[2,5];
  const lifestyle=master||sceneIndexes.includes(i);
  const base={
    buyerQuestion:(aplus?aplusQuestions:galleryQuestions)[i],
    sceneType:lifestyle?'lifestyle':'studio_detail',
    scene:lifestyle?((!aplus&&i===1)?`${scene}中的材质近景，仍保留一处完整产品定位`:scene):'有真实体积光与接触阴影的产品静物空间，背景延续本商品的主辅色',
    action:lifestyle?action:'以完整产品与可见局部的对应关系展示事实，只有需要解释操作时才使用手部动作',visualProof:`围绕“${primaryFact}”选择${proof}作为视觉证据；该事实不能直接可视化时，以原文说明搭配实际使用关系，不制造证明。`,
    composition:master?`摄影主导：${baseLayout}；主体和光线先建立叙事，文字置于自然留白处，不堆成参数卡片`:`信息主导：${baseLayout}；标题、说明与对应证据一一关联，适配快速模式所选信息密度`,
    copy:master?'一个精简主题标题，必要时加一句依据，文案不遮挡关键动作与质地':'一个明确标题，辅以所选密度的短说明；图标只解释已知事实'
  };
  return directStoryboard(richStoryboard(payload,slot,extractProductFacts(payload.product_desc),base,productCategory(payload)),payload.creative_direction,payload,slot);
}

export const visualTraits=['complete_scene','human_interaction','material_macro','headline_hierarchy','information_graphics','coherent_palette','product_in_use','studio_hero'];
const traitGuidance={complete_scene:'建立前中后景和真实接触阴影',human_interaction:'用符合当前商品用途的自然动作建立使用关系',material_macro:'微距纹理配合完整产品定位',headline_hierarchy:'整套采用一致的标题与正文层级',information_graphics:'每组图文解释一条已知信息',coherent_palette:'从当前商品提取统一的主辅色',product_in_use:'让当前商品在真实用途里承担明确作用',studio_hero:'用有方向的光线突出主体轮廓和材质'};
export function crossCategoryGuidance(image) {
  const traits=(image.visualTraits || []).filter(t=>visualTraits.includes(t));
  return (traits.length?traits:['complete_scene','headline_hierarchy','coherent_palette']).map(t=>traitGuidance[t]).join('；');
}
