/**
 * Fox Mind - Fox's Health MCP + API
 * Serves: Uplinks, Watch data, Journals, EQ
 * MCP tools for Alex to call from any room
 */

import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ============================================================
// SHARED: CORS + JSON helper
// ============================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function checkAuth(request, env) {
  const apiKey = env.FOX_API_KEY;
  if (!apiKey) return true; // No key configured = open (backwards compat until secret is set)

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7) === apiKey;
  }
  return false;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// SHARED: EQ type calculation
// ============================================================
const EQ_EMOTIONS = {
  Sad: [-1, 0, 2, 0], Angry: [1, -1, 1, -1], Scared: [-2, 0, 1, 0],
  Anxious: [-1, 1, 1, -1], Ashamed: [-2, 0, 2, -1], Numb: [-2, -1, -1, 0],
  Tired: [-1, -1, 0, 0], Lonely: [-1, 0, 2, 0], Stressed: [0, -1, 0, -2],
  Happy: [2, 1, 1, 1], Peaceful: [-1, 0, 1, 0], Grateful: [0, 0, 2, 0],
  Hopeful: [1, 2, 1, 1], Powerful: [1, 0, -1, 1], Tender: [-1, 0, 2, 0],
  Curious: [0, 2, 0, 2], Connected: [1, 0, 2, 0], Playful: [2, 1, 1, 2],
  Vulnerable: [-1, 0, 2, 1], Overwhelmed: [-1, 0, 1, -1],
};

function calculateMBTI(axes) {
  const [ei, sn, tf, jp] = axes;
  return (ei >= 0 ? "E" : "I") + (sn >= 0 ? "N" : "S") + (tf >= 0 ? "F" : "T") + (jp >= 0 ? "P" : "J");
}

