# LIS Desktop — operator's manual

The offline desktop application. Same system as the web app, on one computer in
the establishment, working with or without internet.

Written for the **LIS administrator** installing and supporting it. Where a step
is for the establishment's own staff, it says so.

Design rationale lives in [sync-and-data-lifecycle.md](sync-and-data-lifecycle.md);
this document is how to run the thing.

---

## 1. What it is

A desktop app that carries a **full copy** of one location's records. It is not
a viewer and not a thin client — it holds the data, computes the Full Audit
locally, and keeps working when the internet does not.

| | Web app | Desktop |
| --- | --- | --- |
| Needs internet | Yes | Only to sync |
| Holds the data | On the server | On the computer, mirrored |
| Reports | Computed on the server | Computed on the machine |
| Sign in | Username + password | Username + password online; **PIN** offline |

Both can be used at the same establishment. Changes flow each way.

---

## 2. Installing and launching

### Development / testing

```bash
npm install                      # once
npm run native  -w @fnb/desktop  # after EVERY npm install — see below
npm run build   -w @fnb/web      # the desktop serves this bundle
npm run dev     -w @fnb/desktop  # bundles the server, launches the app
```

**`npm run native` is not optional.** The database driver must be built for
Electron, and a plain `npm install` builds it for Node. Skipping it gives a
`NODE_MODULE_VERSION` error at launch. Re-run it after every `npm install` —
npm removes the desktop's private copy each time.

### Packaged (for a real bar)

Not yet built — `electron-builder` config is outstanding. When it exists, the
installer will be a single `.exe`; nothing else needs installing on the machine.

---

## 3. First run: connecting to the client's account

The very first launch shows **Set up this computer**. Nobody has to pre-register
anything — a machine cannot know its own identity until the software is on it.

**Who does this:** the establishment's **OWNER**, or an **LIS ADMIN**. A MANAGER
or STAFF account will be refused, because registering a computer consumes a
licence slot and that is a commercial act.

| Field | What to enter |
| --- | --- |
| **Server address** | The establishment's LIS server, e.g. `lis.yourcompany.com`. In testing, `http://localhost:3001`. |
| **Name this computer** | What the administrator sees in the device list, e.g. "Front bar PC". |
| **Username / password** | An OWNER or LIS ADMIN account. |

Press **Connect**, choose which **location** the computer counts, then
**Download data & finish**. The app copies that location's records down and
restarts into the normal screen.

The password is **never stored**. What is kept is a device session — see §7.

### If setup is refused

| Message | Meaning |
| --- | --- |
| "That account can't set up a computer" | Not an OWNER/ADMIN. Get one to sign in once on this machine. |
| "…licence covers N computers, and N are already registered" | Revoke an old machine, or widen the licence (§6). |
| "This computer's access has been revoked" | An administrator revoked it. Reactivate it (§6). |

---

## 4. Daily use: who signs in, and how

Once provisioned, everyone uses their **own** account — the owner's setup login
is not shared.

**With internet:** username and password, exactly like the web app.

**Without internet:** a **device PIN**. Each person sets their own beforehand,
from the web app: **Settings → Offline desktop PIN**. 4–8 digits, obvious ones
refused.

> **Set PINs before the first night shift.** They are set from the web app, which
> needs internet — so a staff member who has not set one cannot sign in offline,
> and the recovery question cannot help because it is stored alongside a PIN that
> was never created.

The PIN works on the desktop only. It can never sign anyone into the website,
which is the whole reason it is a separate secret: a stolen bar computer does not
become access to the establishment's books online.

### Forgotten PIN

In the order they actually get used:

1. **Online** — set a new PIN with your password (Settings → Offline desktop PIN).
2. **A manager or owner clears it** — Administration → Users. Needs internet.
3. **Offline, last resort** — answer your own recovery question on the machine.
   Every use is recorded and reaches the administrator.

### Roles on the desktop

Identical to the web app. STAFF can record counts and sales but cannot void;
MANAGER and above can. The desktop enforces this per **person**, not per machine
— so a staff member working on a computer the owner registered still has staff
permissions.

---

## 5. Where the data lives

| What | Where |
| --- | --- |
| The mirror (all records) | `%APPDATA%\@fnb\desktop\mirror.db` |
| Machine settings + device session | `%APPDATA%\@fnb\desktop\config.json` |
| Server database | `apps/server/data/fnb.db` |

