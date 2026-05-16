// V2 double-check controller: same logic as the V1 `DoubleCheckBenchmarkAgent`
// but pinned to the V2 analyst sub-agents via the parent's
// `primaryAgent`/`secondaryAgent` static fields.
//
// Shares the V1 `schema.name = 'DoubleCheckBenchmarkAgent'` (inherited). Only
// one of V1 or V2 may be registered in any orchestrator at a time — the
// v=2 chat orchestration picks one based on whether the saved log shows V2
// markers.
import 'server-only';
import { DoubleCheckBenchmarkAgent } from '../double-check-benchmark';
import { V2BenchmarkAnalystAgent } from './v2-agent';

export class V2DoubleCheckBenchmarkAgent extends DoubleCheckBenchmarkAgent {
  static primaryAgent = V2BenchmarkAnalystAgent;
  static secondaryAgent = V2BenchmarkAnalystAgent;
}
