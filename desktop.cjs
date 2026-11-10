const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, Notification } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const origin = 'http://127.0.0.1:8765';
let window, tray, bridge, startupTimer, quitting = false;
let hidOnce = false;

function showPanel() {
  if (!window) return;
  window.show();
  window.focus();
}

function fail(message) {
  if (quitting) return;
  dialog.showErrorBox('El Radarı', message);
  app.quit();
}

function openPanel(code) {
  window = new BrowserWindow({
    width: 1100, height: 850, minWidth: 420, show: false, title: 'El Radarı',
    webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  const contents = window.webContents;
  const trusted = url => url === origin || url.startsWith(origin + '/');
  contents.session.setPermissionRequestHandler((source, permission, callback, details) => {
    callback(source === contents && trusted(details.requestingUrl || source.getURL()) &&
      details.isMainFrame !== false && permission === 'media' &&
      details.mediaTypes?.includes('video') && !details.mediaTypes.includes('audio'));
  });
  contents.session.setPermissionCheckHandler((source, permission, requestingOrigin, details) =>
    source === contents && trusted(requestingOrigin) && details.isMainFrame !== false &&
    permission === 'media' && details.mediaType !== 'audio');
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  const hidePanel = () => {
    window.hide();
    if (!hidOnce && Notification.isSupported()) {
      hidOnce = true;
      new Notification({ title: 'El Radarı tepside', body: 'Kamera açıksa takip sürer. Durdurmak için tepsiden Çıkış seç.' }).show();
    }
  };
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    hidePanel();
  });
  window.on('minimize', event => {
    event.preventDefault();
    hidePanel();
  });
  tray = new Tray(nativeImage.createFromDataURL('data:image/png;base64,' + makeIcon()));
  tray.setToolTip('El Radarı');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Paneli aç', click: showPanel },
    { label: 'Tepsiye gizle', click: hidePanel },
    { label: 'Çıkış', click: () => app.quit() }
  ]));
  tray.on('double-click', showPanel);
  window.loadURL(origin + '/#code=' + code).then(showPanel).catch(() => fail('Yerel panel açılamadı.'));
}

function makeIcon() {
  const size = 24;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - 11.5, y - 11.5);
      if (radius < 4 || (radius > 8 && radius < 11)) {
        const offset = (y * size + x) * 4;
        pixels.set([196,255,164,255],offset);
      }
    }
  }
  return nativeImage.createFromBitmap(pixels,{ width:size,height:size }).toPNG().toString('base64');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showPanel);
  app.on('before-quit', () => {
    quitting = true;
    clearTimeout(startupTimer);
    tray?.destroy();
    bridge?.kill();
  });
  app.whenReady().then(() => {
    if (process.platform !== 'win32') return fail('Masaüstü modu Windows için hazırlanmıştır.');
    app.setAppUserModelId('com.digitalevin.elradari');
    bridge = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'Radar.ps1')], {
      windowsHide: true, env: { ...process.env, EL_RADARI_DESKTOP: '1' },
      stdio: ['pipe','pipe','pipe']
    });
    bridge.stdin.on('error', () => {});
    let stderr = '';
    bridge.stderr.on('data', data => { stderr = (stderr + data).slice(-1000); });
    bridge.on('error', () => fail('Windows yardımcısı başlatılamadı.'));
    bridge.on('exit', () => fail('Windows yardımcısı kapandı. Eski El Radarı açıksa kapatıp tekrar dene.\n' + stderr));
    startupTimer = setTimeout(() => fail('Windows yardımcısı zamanında yanıt vermedi.'), 15000);
    readline.createInterface({ input: bridge.stdout }).on('line', line => {
      const match = /^RADAR_READY ([A-Za-z0-9_-]{24})$/.exec(line);
      if (!match || window || quitting) return;
      clearTimeout(startupTimer);
      openPanel(match[1]);
    });
  });
}
