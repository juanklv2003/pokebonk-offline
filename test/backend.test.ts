import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';

import type {SandboxBackend} from '../types/backend.d.ts';
import type {Profile} from '../types/profile.d.ts';
import {record} from '../types/data.ts';

const template = await readFile('dist/runtime/local-backend.js', 'utf8');
function backend(storage = new Map<string,string>(), fault?:(operation:string,key:string)=>void,johto=false): SandboxBackend {
  const defaults = () => ({ settings:{audio:1},league:[],unlocked:[],seen:[],forms:[],shinies:[],classics:[],research:{},lab:{},biomes:{},bag:{},cosmetics:[],itemsOff:[],quests:{},counters:{},runs:[],stardust:0 });
  const context = { structuredClone,crypto:webcrypto,TextEncoder,Date,document:{title:''},
    localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{fault?.('set',key);storage.set(key,value)},removeItem:(key:string)=>{fault?.('remove',key);storage.delete(key)}},
    __PROFILE__:defaults,__SEASON__:()=>({season:johto?3:2}),__ROSTER__:[{id:4},{id:150},...johto?[{id:152},{id:155}]:[]],__REGISTRY__:{pokemon:[{id:4},{id:5},{id:150},...johto?[{id:152},{id:155}]:[]],get:(id:number)=>({family:id}),root:(id:number)=>({id})},
    __TREASURES__:[{id:'fire',starter:4,prizes:[{id:'candy',cosmetics:[]},{id:'grand',cosmetics:['tlook:4:4','frame:tr-fire-2']}]},{id:'water',starter:7,prizes:[{id:'look',cosmetics:['tlook:7:3']}]}],__LAB__:[{id:'move',max:4}],__ITEMS__:[{key:'soda-pop'}],__BIOMES__:[{id:'forest',size:100},{id:'future'}],__EVENTS__:[],__MEDALS__:4,__REFRESH__:(profile:Profile)=>{for(const period of ['daily','weekly'] as const)profile[period]??={ids:['task1','task2','task3'],prog:[],claimed:[]};},__TASK__:()=>({goal:3}),__QUESTS__:[{id:"kills100",title:"Veteran"},{id:"look4",look:{member:4,n:1}}],__SCORE__:()=>0,__COSMETICS__:['frame:master'],__PREPARATIONS__:['rare-candy','honey'] };
  const value: unknown = new vm.Script(template+'\n;createLocalSandboxBackend()').runInNewContext(context);
  const api=record(value);
  for (const method of ['loadProfile','savePrefs','chooseStarter','startRun','finishRun']) assert.equal(typeof api[method],'function');
  // The VM executes the compiled implementation, which implements this contract.
  // Runtime assertions above plus the behavior tests below cover the realm boundary.
  return value as SandboxBackend;
}
test('new profile unlocks catalogs and reload preserves preferences and starter',async()=>{
  const storage=new Map<string,string>(), b=backend(storage);
  const p=await b.loadProfile();
  assert.equal(p.medals['forest-2'],4);assert.equal(p.medals['future-0'],undefined);assert.equal(p.daily.prog[0],3);assert.equal(p.daily.claimed.join(','),'1,1,1,1');assert.equal(p.weekly.claimed.join(','),'1,1,1,1');
  assert.deepEqual(JSON.parse(JSON.stringify(p.treasures)),{fire:{won:['candy','grand']},water:{won:['look']}});
  assert.equal(p.wins[4],7);assert.equal(p.wins[150],7);
  assert.equal(p.stardust,1e9);assert.equal(p.league.length,2);assert.equal(p.lab['move'],4);assert.equal(p.itemsOwned[0],'soda-pop');
  p.settings['audio']=0;await b.savePrefs(null,p);await b.chooseStarter(null,150);
  const reload=await backend(storage).loadProfile();assert.equal(reload.lastSpecies,150);assert.equal(reload.settings['audio'],0);
});
test('finished runs persist counters and finite rewards without external fetch',async()=>{
  const b=backend();await b.loadProfile();const ticket=await b.startRun(null,{boosts:[]});
  const result=await b.finishRun(null,ticket,{victory:true,kills:7,progress:{counters:{kills:7},seen:[5]}});
  assert.equal(result.profile.counters['kills'],7);assert.equal(result.profile.counters['wins'],1);assert.equal(result.profile.runs.length,1);assert.equal(result.stardust,0);
  const unavailable: unknown = Reflect.get(b, 'signIn');
  assert.equal(typeof unavailable, 'function');
  if (typeof unavailable !== 'function') throw new Error('Expected fallback method');
  await assert.rejects(unavailable(),/online feature/);
});
test('corrupt saves fail visibly instead of silently replacing progress',async()=>{
  await assert.rejects(backend(new Map([['pokebonk.local.profile.v1','invalid-json']])).loadProfile(),/JSON/);
});

