const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  await win.loadFile(distPath);

  // Trigger modal display
  await win.webContents.executeJavaScript(`
    (() => {
      // Click change API key button or force trigger modal
      const btn = document.querySelector('[data-testid="btn-change-api-key"]');
      if (btn) {
        btn.click();
      } else {
        // Open settings first
        const settingsBtn = document.querySelector('button[aria-label*="paramètres"], button[aria-label*="Paramètres"]');
        if (settingsBtn) settingsBtn.click();
      }
    })()
  `);

  await new Promise((r) => setTimeout(r, 600));

  await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.querySelector('[data-testid="btn-change-api-key"]');
      if (btn) btn.click();
    })()
  `);

  await new Promise((r) => setTimeout(r, 600));

  const image = await win.webContents.capturePage();
  const brainDir = path.join(
    process.env.USERPROFILE || 'C:\\Users\\DELL',
    '.gemini',
    'antigravity',
    'brain',
    '0d5cdbbf-a579-4d56-afbe-29b2f749bd3b'
  );
  const outPath = path.join(brainDir, 'screenshot_apikey_modal.png');
  fs.writeFileSync(outPath, image.toPNG());
  console.log('Capture d\'écran de la modal API Key enregistrée :', outPath);

  app.quit();
});
