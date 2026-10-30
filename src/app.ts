import express, { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { DateTime } from 'luxon';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { SaxesParser } from 'saxes';
import { pool } from './db';
import { hashPassword, issueToken, readToken, Session, verifyPassword } from './security';
import { generateSlots, OperatingWindow, validateOperatingWindows } from './calendar';

// Express middleware attaches an authenticated session to the request.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global { namespace Express { interface Request { session?: Session } } }
const loginAttempts = new Map<string, { count: number; until: number }>();
const registrationAttempts = new Map<string, { count: number; until: number }>();
const secret = process.env.TOKEN_SECRET ?? '';
const dataDirectory = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'private_data'));
const maxDocumentBytes = Number(process.env.MAX_DOCUMENT_BYTES ?? 10 * 1024 * 1024);
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => { void fs.mkdir(dataDirectory, { recursive: true }).then(() => callback(null, dataDirectory), error => callback(error as Error, dataDirectory)); },
  filename: (_req, file, callback) => callback(null, `${randomBytes(24).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
});
const documentUpload = multer({ storage, limits: { fileSize: Number.isSafeInteger(maxDocumentBytes) && maxDocumentBytes > 0 ? maxDocumentBytes : 10 * 1024 * 1024, files: 1 } });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"); next(); });

async function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const value = req.header('authorization');
    const token = value?.startsWith('Bearer ') ? value.slice(7) : '';
    const session = secret ? readToken(token, secret) : null;
    if (!session) return res.status(401).json({ error: 'Autenticação necessária' });
    const active = await pool.query('SELECT 1 FROM users WHERE id=$1 AND role=$2 AND company_id IS NOT DISTINCT FROM $3 AND active=true', [session.sub, session.role, session.companyId]);
    if (!active.rowCount) return res.status(401).json({ error: 'Sessão inválida ou encerrada' });
    req.session = session; next();
  } catch (error) { next(error); }
}
function admin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.role !== 'admin') return res.status(403).json({ error: 'Permissão insuficiente' });
  next();
}
const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
async function audit(actorId: string | undefined, action: string, resourceType: string, resourceId: string | null, details: Record<string, unknown> = {}, executor: typeof pool | PoolClient = pool) {
  await executor.query('INSERT INTO audit_events(actor_id,action,resource_type,resource_id,details) VALUES($1,$2,$3,$4,$5)', [actorId ?? null, action, resourceType, resourceId, details]);
}
async function isCurrentConfiguredSlot(slot: { config_id: string | null; local_date: string | Date | null; timezone: string | null; starts_at: Date; ends_at: Date }, client: PoolClient): Promise<boolean> {
  if (!slot.config_id) return true;
  if (!slot.local_date || !slot.timezone) return false;
  const localDate = slot.local_date instanceof Date ? DateTime.fromJSDate(slot.local_date, { zone: 'UTC' }).toISODate()! : String(slot.local_date).slice(0, 10);
  const current = await client.query('SELECT id,timezone,weekly_rules FROM schedule_configs WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1', [localDate]);
  if (!current.rowCount || current.rows[0].id !== slot.config_id) return false;
  const config = current.rows[0];
  const exception = await client.query('SELECT blocked,windows FROM schedule_exceptions WHERE config_id=$1 AND local_date=$2', [config.id, localDate]);
  if (exception.rowCount && exception.rows[0].blocked) return false;
  const date = DateTime.fromISO(localDate, { zone: config.timezone });
  const rule = (config.weekly_rules as Array<{ weekday: number; windows: OperatingWindow[] }>).find(item => item.weekday === date.weekday);
  const windows = exception.rowCount && exception.rows[0].windows ? exception.rows[0].windows as OperatingWindow[] : rule?.windows ?? [];
  const actual = generateSlots(localDate, config.timezone, windows);
  return actual.some(item => new Date(item.startsAt).getTime() === slot.starts_at.getTime() && new Date(item.endsAt).getTime() === slot.ends_at.getTime());
}
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, { zone: 'UTC' }).toISODate() === value; }
function ensureXmlWellFormed(filePath: string): Promise<void> {
  return fs.readFile(filePath).then(buffer => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    if (!text.trimStart().startsWith('<') || /<!\s*(DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('XML deve ser bem-formado e não pode conter DTD ou entidades');
    const parser = new SaxesParser({ xmlns: true });
    let rootSeen = false;
    parser.on('opentag', () => { rootSeen = true; });
    parser.on('error', error => { throw error; });
    parser.write(text).close();
    if (!rootSeen) throw new Error('XML vazio ou sem elemento raiz');
  });
}

function isStructurallyValidPdf(content: Buffer): boolean {
  if (content.length < 32) return false;
  const text = content.toString('latin1');
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\n|\r)/.test(text)) return false;
  const pointer = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(text);
  if (!pointer) return false;
  const offset = Number(pointer[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= content.length) return false;
  const xref = text.slice(offset, offset + 1024);
  if (/^xref\b/.test(xref)) return /trailer\s*<</.test(text.slice(offset));
  return /^\d+\s+\d+\s+obj\b/.test(xref) && /\/Type\s*\/XRef\b/.test(xref) && /stream\r?\n/.test(xref);
}

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/v1/auth/login', asyncRoute(async (req, res) => {
  const input = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Dados inválidos' });
  const key = `${req.ip}:${input.data.email.toLowerCase()}`;
  const now = Date.now(); const attempts = loginAttempts.get(key);
  for (const [attemptKey, value] of loginAttempts) if (value.until <= now) loginAttempts.delete(attemptKey);
  if (loginAttempts.size > 5000) loginAttempts.delete(loginAttempts.keys().next().value!);
  if (attempts && attempts.until > now && attempts.count >= 8) return res.status(429).json({ error: 'Tente novamente mais tarde' });
  const result = await pool.query('SELECT id, email, password_hash, role, company_id FROM users WHERE lower(email)=lower($1) AND active=true', [input.data.email]);
  const user = result.rows[0];
  if (!user || !verifyPassword(input.data.password, user.password_hash)) {
    const nextCount = attempts && attempts.until > now ? attempts.count + 1 : 1;
    loginAttempts.set(key, { count: nextCount, until: now + 15 * 60_000 });
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  loginAttempts.delete(key);
  const accessToken = issueToken({ sub: user.id, role: user.role, companyId: user.company_id }, secret, Number(process.env.TOKEN_TTL_SECONDS ?? 28800));
  return res.json({ accessToken, tokenType: 'Bearer', expiresIn: Number(process.env.TOKEN_TTL_SECONDS ?? 28800), user: { id: user.id, email: user.email, role: user.role } });
}));

app.post('/api/v1/auth/register', asyncRoute(async (req, res) => {
  const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const attempts = registrationAttempts.get(key);
  for (const [attemptKey, value] of registrationAttempts) if (value.until <= now) registrationAttempts.delete(attemptKey);
  if (registrationAttempts.size > 5000) registrationAttempts.delete(registrationAttempts.keys().next().value!);
  if (attempts && attempts.until > now && attempts.count >= 5) return res.status(429).json({ error: 'Muitas tentativas de cadastro. Tente novamente mais tarde.' });
  registrationAttempts.set(key, { count: attempts && attempts.until > now ? attempts.count + 1 : 1, until: now + 60 * 60_000 });

  const input = z.object({
    companyName: z.string().trim().min(2).max(200),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(256),
  }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Informe uma empresa, um e-mail válido e uma senha com pelo menos 12 caracteres.', details: input.error.flatten().fieldErrors });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await client.query('INSERT INTO companies(name) VALUES($1) RETURNING id,name', [input.data.companyName]);
    const createdUser = await client.query("INSERT INTO users(email,password_hash,role,company_id) VALUES($1,$2,'company',$3) RETURNING id,email,role", [input.data.email, hashPassword(input.data.password), company.rows[0].id]);
    await client.query('COMMIT');
    registrationAttempts.delete(key);
    return res.status(201).json({ company: company.rows[0], user: createdUser.rows[0] });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Este e-mail já possui cadastro. Entre na sua conta ou use outro e-mail.' });
    throw error;
  } finally {
    client.release();
  }
}));

app.get('/api/v1/admin/calendar/configs', auth, admin, asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT id,timezone,effective_from,weekly_rules,created_at FROM schedule_configs ORDER BY effective_from DESC');
  return res.json({ configurations: result.rows });
}));

app.post('/api/v1/admin/calendar/configs', auth, admin, asyncRoute(async (req, res) => {
  const windowSchema = z.object({ start: z.string(), end: z.string(), durationMinutes: z.number().int().positive().max(1440), capacity: z.number().int().positive() });
  const input = z.object({ timezone: z.string().min(1).max(100), effectiveFrom: z.string(), weeklyRules: z.array(z.object({ weekday: z.number().int().min(1).max(7), windows: z.array(windowSchema) })).max(7) }).safeParse(req.body);
  if (!input.success || (input.success && !isIsoDate(input.data.effectiveFrom))) return res.status(400).json({ error: 'Configuração de calendário inválida', details: input.success ? undefined : input.error.flatten().fieldErrors });
  if (!input.data.weeklyRules.some(rule => rule.windows.length > 0)) return res.status(400).json({ error: 'Adicione ao menos uma faixa de horário antes de publicar a agenda' });
  if (!DateTime.now().setZone(input.data.timezone).isValid) return res.status(400).json({ error: 'Fuso horário IANA inválido' });
  const today = DateTime.now().setZone(input.data.timezone).toISODate()!;
  if (input.data.effectiveFrom < today) return res.status(400).json({ error: 'A vigência não pode começar no passado' });
  const seenWeekdays = new Set<number>();
  try {
    for (const rule of input.data.weeklyRules) {
      if (seenWeekdays.has(rule.weekday)) return res.status(400).json({ error: 'Não repita dias da semana' });
      seenWeekdays.add(rule.weekday); validateOperatingWindows(rule.windows);
    }
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Faixa inválida' }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT id FROM schedule_slots WHERE local_date >= $1 OR (config_id IS NULL AND starts_at >= (($1::date)::timestamp AT TIME ZONE $2)) ORDER BY id FOR UPDATE", [input.data.effectiveFrom, input.data.timezone]);
    const latest = await client.query('SELECT max(effective_from) AS effective_from FROM schedule_configs');
    if (latest.rows[0].effective_from && input.data.effectiveFrom <= DateTime.fromJSDate(new Date(latest.rows[0].effective_from)).toISODate()!) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Uma nova versão deve ter vigência posterior à configuração mais recente' }); }
    const existing = await client.query("SELECT 1 FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id WHERE b.status='confirmed' AND (s.local_date >= $1 OR s.starts_at >= (($1::date)::timestamp AT TIME ZONE $2)) LIMIT 1", [input.data.effectiveFrom, input.data.timezone]);
    if (existing.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Há reservas confirmadas a partir da vigência. Escolha uma data posterior à última reserva.' }); }
    const result = await client.query('INSERT INTO schedule_configs(timezone,effective_from,weekly_rules,created_by) VALUES($1,$2,$3,$4) RETURNING id,timezone,effective_from,weekly_rules,created_at', [input.data.timezone, input.data.effectiveFrom, JSON.stringify(input.data.weeklyRules), req.session!.sub]);
    await client.query("UPDATE schedule_slots SET blocked=true WHERE local_date >= $1 OR (config_id IS NULL AND starts_at >= (($1::date)::timestamp AT TIME ZONE $2))", [input.data.effectiveFrom, input.data.timezone]);
    await audit(req.session!.sub, 'calendar.configuration.created', 'schedule_config', result.rows[0].id, { effectiveFrom: input.data.effectiveFrom }, client);
    await client.query('COMMIT');
    return res.status(201).json({ configuration: result.rows[0] });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Já existe uma configuração com essa vigência' });
    throw error;
  } finally { client.release(); }
}));

app.post('/api/v1/admin/calendar/exceptions', auth, admin, asyncRoute(async (req, res) => {
  const windowSchema = z.object({ start: z.string(), end: z.string(), durationMinutes: z.number().int().positive().max(1440), capacity: z.number().int().positive() });
  const input = z.object({ localDate: z.string(), blocked: z.boolean(), windows: z.array(windowSchema).optional() }).safeParse(req.body);
  if (!input.success || (input.success && !isIsoDate(input.data.localDate)) || (input.success && !input.data.blocked && !input.data.windows)) return res.status(400).json({ error: 'Exceção inválida: data ISO, bloqueio ou faixas são obrigatórios' });
  try { if (input.data.windows) validateOperatingWindows(input.data.windows); }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Faixas inválidas' }); }
  const config = await pool.query('SELECT id,timezone FROM schedule_configs WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1', [input.data.localDate]);
  if (!config.rowCount) return res.status(409).json({ error: 'Configure primeiro o calendário' });
  if (input.data.localDate < DateTime.now().setZone(config.rows[0].timezone).toISODate()!) return res.status(400).json({ error: 'A data da exceção não pode estar no passado' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT id FROM schedule_slots WHERE (config_id=$1 AND local_date=$2) OR (config_id IS NULL AND date(starts_at AT TIME ZONE $3)=$2) ORDER BY id FOR UPDATE", [config.rows[0].id, input.data.localDate, config.rows[0].timezone]);
    const booked = await client.query("SELECT 1 FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id WHERE ((s.config_id=$1 AND s.local_date=$2) OR (s.config_id IS NULL AND date(s.starts_at AT TIME ZONE $3)=$2)) AND b.status='confirmed' LIMIT 1", [config.rows[0].id, input.data.localDate, config.rows[0].timezone]);
    if (booked.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Há reservas confirmadas nesta data; a exceção não pode alterar os horários existentes.' }); }
    const result = await client.query('INSERT INTO schedule_exceptions(config_id,local_date,blocked,windows,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,config_id,local_date,blocked,windows', [config.rows[0].id, input.data.localDate, input.data.blocked, input.data.windows ? JSON.stringify(input.data.windows) : null, req.session!.sub]);
    await client.query("UPDATE schedule_slots SET blocked=true WHERE (config_id=$1 AND local_date=$2) OR (config_id IS NULL AND date(starts_at AT TIME ZONE $3)=$2)", [config.rows[0].id, input.data.localDate, config.rows[0].timezone]);
    await audit(req.session!.sub, 'calendar.exception.created', 'schedule_exception', result.rows[0].id, { localDate: input.data.localDate, blocked: input.data.blocked }, client);
    await client.query('COMMIT');
    return res.status(201).json({ exception: result.rows[0] });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Já existe uma exceção para essa data e configuração' });
    throw error;
  } finally { client.release(); }
}));

app.get('/api/v1/admin/calendar/exceptions', auth, admin, asyncRoute(async (req, res) => {
  const input = z.object({ from: z.string(), to: z.string() }).safeParse(req.query);
  if (!input.success || !isIsoDate(input.data.from) || !isIsoDate(input.data.to) || input.data.from > input.data.to) return res.status(400).json({ error: 'Informe from e to como datas ISO' });
  const result = await pool.query(`SELECT e.id,e.local_date,e.blocked,e.windows,c.timezone,c.effective_from
    FROM schedule_exceptions e JOIN schedule_configs c ON c.id=e.config_id WHERE e.local_date BETWEEN $1 AND $2 ORDER BY e.local_date`, [input.data.from, input.data.to]);
  return res.json({ exceptions: result.rows });
}));

app.get('/api/v1/availability', auth, asyncRoute(async (req, res) => {
  const query = z.object({ from: z.string(), to: z.string() }).safeParse(req.query);
  if (!query.success || !isIsoDate(query.data.from) || !isIsoDate(query.data.to) || query.data.from > query.data.to) return res.status(400).json({ error: 'Informe from e to como datas ISO (AAAA-MM-DD)' });
  const startDay = DateTime.fromISO(query.data.from, { zone: 'UTC' });
  const endDay = DateTime.fromISO(query.data.to, { zone: 'UTC' });
  if (endDay.diff(startDay, 'days').days > 41) return res.status(400).json({ error: 'Consulte no máximo 42 dias por vez' });
  const allSlots = new Map<string, { id: string; starts_at: Date; ends_at: Date; capacity: number; blocked: boolean; timezone: string | null; occupied: number }>();
  const days = new Map<string, { date: string; timezone: string | null; configured: boolean; blocked: boolean; capacity: number; occupied: number; remaining: number; bookingCount: number; status: string; slots: Array<Record<string, unknown>>; bookings: Array<Record<string, unknown>> }>();
  let configurationFound = false;
  for (let day = startDay; day <= endDay; day = day.plus({ days: 1 })) {
    const localDate = day.toISODate()!;
    days.set(localDate, { date: localDate, timezone: null, configured: false, blocked: false, capacity: 0, occupied: 0, remaining: 0, bookingCount: 0, status: 'no-schedule', slots: [], bookings: [] });
    const config = await pool.query('SELECT id,timezone,weekly_rules FROM schedule_configs WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1', [localDate]);
    if (!config.rowCount) continue;
    configurationFound = true;
    const schedule = config.rows[0];
    const exception = await pool.query('SELECT blocked,windows FROM schedule_exceptions WHERE config_id=$1 AND local_date=$2', [schedule.id, localDate]);
    const rule = (schedule.weekly_rules as Array<{ weekday: number; windows: OperatingWindow[] }>).find(item => item.weekday === day.weekday);
    const windows = exception.rowCount && exception.rows[0].windows ? exception.rows[0].windows as OperatingWindow[] : rule?.windows ?? [];
    const blocked = Boolean(exception.rowCount && exception.rows[0].blocked);
    const daySummary = days.get(localDate)!;
    daySummary.configured = true; daySummary.timezone = schedule.timezone; daySummary.blocked = blocked;
    let generated: { startsAt: string; endsAt: string }[];
    try { generated = generateSlots(localDate, schedule.timezone, windows); }
    catch (error) { return res.status(422).json({ error: error instanceof Error ? error.message : 'Calendário inválido', date: localDate }); }
    for (let index = 0; index < generated.length; index++) {
      const window = windows.find(item => {
        const starts = DateTime.fromISO(generated[index].startsAt).setZone(schedule.timezone).toFormat('HH:mm');
        return starts >= item.start && starts < item.end;
      });
      if (!window) continue;
      const inserted = await pool.query(`INSERT INTO schedule_slots(starts_at,ends_at,capacity,blocked,config_id,local_date,timezone)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(config_id,starts_at,ends_at) WHERE config_id IS NOT NULL DO UPDATE SET capacity=EXCLUDED.capacity,blocked=EXCLUDED.blocked,local_date=EXCLUDED.local_date,timezone=EXCLUDED.timezone
        WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE slot_id=schedule_slots.id AND status='confirmed') RETURNING id`, [generated[index].startsAt, generated[index].endsAt, window.capacity, blocked, schedule.id, localDate, schedule.timezone]);
      const slot = inserted.rowCount ? (await pool.query('SELECT id,starts_at,ends_at,capacity,blocked,timezone FROM schedule_slots WHERE id=$1', [inserted.rows[0].id])).rows[0] : (await pool.query('SELECT id,starts_at,ends_at,capacity,blocked,timezone FROM schedule_slots WHERE config_id=$1 AND starts_at=$2 AND ends_at=$3', [schedule.id, generated[index].startsAt, generated[index].endsAt])).rows[0];
      const occupied = await pool.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [slot.id]);
      allSlots.set(slot.id, { ...slot, occupied: occupied.rows[0].count });
    }
  }
  const manual = await pool.query("SELECT s.id,s.starts_at,s.ends_at,s.capacity,s.blocked,s.timezone,count(b.id)::int AS occupied FROM schedule_slots s LEFT JOIN bookings b ON b.slot_id=s.id AND b.status='confirmed' WHERE s.config_id IS NULL AND s.starts_at >= $1::date AND s.starts_at < ($2::date + interval '1 day') GROUP BY s.id ORDER BY s.starts_at", [query.data.from, query.data.to]);
  if (manual.rowCount) configurationFound = true;
  for (const slot of manual.rows) allSlots.set(slot.id, slot);
  const slots = [...allSlots.values()].sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime()).map(slot => {
    const timezone = slot.timezone ?? 'UTC';
    const localDate = DateTime.fromJSDate(slot.starts_at, { zone: 'UTC' }).setZone(timezone).toISODate()!;
    const summary = days.get(localDate);
    if (summary) {
      summary.configured = true;
      summary.capacity += slot.capacity;
      summary.occupied += slot.occupied;
      summary.remaining += slot.blocked ? 0 : Math.max(0, slot.capacity - slot.occupied);
      summary.slots.push({ id: slot.id, startsAt: slot.starts_at, endsAt: slot.ends_at, timezone, capacity: slot.capacity, occupied: slot.occupied, remaining: slot.blocked ? 0 : Math.max(0, slot.capacity - slot.occupied), status: slot.blocked ? 'blocked' : slot.occupied >= slot.capacity ? 'full' : slot.occupied ? 'partial' : 'available' });
    }
    return { id: slot.id, startsAt: slot.starts_at, endsAt: slot.ends_at, timezone, localDate, capacity: slot.capacity, occupied: slot.occupied, status: slot.blocked ? 'blocked' : slot.occupied >= slot.capacity ? 'full' : slot.occupied ? 'partial' : 'available' };
  });
  const bookingParams: unknown[] = [query.data.from, query.data.to, query.data.from, query.data.to];
  let tenantFilter = '';
  if (req.session!.role === 'company') { bookingParams.push(req.session!.companyId); tenantFilter = ` AND b.company_id=$${bookingParams.length}`; }
  const visibleBookings = await pool.query(`SELECT b.id,b.protocol,b.status,s.starts_at,s.local_date,s.timezone,t.plate,d.name AS driver_name,c.name AS company_name
    FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id JOIN trucks t ON t.id=b.truck_id JOIN drivers d ON d.id=b.driver_id JOIN companies c ON c.id=b.company_id
    WHERE b.status='confirmed' AND ((s.local_date BETWEEN $1 AND $2) OR (s.local_date IS NULL AND s.starts_at >= $3::date AND s.starts_at < ($4::date + interval '1 day')))${tenantFilter}
    ORDER BY s.starts_at`, bookingParams);
  for (const booking of visibleBookings.rows) {
    const timezone = booking.timezone ?? 'UTC';
    const localDate = booking.local_date ? booking.local_date instanceof Date ? DateTime.fromJSDate(booking.local_date, { zone: 'UTC' }).toISODate()! : String(booking.local_date).slice(0, 10) : DateTime.fromJSDate(booking.starts_at, { zone: 'UTC' }).setZone(timezone).toISODate()!;
    const summary = days.get(localDate);
    if (!summary) continue;
    summary.bookingCount++;
    summary.bookings.push({ id: booking.id, protocol: booking.protocol, status: booking.status, startsAt: booking.starts_at, timezone, plate: booking.plate, driverName: booking.driver_name, ...(req.session!.role === 'admin' ? { companyName: booking.company_name } : {}) });
  }
  for (const summary of days.values()) {
    if (summary.blocked) summary.status = 'closed';
    else if (summary.slots.length === 0) summary.status = summary.configured ? 'no-service' : 'no-schedule';
    else if (summary.remaining === 0) summary.status = 'full';
    else if (summary.occupied > 0) summary.status = 'partial';
    else summary.status = 'available';
  }
  return res.json({ configured: configurationFound, slots, days: [...days.values()] });
}));

app.post('/api/v1/bookings', auth, asyncRoute(async (req, res) => {
  if (req.session?.role !== 'company' || !req.session.companyId) return res.status(403).json({ error: 'Apenas usuários de empresa podem reservar' });
  const schema = z.object({ slotId: z.string().uuid(), truckId: z.string().uuid(), driverId: z.string().uuid(), weight: z.number().positive().optional(), weightUnit: z.enum(['kg','t']).optional(), invoiceNumber: z.string().min(1).max(64), invoiceSeries: z.string().max(32).optional(), invoiceKey: z.string().max(64).optional(), notes: z.string().max(2000).optional() });
  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Dados inválidos', details: input.error.flatten().fieldErrors });
  const idempotencyHeader = req.header('idempotency-key');
  const idempotency = idempotencyHeader ? z.string().uuid().safeParse(idempotencyHeader) : null;
  if (idempotency && !idempotency.success) return res.status(400).json({ error: 'Idempotency-Key inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (idempotency?.success) {
      const prior = await client.query('SELECT id,protocol,status,created_at FROM bookings WHERE company_id=$1 AND idempotency_key=$2', [req.session.companyId, idempotency.data]);
      if (prior.rowCount) { await client.query('COMMIT'); return res.status(200).json({ booking: prior.rows[0], replayed: true }); }
    }
    const slotResult = await client.query('SELECT id,capacity,blocked,starts_at,ends_at,config_id,local_date,timezone FROM schedule_slots WHERE id=$1 FOR UPDATE', [input.data.slotId]);
    const slot = slotResult.rows[0];
    if (!slot) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Horário não encontrado' }); }
    if (slot.blocked) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Horário bloqueado' }); }
    if (new Date(slot.starts_at).getTime() <= Date.now()) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Não é possível reservar um horário no passado' }); }
    if (!await isCurrentConfiguredSlot(slot, client)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A agenda foi atualizada; consulte a disponibilidade novamente' }); }
    const occupied = await client.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [slot.id]);
    if (occupied.rows[0].count >= slot.capacity) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Horário esgotado' }); }
    const protocolKey = randomBytes(8).toString('hex').toUpperCase();
    const created = await client.query(`INSERT INTO bookings (protocol,company_id,slot_id,truck_id,driver_id,weight,weight_unit,invoice_number,invoice_series,invoice_key,notes,status,created_by,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13) RETURNING id,protocol,status,created_at`,
      [`SAD-${new Date().getUTCFullYear()}-${protocolKey}`, req.session.companyId, input.data.slotId, input.data.truckId, input.data.driverId, input.data.weight ?? null, input.data.weightUnit ?? null, input.data.invoiceNumber, input.data.invoiceSeries ?? null, input.data.invoiceKey ?? null, input.data.notes ?? null, req.session.sub, idempotency?.success ? idempotency.data : null]);
    const booking = created.rows[0];
    await client.query('INSERT INTO booking_history(booking_id,actor_id,action) VALUES($1,$2,$3)', [booking.id, req.session.sub, 'created']);
    await audit(req.session.sub, 'booking.created', 'booking', booking.id, { protocol: booking.protocol }, client);
    await client.query('COMMIT');
    return res.status(201).json({ booking });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if (idempotency?.success && (error as { code?: string }).code === '23505') {
      const prior = await pool.query('SELECT id,protocol,status,created_at FROM bookings WHERE company_id=$1 AND idempotency_key=$2', [req.session.companyId, idempotency.data]);
      if (prior.rowCount) return res.status(200).json({ booking: prior.rows[0], replayed: true });
    }
    throw error;
  }
  finally { client.release(); }
}));

app.get('/api/v1/bookings/:id', auth, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  const params: unknown[] = [req.params.id];
  let where = 'b.id=$1';
  if (req.session?.role === 'company') { params.push(req.session.companyId); where += ' AND b.company_id=$2'; }
  const result = await pool.query(`SELECT b.id,b.slot_id,b.protocol,b.status,b.weight,b.weight_unit,b.invoice_number,b.invoice_series,b.invoice_key,b.notes,b.created_at,s.starts_at,s.ends_at,t.plate,d.name AS driver_name FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id JOIN trucks t ON t.id=b.truck_id JOIN drivers d ON d.id=b.driver_id WHERE ${where}`, params);
  if (!result.rowCount) return res.status(404).json({ error: 'Agendamento não encontrado' });
  const history = await pool.query('SELECT action,details,created_at FROM booking_history WHERE booking_id=$1 ORDER BY id', [req.params.id]);
  const documents = await pool.query('SELECT id,media_type,original_name,byte_size,created_at FROM booking_documents WHERE booking_id=$1 AND deleted_at IS NULL ORDER BY created_at', [req.params.id]);
  return res.json({ booking: result.rows[0], history: history.rows, documents: documents.rows });
}));

app.get('/api/v1/bookings', auth, asyncRoute(async (req, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(25), protocol: z.string().max(64).optional(), plate: z.string().max(16).optional(), companyId: z.string().uuid().optional(), status: z.enum(['confirmed','cancelled']).optional() }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'Filtros inválidos' });
  const filters: string[] = [];
  const values: unknown[] = [];
  const add = (clause: string, value: unknown) => { values.push(value); filters.push(clause.replace('?', `$${values.length}`)); };
  if (req.session!.role === 'company') add('b.company_id=?', req.session!.companyId);
  else if (query.data.companyId) add('b.company_id=?', query.data.companyId);
  if (query.data.protocol) add('b.protocol ILIKE ?', `%${query.data.protocol}%`);
  if (query.data.plate) add('t.plate ILIKE ?', `%${query.data.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`);
  if (query.data.status) add('b.status=?', query.data.status);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await pool.query(`SELECT count(*)::int AS total FROM bookings b JOIN trucks t ON t.id=b.truck_id ${where}`, values);
  values.push(query.data.pageSize, (query.data.page - 1) * query.data.pageSize);
  const result = await pool.query(`SELECT b.id,b.protocol,b.status,b.weight,b.weight_unit,b.invoice_number,b.invoice_series,b.invoice_key,b.notes,b.created_at,s.starts_at,s.ends_at,t.plate,d.name AS driver_name,c.name AS company_name,
    COALESCE((
      SELECT json_agg(json_build_object('id', doc.id, 'media_type', doc.media_type, 'original_name', doc.original_name, 'byte_size', doc.byte_size) ORDER BY doc.created_at)
      FROM booking_documents doc
      WHERE doc.booking_id = b.id AND doc.deleted_at IS NULL
    ), '[]'::json) AS documents
    FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id JOIN trucks t ON t.id=b.truck_id JOIN drivers d ON d.id=b.driver_id JOIN companies c ON c.id=b.company_id ${where}
    ORDER BY s.starts_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  return res.json({ bookings: result.rows, page: query.data.page, pageSize: query.data.pageSize, total: count.rows[0].total });
}));

