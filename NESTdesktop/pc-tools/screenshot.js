import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execAsync = promisify(exec);
const router = Router();

router.get('/screenshot', async (req, res) => {
  try {
    const tmpFile = join(tmpdir(), `nestdesktop-screenshot-${Date.now()}.png`);

    // Use PowerShell + .NET to capture screen
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
      $bitmap.Save("${tmpFile.replace(/\\/g, '\\\\')}")
      $graphics.Dispose()
      $bitmap.Dispose()
    `.trim();

    await execAsync(`powershell.exe -Command "${psScript.replace(/"/g, '\\"')}"`, {
      timeout: 10000,
      windowsHide: true,
    });

    const buf = await readFile(tmpFile);
    const base64 = buf.toString('base64');

    // Cleanup
    await unlink(tmpFile).catch(() => {});

    res.json({ type: 'image/png', base64, size: buf.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
