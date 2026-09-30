/** Exercise real Seatbelt process ownership with disposable, credential-free fixtures. */
import { runCli } from "../extensions/models/cli_agent.ts";

if (Deno.build.os !== "darwin") throw new Error("This probe requires macOS");
const policyRoot = await Deno.realPath(Deno.args[0] ?? ".");
const root = await Deno.realPath(await Deno.makeTempDir());
const subject = `${root}/subject`;
const marker = `${root}/owned.json`;
await Deno.mkdir(subject);
const fixture = `${root}/parent.mjs`;
await Deno.writeTextFile(
  fixture,
  `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('descendant-ready'); setInterval(() => {}, 1000)"], { stdio: 'inherit' });
writeFileSync(${
    JSON.stringify(marker)
  }, JSON.stringify([process.pid, child.pid]));
process.on('SIGTERM', () => {});
if (process.env.PROBE_SCENARIO === 'early-exit') setTimeout(() => process.exit(1), 200);
setInterval(() => {}, 1000);
`,
);
const results: Record<string, unknown>[] = [];
try {
  for (const role of ["readonly", "actor"]) {
    for (const scenario of ["wall", "early-exit", "cancel"]) {
      const controller = new AbortController();
      const reason = new Error("fixture cancellation");
      let pids: number[] = [];
      try {
        const outcome = runCli(["node", fixture], {
          cwd: subject,
          wallTimeoutMs: scenario === "cancel" ? 10000 : 1500,
          idleTimeoutMs: 0,
          signal: controller.signal,
          env: { PROBE_SCENARIO: scenario },
          sandbox: {
            mode: "seatbelt",
            required: true,
            provider: "opencode",
            credentialAccess: "isolated",
            profilePath:
              `${policyRoot}/agent-constraints/nightshift-${role}.sb`,
          },
        }).then(
          (result) => ({ result, error: undefined }),
          (error) => ({ result: undefined, error }),
        );
        for (let attempt = 0; attempt < 200; attempt++) {
          try {
            pids = JSON.parse(await Deno.readTextFile(marker));
          } catch { /* fixture is starting */ }
          if (pids.length === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (scenario === "cancel") controller.abort(reason);
        const observed = await outcome;
        await new Promise((resolve) => setTimeout(resolve, 300));
        const alive = pids.filter((pid) => {
          try {
            Deno.kill(pid, "SIGCONT");
            return true;
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
            return false;
          }
        });
        const passed = pids.length === 2 && alive.length === 0 && (
          scenario === "cancel"
            ? observed.error === reason
            : scenario === "wall"
            ? observed.result?.timedOut === true
            : observed.result?.code === 1 && observed.result?.timedOut === false
        );
        results.push({
          role,
          scenario,
          passed,
          survivors: alive.length,
          timedOut: observed.result?.timedOut ?? false,
          cancelled: observed.error === reason,
          durationMs: observed.result?.durationMs ?? null,
        });
      } finally {
        controller.abort(reason);
        for (const pid of pids) {
          try {
            Deno.kill(pid, "SIGKILL");
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          }
        }
        try {
          await Deno.remove(marker);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
    }
  }
  console.log(
    JSON.stringify({ observedAt: new Date().toISOString(), results }, null, 2),
  );
  if (results.some((result) => !result.passed)) Deno.exitCode = 1;
} finally {
  await Deno.remove(root, { recursive: true });
}
