import express, { Request, Response } from 'express';
import { Server } from 'http';
import crypto from 'crypto';

interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export class MockAuthServer {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;

  // Store authorization requests for PKCE validation
  private authorizationRequests: Map<string, AuthorizationRequest> = new Map();

  // Static values for simplicity
  private readonly FIXED_AUTH_CODE = 'test_auth_code_123';
  private readonly FIXED_ACCESS_TOKEN = 'test_access_token_abc';
  private readonly FIXED_REFRESH_TOKEN = 'test_refresh_token_xyz';
  private readonly TOKEN_EXPIRY = 3600; // 1 hour

  constructor(port: number = 3001) {
    this.port = port;
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Log all requests to auth server
    this.app.use((req, res, next) => {
      console.log(`\n[AUTH SERVER] >>> HTTP ${req.method} ${req.url}`);
      console.log('[AUTH SERVER] Headers:', JSON.stringify(req.headers, null, 2));
      if (req.body && Object.keys(req.body).length > 0) {
        console.log('[AUTH SERVER] Body:', JSON.stringify(req.body, null, 2));
      }
      next();
    });

    // OAuth2 authorization endpoint
    this.app.get('/authorize', (req: Request, res: Response) => {
      const {
        response_type,
        client_id,
        redirect_uri,
        state,
        code_challenge,
        code_challenge_method,
      } = req.query as any;

      // Basic validation
      if (response_type !== 'code') {
        return res.status(400).json({
          error: 'unsupported_response_type',
          error_description: 'Only code response type is supported'
        });
      }

      if (!code_challenge || code_challenge_method !== 'S256') {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'PKCE is required with S256 method'
        });
      }

      // Store the request for later PKCE validation
      this.authorizationRequests.set(this.FIXED_AUTH_CODE, {
        clientId: client_id,
        redirectUri: redirect_uri,
        state: state || '',
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method
      });

      // Immediately redirect back with authorization code (no user interaction)
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', this.FIXED_AUTH_CODE);
      if (state) {
        redirectUrl.searchParams.set('state', state);
      }

      console.log(`Mock auth server: Redirecting to ${redirectUrl.toString()}`);
      res.redirect(redirectUrl.toString());
    });

    // OAuth2 token endpoint
    this.app.post('/token', (req: Request, res: Response) => {
      const {
        grant_type,
        code,
        redirect_uri,
        code_verifier,
        client_id,
        client_secret,
        refresh_token
      } = req.body;

      if (grant_type === 'authorization_code') {
        // Validate authorization code
        if (code !== this.FIXED_AUTH_CODE) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid authorization code'
          });
        }

        // Get the stored authorization request
        const authRequest = this.authorizationRequests.get(code);
        if (!authRequest) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Authorization code not found or expired'
          });
        }

        // Validate redirect URI matches
        if (redirect_uri !== authRequest.redirectUri) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Redirect URI mismatch'
          });
        }

        // Validate PKCE code verifier
        if (!this.validatePKCE(code_verifier, authRequest.codeChallenge)) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid PKCE code verifier'
          });
        }

        // Clean up used authorization code
        this.authorizationRequests.delete(code);

        // Return tokens
        res.json({
          access_token: this.FIXED_ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: this.TOKEN_EXPIRY,
          refresh_token: this.FIXED_REFRESH_TOKEN,
          scope: 'mcp'
        });

      } else if (grant_type === 'refresh_token') {
        // Simple refresh token validation
        if (refresh_token !== this.FIXED_REFRESH_TOKEN) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid refresh token'
          });
        }

        // Return new access token (same static value for simplicity)
        res.json({
          access_token: this.FIXED_ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: this.TOKEN_EXPIRY,
          refresh_token: this.FIXED_REFRESH_TOKEN,
          scope: 'mcp'
        });

      } else {
        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Grant type not supported'
        });
      }
    });

    // Client registration endpoint (returns static client info)
    this.app.post('/register', (req: Request, res: Response) => {
      const { client_name, redirect_uris } = req.body;

      // Return a static client configuration
      res.status(201).json({
        client_id: 'test_client_id',
        client_secret: 'test_client_secret',
        client_name: client_name || 'Test Client',
        redirect_uris: redirect_uris || [],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post'
      });
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', server: 'mock-auth-server' });
    });
  }

  private validatePKCE(codeVerifier: string, codeChallenge: string): boolean {
    if (!codeVerifier || !codeChallenge) {
      return false;
    }

    // Compute S256 challenge from verifier
    const hash = crypto.createHash('sha256');
    hash.update(codeVerifier);
    const computedChallenge = hash.digest('base64url');

    return computedChallenge === codeChallenge;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`Mock auth server started on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Mock auth server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }
}