test('existing saves receive every achievement and cosmetic without fabricating run counters',async()=>{
  const storage=new Map([['pokebonk.local.profile.v1',JSON.stringify({lastSpecies:4,quests:{old:1},counters:{kills:7,wins:1},settings:{audio:0},runs:[{id:'real-run'}],cosmetics:['frame:custom']})]]);
  const b=backend(storage),p=await b.loadProfile();
  assert.equal(p.quests['kills100'],1);assert.equal(p.quests['look4'],1);assert.equal(p.quests['old'],1);
  assert.ok(p.cosmetics.includes('title:q:kills100'));assert.ok(p.cosmetics.includes('look:4:1'));assert.ok(p.cosmetics.includes('frame:custom'));
  assert.equal(p.counters['kills'],7);assert.equal(p.counters['wins'],1);assert.equal(p.runs[0]?.id,'real-run');assert.equal(p.lastSpecies,4);assert.equal(p.settings['audio'],0);
  await b.savePrefs(null,p);const reloaded=await backend(storage).loadProfile();
  assert.equal(reloaded.quests['look4'],1);assert.equal(reloaded.cosmetics.filter(x=>x==='look:4:1').length,1);assert.equal(reloaded.counters['kills'],7);
});

test('structurally invalid saves reject without overwriting stored progress',async()=>{
  for(const profile of [{counters:{kills:'seven'}},{settings:[]},{runs:[{id:42}]},{treasures:{fire:{won:[42]}}},{treasures:{fire:[]}},{wins:{4:'all'}},{wins:{4:-1}},{wins:{4:1.5}},{wins:{4:2147483648}}]) {
    const saved=JSON.stringify(profile),storage=new Map([['pokebonk.local.profile.v1',saved]]);
    await assert.rejects(backend(storage).loadProfile(),/Invalid local profile/);
    assert.equal(storage.get('pokebonk.local.profile.v1'),saved);
  }
});

test('unrecognized upstream fields and equipped looks survive normalization',async()=>{
  const storage=new Map([['pokebonk.local.profile.v1',JSON.stringify({futureField:{keep:true},settings:{quality:'low'},look:'spectral'})]]);
  const p=await backend(storage).loadProfile();
  assert.deepEqual(p['futureField'],{keep:true});assert.equal(p['look'],'spectral');
  assert.equal(p.settings['quality'],'low');
});

test('treasure completion grants every prize once and preserves existing profile data',async()=>{
  const saved={treasures:{fire:{won:['old-prize'],future:42},future:{won:['future-prize']}},cosmetics:['frame:custom'],counters:{wins:2},runs:[{id:'real-run'}],bonk:17,settings:{audio:0},lastSpecies:150,look:'classic'};
  const storage=new Map([['pokebonk.local.profile.v1',JSON.stringify(saved)]]),b=backend(storage);
  const p=await b.loadProfile();
  assert.deepEqual(p['treasures'],{fire:{won:['old-prize','candy','grand'],future:42},future:{won:['future-prize']},water:{won:['look']}});
  assert.ok(p.cosmetics.includes('tlook:4:4'));assert.ok(p.cosmetics.includes('frame:tr-fire-2'));assert.ok(p.cosmetics.includes('tlook:7:3'));
  assert.equal(p.cosmetics.filter(id=>id==='tlook:4:4').length,1);
  for(const key of ['counters','runs','bonk','lastSpecies','look'] as const)assert.deepEqual(p[key],saved[key]);
  const before=JSON.parse(JSON.stringify(p));await b.savePrefs(null,p);
  assert.deepEqual(JSON.parse(JSON.stringify(await backend(storage).loadProfile())),before);
});

