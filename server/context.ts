import { mkdir, realpath, rename, writeFile, stat, unlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export const BASE = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-data", "workbench");
const COORDINATOR_ID = /^[a-z][a-z0-9-]{1,39}$/;

/** Fixed home per Coordinator. "default" keeps the pre-0.1.0-alpha.3 path so an existing Coordinator agent stays valid. */
export function homeFor(coordinatorId: string): string {
  // Re-checked here although the RPC schema validates it: this value becomes a filesystem path.
  if (!COORDINATOR_ID.test(coordinatorId)) throw new Error("Invalid coordinator id");
  return coordinatorId === "default" ? join(BASE, "coordinator") : join(BASE, "coordinators", coordinatorId);
}

export async function prepareHome(coordinatorId: string): Promise<{path:string}> {
  const root=homeFor(coordinatorId);
  await mkdir(root, {recursive:true,mode:0o700});
  // A symlinked home (or ancestor) could point anywhere: the real path must stay inside the real plugin directory.
  const [realRoot,realBase]=await Promise.all([realpath(root),realpath(BASE)]);
  if(!realRoot.startsWith(realBase+sep))throw new Error("Coordinator home resolves outside the Workbench plugin directory");
  const readme=join(root,"README.md");
  try { await stat(readme); }
  catch { await writeFile(readme,"# Workbench Coordinator\n\nThe dedicated home of a user-created Workbench Coordinator agent. CONTEXT.md is a snapshot of its assigned workspaces and their agents, rewritten when the user refreshes it.\n",{flag:"wx",mode:0o600}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=="EEXIST")throw error;}); }
  return {path:root};
}

export async function writeBrief(coordinatorId: string, markdown:string):Promise<{path:string;updatedAt:string}> {
  const {path:root}=await prepareHome(coordinatorId);
  const target=join(root,"CONTEXT.md");
  const temp=join(root,`context-${randomUUID()}.tmp`);
  // The plugin only writes into its own fixed coordinator homes, never an arbitrary path.
  try {
    await writeFile(temp,markdown,{encoding:"utf8",flag:"wx",mode:0o600});
    await rename(temp,target);
  } catch (error) {
    await unlink(temp).catch(()=>undefined);
    throw error;
  }
  return {path:target,updatedAt:new Date().toISOString()};
}
