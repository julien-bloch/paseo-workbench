/**
 * How each provider is kept read-only, tested on Paseo 0.12.0 (see docs/TEST_REPORT.md).
 * Paseo's mode catalog has no read-only flag, so this table is the one hardcoded fact.
 *
 * - "mode": a provider mode Paseo reports back; every launch verifies `currentModeId` before sending the task.
 * - "sandbox": a provider option Paseo applies but does not report (Codex shows mode "auto"), so it cannot
 *   be verified per launch. Tested: with it a shell write fails with "operation not permitted"; with
 *   `workspace-write` the same write succeeds. Labeled as requested, not verified.
 *   Paseo 0.12 rejects modeId "read-only" for Codex, hence the option.
 */
type ReadOnlyPolicy =
  | { kind: "mode"; modeId: string; boundary: string }
  | { kind: "sandbox"; options: Record<string, string>; boundary: string };

export const READ_ONLY_POLICIES: Readonly<Record<string, ReadOnlyPolicy>> = {
  claude: {
    kind: "mode",
    modeId: "plan",
    boundary: "Claude Code plan mode: read-only commands run; file edits and writing shell commands stop for your approval. Commands you set to always-allow in Claude Code still run without asking.",
  },
  codex: {
    kind: "sandbox",
    // "never": no escalation prompts, so an unattended review can neither stall on nor be granted a write.
    options: { sandbox_mode: "read-only", approval_policy: "never" },
    boundary: "Codex read-only OS sandbox requested (writes fail; no escalation prompts). Paseo cannot confirm it per launch and shows the agent's mode as \"Default Permissions\".",
  },
};

export function providerOf(providerModel: string): string {
  return providerModel.split("/")[0] ?? "";
}

export type LaunchMode =
  | { kind: "read-only"; modeId: string; boundary: string }
  | { kind: "sandbox"; options: Record<string, string>; boundary: string }
  | { kind: "chosen"; modeId: string }
  | { kind: "provider-default" };

/**
 * Decide the permission setup for a launch, or explain why it must not happen.
 * Never falls back from a required read-only setup to something weaker.
 */
export function planLaunchMode(input: { name: string; providerModel: string; modeId: string; requireReadOnly: boolean }): LaunchMode {
  const modeId = input.modeId.trim();
  if (!input.requireReadOnly) return modeId ? { kind: "chosen", modeId } : { kind: "provider-default" };
  const policy = READ_ONLY_POLICIES[providerOf(input.providerModel)];
  if (!policy) {
    throw new Error(`${input.name} requires read-only access, but Workbench knows no read-only setup for provider "${providerOf(input.providerModel)}". Choose a claude/ or codex/ model for this profile, or turn off "Require enforced read-only" to launch with instructions-only protection.`);
  }
  if (policy.kind === "sandbox") {
    if (modeId) throw new Error(`${input.name} requires read-only access, which for ${providerOf(input.providerModel)} comes from its sandbox, not a mode. Clear the mode "${modeId}".`);
    return { kind: "sandbox", options: policy.options, boundary: policy.boundary };
  }
  if (modeId && modeId !== policy.modeId) {
    throw new Error(`${input.name} requires read-only access, but its mode is "${modeId}". Clear the mode or set it to "${policy.modeId}".`);
  }
  return { kind: "read-only", modeId: policy.modeId, boundary: policy.boundary };
}

// Modes that turn permission prompts off (Claude, Codex). An auto-approved create_agent/send_agent_prompt asking for one
// would let a Coordinator hand out more power than it has, so such requests go to the user.
const BYPASS_MODES = new Set(["bypassPermissions", "full-access"]);

/** Why an otherwise allowed request must still go to the user, or null. */
export function escalation(input: unknown): string | null {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const settings = (args.settings && typeof args.settings === "object" ? args.settings : {}) as Record<string, unknown>;
  for (const mode of [args.mode, args.modeId, args.sessionMode, settings.modeId]) {
    if (typeof mode === "string" && BYPASS_MODES.has(mode)) return `requests permission-bypassing mode ${mode}`;
  }
  const labels = args.labels && typeof args.labels === "object" ? Object.keys(args.labels) : [];
  if (labels.some((key) => key.startsWith("workbench."))) return "sets Workbench labels";
  return null;
}

