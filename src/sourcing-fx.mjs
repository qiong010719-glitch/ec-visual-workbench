import fs from 'node:fs';
import path from 'node:path';

export const ECB_RATES_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const DAY=86400000;
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const decimal=value=>{
  requireValue(typeof value==='string'&&/^\d{1,12}(?:\.\d{1,12})?$/.test(value)&&Number(value)>0,'汇率格式无效');
  const [whole,fraction='']=value.split('.');return {n:BigInt(whole+fraction),d:10n**BigInt(fraction.length)};
};

export function parseEcbRates(xml,now=Date.now()){
  requireValue(typeof xml==='string'&&xml.length<=100000&&xml.includes('European Central Bank')&&!/<!DOCTYPE|<!ENTITY/i.test(xml),'欧洲央行汇率响应无效');
  const dates=[...xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/g)];
  requireValue(dates.length===1,'汇率发布日期无法确认');const date=dates[0][1],time=Date.parse(date+'T00:00:00Z');
  requireValue(Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===date&&time<=now&&now-time<=7*DAY,'汇率日期无效或超过7天，已停止换算');
  const rates={EUR:'1'};
  for(const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([^'"]+)['"]\s*\/>/g)){
    requireValue(!Object.hasOwn(rates,match[1]),'汇率币种重复');decimal(match[2]);rates[match[1]]=match[2];
  }
  requireValue(rates.USD,'汇率响应缺少USD');return {date,rates};
}

export function createUsdRateProvider({directory,fetcher=fetch,clock=Date.now}){
  const file=path.join(directory,'ecb-rates.json');
  async function latest(){
    const now=clock();let cached;
    try{const value=JSON.parse(fs.readFileSync(file,'utf8'));const rates=parseEcbRates(value.xml,now);if(Date.parse(value.fetchedAt)<=now)cached={...rates,fetchedAt:value.fetchedAt,xml:value.xml};}catch{}
    if(cached&&now-Date.parse(cached.fetchedAt)<3600000)return cached;
    try{
      const response=await fetcher(ECB_RATES_URL,{redirect:'error',signal:AbortSignal.timeout(20000)});
      requireValue(response.ok,`汇率服务返回 ${response.status}`);const xml=await response.text(),rates=parseEcbRates(xml,now),fetchedAt=new Date(now).toISOString();
      fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({xml,fetchedAt}));fs.renameSync(file+'.tmp',file);
      return {...rates,fetchedAt};
    }catch(e){if(cached)return {...cached,cacheFallback:true};throw new Error('无法取得有效美元参考汇率，详情已保留，未导入：'+e.message);}
  }
  return {async quote(currency,targetCurrency='USD'){
    const snapshot=await latest();requireValue(snapshot.rates[currency],`欧洲央行未提供 ${currency} 汇率，已停止，未猜测汇率`);
    requireValue(snapshot.rates[targetCurrency],`欧洲央行未提供 ${targetCurrency} 汇率，已停止，未猜测汇率`);
    return {from:currency,to:targetCurrency,source:'欧洲央行 ECB',sourceUrl:ECB_RATES_URL,date:snapshot.date,fetchedAt:snapshot.fetchedAt,sourcePerEur:snapshot.rates[currency],targetPerEur:snapshot.rates[targetCurrency],usdPerEur:snapshot.rates.USD,rate:Number(snapshot.rates[targetCurrency])/Number(snapshot.rates[currency]),cacheFallback:!!snapshot.cacheFallback};
  }};
}

const zeroDecimalCurrencies=new Set(['JPY','KRW','VND','CLP','ISK','XAF','XOF','XPF']);
const threeDecimalCurrencies=new Set(['BHD','JOD','KWD','OMR','TND']);
const twoDecimalCurrencies=new Set(['AED','ARS','AUD','BDT','BGN','BRL','CAD','CHF','CNY','COP','CZK','DKK','EGP','EUR','GBP','HKD','HUF','IDR','ILS','INR','MAD','MXN','MYR','NOK','NZD','PEN','PHP','PKR','PLN','QAR','RON','RSD','RUB','SAR','SEK','SGD','THB','TRY','TWD','UAH','USD','UYU','ZAR']);
export function currencyDecimals(currency){
  if(zeroDecimalCurrencies.has(currency))return 0;
  if(threeDecimalCurrencies.has(currency))return 3;
  requireValue(twoDecimalCurrencies.has(currency),`无法确认币种 ${currency||'未提供'} 的金额单位`);
  return 2;
}

function priceDecimal(value){
  requireValue(typeof value==='string'&&/^\d{1,12}(?:\.\d{1,8})?$/.test(value),'来源售价必须是明确的十进制金额');
  const [whole,fraction='']=value.split('.');const amount={n:BigInt(whole+fraction),d:10n**BigInt(fraction.length)};
  requireValue(amount.n>0n,'来源直接售价必须大于0');return amount;
}

