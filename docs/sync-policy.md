# Política de sincronización, conflictos e idempotencia — CampusOps (Semana 08)

Este documento define las reglas reales que gobiernan la cola de operaciones sin conexión, la combinación de cambios concurrentes, la detección y resolución de conflictos, la autorización por perfil y el retiro seguro de operaciones en **CampusOps**.

---

## 1. Arquitectura y módulos responsables

| Componente | Ruta | Responsabilidad |
|---|---|---|
| Contratos de sincronización | `src/domain/sync/sync.types.ts` | Define `SyncSnapshot`, `SyncFields`, `SyncResolution` e `IncidentWorkFields`. |
| Entidad de operación pendiente | `src/domain/sync/pending-operation.ts` | Modela `PendingOperation` con identidad estable (`operationId`), versión base (`baseVersion`), instantánea base (`baseFields`), intención local (`localFields`) y estado (`pending`, `conflict`, `failed`). |
| Puerto de cola persistente | `src/domain/sync/offline-queue.port.ts` | Contrato `OfflineQueuePort` (`enqueue`, `list`, `replace`, `remove`) desacoplado de la infraestructura de almacenamiento. |
| Motor de combinación 3-way | `src/domain/sync/resolve-sync.ts` | Implementa `resolveSync(base, local, remote)` mediante comparación por JSON canónico sin mutar las entradas. |
| Deduplicador de cola | `src/domain/sync/deduplicate-operations.ts` | Implementa `deduplicateOperations(operations)` preservando la primera aparición de cada `operationId` sin mutar el arreglo de entrada. |
| Caso de uso de encolado offline | `src/application/sync/enqueue-incident-action.usecase.ts` | Valida permisos RBAC de la semana 6 antes de persistir una operación offline y construye la proyección del campo compuesto `work`. |
| Coordinador de sincronización | `src/application/sync/sync.service.ts` | Orquesta el envío secuencial, deduplicación previa, manejo de `409`/`403`/`500`/timeout, rebase automático de cambios compatibles y preservación de conflictos. |
| Adaptador HTTP idempotente | `src/infrastructure/sync/http-sync-remote.ts` | Conecta con `POST /v1/incidents/:id/actions` y `GET /v1/incidents/:id` enviando `Idempotency-Key: <operationId>`. |
| Fachada de evaluación | `src/course-evaluation/index.ts` | Expone `resolveSync` y `deduplicateOperations` delegando directamente al dominio real. |

---

## 2. Identidad estable e idempotencia (`operationId`)

1. **Generación única al encolar:** Cuando el usuario registra una acción sin conexión mediante `EnqueueIncidentActionUseCase`, se asigna un `operationId` estable (mínimo 8 caracteres) que identifica de forma única la intención del autor.
2. **Prohibición de regenerar claves en reintentos:** Todo reintento posterior sobre la misma operación conserva exactamente el mismo `operationId` y el mismo cuerpo. Nunca se genera un ID nuevo al reintentar una operación pendiente.
3. **Deduplicación en cliente (`deduplicateOperations`):** Antes de transmitir la cola, `SyncService` ejecuta `deduplicateOperations` sobre las operaciones en estado `pending`. Si por reintentos de almacenamiento o lecturas repetidas existieran entradas duplicadas con el mismo `operationId`, se conserva únicamente la primera ocurrencia sin mutar la colección original.
4. **Idempotencia en servidor (`Idempotency-Key`):** `HttpSyncRemote` transmite `Idempotency-Key: <operationId>` en el encabezado HTTP.
   - Si una respuesta previa se perdió después de que el servidor guardó el cambio (escenario `timeout_after_commit`), el reenvío con el mismo `operationId` recibe `200 OK` con `{ duplicate: true }`.
   - El servidor no duplica el efecto en el historial ni incrementa dos veces la versión de la incidencia.
   - Si una clave se reutiliza con contenido distinto, el servidor responde `409 Conflict` (`idempotency_key_reused`) y la operación se marca en conflicto para inspección.

