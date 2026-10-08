/**
 * diffControllers — Core diff engine for NormalizedController instances.
 *
 * Compares two controllers and produces a structured L5XDiff describing
 * every change at each domain level (programs, routines, rungs, tags,
 * data types, AOIs, modules).
 *
 * Matching strategy:
 *   - Programs → name
 *   - Routines → name (within their program)
 *   - Rungs → unchanged sequence anchors, then relative position
 *   - Tags → name
 *   - Data types → name
 *   - Data type members → name
 *   - AOIs → name
 *   - Modules → name (with id as tiebreaker)
 */

import type {
  NormalizedController,
  NormalizedProgram,
  NormalizedRoutine,
  NormalizedRung,
  NormalizedTag,
  NormalizedProgramLocalTag,
  NormalizedDataType,
  NormalizedDataTypeMember,
  NormalizedAOI,
  NormalizedModule,
  STLine,
} from '../types';

import type {
  L5XDiff,
  L5XDiffSummary,
  ControllerInfoDiff,
  ProgramDiff,
  RoutineDiff,
  RungDiff,
  STDiff,
  TagDiff,
  ProgramLocalTagDiff,
  DataTypeDiff,
  DataTypeMemberDiff,
  AOIDiff,
  ModuleDiff,
} from './types';

import { diffFBD } from './diffFBD';

import { matchByKey, diffProperties, valuesEqual } from './matching';

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Compare two NormalizedController instances and produce a structured diff.
 *
 * @param oldController - The "before" state (e.g., previous commit).
 * @param newController - The "after" state (e.g., current working tree).
 * @returns A complete L5XDiff with per-section changes and summary counts.
 */
export function diffControllers(
  oldController: NormalizedController,
  newController: NormalizedController,
): L5XDiff {
  const controllerInfo = diffControllerInfo(oldController, newController);
  const programs = diffPrograms(oldController.programs, newController.programs);
  const tags = diffTags(oldController.tags, newController.tags);
  const dataTypes = diffDataTypes(oldController.dataTypes, newController.dataTypes);
  const aois = diffAOIs(oldController.aois, newController.aois);
  const modules = diffModules(oldController.modules, newController.modules);

  const summary = computeSummary(programs, tags, dataTypes, aois, modules);

  return {
    controllerInfo,
    programs,
    tags,
    dataTypes,
    aois,
    modules,
    summary,
  };
}

// ============================================================================
// Controller Info
// ============================================================================

const CONTROLLER_PROPS = [
  'name', 'description', 'serialNumber', 'commPath', 'processorType',
  'createdDate', 'modifiedDate', 'vendor', 'sourceFormat',
];

function diffControllerInfo(
  oldCtrl: NormalizedController,
  newCtrl: NormalizedController,
): ControllerInfoDiff {
  const changes = diffProperties(
    oldCtrl as unknown as Record<string, unknown>,
    newCtrl as unknown as Record<string, unknown>,
    CONTROLLER_PROPS,
  );
  return { changes };
}

// ============================================================================
// Programs
// ============================================================================

const PROGRAM_PROPS = ['description', 'mainRoutineName', 'faultRoutineName', 'disabled'];

