/**
 * `<Slide>` transforms — the slide rail's rename edit, written back to the jsx source by
 * AST path exactly like the other story transforms (story-number, story-params). Pure
 * text→text (client + server safe).
 */
import { updateJsxElementAtPath, setStaticJsxAttr } from './jsx-edit';

/**
 * Set (or, for a blank title, remove) a Slide's `title` attribute. Removing lets the
 * rail fall back to the slide's first heading — see lib/story-ui/slide-nav.ts.
 */
export function updateSlideTitleInJsx(source: string, astPath: string, title: string): string {
  const trimmed = title.trim();
  return updateJsxElementAtPath(source, astPath, 'Slide', (el) => {
    setStaticJsxAttr(el, 'title', trimmed ? trimmed : undefined);
  });
}
