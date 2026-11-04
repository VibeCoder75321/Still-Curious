/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { concatenateMp3, validateMp3, Mp3Error } from "../lib/mp3.ts";
import { advanceJob } from "../lib/episode-service.ts";

function cbrClip(count: number, marker?: string) {
  const frameLength = 417, bytes = new Uint8Array(frameLength * count);
  for (let i=0; i<count; i++) {
    const at = i * frameLength; bytes.set([0xff,0xfb,0x90,0x64],at);
    if (i===0 && marker) for (let n=0;n<marker.length;n++) bytes[at+36+n]=marker.charCodeAt(n);
  }
  return bytes;
}

function scriptOf(totalWords: number) {
  const guests=[{speaker:"expert1",name:"Ada",expertise:"neuroscientist"},{speaker:"expert2",name:"Bo",expertise:"historian"},{speaker:"expert3",name:"Cy",expertise:"statistician"}];
  let opening="Welcome. Ada is our neuroscientist. Bo is our historian. Cy is our statistician. Tonight we ask a question and listen to the evidence together.";
  const count=(s:string)=>(s.match(/[\p{L}\p{N}’'-]+/gu)||[]).length;
  opening += ` ${"calm ".repeat(115-count(opening))}`;
  const otherCount=totalWords-count(opening), base=Math.floor(otherCount/19), extra=otherCount%19;
  const turns=Array.from({length:20},(_,i)=>({id:`turn-${i+1}`,speaker:["host","expert1","expert2","expert3"][i%4],text:i===0?opening:`${"calm ".repeat(base+(i<=extra?1:0))}`,factual:false,claim_ids:[],delivery:"conversational"}));
  return {guest_introductions:guests,turns};
}

test("MP3 assembler strips ID3 and encoder Info frame then concatenates valid CBR frames", () => {
  const tag = new Uint8Array(10 + 3 + cbrClip(3,"Info").length);
  tag.set([0x49,0x44,0x33,4,0,0,0,0,0,3]); tag.set([1,2,3],10); tag.set(cbrClip(3,"Info"),13);
  const out = concatenateMp3([tag, cbrClip(4,"Xing")]);
  const stat = validateMp3(out);
  assert.equal(stat.frames, 5); // 2 retained frames from each clip plus 1? second has 4 incl header
  assert.ok(stat.durationSeconds > 0);
  assert.equal(out.length, stat.frames * 417);
});

test("MP3 assembler rejects mismatched bitrates and malformed streams", () => {
  const low = cbrClip(2); const different = cbrClip(2); different[2]=0x80; // 64 kbps header
  assert.throws(() => concatenateMp3([low,different]), Mp3Error);
  assert.throws(() => validateMp3(new Uint8Array([1,2,3])), Mp3Error);
});

test("outline transition makes one structured Responses request and persists stage artifact", async () => {
  const original = globalThis.fetch; let requests=0;
  globalThis.fetch = (async (_input: any, init: any) => {
    requests++;
    const body=JSON.parse(init.body);
    assert.equal(body.model,"gpt-4.1-mini"); assert.equal(body.text.format.type,"json_schema");
    return new Response(JSON.stringify({ id:"resp_test", model:"gpt-4.1-mini", usage:{input_tokens:12,output_tokens:23,total_tokens:35}, output_text: JSON.stringify({ title:"A question",premise:"A short seminar",segments:[{title:"Opening",minutes:1,focus:"welcome"},{title:"Evidence",minutes:4,focus:"review"}]}) }), {status:200});
  }) as any;
  try {
    const job: any={id:"job1",userId:"user1",topic:"sleep",lengthMinutes:5,status:"running",stage:"outline",state:{artifacts:{},sources:[]},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const env: any={OPENAI_API_KEY:"test-only", BUCKET:{put:async()=>{},get:async()=>null}};
    const result=await advanceJob(job,env);
    assert.equal(requests,1); assert.equal(result.stage,"research"); assert.equal(result.title,"A question"); assert.equal(result.state.artifacts.outline.title,"A question");
    assert.deepEqual(result.state.openaiResponses[0], { responseId:"resp_test", model:"gpt-4.1-mini", usage:{input_tokens:12,output_tokens:23,total_tokens:35}, webSearchCalls:0 });
  } finally { globalThis.fetch=original; }
});

test("OpenAI billing and rate limits remain distinct without leaking provider messages or retrying", async () => {
  const original = globalThis.fetch;
  try {
    for (const [code, expected, action] of [
      ["credit_balance_exhausted", /has no credits/, "billing"],
      ["insufficient_quota", /credits or usage limits/, "billing"],
      ["project_spend_limit_exceeded", /spending or usage limit/, "limits"],
      ["rate_limit_exceeded", /temporarily limiting requests/, null],
      ["slow_down", /temporarily limiting requests/, null],
    ] as const) {
      let requests = 0;
      globalThis.fetch = (async () => {
        requests++;
        return new Response(JSON.stringify({error:{code,type:code === "rate_limit_exceeded" ? "rate_limit_error" : "insufficient_quota",message:"sensitive-provider-echo"}}), {status:429,headers:{"x-request-id":"req_safe123"}});
      }) as any;
      const job:any = {id:"blocked",userId:"u",topic:"fireflies",lengthMinutes:5,status:"running",stage:"outline",state:{artifacts:{},sources:[]}};
      const result:any = await advanceJob(job, {OPENAI_API_KEY:"test-only"});
      assert.equal(requests, 1);
      assert.equal(result.status, "failed");
      assert.equal(result.errorAmbiguous, false);
      assert.match(result.error, expected);
      assert.deepEqual(result.providerError, {provider:"openai",status:429,code,requestId:"req_safe123"});
      if (action) assert.equal(result.errorAction.url, `https://platform.openai.com/settings/organization/${action}`);
      else assert.equal(result.errorAction, undefined);
      assert.doesNotMatch(JSON.stringify(result), /sensitive-provider-echo|test-only/);
      await advanceJob(job, {OPENAI_API_KEY:"test-only"});
      assert.equal(requests, 1, "terminal failures must not repeat provider requests");
    }
  } finally { globalThis.fetch = original; }
});

test("unreadable OpenAI errors preserve status and uncertain server failures remain terminal", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [429, 503]) {
      globalThis.fetch = (async () => new Response("not JSON", {status})) as any;
      const job:any = {id:"blocked",userId:"u",topic:"fireflies",lengthMinutes:5,status:"running",stage:"outline",state:{artifacts:{},sources:[]}};
      const result:any = await advanceJob(job, {OPENAI_API_KEY:"test-only"});
      assert.equal(result.status,"failed");
      assert.equal(result.providerError.status,status);
      assert.equal(result.errorAmbiguous,status >= 500);
      if (status === 429) assert.match(result.error,/credits and limits/);
    }
  } finally { globalThis.fetch = original; }
});

test("short assembled audio is blocked before final MP3 upload", async () => {
  const frame = cbrClip(20); let finalPuts=0;
  const turns=Array.from({length:16},(_,i)=>({id:`turn-${i+1}`,speaker:i%4===0?"host":"expert1",text:"x",factual:false,claim_ids:[]}));
  const job: any={id:"assemble",userId:"user",topic:"test",lengthMinutes:5,status:"running",stage:"assembling",state:{artifacts:{outline:{title:"test"},script:{turns},clips:turns.map((t,i)=>({key:`clip-${i}`}))},sources:[]}};
  const result=await advanceJob(job,{BUCKET:{put:async()=>{finalPuts++},get:async()=>({arrayBuffer:async()=>frame.slice().buffer})}} as any);
  assert.equal(result.status,"failed"); assert.match(result.error || "",/duration/); assert.equal(finalPuts,0);
});

test("short scripts fail before any speech provider request", async () => {
  const original = globalThis.fetch; let requests=0;
  globalThis.fetch = (async () => { requests++; return new Response("{}",{status:200}); }) as any;
  try {
    const job: any={id:"j",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"tts",progress:{ttsIndex:0},state:{artifacts:{script:{turns:[{id:"t",speaker:"host",text:"hi",claim_ids:[]}]},review:{flags:[]},claims:[]},sources:[]}};
    const result=await advanceJob(job,{ELEVENLABS_API_KEY:"test-only",ELEVEN_VOICE_HOST:"voice",BUCKET:{put:async()=>{},get:async()=>null}} as any);
    assert.equal(result.status,"failed"); assert.equal(requests,0);
  } finally { globalThis.fetch=original; }
});

test("research refuses duplicate source IDs from a grounded search result", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    const sources=["https://example.org/a","https://example.org/b","https://example.org/c"].map((url,i)=>({url,title:`Source ${i+1}`}));
    const dossier={sources:[{id:"same",url:sources[0].url},{id:"same",url:sources[1].url},{id:"third",url:sources[2].url}],findings:Array.from({length:5},(_,i)=>({id:`claim-${i}`,claim:"Finding",source_ids:["same"],uncertainty:"Limited"}))};
    return new Response(JSON.stringify({id:"research",model:"gpt-4.1-mini",output:[{type:"web_search_call",action:{sources}}],output_text:JSON.stringify(dossier)}),{status:200});
  }) as any;
  try {
    const job:any={id:"r",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"research",state:{artifacts:{outline:{title:"x"}},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"failed"); assert.match(result.error || "",/unique/);
  } finally { globalThis.fetch=original; }
});

