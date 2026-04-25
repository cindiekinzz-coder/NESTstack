import { Router } from 'express';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const router = Router();

// Try to find ripgrep binary
async function findRg() {
  const candidates = [
    'rg',
    'C:\\Users\\YourName\\.cargo\\bin\\rg.exe',
    'C:\\Program Files\\ripgrep\\rg.exe',
  ];
  for (const c of candidates) {
    try {
      await execFileAsync(c, ['--version'], { timeout: 3000, windowsHide: true });
      return c;
    } catch {}
  }
  return null;
}

let rgPath = null;

/**
 * Content search using ripgrep — same approach as Claude Code.
 * Falls back to PowerShell Select-String if rg not found.
 */
router.post('/grep', async (req, res) => {
  try {
    const {
      pattern,
      path: searchPath,
      glob: globFilter,
      type,
      output_mode = 'files_with_matches',
      context,
      case_insensitive = false,
      multiline = false,
      head_limit = 250,
    } = req.body;

    if (!pattern) return res.status(400).json({ error: 'pattern is required' });

    // Find rg once
    if (rgPath === null) rgPath = await findRg() || false;

    if (rgPath) {
      // Use ripgrep
      const args = [];
      if (output_mode === 'files_with_matches') args.push('-l');
      else if (output_mode === 'count') args.push('-c');
      else args.push('-n');

      if (case_insensitive) args.push('-i');
      if (multiline) args.push('-U', '--multiline-dotall');
      if (context) args.push('-C', String(context));
      if (globFilter) args.push('--glob', globFilter);
      if (type) args.push('--type', type);
      args.push('--max-count', '1000');
      args.push(pattern);
      args.push(searchPath || '.');

      const { stdout } = await execFileAsync(rgPath, args, {
        cwd: searchPath || process.cwd(),
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      }).catch((err) => {
        if (err.code === 1) return { stdout: '' };
        throw err;
      });

      const lines = stdout.split('\n').filter(Boolean);
      const truncated = lines.length > head_limit;
      const result = lines.slice(0, head_limit);
      return res.json({ output: result.join('\n'), matches: result.length, truncated });
    }

    // Fallback: PowerShell Select-String
    const cwd = searchPath || process.cwd();
    const flags = case_insensitive ? '' : '-CaseSensitive';
    const recurse = '-Recurse';
    const fileFilter = globFilter ? `-Include "${globFilter}"` : '';
    const cmd = `Get-ChildItem -Path "${cwd}" ${recurse} ${fileFilter} -File | Select-String -Pattern "${pattern.replace(/"/g, '`"')}" ${flags} | Select-Object -First ${head_limit} | ForEach-Object { $_.Path + ':' + $_.LineNumber + ':' + $_.Line }`;

    const { stdout } = await execAsync(`powershell.exe -Command "${cmd.replace(/"/g, '\\"')}"`, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }).catch(() => ({ stdout: '' }));

    const lines = stdout.split('\n').filter(Boolean);
    res.json({ output: lines.join('\n'), matches: lines.length, truncated: false, engine: 'powershell' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
