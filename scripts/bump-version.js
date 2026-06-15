const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");

function nextVersion(version) {
  const parts = String(version || "0.0.0").split(".").map((n) => Number.parseInt(n, 10));
  while (parts.length < 3) parts.push(0);
  if (parts.some((n) => Number.isNaN(n) || n < 0)) {
    throw new Error(`Invalid version: ${version}`);
  }
  parts[2] += 1;
  return parts.slice(0, 3).join(".");
}

function writeJson(filePath, updater) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  const result = updater(json);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
  return result;
}

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const from = pkg.version;
const to = nextVersion(from);

writeJson(packagePath, (json) => {
  json.version = to;
});

writeJson(lockPath, (json) => {
  json.version = to;
  if (json.packages && json.packages[""]) {
    json.packages[""].version = to;
  }
});

console.log(`[bump-version] ${from} -> ${to}`);
