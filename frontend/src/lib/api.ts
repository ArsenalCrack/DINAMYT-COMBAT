"use client";

import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { "Content-Type": "application/json" },
});

// Interceptor: inyectar JWT en cada request
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("dinamyt_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Interceptor: si recibimos 401, limpiar sesión
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("dinamyt_token");
      localStorage.removeItem("dinamyt_user");
      // Redirigir a login si no estamos ya ahí
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth API ──
export async function loginAPI(email: string, password: string) {
  const res = await api.post("/auth/login", { email, password });
  return res.data as { token: string; user: UserData };
}

export async function registerUserAPI(data: {
  email: string;
  password: string;
  nombre: string;
  rol: string;
}) {
  const res = await api.post("/auth/register", data);
  return res.data;
}

export async function getMeAPI() {
  const res = await api.get("/auth/me");
  return res.data as UserData;
}

export async function listUsersAPI() {
  const res = await api.get("/auth/users");
  return res.data as UserData[];
}

export async function deleteUserAPI(id: number) {
  const res = await api.delete(`/auth/users/${id}`);
  return res.data;
}

// ── Campeonatos API ──
export async function listCampeonatosAPI() {
  const res = await api.get("/campeonatos");
  return res.data;
}

export async function getCampeonatoAPI(id: number) {
  const res = await api.get(`/campeonatos/${id}`);
  return res.data;
}

export async function createCampeonatoAPI(data: {
  nombre: string;
  descripcion?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  num_tatamis?: number;
}) {
  const res = await api.post("/campeonatos", data);
  return res.data;
}

export async function updateCampeonatoAPI(id: number, data: Record<string, unknown>) {
  const res = await api.put(`/campeonatos/${id}`, data);
  return res.data;
}

export async function deleteCampeonatoAPI(id: number) {
  const res = await api.delete(`/campeonatos/${id}`);
  return res.data;
}

// ── Tatamis API ──
export async function listTatamisAPI(campeonatoId: number) {
  const res = await api.get(`/tatamis/campeonato/${campeonatoId}`);
  return res.data;
}

export async function getTatamiAPI(id: number) {
  const res = await api.get(`/tatamis/${id}`);
  return res.data;
}

export async function misTatamisAPI() {
  const res = await api.get("/tatamis/mis-tatamis");
  return res.data;
}

export async function verificarPinAPI(pin: string) {
  const res = await api.post("/tatamis/verificar-pin", { pin });
  return res.data;
}

export async function asignarJuezAPI(
  tatamiId: number,
  data: { usuario_id: number; rol_tatami: string; nombre_display?: string }
) {
  const res = await api.post(`/tatamis/${tatamiId}/asignar`, data);
  return res.data;
}

export async function desasignarJuezAPI(tatamiId: number, usuarioId: number) {
  const res = await api.delete(`/tatamis/${tatamiId}/desasignar/${usuarioId}`);
  return res.data;
}

// ── Categorías API ──
export async function listCategoriasAPI() {
  const res = await api.get("/categorias");
  return res.data;
}

// ── Combates API ──
export async function listCombatesAPI(tatamiId: number) {
  const res = await api.get(`/combates/tatami/${tatamiId}`);
  return res.data;
}

export async function getCombateDetalleAPI(id: number) {
  const res = await api.get(`/combates/${id}`);
  return res.data;
}

export async function listCombatesRecientesAPI(limit = 20) {
  const res = await api.get(`/combates/recientes?limit=${limit}`);
  return res.data;
}

// ── Types ──
export interface UserData {
  id: number;
  email: string;
  nombre: string;
  rol: "admin" | "juez";
  activo: boolean;
  creado_por_id?: number | null;
  creado_por?: {
    id: number;
    nombre: string;
    email: string;
  } | null;
  created_at: string;
  eliminado_at?: string | null;
  tatamis_asignados?: TatamiAsignacion[];
  asignaciones?: TatamiAsignacion[];
}

export interface TatamiAsignacion {
  id: number;
  tatami_id: number;
  usuario_id: number;
  rol_tatami: string;
  nombre_display: string;
  asignado_at?: string;
  asignado_por?: {
    id: number;
    nombre: string;
    email: string;
  } | null;
  campeonato_nombre?: string;
}

export default api;
