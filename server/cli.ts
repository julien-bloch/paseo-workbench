import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

// The plugin SDK (PaseoApi) cannot manage schedules or change an existing agent's labels; the Paseo CLI can.
const APP_CLI = "/Applications/Paseo.app/Contents/Resources/bin/paseo";
const CLI = process.env.PASEO_CLI || (existsSync(APP_CLI) ? APP_CLI : "paseo");

/** Run the CLI without a shell against this daemon's home; `agentId` makes heartbeat commands act for that agent. */
export function cli(args: string[], agentId?: string): Promise<unknown> {
  const home = process.env.PASEO_HOME ? ["--home", process.env.PASEO_HOME] : [];
  const env = { ...process.env };
  delete env.PASEO_AGENT_ID;
  if (agentId) env.PASEO_AGENT_ID = agentId;
  return new Promise((resolve, reject) => {
    // Options go before a "--" (which keeps a prompt starting with "-" from being read as an option).
    const end = args.indexOf("--");
    const argv = end < 0 ? [...args, "--json", ...home] : [...args.slice(0, end), "--json", ...home, ...args.slice(end)];
    execFile(CLI, argv, { env, timeout: 30_000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      let parsed: unknown;
      try { parsed = JSON.parse(stdout); } catch { /* not JSON */ }
      const message = (parsed as { error?: { message?: string } } | undefined)?.error?.message;
      if (error || message || parsed === undefined) reject(new Error(message || stderr.trim() || error?.message || `unexpected paseo CLI output: ${stdout.slice(0, 200)}`));
      else resolve(parsed);
    });
  });
}

