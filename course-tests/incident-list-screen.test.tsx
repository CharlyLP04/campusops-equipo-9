import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { IncidentListScreen } from '../src/ui/screens/IncidentListScreen';
import type { GetIncidentsUseCase } from '../src/application/incidents/get-incidents.usecase';
import type { Incident } from '../src/domain/incidents/incident.entity';

describe('IncidentListScreen', () => {
  const createIncident = (
    id = 'INC-001',
    description = 'Falla en el equipo del laboratorio',
  ): Incident =>
    ({
      id,
      reporterId: 'USR-001',
      description,
      status: 'open',
      category: 'equipment',
      location: {
        source: 'manual',
        label: 'Laboratorio de computo',
      },
    }) as Incident;

  const createUseCase = (
    execute: jest.Mock,
  ): GetIncidentsUseCase =>
    ({
      execute,
    }) as unknown as GetIncidentsUseCase;

  const renderScreen = (execute: jest.Mock) => {
    const onSelectIncident = jest.fn();

    render(
      <IncidentListScreen
        getIncidentsUseCase={createUseCase(execute)}
        onSelectIncident={onSelectIncident}
      />,
    );

    return onSelectIncident;
  };

  it('muestra el indicador de carga mientras obtiene las incidencias', async () => {
    const execute = jest.fn(
      () => new Promise<readonly Incident[]>(() => {}),
    );
  
    renderScreen(execute);
  
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
  
    expect(screen.getByTestId('loading-indicator')).toBeTruthy();
  });

  it('muestra las incidencias después de cargarlas correctamente', async () => {
    const incident = createIncident();
    const execute = jest.fn().mockResolvedValue([incident]);

    renderScreen(execute);

    await waitFor(() => {
      expect(
        screen.getByTestId(`incident-item-${incident.id}`),
      ).toBeTruthy();
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('muestra un mensaje cuando no existen incidencias', async () => {
    const execute = jest.fn().mockResolvedValue([]);

    renderScreen(execute);

    await waitFor(() => {
      expect(
        screen.getByText('No hay incidencias registradas'),
      ).toBeTruthy();
    });
  });

  it('muestra un mensaje de error cuando falla la carga', async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error('Error de conexión'));

    renderScreen(execute);

    await waitFor(() => {
      expect(
        screen.getByText('No se pudieron cargar las incidencias'),
      ).toBeTruthy();
    });

    expect(screen.getByTestId('retry-button')).toBeTruthy();
  });

  it('permite volver a intentar la carga después de un error', async () => {
    const incident = createIncident();

    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error('Error de conexión'))
      .mockResolvedValueOnce([incident]);

    renderScreen(execute);

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('retry-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId(`incident-item-${incident.id}`),
      ).toBeTruthy();
    });

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('ejecuta la función de selección al pulsar una incidencia', async () => {
    const incident = createIncident();
    const execute = jest.fn().mockResolvedValue([incident]);

    const onSelectIncident = renderScreen(execute);

    await waitFor(() => {
      expect(
        screen.getByTestId(`incident-item-${incident.id}`),
      ).toBeTruthy();
    });

    fireEvent.press(
      screen.getByTestId(`incident-item-${incident.id}`),
    );

    expect(onSelectIncident).toHaveBeenCalledWith(incident.id);
  });
});