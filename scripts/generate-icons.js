#!/usr/bin/env node
/**
 * ONE21 PWA Icon Generator
 * Uses sharp to render SVG icons to PNG at multiple sizes.
 *
 * Usage: node scripts/generate-icons.js
 */

'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Ensure output directory exists
fs.mkdirSync(ICONS_DIR, { recursive: true });

// Base SVG icon design: dark bg + glowing border + ONE box + _21 suffix
function buildSVG(size) {
  // Scale stroke widths and font sizes proportionally from the 512 base
  const scale = size / 512;
  const s = (v) => (v * scale).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#00e676" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#040404" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Background -->
  <rect width="512" height="512" fill="#040404"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <!-- "ONE" bordered box -->
  <rect x="110" y="184" width="180" height="72" fill="none" stroke="#00e676" stroke-width="2.5"/>
  <text x="200" y="237"
    font-family="monospace,Courier New,Courier"
    font-size="52"
    font-weight="700"
    fill="#00e676"
    text-anchor="middle"
    letter-spacing="6">ONE</text>
  <!-- "_21" suffix -->
  <text x="300" y="248"
    font-family="monospace,Courier New,Courier"
    font-size="32"
    font-weight="400"
    fill="#555555"
    text-anchor="start"
    letter-spacing="2">_21</text>
  <!-- Subtitle -->
  <text x="256" y="304"
    font-family="monospace,Courier New,Courier"
    font-size="18"
    fill="#333333"
    text-anchor="middle"
    letter-spacing="4">NEURAL LINK</text>
  <!-- Corner accents — top-left -->
  <path d="M40 40 L40 80 M40 40 L80 40" stroke="#00e676" stroke-width="2" fill="none" opacity="0.35"/>
  <!-- Corner accents — bottom-right -->
  <path d="M472 472 L472 432 M472 472 L432 472" stroke="#00e676" stroke-width="2" fill="none" opacity="0.35"/>
</svg>`;
}

// Maskable version: content scaled to 80% with 10% padding on each side
function buildMaskableSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#00e676" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#040404" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Background fills full bleed for maskable -->
  <rect width="512" height="512" fill="#040404"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <!-- Content group shifted inward 10% (51px) and scaled to 80% -->
  <g transform="translate(51,51) scale(0.8)">
    <rect x="110" y="184" width="180" height="72" fill="none" stroke="#00e676" stroke-width="2.5"/>
    <text x="200" y="237"
      font-family="monospace,Courier New,Courier"
      font-size="52"
      font-weight="700"
      fill="#00e676"
      text-anchor="middle"
      letter-spacing="6">ONE</text>
    <text x="300" y="248"
      font-family="monospace,Courier New,Courier"
      font-size="32"
      font-weight="400"
      fill="#555555"
      text-anchor="start"
      letter-spacing="2">_21</text>
    <text x="256" y="304"
      font-family="monospace,Courier New,Courier"
      font-size="18"
      fill="#333333"
      text-anchor="middle"
      letter-spacing="4">NEURAL LINK</text>
    <path d="M40 40 L40 80 M40 40 L80 40" stroke="#00e676" stroke-width="2" fill="none" opacity="0.35"/>
    <path d="M472 472 L472 432 M472 472 L432 472" stroke="#00e676" stroke-width="2" fill="none" opacity="0.35"/>
  </g>
</svg>`;
}

// Favicon SVG (written directly, no PNG needed)
const faviconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#00e676" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#040404" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="#040404"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <rect x="110" y="184" width="180" height="72" fill="none" stroke="#00e676" stroke-width="2.5"/>
  <text x="200" y="237"
    font-family="monospace,Courier New,Courier"
    font-size="52"
    font-weight="700"
    fill="#00e676"
    text-anchor="middle"
    letter-spacing="6">ONE</text>
  <text x="300" y="248"
    font-family="monospace,Courier New,Courier"
    font-size="32"
    font-weight="400"
    fill="#555555"
    text-anchor="start"
    letter-spacing="2">_21</text>
  <text x="256" y="304"
    font-family="monospace,Courier New,Courier"
    font-size="18"
    fill="#333333"
    text-anchor="middle"
    letter-spacing="4">NEURAL LINK</text>
  <path d="M40 40 L40 80 M40 40 L80 40" stroke="#00e676" stroke-width="2" fill="none" opacity="0.35"/>
  <path d="M472 472 L472 432 M472 472 L432 472" stroke="#00e676" stroke-width="2" fill="none" opacity="0.35"/>
</svg>`;

async function svgToPng(svgString, outputPath) {
  const buf = Buffer.from(svgString, 'utf8');
  await sharp(buf).png().toFile(outputPath);
  const stat = fs.statSync(outputPath);
  console.log(`  Written: ${path.relative(process.cwd(), outputPath)} (${(stat.size / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('ONE21 PWA Icon Generator\n');

  const icons = [
    { name: 'icon-192.png',           size: 192, maskable: false },
    { name: 'icon-512.png',           size: 512, maskable: false },
    { name: 'icon-maskable-512.png',  size: 512, maskable: true  },
    { name: 'apple-touch-icon.png',   size: 180, maskable: false },
  ];

  console.log('Generating PNG icons...');
  for (const icon of icons) {
    const svg = icon.maskable ? buildMaskableSVG(icon.size) : buildSVG(icon.size);
    const outPath = path.join(ICONS_DIR, icon.name);
    await svgToPng(svg, outPath);
  }

  // Write favicon.svg
  const faviconPath = path.join(PUBLIC_DIR, 'favicon.svg');
  fs.writeFileSync(faviconPath, faviconSVG, 'utf8');
  const faviconStat = fs.statSync(faviconPath);
  console.log(`  Written: ${path.relative(process.cwd(), faviconPath)} (${(faviconStat.size / 1024).toFixed(1)} KB)`);

  console.log('\nAll icons generated successfully.');
  console.log(`Output directory: ${ICONS_DIR}`);
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
