# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Root Level Commands
- `yarn` - Install all dependencies for all workspaces
- `yarn web` - Start web development server
- `yarn web-prod` - Build and serve web app in production mode
- `yarn extension` - Start extension development server
- `yarn extension-build` - Build extension for production

### Workspace-Specific Commands
- **Web workspace**: `yarn lint`, `yarn test` (Jest), `yarn prettier`, `yarn build`
- **Extension workspace**: `yarn lint`, `yarn prettier`, `yarn zip` (build and package)
- **Apps workspace**: Jest tests available

## Architecture Overview

### Monorepo Structure
MinusX is organized as a yarn workspace monorepo with 3 main packages:

1. **`web/`** - React frontend application with Redux state management
2. **`extension/`** - Chrome extension with content scripts and background workers  
3. **`apps/`** - Platform-specific integrations, currently focused on Metabase

### Key Architectural Patterns

#### App Controller Pattern (`apps/`)
- Base class `AppController` in `apps/src/base/appController.ts` provides common functionality
- `MetabaseAppController` extends this base for Metabase-specific functionality
- Uses decorator pattern with `@Action` for exposing methods to the planner
- Metabase app defines its own state types, fingerprinting, and query selectors

#### Planner System (`web/src/planner/`)
- Uses `simplePlan` strategy for AI planning and action execution
- `plannerActions.ts` handles action execution and tool calling
- Redux middleware listens for user messages and triggers planning loops
- Actions are performed via `performActions()` which calls app controller methods

#### State Management
- **Web**: Redux with RTK, persisted state, separate reducers for auth, chat, settings, etc.
- **Apps**: Zustand for lightweight state management in app-specific contexts
- **Extension**: Chrome storage APIs for extension-specific data
- **Cross-Boundary Pattern**: Apps expose Zustand stores via `useStore()` that web components can subscribe to using `getApp().useStore()`, enabling reactive UI updates without tight coupling

#### Communication Architecture
- **RPC System**: Bidirectional communication between web app, extension, and content scripts
- **Message Passing**: Chrome extension APIs for background/content script communication  
- **Event System**: Custom event dispatching for DOM interactions and state updates
- **Host Page Monitoring**: Apps use `subscribe()` pattern to listen for DOM changes in the host page (e.g., Metabase), storing state updates in apps-side Zustand stores that web components subscribe to via `getApp().useStore()`

### Metabase Integration
- Full SQL query execution and dashboard interaction capabilities
- Database schema introspection and table cataloging
- Parameter handling for templated queries and dashboard filters
- Semantic layer integration for business context
- Controller located at `apps/src/metabase/appController.ts`
- State management in `apps/src/metabase/appState.ts`

### Extension Architecture
- **Content Scripts**: Injected into Metabase for DOM manipulation
- **Background Scripts**: Service worker for cross-tab communication and API calls
- **Popup**: User interface for quick actions and settings
- **Manifest V3**: Modern Chrome extension architecture with proper permissions

### Development Setup Requirements
- Node.js and Yarn for package management
- Chrome Developer Mode for extension loading

### Environment Configuration
- **Dev vs Prod Detection**: Use `configs.IS_DEV` from `web/src/constants.ts`
- **Environment Files**: `.env.development` and `.env.production` files per workspace, with `env.defaults.json` as fallback
- **Cross-workspace Imports**: Apps and web can import from each other using workspace names
- **Package Exports**: Check `web/src/package.ts` and `apps/src/package.ts` for current available exports
- **Settings Access**: `web/src/app/appSettings.ts` exposes a curated subset of Redux settings to apps workspace via `RPCs.getAppSettings()`

### Development Best Practices
- **Concurrency Control**: Batch API calls to prevent resource exhaustion when fetching data for multiple entities
- **Settings Pattern**: New settings require updates in reducer, settings UI, and `appSettings.ts` for cross-workspace access
- **Code Reuse**: When implementing similar logic in multiple places, extract reusable functions to shared modules rather than duplicating code
- **Template Tag Handling**: Metabase template tags (model references like `{{#1-model_name}}` and snippets like `{{snippet: name}}`) require proper template tag definitions in the `dataset_query.native.template-tags` object to avoid "missing required parameters" errors when generating URLs

## Important File Locations
- Metabase controller: `apps/src/metabase/appController.ts`
- Metabase state: `apps/src/metabase/appState.ts`
- Planner configurations: `web/src/planner/`
- Extension manifest: `extension/src/manifest.json`
- Environment config: `web/src/constants.ts`
- Package exports: `web/src/package.ts`, `apps/src/package.ts`