test('all roster members have every victory mark without changing actual run records',async()=>{
  const original={wins:{4:1,150:4,999:8},counters:{wins:2,kills:7},runs:[{id:'real-run',species:150,victory:true,tier:2}],best:{'forest-0':123},times:{'forest-0':456},settings:{audio:0},lastSpecies:150};
  const storage=new Map([['pokebonk.local.profile.v1',JSON.stringify(original)]]),b=backend(storage);
  const p=await b.loadProfile();
  assert.deepEqual(p['wins'],{4:7,150:7,999:8});
  for(const key of ['counters','runs','best','times','lastSpecies'] as const)assert.deepEqual(p[key],original[key]);
  await b.savePrefs(null,p);
  const reloaded=await backend(storage).loadProfile();assert.deepEqual(reloaded['wins'],{4:7,150:7,999:8});
  assert.equal(reloaded.counters['wins'],2);assert.equal(reloaded.runs.length,1);
});

test('victory completion preserves additional existing bits',async()=>{
  const storage=new Map([['pokebonk.local.profile.v1',JSON.stringify({wins:{4:8}})]]);
  assert.equal((await backend(storage).loadProfile()).wins[4],15);
});

const hashSave=(save:string)=>createHash('sha256').update(save).digest('hex');
function savedRun(storage:Map<string,string>,kind:'runsave'|'runauto',ticket:import('../types/profile.d.ts').RunTicket,overrides:Record<string,unknown>={}) {
  const save=JSON.stringify({v:1,build:'test',cfg:{species:4},summary:{time:12},result:{progress:{counters:{kills:7}}},...overrides});
  const hash=hashSave(save);storage.set(`pb.${kind}.local-sandbox`,JSON.stringify({ticket,save,hash,at:1}));return hash;
}
test('manual suspension and recovery preserve the pre-run profile until one settlement',async()=>{
  const storage=new Map<string,string>(),b=backend(storage);await b.loadProfile();
  const ticket=await b.startRun(null,{}),hash=savedRun(storage,'runsave',ticket);
  b.keepLive(null,ticket,{progress:{counters:{kills:7}}});await b.suspendRun(null,ticket,hash);
  assert.equal(storage.has('pokebonk.local.pending.v1'),true,'suspension retains a settlement fallback');
  const reload=backend(storage);await reload.loadProfile();await reload.resumeRun(null,ticket,hash);
  assert.equal((await reload.loadProfile()).counters['kills'],undefined);
  const result={progress:{counters:{kills:7}}};await reload.finishRun(null,ticket,result);
  const final=backend(storage);await final.loadProfile();const again=await final.finishRun(null,ticket,result);
  assert.equal(again.profile.counters['kills'],7);assert.equal(again.profile.counters['runs'],1);assert.equal(again.profile.runs.length,1);
});
test('autosave is offered before abandoned checkpoint settlement; recovery can repeat safely',async()=>{
  const storage=new Map<string,string>(),b=backend(storage);await b.loadProfile();const ticket=await b.startRun(null,{});
  const hash=savedRun(storage,'runauto',ticket);b.keepLive(null,ticket,{progress:{counters:{kills:7}}});
  const reload=backend(storage);await reload.loadProfile();assert.equal(await reload.autoWaiting(null),true);
  assert.equal((await reload.retryNow()).saved,0);await reload.recoverRun(null,ticket,hash);await reload.recoverRun(null,ticket,hash);
  storage.delete('pb.runauto.local-sandbox');assert.equal((await reload.retryNow()).saved,0,'active recovered run must not settle');
  await reload.finishRun(null,ticket,{progress:{counters:{kills:9}}});
  const last=backend(storage);await last.loadProfile();assert.equal(await last.autoWaiting(null),false);assert.equal((await last.retryNow()).saved,0);
  assert.equal((await last.loadProfile()).counters['kills'],9);
});
test('declining autosave settles latest checkpoint once after restart',async()=>{
  const storage=new Map<string,string>(),b=backend(storage);await b.loadProfile();const ticket=await b.startRun(null,{});
  savedRun(storage,'runauto',ticket);b.keepLive(null,ticket,{progress:{counters:{kills:11}}});
  storage.delete('pb.runauto.local-sandbox');const reload=backend(storage);await reload.loadProfile();
  assert.equal((await reload.retryNow()).saved,1);assert.equal((await reload.retryNow()).saved,0);
  assert.equal((await reload.loadProfile()).counters['kills'],11);
});
test('invalid or mismatched saved blobs reject without touching any storage',async()=>{
  for(const broken of ['{',JSON.stringify({ticket:{id:'other'},save:'{}',hash:'bad'}),JSON.stringify({ticket:{id:'local-x'},save:'{}',hash:'bad'})]) {
    const storage=new Map<string,string>(),b=backend(storage);await b.loadProfile();const ticket=await b.startRun(null,{});
    storage.set('pb.runsave.local-sandbox',broken);const before=[...storage];
    await assert.rejects(b.suspendRun(null,ticket,'bad'));assert.deepEqual([...storage],before);
  }
});

