/**
 * Prompt Visualizer — generates a single self-contained HTML page for inspecting
 * the agent prompts the app actually sends, and budgeting their token cost.
 *
 *   npm run prompt-visualizer        # writes prompt-visualizer.html, then open it
 *
 * Pick a PAGE (drives which skills are preloaded — see PAGE_SKILL_MAP) and an
 * AGENT (drives the toolset). You get:
 *   • a hero stacked bar of the WHOLE turn — every system slot, the tool schemas,
 *     and the app-filled runtime slots — each segment sized by tokens;
 *   • live token inputs for the runtime slots the app fills at request time
 *     (schema, context, app_state, attachments, user message) so you can see how
 *     much of the prompt they eat;
 *   • System (per-slot, fixed vs runtime) / User / Tools panels;
 *   • a Templates tab listing every template & skill by token cost.
 *
 * Tokens are estimated as chars // 4. Everything is driven by the REAL code paths
 * (renderPrompt + the skills logic + each agent's static `tools`), so it tracks
 * prompts.yaml automatically.
 */
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { Type } from 'typebox';
import { PROMPTS, renderPrompt, getSkill, pyFormat } from '@/orchestrator/prompts';
import {
  PAGE_SKILL_MAP,
  getPreloadedSkillNames,
  buildSkillsCatalog,
  buildPreloadedSkillsContent,
} from '@/agents/analyst/skills';
// Tool schemas come from the LIGHT tool modules (web-tools + db-tools). The agent
// classes and the `*.server` tool variants can't be imported into a plain node
// script — they transitively pull in React/Next client modules. The param schemas
// here are the same shapes the LLM is told about.
import {
  ClarifyFrontend, CreateFile, EditFile, LoadSkill, Navigate, PublishAll, ReadFiles,
} from '@/agents/web-analyst/web-tools';
import {
  ListDBConnections, BaseSearchDBSchema, BaseExecuteQuery, FuzzyMatch,
} from '@/agents/benchmark-analyst/db-tools';
import type { Tool } from '@/orchestrator/llm';
import type { TSchema } from 'typebox';

config();

const tok = (s: string | undefined | null): number => Math.floor((s?.length ?? 0) / 4);

// ── local copy of the loader's nested-template resolver (not exported) ─────────
const NESTED_REF = /\{([\w]+(?:\.[\w]+)+)\}/g;
const SIMPLE_REF = /\{(\w+)\}/g;
function resolveTemplates(text: string, templates: Record<string, unknown>): string {
  let cur = text;
  for (let i = 0; i < 10; i++) {
    let replaced = false;
    cur = cur.replace(NESTED_REF, (_m, p: string) => {
      const v = p.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), templates);
      if (typeof v === 'string') { replaced = true; return v; }
      return _m;
    });
    cur = cur.replace(SIMPLE_REF, (m, p: string) => {
      const v = templates[p];
      if (typeof v === 'string') { replaced = true; return v; }
      return m;
    });
    if (!replaced) break;
  }
  return cur;
}

function buildVars(pageType: string | null) {
  const preloadedNames = getPreloadedSkillNames({ pageType, selected: [], unrestrictedMode: false });
  return {
    preloadedNames,
    vars: {
      agent_name: 'MinusX',
      max_steps: '30',
      allowed_viz_types: 'all',
      role: 'editor',
      schema: '«SCHEMA»',
      context: '«CONTEXT»',
      skills_catalog: buildSkillsCatalog({ tree: PROMPTS, preloaded: new Set(preloadedNames), selected: [], userCatalog: [] }),
      connection_id: 'connection_1',
      home_folder: '/org',
      preloaded_skills: buildPreloadedSkillsContent({ tree: PROMPTS, skillNames: preloadedNames, selected: [] }),
    } as Record<string, string>,
  };
}

// `{slot}` refs in the order they appear in default.system.
const slotRefs: string[] = (() => {
  const tmpl = (PROMPTS.prompts as Record<string, { system?: string }>).default?.system ?? '';
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  const re = /\{(\w+)\}/g;
  while ((m = re.exec(tmpl))) refs.push(m[1]);
  return refs;
})();

