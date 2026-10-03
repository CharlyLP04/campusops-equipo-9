# Contrato de API y Gobernanza de Cliente Cloud — CampusOps (Semana 05)

## 1. Visión General y Principio de Frontera

Este documento establece el contrato técnico de integración entre la aplicación móvil **CampusOps** (React Native, Expo, TypeScript) y el servicio de backend didáctico.

Siguiendo el principio de **Arquitectura Limpia / Puertos y Adaptadores (Hexagonal)**, la aplicación móvil adopta una política de **cero confianza** sobre las respuestas de red:
- **Ninguna pantalla ni componente de UI realiza llamadas HTTP directamente.**
- Los datos remotos que viajan por el transporte de red (**DTOs remotos**) son estrictamente validados en la frontera de entrada mediante `parseRemoteResource`.
- Solo los objetos que cumplen el contrato son transformados en **Entidades de Dominio** (`Incident`) y entregados a los Casos de Uso y la UI.
- Si un payload remoto está malformado, es rechazado inmediatamente en el adaptador y transformado en un **error de dominio tipado y controlado**, previniendo fallos inesperados (*crashes*) o corrupción de estado en la interfaz.

---

## 2. Convenciones de Transporte y Encabezados HTTP

### 2.1 Base URL y Entorno Didáctico
El backend de pruebas se ejecuta de forma local y controlada sin depender de servicios en la nube pública:
- URL Base local: `http://localhost:3000` (o `http://10.0.2.2:3000` en emuladores Android).
- Comando de ejecución: `make run-backend`.

### 2.2 Encabezados Obligatorios
Toda solicitud realizada por el cliente HTTP debe incluir:
1. `Authorization`: Token de portador sintético de prueba.
   - Valor: `Bearer course-valid-token`
2. `X-Course-Actor`: Rol que ejecuta la acción, gobernando la visibilidad de datos:
   - `reporter-1`: Reportante de incidencias.
   - `technician-1`: Técnico asignado.
   - `coordinator-1`: Coordinador con permisos globales.
3. `Idempotency-Key` (solo en operaciones de mutación `POST` / `PUT`):
   - Valor: Identificador único UUID v4 que garantiza que reintentos de red no dupliquen la creación o cambio de estado.

### 2.3 Encabezado de Control de Escenarios (`X-Course-Scenario`)
Para garantizar pruebas reproducibles y deterministas sin conexión a internet externa:
- `success`: Simula respuesta exitosa con payload normal.
- `nullable`: Simula respuesta con `payload: null` válido según contrato.
- `malformed`: Simula respuesta rota/incompleta para comprobar el rechazo seguro.
- `slow`: Introduce latencia artificial para verificar la política de timeout y aborto.
- `server_error`: Simula fallo interno HTTP 500 para evaluar la degradación controlada.

---

## 3. Endpoints Mínimos del Contrato

### 3.1 Consulta de Lista de Incidencias
* **Método / Ruta:** `GET /v1/incidents`
* **Propósito:** Retorna la lista de incidencias visibles para el actor autenticado.
* **Respuesta Exitosa (200 OK):**
```json
{
  "items": [
    {
      "id": "campus-inc-001",
      "version": 1,
      "status": "open",
      "payload": {
        "title": "Fuga de agua en edificio B",
        "category": "plumbing",
        "description": "Fuga constante en baños de planta baja",
        "createdAt": "2026-10-01T10:00:00Z"
      }
    }
  ]
}
```

### 3.2 Consulta de Detalle de Incidencia
* **Método / Ruta:** `GET /v1/incidents/:id`
* **Propósito:** Retorna la información completa de una incidencia particular.
* **Respuesta Exitosa (200 OK):**
```json
{
  "id": "campus-inc-001",
  "version": 2,
  "status": "assigned",
  "payload": {
    "title": "Fuga de agua en edificio B",
    "category": "plumbing",
    "description": "Fuga constante en baños de planta baja",
    "assignedTechnician": "technician-1",
    "updatedAt": "2026-10-01T11:30:00Z"
  }
}
```
* **Respuesta Nullable Válida (200 OK con payload nulo):**
```json
{
  "id": "campus-inc-002",
  "version": 3,
  "status": "closed",
  "payload": null
}
```

