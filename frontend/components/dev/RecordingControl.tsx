'use client';

import { useState } from 'react';
import { Box, IconButton, Menu } from '@chakra-ui/react';
import { LuCircle, LuSquare, LuList } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useRecording } from '@/lib/hooks/useRecordingContext';
import { useAppSelector } from '@/store/hooks';
import { isAdmin } from '@/lib/auth/role-helpers';

/**
 * Simple UI control for session recording (Admin only)
 * All recording logic is handled by the global useRecordingManager hook
 */
export default function RecordingControl() {
  const router = useRouter();
  const { startRecording, stopRecording, isRecording } = useRecording();
  const [isProcessing, setIsProcessing] = useState(false);
  const user = useAppSelector((state) => state.auth.user);

  // Only show to admins
  if (!user || !isAdmin(user.role)) {
    return null;
  }

  const handleStart = async () => {
    try {
      setIsProcessing(true);
      await startRecording('explore');
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Failed to start recording. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    try {
      setIsProcessing(true);
      await stopRecording();
    } catch (error) {
      console.error('Failed to stop recording:', error);
      alert('Failed to stop recording. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleViewRecordings = () => {
    router.push('/recordings');
  };

  return (
    <Box position="relative">
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            disabled={isProcessing}
          >
            {isRecording ? (
              <Box color="accent.danger">
                <LuSquare />
              </Box>
            ) : (
              <LuCircle />
            )}
          </IconButton>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="start" onClick={handleStart} disabled={isRecording || isProcessing}>
            <LuCircle />
            Start Recording
          </Menu.Item>
          <Menu.Item value="stop" onClick={handleStop} disabled={!isRecording || isProcessing}>
            <LuSquare />
            Stop Recording
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item value="view" onClick={handleViewRecordings}>
            <LuList />
            View Recordings
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      {/* Red dot indicator when recording */}
      {isRecording && (
        <Box
          position="absolute"
          top="-2px"
          right="-2px"
          w="8px"
          h="8px"
          bg="accent.danger"
          borderRadius="full"
          animation="pulse 2s ease-in-out infinite"
        />
      )}
    </Box>
  );
}
