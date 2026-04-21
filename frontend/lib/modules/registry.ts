import { IAuthModule, ICacheModule, IFileSystemDBModule, IObjectStoreModule } from './types';

export interface ModuleSet {
  auth: IAuthModule;
  db: IFileSystemDBModule;
  store: IObjectStoreModule;
  cache: ICacheModule;
}

// Turbopack creates separate module instances for the instrumentation bundle vs
// request-handler bundles. global is shared across all bundles in the same process,
// so it bridges the gap without needing IPC.
declare global {
  // eslint-disable-next-line no-var
  var __minusx_modules__: ModuleSet | undefined;
}

export function registerModules(modules: ModuleSet): void {
  global.__minusx_modules__ = modules;
}

export function getModules(): ModuleSet {
  const modules = global.__minusx_modules__;
  if (!modules) {
    throw new Error('Modules not registered — check instrumentation.ts (or registerModules() in tests)');
  }
  return modules;
}

export function isModulesRegistered(): boolean {
  return global.__minusx_modules__ != null;
}
