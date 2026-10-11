export class AuthorizationError extends Error {
  constructor(message = 'Se requiere una sesión válida y permisos suficientes.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}
