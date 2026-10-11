import * as SecureStore from 'expo-secure-store';
import {
  CAMPUSOPS_SESSION_STORAGE_KEY,
  ExpoSecureStorageAdapter,
} from '../src/infrastructure/auth/expo-secure-storage.adapter';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('ExpoSecureStorageAdapter', () => {
  let adapter: ExpoSecureStorageAdapter;

  const getItemAsync = SecureStore.getItemAsync as jest.Mock;
  const setItemAsync = SecureStore.setItemAsync as jest.Mock;
  const deleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new ExpoSecureStorageAdapter();
  });

  it('lee la sesión usando la clave administrada por el adaptador', async () => {
    getItemAsync.mockResolvedValueOnce('session-document');

    await expect(
      adapter.getItem(CAMPUSOPS_SESSION_STORAGE_KEY),
    ).resolves.toBe('session-document');

    expect(getItemAsync).toHaveBeenCalledWith(
      CAMPUSOPS_SESSION_STORAGE_KEY,
    );
  });

  it('guarda el documento de sesión en SecureStore', async () => {
    setItemAsync.mockResolvedValueOnce(undefined);

    await adapter.setItem(
      CAMPUSOPS_SESSION_STORAGE_KEY,
      'session-document',
    );

    expect(setItemAsync).toHaveBeenCalledWith(
      CAMPUSOPS_SESSION_STORAGE_KEY,
      'session-document',
    );
  });

  it('elimina el documento de sesión al solicitar removeItem', async () => {
    deleteItemAsync.mockResolvedValueOnce(undefined);

    await adapter.removeItem(CAMPUSOPS_SESSION_STORAGE_KEY);

    expect(deleteItemAsync).toHaveBeenCalledWith(
      CAMPUSOPS_SESSION_STORAGE_KEY,
    );
  });

  it('clear elimina el documento administrado por este adaptador', async () => {
    deleteItemAsync.mockResolvedValueOnce(undefined);

    await adapter.clear();

    expect(deleteItemAsync).toHaveBeenCalledWith(
      CAMPUSOPS_SESSION_STORAGE_KEY,
    );
  });

  it('rechaza claves ajenas sin acceder a SecureStore', async () => {
    await expect(adapter.getItem('another-module-secret')).rejects.toThrow(
      'La clave solicitada no pertenece al almacenamiento de sesión.',
    );

    expect(getItemAsync).not.toHaveBeenCalled();
  });

  it('oculta el error nativo al fallar la escritura', async () => {
    setItemAsync.mockRejectedValueOnce(
      new Error('native failure with sensitive token value'),
    );

    let message = '';

    try {
      await adapter.setItem(
        CAMPUSOPS_SESSION_STORAGE_KEY,
        'session-document',
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(
      'No fue posible guardar la sesión en el almacenamiento seguro.',
    );
    expect(message).not.toContain('sensitive token value');
  });
});
