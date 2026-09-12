/**
 * App.tsx — Raíz de composición (Composition Root)
 *
 * Único lugar en el que se instancian:
 *   - InMemoryIncidentRepository  (Infrastructure)
 *   - GetIncidentsUseCase         (Application)
 *   - GetIncidentDetailUseCase    (Application)
 *
 * La UI recibe las dependencias inyectadas; nunca importa Infrastructure.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// Infrastructure — solo se instancia aquí
import { InMemoryIncidentRepository } from './src/infrastructure/incidents/in-memory-incident.repository';

// Application
import { GetIncidentsUseCase } from './src/application/incidents/get-incidents.usecase';
import { GetIncidentDetailUseCase } from './src/application/incidents/get-incident-detail.usecase';

// UI
import { IncidentListScreen } from './src/ui/screens/IncidentListScreen';
import { IncidentDetailScreen } from './src/ui/screens/IncidentDetailScreen';

// ─── Composition Root ─────────────────────────────────────────────────────────
const repository = new InMemoryIncidentRepository();
const getIncidentsUseCase = new GetIncidentsUseCase(repository);
const getIncidentDetailUseCase = new GetIncidentDetailUseCase(repository);

// ─── Navegación simple ────────────────────────────────────────────────────────
export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
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
});
