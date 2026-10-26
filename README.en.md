# model-admin

Account & check-in console for AI platforms (DeepSeek Harness plugin).

One console for the **accounts** and **daily check-ins** of many AI coding
services: every morning it runs every check-in-capable channel once and
reports per channel what it collected; the panel summarizes balances,
expiring credits and run history. **It registers no model route** —
installing it does not change which model a conversation uses. It is the
management surface, nothing else.

English | [中文](README.md)

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

## Four pages

- **Check-in** — run now / ran-today state, auto switch, run hour (UTC+8),
  and a per-channel result table (claimed / already claimed / not active /
  no check-in / failed, with the reason).
- **Accounts** — per-channel account overview (how many, how many usable,
  why a read failed).
- **Credits** — balances per account; credits and tokens listed separately
  (two units, never summed).
- **Backup** — export an archive containing login credentials.

## Install

```sh
dsh plugin --profile desktop add <this-repo>
```

Or add the dependency to your profile's `package.json` plus one entry in
`dsh.profile.bundles` (package name `model-admin`), then restart DSH. A
**Model Admin** tab appears in the settings panel. Channel sign-in still
happens in each channel's own entry (or via "add account" in Model Admin).

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
node --test "test/*.test.js"                    # 46 unit tests
MODEL_ADMIN_NO_PACK=1 node scripts/smoke.mjs    # end-to-end smoke (mock pack)
node --import ./test/stubs/register.mjs \
     scripts/integration.mjs                    # integration (real pack)
```

The integration check stubs the host-provided `@deepseek-ai/*` modules via
`test/stubs/` and runs the real channel pack's `apply` outside the DSH
process: mount, ten provider registrations, `/api/channel-pack` RPC, and
the bridge vocabulary (`account.list` / `credits.claimAll`) all exercised.

### Layout

```
index.js              Host half: mounts the pack, RPC bridge, check-in
                      engine, console API
client.js             Browser half: settings panel entry and API client
src/channels.js       Channel capability table (login / check-in / notes)
src/schedule.js       UTC+8 date and scheduling pure functions
src/runs.js           Run aggregation (units kept separate)
src/accounts.js       Account and credit normalization (expiring /
                      cooldown / pending)
src/rpc.js            Channel-pack RPC bridge (dedupe, timeout, error
                      normalization)
src/client/panel.js   Panel rendering (four pages)
vendor/channel-pack/  Bundled channel implementation (MIT, see NOTICE.md)
```

## Data

`~/.dsh/model-admin/`: `settings.json` (run hour, expiring window, auto
switch), `checkin.json` (today's mark, per-channel results, last 30 days
of history).

## Disclaimer

For learning and research only. Please comply with each service's terms of
service. The bundled channel implementation comes from an upstream MIT
project (see [NOTICE.md](NOTICE.md)); any consequence of using third-party
channels is the user's own responsibility.
