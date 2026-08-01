const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

if (!fs.existsSync("package.json")) {
  console.log("Missing package.json");
  process.exit(1);
}

const packageJson = readJson("package.json");
let packageLock = null;
if (fs.existsSync("package-lock.json")) {
  packageLock = readJson("package-lock.json");
}

const dependencyNames = new Set();
for (const sectionName of ["dependencies", "devDependencies", "optionalDependencies"]) {
  for (const dependencyName of Object.keys(packageJson[sectionName] || {})) {
    dependencyNames.add(dependencyName);
  }
}

const failures = [];
for (const dependencyName of dependencyNames) {
  const dependencyPackageJsonPath = path.join("node_modules", ...dependencyName.split("/"), "package.json");

  if (!fs.existsSync(dependencyPackageJsonPath)) {
    failures.push(`Missing dependency: ${dependencyName}`);
    continue;
  }

  const lockEntry = packageLock && packageLock.packages && packageLock.packages[`node_modules/${dependencyName}`];
  if (lockEntry && lockEntry.version) {
    const installedPackage = readJson(dependencyPackageJsonPath);
    if (installedPackage.version && installedPackage.version !== lockEntry.version) {
      failures.push(
        `Stale dependency: ${dependencyName} (${installedPackage.version} installed, ${lockEntry.version} required)`
      );
    }
  }
}

if (failures.length > 0) {
  console.log(failures[0]);
  process.exit(1);
}
