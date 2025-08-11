import { describe, test, expect } from '@jest/globals';
import { runComplianceTest, printVerboseOutput } from './helpers/test-utils.js';
import { ValidationServerConfig } from '../types.js';

// Get client command from environment or use a default
const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('Metadata Location Tests', () => {
  describe('Tests different OAuth protected resource metadata locations', () => {
    
    // Test cases for metadata location scenarios
    const metadataTestCases: Array<{
      name: string;
      description?: string;
      config: ValidationServerConfig;
      expectedToPass: boolean;
      expectations?: {
        authMetadataRequested?: boolean;
        authFlowCompleted?: boolean;
      };
    }> = [
      {
        name: 'Standard location with WWW-Authenticate',
        config: {
          authRequired: true,
          metadataLocation: '/.well-known/oauth-protected-resource',
          includeWwwAuthenticate: true
        },
        expectedToPass: true,
        expectations: {
          authMetadataRequested: true
        }
      },
      {
        name: 'Non-standard location with WWW-Authenticate',
        description: 'Custom metadata path advertised via WWW-Authenticate header',
        config: {
          authRequired: true,
          metadataLocation: '/custom/oauth/metadata',
          includeWwwAuthenticate: true
        },
        expectedToPass: true,
        expectations: {
          authMetadataRequested: true
        }
      },
      {
        name: 'Nested well-known path with WWW-Authenticate',
        config: {
          authRequired: true,
          metadataLocation: '/.well-known/oauth-protected-resource/mcp',
          includeWwwAuthenticate: true
        },
        expectedToPass: true,
        expectations: {
          authMetadataRequested: true
        }
      },
      {
        name: 'Standard location without WWW-Authenticate',
        description: 'Client should find metadata at standard location',
        config: {
          authRequired: true,
          metadataLocation: '/.well-known/oauth-protected-resource',
          includeWwwAuthenticate: false
        },
        expectedToPass: true,
        expectations: {
          authMetadataRequested: true
        }
      },
      {
        name: 'Non-standard location without WWW-Authenticate',
        description: 'Client cannot find metadata without header hint',
        config: {
          authRequired: true,
          metadataLocation: '/custom/oauth/metadata',
          includeWwwAuthenticate: false
        },
        expectedToPass: false,
        expectations: {
          authFlowCompleted: false
        }
      }
    ];
    
    // Use test.each to parameterize the tests
    test.each(metadataTestCases)(
      '$name',
      async ({ name, description, config, expectedToPass, expectations }) => {
        const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
          CLIENT_COMMAND,
          config,
          {
            timeout: 30000,
            verbose: VERBOSE
          }
        );
        
        if (VERBOSE) {
          console.log(`\nTest: ${name}`);
          if (description) console.log(`Description: ${description}`);
          printVerboseOutput(report, behavior, authServerTrace, clientOutput);
        }
        
        // Core assertions
        if (expectedToPass) {
          expect(report).toHavePassedCompliance();
          expect(clientOutput.exitCode).toBe(0);
        } else {
          expect(report.overall_result).toBe('FAIL');
          expect(clientOutput.exitCode).not.toBe(0);
        }
        
        // Additional behavior expectations
        if (expectations?.authMetadataRequested !== undefined) {
          expect(behavior.authMetadataRequested).toBe(expectations.authMetadataRequested);
        }
        
        if (expectations?.authFlowCompleted !== undefined) {
          expect(behavior.authFlowCompleted).toBe(expectations.authFlowCompleted);
        }
      }
    );
  });
});