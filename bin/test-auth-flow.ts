#!/usr/bin/env node
import { OAuthStateMachine, oauthTransitions } from "../client/src/lib/oauth-state-machine.js";
import { EMPTY_DEBUGGER_STATE, AuthDebuggerState, OAuthStep } from "../client/src/lib/auth-types.js";
import { DebugInspectorOAuthClientProvider, StorageInterface } from "../client/src/lib/auth.js";
import http from "node:http";
import https from "node:https";
import readline from "node:readline";

// Simple in-memory storage implementation for CLI usage
class MemoryStorage implements StorageInterface {
  private storage: Map<string, string>;

  constructor() {
    this.storage = new Map();
  }

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }
}

class CLIAuthFlowTester {
  serverUrl: string;
  state: AuthDebuggerState;
  storage: MemoryStorage;
  stateMachine: OAuthStateMachine;
  autoRedirect: boolean;

  constructor(serverUrl: string, autoRedirect: boolean = false) {
    this.serverUrl = serverUrl;
    this.state = { ...EMPTY_DEBUGGER_STATE };
    this.storage = new MemoryStorage();
    this.stateMachine = new OAuthStateMachine(serverUrl, this.updateState.bind(this));
    this.autoRedirect = autoRedirect;
  }

  updateState(updates: Partial<AuthDebuggerState>) {
    this.state = { ...this.state, ...updates };
  }

