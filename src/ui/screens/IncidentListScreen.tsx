/**
 * IncidentListScreen — Capa UI
 * AUDITORÍA AC-03: este archivo NO importa nada de src/infrastructure.
 * Recibe el caso de uso mediante inyección de dependencias en sus props.
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
import { Incident, IncidentStatus } from '../../domain/incidents/incident.entity';

// ─── Paleta de colores por estado oficial ────────────────────────────────────
const STATUS_COLORS: Record<IncidentStatus, { bg: string; text: string }> = {
  Reportada:        { bg: '#FFF3CD', text: '#856404' },
  Asignada:         { bg: '#CCE5FF', text: '#004085' },
  'En proceso':     { bg: '#D4EDDA', text: '#155724' },
  'En verificación': { bg: '#D1ECF1', text: '#0C5460' },
  Cerrada:          { bg: '#E2E3E5', text: '#383D41' },
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface IncidentListScreenProps {
  getIncidentsUseCase: GetIncidentsUseCase;
  onSelectIncident: (id: string) => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────
export function IncidentListScreen({
  getIncidentsUseCase,
  onSelectIncident,
}: IncidentListScreenProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getIncidentsUseCase
      .execute()
      .then((data) => {
        if (active) {
          setIncidents(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [getIncidentsUseCase]);

  const renderItem = useCallback(
    ({ item }: { item: Incident }) => {
      const badgeColors = STATUS_COLORS[item.status];
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
              style={[styles.badge, { backgroundColor: badgeColors.bg }]}
            >
              <Text style={[styles.badgeText, { color: badgeColors.text }]}>
                {item.status}
              </Text>
            </View>
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>📍 {item.zone}</Text>
            <Text style={styles.metaText}>🏷 {item.category}</Text>
          </View>
        </TouchableOpacity>
      );
    },
    [onSelectIncident],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator testID="loading-indicator" size="large" color="#4F46E5" />
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
      <FlatList
        testID="incident-list"
        data={incidents}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    gap: 16,
  },
  metaText: {
    fontSize: 12,
    color: '#6B7280',
  },
});
