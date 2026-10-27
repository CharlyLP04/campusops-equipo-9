# Modelo de datos local — Semana 8

## Alcance y almacenamiento

CampusOps separa la identidad de sesión de las operaciones offline:

- **SecureStore:** el documento de sesión `campusops.auth.session.v1`, con
  tokens de sesión y la identidad autenticada. Este almacenamiento no contiene
  operaciones pendientes.
- **SQLite:** `campusops-offline-queue.db`, mediante `SqliteOfflineQueue`.
  Contiene exclusivamente cambios offline de incidencias que todavía no han
  sido confirmados por el servidor.
- **Backend:** sigue siendo la fuente de verdad de incidencias. La app conserva
  una versión remota conocida en `Incident.version` cuando el DTO la provee;
  sin ella no se prepara una operación offline.

## Entidades y relaciones

`PendingOperation` representa la intención de un actor sobre una incidencia:

- `operationId` identifica una única intención y se usa sin cambios como
  `Idempotency-Key` al sincronizar.
- `incidentId` relaciona la operación con la incidencia remota.
- `authorId` conserva el actor autenticado que creó la intención.
- `baseVersion` y `baseFields` describen el estado remoto conocido al crearla.
- `localFields` conserva el efecto local pretendido incluso ante conflicto.

Una incidencia puede tener cero o muchas operaciones pendientes. La cola no
guarda una copia completa de incidencias ni sustituye la persistencia de
incidencias que se integrará posteriormente.

## Esquema SQLite implementado

La versión de esquema de esta cola es **1**. La base crea la tabla siguiente de
forma idempotente:

```sql
CREATE TABLE pending_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  incident_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  base_fields_json TEXT NOT NULL,
  local_fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  conflict_fields_json TEXT
);
CREATE INDEX pending_operations_created_at_idx
  ON pending_operations(created_at, operation_id);
```

`operation_id` es la clave primaria: `INSERT OR IGNORE` conserva siempre la
primera operación cuando se intenta encolar el mismo identificador. Las lecturas
ordenan por `created_at ASC, operation_id ASC`, por lo que dos operaciones con
la misma fecha conservan orden determinista.

## Serialización y recuperación

`payload`, `baseFields` y `localFields` se serializan como JSON en sus columnas
`*_json`; `conflictFields` se guarda como arreglo JSON cuando existe. Al leer,
el adaptador valida que los campos sean objetos JSON, que acción/estado estén en
el conjunto del dominio y que versiones e intentos sean enteros no negativos.
Un dato serializado corrupto provoca error de lectura: nunca se presenta como
una operación recuperada correctamente.

La fecha `createdAt` y `operationId` se guardan como texto sin regenerarse. Al
reiniciar, otra instancia abre el mismo archivo y recupera el contenido de la
misma operación, incluidos estado, intentos, error y campos de conflicto.

## Operaciones atómicas y conservación

`enqueue`, `replace` y `remove` se serializan por instancia y se ejecutan en
`withExclusiveTransactionAsync` de Expo SQLite. `replace` falla si la operación
no existe, para no informar un cambio inexistente. `remove` sólo se invoca por
la confirmación del servidor desde `SyncService` o por una decisión explícita de
resolución de conflicto.

Los estados `pending`, `conflict` y `failed` permanecen en la tabla. Un timeout,
rechazo o conflicto no borra la intención local. La sincronización únicamente
retira registros confirmados y conserva el mismo `operationId` para reintentos.

Las notas y referencias de fotografías pendientes permanecen en `payload_json`.
Una referencia de fotografía es sólo un identificador local de recurso pendiente:
no representa una carga ni una confirmación del servidor.

## Coordinación con la migración de Pacheco

Este cambio no crea ni modifica `src/infrastructure/storage/migrations/`, no
implementa v1 → v2 ni rollback. Pacheco deberá consumir el contrato real de la
tabla `pending_operations` y sus columnas anteriores si la migración necesita
conservar operaciones. Hasta que exista ese módulo verificable, no se declara
una migración ni una recuperación de rollback implementada.


## Migración y recuperación del esquema v1 a v2

La migración de CampusOps se implementa en
`src/infrastructure/storage/migrations/schema-migration.ts`. La versión se
consulta mediante `PRAGMA user_version` y sólo se admite la transición explícita
de la versión 1 a la versión 2.

La versión 2 agrega a la tabla `incidents` la columna obligatoria
`sync_state`, cuyos valores permitidos son `synced`, `pending` y `conflict`.
Las incidencias relacionadas con registros existentes en
`pending_operations` se inicializan como `pending`; las demás se consideran
`synced`. La tabla de operaciones no se reconstruye, por lo que conserva el
mismo `operation_id`, contenido serializado, versión base, intentos y estado.

Toda la transición se ejecuta dentro de una sola transacción iniciada con
`BEGIN IMMEDIATE TRANSACTION`. Los pasos son:

1. Agregar `sync_state` con un valor predeterminado seguro.
2. Marcar como pendientes las incidencias que tengan operaciones en la cola.
3. Actualizar `PRAGMA user_version` a 2.
4. Confirmar todos los cambios mediante `COMMIT`.

El migrador permite inyectar una falla determinista con `failAfterStep`. Si
cualquier paso falla, ejecuta `ROLLBACK`: la versión continúa en 1, no aparece
la nueva columna y se conservan sin cambios tanto las incidencias como las
operaciones pendientes. Posteriormente se puede repetir la migración completa.
Si la base ya está en la versión 2, la ejecución es idempotente y no modifica ni
duplica información.

La prueba `course-tests/schema-migration.test.ts` registra los tres estados
requeridos: antes de migrar, después de una falla controlada en el paso 2 y
después de recuperar correctamente. También comprueba que una segunda
ejecución sobre v2 no altera los datos.