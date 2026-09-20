# Nightshift worker lifecycle release candidate

Candidate: `@funsaized/cli-agent@2026.09.20.1`, based on
`release/funsaized-cli-agent` at `9aba6a9a6885bcc823da70e818d71d48b21e956d`.
That branch's model source exactly matched the installed `2026.09.05.1` package
used by herdr-mise. The repository's default branch did not match that package.

A native Mac probe found that the old executor returned after an early provider
exit while an ordinary child in its process group remained alive. The isolated
upstream regression failed before the fix with “process survived timeout
cleanup”; fixture cleanup terminated the owned child. The fix cleans the owned
POSIX group even when its leader has exited, preserving the provider's exit code
and timeout attribution.

Caller cancellation now propagates from the optional method-context signal
through invoke/invokeAndParse, process execution, and retry backoff. Tests cover
pre-aborted invocation, a running parent and descendant ignoring SIGTERM, and
cancellation during a long retry delay without another invocation. The original
cancellation reason is preserved. No input/resource schema migration is needed;
the previous migration is preserved and the new migration is an identity change.

Validation on September 20:

- Full extension suite: **220 passed, 0 failed, 1 existing Linux-only skip**.
- Native Seatbelt: **6/6 passed**, both readonly/actor roles for wall timeout,
  early parent exit, and caller cancellation; **zero surviving fixture
  processes**.
- Extension format/check passed. Quality earned **12/12 client points**; two
  repository-verification points await registry confirmation.
- Content-bound adversarial review accepted by publication dry run. Remaining
  warnings identify the existing Deno subprocess execution in the agent/orb
  modules, which is the extension's intended function.

Reproduce from this checkout, using the repository-provisioned Deno runtime:

```sh
deno test --no-lock --node-modules-dir=none --allow-all \
  extensions/models/cli_agent_test.ts extensions/models/cli_agent_orb_test.ts
deno run --no-lock --node-modules-dir=none \
  --allow-read --allow-write --allow-env --allow-run \
  scripts/probe-macos-lifecycle.ts /path/to/herdr-mise
```

The native probe uses only fixed, disposable Node fixtures and the real supplied
Nightshift Seatbelt profiles; it does not launch a provider or access
credentials. [Native observations](macos-lifecycle-evidence-2026-09-20.json)
retain the actual role/scenario outcomes. The probe is not included in the
published archive.

Publication and herdr-mise dependency adoption have not happened yet. This does
not establish full host isolation: Windows remains direct-child-only,
descendants that create another group/session are outside the guarantee, and
actual Swamp cancellation depends on the runtime providing the context signal.
Worker credential-broker coverage and complete toolchain acceptance remain
separate.
