/**
 * Break-glass: clear a user's second factor from the host itself.
 *
 *   npm run mfa:reset -w @fnb/server -- <username> "<reason>"
 *
 * WHY THIS EXISTS. An administrator cannot reset their own MFA through the API
 * (routes/mfa.ts) — that rule is what stops a stolen session from quietly
 * removing the factor and re-enrolling a different phone. And an OWNER cannot
 * manage an ADMIN. So a lone ADMIN who loses both their authenticator and their
 * ten recovery codes has no path back through the application, by design.
 *
 * This is the path. It deliberately requires something the network cannot give
 * you: a shell on the server and read/write access to the database file. That
 * is a stronger proof of authority than any in-app flow, which is exactly why it
 * is an acceptable escape hatch rather than a hole.
 *
 * PREFER A SECOND ADMIN. Two administrators can reset each other through the
 * app, with the mandatory reason and the audit entry that goes with it. Reach
 * for this only when that is not possible — see docs/security-runbook.md §1.
 *
 * The reset is written to ActivityLog like any other, so using it is visible.
 */
import { prisma } from "../src/db";

const [username, reason] = process.argv.slice(2);
if (!username || !reason) {
  console.error('Usage: npm run mfa:reset -w @fnb/server -- <username> "<reason>"');
  console.error('The reason is required and goes into the audit trail. Say who asked and why.');
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  if (!user) {
    console.error(`No user "${username}".`);
    process.exit(1);
  }

  const existing = await prisma.userMfa.findUnique({ where: { userId: user.id } });
  if (!existing) {
    console.log(`${user.username} has no second factor set up. Nothing to do.`);
    process.exit(0);
  }

  // One transaction, like every other mutation in this codebase: a security
  // control being removed with no record of it is not a state to allow.
  await prisma.$transaction(async (tx) => {
    await tx.userMfa.delete({ where: { userId: user.id } });
    await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
    // Any live session is ended too. If this is being used because an account
    // was compromised, leaving the attacker's session alive would undo the point.
    const { count } = await tx.authSession.deleteMany({ where: { userId: user.id } });
    await tx.activityLog.create({
      data: {
        /**
         * NOT attributed to the target.
         *
         * This is the one action in the system with no in-app actor, and
         * recording it against the victim's own id makes the trail read as if
         * they cleared their own second factor — the worst possible reading of
         * the one event an investigator most needs to understand. `userId` is
         * nullable precisely for actions the application did not perform.
         *
         * `entityId` still points at the affected user, so filtering by entity
         * finds it.
         */
        userId: null,
        userName: "(server console)",
        action: "mfa.breakGlassReset",
        entity: "UserMfa",
        entityId: user.id,
        summary: `Two-factor authentication cleared from the server console for ${user.username}: ${reason}`,
        detailsJson: JSON.stringify({ viaHostConsole: true, endedSessions: count, reason }),
      },
    });
    console.log(`Cleared ${user.username}'s second factor and ended ${count} session(s).`);
  });

  console.log("Recorded in the activity trail as mfa.breakGlassReset.");
  console.log(`${user.username} must enrol again at /account/security on next sign-in.`);
} finally {
  await prisma.$disconnect();
}
