import { OAuthStep, AuthDebuggerState } from "./auth-types";
import { DebugInspectorOAuthClientProvider, discoverScopes } from "./auth";
import {
  discoverAuthorizationServerMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  discoverOAuthProtectedResourceMetadata,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { generateOAuthState } from "@/utils/oauthUtils";

/**
 * Determines if the authorization server is Azure AD/Entra, which doesn't support the resource parameter
 * @param metadata OAuth metadata containing authorization endpoint
 * @returns true if the server appears to be Azure AD/Entra
 */
export const isAzureADEndpoint = (metadata: { authorization_endpoint?: string }): boolean => {
  const authUrl = metadata.authorization_endpoint;
  if (!authUrl) return false;
  
  // Check for common Azure AD/Entra endpoint patterns
  const azurePatterns = [
    /login\.microsoftonline\.com/,
    /login\.microsoft\.com/,
    /login\.live\.com/,
    /\.b2clogin\.com/,
    // Add more patterns as needed for other Azure AD variants
  ];
  
  return azurePatterns.some(pattern => pattern.test(authUrl));
};

export interface StateMachineContext {
  state: AuthDebuggerState;
  serverUrl: string;
  provider: DebugInspectorOAuthClientProvider;
  updateState: (updates: Partial<AuthDebuggerState>) => void;
}

export interface StateTransition {
  canTransition: (context: StateMachineContext) => Promise<boolean>;
  execute: (context: StateMachineContext) => Promise<void>;
}

// State machine transitions
export const oauthTransitions: Record<OAuthStep, StateTransition> = {
  metadata_discovery: {
    canTransition: async () => true,
    execute: async (context) => {
      // Default to discovering from the server's URL
      let authServerUrl = new URL("/", context.serverUrl);
      let resourceMetadata: OAuthProtectedResourceMetadata | null = null;
      let resourceMetadataError: Error | null = null;
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          context.serverUrl,
        );
        if (resourceMetadata?.authorization_servers?.length) {
          authServerUrl = new URL(resourceMetadata.authorization_servers[0]);
        }
      } catch (e) {
        if (e instanceof Error) {
          resourceMetadataError = e;
        } else {
          resourceMetadataError = new Error(String(e));
        }
      }

      const resource: URL | undefined = await selectResourceURL(
        context.serverUrl,
        context.provider,
        // we default to null, so swap it for undefined if not set
        resourceMetadata ?? undefined,
      );

      const metadata = await discoverAuthorizationServerMetadata(authServerUrl);
      if (!metadata) {
        throw new Error("Failed to discover OAuth metadata");
      }
      const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);
      context.provider.saveServerMetadata(parsedMetadata);
      context.updateState({
        resourceMetadata,
        resource,
        resourceMetadataError,
        authServerUrl,
        oauthMetadata: parsedMetadata,
        oauthStep: "client_registration",
      });
    },
  },

  client_registration: {
    canTransition: async (context) => !!context.state.oauthMetadata,
    execute: async (context) => {
      const metadata = context.state.oauthMetadata!;
      const clientMetadata = context.provider.clientMetadata;

      // Prefer scopes from resource metadata if available
      const scopesSupported =
        context.state.resourceMetadata?.scopes_supported ||
        metadata.scopes_supported;
      // Add all supported scopes to client registration
      if (scopesSupported) {
        clientMetadata.scope = scopesSupported.join(" ");
      }

      // Try Static client first, with DCR as fallback
      let fullInformation = await context.provider.clientInformation();
      if (!fullInformation) {
        fullInformation = await registerClient(context.serverUrl, {
          metadata,
          clientMetadata,
        });
        context.provider.saveClientInformation(fullInformation);
      }

      context.updateState({
        oauthClientInfo: fullInformation,
        oauthStep: "authorization_redirect",
      });
    },
  },

  authorization_redirect: {
    canTransition: async (context) =>
      !!context.state.oauthMetadata && !!context.state.oauthClientInfo,
    execute: async (context) => {
      const metadata = context.state.oauthMetadata!;
      const clientInformation = context.state.oauthClientInfo!;

      const scope = await discoverScopes(
        context.serverUrl,
        context.state.resourceMetadata ?? undefined,
      );

      // Check if this is Azure AD/Entra which doesn't support the resource parameter
      const isAzureAD = isAzureADEndpoint(metadata);
      
      const authParams: Parameters<typeof startAuthorization>[1] = {
        metadata,
        clientInformation,
        redirectUrl: context.provider.redirectUrl,
        scope,
        state: generateOAuthState(),
      };

      // Only include the resource parameter if it's not Azure AD and we have a resource
      if (!isAzureAD && context.state.resource) {
        authParams.resource = context.state.resource;
      }

      const { authorizationUrl, codeVerifier } = await startAuthorization(
        context.serverUrl,
        authParams,
      );

      context.provider.saveCodeVerifier(codeVerifier);
      context.updateState({
        authorizationUrl: authorizationUrl.toString(),
        oauthStep: "authorization_code",
      });
    },
  },

  authorization_code: {
    canTransition: async () => true,
    execute: async (context) => {
      if (
        !context.state.authorizationCode ||
        context.state.authorizationCode.trim() === ""
      ) {
        context.updateState({
          validationError: "You need to provide an authorization code",
        });
        // Don't advance if no code
        throw new Error("Authorization code required");
      }
      context.updateState({
        validationError: null,
        oauthStep: "token_request",
      });
    },
  },

  token_request: {
    canTransition: async (context) => {
      return (
        !!context.state.authorizationCode &&
        !!context.provider.getServerMetadata() &&
        !!(await context.provider.clientInformation())
      );
    },
    execute: async (context) => {
      const codeVerifier = context.provider.codeVerifier();
      const metadata = context.provider.getServerMetadata()!;
      const clientInformation = (await context.provider.clientInformation())!;

      // Check if this is Azure AD/Entra which doesn't support the resource parameter
      const isAzureAD = isAzureADEndpoint(metadata);
      
      const tokenParams: Parameters<typeof exchangeAuthorization>[1] = {
        metadata,
        clientInformation,
        authorizationCode: context.state.authorizationCode,
        codeVerifier,
        redirectUri: context.provider.redirectUrl,
      };

      // Only include the resource parameter if it's not Azure AD and we have a resource
      if (!isAzureAD && context.state.resource) {
        tokenParams.resource = context.state.resource instanceof URL
          ? context.state.resource
          : new URL(context.state.resource);
      }

      const tokens = await exchangeAuthorization(context.serverUrl, tokenParams);

      context.provider.saveTokens(tokens);
      context.updateState({
        oauthTokens: tokens,
        oauthStep: "complete",
      });
    },
  },

  complete: {
    canTransition: async () => false,
    execute: async () => {
      // No-op for complete state
    },
  },
};

export class OAuthStateMachine {
  constructor(
    private serverUrl: string,
    private updateState: (updates: Partial<AuthDebuggerState>) => void,
  ) {}

  async executeStep(state: AuthDebuggerState): Promise<void> {
    const provider = new DebugInspectorOAuthClientProvider(this.serverUrl);
    const context: StateMachineContext = {
      state,
      serverUrl: this.serverUrl,
      provider,
      updateState: this.updateState,
    };

    const transition = oauthTransitions[state.oauthStep];
    if (!(await transition.canTransition(context))) {
      throw new Error(`Cannot transition from ${state.oauthStep}`);
    }

    await transition.execute(context);
  }
}
