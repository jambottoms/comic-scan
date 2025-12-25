const { execSync } = require('child_process');
const path = require('path');

try {
  const repoPath = __dirname;
  process.chdir(repoPath);
  
  console.log('Staging files...');
  execSync('git add app/actions.ts app/actions/analyze-from-url.ts', { stdio: 'inherit' });
  
  console.log('Committing...');
  execSync('git commit -m "Remove all references to gemini-1.5-flash"', { stdio: 'inherit' });
  
  console.log('Pushing...');
  execSync('git push', { stdio: 'inherit' });
  
  console.log('Done!');
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}


