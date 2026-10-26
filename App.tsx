import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import type { SessionIdentityPort } from './src/domain/auth/session-identity.port';
import type {
  CampusOpsActorId,
} from './src/domain/auth/role-authorization';
import type { Incident } from './src/domain/incidents/incident.entity';
import type { SessionStatus } from './src/domain/auth/session.types';

import { CloudIncidentRepository } from './src/infrastructure/incidents/cloud-incident.repository';
import { InMemoryIncidentRepository } from './src/infrastructure/incidents/in-memory-incident.repository';
import { SessionAuthService } from './src/infrastructure/auth/session-auth.service';

import { GetIncidentsUseCase } from './src/application/incidents/get-incidents.usecase';
import { GetIncidentDetailUseCase } from './src/application/incidents/get-incident-detail.usecase';
import { CreateIncidentUseCase } from './src/application/incidents/create-incident.usecase';
import { EnqueueIncidentActionUseCase } from './src/application/sync/enqueue-incident-action.usecase';
import { GetOfflineQueueSummaryUseCase, type OfflineQueueSummary } from './src/application/sync/get-offline-queue-summary.usecase';
import { SyncService } from './src/application/sync/sync.service';
import { HttpSyncRemote } from './src/infrastructure/sync/http-sync-remote';
import { SqliteOfflineQueue } from './src/infrastructure/sync/sqlite-offline-queue';

import { IncidentListScreen } from './src/ui/screens/IncidentListScreen';
import { IncidentDetailScreen } from './src/ui/screens/IncidentDetailScreen';

const isTestEnvironment =
  process.env.NODE_ENV === 'test' ||
  process.env.JEST_WORKER_ID !== undefined;

// El selector de actores sintéticos se habilita únicamente en desarrollo/Jest.
// No es un mecanismo de autenticación apropiado para una aplicación de producción.
const isDevelopmentBuild = process.env.NODE_ENV !== 'production';
const fixtureSelectorEnabled = isTestEnvironment || isDevelopmentBuild;

const sessionAuthService = new SessionAuthService();

const repository = isTestEnvironment
  ? new InMemoryIncidentRepository()
  : new CloudIncidentRepository({
      credentialsProvider: () => sessionAuthService.getRequestCredentials(),
    });

// Fixture de composición exclusivo de Jest para mantener el smoke test reproducible.
const testIdentity: SessionIdentityPort = {
  getAuthenticatedIdentity: () => ({
    actorId: 'coordinator-1',
    role: 'coordinator',
  }),
};

const sessionIdentity: SessionIdentityPort = isTestEnvironment
  ? testIdentity
  : sessionAuthService;

const getIncidentsUseCase = new GetIncidentsUseCase(
  repository,
  sessionIdentity,
);
const getIncidentDetailUseCase = new GetIncidentDetailUseCase(
  repository,
  sessionIdentity,
);
const createIncidentUseCase = new CreateIncidentUseCase(
  repository,
  sessionIdentity,
);
const offlineQueue = isTestEnvironment ? null : new SqliteOfflineQueue();
const queueSummaryUseCase = offlineQueue
  ? new GetOfflineQueueSummaryUseCase(offlineQueue)
  : null;
