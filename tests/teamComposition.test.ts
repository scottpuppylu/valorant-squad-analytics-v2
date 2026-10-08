import { describe, expect, it } from 'vitest';
import { TeamCompositionInput, TeamCompositionResult } from '@vsa/contracts/team-composition';

const member = (i: number, overrides: Record<string, unknown> = {}) => ({
  memberId: `m_${String(i).padStart(16, '0')}`, agentId: `agent-${i}`, agentName: `Agent ${i}`, role: 'Controller',
  generalResponsibility: 'SPACE_CONTROL', attackResponsibilities: ['ATTACK_PLANT_SUPPORT'], defenseResponsibilities: ['DEFENSE_FIRST_CONTACT'],
  teamFit: 72, confidence: 40, sampleSize: 12, evidenceSummary: ['12 Competitive matches as this agent'],
  alternatives: [{ agentId: 'agent-x', agentName: 'Agent X', role: 'Initiator', teamFit: 65, confidence: 30 }], ...overrides,
});
const result = (overrides: Record<string, unknown> = {}) => ({
  analyticsContractVersion: 'analytics-contract-v1', algorithmId: 'team-composition-v2', mapId: 'map-ascent', status: 'ok',
  teamFitSemantics: 'historical-relative-lineup-fit', isWinProbability: false, isProvenOptimalLineup: false,
  teamFit: 70, confidence: 45, members: [1, 2, 3, 4, 5].map((i) => member(i)), reasons: [], ...overrides,
});

describe('Team Builder contract', () => {
  it('input is exactly five distinct members plus a map', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    expect(TeamCompositionInput.parse({ memberIds: ids, mapId: 'map-ascent' }).memberIds).toEqual(ids);
    expect(() => TeamCompositionInput.parse({ memberIds: ids.slice(0, 4), mapId: 'map-ascent' })).toThrow();
    expect(() => TeamCompositionInput.parse({ memberIds: ['a', 'a', 'c', 'd', 'e'], mapId: 'map-ascent' })).toThrow();
    expect(() => TeamCompositionInput.parse({ memberIds: ids })).toThrow();
  });

  it('a valid result carries every required member field', () => {
    const parsed = TeamCompositionResult.parse(result());
    expect(Object.keys(parsed.members[0]!).sort()).toEqual(['agentId', 'agentName', 'alternatives', 'attackResponsibilities', 'confidence', 'defenseResponsibilities',
      'evidenceSummary', 'generalResponsibility', 'memberId', 'role', 'sampleSize', 'teamFit'].sort());
  });

  it('Team Fit can never be presented as a win probability or a proven optimal lineup', () => {
    expect(() => TeamCompositionResult.parse(result({ isWinProbability: true }))).toThrow();
    expect(() => TeamCompositionResult.parse(result({ isProvenOptimalLineup: true }))).toThrow();
    expect(() => TeamCompositionResult.parse(result({ teamFitSemantics: 'win-probability' }))).toThrow();
    expect(() => TeamCompositionResult.parse(result({ teamFit: 140 }))).toThrow();
  });

  it('confidence is independent of Team Fit (high fit with low confidence is valid)', () => {
    expect(TeamCompositionResult.parse(result({ teamFit: 95, confidence: 5 })).confidence).toBe(5);
    expect(TeamCompositionResult.parse(result({ members: [1, 2, 3, 4, 5].map((i) => member(i, { teamFit: 90, confidence: 3 })) })).members[0]!.confidence).toBe(3);
  });

  it('an ok result has exactly five distinct members; insufficient evidence may have none; unknown fields are rejected', () => {
    expect(() => TeamCompositionResult.parse(result({ members: [1, 2, 3, 4].map((i) => member(i)) }))).toThrow();
    expect(() => TeamCompositionResult.parse(result({ members: [1, 1, 2, 3, 4].map((i) => member(i)) }))).toThrow();
    expect(TeamCompositionResult.parse(result({ status: 'insufficient_evidence', members: [], teamFit: null, confidence: null, reasons: ['too few matches'] })).members).toEqual([]);
    expect(() => TeamCompositionResult.parse(result({ winChance: 0.6 }))).toThrow();
    expect(() => TeamCompositionResult.parse(result({ members: [1, 2, 3, 4, 5].map((i) => member(i, { generalResponsibility: 'stand at A heaven' })) }))).toThrow();
  });
});