test("research accepts a whole-response JSON fence grounded in returned source metadata", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async(_input:any,init:any)=>{
    requests++;
    const body=JSON.parse(init.body);
    assert.equal(body.text.format.type,"json_schema");
    assert.equal(body.text.format.name,"research_dossier");
    assert.equal(body.text.format.strict,true);
    assert.deepEqual(body.tools,[{type:"web_search",search_context_size:"medium"}]);
    assert.equal(body.tool_choice,"required"); assert.equal(body.max_tool_calls,1);
    assert.deepEqual(body.include,["web_search_call.action.sources"]);
    const sources=["https://example.org/a","https://example.org/b","https://example.org/c"].map((url,i)=>({url,title:`Returned source ${i+1}`}));
    const dossier={sources:sources.map((s,i)=>({id:`source-${i+1}`,title:s.title,url:s.url,locator:`Section ${i+1}`})),findings:Array.from({length:5},(_,i)=>({id:`finding-${i+1}`,claim:`Supported finding ${i+1}`,source_ids:[`source-${i%3+1}`],uncertainty:"Evidence has limits."})),limitations:["Small evidence base."]};
    return new Response(JSON.stringify({id:"research",model:"gpt-4.1-mini",output:[{type:"web_search_call",action:{sources}}],output_text:`\`\`\`json\n${JSON.stringify(dossier)}\n\`\`\``}),{status:200});
  }) as any;
  try {
    const job:any={id:"r",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"research",state:{artifacts:{outline:{title:"x"}},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"running"); assert.equal(result.stage,"script");
    assert.equal(result.state.artifacts.dossier.findings.length,5);
    assert.deepEqual(result.state.artifacts.claims.map((c:any)=>c.id),["finding-1","finding-2","finding-3","finding-4","finding-5"]);
    assert.deepEqual(result.state.artifacts.dossier.limitations,["Small evidence base."]);
    assert.deepEqual(result.state.sources.map((s:any)=>s.title),["Returned source 1","Returned source 2","Returned source 3"]);
  } finally { globalThis.fetch=original; }
});