The mirror is a SQLite file with the **same schema as the server** — same
migrations, same tables. It is a real copy, not an export.

`config.json` holds the device session, encrypted against the Windows account
that set it up. Copying it to another computer gains nothing.

**Backups:** back up the *server* database. The mirror is a copy and rebuilds
itself from the server; a night of unsynced work on a machine is the exposure,
which is why §6's "last sync" column matters.

---

## 6. Managing computers (LIS admin)

**Administration → Offline Computers**, in the web app.

| Column | Means |
| --- | --- |
| Last sync | When it last successfully sent its work up |
| **Not synced recently** | No push within a shift — a report run now may be missing its work |
| Location | Which location it mirrors; changeable here |

**Revoking** cuts a machine off at its next contact with the server, and deletes
its sessions. Use it for a stolen or decommissioned computer.

> **Read the warning before revoking.** If the machine has not synced, anything
> recorded on it since has not reached the server, and revoking means it never
> will. If it is merely offline rather than gone, wait.

A revoked machine can be **reactivated** — needed when a "dead" computer turns
out to be repairable and is still holding a week of counts.

**Licence:** `maxDevices` on the establishment's subscription, default 1
(one computer per establishment, per the proposal). Raise it in
Administration → Clients.

---

## 7. Sync, in plain terms

- **Up:** everything recorded on the machine queues locally and is sent when the
  network returns. A dropped connection mid-send never duplicates anything — a
  retry lands on the same records.
- **Down:** the machine pulls what changed elsewhere and merges it, never
  overwriting work still waiting to go up.
- **Timestamps:** a record keeps the time it was *actually* entered, not the time
  it was sent. Business dates are whatever the user typed and are never adjusted.

### Two things to know

**An open count belongs to where it was started.** A count opened on the bar PC
is read-only in the web app until it is committed, and vice versa. The web app
shows *"On Front bar PC"*. If that machine is genuinely gone, an owner can
**Release** the draft (Counts screen) to move it.

**Both places can record the same real event.** If staff enter a delivery on the
desktop and the manager enters the same delivery on a laptop, that is two
records, and no software can tell them apart from a genuine repeat delivery.
Agree who records what. Suspected pairs are listed for review.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **"LIS could not start"** | The local database service failed. Most often the native module was not rebuilt — run `npm run native -w @fnb/desktop`. |
| Launches to setup again | `config.json` is missing or was copied from another machine (the session cannot decrypt). Re-run setup. |
| Staff cannot sign in offline | They never set a PIN. Needs internet once, from the web app. |
| Reports differ from the website | The machine has unsynced work, or has not pulled recently. Check Administration → Offline Computers. |
| Cannot edit prices offline | Deliberate. Prices, weights, suppliers and recipes need internet — a stale offline price edit would silently restate valuations. |
| Nothing appears in the window | Check the app is serving: it listens on `127.0.0.1` on a random port. See below. |

### Getting logs on Windows

Electron discards console output on Windows, so a startup failure shows **only**
the error dialog. To see the real error, run the server bundle directly:

```bash
ELECTRON_RUN_AS_NODE=1 FNB_DB_FILE=%APPDATA%\@fnb\desktop\mirror.db FNB_LOCAL_DB=%APPDATA%\@fnb\desktop\mirror.db FNB_MIGRATIONS_DIR=../server/prisma/migrations FNB_WEB_DIST=../web/dist npx electron dist/host.mjs
```

### Proving a machine's numbers are right

```bash
npm run verify:mirror -w @fnb/desktop
```

Registers a device against a running server, pulls a real snapshot into a
throwaway mirror, and asserts the two golden anchors reproduce off it. This is
the check that proves the desktop and the server agree — row counts do not.

---

## 9. What is not built yet

Honest list, so nobody plans around something that does not exist:

- **Installer / packaging.** Runs from source only.
- **Sync status in the app.** The engine exists; the on-screen banner, the
  "synced N minutes ago" indicator and the conflict inbox are not wired up.
- **The PIN unlock screen.** PINs can be set and are delivered to the machine,
  but the offline unlock UI and its local lockout are not built.
- **Automatic background sync.** Push/pull/reconcile exist and are tested; they
  are not yet on a timer.
- **Licence enforcement at startup** (proposal §20). The server half is done.
