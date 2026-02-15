/**
 * Filter utilities for excluding elements from screenshots
 */

/**
 * Filter out elements with specific classes or data attributes
 */
export function createElementFilter(excludeSelectors: string[] = []): (node: HTMLElement) => boolean {
  return (node: HTMLElement) => {
    // Exclude elements matching selectors
    for (const selector of excludeSelectors) {
      if (node.matches?.(selector)) return false;
      if (node.closest?.(selector)) return false;
    }

    // Exclude elements with data-screenshot-exclude attribute
    if (node.hasAttribute?.('data-screenshot-exclude')) return false;

    return true;
  };
}

/**
 * Default excludes for FileView screenshots
 */
export const DEFAULT_EXCLUDE_SELECTORS = [
  '[data-screenshot-exclude]',
  '.edit-toolbar',
  '.hover-actions',
  '.resize-handle'
];
