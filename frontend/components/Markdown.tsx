'use client';

import { Box, Text } from '@chakra-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { LuChartColumnIncreasing, LuChevronDown, LuCircleHelp, LuFilePlus2, LuRocket, LuShieldCheck, LuShieldAlert, LuShieldQuestion } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { FileType } from '@/lib/types';
import { ReactNode, useMemo, useState } from 'react';
import { useAppSelector } from '@/store/hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { ReportQueryResult, QuestionContent } from '@/lib/types';
import QuestionViewV2 from '@/components/views/QuestionViewV2';

// Inline chart component for query references in reports
function InlineChart({ queryData }: { queryData: ReportQueryResult }) {
  // Convert query data to QuestionContent format
  const [localContent, setLocalContent] = useState<QuestionContent>(() => ({
    query: queryData.query,
    vizSettings: queryData.vizSettings,
    parameters: [],
    database_name: queryData.connectionId || ''
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
      fontWeight="500"
      color="white"
      textDecoration="none"
      transition="all 0.15s ease"
      _hover={{ opacity: 0.8 }}
    >
      <Link href={href} style={{ textDecoration: 'none', color: 'white' }}>
        {icon}
        {children}
      </Link>
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

function TrustBadge({ level, context }: { level: 'high' | 'medium' | 'low'; context: 'sidebar' | 'mainpage' }) {
  const [expanded, setExpanded] = useState(false);
  const { config: appConfig } = useConfigs({ skip: false });
  const agentName = appConfig.branding.agentName;
  const config = trustConfig[level];
  const Icon = config.icon;
  const hasMoreDetails = 'moreDetails' in config;

  return (
    <Box
      w="100%"
      mt="3"
      borderRadius="md"
      border="1px solid"
      borderColor={config.borderColor}
      overflow="hidden"
      css={{ '& p, & span, & button': { fontSize: 'var(--chakra-font-sizes-xs) !important' } }}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        px="3"
        py="2"
      >
        <Box display="flex" alignItems="center" gap="1.5">
          <Text fontSize="2xs" color="fg.muted" textTransform="uppercase">
            {agentName} trust score
          </Text>
          <Box
            display="flex"
            alignItems="center"
            gap="1"
            bg={config.bgColor}
            px="2"
            py="0.5"
            borderRadius="lg"
          >
            <Box color="white" display="flex" alignItems="center">
              <Icon />
            </Box>
            <Text fontSize="2xs" fontWeight="600" color="white">
              {config.label}
            </Text>
          </Box>
        </Box>
        {hasMoreDetails && (
          <Box
            asChild
            display="flex"
            alignItems="center"
            gap="1"
            cursor="pointer"
            color="fg.muted"
            fontSize="2xs"
            _hover={{ color: 'fg.default' }}
            transition="all 0.15s ease"
          >
            <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'inherit' }}>
              {context === 'sidebar' ? (
                <LuCircleHelp size={14} />
              ) : (
                <>
                  <Text fontSize="2xs">{config.moreDetailsTitle}</Text>
                  <Box
                    transition="transform 0.2s ease"
                    transform={expanded ? 'rotate(180deg)' : 'rotate(0deg)'}
                    display="flex"
                    alignItems="center"
                  >
                    <LuChevronDown size={12} />
                  </Box>
                </>
              )}
            </button>
          </Box>
        )}
      </Box>
      {hasMoreDetails && expanded && (
        <Box
          px="3"
          pb="2.5"
          pt="0"
          borderTop="1px solid"
          borderColor={config.borderColor}
        >
          <Text fontSize="2xs" color="fg.muted" lineHeight="1.6" mt="2">
            {config.moreDetails}{' '}
            {/* <a href={config.readMoreLink} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
              Read more
            </a> */}
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

  return (
    <Box
      textAlign={textAlign}
      color={textColor}
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

  // Parse content and split on special patterns ({{query:id}}, {{trust:level}})
  function renderContent() {
    // Combined pattern for special references: {{query:id}} and [[trust:level]]
    const specialPattern = /(?:\{\{(query):([^}]+)\}\}|\[\[(trust):([^\]]+)\]\])/g;
    const parts: Array<{ type: 'text' | 'query' | 'trust'; content: string }> = [];
    let lastIndex = 0;
    let match;

    while ((match = specialPattern.exec(children)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: children.slice(lastIndex, match.index) });
      }
      // match[1]+match[2] for {{query:id}}, match[3]+match[4] for [[trust:level]]
      const type = (match[1] || match[3]) as 'query' | 'trust';
      const content = match[2] || match[4];
      parts.push({ type, content });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < children.length) {
      parts.push({ type: 'text', content: children.slice(lastIndex) });
    }

    // If no special patterns found, render plain markdown
    if (parts.length === 1 && parts[0].type === 'text') {
      return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {children}
        </ReactMarkdown>
      );
    }

    // Render parts
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
          } else if (part.type === 'trust') {
            const level = part.content as 'high' | 'medium' | 'low';
            if (level in trustConfig) {
              return <TrustBadge key={index} level={level} context={context} />;
            }
            return null;
          } else {
            // Query reference
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
        })}
      </>
    );
  }
}
