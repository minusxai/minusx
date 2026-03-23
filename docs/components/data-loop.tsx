'use client';

import { Mermaid } from './mermaid-init';

const chart = `graph LR
    A[(Raw Data)] --> B[Data Models]
    B --> C[Context & Knowledge Base]
    C --> D[Evals]
    D --> E[BI & Dashboards]
    E --> F[Ad-hoc Questions]
    F -->|add to eval| D
    D -->|improves context| C
    D -->|improves models| B
    style A fill:#16a085,stroke:#000,color:#fff`;

export function DataLoop() {
  return <Mermaid chart={chart} />;
}
