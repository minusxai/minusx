'use client';

import { Box, Text } from '@chakra-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { LuChartColumnIncreasing, LuChevronDown, LuCircleHelp, LuFilePlus2, LuRocket, LuShieldCheck, LuShieldAlert, LuShieldQuestion, LuSearch } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { FileType } from '@/lib/types';
import { ReactNode, useCallback, useMemo, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectActiveConversation, sendMessage } from '@/store/chatSlice';
import { selectShowSuggestedQuestions, selectShowTrustScore } from '@/store/uiSlice';
import { selectContextFromPath } from '@/store/filesSlice';
import { isViewer } from '@/lib/auth/role-helpers';
import { resolvePath } from '@/lib/mode/path-resolver';
import { ReportQueryResult, QuestionContent } from '@/lib/types';
import QuestionViewV2 from '@/components/views/QuestionViewV2';

// Inline chart component for query references in reports
function InlineChart({ queryData }: { queryData: ReportQueryResult }) {
  // Convert query data to QuestionContent format
  const [localContent, setLocalContent] = useState<QuestionContent>(() => ({
    query: queryData.query,
    vizSettings: queryData.vizSettings,
    parameters: [],
    connection_name: queryData.connectionId || ''
  }));

  const queryResult = useMemo(() => ({
    columns: queryData.columns,
    types: queryData.types,
    rows: queryData.rows
  }), [queryData]);

  // Handler for viz type changes
  const handleContentChange = (updates: Partial<QuestionContent>) => {
    setLocalContent(prev => {
      const merged = { ...prev };
      for (const [key, value] of Object.entries(updates)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && merged[key as keyof QuestionContent] && typeof merged[key as keyof QuestionContent] === 'object') {
          merged[key as keyof QuestionContent] = { ...merged[key as keyof QuestionContent] as any, ...value };
        } else {
          merged[key as keyof QuestionContent] = value as any;
        }
      }
      return merged;
    });
  };

  if (!queryData.rows || queryData.rows.length === 0) {
    return (
      <Box p={3} bg="bg.muted" borderRadius="md" my={2}>
        <Text fontSize="sm" color="fg.muted">No data available</Text>
      </Box>
    );
  }

  return (
    <Box
      my={4}
      border="1px solid"
      borderColor="border.default"
      borderRadius="md"
      overflow="hidden"
      bg="bg.surface"
    >
      <QuestionViewV2
        viewMode='toolcall'
        content={localContent}
        queryData={queryResult}
        queryLoading={false}
        queryError={null}
        queryStale={false}
        onChange={handleContentChange}
        onExecute={() => {}}
      />
    </Box>
  );
}

// Custom link button for internal links
function LinkButton({ href, icon, children, bg = 'accent.primary' }: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  bg?: string;
}) {
  return (
    <Box
      asChild
      display="inline-flex"
      alignItems="center"
      gap="1"
      px="2"
      py="0.5"
      bg={bg}
      borderRadius="sm"
      fontSize={'sm'}
      fontWeight="400"
      color="white"
      textDecoration="none"
      transition="all 0.15s ease"
      _hover={{ opacity: 0.8 }}
    >
      <Link href={href} style={{ textDecoration: 'none', color: 'white', fontWeight: 400, fontSize: 'small' }}>
        {icon}
        {children}
      </Link>
    </Box>
  );
}

// --- XML block parsing helpers ---

interface ParsedTrustInfo {
  level: 'high' | 'medium' | 'low';
  reasons: string[];
}

function parseSuggestedQuestions(xml: string): string[] {
  const questions: string[] = [];
  const re = /<question>([\s\S]*?)<\/question>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const q = m[1].trim();
    if (q) questions.push(q);
  }
  return questions;
}

function parseTrustInfo(xml: string): ParsedTrustInfo | null {
  const levelMatch = xml.match(/level="(high|medium|low)"/);
  if (!levelMatch) return null;

  const reasons: string[] = [];
  const reasonRe = /<reason>([\s\S]*?)<\/reason>/g;
  let m;
  while ((m = reasonRe.exec(xml)) !== null) {
    const r = m[1].trim();
    if (r) reasons.push(r);
  }

  return { level: levelMatch[1] as 'high' | 'medium' | 'low', reasons };
}

