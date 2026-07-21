/**
 * Metric-SQL lexer — the comment/string-aware qualified-ref scanner shared by
 * tier-1 validation (lib/semantic/validate.ts) and the compiler's alias
 * rewrite + metric-only join inclusion (lib/semantic/compile.ts).
 *
 * Deliberately NOT the polyglot parser: the parser returns opaque `raw` select
 * columns for any compound aggregate (verified in Semantic_Model_v2.md §4), so
 * a token scan over qualified identifiers is the mechanism, not a fallback.
 */
import { immutableSet } from '@/lib/utils/immutable-collections';

/** A qualified `alias.column` reference found in metric SQL. */
export interface MetricRef {
  alias: string;
  column: string;
  /** Character offset of the alias token's first char (for splice rewrites). */
  start: number;
  /** Character offset just past the column token's last char. */
  end: number;
}

/** Lexer output for one metric SQL expression. */
export interface MetricLexResult {
  /** Qualified `alias.column` refs (outside strings/comments). */
  refs: MetricRef[];
  /** Bare identifiers (unqualified) with the exposed fields they could mean. */
  bare: Array<{ ident: string; candidates: string[] }>;
  /** True when the SQL contains a quoted (`"…"` / backtick) identifier. */
  quoted: boolean;
}

// Common SQL keywords — never treated as bare column refs. Deliberately broad:
// a keyword wrongly in this list only silences a bare-ref hint (tier 3 still
// catches real mistakes); a keyword missing from it produces a false positive.
const SQL_KEYWORDS = immutableSet([
  'select', 'from', 'where', 'case', 'when', 'then', 'else', 'end', 'and', 'or',
  'not', 'null', 'is', 'in', 'like', 'ilike', 'between', 'as', 'distinct',
  'cast', 'interval', 'true', 'false', 'over', 'partition', 'by', 'order',
  'group', 'having', 'limit', 'asc', 'desc', 'on', 'join', 'left', 'right',
  'inner', 'outer', 'exists', 'all', 'any', 'nulls', 'first', 'last',
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

/**
 * Comment/string-aware scan of a metric SQL expression.
 * `knownFields` maps a source key ('primary' or a reference alias) to its
 * exposed column names — used only to flag ambiguous bare identifiers.
 */
export function lexMetricSql(
  sql: string,
  knownFields: Map<string, Set<string>>,
): MetricLexResult {
  const refs: MetricRef[] = [];
  const bare: Array<{ ident: string; candidates: string[] }> = [];
  let quoted = false;

  // Token scan: identifiers + the structural chars we care about ('.', '(').
  type Tok = { kind: 'ident' | 'dot' | 'lparen' | 'other'; text: string; start: number; end: number };
  const toks: Tok[] = [];

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // Single-quoted string ('' escapes)
    if (c === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      toks.push({ kind: 'other', text: "'str'", start, end: i });
      continue;
    }
    // Line comment
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Quoted identifiers — rejected by policy, just flag their presence.
    if (c === '"' || c === '`') {
      quoted = true;
      const close = c;
      const start = i;
      i++;
      while (i < n && sql[i] !== close) i++;
      i++;
      toks.push({ kind: 'other', text: 'quoted-ident', start, end: i });
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(sql[j])) j++;
      toks.push({ kind: 'ident', text: sql.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    if (c === '.') { toks.push({ kind: 'dot', text: '.', start: i, end: i + 1 }); i++; continue; }
    if (c === '(') { toks.push({ kind: 'lparen', text: '(', start: i, end: i + 1 }); i++; continue; }
    if (!/\s/.test(c)) toks.push({ kind: 'other', text: c, start: i, end: i + 1 });
    i++;
  }

  const seenBare = new Set<string>();
  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t];
    if (tok.kind !== 'ident') continue;
    const prev = toks[t - 1];
    const next = toks[t + 1];
    if (next?.kind === 'dot' && toks[t + 2]?.kind === 'ident') {
      // Qualified ref: alias '.' column — consume all three.
      refs.push({ alias: tok.text, column: toks[t + 2].text, start: tok.start, end: toks[t + 2].end });
      t += 2;
      continue;
    }
    if (prev?.kind === 'dot') continue;              // column side already consumed / stray
    if (next?.kind === 'lparen') continue;           // function name
    if (SQL_KEYWORDS.has(tok.text.toLowerCase())) continue;
    // Bare identifier — flag only when it matches an exposed field somewhere.
    const candidates: string[] = [];
    for (const [source, cols] of knownFields) {
      if (cols.has(tok.text)) candidates.push(`${source}.${tok.text}`);
    }
    if (candidates.length > 0 && !seenBare.has(tok.text)) {
      seenBare.add(tok.text);
      bare.push({ ident: tok.text, candidates: candidates.sort() });
    }
  }

  return { refs, bare, quoted };
}

/**
 * Rewrite the `primary.` qualifier in a (tier-1-valid) metric SQL expression
 * to the compiled base qualifier, leaving reference aliases untouched (they
 * double as the compiled join aliases). Splices by lexer offsets, so refs
 * inside strings/comments are never rewritten.
 */
export function rewriteMetricSql(sql: string, baseQualifier: string): string {
  const { refs } = lexMetricSql(sql, new Map());
  let out = '';
  let cursor = 0;
  for (const ref of refs) {
    if (ref.alias !== 'primary') continue;
    out += sql.slice(cursor, ref.start) + `${baseQualifier}.${ref.column}`;
    cursor = ref.end;
  }
  return out + sql.slice(cursor);
}
