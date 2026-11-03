// Visual directions are reusable methods, never additional facts about a SKU.
export const SCENE_STYLE_VERSION=2;

const topics={
  appearance:/颜色|外观|黑色|白色|镜框|镜片|rim|frame|lens|black|gray|colour|color/i,
  detail:/材质|纹理|细节|接缝|镜腿|饰|面料|texture|material|temple|accent|fabric|finish/i,
  structure:/结构|接口|开口|镜桥|连接|线|bridge|port|opening|cable|structure|handle/i,
  scent:/香调|香味|香气|scent|fragrance/i,
  refill:/补充|补充装|容量|毫升|fl\s*oz|refill|\bml\b|volume/i,
  formula:/不含|无添加|free|成分|ingredient|配方|formula/i,
  format:/剂型|软糖|胶囊|片剂|液体|gumm|capsule|tablet|liquid|粉剂|powder/i,
  label:/含量|每份|规格|数量|\bmg\b|\bmcg\b|count|serving|粒|片|颗/i,
  use:/日常|使用|取用|每日|洗手|手部|daily|hand|bathroom|kitchen|use|routine|sleep/i,
  benefit:/支持|帮助|清洁|温和|gentle|wash|support|help|功能|续航|容量|mAh|Wh|测试/i
};
const noScent=/(?:fragrance|scent)[ -]?free|unscented|no (?:added )?(?:fragrance|scent)|无香|無香|不含香精/i;

// Stable semantic selection keeps a fragrance chapter about fragrance even if
// the merchant reorders the same bullet points. Unmatched facts are not proof.
export function evidenceFor(intent,facts,index,{generic=false}={}) {
  const pattern=topics[intent];
  const matched=pattern?facts.filter(f=>pattern.test(f)&&(intent!=='scent'||!noScent.test(f))):[];
  if(matched.length)return [...new Set(matched)].sort().slice(0,3);
  return generic&&facts.length?[facts[index%facts.length]]:[];
}

const card=(intent,question,device,role,composition,increment,headline)=>({intent,buyerQuestion:question,visualDevice:device,productRole:role,composition,informationIncrement:increment,headline});

