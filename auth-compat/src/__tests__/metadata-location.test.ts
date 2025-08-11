import { describe, test, expect } from '@jest/globals';
import { runComplianceTest, printVerboseOutput } from './helpers/test-utils.js';

// Get client command from environment or use a default
const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('Metadata Location Tests', () => {
  describe('Tests different OAuth protected resource metadata locations', () => {
    
    test('Standard location with WWW-Authenticate', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: true,
          metadataLocation: '/.well-known/oauth-protected-resource',
          includeWwwAuthenticate: true
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );
      
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      expect(report).toHavePassedCompliance();
      expect(clientOutput.exitCode).toBe(0);
      expect(behavior.authMetadataRequested).toBe(true);
    });
    
    test('Non-standard location with WWW-Authenticate - Custom metadata path advertised via WWW-Authenticate header', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: true,
          metadataLocation: '/custom/oauth/metadata',
          includeWwwAuthenticate: true
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );
      
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      expect(report).toHavePassedCompliance();
      expect(clientOutput.exitCode).toBe(0);
      expect(behavior.authMetadataRequested).toBe(true);
    });
    
    test('Nested well-known path with WWW-Authenticate', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: true,
          metadataLocation: '/.well-known/oauth-protected-resource/mcp',
          includeWwwAuthenticate: true
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );
      
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      expect(report).toHavePassedCompliance();
      expect(clientOutput.exitCode).toBe(0);
      expect(behavior.authMetadataRequested).toBe(true);
    });
    
    test('Standard location without WWW-Authenticate - Client should find metadata at standard location', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: true,
          metadataLocation: '/.well-known/oauth-protected-resource',
          includeWwwAuthenticate: false
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );
      
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      expect(report).toHavePassedCompliance();
      expect(clientOutput.exitCode).toBe(0);
      expect(behavior.authMetadataRequested).toBe(true);
    });
    
    test('Non-standard location without WWW-Authenticate - Client cannot find metadata without header hint', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: true,
          metadataLocation: '/custom/oauth/metadata',
          includeWwwAuthenticate: false
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );
      
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      // This test expects the client to FAIL
      expect(report.overall_result).toBe('FAIL');
      expect(clientOutput.exitCode).not.toBe(0);
      // Client should not be able to complete auth flow without finding metadata
      expect(behavior.authFlowCompleted).toBe(false);
    });
  });
});