app.get('/api/v1/company/trucks', auth, asyncRoute(async (req, res) => {
  if (!req.session!.companyId) return res.status(403).json({ error: 'Rota exclusiva de empresas' });
  const result = await pool.query('SELECT id,plate,vehicle_type FROM trucks WHERE company_id=$1 ORDER BY plate', [req.session!.companyId]);
  return res.json({ trucks: result.rows });
}));

app.get('/api/v1/company/profile', auth, asyncRoute(async (req, res) => {
  if (!req.session!.companyId) return res.status(403).json({ error: 'Rota exclusiva de empresas' });
  const result = await pool.query('SELECT id,name,active FROM companies WHERE id=$1', [req.session!.companyId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Empresa não encontrada' });
  return res.json({ company: result.rows[0] });
}));

app.get('/api/v1/company/drivers', auth, asyncRoute(async (req, res) => {
  if (!req.session!.companyId) return res.status(403).json({ error: 'Rota exclusiva de empresas' });
  const result = await pool.query('SELECT id,name,phone FROM drivers WHERE company_id=$1 ORDER BY name', [req.session!.companyId]);
  return res.json({ drivers: result.rows });
}));

app.post('/api/v1/bookings/:id/reschedule', auth, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  const input = z.object({ slotId: z.string().uuid() }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Novo horário inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT id,protocol,company_id,slot_id,status FROM bookings WHERE id=$1 FOR UPDATE', [req.params.id]);
    const booking = currentResult.rows[0];
    if (!booking || (req.session!.role === 'company' && booking.company_id !== req.session!.companyId)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Agendamento não encontrado' }); }
    if (booking.status !== 'confirmed') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Somente reservas confirmadas podem ser reagendadas' }); }
    if (booking.slot_id === input.data.slotId) { await client.query('COMMIT'); return res.json({ id: booking.id, protocol: booking.protocol, status: 'confirmed', unchanged: true }); }
    const ids = [booking.slot_id, input.data.slotId].sort();
    const slots = await client.query('SELECT id,capacity,blocked,starts_at,ends_at,config_id,local_date,timezone FROM schedule_slots WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    const target = slots.rows.find(slot => slot.id === input.data.slotId);
    if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Novo horário não encontrado' }); }
    if (target.blocked) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Novo horário bloqueado' }); }
    if (new Date(target.starts_at).getTime() <= Date.now()) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Não é possível reagendar para um horário no passado' }); }
    if (!await isCurrentConfiguredSlot(target, client)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A agenda foi atualizada; consulte a disponibilidade novamente' }); }
    const count = await client.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [target.id]);
    if (count.rows[0].count >= target.capacity) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Novo horário esgotado' }); }
    const oldSlot = slots.rows.find(slot => slot.id === booking.slot_id);
    await client.query('UPDATE bookings SET slot_id=$2,updated_at=now() WHERE id=$1', [booking.id, target.id]);
    const detail = { oldSlotId: oldSlot.id, oldStartsAt: oldSlot.starts_at, newSlotId: target.id, newStartsAt: target.starts_at };
    await client.query("INSERT INTO booking_history(booking_id,actor_id,action,details) VALUES($1,$2,'rescheduled',$3)", [booking.id, req.session!.sub, detail]);
    await audit(req.session!.sub, 'booking.rescheduled', 'booking', booking.id, detail, client);
    await client.query('COMMIT');
    return res.json({ id: booking.id, protocol: booking.protocol, status: 'confirmed', startsAt: target.starts_at });
  } catch (error: unknown) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.post('/api/v1/bookings/:id/cancel', auth, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT id,company_id,status FROM bookings WHERE id=$1 FOR UPDATE', [req.params.id]);
    const booking = lock.rows[0];
    if (!booking || (req.session?.role === 'company' && booking.company_id !== req.session.companyId)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Agendamento não encontrado' }); }
    if (booking.status !== 'confirmed') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Agendamento não está confirmado' }); }
    await client.query("UPDATE bookings SET status='cancelled',updated_at=now() WHERE id=$1", [booking.id]);
    await client.query('INSERT INTO booking_history(booking_id,actor_id,action) VALUES($1,$2,$3)', [booking.id, req.session!.sub, 'cancelled']);
    await audit(req.session!.sub, 'booking.cancelled', 'booking', booking.id, {}, client);
    await client.query('COMMIT'); return res.json({ id: booking.id, status: 'cancelled' });
  } catch (error: unknown) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.post('/api/v1/bookings/:id/documents', auth, (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  documentUpload.single('file')(req, res, error => error ? next(error) : next());
}, asyncRoute(async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Envie um arquivo no campo file' });
  const extension = path.extname(file.originalname).toLowerCase();
  const originalName = path.basename(file.originalname.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || `document${extension}`;
  const storageKey = path.basename(file.filename);
  const filePath = path.resolve(dataDirectory, storageKey);
  const cleanup = () => fs.rm(filePath, { force: true });
  if (!['.pdf', '.xml'].includes(extension) || filePath !== path.join(dataDirectory, storageKey) || !/^[a-f0-9]{48}\.(pdf|xml)$/.test(storageKey)) {
    await cleanup(); return res.status(400).json({ error: 'Formato de arquivo não permitido' });
  }
  const documentType = req.body.documentType;
  if (!['xml', 'pdf'].includes(documentType) || extension !== `.${documentType}`) { await cleanup(); return res.status(400).json({ error: 'O arquivo não corresponde ao campo de documento informado' }); }
  const content = await fs.readFile(filePath);
  let mediaType: 'application/pdf' | 'application/xml';
  if (extension === '.pdf') {
    if (!isStructurallyValidPdf(content)) { await cleanup(); return res.status(400).json({ error: 'PDF inválido ou corrompido' }); }
    mediaType = 'application/pdf';
  } else {
    try { await ensureXmlWellFormed(filePath); }
    catch { await cleanup(); return res.status(400).json({ error: 'XML inválido ou contém declarações não permitidas' }); }
    mediaType = 'application/xml';
  }
  const tenantFilter = req.session!.role === 'company' ? ' AND company_id=$2' : '';
  const params = req.session!.role === 'company' ? [req.params.id, req.session!.companyId] : [req.params.id];
  const booking = await pool.query(`SELECT id,company_id FROM bookings WHERE id=$1${tenantFilter}`, params);
  if (!booking.rowCount) { await cleanup(); return res.status(404).json({ error: 'Agendamento não encontrado' }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO booking_documents(booking_id,company_id,storage_key,media_type,original_name,byte_size,sha256,uploaded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,booking_id,media_type,original_name,byte_size,created_at`, [booking.rows[0].id, booking.rows[0].company_id, storageKey, mediaType, originalName, content.length, createHash('sha256').update(content).digest('hex'), req.session!.sub]);
    await client.query("INSERT INTO document_audit_events(document_id,actor_id,action) VALUES($1,$2,'upload')", [result.rows[0].id, req.session!.sub]);
    await audit(req.session!.sub, 'document.uploaded', 'booking_document', result.rows[0].id, { bookingId: booking.rows[0].id, mediaType, byteSize: content.length }, client);
    await client.query('COMMIT');
    return res.status(201).json({ document: result.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); await cleanup(); throw error; }
  finally { client.release(); }
}));

app.delete('/api/v1/bookings/:bookingId/documents/:documentId', auth, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.bookingId).success || !z.string().uuid().safeParse(req.params.documentId).success) return res.status(400).json({ error: 'Identificador invÃ¡lido' });
  const client = await pool.connect();
  let storageKey = '';
  try {
    await client.query('BEGIN');
    const tenantFilter = req.session!.role === 'company' ? ' AND b.company_id=$3' : '';
    const params = req.session!.role === 'company' ? [req.params.documentId, req.params.bookingId, req.session!.companyId] : [req.params.documentId, req.params.bookingId];
    const found = await client.query(`SELECT d.id,d.storage_key FROM booking_documents d JOIN bookings b ON b.id=d.booking_id WHERE d.id=$1 AND d.booking_id=$2 AND d.deleted_at IS NULL${tenantFilter} FOR UPDATE OF d`, params);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Documento nÃ£o encontrado' }); }
    storageKey = found.rows[0].storage_key;
    await client.query('UPDATE booking_documents SET deleted_at=now() WHERE id=$1', [found.rows[0].id]);
    await client.query("INSERT INTO document_audit_events(document_id,actor_id,action) VALUES($1,$2,'delete')", [found.rows[0].id, req.session!.sub]);
    await audit(req.session!.sub, 'document.deleted', 'booking_document', found.rows[0].id, { bookingId: req.params.bookingId }, client);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  const key = path.basename(storageKey);
  if (/^[a-f0-9]{48}\.(pdf|xml)$/.test(key)) {
    try { await fs.rm(path.join(dataDirectory, key), { force: true }); }
    catch { console.error('Private document cleanup failed', { documentId: req.params.documentId }); }
  }
  return res.status(204).end();
}));

app.get('/api/v1/documents/:id/download', auth, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  const params: unknown[] = [req.params.id];
  const tenantFilter = req.session!.role === 'company' ? ' AND d.company_id=$2' : '';
  if (req.session!.role === 'company') params.push(req.session!.companyId);
  const result = await pool.query(`SELECT d.id,d.storage_key,d.media_type,d.original_name FROM booking_documents d WHERE d.id=$1 AND d.deleted_at IS NULL${tenantFilter}`, params);
  if (!result.rowCount) return res.status(404).json({ error: 'Documento não encontrado' });
  const document = result.rows[0];
  const key = path.basename(document.storage_key);
  if (key !== document.storage_key || !/^[a-f0-9]{48}\.(pdf|xml)$/.test(key)) return res.status(404).json({ error: 'Documento não encontrado' });
  const filePath = path.resolve(dataDirectory, key);
  if (path.dirname(filePath) !== dataDirectory) return res.status(404).json({ error: 'Documento não encontrado' });
  await pool.query("INSERT INTO document_audit_events(document_id,actor_id,action) VALUES($1,$2,'download')", [document.id, req.session!.sub]);
  await audit(req.session!.sub, 'document.downloaded', 'booking_document', document.id, {});
  res.setHeader('Content-Type', document.media_type);
  const downloadName = document.original_name || `${document.id}.${document.media_type === 'application/pdf' ? 'pdf' : 'xml'}`;
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = (await import('node:fs')).createReadStream(filePath);
  stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'Arquivo não encontrado' }); else res.destroy(); });
  stream.pipe(res);
}));

app.get('/api/v1/bookings/:id/documents/download/:type', auth, asyncRoute(async (req, res) => {
  const type = req.params.type.toLowerCase();
  if (type !== 'xml' && type !== 'pdf') return res.status(400).json({ error: 'Tipo inválido. Use xml ou pdf.' });
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  const tenantFilter = req.session!.role === 'company' ? ' AND d.company_id=$2' : '';
  const params = req.session!.role === 'company' ? [req.params.id, req.session!.companyId] : [req.params.id];
  const mediaFilter = type === 'pdf' ? "d.media_type='application/pdf'" : "(d.media_type='application/xml' OR d.media_type='text/xml')";
  const result = await pool.query(`SELECT d.id,d.storage_key,d.media_type,d.original_name FROM booking_documents d WHERE d.booking_id=$1 AND d.deleted_at IS NULL AND ${mediaFilter}${tenantFilter} ORDER BY d.created_at DESC LIMIT 1`, params);
  if (result.rowCount) {
    const document = result.rows[0];
    const key = path.basename(document.storage_key);
    const filePath = path.resolve(dataDirectory, key);
    if (key === document.storage_key && /^[a-f0-9]{48}\.(pdf|xml)$/.test(key) && path.dirname(filePath) === dataDirectory && (await import('node:fs')).existsSync(filePath)) {
      await pool.query("INSERT INTO document_audit_events(document_id,actor_id,action) VALUES($1,$2,'download')", [document.id, req.session!.sub]);
      await audit(req.session!.sub, 'document.downloaded', 'booking_document', document.id, {});
      res.setHeader('Content-Type', document.media_type);
      const downloadName = document.original_name || `${document.id}.${type}`;
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = (await import('node:fs')).createReadStream(filePath);
      return stream.pipe(res);
    }
  }
  return res.status(404).json({ error: 'Documento fiscal não anexado a este agendamento.' });

}));

app.get('/api/v1/admin/audit', auth, admin, asyncRoute(async (req, res) => {
  const input = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(50), action: z.string().max(100).optional(), resourceType: z.string().max(100).optional() }).safeParse(req.query);
  if (!input.success) return res.status(400).json({ error: 'Filtros inválidos' });
  const filters: string[] = []; const params: unknown[] = [];
  if (input.data.action) { params.push(input.data.action); filters.push(`action=$${params.length}`); }
  if (input.data.resourceType) { params.push(input.data.resourceType); filters.push(`resource_type=$${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(input.data.pageSize, (input.data.page - 1) * input.data.pageSize);
  const result = await pool.query(`SELECT id,actor_id,action,resource_type,resource_id,details,created_at FROM audit_events ${where} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return res.json({ events: result.rows, page: input.data.page, pageSize: input.data.pageSize });
}));

app.post('/api/v1/admin/companies', auth, admin, asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(200), email: z.string().email().max(254).optional(), password: z.string().min(12).max(256).optional() }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Nome inválido' });
  if (Boolean(input.data.email) !== Boolean(input.data.password)) return res.status(400).json({ error: 'E-mail e senha devem ser informados juntos' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await client.query('INSERT INTO companies(name) VALUES($1) RETURNING id,name,active,created_at', [input.data.name]);
    if (input.data.email && input.data.password) {
      const createdUser = await client.query("INSERT INTO users(email,password_hash,role,company_id) VALUES($1,$2,'company',$3) RETURNING id", [input.data.email, hashPassword(input.data.password), company.rows[0].id]);
      await audit(req.session!.sub, 'user.created', 'user', createdUser.rows[0].id, { role: 'company', companyId: company.rows[0].id }, client);
    }
    await audit(req.session!.sub, 'company.created', 'company', company.rows[0].id, { name: company.rows[0].name }, client);
    await client.query('COMMIT');
    return res.status(201).json({ company: company.rows[0] });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado' });
    throw error;
  } finally { client.release(); }
}));

app.get('/api/v1/admin/companies', auth, admin, asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT id,name,active,created_at FROM companies ORDER BY name');
  return res.json({ companies: result.rows });
}));

app.get('/api/v1/admin/dashboard', auth, admin, asyncRoute(async (_req, res) => {
  const today = DateTime.now().setZone('America/Sao_Paulo').toISODate()!;
  const [metrics, nextBookings] = await Promise.all([
    pool.query(`WITH occupied AS (
        SELECT slot_id,count(*)::int AS count FROM bookings WHERE status='confirmed' GROUP BY slot_id
      )
      SELECT
        (SELECT count(*)::int FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id
          WHERE b.status='confirmed' AND COALESCE(s.local_date,(s.starts_at AT TIME ZONE 'America/Sao_Paulo')::date)=$1) AS bookings_today,
        (SELECT COALESCE(sum(GREATEST(s.capacity-COALESCE(o.count,0),0)),0)::int FROM schedule_slots s
          LEFT JOIN occupied o ON o.slot_id=s.id
          WHERE NOT s.blocked AND COALESCE(s.local_date,(s.starts_at AT TIME ZONE 'America/Sao_Paulo')::date)=$1) AS available_slots_today,
        (SELECT count(*)::int FROM trucks) AS trucks_total,
        (SELECT count(*)::int FROM drivers) AS drivers_total`, [today]),
    pool.query(`SELECT b.id,b.protocol,b.status,s.starts_at,s.timezone,t.plate,d.name AS driver_name,c.name AS company_name
      FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id JOIN trucks t ON t.id=b.truck_id
      JOIN drivers d ON d.id=b.driver_id JOIN companies c ON c.id=b.company_id
      WHERE b.status='confirmed' AND s.starts_at >= now() ORDER BY s.starts_at LIMIT 5`),
  ]);
  return res.json({ metrics: metrics.rows[0], nextBookings: nextBookings.rows });
}));

app.patch('/api/v1/admin/companies/:id', auth, admin, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  const input = z.object({ name: z.string().trim().min(1).max(200).optional(), active: z.boolean().optional() }).refine(data => data.name !== undefined || data.active !== undefined).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Dados inválidos' });
  const result = await pool.query('UPDATE companies SET name=COALESCE($2,name),active=COALESCE($3,active) WHERE id=$1 RETURNING id,name,active,created_at', [req.params.id, input.data.name ?? null, input.data.active ?? null]);
  if (!result.rowCount) return res.status(404).json({ error: 'Empresa não encontrada' });
  await audit(req.session!.sub, 'company.updated', 'company', req.params.id, { name: result.rows[0].name, active: result.rows[0].active });
  return res.json({ company: result.rows[0] });
}));

app.get('/api/v1/admin/users', auth, admin, asyncRoute(async (req, res) => {
  const companyId = z.string().uuid().safeParse(req.query.companyId);
  if (req.query.companyId && !companyId.success) return res.status(400).json({ error: 'companyId inválido' });
  const result = await pool.query('SELECT id,email,role,company_id,active,created_at FROM users WHERE role=$1 AND ($2::uuid IS NULL OR company_id=$2) ORDER BY email', ['company', companyId.success ? companyId.data : null]);
  return res.json({ users: result.rows });
}));

app.patch('/api/v1/admin/users/:id', auth, admin, asyncRoute(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido' });
  const input = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Informe active como booleano' });
  const result = await pool.query("UPDATE users SET active=$2 WHERE id=$1 AND role='company' RETURNING id,email,role,company_id,active", [req.params.id, input.data.active]);
  if (!result.rowCount) return res.status(404).json({ error: 'Usuário de empresa não encontrado' });
  await audit(req.session!.sub, 'user.updated', 'user', req.params.id, { active: result.rows[0].active, companyId: result.rows[0].company_id });
  return res.json({ user: result.rows[0] });
}));

app.post('/api/v1/admin/users', auth, admin, asyncRoute(async (req, res) => {
  const input = z.object({ email: z.string().email().max(254), password: z.string().min(12).max(256), companyId: z.string().uuid() }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Dados inválidos', details: input.error.flatten().fieldErrors });
  const company = await pool.query('SELECT id FROM companies WHERE id=$1 AND active=true', [input.data.companyId]);
  if (!company.rowCount) return res.status(404).json({ error: 'Empresa não encontrada' });
  try {
    const result = await pool.query("INSERT INTO users(email,password_hash,role,company_id) VALUES($1,$2,'company',$3) RETURNING id,email,role,company_id,active", [input.data.email, hashPassword(input.data.password), input.data.companyId]);
    await audit(req.session!.sub, 'user.created', 'user', result.rows[0].id, { role: 'company', companyId: input.data.companyId });
    return res.status(201).json({ user: result.rows[0] });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado' });
    throw error;
  }
}));

app.post('/api/v1/admin/slots', auth, admin, asyncRoute(async (req, res) => {
  const input = z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime(), capacity: z.number().int().positive(), blocked: z.boolean().optional() }).safeParse(req.body);
  if (!input.success || (input.success && Date.parse(input.data.endsAt) <= Date.parse(input.data.startsAt))) return res.status(400).json({ error: 'Intervalo e capacidade inválidos' });
  try {
    const slot = await pool.query('INSERT INTO schedule_slots(starts_at,ends_at,capacity,blocked) VALUES($1,$2,$3,$4) RETURNING *', [input.data.startsAt, input.data.endsAt, input.data.capacity, input.data.blocked ?? false]);
    await audit(req.session!.sub, 'schedule.slot.created', 'schedule_slot', slot.rows[0].id, { capacity: slot.rows[0].capacity, blocked: slot.rows[0].blocked });
    return res.status(201).json({ slot: slot.rows[0] });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Já existe uma faixa com esse intervalo' });
    throw error;
  }
}));

app.patch('/api/v1/admin/slots/:id', auth, admin, asyncRoute(async (req, res) => {
  const input = z.object({ capacity: z.number().int().positive().optional(), blocked: z.boolean().optional() }).refine(value => value.capacity !== undefined || value.blocked !== undefined).safeParse(req.body);
  if (!input.success || !z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Dados inválidos' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT id,capacity,blocked FROM schedule_slots WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Faixa não encontrada' }); }
    const occupied = await client.query("SELECT count(*)::int AS count FROM bookings WHERE slot_id=$1 AND status='confirmed'", [req.params.id]);
    if (input.data.capacity !== undefined && input.data.capacity < occupied.rows[0].count) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Capacidade abaixo das reservas existentes' }); }
    const updated = await client.query('UPDATE schedule_slots SET capacity=COALESCE($2,capacity),blocked=COALESCE($3,blocked) WHERE id=$1 RETURNING *', [req.params.id, input.data.capacity ?? null, input.data.blocked ?? null]);
    await audit(req.session!.sub, 'schedule.slot.updated', 'schedule_slot', req.params.id, { capacity: updated.rows[0].capacity, blocked: updated.rows[0].blocked }, client);
    await client.query('COMMIT'); return res.json({ slot: updated.rows[0] });
  } catch (error: unknown) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.post('/api/v1/company/trucks', auth, asyncRoute(async (req, res) => {
  if (req.session?.role !== 'company' || !req.session.companyId) return res.status(403).json({ error: 'Permissão insuficiente' });
  const input = z.object({ plate: z.string().trim().transform(value => value.toUpperCase().replace(/[^A-Z0-9]/g, '')).refine(value => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value), 'Placa inválida'), vehicleType: z.string().max(80).optional() }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Dados inválidos', details: input.error.flatten().fieldErrors });
  try {
    const result = await pool.query('INSERT INTO trucks(company_id,plate,vehicle_type) VALUES($1,$2,$3) RETURNING id,plate,vehicle_type', [req.session.companyId, input.data.plate, input.data.vehicleType ?? null]);
    return res.status(201).json({ truck: result.rows[0] });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') return res.status(409).json({ error: 'Placa já cadastrada nesta empresa' });
    throw error;
  }
}));

app.post('/api/v1/company/drivers', auth, asyncRoute(async (req, res) => {
  if (req.session?.role !== 'company' || !req.session.companyId) return res.status(403).json({ error: 'Permissão insuficiente' });
  const input = z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().min(8).max(32) }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Dados inválidos' });
  const result = await pool.query('INSERT INTO drivers(company_id,name,phone) VALUES($1,$2,$3) RETURNING id,name,phone', [req.session.companyId, input.data.name, input.data.phone]);
  return res.status(201).json({ driver: result.rows[0] });
}));

const webDist = path.join(process.cwd(), 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, etag: true, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(webDist, 'index.html'));
  });
}
app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede o tamanho máximo permitido' : 'Upload inválido' });
  const databaseError = error as { code?: string; constraint?: string };
  console.error('API request failed', { message: error instanceof Error ? error.message : 'unknown error', code: databaseError.code, constraint: databaseError.constraint });
  if (process.env.NODE_ENV === 'development') console.error(error instanceof Error ? error.stack : error);
  return res.status(500).json({ error: 'Erro interno' });
});
export default app;
