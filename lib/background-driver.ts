import { CONNECTION_OBJECT, openConnection } from './cloudflare-setup.ts';
export const SITE_ORIGIN = 'https://still-curious-bedtime.workspace-066083.chatgpt.site';
export const DRIVER_NAME = 'still-curious-background-6acfcc84';
export async function serviceAuthorized(request: Request, secret?: string) {
  if (!secret || request.method !== 'POST') return false;
  const supplied = request.headers.get('x-background-key') || '';
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([digest(secret), digest(supplied)]);
  let diff=0; for(let i=0;i<a.length;i++) diff |= a[i]^b[i]; return diff===0;
}
export const driverSource = `export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const response = await fetch('${SITE_ORIGIN}/api/background/run', {
        method: 'POST', redirect: 'manual',
        headers: {'OAI-Sites-Authorization': 'Bearer ' + env.SITE_SERVICE_TOKEN, 'x-background-key': env.BACKGROUND_RUN_SECRET}
      });
      if (!response.ok) throw new Error('Background runner HTTP ' + response.status);
      const result = await response.json();
      console.log(JSON.stringify({event:'background_tick', claimed:result.claimed, operations:result.operations}));
    })());
  },
  fetch() { return new Response('Not found', {status:404}); }
};`;
export async function provisionDriver(env: Cloudflare.Env, fetcher: typeof fetch = fetch) {
  if (!env.BUCKET || !env.CLOUDFLARE_SETUP_KEY || !env.SITE_SERVICE_TOKEN || !env.BACKGROUND_RUN_SECRET) throw new Error('Background settings missing');
  const object = await env.BUCKET.get(CONNECTION_OBJECT);
  if (!object) throw new Error('Cloudflare connection missing');
  const connection = await openConnection(await object.text(), env.CLOUDFLARE_SETUP_KEY);
  const base = `https://api.cloudflare.com/client/v4/accounts/${connection.accountId}/workers/scripts/${DRIVER_NAME}`;
  const call = async (url: string, init: RequestInit) => {
    const response = await fetcher(url,{...init, redirect:'manual', headers:{...init.headers,Authorization:`Bearer ${connection.token}`},signal:AbortSignal.timeout(60000)});
    const data = await response.json().catch(()=>null) as {success?:boolean;result?:unknown;errors?:{code?:number}[]} | null;
    if (!response.ok || data?.success!==true) throw new Error(`Cloudflare deployment HTTP ${response.status}; codes ${(data?.errors||[]).map(e=>Number.isSafeInteger(e.code)?e.code:'unknown').join(',')}`);
    return data;
  };
  const form = new FormData();
  form.set('metadata',JSON.stringify({main_module:'driver.mjs',compatibility_date:'2026-10-01',bindings:[
    {type:'secret_text',name:'SITE_SERVICE_TOKEN',text:env.SITE_SERVICE_TOKEN},
    {type:'secret_text',name:'BACKGROUND_RUN_SECRET',text:env.BACKGROUND_RUN_SECRET}
  ]}));
  form.set('driver.mjs',new Blob([driverSource],{type:'application/javascript+module'}),'driver.mjs');
  await call(base,{method:'PUT',body:form});
  await call(base+'/schedules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify([{cron:'* * * * *'}])});
  const readback=await call(base+'/schedules',{method:'GET'});
  await env.BUCKET.put('private/settings/background-driver-v1.json',JSON.stringify({worker:DRIVER_NAME,configuredAt:new Date().toISOString(),cron:'* * * * *'}));
  return {worker:DRIVER_NAME,configured:true,schedules:readback.result};
}
