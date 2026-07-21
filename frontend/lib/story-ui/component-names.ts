/**
 * Names-only contract for the story design system (Story_Design_V2 §2) — importable by
 * server-side validation (lib/jsx) WITHOUT pulling React or the component sources in.
 * `lib/story-ui/registry.ts` maps these names to the real components; a registry test
 * asserts the two never drift.
 */

/** The shadcn component tags a new-format (`format:'jsx'`) story may use. */
export const STORY_UI_COMPONENT_NAME_LIST = [
  'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter', 'CardAction',
  'Badge', 'Button',
  'Alert', 'AlertTitle', 'AlertDescription',
  'Table', 'TableHeader', 'TableBody', 'TableFooter', 'TableRow', 'TableHead', 'TableCell', 'TableCaption',
  'Separator', 'Skeleton', 'Progress',
  'Breadcrumb', 'BreadcrumbList', 'BreadcrumbItem', 'BreadcrumbLink', 'BreadcrumbPage', 'BreadcrumbSeparator', 'BreadcrumbEllipsis',
  'Avatar', 'AvatarImage', 'AvatarFallback', 'AvatarBadge', 'AvatarGroup', 'AvatarGroupCount',
  'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent',
  'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
  'Collapsible', 'CollapsibleTrigger', 'CollapsibleContent',
  'Tooltip', 'TooltipTrigger', 'TooltipContent', 'TooltipProvider',
  'Popover', 'PopoverTrigger', 'PopoverContent', 'PopoverAnchor', 'PopoverHeader', 'PopoverTitle', 'PopoverDescription',
] as const;

/**
 * The explicit HTML tag allowlist for new-format stories (§2): content/document tags only.
 * `script`/`iframe`/`object`/`embed`/`base`/`form`/`meta`/`link` are excluded (the validator
 * additionally hard-denies them for every story format).
 */
export const STORY_HTML_TAGS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'kbd', 'samp', 'var',
  'blockquote', 'cite', 'q', 'abbr', 'mark', 'small', 'sub', 'sup', 'del', 'ins',
  'img', 'figure', 'figcaption', 'picture', 'source',
  'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'address',
  'hr', 'br', 'wbr', 'time', 'data', 'details', 'summary',
  'style',
] as const;
