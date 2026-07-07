/**
 * Live-generated styling docs for the agent — rendered into the visualizations skill via the
 * `{viz_capabilities}` and `{schema_viz_styles}` template vars (merged in agents/skill-content.ts,
 * same mechanism as `{schema_question}`). Everything here derives from VIZ_CAPABILITIES and the
 * TypeBox schemas, so the prompt can never drift from what the renderers actually honor.
 */
import { VIZ_TYPES, VisualizationStyleConfig, StoryChartTheme, EmbedVizStyles } from '@/lib/validation/atlas-schemas';
import { VIZ_CAPABILITIES } from './viz-capabilities';

/** Deep-clone to plain JSON, dropping TypeBox's Symbol-keyed metadata (same as atlas-json-schemas). */
const toJson = (schema: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

function buildCapabilitiesText(): string {
  const lines: string[] = [
    '| type | renderer | config group | applicable styleConfig keys | escape hatch | notes |',
    '|---|---|---|---|---|---|',
  ];
  for (const type of VIZ_TYPES) {
    const cap = VIZ_CAPABILITIES[type];
    const hatch = cap.levers.echartsOverrides ? 'echartsOverrides' : 'cssOverrides';
    const styleKeys = cap.levers.styleConfig.filter(k => k !== 'echartsOverrides' && k !== 'cssOverrides');
    lines.push(`| ${type} | ${cap.renderer} | ${cap.levers.configGroup ?? '—'} | ${styleKeys.join(', ') || '—'} | ${hatch} | ${cap.notes} |`);
  }
  const hooks = VIZ_TYPES
    .filter(type => VIZ_CAPABILITIES[type].cssHooks.length > 0)
    .map(type => `- ${type}: ${VIZ_CAPABILITIES[type].cssHooks.join('; ')}`);
  return `${lines.join('\n')}\n\nCSS hooks for cssOverrides (DOM renderers only):\n${hooks.join('\n')}`;
}

export const VIZ_TEMPLATE_VARS: Record<string, string> = {
  viz_capabilities: buildCapabilitiesText(),
  schema_viz_styles: JSON.stringify({
    VisualizationStyleConfig: toJson(VisualizationStyleConfig),
    StoryChartTheme: toJson(StoryChartTheme),
    EmbedVizStyles: toJson(EmbedVizStyles),
  }, null, 2),
};