function diffPrograms(
  oldPrograms: NormalizedProgram[],
  newPrograms: NormalizedProgram[],
): ProgramDiff[] {
  const { added, removed, matched } = matchByKey(
    oldPrograms,
    newPrograms,
    (p) => p.name,
  );

  const diffs: ProgramDiff[] = [];

  // Added programs
  for (const prog of added) {
    const localTagDiffs = diffProgramLocalTags([], prog.localTags ?? []);
    diffs.push({
      name: prog.name,
      kind: 'added',
      routineDiffs: prog.routines.map((r) => ({
        name: r.name,
        kind: 'added' as const,
        routineType: r.type,
        newRoutine: r,
        fbdDiff: r.fbd ? diffFBD(undefined, r.fbd) : undefined,
        summary: r.type === 'RLL' ? { rungsAdded: r.rungs.length, rungsRemoved: 0, rungsModified: 0 } : undefined,
      })),
      tagDiffs: prog.tags.map((t) => ({
        name: t.name,
        kind: 'added' as const,
        newTag: t,
      })),
      ...(localTagDiffs.length > 0 ? { localTagDiffs } : {}),
    });
  }

  // Removed programs
  for (const prog of removed) {
    const localTagDiffs = diffProgramLocalTags(prog.localTags ?? [], []);
    diffs.push({
      name: prog.name,
      kind: 'removed',
      routineDiffs: prog.routines.map((r) => ({
        name: r.name,
        kind: 'removed' as const,
        routineType: r.type,
        oldRoutine: r,
        fbdDiff: r.fbd ? diffFBD(r.fbd, undefined) : undefined,
        summary: r.type === 'RLL' ? { rungsAdded: 0, rungsRemoved: r.rungs.length, rungsModified: 0 } : undefined,
      })),
      tagDiffs: prog.tags.map((t) => ({
        name: t.name,
        kind: 'removed' as const,
        oldTag: t,
      })),
      ...(localTagDiffs.length > 0 ? { localTagDiffs } : {}),
    });
  }

  // Matched programs — diff routines and tags within them
  for (const { oldItem, newItem } of matched) {
    const routineDiffs = diffRoutines(oldItem.routines, newItem.routines);
    const tagDiffs = diffTags(oldItem.tags, newItem.tags);
    const localTagDiffs = diffProgramLocalTags(oldItem.localTags ?? [], newItem.localTags ?? []);
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      PROGRAM_PROPS,
    );

    const hasChanges =
      routineDiffs.length > 0 ||
      tagDiffs.length > 0 ||
      localTagDiffs.length > 0 ||
      propertyChanges.length > 0;

    if (hasChanges) {
      diffs.push({
        name: oldItem.name,
        kind: 'modified',
        routineDiffs,
        tagDiffs,
        ...(localTagDiffs.length > 0 ? { localTagDiffs } : {}),
        propertyChanges,
      });
    }
  }

  return diffs;
}

// ============================================================================
// Routines
// ============================================================================

const ROUTINE_PROPS = ['description', 'type'];

function diffRoutines(
  oldRoutines: NormalizedRoutine[],
  newRoutines: NormalizedRoutine[],
): RoutineDiff[] {
  const { added, removed, matched } = matchByKey(
    oldRoutines,
    newRoutines,
    (r) => r.name,
  );

  const diffs: RoutineDiff[] = [];

  for (const routine of added) {
    diffs.push({
      name: routine.name,
      kind: 'added',
      routineType: routine.type,
      newRoutine: routine,
      fbdDiff: routine.fbd ? diffFBD(undefined, routine.fbd) : undefined,
      summary: routine.type === 'RLL'
        ? { rungsAdded: routine.rungs.length, rungsRemoved: 0, rungsModified: 0 }
        : undefined,
    });
  }

  for (const routine of removed) {
    diffs.push({
      name: routine.name,
      kind: 'removed',
      routineType: routine.type,
      oldRoutine: routine,
      fbdDiff: routine.fbd ? diffFBD(routine.fbd, undefined) : undefined,
      summary: routine.type === 'RLL'
        ? { rungsAdded: 0, rungsRemoved: routine.rungs.length, rungsModified: 0 }
        : undefined,
    });
  }

  for (const { oldItem, newItem } of matched) {
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      ROUTINE_PROPS,
    );

    let rungDiffs: RungDiff[] | undefined;
    let rungAlignment: RoutineDiff['rungAlignment'];
    let stDiff: STDiff | undefined;
    let summary: RoutineDiff['summary'] | undefined;

    if (newItem.type === 'RLL' || oldItem.type === 'RLL') {
      rungAlignment = alignRungs(oldItem.rungs, newItem.rungs);
      rungDiffs = diffRungs(rungAlignment);
      summary = {
        rungsAdded: rungDiffs.filter((r) => r.kind === 'added').length,
        rungsRemoved: rungDiffs.filter((r) => r.kind === 'removed').length,
        rungsModified: rungDiffs.filter((r) => r.kind === 'modified').length,
      };
    }

    if (newItem.type === 'ST' || oldItem.type === 'ST') {
      stDiff = diffStructuredText(oldItem.stContent, newItem.stContent);
    }

    const fbdDiff = oldItem.fbd || newItem.fbd ? diffFBD(oldItem.fbd, newItem.fbd) : undefined;
    const hasRungChanges = rungDiffs !== undefined && rungDiffs.length > 0;
    const hasSTChanges = stDiff !== undefined && stDiff.oldText !== stDiff.newText;
    const hasChanges = propertyChanges.length > 0 || hasRungChanges || hasSTChanges || fbdDiff?.hasChanges;

    if (hasChanges) {
      diffs.push({
        name: oldItem.name,
        kind: 'modified',
        routineType: newItem.type,
        rungDiffs: hasRungChanges ? rungDiffs : undefined,
        rungAlignment,
        stDiff: hasSTChanges ? stDiff : undefined,
        fbdDiff: fbdDiff?.hasChanges ? fbdDiff : undefined,
        propertyChanges: propertyChanges.length > 0 ? propertyChanges : undefined,
        oldRoutine: oldItem,
        newRoutine: newItem,
        summary,
      });
    }
  }

  return diffs;
}

