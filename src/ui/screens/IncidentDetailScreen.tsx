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
import { Incident, IncidentStatus } from '../../domain/incidents/incident.entity';

// ─── Paleta de colores por estado oficial ────────────────────────────────────
const STATUS_COLORS: Record<IncidentStatus, { bg: string; text: string; border: string }> = {
  Reportada:        { bg: '#FFF3CD', text: '#856404', border: '#FFEEBA' },
  Asignada:         { bg: '#CCE5FF', text: '#004085', border: '#B8DAFF' },
  'En proceso':     { bg: '#D4EDDA', text: '#155724', border: '#C3E6CB' },
  'En verificación': { bg: '#D1ECF1', text: '#0C5460', border: '#BEE5EB' },
  Cerrada:          { bg: '#E2E3E5', text: '#383D41', border: '#D6D8DB' },
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface IncidentDetailScreenProps {
  incidentId: string;
  getIncidentDetailUseCase: GetIncidentDetailUseCase;
  onBack: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
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
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getIncidentDetailUseCase
      .execute(incidentId)
      .then((data) => {
        if (!active) return;
        if (data) {
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

      {/* Contenido */}
      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator testID="detail-loading" size="large" color="#4F46E5" />
        </View>
      )}

      {!loading && notFound && (
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Incidencia no encontrada.</Text>
          <TouchableOpacity onPress={onBack} style={styles.retryButton}>
            <Text style={styles.retryText}>Volver a la lista</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && incident && (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Cabecera de estado */}
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: STATUS_COLORS[incident.status].bg,
                borderColor: STATUS_COLORS[incident.status].border,
              },
            ]}
          >
            <Text
              style={[
                styles.statusBannerText,
                { color: STATUS_COLORS[incident.status].text },
              ]}
            >
              {incident.status}
            </Text>
          </View>

          {/* ID + Título */}
          <Text style={styles.incidentId}>{incident.id}</Text>
          <Text style={styles.incidentTitle}>{incident.title}</Text>

          {/* Descripción */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Descripción del problema</Text>
            <Text style={styles.description}>{incident.description}</Text>
          </View>

          {/* Detalles */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Información</Text>
            <View style={styles.infoCard}>
              <InfoRow label="Zona" value={incident.zone} />
              <View style={styles.divider} />
              <InfoRow label="Categoría" value={incident.category} />
              <View style={styles.divider} />
              <InfoRow label="Estado" value={incident.status} />
              <View style={styles.divider} />
              <InfoRow label="Reportado por" value={incident.reportedBy} />
              {incident.assignedTo && (
                <>
                  <View style={styles.divider} />
                  <InfoRow label="Asignado a" value={incident.assignedTo} />
                </>
              )}
            </View>
          </View>

          {/* Fechas */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fechas</Text>
            <View style={styles.infoCard}>
              <InfoRow label="Reportada" value={formatDate(incident.reportedAt)} />
              <View style={styles.divider} />
              <InfoRow label="Última actualización" value={formatDate(incident.updatedAt)} />
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
    marginBottom: 6,
  },
  incidentTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 20,
    lineHeight: 28,
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
