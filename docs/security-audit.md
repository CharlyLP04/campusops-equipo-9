# Auditoría de seguridad y privacidad — Semana 4

**Estudiante:** Carlos Olaya Gutiérrez  
**Proyecto:** CampusOps (React Native + Expo + TypeScript)  
**Modalidad:** Individual  
**Rama:** `week4/security-audit-carlos`  

---

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | **Impresión de tokens y datos sensibles en consola** | Los logs de depuración (Metro bundler, Flipper o consola del sistema) exponían tokens de sesión sintéticos (`Bearer course-valid-token`) y objetos de perfil en texto plano. | Se implementó la utilidad `SafeLogger` que analiza recursivamente las cargas útiles y enmascara claves confidenciales (`token`, `password`, `authHeader`, etc.) con `[REDACTED]`. | `docs/evidence/hallazgo-1-logs-sanitizados.png` |
| 2 | **Exposición de credenciales y URLs internas en mensajes de error** | Ante fallos de red en el cliente HTTP (`courseBackend.ts`), las excepciones arrojadas concatenaban la URL de conexión y parámetros que podían filtrar tokens o infraestructura a pantallas de usuario. | Se implementó e integró `SafeErrorHandler.executeSafely`, garantizando que cualquier fallo en llamadas a la API se capture y sanitice antes de presentarse al usuario. | `docs/evidence/hallazgo-2-errores-seguros.png` |
| 3 | **Variantes de archivos de entorno `.env` desprotegidas en `.gitignore`** | El archivo `.gitignore` inicial solo ignoraba `.env`, dejando desprotegidas variantes habituales como `.env.local`, `.env.production` o `.env.backup`, facilitando su subida involuntaria a Git. | Se añadieron reglas comodín en `.gitignore` (`.env*.local`, `.env.production`, `.env.development`, `*.env`) y se verificó que ningún `.env` sea rastreado por Git. | `docs/evidence/hallazgo-3-gitignore-env.png` |

---

## Hallazgo 1 — Impresión de tokens y datos sensibles en consola

### Problema encontrado
Durante las llamadas de autenticación y sincronización con el backend didáctico, se realizaba la impresión directa de objetos de sesión y respuestas de red mediante `console.log(sessionData)`. Dicho objeto contenía tokens de portador (`Bearer course-valid-token`), credenciales y datos de usuario sin ningún tipo de filtrado previo.

### Riesgo
Cualquier persona o herramienta con acceso a la consola de desarrollo (Metro bundler, logs de depuración de Android Studio, Flipper o volcados de logs del dispositivo) podía inspeccionar y extraer los tokens de autenticación en texto claro. Esto permite la suplantación de identidad (secuestro de sesión) y viola el principio de privacidad de los datos del usuario.

### Solución
Se creó e integró la utilidad `SafeLogger` en [`src/infrastructure/security/safe-logger.ts`](../src/infrastructure/security/safe-logger.ts). Esta utilidad inspecciona recursivamente cualquier objeto, arreglo o cadena antes de imprimirlo, reemplazando automáticamente cualquier clave sensible (`token`, `auth`, `password`, `secret`, `location`, `photos`) por la marca inmutable `[REDACTED]`, preservando únicamente campos técnicos seguros (`actorId`, `status`, `requestId`).

### Antes
```ts
// Código inseguro: imprime directamente el token y el perfil completo
const sessionData = {
  actorId: "technician-1",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic",
  authHeader: "Bearer course-valid-token-secret-123",
  password: "SuperSecretPassword123!"
};

console.log("Sesión iniciada:", sessionData);
// Salida en consola: imprime el token y password en texto claro
```

### Después
```ts
// Código corregido: SafeLogger analiza y enmascara los secretos
import { SafeLogger } from "../src/infrastructure/security/safe-logger";

SafeLogger.logInfo("Sesión iniciada", sessionData);
// Salida en consola: [INFO] Sesión iniciada { actorId: 'technician-1', token: '[REDACTED]', authHeader: '[REDACTED]', password: '[REDACTED]' }
```

### Evidencia
![Evidencia Hallazgo 1](evidence/hallazgo-1-logs-sanitizados.png)

---

## Hallazgo 2 — Exposición de credenciales y URLs internas en mensajes de error

### Problema encontrado
En el cliente de red [`src/api/courseBackend.ts`](../src/api/courseBackend.ts), cuando la verificación de salud del servicio (`getBackendHealth`) fallaba, se lanzaba una excepción nativa concatenando la URL completa y el código de estado sin control de contenido: `throw new Error(\`Backend health failed with \${response.status} at \${baseUrl}\`)`. Si la URL contenía tokens en parámetros de consulta (`?token=...`) o apuntaba a infraestructura privada, el error reflejaba dicha información.

