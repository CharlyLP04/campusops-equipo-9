# Política de Resiliencia, Ubicación Manual y Reintentos (Semana 9)

Este documento describe cómo **CampusOps** integra el servicio de geocodificación con caché, garantiza una alternativa de captura manual cuando el proveedor falla, acota los reintentos con espera progresiva y `Retry-After`, y evita duplicar efectos cuando se pierde una respuesta tras guardar (`timeout_after_commit`).

---

## 1. Servicio de ubicación, proveedor y restricciones

### 1.1 Proveedor y adaptador HTTP
- **Endpoint del contrato y doble controlado:** `GET /v1/geocoding?q=<consulta>` expuesto por el backend didáctico (`course-backend/server.mjs` y `course-backend/campusops.mjs`).
- **Integración desde la aplicación:** El adaptador `src/infrastructure/location/cached-geocoding.service.ts` realiza la consulta al endpoint y obtiene las credenciales mediante el proveedor de credenciales de sesión. Envía el encabezado `Authorization: Bearer` y el identificador de actor `X-Course-Actor`. El encabezado `X-Course-Scenario` se utiliza cuando se configura un escenario controlado de prueba.
- **Tiempo límite:** La consulta tiene un timeout predeterminado de `3000 ms`, configurable mediante `timeoutMs`. Si se supera, la solicitud se aborta y se informa el fallo para aplicar la alternativa correspondiente.
- **Formato esperado de respuesta válida:** `{ label: string, latitude: number, longitude: number }` con etiqueta no vacía y coordenadas numéricas finitas dentro de `latitude ∈ [-90, 90]` y `longitude ∈ [-180, 180]`.
- **Restricciones operativas y de privacidad:**
  - En producción y en el entorno del curso no se incrustan llaves privadas ni tokens facturables en el cliente (`EXPO_PUBLIC_*`).
  - Las consultas externas están sujetas a límites de tasa (`429 Too Many Requests` con encabezado `Retry-After`), latencia variable (`slow` / `timeout`), errores `500` y respuestas malformadas o incompletas (`incomplete`, `invalid_coordinates`).
  - Las coordenadas (`latitude`, `longitude`) y la ubicación textual (`location`) se consideran datos sensibles en telemetría y siempre pasan por `redactForTelemetry` (`[REDACTED]`).

### 1.2 Caché de geocodificación
- **Propósito:** Reducir llamadas repetidas al proveedor externo, respetar cuotas y responder de inmediato ante consultas de edificios o zonas ya resueltas en el campus.
- **Clave normalizada:** `query.trim().toLowerCase().replace(/\s+/g, ' ')`. Esto permite reutilizar una misma entrada aunque la consulta contenga diferencias de mayúsculas o espacios repetidos.
- **Estructura y vigencia (TTL):** Cada entrada almacena `{ label, latitude, longitude, cachedAt, expiresAt }`. El TTL predeterminado es de **5 minutos (`300000 ms`)**, configurable mediante `cacheTtlMs`. Una entrada vencida no debe utilizarse y debe consultarse nuevamente al proveedor.
- **Criterio de almacenamiento:** Sólo se almacenan respuestas válidas del proveedor que superaron la validación de `selectIncidentLocation` (`source === 'provider'`). Las respuestas de error, incompletas o manuales nunca contaminan el caché.

---

## 2. Alternativa manual (`selectIncidentLocation`)

Implementada en `src/domain/location/select-incident-location.ts` y expuesta en `src/course-evaluation/index.ts`.

| Caso recibido del proveedor | Resultado de `selectIncidentLocation(provider, manualLabel)` | ¿Inventa coordenadas? |
|---|---|---|
| `{ label: 'Zona de prueba', latitude: 0, longitude: 0 }` | `{ source: 'provider', label: 'Zona de prueba', latitude: 0, longitude: 0 }` | No (usa las del proveedor validado) |
| `null` o `undefined` (timeout, desconexión o caída capturada en adaptador HTTP) | `{ source: 'manual', label: manualLabel }` | **Nunca** (`latitude` y `longitude` omitidos) |
| Error representado como dato (`{ status: 429 }`, `{ code: 'rate_limited' }`) | `{ source: 'manual', label: manualLabel }` | **Nunca** |
| Datos incompletos (`{ label: 'Incompleta' }`) | `{ source: 'manual', label: manualLabel }` | **Nunca** |
| Coordenadas fuera de rango o no finitas (`latitude: 91`, `latitude: 999`, `longitude: null`, `NaN`) | `{ source: 'manual', label: manualLabel }` | **Nunca** |

Cuando el proveedor falla o tarda demasiado, el usuario en **CampusOps** puede escribir o conservar manualmente el edificio, laboratorio, zona o referencia (por ejemplo, `"Edificio manual"` o `"Edificio Central"`), manteniendo operativo el registro y la atención de incidencias.
Si el usuario no proporciona una referencia manual válida, la función utiliza la etiqueta genérica `Ubicación manual`. En ningún caso se calculan, generan o asignan coordenadas para completar una ubicación manual.

