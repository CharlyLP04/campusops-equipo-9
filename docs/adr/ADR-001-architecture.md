# ADR-001 — Arquitectura en capas para CampusOps (React Native + Expo + TypeScript)

**Estado:** Aceptado  
**Fecha:** 2026-09-08  
**Autores:** Equipo 9 — Carlos Olaya Gutiérrez, et al.  
**Revisión:** Semana 02

---

## Contexto

CampusOps es una aplicación móvil para la gestión de incidencias en campus universitarios.
El sistema debe manejar pantallas, reglas de negocio de incidencias, sesión de usuario,
almacenamiento local y proveedores de ubicación. Se requiere que el código sea testeable,
mantenible y que permita reemplazar proveedores (backend, base de datos, ubicación)
sin reescribir la lógica de negocio.

El stack ya está definido: **React Native + Expo + TypeScript** (Node.js ≥ 22).  
No se pueden instalar paquetes externos más allá de los ya declarados.

---

## Alternativas evaluadas

### Alternativa 1 — Arquitectura en capas (UI → Application → Domain ← Infrastructure)

Separación explícita en cuatro capas con dependencias unidireccionales:

- **UI**: componentes React Native; recibe casos de uso por inyección de dependencias.
- **Application**: casos de uso orquestadores (e.g., `GetIncidentsUseCase`).
- **Domain**: entidades (`Incident`) y puertos abstractos (`IncidentRepository`).
- **Infrastructure**: adaptadores concretos (repositorio en memoria, llamadas al backend).

La regla central es: **UI no importa Infrastructure**. La UI depende de Application;
Application depende del puerto del Domain; Infrastructure implementa ese puerto.

**Ventajas:**
- Cada capa es testeable de forma aislada (mockear el puerto es trivial).
- Cambiar el proveedor de persistencia (memoria → SQLite → API) no toca la UI ni los casos de uso.
- Los límites son verificables automáticamente (inspección de imports).

**Desventajas:**
- Más archivos y carpetas iniciales.
- Requiere disciplina para no cruzar límites (puede olvidarse en equipos grandes).

---

### Alternativa 2 — Arquitectura plana con hooks de React (todo en la UI)

Un único directorio con componentes, hooks de datos (`useFetch`, `useIncidents`) y
llamadas directas al backend o almacenamiento local dentro de los hooks.

**Ventajas:**
- Menos archivos; más sencillo de entender para desarrolladores nuevos en React.
- Velocidad inicial de desarrollo mayor.

**Desventajas:**
- La lógica de negocio queda acoplada a React; difícil de probar con Jest puro.
- Cambiar el proveedor de datos obliga a modificar los hooks y los tests de UI.
- Escala mal: con más features, los hooks se vuelven clases disfrazadas.

---

## Decisión

Se adopta la **Alternativa 1 — Arquitectura en capas**.

La facilidad de prueba es la prioridad principal del proyecto académico; las pruebas
públicas verifican automáticamente los límites de capas. La Alternativa 1 permite:

1. Probar los casos de uso con un repositorio en memoria (sin montar la app).
2. Probar los componentes UI con un caso de uso fake (sin repositorio real).
3. Verificar los límites de imports sin ejecutar la aplicación.

El coste de la complejidad estructural es asumible dado el tamaño del equipo (3 personas)
y la duración del proyecto (semestre académico).

---

## Consecuencias y trade-offs

### Consecuencias positivas

- Los casos de uso son clases TypeScript puras; se prueban sin emulador ni metro bundler.
- Añadir un nuevo proveedor (Firebase, SQLite) solo requiere crear una clase nueva en
  `src/infrastructure/` que implemente el puerto del dominio.
- El límite `UI → Application → Domain ← Infrastructure` es verificable con grep/AST.

### Trade-offs y consecuencias negativas

- **Boilerplate inicial:** Por cada feature se crean al menos tres archivos
  (entidad, puerto, caso de uso) antes de tocar la UI.
- **Disciplina de equipo:** Sin linting de imports, un desarrollador podría importar
  directamente desde `infrastructure` en la UI (violación de límites); se mitiga con
  la prueba AC-03 de la semana 02.
- **Sin ORM ni DI container:** La inyección de dependencias se hace manualmente en el
  composition root (`App.tsx`), lo que funciona bien a escala actual pero podría
  requerir un contenedor (Awilix, InversifyJS) si el número de servicios crece
  significativamente.

---

## Referencias

- Documentación de alcance: `docs/CAMPUSOPS.md`
- Diagrama de componentes: `docs/architecture.mmd`
- Prueba de límites: `course-tests/public/week-02.test.ts`
- Evidencia de ingeniería: `evidence/week-02/engineering.json`
