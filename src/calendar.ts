import { DateTime } from 'luxon';

export interface OperatingWindow { start: string; end: string; durationMinutes: number; capacity: number }
export interface GeneratedSlot { startsAt: string; endsAt: string }

function localDateTime(date: string, time: string, zone: string): DateTime {
  const value = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', { zone, setZone: true, locale: 'en-US' });
  if (!value.isValid || value.toFormat('yyyy-MM-dd HH:mm') !== `${date} ${time}`) throw new Error(`Horário local inexistente ou inválido para ${zone}: ${date} ${time}`);
  if (value.getPossibleOffsets().length !== 1) throw new Error(`Horário local ambíguo por mudança de fuso: ${date} ${time}`);
  return value;
}

export function validateOperatingWindows(windows: OperatingWindow[]): void {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 0; index < sorted.length; index++) {
    const current = sorted[index];
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(current.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(current.end)) throw new Error('Use horários no formato HH:mm');
    if (current.start >= current.end) throw new Error('Cada faixa deve terminar depois de começar no mesmo dia');
    if (!Number.isInteger(current.durationMinutes) || current.durationMinutes <= 0 || current.durationMinutes > 1440) throw new Error('Duração deve ser um número positivo de minutos');
    if (!Number.isInteger(current.capacity) || current.capacity <= 0) throw new Error('Capacidade deve ser um número inteiro positivo');
    if (index > 0 && sorted[index - 1].end > current.start) throw new Error('Faixas do mesmo dia não podem se sobrepor');
  }
}

export function generateSlots(date: string, timezone: string, windows: OperatingWindow[]): GeneratedSlot[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date, { zone: 'UTC' }).isValid) throw new Error('Data inválida');
  if (!DateTime.now().setZone(timezone).isValid) throw new Error('Fuso horário inválido');
  validateOperatingWindows(windows);
  const slots: GeneratedSlot[] = [];
  for (const window of windows) {
    const finish = localDateTime(date, window.end, timezone);
    let cursor = localDateTime(date, window.start, timezone);
    while (cursor.plus({ minutes: window.durationMinutes }).toMillis() <= finish.toMillis()) {
      const next = cursor.plus({ minutes: window.durationMinutes });
      slots.push({ startsAt: cursor.toUTC().toISO()!, endsAt: next.toUTC().toISO()! });
      cursor = next;
    }
  }
  return slots;
}