const gallery=[
  card('benefit','它解决哪一种实际使用需求？','action_and_answer','in_use','一个清楚的使用动作占主画面，旁边以两处真实局部解释需求与已知特点的关系','把一个购买理由转成能看懂的动作与接触关系。',['SEE IT IN YOUR DAY','看看它如何融入日常']),
  card('detail','实物细节是否看得清？','macro_with_locator','detail','大幅可见细节微距与小幅整体定位图；真实纹理而非反复圆形放大框','展示上传素材确实可见的局部与整物对应。',['TAKE A CLOSER LOOK','细节，看得更清楚']),
  card('use','在什么情境中会用到它？','one_context_story','in_use','真实环境中景，用前景物件、主体动作与后景建立空间；文案占自然留白','用一个明确地点和动作解释资料所述用途。',['MADE PART OF YOUR DAY','日常中的这一刻']),
  card('structure','外观与操作部位怎样对应？','exterior_map','detail','俯拍或斜俯拍完整产品加两处外观定位；引线准确连接，不绘制未知内部结构','说明可见外观部位，不能从示意图推断隐藏功能。',['SEE HOW IT COMES TOGETHER','看清各处细节']),
  card('information','已经提供的卖点怎样快速理解？','fact_photo_pairs','supporting','两到三组不同实拍图与原文事实一一配对；不用重复大产品加徽章','让提供的事实与相应图像配对，无法拍出的性质只作文字说明。',['THE DETAILS AT A GLANCE','要点，一眼看清']),
  card('use','它如何进入我的日常流程？','daily_moment','in_use','一个自然拿取或使用瞬间，产品与手和环境有真实接触；换镜头距离','以不同于前面情境的日常瞬间结束主图组。',['A PLACE IN YOUR ROUTINE','融入你的日常'])
];
const aplus=[
  card('use','完整日常情境中，谁在何时怎样使用？','editorial_environment','supporting','宽幅环境叙事：主场景占约三分之二，侧边一幅动作或情境细节，标题与空间融合','从主图的单点理由扩展到完整人物、地点、前后情境；不是把主图横向拉宽。',['THE BIGGER PICTURE','把日常场景展开']),
  card('structure','整体、局部和使用关系如何连在一起？','relationship_atlas','detail','宽幅关系图谱：完整实物、两处真实局部、正确定位线形成阅读路径','增加主图未讲清的整体与局部对应关系，不重放独立卖点海报。',['CONNECT THE DETAILS','把细节联系起来']),
  card('use','同一种用途在不同生活情境中如何呈现？','context_mosaic','in_use','两至三种合理环境形成不等宽叙事分区；每区一个具体动作和相应环境细节','展开使用情境的差别；没有多用途证据时只改变同一用途的环境和视角。',['MORE THAN ONE MOMENT','不止一个日常瞬间']),
  card('detail','近看与实际使用时的细节如何对应？','macro_to_use','detail','左侧实物局部微距，右侧同一细节在使用中的位置，中间细线准确连接','增加从局部到实际使用位置的关系，补足主图只有微距的理解缺口。',['UP CLOSE. IN CONTEXT.','近看细节，放回日常']),
  card('information','购买前哪些事实需要逐一核对？','decision_guide','supporting','宽幅两到三项购买问题，每项配不同实拍证据和简短答案；不制作无依据的竞品对比','把已有事实组织成选购问答；信息不足时只回答外观和已知用途。',['A FEW THINGS TO KNOW','购买前，了解这几件事']),
  card('use','实际取用过程或物品状态怎样衔接？','action_sequence','in_use','宽幅连续动作照片，以同一人物和同一实物呈现；步骤仅来自资料，否则展示可见状态','增加过程连续性，连接取用前、操作中和使用后；不编造用量或维护指令。',['A MOMENT, STEP BY STEP','看清日常的每个动作']),
  card('appearance','最后如何核对想要的外观与已知特点？','visual_index','supporting','一侧完整生活场景，另一侧三块不同细节照片作信息索引；避免再次出现巨型悬浮产品','以情境和证据索引回顾购买信息，给出可查找的答案而不是重复口号。',['THE DETAILS TO REMEMBER','值得记住的细节'])
];