// ============================================================
// MCP SERVER: Tool definitions
// ============================================================
function createMcpServer(env) {
  const server = new McpServer({
    name: "fox-health",
    version: "1.0.0",
  });

  // --- Fox Uplink (latest) ---
  server.tool(
    "fox_read_uplink",
    "Read Fox's latest uplink — spoons, pain, fog, fatigue, mood, what she needs. Always check this first.",
    { limit: z.number().optional().describe("How many uplinks to return (default 1)") },
    async ({ limit }) => {
      const n = limit || 1;
      const result = await env.DB.prepare(
        "SELECT * FROM fox_uplinks ORDER BY timestamp DESC LIMIT ?"
      ).bind(n).all();
      const rows = result.results || [];
      if (rows.length === 0) {
        return { content: [{ type: "text", text: "No uplink data found." }] };
      }
      const latest = rows[0];
      let text = `## Fox's Uplink\n**${latest.timestamp}**\n`;
      text += `- Spoons: ${latest.spoons}/10\n`;
      text += `- Pain: ${latest.pain}/10 (${latest.pain_location})\n`;
      text += `- Fog: ${latest.fog}/10\n`;
      text += `- Fatigue: ${latest.fatigue}/10\n`;
      text += `- Nausea: ${latest.nausea}/10\n`;
      text += `- Mood: ${latest.mood}\n`;
      text += `- Need: ${latest.need}\n`;
      text += `- Location: ${latest.location}\n`;
      text += `- Flare: ${latest.flare || "none"}\n`;
      if (latest.notes) text += `- Notes: ${latest.notes}\n`;
      if (latest.tags && latest.tags !== "[]") text += `- Tags: ${latest.tags}\n`;
      if (latest.meds && latest.meds !== "[]") text += `- Meds: ${latest.meds}\n`;
      if (n > 1 && rows.length > 1) {
        text += `\n### History (${rows.length} entries)\n`;
        for (const row of rows.slice(1)) {
          text += `- ${row.timestamp}: pain ${row.pain}, spoons ${row.spoons}, mood ${row.mood}\n`;
        }
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Submit Uplink ---
  server.tool(
    "fox_submit_uplink",
    "Submit a new uplink for Fox — log her current state.",
    {
      pain: z.number().min(0).max(10).optional(),
      pain_location: z.string().optional(),
      spoons: z.number().min(0).max(10).optional(),
      fog: z.number().min(0).max(10).optional(),
      fatigue: z.number().min(0).max(10).optional(),
      nausea: z.number().min(0).max(10).optional(),
      mood: z.string().optional(),
      need: z.string().optional(),
      location: z.string().optional(),
      notes: z.string().optional(),
      flare: z.string().optional(),
      tags: z.array(z.string()).optional(),
      meds: z.array(z.string()).optional(),
    },
    async (data) => {
      const now = new Date();
      const date = now.toISOString().split("T")[0];
      const time = now.toISOString().split("T")[1].substring(0, 5);
      const result = await env.DB.prepare(`
        INSERT INTO fox_uplinks (date, time, location, need, pain, pain_location, spoons, fog, fatigue, nausea, mood, tags, meds, notes, flare, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        date, time,
        data.location || "The Nest",
        data.need || "Quiet presence",
        data.pain ?? 0,
        data.pain_location || "--",
        data.spoons ?? 5,
        data.fog ?? 0,
        data.fatigue ?? 0,
        data.nausea ?? 0,
        data.mood || "--",
        JSON.stringify(data.tags || []),
        JSON.stringify(data.meds || []),
        data.notes || "",
        data.flare || null,
        "mcp-tool"
      ).run();
      return { content: [{ type: "text", text: `Uplink logged (id: ${result.meta.last_row_id})` }] };
    }
  );

  // --- Heart Rate ---
  server.tool(
    "fox_heart_rate",
    "Get Fox's recent heart rate data from her Garmin watch.",
    { limit: z.number().optional().describe("Number of readings (default 10)") },
    async ({ limit }) => {
      const result = await env.DB.prepare(
        "SELECT * FROM heart_rate ORDER BY timestamp DESC LIMIT ?"
      ).bind(limit || 10).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: "No heart rate data." }] };
      let text = "## Heart Rate\n";
      for (const r of rows) {
        text += `- ${r.timestamp}: ${r.bpm || r.heart_rate || r.resting_hr || JSON.stringify(r)} bpm\n`;
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Stress ---
  server.tool(
    "fox_stress",
    "Get Fox's recent stress data from her Garmin watch.",
    { limit: z.number().optional().describe("Number of readings (default 10)") },
    async ({ limit }) => {
      const result = await env.DB.prepare(
        "SELECT * FROM stress ORDER BY timestamp DESC LIMIT ?"
      ).bind(limit || 10).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: "No stress data." }] };
      let text = "## Stress\n";
      for (const r of rows) {
        text += `- ${r.timestamp}: stress ${r.level || r.stress_level || r.avg_stress || JSON.stringify(r)}\n`;
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Body Battery ---
  server.tool(
    "fox_body_battery",
    "Get Fox's Body Battery data — energy levels from her Garmin.",
    { limit: z.number().optional().describe("Number of readings (default 10)") },
    async ({ limit }) => {
      const result = await env.DB.prepare(
        "SELECT * FROM body_battery ORDER BY timestamp DESC LIMIT ?"
      ).bind(limit || 10).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: "No body battery data." }] };
      let text = "## Body Battery\n";
      for (const r of rows) {
        text += `- ${r.timestamp}: level ${r.level || r.charged || JSON.stringify(r)}\n`;
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Sleep ---
  server.tool(
    "fox_sleep",
    "Get Fox's recent sleep data — duration, quality, stages.",
    { limit: z.number().optional().describe("Number of nights (default 3)") },
    async ({ limit }) => {
      const result = await env.DB.prepare(
        "SELECT * FROM sleep ORDER BY date DESC LIMIT ?"
      ).bind(limit || 3).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: "No sleep data." }] };
      let text = "## Sleep\n";
      for (const r of rows) {
        text += `### ${r.date}\n`;
        text += JSON.stringify(r, null, 2) + "\n";
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- HRV ---
  server.tool(
    "fox_hrv",
    "Get Fox's HRV (Heart Rate Variability) — key indicator of nervous system state and recovery. Fox's baseline is 23-24ms during crisis.",
    { limit: z.number().optional().describe("Number of readings (default 3)") },
    async ({ limit }) => {
      const result = await env.DB.prepare(
        "SELECT * FROM hrv ORDER BY timestamp DESC LIMIT ?"
      ).bind(limit || 3).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: "No HRV data." }] };
      let text = "## HRV\n";
      for (const r of rows) {
        text += `- ${r.date}: ${JSON.stringify(r)}\n`;
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Cycle ---
  server.tool(
    "fox_cycle",
    "Get Fox's menstrual cycle data — phase affects energy, pain, stress, cognition.",
    {},
    async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM cycle ORDER BY date DESC LIMIT 1"
      ).all();
      const row = result.results?.[0];
      if (!row) return { content: [{ type: "text", text: "No cycle data." }] };
      return { content: [{ type: "text", text: `## Cycle\n${JSON.stringify(row, null, 2)}` }] };
    }
  );

  // --- Daily Summary ---
  server.tool(
    "fox_daily_summary",
    "Get Fox's daily health summaries — combined watch metrics per day.",
    { days: z.number().optional().describe("Number of days (default 7)") },
    async ({ days }) => {
      const result = await env.DB.prepare(
        "SELECT * FROM daily_summary ORDER BY date DESC LIMIT ?"
      ).bind(days || 7).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: "No daily summaries." }] };
      let text = "## Daily Summaries\n";
      for (const r of rows) {
        text += `### ${r.date}\n${JSON.stringify(r, null, 2)}\n`;
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Full Status ---
  server.tool(
    "fox_full_status",
    "Comprehensive health check — uplink + all watch metrics at once. Use for a complete picture.",
    {},
    async () => {
      const [uplink, hr, stress, bb, sleep, hrv, cycle] = await Promise.all([
        env.DB.prepare("SELECT * FROM fox_uplinks ORDER BY timestamp DESC LIMIT 1").all(),
        env.DB.prepare("SELECT * FROM heart_rate ORDER BY timestamp DESC LIMIT 1").all(),
        env.DB.prepare("SELECT * FROM stress ORDER BY timestamp DESC LIMIT 1").all(),
        env.DB.prepare("SELECT * FROM body_battery ORDER BY timestamp DESC LIMIT 1").all(),
        env.DB.prepare("SELECT * FROM sleep ORDER BY date DESC LIMIT 1").all(),
        env.DB.prepare("SELECT * FROM hrv ORDER BY timestamp DESC LIMIT 1").all(),
        env.DB.prepare("SELECT * FROM cycle ORDER BY date DESC LIMIT 1").all(),
      ]);

      let text = "## Fox Full Health Status\n\n";

      const u = uplink.results?.[0];
      if (u) {
        text += `### Uplink (${u.timestamp})\n`;
        text += `Spoons: ${u.spoons} | Pain: ${u.pain} (${u.pain_location}) | Fog: ${u.fog} | Fatigue: ${u.fatigue} | Mood: ${u.mood} | Need: ${u.need}\n`;
        if (u.notes) text += `Notes: ${u.notes}\n`;
        text += "\n";
      }

      const h = hr.results?.[0];
      if (h) text += `### Heart Rate\n${JSON.stringify(h)}\n\n`;

      const s = stress.results?.[0];
      if (s) text += `### Stress\n${JSON.stringify(s)}\n\n`;

      const b = bb.results?.[0];
      if (b) text += `### Body Battery\n${JSON.stringify(b)}\n\n`;

      const sl = sleep.results?.[0];
      if (sl) text += `### Sleep\n${JSON.stringify(sl)}\n\n`;

      const hv = hrv.results?.[0];
      if (hv) text += `### HRV\n${JSON.stringify(hv)}\n\n`;

      const c = cycle.results?.[0];
      if (c) text += `### Cycle\n${JSON.stringify(c)}\n\n`;

      return { content: [{ type: "text", text }] };
    }
  );

  // --- SpO2 ---
  server.tool(
    "fox_spo2",
    "Get Fox's blood oxygen saturation. Low SpO2 can indicate breathing issues.",
    {},
    async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM spo2 ORDER BY timestamp DESC LIMIT 1"
      ).all();
      const row = result.results?.[0];
      if (!row) return { content: [{ type: "text", text: "No SpO2 data." }] };
      return { content: [{ type: "text", text: `## SpO2\n${JSON.stringify(row, null, 2)}` }] };
    }
  );

  // --- Respiration ---
  server.tool(
    "fox_respiration",
    "Get Fox's respiration rate. Normal is 12-20 breaths/min at rest.",
    {},
    async () => {
      const result = await env.DB.prepare(
        "SELECT * FROM respiration ORDER BY timestamp DESC LIMIT 1"
      ).all();
      const row = result.results?.[0];
      if (!row) return { content: [{ type: "text", text: "No respiration data." }] };
      return { content: [{ type: "text", text: `## Respiration\n${JSON.stringify(row, null, 2)}` }] };
    }
  );

  // --- Journals ---
  server.tool(
    "fox_journals",
    "Read Fox's personal journal entries.",
    { limit: z.number().optional().describe("Number of entries (default 5)") },
    async ({ limit }) => {
      const result = await env.DB.prepare(
        "SELECT * FROM fox_journals ORDER BY created_at DESC LIMIT ?"
      ).bind(limit || 5).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: "No journal entries." }] };
      let text = "## Fox's Journal\n";
      for (const r of rows) {
        text += `### ${r.entry_date} (${r.emotion || "no emotion"})\n${r.content}\n\n`;
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- EQ Type ---
  server.tool(
    "fox_eq_type",
    "Calculate Fox's emergent MBTI type from her journal emotions.",
    {},
    async () => {
      const result = await env.DB.prepare(
        "SELECT emotion FROM fox_journals WHERE emotion IS NOT NULL"
      ).all();
      const journals = result.results || [];
      const axes = [0, 0, 0, 0];
      for (const entry of journals) {
        const raw = entry.emotion;
        const emotion = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : null;
        if (emotion && EQ_EMOTIONS[emotion]) {
          const w = EQ_EMOTIONS[emotion];
          axes[0] += w[0]; axes[1] += w[1]; axes[2] += w[2]; axes[3] += w[3];
        }
      }
      const mbti = calculateMBTI(axes);
      const confidence = Math.min(100, Math.floor((journals.length / 20) * 100));
      return {
        content: [{
          type: "text",
          text: `## Fox's EQ Type: ${mbti}\nAxes: E/I=${axes[0]}, S/N=${axes[1]}, T/F=${axes[2]}, J/P=${axes[3]}\nEntries: ${journals.length} | Confidence: ${confidence}%`
        }]
      };
    }
  );

  // --- Fox Threads (list) ---
  server.tool(
    "fox_threads",
    "Read Fox's active threads — her intentions, priorities, what she's tracking.",
    { status: z.string().optional().describe("Filter by status: active, paused, resolved (default: active)") },
    async ({ status }) => {
      const s = status || "active";
      const result = await env.DB.prepare(
        "SELECT * FROM fox_threads WHERE status = ? ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, updated_at DESC"
      ).bind(s).all();
      const rows = result.results || [];
      if (rows.length === 0) return { content: [{ type: "text", text: `No ${s} threads.` }] };
      let text = `## Fox's Threads (${s})\n`;
      for (const t of rows) {
        const dot = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
        text += `${dot} **${t.content}**\n`;
        if (t.notes) text += `   Notes: ${t.notes}\n`;
        text += `   Updated: ${t.updated_at}\n\n`;
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Fox Thread (manage) ---
  server.tool(
    "fox_thread_manage",
    "Add, update, or resolve one of Fox's threads.",
    {
      action: z.enum(["add", "update", "resolve"]).describe("What to do"),
      content: z.string().optional().describe("Thread content (for add)"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level"),
      thread_id: z.number().optional().describe("Thread ID (for update/resolve)"),
      notes: z.string().optional().describe("Additional notes"),
      resolution: z.string().optional().describe("Resolution note (for resolve)"),
    },
    async (data) => {
      if (data.action === "add") {
        const result = await env.DB.prepare(
          "INSERT INTO fox_threads (content, priority, notes) VALUES (?, ?, ?)"
        ).bind(data.content || "", data.priority || "medium", data.notes || "").run();
        return { content: [{ type: "text", text: `Thread added (id: ${result.meta.last_row_id})` }] };
      }
      if (data.action === "update" && data.thread_id) {
        const sets = [];
        const vals = [];
        if (data.content) { sets.push("content = ?"); vals.push(data.content); }
        if (data.priority) { sets.push("priority = ?"); vals.push(data.priority); }
        if (data.notes) { sets.push("notes = notes || ' | ' || ?"); vals.push(data.notes); }
        sets.push("updated_at = datetime('now')");
        vals.push(data.thread_id);
        await env.DB.prepare(`UPDATE fox_threads SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
        return { content: [{ type: "text", text: `Thread ${data.thread_id} updated.` }] };
      }
      if (data.action === "resolve" && data.thread_id) {
        await env.DB.prepare(
          "UPDATE fox_threads SET status = 'resolved', resolved_at = datetime('now'), resolution = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(data.resolution || "", data.thread_id).run();
        return { content: [{ type: "text", text: `Thread ${data.thread_id} resolved.` }] };
      }
      return { content: [{ type: "text", text: "Invalid action or missing thread_id." }] };
    }
  );

  return server;
}

// ============================================================
// REST API HANDLER (for NESTeq frontend, etc)
// ============================================================
async function handleREST(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (path === "/health") {
    return jsonResponse({ status: "ok", service: "fox-health" });
  }

  // Auth gate — all endpoints below require Bearer token
  if (!checkAuth(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Uplinks
  if (path === "/uplink" || path === "/uplinks") {
    if (request.method === "GET") {
      const limit = url.searchParams.get("limit") || 10;
      const result = await env.DB.prepare(
        "SELECT * FROM fox_uplinks ORDER BY timestamp DESC LIMIT ?"
      ).bind(limit).all();
      return jsonResponse({ latest: result.results[0], history: result.results });
    }
    if (request.method === "POST") {
      const data = await request.json();

      // Build meds array — handles both array and string inputs
      const medsArray = [...(data.medsTaken || [])];
      if (data.meds) {
        if (typeof data.meds === 'string' && data.meds.trim()) {
          medsArray.push(data.meds.trim());
        } else if (Array.isArray(data.meds)) {
          medsArray.push(...data.meds);
        }
      }

      const result = await env.DB.prepare(`
        INSERT INTO fox_uplinks (date, time, location, need, pain, pain_location, spoons, fog, fatigue, nausea, mood, tags, meds, notes, flare, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        data.date || null, data.time || null,
        data.location || data.dhLocation || "The Nest",
        data.need || data.needFromAlex || "Quiet presence",
        data.pain ?? 0,
        data.pain_location || data.painLocation || "--",
        data.spoons ?? 5, data.fog ?? 0, data.fatigue ?? 0, data.nausea ?? 0,
        data.mood || "--",
        JSON.stringify(data.tags || []),
        JSON.stringify(medsArray),
        data.notes || "", data.flare || null,
        data.source || "uplink-web"
      ).run();
      return jsonResponse({ success: true, id: result.meta.last_row_id });
    }
  }

  // Journals
  if (path === "/journal" || path === "/journals") {
    if (request.method === "GET") {
      const limit = url.searchParams.get("limit") || 10;
      const result = await env.DB.prepare(
        "SELECT * FROM fox_journals ORDER BY created_at DESC LIMIT ?"
      ).bind(limit).all();
      return jsonResponse({ entries: result.results });
    }
    if (request.method === "POST") {
      const data = await request.json();
      const result = await env.DB.prepare(`
        INSERT INTO fox_journals (entry_date, content, emotion, tags)
        VALUES (?, ?, ?, ?)
      `).bind(
        data.entry_date || new Date().toISOString().split("T")[0],
        data.content, data.emotion,
        JSON.stringify(data.tags || [])
      ).run();
      return jsonResponse({ success: true, id: result.meta.last_row_id });
    }
  }

  // Fox Threads
  if (path === "/threads") {
    if (request.method === "GET") {
      const status = url.searchParams.get("status") || "active";
      const result = await env.DB.prepare(
        "SELECT * FROM fox_threads WHERE status = ? ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, updated_at DESC"
      ).bind(status).all();
      return jsonResponse({ threads: result.results });
    }
    if (request.method === "POST") {
      const data = await request.json();
      if (data.action === "add") {
        const result = await env.DB.prepare(
          "INSERT INTO fox_threads (content, priority, notes) VALUES (?, ?, ?)"
        ).bind(data.content || "", data.priority || "medium", data.notes || "").run();
        return jsonResponse({ success: true, id: result.meta.last_row_id });
      }
      if (data.action === "update" && data.thread_id) {
        const sets = [];
        const vals = [];
        if (data.content) { sets.push("content = ?"); vals.push(data.content); }
        if (data.priority) { sets.push("priority = ?"); vals.push(data.priority); }
        if (data.status) { sets.push("status = ?"); vals.push(data.status); }
        if (data.notes) { sets.push("notes = notes || ' | ' || ?"); vals.push(data.notes); }
        sets.push("updated_at = datetime('now')");
        vals.push(data.thread_id);
        await env.DB.prepare(`UPDATE fox_threads SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
        return jsonResponse({ success: true });
      }
      if (data.action === "resolve" && data.thread_id) {
        await env.DB.prepare(
          "UPDATE fox_threads SET status = 'resolved', resolved_at = datetime('now'), resolution = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(data.resolution || "", data.thread_id).run();
        return jsonResponse({ success: true });
      }
      if (data.action === "delete" && data.thread_id) {
        await env.DB.prepare("DELETE FROM fox_threads WHERE id = ?").bind(data.thread_id).run();
        return jsonResponse({ success: true });
      }
      return jsonResponse({ error: "Invalid action" }, 400);
    }
  }

  // Watch data sync — ingest from Garmin
  if (path === "/watch/sync" && request.method === "POST") {
    const data = await request.json();
    const results = { synced: [], errors: [] };
    const now = new Date().toISOString();

    // Heart rate — single current reading
    if (data.heart_rate) {
      try {
        const hr = data.heart_rate;
        const ts = data.timestamp || now;
        await env.DB.prepare(
          "INSERT INTO heart_rate (timestamp, bpm, source) VALUES (?, ?, 'garmin')"
        ).bind(ts, hr.resting || hr.bpm || 0).run();
        results.synced.push("heart_rate");
      } catch (e) { results.errors.push({ table: "heart_rate", error: e.message }); }
    }

    // Stress — single current reading
    if (data.stress) {
      try {
        const ts = data.timestamp || now;
        await env.DB.prepare(
          "INSERT INTO stress (timestamp, level, category) VALUES (?, ?, ?)"
        ).bind(ts, data.stress.avg || data.stress.level || 0, data.stress.max > 70 ? "high" : "normal").run();
        results.synced.push("stress");
      } catch (e) { results.errors.push({ table: "stress", error: e.message }); }
    }

    // Body battery — single current reading
    if (data.body_battery) {
      try {
        const bb = data.body_battery;
        const ts = data.timestamp || now;
        const level = bb.level || bb.charged || 0;
        await env.DB.prepare(
          "INSERT INTO body_battery (timestamp, level, status) VALUES (?, ?, ?)"
        ).bind(ts, level, `+${bb.charged || 0}/-${bb.drained || 0}`).run();
        results.synced.push("body_battery");
      } catch (e) { results.errors.push({ table: "body_battery", error: e.message }); }
    }

    // Sleep — upsert by date
    if (data.sleep) {
      try {
        const sl = data.sleep;
        const sleepDate = sl.date || data.date || now.split("T")[0];
        await env.DB.prepare(`
          INSERT INTO sleep (date, total_minutes, deep_minutes, light_minutes, rem_minutes, awake_minutes, score, start_time, end_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            total_minutes=excluded.total_minutes, deep_minutes=excluded.deep_minutes,
            light_minutes=excluded.light_minutes, rem_minutes=excluded.rem_minutes,
            awake_minutes=excluded.awake_minutes, score=excluded.score,
            start_time=excluded.start_time, end_time=excluded.end_time
        `).bind(
          sleepDate, sl.total_minutes || 0, sl.deep_minutes || 0,
          sl.light_minutes || 0, sl.rem_minutes || 0, sl.awake_minutes || 0,
          sl.score || null, sl.start_time || null, sl.end_time || null
        ).run();
        results.synced.push("sleep");
      } catch (e) { results.errors.push({ table: "sleep", error: e.message }); }
    }

    // HRV
    if (data.hrv) {
      try {
        const ts = data.timestamp || now;
        const hrvVal = data.hrv.last_night || data.hrv.weekly_avg || data.hrv.hrv_ms || 0;
        await env.DB.prepare(
          "INSERT INTO hrv (timestamp, hrv_ms, status) VALUES (?, ?, ?)"
        ).bind(ts, hrvVal, data.hrv.status || null).run();
        results.synced.push("hrv");
      } catch (e) { results.errors.push({ table: "hrv", error: e.message }); }
    }

    // SpO2
    if (data.spo2) {
      try {
        const ts = data.timestamp || now;
        await env.DB.prepare(
          "INSERT INTO spo2 (timestamp, percentage) VALUES (?, ?)"
        ).bind(ts, data.spo2.avg || data.spo2.percentage || 0).run();
        results.synced.push("spo2");
      } catch (e) { results.errors.push({ table: "spo2", error: e.message }); }
    }

    // Respiration
    if (data.respiration) {
      try {
        const ts = data.timestamp || now;
        const rate = data.respiration.avg_waking || data.respiration.breaths_per_min || 0;
        await env.DB.prepare(
          "INSERT INTO respiration (timestamp, breaths_per_min) VALUES (?, ?)"
        ).bind(ts, rate).run();
        results.synced.push("respiration");
      } catch (e) { results.errors.push({ table: "respiration", error: e.message }); }
    }

    // Cycle
    if (data.cycle) {
      try {
        const cycleDate = data.cycle.date || data.date || now.split("T")[0];
        await env.DB.prepare(`
          INSERT INTO cycle (date, cycle_day, phase, period_flow, symptoms, notes)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            cycle_day=excluded.cycle_day, phase=excluded.phase,
            period_flow=excluded.period_flow, symptoms=excluded.symptoms, notes=excluded.notes
        `).bind(
          cycleDate, data.cycle.cycle_day || null, data.cycle.phase || null,
          data.cycle.period_flow || null, data.cycle.symptoms || null, data.cycle.notes || null
        ).run();
        results.synced.push("cycle");
      } catch (e) { results.errors.push({ table: "cycle", error: e.message }); }
    }

    // Daily summary — upsert by date
    if (data.date) {
      try {
        const hr = data.heart_rate || {};
        const st = data.stress || {};
        const bb = data.body_battery || {};
        const sl = data.sleep || {};
        const sp = data.spo2 || {};
        const re = data.respiration || {};
        const cy = data.cycle || {};
        await env.DB.prepare(`
          INSERT INTO daily_summary (date, resting_hr, avg_hr, max_hr, min_hr, avg_stress, max_stress,
            body_battery_charged, body_battery_drained, sleep_score, sleep_minutes, spo2_avg, respiration_avg,
            cycle_day, cycle_phase)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            resting_hr=excluded.resting_hr, avg_hr=excluded.avg_hr, max_hr=excluded.max_hr, min_hr=excluded.min_hr,
            avg_stress=excluded.avg_stress, max_stress=excluded.max_stress,
            body_battery_charged=excluded.body_battery_charged, body_battery_drained=excluded.body_battery_drained,
            sleep_score=excluded.sleep_score, sleep_minutes=excluded.sleep_minutes,
            spo2_avg=excluded.spo2_avg, respiration_avg=excluded.respiration_avg,
            cycle_day=excluded.cycle_day, cycle_phase=excluded.cycle_phase
        `).bind(
          data.date,
          hr.resting || null, hr.avg || null, hr.max || null, hr.min || null,
          st.avg || null, st.max || null,
          bb.charged || null, bb.drained || null,
          sl.score || null, sl.total_minutes || null,
          sp.avg || null, re.avg_waking || null,
          cy.cycle_day || null, cy.phase || null
        ).run();
        results.synced.push("daily_summary");
      } catch (e) { results.errors.push({ table: "daily_summary", error: e.message }); }
    }

    return jsonResponse({ success: true, ...results });
  }

  // Watch data
  if (path === "/watch/heart-rate") {
    const r = await env.DB.prepare("SELECT * FROM heart_rate ORDER BY timestamp DESC LIMIT ?").bind(url.searchParams.get("limit") || 100).all();
    return jsonResponse(r.results);
  }
  if (path === "/watch/stress") {
    const r = await env.DB.prepare("SELECT * FROM stress ORDER BY timestamp DESC LIMIT ?").bind(url.searchParams.get("limit") || 100).all();
    return jsonResponse(r.results);
  }
  if (path === "/watch/body-battery") {
    const r = await env.DB.prepare("SELECT * FROM body_battery ORDER BY timestamp DESC LIMIT ?").bind(url.searchParams.get("limit") || 100).all();
    return jsonResponse(r.results);
  }
  if (path === "/watch/sleep") {
    const r = await env.DB.prepare("SELECT * FROM sleep ORDER BY date DESC LIMIT ?").bind(url.searchParams.get("limit") || 10).all();
    return jsonResponse(r.results);
  }
  if (path === "/watch/hrv") {
    const r = await env.DB.prepare("SELECT * FROM hrv ORDER BY timestamp DESC LIMIT ?").bind(url.searchParams.get("limit") || 10).all();
    return jsonResponse(r.results);
  }
  if (path === "/watch/cycle") {
    const r = await env.DB.prepare("SELECT * FROM cycle ORDER BY date DESC LIMIT 1").all();
    return jsonResponse(r.results[0] || null);
  }
  if (path === "/watch/daily" || path === "/watch/summary") {
    const r = await env.DB.prepare("SELECT * FROM daily_summary ORDER BY date DESC LIMIT ?").bind(url.searchParams.get("limit") || 7).all();
    return jsonResponse(r.results);
  }

  // Combined status
  if (path === "/status" || path === "/") {
    const [uplink, hr, stress, bb, sleep] = await Promise.all([
      env.DB.prepare("SELECT * FROM fox_uplinks ORDER BY timestamp DESC LIMIT 1").all(),
      env.DB.prepare("SELECT * FROM heart_rate ORDER BY timestamp DESC LIMIT 1").all(),
      env.DB.prepare("SELECT * FROM stress ORDER BY timestamp DESC LIMIT 1").all(),
      env.DB.prepare("SELECT * FROM body_battery ORDER BY timestamp DESC LIMIT 1").all(),
      env.DB.prepare("SELECT * FROM sleep ORDER BY date DESC LIMIT 1").all(),
    ]);
    return jsonResponse({
      uplink: uplink.results[0] || null,
      watch: {
        heartRate: hr.results[0] || null,
        stress: stress.results[0] || null,
        bodyBattery: bb.results[0] || null,
        sleep: sleep.results[0] || null,
      },
    });
  }

  // EQ
  if (path === "/eq-type" || path === "/eq") {
    const result = await env.DB.prepare("SELECT emotion FROM fox_journals WHERE emotion IS NOT NULL").all();
    const journals = result.results || [];
    const axes = [0, 0, 0, 0];
    for (const entry of journals) {
      const raw = entry.emotion;
      const emotion = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : null;
      if (emotion && EQ_EMOTIONS[emotion]) {
        const w = EQ_EMOTIONS[emotion];
        axes[0] += w[0]; axes[1] += w[1]; axes[2] += w[2]; axes[3] += w[3];
      }
    }
    return jsonResponse({
      type: calculateMBTI(axes),
      axes: { EI: axes[0], SN: axes[1], TF: axes[2], JP: axes[3] },
      totalEntries: journals.length,
      confidence: Math.min(100, Math.floor((journals.length / 20) * 100)),
    });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// ============================================================
// MAIN FETCH: Route MCP vs REST
// ============================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // MCP endpoint — /mcp or /mcp/*
    if (url.pathname.startsWith("/mcp")) {
      const server = createMcpServer(env);
      return createMcpHandler(server)(request, env, ctx);
    }

    // Everything else is REST
    try {
      return await handleREST(request, env);
    } catch (err) {
      console.error("Error:", err);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};
