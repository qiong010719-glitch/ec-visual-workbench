// Independently implemented against the official OpenAPI schema, checked 2026-11-21:
// https://www.sadcaptcha.com/api/v1/v3/api-docs
// Request spelling is endpoint-specific; normalized point fields use camelCase.
const BASE_URL='https://www.sadcaptcha.com/api/v1';
const TIMEOUT_MS=30_000;
const INT32_MAX=2_147_483_647;
const TYPES=new Set(['puzzle','temu-arced-slide','temu-two-image','temu-swap-two','semantic-items','temu-three-by-three']);

const MESSAGES=Object.freeze({
  SADCAPTCHA_MISSING_KEY:'未配置 SadCaptcha API 密钥。',
  SADCAPTCHA_INVALID_INPUT:'SadCaptcha 请求参数不完整或格式不正确。',
  SADCAPTCHA_UNSUPPORTED_TYPE:'暂不支持此 SadCaptcha 验证码类型。',
  SADCAPTCHA_HTTP_ERROR:'SadCaptcha 返回 HTTP 失败响应，未自动重试。',
  SADCAPTCHA_TIMEOUT:'SadCaptcha 请求超时，结果及可能的扣费未确认，未自动重试。',
  SADCAPTCHA_NETWORK_ERROR:'SadCaptcha 网络请求中断，结果及可能的扣费未确认，未自动重试。',
  SADCAPTCHA_INVALID_RESPONSE:'SadCaptcha 未返回有效结果，可能的扣费未确认，未自动重试。'
});

class SadCaptchaError extends Error {
  constructor(code,{isUnknown=false,httpStatus}={}){
    super(MESSAGES[code]);
    this.name='SadCaptchaError';
    this.code=code;
    this.isUnknown=isUnknown;
    if(httpStatus!==undefined)this.httpStatus=httpStatus;
  }
}

const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
const isInt32=value=>Number.isInteger(value)&&value>=0&&value<=INT32_MAX;
const isProportion=value=>isNumber(value)&&value>=0&&value<=1;
const invalidInput=()=>new SadCaptchaError('SADCAPTCHA_INVALID_INPUT');
const invalidResponse=()=>new SadCaptchaError('SADCAPTCHA_INVALID_RESPONSE',{isUnknown:true});

function image(value){
  // Require raw base64 rather than a URL; malformed images must fail before a paid request.
  if(typeof value!=='string'||!value.trim())throw invalidInput();
  const result=value.replace(/\s+/g,'');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(result)||result.length%4===1)throw invalidInput();
  if(result.includes('=')&&result.length%4!==0)throw invalidInput();
  return result;
}

function point(value,{input=false}={}){
  // Trajectory centers may temporarily extend beyond the puzzle's image bounds.
  const valid=input?isNumber:isProportion;
  if(!isObject(value)||!valid(value.proportionX)||!valid(value.proportionY)){
    throw input?invalidInput():invalidResponse();
  }
  return {proportionX:value.proportionX,proportionY:value.proportionY};
}

function requestPayload(type,payload){
  if(!isObject(payload))throw invalidInput();
  if(type==='puzzle')return {puzzleImageB64:image(payload.puzzleImageB64),pieceImageB64:image(payload.pieceImageB64)};
  if(type==='temu-arced-slide'){
    if(!Array.isArray(payload.slide_piece_trajectory)||!payload.slide_piece_trajectory.length)throw invalidInput();
    const slide_piece_trajectory=payload.slide_piece_trajectory.map(step=>{
      if(!isObject(step)||!isInt32(step.pixels_from_slider_origin)||!isNumber(step.piece_rotation_angle))throw invalidInput();
      return {
        pixels_from_slider_origin:step.pixels_from_slider_origin,
        piece_rotation_angle:step.piece_rotation_angle,
        piece_center:point(step.piece_center,{input:true})
      };
    });
    return {puzzle_image_b64:image(payload.puzzle_image_b64),piece_image_b64:image(payload.piece_image_b64),slide_piece_trajectory};
  }
  if(type==='temu-two-image'){
    if(typeof payload.challenge!=='string'||!payload.challenge.trim()||!Array.isArray(payload.images_b64)||payload.images_b64.length!==2)throw invalidInput();
    return {challenge:payload.challenge.trim(),images_b64:payload.images_b64.map(image)};
  }
  if(type==='semantic-items'){
    // The provider supports English instructions; translation belongs to the calling adapter.
    if(typeof payload.challenge!=='string'||!payload.challenge.trim())throw invalidInput();
    return {challenge:payload.challenge.trim(),image_b64:image(payload.image_b64)};
  }
  if(type==='temu-three-by-three'){
    if(!Array.isArray(payload.objectsOfInterest)||payload.objectsOfInterest.length<1||payload.objectsOfInterest.length>9||!Array.isArray(payload.images)||payload.images.length!==9)throw invalidInput();
    const objectsOfInterest=payload.objectsOfInterest.map(value=>{
      if(typeof value!=='string'||!value.trim())throw invalidInput();
      return value.trim();
    });
    return {objectsOfInterest,images:payload.images.map(image)};
  }
  return {image_b64:image(payload.image_b64)};
}

