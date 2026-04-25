-- Fox Uplinks table
CREATE TABLE IF NOT EXISTS fox_uplinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  date TEXT,
  time TEXT,
  location TEXT DEFAULT 'The Nest',
  need TEXT DEFAULT 'Quiet presence',
  pain INTEGER DEFAULT 0,
  pain_location TEXT DEFAULT '--',
  spoons INTEGER DEFAULT 5,
  fog INTEGER DEFAULT 0,
  fatigue INTEGER DEFAULT 0,
  nausea INTEGER DEFAULT 0,
  mood TEXT DEFAULT '--',
  tags TEXT DEFAULT '[]',
  meds TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  flare TEXT,
  source TEXT DEFAULT 'uplink-web',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Fox Journals table
CREATE TABLE IF NOT EXISTS fox_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT,
  content TEXT NOT NULL,
  emotion TEXT,
  tags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_uplinks_created ON fox_uplinks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journals_created ON fox_journals(created_at DESC);
