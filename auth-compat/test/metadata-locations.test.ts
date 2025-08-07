#!/usr/bin/env npx tsx

import { spawn } from 'child_process';
import { ValidationServer } from '../src/server/validation/index.js';

interface TestCase {
  name: string;
  metadataLocation: string;
  includeWwwAuthenticate: boolean;
  expectedSuccess: boolean;
}

const testCases: TestCase[] = [
  {
    name: 'Standard location with WWW-Authenticate',
    metadataLocation: '/.well-known/oauth-protected-resource',
    includeWwwAuthenticate: true,
    expectedSuccess: true
  },
  {
    name: 'Non-standard location with WWW-Authenticate',
    metadataLocation: '/custom/metadata/location',
    includeWwwAuthenticate: true,
    expectedSuccess: true
  },
  {
    name: 'Nested well-known path with WWW-Authenticate',
    metadataLocation: '/.well-known/oauth-protected-resource/mcp',
    includeWwwAuthenticate: true,
    expectedSuccess: true
  },
  {
    name: 'Standard location without WWW-Authenticate',
    metadataLocation: '/.well-known/oauth-protected-resource',
    includeWwwAuthenticate: false,
    expectedSuccess: true
  },
  {
    name: 'Nested well-known path without WWW-Authenticate',
    metadataLocation: '/.well-known/oauth-protected-resource/mcp/v1',
    includeWwwAuthenticate: false,
    expectedSuccess: true
  }
];

async function runTest(testCase: TestCase): Promise<boolean> {
  console.log(`\nTesting: ${testCase.name}`);
  console.log(`  Metadata location: ${testCase.metadataLocation}`);
  console.log(`  Include WWW-Authenticate: ${testCase.includeWwwAuthenticate}`);

  const server = new ValidationServer({
    authRequired: true,
    metadataLocation: testCase.metadataLocation,
    includeWwwAuthenticate: testCase.includeWwwAuthenticate
  }, false);

  try {
    const serverPort = await server.start();
    const serverUrl = `http://localhost:${serverPort}/mcp`;
    
    console.log(`  Server URL: ${serverUrl}`);
    console.log(`  Metadata URL: http://localhost:${serverPort}${testCase.metadataLocation}`);

    // Test if metadata endpoint is accessible
    const metadataResponse = await fetch(`http://localhost:${serverPort}${testCase.metadataLocation}`);
    if (!metadataResponse.ok) {
      throw new Error(`Metadata endpoint returned ${metadataResponse.status}`);
    }

    const metadata = await metadataResponse.json();
    console.log(`  Metadata response:`, JSON.stringify(metadata, null, 2));

    // Run the client
    const clientProcess = spawn('npx', ['tsx', 'examples/typescript-client/test-client.ts', serverUrl], {
      stdio: 'pipe',
      shell: true,
      timeout: 30000
    });

    let stdout = '';
    let stderr = '';

    clientProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    clientProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Wait for client to finish
    const clientExitCode = await new Promise<number>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        clientProcess.kill();
        resolve(1);
      }, 30000);

      clientProcess.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        resolve(code || 0);
      });
    });

    await server.stop();

    const success = clientExitCode === 0;
    const expectedResult = testCase.expectedSuccess;
    
    if (success === expectedResult) {
      console.log(`  ✅ Test passed (exit code: ${clientExitCode})`);
      return true;
    } else {
      console.log(`  ❌ Test failed (exit code: ${clientExitCode}, expected: ${expectedResult ? 0 : 'non-zero'})`);
      if (!success) {
        console.log(`  Client stderr: ${stderr.slice(-500)}`);
      }
      return false;
    }

  } catch (error: any) {
    console.log(`  ❌ Test error: ${error.message}`);
    await server.stop().catch(() => {});
    return false;
  }
}

async function main() {
  console.log('Testing OAuth Protected Resource Metadata Locations');
  console.log('=' .repeat(60));

  const results: boolean[] = [];

  for (const testCase of testCases) {
    const passed = await runTest(testCase);
    results.push(passed);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test Summary:');
  const passed = results.filter(r => r).length;
  const failed = results.filter(r => !r).length;
  console.log(`  Passed: ${passed}/${results.length}`);
  console.log(`  Failed: ${failed}/${results.length}`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});