test("incomplete structured research response is rejected before saving or advancing", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    const sources=["https://example.org/a","https://example.org/b","https://example.org/c"].map((url,i)=>({url,title:`Source ${i+1}`}));
    const dossier={sources:sources.map((s,i)=>({id:`source-${i+1}`,title:s.title,url:s.url,locator:"Section"})),findings:Array.from({length:5},(_,i)=>({id:`finding-${i+1}`,claim:"Finding",source_ids:["source-1"],uncertainty:"Limited"})),limitations:[]};
    return new Response(JSON.stringify({status:"incomplete",id:"partial",output:[{type:"web_search_call",action:{sources}}],output_text:JSON.stringify(dossier)}),{status:200});
  }) as any;
  try {
    const job:any={id:"r",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"research",state:{artifacts:{outline:{title:"x"}},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"failed"); assert.equal(result.stage,"failed");
    assert.equal(result.state.artifacts.dossier,undefined); assert.equal(result.state.artifacts.claims,undefined);
  } finally { globalThis.fetch=original; }
});

test("fenced research JSON cannot cite a URL absent from returned search metadata", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    const returned=["https://example.org/a","https://example.org/b","https://example.org/c"].map((url,i)=>({url,title:`Source ${i+1}`}));
    const urls=[...returned.map(s=>s.url),"https://unreturned.example.org/forged"];
    const dossier={sources:urls.map((url,i)=>({id:`source-${i+1}`,title:`Source ${i+1}`,url,locator:"Section"})),findings:Array.from({length:5},(_,i)=>({id:`finding-${i+1}`,claim:"Finding",source_ids:["source-1"],uncertainty:"Limited"})),limitations:[]};
    return new Response(JSON.stringify({output:[{type:"web_search_call",action:{sources:returned}}],output_text:`\`\`\`json\n${JSON.stringify(dossier)}\n\`\`\``}),{status:200});
  }) as any;
  try {
    const job:any={id:"r",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"research",state:{artifacts:{outline:{title:"x"}},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"failed"); assert.match(result.error || "",/not returned by web search/);
    assert.equal(result.state.artifacts.dossier,undefined); assert.equal(result.state.artifacts.claims,undefined);
  } finally { globalThis.fetch=original; }
});

