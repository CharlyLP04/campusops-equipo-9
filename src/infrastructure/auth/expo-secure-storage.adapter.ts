import * as SecureStore from 'expo-secure-store';
import type { SecureStoragePort } from '../../domain/security/secure-storage.port';

/**
 * Clave única del documento de sesión.
 * El documento contiene las credenciales de sesión y se almacena en SecureStore.
 */
export const CAMPUSOPS_SESSION_STORAGE_KEY =
  'campusops.auth.session.v1' as const;

/**
 * Adaptador de almacenamiento persistente para la sesión de CampusOps.
 *
 * A diferencia del almacenamiento en memoria, SecureStore utiliza el
 * almacenamiento seguro disponible en el dispositivo.
 *
 * Este adaptador administra exclusivamente su documento de sesión. Por eso,
 * clear() elimina dicho documento, sin borrar secretos de otros módulos.
 * No se registran tokens ni errores nativos que pudieran incluir datos sensibles.
 */
export class ExpoSecureStorageAdapter implements SecureStoragePort {
  async getItem(key: string): Promise<string | null> {
    this.assertSupportedKey(key);

    try {
      return await SecureStore.getItemAsync(CAMPUSOPS_SESSION_STORAGE_KEY);
    } catch {
      throw new Error(
        '[AuthStorage] No fue posible leer la sesión del almacenamiento seguro.',
      );
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    this.assertSupportedKey(key);

    if (typeof value !== 'string') {
      throw new Error('[AuthStorage] El valor de sesión debe ser una cadena.');
    }

    try {
      await SecureStore.setItemAsync(CAMPUSOPS_SESSION_STORAGE_KEY, value);
    } catch {
      throw new Error(
        '[AuthStorage] No fue posible guardar la sesión en el almacenamiento seguro.',
      );
    }
  }

  async removeItem(key: string): Promise<void> {
    this.assertSupportedKey(key);

    try {
      await SecureStore.deleteItemAsync(CAMPUSOPS_SESSION_STORAGE_KEY);
    } catch {
      throw new Error(
        '[AuthStorage] No fue posible eliminar la sesión del almacenamiento seguro.',
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(CAMPUSOPS_SESSION_STORAGE_KEY);
    } catch {
      throw new Error(
        '[AuthStorage] No fue posible limpiar la sesión del almacenamiento seguro.',
      );
    }
  }

  private assertSupportedKey(key: string): void {
    if (key !== CAMPUSOPS_SESSION_STORAGE_KEY) {
      throw new Error(
        '[AuthStorage] La clave solicitada no pertenece al almacenamiento de sesión.',
      );
    }
  }
}