---

## 3. Política de reintentos acotados (`planRetry`)

Implementada en `src/domain/resilience/plan-retry.ts`, integrada en `src/application/resilience/resilient-operation-runner.ts` y expuesta en `src/course-evaluation/index.ts`.

### 3.1 Reglas de decisión

1. **Identidad estable obligatoria para `POST`:**
   - Si `method === 'POST'` y `idempotencyKey` no existe o tiene menos de 8 caracteres útiles, `planRetry` devuelve:
     ```json
     { "retry": false, "delayMs": 0, "requiresStableIdempotencyKey": true }
     ```
   - Esto impide repetir mutaciones (`create`, `start`, `resolve`, `close`, `comment`, `add_evidence`) que podrían duplicar registros en el servidor.
2. **Límite estricto de intentos (`stopAtAttempt = 4`):**
   - Sólo los intentos `1`, `2` y `3` pueden programar un reintento.
   - Desde el **intento 4** (`attempt >= 4`), `planRetry` devuelve siempre `{ retry: false, delayMs: 0, requiresStableIdempotencyKey: false }`. No existen bucles infinitos.
3. **Clasificación de estado HTTP / red:**
   - **Reintentables:** `'timeout'`, `408`, `429`, `500`, `502`, `503`, `504`.
   - **No reintentables (fallo inmediato o conflicto):** `400`, `401`, `403`, `404`, `409`, `422`.
4. **Cálculo de espera (`delayMs`) finito y respeto a `Retry-After`:**
   - Si el servidor indica `retryAfterMs > 0` (o encabezado HTTP `Retry-After`), se respeta ese valor acotado a `maxDelayMs` (`10000 ms`).
   - En ausencia de `Retry-After`, se aplica backoff exponencial progresivo:
     - Intento 1 → `200 ms`
     - Intento 2 → `400 ms`
     - Intento 3 → `800 ms`
     - Intento 4 → `0 ms` (`retry: false`)

---

## 4. Manejo de respuesta perdida tras guardar (`timeout_after_commit`)

### 4.1 Escenario reproducido
1. El técnico o coordinador ejecuta una transición de resolución o cierre (`POST /v1/incidents/campus-inc-001/actions` con `action: 'resolve'` o `'close'`) incluyendo una clave estable `Idempotency-Key: resolve-campus-inc-001-op-1`.
2. Bajo el escenario `timeout_after_commit`, el servidor **aplica el cambio** (incrementa `version`, cambia `status` a `resolved` y agrega el evento a `history`) y guarda la huella en su tabla de idempotencia (`operations`), pero retrasa la respuesta `1500 ms`.
3. El cliente corta la espera por su propio `AbortController` (`timeout`), recibiendo una falla de transporte sin saber si el servidor guardó o no el cambio.
4. `planRetry({ method: 'POST', status: 'timeout', attempt: 1, idempotencyKey: 'resolve-campus-inc-001-op-1' })` autoriza el reintento (`retry: true`, `delayMs: 200`, `requiresStableIdempotencyKey: false`).
5. En el intento 2, `HttpSyncRemote` reenvía **exactamente el mismo payload y el mismo `Idempotency-Key`**.
6. El servidor detecta la clave previa con el mismo fingerprint canónico y responde `200 OK` con `{ duplicate: true, incident: ... }` sin volver a ejecutar la transición ni duplicar entradas en `history`, `notes` ni `evidence`.

### 4.2 Cuándo reintentar, cuándo usar la alternativa y cuándo informar fallo
- **Reintentar automáticamente:** Sólo ante fallos transitorios (`timeout`, `429`, `5xx`) mientras `attempt < 4` y, si es `POST`, únicamente con `Idempotency-Key` estable.
- **Usar la alternativa (fallback):** En geocodificación (`GET /v1/geocoding`), las respuestas incompletas, malformadas o con coordenadas inválidas pasan a la alternativa manual sin reintentos. Ante fallos transitorios como `429`, `500`, `5xx` o `timeout`, el caso de uso aplica reintentos acotados mediante `planRetry`, respeta `Retry-After` cuando está disponible y utiliza la alternativa manual cuando se agotan los intentos o el proveedor continúa sin estar disponible. La ubicación manual conserva únicamente la etiqueta escrita por el usuario, sin inventar coordenadas.
- **Informar fallo o conflicto sin reintentar ciegamente:**
  - Cuando se alcanza el intento 4 sin éxito (`max_retries_exceeded`), la operación permanece resguardada en la cola local o informa el error en la UI para reintento manual posterior.
  - Cuando el servidor responde `409 Conflict`, `403 Forbidden` o `422 Unprocessable Entity`, se detienen los reintentos de inmediato y se delega a la política de conflictos de Semana 8.
