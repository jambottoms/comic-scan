const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  // Get git commit hash (short)
  const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  
  // Get git commit date
  const commitDate = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim();
  
  // Get package.json version
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
  const version = packageJson.version;
  
  // Create version object
  const versionInfo = {
    version,
    commitHash,
    commitDate: commitDate.split(' ')[0], // Just the date part
    buildTime: new Date().toISOString(),
  };
  
  // Write to public directory so it can be accessed by the client
  const outputPath = path.join(__dirname, '../public/version.json');
  fs.writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2));
  
  console.log('Version info generated:', versionInfo);
} catch (error) {
  console.error('Error generating version info:', error.message);
  // Fallback version if git is not available
  const fallbackVersion = {
    version: '0.1.0',
    commitHash: 'unknown',
    commitDate: new Date().toISOString().split('T')[0],
    buildTime: new Date().toISOString(),
  };
  
  const outputPath = path.join(__dirname, '../public/version.json');
  fs.writeFileSync(outputPath, JSON.stringify(fallbackVersion, null, 2));
}

