import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, routeEnv, routeRequest } from './fixtures/route-harness.ts';
import { CONNECTION_OBJECT, handleCloudflareSetup, openConnection, sealConnection, setupOwner } from '../lib/cloudflare-setup.ts';
const accountId = 'a'.repeat(32), token = 'offline-test-token-1234567890';
const key = btoa('k'.repeat(32));
const request = (options = {}) => routeRequest('/api/owner/cloudflare', options);
test('owner-only setup fails closed and rejects cross-origin submissions without provider calls', async () => {
  const h = createRouteHarness(); routeEnv.CLOUDFLARE_SETUP_KEY = key;
  const env = routeEnv as Cloudflare.Env;
  let calls = 0; const fetcher = (async () => { calls++; throw new Error('must not call'); }) as typeof fetch;
  try {
    for (const user of [null, 'invitee']) {
      assert.equal(setupOwner(request({ user }), env), false);
      assert.equal((await handleCloudflareSetup(request({ user }), env, fetcher)).status, 403);
      assert.equal((await handleCloudflareSetup(request({ user, body: {accountId, token} }), env, fetcher)).status, 403);
    }
    assert.equal((await handleCloudflareSetup(request({origin:'https://evil.test', body:{accountId,token}}),env,fetcher)).status,403);
    delete routeEnv.EPISODE_OWNER_USER_ID;
    assert.equal((await handleCloudflareSetup(request(),env,fetcher)).status,403);
    assert.equal(calls,0);
  } finally { h.close(); }
});
test('connection is encrypted, token never returned, and failed verification preserves it', async () => {
  const h = createRouteHarness(); routeEnv.CLOUDFLARE_SETUP_KEY = key; const env = routeEnv as Cloudflare.Env;
  const calls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push(url); assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/'));
    assert.equal(init.redirect,'manual'); assert.equal(new Headers(init.headers).get('authorization'),`Bearer ${token}`);
    return Response.json({success:true,result:url.endsWith('/verify')?{status:'active'}:[]});
  }) as typeof fetch;
  try {
    const response = await handleCloudflareSetup(request({body:{accountId,token}}),env,fetcher);
    assert.equal(response.status,200); assert.equal((await response.text()).includes(token),false); assert.equal(calls.length,3);
    const saved = await (await h.BUCKET.get(CONNECTION_OBJECT))!.text(); assert.equal(saved.includes(token),false);
    assert.equal((await openConnection(saved,key)).token,token);
    const status = await handleCloudflareSetup(request(),env,fetcher); const publicStatus = await status.text(); assert.equal(publicStatus.includes(token),false); assert.equal(JSON.parse(publicStatus).backgroundActive,false);
    const failure = await handleCloudflareSetup(request({body:{accountId,token}}),env,(async()=>{throw new Error(token);}) as typeof fetch);
    assert.equal(failure.status,503); assert.equal((await failure.text()).includes(token),false);
    assert.equal(await (await h.BUCKET.get(CONNECTION_OBJECT))!.text(),saved);
    let redirectCalls = 0;
    const redirect = await handleCloudflareSetup(request({body:{accountId,token}}),env,(async()=>{redirectCalls++; return new Response(null,{status:302,headers:{location:'https://untrusted.test/'}});}) as typeof fetch);
    assert.equal(redirect.status,422); assert.equal(redirectCalls,1);
    assert.equal(await (await h.BUCKET.get(CONNECTION_OBJECT))!.text(),saved);
  } finally {h.close();}
});
test('encryption rejects tampering and wrong keys; malformed or oversized input never calls Cloudflare',async()=>{
  const sealed=await sealConnection({token},key); await assert.rejects(openConnection(sealed,btoa('z'.repeat(32))));
  const corrupt=JSON.parse(sealed); corrupt.ciphertext[0]^=1; await assert.rejects(openConnection(JSON.stringify(corrupt),key));
  const h=createRouteHarness(); routeEnv.CLOUDFLARE_SETUP_KEY=key; let calls=0;
  try { for(const body of [null,[],{accountId:'https://evil.test',token},{accountId,token:'x'.repeat(5000)}]) {
    const result=await handleCloudflareSetup(request({body}),routeEnv as Cloudflare.Env,(async()=>{calls++; throw new Error();}) as typeof fetch);
    assert.ok([400,413].includes(result.status));
  } assert.equal(calls,0); } finally {h.close();}
});
test('rejections identify the failed check without leaking provider text or overwriting a connection',async()=>{
  const h=createRouteHarness(); routeEnv.CLOUDFLARE_SETUP_KEY=key;
  try {
    await h.BUCKET.put(CONNECTION_OBJECT,'keep-existing');
    for(const stage of ['token','workers','queues']) {
      const result=await handleCloudflareSetup(request({body:{accountId,token}}),routeEnv as Cloudflare.Env,(async(url:string)=>{
        const here=url.endsWith('/verify')?'token':url.includes('/workers/')?'workers':'queues';
        return here===stage?Response.json({success:false,errors:[{code:10000,message:token},{code:token}]},{status:403}):Response.json({success:true,result:here==='token'?{status:'active'}:[]});
      }) as typeof fetch);
      assert.equal(result.status,422); const body=await result.json() as {step:string;codes:number[]}; assert.equal(body.step,stage); assert.deepEqual(body.codes,[10000]); assert.equal(JSON.stringify(body).includes(token),false);
      assert.equal(await (await h.BUCKET.get(CONNECTION_OBJECT))!.text(),'keep-existing');
    }
  } finally {h.close();}
});
test('account-owned tokens use account verification and legacy tokens can use its fallback',async()=>{
  for(const value of ['cfat_offline-test-token-1234567890',token]) {
    const h=createRouteHarness(); routeEnv.CLOUDFLARE_SETUP_KEY=key; const paths:string[]=[];
    try {
      const result=await handleCloudflareSetup(request({body:{accountId,token:value}}),routeEnv as Cloudflare.Env,(async(url:string)=>{
        paths.push(url);
        if(url.endsWith('/user/tokens/verify')) return Response.json({success:false},{status:403});
        return Response.json({success:true,result:url.endsWith('/verify')?{status:'active'}:[]});
      }) as typeof fetch);
      assert.equal(result.status,200); assert.ok(paths.some(p=>p.endsWith(`/accounts/${accountId}/tokens/verify`)));
      if(value.startsWith('cfat_')) assert.equal(paths.some(p=>p.endsWith('/user/tokens/verify')),false);
    } finally {h.close();}
  }
});
