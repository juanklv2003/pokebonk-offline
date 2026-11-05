import {inspectTreasureCatalog} from './treasure-catalog.ts';
import { ast, nodesOf, one, literal, edits, configContext, nameOf, maybeName, requireNode } from './source.ts';
import {objectArray, record, text, finite, stringMap, isRecord} from '../types/data.ts';
import type {AnyNode} from 'acorn';

export function inspectGame(main: string, config: string, menus=main) {
  const tree = ast(menus),appTree=menus===main?tree:ast(main);
  const { tree: configTree, values } = configContext(config);
  const arrays = Object.entries(values).filter((entry): entry is [string,Record<string,unknown>[]] => objectArray(entry[1]));
  const findArray = (predicate: (value: Record<string,unknown>[]) => boolean, label: string) => one(arrays.filter(([,value])=>predicate(value)),label);
  const [rosterName, rosterRaw] = findArray(v => v.some(x => x['start'] === true) && v.every(x => x['kit'] && x['passive']), 'League roster');
  const roster=rosterRaw.map(x=>({id:finite(x['id'])}));
  const [labName, labRaw] = findArray(v => v.some(x => x['id'] === 'slot-move') && v.every(x => x['max'] && x['cost']), 'Lab catalog');
  const lab=labRaw.map(x=>({id:text(x['id']),max:finite(x['max'])}));
  const [itemsName, itemsRaw] = findArray(v => v.some(x => x['key'] === 'soda-pop') && v.every(x => x['price']), 'shop catalog');
  const items=itemsRaw.map(x=>({key:text(x['key'])}));
  const [biomesName, biomesRaw] = findArray(v => v.some(x => x['id'] === 'forest' && x['size']), 'biome catalog');
  const biomes=biomesRaw.map(x=>({id:text(x['id']),...(x['size']===undefined?{}:{size:finite(x['size'])})}));
  const findObject=(predicate:(v:Record<string,unknown>)=>boolean,label:string)=>one(Object.values(values).filter(isRecord).filter(predicate),label);
  const seasonRaw=findObject(v=>Boolean(v['maxDex']&&v['season']),'generation limit');
  const season={maxDex:finite(seasonRaw['maxDex']),season:finite(seasonRaw['season'])};
  const versions=stringMap(findObject(v=>Boolean(v['data/pokemon.json']&&v['models']&&v['pmd']),'asset versions'));
  const events=(arrays.find(([,v])=>v.some(x=>x['id']==='halloween26'&&x['start']&&x['end']))?.[1]??[]).map(x=>({...x,start:text(x['start']),end:text(x['end'])}));
  const extraImports: {imported:string;local:string}[]=[];
  const alias = (localName: string) => {
    const exported = nameOf(one(nodesOf(configTree,'ExportSpecifier', n => maybeName(n.local) === localName), `export ${localName}`).exported);
    const imports=nodesOf(tree,'ImportSpecifier', n => maybeName(n.imported) === exported);
    if(!imports.length&&menus!==main) {
      const local=`__pokebonkConfig_${localName}`;
      if(nodesOf(tree,'Identifier',n=>n.name===local).length)throw new Error('Unsupported upstream: config binding collision');
      extraImports.push({imported:exported,local});return local;
    }
    return one(imports, `import ${localName}`).local.name;
  };
  const functions = nodesOf(tree,'FunctionDeclaration');
  const profile = nameOf(one(functions.filter(n => {
    const returns = nodesOf(n.body,'ReturnStatement', x => x.argument?.type === 'ObjectExpression');
    return returns.some(r => requireNode(r.argument,'ObjectExpression').properties.some(p => p.type==='Property'&&maybeName(p.key)==='stardust') && ['lab','league','lastSpecies','settings'].every(key=>requireNode(r.argument,'ObjectExpression').properties.some(p=>p.type==='Property'&&maybeName(p.key)===key)));
  }), 'profile factory').id);
  const registry = nameOf(one(nodesOf(tree,'VariableDeclarator', n => {
    if(n.init?.type!=='NewExpression'||n.init.callee.type!=='ClassExpression')return false;
    const members=n.init.callee.body.body;
    const initialized=(field:string,valid:(value:AnyNode|null|undefined)=>boolean)=>members.some(member=>{
      if(member.type==='PropertyDefinition')return !member.static&&!member.computed&&maybeName(member.key)===field&&valid(member.value);
      if(member.type!=='MethodDefinition'||member.kind!=='constructor')return false;
      // Upstream also lowers class fields to helper(this, key, value) calls.
      return nodesOf(member.value.body,'CallExpression',call=>call.callee.type==='Identifier'
        &&call.arguments.length===3&&call.arguments[0]?.type==='ThisExpression'
        &&literal(call.arguments[1])===field&&valid(call.arguments[2])).length>0;
    });
    return initialized('pokemon',value=>value?.type==='ArrayExpression'&&value.elements.length===0)
      &&initialized('movesByKey',value=>value?.type==='NewExpression'&&maybeName(value.callee)==='Map'&&value.arguments.length===0);
  }), 'Pokédex registry').id);
  const backend = one(nodesOf(appTree,'FunctionDeclaration',n => main.slice(n.start, n.end).includes('https://api.pokebonk.com')), 'backend factory');
  const seasonMethod = one(nodesOf(appTree,'MethodDefinition', n => maybeName(n.key) === 'season' && main.slice(n.start, n.end).includes('this.info')), 'season method');
  const seasonBinding = nameOf(one(nodesOf(seasonMethod,'CallExpression', n => n.callee.type === 'Identifier'), 'season calculation').callee);
  const seasonImport=menus===main?undefined:one(nodesOf(appTree,'ImportSpecifier',n=>n.local.name===seasonBinding),'season import');
  let seasonCall=seasonBinding;
  if(seasonImport) {
    const owner=one(nodesOf(appTree,'ImportDeclaration',n=>n.specifiers.includes(seasonImport)),'season import owner');
    const rosterExport=one(nodesOf(configTree,'ExportSpecifier',n=>maybeName(n.local)===rosterName),'roster config export');
    const configOwner=one(nodesOf(tree,'ImportDeclaration',n=>n.specifiers.some(s=>s.type==='ImportSpecifier'&&maybeName(s.imported)===maybeName(rosterExport.exported))),'menu config owner');
    if(literal(owner.source)===literal(configOwner.source)) {
      const binding=one(nodesOf(configTree,'ExportSpecifier',n=>maybeName(n.exported)===maybeName(seasonImport.imported)),'season config export');
      seasonCall=alias(nameOf(binding.local));
    } else {
      const registryExport=one(nodesOf(tree,'ExportSpecifier',n=>maybeName(n.local)===registry),'registry menu export');
      const menuOwner=one(nodesOf(appTree,'ImportDeclaration',n=>n.specifiers.some(s=>s.type==='ImportSpecifier'&&maybeName(s.imported)===maybeName(registryExport.exported))),'application menu owner');
      if(literal(owner.source)!==literal(menuOwner.source))throw new Error('Unsupported upstream: unknown season module');
      seasonCall=nameOf(one(nodesOf(tree,'ExportSpecifier',n=>maybeName(n.exported)===maybeName(seasonImport.imported)),'season menu export').local);
    }
  }
  const scoreDeclaration = one(nodesOf(configTree,'VariableDeclarator', n => n.init?.type === 'ArrowFunctionExpression'
    && config.slice(n.start,n.end).includes('.kills') && config.slice(n.start,n.end).includes('.time')
    && config.slice(n.start,n.end).includes('.victory')), 'run score');
  const score = alias(nameOf(scoreDeclaration.id));
  const looks = one(nodesOf(configTree,'FunctionDeclaration', n => n.params.length === 4
    && ['shiny','spectral','classic','m1','m2'].every(s => nodesOf(n,'SwitchCase', x => literal(x.test) === s).length>0)), 'wardrobe eligibility');
  const claimable = one(nodesOf(tree,'MethodDefinition', n => maybeName(n.key) === 'claimable'), 'achievement claim count');
  const questName = nameOf(requireNode(one(nodesOf(claimable,'CallExpression', n => n.callee.type === 'MemberExpression' && maybeName(n.callee.property) === 'filter' && n.callee.object.type === 'Identifier'), 'achievement catalog reference').callee,'MemberExpression').object);
  const questImport = nameOf(one(nodesOf(tree,'ImportSpecifier', n => n.local.name === questName), 'achievement catalog import').imported);
  const questLocal = nameOf(one(nodesOf(configTree,'ExportSpecifier', n => maybeName(n.exported) === questImport), 'achievement catalog export').local);
  const rawQuests=values[questLocal];
  if(!objectArray(rawQuests))throw new Error('Unsupported achievement catalog');
  const quests=rawQuests.map(q=>{
    try {
      const id=text(q['id']),counter=text(q['counter']),goal=finite(q['goal']),reward=finite(q['reward']);
      if(goal<=0)throw new Error('Invalid goal');
      const look=q['look']===undefined?undefined:record(q['look']);
      return {id,counter,goal,reward,...(q['title']?{title:text(q['title'])}:{}),...(look?{look:{member:finite(look['member']),n:finite(look['n'])}}:{})};
    }catch{throw new Error('Unsupported achievement catalog');}
  });
  if(new Set(quests.map(q=>q.id)).size!==quests.length)throw new Error('Unsupported achievement catalog');
  const progressMethod = one(nodesOf(tree,'MethodDefinition', n => maybeName(n.key) === 'questProgress'), 'achievement progress method');
  const progressName = nameOf(one(nodesOf(progressMethod,'CallExpression', n => n.callee.type === 'Identifier'), 'achievement progress calculation').callee);
  const questProgress = one(functions.filter(n => maybeName(n.id) === progressName && n.params.length === 2), 'achievement progress function');
  const tasksReady = one(nodesOf(tree,'MethodDefinition',n=>maybeName(n.key)==='tasksReady'),'task refresh method');
  const refresh = nameOf(one(nodesOf(tasksReady,'CallExpression',n=>n.callee.type==='Identifier'&&n.arguments.length===2&&n.arguments[0]?.type==='MemberExpression'&&maybeName(n.arguments[0].property)==='profile'),'task refresh function').callee);
  const taskRefresh = one(functions.filter(n=>maybeName(n.id)===refresh&&n.params.length===2),'task refresh calculation');
  const taskMethod = one(nodesOf(tree,'MethodDefinition',n=>maybeName(n.key)==='task'),'task lookup method');
  const task = nameOf(one(nodesOf(taskMethod,'CallExpression',n=>n.callee.type==='Identifier'),'task lookup function').callee);
  const [,medalRanks] = findArray(v=>v.some(x=>x['id']==='champion')&&v.every(x=>x['id']&&x['name']&&x['icon']), 'medal ranks');
  const aliases = { roster:alias(rosterName),lab:alias(labName),items:alias(itemsName),biomes:alias(biomesName),profile,registry,season:seasonCall,score,quests:questName,refresh,task };
  const configImport=extraImports.length?one(nodesOf(tree,'ImportDeclaration',n=>n.specifiers.some(s=>s.type==='ImportSpecifier'&&s.local.name===aliases.roster)),'menu config import'):undefined;
  return {tree,appTree,configTree,values,aliases,backend,looks,roster,lab,items,biomes,season,versions,events,quests,questProgress,medalRanks,taskRefresh,extraImports,configPath:configImport?text(literal(configImport.source)):undefined};
}

