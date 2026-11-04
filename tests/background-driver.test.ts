import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceAuthorized,provisionDriver,driverSource} from '../lib/background-driver.ts';
import {sealConnection,CONNECTION_OBJECT} from '../lib/cloudflare-setup.ts';
test('background service requires its dedicated secret and POST',async()=>{
 const request=(key:string,method='POST')=>new Request('https://site.test',{method,headers:{'x-background-key':key}});
 assert.equal(await serviceAuthorized(request('secret'),'secret'),true);
 assert.equal(await serviceAuthorized(request('bad'),'secret'),false);
 assert.equal(await serviceAuthorized(request('secret','GET'),'secret'),false);
 assert.equal(await serviceAuthorized(request('')),false);
});
test('provisioning keeps credentials server-side, checks errors, and verifies the schedule',async()=>{
 const key=btoa('k'.repeat(32)),token='provider-secret';
 const sealed=await sealConnection({accountId:'a'.repeat(32),token},key);
 let saved=false; const env={CLOUDFLARE_SETUP_KEY:key,SITE_SERVICE_TOKEN:'site-secret',BACKGROUND_RUN_SECRET:'run-secret',BUCKET:{get:async()=>({text:async()=>sealed}),put:async()=>{saved=true;}}} as any;
 const requests:any[]=[];
 const result=await provisionDriver(env,(async(url:string,init:RequestInit)=>{
   requests.push({url,method:init.method}); assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token); assert.equal(init.redirect,'manual');
   if(init.body instanceof FormData){const meta=JSON.parse(String(init.body.get('metadata')));assert.equal(meta.bindings[0].type,'secret_text');assert.equal(driverSource.includes('site-secret'),false);}
   return Response.json({success:true,result:[{cron:'* * * * *'}]});
 }) as typeof fetch);
 assert.equal(requests.length,3);assert.equal(saved,true);assert.equal(JSON.stringify(result).includes(token),false);
 saved=false;
 await assert.rejects(provisionDriver(env,(async()=>Response.json({success:false,errors:[{code:10000,message:token}]},{status:403})) as typeof fetch),/HTTP 403/);
 assert.equal(saved,false);
});
