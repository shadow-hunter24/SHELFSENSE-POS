const { app, BrowserWindow, Menu, Tray, ipcMain, powerSaveBlocker, dialog, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const { autoUpdater } = require('electron-updater');

let phpServer = null;
let mainWindow = null;
let appTray = null;
let serverUrl = 'http://127.0.0.1:8000/';
let isServerStarting = false;
let windowCreated = false;
let serverCheckInProgress = false;
let powerSaveBlockerId = null;
let activeDbPath = null;
let activeWritableDataDir = null;
const MAX_BACKUPS_PER_DIR = 30;

// ─── Persist window bounds across sessions ───────────────────────
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (fs.existsSync(WINDOW_STATE_FILE())) {
      return JSON.parse(fs.readFileSync(WINDOW_STATE_FILE(), 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { width: 1280, height: 820, x: undefined, y: undefined, maximized: false };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    const state = {
      ...bounds,
      maximized: mainWindow.isMaximized(),
    };
    fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify(state), 'utf8');
  } catch (e) { /* ignore */ }
}

// ─── Logging Setup ───────────────────────────────────────────────
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(logDir, `cf-trading-ent-${date}.log`);
}

function writeLog(entry) {
  try {
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const line = `[${timestamp}] [${entry.level || 'INFO'}] [${entry.category || 'APP'}] ${entry.message}\n`;
    fs.appendFileSync(getLogFilePath(), line, 'utf8');
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

// IPC handler for logging from renderer
ipcMain.handle('write-log', async (event, entry) => {
  writeLog(entry);
});

// IPC handler to read logs
ipcMain.handle('read-logs', async (event, date) => {
  try {
    const logFile = date 
      ? path.join(logDir, `cf-trading-ent-${date}.log`)
      : getLogFilePath();
    if (!fs.existsSync(logFile)) return [];
    const content = fs.readFileSync(logFile, 'utf8');
    return content.split('\n').filter(line => line.trim() !== '');
  } catch (e) {
    return [];
  }
});

// IPC handler to get available log dates
ipcMain.handle('get-log-dates', async () => {
  try {
    if (!fs.existsSync(logDir)) return [];
    const files = fs.readdirSync(logDir)
      .filter(f => (f.startsWith('cf-trading-ent-') || f.startsWith('shelfsense-')) && f.endsWith('.log'))
      .map(f => f.replace('cf-trading-ent-', '').replace('shelfsense-', '').replace('.log', ''))
      .sort()
      .reverse(); // Most recent first
    return files;
  } catch (e) {
    return [];
  }
});

ipcMain.handle('get-app-info', async () => ({
  isDesktop: true,
  isPackaged: app.isPackaged,
  version: app.getVersion(),
  name: app.getName(),
  userDataPath: app.getPath('userData'),
  platform: process.platform,
}));

ipcMain.handle('open-user-data-folder', async () => {
  const { shell } = require('electron');
  await shell.openPath(app.getPath('userData'));
});

ipcMain.handle('backup-database', async () => createDatabaseBackup('manual'));

ipcMain.handle('list-database-backups', async () => ({
  ok: true,
  items: listDatabaseBackups(),
  documentsFolder: path.join(app.getPath('documents'), 'C F Trading ENT POS', 'backups'),
  userDataFolder: path.join(app.getPath('userData'), 'backups'),
  databasePath: activeDbPath,
}));

ipcMain.handle('restore-database', async (_event, backupPath) => restoreDatabaseFile(backupPath));

ipcMain.handle('open-backup-folder', async () => {
  const { shell } = require('electron');
  const folder = path.join(app.getPath('documents'), 'C F Trading ENT POS', 'backups');
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  await shell.openPath(folder);
});

ipcMain.handle('export-database', async () => {
  if (!activeDbPath || !fs.existsSync(activeDbPath)) {
    return { ok: false, error: 'Database not found' };
  }
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Database Backup',
    defaultPath: path.join(app.getPath('documents'), formatBackupFilename()),
    filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
  });
  if (canceled || !filePath) return { ok: false, cancelled: true };
  fs.copyFileSync(activeDbPath, filePath);
  return { ok: true, path: filePath };
});

