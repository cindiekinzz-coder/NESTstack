import { Router } from 'express';
import fileRead from './file-read.js';
import fileWrite from './file-write.js';
import fileEdit from './file-edit.js';
import glob from './glob.js';
import grep from './grep.js';
import shell from './shell.js';
import process from './process.js';
import screenshot from './screenshot.js';
import clipboard from './clipboard.js';
import app from './app.js';
import web from './web.js';

const router = Router();

router.use('/file', fileRead);
router.use('/file', fileWrite);
router.use('/file', fileEdit);
router.use('/', glob);
router.use('/', grep);
router.use('/', shell);
router.use('/process', process);
router.use('/', screenshot);
router.use('/clipboard', clipboard);
router.use('/app', app);
router.use('/web', web);

export default router;
