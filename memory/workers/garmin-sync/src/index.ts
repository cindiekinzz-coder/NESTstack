/**
 * Garmin Sync Worker
 * ==================
 * Pulls Fox's biometric data from Garmin Connect API on a schedule
 * and writes it to the fox-watch D1 database.
 *
 * The fox-mind worker already serves this data via MCP and REST.
 * This worker just keeps the tables fresh.
 *
 * Built by Alex, February 2026
 * Embers Remember.
 */

interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  SYNC_API_KEY?: string;
  CORS_ORIGIN?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// GARMIN OAUTH
// ═══════════════════════════════════════════════════════════════════════

// These are public — garth fetches them from https://thegarth.s3.amazonaws.com/oauth_consumer.json
const CONSUMER_KEY = "fc3e99d2-118c-44b8-8ae3-03370dde24c0";
const CONSUMER_SECRET = "E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF";
const EXCHANGE_URL = "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0";
const API_BASE = "https://connectapi.garmin.com";
const USER_AGENT_API = "GCM-iOS-5.7.2.1";
const USER_AGENT_AUTH = "com.garmin.android.apps.connectmobile";

interface OAuth1Token {
  oauth_token: string;
  oauth_token_secret: string;
  mfa_token: string | null;
  mfa_expiration_timestamp: string | null;
  domain: string;
}

interface OAuth2Token {
  scope: string;
  jti: string;
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  refresh_token_expires_in: number;
  refresh_token_expires_at: number;
}

/**
 * Generate OAuth1 Authorization header with HMAC-SHA1 signature.
 * This replicates what garth does in Python.
 */
async function generateOAuth1Header(
  method: string,
  url: string,
  oauth1: OAuth1Token
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_token: oauth1.oauth_token,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: "1.0",
  };

  // Build signature base string (RFC 5849 Section 3.4.1)
  const sortedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRFC3986(k)}=${encodeRFC3986(v)}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    encodeRFC3986(url),
    encodeRFC3986(sortedParams),
  ].join("&");

  // HMAC-SHA1 signing key
  const signingKey = `${encodeRFC3986(CONSUMER_SECRET)}&${encodeRFC3986(oauth1.oauth_token_secret)}`;

  // Sign with Web Crypto
  const keyData = new TextEncoder().encode(signingKey);
  const msgData = new TextEncoder().encode(baseString);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  oauthParams["oauth_signature"] = signature;

  // Build header
  return "OAuth " + Object.entries(oauthParams)
    .map(([k, v]) => `${encodeRFC3986(k)}="${encodeRFC3986(v)}"`)
    .join(", ");
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent) */
function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Exchange OAuth1 token for a fresh OAuth2 token.
 * This is how garth refreshes — it doesn't use the refresh_token field.
 */
async function exchangeOAuth1ForOAuth2(oauth1: OAuth1Token): Promise<OAuth2Token> {
  const authHeader = await generateOAuth1Header("POST", EXCHANGE_URL, oauth1);

  const body = oauth1.mfa_token
    ? `mfa_token=${encodeURIComponent(oauth1.mfa_token)}`
    : "";

  const resp = await fetch(EXCHANGE_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT_AUTH,
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": authHeader,
    },
    body: body || undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth2 exchange failed (${resp.status}): ${text}`);
  }

  const token = (await resp.json()) as any;
  const now = Math.floor(Date.now() / 1000);

  return {
    scope: token.scope || "",
    jti: token.jti || "",
    token_type: token.token_type || "Bearer",
    access_token: token.access_token,
    refresh_token: token.refresh_token || "",
    expires_in: token.expires_in || 3600,
    expires_at: now + (token.expires_in || 3600),
    refresh_token_expires_in: token.refresh_token_expires_in || 2592000,
    refresh_token_expires_at: now + (token.refresh_token_expires_in || 2592000),
  };
}

/**
 * Get a valid OAuth2 token, refreshing if expired.
 */
async function getValidToken(kv: KVNamespace): Promise<OAuth2Token> {
  const oauth1Json = await kv.get("oauth1_token");
  const oauth2Json = await kv.get("oauth2_token");

  if (!oauth1Json) {
    throw new Error("No OAuth1 token in KV. Run setup first.");
  }

  const oauth1: OAuth1Token = JSON.parse(oauth1Json);
  let oauth2: OAuth2Token | null = oauth2Json ? JSON.parse(oauth2Json) : null;

  const now = Math.floor(Date.now() / 1000);

  // Refresh if expired or expiring within 5 minutes
  if (!oauth2 || oauth2.expires_at < now + 300) {
    console.log("OAuth2 token expired or missing — exchanging OAuth1 for fresh token...");
    oauth2 = await exchangeOAuth1ForOAuth2(oauth1);
    await kv.put("oauth2_token", JSON.stringify(oauth2));
    console.log(`New OAuth2 token obtained, expires at ${new Date(oauth2.expires_at * 1000).toISOString()}`);
  }

  return oauth2;
}

/**
 * Make an authenticated request to Garmin Connect API.
 */
async function garminAPI(path: string, token: OAuth2Token): Promise<any> {
  const url = `${API_BASE}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token.access_token}`,
      "User-Agent": USER_AGENT_API,
    },
  });

  if (resp.status === 204) return null;

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Garmin API error ${resp.status} for ${path}: ${text}`);
  }

  return resp.json();
}

