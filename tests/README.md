# Tests

Initial setup:

```sh
npm ci
npx playwright install chromium
```

Run all tests with `npm test`. Run engine tests separately with `npm run test:unit`,
or browser storage regression tests with `npm run test:storage`.
Use `npm run test:browser` for all browser tests.

Browser tests use isolated browser storage and start their own local Vite server
on port 5189. Leave that port free. Failure traces are saved in `output/playwright/`.
They cover failed shared-link and stored-data loads, preservation during edits,
normal autosave, and recovery through a valid file import or an explicit restart.
Editor tests cover toolbar and palette actions, language changes, file selection,
and desktop/mobile play transitions with preserved editor state and focus.
Document tests cover undo/redo after file imports and restarts, shared-link loads
that reset history and exit play, and the undo checkpoint for legacy terrain upgrades.

Terrain tests also check rebuild counts, unchanged painting, shared environment
calculations, bridge placement, and undo/redo. The four terrain fingerprints in
`fixtures/terrain-before.json` were captured before the optimization. They cover
geometry attributes and indices, object transforms, instance matrices and colors,
material settings, shader source, and texture pixels.

Run `npm run benchmark:editor -- current` to measure three repetitions of the
same seeded 12×12 editor session. This starts a server on port 5190 and writes
`output/performance/current.json`. Run it without other tests or benchmarks active.
Instrumentation is injected through Playwright response interception; production
code contains no measurement hooks. GPU drawing is disabled only in this benchmark
to isolate terrain generation CPU time from software rendering. Results report
function call counts and cumulative CPU time, not FPS or end-to-end input latency.
