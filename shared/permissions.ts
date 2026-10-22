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
const SHELL_META = /[;&|<>`$\\\n\r]/;
const READ_ONLY_PR_COMMANDS = [
  /^gh(\s+-R\s+\S+)?\s+pr\s+(list|view|checks|diff|status)(\s|$)/,
  /^gh(\s+-R\s+\S+)?\s+run\s+(list|view)(\s|$)/,
  /^gh\s+api\s+\S+/,
  /^git\s+-C\s+\S+\s+(status|log|diff|show|fetch|rev-parse|remote\s+-v|branch)(\s|$)/,
];

/** Whether a PR manager may run this shell command without asking: a single read of GitHub or git state. */
export function isReadOnlyPrCommand(command: string): boolean {
  const c = command.trim();
  if (!c || SHELL_META.test(c)) return false;
  if (!READ_ONLY_PR_COMMANDS.some((pattern) => pattern.test(c))) return false;
  if (/\s(--web|-w)(\s|$)/.test(c)) return false; // opens a browser
  // gh api must stay a GET: no method override or request body.
  if (/^gh\s+api/.test(c) && /\s(-X|--method|-f|-F|--field|--raw-field|--input)(\s|=|$)/.test(c)) return false;
  return true;
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
