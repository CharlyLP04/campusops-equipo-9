# Modelo de Amenazas Inicial — CampusOps

**Versión:** 1.0
**Fecha:** 20 de septiembre de 2026
**Equipo:** Equipo 9 (Carlos Olaya Gutiérrez, Alexis Montalvo Osorio, Carlos Alberto Pacheco Avila)
**Sistema:** CampusOps (React Native + Expo + TypeScript)
**Entorno:** Académico con datos exclusivamente sintéticos y ficticios.

---

## 1. Contexto y Objetivos de Seguridad

CampusOps es una aplicación universitaria para la gestión de incidencias que involucra tres perfiles de usuario: **Reportante**, **Técnico** y **Coordinador**. La aplicación gestiona reportes, fotografías, ubicaciones del campus, asignaciones y cambios de estado de trabajo offline-first.

El presente modelo de amenazas identifica los activos críticos, las fronteras de confianza del sistema, las amenazas priorizadas que podrían comprometer la confidencialidad, integridad y disponibilidad de las operaciones, así como los controles técnicos y los mecanismos de verificación automatizada asociados a cada riesgo.

---

## 2. Inventario de Activos a Proteger

Los activos principales del sistema CampusOps identificados son:

1. **Activo A-01: Credenciales y Tokens de Sesión (Autenticación y Autorización)**
   - *Descripción:* Tokens de portador sintéticos (`Bearer course-valid-token`), encabezados de actor (`X-Course-Actor`) y firmas de sesión que determinan la identidad y el perfil del usuario.
   - *Impacto ante compromiso:* Suplantación de identidad, acceso indebido a funciones de coordinación o alteración maliciosa de reportes.

2. **Activo A-02: Información de Incidencias y Diagnósticos de Campus**
   - *Descripción:* Título, descripción textual, categorías de avería (eléctrica, hidráulica, conectividad, etc.), estados del ciclo de vida (`open`, `assigned`, `in_progress`, `resolved`, `closed`), y diagnósticos técnicos de resolución.
   - *Impacto ante compromiso:* Pérdida de integridad en el seguimiento de incidentes, alteración no autorizada de prioridades o diagnósticos erróneos.

3. **Activo A-03: Asignaciones de Técnicos y Trazabilidad de Trabajo**
   - *Descripción:* Asociación formal de un técnico a una incidencia (`assignedTechnicianId`) y el estado compuesto de trabajo (`work: { assignedTechnicianId, status }`).
   - *Impacto ante compromiso:* Conflicto operativo, sabotaje en las cargas de trabajo asignadas o modificación de estados de incidencias reasignadas a otros compañeros.

4. **Activo A-04: Fotografías y Evidencia Multimedia Sintética**
   - *Descripción:* Metadatos y referencias a imágenes de prueba adjuntas como evidencia visual de fallas o de soluciones ejecutadas.
   - *Impacto ante compromiso:* Modificación no autorizada de evidencia técnica o saturación maliciosa del almacenamiento.

5. **Activo A-05: Coordenadas y Ubicaciones del Campus**
   - *Descripción:* Datos de localización sintéticos (edificios, aulas, coordenadas de prueba latitud/longitud) asociados a las incidencias.
   - *Impacto ante compromiso:* Desinformación geográfica de los técnicos de campo o exposición de patrones de desplazamiento.

6. **Activo A-06: Registros Técnicos, Telemetría y Pipeline de CI**
   - *Descripción:* Trazas de auditoría, logs de ejecución, historial de Git, artefactos de GitHub Actions y scripts de evaluación.
   - *Impacto ante compromiso:* Fuga de secretos, omisión de pruebas de calidad o manipulación del proceso de evaluación continua.

---

## 3. Fronteras de Confianza (Trust Boundaries)

Se establecen cuatro fronteras de confianza claras dentro de la arquitectura de CampusOps:

