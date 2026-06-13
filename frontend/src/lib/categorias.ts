// Categorías canónicas de Figuras: lista única compartida entre el panel del
// Juez Central (figuras en vivo) y las colas de figuras del admin. Tenerlas
// definidas evita que en el registro aparezcan variantes de la misma categoría
// ("Defensa" / "defensa personal" / "figura sin armas", etc.).

export const CATEGORIAS_FIGURAS = [
  "FIGURA CON ARMAS",
  "FIGURA A MANOS LIBRES",
  "DEFENSA PERSONAL",
  "FIGURA POR EQUIPOS",
] as const;

export const CATEGORIA_NOMBRE_MAX = 40;

/**
 * Normaliza un nombre de categoría: solo letras y espacios, espacios
 * colapsados y todo en MAYÚSCULAS. Espejo de `_normalizar_nombre_categoria`
 * del backend.
 */
export function normalizarCategoria(raw: string): string {
  return raw
    .replace(/[^\p{L} ]/gu, "")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, CATEGORIA_NOMBRE_MAX);
}