ipcMain.handle('import-database', async () => {
  if (!activeDbPath) return { ok: false, error: 'Database path is not ready' };
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Database Backup',
    filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.length) return { ok: false, cancelled: true };
  return restoreDatabaseFile(filePaths[0]);
});

function getAppIconPath() {
  const iconName = 'cf-trading-ent.ico';
  const unpackedIcon = path.join(process.resourcesPath, 'app.asar.unpacked', iconName);
  const candidates = [
    unpackedIcon,
    path.join(__dirname, iconName),
    path.join(process.resourcesPath, iconName),
    path.join(__dirname, '..', 'assets', 'cf-trading-ent.ico'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getWindowIcon() {
  const iconPath = getAppIconPath();
  if (!iconPath) return undefined;
  try {
    const image = nativeImage.createFromPath(iconPath);
    return image.isEmpty() ? undefined : image;
  } catch (e) {
    console.warn('Failed to load app icon:', e.message);
    return undefined;
  }
}

function resolveServerUrl(appDir) {
  const indexPhp = path.join(appDir, 'index.php');
  if (fs.existsSync(indexPhp)) {
    return 'http://127.0.0.1:8000/index.php';
  }
  const indexHtml = path.join(appDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    return 'http://127.0.0.1:8000/index.html';
  }
  return 'http://127.0.0.1:8000/';
}

function getWritableDataDir(isDev) {
  if (isDev) {
    return path.join(path.resolve(__dirname, '..'), 'data');
  }
  return app.getPath('userData');
}

function resolveDatabasePath(isDev, appDir, writableDataDir) {
  const projectDbPath = path.join(appDir, 'data', 'stocktracker.sqlite');
  const userDbPath = path.join(writableDataDir, 'stocktracker.sqlite');

  if (!fs.existsSync(writableDataDir)) {
    fs.mkdirSync(writableDataDir, { recursive: true });
  }

  if (isDev) {
    if (!fs.existsSync(path.dirname(projectDbPath))) {
      fs.mkdirSync(path.dirname(projectDbPath), { recursive: true });
    }
    return projectDbPath;
  }

  if (!fs.existsSync(userDbPath)) {
    const latestBackup = getLatestDatabaseBackup();
    if (latestBackup) {
      fs.copyFileSync(latestBackup.path, userDbPath);
      writeLog({
        level: 'INFO',
        category: 'BACKUP',
        message: `Restored database after reinstall from ${latestBackup.name}`,
      });
      return userDbPath;
    }

    if (fs.existsSync(projectDbPath)) {
      fs.copyFileSync(projectDbPath, userDbPath);
      writeLog({ level: 'INFO', category: 'APP', message: 'Initialized new database from bundled template' });
    }
    return userDbPath;
  }

  // Never overwrite an existing live database with the bundled template.
  return userDbPath;
}

function buildPhpArgs(isDev) {
  const phpIni = isDev
    ? path.join(__dirname, 'php', 'php.ini')
    : path.join(process.resourcesPath, 'php', 'php.ini');
  const args = ['-S', '127.0.0.1:8000'];
  if (fs.existsSync(phpIni)) {
    args.unshift('-c', phpIni);
  }
  return args;
}

// ─── Database backup & restore ───────────────────────────────────
function getBackupDirectories() {
  const dirs = [
    path.join(app.getPath('documents'), 'C F Trading ENT POS', 'backups'),
    path.join(app.getPath('userData'), 'backups'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return dirs;
}

function formatBackupFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `stocktracker-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.sqlite`;
}

function pruneBackupDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  files.slice(MAX_BACKUPS_PER_DIR).forEach((f) => {
    try {
      fs.unlinkSync(path.join(dir, f.name));
    } catch (e) {
      writeLog({ level: 'WARN', category: 'BACKUP', message: `Failed to prune old backup: ${f.name}` });
    }
  });
}

function createDatabaseBackup(reason = 'manual') {
  if (!activeDbPath || !fs.existsSync(activeDbPath)) {
    return { ok: false, error: 'Database not found' };
  }

  const savedPaths = [];
  for (const dir of getBackupDirectories()) {
    const dest = path.join(dir, formatBackupFilename());
    fs.copyFileSync(activeDbPath, dest);
    pruneBackupDirectory(dir);
    savedPaths.push(dest);
  }

  writeLog({ level: 'INFO', category: 'BACKUP', message: `Database backed up (${reason})` });
  return { ok: true, paths: savedPaths };
}

function listDatabaseBackups() {
  const backups = [];
  for (const dir of getBackupDirectories()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.sqlite')) continue;
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      backups.push({
        path: fullPath,
        name: file,
        folder: dir,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }
  backups.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return backups;
}

function getLatestDatabaseBackup() {
  const backups = listDatabaseBackups();
  return backups.length > 0 ? backups[0] : null;
}

function shouldAutoBackup() {
  const backups = listDatabaseBackups();
  if (backups.length === 0) return true;
  const last = new Date(backups[0].modified).getTime();
  return (Date.now() - last) > (24 * 60 * 60 * 1000);
}

function restoreDatabaseFile(sourcePath) {
  if (!activeDbPath) {
    return { ok: false, error: 'Database path is not ready' };
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: 'Backup file not found' };
  }

  createDatabaseBackup('pre-restore');
  stopPhpServer();
  fs.copyFileSync(sourcePath, activeDbPath);
  writeLog({ level: 'INFO', category: 'BACKUP', message: `Database restored from ${path.basename(sourcePath)}` });
  startPhpServer();
  return { ok: true };
}

// Log app start
writeLog({ level: 'INFO', category: 'APP', message: 'C F Trading ENT application started' });
// ─────────────────────────────────────────────────────────────────

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else if (!isServerStarting) {
      startPhpServer();
    }
  });
}

// ─── Auto Updater ────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return; // Only run in production

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    writeLog({ level: 'INFO', category: 'UPDATER', message: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    writeLog({ level: 'INFO', category: 'UPDATER', message: `Update available: ${info.version}` });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available.`,
      detail: 'Downloading update in the background. You will be notified when it\'s ready to install.',
      buttons: ['OK']
    });
  });

  autoUpdater.on('update-not-available', () => {
    writeLog({ level: 'INFO', category: 'UPDATER', message: 'App is up to date.' });
  });

  autoUpdater.on('update-downloaded', (info) => {
    writeLog({ level: 'INFO', category: 'UPDATER', message: `Update downloaded: ${info.version}` });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the app. Restart now?',
      buttons: ['Restart Now', 'Later']
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    writeLog({ level: 'ERROR', category: 'UPDATER', message: `Update error: ${err.message}` });
  });

  // Check for updates 5 seconds after app is ready
  setTimeout(() => autoUpdater.checkForUpdates(), 5000);
}
// ─────────────────────────────────────────────────────────────────

function checkServerReady(callback, attempts = 0) {
  if (serverCheckInProgress) {
    console.log('Server check already in progress, skipping...');
    return;
  }
  
  serverCheckInProgress = true;
  const maxAttempts = 60; // 30 seconds max wait (increased from 15)
  
  if (attempts >= maxAttempts) {
    console.error('PHP server failed to start after 30 seconds');
    serverCheckInProgress = false;
    callback(false);
    return;
  }

  const req = http.get(serverUrl, (res) => {
    console.log(`Server check attempt ${attempts + 1}: Status ${res.statusCode}`);
    if (res.statusCode === 200) {
      // Wait a bit more to ensure server is fully ready
      setTimeout(() => {
        serverCheckInProgress = false;
        callback(true);
      }, 1000);
    } else {
      setTimeout(() => {
        serverCheckInProgress = false;
        checkServerReady(callback, attempts + 1);
      }, 500);
    }
  });

  req.on('error', (err) => {
    console.log(`Server check attempt ${attempts + 1}: Not ready yet (${err.code})`);
    setTimeout(() => {
      serverCheckInProgress = false;
      checkServerReady(callback, attempts + 1);
    }, 500);
  });

  req.setTimeout(2000, () => {
    req.destroy();
    setTimeout(() => {
      serverCheckInProgress = false;
      checkServerReady(callback, attempts + 1);
    }, 500);
  });
}

function startPhpServer() {
  if (isServerStarting) {
    console.log('Server startup already in progress, skipping...');
    return;
  }
  
  isServerStarting = true;
  
  const isDev = !app.isPackaged;
  const appDir = isDev ? path.resolve(__dirname, '..') : path.join(process.resourcesPath, 'app');

  console.log('App directory:', appDir);
  console.log('Is development:', isDev);

  // Verify app directory exists and has required files
  if (!fs.existsSync(appDir)) {
    console.error('App directory does not exist:', appDir);
    isServerStarting = false;
    return;
  }

  const indexPath = path.join(appDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('index.html not found in app directory:', indexPath);
    isServerStarting = false;
    return;
  }

  serverUrl = resolveServerUrl(appDir);
  console.log('Server URL:', serverUrl);

  const writableDataDir = getWritableDataDir(isDev);
  const dbPath = resolveDatabasePath(isDev, appDir, writableDataDir);
  activeDbPath = dbPath;
  activeWritableDataDir = writableDataDir;

  const env = {
    ...process.env,
    STOCKTRACKER_DB_PATH: dbPath,
    STOCKTRACKER_DATA_DIR: writableDataDir,
    DESKTOP_APP: '1',
    DESKTOP_SESSION_TIMEOUT: '28800',
  };

  console.log('Database path:', dbPath);
  console.log('Writable data dir:', writableDataDir);

  // Use bundled PHP - always use bundled PHP for consistency
  let phpExe;
  
  if (isDev) {
    // Development: Use bundled PHP if available, otherwise system PHP
    const devBundledPhp = path.join(__dirname, 'php', 'php.exe');
    if (fs.existsSync(devBundledPhp)) {
      phpExe = devBundledPhp;
      console.log('Development: Using bundled PHP from desktop/php/');
    } else {
      // Fallback to system PHP only in development
      phpExe = 'php';
      console.log('Development: Using system PHP (bundled PHP not found)');
    }
  } else {
    // Production: ALWAYS use bundled PHP
    phpExe = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'php', 'php.exe')
      : path.join(process.resourcesPath, 'php', 'php');
    console.log('Production: Using bundled PHP from resources');
  }

  console.log('Using PHP executable:', phpExe);
  console.log('PHP executable exists:', fs.existsSync(phpExe));

  // Verify PHP exists before proceeding
  if (!fs.existsSync(phpExe) && phpExe !== 'php') {
    console.error('PHP executable not found at:', phpExe);
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'PHP Not Found', 
      'The bundled PHP executable was not found.\n\n' +
      'Expected location: ' + phpExe + '\n\n' +
      'Please ensure the application was installed correctly.'
    );
    isServerStarting = false;
    app.quit();
    return;
  }

  // Test PHP executable before proceeding (only in development)
  if (isDev && phpExe !== 'php') {
    const testPhp = spawn(phpExe, ['--version'], { stdio: 'pipe' });
    testPhp.on('error', (error) => {
      console.error('PHP executable test failed:', error);
      const { dialog } = require('electron');
      dialog.showErrorBox('PHP Error', 'PHP test failed: ' + error.message + '\n\nPlease ensure PHP is available.');
      isServerStarting = false;
      app.quit();
      return;
    });

    testPhp.on('close', (code) => {
      if (code !== 0) {
        console.error('PHP test failed with code:', code);
        const { dialog } = require('electron');
        dialog.showErrorBox('PHP Error', 'PHP test failed. Please check your PHP installation.');
        isServerStarting = false;
        app.quit();
        return;
      }
      console.log('PHP test successful, proceeding with server startup...');
      actuallyStartServer();
    });
  } else {
    console.log('Production mode: verifying bundled PHP...');
    const testPhp = spawn(phpExe, ['--version'], { stdio: 'pipe', windowsHide: true });
    testPhp.on('error', (error) => {
      writeLog({ level: 'ERROR', category: 'APP', message: 'PHP failed: ' + error.message });
      const { dialog, shell } = require('electron');
      const missingDll = error.code === 'ENOENT' || error.message.includes('ENOENT');
      dialog.showMessageBox({
        type: 'error',
        title: 'PHP Startup Error',
        message: 'Could not start the bundled PHP engine.',
        detail:
          'This usually means the Microsoft Visual C++ Runtime is not installed on this PC.\n\n' +
          'Please install it from Microsoft:\n' +
          'https://aka.ms/vs/17/release/vc_redist.x64.exe\n\n' +
          'Steps:\n' +
          '1. Click "Open Download Page" below\n' +
          '2. Download and install vc_redist.x64.exe\n' +
          '3. Restart your PC\n' +
          '4. Launch C F Trading ENT POS again\n\n' +
          'Technical detail: ' + error.message,
        buttons: ['Open Download Page', 'Close'],
        defaultId: 0
      }).then(result => {
        if (result.response === 0) {
          shell.openExternal('https://aka.ms/vs/17/release/vc_redist.x64.exe');
        }
        isServerStarting = false;
        app.quit();
      });
    });
    testPhp.on('close', (code) => {
      if (code !== 0) {
        writeLog({ level: 'ERROR', category: 'APP', message: 'PHP test exited with code: ' + code });
        const { dialog, shell } = require('electron');
        // 0xC0000135 = 3221225781 = missing VC++ DLL
        // 0xFFFFFFFE = 4294967294 = killed by antivirus/Windows Defender
        const isMissingDll = (code === 3221225781 || code === -1073741515);
        const isBlocked    = (code === 4294967294 || code === -2);
        dialog.showMessageBox({
          type: 'error',
          title: isMissingDll ? 'PHP Error — Missing Runtime'
               : isBlocked   ? 'PHP Blocked by Antivirus'
               :                'PHP Startup Error',
          message: isMissingDll
            ? 'Microsoft Visual C++ Runtime is not installed.'
            : isBlocked
            ? 'Windows Defender or Antivirus is blocking PHP.'
            : 'Bundled PHP failed to start (code ' + code + ').',
          detail: isMissingDll
            ? 'The app requires the Microsoft Visual C++ 2015-2022 Redistributable (x64).\n\n' +
              'Steps to fix:\n' +
              '1. Click "Download & Install" below\n' +
              '2. Run the downloaded vc_redist.x64.exe\n' +
              '3. Restart your PC\n' +
              '4. Launch C F Trading ENT POS again'
            : isBlocked
            ? 'Windows Defender or your antivirus has blocked the bundled PHP engine.\n\n' +
              'Steps to fix:\n' +
              '1. Open Windows Security → Virus & threat protection\n' +
              '2. Click "Protection history"\n' +
              '3. Find the blocked item (php.exe) and click "Allow"\n' +
              '4. OR add an exclusion for the app install folder:\n' +
              '   C:\\Users\\[YourName]\\AppData\\Local\\Programs\\C F Trading ENT POS\n' +
              '5. Restart the app'
            : 'Please try reinstalling the application.\n\nIf the problem persists, contact support.',
          buttons: isMissingDll ? ['Download & Install VC++ Runtime', 'Close'] : ['Close'],
          defaultId: 0
        }).then(result => {
          if (isMissingDll && result.response === 0) {
            shell.openExternal('https://aka.ms/vs/17/release/vc_redist.x64.exe');
          }
          isServerStarting = false;
          app.quit();
        });
        return;
      }
      actuallyStartServer();
    });
  }

  function actuallyStartServer() {

  try {
    // Kill any existing PHP processes on port 8000
    if (process.platform === 'win32') {
      require('child_process').exec('netstat -ano | findstr :8000', (err, stdout) => {
        if (stdout) {
          console.log('Found existing processes on port 8000, attempting to start anyway...');
        }
      });
    }

    console.log('Starting PHP server with command:', phpExe, ...buildPhpArgs(isDev));
    console.log('Working directory:', appDir);

    phpServer = spawn(phpExe, buildPhpArgs(isDev), {
      cwd: appDir, 
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    phpServer.stdout.on('data', (data) => {
      console.log('[PHP stdout]', data.toString());
    });

    phpServer.stderr.on('data', (data) => {
      const message = data.toString();
      console.log('[PHP stderr]', message);
      
      // Check for server ready message and create window only once
      if (message.includes('Development Server') && message.includes('started') && !windowCreated) {
        console.log('PHP server startup detected, creating window...');
        windowCreated = true;
        // Give the server a moment to fully initialize
        setTimeout(() => {
          createWindow();
        }, 1500);
      }
    });

    phpServer.on('error', (error) => {
      console.error('PHP server error:', error);
      isServerStarting = false;
      // Show error dialog instead of infinite restart loop
      const { dialog } = require('electron');
      dialog.showErrorBox('Server Error', 'PHP server failed to start: ' + error.message);
      app.quit();
    });

    phpServer.on('close', (code) => {
      console.log('PHP server closed with code:', code);
      if (code !== null && code !== 0 && code !== 15) { // 15 is SIGTERM (normal shutdown)
        console.log('PHP server crashed, attempting restart...');
        isServerStarting = false;
        windowCreated = false;
        setTimeout(() => startPhpServer(), 2000);
      }
    });

    // Remove the checkServerReady call since we're now using the stderr detection
    // checkServerReady((ready) => {
    //   isServerStarting = false;
    //   if (ready) {
    //     console.log('PHP server is ready, creating window...');
    //     if (!windowCreated) {
    //       windowCreated = true;
    //       createWindow();
    //     }
    //   } else {
    //     console.error('Failed to start PHP server');
    //     // Show error dialog
    //     const { dialog } = require('electron');
    //     dialog.showErrorBox('Server Error', 'Failed to start PHP server. Please ensure PHP is installed and try again.');
    //     app.quit();
    //   }
    // });

    // Fallback: if window not created after 10 seconds, try anyway
    setTimeout(() => {
      if (!windowCreated) {
        console.log('Fallback: Creating window after timeout...');
        windowCreated = true;
        createWindow();
      }
      isServerStarting = false;
      if (activeDbPath && fs.existsSync(activeDbPath) && shouldAutoBackup()) {
        createDatabaseBackup('startup');
      }
    }, 10000);

  } catch (error) {
    console.error('Failed to start PHP server:', error);
    const { dialog } = require('electron');
    dialog.showErrorBox('Startup Error', 'Failed to start PHP server: ' + error.message);
    app.quit();
  }
  } // End of actuallyStartServer function
}

function stopPhpServer() {
  if (phpServer) {
    phpServer.kill();
    phpServer = null;
  }
}

function createTray() {
  if (appTray) return; // already created
  const iconPath = getAppIconPath();
  if (!iconPath) {
    // No icon found — tray won't be created, but ensure window is visible
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }

  try {
    appTray = new Tray(iconPath);
    appTray.setToolTip('C F Trading ENT POS — Running');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open C F Trading ENT POS',
        click: () => {
          if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          appTray.destroy();
          appTray = null;
          app.quit();
        },
      },
    ]);

    appTray.setContextMenu(contextMenu);
    appTray.on('double-click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (e) {
    writeLog({ level: 'WARN', category: 'APP', message: 'Tray creation failed: ' + e.message });
  }
}

function createWindow() {
  if (mainWindow) {
    console.log('Window already exists, focusing existing window...');
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const windowIcon = getWindowIcon();
  const savedState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: 960,
    minHeight: 640,
    show: true,
    title: 'C F Trading ENT POS',
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // webSecurity must remain true — disabling it removes same-origin protection.
      // The app communicates only with 127.0.0.1:8000 (its own bundled PHP server),
      // so same-origin is never a problem.
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false, // CRITICAL: prevent throttling on busy POS shifts
      offscreen: false,
    }
  });

  if (savedState.maximized) mainWindow.maximize();

  // Persist window bounds on move/resize (debounced)
  const saveBoundsDebounced = (() => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(saveWindowState, 500); };
  })();
  mainWindow.on('resize', saveBoundsDebounced);
  mainWindow.on('move', saveBoundsDebounced);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);

  // Create system tray
  createTray();

  // Minimise to tray only when tray icon is available; otherwise use normal minimise
  mainWindow.on('minimize', () => {
    if (appTray) {
      mainWindow.hide();
      if (appTray.displayBalloon) {
        appTray.displayBalloon({
          title: 'C F Trading ENT POS',
          content: 'Still running in the background. Click the tray icon to restore.',
          iconType: 'info',
        });
      }
    }
    // No tray icon: let the window minimize normally (stays in taskbar)
  });

  // ── Focus Fix ─────────────────────────────────────────────────────
  mainWindow.on('focus', () => {
    mainWindow.webContents.focus();
  });
  // ──────────────────────────────────────────────────────────────────

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();

    // Inject renderer-side fix only if inputs are actually broken
    mainWindow.webContents.executeJavaScript(`
      // One-time fix: ensure inputs are enabled on load
      document.querySelectorAll('input, textarea, select').forEach(el => {
        if (!el.disabled && el.type !== 'hidden') {
          el.style.pointerEvents = 'auto';
          el.style.userSelect = 'auto';
          el.removeAttribute('inert');
        }
      });
      console.log('C F Trading ENT: Input stability fix active');
    `).catch(err => console.error('Input fix script error:', err));
  });
  
  // Load the app directly without clearing cache on every launch
  mainWindow.loadURL(serverUrl);
  
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window loaded successfully');
    // Always show on load (handles no-tray-icon scenario and first load)
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.focus();
    }
    // Safety net: always bring to front after a brief delay
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, 1000);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
    // Only retry if it's a connection error and server might be starting
    if (errorCode === -102 && !windowCreated) { // ERR_CONNECTION_REFUSED
      setTimeout(() => {
        console.log('Retrying page load...');
        if (mainWindow && !mainWindow.isDestroyed()) {
          const retryUrl = `${serverUrl}?retry=${Date.now()}`;
          mainWindow.loadURL(retryUrl);
        }
      }, 2000);
    }
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('Console:', message);
  });

  // Add keyboard shortcut for refresh (Ctrl+R or F5)
  // Block DevTools in production builds — Ctrl+Shift+I / F12 should not
  // allow customers or cashiers to inspect the app internals.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      mainWindow.webContents.reload();
    }
    if (app.isPackaged) {
      const isDevTools =
        (input.control && input.shift && input.key.toLowerCase() === 'i') ||
        (input.control && input.shift && input.key.toLowerCase() === 'j') ||
        input.key === 'F12';
      if (isDevTools) {
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    saveWindowState();
    stopPhpServer();
    if (appTray) { appTray.destroy(); appTray = null; }
    mainWindow = null;
    windowCreated = false;
  });

  // Warn before closing if renderer reports an active (unsaved) receipt.
  // The renderer sets window.__activeReceiptInProgress = true while a sale is open.
  mainWindow.on('close', (e) => {
    if (!mainWindow) return;
    mainWindow.webContents.executeJavaScript('window.__activeReceiptInProgress || false')
      .then((active) => {
        if (active) {
          e.preventDefault();
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Receipt In Progress',
            message: 'A receipt is currently open.',
            detail: 'Closing now will discard the unsaved sale. Are you sure you want to quit?',
            buttons: ['Keep Open', 'Discard & Quit'],
            defaultId: 0,
            cancelId: 0,
          }).then(({ response }) => {
            if (response === 1) {
              mainWindow.destroy(); // force close without triggering 'close' again
            }
          });
        }
      })
      .catch(() => {}); // If JS context is gone, allow close
  });

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

// IPC handler for printing
ipcMain.handle('print-receipt', async (event, htmlContent) => {
  const printWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load the HTML content
  await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
  
  // Wait for content to be ready
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return new Promise((resolve) => {
    printWindow.webContents.print({
      silent: false,
      printBackground: true,
      color: false,
      margins: {
        marginType: 'none'
      },
      pageSize: {
        width: 80000,  // 80mm in microns
        height: 297000 // tall enough for any receipt; thermal cuts automatically
      },
      scaleFactor: 100
    }, (success, errorType) => {
      if (!success) {
        console.log('Print cancelled or failed:', errorType);
        // Don't reject - just resolve with false so no error is shown
        resolve(false);
      } else {
        resolve(true);
      }
      printWindow.close();
    });
  });
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  console.log('Electron app ready, starting PHP server...');

  app.setName('C F Trading ENT POS');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.cftradingent.pos');
  }
  
  // CRITICAL: Prevent system from throttling the app
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  console.log('Power save blocker started:', powerSaveBlocker.isStarted(powerSaveBlockerId));

  setupAutoUpdater();
  
  // Create application menu with refresh option
  const isPackaged = app.isPackaged;
  const viewSubmenu = [
    { role: 'reload' },
    { role: 'forceReload' },
    ...(isPackaged ? [] : [{ role: 'toggleDevTools' }]),
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ];

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.reload();
            }
          }
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('Force reload requested...');
              mainWindow.webContents.reloadIgnoringCache();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: viewSubmenu
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Data Folder',
          click: async () => {
            const { shell } = require('electron');
            await shell.openPath(app.getPath('userData'));
          }
        },
        {
          label: 'Open Backup Folder',
          click: async () => {
            const folder = path.join(app.getPath('documents'), 'C F Trading ENT POS', 'backups');
            if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
            await require('electron').shell.openPath(folder);
          }
        },
        { type: 'separator' },
        {
          label: 'About C F Trading ENT POS',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About C F Trading ENT POS',
              message: 'C F Trading ENT POS',
              detail: 
                `Version: ${app.getVersion()}\n\n` +
                'Offline desktop POS & inventory system.\n\n' +
                'Your business data is stored locally in:\n' +
                `${app.getPath('userData')}\n\n` +
                'Track Stock. Prevent Loss. Grow Profit.\n\n' +
                '© 2026 C F Trading ENT. All rights reserved.',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  
  startPhpServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !isServerStarting) {
      if (phpServer) {
        // Server is running but no window, just create window
        if (!windowCreated) {
          windowCreated = true;
          createWindow();
        }
      } else {
        // No server running, start everything
        startPhpServer();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (activeDbPath && fs.existsSync(activeDbPath)) {
      try {
        createDatabaseBackup('shutdown');
      } catch (e) {
        writeLog({ level: 'WARN', category: 'BACKUP', message: `Shutdown backup failed: ${e.message}` });
      }
    }
    // Stop power save blocker
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      console.log('Power save blocker stopped');
    }
    writeLog({ level: 'INFO', category: 'APP', message: 'C F Trading ENT application closed' });
    stopPhpServer();
    isServerStarting = false;
    windowCreated = false;
    app.quit();
  }
});
