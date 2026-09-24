/**
 * Puerto para el mecanismo de almacenamiento seguro (ej. SecureStore en dispositivo,
 * Keychain en iOS, Keystore / EncryptedSharedPreferences en Android).
 *
 * Utilizado exclusivamente para activos de alta confidencialidad (tokens de sesion,
 * llaves de autenticacion y credenciales sinteticas), aislados de la persistencia
 * ordinaria de la aplicacion (SQLite / AsyncStorage).
 */
export interface SecureStoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}
