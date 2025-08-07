#!/usr/bin/env npx tsx

import { ComplianceTestRunner, TestSuite } from '../src/test-framework/index.js';

// Basic compliance tests
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
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
      expectedResult: 'PASS'
    }
  ]
};

// OAuth compliance tests
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
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
      expectedResult: 'PASS'
    }
  ]
};

// Metadata location tests
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
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
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
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
      expectedResult: 'PASS'
    },
    {
      name: 'Nested well-known path with WWW-Authenticate',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/.well-known/oauth-protected-resource/mcp',
        includeWwwAuthenticate: true
      },
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
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
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
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
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
      expectedResult: 'FAIL'  // Should fail - client won't find non-standard location
    }
  ]
};

// Behavior validation tests
const behaviorSuite: TestSuite = {
  name: 'Client Behavior Validation',
  description: 'Tests specific client behaviors',
  scenarios: [
    {
      name: 'Client requests metadata',
      serverConfig: {
        authRequired: true
      },
      clientCommand: 'npx tsx examples/typescript-client/test-client.ts',
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

// Main test runner
async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const json = args.includes('--json');
  const suite = args.find(arg => arg.startsWith('--suite='))?.split('=')[1];

  const runner = new ComplianceTestRunner({ verbose, json });

  // Select which suites to run
  let suitesToRun: TestSuite[] = [];
  
  if (suite) {
    // Run specific suite
    const suiteMap: Record<string, TestSuite> = {
      'basic': basicSuite,
      'oauth': oauthSuite,
      'metadata': metadataLocationSuite,
      'behavior': behaviorSuite
    };
    
    if (suiteMap[suite]) {
      suitesToRun = [suiteMap[suite]];
    } else {
      console.error(`Unknown suite: ${suite}`);
      console.error(`Available suites: ${Object.keys(suiteMap).join(', ')}`);
      process.exit(1);
    }
  } else {
    // Run all suites
    suitesToRun = [basicSuite, oauthSuite, metadataLocationSuite, behaviorSuite];
  }

  console.log('MCP Authorization Compliance Test Suite');
  console.log('=' .repeat(60));
  
  await runner.runSuites(suitesToRun);
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});