---

## 3. Reglas de combinación de tres vías (`resolveSync`)

Dado el estado base `base`, la intención local `local` y el estado actual del servidor `remote`:

1. **Comparación por valor canónico (`canonicalJson`):**
   - Cada campo se serializa ordenando lexicográficamente las claves de cualquier objeto anidado.
   - Dos objetos distintos en memoria con el mismo contenido JSON producen la misma representación canónica y **no** generan falso conflicto.
   - Ninguno de los objetos `base`, `local` o `remote` es mutado durante la evaluación.
2. **Cambios independientes (combinación automática):**
   - Si `local` modificó el campo `A` respecto de `base` y `remote` modificó un campo distinto `B` respecto de `base`, ambos cambios son compatibles.
   - `resolveSync` devuelve `{ kind: 'merged', fields: { ... } }` conservando el valor local de `A` y el valor remoto de `B`.
   - En `SyncService`, cuando el servidor rechaza por `version_conflict` (`409`) pero `resolveSync` determina que los cambios son compatibles (`merged`), la operación local se **rebasa** (`rebase`) a la versión remota actual y permanece en estado `pending` para aplicarse en el siguiente ciclo.
3. **Cambios incompatibles (declaración de conflicto):**
   - Si tanto `local` como `remote` modificaron el mismo campo respecto de `base` y sus valores canónicos difieren (`localValue !== remoteValue`), el campo se declara en conflicto.
   - `resolveSync` devuelve `{ kind: 'conflict', fields: [...] }` con los nombres de los campos incompatibles **ordenados alfabéticamente**.

---

## 4. Caso obligatorio: inicio de atención offline vs. reasignación remota

En CampusOps, la asignación del técnico y el estado operativo forman una unidad de decisión representada en las pruebas y adaptadores mediante el campo compuesto:

```json
{
  "work": {
    "assignedTechnicianId": "technician-1",
    "status": "assigned"
  }
}
```

### Flujo del conflicto
1. **Estado base (`version: 1`):** La incidencia `campus-inc-001` está asignada a `technician-1` con estado `assigned`.
2. **Trabajo sin conexión (`local`):** `technician-1` inicia la atención localmente (`action: 'start'`). Su intención queda persistida en la cola con `baseVersion: 1` y `localFields.work = { assignedTechnicianId: 'technician-1', status: 'in_progress' }`.
3. **Cambio concurrente en servidor (`remote`, `version: 2`):** Mientras `technician-1` sigue sin conexión, `coordinator-1` reasigna la incidencia a `technician-2` (`remote.fields.work = { assignedTechnicianId: 'technician-2', status: 'assigned' }`).
4. **Reconexión y detección:**
   - Al ejecutar `SyncService.syncPending()`, `HttpSyncRemote` envía `POST /v1/incidents/campus-inc-001/actions` con `baseVersion: 1` e `Idempotency-Key: <operationId>`.
   - El backend rechaza la operación con `403 Forbidden` (porque `technician-1` ya no es el técnico asignado) o `409 Conflict` (`version_conflict`).
   - `SyncService` consulta la instantánea remota; si el técnico ya no tiene visibilidad (`403` en `GET /v1/incidents/:id`) o si `resolveSync(base, local, remote)` compara `work`, detecta incompatibilidad sobre `['work']`.
5. **Preservación de ambos hechos:**
   - **No se sobrescribe la asignación remota:** En el servidor, la incidencia permanece en `version: 2` asignada a `technician-2`.
   - **No se borra la intención local:** La operación permanece en la cola con `status: 'conflict'`, `conflictFields: ['work']` y `localFields` intacto.
   - **No se cicla en reintentos infinitos:** Las operaciones en estado `conflict` no se reenvían automáticamente en llamadas subsecuentes a `syncPending()`.