test('interrupted profile write retains checkpoint and retries without lost or duplicate progress',async()=>{
  const storage=new Map<string,string>();let fail=false;
  const b=backend(storage,(op,key)=>{if(fail&&op==='set'&&key==='pokebonk.local.profile.v1')throw Error('quota');});await b.loadProfile();const ticket=await b.startRun(null,{}),result={progress:{counters:{kills:13}}};b.keepLive(null,ticket,result);
  fail=true;await assert.rejects(b.finishRun(null,ticket,result),/quota/);assert.equal(storage.has('pokebonk.local.pending.v1'),true);
  fail=false;const reload=backend(storage);await reload.loadProfile();assert.equal((await reload.retryNow()).saved,1);assert.equal((await reload.loadProfile()).counters['kills'],13);
});
test('interrupted cleanup after durable settlement cannot award the same run twice',async()=>{
  const storage=new Map<string,string>();let fail=false;
  const b=backend(storage,(op,key)=>{if(fail&&op==='remove'&&key==='pokebonk.local.pending.v1')throw Error('cleanup');});await b.loadProfile();const ticket=await b.startRun(null,{}),result={progress:{counters:{kills:17}}};savedRun(storage,'runauto',ticket);b.keepLive(null,ticket,result);
  fail=true;await assert.rejects(b.finishRun(null,ticket,result),/cleanup/);
  const reload=backend(storage);await reload.loadProfile();assert.equal(await reload.autoWaiting(null),false);assert.equal((await reload.retryNow()).saved,0);
  const p=await reload.loadProfile();assert.equal(p.counters['kills'],17);assert.equal(p.counters['runs'],1);assert.equal(p.runs.length,1);
});
test('optional cloud and stash capabilities are absent, upload reports local-only',async()=>{
  const b=backend();await b.loadProfile();for(const key of ['stashGet','stashPut','savedOnServer','downloadSave'])assert.equal(Reflect.get(b,key),undefined);
  const upload=Reflect.get(b,'uploadSave');assert.equal(typeof upload,'function');if(typeof upload!=='function')throw Error('upload');assert.equal(await upload(),false);
});

