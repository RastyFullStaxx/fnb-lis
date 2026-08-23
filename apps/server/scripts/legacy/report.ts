/**
 * What the import did, or would do.
 *
 * The report is the deliverable of a dry run, so nothing is allowed to be
 * silent: every skipped row is listed with its legacy id, and every decision a
 * human still has to make is flagged. An import that quietly drops 300 rows and
 * prints "done" is indistinguishable from one that worked.
 */
export class Report {
  private created = new Map<string, number>();
  private skipped: Array<{ reason: string; detail: string }> = [];
  private flags: string[] = [];

  count(model: string, n = 1): void {
    this.created.set(model, (this.created.get(model) ?? 0) + n);
  }

  skip(reason: string, detail: string): void {
    this.skipped.push({ reason, detail });
  }

  flag(message: string): void {
    this.flags.push(message);
  }

  totals(): Record<string, number> {
    return Object.fromEntries([...this.created].sort());
  }

  print(mode: "DRY RUN" | "APPLIED", stage: string): void {
    console.log(`\n===== ${stage} — ${mode} =====`);
    if (this.created.size === 0) console.log("  (nothing created)");
    for (const [model, n] of [...this.created].sort()) {
      console.log(`  ${model.padEnd(28)} ${String(n).padStart(6)}`);
    }

    if (this.skipped.length) {
      const byReason = new Map<string, number>();
      for (const s of this.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
      console.log(`\n  SKIPPED (${this.skipped.length}) — every row accounted for, none silent:`);
      for (const [reason, n] of [...byReason].sort()) console.log(`    ${reason.padEnd(34)} ${String(n).padStart(5)}`);
      // Full detail, capped so a 300-row skip list does not bury the flags below
      // it. The cap itself is announced — a silent truncation would be the very
      // thing this class exists to prevent.
      const SHOW = 40;
      for (const s of this.skipped.slice(0, SHOW)) console.log(`      [${s.reason}] ${s.detail}`);
      if (this.skipped.length > SHOW) {
        console.log(`      … ${this.skipped.length - SHOW} more not printed (raise SHOW in report.ts to see them all)`);
      }
    }

    if (this.flags.length) {
      console.log(`\n  NEEDS A HUMAN (${this.flags.length}):`);
      for (const f of this.flags) console.log(`    - ${f}`);
    }
    console.log("");
  }
}
