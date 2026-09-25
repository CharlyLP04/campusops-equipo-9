/**
 * IncidentDetailScreen — Capa UI
 * AUDITORÍA AC-03: este archivo NO importa nada de src/infrastructure.
 * Recibe el caso de uso mediante inyección de dependencias en sus props.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { GetIncidentDetailUseCase } from '../../application/incidents/get-incident-detail.usecase';
import {
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_STATUS_LABELS,
  Incident,
  IncidentStatus,
} from '../../domain/incidents/incident.entity';

// ─── Paleta de colores por estado oficial ────────────────────────────────────
type StatusColor = { bg: string; text: string; border: string };

const STATUS_COLORS: Record<IncidentStatus, StatusColor> = {
  open:        { bg: '#FFF3CD', text: '#856404', border: '#FFEEBA' },
  assigned:    { bg: '#CCE5FF', text: '#004085', border: '#B8DAFF' },
  in_progress: { bg: '#D4EDDA', text: '#155724', border: '#C3E6CB' },
  resolved:    { bg: '#D1ECF1', text: '#0C5460', border: '#BEE5EB' },
  closed:      { bg: '#E2E3E5', text: '#383D41', border: '#D6D8DB' },
};

const FALLBACK_COLOR: StatusColor = {
  bg: '#F3F4F6',
  text: '#374151',
  border: '#E5E7EB',
};

/** Devuelve siempre un StatusColor válido; nunca undefined. */
function getStatusColor(status: IncidentStatus): StatusColor {
  return STATUS_COLORS[status] ?? FALLBACK_COLOR;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface IncidentDetailScreenProps {
  incidentId: string;
  getIncidentDetailUseCase: GetIncidentDetailUseCase;
  onBack: () => void;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ─── Componente ───────────────────────────────────────────────────────────────
export function IncidentDetailScreen({
  incidentId,
  getIncidentDetailUseCase,
  onBack,
}: IncidentDetailScreenProps) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    getIncidentDetailUseCase
      .execute(incidentId)
      .then((data) => {
        if (!active) return;
        if (data != null) {
          setIncident(data);
        } else {
          setNotFound(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setNotFound(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [incidentId, getIncidentDetailUseCase]);

  const statusColor: StatusColor =
    incident != null ? getStatusColor(incident.status) : FALLBACK_COLOR;
  const statusLabel =
    incident != null
      ? INCIDENT_STATUS_LABELS[incident.status] ?? incident.status
      : '';
  const categoryLabel =
    incident != null
      ? INCIDENT_CATEGORY_LABELS[incident.category] ?? incident.category
      : '';

  return (
    <View style={styles.container}>
      {/* Barra de navegación */}
      <View style={styles.navbar}>
        <TouchableOpacity
          testID="back-button"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
          activeOpacity={0.75}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Lista</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Detalle</Text>
        <View style={styles.navPlaceholder} />
      </View>

      {/* Estado: cargando */}
      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator testID="detail-loading" size="large" color="#4F46E5" />
        </View>
      )}

      {/* Estado: no encontrado */}
      {!loading && notFound && (
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Incidencia no encontrada.</Text>
          <TouchableOpacity onPress={onBack} style={styles.retryButton}>
            <Text style={styles.retryText}>Volver a la lista</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Estado: datos disponibles */}
      {!loading && incident != null && (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Badge de estado */}
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: statusColor.bg,
                borderColor: statusColor.border,
              },
            ]}
          >
            <Text
              style={[
                styles.statusBannerText,
                { color: statusColor.text },
              ]}
            >
              {statusLabel}
            </Text>
          </View>

          {/* ID */}
          <Text style={styles.incidentId}>{incident.id}</Text>

          {/* Descripción */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Descripción del problema</Text>
            <Text style={styles.description}>{incident.description}</Text>
          </View>

          {/* Información */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Información</Text>
            <View style={styles.infoCard}>
              <InfoRow label="Ubicación" value={incident.location.label} />
              <View style={styles.divider} />
              <InfoRow label="Origen de ubicación" value={incident.location.source} />
              <View style={styles.divider} />
              <InfoRow label="Categoría" value={categoryLabel} />
              <View style={styles.divider} />
              <InfoRow label="Estado" value={statusLabel} />
            </View>
          </View>

          {/* Botón Volver */}
          <TouchableOpacity
            testID="back-button-bottom"
            accessibilityRole="button"
            style={styles.backButtonBottom}
            onPress={onBack}
            activeOpacity={0.8}
          >
            <Text style={styles.backButtonText}>← Volver a la lista</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
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
    padding: 24,
  },
  navbar: {
    backgroundColor: '#4F46E5',
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backArrow: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  backLabel: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  navPlaceholder: {
    width: 56,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  statusBanner: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  statusBannerText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  incidentId: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 1,
    marginBottom: 12,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4F46E5',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  infoLabel: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginHorizontal: 14,
  },
  backButtonBottom: {
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  notFoundText: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
