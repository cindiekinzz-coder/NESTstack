import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

router.get('/list', async (req, res) => {
  try {
    const { sort_by = 'memory', limit = 30, name } = req.query;

    let cmd = 'Get-Process';
    if (name) cmd += ` -Name "${name}"`;
    cmd += ' | Select-Object Id, ProcessName, WorkingSet64, CPU';
    cmd += sort_by === 'cpu' ? ' | Sort-Object CPU -Descending' : ' | Sort-Object WorkingSet64 -Descending';
    cmd += ` | Select-Object -First ${limit}`;
    cmd += ' | ConvertTo-Json';

    const { stdout } = await execAsync(cmd, {
      shell: 'powershell.exe',
      timeout: 10000,
      windowsHide: true,
    });

    const processes = JSON.parse(stdout || '[]');
    const list = (Array.isArray(processes) ? processes : [processes]).map((p) => ({
      pid: p.Id,
      name: p.ProcessName,
      memory_mb: Math.round((p.WorkingSet64 || 0) / 1024 / 1024),
      cpu: p.CPU ? Math.round(p.CPU * 100) / 100 : 0,
    }));

    res.json({ processes: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kill', async (req, res) => {
  try {
    const { pid } = req.body;
    if (!pid) return res.status(400).json({ error: 'pid is required' });

    await execAsync(`Stop-Process -Id ${pid} -Force`, {
      shell: 'powershell.exe',
      timeout: 5000,
      windowsHide: true,
    });

    res.json({ success: true, pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
