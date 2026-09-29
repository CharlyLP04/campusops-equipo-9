import { redactForTelemetry } from '../src/course-evaluation';

describe('Week 04 - Negative and Boundary Tests', () => {
  test('redacts sensitive data inside nested arrays and objects', () => {
    const input = {
      incidentId: 'INC-001',
      correlationId: 'COR-001',
      status: 'open',
      events: [
        {
          email: 'alexis@example.com',
          userId: 'user-123',
        },
        {
          authorization: 'Bearer secret-token',
          location: 'Laboratorio 1',
        },
      ],
    };

    const result = redactForTelemetry(input);

    expect(result).toEqual({
      incidentId: 'INC-001',
      correlationId: 'COR-001',
      status: 'open',
      events: [
        {
          email: '[REDACTED]',
          userId: '[REDACTED]',
        },
        {
          authorization: '[REDACTED]',
          location: '[REDACTED]',
        },
      ],
    });
  });

  test('preserves technical telemetry fields', () => {
    const input = {
      incidentId: 'INC-001',
      correlationId: 'COR-001',
      status: 'resolved',
      attempt: 2,
      durationMs: 350,
    };

    const result = redactForTelemetry(input);

    expect(result).toEqual(input);
  });

  test('does not mutate the original object', () => {
    const input = {
      incidentId: 'INC-001',
      profile: {
        email: 'alexis@example.com',
      },
    };

    const original = structuredClone(input);

    redactForTelemetry(input);

    expect(input).toEqual(original);
  });

  test('redacts sensitive data from network error responses', () => {
    const input = {
      error: {
        status: 500,
        message: 'Request failed',
        response: {
          authorization: 'Bearer secret',
          email: 'alexis@example.com',
          token: 'abc123',
        },
      },
    };

    const result = redactForTelemetry(input);

    expect(result).toEqual({
      error: {
        status: 500,
        message: 'Request failed',
        response: {
          authorization: '[REDACTED]',
          email: '[REDACTED]',
          token: '[REDACTED]',
        },
      },
    });
  });

  test('handles cyclic structures without exposing sensitive data', () => {
    const input: {
      incidentId: string;
      email: string;
      self?: unknown;
    } = {
      incidentId: 'INC-001',
      email: 'alexis@example.com',
    };

    input.self = input;

    expect(() => redactForTelemetry(input)).not.toThrow();
  });
});