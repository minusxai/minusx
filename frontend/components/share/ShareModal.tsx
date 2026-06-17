'use client';

import { useEffect, useState } from 'react';
import {
  Box, Button, CloseButton, Dialog, HStack, Icon, IconButton, Input, Portal, Spinner, Text, VStack,
} from '@chakra-ui/react';
import { LuCopy, LuCheck, LuTrash2, LuLink, LuRefreshCw } from 'react-icons/lu';
import type { ShareRecord } from '@/lib/auth/share-tokens';
import { createShareLink, listShareLinks, revokeShareLink } from '@/lib/api/share-links';
import { captureStoryPreview } from '@/lib/og/capture-story-preview';
import { useFile } from '@/lib/hooks/file-state-hooks';

interface ShareModalProps {
  fileId: number;
  fileName: string;
  isOpen: boolean;
  onClose: () => void;
}

function shareUrl(shareableId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/l/${shareableId}`;
}

/** Admin "Make public" modal: create, copy, and revoke public links for a story. */
export default function ShareModal({ fileId, fileName, isOpen, onClose }: ShareModalProps) {
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [previewBust, setPreviewBust] = useState(0); // cache-bust the preview <img> on re-capture
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const { fileState } = useFile(fileId) ?? {};
  const storedUrl = (fileState?.meta as { preview?: { url?: string } } | null | undefined)?.preview?.url;
  const previewUrl = freshUrl ?? storedUrl ?? null;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listShareLinks(fileId)
      .then((s) => { if (!cancelled) setShares(s); })
      .catch(() => { if (!cancelled) setError('Could not load share links.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, fileId]);

  const live = shares.filter((s) => !s.revoked);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await createShareLink(fileId);
      setShares((prev) => [...prev, created.record]);
      // Now that it's public, compose + store the social-share card from the rendered story.
      const url = await captureStoryPreview(fileId);
      if (url) setFreshUrl(url);
      setPreviewBust((b) => b + 1);
    } catch {
      setError('Could not create a link.');
    } finally {
      setCreating(false);
    }
  };

  const handleRefreshPreview = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const url = await captureStoryPreview(fileId);
      if (url) setFreshUrl(url);
      else setError('Could not refresh the preview — open the story, then try again.');
      setPreviewBust((b) => b + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopy = async (shareableId: string) => {
    await navigator.clipboard.writeText(shareUrl(shareableId));
    setCopied(shareableId);
    window.setTimeout(() => setCopied((c) => (c === shareableId ? null : c)), 1500);
  };

  const handleRevoke = async (nonce: string) => {
    setError(null);
    try {
      await revokeShareLink(fileId, nonce);
      setShares((prev) => prev.map((s) => (s.nonce === nonce ? { ...s, revoked: true } : s)));
    } catch {
      setError('Could not revoke the link.');
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => { if (!e.open) onClose(); }}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.surface" borderRadius="lg" border="1px solid" borderColor="border.default" shadow="xl" p={0} my={12} maxW="560px">
            <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
              <Dialog.Title fontSize="lg" fontWeight="700" fontFamily="mono">Make public</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body px={6} py={5}>
              <Text fontSize="sm" color="fg.muted" mb={4}>
                Anyone with a link can view <Text as="span" fontWeight="600">"{fileName}"</Text> and its live charts.
              </Text>

              {error && <Text fontSize="xs" color="accent.danger" mb={3}>{error}</Text>}

              {loading ? (
                <HStack justify="center" py={6}><Spinner size="md" /></HStack>
              ) : live.length === 0 ? (
                <Text fontSize="sm" color="fg.subtle" mb={4}>No public links yet.</Text>
              ) : (
                <VStack gap={2} align="stretch" mb={4}>
                  {live.map((s) => (
                    <HStack key={s.nonce} gap={2} p={2} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.subtle">
                      <Icon as={LuLink} boxSize={4} color="fg.muted" flexShrink={0} />
                      <Input
                        aria-label="Share link"
                        value={shareUrl(s.shareableId)}
                        readOnly
                        size="xs"
                        fontFamily="mono"
                        flex="1"
                        onFocus={(e) => e.target.select()}
                      />
                      <IconButton aria-label="Copy link" size="xs" variant="ghost" onClick={() => handleCopy(s.shareableId)}>
                        {copied === s.shareableId ? <LuCheck color="green" /> : <LuCopy />}
                      </IconButton>
                      <IconButton aria-label="Revoke link" size="xs" variant="ghost" color="accent.danger" onClick={() => handleRevoke(s.nonce)}>
                        <LuTrash2 />
                      </IconButton>
                    </HStack>
                  ))}
                </VStack>
              )}

              {live.length > 0 && (
                <VStack gap={2} align="stretch" mb={4}>
                  <HStack justify="space-between">
                    <Text fontSize="xs" fontWeight="600" color="fg.muted">Link preview</Text>
                    <Button aria-label="Refresh preview" size="xs" variant="ghost" onClick={handleRefreshPreview} loading={refreshing}>
                      <LuRefreshCw /> Refresh
                    </Button>
                  </HStack>
                  {previewUrl ? (
                    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden" bg="bg.subtle">
                      {/* The composed card stored for this story (cache-busted on refresh). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${previewUrl}${previewUrl.includes('?') ? '&' : '?'}v=${previewBust}`}
                        alt="Social share preview"
                        style={{ width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', display: 'block' }}
                      />
                    </Box>
                  ) : (
                    <Text fontSize="xs" color="fg.subtle">Generating preview…</Text>
                  )}
                </VStack>
              )}

              <Button aria-label="Create link" onClick={handleCreate} loading={creating} colorPalette="blue" size="sm">
                <LuLink /> Create link
              </Button>
            </Dialog.Body>
            <Dialog.Footer px={6} py={4} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
              <Button px={4} variant="outline" fontFamily="mono" onClick={onClose}>Done</Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" top={4} right={4} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
