'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { selectFile } from '@/store/filesSlice';
import CreateMenu from './CreateMenu';

interface MobileNewFileSheetProps {
  onClose: () => void;
}

export default function MobileNewFileSheet({ onClose }: MobileNewFileSheetProps) {
  const pathname = usePathname();

  // Extract file ID from pathname if on file page
  const fileIdMatch = pathname.match(/^\/f\/(\d+)/);
  const currentFileId = fileIdMatch ? parseInt(fileIdMatch[1], 10) : null;

  // Get current file using selector (only if on file page)
  const currentFile = useAppSelector(state =>
    currentFileId ? selectFile(state, currentFileId) : undefined
  );

  // Extract current path for folder modal and new files
  const currentPath = useMemo(() => {
    if (pathname.startsWith('/p/')) {
      return pathname.replace('/p', '');
    }
    if (currentFile?.path) {
      const pathParts = currentFile.path.split('/');
      pathParts.pop();
      return pathParts.join('/') || '/';
    }
    return '/';
  }, [pathname, currentFile]);

  return <CreateMenu variant="sheet" currentPath={currentPath} onClose={onClose} />;
}
