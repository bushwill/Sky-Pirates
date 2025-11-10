#!/usr/bin/env node
/**
 * Auto Cache-Buster Build Script
 * 
 * Automatically updates version numbers in index.html based on file modification times.
 * This eliminates the need to manually increment version numbers for cache busting.
 * 
 * Usage: node build-version.js
 * Typically run during Docker build process.
 */

const fs = require('fs');
const path = require('path');

console.log('🔄 Auto-updating cache-busting versions...');

// JavaScript files that need version management
const jsFiles = [
    'Particle.js',
    'Prediction.js',
    'Game.js', 
    'MapDraw.js',
    'Display.js',
    'Controls.js',
    'ServerMessaging.js',
    'Menu.js',
    'Item.js',
    'Inventory.js',
    'HelpWindow.js'
];

try {
    // Read the current index.html
    const indexPath = './index.html';
    let html = fs.readFileSync(indexPath, 'utf8');
    
    console.log('📁 Processing files:');
    
    // Update version for each JavaScript file
    jsFiles.forEach(file => {
        const filePath = `./${file}`;
        
        if (fs.existsSync(filePath)) {
            // Get file modification time as version (Unix timestamp)
            const stats = fs.statSync(filePath);
            const version = stats.mtime.getTime();
            
            // Create version string (timestamp for uniqueness)
            const versionString = `A.${Math.floor(version / 1000000)}.${version % 1000000}`;
            
            // Replace the version in HTML
            const regex = new RegExp(`(${file}\\?v=)[\\w\\.]+`, 'g');
            const oldMatch = html.match(regex);
            html = html.replace(regex, `$1${versionString}`);
            
            console.log(`  ✅ ${file}: ${oldMatch ? oldMatch[0].split('=')[1] : 'unknown'} → ${versionString}`);
        } else {
            console.log(`  ⚠️  ${file}: File not found, skipping`);
        }
    });
    
    // Write the updated HTML back
    fs.writeFileSync(indexPath, html);
    
    console.log('🎯 Cache-busting versions updated successfully!');
    console.log('💡 All clients will now receive fresh JavaScript files.');
    
} catch (error) {
    console.error('❌ Error updating versions:', error.message);
    process.exit(1);
}