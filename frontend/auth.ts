import { createAuthConfig } from '@/lib/auth/auth-factory';

export const { handlers, signIn, signOut, auth } = createAuthConfig();
