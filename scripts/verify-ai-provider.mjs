import 'dotenv/config'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The model-provider seam.
//
// Groq is OpenAI-compatible; the OS speaks Anthropic. The translation between
// them is the only place a mistake would be silent — a mis-paired tool result
// does not error, the model simply answers as though the tool returned nothing.
// So the message translation is exercised directly, offline.
//
// A live round trip against Groq runs only when GROQ_API_KEY is set, so this
// script is useful on a machine with no keys at all.

const mk = ok => (ok ? '✓' : '✗')
let pass = 0, total = 0
const check = (label, ok, extra = '') => { total++; if (ok) pass++; console.log(`  ${mk(ok)} ${label}${ok ? '' : ` — ${extra}`}`) }

// provider.ts imports the Anthropic SDK for TYPES only plus one runtime use in
// the anthropic branch; stripping the import leaves the groq branch and all the
// selection logic loadable on its own.
const outDir = mkdtempSync(join(tmpdir(), 'prov-'))
execSync(`npx tsc lib/ai/provider.ts --outDir "${outDir}" --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: 'pipe' })
const js = join(outDir, 'provider.js')
writeFileSync(js, readFileSync(js, 'utf8').replace(/^import .*@anthropic-ai\/sdk.*$/gm, ''))
const P = await import(pathToFileURL(js).href)

const withEnv = async (env, fn) => {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
  try { return await fn() } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  }
}

// ══ 1. Provider selection ══
await withEnv({ AI_PROVIDER: undefined, ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g' }, () => {
  check('with both keys and no declaration, Anthropic wins',
    P.aiProvider() === 'anthropic', P.aiProvider())
})
await withEnv({ AI_PROVIDER: 'groq', ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g' }, () => {
  check('an explicit declaration overrides that', P.aiProvider() === 'groq', P.aiProvider())
})
await withEnv({ AI_PROVIDER: undefined, ANTHROPIC_API_KEY: undefined, GROQ_API_KEY: 'g' }, () => {
  check('with only a Groq key it uses Groq', P.aiProvider() === 'groq', P.aiProvider())
  check('…and reports itself configured', P.aiConfigured() === true)
})
await withEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: undefined, ANTHROPIC_API_KEY: 'a' }, () => {
  check('declaring Groq without a Groq key is NOT configured — it does not fall back',
    P.aiConfigured() === false, 'an Anthropic key satisfied a Groq deployment')
})
await withEnv({ AI_PROVIDER: undefined, ANTHROPIC_API_KEY: undefined, GROQ_API_KEY: undefined }, () => {
  check('no keys at all is not configured', P.aiConfigured() === false)
})

// ══ 2. Model selection ══
await withEnv({ AI_PROVIDER: 'groq', AI_ASSISTANT_MODEL: undefined }, () => {
  check('Groq gets a Groq default', /llama|gpt-oss|qwen/.test(P.aiModel()), P.aiModel())
})
await withEnv({ AI_PROVIDER: 'anthropic', AI_ASSISTANT_MODEL: undefined }, () => {
  check('Anthropic gets a Claude default', P.aiModel().startsWith('claude-'), P.aiModel())
})
await withEnv({ AI_PROVIDER: 'groq', AI_ASSISTANT_MODEL: 'claude-haiku-4-5-20251001' }, () => {
  check('a stale Claude model id is IGNORED on Groq, not sent as a 404',
    !P.aiModel().startsWith('claude-'), P.aiModel())
})
await withEnv({ AI_PROVIDER: 'groq', AI_ASSISTANT_MODEL: 'openai/gpt-oss-120b' }, () => {
  check('a Groq model id is honoured', P.aiModel() === 'openai/gpt-oss-120b', P.aiModel())
})
await withEnv({ AI_PROVIDER: 'anthropic', AI_ASSISTANT_MODEL: 'llama-3.3-70b-versatile' }, () => {
  check('…and a Groq id is ignored on Anthropic', P.aiModel().startsWith('claude-'), P.aiModel())
})

// The rule every per-feature override shares. `WHATSAPP_ANALYSIS_MODEL` used to
// reimplement it and got it backwards — honouring a `claude-…` id on Groq, so
// every inbound message 404'd and the caller swallowed it.
await withEnv({ AI_PROVIDER: 'groq' }, () => {
  check('a Claude override is REFUSED on Groq',
    P.providerModelOverride('claude-haiku-4-5-20251001') === null, 'a Claude id survived onto Groq')
  check('…while a Groq override is honoured',
    P.providerModelOverride('openai/gpt-oss-120b') === 'openai/gpt-oss-120b')
})
await withEnv({ AI_PROVIDER: 'anthropic' }, () => {
  check('a Claude override is honoured on Anthropic',
    P.providerModelOverride('claude-haiku-4-5-20251001') === 'claude-haiku-4-5-20251001')
  check('…while a Groq override is refused', P.providerModelOverride('llama-3.3-70b-versatile') === null)
})
check('an unset override is simply absent', P.providerModelOverride(undefined) === null)
check('…and so is a blank one', P.providerModelOverride('   ') === null)

// ══ 3. Message translation — the part that fails silently ══
// Reached by pointing the Groq branch at a local stub and reading what it sends.
const captured = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  captured.push(JSON.parse(init.body))
  return {
    ok: true,
    json: async () => ({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: 'here you go',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'revenue', arguments: '{"days":7}' } }],
        },
      }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    }),
  }
}

const response = await withEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'g' }, () => P.createMessage({
  max_tokens: 100,
  system: 'SYSTEM RULE',
  tools: [{ name: 'revenue', description: 'Revenue.', input_schema: { type: 'object', properties: { days: { type: 'number' } }, required: ['days'] } }],
  tool_choice: { type: 'tool', name: 'revenue' },
  messages: [
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: [
      { type: 'text', text: 'let me look' },
      { type: 'tool_use', id: 'call_earlier', name: 'revenue', input: { days: 1 } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_earlier', content: '{"totalRM":99}' }] },
  ],
}))
globalThis.fetch = realFetch

const sent = captured[0]
const roles = sent.messages.map(m => m.role)
check('the system prompt becomes a system message',
  sent.messages[0].role === 'system' && sent.messages[0].content === 'SYSTEM RULE', JSON.stringify(sent.messages[0]))
check('roles are ordered system → user → assistant → tool',
  JSON.stringify(roles) === JSON.stringify(['system', 'user', 'assistant', 'tool']), roles.join(','))

const assistant = sent.messages[2]
check('an assistant tool_use becomes an OpenAI tool_call',
  assistant.tool_calls?.[0]?.function?.name === 'revenue', JSON.stringify(assistant))
check('…carrying its arguments as a JSON string',
  assistant.tool_calls[0].function.arguments === '{"days":1}', assistant.tool_calls[0].function.arguments)

const toolMsg = sent.messages[3]
check('a tool_result is promoted to its own tool message', toolMsg.role === 'tool', JSON.stringify(toolMsg))
check('…paired by tool_call_id, or the model silently loses the result',
  toolMsg.tool_call_id === 'call_earlier', toolMsg.tool_call_id)

check('tools are wrapped as OpenAI functions',
  sent.tools[0].type === 'function' && sent.tools[0].function.name === 'revenue', JSON.stringify(sent.tools?.[0]))
check('the JSON schema is passed through as parameters',
  sent.tools[0].function.parameters?.properties?.days?.type === 'number', JSON.stringify(sent.tools[0].function.parameters))
check('a forced tool becomes an OpenAI forced function',
  sent.tool_choice?.function?.name === 'revenue', JSON.stringify(sent.tool_choice))

// ══ 4. Response translation ══
check('text comes back as a text block',
  response.content.some(b => b.type === 'text' && b.text === 'here you go'), JSON.stringify(response.content))
const back = response.content.find(b => b.type === 'tool_use')
check('a tool_call comes back as a tool_use block', !!back && back.name === 'revenue', JSON.stringify(back))
check('…with its arguments PARSED, not left a string',
  back?.input?.days === 7, JSON.stringify(back?.input))
check('…keeping the id, so the next turn can pair the result', back?.id === 'call_1', String(back?.id))
check('finish_reason tool_calls maps to stop_reason tool_use',
  response.stop_reason === 'tool_use', String(response.stop_reason))
check('token counts map onto the budget\'s names',
  response.usage.input_tokens === 11 && response.usage.output_tokens === 22, JSON.stringify(response.usage))

// Malformed tool arguments must not throw — the caller's validation reports it.
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: 'not json{' } }] } }],
    usage: {},
  }),
})
const broken = await withEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'g' }, () => P.createMessage({ max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }))
globalThis.fetch = realFetch
check('malformed tool arguments become an empty input, not an exception',
  JSON.stringify(broken.content.find(b => b.type === 'tool_use')?.input) === '{}',
  JSON.stringify(broken.content))

// An API error must name the cause — a bad model id is the likely failure.
globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'model `nope` does not exist' } }) })
let message = ''
try {
  await withEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'g' }, () => P.createMessage({ max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }))
} catch (e) { message = e.message }
globalThis.fetch = realFetch
check('an API error surfaces the provider\'s own message', /does not exist/.test(message), message)

// ══ 5. Nothing bypasses the seam ══
//
// These globs cover .tsx as well as .ts. They did not, once, and six PAGE
// components were quietly deciding whether AI exists by reading
// ANTHROPIC_API_KEY themselves — so on the Groq demo every one of them rendered
// "not configured" over a working feature. The backend was fine; the screens
// were empty. A check that inspects only the files you expected to be wrong
// tells you nothing.
const SOURCE_GLOBS = '"lib/**/*.ts" "lib/**/*.tsx" "app/**/*.ts" "app/**/*.tsx"'
const grep = pattern => execSync(`git grep -n "${pattern}" -- ${SOURCE_GLOBS} || true`, { encoding: 'utf8' })
  .split('\n').filter(l => l && !l.startsWith('lib/ai/provider.ts'))

const bypass = grep('new Anthropic()\\|messages\\.create(')
check('every AI call goes through the provider', bypass.length === 0, bypass.join(' | '))

const envReads = grep('process.env.ANTHROPIC_API_KEY')
check('nothing reads the Anthropic key directly — including .tsx pages',
  envReads.length === 0, envReads.join(' | '))

const groqReads = grep('process.env.GROQ_API_KEY')
check('…and nothing reads the Groq key directly either', groqReads.length === 0, groqReads.join(' | '))

// A per-feature model override must ask the seam whether the id belongs to the
// active provider. Testing the id's SHAPE at the call site is how the WhatsApp
// analyser came to send a `claude-…` model to Groq on every inbound message.
const shapeTests = grep("startsWith('claude-')")
check('no call site decides a model by the shape of its id',
  shapeTests.length === 0, shapeTests.join(' | '))

// The user-facing empty states must not name one vendor: they render on the
// deployment that does NOT have that vendor's key.
const copy = execSync(`git grep -n "No <code>ANTHROPIC_API_KEY</code>" -- ${SOURCE_GLOBS} || true`, { encoding: 'utf8' })
  .split('\n').filter(Boolean)
check('the "not configured" copy is provider-neutral', copy.length === 0, copy.join(' | '))

// ══ 5b. Rate limits are distinguishable from failures ══
const providerSrc = readFileSync('lib/ai/provider.ts', 'utf8')
check('a Groq rate limit is classified as busy, not as a broken feature',
  /res\.status === 429 \|\| res\.status === 403/.test(providerSrc), 'no rate-limit branch')
check('…and an Anthropic 429 lands in the same bucket',
  /status === 429 \|\| status === 529/.test(providerSrc), 'anthropic rate limits not classified')

for (const [label, err, expected] of [
  ['a rate-limit error is recognised', new Error('provider-busy: TPM exceeded'), true],
  ['a model-not-found error is NOT', new Error('groq: model does not exist'), false],
  ['a non-Error is NOT', 'provider-busy', false],
]) check(label, P.isBusy(err) === expected)

const askRoute = readFileSync('app/api/ask/route.ts', 'utf8')
check('the copilot answers a rate limit with 429 busy, not 500 failed',
  /isBusy\(e\)[\s\S]{0,80}'busy'/.test(askRoute), 'busy not mapped')

const askClient = readFileSync('app/ask/AskClient.tsx', 'utf8')
check('…and does not tell the user to rephrase a question that was fine',
  /busy:/.test(askClient), 'no busy message for the reader')

// ══ 6. Live round trip, when a key is present ══
if (process.env.GROQ_API_KEY) {
  const live = await withEnv({ AI_PROVIDER: 'groq' }, () => P.createMessage({
    max_tokens: 300,
    system: 'Record the figures you are given. Invent nothing.',
    tools: [{ name: 'note', description: 'Record.', input_schema: { type: 'object', properties: { observations: { type: 'array', items: { type: 'string' } } }, required: ['observations'] } }],
    tool_choice: { type: 'tool', name: 'note' },
    messages: [{ role: 'user', content: 'Revenue 1240, visits 8.' }],
  }))
  const call = live.content.find(b => b.type === 'tool_use')
  check('LIVE: Groq returns the forced tool', call?.name === 'note', JSON.stringify(live.content).slice(0, 160))
  check('LIVE: its input parses to the declared shape',
    Array.isArray(call?.input?.observations), JSON.stringify(call?.input).slice(0, 160))
  check('LIVE: real token counts come back for the budget',
    live.usage.input_tokens > 0 && live.usage.output_tokens > 0, JSON.stringify(live.usage))
} else {
  console.log('  · live round trip skipped (no GROQ_API_KEY)')
}

console.log(`\n${pass}/${total} passed`)
if (pass !== total) process.exitCode = 1
