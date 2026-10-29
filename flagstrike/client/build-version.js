import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const htmlPath = path.resolve('dist/index.html');
const version = `A.${Date.now()}`;
let html = readFileSync(htmlPath, 'utf8');
let versionedAssets = 0;

html = html.replace(
  /((?:src|href)=["'])(\/flagstrike\/assets\/[^"'?#]+)(?:\?[^"']*)?(["'])/g,
  (_match, attribute, assetPath, quote) => {
    versionedAssets += 1;
    return `${attribute}${assetPath}?v=${version}${quote}`;
  },
);

if (versionedAssets === 0) {
  throw new Error(`No built Flagstrike assets found in ${htmlPath}.`);
}

const versionMeta = `<meta name="build-version" content="${version}">`;
if (/<meta name="build-version" content="[^"]*"\s*\/?>/.test(html)) {
  html = html.replace(/<meta name="build-version" content="[^"]*"\s*\/?>/, versionMeta);
} else if (/<\/head>/i.test(html)) {
  html = html.replace(/<\/head>/i, `  ${versionMeta}\n</head>`);
} else {
  throw new Error(`Could not find </head> in ${htmlPath}.`);
}

writeFileSync(htmlPath, html, 'utf8');