```
+-------------------------------------------------------------------------+
| Frontera 1: Dispositivo Móvil (No Confiable) <---> Backend Didáctico API|
| (React Native / Expo Client)                       (Node.js / Express)  |
+-------------------------------------------------------------------------+
                                     |
+-------------------------------------------------------------------------+
| Frontera 2: Separación de Perfiles de Usuario                           |
| [Reportante]              [Técnico]                  [Coordinador]      |
| (Crea y ve suyos)    (Ve y atiende asignados)    (Supervisa y asigna)   |
+-------------------------------------------------------------------------+
                                     |
+-------------------------------------------------------------------------+
| Frontera 3: Capa de Persistencia Local y Cola Offline                   |
| (Almacenamiento en Memoria / SQLite Local vs. Datos Remotos Validados)  |
+-------------------------------------------------------------------------+
                                     |
+-------------------------------------------------------------------------+
| Frontera 4: Repositorio Git y Pipeline de Integración Continua (CI)     |
| (GitHub Actions Runner Ubuntu con permisos restringidos de solo lectura)|
+-------------------------------------------------------------------------+
```

1. **Frontera F-01 (Móvil vs. Backend):** El cliente React Native corre en un entorno no confiable. Cualquier solicitud enviada al backend a través de HTTP debe validarse en el servidor. El backend nunca asume la legitimidad de un rol declarado únicamente por el cliente sin validar token y cabeceras.
2. **Frontera F-02 (Perfiles y Autorización Horizontal/Vertical):** Cada perfil posee límites funcionales estrictos. Un técnico no puede modificar incidencias asignadas a otro técnico; un reportante no puede consultar reportes ajenos ni cambiar asignaciones; solo el coordinador puede cerrar o reasignar incidencias.
3. **Frontera F-03 (Almacenamiento Local Offline vs. Red):** La cola offline en el dispositivo móvil preserva cambios pendientes con claves de idempotencia estables. La sincronización detecta conflictos cuando el estado remoto difiere de la base sobre la que trabajó el técnico.
4. **Frontera F-04 (Integración Continua y Mínimo Privilegio):** El runner de CI (GitHub Actions) opera con privilegios mínimos declarados explícitamente (`permissions: contents: read`), evitando credenciales de escritura o tokens de repositorio innecesarios.


### Validación de permisos por rol

Como parte de la revisión de seguridad, se verificaron las responsabilidades y restricciones de los tres perfiles de CampusOps:

| Perfil | Acciones permitidas | Acciones que deben rechazarse |
|---|---|---|
| Reportante | Crear incidencias y consultar las que él mismo reportó. | Consultar incidencias ajenas, asignar técnicos o cerrar incidencias. |
| Técnico | Consultar y actualizar incidencias que tenga asignadas. | Modificar incidencias asignadas a otro técnico o reasignarse trabajo. |
| Coordinador | Consultar incidencias, asignar técnicos y supervisar cambios de estado. | Ejecutar operaciones sin una sesión válida o alterar información sin dejar trazabilidad. |

Estas restricciones deben comprobarse en el servicio o backend. Ocultar botones en la interfaz no es suficiente, porque una solicitud podría enviarse directamente a la API. Las pruebas deben verificar respuestas `403 Forbidden` para operaciones no autorizadas y confirmar que la incidencia permanece sin cambios.

---

## 4. Matriz de Amenazas Priorizadas, Controles y Verificación

