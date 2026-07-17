import { useTranslation } from "react-i18next";
import React, { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@/types";
import { clearAuth, getStoredUser, storeUser, setTokens } from "./authStore";
import api from "@/lib/api";
import { applyDirection } from "@/lib/i18n";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [isLoading, setIsLoading] = useState(true);

  // Validate token and load current user on mount
  useEffect(() => {
    const access = localStorage.getItem("access_token");
    if (!access) {
      setIsLoading(false);
      return;
    }

    api
      .get<User>("/core/me/profile/")
      .then((res) => {
        setUser(res.data);
        storeUser(res.data);
        applyDirection(res.data.language_preference);
      })
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const tokenRes = await api.post<{ access: string; refresh: string }>(
      "/auth/login/",
      { email, password }
    );
    setTokens(tokenRes.data.access, tokenRes.data.refresh);

    const userRes = await api.get<User>("/core/me/profile/");
    setUser(userRes.data);
    storeUser(userRes.data);
    applyDirection(userRes.data.language_preference);
  };

  const logout = () => {
    clearAuth();
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
