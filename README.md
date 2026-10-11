# Ladder Visualizer

A React and TypeScript library for parsing, comparing, and rendering
Allen-Bradley/Rockwell PLC controller exports. It provides normalized controller
data, ladder-diagram components, inspection tables, and controller/rung diff
utilities.

## Features

- Parse Rockwell JSON and L5X controller exports into a normalized domain model.
- Render virtualized SVG ladder diagrams, including parallel branches.
- Render read-only Function Block Diagram sheets with React Flow custom nodes and orthogonal edges.
- Browse controller metadata, tags, modules, data types, AOIs, and structured text.
- Compare controllers and render inline, rung-level diffs.
- Customize the UI with CSS custom properties or typed light/dark theme objects.

## Install

```bash
npm install ladder-visualizer react react-dom
```

`react` and `react-dom` are peer dependencies and must be supplied by the host
application.

## Quick start

```tsx
import { parseString, VirtualizedLadderDiagram } from 'ladder-visualizer';
import 'ladder-visualizer/styles';

const result = parseString(l5xSource);

if (!result.success || !result.data) {
  throw new Error(result.errors?.map((error) => error.message).join('\n') ?? 'Parse failed');
}

const routine = result.data.programs[0]?.routines[0];

export function ControllerRoutine() {
  return routine ? (
    <VirtualizedLadderDiagram
      routine={routine}
      instructionContext={result.context}
    />
  ) : null;
}
```

For a normalized FBD routine, render its source-ordered sheets with `FBDDiagram`.
The viewer provides accessible sheet tabs and React Flow's native zoom, fit, and
pan interactions; only the active sheet is mounted:

```tsx
import { FBDDiagram } from 'ladder-visualizer';

const fbd = result.data.programs[0]?.routines.find((routine) => routine.type === 'FBD')?.fbd;

export function FunctionBlockRoutine() {
  return fbd ? <FBDDiagram body={fbd} /> : null;
}
```

Use `sheetIndex` to select a sheet from external application state and
`onSheetIndexChange` to observe tab navigation. Controls are shown by default;
`showControls={false}` hides them without replacing React Flow's viewport model.

Run `npm run preview:fbd` to open the dedicated FBD previewer. It includes the
topology and element-family fixtures, accessible sheet tabs, light/dark themes, grid
and minimap toggles, viewport controls, and renderer diagnostics.

Compare two normalized FBD revisions with `diffFBD(oldBody, newBody)` or read
`routineDiff.fbdDiff` from `diffControllers()`. Render both revisions with:

```tsx
import { FBDDiffDiagram } from 'ladder-visualizer';

<FBDDiffDiagram oldBody={olderRoutine.fbd} newBody={newerRoutine.fbd} height={700} />
```

The default overlay draws unchanged content once in normal theme colors. Changed
fields show their older values in red and newer values in green; moved blocks are
colored in full at their original positions. Automatic resizing retains both frame
and pin positions, and changed wires draw above block backgrounds. Added/deleted elements and changed wire
routes use the same green/red colors. Slightly offset strokes and collision-aware
labels keep both versions visible. Side-by-side views remain fully red/green.
A side-by-side switch,
source sheet number selection, version metadata, pan/zoom controls, and explicit
diagnostics are included. Missing or duplicate sheet numbers force separate views
without guessing a match. Omit either body to display an added or removed routine.
Import `ladder-visualizer/styles` as for the other viewers. `theme`, `width`,
`height`, `initialView`, and `onDiagnostics` configure the component.

Both FBD viewers use the internal `src/components/fbd/elements` library for
reference and connector shapes, instruction frames, pins, field labels, and theme
styles. The regular viewer adds React Flow handles; the comparison viewer adds
revision matching, colors, and collision placement. The static SVG renderer also
uses these shared elements. Add or change element artwork in that library so all
viewers stay consistent.

For a local comparison preview, run `npm run dev` and open
`/tests/visual/fbd-diff.html` (add `?theme=dark` for dark mode). The preview uses
controlled comparison deltas on the existing export-derived level-control fixture.

Use `parseFile()` for browser file uploads and `parseBuffer()` for an
`ArrayBuffer`. Parsers are registered automatically when importing from the
package root.