6. **Información y resolución explícita (`SyncService.resolveConflict`):**
   - La interfaz presenta al usuario la operación retenida con los campos en conflicto (`work`) y la razón (`forbidden` / `version_conflict`).
   - El autor o coordinación debe elegir explícitamente:
     - `discard_local`: reconoce la reasignación remota y retira la intención local de la cola.
     - `retry_on_remote`: sólo si el actor aún tiene visibilidad y permisos sobre la versión remota actual, rebasa la operación sobre el `snapshot` remoto; si el técnico fue desasignado (`snapshot === null`), la operación se mantiene en estado `conflict` sin inventar una base nueva.

---

## 5. Autorización por perfil (continuidad con Semana 06)

La política de sincronización mantiene íntegramente el modelo RBAC de la semana 6 (`src/domain/auth/role-authorization.ts`):

- **En el cliente antes de encolar (`EnqueueIncidentActionUseCase`):**
  - Se invoca `canPerformIncidentAction(actorId, action, incident)`.
  - Sólo el técnico actualmente asignado (`assignedTechnicianId === actorId`) puede encolar `start` o `resolve`.
  - Un técnico no asignado (`technician-2` sobre una incidencia de `technician-1`) o un reportante recibe `AuthorizationError` y la operación **no entra a la cola**.
- **En el servidor al sincronizar (`course-backend/campusops.mjs`):**
  - El backend valida nuevamente el rol y la asignación vigente al momento de recibir el `POST`. Si la asignación cambió mientras el técnico estaba offline, el servidor responde `403 Forbidden`.

---

## 6. Momento de retirar una operación de la cola

Una operación **sólo se elimina de `OfflineQueuePort`** en dos situaciones:

1. **Confirmación explícita del servidor (`kind: 'applied'`):**
   - Respuesta `201 Created` (aplicada por primera vez) o `200 OK` con `duplicate: true` (ya aplicada previamente con el mismo `operationId`) y número de `version` entero válido en el cuerpo.
2. **Descarte explícito del usuario (`resolveConflict(operationId, 'discard_local')`):**
   - Cuando el autor resuelve manualmente un conflicto aceptando el estado remoto.

### Casos en los que NUNCA se retira una operación automáticamente

| Situación | Resultado en `HttpSyncRemote` | Estado en la cola | Comportamiento |
|---|---|---|---|
| Timeout de red o respuesta perdida | `retryable` (`timeout`) | `pending` (o `failed` al agotar `maxAttempts`) | Se conserva en cola con el mismo `operationId` para reintento seguro. |
| Error `500` / `429` / caída de red | `retryable` | `pending` → `failed` tras `maxAttempts` | Incrementa `attempts` y registra `lastError`; nunca se borra silenciosamente. |
| Respuesta `2xx` con JSON malformado | `retryable` (`contract`) | `pending` | No se asume éxito si el contrato remoto es inválido. |
| Conflicto de versión o reasignación (`409` / `403`) | `conflict` | `conflict` con `conflictFields` | Se conserva la intención local hasta decisión explícita. |
| Rechazo de validación (`422`) | `rejected` | `failed` | Queda registrada con `lastError` sin reintento en bucle. |

---

## 7. Trazabilidad con las pruebas automatizadas

| Regla verificada | Archivo de prueba | Comando reproducible |
|---|---|---|
| Conflicto público `work` e inmutabilidad + combinación independiente + deduplicación | `course-tests/public/week-08.test.ts` | `npx jest course-tests/public/week-08.test.ts --runInBand` |
| Comparación por JSON canónico, orden alfabético de conflictos, RBAC al encolar, referencia de foto pendiente, rebase, error 500/timeout y resolución explícita | `course-tests/sync-engine.test.ts` | `npx jest course-tests/sync-engine.test.ts --runInBand` |
| Integración real contra `course-backend`: reasignación remota vs. inicio offline, replay idempotente tras `timeout_after_commit` y retención ante HTTP 500 | `course-tests/sync-backend-integration.test.ts` | `npx jest course-tests/sync-backend-integration.test.ts --runInBand` |
