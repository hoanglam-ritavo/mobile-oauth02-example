import React, { createContext, useContext, useState, useEffect } from "react";
import { AppState, Platform } from 'react-native';
import { createNativeAuthSession } from '../services/auth-runtime';
import type { AuthSession, AuthState } from '../services/auth-session';
import type { PrivateRequest } from '../services/backend-service';

interface AuthContextType extends AuthState {
  isLoading: boolean;
  supported: boolean;
  configured: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
  request: (path: string, options?: PrivateRequest) => Promise<unknown>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
const noop = async () => {};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [runtime] = useState<{ session?: AuthSession; error?: string }>(() => {
    if (Platform.OS === 'web') return { error: 'Đăng nhập chỉ hỗ trợ trên Android và iOS.' };
    try { return { session: createNativeAuthSession() }; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Cấu hình Rita Võ ID không hợp lệ.' }; }
  });
  const [state, setState] = useState<AuthState>({
    status: runtime.session ? 'loading' : 'error', user: null, error: runtime.error ?? null,
  });
  useEffect(() => {
    const session = runtime.session;
    if (!session) return;
    const unsubscribe = session.subscribe(setState);
    const disconnectLinks = session.connectLinks();
    void session.verify();
    let previous = AppState.currentState;
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') void session.verify();
      previous = next;
    });
    return () => { disconnectLinks(); unsubscribe(); listener.remove(); };
  }, [runtime]);

  return (
    <AuthContext.Provider value={{
      ...state, isLoading: state.status === 'loading', supported: Platform.OS !== 'web',
      configured: !!runtime.session, login: runtime.session?.login ?? noop,
      logout: runtime.session?.logout ?? noop, retry: runtime.session?.retry ?? noop,
      request: runtime.session ? runtime.session.authorized.bind(runtime.session) : async () => {
        throw new Error('Application session is unavailable.');
      },
    }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
