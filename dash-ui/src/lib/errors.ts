import { API_BASE } from "./api";

const API_ERROR_MESSAGE = `No se pudo contactar con /api en ${API_BASE}.`;

export function parseErr(e: unknown): string {
  if (e instanceof Error) {
    if (/Failed to fetch/i.test(e.message)) return API_ERROR_MESSAGE;
    return e.message;
  }
  return "Error desconocido.";
}

export { API_ERROR_MESSAGE };
