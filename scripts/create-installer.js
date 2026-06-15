const fs = require("fs");
const path = require("path");
const { createWindowsInstaller } = require("electron-winstaller");

async function run() {
  const root = path.resolve(__dirname, "..");
  const appDirectory = path.join(root, "release", "AI-Content-Studio-win32-x64");
  const outputDirectory = path.join(root, "release", "installer");
  const packagedExe = path.join(appDirectory, "AI-Content-Studio.exe");

  if (!fs.existsSync(appDirectory)) {
    console.error(`Missing folder (did pack:exe fail?): ${appDirectory}`);
    process.exit(1);
  }
  if (!fs.existsSync(packagedExe)) {
    console.error(`Missing ${packagedExe}. Check electron-packager app name matches create-installer.js.`);
    process.exit(1);
  }

  await createWindowsInstaller({
    appDirectory,
    outputDirectory,
    exe: "AI-Content-Studio.exe",
    setupExe: "AI-Content-Studio-Setup.exe",
    noMsi: true,
    authors: "local",
    description: "AI 内容工作室",
    title: "AI 内容工作室",
    name: "ai_desktop_analyst",
    loadingGif: undefined,
  });

  console.log(`Installer generated in: ${outputDirectory}`);
}

run().catch((err) => {
  console.error("Failed to create installer:", err);
  process.exitCode = 1;
});