export function patchGame(main: string,config: string,template: string,menus?:{source:string;path:string}) {
  const info=inspectGame(main,config,menus?.source);let shim=template;
  for(const [name,value]of Object.entries(info.aliases))shim=shim.replaceAll(`__${name.toUpperCase()}__`,value);
  shim=shim.replaceAll('__EVENTS__',JSON.stringify(info.events)).replaceAll('__MEDALS__',String(info.medalRanks.length));
  const lists=Object.values(info.values).filter(objectArray);
  const cosmetics=[...new Set(lists.flatMap(list=>list.flatMap(entry=>[entry['id'],...(objectArray(entry['prizes'])?entry['prizes'].map(prize=>prize['id']):[])])).filter((id):id is string=>typeof id==='string'&&/^(tr|frame|bg|title|sym|deco|skin):/.test(id)))];
  const preparations=one(lists.filter(value=>value.every(item=>item['id']&&item['desc'])&&value.some(item=>item['id']==='rare-candy')),'preparation catalog').map(item=>text(item['id']));
  shim=shim.replaceAll('__COSMETICS__',JSON.stringify(cosmetics)).replaceAll('__PREPARATIONS__',JSON.stringify(preparations));
  if(shim.includes('__TREASURES__'))shim=shim.replaceAll('__TREASURES__',JSON.stringify(inspectTreasureCatalog(config)));
  const remaining = shim.match(/__[A-Z]+__/g);
  if(remaining) {
    console.error('Unresolved backend template symbols (replaced with null):', [...new Set(remaining)].join(', '));
    shim=shim.replace(/__[A-Z]+__/g,'null');
  }
  const boot=one(nodesOf(info.appTree,'AwaitExpression',n=>n.argument.type==='CallExpression'&&n.argument.callee.type==='MemberExpression'&&maybeName(n.argument.callee.property)==='boot'&&n.argument.callee.object.type==='NewExpression'),'application boot');
  const instanceNode=requireNode(requireNode(boot.argument,'CallExpression').callee,'MemberExpression').object;
  const instance=main.slice(instanceNode.start,instanceNode.end);
  const progressProfile=nameOf(info.questProgress.params[0]),progressQuest=nameOf(info.questProgress.params[1]),taskProfile=nameOf(info.taskRefresh.params[0]);
  const menuEdits=[
    {start:info.taskRefresh.body.end-1,end:info.taskRefresh.body.end-1,text:`if(${taskProfile}.localSandbox)for(const period of ['daily','weekly']){${taskProfile}[period].prog=${taskProfile}[period].ids.map(id=>${info.aliases.task}(id).goal);${taskProfile}[period].claimed=[1,1,1,1];}`},
    {start:info.questProgress.body.start+1,end:info.questProgress.body.start+1,text:`if(${progressProfile}.localSandbox&&${progressProfile}.quests[${progressQuest}.id])return ${progressQuest}.goal;`},
  ];
  const patchedMain=edits(main,[
    ...menus?[]:menuEdits,
    {start:info.backend.start,end:info.backend.end,text:(menus?'':shim)+`\nfunction ${nameOf(info.backend.id)}(){return createLocalSandboxBackend()}`},
    {start:boot.start,end:boot.end,text:`await (window.__pokebonkLocalApp=${instance}).boot()`},
  ]);
  const profile=nameOf(info.looks.params[0]),member=nameOf(info.looks.params[1]);
  const urls=nodesOf(info.configTree,'VariableDeclarator',n=>n.init?.type==='ArrowFunctionExpression'&&n.init.body.type==='TemplateLiteral'&&/assets\/|data\//.test(config.slice(n.init.body.start,n.init.body.end)));
  if(urls.length!==2)throw new Error('Unsupported asset URL factories');
  const patchedConfig=edits(config,[{start:info.looks.body.start+1,end:info.looks.body.start+1,text:`if(${profile}.localSandbox&&${profile}.league.includes(${member}))return true;`},...urls.map(n=>{const body=requireNode(n.init,'ArrowFunctionExpression').body;return{start:body.start,end:body.end,text:`new URL(${config.slice(body.start,body.end)},document.baseURI).href`};})]);
  if(menus) {
    if(nodesOf(info.appTree,'Identifier',n=>n.name==='createLocalSandboxBackend').length||nodesOf(info.tree,'Identifier',n=>n.name==='createLocalSandboxBackend').length)throw new Error('Unsupported upstream: local backend binding collision');
    const imports=info.extraImports.length?`import {${info.extraImports.map(i=>`${i.imported} as ${i.local}`).join(',')}} from ${JSON.stringify(info.configPath)};\n`:'';
    return {main:`import {createLocalSandboxBackend} from ${JSON.stringify(menus.path)};\n`+patchedMain,menus:imports+edits(menus.source,menuEdits)+`\n${shim}\nexport {createLocalSandboxBackend};`,config:patchedConfig,info};
  }
  return {main:patchedMain,menus:undefined,config:patchedConfig,info};
}
