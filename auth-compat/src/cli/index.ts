#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import { ValidationServer } from '../server/validation/index.js';
import { ComplianceReport } from '../types.js';

const program = new Command();

program
  .name('mcp-auth-compat')
  .description('MCP Authorization Compliance Checker')
  .version('1.0.0');

program
  .argument('<command>', 'Command to run the client (should accept server URL as argument)')
  .option('--timeout <ms>', 'Timeout for client execution in milliseconds', '30000')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Verbose output', false)
  .action(async (clientCommand: string, options) => {
    await runComplianceTests(clientCommand, options);
  });

async function runComplianceTests(clientCommand: string, options: any) {
  const verbose = options.verbose;
  const timeout = parseInt(options.timeout, 10);
  
  console.log('Running MCP compliance tests...');

  const allTestsPassed: boolean[] = [];

  // Run basic test (no auth)
  console.log('\n[1/2] Basic compliance test');
  const basicPassed = await runSingleTest(clientCommand, false, timeout, options);
  allTestsPassed.push(basicPassed);

  // Run auth test
  console.log('\n[2/2] Authorization compliance test');
  const authPassed = await runSingleTest(clientCommand, true, timeout, options);
  allTestsPassed.push(authPassed);

  // Overall summary
  const overallPass = allTestsPassed.every(p => p);
  console.log('\n' + '='.repeat(40));
  if (overallPass) {
    console.log('✅ All tests PASSED');
  } else {
    console.log('❌ Some tests FAILED');
  }
  console.log('='.repeat(40));

  process.exit(overallPass ? 0 : 1);
}

async function runSingleTest(
  clientCommand: string, 
  authRequired: boolean, 
  timeout: number,
  options: any
): Promise<boolean> {
  const verbose = options.verbose;
  
  // Start validation server
  const server = new ValidationServer({ authRequired });

  try {
    const serverPort = await server.start();
    const serverUrl = `http://localhost:${serverPort}/mcp`;
    
    if (verbose) {
      console.log(`  Server: ${serverUrl}`);
    }

    // Parse the client command to separate the executable from its arguments
    const commandParts = clientCommand.split(' ');
    const executable = commandParts[0];
    const args = [...commandParts.slice(1), serverUrl];

    // Run the client
    const clientProcess = spawn(executable, args, {
      stdio: verbose ? 'inherit' : 'pipe',
      shell: true,
      timeout
    });

    // Wait for client to finish
    const clientExitCode = await new Promise<number>((resolve, reject) => {
      let timedOut = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        clientProcess.kill();
        reject(new Error(`Timeout (${timeout}ms)`));
      }, timeout);

      clientProcess.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        if (!timedOut) {
          resolve(code || 0);
        }
      });

      clientProcess.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });

    // Get validation results
    const results = server.getValidationResults();
    const behavior = server.getClientBehavior();

    // Generate report
    const report: ComplianceReport = {
      overall_result: results.every(r => r.result === 'PASS') && clientExitCode === 0 ? 'PASS' : 'FAIL',
      test_suite: authRequired ? 'authorization-compliance' : 'basic-compliance',
      timestamp: new Date().toISOString(),
      client_command: clientCommand,
      tests_passed: results.filter(r => r.result === 'PASS').length,
      tests_failed: results.filter(r => r.result === 'FAIL').length,
      tests: results
    };

    // Output results
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printCompactReport(report, verbose ? behavior : null);
    }

    // Stop server
    await server.stop();

    return report.overall_result === 'PASS';

  } catch (error: any) {
    console.log(`  ❌ FAIL: ${error.message || error}`);
    if (server) {
      await server.stop();
    }
    return false;
  }
}

function printCompactReport(report: ComplianceReport, behavior?: any) {
  const passed = report.overall_result === 'PASS';
  const icon = passed ? '✅' : '❌';
  
  console.log(`  ${icon} ${report.test_suite}: ${report.overall_result}`);
  
  // Only show failures in compact mode
  if (!passed) {
    report.tests.forEach(test => {
      if (test.result === 'FAIL') {
        console.log(`     ❌ ${test.name}`);
        if (test.errors && test.errors.length > 0) {
          test.errors.forEach(error => {
            console.log(`        - ${error}`);
          });
        }
      }
    });
  }

  // Show detailed behavior only in verbose mode
  if (behavior) {
    console.log('\n  Client Behavior:');
    console.log('  ' + JSON.stringify(behavior, null, 2).split('\n').join('\n  '));
  }
}

program.parse();