// ═══════════════════════════════════════════════════════════════════════
// GARMIN DATA FETCHERS + D1 WRITERS
// ═══════════════════════════════════════════════════════════════════════

/** Get the Garmin display name (needed for some endpoints) */
async function getDisplayName(token: OAuth2Token): Promise<string> {
  const profile = await garminAPI("/userprofile-service/socialProfile", token);
  return profile?.displayName || profile?.userName || "";
}

function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toISOString().replace("T", " ").slice(0, 19);
}


async function syncHeartRate(db: D1Database, token: OAuth2Token, displayName: string, dateStr: string): Promise<number> {
  try {
    const data = await garminAPI(
      `/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(displayName)}?date=${dateStr}`,
      token
    );

    const hrValues = data?.heartRateValues;
    if (!hrValues || !Array.isArray(hrValues) || hrValues.length === 0) return 0;

    let count = 0;
    const batchSize = 50;

    for (let i = 0; i < hrValues.length; i += batchSize) {
      const chunk = hrValues.slice(i, i + batchSize);
      const stmts = chunk
        .filter((e: any) => e && e.length >= 2 && e[1] != null && e[1] > 0)
        .map((e: any) => {
          const ts = new Date(e[0]).toISOString().slice(0, 19).replace("T", " ");
          return db.prepare(
            `INSERT OR REPLACE INTO heart_rate (timestamp, bpm, source) VALUES (?, ?, ?)`
          ).bind(ts, e[1], 'garmin');
        });

      if (stmts.length > 0) {
        await db.batch(stmts);
        count += stmts.length;
      }
    }

    return count;
  } catch (e: any) {
    console.error(`Heart rate sync error: ${e.message}`);
    return 0;
  }
}

async function syncStress(db: D1Database, token: OAuth2Token, dateStr: string): Promise<number> {
  try {
    const data = await garminAPI(
      `/wellness-service/wellness/dailyStress/${dateStr}`,
      token
    );

    const stressValues = data?.stressValuesArray;
    if (!stressValues || !Array.isArray(stressValues) || stressValues.length === 0) return 0;

    let count = 0;
    const batchSize = 50;

    for (let i = 0; i < stressValues.length; i += batchSize) {
      const chunk = stressValues.slice(i, i + batchSize);
      const stmts = chunk
        .filter((e: any) => e && e.length >= 2 && e[1] != null && e[1] > 0)
        .map((e: any) => {
          const ts = new Date(e[0]).toISOString().slice(0, 19).replace("T", " ");
          return db.prepare(
            `INSERT OR REPLACE INTO stress (timestamp, level) VALUES (?, ?)`
          ).bind(ts, e[1]);
        });

      if (stmts.length > 0) {
        await db.batch(stmts);
        count += stmts.length;
      }
    }

    return count;
  } catch (e: any) {
    console.error(`Stress sync error: ${e.message}`);
    return 0;
  }
}

