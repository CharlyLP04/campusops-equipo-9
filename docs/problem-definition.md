# Definición del problema — CampusOps

## Problema

CampusOps atiende la necesidad de gestionar de forma ordenada los incidentes y necesidades de mantenimiento dentro de un campus universitario ficticio. Los estudiantes y personal pueden reportar fallas eléctricas, daños en laboratorios, fugas de agua, problemas de conectividad, equipos dañados, riesgos de seguridad y otras necesidades de mantenimiento.

El problema consiste en que estos reportes necesitan ser clasificados, priorizados, asignados a un técnico, atendidos y posteriormente cerrados, conservando el historial y la evidencia de cada cambio. CampusOps busca centralizar este flujo para facilitar el seguimiento de los incidentes y evitar la pérdida de información.

## Alcance

### Incluye

- Registro y consulta de incidentes por parte del Reportante, incluyendo categoría, descripción, ubicación y fotografías.
- Consulta, asignación, priorización y seguimiento de incidentes por parte del Técnico y Coordinador.
- Flujo de atención de incidentes: `open → assigned → in_progress → resolved → closed`.
- Registro de diagnóstico, notas y evidencias durante la atención.
- Historial de cambios y posibilidad de reabrir un incidente por parte del Coordinador.
- Manejo de información local, trabajo sin conexión y sincronización posterior como parte del alcance funcional del proyecto.

### No incluye

- Pagos o funciones comerciales.
- Chat en tiempo real.
- Funciones de inteligencia artificial o reconocimiento de imágenes.
- Un panel administrativo web completo.
- Integración con datos o servicios reales de la institución.
- Publicación obligatoria en tiendas de aplicaciones.

## Actores y responsabilidades

- **Reportante:** crea incidentes, selecciona la categoría, describe el problema, indica la ubicación, adjunta fotografías cuando sea necesario, consulta sus reportes y puede agregar información posteriormente.
- **Técnico:** consulta los incidentes que tiene asignados, inicia la atención, registra diagnóstico, notas y evidencias, y marca el incidente como resuelto. Puede trabajar sin conexión y sincronizar posteriormente.
- **Coordinador:** consulta los incidentes, establece prioridades, asigna o reasigna técnicos, revisa el historial y las evidencias, y cierra o reabre los incidentes cuando corresponda.

## Flujo principal

1. **Reportar:** el Reportante registra un incidente indicando categoría, descripción, ubicación y, cuando sea necesario, fotografías.
2. **Asignar:** el Coordinador revisa el incidente, establece su prioridad y lo asigna a un Técnico.
3. **Atender:** el Técnico consulta el incidente asignado, registra el diagnóstico, notas y evidencias, y marca el incidente como resuelto.
4. **Cerrar:** el Coordinador revisa la resolución y la evidencia, y cierra el incidente. Si es necesario, puede reabrirlo para continuar su atención.

## Criterios de aceptación verificables

1. **Dado** un Reportante con acceso al sistema, **cuando** registra un incidente con categoría, descripción y ubicación, **entonces** el sistema debe permitir guardar el reporte y mostrarlo como un incidente abierto.

2. **Dado** un incidente abierto, **cuando** el Coordinador lo asigna a un Técnico, **entonces** el incidente debe pasar al estado `assigned` y quedar asociado al Técnico correspondiente.

3. **Dado** un incidente asignado, **cuando** el Técnico registra su atención y lo marca como resuelto, **entonces** el incidente debe pasar a `resolved` y conservar el diagnóstico, notas o evidencias registradas.