const profiles={
  eyewear:{
    boundary:'不得仅凭深色镜片推断 UV 防护、偏光、防蓝光，也不得编造材质、尺寸、重量、认证、真伪、耐用性或适合所有脸型；只有输入明确提供的规格可按原文表述。佩戴图是外观示意，不是尺寸合身证明。',
    scene:'有自然侧光和空间层次的城市街道、穿衣镜附近或出门台面；人物依据已提供的适用人群选取',
    action:'佩戴、轻扶镜腿、双手摘取或平放；镜框、镜桥、镜片和两条镜腿保持连接，保留参考外形与标识',
    gallery:{
      0:card('appearance','这副镜框的外观特点是什么？','appearance_triptych','detail','三分之四角度整体占一侧，另一侧两到三处真实外观细节；逐项解释镜形、颜色或可见饰片','把当前素材中看得见的外观组成说明清楚。',['MEET THE FRAME','认识这副镜框']),
      1:card('use','基础穿搭还差怎样的视觉重点？','outfit_completion','worn','成人完整穿搭与佩戴侧脸形成主次；用衣料、街景和真实镜框产生层次，不能做脸型矫正对比','让产品承担穿搭角色，以真实穿着解释风格需求。',['THE FINISHING TOUCH','穿搭的最后一笔']),
      2:card('detail','镜腿细节近看是什么样？','temple_macro','detail','真实镜腿微距搭配小比例整体定位；保留可见饰片比例与原有标识，不添加品牌大字','从原始商品图可见的细节建立实物辨识度。',['LOOK A LITTLE CLOSER','再靠近，看细节']),
      3:card('appearance','正面与侧面戴上去是什么样？','front_side_wear','worn','同一成人正面与侧面自然佩戴双画面；镜框形态一致，不标未知脸宽尺寸','展示外观在脸上的位置，不给出客观合身承诺。',['FRONT TO SIDE','从正面到侧面']),
      4:card('use','怎样与已有衣服搭配？','outfit_portraits','worn','三种成人穿搭中景，衣服层次和背景各不同，同一商品保持一致；服装仅作场景道具','提供视觉搭配灵感，不声称衣物或配件随货附送。',['STYLE IT YOUR WAY','穿出你的日常风格']),
      5:card('use','出门时怎样自然拿取？','departure_tabletop','in_use','俯拍出门台面、普通钥匙和衣物边缘；一只手拿镜腿，单副墨镜有真实接触阴影','在自然出门情境中呈现产品，避免孤立悬浮。',['THE LAST DETAIL BEFORE YOU LEAVE','出门前的最后一个细节'])
    },
    aplus:{
      0:card('use','它在完整城市穿搭中扮演什么角色？','city_editorial','worn','大幅成人行走中景或全身穿搭，辅以窄幅侧脸；建筑、衣服、镜框建立三层关系','加入完整服装层次、人物动态与街头环境，把单幅佩戴展示扩展为生活故事。',['YOUR EVERYDAY LOOK. ONE FINAL DETAIL.','日常穿搭，点睛一笔']),
      1:card('structure','镜框轮廓由哪些可见部分构成？','frame_geometry_atlas','detail','完整镜框与镜框边缘、镜桥、镜腿三处真实局部形成横向图谱；引线只连正确位置','加入各部位与整体轮廓的对应，避免仅重放主图的三个外观词。',['READ THE LINES','读懂镜框的线条']),
      2:card('use','不同衣橱风格怎样组合成完整造型？','wardrobe_stories','worn','三种成人完整造型配各自衣料实拍细节；不等宽分区，环境和动作各异','从主图的人像搭配扩展到衣服纹理、层次和场景的具体关系。',['START WITH YOUR WARDROBE','从你的衣橱开始']),
      3:card('detail','小细节戴上后处在什么位置？','temple_to_profile','detail','一侧为当前镜腿可见细节的真实微距，另一侧为成人侧脸相应位置；细线连接正确点','把实物微距与佩戴位置一一对应，补足单独细节图没有讲清的关系。',['THE DETAIL YOU NOTICE UP CLOSE','近看才发现的细节']),
      4:card('appearance','同一副镜框从不同佩戴角度怎样看？','consistent_portrait_sequence','worn','同一成人、同一衣服、相同头部比例的正面、斜侧、侧面三联；不能换成三种镜框','提供连续角度而不是重复穿搭海报，帮助看清外观变化；不推断尺寸合身。',['SEE THE FRAME FROM EVERY ANGLE','从每个角度看镜框']),
      5:card('use','佩戴、摘下与放置怎样自然衔接？','on_off_sequence','in_use','同一成人双手握镜腿摘取、镜框正常状态、桌面镜片朝上放置的连续照片；不编造特殊铰链','用连续动作解释物品与手的关系，增加主图没有的过程视角。',['FROM ON TO OFF','从戴上到摘下']),
      6:card('appearance','最后要核对哪些外观选择？','outfit_visual_index','supporting','左侧成人出门场景，右侧当前实物的镜框、镜形、侧面细节三幅照片与短标签','以外观证据和生活场景收束，回答颜色、形状、侧面细节而不是堆性能徽章。',['THE LOOK, IN THREE DETAILS','三个细节，看清整体风格'])
    }
  },
  handsoap:{
    boundary:'香调描述不等于成分证据：茶叶、浆果只能作为明确标注的香调意象，不画成配方原料或果汁。不得编造杀菌率、杀菌时间、医学或皮肤认证。只展示洗手，不洗水果或餐具。补充装瓶形、瓶盖、把手以素材为准，不凭空加把手；泵瓶若非随附仅作使用道具。',
    scene:'真实浴室洗手台或厨房洗手位置；水流、台盆与手有明确接触关系',
    action:'取用、双手揉搓与冲洗；只有明确为补充装时展示向独立皂液器倒液，不能改变产品容器',
    gallery:{
      0:card('benefit','每天洗手时最关心什么？','handwashing_answer','in_use','洗手动作占主画面，产品自然置于台面；少量原文卖点与清楚手部细节配对','用具体洗手情境说明用户提供的清洁或温和描述，不做皮肤治疗对比。',['A FRESH MOMENT FOR YOUR HANDS','给双手一个清新时刻']),
      1:card('scent','这是什么香调体验？','scent_stilllife','supporting','产品与湿润台面、轻盈气氛；仅有香调证据时添加相关香气意象并标 SCENT NOTES，不表现成分萃取','把已提供香调转为感官联想，明确区分香气意象与配方成分。',['MEET YOUR SCENT','认识这款香调']),
      3:card('refill','补充装怎样取用？','refill_contact','in_use','有补充装证据时展示瓶口对准普通皂液器的连续倒液关系；没有证据改为可见开口细节','清楚说明已知包装形态和取用关系，不自行计算省钱或等效瓶数。',['A CLOSER LOOK AT THE BOTTLE','看清瓶身与取用方式']),
      4:card('formula','已提供的配方说明有哪些？','formula_fact_pairs','supporting','真实液体、瓶身标签与简短原文说明配对；不画虚假分子结构或权威印章','用明确文字呈现不易拍出的性质，不把照片伪装成成分检测证据。',['KNOW THE DETAILS','了解这些细节'])
    },
    aplus:{
      0:card('use','家中洗手时刻如何自然发生？','sink_life_editorial','supporting','宽幅真实居家场景包含成人进门后或日常洗手、台面用品与柔和自然光，产品小比例在正确位置','把单独洗手动作扩展为生活前后情境，突出真实需求和完整空间。',['A SMALL MOMENT IN EVERY DAY','每天都会发生的小小片刻']),
      1:card('refill','瓶身、开口与补充过程怎样连起来？','bottle_to_dispenser_map','in_use','仅在补充装证据支持时，以实际瓶身、瓶口微距、倒入普通皂液器三处照片组成关系图；否则用容器外观关系','补充主图未展开的容器与使用道具关系，不添加虚构容量推算。',['FROM BOTTLE TO DAILY ROUTINE','从瓶身到日常取用']),
      2:card('use','同一种洗手需求在家中哪里出现？','home_handwashing_mosaic','in_use','资料明确浴室及厨房时用两种空间的真实洗手；否则保持已知地点，用不同日常时刻展开','展示同一种洗手用途在不同环境的具体位置，避免把洗手液变成餐具或食品清洁剂。',['A PLACE FOR EVERYDAY HANDWASHING','给日常洗手留个位置']),
      3:card('scent','香调与实际洗手情境如何结合？','scent_to_moment','supporting','一侧为已知香调的情绪静物，另一侧成人真实冲洗；香气意象使用明确香调标签，资料未给香气时改液体细节','把主图孤立的香调联想连接到实际洗手时刻，不能升级为天然配方宣称。',['A SCENTED MOMENT IN YOUR DAY','让香调融入日常']),
      4:card('formula','配方说明和用途有什么需要看清？','soap_label_questions','detail','宽幅问答式实拍分区：现有标签近景、液体状态、洗手关系；答案只引用用户资料','把清洁、温和或不含说明按输入逐项解释；没有检测资料时不制作性能图表。',['LOOK AT THE LABEL DETAILS','看清标签上的说明'])
    }
  },
  supplements:{
    boundary:'补充剂不得编造治病、诊断、减重、改善数值、起效时间或临床前后对比；标签支持的描述保留原有限定语。不得猜测剂量、服用频率、联用方式、禁忌或认证；使用动作不显示未经确认的入口剂量。成分示意不代表人体功效证据。',
    scene:'真实居家日常台面，用品和环境由已知用途决定；没有使用时段资料时不指定早晚',
    action:'打开可见包装或展示已确认剂型的取用关系；保持包装标识，剂型未知时只展示包装，剂量未知时不画入口动作',
    gallery:{
      1:card('format','实际剂型与质地是什么样？','dosage_form_macro','detail','已提供软糖、胶囊或片剂时以其真实质地和完整包装对应；未提供则仅拍包装可见细节','看清实际提供的剂型，不用果味联想冒充具体配料或造型。',['A CLOSER LOOK AT THE FORMAT','看清剂型与质地']),
      3:card('formula','成分资料怎样一眼看懂？','ingredient_fact_pairs','supporting','原文成分信息配包装或已知成分意象；每条对应来源，不画器官治疗或虚假作用路径','把成分信息与标签对应，不能从成分名推演未经提供的效果。',['KNOW WHAT IS LISTED','了解已列明的成分']),
      4:card('label','标签中的含量与数量是什么？','label_fact_cards','detail','真实包装定位与原文数字单位并列；每份、每粒、每瓶含义不得互换','保留完整单位和限定词，数据不足时用可见包装信息。',['READ THE LABEL','读懂标签'])
    },
    aplus:{
      1:card('formula','配方里的信息分别来自哪里？','formula_label_atlas','detail','完整包装、对应标签文字与已提供成分意象形成宽幅关系图；资料不足时使用包装部位索引','从单条成分卖点扩展为标签与信息对应，不引入人体疗效或新数值。',['EXPLORE THE FORMULA DETAILS','展开配方信息']),
      3:card('format','剂型细节与取用关系如何对应？','format_to_routine','detail','一侧为已确认剂型微距，另一侧为同一产品实际取用情境；剂型未知时替换为包装细节','把质地与真实日常联系起来，不猜入口数量或服用时段。',['UP CLOSE, IN YOUR ROUTINE','近看细节，融入日常']),
      4:card('label','购买前哪些标签信息需要核对？','supplement_label_guide','supporting','标签阅读问答配对应照片；保留含量单位、每份限定和明确数量；缺失信息不补齐','增加原文限定的解释与位置索引，避免用医学承诺作收尾。',['GET TO KNOW THE LABEL','进一步了解标签'])
    }
  }
};

