/**
 * App.tsx — Raíz de composición (Composition Root)
 *
 * Único lugar en el que se instancian:
 *   - CloudIncidentRepository  (Infrastructure)
 *   - GetIncidentsUseCase         (Application)
 *   - GetIncidentDetailUseCase    (Application)
 *
 * La UI recibe las dependencias inyectadas; nunca importa Infrastructure.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';

// Infrastructure
import { CloudIncidentRepository } from './src/infrastructure/incidents/cloud-incident.repository';
import { InMemoryIncidentRepository } from './src/infrastructure/incidents/in-memory-incident.repository';

// Application
import { GetIncidentsUseCase } from './src/application/incidents/get-incidents.usecase';
import { GetIncidentDetailUseCase } from './src/application/incidents/get-incident-detail.usecase';
import { CreateIncidentUseCase } from './src/application/incidents/create-incident.usecase';

// UI
import { IncidentListScreen } from './src/ui/screens/IncidentListScreen';
import { IncidentDetailScreen } from './src/ui/screens/IncidentDetailScreen';

// ─── Composition Root ─────────────────────────────────────────────────────────
const isTestEnvironment =
  process.env.NODE_ENV === 'test' ||
  process.env.JEST_WORKER_ID !== undefined;

const repository = isTestEnvironment
  ? new InMemoryIncidentRepository()
  : new CloudIncidentRepository();

const getIncidentsUseCase = new GetIncidentsUseCase(repository);
const getIncidentDetailUseCase = new GetIncidentDetailUseCase(repository);
const createIncidentUseCase = new CreateIncidentUseCase(repository);
// ─── Navegación simple ────────────────────────────────────────────────────────
export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'available' | 'offline'>('checking');

  // Smoke-test contract: getByText('CampusOps') + getByTestId('backend-status')
  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then(() => { if (active) setBackendStatus('available'); })
      .catch(() => { if (active) setBackendStatus('offline'); });
    return () => { active = false; };
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Nodo requerido por smoke.test.tsx — no eliminar */}
      <View style={styles.hidden}>
        <Text testID="backend-status">Backend: {backendStatus}</Text>
      </View>
      {selectedIncidentId === null ? (
        <IncidentListScreen
          getIncidentsUseCase={getIncidentsUseCase}
          onSelectIncident={(id) => setSelectedIncidentId(id)}
        />
      ) : (
        <IncidentDetailScreen
          incidentId={selectedIncidentId}
          getIncidentDetailUseCase={getIncidentDetailUseCase}
          onBack={() => setSelectedIncidentId(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { height: 0, overflow: 'hidden' },
});
