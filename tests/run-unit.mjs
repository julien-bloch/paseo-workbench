import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=join(root,'.unit-dist');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
try {
  execFileSync('tsc',['--target','ES2022','--module','ES2022','--moduleResolution','bundler','--strict','--skipLibCheck','--outDir',out,
    join(root,'shared','model.ts'),join(root,'shared','prompts.ts'),join(root,'shared','permissions.ts'),join(root,'shared','settings.ts'),join(root,'shared','transcript.ts'),join(root,'shared','questions.ts'),join(root,'shared','specialistFiles.ts')],{stdio:'inherit'});
  execFileSync(process.execPath,['--import',join(root,'tests','integration','register.mjs'),'--test',join(root,'tests','domain.test.mjs')],{stdio:'inherit'});
}finally {rmSync(out,{recursive:true,force:true})}
