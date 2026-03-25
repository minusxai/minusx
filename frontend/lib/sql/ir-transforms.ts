/**
 * IR transformation utilities — structural modifications to QueryIR objects.
 */

import { QueryIR, FilterCondition, FilterGroup } from './ir-types';

function isFilterGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return 'conditions' in node;
}

/**
 * Recursively prune a FilterGroup, removing any FilterCondition whose
 * param_name is in `noneParams`. Returns null when the group becomes empty.
 */
function pruneGroup(group: FilterGroup, noneParams: Set<string>): FilterGroup | null {
  const kept = group.conditions
    .map((c): FilterCondition | FilterGroup | null => {
      if (isFilterGroup(c)) return pruneGroup(c, noneParams);
      if (c.param_name && noneParams.has(c.param_name)) return null;
      return c;
    })
    .filter((c): c is FilterCondition | FilterGroup => c !== null);

  if (kept.length === 0) return null;
  return { ...group, conditions: kept };
}

/**
 * Remove filter conditions (WHERE and HAVING) that are driven by None params.
 * Empty FilterGroup nodes are pruned automatically up the tree, so a WHERE
 * clause with no remaining conditions is removed entirely.
 *
 * Params that were NOT in a filter condition are left in the SQL text for the
 * caller to handle (typically substituted with NULL).
 */
export function removeNoneParamConditions(ir: QueryIR, noneParams: Set<string>): QueryIR {
  if (noneParams.size === 0) return ir;
  return {
    ...ir,
    where: ir.where ? (pruneGroup(ir.where, noneParams) ?? undefined) : undefined,
    having: ir.having ? (pruneGroup(ir.having, noneParams) ?? undefined) : undefined,
  };
}
