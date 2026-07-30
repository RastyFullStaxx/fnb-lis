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

```bash
npm run dist -w @fnb/desktop
```

Produces `apps/desktop/release/LIS Setup <version>.exe` (~90 MB). That single
file is everything — the bar PC needs no Node, no database, nothing pre-installed.

Installing it:

1. Double-click the setup file and choose a folder (the default is fine).
2. It installs **per user**, so no administrator password is needed.
3. You get an **LIS** icon on the desktop and in the Start Menu. Staff click that.

**Windows will warn you the first time.** The installer is not code-signed, so
SmartScreen shows "Windows protected your PC". Click *More info* → *Run anyway*.
This is expected and will keep happening until a signing certificate is bought;
see §9.

To uninstall: Settings → Apps → LIS, or `Uninstall LIS.exe` in the install
folder. **The mirror, device identity and PINs survive an uninstall** — deleting
an establishment's un-synced counts because someone reinstalled is not a
recoverable mistake. To wipe a machine completely, delete
`%APPDATA%\@fnb\desktop` as well.

> Build notes for whoever maintains this:
>
> - `npm run native` must have been run since the last `npm install`, otherwise
>   the packaged app ships a Node-ABI driver and dies at the first query.
>   `npmRebuild: false` is set deliberately — letting electron-builder rebuild
>   would clobber the root copy that `verify:seed` and the dev server use.
> - electron-builder **26+** is required. v25's dependency collector mishandles
>   npm workspace hoisting and silently omits `call-bind-apply-helpers`, which
>   only shows up as the local server dying at launch.
> - **Do not let a sync client watch `apps/desktop/release`.** A rebuild that
>   fails with `EBUSY` on `release\...\app.asar` means something has a handle on
>   the previous build. On the current dev machine that is Google Drive: it holds
>   a ~90 MB asar open, and because it is a filesystem filter no process shows up
>   in Restart Manager and neither `del`, `rd`, nor renaming the parent directory
>   works. Only a reboot or pausing Drive releases it.
>
>   Uploading a 90 MB installer to the cloud on every build is worth avoiding on
>   its own. Exclude `apps/desktop/release` from the sync client, or build
>   outside the synced tree:
>   `npx electron-builder -c.directories.output=%TEMP%\lis-build`.

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

Two files in `%APPDATA%\@fnb\desktop`, and they are the first thing to ask for:

| File | What it tells you |
|---|---|
| `startup.log` | One line per launch: where the data is, whether this machine is provisioned, which device and location it thinks it is. |
| `host.log` | Everything the local server printed, including the stack trace of whatever killed it. |

`host.log` exists because Windows gives a packaged app no console — without it a
failed launch shows "exited with code 1" and nothing else, on a machine that is
usually behind a bar.

If both are silent, run the server bundle directly:

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

- **Code signing.** The installer works but is unsigned, so every machine shows
  SmartScreen's "Windows protected your PC" on first run. A certificate is
  ~$100–400/year and is a commercial decision, not a technical one. Once bought,
  add `certificateFile` + `certificatePassword` under `win:` in
  `apps/desktop/electron-builder.yml` — nothing else changes.
- **Auto-update.** Each new version is a fresh installer someone has to run.
- **Licence enforcement at startup** (proposal §20). The server half is done —
  registration is capped and revocable — but the app does not check at launch.
- **Conflict resolution actions.** The inbox lists what the server refused and
  lets you dismiss an entry; it cannot yet edit-and-retry one.

### A note for developers

`verify:mirror` needs one free licence slot, and a provisioned desktop holds it.
On a dev machine running both, set `Subscription.maxDevices = 2` for the test
client. The shipped default stays 1, matching §18.
