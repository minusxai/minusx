# docs — the public documentation site

Standalone Next.js App Router site built on fumadocs that renders the user-facing documentation
published at docs.minusx.ai. It is **statically exported** (`output: 'export'` → `out/`) and served as
flat files on port 3001.

It owns only the published content under `docs/content/**` plus the thin app shell that renders it. It
shares **nothing** with `frontend/` — separate `package.json`, `node_modules`, tsconfig, Dockerfile,
deploy workflow — except one file it reads across the boundary (`frontend/compatibility.json`). Loose
`*.md` files sitting at the `docs/` root are not part of the site and are never built or served; only
`content/**` is published.

## Architecture

Two independent content trees, each with its own `defineDocs` → `loader` → route group → MDX component
map. They only look like one site because both layouts render the same `SidebarTabs` switcher.

```
content/docs/**   ─┐                                     ┌─ app/docs/[[...slug]]/page.tsx   + app/docs/layout.tsx
                   ├─ source.config.ts ─→ lib/source.ts ─┤
content/guides/** ─┘   (defineDocs ×2)     (loader ×2)   └─ app/guides/[[...slug]]/page.tsx + app/guides/layout.tsx
                                                │
                          app/api/search/route.ts  ←  docsSource ONLY
```

- `source.config.ts` declares the two doc collections; fumadocs-mdx generates `.source/` at build/dev
  time (gitignored, not in a fresh clone) and `lib/source.ts` wraps each in a `loader` with its
  `baseUrl` (`/docs`, `/guides`).
- Each `[[...slug]]/page.tsx` calls `generateStaticParams()` off its own source and passes an explicit
  `components={{ ...defaultMdxComponents, ... }}` map to the compiled MDX body. `Callout`, `Card`/`Cards`,
  code blocks, links and images come from `defaultMdxComponents`; any local component used **in MDX**
  must be listed by hand (`logo.tsx` / `demo-button.tsx` are layout imports and stay out of that map).
- Sidebar structure is data, not code: a `meta.json` per folder with `title`, `pages` (order), and
  optionally `root` / `defaultOpen`. `content/docs/meta.json` also uses `"---Label---"` entries as
  section separators in the nav.
- `app/page.tsx` redirects `/` → `/docs`. The fumadocs top sub-nav is hidden by CSS
  (`#nd-subnav { display: none }` in `app/global.css`), so `lib/tabs.tsx` is the *only* way to move
  between Docs and Guides — a new top-level tree needs a link added there.
- Search is a build-time static index emitted by `app/api/search/route.ts` (`force-static`,
  `revalidate = false`, `staticGET()`) and consumed by the client via
  `RootProvider search={{ options: { type: 'static', api: '/api/search' } }}` in `app/layout.tsx`.

## Gotchas

- **`cd docs && npm run build` is the only gate.** There is no lint or typecheck script of its own —
  `next build` *is* the typecheck — and nothing in PR CI builds this directory.
  `.github/workflows/docs-deploy.yml` fires *after* merge — on pushes to `main`
  touching `docs/**` — and only dispatches a workflow in the private `minusxai/deploys` repo. A
  broken MDX page reaches `main` unnoticed unless you build locally first.
- **Docker must build from the repository root.** `components/compatibility-tables.tsx` imports
  `../../frontend/compatibility.json` (the same contract the app's connection forms and `install.sh`
  read, so the docs tables can't drift). That single import is why `next.config.mjs` widens
  `turbopack.root` to the parent dir, why `docker-compose.yml` sets `context: ..`, and why the Dockerfile
  copies that one file to `/frontend/compatibility.json` (`docs/` maps onto `/app`, so `../../frontend`
  resolves from `/app/components/`). Only that file crosses the boundary: importing any *other*
  `frontend/` file compiles locally and fails the image build.
- **A custom MDX component must be registered in the `page.tsx` of *every* tree that uses it.**
  `SupportedModels` / `SupportedDatabases` are registered in the docs page only; using either in
  `content/guides/**` fails the build with an undefined-component error.
- **Search covers docs only** — `createFromSource(docsSource)`. Guides pages are not indexed.
- **Omitting a page from `meta.json` hides it from the nav but still builds its URL.**
  `content/docs/installation/self-hosted.mdx` is not in that folder's `pages` array yet still exports a
  route; unlisted pages stay publicly reachable, so use them as redirect stubs, not as drafts.
- **`rehype-mermaid` is a declared dependency but is not wired** (no `mdxOptions` anywhere). A
  ```` ```mermaid ```` fence renders as a plain code block. Diagrams go through the client-side
  `components/mermaid-init.tsx`, wrapped per-diagram the way `components/data-loop.tsx` does it.
- **`ThemedImage` emits both images and toggles them with CSS `display`** rules in `app/global.css` —
  both variants ship in every page's HTML. It takes two independent `light`/`dark` srcs; the convention
  is a matching filename under `public/light/` and `public/dark/`, with theme-neutral art in
  `public/common/` passed for both props. `next/image` is `unoptimized` — static export has no image
  optimizer.
- **Only `title` and `description` frontmatter are used** across all pages; `description` renders as the
  page subhead and the meta description.
- **`npm run start` is a broken script.** `next start` throws under `output: 'export'`. To serve a build
  locally: `npx serve out -l 3001`.
- **The runtime is `serve`, not a real web server.** The Dockerfile builds the static export and runs
  `serve /app/out -l 3001` on `node:20-alpine` — there is no Nginx, no rewrite layer and no redirect
  config, so anything of that shape has to be handled at the CDN/proxy in front of the container.

## Code pointers

| Task | File |
|---|---|
| Add/edit a published page | `docs/content/docs/**` or `docs/content/guides/**` (`.mdx`) |
| Change sidebar order, titles, section labels | the `meta.json` in that folder (+ parent's `pages`) |
| Register a custom MDX component | `docs/app/docs/[[...slug]]/page.tsx` **and** `docs/app/guides/[[...slug]]/page.tsx` |
| Write a new component | `docs/components/` (`'use client'` if it touches the DOM) |
| Colors, fonts, prose/code styling, theme toggling | `docs/app/global.css` |
| Add a content tree / change base URLs | `docs/source.config.ts` + `docs/lib/source.ts` (+ a tab in `docs/lib/tabs.tsx`) |
| Nav chrome, GitHub link, sidebar banner, CTA | `docs/app/docs/layout.tsx`, `docs/app/guides/layout.tsx`, `docs/components/demo-button.tsx` |
| Build/serve image, deploy trigger | `docs/Dockerfile`, `docs/docker-compose.yml`, `.github/workflows/docs-deploy.yml` |