test("research matches returned URLs after removing tracking parameters and saves the cleaned URL", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    const paths=["a","b","c"];
    const returned=paths.map((path,i)=>({url:`https://example.org/${path}?utm_source=openai`,title:`Returned source ${i+1}`}));
    const dossier={sources:paths.map((path,i)=>({id:`source-${i+1}`,title:`Source ${i+1}`,url:`https://example.org/${path}`,locator:"Article"})),findings:Array.from({length:5},(_,i)=>({id:`finding-${i+1}`,claim:"Supported finding",source_ids:["source-1"],uncertainty:"Limited evidence."})),limitations:[]};
    return new Response(JSON.stringify({output:[{type:"web_search_call",action:{sources:returned}}],output_text:`\`\`\`json\n${JSON.stringify(dossier)}\n\`\`\``}),{status:200});
  }) as any;
  try {
    const job:any={id:"r",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"research",state:{artifacts:{outline:{title:"x"}},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"running"); assert.equal(result.stage,"script");
    assert.deepEqual(result.state.sources.map((s:any)=>s.url),["https://example.org/a","https://example.org/b","https://example.org/c"]);
  } finally { globalThis.fetch=original; }
});

test("research still rejects meaningful query parameter mismatches", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    const returned=["https://example.org/article?id=1","https://example.org/b","https://example.org/c"].map((url,i)=>({url,title:`Returned source ${i+1}`}));
    const dossier={sources:["https://example.org/article?id=2",...returned.slice(1).map(s=>s.url)].map((url,i)=>({id:`source-${i+1}`,title:`Source ${i+1}`,url,locator:"Article"})),findings:Array.from({length:5},(_,i)=>({id:`finding-${i+1}`,claim:"Finding",source_ids:["source-1"],uncertainty:"Limited"})),limitations:[]};
    return new Response(JSON.stringify({output:[{type:"web_search_call",action:{sources:returned}}],output_text:`\`\`\`json\n${JSON.stringify(dossier)}\n\`\`\``}),{status:200});
  }) as any;
  try {
    const job:any={id:"r",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"research",state:{artifacts:{outline:{title:"x"}},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"failed"); assert.match(result.error || "",/not returned by web search/);
  } finally { globalThis.fetch=original; }
});

function wordArrayScript() {
  const guest_introductions=[{speaker:"expert1",name:"Ada",expertise:"neuroscientist"},{speaker:"expert2",name:"Bo",expertise:"historian"},{speaker:"expert3",name:"Cy",expertise:"statistician"}];
  const openingWords="Welcome listeners tonight we ask how sleep shapes memory and why careful evidence matters. Ada neuroscientist, Bo historian, and Cy statistician join our seminar. Together we will trace the question, compare research, and leave room for uncertainty.".split(/\s+/);
  while(openingWords.length<120) openingWords.push("calm");
  const speakers=["expert1","expert2","expert3","host"];
  const turns=Array.from({length:19},(_,i)=>({id:`dialogue-${i+1}`,speaker:speakers[i%speakers.length],text_words:Array.from({length:24},(_,n):string=>n===23?"together.":"gently"),factual:false,claim_ids:[],delivery:"conversational"}));
  return {guest_introductions,opening:{id:"opening",speaker:"host",text_words:openingWords,factual:false,claim_ids:[],delivery:"conversational"},turns};
}

