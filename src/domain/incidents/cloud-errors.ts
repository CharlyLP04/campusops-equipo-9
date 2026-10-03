/**
 * Jerarquía de errores tipados para la integración con el cliente cloud.
 * Previene la propagación de excepciones no controladas hacia la UI.
 */

export abstract class CloudClientError extends Error {
  protected constructor(
    message: string,
    public readonly kind: string,
  ) {
    super(message);
    this.name = 'CloudClientError';
  }
}

export class ContractValidationError extends CloudClientError {
  constructor(message = 'La respuesta remota no cumple con el sobre o contrato publicado') {
    super(message, 'contract_validation_error');
    this.name = 'ContractValidationError';
  }
}

export class CloudTimeoutError extends CloudClientError {
  constructor(message = 'La solicitud al backend didáctico excedió el tiempo límite (timeout)') {
    super(message, 'timeout_error');
    this.name = 'CloudTimeoutError';
  }
}

export class CloudServerError extends CloudClientError {
  constructor(
    public readonly statusCode: number = 500,
    message = `Error devuelto por el servidor remoto (${statusCode})`,
  ) {
    super(message, 'server_error');
    this.name = 'CloudServerError';
  }
}

export class CloudNetworkError extends CloudClientError {
  constructor(message = 'Fallo de conectividad de red con el backend didáctico') {
    super(message, 'network_error');
    this.name = 'CloudNetworkError';
  }
}

export class CloudNotFoundError extends CloudClientError {
  constructor(
    public readonly resourceId: string,
    message = `El recurso solicitado con identificador '${resourceId}' no fue encontrado`,
  ) {
    super(message, 'not_found_error');
    this.name = 'CloudNotFoundError';
  }
}
