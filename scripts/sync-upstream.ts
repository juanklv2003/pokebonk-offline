import {treasureAssetPaths} from './treasure-catalog.ts';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ast, nodes, nodesOf, literal, maybeName, nameOf, requireNode } from './source.ts';
import { inspectGame } from './patch-game.ts';
import {gameModules} from './game-modules.ts';
import {inspectReleaseIcons} from './release-icons.ts';
import { inspectIconCatalogs } from './catalog-icons.ts';
import {inspectItemIcons} from './item-icons.ts';
import {inspectMutationAssets} from './mutation-assets.ts';
import {inspectAnimatedSprites} from './sprite-assets.ts';
import {requestUpstream} from './upstream-request.ts';
import {versionForBuild} from './upstream-version.ts';
import {writeSnapshot,snapshotDirectory} from './upstream-snapshot.ts';
import {readResourceContract,assertReviewedInputs,assertRequiredResources} from './resource-contract.ts';

import {record, text as textValue, finite, list, isRecord, objectArray} from '../types/data.ts';

const origin = 'https://pokebonk.com';
const output = path.resolve(process.argv[2] ?? 'cache/upstream-candidate');
const accepted=path.resolve(snapshotDirectory);
if(output===accepted||output.startsWith(accepted+path.sep))throw new Error('Collect into a candidate directory; promotion requires validation');
let cache = path.resolve('cache/upstream');
const files = new Map<string, Buffer>();
const missing: string[] = [];
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
await mkdir(cache, { recursive: true });

async function cacheBytes(file:string,bytes:string|Buffer) {
  // A failed or interrupted run may checkpoint this directory. Readers only
  // use the final URL-hash name, never an incomplete temporary write.
  const temporary=file+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,bytes,{flag:'wx'});
  await rename(temporary,file);
}