export function richStoryboard(payload,slot,facts,base,category) {
  const isAplus=slot>=7,index=isAplus?(slot-7)%7:(Math.max(1,slot)-1)%6;
  const profile=profiles[category];
  let frame=profile?.[isAplus?'aplus':'gallery']?.[index] || (isAplus?aplus:gallery)[index];
  if(frame.intent==='scent'&&(noScent.test([payload.product_name,...facts].join(' '))||!evidenceFor('scent',facts,index).length)){
    frame=isAplus
      ?card('formula','标签上的配方说明如何联系日常取用？','label_to_handwashing','supporting','一侧为真实标签及可见容器细节，另一侧为日常洗手关系，文字仅引用已提供说明','从单独外观扩展到标签与洗手情境的联系；缺少香调证据时保持中性产品展示。',['THE DETAILS IN YOUR ROUTINE','日常中的这些细节'])
      :card('detail','容器与可见质地有什么细节？','soap_visible_details','detail','真实容器局部与完整产品相互定位；液体质地只有资料或图片支持时展示，文字引用原文','看清实际容器与标签，无香或香调缺失时不添加感官承诺。',['A CLOSER LOOK','靠近，看清细节']);
  }
  const supportingFacts=evidenceFor(frame.intent,facts,index,{generic:!profile});
  const evidenceMode=supportingFacts.length?'provided_facts':'visible_reference';
  const master=payload.generation_mode==='master';
  const boundary=profile?.boundary || '仅使用输入中的事实与当前上传素材可见外观。不得从道具、示意图、视觉对比推断参数、性能或认证。场景用品不代表随附配件。';
  const lang=String(payload.target_lang || 'English');
  const headline=/english|^en\b/i.test(lang)?frame.headline[0]:/中文|chinese|^zh\b/i.test(lang)?frame.headline[1]:`将“${frame.headline[0]}”自然翻译为 ${lang}，不可增加产品宣称`;
  const visualProof=supportingFacts.length?`仅依据这些原文事实：${supportingFacts.join('；')}。用实际动作、可见局部或标签位置配对解释；不能直接拍出的性质只作原文说明，不制作实验或效果证明。`:'没有匹配本主题的明确卖点：只展示当前上传素材的可见外观及已知用途关系。没有证据的成分、颜色、剂型、尺寸、技术和性能一律不补写。';
  const scene=base.sceneType==='lifestyle'&&profile?profile.scene:base.scene;
  const board={...base,...frame,category,supportingFacts,evidenceMode,claimBoundary:boundary,scene,
    action:base.sceneType==='lifestyle'&&profile?profile.action:base.action,
    visualProof,
    composition:`${master?'摄影主导':'信息主导'}：${frame.composition}。${base.sceneType==='studio_detail'?'本图选择静物：把人物或环境主画面替换为真实实物、局部、接触位置的静物对应，不擅自增加生活场景。':''}产品职责为 ${frame.productRole}；完整产品的大小服从这项职责，不强制每张巨大居中。`,
    copy:`建议短标题：${headline}。${base.copy}；正文只可取自本图依据，使用 ${lang}。资料不足时用中性外观标签，不能把问题写成未经支持的答案。设计说明不印入成图。`,
    primaryFact:supportingFacts.join('；') || '当前上传素材的可见外观与已知用途，未提供的规格不得推断'
  };
  if(category==='eyewear'){
    const audienceText=[payload.product_name,payload.product_desc].join(' ').replace(/(?:not (?:suitable )?for|keep away from)\s+(?:kids|children)|不适合儿童|远离儿童/gi,'');
    const children=/\bkids?\b|\bchildren\b|\bchild\b|\bjunior\b|儿童|兒童|男童|女童/i.test(audienceText);
    const adult=/\badult\b|\bmen'?s?\b|\bwomen'?s?\b|成人|男士|女士/i.test(audienceText);
    const person=children?'儿童':adult?'成人':'人物';
    for(const key of ['scene','action','composition','informationIncrement'])board[key]=board[key].replaceAll('成人',person);
    board.claimBoundary+=children?' 人物与穿搭应符合资料中的儿童适用对象，保持自然日常活动，不改变参考产品来暗示尺寸合身。':adult?' 人物遵循已提供的成人适用信息，仍不作具体尺寸合身承诺。':' 适用人群未提供：人物佩戴只作造型示意，不声明成人款、儿童款或通用合身；无法合理呈现时使用静物与手持细节。';
  }
  return board;
}

export function describeStoryboard(board) {
  return [`购买问题：${board.buyerQuestion}`,`本图信息增量：${board.informationIncrement}`,`视觉装置：${board.visualDevice}；产品职责：${board.productRole}`,`场景：${board.scene}`,`动作：${board.action}`,`视觉证据：${board.visualProof}`,`本图构图：${board.composition}`,`文字安排：${board.copy}`,`事实边界：${board.claimBoundary}`].join('\n');
}

export function storyboardContract(board) {
  return ['本图叙事约定（与本图方案共同执行）：',`购买问题：${board.buyerQuestion}`,`本图信息增量：${board.informationIncrement}`,`本图证据：${board.visualProof}`,`事实边界：${board.claimBoundary}`,
    '用户明确编辑的场景、构图、文案优先于自动建议；仍须满足事实边界。只保留本图的一个清楚主题及其视觉证据，不机械堆徽章、不把主图横向拉伸为 A+。'].join('\n');
}
