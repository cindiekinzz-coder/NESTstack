import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

// Persistent working directory across calls
let currentCwd = process.cwd();

router.post('/shell', async (req, res) => {
  try {
    const { command, cwd, timeout = 120000 } = req.body;
    if (!command) return res.status(400).json({ error: 'command is required' });

    // Use provided cwd, or persistent cwd
    const workDir = cwd || currentCwd;
    const maxTimeout = Math.min(timeout, 600000); // Max 10 minutes

    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: maxTimeout,
      shell: process.platform === 'win32' ? 'powershell' : '/bin/bash',
      windowsHide: true,
    });

    // Track cd commands for persistent cwd
    const cdMatch = command.match(/^\s*cd\s+["']?(.+?)["']?\s*$/);
    if (cdMatch) {
      const { resolve } = await import('path');
      currentCwd = resolve(workDir, cdMatch[1]);
    }

    res.json({
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
      exitCode: 0,
      cwd: workDir,
    });
  } catch (err) {
    console.error('Shell execution error:', err);
    console.error('Command:', command);
    console.error('CWD:', workDir);
    console.error('Platform:', process.platform);
    console.error('PATH:', process.env.PATH);
    
    res.json({
      stdout: err.stdout?.trimEnd() || '',
      stderr: err.stderr?.trimEnd() || err.message || String(err),
      exitCode: err.code || 1,
      cwd: currentCwd,
      errorDetails: {
        message: err.message,
        code: err.code,
        platform: process.platform,
        path: process.env.PATH
      }
    });
  }
});

export default router;
