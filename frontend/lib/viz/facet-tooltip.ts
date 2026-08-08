/** A hovered Vega facet cell, expressed in root data-rectangle coordinates. */
export interface FacetCellHit {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  datum: Record<string, unknown>;
}

/** Find the deepest facet cell containing a pointer in Vega's scenegraph. */
export function findFacetCellAtPoint(
  sceneRoot: unknown,
  x: number,
  y: number,
  facetFields: string[],
): FacetCellHit | null {
  if (!sceneRoot || typeof sceneRoot !== 'object' || facetFields.length === 0) return null;

  let hit: FacetCellHit | null = null;
  let hitArea = Infinity;
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    const item = candidate as {
      mark?: { name?: unknown };
      datum?: unknown;
      bounds?: { x1?: unknown; y1?: unknown; x2?: unknown; y2?: unknown };
      items?: unknown[];
    };
    const datum = item.datum && typeof item.datum === 'object' && !Array.isArray(item.datum)
      ? item.datum as Record<string, unknown>
      : null;
    const bounds = item.bounds;
    const x1 = Number(bounds?.x1), y1 = Number(bounds?.y1);
    const x2 = Number(bounds?.x2), y2 = Number(bounds?.y2);
    if (
      item.mark?.name === 'cell' && datum &&
      facetFields.every(field => Object.prototype.hasOwnProperty.call(datum, field)) &&
      [x1, y1, x2, y2].every(Number.isFinite) &&
      x >= x1 && x <= x2 && y >= y1 && y <= y2
    ) {
      const area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      if (area < hitArea) {
        hit = { x1, y1, x2, y2, datum };
        hitArea = area;
      }
    }
    if (Array.isArray(item.items)) item.items.forEach(visit);
  };
  visit(sceneRoot);
  return hit;
}
