#!/usr/bin/env bash
#
# Deploy one verified commit onto this host. Run by .github/workflows/deploy.yml
# over SSH, and safe to run by hand:
#
#   /srv/fnb-lis/scripts/deploy.sh <sha>
#
# Order is deliberate. Backup precedes the code change, because the step that
# can destroy data is `migrate deploy`, and a backup taken after it is a backup
# of the damage. See docs/security-runbook.md §0 and §2.
set -euo pipefail

SHA="${1:?usage: deploy.sh <commit-sha>}"
APP_DIR="${APP_DIR:-/srv/fnb-lis}"
SERVICE="${SERVICE:-fnb-lis}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3001/api/health}"

# apps/desktop pulls Electron. Nothing on a headless server runs it, and its
# postinstall downloads ~100 MB of binary that would only ever sit there.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export CI=1

cd "$APP_DIR"

echo "==> Backup before anything changes"
npm run backup -w @fnb/server

echo "==> Checkout $SHA"
git fetch --prune origin
git reset --hard "$SHA"
# -fd, never -fdx: data/ and .env are gitignored, and -x would delete the
# database and the MFA key along with the build leftovers.
git clean -fd

echo "==> Install"
# --foreground-scripts so a failed better-sqlite3 native build fails HERE
# rather than as a mysterious runtime error after the restart.
npm ci --foreground-scripts

echo "==> Prisma"
# migrate does NOT regenerate the client; generate must follow it, not precede.
npm run db:deploy -w @fnb/server
npm run db:generate -w @fnb/server

echo "==> Build web"
npm run build

echo "==> Restart"
sudo -n systemctl restart "$SERVICE"

echo "==> Health"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "healthy after ${i}s"
    exit 0
  fi
  sleep 1
done

echo "UNHEALTHY after 30s — service did not come back" >&2
sudo -n systemctl status "$SERVICE" --no-pager --lines 40 >&2 || true
exit 1
