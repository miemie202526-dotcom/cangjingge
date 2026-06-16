const path = require("path");
const { app, BrowserWindow } = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const userData = path.join(app.getPath("home"), "Library", "Application Support", "ai-content-studio");

app.setPath("userData", userData);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });
  await win.loadFile(path.join(projectRoot, "scripts", "export-current-seed.html"), {
    query: { projectRoot },
  });
});

app.on("window-all-closed", () => app.quit());
