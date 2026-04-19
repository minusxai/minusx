import { toaster } from '@/components/ui/toaster';
import { getStore } from '@/store/store';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectDevMode } from '@/store/uiSlice';
import { isAdmin } from '@/lib/auth/role-helpers';

interface ToastOptions {
  title: string;
  description?: string;
  type?: 'info' | 'success' | 'error' | 'warning' | 'loading';
  duration?: number;
}

/**
 * Show a toast notification, but only to admin users
 * Regular users won't see any toasts (silent error handling)
 */
export function showAdminToast(options: ToastOptions) {
  const state = getStore().getState();
  const user = selectEffectiveUser(state);

  if (!user || !isAdmin(user.role)) return;

  // Error/warning toasts only shown when "Show Debug Options" (devMode) is enabled
  if ((options.type === 'error' || options.type === 'warning') && !selectDevMode(state)) return;

  toaster.create({
    title: options.title,
    description: options.description,
    type: options.type || 'info',
    duration: options.duration ?? 5000,
  });
}
