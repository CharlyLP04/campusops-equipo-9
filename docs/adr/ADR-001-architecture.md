# ADR-001: Arquitectura interna basada en Puertos y Adaptadores

## Estado

Aceptado

## Contexto

CampusOps es una aplicación móvil para gestionar, atender y cerrar incidencias dentro de un campus universitario. La aplicación contempla tres perfiles: Reportante, Técnico y Coordinador.

Las incidencias siguen cinco estados definidos:

- `open`: abierta.
- `assigned`: asignada.
- `in_progress`: en proceso.
- `resolved`: resuelta por el técnico.
- `closed`: cerrada por coordinación.

El stack base utiliza React Native, Expo y TypeScript. En semanas posteriores, CampusOps incorporará persistencia local, funcionamiento sin conexión, sincronización y resolución de conflictos.

El problema arquitectónico consiste en evitar que las pantallas dependan directamente de mecanismos concretos como HTTP, almacenamiento local, SQLite o SDK de Expo. Si estas dependencias se mezclan con la interfaz, cambiar la fuente de datos obligaría a modificar pantallas y reglas de negocio.

## Alternativas consideradas

### Alternativa A: UI con servicios directos

Las pantallas de React Native consumirían directamente servicios que combinan las llamadas de red y el acceso al almacenamiento.

Ventajas:

- Requiere pocos archivos.
- Permite desarrollar rápidamente las primeras pantallas.
- Presenta un flujo sencillo al inicio.

Desventajas:

- Produce mayor acoplamiento entre la UI y la infraestructura.
- Complica las pruebas sin emulador.
- Cambiar la fuente de datos puede afectar pantallas y servicios.
- Favorece la mezcla de presentación, negocio y persistencia.

### Alternativa B: Puertos y Adaptadores con Capas Limpias

El proyecto se divide en cuatro capas:

1. **Domain:** contiene entidades, reglas de negocio y contratos de repositorio escritos en TypeScript puro.
2. **Application:** contiene casos de uso que coordinan las operaciones del dominio.
3. **Infrastructure:** contiene adaptadores concretos para memoria, almacenamiento local, SQLite o servicios remotos.
4. **UI:** contiene pantallas y componentes de React Native que consumen casos de uso.

Las dependencias se dirigen hacia las abstracciones del dominio:

`UI → Application → Domain ← Infrastructure`

La UI no puede importar directamente la infraestructura.

Ventajas:

- Facilita las pruebas unitarias con Jest sin levantar un emulador.
- Permite sustituir una fuente de datos mediante otro adaptador.
- Separa la interfaz, las reglas de negocio y la persistencia.
- Reduce el impacto de los cambios futuros.

Desventajas:

- Requiere más archivos y carpetas.
- Necesita contratos e interfaces explícitas.
- Introduce mayor complejidad durante el inicio.
- El equipo debe respetar las fronteras entre capas.

## Comparación de trade-offs

| Criterio | UI con servicios directos | Puertos y Adaptadores |
|---|---|---|
| Testabilidad | Baja, porque las pruebas pueden depender de React Native, almacenamiento o red. | Alta, porque los casos de uso pueden probarse con repositorios en memoria. |
| Complejidad inicial | Baja, porque requiere menos archivos y abstracciones. | Media-alta, porque necesita capas, contratos e inyección de dependencias. |
| Costo de cambiar la fuente de datos | Alto, porque el cambio puede afectar servicios y pantallas. | Menor, porque se puede crear otro adaptador que cumpla el mismo contrato. |

## Decisión

Se elige la alternativa de Puertos y Adaptadores con Capas Limpias.

La razón principal es que CampusOps evolucionará hacia almacenamiento local, funcionamiento sin conexión y sincronización. Utilizar contratos permite comenzar con un repositorio determinista en memoria y posteriormente incorporar otro adaptador sin reescribir la interfaz ni las reglas del dominio.

## Consecuencias

### Consecuencias positivas

- La UI no conocerá directamente la persistencia.
- Los casos de uso podrán probarse sin emulador.
- Los datos sintéticos podrán suministrarse mediante un repositorio en memoria.
- La incorporación posterior de persistencia local tendrá un impacto limitado.
- Las responsabilidades estarán separadas de forma explícita.

### Consecuencias negativas

- Aumentará el número inicial de archivos.
- El equipo deberá crear interfaces y adaptadores.
- Será necesario aplicar inyección de dependencias.
- Los integrantes deberán respetar las reglas de importación.

## Verificación

La decisión se comprobará mediante:

- Un repositorio en memoria con datos sintéticos deterministas.
- Casos de uso que dependan de `IncidentRepository` y no de una implementación concreta.
- Pantallas que no importen archivos de `src/infrastructure/`.
- La prueba pública `course-tests/public/week-02.test.ts`.
- La ejecución de `npm run typecheck` y las comprobaciones de Semana 2.
