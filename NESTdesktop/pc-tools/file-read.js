import { Router } from 'express';
import { readFile, stat } from 'fs/promises';
import { extname } from 'path';

const router = Router();

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'];

router.post('/read', async (req, res) => {
  try {
    const { path, offset = 0, limit = 2000 } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });

    const info = await stat(path);
    const ext = extname(path).toLowerCase();

    // Images: return base64
    if (IMAGE_EXTS.includes(ext)) {
      const buf = await readFile(path);
      const base64 = buf.toString('base64');
      const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;
      return res.json({ type: 'image', mime, base64, size: info.size });
    }

    // Text files: return with line numbers
    const content = await readFile(path, 'utf-8');
    const lines = content.split('\n');
    const sliced = lines.slice(offset, offset + limit);
    const numbered = sliced.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');

    res.json({
      type: 'text',
      content: numbered,
      totalLines: lines.length,
      offset,
      limit,
      size: info.size,
    });
  } catch (err) {
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: err.message });
  }
});

export default router;
