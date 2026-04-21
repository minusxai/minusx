'use client';

import { Box } from '@chakra-ui/react';
import { ReactNode, Suspense, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import Sidebar from './Sidebar';
import MobileBottomNav from './MobileBottomNav';
import { RecordingProvider } from '@/lib/hooks/useRecordingContext';
import { useRouter } from '@/lib/navigation/use-navigation';
import { clearViewStack } from '@/store/uiSlice';

interface LayoutWrapperProps {
  children: ReactNode;
}

export default function LayoutWrapper({ children }: LayoutWrapperProps) {
  const leftSidebarCollapsed = useAppSelector((state) => state.ui.leftSidebarCollapsed);
  const pathname = usePathname();
  const dispatch = useAppDispatch();

  // Initialize router singleton for Navigate tool
  useRouter();

  // Clear view stack on navigation so overlaid question editors don't persist
  useEffect(() => {
    dispatch(clearViewStack());
  }, [pathname, dispatch]);

  // Public routes that should not show sidebar
  const publicRoutes = ['/login'];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // If it's a public route, render children without sidebar (and without recording)
  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <RecordingProvider>
      <Suspense fallback={null}>
        <Sidebar />
      </Suspense>
      <MobileBottomNav />
      <Box
        ml={{ base: 0, md: leftSidebarCollapsed ? '72px' : '300px' }} // No margin on mobile
        pb={{ base: '80px', md: 0 }} // Padding bottom for mobile nav
        transition="margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
        minH="100vh"
      >
        {children}
      </Box>
    </RecordingProvider>
  );
}
