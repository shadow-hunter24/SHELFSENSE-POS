const { contextBridge, ipcRenderer } = require('electron');

// ── Expose desktop API to renderer ───────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  printReceipt: (htmlContent) => ipcRenderer.invoke('print-receipt', htmlContent),
  writeLog: (entry) => ipcRenderer.invoke('write-log', entry),
  readLogs: (date) => ipcRenderer.invoke('read-logs', date),
  getLogDates: () => ipcRenderer.invoke('get-log-dates'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openUserDataFolder: () => ipcRenderer.invoke('open-user-data-folder'),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  listDatabaseBackups: () => ipcRenderer.invoke('list-database-backups'),
  restoreDatabase: (backupPath) => ipcRenderer.invoke('restore-database', backupPath),
  openBackupFolder: () => ipcRenderer.invoke('open-backup-folder'),
  exportDatabase: () => ipcRenderer.invoke('export-database'),
  importDatabase: () => ipcRenderer.invoke('import-database'),
});

// ── Receipt-in-progress guard ─────────────────────────────────────
// The renderer calls window.setReceiptInProgress(true/false) while a
// sale is open. main.js reads window.__activeReceiptInProgress before
// allowing the window to close, so unsaved sales are never silently lost.
window.__activeReceiptInProgress = false;
window.setReceiptInProgress = (active) => {
  window.__activeReceiptInProgress = !!active;
};
