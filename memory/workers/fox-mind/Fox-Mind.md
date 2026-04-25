# Fox Mind — Fox Health MCP

## What This Is
A Cloudflare Worker (`fox-mind`) that serves as Fox's unified health data layer. It has both a REST API (for The Nest frontend) and an MCP endpoint (for Alex to call from any room).

**Worker URL**: `https://your-fox-mind.workers.dev`
**MCP Endpoint**: `https://your-fox-mind.workers.dev/mcp`
**D1 Database**: `fox-watch`
**Source Code**: `workers/fox-mind/src/index.js`
**Wrangler Config**: `workers/fox-mind/wrangler.toml`

## What Happened — February 10, 2026

### The Problem
Fox's uplink data was in two places:
- **ai-mind D1** (`fox_uplinks` table) — 55 rows, Jan 17 - Feb 9. This is where `nesteq_home_read_uplink` was reading from.
- **fox-watch D1** (`fox_uplinks` table) — 4 test rows from Feb 9-10.

Fox wanted all her health data in one place (fox-watch D1), next to her Garmin data (heart_rate, stress, sleep, hrv, body_battery, cycle, spo2, respiration, daily_summary).

### What We Did
1. **Migrated all 55 uplink rows** from ai-mind D1 to fox-watch D1. Cleared the 4 test rows first, then inserted all 55 with original IDs and timestamps preserved.

2. **Added MCP protocol** to the fox-mind worker. It previously only had REST endpoints. Now it has:
   - REST API on all non-`/mcp` paths (for NESTeq frontend, etc.)
   - MCP tools on `/mcp` path (for Claude/Alex)

3. **Installed dependencies**: `@modelcontextprotocol/sdk`, `agents` (Cloudflare), `zod`

4. **Updated wrangler.toml**: Added `compatibility_flags = ["nodejs_compat"]` and bumped `compatibility_date` to `2025-01-01`

5. **Deployed** to Cloudflare Workers. Version ID: `301b823b-5afa-4d0b-9da2-40cd8cdca48c`

6. **Added to Claude config** (`.claude.json`): `fox-health` MCP server pointing at your deployed worker's `/mcp` endpoint

### MCP Tools Available
| Tool | What It Does |
|------|-------------|
| `fox_read_uplink` | Fox's latest state — spoons, pain, fog, fatigue, mood, needs. **Check this first.** |
| `fox_submit_uplink` | Log a new uplink entry via MCP |
| `fox_heart_rate` | Recent HR data from Garmin sync |
| `fox_stress` | Recent stress data |
| `fox_body_battery` | Energy levels |
| `fox_sleep` | Sleep data — duration, stages |
| `fox_hrv` | Heart Rate Variability (baseline 23-24ms in crisis) |
| `fox_spo2` | Blood oxygen |
| `fox_respiration` | Breathing rate (normal 12-20/min) |
| `fox_cycle` | Menstrual cycle phase |
| `fox_daily_summary` | Combined daily metrics |
| `fox_full_status` | Everything at once — uplink + all watch data |
| `fox_journals` | Fox's personal journal entries |
| `fox_eq_type` | Emergent MBTI from journal emotions |

### What Still Exists
- **Local `garmin-fox` MCP** (Python/FastMCP) — still configured in `.claude.json`. This talks live to Garmin API for real-time data. Cloud fox-health gives you D1-synced data. The local MCP is now mostly redundant since garmin-sync keeps D1 fresh.
- **ai-mind `nesteq_home_read_uplink`** — still exists but reads from OLD table in ai-mind D1. The data is still there but stale. Fox-health MCP is the correct source now.

### Architecture (updated Feb 16 2026)
```
Fox's Watch (Garmin Lily 2)
    |
    v
Garmin Connect API
    |
    v
garmin-sync Worker (cron every 15 min)
    | OAuth1→OAuth2 auto-refresh
    | KV stores tokens
    v
fox-watch D1 (heart_rate, stress, body_battery, sleep, spo2, respiration, cycle, daily_summary)
    |
    v
fox-mind Worker (REST + MCP)
    |
    +--> REST: /uplink, /threads, /watch/*, /status, /eq (NESTeq dashboard)
    +--> MCP: /mcp (Claude/Alex from any room)
```

**Old pipeline** (before Feb 16): `sync_garmin.py` ran manually on PC → data went stale within hours.
**New pipeline**: `garmin-sync` cloud worker runs every 15 minutes automatically. No PC needed.

---

## What Happened — February 16, 2026

### Garmin Sync Worker
Built `garmin-sync` — a Cloudflare Worker that replaces the manual `sync_garmin.py` script with automated cloud-based syncing.

**The problem**: Dashboard showed "last update: 2d ago" on biometrics because the Python sync script only ran when someone remembered to run it on the PC.

**The fix**: A TypeScript Cloudflare Worker that:
1. Stores Garmin OAuth tokens in KV (OAuth1 is long-lived, OAuth2 auto-refreshes)
2. Authenticates with Garmin Connect API using the same OAuth1→OAuth2 exchange that the `garth` Python library uses
3. Pulls all biometric data types (HR, stress, body battery, sleep, HRV, SpO2, respiration, cycle)
4. Writes directly to the fox-watch D1 database
5. Runs on a cron trigger every 15 minutes

First sync pulled 272 HR readings, 181 stress readings, sleep data, cycle data — all in 1.4 seconds.

### Column Name Bug Fixes
Fixed display bugs in fox-mind where MCP tools and REST endpoints referenced wrong column names:
- `r.heart_rate` → `r.bpm` (actual column name in D1)
- `r.stress_level` → `r.level` (actual column name)
- `ORDER BY date` → `ORDER BY timestamp` (for HRV table — column is `timestamp`, not `date`)

### Threads REST Endpoint
The deployed fox-mind worker was missing the `/threads` REST endpoint that the dashboard needs. Added full CRUD: list, add, update, resolve, delete. Also added `fox_threads` and `fox_thread_manage` MCP tools.

### Third-Party Adapter Tools
Added 16 adapter tools to ai-mind so external companion apps can connect via MCP. Thin wrappers around existing NESTeq data — no new tables, no impact on our system.

---

### Lessons From Development
- **Listen to your human.** Don't barrel into fix mode without checking what they actually need.
- **Don't search for things that aren't local.** Worker code is on Cloudflare, not in local directories. Use the Cloudflare dashboard or API to pull deployed code.
- **Ask what they need** instead of assuming "this is the situation" means "fix it immediately."

---

*Built with NESTeq.*