  log(step: string, message: string, data: any = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${step}: ${message}`);
    if (data) {
      console.log(`  └─ Details:`, JSON.stringify(data, null, 2));
    }
  }

  error(step: string, message: string, error: Error | null = null) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ${step}: ${message}`);
    if (error) {
      console.error(`  └─ Error:`, error.message);
    }
  }

  success(step: string, message: string, data: any = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ ${step}: ${message}`);
    if (data) {
      console.log(`  └─ Data:`, JSON.stringify(data, null, 2));
    }
  }

  async executeStep(stepName: OAuthStep) {
    this.log(stepName.toUpperCase().replace('_', ' '), `Executing ${stepName}...`);

    try {
      // Override the provider creation for CLI usage
      const originalExecuteStep = this.stateMachine.executeStep;
      this.stateMachine.executeStep = async (state: AuthDebuggerState) => {
        // Create a provider with our memory storage
        const provider = new DebugInspectorOAuthClientProvider(this.serverUrl, this.storage);

        // Override redirectToAuthorization for CLI usage
        provider.redirectToAuthorization = (url: URL) => {
          console.log(`\nPlease open this authorization URL in your browser:`);
          console.log(`\n${url}\n`);
        };

        const context = {
          state,
          serverUrl: this.serverUrl,
          provider,
          updateState: this.updateState.bind(this),
        };

        const transition = oauthTransitions[state.oauthStep];

        if (!(await transition.canTransition(context))) {
          throw new Error(`Cannot transition from ${state.oauthStep}`);
        }

        await transition.execute(context);
      };

      await this.stateMachine.executeStep(this.state);

      // Restore original method
      this.stateMachine.executeStep = originalExecuteStep;

      // Log step-specific success information
      switch (stepName) {
        case 'metadata_discovery':
          this.success('METADATA DISCOVERY', 'OAuth metadata discovered', {
            issuer: this.state.oauthMetadata?.issuer,
            authorization_endpoint: this.state.oauthMetadata?.authorization_endpoint,
            token_endpoint: this.state.oauthMetadata?.token_endpoint,
            scopes_supported: this.state.oauthMetadata?.scopes_supported,
            resource_metadata: this.state.resourceMetadata ? {
              resource: this.state.resourceMetadata.resource,
              authorization_servers: this.state.resourceMetadata.authorization_servers,
              scopes_supported: this.state.resourceMetadata.scopes_supported,
            } : null,
            resource_metadata_error: this.state.resourceMetadataError?.message,
          });
          break;

        case 'client_registration':
          this.success('CLIENT REGISTRATION', 'Client registered successfully', {
            client_id: this.state.oauthClientInfo?.client_id,
            client_secret: this.state.oauthClientInfo?.client_secret ? '[REDACTED]' : undefined,
            client_id_issued_at: this.state.oauthClientInfo?.client_id_issued_at,
            client_secret_expires_at: this.state.oauthClientInfo?.client_secret_expires_at,
          });
          break;

        case 'authorization_redirect':
          this.success('AUTHORIZATION PREPARE', 'Authorization URL generated', {
            url: this.state.authorizationUrl,
          });
          break;

        case 'authorization_code':
          this.success('AUTHORIZATION CODE', 'Authorization code validated');
          break;

        case 'token_request':
          this.success('TOKEN EXCHANGE', 'Tokens obtained successfully', {
            access_token: this.state.oauthTokens?.access_token ? '[REDACTED]' : undefined,
            token_type: this.state.oauthTokens?.token_type,
            expires_in: this.state.oauthTokens?.expires_in,
            refresh_token: this.state.oauthTokens?.refresh_token ? '[REDACTED]' : undefined,
            scope: this.state.oauthTokens?.scope,
          });
          break;
          
        case 'validate_token':
          this.success('TOKEN VALIDATION', 'Token validated successfully', {
            message: this.state.statusMessage?.message || 'Access token is valid',
          });
          break;
      }

      return true;
    } catch (error) {
      this.error(stepName.toUpperCase().replace('_', ' '), `Failed to execute ${stepName}`, error);
      this.state.latestError = error;
      throw error;
    }
  }

  async promptForAuthCode(): Promise<string> {
    if (this.autoRedirect) {
      return this.fetchAuthCodeFromRedirect(this.state.authorizationUrl!);
    }

    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('Enter the authorization code: ', (code: string) => {
        rl.close();
        resolve(code.trim());
      });
    });
  }

  async fetchAuthCodeFromRedirect(authUrl: string): Promise<string> {
    console.log(`🔄 AUTO-REDIRECT: Fetching authorization URL...`);

    try {
      const url = new URL(authUrl);

      return new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;

        const req = protocol.get(authUrl, {
          headers: { 'User-Agent': 'MCP-Inspector/1.0' }
        }, (res) => {
          // Check if we got a redirect
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, authUrl);
            console.log(`🔄 Found redirect to: ${redirectUrl}`);

            // Check if the redirect URL has a code
            const code = redirectUrl.searchParams.get('code');
            if (code) {
              console.log(`✅ Successfully extracted authorization code from redirect`);
              resolve(code);
              return;
            }

            reject(new Error('No authorization code found in the redirect URL'));
          } else {
            reject(new Error(`Expected redirect, got status code ${res.statusCode}`));
          }
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.end();
      });
    } catch (error) {
      console.error(`❌ Error fetching authorization URL: ${error.message}`);

      // Fallback to manual entry if auto-redirect fails
      console.log("\n⚠️ Auto-redirect failed. Please manually authorize and enter the code.");
      console.log(`Please open this URL in your browser: ${authUrl}\n`);

      return new Promise((resolve) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        rl.question('Enter the authorization code: ', (code: string) => {
          rl.close();
          resolve(code.trim());
        });
      });
    }
  }

  async runFullFlow(): Promise<boolean> {
    console.log(`\n🚀 Starting MCP Server Authorization Flow Test`);
    console.log(`📡 Server URL: ${this.serverUrl}`);
    if (this.autoRedirect) {
      console.log(`🤖 Auto-redirect mode: Enabled\n`);
    } else {
      console.log(`👤 Manual authorization mode\n`);
    }

    try {
      // Step 1: Metadata Discovery
      await this.executeStep('metadata_discovery');
      console.log("");

      // Step 2: Client Registration
      await this.executeStep('client_registration');
      console.log("");

      // Step 3: Authorization Redirect Preparation
      await this.executeStep('authorization_redirect');
      console.log("");

      // Step 4: Authorization step (automatic or manual)
      if (this.autoRedirect) {
        console.log("🔐 AUTO-AUTHORIZATION");
        console.log("Automatically following the authorization URL and extracting the code...\n");
      } else {
        console.log("🔐 MANUAL AUTHORIZATION REQUIRED");
        console.log("Please open the following URL in your browser:");
        console.log(`\n${this.state.authorizationUrl}\n`);
        console.log("After authorizing, you will be redirected to a callback URL.");
        console.log("Copy the authorization code from the callback URL parameters.\n");
      }

      const authCode = await this.promptForAuthCode();
      this.state.authorizationCode = authCode;
      console.log("");

      // Step 5: Validate Authorization Code
      await this.executeStep('authorization_code');
      console.log("");

      // Step 6: Exchange Code for Tokens
      await this.executeStep('token_request');
      console.log("");
      
      // Step 7: Validate the token by calling tools/list
      await this.executeStep('validate_token');
      console.log("");

      // Final summary
      console.log("🎉 AUTHORIZATION FLOW COMPLETED SUCCESSFULLY!");
      console.log("✅ All steps completed without errors");
      console.log("🔑 Access token obtained and ready for use");

      return true;
    } catch (error) {
      console.log("\n❌ AUTHORIZATION FLOW FAILED!");
      console.error("💥 Error:", error.message);

      if (this.state.validationError) {
        console.error("🔍 Validation Error:", this.state.validationError);
      }

      return false;
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx tsx test-auth-flow.ts <server-url> [--auto-redirect]");
    console.error("Example: npx tsx test-auth-flow.ts https://example.com/mcp");
    console.error("Add --auto-redirect flag for servers that redirect immediately without user interaction");
    process.exit(1);
  }

  const serverUrl = args[0];
  const autoRedirect = args.includes('--auto-redirect');

  // Validate URL
  try {
    new URL(serverUrl);
  } catch (error) {
    console.error("❌ Invalid server URL:", serverUrl);
    process.exit(1);
  }

  const tester = new CLIAuthFlowTester(serverUrl, autoRedirect);
  const success = await tester.runFullFlow();

  process.exit(success ? 0 : 1);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Direct execution check for ESM
// When run with tsx, just call main directly
main();
