import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearToken, getToken, setToken, type Me } from "./api";

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  signup: (orgName: string, email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch {
      clearToken();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signup = useCallback(async (orgName: string, email: string, password: string) => {
    const { token, user } = await api.signup(orgName, email, password);
    setToken(token);
    setMe({ ...user, plan: "starter", subscriptions: [] });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token } = await api.login(email, password);
    setToken(token);
    await refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    clearToken();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, signup, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
