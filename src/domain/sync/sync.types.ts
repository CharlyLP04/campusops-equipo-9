/**
 * Tipos de dominio para sincronización offline de CampusOps (semana 8).
 *
 * Un `SyncSnapshot` describe el estado de una incidencia en una versión
 * concreta. Los campos se comparan por contenido JSON, nunca por identidad
 * de objeto. En CampusOps el campo `work` agrupa `assignedTechnicianId` y
 * `status`, porque una reasignación remota y un inicio de atención local
 * afectan la misma decisión operativa.
 */
export type SyncFields = Readonly<Record<string, unknown>>;

export type SyncSnapshot = Readonly<{
  id: string;
  version: number;
  fields: SyncFields;
}>;

export type SyncResolution =
  | Readonly<{ kind: 'merged'; fields: SyncFields }>
  | Readonly<{ kind: 'conflict'; fields: readonly string[] }>;

export type IncidentWorkFields = Readonly<{
  assignedTechnicianId: string | null;
  status: string;
}>;
