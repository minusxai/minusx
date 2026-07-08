import { STORY_COMPONENT_NAMES } from '@/lib/data/story/story-components';

/**
 * The Capitalized component names allowed in a `jsx` body (File Architecture v2) — anything
 * else Capitalized is rejected by the static validator. Live embeds (<Question/>, <Param/>,
 * <Number/>) render via StoryEmbeds; the design-system components (lib/data/story/
 * story-components.ts) are compile-time only — they become static HTML containers at
 * parseStoryJsx time. Lowercase tags are HTML (sanitized at render via AgentHtml).
 */
export const JSX_COMPONENT_NAMES = ['Question', 'Param', 'Number', ...STORY_COMPONENT_NAMES];
