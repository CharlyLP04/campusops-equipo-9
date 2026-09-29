import type { SecureStoragePort } from '../../domain/security/secure-storage.port';

/**
 * Servicio de almacenamiento seguro con proteccion contra exposicion de secretos.
 *
 * Implementa una capa de acceso a almacenamiento seguro en memoria (con soporte para
 * desacoplar persistencia segura de hardware como Expo SecureStore / KeyStore / Keychain).
 * Garantiza que ante fallos de lectura/escritura, nunca se expongan los valores
 * sensibles en los mensajes de error arrojados.
 */
export class SecureStorageService implements SecureStoragePort {
  private readonly storage = new Map<string, string>();

  /**
   * Obtiene un valor confidencial a partir de su clave.
   */
  async getItem(key: string): Promise<string | null> {
    this.assertValidKey(key);
    return this.storage.get(key) ?? null;
  }

  /**
   * Almacena de forma segura un valor sensible (token, secreto de sesion).
   */
  async setItem(key: string, value: string): Promise<void> {
    this.assertValidKey(key);
    if (typeof value !== 'string') {
      throw new Error(`[SecureStorage] El valor para '${key}' debe ser una cadena.`);
    }
    this.storage.set(key, value);
  }

  /**
   * Elimina un secreto del almacenamiento seguro.
   */
  async removeItem(key: string): Promise<void> {
    this.assertValidKey(key);
    this.storage.delete(key);
  }

  /**
   * Limpia todos los secretos almacenados (ej. ante cierre de sesion).
   */
  async clear(): Promise<void> {
    this.storage.clear();
  }

  private assertValidKey(key: string): void {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new Error('[SecureStorage] La clave no puede ser vacia.');
    }
  }
}
