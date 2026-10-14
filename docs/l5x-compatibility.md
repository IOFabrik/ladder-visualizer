# L5X compatibility contract

Compatibility matrix version: **1.16.0**

This document defines the narrow, testable claims Ladder Visualizer may make about Rockwell L5X input. A profile is a promise about named constructs and export shapes. It is not a percentage derived from the number of entities that happened to survive normalization.

The executable source of truth is [`tests/fixtures/l5x/manifest.ts`](../tests/fixtures/l5x/manifest.ts). The manifest records the source version, actual L5X target type, expected parse status, source counts, normalized counts, and current parser outcome for every sanitized fixture.

## Compatibility profiles

| Profile                   | Version 1.16.0 status | Included contract                                                                                     | Known boundaries                                                                                                  |
| ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `rockwell-controller-rll` | Supported            | Controller identity/communication metadata, UDT headers, controller and program tags, program hierarchy, Equipment Phase metadata, tasks and schedules, trends and quick-watch lists, AOIs, modules, RLL routines/rungs, and Program/AOI Structured Text source lines | Rockwell-specific controller configuration and SFC-based equipment sequences are preserved rather than normalized |
| `rockwell-program-rll`    | Supported            | Program target exports with identity/hierarchy attributes, parameters, program state, program tags, RLL routines, and Structured Text source lines | A parent omitted from a component export is not treated as invalid; resource IDs are document-local |
| `rockwell-routine-rll`    | Partial              | RLL routine target exports represented in the controller-shaped result                                | Context-controller configuration is retained and reported as partial; stable cross-export identity and source spans are not modeled                                                        |
| `rockwell-rung-rll`       | Supported          | Standalone `TargetType="Rung"` exports are present in the corpus                                      | Rungs have typed resources and owner routine IDs                                                                    |
| `rockwell-tags`           | Partial              | Controller/program tags, aliases, dimensions, comments, forces, decorated arrays/structures, and alarms | Standard tag attributes outside the normalized contract are preserved and explicitly reported as partial |
| `rockwell-full-project`   | Unsupported          | Corpus coverage tracks controller configuration, tasks, RLL, canonical FBD, SFC, protected content, and malformed/adversarial input | Rockwell-specific configuration and unsupported/encoded bodies are preserved with diagnostics; typed SFC bodies remain incomplete |

“Supported” applies only to the declared fixture shapes and versions. “Partial” means useful content is returned but at least one declared construct is preserved without full normalization, recovered, or rejected. “Unsupported” means the profile must not be advertised as a successful parse contract.

## Corpus matrix

The core corpus contains every required artifact target for every declared Studio 5000 version. Each cell is backed by a separate fixture rather than inferring compatibility from a different version.

| Artifact target            | v33.00   | v34.01   | v35.01   | Current boundary                    |
| -------------------------- | -------- | -------- | -------- | ----------------------------------- |
| Controller                 | complete | complete | complete | Controller-shaped result            |
| Program                    | complete | complete | complete | Controller-shaped result            |
| Routine                    | complete | complete | complete | Controller-shaped result            |
| Rung                       | complete | complete | complete | Typed rung and owner routine        |
| Tag                        | complete/partial | complete/partial | complete/partial | Declared value forms normalize; unmodeled metadata is partial |
| DataType (UDT)             | complete | complete | complete | Typed UDT target and dependencies   |
| AddOnInstructionDefinition | complete | complete | complete | AOI metadata plus RLL and Structured Text routines normalize |
| Module                     | complete | complete | complete | Typed module target and dependencies |
| Controller configuration  | partial  | partial  | partial  | Clear metadata normalizes; Rockwell-specific families are preserved with diagnostics |

Three additional `full-project-vXX` fixtures exercise the same semantic families in v33, v34, and v35:

- Structured Text lines, RLL, FBD, SFC, and protected routines.
- Base, produced, and consumed tags plus decorated array data.
- AOI and program parameters and local tags.
- Module ports and connections.
- Tasks, scheduled programs, and wall-clock configuration.
- The schema transition where `MaxObservedNetworkDelay` is an integer in v33 and a float in v34/v35.

