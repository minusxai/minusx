/**
 * Centralized API declarations with types and caching defaults.
 * All client-side API calls should be defined here.
 */

export type CacheStrategy = {
  ttl: number;           // Time to live in ms
  deduplicate: boolean;  // Prevent duplicate in-flight requests
  staleWhileRevalidate?: number;  // Serve stale data while revalidating
};

export type ApiEndpoint<TInput = any, TOutput = any> = {
  url: string | ((input: TInput) => string);  // Static URL or function
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  cache?: CacheStrategy;
  headers?: HeadersInit;
};

// ===== API DECLARATIONS ===== //

export const API = {
  // Files API
  files: {
    search: {
      url: '/api/files/search',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for search (results change frequently)
        deduplicate: true,  // But prevent duplicate in-flight requests
      },
    },
    loadById: {
      url: (id: number) => `/api/files/${id}`,
      method: 'GET',
      cache: {
        ttl: 5 * 60 * 1000,  // 5 minutes
        deduplicate: true,
        staleWhileRevalidate: 10 * 60 * 1000,  // 10 minutes
      },
    },
    list: {
      url: '/api/files',
      method: 'GET',
      cache: {
        ttl: 2 * 60 * 1000,  // 2 minutes
        deduplicate: true,
      },
    },
    save: {
      url: '/api/files',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,  // Allow duplicate saves (user might want to save twice)
      },
    },
    delete: {
      url: (id: number) => `/api/files/${id}`,
      method: 'DELETE',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: true,  // Prevent accidental double deletes
      },
    },
  },

  // Folders API
  folders: {
    loadByPath: {
      url: (path: string) => `/api/folders?path=${encodeURIComponent(path)}`,
      method: 'GET',
      cache: {
        ttl: 2 * 60 * 1000,  // 2 minutes
        deduplicate: true,
      },
    },
    create: {
      url: '/api/folders',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,
      },
    },
  },

  // Connections API
  connections: {
    list: {
      url: '/api/connections',
      method: 'GET',
      cache: {
        ttl: 5 * 60 * 1000,  // 5 minutes
        deduplicate: true,
      },
    },
    test: {
      url: '/api/connections/test',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for test connections
        deduplicate: true,
      },
    },
  },

  // Query API
  query: {
    execute: {
      url: '/api/query',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching (data changes)
        deduplicate: true,  // Prevent duplicate in-flight
      },
    },
  },

  // Autocomplete API
  autocomplete: {
    mentions: {
      url: '/api/autocomplete',
      method: 'POST',
      cache: {
        ttl: 30 * 1000,  // 30 seconds
        deduplicate: true,
      },
    },
    completions: {
      url: '/api/completions',
      method: 'POST',
      cache: {
        ttl: 30 * 1000,  // 30 seconds
        deduplicate: true,
      },
    },
  },

  // Contexts API
  contexts: {
    list: {
      url: '/api/contexts',
      method: 'GET',
      cache: {
        ttl: 5 * 60 * 1000,  // 5 minutes
        deduplicate: true,
      },
    },
  },

  // Configs API
  configs: {
    get: {
      url: '/api/configs',
      method: 'GET',
      cache: {
        ttl: 5 * 60 * 1000,  // 5 minutes
        deduplicate: true,
      },
    },
  },

  // Chat API
  chat: {
    send: {
      url: '/api/chat',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,  // Allow multiple messages
      },
    },
  },

  // Conversations API
  conversations: {
    loadById: {
      url: (id: number) => `/api/conversations/${id}`,
      method: 'GET',
      cache: {
        ttl: 1 * 60 * 1000,  // 1 minute
        deduplicate: true,
      },
    },
    list: {
      url: '/api/conversations',
      method: 'GET',
      cache: {
        ttl: 2 * 60 * 1000,  // 2 minutes
        deduplicate: true,
      },
    },
  },

  // Pipelines API
  pipelines: {
    run: {
      url: '/api/pipelines/run',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: true,  // Prevent duplicate pipeline runs
      },
    },
    status: {
      url: (id: string) => `/api/pipelines/status/${id}`,
      method: 'GET',
      cache: {
        ttl: 5 * 1000,  // 5 seconds (status updates frequently)
        deduplicate: true,
      },
    },
  },

  // Users API
  users: {
    list: {
      url: '/api/users',
      method: 'GET',
      cache: {
        ttl: 5 * 60 * 1000,  // 5 minutes
        deduplicate: true,
      },
    },
    create: {
      url: '/api/users',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,
      },
    },
    update: {
      url: (email: string) => `/api/users/${encodeURIComponent(email)}`,
      method: 'PUT',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,
      },
    },
    delete: {
      url: (email: string) => `/api/users/${encodeURIComponent(email)}`,
      method: 'DELETE',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: true,
      },
    },
  },

  // Access Tokens API
  accessTokens: {
    list: {
      url: '/api/access-tokens',
      method: 'GET',
      cache: {
        ttl: 2 * 60 * 1000,  // 2 minutes
        deduplicate: true,
      },
    },
    create: {
      url: '/api/access-tokens',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,
      },
    },
    delete: {
      url: (id: number) => `/api/access-tokens/${id}`,
      method: 'DELETE',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: true,
      },
    },
  },

  // Recordings API
  recordings: {
    list: {
      url: '/api/recordings',
      method: 'GET',
      cache: {
        ttl: 1 * 60 * 1000,  // 1 minute
        deduplicate: true,
      },
    },
    create: {
      url: '/api/recordings',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,
      },
    },
    addEvents: {
      url: (id: number) => `/api/recordings/${id}/events`,
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,
      },
    },
    stop: {
      url: (id: number) => `/api/recordings/${id}/stop`,
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,
      },
    },
  },

  // Admin API
  admin: {
    dbVersion: {
      url: '/api/admin/db-version',
      method: 'GET',
      cache: {
        ttl: 30 * 1000,  // 30 seconds
        deduplicate: true,
      },
    },
    exportDb: {
      url: '/api/admin/export-db',
      method: 'GET',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,
      },
    },
    validateDb: {
      url: '/api/admin/validate-db',
      method: 'GET',
      cache: {
        ttl: 0,  // No caching
        deduplicate: true,
      },
    },
    importCompany: {
      url: '/api/admin/import-company',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,
      },
    },
    migrateDb: {
      url: '/api/admin/migrate-db',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: true,
      },
    },
    clearCache: {
      url: '/api/cache/clear',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: true,
      },
    },
  },

  // Auth API (for login/register)
  auth: {
    check2FA: {
      url: '/api/auth/check-2fa',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,
      },
    },
    sendOTP: {
      url: '/api/auth/send-otp',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,
      },
    },
    verifyOTP: {
      url: '/api/auth/verify-otp',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,
      },
    },
  },

  // Companies API (for registration)
  companies: {
    register: {
      url: '/api/companies/register',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching
        deduplicate: false,
      },
    },
  },

  // Documents API (generic file operations)
  documents: {
    create: {
      url: '/api/documents',
      method: 'POST',
      cache: {
        ttl: 0,  // No caching for mutations
        deduplicate: false,
      },
    },
    list: {
      url: '/api/documents',
      method: 'GET',
      cache: {
        ttl: 2 * 60 * 1000,  // 2 minutes
        deduplicate: true,
      },
    },
  },
} as const;

// Type helpers for API declarations
export type ApiDeclaration = typeof API;
export type ApiCategory = keyof ApiDeclaration;
export type ApiMethod<C extends ApiCategory> = keyof ApiDeclaration[C];
