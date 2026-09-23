import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertToModelMessages, simulateReadableStream, stepCountIs, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { makeWebSearchTools, WEB_SEARCH_INSTRUCTIONS } from '../api/lib/webSearchTools.js';

// Exercise the real SDK protocol consumed by Higgins, without paid API calls.
for (const scenario of [
  { name: 'results with citations', output: { id: 'search-1', results: [
    { title: 'Example release', url: 'https://example.com/release', snippet: 'Released today.' },
  ] }, answer: 'Released today. [Example release](https://example.com/release)' },
  { name: 'no results', output: { id: 'search-2', results: [] }, answer: 'No search results were found.' },
  { name: 'search service failure', output: { error: 'rate_limit', statusCode: 429, message: 'Try later.' },
    answer: 'Web search is unavailable; I could not verify this.' },
]) {
  test(`web search streams ${scenario.name} and preserves the answer for history`, async () => {
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        assert.ok(options.tools?.some((t) => t.type === 'provider' && t.id === 'gateway.perplexity_search'));
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'tool-input-start', id: 'call-1', toolName: 'web_search', providerExecuted: true },
              { type: 'tool-call', toolCallId: 'call-1', toolName: 'web_search',
                input: JSON.stringify({ query: 'latest example release' }), providerExecuted: true },
              { type: 'tool-result', toolCallId: 'call-1', toolName: 'web_search', result: scenario.output },
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: scenario.answer },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 10, text: 10, reasoning: undefined },
              } },
            ],
          }),
        };
      },
    });
    const result = streamText({ model, tools: makeWebSearchTools(),
      system: WEB_SEARCH_INSTRUCTIONS, prompt: 'Search for the latest release.', stopWhen: stepCountIs(8) });
    const events = [];
    for await (const event of result.toUIMessageStream()) events.push(event);
    assert.ok(events.some((e) => e.type === 'tool-input-start' && e.toolName === 'web_search'));
    assert.ok(events.some((e) => e.type === 'tool-output-available'));
    assert.ok(!events.some((e) => e.type === 'error'));
    assert.equal(await result.text, scenario.answer);
    assert.equal((await result.steps).flatMap((step) => step.toolCalls).length, 1);
    const history = await convertToModelMessages([
      { role: 'assistant', parts: [{ type: 'text', text: await result.text }] },
    ]);
    assert.ok(JSON.stringify(history).includes(scenario.answer));
  });
}
