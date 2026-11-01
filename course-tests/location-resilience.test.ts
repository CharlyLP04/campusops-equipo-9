
import { selectIncidentLocation } from '../src/domain/location/select-incident-location';

describe('Semana 09 — selectIncidentLocation', () => {
  const manualLabel = 'Laboratorio de cómputo';

  it('acepta una ubicación válida del proveedor', () => {
    expect(
      selectIncidentLocation(
        {
          label: 'Edificio A',
          latitude: 18.462,
          longitude: -97.392,
        },
        manualLabel,
      ),
    ).toEqual({
      source: 'provider',
      label: 'Edificio A',
      latitude: 18.462,
      longitude: -97.392,
    });
  });

  it('limpia espacios de la etiqueta del proveedor', () => {
    expect(
      selectIncidentLocation(
        {
          label: '  Edificio A  ',
          latitude: 0,
          longitude: 0,
        },
        manualLabel,
      ),
    ).toEqual({
      source: 'provider',
      label: 'Edificio A',
      latitude: 0,
      longitude: 0,
    });
  });

  it.each([
    null,
    undefined,
    [],
    { status: 429 },
    { label: 'Incompleta' },
    { label: '', latitude: 0, longitude: 0 },
    { label: 'Inválida', latitude: 91, longitude: 0 },
    { label: 'Inválida', latitude: -91, longitude: 0 },
    { label: 'Inválida', latitude: 0, longitude: 181 },
    { label: 'Inválida', latitude: 0, longitude: -181 },
    { label: 'Inválida', latitude: NaN, longitude: 0 },
    { label: 'Inválida', latitude: 0, longitude: Infinity },
    { label: 'Inválida', latitude: null, longitude: 0 },
    { label: 'Inválida', latitude: '18.462', longitude: 0 },
  ])('utiliza ubicación manual ante datos inválidos: %p', (provider) => {
    expect(
      selectIncidentLocation(provider, manualLabel),
    ).toEqual({
      source: 'manual',
      label: manualLabel,
    });
  });

  it('utiliza Ubicación manual cuando la etiqueta manual está vacía', () => {
    expect(
      selectIncidentLocation(null, '   '),
    ).toEqual({
      source: 'manual',
      label: 'Ubicación manual',
    });
  });

  it('acepta coordenadas de los límites geográficos', () => {
    expect(
      selectIncidentLocation(
        {
          label: 'Punto válido',
          latitude: 90,
          longitude: 180,
        },
        manualLabel,
      ),
    ).toMatchObject({
      source: 'provider',
      latitude: 90,
      longitude: 180,
    });
  });
});
