import express, { Request, Response } from 'express';
import { Server } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ClientBehavior, TestResult, ValidationServerConfig } from '../../types.js';
import { z } from 'zod';

export class ValidationServer {
  private app: express.Application;
  private server: Server | null = null;
  private mcpServer: McpServer;
  private transport: StreamableHTTPServerTransport | null = null;
  private clientBehavior: ClientBehavior;
  private config: ValidationServerConfig;

  constructor(config: ValidationServerConfig = {}) {
    this.config = {
      port: config.port || 0, // 0 means random port
      authRequired: config.authRequired || false,
      metadataLocation: config.metadataLocation || '/.well-known/oauth-authorization-server',
      mockAuthServerUrl: config.mockAuthServerUrl || 'http://localhost:3001'
    };

    this.app = express();
    this.app.use(express.json());

    // Initialize client behavior tracking
    this.clientBehavior = {
      connected: false,
      initialized: false,
      requestsMade: [],
      authMetadataRequested: false,
      authFlowCompleted: false,
      errors: []
    };

    // Create MCP server
    this.mcpServer = new McpServer({
      name: 'validation-server',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });

    this.setupMCPHandlers();
    this.setupRoutes();
  }

  private setupMCPHandlers(): void {
    // Register a test tool
    this.mcpServer.registerTool(
      'test-tool',
      {
        title: 'Test Tool',
        description: 'A simple test tool for validation',
        inputSchema: {
          message: z.string().describe('Test message')
        }
      },
      async ({ message }) => {
        this.clientBehavior.requestsMade.push('tools/call:test-tool');
        return {
          content: [{
            type: 'text',
            text: `Test response: ${message}`
          }]
        };
      }
    );

    // We'll track tool listing through the transport message handler instead
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    // OAuth metadata endpoint (if auth is required)
    if (this.config.authRequired) {
      this.app.get(this.config.metadataLocation!, (req, res) => {
        this.clientBehavior.authMetadataRequested = true;
        res.json({
          issuer: this.config.mockAuthServerUrl,
          authorization_endpoint: `${this.config.mockAuthServerUrl}/authorize`,
          token_endpoint: `${this.config.mockAuthServerUrl}/token`,
          jwks_uri: `${this.config.mockAuthServerUrl}/jwks`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic']
        });
      });
    }

    // Create transport once at startup
    this.transport = new StreamableHTTPServerTransport(
      this.config.authRequired ? {
        requireAuth: true,
        authMetadataUrl: `http://localhost:${this.config.port || 3000}${this.config.metadataLocation}`
      } : {}
    );

    // Connect MCP server to transport
    this.mcpServer.connect(this.transport).catch(console.error);

    // MCP endpoint
    this.app.post('/mcp', async (req: Request, res: Response) => {
      // Track the incoming message
      if (req.body) {
        const message = req.body;
        if (message.method === 'initialize') {
          this.clientBehavior.connected = true;
          this.clientBehavior.initialized = true;
          this.clientBehavior.protocolVersion = message.params?.protocolVersion;
          this.clientBehavior.clientInfo = message.params?.clientInfo;
          this.clientBehavior.requestsMade.push('initialize');
        } else if (message.method === 'tools/list') {
          this.clientBehavior.requestsMade.push('tools/list');
        } else if (message.method === 'tools/call') {
          this.clientBehavior.requestsMade.push(`tools/call:${message.params?.name}`);
        }
      }

      // Handle the request through transport
      try {
        await this.transport!.handleRequest(req, res);
      } catch (error) {
        this.clientBehavior.errors.push(`Request error: ${error}`);
        console.error('Transport error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Endpoint to retrieve client behavior for reporting
    this.app.get('/validation/report', (req, res) => {
      res.json(this.getValidationResults());
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        const port = this.getPort();
        console.log(`Validation server started on port ${port}`);
        resolve(port);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Validation server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    if (!this.server) {
      throw new Error('Server not started');
    }
    const address = this.server.address();
    if (typeof address === 'object' && address !== null) {
      return address.port;
    }
    throw new Error('Unable to get server port');
  }

  getValidationResults(): TestResult[] {
    const results: TestResult[] = [];

    // Test: MCP Initialization
    results.push({
      name: 'mcp_initialization',
      result: this.clientBehavior.initialized ? 'PASS' : 'FAIL',
      details: {
        connected: this.clientBehavior.connected,
        initialized: this.clientBehavior.initialized,
        protocol_version: this.clientBehavior.protocolVersion,
        client_info: this.clientBehavior.clientInfo
      },
      errors: this.clientBehavior.initialized ? undefined : ['Client did not complete initialization']
    });

    // Test: Auth metadata discovery (if auth required)
    if (this.config.authRequired) {
      results.push({
        name: 'auth_metadata_discovery',
        result: this.clientBehavior.authMetadataRequested ? 'PASS' : 'FAIL',
        details: {
          metadata_requested: this.clientBehavior.authMetadataRequested,
          metadata_location: this.config.metadataLocation
        },
        errors: this.clientBehavior.authMetadataRequested ? undefined : ['Client did not request auth metadata']
      });
    }

    // Test: Basic functionality
    const madeRequests = this.clientBehavior.requestsMade.length > 1; // More than just initialize
    results.push({
      name: 'basic_functionality',
      result: madeRequests ? 'PASS' : 'FAIL',
      details: {
        requests_made: this.clientBehavior.requestsMade
      },
      errors: madeRequests ? undefined : ['Client did not make any requests beyond initialization']
    });

    return results;
  }

  getClientBehavior(): ClientBehavior {
    return this.clientBehavior;
  }
}