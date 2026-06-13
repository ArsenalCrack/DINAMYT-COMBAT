// Podio de una llave de eliminación, derivado del cuadro:
//   1° campeón · 2° finalista perdedor · 3° perdedores de la ronda anterior a la
//   final (semifinales) — bronce compartido, estándar en artes marciales.
// Espejo de `podio_llave` del backend (app/api/llaves.py).

import type { LlaveEstructura } from "@/lib/api";

export interface PodioItem {
  puesto: number;
  nombre: string;
  club: string;
}

export function podioLlave(est: LlaveEstructura | null | undefined): PodioItem[] {
  if (!est || !est.campeon || !est.rondas?.length) return [];
  const rondas = est.rondas;
  const podio: PodioItem[] = [];

  // 1° y 2°: la final es el único partido de la última ronda
  const final = rondas[rondas.length - 1]?.[0];
  if (final && (final.ganador === 1 || final.ganador === 2)) {
    const gan = final.ganador === 1 ? final.comp1 : final.comp2;
    const perd = final.ganador === 1 ? final.comp2 : final.comp1;
    if (gan) podio.push({ puesto: 1, nombre: gan.nombre, club: gan.club || "" });
    if (perd) podio.push({ puesto: 2, nombre: perd.nombre, club: perd.club || "" });
  }

  // 3°: ganador del partido por el bronce (un único 3°, sin bronce compartido).
  const bronce = est.bronce;
  if (bronce && (bronce.ganador === 1 || bronce.ganador === 2)) {
    const tercero = bronce.ganador === 1 ? bronce.comp1 : bronce.comp2;
    if (tercero) podio.push({ puesto: 3, nombre: tercero.nombre, club: tercero.club || "" });
  }

  return podio;
}

export function medallaPuesto(puesto: number): string {
  return puesto === 1 ? "🥇" : puesto === 2 ? "🥈" : puesto === 3 ? "🥉" : `${puesto}°`;
}
