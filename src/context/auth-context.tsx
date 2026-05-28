import React, { createContext, useContext, useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { OAUTH_CONFIG } from '../constants/config';
import {
  generateRandomString,
  generateCodeChallenge,
  exchangeCodeForTokens,
  fetchUserProfile,
  saveTokens,
  getAccessToken,
  clearTokens,
  UserProfile,
} from '../services/auth-service';

// Required for web browser redirect handling in some environments (like web platforms)
WebBrowser.maybeCompleteAuthSession();

interface AuthContextType {
  user: UserProfile | null;
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize and check for existing login session on mount
  useEffect(() => {
    async function loadStoredSession() {
      try {
        const storedToken = await getAccessToken();
        if (storedToken) {
          console.log('🔄 Found stored access token, recovering session...');
          // Attempt to fetch profile to verify if token is valid
          const profile = await fetchUserProfile(storedToken);
          console.log('👤 Recovered Stored SSO User Profile:', JSON.stringify(profile, null, 2));
          setAccessToken(storedToken);
          setUser(profile);
        }
      } catch (err) {
        // Token might have expired or backend is down, silently clear session
        console.warn('Failed to recover stored session:', err);
        await clearTokens();
      } finally {
        setIsLoading(false);
      }
    }
    loadStoredSession();
  }, []);

  const login = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Generate security state and PKCE verifier/challenge
      const state = generateRandomString(16);
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // 2. Build Authorize URL targeting Next.js OAuth authorize page
      const authParams = new URLSearchParams({
        client_id: OAUTH_CONFIG.clientId,
        redirect_uri: OAUTH_CONFIG.redirectUri,
        response_type: 'code',
        scope: OAUTH_CONFIG.scopes.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      const authUrl = `${OAUTH_CONFIG.authUrl}?${authParams.toString()}`;

      // 3. Launch In-App Web Browser
      const result = await WebBrowser.openAuthSessionAsync(
        authUrl,
        OAUTH_CONFIG.redirectUri
      );

      if (result.type !== 'success') {
        throw new Error('Authentication flow cancelled or closed.');
      }

      // 4. Parse redirect URL parameters
      const parsedUrl = Linking.parse(result.url);
      const code = parsedUrl.queryParams?.code;
      const returnedState = parsedUrl.queryParams?.state;

      if (!code) {
        throw new Error('Authorization code not returned.');
      }

      if (returnedState !== state) {
        throw new Error('OAuth State verification failed. CSRF attack blocked.');
      }

      // 5. Exchange code for JWT tokens
      console.log('🔄 Exchanging auth code for tokens...');
      console.log('🎫 Auth Code:', code);
      const tokenResponse = await exchangeCodeForTokens(code as string, codeVerifier);
      console.log('🔑 Token Response:', tokenResponse);

      // 6. Save tokens and fetch user profile
      await saveTokens(tokenResponse.access_token, tokenResponse.refresh_token);
      console.log('📥 Fetching user profile with access token...');
      const profile = await fetchUserProfile(tokenResponse.access_token);
      console.log('👤 SSO User Profile Payload:', JSON.stringify(profile, null, 2));

      setAccessToken(tokenResponse.access_token);
      setUser(profile);
    } catch (err: any) {
      console.error('SSO Login Error:', err);
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await clearTokens();
      setUser(null);
      setAccessToken(null);
    } catch (err: any) {
      console.error('Logout error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        error,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
