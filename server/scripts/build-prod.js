#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import pkg from 'glob';
const { glob } = pkg;

// Run TypeScript compilation
console.log('Building TypeScript...');
execSync('npx tsc', { stdio: 'inherit' });

// Replace NODE_ENV references in built files
console.log('Hardcoding NODE_ENV=production...');
const jsFiles = glob.sync('build/**/*.js');

for (const file of jsFiles) {
  let content = readFileSync(file, 'utf8');
  
  // Replace process.env.NODE_ENV || "development" with "production"
  content = content.replace(
    /process\.env\.NODE_ENV\s*\|\|\s*["']development["']/g,
    '"production"'
  );
  
  // Replace process.env.NODE_ENV with "production" when used directly
  content = content.replace(
    /process\.env\.NODE_ENV/g,
    '"production"'
  );
  
  writeFileSync(file, content);
}

console.log('Production build complete!');