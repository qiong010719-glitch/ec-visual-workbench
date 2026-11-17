// Keep the planner's validation identical for both supported text transports.
export function textEndpoint(configuration) {
  return configuration.PLANNER_BASE_URL.replace(/\/$/,'')+(configuration.PLANNER_API_FORMAT==='responses'?'/responses':'/chat/completions');
}
export function textBody(chat,configuration) {
  if(configuration.PLANNER_API_FORMAT!=='responses')return JSON.stringify(chat);
  return JSON.stringify({model:chat.model,stream:false,
    instructions:chat.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),
    input:chat.messages.filter(m=>m.role!=='system'),
    ...(chat.reasoning_effort?{reasoning:{effort:chat.reasoning_effort}}:{})});
}
export function textResult(value,configuration) {
  if(configuration.PLANNER_API_FORMAT!=='responses')return value;
  const content=value.output_text||value.output?.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('')||'';
  return {...value,choices:[{message:{content},finish_reason:value.status==='incomplete'?'length':value.status==='failed'?'error':'stop'}],usage:{...value.usage,prompt_tokens:value.usage?.input_tokens,completion_tokens:value.usage?.output_tokens}};
}
