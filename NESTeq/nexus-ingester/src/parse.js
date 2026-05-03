// Parse one Nexus AI Chat Importer markdown file → structured conversation.
//
// Format:
//   ---
//   <YAML frontmatter>
//   ---
//   # Title: ...
//   Created: ...
//   Last Updated: ...
//   Chat URL: ...
//
//   >[!nexus_user] **User** - DD/MM/YYYY at HH:MM:SS
//   > content line 1
//   > content line 2
//   <!-- UID: <uid> -->
//   >[!nexus_agent] **Assistant** - DD/MM/YYYY at HH:MM:SS
//   > content...
//   <!-- UID: <uid> -->
//
//   ---
//   >[!nexus_user] ...
//
// Output:
//   { frontmatter: {...}, title, turns: [{ role, ts_iso, uid, content }, ...] }

import { readFile } from 'node:fs/promises';

const HEADER_RE = /^>\[!nexus_(user|agent)\]\s+\*\*(?:User|Assistant)\*\*\s+-\s+(\d{2})\/(\d{2})\/(\d{4})\s+at\s+(\d{2}):(\d{2}):(\d{2})\s*$/;
const UID_RE = /^<!--\s*UID:\s*([0-9a-f-]+)\s*-->\s*$/i;

/** Parse YAML-ish frontmatter (top of file between two `---` lines). Nexus
 *  frontmatter is shallow string/number/bool — we don't need a full YAML parser. */
function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body_start: 0 };
  const fm = {};
  let i = 1;
  while (i < lines.length && lines[i].trim() !== '---') {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (m) {
      let val = m[2].trim();
      // Strip wrapping quotes if present.
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      fm[m[1]] = val;
    }
    i++;
  }
  return { frontmatter: fm, body_start: i + 1 };
}

/** DD/MM/YYYY HH:MM:SS → ISO 8601 (assumes Europe/London local time, which is
 *  what Nexus writes in the human-readable header). We use the frontmatter's
 *  create_time/update_time as the authoritative UTC bounds, but the per-turn
 *  timestamps from the header are LOCAL — we keep them as-is and let the
 *  ingester decide how to handle TZ. For now we serialize them naively as
 *  YYYY-MM-DDTHH:MM:SS (no Z) to flag they're local. */
function toLocalIso(dd, mm, yyyy, h, m, s) {
  return `${yyyy}-${mm}-${dd}T${h}:${m}:${s}`;
}

/** Find turns in body. A turn = header line + following content lines (each
 *  starting with `>`) + optional trailing UID comment. Stops at next header,
 *  `---` separator, or EOF. */
function extractTurns(bodyLines) {
  const turns = [];
  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    const h = line.match(HEADER_RE);
    if (!h) { i++; continue; }

    const role = h[1] === 'user' ? 'fox' : 'assistant';
    const ts_iso = toLocalIso(h[2], h[3], h[4], h[5], h[6], h[7]);
    const contentLines = [];
    let uid = null;
    i++;
    while (i < bodyLines.length) {
      const cur = bodyLines[i];
      if (HEADER_RE.test(cur)) break;
      if (cur.trim() === '---') { i++; break; }
      const uidMatch = cur.match(UID_RE);
      if (uidMatch) { uid = uidMatch[1]; i++; continue; }
      if (cur.startsWith('>')) {
        // Strip leading `>` and one optional space.
        contentLines.push(cur.replace(/^>\s?/, ''));
      } else if (cur.trim() === '') {
        // Allow blank line between turn body and UID comment / separator.
        contentLines.push('');
      } else {
        // Unexpected non-quoted line in body — stop the turn.
        break;
      }
      i++;
    }
    // Trim trailing blank lines.
    while (contentLines.length && contentLines[contentLines.length - 1] === '') contentLines.pop();
    turns.push({ role, ts_iso, uid, content: contentLines.join('\n') });
  }
  return turns;
}

export async function parseFile(path) {
  const raw = await readFile(path, 'utf8');
  const lines = raw.split(/\r?\n/);
  const { frontmatter, body_start } = parseFrontmatter(lines);

  // Skip the title/metadata block (# Title, Created, Last Updated, Chat URL).
  let bodyStart = body_start;
  while (bodyStart < lines.length) {
    const t = lines[bodyStart].trim();
    if (HEADER_RE.test(lines[bodyStart])) break;
    bodyStart++;
    if (bodyStart - body_start > 50) break; // safety: don't over-skip
  }

  const turns = extractTurns(lines.slice(bodyStart));

  return {
    path,
    frontmatter,
    title: frontmatter.aliases || '',
    conversation_id: frontmatter.conversation_id || null,
    provider: frontmatter.provider || 'unknown',
    create_time: frontmatter.create_time || null,
    update_time: frontmatter.update_time || null,
    turns,
  };
}
