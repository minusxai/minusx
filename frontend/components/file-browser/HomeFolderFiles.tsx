'use client';

import { useEffect, useState } from 'react';
import { Box, Spinner } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { useFolder } from '@/lib/hooks/file-state-hooks';
import FilesList from './FilesList';

/**
 * Compact folder view for the home page — shows the user's home folder contents.
 * Only renders when the user has no recent analytics (e.g. new user).
 */
export default function HomeFolderFiles() {
  const user = useAppSelector(state => state.auth.user);
  const homePath = resolveHomeFolderSync(user?.mode ?? 'org', user?.home_folder ?? '');
  const { files, loading: folderLoading } = useFolder(homePath);

  // Check if user has analytics — if so, don't render (analytics sections handle it)
  const [hasAnalytics, setHasAnalytics] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        setHasAnalytics(json.success && json.data?.recent?.length > 0);
      })
      .catch(() => setHasAnalytics(false));
  }, []);

  // Still loading analytics check — show nothing (analytics sections show skeletons)
  if (hasAnalytics === null) return null;
  // User has analytics — let the RecentQuestions/RecentDashboards sections handle it
  if (hasAnalytics) return null;

  if (folderLoading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" py={8}>
        <Spinner size="md" />
      </Box>
    );
  }

  if (files.length === 0) return null;

  return <FilesList files={files as any} />;
}
