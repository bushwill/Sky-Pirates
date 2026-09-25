#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const appDir = __dirname;
const versionFilePath = path.join(appDir, 'build-version.txt');
const htmlPath = path.join(appDir, 'index.html');

function readBuildNumber() {
  if (!fs.existsSync(versionFilePath)) {
    return 0;
  }

  const raw = fs.readFileSync(versionFilePath, 'utf8').trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeBuildNumber(number) {
  fs.writeFileSync(versionFilePath, String(number), 'utf8');
}

function applyVersionToAsset(html, assetPath, version) {
  const escapedAsset = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const versionPattern = new RegExp(`(${escapedAsset})(\\?v=[A-Za-z0-9.]+)?`, 'g');
  const updatedHtml = html.replace(versionPattern, `$1?v=${version}`);

  if (updatedHtml === html) {
    return html;
  }

  return updatedHtml;
}

try {
  let buildNumber = readBuildNumber();
  buildNumber += 1;
  const version = `A.${buildNumber}`;

  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Missing HTML file: ${htmlPath}`);
  }

  let html = fs.readFileSync(htmlPath, 'utf8');

  html = applyVersionToAsset(html, '/maizemodel/p5.min.js', version);
  html = applyVersionToAsset(html, '/maizemodel/App.js', version);

  fs.writeFileSync(htmlPath, html, 'utf8');
  writeBuildNumber(buildNumber);

  console.log(`Maize model build version: ${version}`);
} catch (error) {
  console.error('Failed to update build version:', error.message);
  process.exit(1);
}