function flexibleStringScript() {
  const guest_introductions=[{speaker:"expert1",name:"Ada",expertise:"neuroscientist"},{speaker:"expert2",name:"Bo",expertise:"historian"},{speaker:"expert3",name:"Cy",expertise:"statistician"}];
  const count=(s:string)=>(s.match(/[\p{L}\p{N}’'-]+/gu)||[]).length;
  let opening="Welcome. Tonight we ask how sleep shapes memory and how careful evidence can help us understand that question. Ada is our neuroscientist, Bo is our historian, and Cy is our statistician. We will compare what researchers know, where uncertainty remains, and why the details matter in everyday life.";
  opening += ` ${"calm ".repeat(120-count(opening))}`;
  const sustained="The pattern becomes clearer when we separate what was measured from what people remember later. A well designed study can test one part of that process, but it cannot answer every question about daily life. We should look at who took part, how memory was measured, and whether another group found a similar result. Those details help us distinguish a promising clue from a conclusion that the evidence cannot yet support. Researchers also need to report what did not work, since quiet failures can change how a result should be understood.";
  const filler=(n:number)=>"careful discussion follows the evidence and leaves room for uncertainty. ".repeat(Math.ceil(n/10)).trim().split(/\s+/).slice(0,n).join(" ");
  const target=600;
  const remaining=target-count(opening)-count("Exactly so.")-count(sustained);
  const texts=[opening,"Exactly so.",sustained,...Array.from({length:7},(_,i)=>filler(Math.floor(remaining/7)+(i<remaining%7?1:0)))];
  const speakers=["host","expert1","expert2","host","expert3","expert1","host","expert2","expert3","host"];
  return {guest_introductions,turns:texts.map((text,i)=>({id:`turn-${i+1}`,speaker:speakers[i],text,factual:i===2,claim_ids:i===2?["claim-1"]:[],delivery:"conversational"}))};
}

test("script schema accepts flexible string turns, including a brief interjection and sustained explanation", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async(_input:any,init:any)=>{
    requests++;
    const body=JSON.parse(init.body); const writing=body.text.format.schema;
    const variants=writing.properties.turns.items.anyOf;
    const factual=variants.find((v:any)=>v.properties.factual.enum[0]===true);
    const nonfactual=variants.find((v:any)=>v.properties.factual.enum[0]===false);
    assert.equal(writing.properties.turns.minItems,8); assert.equal(writing.properties.turns.maxItems,36);
    assert.equal(variants[0].properties.text.type,"string");
    assert.equal(variants[1].properties.text.type,"string");
    assert.equal(factual.properties.claim_ids.minItems,1); assert.deepEqual(factual.properties.claim_ids.items.enum,["claim-1"]);
    assert.equal(nonfactual.properties.claim_ids.minItems,0); assert.deepEqual(nonfactual.properties.claim_ids.items.enum,["claim-1"]);
    return new Response(JSON.stringify({id:"script",model:"gpt-4.1",output_text:JSON.stringify(flexibleStringScript())}),{status:200});
  }) as any;
  try {
    const job:any={id:"s",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"script",state:{artifacts:{outline:{title:"x"},dossier:{},claims:[{id:"claim-1",statement:"Claim",source_ids:["s1"]}]},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"running"); assert.equal(result.stage,"review",result.error);
    assert.equal(result.state.artifacts.script.words,600);
    assert.ok(result.state.artifacts.script.chars <= 5000);
    assert.equal(result.state.artifacts.script.turns.length,10);
    assert.ok(result.state.artifacts.script.turns[1].text.split(/\s+/).length >= 2 && result.state.artifacts.script.turns[1].text.split(/\s+/).length <= 5);
    assert.ok(result.state.artifacts.script.turns[2].text.split(/\s+/).length > 80);
    assert.equal(result.state.artifacts.script.turns[2].factual,true);
    assert.deepEqual(result.state.artifacts.script.turns[2].claim_ids,["claim-1"]);
  } finally { globalThis.fetch=original; }
});

test("legacy word-array drafts normalize to text before review", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    return new Response(JSON.stringify({output_text:JSON.stringify(wordArrayScript())}),{status:200});
  }) as any;
  try {
    const job:any={id:"legacy",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"script",state:{artifacts:{outline:{},dossier:{},claims:[]},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"running"); assert.equal(result.stage,"review",result.error);
    assert.equal(result.state.artifacts.script.turns.length,20);
    assert.equal(result.state.artifacts.script.turns[0].text.split(/\s+/).length,120);
    assert.equal(result.state.artifacts.script.turns[1].text.split(/\s+/).length,24);
    assert.equal("text_words" in result.state.artifacts.script.turns[0],false);
  } finally { globalThis.fetch=original; }
});

