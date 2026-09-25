import { SafeLogger } from '../src/infrastructure/security/safe-logger';
import { SafeErrorHandler } from '../src/infrastructure/security/safe-error-handler';
import { getBackendHealth } from '../src/api/courseBackend';

describe('Auditoria de Seguridad y Privacidad — Semana 4', () => {
  describe('Hallazgo 1: Sanitizacion de logs en consola (SafeLogger)', () => {
    test('enmascara tokens, passwords y credenciales con [REDACTED] en objetos anidados', () => {
      const sensitivePayload = {
        actorId: 'technician-1',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic',
        authHeader: 'Bearer course-valid-token-secret-123',
        password: 'SuperSecretPassword123!',
        profile: {
          email: 'tecnico@campusops.test',
          photos: ['photo-hash-1', 'photo-hash-2'],
        },
        metadata: {
          requestId: 'req-001',
          status: 'success',
        },
      };

      const sanitized = SafeLogger.sanitizeForLog(sensitivePayload) as Record<string, unknown>;

      // Los campos sensibles deben ser reemplazados
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.authHeader).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');

      const profile = sanitized.profile as Record<string, unknown>;
      expect(profile.photos).toBe('[REDACTED]');

      // Los campos tecnicos y seguros deben preservarse
      expect(sanitized.actorId).toBe('technician-1');
      const metadata = sanitized.metadata as Record<string, unknown>;
      expect(metadata.requestId).toBe('req-001');
      expect(metadata.status).toBe('success');
    });

    test('imprime mensajes de log en consola sin exponer contrasenas ni tokens', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      SafeLogger.logInfo('Sesion iniciada', {
        actorId: 'reporter-1',
        token: 'secret-token-xyz',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[INFO] Sesion iniciada',
        expect.objectContaining({
          actorId: 'reporter-1',
          token: '[REDACTED]',
        }),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Hallazgo 2: Sanitizacion de errores y excepciones (SafeErrorHandler)', () => {
    test('elimina Bearer tokens y parametros de consulta de mensajes de error de red', () => {
      const rawError = 'Fallo de red al conectar con https://api.campusops.test/v1/incidents?token=super-secret-token-999 con cabecera Authorization: Bearer secret-auth-key';
      const sanitized = SafeErrorHandler.sanitizeErrorMessage(rawError);

      expect(sanitized).not.toContain('super-secret-token-999');
      expect(sanitized).not.toContain('secret-auth-key');
      expect(sanitized).toContain('token=[REDACTED]');
      expect(sanitized).toContain('[REDACTED]');
    });

    test('SafeErrorHandler.executeSafely envuelve excepciones de API y oculta credenciales', async () => {
      const failingApiCall = async () => {
        throw new Error('Timeout al consultar http://192.168.1.50:4310?token=my-private-api-key');
      };

      await expect(
        SafeErrorHandler.executeSafely(failingApiCall, 'Backend API'),
      ).rejects.toThrow('[Backend API] Timeout al consultar http://192.168.1.50:4310?token=[REDACTED]');
    });

    test('getBackendHealth maneja fallos de conexion arrojando un error seguro', async () => {
      // Configuramos una URL inaccesible simulada
      await expect(
        getBackendHealth('http://127.0.0.1:99999'),
      ).rejects.toThrow(/\[Backend\]/);
    });
  });
});
