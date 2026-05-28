export const OAUTH_CONFIG = {
  clientId: process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID || "790e65a0af811c7e01d5238c79c7fcf1",
  redirectUri: process.env.EXPO_PUBLIC_OAUTH_REDIRECT_URI || "ritaidapp://redirect",
  authUrl: process.env.EXPO_PUBLIC_OAUTH_AUTH_URL || "http://172.16.6.131:3001/oauth/authorize",
  tokenUrl: process.env.EXPO_PUBLIC_OAUTH_TOKEN_URL || "http://172.16.6.131:3000/auth/oauth/token",
  userInfoUrl: process.env.EXPO_PUBLIC_OAUTH_USER_INFO_URL || "http://172.16.6.131:3000/auth/oauth/userinfo",
  scopes: ["openid", "profile", "email"],
};

