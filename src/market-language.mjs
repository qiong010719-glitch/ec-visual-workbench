const definitions=[
  ['en-CA','英语','English (Canada)',['加拿大','canada','ca']],
  ['ja-JP','日语','Japanese',['日本','japan','jp']],
  ['en-US','英语','English (United States)',['美国','united states','usa','us']],
  ['en-GB','英语','English (United Kingdom)',['英国','united kingdom','uk','gb']],
  ['en-AU','英语','English (Australia)',['澳大利亚','澳洲','australia','au']],
  ['en-NZ','英语','English (New Zealand)',['新西兰','new zealand','nz']],
  ['de-DE','德语','German',['德国','germany','de']],
  ['fr-FR','法语','French',['法国','france','fr']],
  ['it-IT','意大利语','Italian',['意大利','italy','it']],
  ['es-ES','西班牙语','Spanish (Spain)',['西班牙','spain','es']],
  ['es-MX','西班牙语','Spanish (Mexico)',['墨西哥','mexico','mx']],
  ['pt-BR','葡萄牙语','Portuguese (Brazil)',['巴西','brazil','br']],
  ['pt-PT','葡萄牙语','Portuguese (Portugal)',['葡萄牙','portugal','pt']],
  ['ko-KR','韩语','Korean',['韩国','south korea','korea','kr']],
  ['nl-NL','荷兰语','Dutch',['荷兰','netherlands','nl']],
  ['pl-PL','波兰语','Polish',['波兰','poland','pl']],
  ['sv-SE','瑞典语','Swedish',['瑞典','sweden','se']],
  ['da-DK','丹麦语','Danish',['丹麦','denmark','dk']],
  ['nb-NO','挪威语','Norwegian Bokmal',['挪威','norway','no']],
  ['fi-FI','芬兰语','Finnish',['芬兰','finland','fi']],
  ['cs-CZ','捷克语','Czech',['捷克','czechia','czech republic','cz']],
  ['el-GR','希腊语','Greek',['希腊','greece','gr']],
  ['ro-RO','罗马尼亚语','Romanian',['罗马尼亚','romania','ro']],
  ['hu-HU','匈牙利语','Hungarian',['匈牙利','hungary','hu']],
  ['tr-TR','土耳其语','Turkish',['土耳其','turkey','turkiye','tr']],
  ['ar-SA','阿拉伯语','Arabic',['沙特','沙特阿拉伯','saudi arabia','sa']],
  ['ar-AE','阿拉伯语','Arabic',['阿联酋','united arab emirates','uae','ae']],
  ['he-IL','希伯来语','Hebrew',['以色列','israel','il']],
  ['th-TH','泰语','Thai',['泰国','thailand','th']],
  ['vi-VN','越南语','Vietnamese',['越南','vietnam','vn']],
  ['id-ID','印尼语','Indonesian',['印度尼西亚','印尼','indonesia','id']],
  ['en-IE','英语','English (Ireland)',['爱尔兰','ireland','ie']],
  ['de-AT','德语','German (Austria)',['奥地利','austria','at']]
];
const normalize=value=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/(?:站点|站|market|site)$/u,'').trim();
export function marketLanguage(site){
  const key=normalize(site),row=definitions.find(([code,,,aliases])=>normalize(code)===key||aliases.includes(key));
  if(!row)throw Object.assign(new Error(`无法确定「${site||'未填写国家'}」的标题语言，请在店铺设置填写明确的国家站点；多语言市场需明确语言，不自动使用英语。`),{status:400});
  const [code,label,name]=row;return {code,label,name,market:String(site),english:code.startsWith('en-')};
}
export function validateMarketTitle(text,language){
  const value=String(text||''),code=language.code;
  const scripts={ja:/[\p{Script=Hiragana}\p{Script=Katakana}]/u,ko:/\p{Script=Hangul}/u,ar:/\p{Script=Arabic}/u,he:/\p{Script=Hebrew}/u,th:/\p{Script=Thai}/u,el:/\p{Script=Greek}/u};
  const pattern=scripts[code.split('-')[0]];
  if(pattern?!pattern.test(value):!/[\p{Script=Latin}]/u.test(value)||/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Thai}]/u.test(value))throw Object.assign(new Error(`商品标题应使用${language.label}（${language.market||code}），请重新生成或修改。`),{status:400});
}
