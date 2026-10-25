import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BASE } from "./context";

/**
 * What only Workbench itself may assert, persisted across plugin restarts. Agents cannot call plugin RPCs,
 * so unlike labels (which create_agent lets any agent set) these entries cannot be forged by an agent.
 */
export interface WorkbenchState {
  /** Coordinator agent id -> coordinator entry id, registered by the UI after creation and verified here. */
  coordinators: Record<string, string>;
  /** Second-opinion or committee-member agent id -> its primary (chair), plus hashes of reports already delivered. */
  secondOpinions: Record<string, {
    primaryId: string; failure?: string; delivered: string[];
    /** Committee progress: 0 independent reviews, 1 exchanged, 2 consensus requested (or the member failed). */
    mode?: "committee"; stage?: number;
    /** The two independent reviews, frozen when the exchange starts so a retried send repeats exactly them. */
    exchange?: { toMember: string; toChair: string };
  }>;
  /** Scheduled check-ins (Paseo heartbeats) Workbench created for a Coordinator, by heartbeat id; the CLI cannot list them. */
  checkIns?: Record<string, { agentId: string; name: string; cadence: string }>;
}

const FILE = join(BASE, "state.json");
// The read itself is cached, so concurrent first reads share one object and a late parse cannot replace an updated one.
let cache: Promise<WorkbenchState> | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function readState(): Promise<WorkbenchState> {
  cache ??= readFile(FILE, "utf8").then((text) => JSON.parse(text) as WorkbenchState, (error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { coordinators: {}, secondOpinions: {} };
  });
  // A failed read is not cached: the next caller tries again.
  cache.catch(() => { cache = null; });
  return cache;
}

/** Serialized read-modify-write with an atomic rename, so concurrent hooks never lose an entry. */
export function updateState(change: (state: WorkbenchState) => void): Promise<WorkbenchState> {
  const next = chain.then(async () => {
    const state = await readState();
    change(state);
    await mkdir(BASE, { recursive: true, mode: 0o700 });
    const temp = join(BASE, `state-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temp, FILE);
    return state;
  });
  chain = next.catch(() => undefined);
  return next;
}