Each successful parse returns a controller-scoped `context` containing built-in
instruction metadata plus that controller's AOI definitions. Pass it to ladder
renderers so BOX symbols use the correct AOI parameter labels. Parsing never
clears or repopulates `globalInstructionRegistry`, so multiple parsed
controllers remain isolated. Existing integrations that intentionally use the
global registry can continue to call `registerAOIsFromController(controller)`;
that compatibility helper is now an explicit opt-in side effect.
Low-level `l5xToNormalized()` and `jsonToNormalized()` callers can use
`finalizeController(controller)` to obtain the matching context and replace
provisional rung categories before rendering.

## SFC raw routines

SFC routines retain their complete original `<Routine>` XML in `rawSource` when
parsed through the public L5X APIs. Select a routine in the demo to inspect its
source, or use the reusable component in your application:

```tsx
import { parseString, RawRoutineViewer } from 'ladder-visualizer';

const result = parseString(l5xSource, 'l5x');
const routine = result.data?.programs[0]?.routines.find(item => item.type === 'SFC');
if (routine?.rawSource) {
  return <RawRoutineViewer routine={routine} style={{ height: 480 }} />;
}
```

The source retains comments, CDATA, nested code, whitespace and line endings.
`rawSource.sourcePath` identifies the routine's owner; `startOffset` and
`endOffset` delimit its exact XML in the decoded input string (UTF-16 indexes,
exclusive end). `RawRoutineViewer` uses the same theme variables as
`StructuredTextViewer` and accepts `showLineNumbers`, `fontSize`, `className`,
and `style`. SFC semantic normalization and rich charts remain incomplete,
so raw access does not change a partial parse into a complete one.

## L5X input safety

L5X parsing rejects XML `DOCTYPE` declarations and custom entities. Built-in
XML entities such as `&amp;` remain supported. The default resource guard accepts
at most 10 MiB of UTF-8 source, 100,000 XML elements, and 64 nested elements.
These defaults cover normal controller exports while preventing unbounded input
work. The repository includes a small, sanitized controller example for local
development and integration testing.

Pass controlled overrides for trusted inputs, and use standard cancellation or
timeout controls at any public parsing entry point:

```ts
const result = parseString(l5xSource, 'l5x', {
  resourceLimits: {
    maxSourceBytes: 20 * 1024 * 1024,
    maxXmlNodes: 200_000,
  },
  signal: abortController.signal,
  timeoutMs: 5_000,
});
```

Failures use stable `ParseErrorCodes`, including
`SOURCE_BYTE_LIMIT_EXCEEDED`, `XML_NODE_LIMIT_EXCEEDED`,
`XML_DEPTH_LIMIT_EXCEEDED`, `UNSAFE_XML_ENTITY`, `PARSE_CANCELLED`, and
`PARSE_TIMEOUT`.

## Theming

Import the default stylesheet, or import only the CSS variables when integrating
with an existing design system:

```ts
import 'ladder-visualizer/styles';
// or
import 'ladder-visualizer/styles/variables';
```

For a programmatic theme, pass `DARK_THEME` or a partial `LadderDiagramTheme` to
`VirtualizedLadderDiagram`. Applying the `ladder-visualizer-dark` class also
enables the built-in dark-mode variables.

## Development

Development and CI use Node.js 24.

```bash
npm install
npm run dev        # start the demo application
npm run build      # type-check and package the library
npm run test:run   # run tests once
npm run test:visual # run Chromium visual baselines
npm run lint       # lint source files
```

## Repository layout

```text
src/
  components/  React and SVG rendering components
  diff/        controller and inline rung comparison
  layout/      ladder-diagram geometry and measurement
  parsers/     JSON and L5X parsing into normalized data
  styles/      CSS variables and default styles
  types/       public TypeScript contracts
demo/          local Vite demonstration app
examples/      small, representative controller exports
tests/         unit and integration tests
```

The example controller contains synthetic test logic and sanitized metadata. Do
not commit production controller exports without first removing personal,
network, project-serial, customer, and proprietary process information.

## License

Copyright (c) 2026 onwards IOFabrik.

Ladder Visualizer is licensed under the [GNU Affero General Public License
v3.0 or later](LICENSE) (`AGPL-3.0-or-later`). The corresponding source code
is available in this repository.

Third-party packages retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
