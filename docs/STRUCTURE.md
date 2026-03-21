# Docs Structure

The sidebar navigation is controlled by `meta.json` files in each directory.
Each `meta.json` has a `pages` array that defines the order.
Use `---Section Name---` for section dividers.

## Docs Tab (`content/docs/`)

```
content/docs/meta.json → sidebar root
├── ---Getting Started---        (section divider)
├── index.mdx                    "What is MinusX?"
├── installation/
│   ├── self-hosted.mdx          "Self-Hosted Installation"
│   └── cloud.mdx                "Cloud / Managed"
├── ---Features---               (section divider)
├── concepts/
│   └── philosophy.mdx           "Philosophy"
├── questions/
│   ├── index.mdx                "Questions"
│   ├── sql-editor.mdx           "SQL Editor"
│   ├── parameters.mdx           "Parameters"
│   ├── visualization.mdx        "Visualization"
│   └── saving-organizing.mdx    "Saving & Organizing"
├── dashboards/
│   ├── index.mdx                "Dashboards"
│   ├── creating-dashboards.mdx  "Creating Dashboards"
│   ├── layout-widgets.mdx       "Layout & Widgets"
│   └── dashboard-parameters.mdx "Dashboard Parameters"
├── knowledge-base/
│   ├── index.mdx                "Knowledge Base"
│   ├── table-context.mdx        "Table Context"
│   ├── text-context.mdx         "Text Context"
│   └── evals.mdx                "Evals"
├── proactive/
│   ├── reports.mdx              "Reports"
│   └── alerts.mdx               "Alerts"
└── ai-chat/
    ├── index.mdx                "AI Chat"
    └── how-it-works.mdx         "How the AI Works"
```

## Guides Tab (`content/guides/`)

```
content/guides/meta.json → sidebar root
├── index.mdx                    "Guides" (landing page)
├── getting-started.mdx          "Getting Started"
├── first-question.mdx           "Your First Question"
├── creating-dashboard.mdx       "Creating a Dashboard"
├── knowledge-base-setup.mdx     "Setting Up the Knowledge Base"
└── reports-alerts.mdx           "Reports & Alerts"
```

## How to edit structure

**Reorder pages:** Edit the `pages` array in the relevant `meta.json`
**Add a page:** Create the `.mdx` file and add its name (without extension) to `meta.json`
**Rename a section:** Change `title` in the folder's `meta.json`
**Add a section divider:** Add `"---Divider Text---"` to the pages array
**Add a new folder:** Create the folder, add `meta.json` with title + pages, add to parent's `meta.json`

## meta.json reference

```json
{
  "title": "Section Name",
  "pages": ["index", "page-a", "page-b"]
}
```

## MDX frontmatter reference

```yaml
---
title: Page Title
description: Short description shown below the title
---
```