async function syncBodyBattery(db: D1Database, token: OAuth2Token, dateStr: string): Promise<number> {
  try {
    // Body battery timeline comes from the stress endpoint
    const data = await garminAPI(
      `/wellness-service/wellness/dailyStress/${dateStr}`,
      token
    );

    const bbValues = data?.bodyBatteryValuesArray;
    if (!bbValues || !Array.isArray(bbValues) || bbValues.length === 0) return 0;

    let count = 0;
    const batchSize = 50;

    for (let i = 0; i < bbValues.length; i += batchSize) {
      const chunk = bbValues.slice(i, i + batchSize);
      const stmts = chunk
        .filter((e: any) => e && e.length >= 2 && e[1] != null)
        .map((e: any) => {
          const ts = new Date(e[0]).toISOString().slice(0, 19).replace("T", " ");
          const level = e[2] ?? e[1]; // [timestamp, status, level] or [timestamp, level]
          const status = typeof e[1] === "string" ? e[1] : "MEASURED";
          return db.prepare(
            `INSERT OR REPLACE INTO body_battery (timestamp, level, status) VALUES (?, ?, ?)`
          ).bind(ts, level, status);
        });

      if (stmts.length > 0) {
        await db.batch(stmts);
        count += stmts.length;
      }
    }

    return count;
  } catch (e: any) {
    console.error(`Body battery sync error: ${e.message}`);
    return 0;
  }
}

