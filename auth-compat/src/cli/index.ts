#!/usr/bin/env node

import { Command } from 'commander';
import { ComplianceTestRunner, TestSuite } from '../test-framework/index.js';
import { basicSuite, behaviorSuite, metadataLocationSuite, oauthSuite } from '../test-framework/suites.js';

const program = new Command();

program
  .name('mcp-auth-test')
  .description('MCP Authorization Compliance Test Runner')
  .version('1.0.0');

program
  .requiredOption('--command <command>', 'Command to run the client (should accept server URL as argument)')
  .option('--suite <name>', 'Run specific test suite (basic, oauth, metadata, behavior, all)', 'all')
  .option('--timeout <ms>', 'Timeout for client execution in milliseconds', '30000')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Verbose output', false)
  .action(async (options) => {
    await runTests(options);
  });


async function runTests(options: any) {
  const verbose = options.verbose;
  const runner = new ComplianceTestRunner(options.command, { verbose, json: options.json });

  console.log('Running MCP compliance tests...');

  // Select which suites to run
  let suitesToRun: TestSuite[] = [];

  const suiteMap: Record<string, TestSuite> = {
    'basic': basicSuite,
    'oauth': oauthSuite,
    'metadata': metadataLocationSuite,
    'behavior': behaviorSuite
  };

  if (options.suite === 'all') {
    suitesToRun = [basicSuite, oauthSuite, metadataLocationSuite, behaviorSuite];
  } else if (suiteMap[options.suite]) {
    suitesToRun = [suiteMap[options.suite]];
  } else {
    console.error(`Unknown suite: ${options.suite}`);
    console.error(`Available suites: ${Object.keys(suiteMap).join(', ')}, all`);
    process.exit(1);
  }

  await runner.runSuites(suitesToRun);
}

program.parse();
