/**
 * Auth store — manages JWT tokens and current user.
 * Uses localStorage for persistence.
 */
import { create } from "zustand";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setTokens: (access: string, refresh: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

// Simple zustand-like store without the dependency - use context + useState
let _user: User | null = null;
let _listeners: (() => void)[] = [];

export function getStoredUser(): User | null {
  try {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem("access_token");
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem("access_token", access);
  localStorage.setItem("refresh_token", refresh);
}

export function clearAuth(): void {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("user");
}

export function storeUser(user: User): void {
  localStorage.setItem("user", JSON.stringify(user));
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem("access_token");
}
