import {configContext,one} from './source.ts';
import {objectArray,record,text} from '../types/data.ts';

export function inspectMutationAssets(config:string) {
  const {values}=configContext(config);
  const catalogs=Object.values(values).filter(objectArray).filter(entries=>
    entries.some(entry=>'prize' in entry)&&entries.every(entry=>'rules' in entry&&'tier' in entry));
  // Generation-specific arrays are also exposed alongside the combined catalog.
  // Accept only a unique strict superset; conflicting or duplicate catalogs reject.
  const catalog=one(catalogs.filter(candidate=>catalogs.every(other=>other===candidate||other.length<candidate.length&&other.every(entry=>candidate.some(value=>JSON.stringify(value)===JSON.stringify(entry))))),'mutation catalog');
  const ids=new Set<string>();
  const assets=new Set<string>();
  for(const entry of catalog) {
    const id=text(entry['id'],'mutation id'),icon=text(entry['icon'],'mutation icon');
    if(!/^[\w-]+$/.test(id)||ids.has(id))throw new Error('Invalid or duplicate mutation id');
    if(!/^[\w-]+$/.test(icon))throw new Error('Invalid mutation icon');
    ids.add(id);
    const prize=record(entry['prize'],'mutation prizes');
    text(prize['frame'],'mutation frame');text(prize['banner'],'mutation banner');
    // Renderers use the catalog icon token and derive both reward images from its id.
    assets.add(`assets/ui/icons/${icon}.png`);
    assets.add(`assets/ui/frames/mut-${id}.png`);
    assets.add(`assets/ui/banners/mut-${id}.jpg`);
  }
  return [...assets].sort();
}
