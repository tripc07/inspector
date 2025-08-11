import { describe, test, expect } from '@jest/globals';
import { runComplianceTest, printVerboseOutput } from './helpers/test-utils.js';

// Get client command from environment or use a default
const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('OAuth Compliance', () => {
  describe('Tests OAuth2/OIDC authorization flow', () => {
    test('Standard OAuth Flow - Client completes OAuth flow with default settings', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: true
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );
      
      // Print verbose output if requested
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      // Assertions
      expect(report).toHavePassedCompliance();
      expect(clientOutput.exitCode).toBe(0);
      expect(clientOutput.timedOut).toBe(false);
      expect(behavior.connected).toBe(true);
      expect(behavior.initialized).toBe(true);
      expect(behavior.authMetadataRequested).toBe(true);
      expect(behavior.authFlowCompleted).toBe(true);
      
      // Verify auth server was contacted
      expect(authServerTrace.length).toBeGreaterThan(0);
    });
  });
});