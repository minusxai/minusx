/**
 * Custom Link component that automatically preserves `as_user` and `mode` parameters
 *
 * This component wraps Next.js's Link and ensures that the impersonation
 * and mode parameters are preserved across all link-based navigation.
 */

'use client';

import NextLink from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import { forwardRef, ComponentProps } from 'react';

/**
 * Enhanced Link component with automatic parameter preservation
 */
export const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(
  ({ href, ...props }, ref) => {
    // Preserve both as_user and mode params if href is a string
    const preservedHref = typeof href === 'string' ? preserveParams(href) : href;

    return <NextLink ref={ref} href={preservedHref} {...props} />;
  }
);

Link.displayName = 'Link';