// ============================================================================
// Rungs (RLL)
// ============================================================================

const RUNG_PROPS = ['comment', 'type'];

interface RungSequencePair { oldIndex?: number; newIndex?: number }

/** Hirschberg alignment keeps score rows, rather than a table for the entire routine. */
function alignRungSequence(
  oldStart: number, oldEnd: number, newStart: number, newEnd: number,
  cost: (oldIndex: number, newIndex: number) => number,
): RungSequencePair[] {
  const prefix: RungSequencePair[] = [];
  while (oldStart < oldEnd && newStart < newEnd && cost(oldStart, newStart) === 0) {
    prefix.push({ oldIndex: oldStart++, newIndex: newStart++ });
  }
  if (oldStart === oldEnd) return prefix.concat(Array.from({ length: newEnd - newStart },
    (_, index) => ({ newIndex: newStart + index })));
  if (newStart === newEnd) return prefix.concat(Array.from({ length: oldEnd - oldStart },
    (_, index) => ({ oldIndex: oldStart + index })));
  if (oldEnd - oldStart === 1) {
    let match: number | undefined, best = 2;
    for (let index = newStart; index < newEnd; index++) {
      const value = cost(oldStart, index);
      if (value < best) { best = value; match = index; }
    }
    if (match === undefined) prefix.push({ oldIndex: oldStart });
    for (let index = newStart; index < newEnd; index++) {
      prefix.push({ newIndex: index, oldIndex: index === match ? oldStart : undefined });
    }
    return prefix;
  }
  const middle = (oldStart + oldEnd) >>> 1;
  const scoreRow = (start: number, end: number, reverse: boolean) => {
    const row = Float64Array.from({ length: newEnd - newStart + 1 }, (_, index) => index);
    for (let i = 0; i < end - start; i++) {
      let diagonal = row[0];
      row[0] = i + 1;
      for (let j = 1; j < row.length; j++) {
        const previous = row[j];
        row[j] = Math.min(previous + 1, row[j - 1] + 1, diagonal + cost(
          reverse ? end - i - 1 : start + i,
          reverse ? newEnd - j : newStart + j - 1));
        diagonal = previous;
      }
    }
    return row;
  };
  let forward = scoreRow(oldStart, middle, false), backward = scoreRow(middle, oldEnd, true);
  let split = 0, best = Infinity;
  for (let index = 0; index < forward.length; index++) {
    const value = forward[index] + backward[backward.length - index - 1];
    if (value < best) { best = value; split = index; }
  }
  // Release the score rows before descending into either half.
  forward = backward = new Float64Array(0);
  return prefix.concat(
    alignRungSequence(oldStart, middle, newStart, newStart + split, cost),
    alignRungSequence(middle, oldEnd, newStart + split, newEnd, cost));
}