export function normalizeMoneyAmount(amount,currency){
  const value=priceDecimal(amount),decimals=currencyDecimals(currency),scale=10n**BigInt(decimals);
  requireValue(value.n*scale%value.d===0n,`来源金额的小数位与 ${currency} 币种不一致`);
  const minor=value.n*scale/value.d;
  return formatMinor(minor,decimals);
}

function formatMinor(minor,decimals){
  const text=minor.toString().padStart(decimals+1,'0');
  return decimals?text.slice(0,-decimals)+'.'+text.slice(-decimals):text;
}

// Price parity uses decimal strings throughout. The legacy workbook conversion
// above retains its numeric return type; listing drafts keep the exact quote.
export function convertDisplayedSalePrice({amount,currency},targetCurrency,quote,{clock=Date.now}={}){
  const originalAmount=normalizeMoneyAmount(amount,currency),targetDecimals=currencyDecimals(targetCurrency);
  if(currency===targetCurrency)return {amount:normalizeMoneyAmount(originalAmount,targetCurrency),currency:targetCurrency,originalAmount,originalCurrency:currency,conversion:null};
  const now=typeof clock==='function'?clock():clock;
  requireValue(Number.isFinite(now),'无法确认价格换算时间');
  requireValue(quote?.from===currency&&quote.to===targetCurrency&&quote.sourceUrl===ECB_RATES_URL,'汇率币种或来源不匹配');
  const date=String(quote.date||''),dateTime=Date.parse(date+'T00:00:00Z'),fetchedTime=Date.parse(quote.fetchedAt);
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(dateTime)&&new Date(dateTime).toISOString().slice(0,10)===date&&dateTime<=now&&now-dateTime<=7*DAY&&Number.isFinite(fetchedTime)&&fetchedTime>=dateTime&&fetchedTime<=now&&now-fetchedTime<=7*DAY,'汇率日期无效或超过7天，已停止换算');
  const source=decimal(quote.sourcePerEur),target=decimal(quote.targetPerEur??(targetCurrency==='USD'?quote.usdPerEur:undefined)),value=priceDecimal(originalAmount);
  const numerator=value.n*target.n*source.d*10n**BigInt(targetDecimals),denominator=value.d*target.d*source.n;
  const minor=(2n*numerator+denominator)/(2n*denominator);
  requireValue(minor>0n&&minor<=999999999999999n,'换算售价超出平台可支持范围');
  return {amount:formatMinor(minor,targetDecimals),currency:targetCurrency,originalAmount,originalCurrency:currency,conversion:{from:currency,to:targetCurrency,source:quote.source||'欧洲央行 ECB',sourceUrl:ECB_RATES_URL,date,fetchedAt:quote.fetchedAt,sourcePerEur:quote.sourcePerEur,targetPerEur:quote.targetPerEur??quote.usdPerEur,cacheFallback:!!quote.cacheFallback,rounding:`half-up:${targetDecimals}`}};
}

export function convertProductToUsd(product,quote){
  if(product.currency==='USD')return {...product,originalCurrency:'USD'};
  requireValue(quote?.from===product.currency&&quote.to==='USD'&&quote.sourceUrl===ECB_RATES_URL,'汇率币种或来源不匹配');
  const source=decimal(quote.sourcePerEur),usd=decimal(quote.usdPerEur);
  const dollars=(minor,decimals)=>{
    requireValue(Number.isSafeInteger(minor)&&minor>=0&&Number.isInteger(decimals)&&decimals>=0&&decimals<=4,'原始金额单位无法确认');
    const numerator=BigInt(minor)*usd.n*source.d*100n,denominator=10n**BigInt(decimals)*usd.d*source.n;
    const cents=(2n*numerator+denominator)/(2n*denominator);
    requireValue(cents<=BigInt(Number.MAX_SAFE_INTEGER),'换算金额超出支持范围');return Number(cents)/100;
  };
  const skus=product.skus.map(s=>({...s,originalPrice:s.price,originalSalePrice:s.salePrice,price:dollars(s.priceMinor,s.priceDecimals),salePrice:dollars(s.salePriceMinor,s.priceDecimals)}));
  return {...product,currency:'USD',originalCurrency:product.currency,conversion:{...quote,rounding:'每个SKU分别四舍五入至美元小数点后2位'},skus,warnings:[...product.warnings,'美元金额按参考汇率换算，保留原币种价格；不含汇兑手续费、运费或利润加价。',...(quote.cacheFallback?['汇率服务暂不可用，本次使用7天内已保存的参考汇率。']:[])]};
}