type ContentPart =
  | { type: 'text'; content: string }
  | { type: 'query'; content: string }
  | { type: 'trust_legacy'; content: string }
  | { type: 'suggested_questions'; questions: string[] }
  | { type: 'trust_info'; info: ParsedTrustInfo };

/**
 * Parse content string into parts, extracting XML blocks and legacy patterns.
 * Incomplete XML blocks (no closing tag yet — streaming) are stripped from output.
 */
function parseContentParts(text: string, queries?: Record<string, ReportQueryResult>): ContentPart[] {
  // Combined pattern: completed XML blocks + legacy patterns
  // Order matters: XML blocks first (greedy), then legacy patterns
  const xmlBlockPattern = /(?:<suggested_questions>([\s\S]*?)<\/suggested_questions>|<trust_info\s([\s\S]*?)<\/trust_info>|\{\{(query):([^}]+)\}\}|\[\[(trust):([^\]]+)\]\])/g;

  const parts: ContentPart[] = [];
  let lastIndex = 0;
  let match;

  while ((match = xmlBlockPattern.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      // <suggested_questions>...</suggested_questions>
      const questions = parseSuggestedQuestions(match[0]);
      if (questions.length > 0) {
        parts.push({ type: 'suggested_questions', questions });
      }
    } else if (match[2] !== undefined) {
      // <trust_info ...>...</trust_info>
      const info = parseTrustInfo(match[0]);
      if (info) {
        parts.push({ type: 'trust_info', info });
      }
    } else if (match[3] === 'query') {
      // {{query:id}}
      parts.push({ type: 'query', content: match[4] });
    } else if (match[5] === 'trust') {
      // [[trust:level]] — legacy
      parts.push({ type: 'trust_legacy', content: match[6] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text — but strip any incomplete XML tags (streaming)
  if (lastIndex < text.length) {
    let remaining = text.slice(lastIndex);
    // Remove incomplete opening tags that haven't closed yet
    remaining = remaining.replace(/<suggested_questions>[\s\S]*$/, '');
    remaining = remaining.replace(/<trust_info[\s\S]*$/, '');
    if (remaining.trim()) {
      parts.push({ type: 'text', content: remaining });
    }
  }

  return parts;
}

// Suggested questions component — clickable chips that dispatch directly to Redux
function SuggestedQuestionsBlock({ questions }: { questions: string[] }) {
  const dispatch = useAppDispatch();
  const conversationID = useAppSelector(selectActiveConversation);

  if (questions.length === 0) return null;

  const handleClick = (question: string) => {
    if (conversationID === undefined) return;
    dispatch(sendMessage({ conversationID, message: question }));
  };

  return (
    <Box mt="4" display="flex" flexDirection="column" gap="1.5">
      <Box display="flex" alignItems="center" gap="2">
        <Box flex="1" h="1px" bg="border.default" />
        <span style={{ fontFamily: 'var(--font-jetbrains-mono)', fontWeight: 500, color: 'var(--chakra-colors-fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0, fontSize: '10px' }}>
          Suggested questions
        </span>
      </Box>
      {questions.map((q, i) => (
        <Box
          key={i}
          display="flex"
          alignItems="center"
          gap="2"
          px="2.5"
          py="1"
          borderRadius="md"
          bg="bg.muted"
          border="1px solid"
          borderColor="border.default"
          fontSize="2xs"
          fontFamily="mono"
          color="fg.muted"
          cursor="pointer"
          transition="all 0.2s"
          aria-label={`Suggested question: ${q}`}
          onClick={() => handleClick(q)}
          _hover={{
            borderColor: 'accent.teal',
            bg: 'accent.teal/5',
            transform: 'translateX(4px)',
          }}
        >
          <Box color="accent.teal" display="flex" alignItems="center" flexShrink={0}>
            <LuSearch size={12} />
          </Box>
          <Text fontSize="2xs" fontFamily="mono">{q}</Text>
        </Box>
      ))}
    </Box>
  );
}

// Trust level section for AI confidence indicators
const trustConfig = {
  high: {
    label: 'High',
    icon: LuShieldCheck,
    bgColor: 'accent.teal/85',
    borderColor: 'accent.teal/30',
    moreDetailsTitle: 'What does this mean?',
    moreDetails: 'Queries in the analysis are directly from saved questions or very slight modifications. All metrics are well-defined in the context with no assumptions made.',
    readMoreLink: 'https://minusx.ai',
  },
  medium: {
    label: 'Medium',
    icon: LuShieldAlert,
    bgColor: 'accent.warning/85',
    borderColor: 'accent.warning/30',
    moreDetailsTitle: 'How to improve?',
    moreDetails: 'Analysis uses queries that deviate from saved questions, and some metrics were tweaked. You can improve confidence by saving verified queries, defining metrics in your context docs, and validating assumptions with your team.',
    readMoreLink: 'https://minusx.ai',
  },
  low: {
    label: 'Low',
    icon: LuShieldQuestion,
    bgColor: 'accent.danger/85',
    borderColor: 'accent.danger/30',
    moreDetailsTitle: 'How to improve?',
    moreDetails: 'Analysis required building queries from scratch with significant assumptions about metric definitions. You can improve confidence by creating base queries for common analyses, and adding well-defined metrics and documentation to the Knowledge Base.',
    readMoreLink: 'https://minusx.ai',
  },
} as const;

function TrustBadge({ level, context, reasons }: {
  level: 'high' | 'medium' | 'low';
  context: 'sidebar' | 'mainpage';
  reasons?: string[];
}) {
  const [expanded, setExpanded] = useState(true);
  const { config: appConfig } = useConfigs({ skip: false });
  const agentName = appConfig.branding.agentName;
  const config = trustConfig[level];
  const Icon = config.icon;
  const hasMoreDetails = 'moreDetails' in config;
  const hasReasons = reasons && reasons.length > 0;
  const hasExpandableContent = hasReasons || hasMoreDetails;

  // Find the user's context file for the "Edit Knowledge Base" link
  const trustUser = useAppSelector(selectEffectiveUser);
  const userMode = trustUser?.mode || 'org';
  const userHomePath = resolvePath(userMode, trustUser?.home_folder ? `/${trustUser.home_folder}` : '/');
  const contextFile = useAppSelector((state) => selectContextFromPath(state, userHomePath));

  if (level === 'high') return null;

  return (
    <Box w="100%" mt="3">
      {/* Compact inline trust indicator */}
      <Box
        asChild
        display="inline-flex"
        alignItems="center"
        gap="1.5"
        cursor={hasExpandableContent ? 'pointer' : 'default'}
        transition="all 0.15s ease"
        _hover={hasExpandableContent ? { opacity: 0.85 } : {}}
      >
        <button
          aria-label={`Trust score: ${config.label}`}
          onClick={() => hasExpandableContent && setExpanded(!expanded)}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: hasExpandableContent ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: 'inherit' }}
        >
          <Box color={config.bgColor} display="flex" alignItems="center">
            <Icon size={14} />
          </Box>
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
            {agentName} confidence: {config.label}
          </Text>
          {hasExpandableContent && (
            <Box
              transition="transform 0.2s ease"
              transform={expanded ? 'rotate(180deg)' : 'rotate(0deg)'}
              display="flex"
              alignItems="center"
              color="fg.subtle"
            >
              <LuChevronDown size={10} />
            </Box>
          )}
        </button>
      </Box>

      {/* Expanded reasons */}
      {hasExpandableContent && expanded && (
        <Box
          mt="2"
          pl="3"
          borderLeft="2px solid"
          borderColor={config.borderColor}
        >
          {hasReasons && reasons.map((reason, i) => (
            <Text key={i} fontSize="2xs" color="fg.muted" lineHeight="1.7" fontFamily="mono">
              {reason}
            </Text>
          ))}
          {!hasReasons && 'moreDetails' in config && (
            <Text fontSize="2xs" color="fg.muted" lineHeight="1.7" fontFamily="mono">
              {config.moreDetails}
            </Text>
          )}
          {/* Link to edit knowledge base */}
          <Text fontSize="2xs" color="fg.subtle" lineHeight="1.7" fontFamily="mono" mt="1.5">
            {contextFile ? (
              <>
                <Link href={`/f/${contextFile.id}`} style={{ color: 'var(--chakra-colors-accent-teal)', textDecoration: 'underline' }}>
                  Edit Knowledge Base
                </Link>
                {' '}to improve confidence, or just ask the agent!
              </>
            ) : (
              <>Improve confidence by adding context — just ask the agent!</>
            )}
          </Text>
        </Box>
      )}
    </Box>
  );
}

interface MarkdownProps {
  children: string;
  context?: 'sidebar' | 'mainpage';
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  queries?: Record<string, ReportQueryResult>;  // Query results for {{query:id}} references
}

/**
 * Unified Markdown component with consistent styling across the app.
 *
 * Context:
 * - sidebar: Smaller fonts and spacing for chat messages, sidebars, and previews
 * - mainpage: Standard markdown styling for documents, reports, slides, and content blocks
 */
export default function Markdown({
  children,
  context = 'mainpage',
  textAlign = 'left',
  textColor,
  queries
}: MarkdownProps) {
  const styles = {
    h1: { fontSize: 'xl', fontWeight: '700', mb: 3, mt: 2, lineHeight: '1.3' },
    h2: { fontSize: 'lg', fontWeight: '600', mb: 2.5, mt: 2, lineHeight: '1.4' },
    h3: { fontSize: 'md', fontWeight: '600', mb: 2, mt: 2, lineHeight: '1.4' },
    h4: { fontSize: 'sm', fontWeight: '600', mb: 1.5, mt: 1.5 },
    p: { fontSize: 'sm', lineHeight: '1.7', fontWeight: '400' },
    a: { fontSize: 'sm', lineHeight: '1.7', fontWeight: '400' },
    code: { fontSize: 'sm' },
    pre: { mb: 3, p: 2.5 },
    list: { ml: 5, mb: 2.5, fontSize: 'sm', lineHeight: '1.7' },
    li: { mb: 1 },
    table: { mb: 3, fontSize: 'sm', mt: 2 },
    th: { py: 2, px: 3 },
    td: { py: 2, px: 3 },
  };

  // Get mode from Redux to preserve in internal links
  const mode = useAppSelector(state => state.auth.user?.mode);

  // Feature flags + role check
  const user = useAppSelector(selectEffectiveUser);
  const isViewerUser = user ? isViewer(user.role) : false;
  const showSuggestedQuestions = useAppSelector(selectShowSuggestedQuestions);
  const showTrustScore = useAppSelector(selectShowTrustScore);

  // Append mode param to internal links if in non-default mode
  const withMode = (href: string): string => {
    if (!mode || mode === 'org') return href;
    return `${href}?mode=${mode}`;
  };

  // Check if a link is an internal file link (/f/<id>)
  const isInternalFileLink = (href: string | undefined): boolean => {
    if (!href) return false;
    return /^\/f\/\d+$/.test(href);
  };
  // Check if a link is explore page link (/explore)
    const isExplorePageLink = (href: string | undefined): boolean => {
        if (!href) return false;
        return href === '/explore';
    };
  // Check if a link is a new content page link (/new/{type})
  const isNewContentPageLink = (href: string | undefined): boolean => {
    if (!href) return false;
    return /^\/new\/[^/]+$/.test(href);
  };

  // Custom components for ReactMarkdown
  const components = {
    table: ({ node, ...props }: any) => (
      <Box overflowX="auto" mb={`${styles.table.mb * 0.25}rem`} mt={`${styles.table.mt * 0.25}rem`}>
        <table {...props} />
      </Box>
    ),
    a: ({ node, href, children, ...props }: any) => {
      if (isInternalFileLink(href)) {
        return (
          <LinkButton href={withMode(href)} icon={<LuChartColumnIncreasing size={14} />}>
            {children}
          </LinkButton>
        );
      }
      if (isExplorePageLink(href)) {
        return (
          <LinkButton href={withMode(href)} icon={<LuRocket size={14} />} bg="accent.teal">
            Explore Page
          </LinkButton>
        );
      }
      if (isNewContentPageLink(href)) {
        const fileType = href!.split('/').pop() as FileType;
        const metadata = getFileTypeMetadata(fileType);
        const Icon = metadata?.icon ?? LuFilePlus2;
        return (
          <LinkButton
            href={withMode(href)}
            icon={<Icon size={14} />}
            bg={metadata?.color ?? 'accent.danger/90'}
          >
            New {metadata?.label ?? fileType}
          </LinkButton>
        );
      }
      // Regular external link
      return <a href={href} {...props}>{children}</a>;
    },
  };

  // Strip background colors and non-default text colors from copied HTML
  // so pasting into Google Docs / Word uses black-on-white defaults
  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    // Get plain text
    const plainText = selection.toString();

    // Build sanitized HTML from the selection
    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);

    // Remove style-heavy properties that carry app theme colors
    wrapper.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.removeProperty('background-color');
        el.style.removeProperty('background');
        el.style.removeProperty('color');
        el.style.removeProperty('font-family');
        el.style.removeProperty('border');
        el.style.removeProperty('border-bottom');
        el.style.removeProperty('border-right');
        el.style.removeProperty('border-left');
        el.style.removeProperty('border-top');
      }
    });

    e.clipboardData.setData('text/plain', plainText);
    e.clipboardData.setData('text/html', wrapper.innerHTML);
    e.preventDefault();
  }, []);

  return (
    <Box
      textAlign={textAlign}
      color={textColor}
      onCopy={handleCopy}
      css={{
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        fontFamily: 'JetBrains Mono, monospace',
        '& h1': {
          fontSize: styles.h1.fontSize,
          fontWeight: styles.h1.fontWeight,
          marginBottom: `${styles.h1.mb * 0.25}rem`,
          marginTop: `${styles.h1.mt * 0.25}rem`,
          lineHeight: styles.h1.lineHeight,
          letterSpacing: undefined,
        },
        '& h2': {
          fontSize: styles.h2.fontSize,
          fontWeight: styles.h2.fontWeight,
          marginBottom: `${styles.h2.mb * 0.25}rem`,
          marginTop: `${styles.h2.mt * 0.25}rem`,
          lineHeight: styles.h2.lineHeight,
          letterSpacing: undefined,
        },
        '& h3': {
          fontSize: styles.h3.fontSize,
          fontWeight: styles.h3.fontWeight,
          marginBottom: `${styles.h3.mb * 0.25}rem`,
          marginTop: `${styles.h3.mt * 0.25}rem`,
          lineHeight: styles.h3.lineHeight,
        },
        '& h4': {
          fontSize: styles.h4.fontSize,
          fontWeight: styles.h4.fontWeight,
          marginBottom: `${styles.h4.mb * 0.25}rem`,
          marginTop: `${styles.h4.mt * 0.25}rem`,
        },
        '& p': {
          fontSize: styles.p.fontSize,
          lineHeight: styles.p.lineHeight,
        },
        '& strong': {
          fontWeight: '800',
          color: 'inherit',
        },
        '& em': {
          fontStyle: 'italic',
          color: 'var(--chakra-colors-fg-emphasized)',
        },
        '& code': {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: styles.code.fontSize,
          backgroundColor: 'var(--chakra-colors-bg-muted)',
          color: 'inherit',
          padding: '0.125rem 0.5rem',
          borderRadius: '0.125rem',
          fontWeight: '500',
          display: 'inline-block',
        },
        '& pre': {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: styles.code.fontSize,
          backgroundColor: 'var(--chakra-colors-bg-muted)',
          padding: `${styles.pre.p * 0.25}rem`,
          borderRadius: '0.375rem',
          overflow: 'auto',
          marginBottom: `${styles.pre.mb * 0.25}rem`,
          border: '1px solid var(--chakra-colors-border-default)',
        },
        '& pre code': {
          backgroundColor: 'transparent',
          padding: 0,
          borderRadius: 0,
          display: 'block',
        },
        '& ul': {
          marginLeft: `${styles.list.ml * 0.25}rem`,
          marginBottom: `${styles.list.mb * 0.25}rem`,
          fontSize: styles.list.fontSize,
          lineHeight: styles.list.lineHeight,
          listStyleType: 'disc',
          paddingLeft: '1em',
        },
        '& ol': {
          marginLeft: `${styles.list.ml * 0.25}rem`,
          marginBottom: `${styles.list.mb * 0.25}rem`,
          fontSize: styles.list.fontSize,
          lineHeight: styles.list.lineHeight,
          listStyleType: 'decimal',
          paddingLeft: '1em',
        },
        '& li': {
          marginBottom: `${styles.li.mb * 0.25}rem`,
        },
        '& blockquote': {
          borderLeft: '4px solid var(--chakra-colors-accent-secondary)',
          paddingLeft: '1rem',
          paddingTop: '0.5rem',
          paddingBottom: '0.5rem',
          marginTop: '0.75rem',
          marginBottom: '0.75rem',
          color: 'var(--chakra-colors-fg-muted)',
          fontStyle: 'italic',
        },
        '& a': {
          color: 'var(--chakra-colors-accent-secondary)',
          textDecoration: 'underline',
          fontWeight: '600',
        },
        '& hr': {
          marginTop: '0.25rem',
          marginBottom: '0.25rem',
          border: 'none',
          borderTop: '1px solid var(--chakra-colors-border-emphasized)',
          opacity: 0.6,
        },
        '& table': {
          width: 'max-content',
          minWidth: '100%',
          borderCollapse: 'collapse',
          fontSize: styles.table.fontSize,
          border: '1px solid var(--chakra-colors-border-default)',
          borderRadius: '0.375rem',
          overflow: 'hidden',
        },
        '& thead': {
          backgroundColor: 'var(--chakra-colors-bg-muted)',
          borderBottom: '1px solid var(--chakra-colors-border-emphasized)',
        },
        '& th': {
          paddingTop: `${styles.th.py * 0.25}rem`,
          paddingBottom: `${styles.th.py * 0.25}rem`,
          paddingLeft: `${styles.th.px * 0.25}rem`,
          paddingRight: `${styles.th.px * 0.25}rem`,
          textAlign: 'left',
          fontWeight: '700',
          color: 'var(--chakra-colors-fg-emphasized)',
          lineHeight: '1.5',
          borderRight: '1px solid var(--chakra-colors-border-emphasized)',
        },
        '& th:last-child': {
          borderRight: 'none',
        },
        '& td': {
          paddingTop: `${styles.td.py * 0.25}rem`,
          paddingBottom: `${styles.td.py * 0.25}rem`,
          paddingLeft: `${styles.td.px * 0.25}rem`,
          paddingRight: `${styles.td.px * 0.25}rem`,
          borderBottom: '1px solid var(--chakra-colors-border-emphasized)',
          borderRight: '1px solid var(--chakra-colors-border-emphasized)',
          lineHeight: '1.6',
        },
        '& td:last-child': {
          borderRight: 'none',
        },
        '& tbody tr:last-child td': {
          borderBottom: 'none',
        },
        '& tbody tr:hover': {
          backgroundColor: 'var(--chakra-colors-bg-subtle)',
        },
      }}
    >
      {renderContent()}
    </Box>
  );

  // Parse content and split on special patterns (XML blocks, {{query:id}}, [[trust:level]])
  function renderContent() {
    const parts = parseContentParts(children, queries);

    // If no special patterns found, render plain markdown
    if (parts.length === 1 && parts[0].type === 'text') {
      return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {children}
        </ReactMarkdown>
      );
    }

    // Render parts: text/trust/query inline, then suggested questions at the very end
    const suggestedQuestions = parts.filter((p): p is Extract<ContentPart, { type: 'suggested_questions' }> => p.type === 'suggested_questions');

    return (
      <>
        {parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <ReactMarkdown
                key={index}
                remarkPlugins={[remarkGfm]}
                components={components}
              >
                {part.content}
              </ReactMarkdown>
            );
          } else if (part.type === 'trust_info') {
            if (isViewerUser || !showTrustScore) return null;
            return (
              <TrustBadge
                key={index}
                level={part.info.level}
                context={context}
                reasons={part.info.reasons}
              />
            );
          } else if (part.type === 'trust_legacy') {
            if (isViewerUser || !showTrustScore) return null;
            const level = part.content as 'high' | 'medium' | 'low';
            if (level in trustConfig) {
              return <TrustBadge key={index} level={level} context={context} />;
            }
            return null;
          } else if (part.type === 'query') {
            const queryData = queries?.[part.content];
            if (queryData) {
              return <InlineChart key={index} queryData={queryData} />;
            } else {
              return (
                <Box
                  key={index}
                  p={3}
                  my={2}
                  bg="bg.muted"
                  borderRadius="md"
                  border="1px dashed"
                  borderColor="border.muted"
                >
                  <Text fontSize="sm" color="fg.muted">
                    Chart not available (query: {part.content})
                  </Text>
                </Box>
              );
            }
          }
          return null;
        })}
        {/* Suggested questions always render last */}
        {showSuggestedQuestions && suggestedQuestions.map((part, i) => (
          <SuggestedQuestionsBlock key={`sq-${i}`} questions={part.questions} />
        ))}
      </>
    );
  }
}