/** Myers is fast for ordinary edits; cap its trace and retain the bounded-memory fallback. */
function exactRungAnchors(oldKeys: string[], newKeys: string[]): Array<{ oldIndex: number; newIndex: number }> {
  const trace: Int32Array[] = [];
  for (let depth = 0; depth <= oldKeys.length + newKeys.length; depth++) {
    if ((depth + 1) ** 2 > 1_000_000) break;
    const frontier = new Int32Array(2 * depth + 1).fill(-1);
    const previous = trace[depth - 1];
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const left = previous?.[diagonal + depth - 2] ?? -1;
      const right = previous?.[diagonal + depth] ?? -1;
      let x = depth === 0 ? 0 : diagonal === -depth || (diagonal !== depth && left < right)
        ? right : left + 1;
      let y = x - diagonal;
      while (x < oldKeys.length && y < newKeys.length && oldKeys[x] === newKeys[y]) { x++; y++; }
      frontier[diagonal + depth] = x;
      if (x < oldKeys.length || y < newKeys.length) continue;
      trace.push(frontier);
      const anchors: Array<{ oldIndex: number; newIndex: number }> = [];
      x = oldKeys.length; y = newKeys.length;
      for (let step = depth; step > 0; step--) {
        const k = x - y, row = trace[step - 1];
        const priorK = k === -step || (k !== step && (row[k + step - 2] ?? -1) < (row[k + step] ?? -1))
          ? k + 1 : k - 1;
        const priorX = row[priorK + step - 1], priorY = priorX - priorK;
        while (x > priorX && y > priorY) anchors.push({ oldIndex: --x, newIndex: --y });
        x = priorX; y = priorY;
      }
      while (x > 0 && y > 0) anchors.push({ oldIndex: --x, newIndex: --y });
      return anchors.reverse();
    }
    trace.push(frontier);
  }
  return alignRungSequence(0, oldKeys.length, 0, newKeys.length,
    (i, j) => oldKeys[i] === newKeys[j] ? 0 : Infinity).flatMap(pair =>
    pair.oldIndex === undefined || pair.newIndex === undefined ? []
      : [{ oldIndex: pair.oldIndex, newIndex: pair.newIndex }]);
}

/** Exported numbers change on insertion. Reserve unchanged sequence anchors first. */
function alignRungs(
  oldRungs: NormalizedRung[],
  newRungs: NormalizedRung[],
): NonNullable<RoutineDiff['rungAlignment']> {
  const key = (rung: NormalizedRung) => JSON.stringify([rung.raw, rung.comment, rung.type]);
  const oldKeys = oldRungs.map(key), newKeys = newRungs.map(key);
  const newKeySet = new Set(newKeys);
  // Metadata-only edits at the same logic positions need no sequence search.
  // Keep exact anchors when an unchanged full rung moved to another position.
  if (oldRungs.length === newRungs.length && oldRungs.every((rung, index) =>
    rung.raw === newRungs[index].raw && (oldKeys[index] === newKeys[index] || !newKeySet.has(oldKeys[index])))) {
    return oldRungs.map((oldRung, index) => ({ oldRung, newRung: newRungs[index] }));
  }
  const anchors = oldKeys.some(key => newKeySet.has(key)) ? exactRungAnchors(oldKeys, newKeys) : [];
  const pairs: NonNullable<RoutineDiff['rungAlignment']> = [];
  let oldCursor = 0, newCursor = 0;
  const span = (oldEnd: number, newEnd: number) => {
    const oldStart = oldCursor, newStart = newCursor;
    // Within an unanchored span, prefer a small logic edit over an unrelated insertion.
    const tokens = (raw: string) => new Set(raw.match(/[\w.$:]+/g) ?? []);
    const oldTokens = oldRungs.slice(oldCursor, oldEnd).map(rung => tokens(rung.raw));
    const newTokens = newRungs.slice(newCursor, newEnd).map(rung => tokens(rung.raw));
    const editCost = (i: number, j: number) => {
      if (oldRungs[i].number - i !== newRungs[j].number - j)
        return Infinity;
      const oldSet = oldTokens[i - oldStart], newSet = newTokens[j - newStart];
      const common = [...oldSet].filter(token => newSet.has(token)).length;
      return Math.max(0.25, 1 - common / Math.max(1, oldSet.size, newSet.size));
    };
    for (const pair of alignRungSequence(oldStart, oldEnd, newStart, newEnd, editCost)) {
      pairs.push({ oldRung: pair.oldIndex === undefined ? undefined : oldRungs[pair.oldIndex],
        newRung: pair.newIndex === undefined ? undefined : newRungs[pair.newIndex] });
    }
    oldCursor = oldEnd; newCursor = newEnd;
  };
  for (const { oldIndex, newIndex } of anchors) {
    span(oldIndex, newIndex);
    pairs.push({ oldRung: oldRungs[oldIndex], newRung: newRungs[newIndex] });
    oldCursor = oldIndex + 1; newCursor = newIndex + 1;
  }
  span(oldRungs.length, newRungs.length);
  return pairs;
}

