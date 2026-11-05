import { test, expect, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { pool } from '../src/db';
import { hashPassword } from '../src/security';
import fs from 'node:fs/promises';
import path from 'node:path';

const suffix = randomBytes(5).toString('hex');
const adminEmail = `e2e-admin-${suffix}@example.test`;
const adminPassword = `Synthetic-${randomBytes(16).toString('hex')}`;
const companyEmail = `e2e-company-${suffix}@example.test`;
const companyPassword = `Synthetic-${randomBytes(16).toString('hex')}`;
const companyName = `Synthetic E2E company ${suffix}`;
let adminId = '';
let scheduleDate = '';
const privateData = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'private_data'));
function makeValidPdf(): Buffer {
  let document = '%PDF-1.4\n';
  const objects = ['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n'];
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(document, 'latin1')); document += object; }
  const xrefOffset = Buffer.byteLength(document, 'latin1');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'latin1');
}

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.beforeAll(async () => {
  const today = DateTime.now().setZone('America/Sao_Paulo').toISODate()!;
  const lastUse = await pool.query(`SELECT greatest(
    coalesce((SELECT max(s.starts_at AT TIME ZONE $1)::date FROM bookings b JOIN schedule_slots s ON s.id=b.slot_id WHERE b.status='confirmed'), $2::date),
    coalesce((SELECT max(effective_from) FROM schedule_configs), $2::date)
  )::text AS last_date`, ['America/Sao_Paulo', today]);
  scheduleDate = DateTime.fromISO(lastUse.rows[0].last_date, { zone: 'America/Sao_Paulo' }).plus({ days: 1 }).toISODate()!;
  const admin = await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id", [adminEmail, hashPassword(adminPassword)]);
  adminId = admin.rows[0].id;
});

test.afterAll(async () => {
  const companyUser = await pool.query('SELECT id,company_id FROM users WHERE lower(email)=lower($1)', [companyEmail]);
  const companyId = companyUser.rows[0]?.company_id as string | undefined;
  if (companyId) {
    const bookings = await pool.query('SELECT id FROM bookings WHERE company_id=$1', [companyId]);
    const bookingIds = bookings.rows.map((row: { id: string }) => row.id);
    if (bookingIds.length) {
      const docs = await pool.query('SELECT id,storage_key FROM booking_documents WHERE booking_id=ANY($1::uuid[])', [bookingIds]);
      for (const doc of docs.rows as Array<{ id: string; storage_key: string }>) await fs.rm(path.join(privateData, doc.storage_key), { force: true });
      if (docs.rowCount) await pool.query('DELETE FROM document_audit_events WHERE document_id=ANY($1::uuid[])', [docs.rows.map((row: { id: string }) => row.id)]);
      await pool.query('DELETE FROM booking_documents WHERE booking_id=ANY($1::uuid[])', [bookingIds]);
      await pool.query('DELETE FROM booking_history WHERE booking_id=ANY($1::uuid[])', [bookingIds]);
      await pool.query('DELETE FROM bookings WHERE id=ANY($1::uuid[])', [bookingIds]);
    }
    await pool.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [[adminId, ...companyUser.rows.map((row: { id: string }) => row.id)].filter(Boolean)]);
    await pool.query('DELETE FROM trucks WHERE company_id=$1', [companyId]);
    await pool.query('DELETE FROM drivers WHERE company_id=$1', [companyId]);
    await pool.query('DELETE FROM users WHERE company_id=$1', [companyId]);
    await pool.query('DELETE FROM companies WHERE id=$1', [companyId]);
  }
  if (adminId) {
    const configs = await pool.query('SELECT id FROM schedule_configs WHERE created_by=$1', [adminId]);
    const ids = configs.rows.map((row: { id: string }) => row.id);
    if (ids.length) {
      await pool.query('DELETE FROM schedule_exceptions WHERE config_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM schedule_slots WHERE config_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM schedule_configs WHERE id=ANY($1::uuid[])', [ids]);
    }
    await pool.query('DELETE FROM audit_events WHERE actor_id=$1', [adminId]);
    await pool.query('DELETE FROM users WHERE id=$1', [adminId]);
  }
  await pool.end();
});

