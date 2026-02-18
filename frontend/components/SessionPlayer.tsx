'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, VStack, HStack, Text, Button } from '@chakra-ui/react';
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import { decompressEvents } from '@/lib/recordings-client';
import { SessionRecordingFileContent } from '@/lib/types';
import { deleteFile } from '@/lib/api/file-state';

interface SessionPlayerProps {
  content: SessionRecordingFileContent;
  fileName: string;  // File name (session identifier) - separate from content
  fileId: number;
  onDelete?: () => void;
}

export default function SessionPlayer({ content, fileName, fileId, onDelete }: SessionPlayerProps) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  // Decompress events on mount
  useEffect(() => {
    try {
      setIsLoading(true);
      const decompressed = decompressEvents(content.events);
      setEvents(decompressed);
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to decompress events:', err);
      setError('Failed to load recording. The file may be corrupted.');
      setIsLoading(false);
    }
  }, [content.events]);

  // Initialize rrweb player
  useEffect(() => {
    if (!playerContainerRef.current || events.length === 0 || isLoading) return;

    const player = new rrwebPlayer({
      target: playerContainerRef.current,
      props: {
        events,
        width: 1024,
        height: 768,
        autoPlay: false,
        showController: true,
        speed: 1,
      },
    });

    return () => {
      // Cleanup player - rrweb-player may not have a destroy method
      try {
        if (player && typeof (player as any).$destroy === 'function') {
          (player as any).$destroy();
        }
      } catch (err) {
        console.error('Error destroying player:', err);
      }
    };
  }, [events, isLoading]);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this recording? This cannot be undone.')) {
      return;
    }

    try {
      await deleteFile({ fileId });

      if (onDelete) {
        onDelete();
      }
    } catch (err) {
      console.error('Failed to delete recording:', err);
      alert('Failed to delete recording. Please try again.');
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <Box p={6}>
        <Text>Loading recording...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={6}>
        <VStack align="start" gap={4}>
          <Text color="accent.danger" fontWeight="600">
            {error}
          </Text>
          {onDelete && (
            <Button size="sm" colorPalette="red" onClick={handleDelete}>
              Delete Recording
            </Button>
          )}
        </VStack>
      </Box>
    );
  }

  // Show message if no events
  if (events.length === 0) {
    return (
      <Box p={6}>
        <VStack align="stretch" gap={6}>
          {/* Metadata */}
          <HStack justify="space-between" align="start">
            <VStack align="start" gap={2}>
              <Text fontSize="2xl" fontWeight="600">
                {fileName}
              </Text>
              <HStack gap={4} fontSize="sm" color="fg.muted">
                <Text>
                  Duration: {formatDuration(content.metadata.duration)}
                </Text>
                <Text>Events: {content.metadata.eventCount}</Text>
                <Text>
                  Page: {content.metadata.pageType}
                </Text>
                <Text>
                  Recorded: {new Date(content.metadata.recordedAt).toLocaleString()}
                </Text>
              </HStack>
            </VStack>
            {onDelete && (
              <Button size="sm" colorPalette="red" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </HStack>

          {/* No events message */}
          <Box
            p={8}
            borderRadius="md"
            bg="bg.muted"
            borderWidth="1px"
            borderColor="border.default"
          >
            <VStack gap={3}>
              <Text fontSize="lg" fontWeight="600" color="fg.muted">
                No Recording Data
              </Text>
              <Text fontSize="sm" color="fg.muted" textAlign="center">
                This recording has no events. It may have been stopped before any events were captured.
              </Text>
            </VStack>
          </Box>
        </VStack>
      </Box>
    );
  }

  return (
    <Box p={6}>
      <VStack align="stretch" gap={6}>
        {/* Metadata */}
        <HStack justify="space-between" align="start">
          <VStack align="start" gap={2}>
            <Text fontSize="2xl" fontWeight="600">
              {fileName}
            </Text>
            <HStack gap={4} fontSize="sm" color="fg.muted">
              <Text>
                Duration: {formatDuration(content.metadata.duration)}
              </Text>
              <Text>Events: {content.metadata.eventCount}</Text>
              <Text>
                Page: {content.metadata.pageType}
              </Text>
              <Text>
                Recorded: {new Date(content.metadata.recordedAt).toLocaleString()}
              </Text>
            </HStack>
          </VStack>
          {onDelete && (
            <Button size="sm" colorPalette="red" onClick={handleDelete}>
              Delete
            </Button>
          )}
        </HStack>

        {/* Player */}
        <Box
          ref={playerContainerRef}
          borderRadius="md"
          overflow="hidden"
          boxShadow="lg"
          bg="bg.surface"
        />
      </VStack>
    </Box>
  );
}
