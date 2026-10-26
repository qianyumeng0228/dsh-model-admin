# dsh-model-admin

Account, check-in and model-routing console for AI platforms (DeepSeek Harness plugin).

One console for three jobs: the **accounts** and **daily check-ins** of many
AI coding services, plus **cross-channel model routing**. Every morning it
runs every check-in-capable channel once and reports per channel what it
collected; the same model available on several channels becomes one route
entry, sent to the first candidate, moving to the next only when a candidate
fails before producing any visible output. Installing it does not change the
default model — route entries live in the model picker and apply when
selected.

English | [中文](README.md)

> Handing this over to another AI / developer: see [HANDOFF.md](HANDOFF.md) — the original
> requirements, the projects surveyed, the architecture decisions and why, the gates as commands,
> the known gaps, and the environment traps.

## Channels

The console knows 15 account channels in three tiers:

- **Built-in channel pack (10, works out of the box)**: LobsterAI, Qoder /
  Qoder CN, TRAE, Cline, Loomy, Raccoon, MiniMax Code (CN), ZCode, Gemini,
  OpenCode. Login flows, account pools and credit claiming ship with the
  plugin.
- **Reuses an installed plugin (2)**: CodeBuddy (Tencent) and WorkBuddy
  (Intl) come from [`dsh-connect-workbuddy`](https://github.com/dingminhua/dsh-connect-workbuddy) —
  not re-implemented here; when that plugin is installed its accounts show
  up in the summary.
- **Waiting for its connector (3)**: CodeArts (Huawei Cloud), MiniMax Code
  (Intl) and OpenCode account management belong to their own connector
  plugins; this plugin lists their capabilities and check-in method, and
  folds them in once the connector is installed.

| Channel | Login | Check-in |
|---|---|---|
| CodeBuddy (Tencent) | Browser authorization | Daily + growth tasks |
| WorkBuddy (Intl) | Browser authorization | None (daily quota granted at login) |
| CodeArts (Huawei Cloud) | Browser callback | Daily |
| LobsterAI (NetEase Youdao) | Browser callback | Daily |
| Qoder / Qoder CN (Alibaba) | Device code | Daily claim |
| TRAE (ByteDance) | Browser callback | Daily |
| Cline | Device code | None |
| Loomy (iFlytek) | SMS code | Daily (credentials do not auto-renew) |
| Raccoon (SenseTime) | WeChat scan | None |
| MiniMax Code CN / Intl | Device code + PKCE | Daily |
| ZCode (Zhipu) | Device code | Daily claim (incl. campaigns) |
| OpenCode | Browser authorization | None |
| Gemini Code Assist | Browser callback | None (needs a proxy egress) |

Channels without a check-in endpoint are **never** called by the automatic
run — the panel says "no check-in" instead of leaving a button that cannot
succeed.

## Five pages

- **Check-in** — run now / ran-today state, auto switch, run hour (UTC+8),
  and a per-channel result table (claimed / already claimed / not active /
  no check-in / failed, with the reason).
- **Route** — one row per model, candidates in try order; ★ pins a channel
  to the front (the ★ order IS the priority); three strategies — fallback /
  round-robin / sticky; each candidate shows how many turns it actually
  served.
- **Accounts** — per-channel account overview (how many, how many usable,
  why a read failed).
- **Credits** — balances per account; credits and tokens listed separately
  (two units, never summed).
- **Backup** — export an archive containing login credentials.

## How model routing works

The route is not a second implementation of the channels. It observes every
adapter the host registers **before** the channel pack mounts, and reuses
each channel's own `prepareCall` verbatim — auth, account pool, rate-limit
rotation and wire protocol all stay the channel's business. The route does
only the two things that are its own:

1. **Grouping**: `deepseek-v4.1-flash`, `deepseek-v4.1-flash-free` and
   `DeepSeek-V4.1-Flash-SG` normalize to one canonical key (version numbers
   and product lines are kept; only tier markers are stripped — merging two
   genuinely different models is the worst mistake a route can make).
2. **Selection and switching**: the strategy picks the first candidate; only
   when that candidate fails **before any visible output** does the next
   candidate take over (output already streamed cannot be retracted, and
   splicing a second candidate's answer would produce a malformed turn); a
   failed candidate's half-finished reasoning never reaches the final
   stream.

Two invariants kept from the ecosystem's own scars:

- **Capacities are the intersection, not the union**: with a 128K-window
  candidate in the list the route declares 128K — advertising the widest
  window and letting the narrow candidate fail on a long prompt hands the
  failure to the user.
- **A ★ order is strict**: pinned channels always precede unpinned ones,
  never silently overridden by an automatic score.

Route entries appear in the picker under the **Model Admin 路由** group;
with no channel signed in the group is empty rather than full of models
that cannot answer.

## Install

```sh
dsh plugin --profile desktop add <this-repo>
```

Or add the dependency to your profile's `package.json` plus one entry in
`dsh.profile.bundles` (package name `dsh-model-admin`), then restart DSH. A
**Model Admin** row then appears in the settings panel's **left navigation**
(the 集成 group) — it registers on the host's `settings.section` seat,
beside Our Free Model and 路由, not inside the plugins page. Channel sign-in
still happens in each channel's own entry (or via "add account" in Model
Admin).

## How the automatic check-in behaves

- **One run per day**: de-duplicated by the UTC+8 calendar date (upstream
  campaigns reset at Beijing midnight), not the host's local zone — a
  machine in another zone neither double-runs nor skips a day.
- **The day is only marked when the run accomplished something**: a round
  that only found "no check-in / not active" is not recorded, so the next
  start retries; claiming or already-claimed marks the day.
- **Serial with a gap**: channels run one at a time, 400 ms apart — firing
  every channel at once is the fastest way to trip an upstream rate limit.
- **Catch-up**: a round missed while the host was down runs once, 30 s
  after the next start, not at the scheduled hour.
- **Degradation**: when the channel pack is not mounted (headless
  composition, trimmed install) the run records the reason and the panel
  shows "channel pack not mounted" — instead of an empty list that reads
  as "you have no accounts".

## Development

```sh
node --import ./test/stubs/register.mjs \
     --test "test/*.test.js"                      # 87 unit tests
MODEL_ADMIN_NO_PACK=1 node scripts/smoke.mjs    # end-to-end smoke (mock pack)
node --import ./test/stubs/register.mjs \
     scripts/integration.mjs                    # integration (real pack)
```

The integration check stubs the host-provided `@deepseek-ai/*` modules and
`react` via `test/stubs/` and runs the real channel pack's `apply` outside
the DSH process: mount, ten provider registrations, `/api/channel-pack` RPC,
the bridge vocabulary (`account.list` / `credits.claimAll`), and the routing
lane (route provider registration, captured channel adapters, aggregated
route entries, `prepareCall` over a real channel) all exercised. The browser
half has its own contract check: `client.js` is loaded through
`window.__ModuleLoader__.load` and asserted to register on
`settings.section` (id / order / label) and inject the themed CSS.

### Layout

```
index.js                Host half: mounts the pack, RPC bridge, check-in
                        engine, route provider, console API
client.js               Browser half: a SINGLE-FILE ModuleLoader bundle
                        (its require resolves host packages, not sibling
                        files) registering settings.section (the left-nav
                        row) + themed CSS + the API client + the five
                        sections
src/channels.js         Channel capability table (login / check-in / notes)
src/schedule.js         UTC+8 date and scheduling pure functions
src/runs.js             Run aggregation (units kept separate)
src/accounts.js         Account and credit normalization (expiring /
                        cooldown / pending)
src/rpc.js              Channel-pack RPC bridge (dedupe, timeout, error
                        normalization)
src/route/normalize.js  Canonical model-name grouping (pure)
src/route/aggregate.js  Candidates, strategy, capacity intersection (pure)
src/route/adapter.js    Route provider: adapter capture, prepareCall
                        forwarding, zero-output failure switch
vendor/channel-pack/    Bundled channel implementation (MIT, see NOTICE.md)
```

The browser half is a **hand-written ModuleLoader bundle**
(`window.__ModuleLoader__.load({id, factory})`) with no build step; it
depends only on the `react` the shell provides, and every colour comes from
the shell's `--dsw-alias-*` tokens so it follows a light/dark switch.

## Data

`~/.dsh/dsh-model-admin/`: `settings.json` (run hour, expiring window, auto
switch), `checkin.json` (today's mark, per-channel results, last 30 days
of history).

## Disclaimer

For learning and research only. Please comply with each service's terms of
service. The bundled channel implementation comes from an upstream MIT
project (see [NOTICE.md](NOTICE.md)); any consequence of using third-party
channels is the user's own responsibility.