function answer(type,data){
  if(!isObject(data))throw invalidResponse();
  if(type==='credits'){
    if(!isInt32(data.credits))throw invalidResponse();
    return {credits:data.credits};
  }
  if(type==='puzzle'){
    if(!isProportion(data.slideXProportion))throw invalidResponse();
    return {slideXProportion:data.slideXProportion};
  }
  if(type==='temu-arced-slide'){
    if(!isInt32(data.pixelsFromSliderOrigin))throw invalidResponse();
    return {pixelsFromSliderOrigin:data.pixelsFromSliderOrigin};
  }
  if(type==='temu-three-by-three'){
    // Use ThreeByThreeCaptchaResponse; the path's response reference is inconsistent in OpenAPI.
    if(!Array.isArray(data.solutionIndices)||!data.solutionIndices.length||!data.solutionIndices.every(index=>Number.isInteger(index)&&index>=0&&index<=8))throw invalidResponse();
    return {solutionIndices:[...data.solutionIndices]};
  }
  if(!Array.isArray(data.proportionalPoints)||!data.proportionalPoints.length||(type==='temu-swap-two'&&data.proportionalPoints.length!==2))throw invalidResponse();
  return {proportionalPoints:data.proportionalPoints.map(value=>point(value))};
}

/**
 * Only the fixed official HTTPS API is contacted; redirects and automatic retries are disabled.
 * The key is read from the supplied configuration on every call and is never stored in results/errors.
 * credits() returns {credits}; solve(type,payload) returns {answer,durationMs}.
 * Input field names follow the live OpenAPI schema, not the inconsistent prose examples.
 */
export function createSadCaptchaClient(configuration,{fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw invalidInput();

  async function request(type,payload){
    let apiKey;
    try{apiKey=configuration?.SADCAPTCHA_API_KEY;}catch{throw new SadCaptchaError('SADCAPTCHA_MISSING_KEY');}
    if(typeof apiKey!=='string'||!apiKey.trim())throw new SadCaptchaError('SADCAPTCHA_MISSING_KEY');
    const url=new URL(`${BASE_URL}/${type==='credits'?'license/credits':type}`);
    url.searchParams.set('licenseKey',apiKey.trim());
    const controller=new AbortController();
    const startedAt=performance.now();
    let timer,timedOut=false;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>{
        timedOut=true;
        controller.abort();
        reject(new SadCaptchaError('SADCAPTCHA_TIMEOUT',{isUnknown:true}));
      },TIMEOUT_MS);
    });
    const perform=async()=>{
      try{
        const response=await fetchImpl(url.href,{
          method:type==='credits'?'GET':'POST',
          headers:type==='credits'?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},
          ...(type==='credits'?{}:{body:JSON.stringify(payload)}),
          signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'
        });
        if(!response||!Number.isInteger(response.status)||response.status<100||response.status>599)throw invalidResponse();
        if(response.status<200||response.status>=300){
          // Never read/propagate error bodies, statusText or URLs: they can echo the license key.
          try{if(response.body?.cancel)Promise.resolve(response.body.cancel()).catch(()=>{});}catch{}
          throw new SadCaptchaError('SADCAPTCHA_HTTP_ERROR',{httpStatus:response.status});
        }
        if(typeof response.json!=='function')throw invalidResponse();
        let data;
        try{data=await response.json();}catch(error){
          if(error instanceof SyntaxError)throw invalidResponse();
          throw error;
        }
        const result=answer(type,data);
        return type==='credits'?result:{answer:result,durationMs:Math.max(0,Math.round(performance.now()-startedAt))};
      }catch(error){
        if(error instanceof SadCaptchaError)throw error;
        const code=timedOut||error?.name==='AbortError'||error?.name==='TimeoutError'?'SADCAPTCHA_TIMEOUT':'SADCAPTCHA_NETWORK_ERROR';
        // Do not preserve an upstream error, cause or stack, even when it looks harmless.
        throw new SadCaptchaError(code,{isUnknown:true});
      }
    };
    try{return await Promise.race([perform(),timeout]);}finally{clearTimeout(timer);}
  }

  return Object.freeze({
    credits:()=>request('credits'),
    async solve(type,payload){
      if(!TYPES.has(type))throw new SadCaptchaError('SADCAPTCHA_UNSUPPORTED_TYPE');
      let normalized;
      try{normalized=requestPayload(type,payload);}catch{throw invalidInput();}
      return request(type,normalized);
    }
  });
}