async function download(resource: string, optional = false): Promise<Buffer | null> {
  const url = new URL(resource, origin);
  if (url.origin !== origin || url.pathname.includes('..') || !/^\/[\w./-]+$/.test(url.pathname)) throw new Error(`Invalid static URL: ${url}`);
  const key = url.pathname.slice(1);
  const existing = files.get(key);
  if (existing) return existing;
  const cached = path.join(cache, sha(url.href));
  if (optional) {
    try { await readFile(cached + '.missing'); missing.push(key); return null; } catch {}
  }
  let bytes;
  let downloaded=false;
  try { bytes = await readFile(cached); } catch {
    const response = await requestUpstream(url,{maxBytes:32*1024*1024});
    if (response.status === 404 && optional) { await cacheBytes(cached + '.missing', '404'); missing.push(key); return null; }
    if (!response.ok) throw new Error(`Static download ${response.status}: ${url}`);
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > 32 * 1024 * 1024) throw new Error(`Asset too large: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 32 * 1024 * 1024) throw new Error(`Asset too large: ${url}`);
    downloaded=true;
  }
  if (!bytes) throw new Error(`No bytes downloaded: ${url}`);
  if (/\.(png|jpg|glb|ogg|woff2?)$/.test(key) && bytes.subarray(0, 100).toString().includes('<!doctype html')) {
    if (optional) { missing.push(key); return null; }
    throw new Error(`HTML returned for binary asset: ${key}`);
  }
  if(downloaded)await cacheBytes(cached,bytes);
  files.set(key, bytes);
  if (files.size % 100 === 0) console.log(`Collected ${files.size} files (${key})`);
  return bytes;
}

async function required(resource: string): Promise<Buffer> {
  const data = await download(resource);
  if (!data) throw new Error(`Missing required resource: ${resource}`);
  return data;
}
function contents(key: string): string {
  const data = files.get(key);
  if (!data) throw new Error(`Missing collected resource: ${key}`);
  return data.toString();
}
const html = (await required('/index.html?offline-check=' + Date.now())).toString();
const buildId = html.match(/name="pokebonk-build" content="([\w-]+)"/)?.[1];
if (!buildId) throw new Error('Unsupported upstream index: no build identifier');
if(process.env['EXPECTED_BUILD']&&buildId!==process.env['EXPECTED_BUILD'])throw new Error('Upstream changed before snapshot collection');
cache=path.join(cache,buildId);await mkdir(cache,{recursive:true});
console.log(`Collecting upstream ${buildId}`);
// Follow Vite's module graph, CSS URLs, and HTML assets, including lazy language modules.
const pending = new Set<string>();
function discover(text: string, parent: string) {
  const pattern = /["'`(]((?:\.?\.?\/|\/assets\/|\/icons\/)[A-Za-z0-9_./-]+\.(?:js|css|png|svg|webp|woff2?|ico|webmanifest))(?:["'`)\s?])/g;
  for (const match of text.matchAll(pattern)) {
    const url = new URL(textValue(match[1]), new URL(parent, origin));
    if (url.origin === origin) pending.add(url.pathname);
  }
}
discover(html, '/index.html');
discover((await required('/legal.html')).toString(),'/legal.html');
for (;;) {
  const batch = [...pending].filter(key => !files.has(key.slice(1))).slice(0,8);
  if (!batch.length) break;
  const downloaded = await Promise.all(batch.map(async key=>({key,data:await required(key)})));
  for(const {key,data} of downloaded)if (/\.(js|css|webmanifest)$/.test(key)) discover(data.toString(), key);
}
const modules=gameModules(files),main=modules.main.source,config=modules.config.source,menus=modules.menus.source;
const info = inspectGame(main, config,menus);
const version = versionForBuild(info.configTree,buildId);
if (!version) throw new Error('Game/config build mismatch');
const resourceContract=await readResourceContract();
// Compare every input after collection too: data catalogs are fetched below.
if(buildId!==resourceContract.upstreamBuild)throw new Error('Unreviewed upstream resource inputs: build changed; see docs/resource-completeness.md');
const resourceVersion = (key: string) => {
  const relative = key.replace(/^assets\//, '');
  const parts = relative.split('/');
  const group = relative.startsWith('data/') ? relative : parts.slice(0, Math.min(2, parts.length - 1)).join('/');
  return info.versions[group] ?? buildId;
};
const assets = new Map<string, boolean>();
const add = (key: string, optional = false) => {
  if (!/^[\w./-]+\.(png|jpg|json|glb|ogg|svg|webp)$/.test(key) || key.includes('..')) throw new Error(`Invalid catalog path: ${key}`);
  assets.set(key, assets.has(key) ? (assets.get(key) ?? false) && optional : optional);
};
for (const key of Object.keys(info.versions).filter(key => key.startsWith('data/'))) add(key);
for (const key of ['pokemon','moves','learnsets','abilities','types','items','sprites']) add(`data/${key}.json`);
async function collect() {
  const queue = [...assets].filter(([key]) => !files.has(key));
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < queue.length) {
      const next = queue[cursor++];
      if (!next) break;
      const [key, optional] = next;
      await download(`/${key}?v=${resourceVersion(key)}`, optional);
    }
  }));
}
await collect();
const pokemon = list(JSON.parse(contents('data/pokemon.json')), value => {const mon=record(value);return {id:finite(mon['id']),types:list(mon['types'],textValue)};});
const sprites = record(JSON.parse(contents('data/sprites.json')));
const itemData = record(JSON.parse(contents('data/items.json')));
const species = pokemon.filter(mon => mon.id <= info.season.maxDex || mon.id === 201).map(mon => mon.id);
for (const id of species) {
  for (const category of ['pmd','portraits','icons','cries']) add(`assets/${category}/${id}.${category === 'cries' ? 'ogg' : 'png'}`);
  for (const category of ['pmd-shiny','portraits-shiny','front']) add(`assets/${category}/${id}.png`, true);
  const sprite = sprites[id];
  if (isRecord(sprite) && sprite['fallback']) add('assets/' + textValue(sprite['fallback']));
}
for(const key of inspectAnimatedSprites(sprites))add(key);
const itemIcons=inspectItemIcons(config,itemData);
const requiredItems=new Set(itemIcons);
for(const item of Object.values(itemData))if(isRecord(item)&&item['icon']) {
  const key='assets/'+textValue(item['icon']);
  add(key,!requiredItems.has(key));
}
for(const key of itemIcons)add(key);
for(const key of inspectMutationAssets(config))add(key);
for(const key of treasureAssetPaths(config))add(key);
for (const region of Object.keys(info.versions).filter(key => key.startsWith('env/'))) {
  for (const name of region === 'env/common' ? ['atlas.json','atlas.png'] : ['atlas.json','atlas.png','ground.png','cliff.png','path.png']) add(`assets/${region}/${name}`);
}
const allTrees = [ast(main), ast(config),...(menus===main?[]:[info.tree])];
const strings = allTrees.flatMap(tree => nodes(tree, n => typeof literal(n) === 'string').map(literal).filter((value): value is string => typeof value === 'string'));
for (const value of strings) {
  if (/^(?:tower|halloween|desert|glacier|coast|ruins?|storm|frost|sanct)_[a-z_]+$/.test(value)) add(`assets/models/${value}.glb`, true);
  if (/^(?:env|ui|items|models|music|portraits|pmd)\/[\w./-]+\.(png|jpg|glb|ogg|json)$/.test(value)) add('assets/' + value);
  if (/^(tr|frame|bg|sym|deco):[\w-]+$/.test(value)) {
    const [kind, id] = value.split(':');
    const dir = new Map([['tr','ui/avatars'],['frame','ui/frames'],['bg','ui/banners'],['sym','ui/clan/sym'],['deco','ui/clan/deco']]).get(kind ?? '');
    add(`assets/${dir}/${id}.${kind==='bg'?'jpg':'png'}`, true);
  }
}
// Catalog-driven cosmetics and every literal icon/model call. Missing candidates are
// recorded; gameplay-required atlas, sprite, item and data files are mandatory above.
for (const value of Object.values(info.values)) if (objectArray(value)) for (const entry of value) {
  if (entry['id'] && entry['how'] && !entry['kind'] && typeof entry['id'] === 'string') {
    for (const dir of ['ui/avatars','ui/frames','ui/clan/sym','ui/clan/deco']) add(`assets/${dir}/${entry['id']}.png`, true);
  }
  if (typeof entry['style'] === 'string' && entry['style']) add(`assets/ui/frames/look-${entry['style']}.png`, true);
}
const {iconFunction,appIconFunction,statusIcons,reactionIcons}=inspectIconCatalogs(main,config,menus);
for(const key of [...statusIcons,...reactionIcons,...inspectReleaseIcons(menus)])add(key);
for (const tree of allTrees) {
  for (const call of nodesOf(tree, 'CallExpression')) {
    const method = call.callee.type === 'MemberExpression' ? maybeName(call.callee.property) : maybeName(call.callee);
    const words = nodes(call.arguments[0], n => typeof literal(n) === 'string').map(literal).filter((s): s is string => typeof s === 'string' && /^[\w-]+$/.test(s));
    if (method === (tree===allTrees[0]?appIconFunction:iconFunction) && call.arguments[0]?.type !== 'BinaryExpression') words.forEach(s => add(`assets/ui/icons/${s}.png`, true));
    if (method && ['model','place','bu','xu'].includes(method)) words.forEach(s => add(`assets/models/${s}.glb`, true));
  }
  for (const property of nodesOf(tree, 'Property', n => ['model','shrine','portal','gate'].includes(maybeName(n.key) ?? ''))) {
    const value = literal(property.value);
    if (typeof value === 'string' && /^[\w-]+$/.test(value)) add(`assets/models/${value}.glb`, true);
  }
}
// Calls through indirect maps store model names as [name, size].
for (const node of [...new Set([info.tree,info.appTree])].flatMap(tree=>nodesOf(tree, 'ArrayExpression', n => n.elements.length === 2))) {
  const value = literal(node.elements[0]);
  if (typeof value === 'string' && /^[\w-]+$/.test(value) && typeof literal(node.elements[1]) === 'number') add(`assets/models/${value}.glb`, true);
}
for (const name of ['battle1','battle2','battle3','battle4','boss','menu','halloween-menu','halloween-battle','halloween-boss']) add(`assets/music/${name}.ogg`, true);
for (const declaration of [...new Set([info.tree,info.appTree])].flatMap(tree=>nodesOf(tree, 'VariableDeclarator', n => n.init?.type === 'ObjectExpression'))) {
  const properties = requireNode(declaration.init, 'ObjectExpression').properties.filter(p => p.type === 'Property');
  if (properties.some(p => maybeName(p.key) === 'menu') && properties.some(p => maybeName(p.key) === 'ingame1')) {
    for (const property of properties) add(`assets/music/${nameOf(property.key)}.ogg`);
  }
}
for (const type of new Set(pokemon.flatMap(mon=>mon.types))) {
  if (!/^[a-z]+$/.test(type)) throw new Error('Unknown Pokémon type');
  add(`assets/ui/types/${type}.png`);
  add(`assets/items/tm-${type}.png`, true);
}
for (const rank of ['bronze','silver','gold','champion','master','legend','elite','top10','top25','top50','top100']) add(`assets/ui/ranks/${rank}.png`, true);
for (const name of ['ball','freeball','cursedball','unown','boss','portal','shrine','challenge','cursed','cage','rock','shroom','tower','comet','candle','escalera']) add(`assets/ui/icons/map-${name}.png`, true);
console.log(`Downloading ${assets.size} catalog assets`);
for(const key of resourceContract.required)if(!files.has(key))add(key);
await collect();
assertReviewedInputs(files,buildId,resourceContract);
assertRequiredResources(new Set(files.keys()),resourceContract);
const bytes = [...files.values()].reduce((sum, value) => sum + value.length, 0);
if (bytes > 1024 * 1024 * 1024) throw new Error('Payload exceeds 1 GiB budget');
const manifest=await writeSnapshot(output,files,buildId,version,missing);
console.log(`Captured ${files.size} pristine upstream files at ${output} (${manifest.digest})`);