### 3.3 Creación de Incidencia
* **Método / Ruta:** `POST /v1/incidents`
* **Encabezados adicionales:** `Idempotency-Key: <UUID>`
* **Cuerpo de Solicitud (Request Body):**
```json
{
  "title": "Luminaria fundida",
  "category": "electrical",
  "description": "Lámpara parpadea en pasillo norte",
  "location": "Edificio C, Nivel 2"
}
```
* **Respuesta Exitosa (201 Created):**
```json
{
  "id": "campus-inc-105",
  "version": 0,
  "status": "open",
  "payload": {
    "title": "Luminaria fundida",
    "category": "electrical",
    "description": "Lámpara parpadea en pasillo norte",
    "createdAt": "2026-10-03T16:00:00Z"
  }
}
```

---

## 4. Especificación del Sobre Remoto y Validación con `parseRemoteResource`

El contrato publicado exige que todo recurso individual entregado por el backend cumpla con la estructura de un **sobre remoto**:

```typescript
export type RemoteEnvelope = {
  id: string;
  version: number;
  status: string;
  payload: Record<string, unknown> | null;
  [key: string]: unknown; // Campos adicionales permitidos para compatibilidad hacia adelante
};
```

### 4.1 Reglas de Validación Estricta
La función guardiana `parseRemoteResource(input: unknown): ParseResult` aplica las siguientes comprobaciones defensivas:
1. **Validación de Tipo Raíz:** La entrada debe ser un objeto JavaScript no nulo y no debe ser un arreglo (`Array.isArray(input) === false`).
2. **Identificador (`id`):** Debe ser una cadena de texto no vacía (`typeof id === 'string' && id.trim().length > 0`).
3. **Versión de Concurrencia (`version`):** Debe ser un número entero mayor o igual a 0 (`typeof version === 'number' && Number.isInteger(version) && version >= 0`).
4. **Estado del Ciclo de Vida (`status`):** Debe ser una cadena de texto no vacía (`typeof status === 'string' && status.trim().length > 0`).
5. **Contenido de Datos (`payload`):**
   - Se permite un valor estrictamente `null` (ausencia legítima de datos).
   - Si no es `null`, debe ser un objeto plano no arreglo (`typeof payload === 'object' && !Array.isArray(payload)`).
6. **Compatibilidad hacia Adelante (Forward-Compatibility):** Campos no contemplados en el contrato actual (ej. `metadata`, `serverTimestamp`, `experimentalFlag`) son tolerados y descartados, impidiendo que cambios menores en el servidor rompan clientes existentes.

### 4.2 Semántica del `null` Válido
> **Regla de integridad:** Un `payload: null` válido indica que el recurso no contiene metadatos complementarios en su estado actual. **Está estrictamente prohibido que el cliente invente datos o rellene atributos con suposiciones.** El adaptador debe mapear esta ausencia de forma explícita al dominio como `payload: null` o entidad con atributos opcionales no definidos.

---

## 5. Representación y Modelado de Errores Tipados

Para evitar el uso de excepciones no controladas o mensajes genéricos en la interfaz, el cliente implementa una jerarquía de errores tipados:

| Clase de Error | Condición Disparadora | Comportamiento del Cliente |
|---|---|---|
| `ContractValidationError` | La respuesta HTTP es 200 pero el sobre no cumple el contrato (`parseRemoteResource` devuelve `{ ok: false }`). | Se rechaza el recurso; se registra advertencia de telemetría y se notifica al usuario que el formato recibido es incompatible. |
| `CloudTimeoutError` | La petición excede el tiempo límite fijado (ej. 5000 ms) sin recibir respuesta. | Se cancela la conexión mediante `AbortController`; se presenta estado reintentable al usuario. |
| `CloudServerError` | El servidor responde con códigos HTTP 500, 502, 503 o 504. | Se preserva la estabilidad de la app, mostrando un estado de servicio no disponible sin crashear. |
| `CloudNetworkError` | Fallo físico de conexión, pérdida de señal o resolución DNS fallida. | La app activa la ruta de fallback local/offline sin emitir logs no sanitizados. |
| `CloudNotFoundError` | El servidor responde con código HTTP 404 ante un ID inexistente. | La interfaz transiciona al estado visual de recurso no encontrado. |

---

## 6. Privacidad y Sanitización de Errores

En estricto cumplimiento de los controles de seguridad y privacidad:
- Ningún mensaje de error, reporte o registro de telemetría debe incluir datos sensibles de usuario (nombres, correos, tokens de sesión o contraseñas).
- Todo payload transmitido a herramientas de registro pasa antes por `redactForTelemetry`.
- Los errores técnicos se identifican mediante códigos o identificadores seguros (`error: 'contract'`, `status: 500`), nunca exponiendo trazas internas del servidor ni cadenas crudas de excepción.
