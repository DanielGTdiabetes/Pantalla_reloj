export function parseErr(e: unknown): string {
  if (e instanceof Error) {
    if (/Failed to fetch/i.test(e.message)) return "No se pudo contactar con el backend (/api).";
    return e.message;
  }
  return "Error desconocido.";
}
