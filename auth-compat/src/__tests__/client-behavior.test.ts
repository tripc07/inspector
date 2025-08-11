import { describe, test, expect } from '@jest/globals';
import { runComplianceTest, validateClientBehavior, printVerboseOutput } from './helpers/test-utils.js';

// Get client command from environment or use a default
const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('Client Behavior Validation', () => {
  describe('Tests specific client behaviors', () => {
    
    test('Client requests metadata', async () => {
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
      
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      // Validate specific behaviors
      const behaviorErrors = validateClientBehavior(behavior, {
        authMetadataRequested: true,
        initialized: true,
        connected: true,
        authFlowCompleted: true
      });
      
      // Assertions
      expect(behaviorErrors).toHaveLength(0);
      expect(report).toHavePassedCompliance();
      expect(clientOutput.exitCode).toBe(0);
      
      // Detailed behavior checks
      expect(behavior.authMetadataRequested).toBe(true);
      expect(behavior.initialized).toBe(true);
      expect(behavior.connected).toBe(true);
      expect(behavior.authFlowCompleted).toBe(true);
      
      // Check that proper requests were made
      expect(behavior.requestsMade).toContain('initialize');
    });
    
    test('Client handles auth failure gracefully', async () => {
      // This test could be expanded to test failure scenarios
      // For now, we'll test a basic auth required scenario
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
      
      // Check that client properly attempted auth
      expect(behavior.authMetadataRequested).toBe(true);
      
      // If auth succeeded, these should be true
      if (clientOutput.exitCode === 0) {
        expect(behavior.authFlowCompleted).toBe(true);
        expect(behavior.initialized).toBe(true);
      }
    });
    
    test('Client behavior without auth requirement', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: false
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );
      
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }
      
      // Without auth requirement, client should connect directly
      expect(behavior.connected).toBe(true);
      expect(behavior.initialized).toBe(true);
      
      // Should not attempt auth flow
      expect(behavior.authMetadataRequested).toBe(false);
      expect(behavior.authFlowCompleted).toBe(false);
      
      // Should have no auth server traces
      expect(authServerTrace).toHaveLength(0);
    });
  });
});