function diffRungs(alignment: NonNullable<RoutineDiff['rungAlignment']>): RungDiff[] {
  const diffs: RungDiff[] = [];
  for (const { oldRung: oldItem, newRung: newItem } of alignment) {
    if (!oldItem || !newItem) {
      diffs.push({
        rungNumber: (newItem ?? oldItem)!.number,
        kind: newItem ? 'added' : 'removed',
        oldRung: oldItem,
        newRung: newItem,
      });
      continue;
    }
    // Compare rung raw text (the canonical representation of the logic)
    const rawChanged = oldItem.raw !== newItem.raw;
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      RUNG_PROPS,
    );

    if (rawChanged || propertyChanges.length > 0) {
      diffs.push({
        rungNumber: newItem.number,
        kind: 'modified',
        oldRung: oldItem,
        newRung: newItem,
        propertyChanges: propertyChanges.length > 0 ? propertyChanges : undefined,
      });
    }
  }

  // Sort by rung number for stable output
  diffs.sort((a, b) => a.rungNumber - b.rungNumber);

  return diffs;
}

// ============================================================================
// Structured Text (ST)
// ============================================================================

function stLinesToString(lines?: STLine[]): string {
  if (!lines || lines.length === 0) return '';
  return lines.map((l) => l.text).join('\n');
}

function diffStructuredText(
  oldContent?: STLine[],
  newContent?: STLine[],
): STDiff {
  return {
    oldText: stLinesToString(oldContent),
    newText: stLinesToString(newContent),
  };
}

// ============================================================================
// Tags
// ============================================================================

const TAG_PROPS = [
  'tagType', 'dataType', 'radix', 'externalAccess',
  'scope', 'description', 'aliasFor', 'value',
  'dimensions', 'constant', 'canForce', 'comments', 'forceData', 'data',
];

function diffTags(
  oldTags: NormalizedTag[],
  newTags: NormalizedTag[],
): TagDiff[] {
  const { added, removed, matched } = matchByKey(
    oldTags,
    newTags,
    (t) => t.name,
  );

  const diffs: TagDiff[] = [];

  for (const tag of added) {
    diffs.push({ name: tag.name, kind: 'added', newTag: tag });
  }

  for (const tag of removed) {
    diffs.push({ name: tag.name, kind: 'removed', oldTag: tag });
  }

  for (const { oldItem, newItem } of matched) {
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      TAG_PROPS,
    );
    if (propertyChanges.length > 0) {
      diffs.push({
        name: oldItem.name,
        kind: 'modified',
        propertyChanges,
        oldTag: oldItem,
        newTag: newItem,
      });
    }
  }

  return diffs;
}

