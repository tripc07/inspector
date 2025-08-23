import { isAzureADEndpoint } from "../oauth-state-machine";

describe("isAzureADEndpoint", () => {
  test("should return true for Microsoft Online endpoints", () => {
    expect(isAzureADEndpoint({ authorization_endpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize" })).toBe(true);
    expect(isAzureADEndpoint({ authorization_endpoint: "https://login.microsoft.com/oauth2/v2.0/authorize" })).toBe(true);
    expect(isAzureADEndpoint({ authorization_endpoint: "https://login.live.com/oauth20_authorize.srf" })).toBe(true);
  });

  test("should return true for Azure B2C endpoints", () => {
    expect(isAzureADEndpoint({ authorization_endpoint: "https://contoso.b2clogin.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize" })).toBe(true);
  });

  test("should return false for non-Azure endpoints", () => {
    expect(isAzureADEndpoint({ authorization_endpoint: "https://auth0.com/authorize" })).toBe(false);
    expect(isAzureADEndpoint({ authorization_endpoint: "https://accounts.google.com/oauth/authorize" })).toBe(false);
    expect(isAzureADEndpoint({ authorization_endpoint: "https://example.com/oauth/authorize" })).toBe(false);
  });

  test("should return false for missing authorization_endpoint", () => {
    expect(isAzureADEndpoint({})).toBe(false);
    expect(isAzureADEndpoint({ authorization_endpoint: undefined })).toBe(false);
    expect(isAzureADEndpoint({ authorization_endpoint: "" })).toBe(false);
  });
});