/**
 * 创意动画 (Lemo) and 模板动画 (Remotion templates) are separate products that share one storage
 * type (`editorial-collage`) so every existing project keeps opening and resuming. The route is a
 * fact of the project's persisted production settings, fixed at creation:
 *  - authoring.mode 'ai-code' (or its legacy alias 'existing-assets') → 创意动画
 *  - authoring.mode 'template'                                       → 模板动画
 *  - no authoring / no production settings at all                    → 模板动画
 *    (pre-Lemo Vox projects: deterministic layers + Remotion shots, never a Lemo film)
 * Music MV projects are a separate category and always Lemo.
 * New projects get their route written at creation (`productionRoute` on the create input).
 */
export type EditorialProductionRoute = 'lemo' | 'template';
export const TEMPLATE_ANIMATION_CATEGORY = 'template-animation';
const LEMO_MODES = ['ai-code', 'existing-assets'];

interface RouteSettings { authoring?: { mode?: string } | null }

export function editorialProductionRoute(settings: RouteSettings | null | undefined): EditorialProductionRoute {
  return settings?.authoring?.mode && LEMO_MODES.includes(settings.authoring.mode) ? 'lemo' : 'template';
}

/** Route of a stored editorial document; unreadable legacy JSON counts as a legacy (template) project. */
export function editorialProductionRouteFromPipelineData(pipelineData: string | null | undefined): EditorialProductionRoute {
  try {
    const value = JSON.parse(pipelineData || '{}') as { productionSettings?: RouteSettings | null } | null;
    return editorialProductionRoute(value && typeof value === 'object' ? value.productionSettings : undefined);
  } catch { return 'template'; }
}

/** SQLite (JSON1) form of the same rule over a pipeline_data column: true when the stored project is a 模板动画 project. */
export const editorialTemplateRouteSql = (column = 'pipeline_data') =>
  `NOT (json_valid(${column}) AND coalesce(json_extract(${column}, '$.productionSettings.authoring.mode'), '') IN (${LEMO_MODES.map(mode => `'${mode}'`).join(', ')}))`;

export const editorialRouteLabel = (route: EditorialProductionRoute) => route === 'template' ? '模板动画' : '创意动画';

export function taskProductionRoute(task: { taskType?: string; taskKind?: string; productionRoute?: EditorialProductionRoute }): EditorialProductionRoute | undefined {
  if (task.taskType !== 'editorial-collage') return undefined;
  if (task.taskKind === 'music-mv') return 'lemo';
  return task.productionRoute ?? 'lemo';
}