// ============================================================================
// Program Local Tags
// ============================================================================

const PROGRAM_LOCAL_TAG_PROPS = [
  'uid', 'parentUid', 'dataTypeUid', 'dataType', 'scope', 'programName',
  'dimensions', 'radix', 'externalAccess', 'verified', 'description',
  'comments', 'defaultData', 'defaultValue',
];

function diffProgramLocalTags(
  oldTags: NormalizedProgramLocalTag[],
  newTags: NormalizedProgramLocalTag[],
): ProgramLocalTagDiff[] {
  const { added, removed, matched } = matchByKey(oldTags, newTags, (tag) => tag.name);
  const diffs: ProgramLocalTagDiff[] = [
    ...added.map((tag) => ({ name: tag.name, kind: 'added' as const, newTag: tag })),
    ...removed.map((tag) => ({ name: tag.name, kind: 'removed' as const, oldTag: tag })),
  ];
  for (const { oldItem, newItem } of matched) {
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      PROGRAM_LOCAL_TAG_PROPS,
    );
    if (propertyChanges.length > 0) {
      diffs.push({
        name: oldItem.name,
        kind: 'modified',
        propertyChanges,
        oldTag: oldItem,
        newTag: newItem,
      });
    }
  }
  return diffs;
}

// ============================================================================
// Data Types
// ============================================================================

const DATATYPE_PROPS = ['family', 'class', 'description'];
const MEMBER_PROPS = [
  'dataType',
  'dimension',
  'dimensions',
  'radix',
  'hidden',
  'storageTarget',
  'bitNumber',
  'externalAccess',
  'description',
];

function diffDataTypes(
  oldTypes: NormalizedDataType[],
  newTypes: NormalizedDataType[],
): DataTypeDiff[] {
  const { added, removed, matched } = matchByKey(
    oldTypes,
    newTypes,
    (dt) => dt.name,
  );

  const diffs: DataTypeDiff[] = [];

  for (const dt of added) {
    diffs.push({
      name: dt.name,
      kind: 'added',
      memberDiffs: [],
      newDataType: dt,
    });
  }

  for (const dt of removed) {
    diffs.push({
      name: dt.name,
      kind: 'removed',
      memberDiffs: [],
      oldDataType: dt,
    });
  }

  for (const { oldItem, newItem } of matched) {
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      DATATYPE_PROPS,
    );
    const memberDiffs = diffDataTypeMembers(oldItem.members, newItem.members);

    if (propertyChanges.length > 0 || memberDiffs.length > 0) {
      diffs.push({
        name: oldItem.name,
        kind: 'modified',
        memberDiffs,
        propertyChanges: propertyChanges.length > 0 ? propertyChanges : undefined,
        oldDataType: oldItem,
        newDataType: newItem,
      });
    }
  }

  return diffs;
}

function diffDataTypeMembers(
  oldMembers: NormalizedDataTypeMember[],
  newMembers: NormalizedDataTypeMember[],
): DataTypeMemberDiff[] {
  const { added, removed, matched } = matchByKey(
    oldMembers,
    newMembers,
    (m) => m.name,
  );

  const diffs: DataTypeMemberDiff[] = [];

  for (const member of added) {
    diffs.push({ name: member.name, kind: 'added', newMember: member });
  }

  for (const member of removed) {
    diffs.push({ name: member.name, kind: 'removed', oldMember: member });
  }

  for (const { oldItem, newItem } of matched) {
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      MEMBER_PROPS,
    );
    if (propertyChanges.length > 0) {
      diffs.push({
        name: oldItem.name,
        kind: 'modified',
        propertyChanges,
        oldMember: oldItem,
        newMember: newItem,
      });
    }
  }

  return diffs;
}

// ============================================================================
// AOIs
// ============================================================================

const AOI_PROPS = [
  'description', 'revision', 'revisionExtension', 'vendor', 'class',
  'executePrescan', 'executePostscan', 'executeEnableInFalse',
  'revisionNote', 'helpText',
];