// Which system slot carries an app-filled runtime value (and the input key it maps to).
const SLOT_RUNTIME: Record<string, 'schema' | 'context'> = { schema_section: 'schema', context_section: 'context' };

function renderSlotFixed(ref: string, vars: Record<string, string>): string {
  // measure the slot's FIXED text — runtime values blanked so only the wrapper counts
  const v: Record<string, string> = { ...vars, schema: '', context: '' };
  const t = PROMPTS.templates[ref];
  if (typeof t === 'string') {
    try { return pyFormat(resolveTemplates(t, PROMPTS.templates), v); }
    catch { return resolveTemplates(t, PROMPTS.templates); }
  }
  return v[ref] ?? '';
}

type Part = { name: string; fixed: number; runtime: 'schema' | 'context' | null; children?: { name: string; tokens: number }[]; text: string };
type SystemView = { text: string; parts: Part[]; fixedTotal: number };

function systemFor(pageType: string | null): SystemView {
  const { vars, preloadedNames } = buildVars(pageType);
  const parts: Part[] = slotRefs.map((ref) => {
    const fixedText = renderSlotFixed(ref, vars);
    const part: Part = { name: ref, fixed: tok(fixedText), runtime: SLOT_RUNTIME[ref] ?? null, text: fixedText };
    if (ref === 'preloaded_skills') part.children = preloadedNames.map((n) => ({ name: n, tokens: tok(getSkill(n) ?? '') }));
    return part;
  });
  return { text: renderPrompt('default.system', vars), parts, fixedTotal: parts.reduce((s, p) => s + p.fixed, 0) };
}

function userView() {
  const fixedText = renderPrompt('default.user', { app_state: '', current_date: '', attachments: '', goal: '' });
  const display = renderPrompt('default.user', {
    app_state: '«app_state: JSON snapshot of the current page»',
    current_date: new Date().toISOString().slice(0, 10),
    attachments: '«attachments»',
    goal: '«user message»',
  });
  return { fixed: tok(fixedText), text: display };
}

// SearchFiles lives in agents/analyst/file-tools.ts, which pulls in server-only
// file-state deps a node script can't load. Mirror its schema here (keep in sync).
const SearchFilesSchema: Tool<TSchema> = {
  name: 'SearchFiles',
  description: 'Search files by name, description, or content with ranked results and snippets. Returns {success, results: [{id, name, path, type, score, snippets}], total}.',
  parameters: Type.Object({
    query: Type.String({ description: 'Search term to find in file names, descriptions, and content.' }),
    file_types: Type.Optional(Type.Array(Type.String(), { description: 'File types to search: "question", "dashboard". Default: both.' })),
    folder_path: Type.Optional(Type.String({ description: "Folder path to search within (default: user's home folder)." })),
    depth: Type.Optional(Type.Number({ description: 'Folder depth to search (default 999 — all subfolders).' })),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of results to return (default 20).' })),
    offset: Type.Optional(Type.Number({ description: 'Number of results to skip for pagination (default 0).' })),
  }),
};

type AgentDef = { label: string; tools: Tool<TSchema>[] };
// Toolset membership/order mirrors agents/web-analyst/web-analyst.ts and
// agents/analyst/analyst-agent.ts (kept in sync by hand — the agent classes
// can't be imported here). The schema objects themselves are the real ones.
const AGENTS: AgentDef[] = [
  {
    label: 'WebAnalystAgent (browser — production chat)',
    tools: [
      BaseSearchDBSchema.schema, BaseExecuteQuery.schema, FuzzyMatch.schema, ReadFiles.schema, SearchFilesSchema,
      EditFile.schema, CreateFile.schema, Navigate.schema, ClarifyFrontend.schema, PublishAll.schema, LoadSkill.schema,
    ],
  },
  {
    label: 'AnalystAgent (server / headless)',
    tools: [
      ListDBConnections.schema, BaseSearchDBSchema.schema, BaseExecuteQuery.schema, ReadFiles.schema, SearchFilesSchema,
    ],
  },
];
function toolsFor(a: AgentDef) {
  return a.tools.map((t) => {
    const schema = JSON.stringify(t.parameters, null, 2);
    return { name: t.name, description: t.description ?? '', schema, tokens: tok(t.name + (t.description ?? '') + schema) };
  });
}

