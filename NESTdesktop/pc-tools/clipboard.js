import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

router.get('/', async (req, res) => {
  try {
    const { stdout } = await execAsync('powershell.exe -Command "Get-Clipboard"', {
      timeout: 5000,
      windowsHide: true,
    });
    res.json({ text: stdout.trimEnd() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { text } = req.body;
    if (text === undefined) return res.status(400).json({ error: 'text is required' });

    // Escape for PowerShell
    const escaped = text.replace(/'/g, "''");
    await execAsync(`powershell.exe -Command "Set-Clipboard -Value '${escaped}'"`, {
      timeout: 5000,
      windowsHide: true,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