const AOI_PARAMETER_PROPS = [
  'tagType', 'dataType', 'usage', 'radix', 'dimensions', 'required', 'visible',
  'constant', 'externalAccess', 'description', 'comments', 'defaultValue', 'defaultData',
];

const AOI_LOCAL_TAG_PROPS = [
  'dataType', 'radix', 'dimensions', 'externalAccess', 'description', 'comments',
  'defaultValue', 'defaultData',
];

function diffAOIs(
  oldAOIs: NormalizedAOI[],
  newAOIs: NormalizedAOI[],
): AOIDiff[] {
  const { added, removed, matched } = matchByKey(
    oldAOIs,
    newAOIs,
    (a) => a.name,
  );

  const diffs: AOIDiff[] = [];

  for (const aoi of added) {
    diffs.push({ name: aoi.name, kind: 'added', newAOI: aoi, routineDiffs: diffRoutines([], aoi.routines) });
  }

  for (const aoi of removed) {
    diffs.push({ name: aoi.name, kind: 'removed', oldAOI: aoi, routineDiffs: diffRoutines(aoi.routines, []) });
  }

  for (const { oldItem, newItem } of matched) {
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      AOI_PROPS,
    );

    // Compute parameter summary
    const paramMatch = matchByKey(oldItem.parameters, newItem.parameters, (p) => p.name);
    let paramModified = 0;
    for (const { oldItem: oldP, newItem: newP } of paramMatch.matched) {
      const pChanges = diffProperties(
        oldP as unknown as Record<string, unknown>,
        newP as unknown as Record<string, unknown>,
        AOI_PARAMETER_PROPS,
      );
      if (pChanges.length > 0) paramModified++;
    }

    const localMatch = matchByKey(oldItem.localTags, newItem.localTags, (tag) => tag.name);
    let localModified = 0;
    for (const { oldItem: oldTag, newItem: newTag } of localMatch.matched) {
      const localChanges = diffProperties(
        oldTag as unknown as Record<string, unknown>,
        newTag as unknown as Record<string, unknown>,
        AOI_LOCAL_TAG_PROPS,
      );
      if (localChanges.length > 0) localModified++;
    }

    // Check routines within the AOI
    const routineDiffs = diffRoutines(oldItem.routines, newItem.routines);

    const paramSummary = {
      added: paramMatch.added.length,
      removed: paramMatch.removed.length,
      modified: paramModified,
    };
    const localTagSummary = {
      added: localMatch.added.length,
      removed: localMatch.removed.length,
      modified: localModified,
    };

    const hasChanges =
      propertyChanges.length > 0 ||
      paramSummary.added > 0 ||
      paramSummary.removed > 0 ||
      paramSummary.modified > 0 ||
      localTagSummary.added > 0 ||
      localTagSummary.removed > 0 ||
      localTagSummary.modified > 0 ||
      routineDiffs.length > 0;

    if (hasChanges) {
      diffs.push({
        name: oldItem.name,
        kind: 'modified',
        propertyChanges: propertyChanges.length > 0 ? propertyChanges : undefined,
        oldAOI: oldItem,
        newAOI: newItem,
        routineDiffs,
        parameterSummary: paramSummary,
        localTagSummary,
      });
    }
  }

  return diffs;
}

// ============================================================================
// Modules
// ============================================================================

const MODULE_PROPS = [
  'name', 'catalogNumber', 'description', 'vendorId', 'productType',
  'productCode', 'majorRevision', 'minorRevision', 'category',
  'parentModuleName', 'parentPortId', 'slot', 'inhibited', 'majorFault',
  'safetyEnabled', 'eKeyState',
];

