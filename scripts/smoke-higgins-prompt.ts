/**
 * Smoke test for the Phase 1 Higgins system prompt assembly.
 *
 * Loads .env.local, calls buildHigginsSystemPrompt(), and prints the
 * composed prompt to stdout. Useful for eyeballing the catalog injection
 * and confirming the exec-orchestrator base is wired in correctly without
 * having to round-trip through the live chat UI.
 *
 *     npm run smoke:higgins-prompt
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..');

// Lightweight .env.local loader — must run before importing modules that
// read process.env at import time (supabaseClient.ts).
function loadEnv(): void {
  const envPath = resolve(repoRoot, '.env.local');
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // Missing .env.local just means we'll fail the DB call below — let it.
  }
}

async function main(): Promise<void> {
  loadEnv();

  const { buildHigginsSystemPrompt } = await import('../api/lib/higginsSystemPrompt.js');
  const prompt = await buildHigginsSystemPrompt();

  const banner = '═'.repeat(72);
  console.log(banner);
  console.log(`HIGGINS 2.0 SYSTEM PROMPT — ${prompt.length} chars`);
  console.log(banner);
  console.log(prompt);
  console.log(banner);

  // Coverage check: confirm the expected agents got mentioned by character name.
  const expectedCharacters = [
    'Higgins',          // base persona
    'Jarvis', 'Alfred', // exec_team
    'Dakota', 'Marlowe', 'Tatum', 'Sloan',            // some dept orchestrators
    'Ellis', 'Kendall', 'Cameron', 'Morgan-L',        // some cross_functional
  ];

  const present = expectedCharacters.filter((c) => prompt.includes(c));
  const missing = expectedCharacters.filter((c) => !prompt.includes(c));
  console.log(`Characters present (${present.length}/${expectedCharacters.length}):`, present.join(', '));
  if (missing.length) {
    console.log('MISSING:', missing.join(', '));
    process.exit(1);
  }
  console.log('OK — Phase 1 assembly looks healthy.');
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
