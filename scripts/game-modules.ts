import path from 'node:path';
import {ast,maybeName,nodesOf,one,literal} from './source.ts';

export function gameModules(files:ReadonlyMap<string,Uint8Array>) {
  const modules=[...files].filter(([name])=>name.endsWith('.js')).map(([name,bytes])=>({name,source:Buffer.from(bytes).toString()}));
  const main=one(modules.filter(module=>module.source.includes(' as App}')),'snapshot application module');
  const menus=one(modules.filter(module=>module.source.includes('lastSpecies')&&nodesOf(ast(module.source),'FunctionDeclaration',fn=>
    nodesOf(fn.body,'ReturnStatement',node=>node.argument?.type==='ObjectExpression'&&['stardust','lab','league','lastSpecies','settings'].every(key=>node.argument?.type==='ObjectExpression'&&node.argument.properties.some(p=>p.type==='Property'&&maybeName(p.key)===key))).length>0).length>0),'snapshot profile module');
  const config=one(modules.filter(module=>module!==main&&module!==menus&&module.source.includes('slot-move')),'snapshot configuration module');
  const menuPath=menus===main?undefined:one([...new Set(nodesOf(ast(main.source),'ImportDeclaration',node=>{
    const value=literal(node.source);
    return typeof value==='string'&&value.startsWith('./')&&path.posix.join(path.posix.dirname(main.name),value)===menus.name;
  }).map(node=>literal(node.source)))],'application menu import');
  if(menuPath!==undefined&&typeof menuPath!=='string')throw new Error('Unsupported menu import');
  return {main,config,menus,menuPath};
}
