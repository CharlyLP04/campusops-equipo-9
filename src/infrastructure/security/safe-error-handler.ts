/**
 * Utilidad de manejo y sanitizacion de errores para prevenir fugas de informacion sensible.
 *
 * Elimina patrones de tokens (Bearer tokens, credenciales, queries con secretos)
 * de mensajes de error antes de que sean impresos en consola o reportados a telemetria.
 */
export class SafeErrorHandler {
  private static readonly SENSITIVE_PATTERNS: readonly RegExp[] = [
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    /token=([A-Za-z0-9._~+/-]+)/gi,
    /password=([^\s&]+)/gi,
    /authorization:\s*([^\n\r]+)/gi,
  ];

  /**
   * Sanitiza un mensaje de error o una excepcion, reemplazando datos sensibles por [REDACTED].
   */
  static sanitizeErrorMessage(message: string): string {
    if (!message || typeof message !== 'string') {
      return '';
    }
    let sanitized = message;
    for (const pattern of SafeErrorHandler.SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match, p1) => {
        if (p1) {
          return match.replace(p1, '[REDACTED]');
        }
        return '[REDACTED]';
      });
    }
    return sanitized;
  }

  /**
   * Envoltorio seguro para ejecutar operaciones asincronas; si la operacion falla,
   * captura la excepcion y relanza un Error con el mensaje sanitizado.
   */
  static async executeSafely<T>(operation: () => Promise<T>, fallbackContext = 'Operacion'): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = SafeErrorHandler.sanitizeErrorMessage(originalMessage);
      throw new Error(`[${fallbackContext}] ${safeMessage}`);
    }
  }
}
