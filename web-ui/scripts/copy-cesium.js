const fs = require('fs');
const path = require('path');

const cesiumSource = path.join(__dirname, '..', 'node_modules', 'cesium', 'Build', 'Cesium');
const publicDest = path.join(__dirname, '..', 'public', 'cesium');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(cesiumSource)) {
  console.log('Cesium not found in node_modules, skipping copy.');
  process.exit(0);
}

console.log('Copying Cesium assets to public/cesium...');
fs.mkdirSync(publicDest, { recursive: true });
['Workers', 'Assets', 'Widgets', 'ThirdParty'].forEach((dir) => {
  copyDir(path.join(cesiumSource, dir), path.join(publicDest, dir));
});
// Copy main Cesium.js bundle
fs.copyFileSync(path.join(cesiumSource, 'Cesium.js'), path.join(publicDest, 'Cesium.js'));
console.log('Done.');
