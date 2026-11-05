// Storage is untrusted even though all writes stay on this device. Preserve
// unknown upstream fields while validating every field this adapter consumes.
function localObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid local profile object');
  return value as Record<string, unknown>;
}
function localString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid local profile string');
  return value;
}
function localNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid local profile number');
  return value;
}
function localList<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Invalid local profile array');
  return value.map(parse);
}

// A normal-progression save is separate from the earlier unlock-all sandbox.
const PROFILE_KEY = 'pokebonk.local.profile.v2';
// Stardust awarded for a finished run: participation, effort and a victory bonus.
const RUN_DUST = { base: 12, kill: 1.5, level: 6, victory: 180 };
const BONK_PER_BOSS = 1;
const TASK_SLOTS = 3;
const STREAK_SLOT = 3;
const STREAK_DUST = 50;
const STREAK_DUST_CAP = 5;
const BAG_CAP = 9;
const SHOP_PRICE_STEP = 0.5;
// Mirrors the upstream season day counter used by the shop's daily limit.
const dayNow = () => Math.floor((Date.now() - __EPOCH__) / 86400000) + 1;

function localTicket(value:unknown):LocalRunTicket {  const ticket=localObject(value),id=localString(ticket['id']),seed=localNumber(ticket['seed']);
  if(!id.startsWith('local-')||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid local run ticket');
  return {id,seed,ranked:false,boosts:localList(ticket['boosts'],entry=>entry)};
}
function localResult(value:unknown):LocalRunResult {
  const result=localObject(value);
  if(result['victory']!==undefined&&typeof result['victory']!=='boolean')throw new Error('Invalid local run victory');
  if(result['progress']===undefined)return {...result};
  const progress=localObject(result['progress']);
  const counters=Object.fromEntries(Object.entries(localObject(progress['counters']??{})).map(([key,value])=>{
    const count=localNumber(value);if(count<0)throw new Error('Invalid local run counter');return [key,count];
  }));
  const ids=(key:string)=>localList(progress[key]??[],localNumber);
  return {...result,progress:{...progress,counters,seen:ids('seen'),forms:ids('forms'),league:ids('league'),shinies:ids('shinies'),classics:ids('classics')}};
}

// Injected into the pinned game module; all state and results stay local.
class LocalSandboxBackend implements LocalBackendContract {
  kind = 'local';
  clockSkew = 0;
  current: LocalReadyProfile | null = null;
  get profile(): LocalReadyProfile {
    if (!this.current) throw new Error("Load the local profile before changing it.");
    return this.current;
  }
  account = { id: 'local-sandbox', name: 'Pokebonk', guest: false };

  season() { return __SEASON__(Date.now()); }
  events() { return __EVENTS__.filter(event => Date.parse(event.start) <= Date.now() && Date.parse(event.end) > Date.now()).map(event => ({ ...event, live: true, start: Date.parse(event.start), end: Date.parse(event.end) })); }
  async status() {
    return { maintenance: { on: false }, registration: { inviteOnly: false }, season: this.season(), events: this.events() };
  }
  async restore() { document.title = 'Pokebonk'; return this.account; }
  async guest() { return this.account; }
  guestSave() { return true; }
  async logout() { throw new Error('Local sandbox: no online account is connected.'); }

  // A fresh profile: only the offline marker and the period refresh are applied.
  // Everything else is earned through play, unlike the unlock-all sandbox.
  prepare(profile: LocalProfile): LocalReadyProfile {
    profile.localSandbox = true;
    __REFRESH__(profile, Date.now());
    if (!profile.daily || !profile.weekly) throw new Error('Invalid refreshed task periods');
    return profile as LocalReadyProfile;
  }
  async persist(profile: unknown = this.profile) {
    const next = this.prepare(this.normalize(structuredClone(profile)));
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    this.current = next;
    return structuredClone(next);
  }
  normalize(value: unknown): LocalProfile {
    const defaults = localObject(__PROFILE__('Local Sandbox'));
    const saved = value === null ? {} : localObject(value);
    const merged = {...defaults, ...saved};
    const numbers = (key: string) => localList(merged[key] ?? [], localNumber);
    const strings = (key: string) => localList(merged[key] ?? [], localString);
    const counts = (key: string) => Object.fromEntries(Object.entries(localObject(merged[key] ?? {})).map(([k,v]) => [k,localNumber(v)]));
    const wins=counts('wins');
    if(Object.values(wins).some(mask=>!Number.isInteger(mask)||mask<0||mask>0x7fffffff))throw new Error('Invalid local profile victory mask');
    const profile: LocalProfile = {
      ...merged,
      settings: {...localObject(defaults['settings'] ?? {}), ...localObject(saved['settings'] ?? {})},
      league:numbers('league'),unlocked:numbers('unlocked'),seen:numbers('seen'),forms:numbers('forms'),shinies:numbers('shinies'),classics:numbers('classics'),
      research:counts('research'),lab:counts('lab'),biomes:counts('biomes'),bag:counts('bag'),medals:counts('medals'),quests:counts('quests'),counters:counts('counters'),wins,captured:counts('captured'),
      treasures:Object.fromEntries(Object.entries(localObject(merged['treasures']??{})).map(([id,value])=>{
        const wheel=localObject(value);
        return [id,{...wheel,won:localList(wheel['won']??[],localString)}];
      })),
      cosmetics:strings('cosmetics'),itemsOff:strings('itemsOff'),itemsOwned:strings('itemsOwned'),
      runs:localList(merged['runs'] ?? [], entry => {const run=localObject(entry);return {...run,id:localString(run['id'])};}),
      stardust:localNumber(merged['stardust'] ?? 0),totalStardust:localNumber(merged['totalStardust'] ?? 0),
    };
    for (const key of ['starter','lastSpecies'] as const) if (merged[key] !== undefined) profile[key] = localNumber(merged[key]);
    for (const key of ['daily','weekly'] as const) if (merged[key] !== undefined) {
      const period=localObject(merged[key]);
      profile[key]={...period,ids:localList(period['ids'],localString),prog:localList(period['prog'] ?? [],localNumber),claimed:localList(period['claimed'] ?? [],localNumber)};
    }
    profile.bonk = localNumber(merged['bonk'] ?? 0);
    if (merged['shop'] !== undefined) {
      const shop = localObject(merged['shop']);
      profile.shop = {
        day: localNumber(shop['day']),
        n: Object.fromEntries(Object.entries(localObject(shop['n'] ?? {})).map(([key, value]) => [key, localNumber(value)])),
      };
    }
    if (merged['dailyStreak'] !== undefined) {
      const streak = localObject(merged['dailyStreak']);
      profile.dailyStreak = { last: localNumber(streak['last']), n: localNumber(streak['n']) };
    }
    // A new device/profile starts completely locked: no Pokémon, research, items,
    // cosmetics or currency are pre-unlocked. Progress is earned through play.
    const isNew = !saved || Object.keys(saved).length === 0;
    if (isNew) {
      profile.league = []; profile.unlocked = []; profile.seen = []; profile.forms = [];
      profile.shinies = []; profile.classics = []; profile.research = {}; profile.lab = {};
      profile.biomes = {}; profile.bag = {}; profile.cosmetics = []; profile.itemsOff = [];
      profile.itemsOwned = []; profile.quests = {}; profile.counters = {}; profile.wins = {};
      profile.captured = {}; profile.treasures = {}; profile.runs = [];
      profile.stardust = 0; profile.totalStardust = 0; profile.bonk = 0; profile.medals = {};
      delete profile.starter; delete profile.lastSpecies;
    }
    return profile;
  }
  async loadProfile() {
    const raw = localStorage.getItem(PROFILE_KEY);
    this.current = this.prepare(this.normalize(raw ? JSON.parse(raw) : null));
    // Reject damaged recovery envelopes before startup exposes a playable
    // profile that could overwrite the previous run's checkpoint.
    await this.savedBlob('runsave');await this.savedBlob('runauto');
    await this.persist();
    // Reconcile a completed settlement whose process stopped before cleanup.
    // Never offer an already-awarded manual save again on the next startup.
    const settled=new Set([...this.settledIds(),...this.profile.runs.map(run=>run.id)]);
    for(const key of this.runKeys()) {
      const raw=localStorage.getItem(key);
      if(raw!==null) {
        const id=localString(localObject(localObject(JSON.parse(raw))['ticket'])['id']);
        if(settled.has(id))this.clearRun(id);
      }
    }
    return structuredClone(this.current);
  }
  async savePrefs(_account: unknown, profile: unknown) {
    if(!this.activeTicket) { await this.persist(profile);return; }
    // Match the upstream prefs endpoint: in-run progress belongs to settlement,
    // even when Meta passes its complete, already-mutated in-memory profile.
    const input=localObject(profile),next={...this.profile};
    for(const key of ['settings','lastSpecies','lastBiome','avatar','frame','title','banner','skins','team'])if(key in input)next[key]=input[key];
    await this.persist(next);
  }
  async chooseStarter(_account: unknown, species: number) {
    const family = __REGISTRY__.get(species).family ?? __REGISTRY__.root(species).id;
    this.profile.starter = species;
    this.profile.lastSpecies = species;
    if (!this.profile.league.includes(species)) this.profile.league.push(species);
    if (!this.profile.unlocked.includes(family)) this.profile.unlocked.push(family);
    if (!this.profile.seen.includes(species)) this.profile.seen.push(species);
    if (!(family in this.profile.captured)) this.profile.captured[family] = Date.now();
    return this.persist();
  }
  async startRun(_account: unknown, config: LocalRunConfig): Promise<LocalRunTicket> {
    const ticket = { id: 'local-' + crypto.randomUUID(), seed: new DataView(crypto.getRandomValues(new Uint8Array(4)).buffer).getUint32(0,true), ranked: false, boosts: config.boosts || [] };
    // Carried preparations leave the bag when the run starts, as upstream does.
    for (const boost of ticket.boosts) {
      const key = localString(boost), count = (this.profile.bag[key] ?? 0) - 1;
      if (count > 0) this.profile.bag[key] = count; else delete this.profile.bag[key];
    }
    this.activeTicket=ticket.id;
    return ticket;
  }
  // Cloud/stash callbacks are optional upstream capabilities. The game's local
  // plans and presets remain authoritative; never claim to upload their data.
  stashGet = undefined;
  stashPut = undefined;
  savedOnServer = undefined;
  downloadSave = undefined;
  async uploadSave() { return false; }
  activeTicket: string | null = null;
  checkpoint() {}
  async savedBlob(kind: 'runsave'|'runauto', ticket?: LocalRunTicket, hash?: string) {
    const raw=localStorage.getItem(`pb.${kind}.${this.account.id}`);
    if(raw===null)return null;
    const blob=localObject(JSON.parse(raw));
    const savedTicket=localTicket(blob['ticket']);
    const id=savedTicket.id;
    if(this.settledIds().includes(id)||this.profile.runs.some(run=>run.id===id))return null;
    const save=localString(blob['save']),storedHash=localString(blob['hash']);
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(save)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if(!id.startsWith('local-')||storedHash!==digest||(ticket&&id!==ticket.id)||(hash&&hash!==digest))throw new Error('Invalid local run save identity or hash');
    const body=localObject(JSON.parse(save));
    if(body['v']!==1)throw new Error('Unsupported local run save version');
    localObject(body['cfg']);localObject(body['summary']);const result=localResult(body['result']);
    return {id,hash:digest,result};
  }
  settledIds() { return localList(this.profile['localSettledRuns']??[],localString); }
  async suspendRun(_account: unknown,ticket: LocalRunTicket,hash: string) {
    const saved=await this.savedBlob('runsave',ticket,hash);
    if(!saved)throw new Error('Missing local run save');
    this.keepLive(null,ticket,saved.result);
    this.activeTicket=null;
  }
  async resumeRun(_account: unknown,ticket: LocalRunTicket,hash: string) {
    if(!await this.savedBlob('runsave',ticket,hash))throw new Error('Missing local run save');
    this.activeTicket=ticket.id;
  }
  async recoverRun(_account: unknown,ticket: LocalRunTicket,hash: string) {
    if(!await this.savedBlob('runauto',ticket,hash))throw new Error('Missing local autosave');
    this.activeTicket=ticket.id;
  }
  async autoWaiting() {
    const saved=await this.savedBlob('runauto');
    if(!saved||saved.id===this.activeTicket)return false;
    const raw=localStorage.getItem('pokebonk.local.pending.v1');
    if(!raw)return false;
    const pending=localObject(JSON.parse(raw));
    return localObject(pending['ticket'])['id']===saved.id;
  }
  keepLive(_account: unknown, ticket: LocalRunTicket, result: LocalRunResult) {
    localStorage.setItem('pokebonk.local.pending.v1', JSON.stringify({ ticket:localTicket(ticket), result:localResult(result) }));
  }
  hasPending() { return localStorage.getItem('pokebonk.local.pending.v1')!==null; }
  async retryNow() {
    const raw=localStorage.getItem('pokebonk.local.pending.v1');
    if(!raw)return {left:0,saved:0};
    const pending=localObject(JSON.parse(raw)),ticket=localTicket(pending['ticket']);
    const id=ticket.id;
    if(id===this.activeTicket||await this.savedBlob('runsave')||await this.savedBlob('runauto'))return {left:1,saved:0};
    const already=this.settledIds().includes(id);
    await this.finishRun(null,ticket,localResult(pending['result']));
    return {left:0,saved:already?0:1};
  }
  async finishRun(_account: unknown, ticket: LocalRunTicket, result: LocalRunResult) {
    ticket=localTicket(ticket);result=localResult(result);
    // The settlement ID and updated progress share one atomic localStorage
    // write. A crash during subsequent cleanup can only retry the same ID.
    const profile = structuredClone(this.profile);
    const settled=this.settledIds();
    const previous=profile.runs.find(record=>record.id===ticket.id);
    if(settled.includes(ticket.id)||previous) {
      this.clearRun(ticket.id);
      this.activeTicket=null;
      return {profile:structuredClone(profile),record:previous??{id:ticket.id},ranked:false,stardust:0,local:true};
    }
    const progress = result.progress || {};
    for (const [key, value] of Object.entries(progress.counters || {})) profile.counters[key] = (profile.counters[key] || 0) + value;
    profile.counters['runs'] = (profile.counters['runs'] || 0) + 1;
    for (const key of ['seen', 'forms', 'league', 'shinies', 'classics'] as const) profile[key] = [...new Set([...(profile[key] || []), ...(progress[key] || [])])];
    for (const [family, value] of Object.entries(progress.research || {})) profile.research[family] = (profile.research[family] || 0) + value;
    // A captured League member also unlocks its evolution family and look.
    for (const member of progress.league || []) {
      const family = __REGISTRY__.get(member).family ?? __REGISTRY__.root(member).id;
      if (!profile.unlocked.includes(family)) profile.unlocked.push(family);
      if (!(family in profile.captured)) profile.captured[family] = Date.now();
    }
    this.awardMedals(profile, result);
    const record = { ...result, id: ticket.id, date: Date.now(), seed: ticket.seed, ranked: false, score: __SCORE__(result) };
    delete record.progress;
    profile.runs = [record, ...profile.runs].slice(0, 30);
    if (result.victory) {
      profile.counters['wins'] = (profile.counters['wins'] || 0) + 1;
    }
    const stardust = this.runReward(result);
    if (stardust > 0) {
      profile.stardust += stardust;
      profile.totalStardust += stardust;
    }
    const bonk = (progress.counters?.['bonkBoss'] || 0) * BONK_PER_BOSS;
    if (bonk > 0) profile.bonk = (profile.bonk || 0) + bonk;
    profile['localSettledRuns']=[...settled,ticket.id];
    const persisted=await this.persist(profile);
    this.clearRun(ticket.id);
    this.activeTicket=null;
    return { profile: persisted, record, ranked: false, stardust, local: true };
  }
  private runReward(result: LocalRunResult) {
    const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
    return Math.round(
      RUN_DUST.base
      + number(result['kills']) * RUN_DUST.kill
      + number(result['level']) * RUN_DUST.level
      + (result.victory ? RUN_DUST.victory : 0),
    );
  }
  // Beating a region difficulty earns its medal; clearing all three earns the
  // champion rank, which is what the `@champ` achievements count.
  private awardMedals(profile: LocalProfile, result: LocalRunResult) {
    const biome = result['biome'], tier = result['tier'];
    if (!result.victory || typeof biome !== 'string' || !Number.isFinite(tier)) return;
    if (!__BIOMES__.some(entry => entry.id === biome) || !Number.isInteger(tier) || (tier as number) < 0 || (tier as number) > 2) return;
    const key = `${biome}-${tier}`;
    profile.medals[key] = Math.max(profile.medals[key] ?? 0, (tier as number) + 1);
    if ([0, 1, 2].every(level => (profile.medals[`${biome}-${level}`] ?? 0) >= 3)) {
      for (const level of [0, 1, 2]) profile.medals[`${biome}-${level}`] = Math.max(profile.medals[`${biome}-${level}`] ?? 0, __MEDALS__);
    }
  }
  runKeys() {return ['pokebonk.local.pending.v1',`pb.runauto.${this.account.id}`,`pb.runsave.${this.account.id}`];}
  clearRun(id:string) {
    for(const key of this.runKeys()) {
      const raw=localStorage.getItem(key);
      if(raw!==null&&localObject(localObject(JSON.parse(raw))['ticket'])['id']===id)localStorage.removeItem(key);
    }
  }
  async actions(_account: unknown, actions: LocalProfileAction[]) {
    for (const action of actions) {
      if (action.k === 'archive') {
        const disabled = new Set(this.profile.itemsOff);
        action.off ? disabled.add(action.key) : disabled.delete(action.key);
        this.profile.itemsOff = [...disabled];
      }
      if (action.k === 'quest') this.claimAchievement(action.id);
      if (action.k === 'task') this.applyTaskClaim(action.period, action.slot);
      if (action.k === 'lab') this.buyLabUpgrade(action.id, action.lv);
      if (action.k === 'item') this.applyItemPurchase(action.key);
      if (action.k === 'shop') this.buyShopItem(action.id, action.n);
    }
    return this.persist();
  }
  // The client checks affordability against its own copy and then sends the
  // action without the deducted balance, so every price is re-derived here
  // from the bundled catalogs before the profile is stored.
  private claimAchievement(id: string) {
    const quest = __QUESTS__.find(entry => entry.id === id);
    if (!quest || this.profile.quests[id]) return;
    this.profile.quests[id] = 1;
    this.profile.stardust += quest.reward;
    this.profile.totalStardust += quest.reward;
    const title = `title:q:${quest.id}`;
    if (quest.title && !this.profile.cosmetics.includes(title)) this.profile.cosmetics.push(title);
    const look = quest.look && `look:${quest.look.member}:${quest.look.n}`;
    if (look && !this.profile.cosmetics.includes(look)) this.profile.cosmetics.push(look);
  }
  private applyTaskClaim(period: 'daily' | 'weekly', slot: number) {
    const tasks = this.profile[period];
    if (!tasks || !Number.isInteger(slot) || slot < 0 || slot > STREAK_SLOT || tasks.claimed[slot]) return;
    if (slot === STREAK_SLOT) {
      if (![0, 1, 2].every(index => tasks.claimed[index])) return;
      const day = this.tasksDay(tasks);
      const streak = this.profile.dailyStreak;
      const run = streak?.last === day - 1 ? streak.n + 1 : 1;
      if (period === 'daily') this.profile.dailyStreak = { last: day, n: run };
      this.grantTaskReward(period, slot, Math.round(STREAK_DUST * Math.min(STREAK_DUST_CAP, run)));
      return;
    }
    const task = tasks.ids[slot] && __TASK__(tasks.ids[slot]);
    if (!task || (tasks.prog[slot] ?? 0) < task.goal) return;
    this.profile.counters['tasks'] = (this.profile.counters['tasks'] ?? 0) + 1;
    this.grantTaskReward(period, slot, __DUST__[period][slot] ?? 0);
  }
  private tasksDay(tasks: LocalPeriodTasks) {
    return Number.isFinite(tasks.idx) ? (tasks.idx as number) : dayNow();
  }
  private grantTaskReward(period: 'daily' | 'weekly', slot: number, dust: number) {
    const tasks = this.profile[period];
    if (!tasks) return;
    tasks.claimed[slot] = 1;
    this.profile.stardust += dust;
    this.profile.totalStardust += dust;
    if (slot !== STREAK_SLOT) return;
    const item = __PREPARATIONS__[this.tasksDay(tasks) % Math.max(1, __PREPARATIONS__.length)];
    if (!item) return;
    const count = period === 'weekly' ? 2 : 1;
    this.profile.bag[item] = Math.min(BAG_CAP, (this.profile.bag[item] ?? 0) + count);
  }
  private buyLabUpgrade(id: string, level: number) {
    const upgrade = __LAB__.find(entry => entry.id === id);
    const current = this.profile.lab[id] ?? 0;
    if (!upgrade || level !== current || current >= upgrade.max) return;
    const cost = upgrade.cost(current);
    if (!Number.isFinite(cost) || this.profile.stardust < cost) return;
    this.profile.stardust -= cost;
    this.profile.lab[id] = current + 1;
  }
  private applyItemPurchase(key: string) {
    const item = __ITEMS__.find(entry => entry.key === key);
    if (!item || this.profile.itemsOwned.includes(key) || this.profile.stardust < item.price) return;
    this.profile.stardust -= item.price;
    this.profile.itemsOwned.push(key);
  }
  private buyShopItem(id: string, bought: number) {
    const entry = __SHOP__.find(item => item.id === id);
    if (!entry) return;
    const day = dayNow();
    const today = this.profile.shop?.day === day ? this.profile.shop.n : {};
    const count = today[id] ?? 0;
    if (count !== bought || count >= entry.daily || (this.profile.bag[id] ?? 0) >= BAG_CAP) return;
    const price = Math.round(entry.price * (1 + SHOP_PRICE_STEP * count));
    if (this.profile.stardust < price) return;
    this.profile.stardust -= price;
    this.profile.bag[id] = (this.profile.bag[id] ?? 0) + 1;
    this.profile.shop = { day, n: { ...today, [id]: count + 1 } };
  }
  async spinTreasure(_account: unknown, wheel: string, spin: number, _key: string) {
    const entry = __TREASURES__.find(item => item.id === wheel);
    if (!entry) throw new Error('Unknown treasure wheel');
    const won = this.profile.treasures[wheel]?.won ?? [];
    const prizes = entry.prizes.filter(prize => !won.includes(prize.id));
    const available = entry.prizes.length - prizes.length;
    if (!prizes.length || spin !== available) throw new Error('This treasure wheel is already complete');
    const cost = __SPIN__;
    if ((this.profile.bonk ?? 0) < cost) throw new Error('Not enough Bonkoins');
    const prize = prizes[Math.floor(Math.random() * prizes.length)]!;
    this.profile.bonk = (this.profile.bonk ?? 0) - cost;
    this.profile.treasures[wheel] = { ...this.profile.treasures[wheel], won: [...won, prize.id] };
    for (const cosmetic of prize.cosmetics) {
      if (!this.profile.cosmetics.includes(cosmetic)) this.profile.cosmetics.push(cosmetic);
    }
    const profile = await this.persist();
    return { profile, spin: { prize: prize.id } };
  }
  async buyLab(account: unknown, id: string) { return this.actions(account, [{ k: 'lab', id, lv: this.profile.lab[id] ?? 0 }]); }
  async buyItem(account: unknown, key: string) { return this.actions(account, [{ k: 'item', key }]); }
  async buyShop(account: unknown, id: string, n: number) { return this.actions(account, [{ k: 'shop', id, n }]); }
  async archiveItem(account: unknown, key: string, off: boolean) { return this.actions(account, [{ k: 'archive', key, off }]); }
  async claimQuest(account: unknown, id: string) { return this.actions(account, [{ k: 'quest', id }]); }
  async claimTask(account: unknown, period: 'daily'|'weekly', slot: number) { return this.actions(account, [{ k: 'task', period, slot }]); }
  async records() { return { records: [], best: {}, times: {}, kills: {} }; }
  async endlessRecords() { return { records: [], best: {} }; }
  async board() { return { entries: [], me: null, players: 0, cutoff: null, info: this.season() }; }
  async monBoards() { return []; }
  async seasonAwards() { return []; }
  async news() { return []; }
  async mail() { return []; }
  async readMail() {}
  async clanStatus() { return { clan: null, mail: 0, requests: 0, pending: [] }; }
  async friends() { return { friends: [], incoming: [], outgoing: [] }; }
  async coopInvites() { return []; }
  async eventView() { return { entries: [], quests: [], track: [], me: null }; }
}

function createLocalSandboxBackend() {
  const backend = new LocalSandboxBackend();
  return new Proxy(backend, {
    get(target, key, receiver): unknown {
      if (key in target || typeof key !== 'string' || key === 'then') return Reflect.get(target, key, receiver);
      if (key.startsWith('on')) return undefined;
      return async () => { throw new Error('This online feature is unavailable in the local sandbox.'); };
    },
  });
}
