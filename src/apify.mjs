import fs from 'node:fs';
import {parseEnv} from 'node:util';
// Official API: https://docs.apify.com/api/v2/actors-runs-post
// Starting a run is deliberately never retried: an interrupted response may have created a paid run.
const resourceId = value => {
  if (typeof value !== 'string' || !/^[\w-]+(?:[~/][\w-]+)?$/.test(value)) throw new Error('Apify ID 无效');
  return value.replace('/', '~');
};
export class ApifyClient {
  constructor(configuration = process.env, transport = fetch) {this.configuration = configuration; this.transport = transport;}
  get token() {
    if(this.configuration.APIFY_API_TOKEN)return this.configuration.APIFY_API_TOKEN;
    const file=this.configuration.APIFY_TOKEN_FILE;
    return file && fs.existsSync(file) ? parseEnv(fs.readFileSync(file,'utf8')).APIFY_API_TOKEN || '' : '';
  }
  get configured() {return !!this.token;}
  async request(route, {method = 'GET', payload} = {}) {
    if (!this.configured) throw new Error('请先配置 APIFY_API_TOKEN');
    let response;
    try {
      response = await this.transport('https://api.apify.com/v2/' + route, {
        method, headers: {Authorization: `Bearer ${this.token}`, 'Content-Type':'application/json'},
        body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(45000), redirect:'error'
      });
    } catch {
      throw Object.assign(new Error(method === 'POST' ? 'Apify 提交结果未知；请先在 Apify 核对运行记录，不要重复提交。' : 'Apify 读取失败，可用已有运行编号继续同步。'), {submissionUnknown:method === 'POST'});
    }
    if (!response.ok) throw Object.assign(new Error(`Apify HTTP ${response.status}；请核对 API token、Actor 权限和额度。`), {httpStatus:response.status,submissionUnknown:method === 'POST' && response.status >= 500});
    try {return await response.json();}
    catch {throw Object.assign(new Error('Apify 响应无法解析，请核对运行记录。'), {submissionUnknown:method === 'POST'});}
  }
  async start(actor, input, {maxTotalChargeUsd, maxItems}) {
    if (!Number.isFinite(maxTotalChargeUsd) || maxTotalChargeUsd <= 0) throw new Error('需要明确的采集费用上限');
    const query = new URLSearchParams({maxTotalChargeUsd:String(maxTotalChargeUsd),maxItems:String(maxItems),timeout:'900',restartOnError:'false'});
    const result = await this.request(`actors/${resourceId(actor)}/runs?${query}`, {method:'POST',payload:input});
    if (!result.data?.id) throw Object.assign(new Error('Apify 没有返回运行编号，请在控制台核对。'),{submissionUnknown:true});
    return result.data;
  }
  async run(id) {return (await this.request(`actor-runs/${resourceId(id)}`)).data;}
  async items(id, maximum = 1000) {
    const rows = [];
    while (rows.length < maximum) {
      const limit = Math.min(250, maximum - rows.length);
      const data = await this.request(`datasets/${resourceId(id)}/items?format=json&clean=true&offset=${rows.length}&limit=${limit}`);
      if (!Array.isArray(data)) throw new Error('Apify 数据集格式不正确');
      rows.push(...data);
      if (data.length < limit) break;
    }
    return rows.slice(0,maximum);
  }
}
