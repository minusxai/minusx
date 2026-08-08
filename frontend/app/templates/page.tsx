'use client';

/**
 * Templates — what ships with the app, and how to make it yours.
 *
 * A page rather than a folder in the file tree: these are code, and a folder
 * would promise a context file, an owner, edit/move/delete and a place in
 * recipe resolution that none of them can keep. Overriding and extending IS the
 * file system's job — copy one here and the normal shadowing rules apply.
 *
 * `?tab=` selects the section so more template kinds (story components, themes)
 * slot in without a new route, matching the `/settings?tab=` convention.
 */
import { Suspense } from 'react';
import { Box, Flex, Heading, Text } from '@chakra-ui/react';
import { useSearchParams } from 'next/navigation';
import Breadcrumb from '@/components/file-browser/Breadcrumb';
import TemplatesContainerV2 from '@/components/containers/TemplatesContainerV2';

const TABS = [
  { id: 'visualizations', label: 'Visualizations', blurb: 'Chart recipes that ship with the app. Copy one to get an editable version in your workspace, or create a recipe of the same name in a folder to override it there.' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function TemplatesPageInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'visualizations';
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <Box as="main" w="100%" maxW="1200px" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 5, md: 8 }} pb={8}>
      <Box mb={{ base: 2, md: 4 }}>
        <Breadcrumb items={[{ label: 'Templates' }, { label: active.label }]} />
      </Box>
      <Heading as="h1" fontFamily="mono" size="2xl" mb={1}>{active.label}</Heading>
      <Text fontSize="sm" color="fg.muted" mb={5} maxW="720px">{active.blurb}</Text>
      <Flex minH="0" flex="1">
        {tab === 'visualizations' && <TemplatesContainerV2 />}
      </Flex>
    </Box>
  );
}

export default function TemplatesPage() {
  // useSearchParams needs a Suspense boundary for the static shell.
  return (
    <Suspense fallback={null}>
      <TemplatesPageInner />
    </Suspense>
  );
}
