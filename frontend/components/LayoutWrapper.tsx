'use client';

import { Box } from '@chakra-ui/react';
import { ReactNode, Suspense, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import Sidebar from './Sidebar';
import MobileBottomNav from './MobileBottomNav';
import DataPrepBanner from './DataPrepBanner';
import { RecordingProvider } from '@/lib/hooks/useRecordingContext';
import { useRouter } from '@/lib/navigation/use-navigation';
import { endNavigation } from '@/lib/navigation/nav-progress';
import { clearViewStack } from '@/store/uiSlice';
import { selectView } from '@/store/authSlice';
import { viewAtLeast } from '@/lib/view/view-types';

interface LayoutWrapperProps {
  children: ReactNode;
}

export default function LayoutWrapper({ children }: LayoutWrapperProps) {
  const leftSidebarCollapsed = useAppSelector((state) => state.ui.leftSidebarCollapsed);
  const view = useAppSelector(selectView);
  const pathname = usePathname();
  const dispatch = useAppDispatch();

  // Initialize router singleton for Navigate tool
  useRouter();

  // Clear view stack on navigation so overlaid question editors don't persist
  useEffect(() => {
    dispatch(clearViewStack());
    // Route committed — flush updates deferred while the navigation was in flight.
    endNavigation();
  }, [pathname, dispatch]);

  // Public routes that should not show sidebar
  const publicRoutes = ['/login'];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // If it's a public route, render children without sidebar (and without recording)
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Public story shares (/l/...) own their full chrome (no app nav / data-prep banner),
  // but keep RecordingProvider so the embedded chat surface works for guests.
  if (pathname.startsWith('/l/')) {
    return <RecordingProvider>{children}</RecordingProvider>;
  }

  // view >= file: bare embed — render only the page content (no left sidebar,
  // mobile nav, data-prep banner, or sidebar margin). Keep RecordingProvider so
  // file/chat surfaces that depend on its context still work.
  if (viewAtLeast(view, 'file')) {
    return <RecordingProvider>{children}</RecordingProvider>;
  }

  return (
    <RecordingProvider>
      <Suspense fallback={null}>
        <Sidebar />
      </Suspense>
      <MobileBottomNav />
      <Box
        ml={{ base: 0, md: leftSidebarCollapsed ? '72px' : '260px' }} // No margin on mobile
        pb={{ base: '80px', md: 0 }} // Padding bottom for mobile nav
        transition="margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
        minH="100vh"
      >
        <DataPrepBanner />
        {children}
      </Box>
    </RecordingProvider>
  );
}
