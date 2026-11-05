import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import app from './app';
import { pool } from './db';
import { hashPassword, issueToken } from './security';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
function makeValidPdf(): Buffer {
  let document = '%PDF-1.4\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
  ];
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(document, 'latin1')); document += object; }
  const xrefOffset = Buffer.byteLength(document, 'latin1');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'latin1');
}
(enabled ? describe : describe.skip)('PostgreSQL SAD integration', () => {
  let server: ReturnType<typeof app.listen>;
  let baseUrl = '';
  let companyId = '';
  let outsiderCompanyId = '';
  let userId = '';
  let outsiderUserId = '';
  let adminId = '';
  let outsiderToken = '';
  let adminToken = '';
  let slotId = '';
  let targetSlotId = '';
  let rescheduleSourceIds: string[] = [];
  let capacitySlotId = '';
  let cancellationRaceSlotId = '';
  let truckId = '';
  let driverId = '';
  let token = '';
  let bookingId = '';
  let protocol = '';
  let testEmail = '';
  let testPassword = '';
  const integrationDocumentDirectory = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'private_data'));

  beforeAll(async () => {
    const unique = randomBytes(6).toString('hex');
    testEmail = `integration-${unique}@example.test`;
    testPassword = `Synthetic-${randomBytes(16).toString('hex')}`;
    const company = await pool.query("INSERT INTO companies(name) VALUES('Synthetic integration company') RETURNING id");
    companyId = company.rows[0].id;
    const user = await pool.query("INSERT INTO users(email,password_hash,role,company_id) VALUES($1,$2,'company',$3) RETURNING id", [testEmail, hashPassword(testPassword), companyId]);
    userId = user.rows[0].id;
    const admin = await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id", [`admin-${unique}@example.test`, hashPassword(testPassword)]);
    adminId = admin.rows[0].id;
    const outsiderCompany = await pool.query("INSERT INTO companies(name) VALUES('Synthetic outsider company') RETURNING id");
    outsiderCompanyId = outsiderCompany.rows[0].id;
    const outsider = await pool.query("INSERT INTO users(email,password_hash,role,company_id) VALUES($1,$2,'company',$3) RETURNING id", [`outsider-${unique}@example.test`, hashPassword(`Other-${testPassword}`), outsiderCompanyId]);
    outsiderUserId = outsider.rows[0].id;
    const truck = await pool.query("INSERT INTO trucks(company_id,plate) VALUES($1,$2) RETURNING id", [companyId, `TST${Math.floor(Math.random() * 10)}A01`]);
    truckId = truck.rows[0].id;
    const driver = await pool.query("INSERT INTO drivers(company_id,name,phone) VALUES($1,'Synthetic Driver','11999990000') RETURNING id", [companyId]);
    driverId = driver.rows[0].id;
    const slots = await pool.query(`INSERT INTO schedule_slots(starts_at,ends_at,capacity) VALUES
      (now()+interval '2 days',now()+interval '2 days 30 minutes',1),
      (now()+interval '3 days',now()+interval '3 days 30 minutes',1),
      (now()+interval '4 days',now()+interval '4 days 30 minutes',1),
      (now()+interval '5 days',now()+interval '5 days 30 minutes',1),
      (now()+interval '6 days',now()+interval '6 days 30 minutes',2),
      (now()+interval '6 days 1 hour',now()+interval '6 days 1 hour 30 minutes',1) RETURNING id`);
    const slotIds = slots.rows.map(row => row.id);
    [slotId, targetSlotId] = slotIds;
    rescheduleSourceIds = slotIds.slice(2, 4);
    capacitySlotId = slotIds[4];
    cancellationRaceSlotId = slotIds[5];
    token = issueToken({ sub: userId, role: 'company', companyId }, process.env.TOKEN_SECRET!, 600);
    outsiderToken = issueToken({ sub: outsiderUserId, role: 'company', companyId: outsiderCompanyId }, process.env.TOKEN_SECRET!, 600);
    adminToken = issueToken({ sub: adminId, role: 'admin', companyId: null }, process.env.TOKEN_SECRET!, 600);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine test server address');
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    const bookings = await pool.query('SELECT id FROM bookings WHERE company_id=$1', [companyId]);
    const bookingIds = bookings.rows.map(row => row.id);
    const documents = bookingIds.length ? await pool.query('SELECT id,storage_key FROM booking_documents WHERE booking_id=ANY($1::uuid[])', [bookingIds]) : { rows: [] as Array<{ id: string; storage_key: string }> };
    for (const document of documents.rows) await fs.rm(path.join(integrationDocumentDirectory, document.storage_key), { force: true });
    if (documents.rows.length) await pool.query('DELETE FROM document_audit_events WHERE document_id=ANY($1::uuid[])', [documents.rows.map(row => row.id)]);
    if (bookingIds.length) {
      await pool.query('DELETE FROM booking_documents WHERE booking_id=ANY($1::uuid[])', [bookingIds]);
      await pool.query('DELETE FROM booking_history WHERE booking_id=ANY($1::uuid[])', [bookingIds]);
      await pool.query('DELETE FROM bookings WHERE id=ANY($1::uuid[])', [bookingIds]);
    }
    if (adminId) {
      const configs = await pool.query('SELECT id FROM schedule_configs WHERE created_by=$1', [adminId]);
      const configIds = configs.rows.map(row => row.id);
      if (configIds.length) {
        await pool.query('DELETE FROM schedule_exceptions WHERE config_id=ANY($1::uuid[])', [configIds]);
        await pool.query('DELETE FROM schedule_slots WHERE config_id=ANY($1::uuid[])', [configIds]);
        await pool.query('DELETE FROM schedule_configs WHERE id=ANY($1::uuid[])', [configIds]);
      }
    }
    const manualSlotIds = [slotId, targetSlotId, ...rescheduleSourceIds, capacitySlotId, cancellationRaceSlotId].filter(Boolean);
    if (manualSlotIds.length) await pool.query('DELETE FROM schedule_slots WHERE id=ANY($1::uuid[])', [manualSlotIds]);
    await pool.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [[adminId, userId, outsiderUserId].filter(Boolean)]);
    if (truckId) await pool.query('DELETE FROM trucks WHERE id=$1', [truckId]);
    if (driverId) await pool.query('DELETE FROM drivers WHERE id=$1', [driverId]);
    if (userId || outsiderUserId || adminId) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[userId, outsiderUserId, adminId].filter(Boolean)]);
    if (companyId || outsiderCompanyId) await pool.query('DELETE FROM companies WHERE id=ANY($1::uuid[])', [[companyId, outsiderCompanyId].filter(Boolean)]);
    await pool.end();
  });

  async function reserve(): Promise<Response> {
    return reserveAt(slotId, 'SYNTHETIC-1');
  }
  async function reserveAt(targetSlotId: string, invoiceNumber: string, idempotencyKey?: string): Promise<Response> {
    return fetch(`${baseUrl}/bookings`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }, body: JSON.stringify({ slotId: targetSlotId, truckId, driverId, weight: 12.5, weightUnit: 't', invoiceNumber }) });
  }

  it('authenticates users and protects private routes', async () => {
    expect((await fetch(`${baseUrl}/bookings`)).status).toBe(401);
    const login = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: testEmail, password: testPassword }) });
    expect(login.status).toBe(200);
    expect((await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: testEmail, password: 'wrong synthetic password' }) })).status).toBe(401);
  });

  it('allows only one of two simultaneous requests to claim the last slot', async () => {
    const results = await Promise.all([reserve(), reserve()]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const winner = results.find(result => result.status === 201)!;
    const response = await winner.json() as { booking: { id: string; protocol: string } };
    bookingId = response.booking.id; protocol = response.booking.protocol;
    expect(protocol).toMatch(/^SAD-\d{4}-[A-F0-9]+$/);
    const count = await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [slotId]);
    expect(count.rows[0].count).toBe(1);
  });

  it('does not disclose a booking to another company', async () => {
    expect((await fetch(`${baseUrl}/bookings/${bookingId}`, { headers: { authorization: `Bearer ${outsiderToken}` } })).status).toBe(404);
    const list = await fetch(`${baseUrl}/bookings?pageSize=100`, { headers: { authorization: `Bearer ${outsiderToken}` } }).then(r => r.json()) as { bookings: unknown[] };
    expect(list.bookings).toHaveLength(0);
  });

  it('summarizes daily bookings without exposing another company\'s reservations', async () => {
    const date = (await pool.query("SELECT (starts_at AT TIME ZONE 'UTC')::date::text AS date FROM schedule_slots WHERE id=$1", [slotId])).rows[0].date as string;
    const request = (accessToken: string) => fetch(`${baseUrl}/availability?from=${date}&to=${date}`, { headers: { authorization: `Bearer ${accessToken}` } }).then(response => response.json()) as Promise<{ days: Array<{ date: string; bookingCount: number; occupied: number; bookings: Array<{ id: string }> }> }>;
    const [own, outsider] = await Promise.all([request(token), request(outsiderToken)]);
    expect(own.days[0].bookingCount).toBe(1);
    expect(own.days[0].bookings[0].id).toBe(bookingId);
    expect(outsider.days[0].bookingCount).toBe(0);
    expect(outsider.days[0].bookings).toHaveLength(0);
    expect(outsider.days[0].occupied).toBe(own.days[0].occupied);
  });

  it('returns the original booking for an idempotent reservation retry', async () => {
    const key = randomUUID();
    const first = await reserveAt(capacitySlotId, 'SYNTHETIC-IDEMPOTENT', key);
    expect(first.status).toBe(201);
    const firstId = (await first.json() as { booking: { id: string } }).booking.id;
    const replay = await reserveAt(capacitySlotId, 'SYNTHETIC-IDEMPOTENT', key);
    expect(replay.status).toBe(200);
    const replayData = await replay.json() as { booking: { id: string }; replayed: boolean };
    expect(replayData.booking.id).toBe(firstId);
    expect(replayData.replayed).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [capacitySlotId])).rows[0].count).toBe(1);
    expect((await fetch(`${baseUrl}/bookings/${firstId}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  it('validates, stores, downloads, deletes and audits private XML/PDF documents', async () => {
    const badForm = new FormData();
    badForm.append('documentType', 'xml');
    badForm.append('file', new Blob(['<!DOCTYPE invoice [<!ENTITY x SYSTEM "file:///etc/passwd">]><invoice>&x;</invoice>'], { type: 'application/xml' }), 'unsafe.xml');
    const bad = await fetch(`${baseUrl}/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: badForm });
    expect(bad.status).toBe(400);

    const mismatchedForm = new FormData();
    mismatchedForm.append('documentType', 'pdf');
    mismatchedForm.append('file', new Blob(['<invoice/>'], { type: 'application/xml' }), 'invoice.xml');
    expect((await fetch(`${baseUrl}/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: mismatchedForm })).status).toBe(400);

    const corruptPdfForm = new FormData();
    corruptPdfForm.append('documentType', 'pdf');
    corruptPdfForm.append('file', new Blob(['%PDF-1.7\n%%EOF'], { type: 'application/pdf' }), 'broken.pdf');
    expect((await fetch(`${baseUrl}/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: corruptPdfForm })).status).toBe(400);

    const xmlForm = new FormData();
    xmlForm.append('documentType', 'xml');
    xmlForm.append('file', new Blob(['<?xml version="1.0"?><Invoice><Number>SYNTHETIC</Number></Invoice>'], { type: 'application/xml' }), '../../safe.xml');
    const xml = await fetch(`${baseUrl}/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: xmlForm });
    expect(xml.status).toBe(201);
    const xmlId = (await xml.json() as { document: { id: string; original_name: string } }).document.id;
    expect((await (await fetch(`${baseUrl}/bookings/${bookingId}`, { headers: { authorization: `Bearer ${token}` } })).json() as { documents: Array<{ original_name: string }> }).documents[0].original_name).toBe('safe.xml');
    expect((await fetch(`${baseUrl}/documents/${xmlId}/download`, { headers: { authorization: `Bearer ${outsiderToken}` } })).status).toBe(404);
    const download = await fetch(`${baseUrl}/documents/${xmlId}/download`, { headers: { authorization: `Bearer ${token}` } });
    expect(download.status).toBe(200);
    expect(await download.text()).toContain('SYNTHETIC');

    const pdfForm = new FormData();
    pdfForm.append('documentType', 'pdf');
    pdfForm.append('file', new Blob([makeValidPdf()], { type: 'application/pdf' }), 'sample.pdf');
    expect((await fetch(`${baseUrl}/bookings/${bookingId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: pdfForm })).status).toBe(201);
    expect((await fetch(`${baseUrl}/bookings/${bookingId}/documents/${xmlId}`, { method: 'DELETE', headers: { authorization: `Bearer ${outsiderToken}` } })).status).toBe(404);
    expect((await fetch(`${baseUrl}/bookings/${bookingId}/documents/${xmlId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(204);
    expect((await fetch(`${baseUrl}/documents/${xmlId}/download`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    const details = await fetch(`${baseUrl}/bookings/${bookingId}`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.json()) as { documents: Array<{ media_type: string }> };
    expect(details.documents).toHaveLength(1);
    expect(details.documents[0].media_type).toBe('application/pdf');
    const events = await pool.query('SELECT action FROM document_audit_events WHERE document_id=$1 ORDER BY id', [xmlId]);
    expect(events.rows.map((row: { action: string }) => row.action)).toEqual(['upload', 'download', 'delete']);
  });

  it('reschedules atomically, preserves history, and cancellation releases capacity', async () => {
    const moved = await fetch(`${baseUrl}/bookings/${bookingId}/reschedule`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ slotId: targetSlotId }) });
    expect(moved.status).toBe(200);
    const details = await fetch(`${baseUrl}/bookings/${bookingId}`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()) as { booking: { slot_id: string; protocol: string }; history: Array<{ action: string; details: { oldSlotId?: string; newSlotId?: string } }> };
    expect(details.booking.slot_id).toBe(targetSlotId);
    expect(details.booking.protocol).toBe(protocol);
    expect(details.history.some(item => item.action === 'rescheduled' && item.details.oldSlotId === slotId && item.details.newSlotId === targetSlotId)).toBe(true);
    expect((await fetch(`${baseUrl}/bookings/${bookingId}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [targetSlotId])).rows[0].count).toBe(0);
  });

  it('serializes two competing reschedules into the same last slot', async () => {
    const first = await reserveAt(rescheduleSourceIds[0], 'SYNTHETIC-RS-1');
    const second = await reserveAt(rescheduleSourceIds[1], 'SYNTHETIC-RS-2');
    expect([first.status, second.status]).toEqual([201, 201]);
    const firstId = (await first.json() as { booking: { id: string } }).booking.id;
    const secondId = (await second.json() as { booking: { id: string } }).booking.id;
    const move = (id: string) => fetch(`${baseUrl}/bookings/${id}/reschedule`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ slotId: targetSlotId }) });
    const results = await Promise.all([move(firstId), move(secondId)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [targetSlotId])).rows[0].count).toBe(1);
  });

  it('refuses a capacity reduction below current occupancy', async () => {
    expect((await reserveAt(capacitySlotId, 'SYNTHETIC-CAP-1')).status).toBe(201);
    expect((await reserveAt(capacitySlotId, 'SYNTHETIC-CAP-2')).status).toBe(201);
    const response = await fetch(`${baseUrl}/admin/slots/${capacitySlotId}`, { method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ capacity: 1 }) });
    expect(response.status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [capacitySlotId])).rows[0].count).toBe(2);
  });

  it('serializes a reservation racing a cancellation without exceeding capacity', async () => {
    const created = await reserveAt(cancellationRaceSlotId, 'SYNTHETIC-CANCEL-RACE');
    const id = (await created.json() as { booking: { id: string } }).booking.id;
    const cancel = fetch(`${baseUrl}/bookings/${id}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const nextReservation = reserveAt(cancellationRaceSlotId, 'SYNTHETIC-AFTER-CANCEL');
    const [cancelResult, reservationResult] = await Promise.all([cancel, nextReservation]);
    expect(cancelResult.status).toBe(200);
    expect([201, 409]).toContain(reservationResult.status);
    let count = (await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [cancellationRaceSlotId])).rows[0].count as number;
    expect(count).toBeLessThanOrEqual(1);
    if (count === 0) expect((await reserveAt(cancellationRaceSlotId, 'SYNTHETIC-RETRY')).status).toBe(201);
    count = (await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [cancellationRaceSlotId])).rows[0].count as number;
    expect(count).toBe(1);
  });

  it('generates recurring slots in the configured timezone and applies dated exceptions', async () => {
    const effective = DateTime.now().setZone('America/Sao_Paulo').plus({ days: 10 }).toISODate()!;
    const date = DateTime.fromISO(effective, { zone: 'America/Sao_Paulo' });
    const configured = await fetch(`${baseUrl}/admin/calendar/configs`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ timezone: 'America/Sao_Paulo', effectiveFrom: effective, weeklyRules: [{ weekday: date.weekday, windows: [{ start: '10:00', end: '11:00', durationMinutes: 30, capacity: 2 }] }] }) });
    expect(configured.status).toBe(201);
    const availabilityUrl = `${baseUrl}/availability?from=${effective}&to=${effective}`;
    const available = await fetch(availabilityUrl, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()) as { configured: boolean; slots: Array<{ id: string; startsAt: string; timezone: string; status: string }> };
    expect(available.configured).toBe(true);
    expect(available.slots).toHaveLength(2);
    expect(available.slots[0].timezone).toBe('America/Sao_Paulo');
    expect(available.slots[0].startsAt).toContain('Z');
    const exception = await fetch(`${baseUrl}/admin/calendar/exceptions`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ localDate: effective, blocked: true }) });
    expect(exception.status).toBe(201);
    const blocked = await fetch(availabilityUrl, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()) as { slots: Array<{ status: string }>; days: Array<{ date: string; status: string }> };
    expect(blocked.slots.every(slot => slot.status === 'blocked')).toBe(true);
    expect(blocked.days.find(day => day.date === effective)?.status).toBe('closed');

    const nextOccurrence = date.plus({ days: 7 }).toISODate()!;
    const nextAvailability = await fetch(`${baseUrl}/availability?from=${nextOccurrence}&to=${nextOccurrence}`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()) as { slots: Array<{ id: string; status: string }> };
    expect(nextAvailability.slots.length).toBeGreaterThan(0);
    expect((await reserveAt(nextAvailability.slots[0].id, 'SYNTHETIC-CALENDAR-SUMMARY')).status).toBe(201);
    const monthlySummary = await fetch(`${baseUrl}/availability?from=${nextOccurrence}&to=${nextOccurrence}`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()) as { days: Array<{ date: string; bookingCount: number; bookings: Array<{ protocol: string }> }> };
    expect(monthlySummary.days.find(day => day.date === nextOccurrence)?.bookingCount).toBe(1);
    expect(monthlySummary.days.find(day => day.date === nextOccurrence)?.bookings[0].protocol).toMatch(/^SAD-/);
  });

  it('limits weekly configuration availability to its inclusive effective date range', async () => {
    const effectiveDate = DateTime.now().setZone('America/Sao_Paulo').plus({ days: 40 });
    const effectiveFrom = effectiveDate.toISODate()!;
    const effectiveTo = effectiveDate.plus({ days: 7 }).toISODate()!;
    const headers = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
    const configured = await fetch(`${baseUrl}/admin/calendar/configs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        timezone: 'America/Sao_Paulo',
        effectiveFrom,
        effectiveTo,
        weeklyRules: [{ weekday: effectiveDate.weekday, windows: [{ start: '10:00', end: '11:00', durationMinutes: 30, capacity: 2 }] }],
      }),
    });
    expect(configured.status).toBe(201);

    const availabilityFor = async (date: string) => fetch(`${baseUrl}/availability?from=${date}&to=${date}`, { headers: { authorization: `Bearer ${adminToken}` } }).then(response => response.json()) as Promise<{ days: Array<{ date: string; status: string }> }>;
    expect((await availabilityFor(effectiveFrom)).days[0].status).toBe('available');
    expect((await availabilityFor(effectiveTo)).days[0].status).toBe('available');
    const afterEffectiveTo = effectiveDate.plus({ days: 8 }).toISODate()!;
    expect((await availabilityFor(afterEffectiveTo)).days[0].status).toBe('no-schedule');
  });
});
