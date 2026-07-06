'use client';

/**
 * NumberQueryEditor — the FULL shared SqlEditor (syntax highlighting, format, SQL validation, and
 * schema/@reference autocomplete) for editing an inline `<Number>`'s query. It renders in a
 * light-DOM Dialog at the StoryView level, NOT in the story's footnote popover: the popover lives
 * in a shadow root, where Monaco's floating widgets (suggest/hover) mis-anchor. Apply hands the new
 * query back via the request's `apply` (which writes it onto the body placeholder + re-runs live).
 */
import { useState } from 'react';
import { Dialog, Portal, Box, Button, HStack } from '@chakra-ui/react';
import SqlEditor from '@/components/query-builder/SqlEditor';
import { useContext as useSchemaContext } from '@/lib/hooks/useContext';
import { useConnections } from '@/lib/hooks/useConnections';
import type { NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';

export default function NumberQueryEditor({ request, filePath, onClose }: {
  request: NumberQueryEditRequest | null;
  filePath?: string;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={!!request} onOpenChange={(e: { open: boolean }) => { if (!e.open) onClose(); }} size="xl">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="820px" w="92vw" bg="bg.surface" borderRadius="lg" border="1px solid" borderColor="border.default">
            {request && <EditorBody request={request} filePath={filePath} onClose={onClose} />}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/** Separate body so the schema/connection hooks only run while the editor is actually open. */
function EditorBody({ request, filePath, onClose }: {
  request: NumberQueryEditRequest; filePath?: string; onClose: () => void;
}) {
  const [draft, setDraft] = useState(request.query);
  // Same schema + connection sources the question editor uses → real autocomplete.
  const { databases } = useSchemaContext(filePath || '/org');
  const { connections } = useConnections();
  const connectionType = request.connection ? connections[request.connection]?.metadata?.type : undefined;
  return (
    <>
      <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
        <Dialog.Title fontWeight={700} fontSize="lg">Edit inline number query</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={6} py={5}>
        <Box height="55vh" minH="320px">
          <SqlEditor
            value={draft}
            onChange={setDraft}
            databaseName={request.connection}
            connectionType={connectionType}
            schemaData={databases}
            showFormatButton
            fillHeight
          />
        </Box>
      </Dialog.Body>
      <Dialog.Footer px={6} py={4} borderTop="1px solid" borderColor="border.default">
        <HStack gap={2} justify="flex-end">
          <Button variant="outline" aria-label="cancel number query edit" onClick={onClose}>Cancel</Button>
          <Button colorPalette="teal" aria-label="apply number query edit" onClick={() => { request.apply(draft); onClose(); }}>
            Apply
          </Button>
        </HStack>
      </Dialog.Footer>
    </>
  );
}