### Riesgo
Al producirse un error de conexión, la excepción no sanitizada burbujeaba hacia la capa de presentación (UI) o telemetría, mostrando al usuario final o a logs externos la dirección IP interna, puertos y posibles tokens de acceso embebidos en la URL, facilitando vectores de ataque a la infraestructura.

### Solución
Se implementó `SafeErrorHandler` en [`src/infrastructure/security/safe-error-handler.ts`](../src/infrastructure/security/safe-error-handler.ts) y se envolvió la ejecución de `getBackendHealth` mediante `SafeErrorHandler.executeSafely`. Esta función intercepta la excepción, remueve patrones de Bearer tokens, passwords y query params confidenciales mediante expresiones regulares defensivas, y devuelve un mensaje controlado con prefijo `[Backend]`.

### Antes
```ts
// Código inseguro: expone detalles de red y parámetros en el error
export async function getBackendHealth(baseUrl = DEFAULT_URL): Promise<BackendHealth> {
  const response = await fetch(`${baseUrl}/health?token=super-secret-token-999`);
  if (!response.ok) {
    throw new Error(`Backend health failed with ${response.status} at ${baseUrl}?token=super-secret-token-999`);
  }
  return response.json();
}
```

### Después
```ts
// Código corregido: SafeErrorHandler captura el fallo y sanitiza el mensaje
export async function getBackendHealth(baseUrl = DEFAULT_URL): Promise<BackendHealth> {
  return SafeErrorHandler.executeSafely(async () => {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Backend health failed with ${response.status}`);
    }
    const payload = await response.json();
    SafeLogger.logInfo('Backend health check exitoso', { status: 'available' });
    return payload as BackendHealth;
  }, 'Backend');
}
```

### Evidencia
![Evidencia Hallazgo 2](evidence/hallazgo-2-errores-seguros.png)

---

## Hallazgo 3 — Variantes de archivos de entorno `.env` desprotegidas en `.gitignore`

### Problema encontrado
El archivo [`.gitignore`](../.gitignore) del proyecto contenía únicamente la línea `.env`. Sin embargo, en flujos de desarrollo con Expo y React Native es muy común generar variantes locales como `.env.local`, `.env.development`, `.env.production` o copias de respaldo `.env.backup`. Ninguna de estas extensiones estaba contemplada, por lo que Git las consideraba archivos no rastreados listos para subir.

### Riesgo
Al ejecutar comandos comunes como `git add .` o `git commit -a`, cualquier archivo de variables locales creado por el desarrollador con credenciales sintéticas de laboratorio o API keys privadas habría sido enviado accidentalmente al repositorio público de GitHub, provocando una fuga irrevocable en el historial de Git.

### Solución
Se modificó [`.gitignore`](../.gitignore) agregando reglas exhaustivas con comodines:
```gitignore
# Environment files
.env
.env*.local
.env.production
.env.development
.env.backup
*.env
```
Asimismo, se verificó la existencia del archivo de plantilla [`.env.example`](../.env.example) que únicamente documenta los nombres de las variables requeridas (`EXPO_PUBLIC_COURSE_BACKEND_URL`) con valores por defecto seguros y sin credenciales reales.

### Antes
```gitignore
# Fragmento anterior de .gitignore:
dist/
.env
*.jks
```

### Después
```gitignore
# Fragmento corregido de .gitignore:
dist/
# Environment files
.env
.env*.local
.env.production
.env.development
.env.backup
*.env
*.keystore
```

### Evidencia
![Evidencia Hallazgo 3](evidence/hallazgo-3-gitignore-env.png)

---

## Verificación de Integridad y Ausencia de Secretos

Para garantizar que ningún secreto o credencial real se haya introducido durante esta auditoría:
1. Se ejecutó la suite de pruebas unitarias de auditoría:
   ```bash
   npx jest course-tests/security-audit.test.ts --ci --runInBand
   ```
   **Resultado:** 5 pruebas aprobadas al 100% (sanitización de objetos, enmascaramiento en consola, sanitización de excepciones de red y manejo de fallos).
2. Se ejecutó `npm run typecheck` y `npm run lint` obteniendo código limpio sin errores de tipos ni advertencias de estilo.
3. Se verificó con `git status` que ningún archivo `.env` o credencial privada figure en el árbol de trabajo de Git.