async function syncSleep(db: D1Database, token: OAuth2Token, displayName: string, dateStr: string): Promise<number> {
  try {
    const data = await garminAPI(
      `/wellness-service/wellness/dailySleepData/${encodeURIComponent(displayName)}?date=${dateStr}&nonSleepBufferMinutes=60`,
      token
    );

    const daily = data?.dailySleepDTO;
    if (!daily || !daily.sleepTimeSeconds) return 0;

    const deep = Math.floor((daily.deepSleepSeconds || 0) / 60);
    const light = Math.floor((daily.lightSleepSeconds || 0) / 60);
    const rem = Math.floor((daily.remSleepSeconds || 0) / 60);
    const awake = Math.floor((daily.awakeSleepSeconds || 0) / 60);
    const total = Math.floor((daily.sleepTimeSeconds || 0) / 60);

    const scores = daily.sleepScores || {};
    const score = scores?.overall?.value ?? null;

    const startTime = daily.sleepStartTimestampGMT
      ? new Date(daily.sleepStartTimestampGMT).toISOString().slice(0, 19).replace("T", " ")
      : null;
    const endTime = daily.sleepEndTimestampGMT
      ? new Date(daily.sleepEndTimestampGMT).toISOString().slice(0, 19).replace("T", " ")
      : null;

    await db.prepare(
      `INSERT OR REPLACE INTO sleep (date, total_minutes, deep_minutes, light_minutes, rem_minutes, awake_minutes, score, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(dateStr, total, deep, light, rem, awake, score, startTime, endTime).run();

    return 1;
  } catch (e: any) {
    console.error(`Sleep sync error: ${e.message}`);
    return 0;
  }
}

async function syncHRV(db: D1Database, token: OAuth2Token, dateStr: string): Promise<number> {
  try {
    const data = await garminAPI(`/hrv-service/hrv/${dateStr}`, token);

    const summary = data?.hrvSummary;
    if (!summary || !summary.startTimestampGMT) return 0;

    const ts = new Date(summary.startTimestampGMT).toISOString().slice(0, 19).replace("T", " ");
    const hrvVal = summary.lastNight ?? summary.weeklyAvg ?? null;
    const status = summary.status ?? null;

    if (hrvVal == null) return 0;

    await db.prepare(
      `INSERT OR REPLACE INTO hrv (timestamp, hrv_ms, status) VALUES (?, ?, ?)`
    ).bind(ts, hrvVal, status).run();

    return 1;
  } catch (e: any) {
    console.error(`HRV sync error: ${e.message}`);
    return 0;
  }
}

async function syncSpO2(db: D1Database, token: OAuth2Token, dateStr: string): Promise<number> {
  try {
    const data = await garminAPI(
      `/wellness-service/wellness/daily/spo2/${dateStr}`,
      token
    );

    const hourly = data?.spO2HourlyAverages;
    if (!hourly || !Array.isArray(hourly) || hourly.length === 0) return 0;

    const stmts = hourly
      .filter((e: any) => e && e.length >= 2 && e[1] != null && e[1] > 0)
      .map((e: any) => {
        const ts = new Date(e[0]).toISOString().slice(0, 19).replace("T", " ");
        return db.prepare(
          `INSERT OR REPLACE INTO spo2 (timestamp, percentage) VALUES (?, ?)`
        ).bind(ts, e[1]);
      });

    if (stmts.length === 0) return 0;

    await db.batch(stmts);

    return stmts.length;
  } catch (e: any) {
    console.error(`SpO2 sync error: ${e.message}`);
    return 0;
  }
}

async function syncRespiration(db: D1Database, token: OAuth2Token, dateStr: string): Promise<number> {
  try {
    const data = await garminAPI(
      `/wellness-service/wellness/daily/respiration/${dateStr}`,
      token
    );

    const respValues = data?.respirationValuesArray;
    if (!respValues || !Array.isArray(respValues) || respValues.length === 0) return 0;

    let count = 0;
    const batchSize = 50;

    for (let i = 0; i < respValues.length; i += batchSize) {
      const chunk = respValues.slice(i, i + batchSize);
      const stmts = chunk
        .filter((e: any) => e && e.length >= 2 && e[1] != null && e[1] > 0)
        .map((e: any) => {
          const ts = new Date(e[0]).toISOString().slice(0, 19).replace("T", " ");
          return db.prepare(
            `INSERT OR REPLACE INTO respiration (timestamp, breaths_per_min) VALUES (?, ?)`
          ).bind(ts, e[1]);
        });

      if (stmts.length > 0) {
        await db.batch(stmts);
        count += stmts.length;
      }
    }

    return count;
  } catch (e: any) {
    console.error(`Respiration sync error: ${e.message}`);
    return 0;
  }
}

async function syncCycle(db: D1Database, token: OAuth2Token, dateStr: string): Promise<number> {
  try {
    const data = await garminAPI(
      `/periodichealth-service/menstrualcycle/dayview/${dateStr}`,
      token
    );

    const summary = data?.daySummary;
    if (!summary) return 0;

    const phaseMap: Record<number, string> = {
      1: "Menstrual",
      2: "Follicular",
      3: "Ovulation",
      4: "Luteal",
    };

    const cycleDay = summary.dayInCycle ?? null;
    const phase = phaseMap[summary.currentPhase] ?? null;

    if (cycleDay == null && phase == null) return 0;

    await db.prepare(
      `INSERT OR REPLACE INTO cycle (date, cycle_day, phase) VALUES (?, ?, ?)`
    ).bind(dateStr, cycleDay, phase).run();

    return 1;
  } catch (e: any) {
    console.error(`Cycle sync error: ${e.message}`);
    return 0;
  }
}

async function syncDailySummary(db: D1Database, token: OAuth2Token, displayName: string, dateStr: string): Promise<number> {
  try {
    // Pull summary data from multiple endpoints
    let restingHR: number | null = null;
    let avgHR: number | null = null;
    let maxHR: number | null = null;
    let minHR: number | null = null;
    let avgStress: number | null = null;
    let maxStress: number | null = null;
    let bbCharged: number | null = null;
    let bbDrained: number | null = null;
    let sleepScore: number | null = null;
    let sleepMinutes: number | null = null;
    let spo2Avg: number | null = null;
    let respAvg: number | null = null;
    let cycleDay: number | null = null;
    let cyclePhase: string | null = null;

    // Heart rate
    try {
      const hr = await garminAPI(
        `/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(displayName)}?date=${dateStr}`,
        token
      );
      restingHR = hr?.restingHeartRate ?? null;
      maxHR = hr?.maxHeartRate ?? null;
      minHR = hr?.minHeartRate ?? null;
      // Calculate avg from timeline if available
      const vals = hr?.heartRateValues?.filter((e: any) => e?.[1] > 0) ?? [];
      if (vals.length > 0) {
        avgHR = Math.round(vals.reduce((s: number, e: any) => s + e[1], 0) / vals.length);
      }
    } catch {}

    // Stress
    try {
      const stress = await garminAPI(`/wellness-service/wellness/dailyStress/${dateStr}`, token);
      avgStress = stress?.avgStressLevel ?? null;
      maxStress = stress?.maxStressLevel ?? null;
    } catch {}

    // Body battery
    try {
      const bb = await garminAPI(
        `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${dateStr}&endDate=${dateStr}`,
        token
      );
      if (bb && Array.isArray(bb) && bb.length > 0) {
        bbCharged = bb[0].charged ?? null;
        bbDrained = bb[0].drained ?? null;
      }
    } catch {}

    // Sleep
    try {
      const sleep = await garminAPI(
        `/wellness-service/wellness/dailySleepData/${encodeURIComponent(displayName)}?date=${dateStr}&nonSleepBufferMinutes=60`,
        token
      );
      const daily = sleep?.dailySleepDTO;
      if (daily) {
        sleepMinutes = daily.sleepTimeSeconds ? Math.floor(daily.sleepTimeSeconds / 60) : null;
        sleepScore = daily.sleepScores?.overall?.value ?? null;
      }
    } catch {}

    // SpO2
    try {
      const spo2 = await garminAPI(`/wellness-service/wellness/daily/spo2/${dateStr}`, token);
      spo2Avg = spo2?.averageSpO2 ?? null;
    } catch {}

    // Respiration
    try {
      const resp = await garminAPI(`/wellness-service/wellness/daily/respiration/${dateStr}`, token);
      respAvg = resp?.avgWakingRespirationValue ?? resp?.avgSleepRespirationValue ?? null;
    } catch {}

    // Cycle
    try {
      const cycle = await garminAPI(`/periodichealth-service/menstrualcycle/dayview/${dateStr}`, token);
      const s = cycle?.daySummary;
      if (s) {
        cycleDay = s.dayInCycle ?? null;
        const phaseMap: Record<number, string> = { 1: "Menstrual", 2: "Follicular", 3: "Ovulation", 4: "Luteal" };
        cyclePhase = phaseMap[s.currentPhase] ?? null;
      }
    } catch {}

    await db.prepare(
      `INSERT OR REPLACE INTO daily_summary
       (date, resting_hr, avg_hr, max_hr, min_hr, avg_stress, max_stress,
        body_battery_charged, body_battery_drained, sleep_score, sleep_minutes,
        spo2_avg, respiration_avg, cycle_day, cycle_phase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      dateStr, restingHR, avgHR, maxHR, minHR, avgStress, maxStress,
      bbCharged, bbDrained, sleepScore, sleepMinutes,
      spo2Avg, respAvg, cycleDay, cyclePhase
    ).run();

    return 1;
  } catch (e: any) {
    console.error(`Daily summary sync error: ${e.message}`);
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN SYNC ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════

interface SyncResult {
  date: string;
  heart_rate: number;
  stress: number;
  body_battery: number;
  sleep: number;
  hrv: number;
  spo2: number;
  respiration: number;
  cycle: number;
  daily_summary: number;
  duration_ms: number;
}

async function syncDate(db: D1Database, token: OAuth2Token, displayName: string, dateStr: string): Promise<SyncResult> {
  const start = Date.now();

  // Sync all data types for this date
  // Some share the same API response, but keeping them separate for clarity and error isolation
  const [hr, stress, bb, sleep, hrv, spo2, resp, cycle] = await Promise.allSettled([
    syncHeartRate(db, token, displayName, dateStr),
    syncStress(db, token, dateStr),
    syncBodyBattery(db, token, dateStr),
    syncSleep(db, token, displayName, dateStr),
    syncHRV(db, token, dateStr),
    syncSpO2(db, token, dateStr),
    syncRespiration(db, token, dateStr),
    syncCycle(db, token, dateStr),
  ]);

  // Daily summary after individual syncs (it makes its own API calls for aggregation)
  const summary = await syncDailySummary(db, token, displayName, dateStr);

  return {
    date: dateStr,
    heart_rate: hr.status === "fulfilled" ? hr.value : 0,
    stress: stress.status === "fulfilled" ? stress.value : 0,
    body_battery: bb.status === "fulfilled" ? bb.value : 0,
    sleep: sleep.status === "fulfilled" ? sleep.value : 0,
    hrv: hrv.status === "fulfilled" ? hrv.value : 0,
    spo2: spo2.status === "fulfilled" ? spo2.value : 0,
    respiration: resp.status === "fulfilled" ? resp.value : 0,
    cycle: cycle.status === "fulfilled" ? cycle.value : 0,
    daily_summary: summary,
    duration_ms: Date.now() - start,
  };
}

async function runSync(env: Env, days: number = 1): Promise<SyncResult[]> {
  console.log(`Starting Garmin sync for ${days} day(s)...`);

  // Get valid OAuth2 token
  const token = await getValidToken(env.TOKENS);

  // Get display name (cache it in KV for subsequent runs)
  let displayName = await env.TOKENS.get("display_name");
  if (!displayName) {
    displayName = await getDisplayName(token);
    if (displayName) {
      await env.TOKENS.put("display_name", displayName);
    }
  }

  if (!displayName) {
    throw new Error("Could not determine Garmin display name");
  }

  const results: SyncResult[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    console.log(`Syncing ${dateStr}...`);
    const result = await syncDate(env.DB, token, displayName, dateStr);
    results.push(result);
    console.log(`  HR:${result.heart_rate} Str:${result.stress} BB:${result.body_battery} Slp:${result.sleep} HRV:${result.hrv} O2:${result.spo2} Rsp:${result.respiration} Cyc:${result.cycle} (${result.duration_ms}ms)`);
  }

  // Update last sync timestamp
  await env.TOKENS.put("last_sync", new Date().toISOString());

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// TOKEN SETUP ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

async function handleSetup(request: Request, env: Env): Promise<Response> {
  // Requires API key
  const authHeader = request.headers.get("Authorization");
  const key = authHeader?.replace("Bearer ", "");
  if (!env.SYNC_API_KEY || key !== env.SYNC_API_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const body = (await request.json()) as any;

  if (body.oauth1_token) {
    await env.TOKENS.put("oauth1_token", JSON.stringify(body.oauth1_token));
  }
  if (body.oauth2_token) {
    await env.TOKENS.put("oauth2_token", JSON.stringify(body.oauth2_token));
  }
  if (body.display_name) {
    await env.TOKENS.put("display_name", body.display_name);
  }

  // Try to validate the tokens
  try {
    const token = await getValidToken(env.TOKENS);
    const displayName = await getDisplayName(token);
    if (displayName) {
      await env.TOKENS.put("display_name", displayName);
    }
    return new Response(JSON.stringify({
      success: true,
      display_name: displayName,
      message: "Tokens stored and validated. Garmin API accessible."
    }));
  } catch (e: any) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
      message: "Tokens stored but validation failed. Check token freshness."
    }), { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HTTP + CRON HANDLERS
// ═══════════════════════════════════════════════════════════════════════

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    try {
      // POST /setup — store OAuth tokens
      if (url.pathname === "/setup" && request.method === "POST") {
        return handleSetup(request, env);
      }

      // POST /sync — manual trigger
      if (url.pathname === "/sync" && request.method === "POST") {
        const authHeader = request.headers.get("Authorization");
        const key = authHeader?.replace("Bearer ", "");
        if (!env.SYNC_API_KEY || key !== env.SYNC_API_KEY) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
        }

        const body = (await request.json().catch(() => ({}))) as any;
        const days = body?.days || 1;
        const results = await runSync(env, days);
        return new Response(JSON.stringify({ success: true, results }), { headers });
      }

      // GET /status — check sync health
      if (url.pathname === "/status" || url.pathname === "/") {
        const lastSync = await env.TOKENS.get("last_sync");
        const displayName = await env.TOKENS.get("display_name");
        const hasOAuth1 = !!(await env.TOKENS.get("oauth1_token"));
        const hasOAuth2 = !!(await env.TOKENS.get("oauth2_token"));

        let tokenStatus = "none";
        if (hasOAuth1 && hasOAuth2) {
          const oauth2Json = await env.TOKENS.get("oauth2_token");
          if (oauth2Json) {
            const oauth2: OAuth2Token = JSON.parse(oauth2Json);
            const now = Math.floor(Date.now() / 1000);
            tokenStatus = oauth2.expires_at > now ? "valid" : "expired (will refresh on next sync)";
          }
        } else if (hasOAuth1) {
          tokenStatus = "oauth1 only (will exchange on first sync)";
        }

        return new Response(JSON.stringify({
          status: "ok",
          last_sync: lastSync,
          display_name: displayName,
          oauth1_present: hasOAuth1,
          oauth2_present: hasOAuth2,
          token_status: tokenStatus,
        }), { headers });
      }

      // GET /health — for monitoring
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ healthy: true, timestamp: new Date().toISOString() }), { headers });
      }

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
    } catch (e: any) {
      console.error(`Request error: ${e.message}`);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  },

  // Cron trigger — runs every 15 minutes
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`Cron triggered at ${new Date().toISOString()}`);
    try {
      // Sync today only (cron runs frequently enough)
      const results = await runSync(env, 1);
      console.log(`Cron sync complete: ${JSON.stringify(results.map(r => ({
        date: r.date,
        hr: r.heart_rate,
        stress: r.stress,
        bb: r.body_battery,
        ms: r.duration_ms
      })))}`);
    } catch (e: any) {
      console.error(`Cron sync failed: ${e.message}`);
    }
  },
};
