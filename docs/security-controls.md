# Controles de seguridad y privacidad — Semana 4

## Objetivo

Este documento describe los controles técnicos de seguridad y privacidad de CampusOps y su relación con las amenazas identificadas durante la Semana 3.

CampusOps utiliza únicamente datos sintéticos durante el desarrollo y las pruebas. Ninguna credencial, ubicación, fotografía o dato personal real debe almacenarse en el repositorio.

## Relación entre amenazas y controles

| Amenaza | Riesgo | Control técnico | Verificación |
|---|---|---|---|
| T-01 — Alteración no autorizada de asignaciones y estados | Un usuario podría reasignar técnicos o modificar estados sin autorización. | Validación de sesión, actor y rol en el backend. Las operaciones deben comprobar la versión base y rechazar conflictos o acciones prohibidas. | Pruebas de autorización que esperan respuestas `403 Forbidden` o `409 Conflict` y verifican que la incidencia permanezca sin cambios. |
| T-02 — Consulta de incidencias ajenas | Un Reportante o Técnico podría consultar información que pertenece a otro usuario. | Filtrado de incidencias según el actor autenticado: el Reportante consulta las propias, el Técnico las asignadas y el Coordinador las autorizadas por su función. | Pruebas de acceso horizontal que solicitan una incidencia ajena y comprueban que los datos no se entreguen. |
| T-03 — Exposición de credenciales o secretos | Un token, llave privada o contraseña podría llegar al repositorio o a GitHub Actions. | Escaneo estático obligatorio, archivos `.env` excluidos mediante `.gitignore`, datos exclusivamente ficticios y permisos mínimos de CI con `contents: read`. | `python tools/course_public_evaluator.py --week 04 --mode verify` debe devolver `secret_scan: pass` y `hits=[]`. |
| T-04 — Filtración de datos en logs y telemetría | Tokens, nombres, ubicaciones, fotografías o comentarios internos podrían aparecer en logs y errores. | Sanitización recursiva mediante `redactForTelemetry`, sustituyendo valores sensibles por `[REDACTED]` antes de registrar o reportar información. | Pruebas públicas y negativas con objetos anidados, listas y errores simulados deben confirmar que los datos sensibles no sobreviven a la sanitización. |

## Separación del almacenamiento

### Tokens de sesión: SecureStore

Los tokens de acceso y renovación deben almacenarse mediante SecureStore porque representan credenciales que permiten actuar en nombre del usuario. SecureStore utiliza mecanismos protegidos del sistema operativo y reduce la exposición frente a una lectura casual del almacenamiento de la aplicación.

Los tokens no deben guardarse en SQLite, almacenamiento plano, logs ni variables públicas como `EXPO_PUBLIC_*`.

### Incidencias operativas: SQLite

Las incidencias, estados, asignaciones pendientes y operaciones offline se almacenan en SQLite porque necesitan:

- consultas estructuradas;
- relaciones entre registros;
- actualizaciones y transacciones;
- funcionamiento sin conexión;
- sincronización posterior con el servicio remoto.

SQLite facilita el trabajo offline, pero no debe utilizarse para conservar tokens de sesión ni secretos.

## Alternativa considerada

Una alternativa sería guardar sesión e incidencias juntas en SQLite. Esta opción simplificaría el acceso inicial a los datos, pero aumentaría el impacto de una copia o lectura no autorizada de la base local.

Se decidió separar responsabilidades:

- SecureStore para credenciales de sesión;
- SQLite para información operativa;
- sanitización antes de enviar información a logs, errores o reportes.

## Auditoría de dependencias y secretos

Se ejecutaron:

```text
npm.cmd run audit:ci
python tools/course_public_evaluator.py --week 04 --mode verify