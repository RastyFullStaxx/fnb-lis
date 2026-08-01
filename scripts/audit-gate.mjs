/**
 * `npm audit`, with exceptions that are explicit, justified, and expiring.
 *
 *   npm run audit
 *
 * Plain `npm audit --audit-level=high` in CI has exactly two end states, and
 * both are bad: it blocks every build over an advisory nobody can reach, or
 * somebody adds `|| true` and it silently stops meaning anything. Neither tells
 * you whether the tree is actually safe.
 *
 * So exceptions live HERE, in review, with a written reason and an expiry. When
 * one expires the build fails and a human looks again — which is the behaviour
 * you actually want from an accepted risk, as opposed to a forgotten one.
 *
 * Scoped to what SHIPS. @fnb/desktop pulls the Electron builder toolchain,
 * which is a build-time dependency of an installer, not code serving requests.
 * Advisories there are reported but do not gate.
 */
import { execFileSync } from "node:child_process";

const SHIPPING_WORKSPACES = ["@fnb/server", "@fnb/web"];
const GATE_LEVEL = new Set(["high", "critical"]);

/**
 * Accepted risks. Every entry needs a reason a reviewer can check and a date
 * the acceptance dies. Do NOT add one without tracing the actual call path.
 */
const EXCEPTIONS = [
  {
    package: "brace-expansion",
    advisory: "GHSA-3jxr-9vmj-r5cp / GHSA-mh99-v99m-4gvg",
    expires: "2026-11-01",
    reason:
      "ReDoS/OOM via attacker-controlled GLOB PATTERNS. Reached only as " +
      "exceljs -> archiver -> glob -> minimatch, where the patterns are " +
      "archiver's own constants. No user input reaches a glob in this app: " +
      "uploads are parsed by name-from-SHA256 (routes/imports.ts) and never " +
      "globbed. Drop this entry when exceljs republishes with archiver >=6.",
  },
  {
    package: "fast-uri",
    advisory: "GHSA-v2hh-gcrm-f6hx",
    expires: "2026-11-01",
    reason:
      "Host confusion in URI parsing. Present only via prisma -> @prisma/dev " +
      "-> ajv, i.e. the Prisma CLI, which runs at migrate/generate time and is " +
      "never loaded by the running server. npm audit fix resolves it by " +
      "bumping the CLI to 7.9.1 while @prisma/client stays 7.8.0; a split " +
      "Prisma toolchain under a system whose value is numerical correctness is " +
      "the worse trade. Revisit when @prisma/client and prisma can move together.",
  },
];

/**
 * Distinguish "audit ran and found things" from "audit never ran".
 *
 * npm exits non-zero for BOTH, and both write JSON to stdout — so reading
 * `err.stdout` and trusting it fails OPEN. When the registry is unreachable npm
 * emits `{"message":"request to … failed …","error":{…}}` with no
 * `vulnerabilities` key at all, and `?? {}` then read that as a clean tree: the
 * gate printed "PASS — 0 blocking" and exited 0. Reproduced with
 * `npm_config_registry=http://127.0.0.1:1`.
 *
 * A dependency gate that announces success when it did not run is worse than
 * having no gate, because CI goes green and nobody looks. So the shape is
 * checked: a real report always carries a `vulnerabilities` OBJECT and a
 * `metadata` block; anything else throws.
 */
function auditWorkspace(ws) {
  let raw;
  try {
    raw = execFileSync("npm", ["audit", "--omit=dev", "-w", ws, "--json"], {
      encoding: "utf-8",
      shell: process.platform === "win32",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // npm audit exits non-zero WHEN it finds things — that is the normal path
    // here, and its stdout is still the report we want.
    if (!err.stdout) throw err;
    raw = err.stdout;
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error(`npm audit for ${ws} did not return JSON:\n${String(raw).slice(0, 400)}`);
  }

  if (report.error || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
    const why = report.error?.summary || report.message || "no vulnerabilities object in the response";
    throw new Error(
      `npm audit did not run for ${ws} — ${why}\n` +
        "Refusing to report PASS on an audit that never happened (registry down, proxy, or auth).",
    );
  }
  if (!report.metadata) {
    throw new Error(`npm audit for ${ws} returned no metadata block; treating as not-run.`);
  }
  return report;
}

const today = new Date().toISOString().slice(0, 10);
let blocking = 0;
let excepted = 0;
let expired = 0;

for (const ws of SHIPPING_WORKSPACES) {
  let report;
  try {
    report = auditWorkspace(ws);
  } catch (err) {
    // Fail LOUD and non-zero. The whole point of this file is that a gate which
    // cannot distinguish "clean" from "did not run" is not a gate.
    console.error(`
FAIL — ${err instanceof Error ? err.message : err}
`);
    process.exit(1);
  }
  const vulns = Object.entries(report.vulnerabilities ?? {});
  const gated = vulns.filter(([, v]) => GATE_LEVEL.has(v.severity));

  console.log(`\n== ${ws}: ${vulns.length} advisor${vulns.length === 1 ? "y" : "ies"}, ${gated.length} at high/critical`);

  for (const [name, v] of gated) {
    /**
     * Matched on package name AND advisory identity.
     *
     * Name alone was wrong: an exception written for one CVE silently absorbed
     * every FUTURE advisory in the same package, including an unrelated RCE.
     * The `advisory` field existed but was prose nobody compared to anything.
     * Now the GHSA ids in it must actually appear in this finding's `via`
     * entries, so a new advisory in an already-excepted package BLOCKS and gets
     * looked at.
     */
    const advisoryIds = new Set(
      (v.via ?? [])
        .filter((x) => typeof x === "object")
        .flatMap((x) => [x.url, x.source].filter(Boolean).map(String)),
    );
    const candidate = EXCEPTIONS.find((e) => e.package === name);
    const exception =
      candidate &&
      candidate.advisory
        .split("/")
        .map((a) => a.trim())
        .filter(Boolean)
        .every((id) => [...advisoryIds].some((seen) => seen.includes(id)))
        ? candidate
        : undefined;
    if (candidate && !exception) {
      console.log(`  BLOCK  ${name} (${v.severity}) — a DIFFERENT advisory than the one excepted`);
      console.log(`         excepted: ${candidate.advisory}`);
      console.log(`         found   : ${[...advisoryIds].join(", ") || "(none reported)"}`);
      blocking += 1;
      continue;
    }
    if (!exception) {
      blocking += 1;
      console.log(`  BLOCK  ${name} (${v.severity}) — ${v.range}`);
      for (const via of v.via) if (typeof via === "object") console.log(`         ${via.title}`);
      console.log(`         fix: ${JSON.stringify(v.fixAvailable)}`);
      continue;
    }
    if (exception.expires < today) {
      expired += 1;
      blocking += 1;
      console.log(`  EXPIRED ${name} — acceptance lapsed ${exception.expires}. Re-assess.`);
      continue;
    }
    excepted += 1;
    console.log(`  allow  ${name} (${v.severity}) — accepted until ${exception.expires}`);
  }
}

console.log(
  `\n${blocking === 0 ? "PASS" : "FAIL"} — ${blocking} blocking, ${excepted} accepted${expired ? `, ${expired} EXPIRED` : ""}\n`,
);
if (blocking > 0) {
  console.log("Fix it, or add a reviewed exception in scripts/audit-gate.mjs with a reason and an expiry.\n");
}
process.exit(blocking === 0 ? 0 : 1);
