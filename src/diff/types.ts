/**
 * L5X Diff Types — Domain-aware structured diff for PLC controller data.
 *
 * These types represent the difference between two NormalizedController instances,
 * broken down by section (programs, routines, tags, data types, AOIs, modules).
 *
 * Entities are matched by stable names or aligned content
 * and classified as added, removed, or modified.
 */

import type { FBDDiff } from './diffFBD';

import type {
  NormalizedRoutine,
  NormalizedRung,
  NormalizedTag,
  NormalizedProgramLocalTag,
  NormalizedDataType,
  NormalizedDataTypeMember,
  NormalizedAOI,
  NormalizedModule,
  NormalizedRoutineType,
} from '../types';

// ============================================================================
// Generic Change Wrapper
// ============================================================================

/** The kind of change detected for an entity. */
export type ChangeKind = 'added' | 'removed' | 'modified';

/**
 * A generic change record wrapping an entity with its old/new values.
 * - added:    `oldValue` is undefined, `newValue` is present.
 * - removed:  `oldValue` is present, `newValue` is undefined.
 * - modified: Both `oldValue` and `newValue` are present.
 */
export interface Change<T> {
  kind: ChangeKind;
  oldValue?: T;
  newValue?: T;
}

// ============================================================================
// Property-Level Diff (for tags, data type members, etc.)
// ============================================================================

/** A single property that changed on an entity. */
export interface PropertyChange {
  /** The property name (e.g., "dataType", "description", "value"). */
  property: string;
  /** The old value (undefined for added properties). */
  oldValue: unknown;
  /** The new value (undefined for removed properties). */
  newValue: unknown;
}

// ============================================================================
// Controller Info Diff
// ============================================================================

/** Changes to top-level controller metadata (name, description, dates, etc.). */
export interface ControllerInfoDiff {
  changes: PropertyChange[];
}

// ============================================================================
// Rung Diff (for RLL routines)
// ============================================================================

/** A diff entry for a single rung within an RLL routine. */
export interface RungDiff {
  /** Display number: the new rung number, or the old number for a removal. */
  rungNumber: number;
  /** The kind of change. */
  kind: ChangeKind;
  /** The old rung data (undefined if added). */
  oldRung?: NormalizedRung;
  /** The new rung data (undefined if removed). */
  newRung?: NormalizedRung;
  /** Which properties changed (comment, raw text, type) — for 'modified' only. */
  propertyChanges?: PropertyChange[];
}

// ============================================================================
// Structured Text Diff (for ST routines)
// ============================================================================

/**
 * A unified text diff for structured text routines.
 * Uses a simplified representation — the full ST content as old/new strings
 * so the UI layer can run a text diffing library (e.g. react-diff-view).
 */
export interface STDiff {
  /** Full old ST content as a single string (lines joined by \n). */
  oldText: string;
  /** Full new ST content as a single string (lines joined by \n). */
  newText: string;
}

// ============================================================================
// Routine Diff
// ============================================================================

/** A diff entry for a single routine within a program. */
export interface RoutineDiff {
  /** Routine name (used as the match key). */
  name: string;
  /** The kind of change at the routine level. */
  kind: ChangeKind;
  /** Routine type (RLL, ST, FBD, SFC). */
  routineType?: NormalizedRoutineType;
  /** For RLL routines: per-rung diffs. Only present when kind is 'modified'. */
  rungDiffs?: RungDiff[];
  /** Complete sequence alignment, including unchanged rungs and original source numbers. */
  rungAlignment?: Array<{ oldRung?: NormalizedRung; newRung?: NormalizedRung }>;
  /** For ST routines: text diff. Only present when kind is 'modified'. */
  stDiff?: STDiff;
  /** Normalized FBD comparison, including complete sheet pairs for visualization. */
  fbdDiff?: FBDDiff;
  /** Property-level changes (description, type). */
  propertyChanges?: PropertyChange[];
  /** The old routine (for removed or modified). */
  oldRoutine?: NormalizedRoutine;
  /** The new routine (for added or modified). */
  newRoutine?: NormalizedRoutine;
  /** Summary counts for quick display. */
  summary?: {
    rungsAdded: number;
    rungsRemoved: number;
    rungsModified: number;
  };
}

// ============================================================================
// Program Diff
// ============================================================================

/** A diff entry for a single program. */
export interface ProgramDiff {
  /** Program name (used as the match key). */
  name: string;
  /** The kind of change at the program level. */
  kind: ChangeKind;
  /** Routine-level diffs within this program. */
  routineDiffs: RoutineDiff[];
  /** Tag diffs for program-scoped tags. */
  tagDiffs: TagDiff[];
  /** Diffs for local declarations, kept separate from same-name ordinary tags. */
  localTagDiffs?: ProgramLocalTagDiff[];
  /** Property-level changes (description, mainRoutineName, disabled). */
  propertyChanges?: PropertyChange[];
}