| ID | Amenaza Priorizada | Activo Afectado | Frontera | Control Técnico de Mitigación | Método de Verificación Asociado | Prioridad | Riesgo Residual Justificado |
|---|---|---|---|---|---|---|---|
| **T-01** | **Alteración no autorizada de asignaciones y estados**<br>Un actor intenta reasignar un técnico o cambiar el estado de una incidencia asignada a un tercero. | A-02, A-03 | F-01, F-02 | Validación de autorización en backend (`POST /v1/incidents/:id/actions`) verificando rol y actor. Control de concurrencia optimista mediante `baseVersion` e idempotencia que rechaza colisiones con HTTP 403 / 409. | Pruebas de contrato automatizadas ejecutadas contra el backend simulado (`npm run backend:self-test` y pruebas de integración) asegurando que solicitudes ilegítimas retornen 403 Forbidden o 409 Conflict. | **Alta** | Si un técnico opera offline durante un periodo prolongado, el conflicto se reportará hasta el momento de la reconexión. |
| **T-02** | **Consulta no autorizada de incidencias ajenas (IDOR / BOLA)**<br>Un reportante o técnico consulta incidencias ajenas manipulando el identificador en la API. | A-01, A-02, A-05 | F-01, F-02 | Filtrado de resultados en la capa de servicio según el rol autenticado: `GET /v1/incidents` restringe elementos para reportantes a sus propios reportes y para técnicos a sus tareas asignadas. | Pruebas unitarias y de integración de casos de uso (`GetIncidentsUseCase`, `GetIncidentDetailUseCase`) validando que no se expongan datos ajenos al actor en sesión. | **Alta** | Exposición visual local si el usuario presta voluntariamente su dispositivo móvil desbloqueado a terceros. |
| **T-03** | **Exposición de credenciales o claves privadas en el repositorio/CI**<br>Inclusión involuntaria de tokens de acceso (`ghp_...`), claves privadas SSH o llaves API en commits o logs del workflow. | A-01, A-06 | F-04 | Escaneo estático obligatorio de secretos en cada compilación mediante el evaluador (`SECRET_PATTERNS` en `course_public_evaluator.py`) y fijación de privilegios mínimos en CI (`contents: read`). | Ejecución obligatoria de `secret_scan` en `make verify-week-03`. Si se introduce un patrón sospechoso, el workflow falla inmediatamente con código de salida distinto de cero impidiendo la integración. | **Crítica** | Detección limitada si se utilizan formatos de secretos propietarios completamente atípicos que no coincidan con las expresiones regulares estándar de auditoría. |
| **T-04** | **Filtrado de datos sensibles en logs y telemetría**<br>Impresión de tokens de sesión, contraseñas, nombres, coordenadas o notas internas en los logs del sistema o consola móvil. | A-01, A-02, A-05 | F-01, F-03 | Función de sanitización profunda `redactForTelemetry` que analiza recursivamente cargas útiles y enmascara campos sensibles (`authorization`, `token`, `password`, `location`, `photos`) sustituyéndolos por `[REDACTED]`. | Suite de pruebas automatizadas de sanitización (`course-tests/public/week-04.test.ts` y pruebas de log) verificando que ningún dato clasificado sobreviva a la serialización de telemetría. | **Media-Alta** | Registro involuntario de información confidencial embebida en cadenas de texto libre no estructuradas en el cuerpo de comentarios. |

---

## 5. Trazabilidad de la Verificación en Integración Continua

Cada amenaza documentada cuenta con un punto de contacto directo en el flujo automatizado de GitHub Actions (`.github/workflows/week-03-ci-amenazas-feedback.yml`):

1. **Revisión estática y dependencias:** `npm run typecheck`, `npm run lint` y `npm run audit:ci`.
2. **Escaneo de secretos y consistencia estructural:** `make verify-week-03` ejecuta `course_public_evaluator.py`, analizando recursivamente el árbol de archivos en busca de llaves privadas y tokens.
3. **Comprobación de comportamiento y modelo de amenazas:** `make public-test-week-03` evalúa `course-tests/public/week-03.test.ts`, asegurando que el workflow mantenga mínimo privilegio y que el modelo vincule activos, amenazas, controles y verificación.
4. **Preservación inmutable de evidencia:** `make evidence-week-03` valida que los reportes generados correspondan al commit evaluado (`commitSha`) y que las fallas declaradas cuenten con pruebas reproducibles.

---

## 6. Datos Sintéticos y Cumplimiento de Políticas

Para todas las actividades de modelado, pruebas unitarias y generación de reportes se utilizan exclusivamente datos sintéticos de muestra:
- Actores de prueba: `reporter-1`, `reporter-2`, `technician-1`, `technician-2`, `coordinator-1`.
- Incidencias de prueba: `campus-inc-001`, categorías estándar (`electricidad`, `fontaneria`, `redes`).
- Ubicaciones ficticias: Edificio de Aulas 3, Laboratorio Central de Cómputo (Campus Universitario Ficticio).
- Credenciales: `course-valid-token`, sin almacenar llaves de producción ni información privada real.
