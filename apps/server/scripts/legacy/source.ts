/**
 * Read-only access to the legacy FnB/LIS MySQL database.
 *
 * SETUP (once, before any import run).
 *
 * This reads from an ISOLATED, THROWAWAY MariaDB instance, not from XAMPP's.
 * XAMPP's MariaDB (port 3307) currently listens but drops every connection at
 * handshake — its InnoDB reports "log sequence number is in the future", so
 * startup never completes. Its data directory also holds ~15 unrelated project
 * databases, so repairing it is a separate decision with its own risk. The
 * legacy dump does not need any of that: it needs a SQL engine that can parse a
 * mysqldump, and any instance will do.
 *
 *   MDB="/c/Program Files/MariaDB 11.4/bin"
 *   "$MDB/mariadb-install-db.exe" --datadir="C:/temp/fnb-legacy-db" --port=3399
 *   "$MDB/mariadbd.exe" --defaults-file="C:/temp/fnb-legacy-db/my.ini" --datadir="C:/temp/fnb-legacy-db" --port=3399 --console --skip-grant-tables --bind-address=127.0.0.1 &
 *   "$MDB/mariadb.exe" --protocol=TCP -h127.0.0.1 -P3399 -uroot -e "DROP DATABASE IF EXISTS fnb_legacy; CREATE DATABASE fnb_legacy CHARACTER SET utf8mb4;"
 *   "$MDB/mariadb.exe" --protocol=TCP -h127.0.0.1 -P3399 -uroot fnb_legacy < "C:/xampp/htdocs/fnb-main/fnb.sql"
 *
 * TEAR DOWN when the migration is done: stop mariadbd, `rm -rf C:/temp/fnb-legacy-db`.
 * Nothing in the running system reads from it.
 *
 * To point at XAMPP's instead once it is repaired:
 *   FNB_MYSQL_BIN="C:/xampp/mysql/bin/mysql.exe" FNB_MYSQL_PORT=3307
 *
 * WHY NOT PARSE fnb.sql DIRECTLY. Two hand-written parsers were attempted while
 * designing this migration and both silently mis-read the dump: the first
 * reported 114 rows where there are 48,322 (it counted `),(` separators, but the
 * dump puts one tuple per line), the second reported 494 catalog rows where
 * there are 2,156 (it used a non-global regex and saw only the first INSERT
 * chunk per table — mysqldump splits them). Both looked like they worked.
 *
 * A migration whose reader is silently wrong produces a database that is
 * plausibly, undetectably incorrect — which for an audit system is the worst
 * possible failure. MariaDB is already installed and parses its own dumps
 * correctly. Use it.
 *
 * Every caller SELECTs a single JSON_OBJECT(...) column and gets one JSON object
 * per line back. `--raw` is required or MySQL escapes the JSON and parsing fails.
 */
import { execFileSync } from "node:child_process";

const MYSQL = process.env.FNB_MYSQL_BIN ?? "C:/Program Files/MariaDB 11.4/bin/mariadb.exe";
const DB = process.env.FNB_LEGACY_DB ?? "fnb_legacy";
const USER = process.env.FNB_MYSQL_USER ?? "root";
const HOST = process.env.FNB_MYSQL_HOST ?? "127.0.0.1";
// The isolated instance above. NOT 3306 (never used here) and not 3307 (XAMPP's,
// currently unable to complete startup). A wrong default produces a confusing
// "can't connect" rather than anything that points at the port, which is why
// assertReachable() below names the port and the config file explicitly.
const PORT = process.env.FNB_MYSQL_PORT ?? "3399";

function args(extra: string[]): string[] {
  return [
    "--protocol=TCP",
    `--host=${HOST}`,
    `--port=${PORT}`,
    `--user=${USER}`,
    "--password=",
    "--connect-timeout=8",
    "--default-character-set=utf8mb4",
    ...extra,
  ];
}

/**
 * Fail early and specifically. Without this the first stage dies mid-run with a
 * connection error that reads like a bug in the stage.
 */
export function assertReachable(): void {
  try {
    execFileSync(MYSQL, args(["--batch", "--skip-column-names", "-e", "SELECT 1"]), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(
      `Cannot reach the legacy MySQL server at ${HOST}:${PORT}.\n` +
        `  - Is MariaDB running?  (XAMPP control panel)\n` +
        `  - Is it on ${PORT}?     (C:/xampp/mysql/bin/my.ini, [mysqld] port=)\n` +
        `  - If the handshake is dropped, check C:/xampp/mysql/data/mysql_error.log —\n` +
        `    an InnoDB "log sequence number is in the future" error means the server\n` +
        `    listens but never finishes starting.\n` +
        `Original: ${(e as Error).message}`,
    );
  }
}

/** Run a query that selects ONE JSON_OBJECT column; returns one object per row. */
export function query<T>(sql: string): T[] {
  const out = execFileSync(MYSQL, args(["--batch", "--raw", "--skip-column-names", DB, "-e", sql]), {
    encoding: "utf8",
    // 21,991 trail rows of JSON comfortably exceeds the 1 MB default.
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const rows: T[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t) as T);
    } catch {
      throw new Error(`Legacy row did not parse as JSON. Is the SELECT a single JSON_OBJECT()?\n  ${t.slice(0, 200)}`);
    }
  }
  return rows;
}

/** Convenience for counts and other single scalars. */
export function scalar(sql: string): string {
  return execFileSync(MYSQL, args(["--batch", "--skip-column-names", DB, "-e", sql]), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
