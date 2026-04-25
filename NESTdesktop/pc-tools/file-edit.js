import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';

const router = Router();

/**
 * Precise string replacement — modeled after Claude Code's FileEditTool.
 * Finds old_string in the file and replaces with new_string.
 * Fails if old_string is not found or not unique (unless replace_all is true).
 */
router.post('/edit', async (req, res) => {
  try {
    const { path, old_string, new_string, replace_all = false } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });
    if (old_string === undefined) return res.status(400).json({ error: 'old_string is required' });
    if (new_string === undefined) return res.status(400).json({ error: 'new_string is required' });
    if (old_string === new_string) return res.status(400).json({ error: 'old_string and new_string must be different' });

    const content = await readFile(path, 'utf-8');

    // Count occurrences
    const occurrences = content.split(old_string).length - 1;

    if (occurrences === 0) {
      return res.status(400).json({
        error: 'old_string not found in file',
        hint: 'Make sure the string matches exactly, including whitespace and indentation',
      });
    }

    if (occurrences > 1 && !replace_all) {
      return res.status(400).json({
        error: `old_string found ${occurrences} times — not unique`,
        hint: 'Provide more surrounding context to make it unique, or set replace_all: true',
      });
    }

    // Perform replacement
    let newContent;
    if (replace_all) {
      newContent = content.replaceAll(old_string, new_string);
    } else {
      newContent = content.replace(old_string, new_string);
    }

    await writeFile(path, newContent, 'utf-8');

    res.json({
      success: true,
      path,
      replacements: replace_all ? occurrences : 1,
    });
  } catch (err) {
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: err.message });
  }
});

export default router;