test('saving preferences during a resumed run does not pre-award cumulative progress',async()=>{
  const storage=new Map<string,string>(),b=backend(storage);const p=await b.loadProfile();const ticket=await b.startRun(null,{});
  p.counters['kills']=7;p.settings['audio']=0;p['frame']='frame:custom';
  await b.savePrefs(null,p);
  const finished=await b.finishRun(null,ticket,{progress:{counters:{kills:7}}});
  assert.equal(finished.profile.counters['kills'],7);assert.equal(finished.profile.settings['audio'],0);assert.equal(finished.profile['frame'],'frame:custom');
});

test('unsupported save schemas and altered payloads remain intact on rejection',async()=>{
  for(const overrides of [{v:2},{cfg:[]},{result:null}]) {
    const storage=new Map<string,string>(),b=backend(storage);await b.loadProfile();const ticket=await b.startRun(null,{}),hash=savedRun(storage,'runsave',ticket,overrides),before=[...storage];
    await assert.rejects(b.resumeRun(null,ticket,hash));assert.deepEqual([...storage],before);
  }
  const storage=new Map<string,string>(),b=backend(storage);await b.loadProfile();const ticket=await b.startRun(null,{}),hash=savedRun(storage,'runsave',ticket);
  const key='pb.runsave.local-sandbox';const raw=storage.get(key);assert.ok(raw);storage.set(key,raw.replace('"v\\":1','"v\\":2'));const before=[...storage];
  await assert.rejects(b.resumeRun(null,ticket,hash));assert.deepEqual([...storage],before);
});
test('settled IDs survive display-history eviction and interrupted manual-save cleanup',async()=>{
  const storage=new Map<string,string>();let fail=false;
  const b=backend(storage,(op,key)=>{if(fail&&op==='remove'&&key==='pb.runsave.local-sandbox')throw Error('cleanup');});await b.loadProfile();const first=await b.startRun(null,{});savedRun(storage,'runsave',first);
  fail=true;await assert.rejects(b.finishRun(null,first,{progress:{counters:{kills:3}}}),/cleanup/);
  const reload=backend(storage);await reload.loadProfile();assert.equal(storage.has('pb.runsave.local-sandbox'),false);
  for(let index=0;index<31;index++){const ticket=await reload.startRun(null,{});await reload.finishRun(null,ticket,{});}
  await reload.finishRun(null,first,{progress:{counters:{kills:3}}});const p=await reload.loadProfile();assert.equal(p.runs.length,30);assert.equal(p.counters['kills'],3);assert.equal(p.counters['runs'],32);
});

test('startup rejects corrupt or incompatible recovery data before writing the profile',async()=>{
  for(const broken of ['{',JSON.stringify({ticket:{id:'local-old',seed:1,boosts:[]},save:'{}',hash:'bad'})]) {
    const storage=new Map<string,string>(),b=backend(storage);await b.loadProfile();storage.set('pb.runauto.local-sandbox',broken);const before=[...storage];
    await assert.rejects(backend(storage).loadProfile());assert.deepEqual([...storage],before);
  }
});

test('Johto profiles unlock their starter and forms while preserving an existing choice',async()=>{
  const storage=new Map<string,string>(),api=backend(storage,undefined,true),fresh=await api.loadProfile();
  assert.equal(fresh.starterJ,152);
  assert.ok(Array.isArray(fresh.johtoForms)&&fresh.johtoForms.includes(155));
  fresh.starterJ=155;fresh.lastSpecies=150;fresh.counters['kills']=23;
  storage.set('pokebonk.local.profile.v1',JSON.stringify(fresh));
  const restored=await backend(storage,undefined,true).loadProfile();
  assert.equal(restored.starterJ,155);assert.equal(restored.lastSpecies,150);assert.equal(restored.counters['kills'],23);
  for(const invalid of [{starterJ:'155'},{johtoForms:['152']}]){
    const raw=JSON.stringify(invalid),bad=new Map([['pokebonk.local.profile.v1',raw]]);
    await assert.rejects(backend(bad,undefined,true).loadProfile());
    assert.equal(bad.get('pokebonk.local.profile.v1'),raw);
  }
});
