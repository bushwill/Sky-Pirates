#!/usr/bin/env node

const fs = require('fs');

const htmlPath = './landing.html';
const assetFiles = ['p5.min.js', 'plant_overlay.js'];
const version = `A.${Date.now()}`;

let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(
    /(<meta name="build-version" content=")[\w.]+("\s*\/?>)/,
    `$1${version}$2`
);

for (const file of assetFiles) {
    const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionPattern = new RegExp(`(${escapedFile}\\?v=)[\\w.]+`, 'g');

    if (!versionPattern.test(html)) {
        throw new Error(`Missing versioned reference for ${file} in ${htmlPath}`);
    }

    html = html.replace(versionPattern, `$1${version}`);
    console.log(`${file}: ${version}`);
}

fs.writeFileSync(htmlPath, html);