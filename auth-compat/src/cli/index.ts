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

    // Capture client output when not in verbose mode (verbose mode uses 'inherit')
    let clientStdout = '';
    let clientStderr = '';

    // Run the client
    const clientProcess = spawn(executable, args, {
      stdio: verbose ? 'inherit' : 'pipe',
      shell: true,
      timeout
    });

    // Capture stdout/stderr when not in verbose mode
    if (!verbose) {
      if (clientProcess.stdout) {
        clientProcess.stdout.on('data', (data) => {
          clientStdout += data.toString();
        });
      }
      if (clientProcess.stderr) {
        clientProcess.stderr.on('data', (data) => {
          clientStderr += data.toString();
        });
      }
    }

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

    // Get auth server trace if auth was required
    const authServerTrace = authRequired && server.authServer ? server.authServer.getHttpTrace() : [];

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
      const clientOutput = { stdout: clientStdout, stderr: clientStderr };
      printCompactReport(report, verbose ? behavior : null, verbose ? authServerTrace : null, clientOutput);
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

function printHttpTrace(traces: any[], label: string) {
  console.log(`\n  ====== ${label} ======`);
  traces.forEach((trace: any, index: number) => {
    console.log(`\n  --- Request #${index + 1} ---`);

    // Request line
    console.log(`  ${trace.method} ${trace.url} HTTP/1.1`);

    // Request headers
    if (trace.headers) {
      Object.entries(trace.headers).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    }

    // Request body
    if (trace.body) {
      console.log('');
      const bodyStr = typeof trace.body === 'string' ? trace.body : JSON.stringify(trace.body);
      console.log(`  ${bodyStr}`);
    }

    // Response
    if (trace.response) {
      console.log(`\n  HTTP/1.1 ${trace.response.status} ${getStatusText(trace.response.status)}`);

      // Response headers
      if (trace.response.headers) {
        Object.entries(trace.response.headers).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
      }

      // Response body
      if (trace.response.body) {
        console.log('');
        const bodyStr = typeof trace.response.body === 'string'
          ? trace.response.body
          : JSON.stringify(trace.response.body);

        // Truncate very long responses
        if (bodyStr.length > 1000) {
          console.log(`  ${bodyStr.substring(0, 1000)}... [truncated]`);
        } else {
          console.log(`  ${bodyStr}`);
        }
      }
    }
    console.log('');
  });
  console.log('  ========================\n');
}

function printCompactReport(report: ComplianceReport, behavior?: any, authServerTrace?: any[], clientOutput?: { stdout: string, stderr: string }) {
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

  // Show HTTP trace and detailed behavior in verbose mode
  if (behavior) {
    // Collect all traces and interleave them by timestamp
    const allTraces: any[] = [];

    // Add validation server traces with source label
    if (behavior.httpTrace && behavior.httpTrace.length > 0) {
      behavior.httpTrace.forEach((trace: any) => {
        allTraces.push({ ...trace, source: 'VALIDATION' });
      });
    }

    // Add auth server traces with source label
    if (authServerTrace && authServerTrace.length > 0) {
      authServerTrace.forEach((trace: any) => {
        allTraces.push({ ...trace, source: 'AUTH' });
      });
    }

    // Sort all traces by timestamp for interleaved view
    if (allTraces.length > 0) {
      allTraces.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Print interleaved traces
      console.log('\n  ====== INTERLEAVED HTTP TRACE ======');
      allTraces.forEach((trace: any, index: number) => {
        console.log(`\n  --- [${trace.source}] Request #${index + 1} ---`);
        console.log(`  Timestamp: ${trace.timestamp}`);

        // Request line
        console.log(`  ${trace.method} ${trace.url} HTTP/1.1`);

        // Request headers
        if (trace.headers) {
          Object.entries(trace.headers).forEach(([key, value]) => {
            console.log(`  ${key}: ${value}`);
          });
        }

        // Request body
        if (trace.body) {
          console.log('');
          const bodyStr = typeof trace.body === 'string' ? trace.body : JSON.stringify(trace.body);
          console.log(`  ${bodyStr}`);
        }

        // Response
        if (trace.response) {
          console.log(`\n  HTTP/1.1 ${trace.response.status} ${getStatusText(trace.response.status)}`);

          // Response headers
          if (trace.response.headers) {
            Object.entries(trace.response.headers).forEach(([key, value]) => {
              console.log(`  ${key}: ${value}`);
            });
          }

          // Response body
          if (trace.response.body) {
            console.log('');
            const bodyStr = typeof trace.response.body === 'string'
              ? trace.response.body
              : JSON.stringify(trace.response.body);

            // Truncate very long responses
            if (bodyStr.length > 1000) {
              console.log(`  ${bodyStr.substring(0, 1000)}... [truncated]`);
            } else {
              console.log(`  ${bodyStr}`);
            }
          }
        }
        console.log('');
      });
      console.log('  ========================\n');
    }

    // Show other behavior details
    console.log('  Client Behavior Summary:');
    const summaryBehavior = { ...behavior };
    delete summaryBehavior.httpTrace; // Don't repeat the trace
    console.log('  ' + JSON.stringify(summaryBehavior, null, 2).split('\n').join('\n  '));
  }

  // Show client output at the very end
  // In verbose mode, output was shown directly via 'inherit', but we still captured it for non-verbose mode
  if (clientOutput && (clientOutput.stdout || clientOutput.stderr)) {
    if (clientOutput.stdout) {
      console.log('\n  ====== CLIENT STDOUT ======');
      console.log('  ' + clientOutput.stdout.split('\n').join('\n  '));
      console.log('  ========================\n');
    }
    
    if (clientOutput.stderr) {
      console.log('\n  ====== CLIENT STDERR ======');
      console.log('  ' + clientOutput.stderr.split('\n').join('\n  '));
      console.log('  ========================\n');
    }
  }
}

function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    302: 'Found',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    500: 'Internal Server Error'
  };
  return statusTexts[status] || '';
}

program.parse();