const enqueueIncidentActionUseCase = offlineQueue
  ? new EnqueueIncidentActionUseCase(
      offlineQueue,
      () => `offline-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    )
  : null;
const syncService = offlineQueue
  ? new SyncService(
      offlineQueue,
      new HttpSyncRemote({
        accessTokenProvider: () => sessionAuthService.getAccessToken(),
      }),
    )
  : null;
const EVALUATION_ACTORS: readonly {
  id: CampusOpsActorId;
  label: string;
}[] = [
  { id: 'reporter-1', label: 'Entrar como reportante' },
  { id: 'technician-1', label: 'Entrar como técnico' },
  { id: 'coordinator-1', label: 'Entrar como coordinación' },
];

export default function App() {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    null,
  );
  const [backendStatus, setBackendStatus] = useState<
    'checking' | 'available' | 'offline'
  >('checking');

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(
    isTestEnvironment ? 'authenticated' : 'anonymous',
  );
  const [sessionInitializing, setSessionInitializing] = useState(
    !isTestEnvironment,
  );
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [queueSummary, setQueueSummary] = useState<OfflineQueueSummary | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);

  const refreshQueueSummary = async () => {
    if (!queueSummaryUseCase) return;
    try {
      setQueueSummary(await queueSummaryUseCase.execute());
      setQueueMessage(null);
    } catch {
      setQueueMessage('No se pudo recuperar la cola local.');
    }
  };

  useEffect(() => {
    let active = true;

    getBackendHealth()
      .then(() => {
        if (active) setBackendStatus('available');
      })
      .catch(() => {
        if (active) setBackendStatus('offline');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshQueueSummary();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const enqueueStartAttention = async (
    incident: Incident,
    payload: Readonly<Record<string, unknown>>,
  ) => {
    const identity = sessionIdentity.getAuthenticatedIdentity();

    if (
      !identity ||
      !enqueueIncidentActionUseCase ||
      incident.version === undefined
    ) {
      throw new Error('No existe una identidad o versión válida para encolar.');
    }

    const knownIncident = {
      id: incident.id,
      version: incident.version,
      reporterId: incident.reporterId,
      assignedTechnicianId: incident.assignedTechnicianId,
      status: incident.status,
    };

    const note =
      typeof payload.note === 'string' ? payload.note.trim() : '';

    const photoReference =
      typeof payload.photoReference === 'string'
        ? payload.photoReference.trim()
        : '';

    await enqueueIncidentActionUseCase.execute({
      actorId: identity.actorId,
      incident: knownIncident,
      action: 'start',
    });

    if (note) {
      await enqueueIncidentActionUseCase.execute({
        actorId: identity.actorId,
        incident: knownIncident,
        action: 'comment',
        payload: { text: note },
      });
    }

    if (photoReference) {
      await enqueueIncidentActionUseCase.execute({
        actorId: identity.actorId,
        incident: knownIncident,
        action: 'add_evidence',
        payload: { evidenceId: photoReference },
      });
    }

    await refreshQueueSummary();
  };

  const synchronizeQueue = async () => {
    if (!syncService) return;
    try {
      await syncService.syncPending();
      await refreshQueueSummary();
    } catch {
      setQueueMessage('No se pudo sincronizar la cola local.');
    }
  };

  useEffect(() => {
    if (isTestEnvironment) return;

    let active = true;

    sessionAuthService
      .initialize()
      .then((state) => {
        if (active) setSessionStatus(state.status);
      })
      .catch(() => {
        if (active) {
          setSessionStatus('anonymous');
          setSessionMessage(
            'No se pudo recuperar la sesión segura. Puedes volver a iniciar sesión.',
          );
        }
      })
      .finally(() => {
        if (active) setSessionInitializing(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const loginAs = async (actorId: CampusOpsActorId) => {
    setSessionInitializing(true);
    setSessionMessage(null);

    try {
      const state = await sessionAuthService.login(actorId);
      setSessionStatus(state.status);
      setSelectedIncidentId(null);
    } catch {
      setSessionStatus(sessionAuthService.getState().status);
      setSessionMessage(
        'No se pudo iniciar sesión. Verifica que el backend de evaluación esté disponible.',
      );
    } finally {
      setSessionInitializing(false);
    }
  };

  const refreshSession = async () => {
    setSessionInitializing(true);
    setSessionMessage(null);

    try {
      const state = await sessionAuthService.refresh();
      setSessionStatus(state.status);
    } catch {
      setSessionStatus(sessionAuthService.getState().status);
      setSessionMessage(
        'La sesión no pudo renovarse. Inicia sesión nuevamente.',
      );
    } finally {
      setSessionInitializing(false);
    }
  };

  const logout = async () => {
    setSessionMessage(null);

    try {
      await sessionAuthService.logout();
    } catch {
      setSessionMessage(
        'La sesión se invalidó en memoria, pero no se pudo confirmar la limpieza del almacenamiento.',
      );
    } finally {
      setSessionStatus('anonymous');
      setSelectedIncidentId(null);
    }
  };

  const showLoginGate =
    !isTestEnvironment && sessionStatus !== 'authenticated';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.hidden}>
        <Text testID="backend-status">Backend: {backendStatus}</Text>
      </View>

      {showLoginGate ? (
        <View style={styles.authContainer}>
          <Text style={styles.authTitle}>CampusOps</Text>
          <Text style={styles.authSubtitle}>Sesión segura</Text>

          {sessionInitializing ? (
            <Text style={styles.authMessage}>
              Comprobando almacenamiento y estado de sesión...
            </Text>
          ) : (
            <>
              {sessionStatus === 'expired' ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.authButton}
                  onPress={() => void refreshSession()}
                >
                  <Text style={styles.authButtonText}>
                    Renovar sesión
                  </Text>
                </Pressable>
              ) : null}

              {fixtureSelectorEnabled ? (
                <>
                  <Text style={styles.authMessage}>
                    Selector de actores sintéticos para evaluación del curso.
                    No representa autenticación de producción.
                  </Text>

                  {EVALUATION_ACTORS.map((actor) => (
                    <Pressable
                      key={actor.id}
                      accessibilityRole="button"
                      style={styles.authButton}
                      onPress={() => void loginAs(actor.id)}
                    >
                      <Text style={styles.authButtonText}>
                        {actor.label}
                      </Text>
                    </Pressable>
                  ))}
                </>
              ) : (
                <Text style={styles.authMessage}>
                  La autenticación con actores de evaluación solo está
                  disponible durante el desarrollo.
                </Text>
              )}
            </>
          )}

          {sessionMessage ? (
            <Text accessibilityRole="alert" style={styles.authError}>
              {sessionMessage}
            </Text>
          ) : null}

          {sessionStatus !== 'anonymous' && !sessionInitializing ? (
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => void logout()}
            >
              <Text style={styles.secondaryButtonText}>
                Cerrar sesión
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          {!isTestEnvironment ? (
            <View style={styles.sessionBar}>
              <View>
                <Text style={styles.sessionLabel}>Sesión: {sessionAuthService.getActorId()}</Text>
                <Text style={styles.queueLabel}>
                  {queueSummary ? `Pendientes: ${queueSummary.pending}` : 'Cargando cola…'}
                  {queueSummary && queueSummary.conflicts > 0 ? ` · Conflictos: ${queueSummary.conflicts}` : ''}
                </Text>
              </View>
              <View style={styles.sessionActions}>
                <Pressable accessibilityRole="button" onPress={() => void synchronizeQueue()}>
                  <Text style={styles.syncText}>Sincronizar</Text>
                </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void logout()}
              >
                <Text style={styles.logoutText}>Cerrar sesión</Text>
              </Pressable>
              </View>
            </View>
          ) : null}

          {queueMessage ? <Text accessibilityRole="alert" style={styles.queueError}>{queueMessage}</Text> : null}

          {selectedIncidentId === null ? (
            <IncidentListScreen
              getIncidentsUseCase={getIncidentsUseCase}
              createIncidentUseCase={createIncidentUseCase}
              onSelectIncident={(id) => setSelectedIncidentId(id)}
            />
          ) : (
            <IncidentDetailScreen
              incidentId={selectedIncidentId}
              getIncidentDetailUseCase={getIncidentDetailUseCase}
              onBack={() => setSelectedIncidentId(null)}
              {...(offlineQueue
                ? {
                    offlineActions: {
                      canStartAttention: sessionAuthService.getAuthenticatedIdentity()?.role === 'technician',
                      pendingCount: queueSummary?.pending ?? 0,
                      conflictCount: queueSummary?.conflicts ?? 0,
                      onStartAttention: enqueueStartAttention,
                    },
                  }
                : {})}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { height: 0, overflow: 'hidden' },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F8F9FA',
  },
  authTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#312E81',
    textAlign: 'center',
  },
  authSubtitle: {
    fontSize: 18,
    color: '#4B5563',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  authMessage: {
    fontSize: 14,
    lineHeight: 21,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 16,
  },
  authButton: {
    backgroundColor: '#4F46E5',
    padding: 14,
    borderRadius: 9,
    marginBottom: 12,
  },
  authButtonText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  authError: {
    marginTop: 12,
    color: '#B91C1C',
    textAlign: 'center',
    fontSize: 14,
  },
  secondaryButton: {
    marginTop: 16,
    padding: 12,
  },
  secondaryButtonText: {
    textAlign: 'center',
    color: '#4338CA',
    fontWeight: '600',
  },
  sessionBar: {
    minHeight: 42,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
  },
  sessionActions: {
    flexDirection: 'row',
    gap: 14,
  },
  sessionLabel: {
    color: '#312E81',
    fontSize: 12,
    fontWeight: '600',
  },
  logoutText: {
    color: '#4338CA',
    fontSize: 13,
    fontWeight: '600',
  },
  syncText: {
    color: '#4338CA',
    fontSize: 13,
    fontWeight: '600',
  },
  queueLabel: {
    color: '#4B5563',
    fontSize: 11,
    marginTop: 2,
  },
  queueError: {
    color: '#B91C1C',
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: 12,
  },
});
