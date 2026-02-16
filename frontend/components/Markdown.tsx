'use client';

import { Box, Text } from '@chakra-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { LuChartColumnIncreasing, LuFilePlus2, LuRocket } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { FileType } from '@/lib/types';
import { ReactNode, useMemo, useState } from 'react';
import { useAppSelector } from '@/store/hooks';
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
        fileName={queryData.fileName || 'Query Result'}
        content={localContent}
        queryData={queryResult}
        queryLoading={false}
        queryError={null}
        queryStale={false}
        editMode={false}
        isDirty={false}
        isSaving={false}
        saveError={null}
        onChange={handleContentChange}
        onMetadataChange={() => {}}
        onExecute={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
        onEditModeChange={() => {}}
      />
    </Box>
  );
}

// Custom link button for internal links
function LinkButton({ href, icon, children, variant, bg = 'accent.primary' }: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  variant: 'default' | 'compact' | 'presentation';
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
      fontSize={variant === 'compact' ? 'xs' : 'sm'}
      fontWeight="500"
      color="white"
      textDecoration="none"
      transition="all 0.15s ease"
      _hover={{ opacity: 0.8 }}
    >
      <Link href={href} style={{ textDecoration: 'none' }}>
        {icon}
        {children}
      </Link>
    </Box>
  );
}

interface MarkdownProps {
  children: string;
  variant?: 'default' | 'compact' | 'presentation';
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  queries?: Record<string, ReportQueryResult>;  // Query results for {{query:id}} references
}

/**
 * Unified Markdown component with consistent styling across the app.
 *
 * Variants:
 * - default: Standard markdown styling for documents and content blocks
 * - compact: Smaller fonts and spacing for chat messages and previews
 * - presentation: Large, bold fonts for slides and presentations
 */
export default function Markdown({
  children,
  variant = 'default',
  textAlign = 'left',
  textColor,
  queries
}: MarkdownProps) {
  // Variant-specific styles
  const variantStyles = {
    default: {
      h1: { fontSize: '2em', fontWeight: '800', mb: 3, mt: 2, lineHeight: '1.2', letterSpacing: '-0.03em' },
      h2: { fontSize: '1.5em', fontWeight: '700', mb: 3, mt: 2, lineHeight: '1.3', letterSpacing: '-0.02em' },
      h3: { fontSize: '1.17em', fontWeight: '700', mb: 2, mt: 2, lineHeight: '1.4' },
      h4: { fontSize: '1em', fontWeight: '700', mb: 2, mt: 2 },
      p: { fontSize: 'sm', lineHeight: '1.6' },
      code: { fontSize: 'sm' },
      pre: { mb: 3, p: 3 },
      list: { ml: 6, mb: 3, fontSize: 'sm', lineHeight: '1.6' },
      li: { mb: 0.5 },
      table: { mb: 4, fontSize: 'sm', mt: 3 },
      th: { py: 3, px: 4 },
      td: { py: 3, px: 4 },
    },
    compact: {
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
    },
    presentation: {
      h1: { fontSize: '4xl', fontWeight: '900', mb: 4, mt: 2, lineHeight: '1.1', letterSpacing: '-0.02em' },
      h2: { fontSize: '3xl', fontWeight: '800', mb: 3, mt: 2, lineHeight: '1.2', letterSpacing: '-0.01em' },
      h3: { fontSize: '2xl', fontWeight: '700', mb: 3, mt: 2, lineHeight: '1.3' },
      h4: { fontSize: 'xl', fontWeight: '700', mb: 2, mt: 2 },
      p: { fontSize: 'lg', lineHeight: '1.7' },
      code: { fontSize: 'md' },
      pre: { mb: 4, p: 4 },
      list: { ml: 6, mb: 3, fontSize: 'lg', lineHeight: '1.7' },
      li: { mb: 1.5 },
      table: { mb: 5, fontSize: 'md', mt: 4 },
      th: { py: 4, px: 5 },
      td: { py: 3, px: 5 },
    },
  };

  const styles = variantStyles[variant];

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
          <LinkButton href={withMode(href)} icon={<LuChartColumnIncreasing size={14} />} variant={variant}>
            {children}
          </LinkButton>
        );
      }
      if (isExplorePageLink(href)) {
        return (
          <LinkButton href={withMode(href)} icon={<LuRocket size={14} />} variant={variant} bg="accent.teal">
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
            variant={variant}
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
          letterSpacing: 'letterSpacing' in styles.h1 ? styles.h1.letterSpacing : undefined,
        },
        '& h2': {
          fontSize: styles.h2.fontSize,
          fontWeight: styles.h2.fontWeight,
          marginBottom: `${styles.h2.mb * 0.25}rem`,
          marginTop: `${styles.h2.mt * 0.25}rem`,
          lineHeight: styles.h2.lineHeight,
          letterSpacing: 'letterSpacing' in styles.h2 ? styles.h2.letterSpacing : undefined,
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
          fontWeight: variant === 'presentation' ? '900' : '800',
          color: variant === 'presentation' ? 'var(--chakra-colors-accent-secondary)' : 'inherit',
        },
        '& em': {
          fontStyle: 'italic',
          color: 'var(--chakra-colors-fg-emphasized)',
        },
        '& code': {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: styles.code.fontSize,
          backgroundColor: variant === 'presentation' ? 'var(--chakra-colors-accent-secondary)' : 'var(--chakra-colors-bg-muted)',
          color: variant === 'presentation' ? 'white' : 'inherit',
          padding: variant === 'presentation' ? '0.25rem 0.5rem' : '0.125rem 0.5rem',
          borderRadius: variant === 'presentation' ? '0.375rem' : '0.125rem',
          fontWeight: variant === 'presentation' ? '600' : '500',
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
          marginTop: variant === 'compact' ? '0.25rem' : '0.5rem',
          marginBottom: variant === 'compact' ? '0.25rem' : '0.5rem',
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

  // Parse content and split on query references
  function renderContent() {
    // If no queries, render plain markdown
    if (!queries || Object.keys(queries).length === 0) {
      return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {children}
        </ReactMarkdown>
      );
    }

    // Split content on {{query:id}} pattern
    const queryPattern = /\{\{query:([^}]+)\}\}/g;
    const parts: Array<{ type: 'text' | 'query'; content: string }> = [];
    let lastIndex = 0;
    let match;

    while ((match = queryPattern.exec(children)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: children.slice(lastIndex, match.index)
        });
      }
      // Add the query reference
      parts.push({
        type: 'query',
        content: match[1] // The query ID
      });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < children.length) {
      parts.push({
        type: 'text',
        content: children.slice(lastIndex)
      });
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
          } else {
            // Query reference
            const queryData = queries[part.content];
            if (queryData) {
              return <InlineChart key={index} queryData={queryData} />;
            } else {
              // Query not found - show placeholder
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