// ============================================================================
// Tag Diff
// ============================================================================

/** A diff entry for a single tag. */
export interface TagDiff {
  /** Tag name (used as the match key). */
  name: string;
  /** The kind of change. */
  kind: ChangeKind;
  /** Property-level changes (dataType, value, description, etc.). */
  propertyChanges?: PropertyChange[];
  /** The old tag (for removed or modified). */
  oldTag?: NormalizedTag;
  /** The new tag (for added or modified). */
  newTag?: NormalizedTag;
}

/** A diff entry for a program-owned local declaration. */
export interface ProgramLocalTagDiff {
  name: string;
  kind: ChangeKind;
  propertyChanges?: PropertyChange[];
  oldTag?: NormalizedProgramLocalTag;
  newTag?: NormalizedProgramLocalTag;
}

// ============================================================================
// Data Type Diff
// ============================================================================

/** A diff entry for a data type member. */
export interface DataTypeMemberDiff {
  /** Member name. */
  name: string;
  /** The kind of change. */
  kind: ChangeKind;
  /** Property-level changes (dataType, dimension, description, etc.). */
  propertyChanges?: PropertyChange[];
  /** Old member definition. */
  oldMember?: NormalizedDataTypeMember;
  /** New member definition. */
  newMember?: NormalizedDataTypeMember;
}

/** A diff entry for a single data type (UDT). */
export interface DataTypeDiff {
  /** Data type name (used as the match key). */
  name: string;
  /** The kind of change. */
  kind: ChangeKind;
  /** Member-level diffs for structured types. */
  memberDiffs: DataTypeMemberDiff[];
  /** Property-level changes (family, class, description). */
  propertyChanges?: PropertyChange[];
  /** Old data type. */
  oldDataType?: NormalizedDataType;
  /** New data type. */
  newDataType?: NormalizedDataType;
}

// ============================================================================
// AOI Diff
// ============================================================================

/** A diff entry for an Add-On Instruction. */
export interface AOIDiff {
  /** AOI name (used as the match key). */
  name: string;
  /** The kind of change. */
  kind: ChangeKind;
  /** Property-level changes (description, revision, vendor, etc.). */
  propertyChanges?: PropertyChange[];
  /** The old AOI definition. */
  oldAOI?: NormalizedAOI;
  /** The new AOI definition. */
  newAOI?: NormalizedAOI;
  /** Routine changes within the AOI, including FBD bodies. */
  routineDiffs?: RoutineDiff[];
  /** Summary: parameters added/removed/modified count. */
  parameterSummary?: {
    added: number;
    removed: number;
    modified: number;
  };
  /** Summary: AOI local tags added/removed/modified count. */
  localTagSummary?: {
    added: number;
    removed: number;
    modified: number;
  };
}

// ============================================================================
// Module Diff
// ============================================================================

/** A diff entry for a module/device. */
export interface ModuleDiff {
  /** Module name (used as the match key, falls back to id). */
  name: string;
  /** Module id. */
  id: number;
  /** The kind of change. */
  kind: ChangeKind;
  /** Property-level changes (catalogNumber, slot, inhibited, etc.). */
  propertyChanges?: PropertyChange[];
  /** Old module definition. */
  oldModule?: NormalizedModule;
  /** New module definition. */
  newModule?: NormalizedModule;
}

// ============================================================================
// Top-Level L5X Diff
// ============================================================================

/**
 * The complete structured diff between two NormalizedController instances.
 * This is the primary output of `diffControllers()`.
 */
export interface L5XDiff {
  /** Changes to controller-level metadata. */
  controllerInfo: ControllerInfoDiff;
  /** Program-level diffs (includes routine and program-tag diffs). */
  programs: ProgramDiff[];
  /** Controller-scoped tag diffs. */
  tags: TagDiff[];
  /** Data type diffs. */
  dataTypes: DataTypeDiff[];
  /** Add-On Instruction diffs. */
  aois: AOIDiff[];
  /** Module diffs. */
  modules: ModuleDiff[];
  /** Summary counts for the entire diff. */
  summary: L5XDiffSummary;
}

/** High-level summary of all changes in the diff. */
export interface L5XDiffSummary {
  totalChanges: number;
  programs: { added: number; removed: number; modified: number };
  routines: { added: number; removed: number; modified: number };
  rungs: { added: number; removed: number; modified: number };
  tags: { added: number; removed: number; modified: number };
  dataTypes: { added: number; removed: number; modified: number };
  aois: { added: number; removed: number; modified: number };
  modules: { added: number; removed: number; modified: number };
}
