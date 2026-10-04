import { parseRemoteResource } from '../src/course-evaluation';
import {
  CloudClientError,
  ContractValidationError,
  CloudTimeoutError,
  CloudServerError,
  CloudNetworkError,
  CloudNotFoundError,
} from '../src/domain/incidents/cloud-errors';

describe('Gobernanza de Contrato y Validación Remota — parseRemoteResource', () => {
  it('valida exitosamente un sobre completo conforme con payload', () => {
    const raw = {
      id: 'campus-inc-101',
      version: 1,
      status: 'open',
      payload: {
        title: 'Fuga de agua',
        category: 'plumbing',
      },
    };

    const result = parseRemoteResource(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('campus-inc-101');
      expect(result.value.version).toBe(1);
      expect(result.value.status).toBe('open');
      expect(result.value.payload).toEqual({
        title: 'Fuga de agua',
        category: 'plumbing',
      });
    }
  });

  it('acepta un payload nulo permitido sin inventar datos', () => {
    const raw = {
      id: 'campus-inc-102',
      version: 3,
      status: 'closed',
      payload: null,
    };

    const result = parseRemoteResource(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('campus-inc-102');
      expect(result.value.payload).toBeNull();
    }
  });

  it('soporta compatibilidad hacia adelante ignorando propiedades adicionales', () => {
    const raw = {
      id: 'campus-inc-103',
      version: 0,
      status: 'open',
      payload: null,
      serverTime: 1727900000,
      metadata: { traceId: 'xyz' },
      experimentalFlag: true,
    };

    const result = parseRemoteResource(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('campus-inc-103');
      expect((result.value as Record<string, unknown>).serverTime).toBeUndefined();
    }
  });

  it('rechaza entradas nulas, arreglos y tipos primitivos', () => {
    expect(parseRemoteResource(null)).toEqual({ ok: false, error: 'contract' });
    expect(parseRemoteResource(undefined)).toEqual({ ok: false, error: 'contract' });
    expect(parseRemoteResource([])).toEqual({ ok: false, error: 'contract' });
    expect(parseRemoteResource('cadena')).toEqual({ ok: false, error: 'contract' });
    expect(parseRemoteResource(12345)).toEqual({ ok: false, error: 'contract' });
    expect(parseRemoteResource(true)).toEqual({ ok: false, error: 'contract' });
  });

  it('rechaza identificadores vacios o solo espacios en blanco', () => {
    expect(
      parseRemoteResource({ id: '', version: 1, status: 'open', payload: null }),
    ).toEqual({ ok: false, error: 'contract' });
    expect(
      parseRemoteResource({ id: '   ', version: 1, status: 'open', payload: null }),
    ).toEqual({ ok: false, error: 'contract' });
  });

  it('rechaza versiones no numericas, negativas o flotantes', () => {
    expect(
      parseRemoteResource({ id: 'inc-1', version: '1', status: 'open', payload: null }),
    ).toEqual({ ok: false, error: 'contract' });
    expect(
      parseRemoteResource({ id: 'inc-1', version: -1, status: 'open', payload: null }),
    ).toEqual({ ok: false, error: 'contract' });
    expect(
      parseRemoteResource({ id: 'inc-1', version: 1.5, status: 'open', payload: null }),
    ).toEqual({ ok: false, error: 'contract' });
  });

  it('rechaza estatus ausente o vacio', () => {
    expect(
      parseRemoteResource({ id: 'inc-1', version: 0, status: '', payload: null }),
    ).toEqual({ ok: false, error: 'contract' });
    expect(
      parseRemoteResource({ id: 'inc-1', version: 0, status: '   ', payload: null }),
    ).toEqual({ ok: false, error: 'contract' });
  });

  it('rechaza payloads no conformes como arreglos o primitivos', () => {
    expect(
      parseRemoteResource({ id: 'inc-1', version: 0, status: 'open', payload: [1, 2, 3] }),
    ).toEqual({ ok: false, error: 'contract' });
    expect(
      parseRemoteResource({ id: 'inc-1', version: 0, status: 'open', payload: 'texto' }),
    ).toEqual({ ok: false, error: 'contract' });
  });
});

describe('Modelado de Errores Tipados de Integración Cloud', () => {
  it('instancia correctamente ContractValidationError heredando de CloudClientError', () => {
    const error = new ContractValidationError();
    expect(error).toBeInstanceOf(CloudClientError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ContractValidationError');
    expect(error.kind).toBe('contract_validation_error');
  });

  it('instancia CloudTimeoutError y preserva el mensaje descriptivo', () => {
    const error = new CloudTimeoutError();
    expect(error.kind).toBe('timeout_error');
    expect(error.message).toContain('timeout');
  });

  it('instancia CloudServerError con codigo de estado HTTP asociado', () => {
    const error = new CloudServerError(503, 'Servicio no disponible temporalmente');
    expect(error.statusCode).toBe(503);
    expect(error.kind).toBe('server_error');
  });

  it('instancia CloudNetworkError y CloudNotFoundError con identificadores explicitos', () => {
    const netErr = new CloudNetworkError();
    expect(netErr.kind).toBe('network_error');

    const notFound = new CloudNotFoundError('inc-999');
    expect(notFound.kind).toBe('not_found_error');
    expect(notFound.resourceId).toBe('inc-999');
  });
});
