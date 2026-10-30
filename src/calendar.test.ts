import { generateSlots, validateOperatingWindows } from './calendar';

describe('calendar slot generation', () => {
  const window = { start: '08:00', end: '09:00', durationMinutes: 30, capacity: 2 };

  it('converts local windows to UTC instants consistently', () => {
    expect(generateSlots('2026-02-03', 'America/Sao_Paulo', [window])).toEqual([
      { startsAt: '2026-02-03T11:00:00.000Z', endsAt: '2026-02-03T11:30:00.000Z' },
      { startsAt: '2026-02-03T11:30:00.000Z', endsAt: '2026-02-03T12:00:00.000Z' },
    ]);
  });

  it('rejects nonexistent local times and ambiguous DST times', () => {
    expect(() => generateSlots('2026-03-08', 'America/New_York', [{ ...window, start: '02:00', end: '03:00' }])).toThrow('inválido');
    expect(() => generateSlots('2026-11-01', 'America/New_York', [{ ...window, start: '01:00', end: '02:00' }])).toThrow('ambíguo');
  });

  it('rejects overlaps rather than producing duplicate capacity', () => {
    expect(() => validateOperatingWindows([window, { ...window, start: '08:30', end: '09:30' }])).toThrow('sobrepor');
  });
});
