import { Router } from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

router.post('/launch', async (req, res) => {
  try {
    const { name, args = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Launch detached so it doesn't block
    const child = spawn(name, args, {
      detached: true,
      stdio: 'ignore',
      shell: true,
      windowsHide: false,
    });
    child.unref();

    res.json({ success: true, name, pid: child.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', async (req, res) => {
  try {
    const { stdout } = await execAsync(
      'powershell.exe -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne \\"\\" } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json"',
      { timeout: 10000, windowsHide: true }
    );

    const procs = JSON.parse(stdout || '[]');
    const windows = (Array.isArray(procs) ? procs : [procs]).map((p) => ({
      pid: p.Id,
      name: p.ProcessName,
      title: p.MainWindowTitle,
    }));

    res.json({ windows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
