"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loginAPI, getMeAPI, type UserData } from "./api";

interface AuthContextType {
  user: UserData | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isJuez: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Cargar sesion de localStorage al iniciar
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const savedToken = localStorage.getItem("dinamyt_token");
      const savedUser = localStorage.getItem("dinamyt_user");

      if (savedToken && savedUser) {
        try {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
          // Verificar que el token siga vigente
          getMeAPI()
            .then((userData) => {
              if (cancelled) return;
              setUser(userData);
              localStorage.setItem("dinamyt_user", JSON.stringify(userData));
            })
            .catch(() => {
              if (cancelled) return;
              // Token expirado
              localStorage.removeItem("dinamyt_token");
              localStorage.removeItem("dinamyt_user");
              setToken(null);
              setUser(null);
            })
            .finally(() => {
              if (!cancelled) setLoading(false);
            });
        } catch {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await loginAPI(email, password);
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem("dinamyt_token", data.token);
    localStorage.setItem("dinamyt_user", JSON.stringify(data.user));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("dinamyt_token");
    localStorage.removeItem("dinamyt_user");
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        isAdmin: user?.rol === "admin",
        isJuez: user?.rol === "juez",
      }}
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
