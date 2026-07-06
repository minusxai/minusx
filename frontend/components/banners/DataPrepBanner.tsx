'use client';

/**
 * DataPrepBanner — progress indicator while a freshly-created tutorial workspace
 * finishes copying its mxfood sample data.
 *
 * Registration seeds the tutorial data fire-and-forget (lib/modules/auth/index.ts),
 * so right after a company is created the tutorial briefly has no queryable data.
 * This polls /api/orgs/seed-status and shows "preparing sample data…" until ready,
 * then refreshes server data (so connections pick up their tables) and hides.
 * Only relevant in tutorial mode; renders nothing otherwise.
 */
import { useEffect, useRef, useState } from 'react';
import { HStack, Spinner, Text } from '@chakra-ui/react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useAppSelector } from '@/store/hooks';

interface SeedStatus {
  ready: boolean;
  present: number;
  total: number;
}

export default function DataPrepBanner() {
  const mode = useAppSelector((s) => s.auth.user?.mode) ?? 'org';
  const router = useRouter();
  const [status, setStatus] = useState<SeedStatus | null>(null);
  const sawNotReady = useRef(false);

  useEffect(() => {
    if (mode !== 'tutorial') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/orgs/seed-status?mode=${mode}`);
        if (res.ok) {
          const data: SeedStatus | undefined = (await res.json())?.data;
          if (!active) return;
          setStatus(data ?? null);
          if (data?.ready) {
            // Only refresh if the data JUST became ready (we previously saw it
            // not-ready) — so the connection picks up its new tables. If it was
            // already ready on first poll (the common case), don't churn.
            if (sawNotReady.current) router.refresh();
            return; // stop polling
          }
          sawNotReady.current = true;
        }
      } catch {
        /* transient — keep polling */
      }
      timer = setTimeout(poll, 3000);
    };

    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [mode, router]);

  if (mode !== 'tutorial' || !status || status.ready) return null;

  return (
    <HStack
      aria-label="Preparing sample data"
      gap={2}
      px={4}
      py={2}
      bg="accent.teal/10"
      borderBottom="1px solid"
      borderColor="border.muted"
      fontSize="sm"
      color="fg.muted"
    >
      <Spinner size="sm" color="accent.teal" />
      <Text fontFamily="mono">
        Preparing sample data… ({status.present}/{status.total} tables ready)
      </Text>
    </HStack>
  );
}
