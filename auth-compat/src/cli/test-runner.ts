#!/usr/bin/env node

import { Command } from 'commander';
import { ComplianceTestRunner, TestSuite } from '../test-framework/index.js';

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
  .action(async (clientCommand: string, options) => {
    await runTests(clientCommand, options);
  });

// Test suite definitions
const basicSuite: TestSuite = {
  name: 'Basic Compliance',
  description: 'Tests basic MCP protocol compliance without authentication',
  scenarios: [
    {
      name: 'Basic MCP Connection',
      description: 'Client can connect and list tools without auth',
      serverConfig: {
        authRequired: false
      },
      expectedResult: 'PASS'
    }
  ]
};

const oauthSuite: TestSuite = {
  name: 'OAuth Compliance',
  description: 'Tests OAuth2/OIDC authorization flow',
  scenarios: [
    {
      name: 'Standard OAuth Flow',
      description: 'Client completes OAuth flow with default settings',
      serverConfig: {
        authRequired: true
      },
      expectedResult: 'PASS'
    }
  ]
};

const metadataLocationSuite: TestSuite = {
  name: 'Metadata Location Tests',
  description: 'Tests different OAuth protected resource metadata locations',
  scenarios: [
    {
      name: 'Standard location with WWW-Authenticate',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/.well-known/oauth-protected-resource',
        includeWwwAuthenticate: true
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Non-standard location with WWW-Authenticate',
      description: 'Custom metadata path advertised via WWW-Authenticate header',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/custom/oauth/metadata',
        includeWwwAuthenticate: true
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Nested well-known path with WWW-Authenticate',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/.well-known/oauth-protected-resource/mcp',
        includeWwwAuthenticate: true
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Standard location without WWW-Authenticate',
      description: 'Client should find metadata at standard location',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/.well-known/oauth-protected-resource',
        includeWwwAuthenticate: false
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Non-standard location without WWW-Authenticate',
      description: 'Client cannot find metadata without header hint',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/custom/oauth/metadata',
        includeWwwAuthenticate: false
      },
      expectedResult: 'FAIL'  // Should fail - client won't find non-standard location
    }
  ]
};

const behaviorSuite: TestSuite = {
  name: 'Client Behavior Validation',
  description: 'Tests specific client behaviors',
  scenarios: [
    {
      name: 'Client requests metadata',
      serverConfig: {
        authRequired: true
      },
      expectedResult: 'PASS',
      validateBehavior: (behavior) => {
        const errors = [];
        if (!behavior.authMetadataRequested) {
          errors.push('Client did not request OAuth metadata');
        }
        if (!behavior.initialized) {
          errors.push('Client did not complete initialization');
        }
        return errors;
      }
    }
  ]
};

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
