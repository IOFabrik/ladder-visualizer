import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffControllers, diffFBD } from '../../src/diff';
import { parseString } from '../../src/parsers';
import { buildFBDSheetLayout } from '../../src/layout';
import { buildFBDDiffArtwork } from '../../src/components/fbd/fbdDiffLayout';
import type { NormalizedController, NormalizedFBDBody, NormalizedFBDElement } from '../../src/types';

function controller(logic: string[]): NormalizedController {
  return {
    name: 'Repro', tags: [], dataTypes: [], aois: [], modules: [],
    programs: [{ name: 'Main', tags: [], routines: [{
      name: 'Test', type: 'RLL',
      rungs: logic.map((raw, number) => ({ number, raw, instructions: [], elements: [] })),
    }] }],
  };
}

function block(id: string, instruction: string, operand: string): NormalizedFBDElement {
  return {
    kind: 'block', id, instruction, operand, position: { x: '280', y: '140' },
    ports: [], visiblePins: [], arrays: [], arrayRequirements: [], hideDescription: false,
  };
}

function body(elements: NormalizedFBDElement[]): NormalizedFBDBody {
  return {
    sheetSize: { value: 'A4', source: 'fallback' },
    orientation: { value: 'Landscape', source: 'fallback' },
    diagnostics: [], sheets: [{
    number: { value: '1', source: 'declared' }, name: { value: 'Sheet', source: 'fallback' },
    descriptions: [], elements, connections: [], attachments: [],
  }] };
}