Focused v33-v35 FBD fixtures, an AOI-owned FBD fixture, a complete FBD collection/cardinality fixture, and focused v35 SFC and protected-routine fixtures retain small loss-regression cases. Truncated v35 XML, mismatched v34 XML, and a v35 entity-declaration fixture cover malformed and adversarial handling.

Public parser results expose both the legacy `success` boolean and a `status` of `complete`, `partial`, or `failed`. Built-in parsers and result helpers always provide `status`. The field remains optional on the `PLCParser` implementation contract so custom parsers compiled against the earlier boolean-only result remain source-compatible; registry and document orchestration fill a missing status deterministically.

The v33-v35 matrix now covers `EncodedData` routine targets, encoded AOI targets, and mixed documents. The v35 AOI fixture is a sanitized, schema-valid derivative of the public Studio 5000 v35.00 export [`Par_Cast_AOI.L5X` at `b27a0e7`](https://github.com/JeremyMedders/LogixLibraries/blob/b27a0e7fdf99f644d3d32fb84d45810db469a8f7/src/Parameter/Par_Cast_AOI.L5X). Its wrapper attributes and placement follow that export; payload, names, and children were reduced to synthetic content. The public document parser also recognizes the original export and selects its encoded AOI target. The original export includes fields that the pinned v35 XSD rejects, so the derivative is the schema fixture, while the original is shape evidence. The v33-v34 encoded AOI cases and all encoded routine cases are schema-backed synthetic boundaries, not claims of observed exports for those versions.

Completeness is evaluated against the exact encountered construct, not merely whether its source survives in a document fragment. Program `LocalTags` normalize into their own ordered collection with program ownership, dimensions, metadata, ordered shared default-data values, and supported scalar defaults. Unsupported default-data nodes and unrepresentable dimensions remain in source fragments, emit `UNSUPPORTED_L5X_PROGRAM_LOCAL_TAG_DATA` or `UNSUPPORTED_L5X_PROGRAM_LOCAL_TAG_DIMENSIONS`, and make the result `partial`. AOI parameters and local tags expose ordered `defaultData` representations with typed recursive decorated arrays and structures, while `defaultValue` remains a scalar convenience field. AOI local dimensions retain their ordered extents. Parameter and local-tag default changes participate in AOI comparison. Raw or unsupported AOI default formats and nodes emit `UNSUPPORTED_L5X_AOI_DEFAULT_DATA`; unrepresentable local or parameter dimensions and decorated array dimensions or indexes emit precise `UNNORMALIZED_L5X_AOI_*` diagnostics. These cases make the result `partial` while the source remains inspectable. AOI revision notes and additional help text are normalized documentation fields and do not become gaps merely because their source representation is also retained.

The tracked `AB-samples` exports at `68a6a4c05552f9837c95d0bb0accc20c98d7f9e5` contain AOI decorated arrays and structures, but no Program `LocalTags` or multidimensional AOI locals. The v33–v35 fixtures for the latter constructs are schema-valid status probes; they do not establish a Studio export compatibility claim for those shapes.

AOI parameter `Constant` and operand comments, and AOI local-tag operand comments, are typed when present in Studio exports; omitted metadata remains absent. These fields also participate in AOI comparison. `Verified` and 2D/3D AOI local-tag dimensions await in-range export evidence.

Tag data keeps decorated values authoritative. When a tag has only opaque raw data, `TagTable` can use the optional declared data-type catalog to present its structure without decoding or inventing values. This includes recursively nested UDT arrays, comma- or whitespace-separated dimensions, and logical `BOOL` rows backed by packed `BIT` members; hidden backing storage is omitted. Raw-only representations remain `partial`, their leaf values remain unknown, and large arrays are materialized only as the user expands them.

Controller results expose tasks in source order. Task types, descriptions, scheduling attributes, event metadata, and ordered scheduled-program names normalize across v33-v35. Programs retain their declared executing-task name. Missing, duplicate, or contradictory relationships produce stable warnings and a `partial` result while preserving the usable controller. Stable cross-document task and program IDs remain outside this profile.

Controller results expose trends and quick-watch lists in source order. Trends retain capture, trigger, pre/post-sample, and version metadata plus ordered pens; pens retain display and engineering-range metadata. Quick-watch lists retain ordered tag specifiers and their source scopes. Omitted collections and empty child collections normalize to empty arrays. Schema-valid trend and pen integers outside JavaScript's safe range remain source-preserved, produce `UNSUPPORTED_L5X_TREND_NUMERIC_VALUE`, and make the result `partial`. Opaque Studio trend templates and collection bookkeeping IDs remain inspectable source representations rather than vendor-neutral fields.

Controller name, description, project serial, project dates, processor type, and communication path have canonical fields. Remaining controller attributes and the `RedundancyInfo`, `Security`, `SafetyInfo`, `CommPorts`, `CST`, `WallClockTime`, `DataLogs`, `TimeSynchronize`, `InternetProtocol`, `EthernetPorts`, and `EthernetNetwork` families remain complete parsed fragments. Each present family emits a stable `PRESERVED_L5X_*_CONFIGURATION` warning and makes the result `partial`; no cross-vendor meaning is inferred. The v33-v35 schemas define the same shapes, including unconstrained `DataLogs` and repeated serial/Ethernet ports.

## Target-aware document API

`parseDocumentString`, `parseDocumentBuffer`, `parseDocumentFile`, and `L5XParser.parseDocument` return a `PlcDocument`. Ordinary members of all eight target families appear in `resources`, including context and reference dependencies. Each discriminated resource has a `kind`, typed `data`, a `role`, a one-based XML `sourcePath` used as its document-local `id`, and an `ownerId` where applicable. `targetIds` identifies only the declared export family; it can point to a resource or an opaque encoded item. Owned descendants inherit target roles unless explicitly overridden. IDs are not stable across exports.

Every `<EncodedData>` wrapper appears in XML order at `PlcDocument.encodedData`, independently of Routine, AOI, UDT, and Tag models. Each item retains its source path, containing path, wrapper attributes, and untrimmed direct text or CDATA payload. Its capabilities say the payload can be inspected while decoded visualization and semantic queries are unavailable. Encoded routine and AOI targets select the encoded item's path without making an empty normalized routine or AOI. `diffEncodedData` compares exact payload text for matched items; it does not infer decoded changes or Studio importability. The controller-shaped entry point remains partial for encoded content and does not expose the payload collection.

Explicit resource `Use` takes precedence over the immediate collection's `Use`. Otherwise targets are selected by name, a unique eligible candidate, or an export without context. The parser checks declared target counts and reports `AMBIGUOUS_L5X_TARGET` instead of choosing between unresolved candidates. Missing targets produce `MISSING_L5X_TARGET` through document and controller-shaped APIs.

`fragments` retains unmodeled elements, protected/encoded content, and source representations that extend or overlap existing normalized fields. Each fragment has a path, parsed subtree, and reason (`unmodeled`, `protected`, or `source-representation`). Attributes use `@_`; text and CDATA use `#text` and `#cdata`. `mappings` accounts for source leaves represented by typed fields. Tests require every parsed leaf to be mapped or preserved. This is parsed-subtree preservation, without a byte-perfect XML or comment guarantee. Normalized decorated structures retain heterogeneous member declaration order. Opaque trend templates are retained as source representations.

A successful result means a usable document was returned, not that all content was normalized. `PRESERVED_L5X_CONTENT` identifies results with retained fragments. Standard tag metadata outside the normalized contract, explicitly preserved Rockwell controller configuration, recovered FBD placeholders, and SFC bodies can make a result partial. Encoded wrappers and their additional source children remain protected fragments and make the result partial.

### SFC raw source boundary

High-level L5X parsing exposes `NormalizedRoutine.rawSource` for each SFC routine,
including program-owned and AOI-owned resources and standalone Routine exports.
Its `text` is the complete original `<Routine>` element, including all SFC bodies,
online-edit representations, descriptions, comments, CDATA, nested actions,
conditions, presets, limits, and embedded Structured Text. Extraction preserves
attribute spelling/order, XML escapes, whitespace, and original line endings.
`sourcePath` identifies the owning routine by one-based element occurrence;
`startOffset` and `endOffset` are UTF-16 indexes into the decoded input, with an
exclusive end. Slicing that input with those offsets yields `text` exactly.
The XML-object-only `l5xToNormalized()` mapper cannot recover original source text.

The `sfc-raw-v33`, `sfc-raw-v34`, and `sfc-raw-v35` fixtures validate against the
pinned matching schemas. They cover empty/single/repeated bodies, repeated actions,
all SFC child families, nested code, and routines with equal names under different
programs. Focused transport tests exercise v17/v32 envelopes; the v17 exports
`SFC_GearChange.L5X`, `SFC_Motion_Example.L5X`, and `Equipment_Phase_Sequencer.L5X`
in AB-samples at `4aa89ad31a25f6a7dcff7e5094494841d9fc37ca` provide earlier
real-export shape evidence. The new fixtures are synthetic schema-based inputs.

`RawRoutineViewer` renders this source as read-only text with optional line numbers
and the existing Structured Text theme variables. The library demo selects this
fallback for SFC routines. Raw inspection does not normalize SFC semantics: source
fragments and partial-status diagnostics remain, with no rich SFC chart, step/action
navigation, protected-content decoding, or IOFabrik integration in this slice.

### FBD compatibility boundary

Across v33-v35, the parser accepts exactly one FBD body only when `OnlineEditType` is absent. Repeated bodies or any declared or unknown edit-state tag fail before normalized-model creation with `UNSUPPORTED_FBD_ONLINE_EDIT`; the error identifies the owning routine path and observed states. This prevents Original, Pending Edits, and Test Edits views from being mistaken for one deterministic static routine. `NoType` is also rejected until a supported-version real export establishes its semantics.

Accepted static bodies normalize to `NormalizedRoutine.fbd` for Program-owned and AOI-owned routines. The model retains ordered sheets and descriptions, exact string IDs/coordinates, references, connectors, blocks and arrays, AOI bindings, JSR/SBR/RET calls, wires, feedback wires, text boxes, and attachments. Implicit IRef/ICon source terminals and ORef/OCon destination terminals use the canonical `value` port. Every well-formed Block resolves `VisiblePins` from its operand's own decorated direct-member structure: Program tags and Program LocalTags share one program scope before Controller tags, while AOI-owned routines use AOI LocalTags. Duplicate operand names within one program scope produce an ambiguity diagnostic. `EnableIn` and `EnableOut` delimit input/output sides; exact member IDs and data types are retained, nested members are not flattened, and no data-type or wire fallback is attempted. Source arrays are preserved without instruction-specific required-array validation. This source-derived rule is exercised with v17 sample-compatible input and the pinned v33-v35 schema matrix. AOI Input and Output ports resolve from ordered parameter definitions while InOut bindings remain separate. Supported-controller ADD, MUL, SUB, and GRT Function extensions resolve from the Function-only version-aware catalog; other schema-absent Functions, unknown mnemonics, invalid structures, and malformed/unplaceable nodes survive as placeholders with stable diagnostics and make the result partial. Missing presentation metadata uses explicit fallback provenance and informational diagnostics. The raw accepted body remains a `source-representation` fragment rather than an `unmodeled` fragment.

`FBDDiagram` renders one normalized core FBD sheet at a time. One source grid unit equals one SVG user unit; deterministic measurement and orthogonal routing preserve source anchors. Routine-scoped connector matching is exact and case-sensitive, resolves one OCon producer to one or more ICon consumers, and does not draw cross-sheet lines. Blank, unmatched, case-variant, or multiple-producer connector groups remain unresolved with diagnostics. The sanitized v35 level-control fixture and light/dark Chromium baselines define the current visual contract. The viewer also renders Function/AOI nodes, routine-control elements, text boxes, attachments, degraded placeholders, and sheet navigation.

Existing controller-shaped APIs use the same document pipeline and support the newly accepted target families. They return warnings, while the document APIs provide access to fragments. A `TargetType="Program"` envelope without an actual Program target returns `MISSING_L5X_TARGET` through both API families; the parser never fabricates a Program that is absent from the source.

### FBD comparison

`diffFBD` compares normalized body and sheet metadata, elements, ports, operands,
wires (including feedback), attachments and placeholders. `diffControllers` exposes
these results on `RoutineDiff.fbdDiff` for program routines and through
`AOIDiff.routineDiffs` for AOI routines. FBD changes contribute to the existing
routine/program or AOI summary counts; nested FBD entities are not counted again.

Sheets match by declared source number and elements by unique source ID within a
sheet. Decimal IDs are matched without lossy JavaScript number conversion. Reordered
sheets retain their matches and produce a presentation change. Connections and
attachments match as multisets of endpoints, so a rewire is a removal plus an
addition. Exact duplicate-edge matches are reserved before pairing modified edges.
All entries, including unchanged ones, retain both source versions for
rendering. Property changes distinguish known presentation fields from logic and
unknown fields. Missing or duplicate identities are retained as unpaired
added/removed entries with diagnostics and `complete: false`; those entries do not
establish that the source entities were actually added or removed. Parser diagnostics
are not treated as source edits. The API compares normalized content only and does
not establish whole-document equivalence or compare preserved XML fragments.

`FBDDiffDiagram` draws unchanged overlay content once in normal theme colors. For
stationary blocks, only changed fields show older red/newer green values; moved
blocks are colored in full at each version's source position. Added/deleted elements
and changed wire routes are green/red. Small stroke offsets keep coincident changed
geometry visible. Label placement may move text to avoid collisions and draw a
leader to its original anchor; source geometry and semantic results are unchanged.
Unchanged metadata appears once; changed metadata shows both colored values.
Side-by-side views retain full version colors. Ambiguous sheet numbers force
separate-version rendering. Layout failures, unplaceable elements and unresolved
connections remain explicit diagnostics. The viewer offers side-by-side mode and
native pan/zoom, and uses the existing light/dark diff theme colors. No change list,
live state or composed-document validation is involved.

The comparison tests use the existing sanitized v35 level-control export fixture
and controlled normalized deltas. These tests exercise comparisons and rendering;
they do not expand the parser's export compatibility claims or conformance counts.

### Structured Text boundary

Program-owned and AOI-owned `Type="ST"` routines normalize their ordered `STContent/Line` collections across v33-v35. Each `STLine` retains its declared numeric line number and exact body whether Rockwell encoded it as CDATA or ordinary XML text; an absent line collection normalizes to an empty array. This is source preservation for viewing and diffing, not an ST grammar, symbol model, or execution engine. The real v17 `Equipment_Phase_Sequencer.L5X` export from AB-samples is exercised as a regression input, but does not expand the XSD conformance matrix beyond v33-v35.

### Program parameters and state

Program parameters are normalized separately from AOI parameters and retain source order, owning program scope, usage, type metadata, optional booleans, comments, and L5K or decorated default data. Program edit, verification, disabled, routine-entry, Equipment Phase state, scan-time, redundancy-synchronization, and executing-task metadata remain optional when their source attributes are absent. Schema-valid program integers outside JavaScript's safe range remain source-preserved and produce `UNSUPPORTED_L5X_PROGRAM_NUMERIC_VALUE` with a `partial` result. Unsupported schema-valid default-data nodes are retained in document fragments and produce `UNSUPPORTED_L5X_PROGRAM_PARAMETER_DATA` with a `partial` result.

The pinned v33, v34, and v35 schemas use the same `ProgramType` and `AOIParameterType` definitions for these fields. None of those schemas declares a program parameter-connection element or attribute, so this compatibility version does not invent or advertise a parameter-connection relationship. Program `LocalTags` are covered separately below; task-to-program relationships are validated separately.

### Program LocalTags

Program locals remain separate from ordinary tags, parameters, and AOI locals. Each normalized local carries its owning program, source order, optional dimensions and metadata, comments, and all declared `NormalizedTagData` defaults in source order. A supported scalar default also has a convenience `defaultValue`. Missing and empty collections normalize to `[]`. `TagResolver.getProgramTagCandidates` returns same-name ordinary and local declarations together without choosing one. FBD Block operand resolution treats them as one program scope; duplicate names in that scope are ambiguous, and Controller tags remain in the outer scope. The v33–v35 schema-backed fixtures cover declared locals and repeated defaults; focused v17 and v32 parser inputs exercise the older compatibility range without claiming matching XSD validation. See the [slice contract](l5x-program-local-tags-slice.md).

### Program hierarchy and Equipment Phases

Programs retain schema-declared `UId` and `ParentUId` values as exact strings, preserving `xs:unsignedLong` precision, and retain the optional `UseAsFolder` flag. Controller program order remains source order, so parent relationships are deterministic without introducing a second nested program tree. Complete controller exports report duplicate identities, missing parents, cycles, and children attached to an explicit `UseAsFolder=false` parent as stable warnings with source paths and a `partial` result. A standalone Program export may legitimately omit its parent context, so an unresolved `ParentUId` there is retained without a missing-parent warning.

Equipment Phase programs remain distinguishable through `programType: "EquipmentPhase"`. Their existing state and command attributes are joined by safe-integer `equipmentId` and the exact, opaque `recipePhaseNames` string. `RecipePhaseNames` is not split into inferred relationships because the supported XSDs define only an unconstrained string. An out-of-range `EquipmentId` is preserved in document fragments and reported with `UNSUPPORTED_L5X_PROGRAM_NUMERIC_VALUE`.

The v33, v34, and v35 schemas do not declare an EquipmentSequence entity. The sanitized AB-Samples regression represents sequencing as an SFC whose embedded Structured Text invokes `PCMD` against Equipment Phase programs. The parser therefore does not invent a canonical sequence model: it preserves the `SFCContent` fragment and emits `UNSUPPORTED_L5X_EQUIPMENT_SEQUENCE` at that source path. SFC body normalization remains outside this profile.

The document capability is optional on `PLCParser`; existing custom parsers remain compatible. JSON parsing continues through the existing APIs. Calling a document API with a parser lacking that capability returns `UNSUPPORTED_FORMAT`.

## Count rules

Every fixture declares both `sourceCounts` and `normalizedCounts`:

- Source counts are lexical counts of the entity elements present in the L5X input. This remains deterministic even for intentionally malformed files.
- Normalized counts describe the current `NormalizedController` result. They are `null` when parsing fails.
- AOI routines and rungs are included in the aggregate routine and rung totals.
- Counts include ST lines, canonical FBD bodies/sheets/elements/connections/attachments/placeholders, program parameters, AOI parameters/local tags, module ports/connections, tasks, scheduled-program relationships, trends, pens, quick-watch lists, watch tags, decorated arrays, `EncodedData` wrappers, other protected-content containers, and every remaining controller-configuration family and repeated port child where applicable.
- A count change requires an intentional manifest update and review; tests must not silently regenerate baselines.

## Schema validation

Every corpus fixture other than the intentionally malformed and entity-policy cases must validate against its matching v33, v34, or v35 XSD. `npm run test:schema` uses `xmllint` and the schema directory named by `L5X_SCHEMA_DIR`; locally it defaults to the sibling `l5x-schema` checkout.

CI checks out `IOFabrik/l5x-schema` at commit `441573b4f96493a0fa31627a51b8a4ecb857e980`, so schema changes cannot silently alter the baseline. Intentionally malformed and entity-policy fixtures are excluded from XSD success validation and remain covered by parser assertions.

## Adding or changing fixtures

1. Prefer a minimal synthetic export. Anonymize controller names, project serials, network addresses, user names, process names, and proprietary logic before committing a real export.
2. Add the `.L5X` file and its manifest entry in the same change.
3. Declare profiles, Studio 5000 version, root target type, artifact kind, expected contract status, exact source counts, and current normalized counts or error code.
4. Use `partial` whenever source content is omitted or recovered. Use `failed` when the source must not produce a document under the intended production contract.
5. Never weaken an existing count merely to make a regression pass. Explain intentional model changes in the pull request.
6. Run `npm run test:schema`, `npm run test:conformance`, `npm run test:run`, and `npm run typecheck`.

## Reporting

Report corpus results by profile and Studio 5000 version, including complete, partial, and failed fixture counts. Do not publish one overall L5X compatibility percentage: retaining many RLL rungs does not compensate for discarding a single safety-critical FBD or SFC routine.

## Format reference

The fixture taxonomy follows Rockwell Automation publication 1756-RM014D-EN-P, _Logix 5000 Controllers Import/Export_ (September 2025). Fixtures are continuously checked against the corresponding `l5x-v33.xsd`, `l5x-v34.xsd`, or `l5x-v35.xsd` from the pinned IOFabrik `l5x-schema` revision. Public vendor-generated component exports corroborate root target spellings and the v35 encoded AOI wrapper shape; committed fixtures contain synthetic payloads and no third-party project logic.
