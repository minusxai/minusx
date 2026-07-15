'use client';

import { use, useEffect, useRef, Suspense } from 'react';
import { notFound } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { Center, Spinner } from '@chakra-ui/react';
import { FileType, getSupportedFileTypes } from '@/lib/ui/file-metadata';
import { createDraftFile } from '@/lib/file-state/file-state';
import { useRouter } from '@/lib/navigation/use-navigation';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import { useConfigs } from '@/lib/hooks/useConfigs';
import DatasetContainerV2 from '@/components/containers/DatasetContainerV2';

interface NewFilePageProps {
  params: Promise<{ type: string }>;
}

function NewFileRedirect({ type }: { type: FileType }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const creating = useRef(false);

  useEffect(() => {
    if (creating.current) return;
    creating.current = true;

    const databaseName = searchParams.get('databaseName') ?? undefined;
    const queryB64 = searchParams.get('queryB64') ?? undefined;
    let query: string | undefined;
    if (queryB64) {
      try {
        const binaryStr = atob(queryB64);
        const bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
        query = new TextDecoder().decode(bytes);
      } catch {
        // ignore decode errors
      }
    }

    createDraftFile(type, { databaseName, query })
      .then(id => {
        router.replace(preserveModeParam(`/f/${id}`));
      })
      .catch(() => {
        router.replace(preserveModeParam('/'));
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Center h="100vh" bg="bg.canvas">
      <Spinner size="lg" />
    </Center>
  );
}

export default function NewFilePage({ params }: NewFilePageProps) {
  const { type: typeParam } = use(params);
  const type = typeParam as FileType;
  const { config } = useConfigs();

  if (!getSupportedFileTypes(config.supportedFileTypes).includes(type)) {
    notFound();
  }

  // Datasets are upload-first: no draft doc exists until the upload registers
  // (they're LIVE on create), so render the create form directly instead of
  // the draft-then-redirect flow.
  if (type === 'dataset') {
    return (
      <Suspense fallback={<Center h="100vh" bg="bg.canvas"><Spinner size="lg" /></Center>}>
        <DatasetContainerV2 fileId={-1} mode="create" />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Center h="100vh" bg="bg.canvas"><Spinner size="lg" /></Center>}>
      <NewFileRedirect type={type} />
    </Suspense>
  );
}
