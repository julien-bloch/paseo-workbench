import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname);
const files=['paseo-plugin.json','index.client.tsx','index.server.ts','README.md','docs/ENGINEERING_SPEC.md','docs/ENGINEER_HANDOFF.md','docs/HANDOFF_PROMPT.md','docs/IMPLEMENTATION_BACKLOG.md','docs/TEST_REPORT.md'];
let count=0;
for(const file of files){if(!existsSync(resolve(root,file)))throw new Error(`Missing ${file}`);count++;}
const manifest=JSON.parse(readFileSync(resolve(root,'paseo-plugin.json'),'utf8'));
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
if(manifest.id!=='workbench'||!pkg.private)throw new Error('Invalid plugin identity or packaging policy');
console.log(`${count} critical handoff files present; manifest ${manifest.id}; package ${pkg.version}`);
