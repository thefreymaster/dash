import { describe, expect, it } from 'vitest';
import { abbreviateRoadName, roadLabel, roadSpokenName } from './roadLabel';

describe('abbreviateRoadName', () => {
  it.each([
    ['Main Street', 'Main St'],
    ['North Main Street', 'N Main St'],
    ['Park Avenue South', 'Park Ave S'],
    ['South Van Ness Avenue', 'S Van Ness Ave'],
    ['Martin Luther King Junior Boulevard', 'Martin Luther King Junior Blvd'],
    ['Pacific Coast Highway', 'Pacific Coast Hwy'],
    ['Mulholland Drive', 'Mulholland Dr'],
  ])('%s → %s', (name, expected) => {
    expect(abbreviateRoadName(name)).toBe(expected);
  });

  it('leaves names alone when the word is not a suffix/prefix, or is the whole name', () => {
    expect(abbreviateRoadName('Avenue of the Americas')).toBe('Avenue of the Americas');
    expect(abbreviateRoadName('North Street')).toBe('North St');
    expect(abbreviateRoadName('South')).toBe('South');
    expect(abbreviateRoadName('The Embarcadero')).toBe('The Embarcadero');
    expect(abbreviateRoadName('Rue de Rivoli')).toBe('Rue de Rivoli');
    expect(abbreviateRoadName('  Highway   1 ')).toBe('Highway 1');
  });
});

describe('roadLabel', () => {
  it('shows motorways by route number, other roads by name', () => {
    expect(roadLabel({ name: 'Eastshore Freeway', ref: 'I 80', roadClass: 'motorway' })).toBe('I 80');
    expect(roadLabel({ name: 'Van Ness Avenue', ref: 'US 101', roadClass: 'trunk' })).toBe('Van Ness Ave');
    expect(roadLabel({ name: null, ref: 'CA 1', roadClass: 'primary' })).toBe('CA 1');
    expect(roadLabel({ name: 'Bayshore Freeway', ref: null, roadClass: 'motorway' })).toBe('Bayshore Fwy');
  });

  it('speaks the full name', () => {
    expect(roadSpokenName({ name: 'Main Street', ref: null, roadClass: 'street' })).toBe('Main Street');
    expect(roadSpokenName({ name: null, ref: 'I 80', roadClass: 'motorway' })).toBe('I 80');
  });
});
