import express, { Request, Response } from 'express';
import { Server } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

import { ClientBehavior, TestResult, ValidationServerConfig } from '../../types.js';
import { MockAuthServer, MockTokenVerifier } from '../auth/index.js';
import { z } from 'zod';

export class ValidationServer {
  private app: express.Application;
  private server: Server | null = null;
  private clientBehavior: ClientBehavior;
  private config: ValidationServerConfig;
  private authServer: MockAuthServer | null = null;

  constructor(config: ValidationServerConfig = {}) {
    this.config = {
      port: config.port || 0, // 0 means random port
      authRequired: config.authRequired || false,
      metadataLocation: config.metadataLocation || '/.well-known/oauth-authorization-server',
      mockAuthServerUrl: config.mockAuthServerUrl || 'http://localhost:3001'
    };

    // Start auth server if auth is required
    if (this.config.authRequired) {
      this.authServer = new MockAuthServer(3001);
    }

    this.app = express();
    this.app.use(express.json());

    // Initialize client behavior tracking
    this.clientBehavior = {
      connected: false,
      initialized: false,
      requestsMade: [],
      authMetadataRequested: false,
      authFlowCompleted: false,
      errors: [],
      httpTrace: []
    };

    this.setupRoutes();
  }

  private createMCPServer(): McpServer {
    // Create a new MCP server instance for each request
    const mcpServer = new McpServer({
      name: 'validation-server',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Register a test tool
    mcpServer.registerTool(
      'test-tool',
      {
        title: 'Test Tool',
        description: 'A simple test tool for validation',
        inputSchema: {
          message: z.string().describe('Test message')
        }
      },
      async ({ message }) => {
        return {
          content: [{
            type: 'text',
            text: `Test response: ${message}`
          }]
        };
      }
    );

    return mcpServer;
  }

  private setupRoutes(): void {
    // Capture all HTTP requests and responses
    this.app.use((req, res, next) => {
      const trace: any = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body && Object.keys(req.body).length > 0 ? req.body : undefined
      };

      // Capture response using Buffer approach
      const oldWrite = res.write;
      const oldEnd = res.end;
      const chunks: Buffer[] = [];

      res.write = function (chunk) {
        chunks.push(Buffer.from(chunk));
        return oldWrite.apply(res, arguments);
      };

      res.end = function (chunk) {
        if (chunk)
          chunks.push(Buffer.from(chunk));

        var body = Buffer.concat(chunks).toString('utf8');

        // Capture response details
        trace.response = {
          status: res.statusCode,
          headers: res.getHeaders(),
          body: body
        };

        return oldEnd.apply(res, arguments);
      };

      this.clientBehavior.httpTrace.push(trace);

      next();
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    let bearerMiddleware = (req, res, next) => {
      next()
    }

    // OAuth metadata endpoint (if auth is required)
    if (this.config.authRequired) {
      this.app.get(this.config.metadataLocation!, (req, res) => {
        this.clientBehavior.authMetadataRequested = true;
        res.json({
          issuer: this.config.mockAuthServerUrl,
          authorization_endpoint: `${this.config.mockAuthServerUrl}/authorize`,
          token_endpoint: `${this.config.mockAuthServerUrl}/token`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256']
        });
      });

      const tokenVerifier = new MockTokenVerifier();
      bearerMiddleware = requireBearerAuth({
         verifier: tokenVerifier,
         requiredScopes: [],
         // This is for www-authenticate, need to handle disabling this
         resourceMetadataUrl: this.config.metadataLocation!,
      });
    }

    // MCP POST endpoint - stateless mode
    this.app.post('/mcp', bearerMiddleware, async (req: Request, res: Response) => {
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
          const toolName = message.params?.name;
          this.clientBehavior.requestsMade.push(`tools/call:${toolName}`);
        } else if (message.method) {
          this.clientBehavior.requestsMade.push(message.method);
        }
      }

      // In stateless mode, create a new instance of transport and server for each request
      // to ensure complete isolation
      try {
        const mcpServer = this.createMCPServer();

        // Configure transport based on auth requirements
        const transportConfig: any = {
          sessionIdGenerator: undefined, // No sessions in stateless mode
        };

        // If auth is required, set the auth metadata URL
        if (this.config.authRequired) {
          const serverPort = this.getPort();
          transportConfig.authMetadataUrl = `http://localhost:${serverPort}${this.config.metadataLocation}`;
        }

        const transport = new StreamableHTTPServerTransport(transportConfig);

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);

        res.on('close', () => {
          transport.close();
          mcpServer.close();
        });
      } catch (error) {
        this.clientBehavior.errors.push(`Request error: ${error}`);
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // MCP GET endpoint - not supported in stateless mode
    this.app.get('/mcp', async (req: Request, res: Response) => {
      console.log('Received GET MCP request (not supported in stateless mode)');
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed in stateless mode"
        },
        id: null
      }));
    });

    // MCP DELETE endpoint - not supported in stateless mode
    this.app.delete('/mcp', async (req: Request, res: Response) => {
      console.log('Received DELETE MCP request (not supported in stateless mode)');
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed in stateless mode"
        },
        id: null
      }));
    });

    // Endpoint to retrieve client behavior for reporting
    this.app.get('/validation/report', (req, res) => {
      res.json(this.getValidationResults());
    });
  }

  async start(): Promise<number> {
    // Start auth server first if needed
    if (this.authServer) {
      await this.authServer.start();
    }

    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        const port = this.getPort();
        console.log(`Validation server started on port ${port} (stateless mode)`);
        resolve(port);
      });
    });
  }

  async stop(): Promise<void> {
    // Stop auth server if running
    if (this.authServer) {
      await this.authServer.stop();
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
