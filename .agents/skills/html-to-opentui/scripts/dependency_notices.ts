/** Standalone tooling notices from the pinned npm lock and installed package license files. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { main, readJson } from './io.ts';
main(import.meta.url, () => {
  const {values}=parseArgs({options:{check:{type:'boolean'}}});
  const root=fileURLToPath(new URL('../',import.meta.url));
  const lock=readJson<{packages:Record<string,{version:string;resolved?:string;integrity?:string}>}>(join(root,'package-lock.json'));
  const sections=['# Third-party notices\n\nThese dependencies are used by the standalone development tools. They are not generated application dependencies.\n'];
  for(const [folder, pinned] of Object.entries(lock.packages).filter(([p])=>p.startsWith('node_modules/')).sort(([a],[b])=>a.localeCompare(b))) {
    const path=join(root,folder), metadata=readJson<{name:string;version:string;license:string}>(join(path,'package.json'));
    if(metadata.version!==pinned.version)throw new Error('Installed dependency differs from lock: '+folder);
    const files=readdirSync(path).filter(name=>/^(licen[sc]e|copying|notice|thirdpartynotice)/i.test(name));
    if(!files.length || !metadata.license)throw new Error('Review missing license: '+folder);
    sections.push(`## ${metadata.name}@${metadata.version}\n\nDeclared license: ${metadata.license}\n\nSource: ${pinned.resolved ?? 'see package-lock.json'}\n\n`);
    for(const name of files) sections.push(`### ${name}\n\n${readFileSync(join(path,name),'utf8').trim()}\n\n`);
  }
  const output=join(root,'THIRD_PARTY_NOTICES.md'), content=sections.join('');
  if(values.check){if(readFileSync(output,'utf8')!==content)throw new Error('Dependency notices are stale');console.log('Dependency notices match the installed lockfile.');}
  else{writeFileSync(output,content);console.log('Generated standalone dependency notices.');}
});
