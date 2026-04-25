import { Router } from 'express';
import fg from 'fast-glob';
import { stat } from 'fs/promises';

const router = Router();

router.post('/glob', async (req, res) => {
  try {
    const { pattern, path } = req.body;
    if (!pattern) return res.status(400).json({ error: 'pattern is required' });

    const cwd = path || process.cwd();
    const files = await fg(pattern, {
      cwd,
      absolute: true,
      dot: false,
      onlyFiles: true,
      suppressErrors: true,
    });

    // Sort by modification time (newest first) like Claude Code
    const withStats = await Promise.all(
      files.slice(0, 500).map(async (f) => {
        try {
          const s = await stat(f);
          return { path: f, mtime: s.mtimeMs };
        } catch {
          return { path: f, mtime: 0 };
        }
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);

    res.json({
      files: withStats.map((f) => f.path),
      total: files.length,
      truncated: files.length > 500,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
