import { describe, test, expect } from '@jest/globals';
import { runComplianceTest, printVerboseOutput } from './helpers/test-utils.js';

// Get client command from environment or use a default
const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('Metadata Location Tests', () => {
  describe('Tests different OAuth protected resource metadata locations', () => {

    const testCases: Array<[string, string, boolean]> = [
      ['Non-standard location with WWW-Authenticate', '/custom/oauth/metadata', true],
      ['Standard location without WWW-Authenticate', '/.well-known/oauth-protected-resource', false],
      ['Nested well-known path with WWW-Authenticate', '/.well-known/oauth-protected-resource/mcp', false],
    ];

    test.each(testCases)(
      '%s',
      async (name, metadataLocation, includeWwwAuth) => {
        const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
          CLIENT_COMMAND,
          {
            authRequired: true,
            metadataLocation,
            includeWwwAuthenticate: includeWwwAuth
          },
          { timeout: 30000, verbose: VERBOSE }
        );

        if (VERBOSE) {
          console.log(`\nTest: ${name}`);
          printVerboseOutput(report, behavior, authServerTrace, clientOutput);
        }

        expect(clientOutput.exitCode).toBe(0);
        expect(behavior.authMetadataRequested).toBe(true);
      }
    );
  });
});
