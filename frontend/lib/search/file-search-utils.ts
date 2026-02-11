/**
 * Search utilities shared across file and schema search
 */

/**
 * Search statistics for a single field
 */
export interface FieldSearchStats {
  field: string;
  weight: number;
  exactMatches: number;
  wordBoundaryMatches: number;
  partialMatches: number;
  snippets: string[];
}

/**
 * Extract snippet around a match position
 * @param text Full text content
 * @param matchIndex Position of match
 * @param matchLength Length of matched text
 * @param contextChars Characters before/after match (default 60)
 */
function extractSnippet(
  text: string,
  matchIndex: number,
  matchLength: number,
  contextChars: number = 60
): string {
  const start = Math.max(0, matchIndex - contextChars);
  const end = Math.min(text.length, matchIndex + matchLength + contextChars);

  let snippet = text.slice(start, end);

  // Add ellipsis if truncated
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet.trim();
}

/**
 * Search within a single field and return match statistics
 */
export function searchInField(
  text: string,
  query: string,
  fieldName: string,
  weight: number
): FieldSearchStats {
  const stats: FieldSearchStats = {
    field: fieldName,
    weight,
    exactMatches: 0,
    wordBoundaryMatches: 0,
    partialMatches: 0,
    snippets: []
  };

  if (!text || !query) return stats;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);

  // Track all match positions for snippet extraction
  const matchPositions: Array<{ index: number; length: number; type: 'exact' | 'word' | 'partial' }> = [];

  // 1. Exact phrase match
  let exactIndex = textLower.indexOf(queryLower);
  while (exactIndex !== -1) {
    stats.exactMatches++;
    matchPositions.push({ index: exactIndex, length: query.length, type: 'exact' });
    exactIndex = textLower.indexOf(queryLower, exactIndex + 1);
  }

  // 2. Word boundary matches (each word as standalone)
  for (const word of queryWords) {
    // Escape special regex characters
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`\\b${escapedWord}\\b`, 'gi');
    let match;
    while ((match = wordRegex.exec(textLower)) !== null) {
      stats.wordBoundaryMatches++;
      matchPositions.push({ index: match.index, length: word.length, type: 'word' });
    }
  }

  // 3. Partial matches (substring, but not already counted)
  if (stats.exactMatches === 0 && stats.wordBoundaryMatches === 0) {
    let partialIndex = textLower.indexOf(queryLower);
    while (partialIndex !== -1) {
      stats.partialMatches++;
      matchPositions.push({ index: partialIndex, length: query.length, type: 'partial' });
      partialIndex = textLower.indexOf(queryLower, partialIndex + 1);
    }
  }

  // Extract top 3 snippets (prioritize exact > word > partial)
  matchPositions.sort((a, b) => {
    const typeOrder = { exact: 0, word: 1, partial: 2 };
    if (typeOrder[a.type] !== typeOrder[b.type]) {
      return typeOrder[a.type] - typeOrder[b.type];
    }
    return a.index - b.index;
  });

  const uniqueSnippets = new Set<string>();
  for (const pos of matchPositions) {
    if (uniqueSnippets.size >= 3) break;
    const snippet = extractSnippet(text, pos.index, pos.length);
    if (snippet.length > 10) { // Avoid trivial snippets
      uniqueSnippets.add(snippet);
    }
  }
  stats.snippets = Array.from(uniqueSnippets);

  return stats;
}
