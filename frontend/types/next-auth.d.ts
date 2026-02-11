/**
 * Type augmentation for NextAuth
 * Extends default User, Session, and JWT types with custom fields
 */
import { DefaultSession } from "next-auth"
import { UserRole } from "@/lib/types"

declare module "next-auth" {
  /**
   * Extended user object with role, userId, and company info
   */
  interface User {
    userId: number;  // Required - every authenticated user has an ID
    role?: UserRole;
    home_folder: string;
    companyId: number;  // Required - enforced by withAuth middleware
    companyName?: string;
    tokenVersion?: number;
    createdAt?: number;  // Unix timestamp
  }

  /**
   * Extended session object
   */
  interface Session {
    user: {
      userId: number;  // Required - every authenticated user has an ID
      role?: UserRole;
      home_folder: string;
      companyId: number;  // Required - enforced by withAuth middleware
      companyName?: string;
      tokenVersion?: number;
      createdAt?: number;  // Unix timestamp
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  /**
   * Extended JWT token
   */
  interface JWT {
    userId: number;  // Required - every authenticated user has an ID
    role?: UserRole;
    home_folder: string;
    companyId: number;  // Required - enforced by withAuth middleware
    companyName?: string;
    tokenVersion?: number;
    createdAt?: number;  // Unix timestamp
  }
}