const PAGES: (string | null)[] = [null, ...Object.keys(PAGE_SKILL_MAP)];
const pageLabel = (p: string | null) => (p === null ? '(unknown / default)' : p);

const allTemplates = Object.entries(PROMPTS.templates)
  .map(([name, val]) => {
    const raw = typeof val === 'string' ? val : (val && typeof val === 'object' ? String((val as Record<string, unknown>).content ?? '') : '');
    const isSkill = name.startsWith('skill_');
    const effective = isSkill ? (getSkill(name.slice('skill_'.length)) ?? raw) : raw;
    return { name, tokens: tok(effective), isSkill };
  })
  .sort((a, b) => b.tokens - a.tokens);

const data = {
  pages: PAGES.map(pageLabel),
  agents: AGENTS.map((a) => a.label),
  system: PAGES.map((p) => systemFor(p)),
  user: userView(),
  tools: AGENTS.map(toolsFor),
  templates: allTemplates,
  // default runtime estimates (tokens) — the app fills these at request time
  defaults: { schema: 1200, context: 500, app_state: 2000, attachments: 0, goal: 40 },
  generatedAt: new Date().toISOString(),
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MinusX Prompt Visualizer</title>
<style>
 :root{--bg:#0e1014;--panel:#161922;--panel2:#1d212c;--bd:#2a2f3c;--fg:#e7eaf1;--mut:#8b93a7;
   --sys:#5aa9ff;--rt:#f5a623;--tool:#b58cff;--user:#39d98a;--mono:ui-monospace,Menlo,Consolas,monospace}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
 header{position:sticky;top:0;z-index:9;background:var(--panel);border-bottom:1px solid var(--bd);padding:11px 18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
 h1{font-size:15px;margin:0;font-weight:700;letter-spacing:.3px}
 label.ctl{display:flex;gap:7px;align-items:center;font-size:12px;color:var(--mut)}
 select,input[type=number]{background:var(--panel2);color:var(--fg);border:1px solid var(--bd);border-radius:7px;padding:6px 9px;font-size:13px}
 input[type=number]{width:74px;font-family:var(--mono)}
 .tabs{display:flex;gap:6px;margin-left:auto}
 .tab{background:transparent;border:1px solid var(--bd);color:var(--mut);padding:6px 12px;border-radius:7px;cursor:pointer;font-size:13px}
 .tab.active{background:var(--sys);border-color:var(--sys);color:#06121f;font-weight:600}
 main{padding:18px;max-width:1560px;margin:0 auto}
 .hero{background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:16px 18px;margin-bottom:16px}
 .hero .top{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:10px;margin-bottom:12px}
 .grand{font:800 26px/1 var(--mono)} .grand small{font:600 13px/1 var(--mono);color:var(--mut)}
 .rtshare{font:700 13px/1 var(--mono);color:var(--rt)}
 .stack{display:flex;height:42px;width:100%;border-radius:8px;overflow:hidden;border:1px solid var(--bd);background:var(--panel2)}
 .seg{height:100%;position:relative;min-width:1px;transition:width .15s ease;cursor:default;box-shadow:inset -1.5px 0 0 rgba(0,0,0,.55),inset 0 0 0 .5px rgba(255,255,255,.12)}
 .seg:last-child{box-shadow:inset 0 0 0 .5px rgba(255,255,255,.12)}
 .seg:hover{filter:brightness(1.25)}
 .runtime-inputs{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--bd)}
 .runtime-inputs .ri{display:flex;flex-direction:column;gap:4px}
 .runtime-inputs label{font:600 11px/1 var(--mono);color:var(--rt);text-transform:uppercase;letter-spacing:.4px}
 .legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:12px}
 .legend .lg{display:flex;gap:6px;align-items:center;color:var(--mut)}
 .sw{width:11px;height:11px;border-radius:3px;display:inline-block}
 .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px} @media(max-width:1100px){.grid{grid-template-columns:1fr}}
 .col{background:var(--panel);border:1px solid var(--bd);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
 .col>h2{margin:0;padding:11px 14px;font-size:13px;font-weight:600;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;background:var(--panel2)}
 .pill{font:700 11px/1 var(--mono);padding:4px 8px;border-radius:999px;background:#0d1f33;color:var(--sys)}
 .pill.g{background:#0d2a1d;color:var(--user)} .pill.p{background:#211233;color:var(--tool)}
 .body{padding:10px 0;overflow:auto;max-height:66vh}
 pre{margin:0;padding:0 14px;white-space:pre-wrap;word-break:break-word;font:12px/1.55 var(--mono);color:#cdd3df}
 details.slot{margin:0 10px 6px;border:1px solid var(--bd);border-radius:8px;overflow:hidden}
 details.slot>summary{cursor:pointer;list-style:none;padding:8px 11px;display:flex;justify-content:space-between;align-items:center;background:var(--panel2);font-size:12px;gap:8px}
 summary::-webkit-details-marker{display:none}
 .tag{font:600 10px/1 var(--mono);padding:3px 6px;border-radius:4px;background:#2a2110;color:var(--rt)}
 .sub{font:600 11px/1 var(--mono);color:var(--mut)} details.slot pre{padding:10px 12px;border-top:1px solid var(--bd);max-height:320px;overflow:auto}
 .child{display:flex;justify-content:space-between;padding:5px 11px 5px 24px;font-size:12px;border-top:1px dashed var(--bd);color:var(--mut)}
 details.tool{margin:0 10px 8px} details.tool>summary{cursor:pointer;list-style:none;padding:9px 11px;border:1px solid var(--bd);border-radius:8px;display:flex;gap:10px;align-items:center;background:var(--panel2)}
 .tname{font:700 13px/1 var(--mono);color:var(--user)} .tdesc{color:var(--mut);font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 details.tool pre{padding:10px 12px;margin-top:6px;border:1px solid var(--bd);border-radius:8px;max-height:340px;overflow:auto}
 table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--bd);font-size:13px}
 th{color:var(--mut);font-weight:600;font-size:12px;position:sticky;top:0;background:var(--panel2)}
 td.n{font:700 12px/1 var(--mono);text-align:right;color:var(--sys)} tr.skill td:first-child{color:var(--tool)}
 .bar{height:7px;background:#0d1f33;border-radius:4px;overflow:hidden;min-width:80px}.bar>i{display:block;height:100%;background:var(--sys)}
 .hide{display:none}
 #tip{position:fixed;pointer-events:none;background:#000;border:1px solid var(--bd);border-radius:7px;padding:7px 9px;font:12px/1.4 var(--mono);z-index:30;display:none;max-width:280px}
</style></head>
<body>
<header>
 <h1>⚡ Prompt Visualizer</h1>
 <label class="ctl">Page <select id="page"></select></label>
 <label class="ctl">Agent <select id="agent"></select></label>
 <div class="tabs">
  <button class="tab active" data-tab="combo">Budget &amp; Prompt</button>
  <button class="tab" data-tab="templates">All Templates</button>
 </div>
</header>
<main>
 <section id="combo">
  <div class="hero">
   <div class="top">
    <div><div class="grand"><span id="grand"></span> <small>tokens / turn</small></div></div>
    <div class="rtshare" id="rtshare"></div>
   </div>
   <div class="stack" id="stack"></div>
   <div class="legend" id="legend"></div>
   <div class="runtime-inputs" id="rinputs"></div>
  </div>
  <div class="grid">
   <div class="col"><h2>System <span class="pill" id="sysTok"></span></h2><div class="body" id="sysBody"></div></div>
   <div class="col"><h2>User <span class="pill g" id="usrTok"></span></h2><div class="body" id="usrBody"></div></div>
   <div class="col"><h2>Tools <span class="pill p" id="toolTok"></span></h2><div class="body" id="toolBody"></div></div>
  </div>
 </section>
 <section id="templates" class="hide">
  <div class="col"><h2>Every template &amp; skill, by token cost <span class="pill" id="tmplTot"></span></h2>
   <div class="body"><table><thead><tr><th>Template</th><th>Tokens</th><th>Share</th></tr></thead><tbody id="tmplRows"></tbody></table></div></div>
 </section>
</main>
<div id="tip"></div>
<script>
const DATA=${JSON.stringify(data)};
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const fmt=n=>Math.round(n).toLocaleString();
const $=id=>document.getElementById(id);
const RT={...DATA.defaults};                       // live runtime token estimates
const COL={sys:'var(--sys)',rt:'var(--rt)',tool:'var(--tool)',user:'var(--user)'};
const RTLABEL={schema:'schema',context:'context',app_state:'app_state',attachments:'attachments',goal:'user message'};

const pageSel=$('page'),agentSel=$('agent');
DATA.pages.forEach((p,i)=>pageSel.add(new Option(p,i)));
DATA.agents.forEach((a,i)=>agentSel.add(new Option(a,i)));
const qi=DATA.pages.indexOf('question'); pageSel.value=qi<0?0:qi;

// runtime inputs
$('rinputs').innerHTML=Object.keys(DATA.defaults).map(k=>
 '<div class="ri"><label>'+RTLABEL[k]+' (app-filled)</label><input type="number" min="0" step="50" id="rt_'+k+'" value="'+DATA.defaults[k]+'"></div>').join('');
Object.keys(DATA.defaults).forEach(k=>$('rt_'+k).oninput=e=>{RT[k]=Math.max(0,+e.target.value||0);render();});

function segments(){
 const pi=+pageSel.value,ai=+agentSel.value;
 const sys=DATA.system[pi],tools=DATA.tools[ai];
 const segs=[];
 sys.parts.forEach(p=>{
  if(p.fixed>0) segs.push({label:p.name,tok:p.fixed,kind:'sys'});
  if(p.runtime) segs.push({label:p.runtime+' (app-filled)',tok:RT[p.runtime],kind:'rt'});
 });
 segs.push({label:'tools — JSON schemas ('+tools.length+')',tok:tools.reduce((s,t)=>s+t.tokens,0),kind:'tool'});
 segs.push({label:'app_state (app-filled)',tok:RT.app_state,kind:'rt'});
 if(RT.attachments>0)segs.push({label:'attachments (app-filled)',tok:RT.attachments,kind:'rt'});
 segs.push({label:'user message',tok:RT.goal,kind:'user'});
 return segs.filter(s=>s.tok>0);
}

function render(){
 const pi=+pageSel.value,ai=+agentSel.value,sys=DATA.system[pi],tools=DATA.tools[ai];
 const segs=segments();const total=segs.reduce((s,x)=>s+x.tok,0)||1;
 const rt=segs.filter(s=>s.kind==='rt').reduce((s,x)=>s+x.tok,0);
 $('grand').textContent=fmt(total);
 $('rtshare').textContent='app-filled runtime = '+fmt(rt)+' tok ('+Math.round(100*rt/total)+'% of turn)';
 $('stack').innerHTML=segs.map(s=>'<div class="seg" style="width:'+(100*s.tok/total)+'%;background:'+COL[s.kind]+'" data-l="'+esc(s.label)+'" data-t="'+s.tok+'" data-p="'+(100*s.tok/total).toFixed(1)+'"></div>').join('');
 const kinds=[['sys','System (fixed templates)'],['rt','App-filled runtime'],['tool','Tool JSON schemas'],['user','User message']];
 $('legend').innerHTML=kinds.map(([k,l])=>{const t=segs.filter(s=>s.kind===k).reduce((s,x)=>s+x.tok,0);return '<span class="lg"><span class="sw" style="background:'+COL[k]+'"></span>'+l+' · '+fmt(t)+' ('+Math.round(100*t/total)+'%)</span>';}).join('');
 // system panel
 $('sysTok').textContent=fmt(sys.fixedTotal+RT.schema+RT.context)+' tok';
 $('sysBody').innerHTML=sys.parts.map(p=>{
  const rtTok=p.runtime?RT[p.runtime]:0;const t=p.fixed+rtTok;
  const tag=p.runtime?' <span class="tag">+'+fmt(rtTok)+' runtime</span>':'';
  const kids=p.children?('<div>'+p.children.map(c=>'<div class="child"><span>'+esc(c.name)+'</span><span class="sub">'+fmt(c.tokens)+'</span></div>').join('')+'</div>'):'';
  const pre=p.text?'<pre>'+esc(p.text)+'</pre>':'';
  return '<details class="slot"><summary><span>'+esc(p.name)+tag+'</span><span class="sub">'+fmt(t)+' tok</span></summary>'+kids+pre+'</details>';
 }).join('')+'<details class="slot"><summary><span><b>full rendered system prompt</b> (placeholders)</span><span class="sub">'+fmt(sys.fixedTotal+RT.schema+RT.context)+' tok</span></summary><pre>'+esc(sys.text)+'</pre></details>';
 // user
 const uTot=DATA.user.fixed+RT.app_state+RT.attachments+RT.goal;
 $('usrTok').textContent=fmt(uTot)+' tok';
 $('usrBody').innerHTML='<details class="slot" open><summary><span>wrapper (fixed) + app_state/goal <span class="tag">+'+fmt(RT.app_state+RT.attachments+RT.goal)+' runtime</span></span><span class="sub">'+fmt(uTot)+' tok</span></summary><pre>'+esc(DATA.user.text)+'</pre></details>';
 // tools
 const ttot=tools.reduce((s,t)=>s+t.tokens,0);
 $('toolTok').textContent=tools.length+' · '+fmt(ttot)+' tok';
 $('toolBody').innerHTML=tools.map(t=>'<details class="tool"><summary><span class="tname">'+esc(t.name)+'</span><span class="tdesc">'+esc(t.description)+'</span><span class="sub" style="color:var(--tool)">'+fmt(t.tokens)+'</span></summary><pre>'+esc(t.schema)+'</pre></details>').join('');
}

// templates tab
const maxT=Math.max(...DATA.templates.map(t=>t.tokens),1);
$('tmplTot').textContent=fmt(DATA.templates.reduce((s,t)=>s+t.tokens,0))+' tok';
$('tmplRows').innerHTML=DATA.templates.map(t=>'<tr class="'+(t.isSkill?'skill':'')+'"><td>'+esc(t.name)+'</td><td class="n">'+fmt(t.tokens)+'</td><td><div class="bar"><i style="width:'+(100*t.tokens/maxT)+'%"></i></div></td></tr>').join('');

// tooltip
const tip=$('tip');
$('stack').addEventListener('mousemove',e=>{const s=e.target.closest('.seg');if(!s){tip.style.display='none';return;}
 tip.style.display='block';tip.style.left=Math.min(e.clientX+12,innerWidth-280)+'px';tip.style.top=(e.clientY+14)+'px';
 tip.innerHTML='<b>'+esc(s.dataset.l)+'</b><br>'+fmt(s.dataset.t)+' tok · '+s.dataset.p+'%';});
$('stack').addEventListener('mouseleave',()=>tip.style.display='none');

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
 $('combo').classList.toggle('hide',b.dataset.tab!=='combo');$('templates').classList.toggle('hide',b.dataset.tab!=='templates');});
pageSel.onchange=render;agentSel.onchange=render;render();
</script></body></html>`;

const outPath = new URL('../prompt-visualizer.html', import.meta.url).pathname;
writeFileSync(outPath, html, 'utf8');
// eslint-disable-next-line no-console
console.log(`✓ wrote ${outPath}\n  pages=${data.pages.length} agents=${data.agents.length} templates=${data.templates.length}\n  open it in a browser: open ${outPath}`);
