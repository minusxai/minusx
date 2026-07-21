import { STORY_COMPONENT_NAMES } from '@/lib/data/story/story-components';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';

/**
 * The Capitalized component names allowed in a LEGACY `jsx` body (File Architecture v2) —
 * anything else Capitalized is rejected by the static validator. Live embeds (<Question/>,
 * <Param/>, <Number/>) render via StoryEmbeds; the design-system components (lib/data/story/
 * story-components.ts) are compile-time only — they become static HTML containers at
 * parseStoryJsx time. Lowercase tags are HTML (sanitized at render via AgentHtml).
 */
export const JSX_COMPONENT_NAMES = ['Question', 'Param', 'Number', ...STORY_COMPONENT_NAMES];

/**
 * The component names allowed in a NEW-format (`format:'jsx'`) story body (Story_Design_V2
 * §2): the live embeds plus the real shadcn/ui registry (lib/story-ui). Names only — no React
 * import, so server-side validation stays headless. The legacy invented components
 * (STORY_COMPONENT_NAMES) are deliberately absent: new stories must use shadcn.
 */
export const JSX_STORY_COMPONENT_NAMES = ['Question', 'Param', 'Number', ...STORY_UI_COMPONENT_NAME_LIST];
