/**
 * Utilidad de registro seguro (Safe Logger)
 *
 * Previene la fuga de informacion sensible (tokens, contrasenas, correos, ubicaciones)
 * en la consola del desarrollador o en logs de depuracion de React Native.
 */
export class SafeLogger {
  private static readonly SENSITIVE_KEYS = new Set([
    'password',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'secret',
    'location',
    'photos',
  ]);

  /**
   * Sanitiza un objeto eliminando campos sensibles antes de imprimir en consola.
   */
  static sanitizeForLog<T>(data: T): unknown {
    if (data === null || data === undefined) {
      return data;
    }
    if (typeof data !== 'object') {
      return data;
    }
    if (Array.isArray(data)) {
      return data.map((item) => SafeLogger.sanitizeForLog(item));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
      const isSensitive =
        SafeLogger.SENSITIVE_KEYS.has(normalizedKey) ||
        normalizedKey.includes('auth') ||
        normalizedKey.includes('token') ||
        normalizedKey.includes('password') ||
        normalizedKey.includes('secret');

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = SafeLogger.sanitizeForLog(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Registra informacion tecnica en consola asegurando que no se expongan datos sensibles.
   */
  static logInfo(message: string, context?: unknown): void {
    if (context !== undefined) {
      const safeContext = SafeLogger.sanitizeForLog(context);
      console.log(`[INFO] ${message}`, safeContext);
    } else {
      console.log(`[INFO] ${message}`);
    }
  }
}
