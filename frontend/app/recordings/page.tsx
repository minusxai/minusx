'use client';

import { useState, useEffect } from 'react';
import { Box, VStack, HStack, Text, Spinner, Table, IconButton } from '@chakra-ui/react';
import { LuPlay, LuTrash2 } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Tooltip } from '@/components/ui/tooltip';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

interface RecordingSummary {
  id: number;
  name: string;
  duration: number;
  createdAt: string;
  pageType: string;
  eventCount: number;
  size: number;
}

export default function RecordingsPage() {
  const router = useRouter();
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecordings();
  }, []);

  const fetchRecordings = async () => {
    try {
      setLoading(true);
      const data = await fetchWithCache('/api/recordings', {
        method: 'GET',
        cacheStrategy: API.recordings.list.cache,
      });
      setRecordings(data.recordings);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch recordings:', err);
      setError('Failed to load recordings');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this recording? This cannot be undone.')) {
      return;
    }

    try {
      await fetchWithCache(`/api/files/${id}`, {
        method: 'DELETE',
        cacheStrategy: API.files.delete.cache,
      });

      // Refresh list
      fetchRecordings();
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

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minH="400px">
        <Spinner size="xl" />
      </Box>
    );
  }

  return (
    <Box p={8} maxW="1400px" mx="auto">
      <VStack align="stretch" gap={6}>
        {/* Header */}
        <Box>
          <Text fontSize="3xl" fontWeight="600" mb={2}>
            Session Recordings
          </Text>
          <Text color="fg.muted">
            View and manage your recorded sessions
          </Text>
        </Box>

        {/* Error */}
        {error && (
          <Box p={4} bg="accent.danger" borderRadius="md" borderWidth="1px" borderColor="accent.danger">
            <Text color="accent.danger">{error}</Text>
          </Box>
        )}

        {/* Empty state */}
        {!error && recordings.length === 0 && (
          <Box p={12} textAlign="center" borderWidth="1px" borderRadius="md" borderColor="border.default">
            <Text fontSize="lg" color="fg.muted">
              No recordings yet
            </Text>
            <Text fontSize="sm" color="fg.subtle" mt={2}>
              Start a recording from the sidebar to begin
            </Text>
          </Box>
        )}

        {/* Table */}
        {!error && recordings.length > 0 && (
          <Box borderWidth="1px" borderRadius="md" overflow="hidden">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Duration</Table.ColumnHeader>
                  <Table.ColumnHeader>Events</Table.ColumnHeader>
                  <Table.ColumnHeader>Size</Table.ColumnHeader>
                  <Table.ColumnHeader>Page</Table.ColumnHeader>
                  <Table.ColumnHeader>Date</Table.ColumnHeader>
                  <Table.ColumnHeader width="100px">Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {recordings.map((recording) => (
                  <Table.Row
                    key={recording.id}
                    _hover={{ bg: 'bg.muted', cursor: 'pointer' }}
                    onClick={() => router.push(`/f/${recording.id}`)}
                  >
                    <Table.Cell>
                      <Text fontWeight="500">{recording.name}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontFamily="mono" fontSize="sm">
                        {formatDuration(recording.duration)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontFamily="mono" fontSize="sm">
                        {recording.eventCount}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontFamily="mono" fontSize="sm">
                        {formatSize(recording.size)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" textTransform="capitalize">
                        {recording.pageType}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="fg.muted">
                        {formatDate(recording.createdAt)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <HStack gap={2}>
                        <Tooltip content="Play recording">
                          <IconButton
                            size="sm"
                            variant="ghost"
                            aria-label="Play"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/f/${recording.id}`);
                            }}
                          >
                            <LuPlay />
                          </IconButton>
                        </Tooltip>
                        <Tooltip content="Delete recording">
                          <IconButton
                            size="sm"
                            variant="ghost"
                            colorPalette="red"
                            aria-label="Delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(recording.id);
                            }}
                          >
                            <LuTrash2 />
                          </IconButton>
                        </Tooltip>
                      </HStack>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        )}
      </VStack>
    </Box>
  );
}
