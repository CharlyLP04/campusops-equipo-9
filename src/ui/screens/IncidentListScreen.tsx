
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
  TouchableOpacity,
  View,
} from 'react-native';

import { GetIncidentsUseCase } from '../../application/incidents/get-incidents.usecase';
import {
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_STATUS_LABELS,
  Incident,
  IncidentStatus,
} from '../../domain/incidents/incident.entity';

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
}

export function IncidentListScreen({
  getIncidentsUseCase,
  onSelectIncident,
}: IncidentListScreenProps) {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
        <Text style={styles.headerTitle}>CampusOps</Text>
        <Text style={styles.headerSubtitle}>
          Incidencias activas — {incidents.length} registradas
        </Text>
      </View>

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
