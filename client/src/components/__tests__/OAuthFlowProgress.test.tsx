import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect } from "@jest/globals";
import { OAuthFlowProgress } from "../OAuthFlowProgress";
import { EMPTY_DEBUGGER_STATE } from "@/lib/auth-types";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock the MCP SDK auth functions
jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverOAuthProtectedResourceMetadata: jest.fn(),
}));

// Mock the auth lib
jest.mock("@/lib/auth", () => ({
  DebugInspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({
    clientInformation: jest.fn().mockResolvedValue(null),
  })),
}));

// Mock toast hook
jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

const mockOAuthMetadata = {
  issuer: "https://oauth.example.com",
  authorization_endpoint: "https://oauth.example.com/authorize",
  token_endpoint: "https://oauth.example.com/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  scopes_supported: ["read", "write"],
};

const mockResourceMetadata = {
  resource: "https://example.com/mcp",
  authorization_servers: ["https://oauth.example.com"],
  bearer_methods_supported: ["header"],
};

describe("OAuthFlowProgress URL Construction", () => {
  const defaultProps = {
    authState: EMPTY_DEBUGGER_STATE,
    updateAuthState: jest.fn(),
    proceedToNextStep: jest.fn(),
  };

  const renderWithTooltip = (props: any) => {
    return render(
      <TooltipProvider>
        <OAuthFlowProgress {...props} />
      </TooltipProvider>,
    );
  };

  describe("Server URL without path", () => {
    it("should construct correct metadata URLs for root server URLs", () => {
      const serverUrl = "https://example.com";
      const authState = {
        ...EMPTY_DEBUGGER_STATE,
        oauthStep: "metadata_discovery" as const,
        oauthMetadata: mockOAuthMetadata,
        resourceMetadata: mockResourceMetadata,
        authServerUrl: new URL("https://oauth.example.com"),
      };

      renderWithTooltip({
        ...defaultProps,
        serverUrl,
        authState,
      });

      // Expand the metadata sources to see the URLs
      const summaryElement = screen.getByText("OAuth Metadata Sources");
      fireEvent.click(summaryElement);

      // Check that the resource metadata URL is constructed correctly
      expect(
        screen.getByText(
          "https://example.com/.well-known/oauth-protected-resource",
        ),
      ).toBeInTheDocument();

      // Check that the authorization server metadata URL is constructed correctly  
      expect(
        screen.getByText(
          "https://oauth.example.com/.well-known/oauth-authorization-server",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("Server URL with path", () => {
    it("should construct correct metadata URLs preserving server path", () => {
      const serverUrl = "https://mcp-oauth-ex2.val.run/mcp";
      const authState = {
        ...EMPTY_DEBUGGER_STATE,
        oauthStep: "metadata_discovery" as const,
        oauthMetadata: mockOAuthMetadata,
        resourceMetadata: mockResourceMetadata,
        authServerUrl: new URL("https://mcp-oauth-ex2.val.run/mcp"),
      };

      renderWithTooltip({
        ...defaultProps,
        serverUrl,
        authState,
      });

      // Expand the metadata sources to see the URLs
      const summaryElement = screen.getByText("OAuth Metadata Sources");
      fireEvent.click(summaryElement);

      // This is the key test - the path should be preserved in the metadata URL
      expect(
        screen.getByText(
          "https://mcp-oauth-ex2.val.run/mcp/.well-known/oauth-protected-resource",
        ),
      ).toBeInTheDocument();

      // Also check authorization server metadata URL
      expect(
        screen.getByText(
          "https://mcp-oauth-ex2.val.run/mcp/.well-known/oauth-authorization-server",
        ),
      ).toBeInTheDocument();
    });

    it("should handle server URLs with nested paths correctly", () => {
      const serverUrl = "https://api.example.com/v1/mcp/server";
      const authState = {
        ...EMPTY_DEBUGGER_STATE,
        oauthStep: "metadata_discovery" as const,
        oauthMetadata: mockOAuthMetadata,
        resourceMetadata: mockResourceMetadata,
        authServerUrl: new URL("https://api.example.com/v1/mcp/server"),
      };

      renderWithTooltip({
        ...defaultProps,
        serverUrl,
        authState,
      });

      // Expand the metadata sources
      const summaryElement = screen.getByText("OAuth Metadata Sources");
      fireEvent.click(summaryElement);

      // Verify nested paths are preserved
      expect(
        screen.getByText(
          "https://api.example.com/v1/mcp/server/.well-known/oauth-protected-resource",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "https://api.example.com/v1/mcp/server/.well-known/oauth-authorization-server",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("Error handling URLs", () => {
    it("should show correct URLs in error messages when resource metadata fails", () => {
      const serverUrl = "https://example.com/mcp";
      const resourceError = new Error("Failed to fetch metadata");
      const authState = {
        ...EMPTY_DEBUGGER_STATE,
        oauthStep: "metadata_discovery" as const,
        oauthMetadata: mockOAuthMetadata,
        resourceMetadataError: resourceError,
        authServerUrl: new URL("https://example.com/mcp"),
      };

      renderWithTooltip({
        ...defaultProps,
        serverUrl,
        authState,
      });

      // Expand the metadata sources
      const summaryElement = screen.getByText("OAuth Metadata Sources");
      fireEvent.click(summaryElement);

      // Check that the error message contains the correct URL with path preserved
      const errorLink = screen.getByRole("link", {
        name: "https://example.com/mcp/.well-known/oauth-protected-resource",
      });
      expect(errorLink).toHaveAttribute(
        "href",
        "https://example.com/mcp/.well-known/oauth-protected-resource",
      );
    });

    it("should handle localhost URLs with ports correctly", () => {
      const serverUrl = "http://localhost:8080/api/mcp";
      const authState = {
        ...EMPTY_DEBUGGER_STATE,
        oauthStep: "metadata_discovery" as const,
        oauthMetadata: mockOAuthMetadata,
        resourceMetadata: mockResourceMetadata,
        authServerUrl: new URL("http://localhost:8080/api/mcp"),
      };

      renderWithTooltip({
        ...defaultProps,
        serverUrl,
        authState,
      });

      // Expand the metadata sources
      const summaryElement = screen.getByText("OAuth Metadata Sources");
      fireEvent.click(summaryElement);

      // Verify localhost with port and path works correctly
      expect(
        screen.getByText(
          "http://localhost:8080/api/mcp/.well-known/oauth-protected-resource",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "http://localhost:8080/api/mcp/.well-known/oauth-authorization-server",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("Edge cases", () => {
    it("should handle server URLs with trailing slashes", () => {
      const serverUrl = "https://example.com/mcp/";
      const authState = {
        ...EMPTY_DEBUGGER_STATE,
        oauthStep: "metadata_discovery" as const,
        oauthMetadata: mockOAuthMetadata,
        resourceMetadata: mockResourceMetadata,
        authServerUrl: new URL("https://example.com/mcp/"),
      };

      renderWithTooltip({
        ...defaultProps,
        serverUrl,
        authState,
      });

      // Expand the metadata sources
      const summaryElement = screen.getByText("OAuth Metadata Sources");
      fireEvent.click(summaryElement);

      // The URL construction should handle trailing slashes gracefully
      // Note: new URL(".well-known/...", "https://example.com/mcp/") 
      // should result in "https://example.com/mcp/.well-known/..."
      expect(
        screen.getByText(
          "https://example.com/mcp/.well-known/oauth-protected-resource",
        ),
      ).toBeInTheDocument();
    });

    it("should handle server URLs with query parameters", () => {
      const serverUrl = "https://example.com/mcp?version=1";
      const authState = {
        ...EMPTY_DEBUGGER_STATE,
        oauthStep: "metadata_discovery" as const,
        oauthMetadata: mockOAuthMetadata,
        resourceMetadata: mockResourceMetadata,
        authServerUrl: new URL("https://example.com/mcp?version=1"),
      };

      renderWithTooltip({
        ...defaultProps,
        serverUrl,
        authState,
      });

      // Expand the metadata sources
      const summaryElement = screen.getByText("OAuth Metadata Sources");
      fireEvent.click(summaryElement);

      // URL construction should preserve query parameters in the base but add the well-known path
      expect(
        screen.getByText(
          "https://example.com/mcp/.well-known/oauth-protected-resource",
        ),
      ).toBeInTheDocument();
    });
  });
});