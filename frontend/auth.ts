import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { UserDB } from '@/lib/database/user-db'
import { CompanyDB } from '@/lib/database/company-db'
import { verifyPassword } from '@/lib/auth/password-utils'
import { IS_DEV } from '@/lib/constants'
import { UserRole, UserState } from '@/lib/types'
import { isAdmin } from '@/lib/auth/role-helpers'
import { getCompanyNameById } from '@/lib/data/configs.server'
import { ADMIN_PWD } from '@/lib/config'

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        company: { label: "Company", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        try {
          let companyName: string;

          // If company not provided, check for default company (single-tenant mode)
          if (!credentials.company) {
            const defaultCompany = await CompanyDB.getDefaultCompany();

            if (!defaultCompany) {
              console.log('No company provided and not in single-tenant mode');
              return null;
            }

            companyName = defaultCompany.name;
          } else {
            companyName = credentials.company as string;
          }

          // Find company by name
          const company = await CompanyDB.getByName(companyName)

          if (!company) {
            console.log('Company not found:', companyName)
            return null
          }

          // Query users table within company
          const user = await UserDB.getByEmailAndCompany(
            credentials.email as string,
            company.id
          )

          if (!user) {
            console.log('User not found:', credentials.email, 'in company:', company.name)
            return null
          }

          // Dev-only: Allow admins without password to login with email as password
          if (IS_DEV && credentials.password === user.email) {
            console.log('⚠️  Dev mode: User logged in using email as password')
          } else if (!user.password_hash) {
            if (isAdmin(user.role) && ADMIN_PWD && credentials.password === ADMIN_PWD) {
              console.log('⚠️  Prod mode: Admin logged in using ADMIN_PWD')
            } else {
              return null
            }
          } else {
            // Verify password
            const isValid = await verifyPassword(
              credentials.password as string,
              user.password_hash
            )

            if (!isValid) {
              console.log('Invalid password for user:', credentials.email)
              return null
            }
          }

          // Note: 2FA verification happens in the frontend flow before signIn() is called
          // The check-2fa and verify-otp endpoints handle OTP validation via JWT
          // If signIn() is called, we trust that 2FA was already verified (if required)

          // Return user object with userId and company info
          return {
            id: user.email,  // Keep email as id for NextAuth compatibility
            userId: user.id,  // Add integer user ID
            email: user.email,
            name: user.name,
            role: user.role,
            home_folder: user.home_folder,  // Add home_folder to JWT
            companyId: company.id,
            companyName: company.name,
          }
        } catch (error) {
          console.error('Auth error:', error)
          return null
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Import constants from shared location
      const { CURRENT_TOKEN_VERSION } = await import('@/lib/auth/auth-constants');

      // On sign in, add user data to token
      if (user) {
        token.userId = user.userId
        token.email = user.email
        token.name = user.name
        token.role = user.role
        token.home_folder = user.home_folder  // Store home_folder in JWT
        token.companyId = user.companyId
        token.companyName = user.companyName

        // Token versioning and timestamp for future invalidation logic
        token.tokenVersion = CURRENT_TOKEN_VERSION  // Increment this when JWT schema changes
        token.createdAt = Math.floor(Date.now() / 1000)  // Unix timestamp
        // Note: JWT 'iat' (issued-at) is automatically added by NextAuth
      }

      // Handle session updates
      if (trigger === 'update' && session) {
        // Auto-refresh old tokens when updated
        if (session.refreshToken) {
          console.log('[Auth] Refreshing old token to latest version');

          // Fetch fresh user data from DB
          if (token.userId && token.companyId) {
            try {
              const freshUser = await UserDB.getById(token.userId as number, token.companyId as number);
              if (freshUser) {
                token.home_folder = freshUser.home_folder;
                token.role = freshUser.role;
                token.tokenVersion = CURRENT_TOKEN_VERSION;
                token.createdAt = Math.floor(Date.now() / 1000);
                console.log('[Auth] Token refreshed successfully');
              }
            } catch (error) {
              console.error('[Auth] Failed to refresh token:', error);
            }
          }
        }
      }

      return token
    },
    async session({ session, token }) {
      // Add user data to session
      if (token && session.user) {
        session.user.userId = token.userId as number
        session.user.email = token.email as string
        session.user.name = token.name as string
        session.user.role = token.role as UserRole | undefined
        session.user.home_folder = token.home_folder as string  // home_folder is now required for all users
        session.user.companyId = token.companyId as number
        session.user.companyName = token.companyName as string
        session.user.tokenVersion = token.tokenVersion as number | undefined
        session.user.createdAt = token.createdAt as number | undefined
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
  trustHost: true, // Allow requests from any subdomain (required for subdomain-based company routing)
})