describe('Studio 5000 renumbering', () => {
  it('reports the inserted rung instead of modifying the following rung', () => {
    const result = diffControllers(controller(['XIC(Flag)OTE(Output);']),
      controller(['NOP();', 'XIC(Flag)OTE(Output);'])).programs[0].routineDiffs[0];
    expect(result.summary).toEqual({ rungsAdded: 1, rungsRemoved: 0, rungsModified: 0 });
    expect(result.rungDiffs.map(rung => [rung.kind, rung.rungNumber])).toEqual([['added', 0]]);
  });

  it('reports only the new block when its ID displaces an existing block', () => {
    const result = diffFBD(body([block('2', 'SRTP', 'Existing')]),
      body([block('2', 'LES', 'Added'), block('3', 'SRTP', 'Existing')]));
    expect(result.sheets[0].elements.map(element =>
      [element.kind, element.oldValue?.id, element.newValue?.id]))
      .toEqual([['added', undefined, '2'], ['unchanged', '2', '3']]);
  });

  const logic = ['XIC(A)OTE(B);', 'JSR(Group,0);', 'XIC(C)OTE(D);'];
  it.each([0, 1, 2])('aligns insertion and deletion at rung %i', (index) => {
    const next = [...logic];
    next.splice(index, 0, 'NOP();');
    for (const removed of [false, true]) {
      const old = controller(removed ? next : logic), nu = controller(removed ? logic : next);
      const diff = diffControllers(old, nu).programs[0].routineDiffs[0];
      expect(diff.rungDiffs).toHaveLength(1);
      expect(diff.rungDiffs![0].kind).toBe(removed ? 'removed' : 'added');
      expect(diff.rungDiffs![0].rungNumber).toBe(index);
      expect(diff.rungAlignment?.filter(pair => pair.oldRung && pair.newRung)).toHaveLength(3);
      expect(diff.rungAlignment?.filter(pair => pair.oldRung && pair.newRung)
        .every(pair => pair.oldRung!.raw === pair.newRung!.raw)).toBe(true);
    }
  });

  it('places an identical inserted rung after its existing copy', () => {
    const diff = diffControllers(controller(logic), controller([logic[0], logic[1], logic[1], logic[2]]))
      .programs[0].routineDiffs[0];
    expect(diff.rungDiffs!.map(rung => [rung.kind, rung.rungNumber])).toEqual([['added', 2]]);
    expect(diff.rungAlignment?.map(pair => [pair.oldRung?.number, pair.newRung?.number]))
      .toEqual([[0, 0], [1, 1], [undefined, 2], [2, 3]]);
  });

  it.each([false, true])('retains a nearby logic edit beside an insertion (edit first: %s)', (editFirst) => {
    const edit = 'JSR(GroupChanged,0);';
    const next = [logic[0], ...(editFirst ? [edit, 'NOP();'] : ['NOP();', edit]), logic[2]];
    const diff = diffControllers(controller(logic), controller(next)).programs[0].routineDiffs[0];
    expect(diff.summary).toEqual({ rungsAdded: 1, rungsRemoved: 0, rungsModified: 1 });
    expect(diff.rungDiffs!.find(rung => rung.kind === 'modified')?.newRung?.raw).toBe(edit);
    expect(diff.rungDiffs!.find(rung => rung.kind === 'added')?.newRung?.raw).toBe('NOP();');
  });

  it('retains multiple logic and metadata edits without exact anchors', () => {
    const old = controller(logic), next = controller(logic.map(raw => raw.replace(');', ',Extra);')));
    next.programs[0].routines[0].rungs[1].comment = 'Changed comment';
    next.programs[0].routines[0].rungs[2].type = 'Insert';
    const diff = diffControllers(old, next).programs[0].routineDiffs[0];
    expect(diff.summary).toEqual({ rungsAdded: 0, rungsRemoved: 0, rungsModified: 3 });
    expect(diff.rungDiffs![1].propertyChanges).toContainEqual({
      property: 'comment', oldValue: undefined, newValue: 'Changed comment',
    });
    expect(diff.rungDiffs![2].propertyChanges).toContainEqual({
      property: 'type', oldValue: undefined, newValue: 'Insert',
    });
  });

  function connectedBody(): NormalizedFBDBody {
    const original = body([block('2', 'SRTP', 'Existing'), {
      kind: 'reference', id: '3', referenceType: 'input', operand: 'Signal',
      position: { x: '140', y: '140' }, ports: ['value'],
    }]);
    original.sheets[0].connections = [{ kind: 'wire', from: { elementId: '3' },
      to: { elementId: '2', port: 'Input' } }];
    original.sheets[0].attachments = [{ fromElementId: '3', toElementId: '2' }];
    const second = structuredClone(original.sheets[0]);
    second.number.value = '2';
    second.elements[0].id = '6'; second.elements[1].id = '7';
    second.connections[0].from.elementId = '7'; second.connections[0].to.elementId = '6';
    second.attachments[0] = { fromElementId: '7', toElementId: '6' };
    original.sheets.push(second);
    return original;
  }

  function renumberedBody(original: NormalizedFBDBody): NormalizedFBDBody {
    const next = structuredClone(original);
    for (const sheet of next.sheets) {
      const shift = (id: string) => String(Number(id) + 1);
      sheet.elements.forEach(element => { element.id = shift(element.id!); });
      sheet.connections.forEach(wire => {
        wire.from.elementId = shift(wire.from.elementId); wire.to.elementId = shift(wire.to.elementId);
      });
      sheet.attachments.forEach(attachment => {
        attachment.fromElementId = shift(attachment.fromElementId);
        attachment.toElementId = shift(attachment.toElementId);
      });
    }
    next.sheets[0].elements.unshift(block('2', 'LES', 'Added'));
    return next;
  }

  it.each([false, true])('compares renumbered wires, attachments and later sheets (delete: %s)', (removed) => {
    const old = connectedBody(), next = renumberedBody(old);
    const snapshot = JSON.stringify([old, next]);
    const diff = removed ? diffFBD(next, old) : diffFBD(old, next);
    expect(diff.complete).toBe(true);
    expect(diff.sheets.flatMap(sheet => sheet.elements).map(element => element.kind).sort())
      .toEqual([removed ? 'removed' : 'added', 'unchanged', 'unchanged', 'unchanged', 'unchanged'].sort());
    expect(diff.sheets.flatMap(sheet => [...sheet.connections, ...sheet.attachments])
      .every(edge => edge.kind === 'unchanged')).toBe(true);
    expect(diff.sheets[1].kind).toBe('unchanged');
    expect(JSON.stringify([old, next])).toBe(snapshot);
    const pair = diff.sheets[0].elements.find(element => element.oldValue?.kind === 'reference')!;
    expect(pair.oldValue).toBe((removed ? next : old).sheets[0].elements.find(element => element.kind === 'reference'));
  });

  it('preserves genuine edits, moves, pins and rewiring during ID churn', () => {
    const old = connectedBody(), next = renumberedBody(old);
    const existing = next.sheets[0].elements[1];
    if (existing.kind !== 'block') throw new Error('expected block');
    existing.operand = 'Changed'; existing.position.x = '350'; existing.visiblePins = ['Input'];
    next.sheets[0].connections[0].to.elementId = '2';
    const diff = diffFBD(old, next);
    expect(diff.sheets[0].elements.find(element => element.kind === 'modified')?.propertyChanges)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ property: 'operand' }),
        expect.objectContaining({ property: 'position.x' }),
        expect.objectContaining({ property: 'visiblePins' }),
      ]));
    expect(diff.sheets[0].connections.map(wire => wire.kind).sort()).toEqual(['added', 'removed']);
    expect(diff.sheets[0].attachments[0].kind).toBe('unchanged');
  });

  it('does not pair incompatible kinds just because an ID was reused', () => {
    const old = connectedBody(), next = structuredClone(old);
    next.sheets[0].elements[0] = { ...next.sheets[0].elements[1], id: '2' };
    expect(diffFBD(old, next).sheets[0].elements.some(element =>
      element.oldValue?.kind === 'block' && element.newValue?.kind === 'reference')).toBe(false);
  });

  it('reports uncertainty for indistinguishable repeated blocks after renumbering', () => {
    const old = body([block('2', 'SRTP', 'Same'), block('3', 'SRTP', 'Same')]);
    const next = body([block('3', 'SRTP', 'Same'), block('4', 'SRTP', 'Same')]);
    const diff = diffFBD(old, next);
    expect(diff.complete).toBe(false);
    expect(diff.sheets[0].elements).toHaveLength(4);
    expect(diff.sheets[0].elements.every(element => element.ambiguous)).toBe(true);
  });

  it('does not invent changes in identical repeated blocks with unchanged source addresses', () => {
    const old = body([block('2', 'SRTP', 'Same'), block('3', 'SRTP', 'Same')]);
    const next = structuredClone(old);
    next.sheets[0].elements.reverse();
    const diff = diffFBD(old, next);
    expect(diff.hasChanges).toBe(false);
    expect(diff.complete).toBe(true);
    expect(diff.sheets[0].elements.every(element => element.kind === 'unchanged')).toBe(true);
  });

  it.each(['unchanged', 'inserted', 'edited'])(
    'compares a large %s routine without a quadratic memory increase', (scenario) => {
      const raws = Array.from({ length: 6000 }, (_, index) => `XIC(Input${index})OTE(Output${index});`);
      const next = [...raws];
      if (scenario === 'inserted') next.splice(1, 0, 'NOP();');
      if (scenario === 'edited') next[1] = 'XIO(Input1)OTE(Output1);';
      const old = controller(raws), nu = controller(next);
      const memoryBefore = process.resourceUsage().maxRSS;
      const started = performance.now();
      const diff = diffControllers(old, nu);
      expect(diff.summary.rungs.added).toBe(scenario === 'inserted' ? 1 : 0);
      expect(diff.summary.rungs.modified).toBe(scenario === 'edited' ? 1 : 0);
      expect(diff.summary.rungs.removed).toBe(0);
      expect(process.resourceUsage().maxRSS - memoryBefore).toBeLessThan(64 * 1024);
      expect(performance.now() - started).toBeLessThan(1500);
    }
  );

  it('preserves moves of repeated blocks into each other\'s previous positions', () => {
    const old = body([block('2', 'SRTP', 'Same'), block('3', 'SRTP', 'Same')]);
    old.sheets[0].elements[1].position = { x: '500', y: '140' };
    const next = structuredClone(old);
    next.sheets[0].elements[0].position = { x: '500', y: '140' };
    next.sheets[0].elements[1].position = { x: '720', y: '140' };
    const diff = diffFBD(old, next);
    expect(diff.complete).toBe(true);
    expect(diff.sheets[0].elements.map(pair => [pair.kind, pair.oldValue?.id, pair.newValue?.id]))
      .toEqual([['modified', '2', '2'], ['modified', '3', '3']]);
    expect(diff.sheets[0].elements.every(pair => pair.propertyChanges.some(change => change.property === 'position.x')))
      .toBe(true);
  });

  it.each(['block', 'function', 'add-on-instruction', 'routine-control', 'text-box'] as const)(
    'preserves combined logic and position edits to a %s with stable addresses', (kind) => {
      const base = { id: '2', position: { x: '280', y: '140' } };
      const elements: Record<typeof kind, NormalizedFBDElement> = {
        block: block('2', 'SRTP', 'Existing'),
        function: { ...base, kind: 'function', instruction: 'ADD', ports: [] },
        'add-on-instruction': { ...base, kind: 'add-on-instruction', name: 'AOI_A', ports: [], bindings: [], visiblePins: [] },
        'routine-control': { ...base, kind: 'routine-control', operation: 'JSR', routine: 'A', inputParameters: [], returnParameters: [] },
        'text-box': { ...base, kind: 'text-box', text: 'Before' },
      };
      const old = body([elements[kind]]), next = structuredClone(old);
      const element = next.sheets[0].elements[0];
      element.position = { x: '500', y: '300' };
      if (element.kind === 'block') { element.instruction = 'LES'; element.operand = 'Changed'; }
      if (element.kind === 'function') element.instruction = 'SUB';
      if (element.kind === 'add-on-instruction') element.name = 'AOI_B';
      if (element.kind === 'routine-control') { element.operation = 'RET'; element.routine = undefined; }
      if (element.kind === 'text-box') element.text = 'After';
      const diff = diffFBD(old, next);
      expect(diff.complete).toBe(true);
      expect(diff.sheets[0].elements).toHaveLength(1);
      expect(diff.sheets[0].elements[0].kind).toBe('modified');
      expect(diff.sheets[0].elements[0].propertyChanges.some(change => change.property === 'position.x')).toBe(true);
      expect(diff.sheets[0].elements[0].propertyChanges.some(change => change.category === (kind === 'text-box' ? 'presentation' : 'logic'))).toBe(true);
    }
  );

  it('compares bulk metadata edits using unchanged rung logic without expensive sequence search', () => {
    const raws = Array.from({ length: 3000 }, (_, index) => `XIC(Input${index})OTE(Output${index});`);
    const old = controller(raws), next = controller(raws);
    next.programs[0].routines[0].rungs.forEach(rung => { rung.comment = 'Updated comment'; rung.type = 'Insert'; });
    const started = performance.now();
    const diff = diffControllers(old, next);
    expect(diff.summary.rungs).toEqual({ added: 0, removed: 0, modified: 3000 });
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('retains source order and multiplicity across repeated insertions and deletions', () => {
    let seed = 111;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let example = 0; example < 160; example++) {
      const raws = Array.from({ length: random(16) }, () => `XIC(Input${random(5)})OTE(Output);`);
      const next = [...raws];
      next.splice(random(next.length + 1), 0, 'NOP();');
      next.splice(random(next.length + 1), 0, raws[random(Math.max(1, raws.length))] ?? 'NOP();');
      for (const reverse of [false, true]) {
        const old = controller(reverse ? next : raws), nu = controller(reverse ? raws : next);
        const diff = diffControllers(old, nu).programs[0].routineDiffs[0];
        expect(diff.summary).toEqual({ rungsAdded: reverse ? 0 : 2, rungsRemoved: reverse ? 2 : 0, rungsModified: 0 });
        expect(diff.rungAlignment!.flatMap(pair => pair.oldRung ? [pair.oldRung] : []))
          .toEqual(old.programs[0].routines[0].rungs);
        expect(diff.rungAlignment!.flatMap(pair => pair.newRung ? [pair.newRung] : []))
          .toEqual(nu.programs[0].routines[0].rungs);
      }
    }
  });

  it('preserves an exact rung anchor beyond the bounded edit trace', () => {
    const old = controller(['NOP();']);
    const next = controller([...Array.from({ length: 1001 }, (_, index) => `XIC(Input${index})OTE(Output);`), 'NOP();']);
    const diff = diffControllers(old, next).programs[0].routineDiffs[0];
    expect(diff.summary).toEqual({ rungsAdded: 1001, rungsRemoved: 0, rungsModified: 0 });
    expect(diff.rungAlignment!.at(-1)?.oldRung).toBe(old.programs[0].routines[0].rungs[0]);
    expect(diff.rungAlignment!.at(-1)?.newRung?.number).toBe(1001);
  });

  it('renders renumbered existing elements and connections with unchanged colors', () => {
    const old = parseString(readFileSync(new URL('../fixtures/l5x/fbd-level-control-v35.L5X', import.meta.url), 'utf8'), 'l5x')
      .data!.programs[0].routines[0].fbd!;
    const next = renumberedBody(old);
    const added = next.sheets[0].elements[0];
    added.id = '0';
    added.position = { x: '2000', y: '2000' };
    const comparison = diffFBD(old, next).sheets[0];
    const artwork = buildFBDDiffArtwork(buildFBDSheetLayout(old.sheets[0]), buildFBDSheetLayout(next.sheets[0]), comparison);
    expect(artwork.outlines.filter(outline => outline.tone === 'neutral')).toHaveLength(old.sheets[0].elements.length);
    expect(artwork.outlines.filter(outline => outline.tone === 'newer')).toHaveLength(1);
    expect(artwork.outlines.filter(outline => outline.tone === 'older')).toHaveLength(0);
    expect(artwork.paths).toHaveLength(old.sheets[0].connections.length + old.sheets[0].attachments.length);
    expect(artwork.paths.every(path => path.tone === 'neutral')).toBe(true);
  });
});
