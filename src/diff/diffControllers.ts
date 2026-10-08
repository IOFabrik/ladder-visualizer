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

/** Exported numbers change on insertion. Reserve unchanged sequence anchors first. */
function alignRungs(
  oldRungs: NormalizedRung[],
  newRungs: NormalizedRung[],
): NonNullable<RoutineDiff['rungAlignment']> {
  const key = (rung: NormalizedRung) => JSON.stringify([rung.raw, rung.comment, rung.type]);
  const oldKeys = oldRungs.map(key), newKeys = newRungs.map(key);
  const table = Array.from({ length: oldRungs.length + 1 }, () =>
    new Uint32Array(newRungs.length + 1)
  );
  for (let i = oldRungs.length - 1; i >= 0; i--) {
    for (let j = newRungs.length - 1; j >= 0; j--) {
      table[i][j] = oldKeys[i] === newKeys[j] ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: NonNullable<RoutineDiff['rungAlignment']> = [];
  let oldCursor = 0, newCursor = 0;
  const span = (oldEnd: number, newEnd: number) => {
    const oldStart = oldCursor, newStart = newCursor;
    // Within an unanchored span, prefer a small logic edit over an unrelated insertion.
    const tokens = (raw: string) => new Set(raw.match(/[\w.$:]+/g) ?? []);
    const oldTokens = oldRungs.slice(oldCursor, oldEnd).map(rung => tokens(rung.raw));
    const newTokens = newRungs.slice(newCursor, newEnd).map(rung => tokens(rung.raw));
    const costs = Array.from({ length: oldTokens.length + 1 }, () => new Float64Array(newTokens.length + 1));
    const editCost = (i: number, j: number) => {
      if (oldRungs[oldStart + i].number - oldStart - i !== newRungs[newStart + j].number - newStart - j)
        return Infinity;
      const common = [...oldTokens[i]].filter(token => newTokens[j].has(token)).length;
      return Math.max(0.25, 1 - common / Math.max(1, oldTokens[i].size, newTokens[j].size));
    };
    for (let i = oldTokens.length; i >= 0; i--) {
      for (let j = newTokens.length; j >= 0; j--) {
        costs[i][j] = i === oldTokens.length ? newTokens.length - j
          : j === newTokens.length ? oldTokens.length - i
          : Math.min(costs[i + 1][j] + 1, costs[i][j + 1] + 1, costs[i + 1][j + 1] + editCost(i, j));
      }
    }
    let i = 0, j = 0;
    while (oldCursor < oldEnd || newCursor < newEnd) {
      const oldRung = oldCursor < oldEnd ? oldRungs[oldCursor] : undefined;
      const newRung = newCursor < newEnd ? newRungs[newCursor] : undefined;
      if (oldRung && newRung && costs[i][j] === costs[i + 1][j + 1] + editCost(i, j)) {
        pairs.push({ oldRung, newRung }); i++; j++; oldCursor++; newCursor++;
      } else if (oldRung && (!newRung || costs[i + 1][j] < costs[i][j + 1])) {
        pairs.push({ oldRung }); i++; oldCursor++;
      } else {
        pairs.push({ newRung }); j++; newCursor++;
      }
    }
  };
  let i = 0, j = 0;
  while (i < oldRungs.length && j < newRungs.length) {
    if (oldKeys[i] === newKeys[j]) {
      span(i, j);
      pairs.push({ oldRung: oldRungs[i++], newRung: newRungs[j++] });
      oldCursor = i; newCursor = j;
    } else if (table[i][j + 1] >= table[i + 1][j]) j++;
    else i++;
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
