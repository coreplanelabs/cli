export type Credential = ApiKeyCredential | OAuthCredential;

export interface ApiKeyCredential {
  type: 'api-key';
  key: string;
  source: 'flag' | 'env' | 'config';
}

export interface OAuthCredential {
  type: 'oauth';
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  tokenType: string;
  scope: string;
  account?: string;
}

export interface StoredOAuthCredential {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  token_type: string;
  scope: string;
  account?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface OIDCConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  scopes_supported?: string[];
}
