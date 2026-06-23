/**
 * Dashboard ⇄ jsx body adapter (File Architecture v2).
 *
 * A dashboard's body projects to a grid of positioned `<Question/>` embeds:
 *
 *   <Dashboard cols={12}>
 *     <Question id={5} x={0} y={0} w={6} h={4} />
 *     <Question id={9} x={6} y={0} w={6} h={4} />
 *   </Dashboard>
 *
 * `assets` + `layout` (the structured fields) live in the body jsx; the remaining
 * scalar metadata (`description`, `parameterValues`) stays in `props`. Inline (text/
 * image/divider) assets are preserved as lowercase HTML-ish elements carrying the same
 * x/y/w/h position attributes.
 */
import type { DashboardContent, DashboardLayoutItem, AssetReference } from '@/lib/types';

const num = (attrs: Record<string, unknown>, k: string): number | undefined =>
  typeof attrs[k] === 'number' ? (attrs[k] as number) : undefined;

interface JsxNodeLite {
  type: string;
  tag?: string;
  attributes?: { name: string; value: { static: boolean; json?: unknown } }[];
  children?: JsxNodeLite[];
  value?: { static: boolean; json?: unknown };
}

const attrMap = (n: JsxNodeLite): Record<string, unknown> =>
  Object.fromEntries((n.attributes ?? []).filter((a) => a.value.static).map((a) => [a.name, a.value.json]));

/** Build the dashboard body jsx from its content (assets + layout). */
export function dashboardToJsx(content: Partial<DashboardContent>): string {
  const cols = content.layout?.columns ?? 12;
  const items = content.layout?.items ?? [];
  const assetById = new Map<string | number, AssetReference>((content.assets ?? []).map((a) => [a.id as string | number, a]));
  const rows = items.map((it) => {
    const pos = `x={${it.x}} y={${it.y}} w={${it.w}} h={${it.h}}`;
    const asset = assetById.get(it.id);
    if (!asset || (asset as { type?: string }).type === 'question') {
      return `  <Question id={${it.id}} ${pos} />`;
    }
    const inline = asset as { type: string; content?: string | null };
    const tag = inline.type === 'image' ? 'img' : inline.type === 'divider' ? 'hr' : 'text';
    if (tag === 'hr') return `  <hr ${pos} />`;
    if (tag === 'img') return `  <img src=${JSON.stringify(inline.content ?? '')} ${pos} />`;
    const body = (inline.content ?? '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return `  <text ${pos}>{\`${body}\`}</text>`;
  });
  return `<Dashboard cols={${cols}}>\n${rows.join('\n')}\n</Dashboard>`;
}

/** Reconstruct a dashboard's { assets, layout } from its body jsx AST nodes. */
export function jsxToDashboard(nodes: JsxNodeLite[]): { assets: AssetReference[]; layout: { columns: number; items: DashboardLayoutItem[] } } {
  const root = nodes.find((n) => n.type === 'element' && n.tag === 'Dashboard');
  const cols = root ? (num(attrMap(root), 'cols') ?? 12) : 12;
  const children = (root?.children ?? []).filter((c) => c.type === 'element');
  const assets: AssetReference[] = [];
  const items: DashboardLayoutItem[] = [];
  for (const c of children) {
    const a = attrMap(c);
    const x = num(a, 'x') ?? 0, y = num(a, 'y') ?? 0, w = num(a, 'w') ?? 6, h = num(a, 'h') ?? 4;
    if (c.tag === 'Question') {
      const id = num(a, 'id');
      if (id == null) continue;
      assets.push({ type: 'question', id });
      items.push({ id, x, y, w, h });
    } else {
      // Inline asset (text/img/hr). Stable string id keyed by position.
      const id = `${c.tag}-${x}-${y}`;
      const type = c.tag === 'img' ? 'image' : c.tag === 'hr' ? 'divider' : 'text';
      const textChild = (c.children ?? []).find((ch) => ch.type === 'expression' && ch.value?.static);
      const content = c.tag === 'img'
        ? String(a.src ?? '')
        : textChild?.value && typeof textChild.value.json === 'string' ? textChild.value.json : '';
      assets.push({ type, id, content } as AssetReference);
      items.push({ id, x, y, w, h });
    }
  }
  return { assets, layout: { columns: cols, items } };
}
