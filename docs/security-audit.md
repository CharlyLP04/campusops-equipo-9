# Auditoría de seguridad y privacidad — Semana 4

Esta auditoría se limita a datos sintéticos de CampusOps. No se usaron
credenciales, tokens ni datos personales reales.

## Hallazgo 1 — `redactForTelemetry` sin implementar

### Problema

`redactForTelemetry` en `src/course-evaluation/index.ts` delegaba en
`pending(...)`. Por tanto, no sanitizaba datos antes de que éstos llegaran a
telemetría.

### Riesgo

Un evento con encabezados de autorización, tokens, identificadores de actores,
ubicación, fotos/evidencias o comentarios internos podría enviarse sin
redactar. Esto viola minimización de datos y puede exponer información sensible
en registros técnicos.

### Solución aplicada

Se implementó una transformación inmutable y recursiva para objetos y arreglos.
Normaliza las claves al eliminar separadores y diferencias de mayúsculas, y
reemplaza los valores sensibles con `[REDACTED]`. Conserva el contexto técnico
no sensible, por ejemplo `incidentId`, `status`, `attempt`, `durationMs` y
`accept`.

### Antes

La función lanzaba un error mediante `pending('redactForTelemetry')`.

### Después

La función devuelve una copia con los datos sensibles redactados, también dentro
de estructuras anidadas y arreglos.

### Evidencia

- `evidence/Hallazgo 1 .png`
-
- Ejecución de `npx jest course-tests/public/week-04.test.ts --runInBand`

## Hallazgo 2 — Exposición de IDs internos en el detalle de incidencia

### Problema

`IncidentDetailScreen` mostraba `incident.reporterId` y
`incident.assignedTechnicianId` como parte de la información visible del
detalle.

### Riesgo

Los identificadores internos no son necesarios para consultar una incidencia.
Mostrarlos incrementa innecesariamente la exposición de identidad y dificulta
cumplir el principio de minimización de datos.

### Solución aplicada

Se eliminaron únicamente las filas visuales “Reportado por” y “Técnico
asignado”. Los campos siguen existiendo en el modelo de dominio y la lógica de
obtención de la incidencia no se modifica.

### Antes

La interfaz presentaba ambos IDs internos al usuario.

### Después

La interfaz conserva ubicación, origen de ubicación, categoría y estado sin
renderizar los IDs de reportante ni técnico asignado.

### Evidencia

- `evidence/Hallazgo 2.png`


## Hallazgo 3 — Consulta sin filtrado por actor o rol

### Problema

`InMemoryIncidentRepository.findAll()` devuelve todas las incidencias y el caso
de uso de consulta no recibe contexto de actor o rol para aplicar un filtro.

### Riesgo

Si esta ruta se usara sin una capa de autorización, podría devolver incidencias
que el actor solicitante no debería consultar.

### Solución aplicada

Identificado, pero **no corregido en esta entrega individual**. Corregirlo
requeriría definir autorización y filtrado en la capa de aplicación/dominio, un
alcance distinto a las dos correcciones mínimas de esta auditoría.

### Evidencia

- `evidence/Hallazgo 3.png`

## Verificación

Se ejecutan los siguientes comandos sin modificar pruebas públicas:

node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\eslint\bin\eslint.js .
node .\node_modules\jest\bin\jest.js course-tests/public/week-04.test.ts --runInBand
git status
git diff

Los resultados de la ejecución se registran en la entrega de la actividad. Las
capturas manuales se conservan en `docs/evidence/` con los nombres indicados.
