import { SecureStorageService } from '../src/infrastructure/security/secure-storage.service';
import { SafeErrorHandler } from '../src/infrastructure/security/safe-error-handler';

describe('SecureStorageService & SafeErrorHandler', () => {
  test('almacena, recupera y elimina credenciales y tokens de sesion de forma aislada', async () => {
    const storage = new SecureStorageService();

    await storage.setItem('auth_session_token', 'synthetic-token-xyz-123');
    const token = await storage.getItem('auth_session_token');
    expect(token).toBe('synthetic-token-xyz-123');

    await storage.removeItem('auth_session_token');
    const deletedToken = await storage.getItem('auth_session_token');
    expect(deletedToken).toBeNull();
  });

  test('falla defensivamente si se intenta usar una clave vacia sin exponer secretos', async () => {
    const storage = new SecureStorageService();
    await expect(storage.setItem('', 'secret')).rejects.toThrow('La clave no puede ser vacia');
  });

  test('SafeErrorHandler sanitiza Bearer tokens y parametros sensibles en mensajes de error', () => {
    const rawError = 'Network request failed with headers Authorization: Bearer secret-course-token-999';
    const sanitized = SafeErrorHandler.sanitizeErrorMessage(rawError);

    expect(sanitized).not.toContain('secret-course-token-999');
    expect(sanitized).toContain('[REDACTED]');
  });

  test('SafeErrorHandler.executeSafely encapsula excepciones y oculta credenciales de la traza', async () => {
    const riskyOperation = async () => {
      throw new Error('Conexion rechazada a https://api.campusops.test?token=super-secret-token');
    };

    await expect(
      SafeErrorHandler.executeSafely(riskyOperation, 'Autenticacion'),
    ).rejects.toThrow('[Autenticacion] Conexion rechazada a https://api.campusops.test?token=[REDACTED]');
  });
});
