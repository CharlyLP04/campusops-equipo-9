
/**
 * IncidentListScreen — Capa UI
 * No importa nada de src/infrastructure.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { GetIncidentsUseCase } from '../../application/incidents/get-incidents.usecase';
import { CreateIncidentUseCase } from '../../application/incidents/create-incident.usecase';

import type { IncidentLocation } from '../../campusops/contracts';

import {
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_STATUS_LABELS,
  Incident,
  IncidentStatus,
} from '../../domain/incidents/incident.entity';

type ResolveIncidentLocation = (
  query: string,
  manualLabel: string,
) => Promise<IncidentLocation>;

type BadgeColor = { bg: string; text: string };

const STATUS_COLORS: Record<IncidentStatus, BadgeColor> = {
  open: { bg: '#FFF3CD', text: '#856404' },
  assigned: { bg: '#CCE5FF', text: '#004085' },
  in_progress: { bg: '#D4EDDA', text: '#155724' },
  resolved: { bg: '#D1ECF1', text: '#0C5460' },
  closed: { bg: '#E2E3E5', text: '#383D41' },
};

const FALLBACK_BADGE: BadgeColor = {
  bg: '#F3F4F6',
  text: '#374151',
};

function getBadgeColor(status: IncidentStatus): BadgeColor {
  return STATUS_COLORS[status] ?? FALLBACK_BADGE;
}

interface IncidentListScreenProps {
  getIncidentsUseCase: GetIncidentsUseCase;
  onSelectIncident: (id: string) => void;
  createIncidentUseCase?: CreateIncidentUseCase;
  resolveIncidentLocationUseCase?: ResolveIncidentLocation;
}

export function IncidentListScreen({
  getIncidentsUseCase,
  onSelectIncident,
  createIncidentUseCase,
  resolveIncidentLocationUseCase,
}: IncidentListScreenProps) {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [resolvedLocation, setResolvedLocation] =
    useState<IncidentLocation | null>(null);

  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadIncidents = useCallback(() => {
    setLoading(true);
    setError(false);

    getIncidentsUseCase
      .execute()
      .then((data) => {
        setIncidents(data);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [getIncidentsUseCase]);

  const handleOpenCreateForm = useCallback(() => {
    setShowCreateForm(true);
    setLocationQuery('');
    setResolvedLocation(null);
    setLocationMessage(null);
    setCreateError(null);
  }, []);

  const handleCloseCreateForm = useCallback(() => {
    if (creating || resolvingLocation) return;

    setShowCreateForm(false);
    setLocationQuery('');
    setResolvedLocation(null);
    setLocationMessage(null);
    setCreateError(null);
  }, [creating, resolvingLocation]);

  const handleResolveLocation = useCallback(async () => {
    if (resolvingLocation || creating) return;

    const normalizedQuery = locationQuery.trim();

    if (!normalizedQuery) {
      setLocationMessage('Escribe una ubicación antes de continuar.');
      return;
    }

    setResolvingLocation(true);
    setResolvedLocation(null);
    setLocationMessage(null);
    setCreateError(null);

    try {
      let location: IncidentLocation;

      if (resolveIncidentLocationUseCase) {
        location = await resolveIncidentLocationUseCase(
          normalizedQuery,
          normalizedQuery,
        );
      } else {
        location = {
          source: 'manual',
          label: normalizedQuery,
        };
      }

      setResolvedLocation(location);

      if (location.source === 'provider') {
        setLocationMessage(
          'Ubicación validada por el proveedor. Las coordenadas se conservarán en la aplicación.',
        );
      } else {
        setLocationMessage(
          'Se utilizará la ubicación manual. No se enviarán coordenadas.',
        );
      }
    } catch {
      setResolvedLocation({
        source: 'manual',
        label: normalizedQuery,
      });

      setLocationMessage(
        'No se pudo consultar el proveedor. Se utilizará la ubicación manual.',
      );
    } finally {
      setResolvingLocation(false);
    }
  }, [
    locationQuery,
    resolveIncidentLocationUseCase,
    resolvingLocation,
    creating,
  ]);

  const handleCreateIncident = useCallback(() => {
    if (!createIncidentUseCase || !resolvedLocation || creating) {
      return;
    }

    setCreating(true);
    setCreateError(null);

    void createIncidentUseCase
      .execute({
        category: 'connectivity',
        description: `Incidencia rápida #${Date.now().toString().slice(-4)}`,
        location: resolvedLocation.label,
        idempotencyKey: `op-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
      })
      .then(() => {
        setShowCreateForm(false);
        setLocationQuery('');
        setResolvedLocation(null);
        setLocationMessage(null);
        setCreateError(null);

        loadIncidents();
      })
      .catch(() => {
        setCreateError(
          'No se pudo crear la incidencia. Verifica tus permisos y conexión.',
        );
      })
      .finally(() => {
        setCreating(false);
      });
  }, [
    createIncidentUseCase,
    resolvedLocation,
    creating,
    loadIncidents,
  ]);

  useEffect(() => {
    let active = true;

    getIncidentsUseCase
      .execute()
      .then((data) => {
        if (active) {
          setIncidents(data);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [getIncidentsUseCase]);

  const renderItem = useCallback(
    ({ item }: { item: Incident }) => {
      const badgeColors = getBadgeColor(item.status);
      const statusLabel =
        INCIDENT_STATUS_LABELS[item.status] ?? item.status;
      const categoryLabel =
        INCIDENT_CATEGORY_LABELS[item.category] ?? item.category;

      return (
        <TouchableOpacity
          testID={`incident-item-${item.id}`}
          accessibilityRole="button"
          style={styles.card}
          onPress={() => onSelectIncident(item.id)}
          activeOpacity={0.75}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.incidentId}>{item.id}</Text>

            <View
              style={[
                styles.badge,
                { backgroundColor: badgeColors.bg },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: badgeColors.text },
                ]}
              >
                {statusLabel}
              </Text>
            </View>
          </View>

          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.description}
          </Text>

          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>
              📍 {item.location.label}
            </Text>
            <Text style={styles.metaText}>
              🏷️ {categoryLabel}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [onSelectIncident],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          testID="loading-indicator"
          size="large"
          color="#4F46E5"
        />
        <Text style={styles.helperText}>Cargando incidencias...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.messageTitle}>
          No se pudieron cargar las incidencias
        </Text>

        <Text style={styles.helperText}>
          Verifica tu conexión e inténtalo nuevamente.
        </Text>

        <TouchableOpacity
          testID="retry-button"
          accessibilityRole="button"
          style={styles.retryButton}
          onPress={loadIncidents}
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>CampusOps</Text>
            <Text style={styles.headerSubtitle}>
              Incidencias activas — {incidents.length} registradas
            </Text>
          </View>

          {createIncidentUseCase ? (
            <TouchableOpacity
              testID="create-incident-button"
              accessibilityRole="button"
              style={styles.createButton}
              onPress={
                showCreateForm
                  ? handleCloseCreateForm
                  : handleOpenCreateForm
              }
              disabled={creating || resolvingLocation}
            >
              <Text style={styles.createButtonText}>
                {showCreateForm ? 'Cancelar' : '+ Nueva'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {showCreateForm ? (
        <View style={styles.createForm}>
          <Text style={styles.formTitle}>Nueva incidencia</Text>

          <Text style={styles.formDescription}>
            Introduce la ubicación del incidente. La aplicación intentará
            validarla y utilizará el texto manual cuando el proveedor no esté
            disponible.
          </Text>

          <TextInput
            testID="incident-location-input"
            accessibilityLabel="Ubicación de la incidencia"
            style={styles.locationInput}
            placeholder="Ej. Edificio Central"
            placeholderTextColor="#9CA3AF"
            value={locationQuery}
            onChangeText={(value) => {
              setLocationQuery(value);
              setResolvedLocation(null);
              setLocationMessage(null);
              setCreateError(null);
            }}
            editable={!resolvingLocation && !creating}
            returnKeyType="done"
            onSubmitEditing={() => void handleResolveLocation()}
          />

          {locationMessage ? (
            <Text
              testID="location-resolution-message"
              style={[
                styles.locationMessage,
                resolvedLocation?.source === 'provider'
                  ? styles.providerMessage
                  : styles.manualMessage,
              ]}
            >
              {locationMessage}
            </Text>
          ) : null}

          {resolvedLocation ? (
            <View style={styles.resolvedLocation}>
              <Text style={styles.resolvedLocationLabel}>
                Ubicación seleccionada:
              </Text>
              <Text style={styles.resolvedLocationValue}>
                {resolvedLocation.label}
              </Text>
              <Text style={styles.resolvedLocationSource}>
                {resolvedLocation.source === 'provider'
                  ? 'Origen: proveedor'
                  : 'Origen: manual'}
              </Text>
            </View>
          ) : null}

          {createError ? (
            <Text
              testID="create-incident-error"
              accessibilityRole="alert"
              style={styles.createError}
            >
              {createError}
            </Text>
          ) : null}

          <View style={styles.formActions}>
            <TouchableOpacity
              testID="resolve-location-button"
              accessibilityRole="button"
              style={styles.resolveButton}
              onPress={() => void handleResolveLocation()}
              disabled={
                resolvingLocation ||
                creating ||
                locationQuery.trim().length === 0
              }
            >
              <Text style={styles.actionButtonText}>
                {resolvingLocation
                  ? 'Validando...'
                  : resolvedLocation
                    ? 'Volver a validar'
                    : 'Validar ubicación'}
              </Text>
            </TouchableOpacity>

            {resolvedLocation ? (
              <TouchableOpacity
                testID="confirm-create-incident-button"
                accessibilityRole="button"
                style={styles.confirmButton}
                onPress={handleCreateIncident}
                disabled={creating || resolvingLocation}
              >
                <Text style={styles.actionButtonText}>
                  {creating ? 'Creando...' : 'Crear incidencia'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {incidents.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.messageTitle}>
            No hay incidencias registradas
          </Text>
          <Text style={styles.helperText}>
            Cuando se registre una incidencia, aparecerá aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          testID="incident-list"
          data={incidents}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => (
            <View style={styles.separator} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    backgroundColor: '#4F46E5',
    paddingTop: 56,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  createButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#C7D2FE',
    marginTop: 4,
  },
  createForm: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  formDescription: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
    marginBottom: 14,
  },
  locationInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#111827',
    fontSize: 14,
    backgroundColor: '#FFFFFF',
  },
  locationMessage: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  providerMessage: {
    color: '#047857',
  },
  manualMessage: {
    color: '#92400E',
  },
  resolvedLocation: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  resolvedLocationLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 3,
  },
  resolvedLocationValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  resolvedLocationSource: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
  },
  createError: {
    color: '#B91C1C',
    fontSize: 12,
    marginTop: 10,
  },
  formActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  resolveButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
  },
  confirmButton: {
    backgroundColor: '#047857',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
  },
  separator: {
    height: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  incidentId: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
    lineHeight: 22,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#6B7280',
  },
  messageTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  helperText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 20,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