function diffModules(
  oldModules: NormalizedModule[],
  newModules: NormalizedModule[],
): ModuleDiff[] {
  // Match by name (with id as a string fallback key for unnamed modules)
  const { added, removed, matched } = matchByKey(
    oldModules,
    newModules,
    (m) => m.name || `__module_id_${m.id}`,
  );

  const diffs: ModuleDiff[] = [];

  for (const mod of added) {
    diffs.push({ name: mod.name, id: mod.id, kind: 'added', newModule: mod });
  }

  for (const mod of removed) {
    diffs.push({ name: mod.name, id: mod.id, kind: 'removed', oldModule: mod });
  }

  for (const { oldItem, newItem } of matched) {
    const propertyChanges = diffProperties(
      oldItem as unknown as Record<string, unknown>,
      newItem as unknown as Record<string, unknown>,
      MODULE_PROPS,
    );

    // Also compare ports and connections via deep equality
    const portsChanged = !valuesEqual(oldItem.ports, newItem.ports);
    const connectionsChanged = !valuesEqual(oldItem.connections, newItem.connections);

    if (propertyChanges.length > 0 || portsChanged || connectionsChanged) {
      const allChanges = [...propertyChanges];
      if (portsChanged) {
        allChanges.push({ property: 'ports', oldValue: oldItem.ports, newValue: newItem.ports });
      }
      if (connectionsChanged) {
        allChanges.push({ property: 'connections', oldValue: oldItem.connections, newValue: newItem.connections });
      }

      diffs.push({
        name: oldItem.name,
        id: oldItem.id,
        kind: 'modified',
        propertyChanges: allChanges,
        oldModule: oldItem,
        newModule: newItem,
      });
    }
  }

  return diffs;
}

// ============================================================================
// Summary Computation
// ============================================================================

function countChanges(items: Array<{ kind: string }>): { added: number; removed: number; modified: number } {
  let added = 0, removed = 0, modified = 0;
  for (const item of items) {
    if (item.kind === 'added') added++;
    else if (item.kind === 'removed') removed++;
    else if (item.kind === 'modified') modified++;
  }
  return { added, removed, modified };
}

function computeSummary(
  programs: ProgramDiff[],
  tags: TagDiff[],
  dataTypes: DataTypeDiff[],
  aois: AOIDiff[],
  modules: ModuleDiff[],
): L5XDiffSummary {
  const programCounts = countChanges(programs);
  const tagCounts = countChanges(tags);
  const dataTypeCounts = countChanges(dataTypes);
  const aoiCounts = countChanges(aois);
  const moduleCounts = countChanges(modules);

  // Aggregate routine and rung counts from within programs
  const allRoutineDiffs = programs.flatMap((p) => p.routineDiffs);
  const routineCounts = countChanges(allRoutineDiffs);

  const allRungDiffs = allRoutineDiffs.flatMap((r) => r.rungDiffs ?? []);
  const rungCounts = countChanges(allRungDiffs);

  // Also count program-scoped tags
  const programTagDiffs = programs.flatMap((p) => [...p.tagDiffs, ...(p.localTagDiffs ?? [])]);
  tagCounts.added += programTagDiffs.filter((t) => t.kind === 'added').length;
  tagCounts.removed += programTagDiffs.filter((t) => t.kind === 'removed').length;
  tagCounts.modified += programTagDiffs.filter((t) => t.kind === 'modified').length;

  const totalChanges =
    programCounts.added + programCounts.removed + programCounts.modified +
    routineCounts.added + routineCounts.removed + routineCounts.modified +
    rungCounts.added + rungCounts.removed + rungCounts.modified +
    tagCounts.added + tagCounts.removed + tagCounts.modified +
    dataTypeCounts.added + dataTypeCounts.removed + dataTypeCounts.modified +
    aoiCounts.added + aoiCounts.removed + aoiCounts.modified +
    moduleCounts.added + moduleCounts.removed + moduleCounts.modified;

  return {
    totalChanges,
    programs: programCounts,
    routines: routineCounts,
    rungs: rungCounts,
    tags: tagCounts,
    dataTypes: dataTypeCounts,
    aois: aoiCounts,
    modules: moduleCounts,
  };
}
