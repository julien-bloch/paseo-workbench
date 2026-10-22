import { mkdir, realpath, rename, writeFile, stat, unlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export const BASE = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-data", "workbench");
const COORDINATOR_ID = /^[a-z][a-z0-9-]{1,39}$/;

/** The one working folder all coordinators share, so Paseo shows them together in a single project. */
export const SHARED = join(BASE, "coordinators");

function checkId(coordinatorId: string) {
  // Re-checked here although the RPC schema validates it: this value becomes a filesystem path.
  if (!COORDINATOR_ID.test(coordinatorId)) throw new Error("Invalid coordinator id");
}

/** A coordinator's own folder inside the shared one; it holds its CONTEXT.md. */
export function contextDirFor(coordinatorId: string): string {
  checkId(coordinatorId);
  return join(SHARED, coordinatorId);
}

/** Where coordinators started before 0.1.0-alpha.15 run ("default" kept its pre-alpha.3 path); still accepted. */
export function legacyHomeFor(coordinatorId: string): string {
  checkId(coordinatorId);
  return coordinatorId === "default" ? join(BASE, "coordinator") : join(SHARED, coordinatorId);
}

async function inside(dir: string) {
  // A symlinked folder (or ancestor) could point anywhere: the real path must stay inside the real plugin directory.
  const [real, realBase] = await Promise.all([realpath(dir), realpath(BASE)]);
  if (!real.startsWith(realBase + sep)) throw new Error("Coordinator folder resolves outside the Workbench plugin directory");
}

/** The shared working folder (the coordinator's cwd) and this coordinator's context file in it. */
export async function prepareHome(coordinatorId: string): Promise<{ path: string; contextFile: string }> {
  const dir = contextDirFor(coordinatorId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await inside(SHARED);
  await inside(dir);
  const readme = join(SHARED, "README.md");
  try { await stat(readme); }
  catch { await writeFile(readme, "# Workbench coordinators\n\nThe shared working folder of the Workbench coordinators you start, so Paseo lists them in one project. Each has its own folder here with CONTEXT.md, a snapshot of what it coordinates, rewritten when you refresh it.\n", { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; }); }
  return { path: SHARED, contextFile: join(dir, "CONTEXT.md") };
}

async function writeAtomic(dir: string, markdown: string): Promise<string> {
  const target = join(dir, "CONTEXT.md");
  const temp = join(dir, `context-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, markdown, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return target;
}

export async function writeBrief(coordinatorId: string, markdown: string): Promise<{ path: string; updatedAt: string }> {
  // The plugin only writes into its own coordinator folders, never an arbitrary path.
  await prepareHome(coordinatorId);
  const path = await writeAtomic(contextDirFor(coordinatorId), markdown);
  // A "default" coordinator started before alpha.15 reads CONTEXT.md in its old folder: keep that copy current too.
  const legacy = legacyHomeFor(coordinatorId);
  if (legacy !== contextDirFor(coordinatorId) && await stat(legacy).then(() => true, () => false)) { await inside(legacy); await writeAtomic(legacy, markdown); }
  return { path, updatedAt: new Date().toISOString() };
}