// A PR manager's own read-only commands: one gh/git read, no chaining, redirection, substitution or escapes.
// Every argument is checked against an allowlist per subcommand (default deny): a flag that is not listed, such as
// `-XDELETE` or `git branch -D`, keeps the command pending for the user.
const SHELL_META = /[;&|<>`$\\\n\r]/;

type Rule = {
  /** Flags this subcommand may use: "flag" takes no value, "value" takes one (`--x v` or `--x=v`). */
  flags: Record<string, "flag" | "value">;
  /** Positional arguments allowed, each checked by `ok`. */
  positional: { max: number; ok: (token: string) => boolean };
};
const any = (t: string) => !t.startsWith("-");
const v = "value" as const, f = "flag" as const;
const REPO = { "-R": v, "--repo": v };
const JSON_OUT = { "--json": v, "--jq": v, "-q": v };

const GH_PR: Record<string, Rule> = {
  list: { flags: { ...REPO, ...JSON_OUT, "--author": v, "--search": v, "-S": v, "--state": v, "-s": v, "--limit": v, "-L": v, "--label": v, "-l": v, "--base": v, "-B": v, "--head": v, "-H": v, "--assignee": v, "-a": v, "--draft": f }, positional: { max: 0, ok: any } },
  view: { flags: { ...REPO, ...JSON_OUT, "--comments": f, "-c": f }, positional: { max: 1, ok: any } },
  checks: { flags: { ...REPO, ...JSON_OUT, "--required": f }, positional: { max: 1, ok: any } },
  diff: { flags: { ...REPO, "--name-only": f, "--patch": f, "--color": v }, positional: { max: 1, ok: any } },
  status: { flags: { ...REPO, ...JSON_OUT }, positional: { max: 0, ok: any } },
};
const GH_RUN: Record<string, Rule> = {
  list: { flags: { ...REPO, ...JSON_OUT, "--limit": v, "-L": v, "--branch": v, "-b": v, "--workflow": v, "-w": v, "--status": v, "-s": v, "--event": v, "-e": v, "--commit": v, "-c": v, "--user": v, "-u": v }, positional: { max: 0, ok: any } },
  view: { flags: { ...REPO, ...JSON_OUT, "--log": f, "--log-failed": f, "--job": v, "-j": v, "--attempt": v, "-a": v, "--verbose": f, "-v": f }, positional: { max: 1, ok: (t) => /^\d+$/.test(t) } },
};
// gh api: GET only. No method override, request fields, input body or headers (those all live in flags not listed here).
const GH_API: Rule = { flags: { "--paginate": f, "--slurp": f, "--jq": v, "-q": v, "--include": f, "-i": f, "--cache": v }, positional: { max: 1, ok: (t) => /^[A-Za-z0-9_./{}:@%?=,+-]+$/.test(t) && !t.startsWith("-") && t !== "graphql" } };

const PATHS = (t: string) => !t.startsWith("-");
const GIT: Record<string, Rule> = {
  status: { flags: { "-s": f, "--short": f, "--porcelain": f, "-b": f, "--branch": f }, positional: { max: 20, ok: PATHS } },
  log: { flags: { "--oneline": f, "--graph": f, "--decorate": f, "--stat": f, "--name-only": f, "--no-merges": f, "--first-parent": f, "-n": v, "--max-count": v, "--format": v, "--pretty": v, "--since": v, "--until": v, "--author": v }, positional: { max: 20, ok: PATHS } },
  diff: { flags: { "--stat": f, "--shortstat": f, "--numstat": f, "--name-only": f, "--name-status": f, "--cached": f, "--staged": f }, positional: { max: 20, ok: PATHS } },
  show: { flags: { "--stat": f, "--name-only": f, "--name-status": f, "--oneline": f, "--format": v, "--pretty": v }, positional: { max: 20, ok: PATHS } },
  // No refspec with a destination (`a:b` writes a local ref) and no forced update (`+`).
  fetch: { flags: { "--prune": f, "--all": f, "--quiet": f, "-q": f }, positional: { max: 2, ok: (t) => !t.startsWith("-") && !t.startsWith("+") && !t.includes(":") } },
  "rev-parse": { flags: { "--abbrev-ref": f, "--show-toplevel": f, "--short": f, "--verify": f, "--git-dir": f }, positional: { max: 5, ok: PATHS } },
  // Listing only: any other flag (-d, -D, -m, -c ...) or a name (which would create a branch) is refused.
  branch: { flags: { "-a": f, "--all": f, "-r": f, "--remotes": f, "-v": f, "-vv": f, "--list": f, "--show-current": f }, positional: { max: 0, ok: any } },
};

/** Split into words, honouring simple '...' and "..." quoting. Null when quotes do not balance. */
function words(command: string): string[] | null {
  const tokens = command.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? [];
  if (tokens.join("").length !== command.replace(/\s+/g, "").length) return null;
  return tokens.map((t) => t.replace(/["']/g, ""));
}

/** Whether every argument fits the rule (a lone `--` ends the flags; later words are positional). */
function fits(args: readonly string[], rule: Rule): boolean {
  let positional = 0, flagsDone = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!flagsDone && a === "--") { flagsDone = true; continue; }
    if (!flagsDone && a.startsWith("-")) {
      if (/^-\d+$/.test(a) && rule.flags["-n"]) continue; // git log -5
      const [name, inline] = a.includes("=") && a.startsWith("--") ? [a.slice(0, a.indexOf("=")), true] : [a, false];
      const kind = rule.flags[name];
      if (!kind) return false;
      if (kind === "flag" && inline) return false;
      if (kind === "value" && !inline) { if (i + 1 >= args.length) return false; i++; }
      continue;
    }
    if (++positional > rule.positional.max || !rule.positional.ok(a)) return false;
  }
  return true;
}

/** Whether a PR manager may run this shell command without asking: a single read of GitHub or git state. */
export function isReadOnlyPrCommand(command: string): boolean {
  const c = command.trim();
  if (!c || SHELL_META.test(c)) return false;
  const w = words(c);
  if (!w || w.length < 2) return false;
  if (w[0] === "gh") {
    let rest = w.slice(1);
    let repo: string[] = [];
    if (rest[0] === "-R" || rest[0] === "--repo") { repo = rest.slice(0, 2); rest = rest.slice(2); if (repo.length < 2 || repo[1]!.startsWith("-")) return false; }
    const [group, sub, ...args] = rest;
    if (group === "api") return !repo.length && sub !== undefined && fits([sub, ...args], GH_API) && GH_API.positional.ok(sub);
    const rule = group === "pr" ? GH_PR[sub ?? ""] : group === "run" ? GH_RUN[sub ?? ""] : undefined;
    return Boolean(rule) && fits(args, rule!);
  }
  if (w[0] === "git" && w[1] === "-C" && w[2] && !w[2].startsWith("-")) {
    const [sub, ...args] = w.slice(3);
    if (sub === "remote") return args.length === 1 && args[0] === "-v";
    const rule = GIT[sub ?? ""];
    return Boolean(rule) && fits(args, rule!);
  }
  return false;
}

/**
 * Whether a PR manager's create_workspace / create_agent request may run without asking: workspaces only as a
 * worktree checked out at a PR, and fixers only in modes where shell commands (git push included) ask the user.
 */
export function prManagerRequestAllowed(tool: string, input: unknown): boolean {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (tool === "create_workspace") return args.isolation === "worktree" && args.mode === "checkout-pr" && typeof args.prNumber === "number";
  if (tool === "create_agent") {
    const settings = (args.settings && typeof args.settings === "object" ? args.settings : {}) as Record<string, unknown>;
    const mode = typeof settings.modeId === "string" ? settings.modeId : typeof args.mode === "string" ? args.mode : "";
    const provider = typeof args.provider === "string" ? args.provider.split("/")[0] : "";
    if (provider === "claude") return ["acceptEdits", "default", "plan"].includes(mode);
    if (provider === "codex") return mode === "" || mode === "auto";
    return false;
  }
  return true;
}