test("legacy word-array drafts containing embedded spaces fail before review", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    const value=wordArrayScript(); value.turns[0].text_words[0]="two words";
    return new Response(JSON.stringify({output_text:JSON.stringify(value)}),{status:200});
  }) as any;
  try {
    const job:any={id:"s",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"script",state:{artifacts:{outline:{},dossier:{},claims:[{id:"claim-1",statement:"Claim",source_ids:["s1"]}]},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"failed"); assert.equal(result.stage,"failed");
    assert.match(result.error || "",/word format is invalid/);
    assert.equal(result.state.artifacts.script,undefined);
  } finally { globalThis.fetch=original; }
});

test("factual script turns without claim citations fail before review", async () => {
  const original=globalThis.fetch; let requests=0;
  globalThis.fetch=(async()=>{
    requests++;
    const opening=["Iris","Mina","Theo"].map((name,i)=>`${name} brings ${["neuroscience","history","statistics"][i]}`).join(". ");
    const turns=Array.from({length:20},(_,i)=>({id:`turn-${i+1}`,speaker:["host","expert1","expert2","expert3"][i%4],text:i===0?`${opening}. ${"Welcome, this seminar asks a question, and we will follow the evidence carefully. ".repeat(9)}`:`${"A careful discussion follows. ".repeat(7)}`,factual:i===1,claim_ids:[],delivery:"conversational"}));
    return new Response(JSON.stringify({output_text:JSON.stringify({guest_introductions:[{speaker:"expert1",name:"Iris",expertise:"neuroscience"},{speaker:"expert2",name:"Mina",expertise:"history"},{speaker:"expert3",name:"Theo",expertise:"statistics"}],turns})}),{status:200});
  }) as any;
  try {
    const job:any={id:"s",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"script",state:{artifacts:{outline:{},dossier:{},claims:[{id:"claim-1",statement:"Claim",source_ids:["s"]}]},sources:[]}};
    const result=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,1); assert.equal(result.status,"failed"); assert.match(result.error || "",/factual script turn must cite/);
  } finally { globalThis.fetch=original; }
});

test("one script repair stage corrects word count and preserves claims and speakers", async () => {
  const original=globalThis.fetch; let requests=0; const responses=[scriptOf(545),scriptOf(625)];
  globalThis.fetch=(async()=>{
    const value=responses[requests++];
    return new Response(JSON.stringify({id:`script-${requests}`,model:"gpt-4.1-mini",usage:{total_tokens:100},output_text:JSON.stringify(value)}),{status:200});
  }) as any;
  try {
    const job:any={id:"repair",userId:"u",topic:"x",lengthMinutes:5,status:"running",stage:"script",state:{artifacts:{outline:{},dossier:{},claims:[]},sources:[]}};
    const first=await advanceJob(job,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(first.stage,"script_repair"); assert.equal(first.status,"running"); assert.equal(first.state.openaiCalls,1);
    assert.equal(first.state.artifacts.script.turns.length,20); assert.equal(first.state.artifacts.scriptRepair.attempted,true); assert.equal(first.state.artifacts.scriptRepair.completed,false);
    const repaired=await advanceJob(first,{OPENAI_API_KEY:"test-only"} as any);
    assert.equal(requests,2); assert.equal(repaired.stage,"review",repaired.error); assert.equal(repaired.status,"running");
    assert.equal(repaired.state.openaiCalls,2); assert.equal(repaired.state.artifacts.script.words,625); assert.equal(repaired.state.artifacts.scriptRepair.completed,true);
    assert.deepEqual(repaired.state.artifacts.script.turns.map((t:any)=>t.speaker),first.state.artifacts.script.turns.map((t:any)=>t.speaker));
  } finally { globalThis.fetch=original; }
});
