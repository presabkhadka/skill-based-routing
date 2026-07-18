const CANONICAL_ALIASES: Record<string, string[]> = {
  "Frontend Development": [
    "frontend",
    "front end",
    "front-end",
    "ui",
    "ui development",
    "react",
    "react js", "reactjs",
    "react.js",
    "vue",
    "vue js",
    "vuejs",
    "vue.js",
    "angular",
    "svelte",
    "next",
    "next js",
    "nextjs",
    "next.js",
    "tailwind",
    "css",
  ],
  "Backend Development": [
    "backend",
    "back end",
    "back-end",
    "server side",
    "server-side",
    "node",
    "node js",
    "nodejs",
    "node.js",
    "express",
    "django",
    "flask",
    "rails",
    "spring",
    "rest api",
    "graphql",
  ],
  "AI Development": [
    "ai",
    "a.i.",
    "artificial intelligence",
    "machine learning",
    "ml",
    "deep learning",
    "llm",
    "llms",
    "neural networks",
  ],
  "Agentic AI": [
    "agentic",
    "agentic ai",
    "ai agent",
    "ai agents",
    "agent development",
    "autonomous agents",
    "langchain",
    "langgraph",
  ],
  HVAC: [
    "ac",
    "a/c",
    "air conditioning",
    "air conditioner",
    "air con",
    "heating",
    "cooling",
    "furnace",
    "thermostat",
  ],
  Electrical: [
    "electric",
    "electrician",
    "wiring",
    "breaker",
    "circuit",
    "panel",
    "outlet",
  ],
  Plumbing: [
    "plumber",
    "pipe",
    "pipes",
    "leak",
    "drain",
    "faucet",
    "sink",
    "water heater",
  ],
};

const ALIAS_LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    m.set(canonical.toLowerCase(), canonical);
    for (const alias of aliases) m.set(alias.toLowerCase(), canonical);
  }
  return m;
})();

export function normalizeSkillName(name: string): string {
  const clean = name.trim();
  return ALIAS_LOOKUP.get(clean.toLowerCase()) ?? clean;
}
