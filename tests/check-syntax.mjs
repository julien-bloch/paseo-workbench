import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const root=resolve(new URL('..',import.meta.url).pathname);
const paths=[];
function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory()){if(!['node_modules','.unit-dist','.git'].includes(entry.name))visit(path)}else if(/\.(ts|tsx)$/.test(path))paths.push(path)}}
visit(root);
let bad=0;
for (const file of paths){
  const src=readFileSync(file,'utf8');
  const result=ts.transpileModule(src,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
  const errors=(result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
  if(errors.length){bad+=errors.length;for(const e of errors)console.error(file,ts.flattenDiagnosticMessageText(e.messageText,'\n'));}
}
console.log(`Syntactic transpilation: ${paths.length} TypeScript/TSX files; ${bad} errors`);
if(bad)process.exit(1);
