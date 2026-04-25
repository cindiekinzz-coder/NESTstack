import { Router } from 'express';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

const router = Router();

router.post('/write', async (req, res) => {
  try {
    const { path, content } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });
    if (content === undefined) return res.status(400).json({ error: 'content is required' });

    // Create parent directories if needed
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');

    res.json({ success: true, path, bytes: Buffer.byteLength(content, 'utf-8') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