test('admin configures the calendar and a company books, reschedules, downloads and cancels', async ({ page }) => {
  const bookingDay = DateTime.fromISO(scheduleDate, { zone: 'America/Sao_Paulo' });
  const browserErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await login(page, adminEmail, adminPassword);
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const navigateAdmin = async (label: string) => {
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.locator('.admin-sidebar').getByRole('button', { name: label, exact: true }).click();
  };
  await navigateAdmin('Configurações da agenda');
  await expect(page.getByRole('heading', { name: 'Configuração da agenda' })).toBeVisible();

  await page.getByLabel('Fuso horário IANA').fill('America/Sao_Paulo');
  await page.getByLabel('Início da vigência').fill(scheduleDate);
  await page.getByLabel('Fim da vigência').fill(scheduleDate);
  const rule = page.locator('form.rule-form').first();
  await rule.getByLabel('Dia').selectOption(String(bookingDay.weekday));
  await rule.getByLabel('Abre').fill('10:00');
  await rule.getByLabel('Fecha').fill('11:00');
  await rule.getByLabel('Duração (min)').fill('30');
  await rule.getByLabel('Capacidade').fill('1');
  await rule.getByRole('button', { name: 'Adicionar faixa' }).click();
  await rule.getByLabel('Dia').selectOption(String(bookingDay.weekday));
  await rule.getByLabel('Abre').fill('11:00');
  await rule.getByLabel('Fecha').fill('12:00');
  await rule.getByLabel('Duração (min)').fill('30');
  await rule.getByLabel('Capacidade').fill('1');
  await rule.getByRole('button', { name: 'Adicionar faixa' }).click();
  await page.getByRole('button', { name: 'Publicar configuração' }).click();
  await expect(page.getByRole('status')).toContainText('Configuração de calendário publicada');

  await navigateAdmin('Bloqueios e Exceções');
  await expect(page.getByRole('heading', { name: 'Bloqueios e exceções' })).toBeVisible();
  await navigateAdmin('Agendamentos');
  await expect(page.getByRole('heading', { name: 'Agendamentos', exact: true })).toBeVisible();
  await navigateAdmin('Notas Fiscais');
  await expect(page.getByRole('heading', { name: 'Upload de nota fiscal' })).toBeVisible();
  await navigateAdmin('Auditoria');
  await expect(page.getByRole('heading', { name: 'Auditoria', exact: true })).toBeVisible();
  await navigateAdmin('Empresas e Usuários');
  const companyForm = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Cadastrar empresa' }) }).locator('form');
  await companyForm.getByLabel('Nome da empresa').fill(companyName);
  await companyForm.getByLabel('E-mail do usuário (opcional)').fill(companyEmail);
  await companyForm.locator('input[name="password"]').fill(companyPassword);
  await companyForm.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByRole('status')).toContainText('Empresa cadastrada');
  await page.getByRole('button', { name: 'Sair' }).click();

  await login(page, companyEmail, companyPassword);
  await expect(page.getByRole('button', { name: 'Novo agendamento' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Cadastro', exact: true }).click();
  const plate = `EET${Math.floor(Math.random() * 10)}A23`;
  const truckForm = page.locator('.two-col .panel').first().locator('form');
  await truckForm.getByLabel('Placa').fill(plate);
  await truckForm.getByLabel('Tipo de veículo (opcional)').fill('Carreta teste');
  await truckForm.getByRole('button', { name: 'Cadastrar' }).click();
  const driverForm = page.locator('.two-col .panel').nth(1).locator('form');
  await driverForm.getByLabel('Nome').fill('Motorista E2E sintético');
  await driverForm.getByLabel('Telefone').fill('11999990001');
  await driverForm.getByRole('button', { name: 'Cadastrar' }).click();

  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Agendamento', exact: true }).click();
  await page.getByLabel('De', { exact: true }).fill(scheduleDate);
  await page.getByLabel('Até', { exact: true }).fill(scheduleDate);
  await page.getByRole('button', { name: 'Consultar horários' }).click();
  await expect(page.locator('.slot-card.status-available').first()).toBeVisible();
  await page.locator('.slot-card.status-available').first().click();
  await page.getByLabel('Caminhão').selectOption({ label: plate });
  await page.getByLabel('Motorista').selectOption({ label: 'Motorista E2E sintético' });
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await page.getByLabel('Número da nota fiscal').fill('E2E-SYNTHETIC-01');
  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await page.getByLabel('Arquivo XML').setInputFiles({ name: 'synthetic-invoice.xml', mimeType: 'application/xml', buffer: Buffer.from('<?xml version="1.0"?><Invoice><Number>SYNTHETIC-E2E</Number></Invoice>') });
  await page.getByLabel('Arquivo PDF').setInputFiles({ name: 'synthetic-invoice.pdf', mimeType: 'application/pdf', buffer: makeValidPdf() });
  await expect(page.locator('[data-booking-stage="4"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar agendamento' })).toBeVisible();
  const bookingResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/bookings') && response.request().method() === 'POST');
  await page.locator('.booking-stage-actions button[formnovalidate]').click();
  const booked = await bookingResponse;
  expect(booked.status(), await booked.text()).toBe(201);
  await expect(page.locator('.alert-success')).toContainText('Protocolo SAD-');

  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Meus agendamentos' }).click();
  await expect(page.getByRole('heading', { name: 'Calendário de Disponibilidade' })).toBeVisible();
  const targetMonth = DateTime.fromISO(scheduleDate, { zone: 'America/Sao_Paulo' }).startOf('month');
  let visibleMonth = DateTime.now().setZone('America/Sao_Paulo').startOf('month');
  while (visibleMonth < targetMonth) { await page.getByRole('button', { name: 'Próximo mês' }).click(); visibleMonth = visibleMonth.plus({ months: 1 }); }
  while (visibleMonth > targetMonth) { await page.getByRole('button', { name: 'Mês anterior' }).click(); visibleMonth = visibleMonth.minus({ months: 1 }); }
  await page.getByRole('gridcell', { name: new RegExp(`^${scheduleDate}:`) }).click();
  await expect(page.locator('.calendar-bookings')).toContainText(/SAD-\d{4}-/);
  await page.getByRole('button', { name: 'Detalhes' }).click();
  await expect(page.locator('.document-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(page.getByText(/SAD-\d{4}-/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reagendar' }).click();
  const rebooking = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Escolher novo horário' }) });
  await rebooking.getByLabel('De', { exact: true }).fill(scheduleDate);
  await rebooking.getByLabel('Até', { exact: true }).fill(scheduleDate);
  const rescheduleAvailability = page.waitForResponse(response => response.url().includes('/api/v1/availability?') && response.request().method() === 'GET');
  await rebooking.getByRole('button', { name: 'Consultar' }).click();
  const slots = await (await rescheduleAvailability).json() as { configured: boolean; slots: Array<{ id: string; status: string; startsAt: string; capacity: number; occupied: number }> };
  expect(slots.slots.some(slot => slot.status === 'available' || slot.status === 'partial'), JSON.stringify(slots)).toBe(true);
  await rebooking.locator('.slot-card').first().click();
  await rebooking.getByRole('button', { name: 'Confirmar reagendamento' }).click();
  await expect(page.getByRole('status')).toContainText('Agendamento reagendado');

  const xmlDocument = page.locator('.document-row').filter({ hasText: 'synthetic-invoice.xml' });
  const downloadEvent = page.waitForEvent('download');
  await xmlDocument.getByRole('button', { name: 'Baixar' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.xml$/);

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Cancelado').first()).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Notas fiscais', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notas fiscais', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Enviar documentos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upload de nota fiscal' })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
