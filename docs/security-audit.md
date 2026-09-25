# Auditoría de seguridad — Semana 4

**Estudiante:** Carlos Alberto Pacheco Avila  
**Proyecto:** CampusOps  
**Rama:** `week4/security-audit-pacheco`

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---:|---|---|---|---|
| 1 | `redactForTelemetry` no estaba implementada. | Los logs y reportes podían conservar tokens, identidades, ubicaciones, fotografías y comentarios internos. | Se implementó sanitización recursiva y los valores sensibles se sustituyen por `[REDACTED]`. | `docs/evidence/week04-public-test.txt` |
| 2 | La pantalla de detalle mostraba `reporterId` y `assignedTechnicianId`. | La interfaz podía exponer identificadores internos de usuarios y técnicos. | Se aplicó minimización de datos mostrando únicamente etiquetas no identificables. | `docs/evidence/identifiers-protected.diff` |
| 3 | El proyecto todavía no implementa almacenamiento seguro para una sesión real. | Un token almacenado en almacenamiento plano podría recuperarse desde el dispositivo. | Se documentó como riesgo pendiente; una sesión real deberá utilizar SecureStore y eliminarse al cerrar sesión. | Revisión de la estructura actual del proyecto |

## Hallazgo 1 — Sanitización no implementada

### Problema encontrado

La función `redactForTelemetry` de `src/course-evaluation/index.ts` lanzaba un error pendiente y no procesaba los datos recibidos.

### Riesgo

La información utilizada para telemetría podía conservar tokens, correos, nombres, identificadores, ubicaciones, fotografías y comentarios internos.

### Solución aplicada

Se implementó una función recursiva que recorre objetos y listas, normaliza las claves y reemplaza los datos sensibles por `[REDACTED]`. La función conserva datos técnicos como `incidentId` y crea una copia sin modificar el objeto original.

### Evidencia

`docs/evidence/week04-public-test.txt` demuestra que la prueba pública terminó con una prueba aprobada.

## Hallazgo 2 — Identificadores internos visibles

### Problema encontrado

`src/ui/screens/IncidentDetailScreen.tsx` mostraba directamente `reporterId` y `assignedTechnicianId`.

### Riesgo

Un usuario podía conocer identificadores internos que no necesita para consultar una incidencia.

### Solución aplicada

La pantalla ahora muestra `Identidad protegida` para el reportante y únicamente informa si existe un técnico asignado, sin revelar su identificador.

### Evidencia

`docs/evidence/identifiers-protected.diff` contiene el cambio antes y después. `docs/evidence/typecheck.txt` confirma que TypeScript terminó sin errores.

## Hallazgo 3 — Almacenamiento seguro pendiente

### Problema encontrado

El proyecto todavía no contiene una implementación de almacenamiento seguro para una sesión real.

### Riesgo

Cuando se incorporen tokens reales, guardarlos en almacenamiento plano permitiría recuperarlos desde un dispositivo comprometido o una copia de sus datos.

### Recomendación

La sesión deberá almacenarse mediante SecureStore, eliminarse al cerrar sesión y evitarse completamente en logs y mensajes de error. Este riesgo queda pendiente porque actualmente el backend y sus tokens son fixtures sintéticos del curso.

## Comprobaciones realizadas

```text
npm.cmd test -- --ci --runInBand course-tests/public/week-04.test.ts
npm.cmd run typecheck
git check-ignore -v .env