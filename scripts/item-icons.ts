import {configContext,one} from './source.ts';
import {objectArray,record,text} from '../types/data.ts';

export function inspectItemIcons(config:string,itemData:unknown) {
  const {values}=configContext(config);
  const catalogs=Object.values(values).filter(objectArray);
  const upgrades=one(catalogs.filter(items=>items.every(item=>'key' in item&&'stat' in item&&'per' in item)),'upgrade item catalog');
  const held=one(catalogs.filter(items=>items.every(item=>'key' in item&&'mods' in item&&!('passive' in item))),'held item catalog');
  const shop=one(catalogs.filter(items=>items.every(item=>'key' in item&&'price' in item)),'shop item catalog');
  const tokens=new Set<string>();
  for(const catalog of [upgrades,held,shop]) {
    const keys=new Set<string>();
    for(const item of catalog) {
      const key=text(item['key'],'item key');
      if(!/^[\w-]+$/.test(key)||keys.has(key))throw new Error('Invalid or duplicate item key');
      keys.add(key);
      // Upgrade renderers pass icon tokens, which can differ from their keys.
      // Held-item and shop renderers pass the catalog key instead.
      const token=catalog===upgrades?text(item['icon'],'upgrade item icon'):key;
      if(!/^[\w-]+$/.test(token))throw new Error('Invalid item icon token');
      tokens.add(token);
    }
  }
  const data=record(itemData,'item data');
  return [...new Set(['assets/items/poke-ball.png',...[...tokens].map(token=>{
    const entry=data[token]===undefined?undefined:record(data[token],'item data entry');
    // Match the game's item helper, including tokens absent from items.json.
    const icon=entry?.['icon']===undefined?`items/${token}.png`:text(entry['icon'],'item icon path');
    if(!/^items\/[\w-]+\.png$/.test(icon))throw new Error('Invalid item icon path');
    return `assets/${icon}`;
  })])].sort();
}
