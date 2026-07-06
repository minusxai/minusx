# Docs Sync Marker

This file records the last commit at which the project documentation
(`CLAUDE.md`, `README.md`, and the `docs/` site) was reconciled against the
codebase. Use it to audit doc drift: everything merged after this commit is a
candidate for a docs update.

```
DOCS_SYNCED_TO: ddb79028  (2026-07-06)
```

## See what's changed since the last sync

```bash
# commit subjects since docs were last reconciled
git log --oneline ddb79028..HEAD

# full diff of code (ignore the docs themselves)
git diff ddb79028..HEAD -- . ':!docs' ':!*.md'
```

## When you update the docs

After reconciling the docs with the current code, bump the hash above to the
new `HEAD` and the date alongside it:

```bash
git rev-parse --short HEAD   # new value for DOCS_SYNCED_TO
```

Keep the marker honest — only advance it once you've actually walked the
`git log <old>..HEAD` range and folded any doc-worthy changes into the docs.
