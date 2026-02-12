![Logo](https://minusx.ai/logo_light.png#gh-dark-mode-only)

MinusX is an Agentic Business Intelligence platform built from the ground up for native AI interop. It is the Claude Code / Codex for data.

![Schematic](./frontend/public/schematic.png)

## What you can do with MinusX

- **Explore naturally:** Ask questions in plain English across all your data
- **Move faster:** Use agents to dig through dashboards and questions, modify existing ones, or generate new ones
- **Be in control:** Tune agent performance and visibility using controlled contexts
- **Build trust; avoid the mess:** The agent encourages data best practices and prioritizes user (especially non technical) understanding and trust.

Note: This is on top of obvious BI features like connecting to databases/warehouses, questions, dashboards, reports, etc.

## Quick Links

- **MinusX Cloud:** [minusx.app](https://minusx.app)
- **Website:** [minusx.ai](https://minusx.ai)

## Getting Started
- Simple Docker setup (coming soon)
- Local development setup: [Local Setup](./Docs.md)

## Why MinusX

We've spent years watching companies struggle with the same problem: they buy expensive "self-serve" BI tools, set it up over months, hire analysts, and build dashboards. And yet, most people in the company can't answer basic questions about their own data without pain and tears.

When LLMs got better, everyone (including us) bolted chatbots / text-to-SQL onto existing tools. Unfortunately, it doesn't work. These tools were designed around menus, isolated query editors and tons of scaffolding. The AI is an afterthought and almost a parlor trick that breaks the moment you need it to do anything real.

We think the answer is rebuilding from scratch. Learning from the magic of Claude Code, MinusX exposes the entire BI (questions, dashboards, reports etc.) as a file system the agent can read and write. The agent is omni-present, working exactly how you work.

Anyone who has spent any time working with LLMs in data knows that the hard part is not SQL, it's context. The model doesn't know that `revenue` is `ARR_operational` in your company, or that the `orders` table has a quirk where cancelled orders still show up, but only till 2025(!!!). MinusX Knowledge Base gives you tools to teach the agent what it needs to know, and learns from your continued usage. A 200 line generated SQL that you cannot understand, trust and reason about is as useless as not having the answer.

dbt is amazing. Semantic models are great. Still, less than ~10% of fast growing companies have all their data modeled. This tech-debt only grows as you scale. MinusX is designed to work with or without dbt. Write messy SQL and have the agent clean it up!


## License

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

MinusX is Open Source Software and licensed under the AGPL-3.0 license. See [LICENSE](LICENSE) file for details.