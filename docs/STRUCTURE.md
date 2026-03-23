# Docs Structure

Sidebar sections are collapsible folders. Each folder has a `meta.json` with `title` and `pages`.

## Docs Tab (`content/docs/`)

```
content/docs/
├── index.mdx                        "Getting Started"
├── installation/
│   ├── self-hosted.mdx              "Self-Hosted Installation"
│   └── cloud.mdx                    "Cloud / Managed"
├── concepts/                        (collapsible)
│   ├── philosophy.mdx               "Philosophy"
│   └── agent.mdx                    "MinusX Agent"
├── bi/                              (collapsible)
│   ├── questions.mdx                "Questions" (SQL editor, parameters, viz overview)
│   ├── dashboards.mdx               "Dashboards" (creating, layout, params)
│   ├── explore.mdx                  "Explore" (full-page AI chat)
│   ├── visualization.mdx            "Visualization" (chart types, GUI builder, pivot)
│   └── filters.mdx                  "Filters & Parameters" (deep dive)
├── data/                            (collapsible)
│   ├── connections.mdx              "Connections"
│   └── data-modeling.mdx            "Data Modeling"
├── knowledge-base/                  (collapsible)
│   ├── context.mdx                  "Context" (table + text context)
│   └── evals.mdx                    "Evals"
├── proactive/                       (collapsible)
│   ├── reports.mdx                  "Reports"
│   └── alerts.mdx                   "Alerts"
```

## Guides Tab (`content/guides/`)

```
content/guides/
├── index.mdx                    "Guides" (landing page)
├── getting-started.mdx          "Getting Started"
├── first-question.mdx           "Your First Question"
├── creating-dashboard.mdx       "Creating a Dashboard"
├── knowledge-base-setup.mdx     "Setting Up the Knowledge Base"
└── reports-alerts.mdx           "Reports & Alerts"
```

## How to edit

**Reorder pages:** Edit `pages` array in folder's `meta.json`
**Add a page:** Create `.mdx` file, add name (no extension) to `meta.json`
**Rename section:** Change `title` in folder's `meta.json`
**Add folder:** Create folder + `meta.json`, add folder name to parent's `meta.json`
