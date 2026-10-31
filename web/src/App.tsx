import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AdminLayout } from './admin/layouts/AdminLayout';
import { SADIcon } from './components/SADIcon';

type User = { id: string; email: string; role: 'admin' | 'company' };
type Slot = { id: string; startsAt: string; endsAt: string; timezone: string | null; localDate?: string; capacity: number; occupied: number; remaining?: number; status: string };
type CalendarBooking = { id: string; protocol: string; status: string; startsAt: string; timezone: string; plate: string; driverName: string; companyName?: string };
type CalendarDay = { date: string; timezone: string | null; configured: boolean; blocked: boolean; capacity: number; occupied: number; remaining: number; bookingCount: number; status: 'no-schedule' | 'no-service' | 'closed' | 'available' | 'partial' | 'full'; slots: Slot[]; bookings: CalendarBooking[] };
type Availability = { configured: boolean; slots: Slot[]; days: CalendarDay[] };
type Company = { id: string; name: string; active: boolean };
type CompanyProfile = { id: string; name: string; active: boolean };
type AdminDashboardData = {
  metrics: { bookings_today: number; available_slots_today: number; trucks_total: number; drivers_total: number };
  nextBookings: Array<{ id: string; protocol: string; status: string; starts_at: string; timezone: string | null; plate: string; driver_name: string; company_name: string }>;
};
type DocumentMeta = { id: string; media_type: string; original_name?: string; byte_size?: number; created_at?: string };
type Booking = {
  id: string;
  protocol: string;
  status: string;
  weight?: string | null;
  weight_unit?: string | null;
  invoice_number: string;
  invoice_series?: string | null;
  invoice_key?: string | null;
  notes?: string | null;
  created_at?: string;
  starts_at: string;
  ends_at: string;
  plate: string;
  driver_name: string;
  company_name?: string;
  documents?: DocumentMeta[];
};
type BookingDetailsData = {
  booking: {
    id: string;
    protocol: string;
    status: string;
    weight?: string | null;
    weight_unit?: string | null;
    invoice_number: string;
    invoice_series?: string | null;
    invoice_key?: string | null;
    notes?: string | null;
    created_at: string;
    starts_at: string;
    ends_at: string;
    plate: string;
    driver_name: string;
    company_name?: string;
  };
  history: Array<{ action: string; details?: Record<string, unknown> | null; created_at: string }>;
  documents: DocumentMeta[];
};
type WindowRule = { start: string; end: string; durationMinutes: number; capacity: number };
type DayWindow = WindowRule & { weekday: number };

let bearer = '';
async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) { bearer = ''; window.dispatchEvent(new Event('sad-session-expired')); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = body.details && typeof body.details === 'object'
      ? Object.entries(body.details as Record<string, unknown>).flatMap(([field, messages]) => Array.isArray(messages) ? messages.map(message => `${field}: ${String(message)}`) : []).join('; ')
      : '';
    throw new Error([body.error ?? `Falha HTTP ${response.status}`, details].filter(Boolean).join(' — '));
  }
  return body as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateInZone = (date: Date, timezone?: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`;
};
const formatFileSize = (size: number) => size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(2)} MB`;
const fmt = (instant: string, timezone?: string | null) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(instant));
const bookingStatusLabel = (status: string) => status === 'confirmed' ? 'Confirmado' : status === 'cancelled' ? 'Cancelado' : status === 'pending' ? 'Pendente' : status;
const hasFiscalDocument = (booking: { documents?: DocumentMeta[] }, type: 'xml' | 'pdf') => booking.documents?.some(document => type === 'pdf'
  ? document.media_type === 'application/pdf' || document.original_name?.toLowerCase().endsWith('.pdf')
  : document.media_type.includes('xml') || document.original_name?.toLowerCase().endsWith('.xml')) ?? false;
const weekdayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

// Função utilitária para baixar XML e DANFE (PDF) de cada agendamento
async function downloadBookingDocument(booking: { id: string; protocol: string; invoice_number: string; invoice_series?: string | null; invoice_key?: string | null; starts_at: string; ends_at: string; plate: string; driver_name: string; weight?: string | null; weight_unit?: string | null; company_name?: string; notes?: string | null; created_at?: string; documents?: DocumentMeta[]; status?: string }, type: 'xml' | 'pdf', viewInNewTab = false) {
  const doc = booking.documents?.find(d =>
    type === 'pdf'
      ? (d.media_type === 'application/pdf' || d.original_name?.toLowerCase().endsWith('.pdf'))
      : (d.media_type.includes('xml') || d.original_name?.toLowerCase().endsWith('.xml'))
  );

  if (doc) {
    if (viewInNewTab && type === 'pdf') {
      const popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
      try {
        const res = await fetch(`/api/v1/documents/${doc.id}/download`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
        if (!res.ok) throw new Error('Não foi possível carregar o PDF.');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (popup) popup.location.replace(url);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      } catch (e) {
        popup?.close();
        window.alert((e as Error).message);
        return;
      }
    }

    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/download`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.original_name || `NF_${booking.invoice_number || booking.protocol}.${type}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
    } catch {
      // Fallback
    }
  }

  // Tenta endpoint do backend
  try {
    const res = await fetch(`/api/v1/bookings/${booking.id}/documents/download/${type}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (viewInNewTab && type === 'pdf') {
        const popup = window.open(url, '_blank');
        if (popup) popup.opener = null;
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `NF_${booking.invoice_number || booking.protocol}_${booking.protocol}.${type === 'xml' ? 'xml' : 'txt'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
  } catch {
    // Fallback
  }

  window.alert(`Não foi possível obter o documento ${type.toUpperCase()}. Confirme se ele está anexado e tente novamente.`);
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const register = async (companyName: string, email: string, password: string) => {
    try {
      await api('/api/v1/auth/register', json({ companyName, email, password }));
      setError('');
      await login(email, password);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    const expired = () => { setUser(null); setError('Sua sessão expirou. Entre novamente.'); };
    window.addEventListener('sad-session-expired', expired);
    return () => window.removeEventListener('sad-session-expired', expired);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const result = await api<{ accessToken: string; user: User }>('/api/v1/auth/login', json({ email, password }));
      bearer = result.accessToken;
      setUser(result.user);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const signOut = () => { bearer = ''; setUser(null); setSection('home'); };

  // Menu completo para Admin e para Empresa com navegação idêntica à funcionalidade original
  const navigation: Array<[string, string, string]> = user?.role === 'admin'
    ? [
        ['home', 'Início', 'home'],
        ['bookings', 'Agendamentos', 'bookings'],
        ['agenda', 'Configurações da agenda', 'agenda'],
        ['exceptions', 'Bloqueios e Exceções', 'exceptions'],
        ['companies', 'Empresas e Usuários', 'companies'],
        ['upload', 'Notas Fiscais', 'upload'],
        ['audit', 'Auditoria', 'audit']
      ]
    : [
        ['home', 'Início', 'home'],
        ['agenda', 'Agendamento', 'agenda'],
        ['cadastro', 'Cadastro', 'cadastro'],
        ['bookings', 'Meus agendamentos', 'bookings'],
        ['invoices', 'Notas fiscais', 'invoices'],
        ['upload', 'Enviar documentos', 'upload']
      ];

  if (!user) return <Login onLogin={login} onRegister={register} error={error} />;

  if (user.role === 'admin') {
    return (
      <AdminLayout email={user.email} section={section} navigation={navigation} collapsed={sidebarCollapsed} mobileMenuOpen={mobileMenuOpen}
        onNavigate={next => { setSection(next); setMobileMenuOpen(false); }}
        onToggleCollapsed={() => setSidebarCollapsed(value => !value)}
        onToggleMobileMenu={() => setMobileMenuOpen(open => !open)}
        onSignOut={signOut}>
        {error && <div className="alert alert-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar">×</button></div>}
        {notice && <div className="alert alert-success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar">×</button></div>}
        <Admin section={section} onNavigate={setSection} onError={setError} onNotice={setNotice} />
      </AdminLayout>
    );
  }

  return (
    <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      {/* Topbar Revest Amarela */}
      <header className="topbar">
        <a className="brand revest-brand" href="#inicio" onClick={e => { e.preventDefault(); setSection('home'); }}>
          <span className="revest-wordmark">
            <span>REVEST</span>
            <small>ACABAMENTOS</small>
          </span>
        </a>
        <span className="system-name">SAD <span>— Agendamento de Descarga</span></span>

        <div className="account">
          <button className="menu-toggle mobile-menu-toggle" onClick={() => setMobileMenuOpen(open => !open)} aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={mobileMenuOpen}>
            <span /><span /><span />
          </button>
          <span className="account-avatar" aria-hidden="true">{user.email.slice(0, 1).toUpperCase()}</span>
          <div className="account-text">
            <strong>{user.email.includes('@') ? user.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Admin Teste Local'}</strong>
            <small>Acesso da empresa</small>
          </div>
          <button className="button button-quiet sign-out" onClick={signOut} title="Sair da conta" aria-label="Sair da conta">Sair</button>
        </div>
      </header>

      <div className="layout">
        {/* Sidebar Grafite Revest */}
        <aside className="sidebar" aria-label="Navegação principal">
          <button className="sidebar-collapse" onClick={() => setSidebarCollapsed(value => !value)} aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'} title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}>⇔</button>
          <div className="sidebar-navigation">
            <p className="nav-label">MENU PRINCIPAL</p>
            {navigation.map(([key, label, icon]) => (
              <button key={key} className={`nav-item ${section === key ? 'active' : ''}`} aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setMobileMenuOpen(false); }}>
                <span className="nav-icon"><SADIcon name={icon} /></span>
                <span className="nav-label-text">{label}</span>
              </button>
            ))}
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-product">
              <span className="product-icon">S</span>
              <div>
                <strong>SAD</strong>
                <small>Sistema de Agendamento<br />de Descarga</small>
              </div>
            </div>
            <div className="support-block"><span className="support-header">SUPORTE</span><small>Fale com o administrador</small></div>
            <small className="version-label">Versão 1.0.0</small>
          </div>
        </aside>

        {/* Conteúdo Principal */}
        <button className="mobile-menu-backdrop" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} />
        <nav className="mobile-bottom-nav" aria-label="Navegação rápida">
          {navigation.slice(0, 4).map(([key, label, icon]) => <button key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setMobileMenuOpen(false); }}><span><SADIcon name={icon} /></span><small>{key === 'home' ? 'Início' : key === 'agenda' ? 'Agendamento' : key === 'cadastro' ? 'Cadastro' : key === 'trucks' ? 'Frota' : key === 'exceptions' ? 'Bloqueios' : label}</small></button>)}
        </nav>
        <main className="content">
          {error && <div className="alert alert-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar">×</button></div>}
          {notice && <div className="alert alert-success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar">×</button></div>}

          <CompanyPortal section={section} onNavigate={setSection} onError={setError} onNotice={setNotice} />
        </main>
      </div>
    </div>
  );
}

// Tela de Login com caminhão e visual Revest
function Login({ onLogin, onRegister, error }: { onLogin: (email: string, password: string) => void; onRegister: (companyName: string, email: string, password: string) => Promise<void>; error: string }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email'));
    const password = String(data.get('password'));
    if (mode === 'login') { onLogin(email, password); return; }
    setSubmitting(true);
    void onRegister(String(data.get('companyName')), email, password).finally(() => setSubmitting(false));
  };

  return (
    <main className="login-screen">
      <section className="login-showcase">
        <div className="login-brand-large">
          <span className="revest-wordmark">
            <span>REVEST</span>
            <small>ACABAMENTOS</small>
          </span>
        </div>
        <div className="login-copy">
          <span className="badge-tag">LOGÍSTICA COM EFICIÊNCIA</span>
          <h1>Agendamentos simples.<br />Operação organizada.</h1>
          <p>Gerencie suas descargas em um só lugar.</p>
        </div>
        <svg className="login-truck-art" viewBox="0 0 520 250" fill="none" aria-hidden="true">
          <path d="M42 183h268V67H42z" fill="#ffd900" />
          <path d="M310 112h92l67 70v1H310z" fill="#e9b900" />
          <path d="M334 128h56l42 43H334z" fill="#182630" />
          <path d="M69 87h201v78H69z" fill="#101820" />
          <path d="M86 104h166M86 121h166M86 138h166" stroke="#ffd900" strokeWidth="4" opacity=".8" />
          <path d="M31 184h449" stroke="#d8e0e8" strokeWidth="8" strokeLinecap="round" />
          <circle cx="117" cy="190" r="31" fill="#0b1117" stroke="#dce3e9" strokeWidth="7" />
          <circle cx="117" cy="190" r="10" fill="#ffd900" />
          <circle cx="386" cy="190" r="31" fill="#0b1117" stroke="#dce3e9" strokeWidth="7" />
          <circle cx="386" cy="190" r="10" fill="#ffd900" />
          <path d="M20 219h480" stroke="#ffd900" strokeWidth="3" strokeDasharray="20 16" opacity=".6" />
        </svg>
      </section>

      <section className="login-card-wrapper">
        <div className="card-screen login-card">
          <a className="brand login-brand">
            <span className="brand-mark">S</span>
            <span>SAD <b>Logística</b></span>
          </a>
          <p className="eyebrow">PORTAL DE AGENDAMENTO</p>
          <h1>{mode === 'login' ? 'Entre na sua conta' : 'Crie seu acesso'}</h1>
          <p className="muted">Acesse para consultar horários e organizar suas descargas.</p>
          <form onSubmit={submit} className="form-stack">
            {mode === 'register' && <label><span>Nome da empresa</span><input name="companyName" type="text" autoComplete="organization" minLength={2} maxLength={200} placeholder="Sua empresa" required /></label>}
            <label>
              <span>E-mail</span>
              <input name="email" type="email" placeholder="contato@empresa.com" autoComplete="username" maxLength={254} required />
            </label>
            <label>
              <span>Senha</span>
              <input name="password" type="password" placeholder="Mínimo de 12 caracteres" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 12 : undefined} maxLength={256} required />
            </label>
            {mode === 'login' && <div className="login-row-options">
              <label className="checkbox-label"><input type="checkbox" name="remember" defaultChecked /> Lembrar-me</label>
              <a href="#recuperar" onClick={e => { e.preventDefault(); alert('Contate o suporte ou o administrador da empresa.'); }} className="text-link-subtle">Esqueceu a senha?</a>
            </div>}
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <button className="button button-primary button-full" disabled={submitting}>{submitting ? 'Criando cadastro…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
          </form>
          <p className="login-help">{mode === 'login' ? 'Ainda não tem acesso? ' : 'Já tem uma conta? '}<button className="login-mode-toggle" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Cadastre sua empresa' : 'Entrar'}</button></p>
        </div>
      </section>
    </main>
  );
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel card-screen ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

function MetricCard({ icon, label, value, note }: { icon: string; label: string; value: string; note: string }) {
  return (
    <div className="metric-card">
      <span className="metric-icon yellow-box"><SADIcon name={icon} size={20} /></span>
      <div className="metric-data">
        <p className="metric-label">{label}</p>
        <strong className="metric-value">{value}</strong>
        <small className="metric-subtext">{note}</small>
      </div>
    </div>
  );
}

function useLoad<T>(url: string, refresh: number, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setData(await api<T>(url)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [url]);
  useEffect(() => { void load(); }, [load, refresh]);
  return { data, busy, error, reload: load };
}

// Portal da Empresa com todas as funções originais
function CompanyPortal({ section, onNavigate, onError, onNotice }: { section: string; onNavigate: (section: string) => void; onError: (v: string) => void; onNotice: (v: string) => void }) {
  const [refresh, setRefresh] = useState(0);
  const [agendaMonth, setAgendaMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [from, setFrom] = useState(dateValue(new Date()));
  const [to, setTo] = useState(dateValue(new Date(Date.now() + 6 * 86400000)));
  const [selectedDate, setSelectedDate] = useState(dateValue(new Date()));
  const [slotsData, setSlotsData] = useState<Availability>({ configured: false, slots: [], days: [] });
  const [selected, setSelected] = useState('');
  const [fleetRefresh, setFleetRefresh] = useState(0);
  const [trucks, setTrucks] = useState<Array<{ id: string; plate: string }>>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [details, setDetails] = useState<BookingDetailsData | null>(null);
  const [reschedulingId, setReschedulingId] = useState('');
  const [bookingView, setBookingView] = useState<'calendar' | 'list'>('calendar');
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState('');
  const [bookingFromFilter, setBookingFromFilter] = useState('');
  const [bookingToFilter, setBookingToFilter] = useState('');
  const [bookingPage, setBookingPage] = useState(1);
  const [bookingStep, setBookingStep] = useState(2);
  const [bookingReview, setBookingReview] = useState<Record<string, string>>({});
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [xmlUploadState, setXmlUploadState] = useState('');
  const [pdfUploadState, setPdfUploadState] = useState('');
  const [pendingUpload, setPendingUpload] = useState<{ id: string; protocol: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const bookingForm = useRef<HTMLFormElement>(null);
  const xmlInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const loadSlots = async (start = from, end = to) => {
    try {
      const availability = await api<Availability>(`/api/v1/availability?from=${start}&to=${end}`);
      setSlotsData(availability);
      setSelected(current => availability.slots.some(slot => slot.id === current && (slot.status === 'available' || slot.status === 'partial')) ? current : '');
      const selectedHasFutureSlots = availability.days
        .find(day => day.date === selectedDate)?.slots
        .some(slot => slot.status !== 'blocked' && slot.status !== 'full' && new Date(slot.startsAt).getTime() > Date.now());
      if (!selectedHasFutureSlots) {
        const nextAvailableDay = availability.days.find(day => day.remaining > 0 && day.slots.some(slot =>
          slot.status !== 'blocked' && slot.status !== 'full' && new Date(slot.startsAt).getTime() > Date.now()));
        if (nextAvailableDay) {
          setSelectedDate(nextAvailableDay.date);
          const [year, month] = nextAvailableDay.date.split('-').map(Number);
          setAgendaMonth(current => current.getFullYear() === year && current.getMonth() === month - 1
            ? current
            : new Date(year, month - 1, 1));
        }
      }
    } catch (e) { onError((e as Error).message); }
  };
  const loadFleet = async () => { try { const [t, d, p] = await Promise.all([api<{ trucks: typeof trucks }>('/api/v1/company/trucks'), api<{ drivers: typeof drivers }>('/api/v1/company/drivers'), api<{ company: CompanyProfile }>('/api/v1/company/profile')]); setTrucks(t.trucks); setDrivers(d.drivers); setCompanyProfile(p.company); } catch (e) { onError((e as Error).message); } };
  const loadBookings = async () => { try { setBookings((await api<{ bookings: Booking[] }>('/api/v1/bookings?pageSize=100')).bookings); } catch (e) { onError((e as Error).message); } };

  useEffect(() => {
    if (section === 'agenda') {
      const start = dateValue(agendaMonth);
      const end = dateValue(new Date(agendaMonth.getFullYear(), agendaMonth.getMonth() + 1, 0));
      void loadSlots(start, end);
      void loadFleet();
    }
    if (['bookings', 'invoices', 'upload'].includes(section)) void loadBookings();
    if (['cadastro', 'fleet', 'trucks', 'drivers'].includes(section)) void loadFleet();
    if (section === 'home') {
      void loadBookings();
      void loadFleet();
    }
  }, [section, refresh, fleetRefresh, agendaMonth]);

  const finishBooking = (booking: { id: string; protocol: string }) => {
    bookingForm.current?.reset(); setBookingStep(2); setBookingReview({}); setXmlFile(null); setPdfFile(null); setXmlUploadState(''); setPdfUploadState(''); setPendingUpload(null); setIdempotencyKey(crypto.randomUUID()); setSelected(''); setRefresh(value => value + 1);
    onNotice(`Agendamento confirmado. Protocolo ${booking.protocol}`);
  };

  const uploadPendingDocuments = async (booking: { id: string; protocol: string }) => {
    const pending = [
      { label: 'XML', file: xmlFile, extension: '.xml', setFile: setXmlFile, setState: setXmlUploadState, input: xmlInput },
      { label: 'PDF', file: pdfFile, extension: '.pdf', setFile: setPdfFile, setState: setPdfUploadState, input: pdfInput },
    ].filter((item): item is typeof item & { file: File } => item.file !== null);
    if (pending.length === 0) { finishBooking(booking); return; }
    let failed = false;
    for (const item of pending) {
      if (!item.file.name.toLowerCase().endsWith(item.extension)) { item.setState(`Falha: selecione um arquivo ${item.extension.toUpperCase()}.`); failed = true; continue; }
      if (item.file.size === 0 || item.file.size > 10 * 1024 * 1024) { item.setState(item.file.size === 0 ? 'Falha: arquivo vazio.' : 'Falha: limite de 10 MiB excedido.'); failed = true; continue; }
      item.setState('Enviando…');
      const form = new FormData(); form.append('documentType', item.label.toLowerCase()); form.append('file', item.file);
      try {
        await api(`/api/v1/bookings/${booking.id}/documents`, { method: 'POST', body: form });
        item.setFile(null); if (item.input.current) item.input.current.value = ''; item.setState('Enviado com sucesso.');
      } catch (error) { item.setState(`Falha no envio: ${(error as Error).message}`); failed = true; }
    }
    if (failed) onError(`O agendamento ${booking.protocol} foi criado. Revise ou tente novamente os documentos que falharam; os demais campos foram mantidos.`);
    else finishBooking(booking);
  };

  const createBooking = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (busy) return; setBusy(true);
    try {
      let booking = pendingUpload;
      if (!booking) {
        const form = new FormData(e.currentTarget);
        const payload = { slotId: selected, truckId: String(form.get('truckId')), driverId: String(form.get('driverId')), invoiceNumber: String(form.get('invoiceNumber')), invoiceSeries: String(form.get('invoiceSeries')) || undefined, invoiceKey: String(form.get('invoiceKey')) || undefined, notes: String(form.get('notes')) || undefined };
        const created = await api<{ booking: { id: string; protocol: string } }>('/api/v1/bookings', { ...json(payload), headers: { 'Idempotency-Key': idempotencyKey } });
        booking = created.booking; setPendingUpload(booking);
      }
      await uploadPendingDocuments(booking);
    } catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  };

  const advanceBooking = (nextStep: number) => {
    if (nextStep > bookingStep) {
      const currentStage = bookingForm.current?.querySelector<HTMLElement>(`[data-booking-stage="${bookingStep}"]`);
      const fields = currentStage?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
      if (fields && !Array.from(fields).every(field => field.reportValidity())) return;
      if (nextStep === 4 && bookingForm.current) {
        const form = new FormData(bookingForm.current);
        setBookingReview(Object.fromEntries(['truckId', 'driverId', 'invoiceNumber', 'invoiceSeries', 'invoiceKey'].map(name => [name, String(form.get(name) ?? '')])));
      }
    }
    setBookingStep(nextStep);
  };

  const createTruck = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const formElement = e.currentTarget; const f = new FormData(formElement); try { await api('/api/v1/company/trucks', json({ plate: f.get('plate'), vehicleType: f.get('vehicleType') || undefined })); formElement.reset(); setFleetRefresh(v => v + 1); onNotice('Caminhão cadastrado.'); } catch (e) { onError((e as Error).message); } };
  const createDriver = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const formElement = e.currentTarget; const f = new FormData(formElement); try { await api('/api/v1/company/drivers', json({ name: f.get('name'), phone: f.get('phone') })); formElement.reset(); setFleetRefresh(v => v + 1); onNotice('Motorista cadastrado.'); } catch (e) { onError((e as Error).message); } };
  const cancel = async (id: string) => { if (!window.confirm('Deseja cancelar este agendamento?')) return; try { await api(`/api/v1/bookings/${id}/cancel`, { method: 'POST' }); onNotice('Agendamento cancelado.'); setRefresh(v => v + 1); } catch (e) { onError((e as Error).message); } };
  const showDetails = async (id: string) => { try { setDetails(await api(`/api/v1/bookings/${id}`)); } catch (e) { onError((e as Error).message); } };
  const reschedule = (id: string) => setReschedulingId(id);

  const agendaYear = agendaMonth.getFullYear();
  const agendaMonthIndex = agendaMonth.getMonth();
  const agendaOffset = (new Date(agendaYear, agendaMonthIndex, 1).getDay() + 6) % 7;
  const agendaCellCount = Math.ceil((agendaOffset + new Date(agendaYear, agendaMonthIndex + 1, 0).getDate()) / 7) * 7;
  const agendaGridStart = new Date(agendaYear, agendaMonthIndex, 1 - agendaOffset);
  const agendaDates = Array.from({ length: agendaCellCount }, (_, index) => new Date(agendaGridStart.getFullYear(), agendaGridStart.getMonth(), agendaGridStart.getDate() + index));
  const selectedCalendarDay = slotsData.days.find(day => day.date === selectedDate);
  const selectedDateSlots = selectedCalendarDay?.slots ?? slotsData.slots.filter(slot => slot.localDate === selectedDate);
  const filteredBookings = bookings.filter(booking => {
    const query = bookingSearch.trim().toLocaleLowerCase('pt-BR');
    const searchable = `${booking.protocol} ${booking.plate} ${booking.invoice_number}`.toLocaleLowerCase('pt-BR');
    const date = booking.starts_at.slice(0, 10);
    return (!query || searchable.includes(query)) && (!bookingStatusFilter || booking.status === bookingStatusFilter) && (!bookingFromFilter || date >= bookingFromFilter) && (!bookingToFilter || date <= bookingToFilter);
  });
  const bookingPageCount = Math.max(1, Math.ceil(filteredBookings.length / 5));
  const bookingSteps: Array<[string, number]> = [['Data e horário', 1], ['Veículo e motorista', 2], ['Nota fiscal', 3], ['Confirmação', 4]];

  return (
    <>
      {section === 'home' && (
        <div className="company-home">
          <PageTitle eyebrow="INÍCIO" title={companyProfile?.name ?? 'Sua empresa'} description="Consulte os dias disponíveis e acompanhe os dados da sua operação." action={<button className="button button-primary" onClick={() => onNavigate('agenda')}>Novo agendamento</button>} />
          <div className="company-overview">
            <Panel title="Dados da empresa" className="company-summary-card">
              <div className="company-summary-name"><span className="company-summary-icon">{(companyProfile?.name ?? 'E').slice(0, 1).toUpperCase()}</span><div><strong>{companyProfile?.name ?? 'Carregando empresa...'}</strong><small>{companyProfile?.active ? 'Cadastro ativo' : 'Situação da empresa'}</small></div></div>
              <div className="company-fleet-counts"><div><span>Caminhões</span><strong>{trucks.length}</strong></div><div><span>Motoristas</span><strong>{drivers.length}</strong></div></div>
              <button className="text-link" onClick={() => onNavigate('cadastro')}>Gerenciar cadastros →</button>
            </Panel>
            <Panel title="Agendamentos">
              <p className="muted">Confira as datas liberadas para descarga e consulte os horários disponíveis.</p>
              <button className="button button-primary" onClick={() => onNavigate('agenda')}>Ver horários e agendar</button>
            </Panel>
          </div>
          <div className="company-home-calendar"><AppointmentsCalendar refresh={refresh} onDetails={showDetails} /></div>
          {details && <BookingDetails detail={details} onClose={() => setDetails(null)} onDeleteDocument={async id => { await api(`/api/v1/bookings/${details.booking.id}/documents/${id}`, { method: 'DELETE' }); await showDetails(details.booking.id); onNotice('Documento removido e registrado na auditoria.'); }} />}
        </div>
      )}

      {section === 'agenda' && (
        <>
          <PageTitle eyebrow="PORTAL DA EMPRESA" title="Agendar descarga" description="Escolha uma data e um horário com capacidade disponível." />
          <Panel title="Disponibilidade">
            <div className="booking-calendar-toolbar">
              <strong>{new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(agendaMonth)}</strong>
              <div className="calendar-actions">
                <button className="button button-quiet" aria-label="Mês anterior" onClick={() => setAgendaMonth(new Date(agendaYear, agendaMonthIndex - 1, 1))}>‹</button>
                <button className="button button-secondary" onClick={() => { const today = new Date(); setAgendaMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(dateValue(today)); }}>Hoje</button>
                <button className="button button-quiet" aria-label="Próximo mês" onClick={() => setAgendaMonth(new Date(agendaYear, agendaMonthIndex + 1, 1))}>›</button>
              </div>
            </div>
            <div className="booking-calendar-grid" role="grid" aria-label="Calendário de agendamento">
              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label, index) => <span className="booking-calendar-weekday" role="columnheader" key={`${label}-${index}`}>{label}</span>)}
              {agendaDates.map(date => {
                const key = dateValue(date);
                const day = slotsData.days.find(item => item.date === key);
                const inMonth = date.getMonth() === agendaMonthIndex;
                const available = (day?.remaining ?? 0) > 0;
                return <button key={key} type="button" role="gridcell" aria-pressed={selectedDate === key} aria-label={`${key}${available ? `, ${day?.remaining} vagas` : ', sem horários disponíveis'}`} className={`booking-calendar-day ${inMonth ? '' : 'outside-month'} ${selectedDate === key ? 'selected' : ''} ${available ? 'has-availability' : ''}`} onClick={() => { if (!inMonth) setAgendaMonth(new Date(date.getFullYear(), date.getMonth(), 1)); setSelectedDate(key); setSelected(''); }}><span>{date.getDate()}</span>{available && <i aria-hidden="true" />}</button>;
              })}
            </div>
            <p className="muted small booking-calendar-hint">Dias com ponto têm horários disponíveis. Selecione uma data para ver as vagas.</p>
            <div className="inline-fields">
              <label>De<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
              <label>Até<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
              <button className="button button-secondary" onClick={() => void loadSlots()}>Consultar horários</button>
            </div>
            {!slotsData.configured && <div className="empty-state">A agenda ainda não está configurada para o período. Entre em contato com o administrador.</div>}
            {slotsData.configured && slotsData.slots.length === 0 && <div className="empty-state">Não há horários de atendimento neste período.</div>}
            <h3 className="selected-date-heading">Horários de {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date(`${selectedDate}T12:00:00`))}</h3>
            <div className="slot-grid">
              {selectedDateSlots.map(slot => (
                <button key={slot.id} disabled={slot.status === 'full' || slot.status === 'blocked'} className={`slot-card ${selected === slot.id ? 'chosen' : ''} status-${slot.status}`} onClick={() => { setSelected(slot.id); setBookingStep(2); }}>
                  <span className="slot-card-date">{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: slot.timezone ?? undefined }).format(new Date(slot.startsAt))}</span>
                  <b className="slot-card-time">{new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: slot.timezone ?? undefined }).format(new Date(slot.startsAt))}</b>
                  <span className="slot-card-capacity">{slot.status === 'blocked' ? 'Bloqueado' : slot.status === 'full' ? 'Lotado' : `${slot.remaining ?? slot.capacity - slot.occupied} vaga(s)`}</span>
                </button>
              ))}
            </div>
            {slotsData.configured && selectedDateSlots.length === 0 && (
              <div className="empty-state">
                {selectedCalendarDay?.blocked
                  ? 'Esta data está bloqueada para agendamentos.'
                  : selectedCalendarDay?.configured
                    ? 'Não há expediente configurado para esta data. Consulte o administrador da agenda.'
                    : 'A agenda ainda não está publicada para esta data.'}
              </div>
            )}
          </Panel>
          {selected && (
            <Panel title="Dados do agendamento">
              <ol className="booking-stepper" aria-label="Etapas do agendamento">
                {bookingSteps.map(([label, step]) => <li key={step} className={bookingStep === step ? 'current' : bookingStep > step ? 'complete' : ''}><button type="button" disabled={step > bookingStep || (Boolean(pendingUpload) && step < 4)} aria-current={bookingStep === step ? 'step' : undefined} onClick={() => advanceBooking(step)}><span>{bookingStep > step ? '✓' : step}</span>{label}</button></li>)}
              </ol>
              <form ref={bookingForm} className="form-grid" onSubmit={createBooking}>
                <fieldset className="wide booking-data booking-stage" data-booking-stage="2" hidden={bookingStep !== 2} disabled={Boolean(pendingUpload)}>
                  <legend>Veículo e motorista</legend>
                  <div className="form-grid">
                    <label>Caminhão<select name="truckId" required defaultValue=""><option value="" disabled>Selecione</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}</select></label>
                    <label>Motorista<select name="driverId" required defaultValue=""><option value="" disabled>Selecione</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                  </div>
                </fieldset>
                <fieldset className="wide booking-data booking-stage" data-booking-stage="3" hidden={bookingStep !== 3} disabled={Boolean(pendingUpload)}>
                  <legend>Carga e nota fiscal</legend>
                  <div className="form-grid">
                    <label>Número da nota fiscal<input name="invoiceNumber" required maxLength={64} /></label>
                    <label>Série<input name="invoiceSeries" maxLength={32} /></label>
                    <label className="wide">Chave de acesso<input name="invoiceKey" maxLength={64} /></label>
                    <label className="wide">Observações<textarea name="notes" maxLength={2000} rows={2} /></label>
                  </div>
                </fieldset>
                <section className="wide document-upload-section booking-stage" data-booking-stage="4" hidden={bookingStep !== 4}>
                  <h3>Revisão do agendamento</h3>
                  <dl className="booking-review-grid">
                    <div><dt>Data e horário</dt><dd>{selectedDate} · {fmt(selectedDateSlots.find(slot => slot.id === selected)?.startsAt ?? '')}</dd></div>
                    <div><dt>Veículo</dt><dd>{trucks.find(item => item.id === bookingReview.truckId)?.plate ?? '—'}</dd></div>
                    <div><dt>Motorista</dt><dd>{drivers.find(item => item.id === bookingReview.driverId)?.name ?? '—'}</dd></div>
                    <div><dt>Nota fiscal</dt><dd>{bookingReview.invoiceNumber || '—'}</dd></div>
                  </dl>
                  <h3>Documentos da nota fiscal</h3>
                  <p className="muted small">Envie até um XML e um PDF neste agendamento. Cada arquivo pode ter até 10 MiB. Os documentos são opcionais e ficam privados.</p>
                  <label>
                    Arquivo XML
                    <input ref={xmlInput} type="file" accept=".xml,application/xml,text/xml" onChange={e => { setXmlFile(e.currentTarget.files?.[0] ?? null); setXmlUploadState(''); }} />
                    <span className="file-meta" aria-live="polite">{xmlFile ? `${xmlFile.name} · ${formatFileSize(xmlFile.size)}` : 'Nenhum XML selecionado'}{xmlUploadState ? ` · ${xmlUploadState}` : ''}</span>
                    {xmlFile && <button className="danger-link file-remove" type="button" onClick={() => { setXmlFile(null); if (xmlInput.current) xmlInput.current.value = ''; setXmlUploadState('Arquivo removido da fila.'); }}>Remover XML pendente</button>}
                  </label>
                  <label>
                    Arquivo PDF
                    <input ref={pdfInput} type="file" accept=".pdf,application/pdf" onChange={e => { setPdfFile(e.currentTarget.files?.[0] ?? null); setPdfUploadState(''); }} />
                    <span className="file-meta" aria-live="polite">{pdfFile ? `${pdfFile.name} · ${formatFileSize(pdfFile.size)}` : 'Nenhum PDF selecionado'}{pdfUploadState ? ` · ${pdfUploadState}` : ''}</span>
                    {pdfFile && <button className="danger-link file-remove" type="button" onClick={() => { setPdfFile(null); if (pdfInput.current) pdfInput.current.value = ''; setPdfUploadState('Arquivo removido da fila.'); }}>Remover PDF pendente</button>}
                  </label>
                </section>
                <div className="wide booking-stage-actions">
                  {pendingUpload && <p className="muted" role="status">Reserva criada: {pendingUpload.protocol}. Os dados estão preservados; reenvie somente os documentos pendentes.</p>}
                  {bookingStep > 2 && bookingStep < 4 && <button key="back" className="button button-secondary" type="button" onClick={() => advanceBooking(bookingStep - 1)}>Voltar</button>}
                  {bookingStep < 4 && <button key="next" className="button button-primary" type="button" onClick={() => advanceBooking(bookingStep + 1)}>Próximo</button>}
                  <button key="submit" className="button button-primary" disabled={busy} hidden={bookingStep !== 4} formNoValidate>{busy ? (pendingUpload ? 'Enviando documentos…' : 'Confirmando…') : pendingUpload ? 'Tentar envio de documentos' : 'Confirmar agendamento'}</button>
                </div>
              </form>
            </Panel>
          )}
        </>
      )}

      {section === 'bookings' && (
        <>
          <PageTitle eyebrow="PORTAL DA EMPRESA" title="Meus agendamentos" description="Consulte disponibilidade mensal, protocolos, documentos e histórico." action={<button className="button button-secondary" onClick={() => setRefresh(value => value + 1)}>Atualizar</button>} />
          <div className="view-toggle" role="group" aria-label="Visualização de agendamentos">
            <button className={`button ${bookingView === 'calendar' ? 'button-primary' : 'button-quiet'}`} aria-pressed={bookingView === 'calendar'} onClick={() => setBookingView('calendar')}>Calendário</button>
            <button className={`button ${bookingView === 'list' ? 'button-primary' : 'button-quiet'}`} aria-pressed={bookingView === 'list'} onClick={() => setBookingView('list')}>Lista</button>
          </div>
          {bookingView === 'calendar' ? (
            <AppointmentsCalendar refresh={refresh} onDetails={showDetails} />
          ) : (
            <Panel title="Meus agendamentos">
              <div className="booking-filter-toolbar">
                <label>Status<select value={bookingStatusFilter} onChange={event => { setBookingStatusFilter(event.target.value); setBookingPage(1); }}><option value="">Todos os status</option><option value="confirmed">Confirmado</option><option value="pending">Pendente</option><option value="cancelled">Cancelado</option></select></label>
                <label>De<input type="date" value={bookingFromFilter} onChange={event => { setBookingFromFilter(event.target.value); setBookingPage(1); }} /></label>
                <label>Até<input type="date" value={bookingToFilter} onChange={event => { setBookingToFilter(event.target.value); setBookingPage(1); }} /></label>
                <label className="booking-search">Pesquisar<input type="search" value={bookingSearch} onChange={event => { setBookingSearch(event.target.value); setBookingPage(1); }} placeholder="Protocolo, placa ou NF" /></label>
              </div>
              {filteredBookings.length ? (
                <BookingTable bookings={filteredBookings.slice((bookingPage - 1) * 5, bookingPage * 5)} onDetails={showDetails} onCancel={cancel} onReschedule={reschedule} />
              ) : (
                <div className="empty-state">Nenhum agendamento corresponde aos filtros.</div>
              )}
              {filteredBookings.length > 0 && <div className="booking-pagination"><span>{filteredBookings.length} agendamento(s)</span><div><button className="button button-quiet" disabled={bookingPage <= 1} onClick={() => setBookingPage(page => page - 1)}>Anterior</button><span>Página {bookingPage} de {bookingPageCount}</span><button className="button button-quiet" disabled={bookingPage >= bookingPageCount} onClick={() => setBookingPage(page => page + 1)}>Próxima</button></div></div>}
            </Panel>
          )}
          {reschedulingId && (
            <ReschedulePanel bookingId={reschedulingId} onClose={() => setReschedulingId('')} onError={onError} onDone={() => { setReschedulingId(''); setRefresh(value => value + 1); onNotice('Agendamento reagendado.'); }} />
          )}
          {details && (
            <BookingDetails detail={details} onClose={() => setDetails(null)} onDeleteDocument={async id => { await api(`/api/v1/bookings/${details.booking.id}/documents/${id}`, { method: 'DELETE' }); await showDetails(details.booking.id); onNotice('Documento removido e registrado na auditoria.'); }} />
          )}
        </>
      )}

      {section === 'calendar' && (
        <>
          <PageTitle eyebrow="AGENDA" title="Calendário de disponibilidade" description="Consulte dias, horários e vagas liberadas para descarga." />
          <AppointmentsCalendar refresh={refresh} onDetails={showDetails} />
          {details && (
            <BookingDetails detail={details} onClose={() => setDetails(null)} onDeleteDocument={async id => { await api(`/api/v1/bookings/${details.booking.id}/documents/${id}`, { method: 'DELETE' }); await showDetails(details.booking.id); onNotice('Documento removido e registrado na auditoria.'); }} />
          )}
        </>
      )}

      {section === 'invoices' && (
        <>
          <PageTitle eyebrow="DOCUMENTOS" title="Notas fiscais" description="Acesse os documentos anexados aos seus agendamentos e baixe XML ou PDF." action={<button className="button button-primary" onClick={() => onNavigate('agenda')}>Novo agendamento</button>} />
          <Panel title="Agendamentos">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Protocolo</th><th>Data</th><th>Nota fiscal</th><th>Caminhão</th><th>Status</th><th>Download Direto</th><th>Ação</th></tr>
                </thead>
                <tbody>
                  {bookings.map(b => (
                    <tr key={b.id}>
                      <td><b>{b.protocol}</b></td>
                      <td>{fmt(b.starts_at)}</td>
                      <td>{b.invoice_number}</td>
                      <td>{b.plate}</td>
                      <td><span className={`pill ${b.status}`}>{bookingStatusLabel(b.status)}</span></td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-download-xml" disabled={!hasFiscalDocument(b, 'xml')} onClick={() => void downloadBookingDocument(b, 'xml')}>Baixar XML</button>
                          <button className="btn-download-pdf" disabled={!hasFiscalDocument(b, 'pdf')} onClick={() => void downloadBookingDocument(b, 'pdf')}>Baixar Nota (PDF)</button>
                        </div>
                      </td>
                      <td><button onClick={() => void showDetails(b.id)}>Ver documentos</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bookings.length === 0 && <div className="empty-state">Nenhum agendamento encontrado.</div>}
          </Panel>
          {details && (
            <BookingDetails detail={details} onClose={() => setDetails(null)} onDeleteDocument={async id => { await api(`/api/v1/bookings/${details.booking.id}/documents/${id}`, { method: 'DELETE' }); await showDetails(details.booking.id); onNotice('Documento removido e registrado na auditoria.'); }} />
          )}
        </>
      )}

      {section === 'upload' && (
        <>
          <PageTitle eyebrow="DOCUMENTOS FISCAIS" title="Upload de nota fiscal" description="Anexe XML ou PDF a um agendamento confirmado." />
          <InvoiceUpload bookings={bookings} onError={onError} onNotice={onNotice} />
        </>
      )}

      {section === 'trucks' && (
        <>
          <PageTitle eyebrow="FROTA" title="Meus caminhões" description="Cadastre e consulte os veículos vinculados à sua empresa." />
          <TruckManager trucks={trucks} onSubmit={createTruck} />
        </>
      )}

      {section === 'drivers' && (
        <>
          <PageTitle eyebrow="FROTA" title="Meus motoristas" description="Cadastre e consulte os motoristas vinculados à sua empresa." />
          <DriverManager drivers={drivers} onSubmit={createDriver} />
        </>
      )}

      {section === 'cadastro' && (
        <>
          <PageTitle eyebrow="CADASTROS" title="Caminhões e motoristas" description="Seus cadastros ficam isolados dos dados de outras empresas." />
          <div className="two-col">
            <Panel title="Cadastrar caminhão">
              <form className="form-stack" onSubmit={createTruck}>
                <label>Placa<input name="plate" placeholder="ABC-1234 ou ABC1D23" autoCapitalize="characters" autoComplete="off" spellCheck={false} required /><small>Informe no padrão antigo (ABC-1234) ou Mercosul (ABC1D23).</small></label>
                <label>Tipo de veículo (opcional)<input name="vehicleType" maxLength={80} /></label>
                <button className="button button-primary">Cadastrar</button>
              </form>
              <ul className="simple-list">{trucks.map(t => <li key={t.id}>{t.plate}</li>)}</ul>
            </Panel>
            <Panel title="Cadastrar motorista">
              <form className="form-stack" onSubmit={createDriver}>
                <label>Nome<input name="name" required maxLength={160} /></label>
                <label>Telefone<input name="phone" required minLength={8} maxLength={32} /></label>
                <button className="button button-primary">Cadastrar</button>
              </form>
              <ul className="simple-list">{drivers.map(d => <li key={d.id}>{d.name}</li>)}</ul>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

// Visualização de Documentos e Downloads
function Documents({ detail, onDelete }: { detail: { documents?: DocumentMeta[] }; onDelete?: (id: string) => Promise<void> }) {
  const openDocument = async (doc: { id: string; media_type: string; original_name?: string }, view: boolean) => {
    const popup = view && doc.media_type === 'application/pdf' ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    try {
      const response = await fetch(`/api/v1/documents/${doc.id}/download`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
      if (!response.ok) throw new Error('Não foi possível acessar o documento.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (view && doc.media_type === 'application/pdf' && popup) { popup.location.replace(url); setTimeout(() => URL.revokeObjectURL(url), 60_000); return; }
      const link = document.createElement('a'); link.href = url; link.download = doc.original_name || `${doc.id}.${doc.media_type.endsWith('pdf') ? 'pdf' : 'xml'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) { popup?.close(); window.alert((error as Error).message); }
  };

  if (!detail.documents?.length) return <p className="muted">Nenhum documento anexado.</p>;

  return (
    <div className="document-list">
      {detail.documents.map(doc => (
        <div className="document-row" key={doc.id}>
          <div>
            <b>{doc.original_name || (doc.media_type.endsWith('pdf') ? 'Documento PDF' : 'Documento XML')}</b>
            <span>{doc.media_type.endsWith('pdf') ? 'PDF' : 'XML'} · {doc.byte_size === undefined ? 'Tamanho indisponível' : formatFileSize(doc.byte_size)}</span>
          </div>
          <div className="document-actions">
            <button className="button button-quiet" onClick={() => void openDocument(doc, false)}>Baixar</button>
            {doc.media_type === 'application/pdf' && <button className="button button-quiet" onClick={() => void openDocument(doc, true)}>Visualizar PDF</button>}
            {onDelete && <button className="danger-link" onClick={async () => { if (!window.confirm(`Remover ${doc.original_name || 'este documento'}?`)) return; try { await onDelete(doc.id); } catch (error) { window.alert((error as Error).message); } }}>Remover</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Detalhes do Agendamento com download de XML e DANFE
function BookingDetails({ detail, onClose, onDeleteDocument }: { detail: BookingDetailsData; onClose?: () => void; onDeleteDocument?: (id: string) => Promise<void> }) {
  const { booking } = detail;
  const bookingWithDocuments = { ...booking, documents: detail.documents };
  const historyLabel: Record<string, string> = { created: 'Agendamento criado', rescheduled: 'Agendamento reagendado', cancelled: 'Agendamento cancelado' };

  return (
    <Panel title="Detalhes do agendamento" className="booking-detail-panel">
      <div className="booking-detail-heading">
        <b>Protocolo #{booking.protocol}</b>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`pill ${booking.status}`}>{bookingStatusLabel(booking.status)}</span>
          {onClose && <button className="button button-quiet" style={{ padding: '3px 8px' }} onClick={onClose}>Fechar</button>}
        </div>
      </div>

      <div className="booking-detail-grid">
        <DetailField icon="▦" label="Data e horário" value={`${fmt(booking.starts_at)} até ${fmt(booking.ends_at)}`} />
        <DetailField icon="▰" label="Caminhão" value={booking.plate} />
        <DetailField icon="♙" label="Motorista" value={booking.driver_name} />
        {booking.weight != null && booking.weight_unit && <DetailField icon="▤" label="Peso bruto" value={`${booking.weight} ${booking.weight_unit}`} />}
        <DetailField icon="▧" label="Nota fiscal" value={`${booking.invoice_number}${booking.invoice_series ? ` · Série ${booking.invoice_series}` : ''}`} />
        {booking.invoice_key && <DetailField icon="⌁" label="Chave de acesso" value={booking.invoice_key} />}
      </div>

      {/* Caixa com download de XML e DANFE (PDF) */}
      <div className="invoice-download-card">
        <div>
          <small>Documentos Fiscais</small>
          <strong>NF Nº {booking.invoice_number}</strong>
        </div>
        <div className="row-actions">
          <button className="btn-download-xml" disabled={!hasFiscalDocument(bookingWithDocuments, 'xml')} onClick={() => void downloadBookingDocument(bookingWithDocuments, 'xml')}>
            Baixar XML
          </button>
          <button className="btn-download-pdf" disabled={!hasFiscalDocument(bookingWithDocuments, 'pdf')} onClick={() => void downloadBookingDocument(bookingWithDocuments, 'pdf')}>
            Baixar Nota Fiscal (PDF)
          </button>
          <button className="button button-quiet" disabled={!hasFiscalDocument(bookingWithDocuments, 'pdf')} onClick={() => void downloadBookingDocument(bookingWithDocuments, 'pdf', true)}>
            Visualizar DANFE
          </button>
        </div>
      </div>

      {booking.notes && <div className="booking-notes"><b>Observações</b><p>{booking.notes}</p></div>}

      <section className="booking-detail-section">
        <h3>Documentos anexados</h3>
        <Documents detail={detail} onDelete={onDeleteDocument} />
      </section>

      <section className="booking-detail-section">
        <h3>Histórico</h3>
        {detail.history.length ? (
          <ol className="booking-history">
            {detail.history.map((event, index) => (
              <li key={`${event.action}-${event.created_at}-${index}`}>
                <span className="history-marker" />
                <div>
                  <b>{historyLabel[event.action] ?? event.action}</b>
                  <time>{fmt(event.created_at)}</time>
                  {event.action === 'rescheduled' && Boolean(event.details?.oldStartsAt && event.details?.newStartsAt) && (
                    <small>De {fmt(String(event.details?.oldStartsAt))} para {fmt(String(event.details?.newStartsAt))}</small>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Nenhum evento no histórico.</p>
        )}
      </section>
    </Panel>
  );
}

function DetailField({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="detail-field">
      <span className="detail-field-icon yellow-box">{icon}</span>
      <div>
        <small>{label}</small>
        <b>{value}</b>
      </div>
    </div>
  );
}

function TruckManager({ trucks, onSubmit }: { trucks: Array<{ id: string; plate: string }>; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="two-col">
      <Panel title="Cadastrar caminhão">
        <form className="form-stack" onSubmit={onSubmit}>
          <label>Placa<input name="plate" placeholder="ABC-1234 ou ABC1D23" autoCapitalize="characters" autoComplete="off" spellCheck={false} required /><small>Informe no padrão antigo (ABC-1234) ou Mercosul (ABC1D23).</small></label>
          <label>Tipo de veículo (opcional)<input name="vehicleType" maxLength={80} /></label>
          <button className="button button-primary">Cadastrar caminhão</button>
        </form>
      </Panel>
      <Panel title={`Caminhões cadastrados (${trucks.length})`}>
        {trucks.length ? (
          <ul className="simple-list">{trucks.map(truck => <li key={truck.id}><b>{truck.plate}</b></li>)}</ul>
        ) : (
          <div className="empty-state">Nenhum caminhão cadastrado.</div>
        )}
      </Panel>
    </div>
  );
}

function DriverManager({ drivers, onSubmit }: { drivers: Array<{ id: string; name: string }>; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="two-col">
      <Panel title="Cadastrar motorista">
        <form className="form-stack" onSubmit={onSubmit}>
          <label>Nome<input name="name" required maxLength={160} /></label>
          <label>Telefone<input name="phone" required minLength={8} maxLength={32} /></label>
          <button className="button button-primary">Cadastrar motorista</button>
        </form>
      </Panel>
      <Panel title={`Motoristas cadastrados (${drivers.length})`}>
        {drivers.length ? (
          <ul className="simple-list">{drivers.map(driver => <li key={driver.id}><b>{driver.name}</b></li>)}</ul>
        ) : (
          <div className="empty-state">Nenhum motorista cadastrado.</div>
        )}
      </Panel>
    </div>
  );
}

function InvoiceUpload({ bookings, onError, onNotice }: { bookings: Booking[]; onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [bookingId, setBookingId] = useState('');
  const [xml, setXml] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [xmlState, setXmlState] = useState('');
  const [pdfState, setPdfState] = useState('');

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bookingId) { onError('Selecione o agendamento que receberá os documentos.'); return; }
    if (!xml && !pdf) { onError('Selecione um arquivo XML ou PDF.'); return; }
    setBusy(true);
    let failed = false;
    for (const item of [
      { type: 'xml', file: xml, extension: '.xml', set: setXml, state: setXmlState },
      { type: 'pdf', file: pdf, extension: '.pdf', set: setPdf, state: setPdfState }
    ]) {
      if (!item.file) continue;
      if (!item.file.name.toLowerCase().endsWith(item.extension) || item.file.size === 0 || item.file.size > 10 * 1024 * 1024) {
        item.state(item.file.size > 10 * 1024 * 1024 ? 'Arquivo excede 10 MiB.' : `Selecione um arquivo ${item.extension.toUpperCase()} válido.`);
        failed = true;
        continue;
      }
      try {
        const form = new FormData();
        form.append('documentType', item.type);
        form.append('file', item.file);
        await api(`/api/v1/bookings/${bookingId}/documents`, { method: 'POST', body: form });
        item.set(null);
        item.state('Enviado com sucesso.');
      } catch (error) {
        item.state(`Falha no envio: ${(error as Error).message}`);
        failed = true;
      }
    }
    setBusy(false);
    if (!failed) onNotice('Documento(s) anexado(s) ao agendamento com sucesso.');
  };

  return (
    <Panel title="Arquivos da nota fiscal">
      <form className="form-grid" onSubmit={upload}>
        <label className="wide">
          Agendamento
          <select value={bookingId} onChange={event => setBookingId(event.target.value)} required>
            <option value="">Selecione o protocolo</option>
            {bookings.map(booking => (
              <option key={booking.id} value={booking.id}>
                {booking.protocol} · {fmt(booking.starts_at)} · {booking.plate}
              </option>
            ))}
          </select>
        </label>
        <div className="document-upload-section wide">
          <label className="upload-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) { setXml(file); setXmlState(''); } }}>
            Arquivo XML
            <input type="file" accept=".xml,application/xml,text/xml" onChange={event => { setXml(event.currentTarget.files?.[0] ?? null); setXmlState(''); }} />
            <span className="file-meta">{xml ? `${xml.name} · ${formatFileSize(xml.size)}` : xmlState || 'Nenhum XML selecionado'}</span>
          </label>
          <label className="upload-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) { setPdf(file); setPdfState(''); } }}>
            Arquivo PDF
            <input type="file" accept=".pdf,application/pdf" onChange={event => { setPdf(event.currentTarget.files?.[0] ?? null); setPdfState(''); }} />
            <span className="file-meta">{pdf ? `${pdf.name} · ${formatFileSize(pdf.size)}` : pdfState || 'Nenhum PDF selecionado'}</span>
          </label>
        </div>
        <p className="muted wide">Formatos aceitos: XML e PDF. Limite de 10 MiB por arquivo. Os documentos ficam privados e disponíveis apenas para usuários autorizados.</p>
        <div className="wide">
          <button className="button button-primary" disabled={busy || bookings.length === 0}>{busy ? 'Enviando…' : 'Enviar documentos'}</button>
        </div>
      </form>
    </Panel>
  );
}

// Tabela de Agendamentos com botões para baixar XML e Nota (PDF)
function BookingTable({ bookings, onDetails, onCancel, onReschedule }: { bookings: Booking[]; onDetails: (id: string) => void; onCancel: (id: string) => void; onReschedule: (id: string) => void }) {
  return (
    <div className="table-wrap booking-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Protocolo</th>
            <th>Data e hora</th>
            <th>Empresa</th>
            <th>Caminhão</th>
            <th>Status</th>
            <th>Documentos</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map(b => (
            <tr key={b.id}>
              <td><b>{b.protocol}</b></td>
              <td>{fmt(b.starts_at)}</td>
              <td>{b.company_name ?? '—'}</td>
              <td>{b.plate}</td>
              <td><span className={`pill ${b.status}`}>{bookingStatusLabel(b.status)}</span></td>
              <td>
                <div className="row-actions">
                  <button className="btn-download-xml" title={hasFiscalDocument(b, 'xml') ? 'Baixar XML da NF' : 'XML ainda não anexado'} disabled={!hasFiscalDocument(b, 'xml')} onClick={() => void downloadBookingDocument(b, 'xml')}>
                    XML
                  </button>
                  <button className="btn-download-pdf" title={hasFiscalDocument(b, 'pdf') ? 'Baixar Nota Fiscal (PDF)' : 'PDF ainda não anexado'} disabled={!hasFiscalDocument(b, 'pdf')} onClick={() => void downloadBookingDocument(b, 'pdf')}>
                    Nota (PDF)
                  </button>
                </div>
              </td>
              <td>
                <div className="row-actions">
                  <button onClick={() => onDetails(b.id)}>Detalhes</button>
                  {b.status === 'confirmed' && (
                    <>
                      <button onClick={() => onReschedule(b.id)}>Reagendar</button>
                      <button className="danger-link" onClick={() => onCancel(b.id)}>Cancelar</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Calendário Mensal com redução de ~20% no tamanho para tela menos poluída
function AppointmentsCalendar({ refresh, onDetails }: { refresh: number; onDetails: (id: string) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [today, setToday] = useState(dateValue(new Date()));

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const cellCount = Math.ceil((offset + new Date(year, monthIndex + 1, 0).getDate()) / 7) * 7;
  const gridStart = new Date(year, monthIndex, 1 - offset);
  const dates = Array.from({ length: cellCount }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const from = dateValue(dates[0]);
  const to = dateValue(dates[dates.length - 1]);

  useEffect(() => {
    let mounted = true;
    setLoading(true); setError('');
    api<Availability>(`/api/v1/availability?from=${from}&to=${to}`).then(result => {
      if (!mounted) return;
      setAvailability(result);
      const timezone = result.days.find(day => day.timezone)?.timezone ?? undefined;
      const todayInZone = dateInZone(new Date(), timezone);
      const monthStart = dateValue(new Date(year, monthIndex, 1));
      const monthEnd = dateValue(new Date(year, monthIndex + 1, 0));
      setToday(todayInZone);
      setSelected(current => current >= monthStart && current <= monthEnd
        ? current
        : todayInZone >= monthStart && todayInZone <= monthEnd ? todayInZone : monthStart);
    }).catch(reason => { if (mounted) setError((reason as Error).message); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [from, to, refresh, retry]);

  const daysByDate = new Map((availability?.days ?? []).map(day => [day.date, day]));
  const selectedDay = daysByDate.get(selected);
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(firstDay);
  const goToday = () => {
    const now = dateInZone(new Date(), availability?.days.find(day => day.timezone)?.timezone ?? undefined);
    const parsed = new Date(`${now}T12:00:00`);
    setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    setSelected(now);
  };
  const statusLabels: Record<CalendarDay['status'] | 'blocked', string> = {
    'no-schedule': 'Sem agenda',
    'no-service': 'Sem atendimento',
    closed: 'Exceção fechada',
    available: 'Disponível',
    partial: 'Parcialmente ocupada',
    full: 'Lotada',
    blocked: 'Bloqueado'
  };

  return (
    <div className="appointments-calendar-view">      <Panel title="Calendário de Disponibilidade">
        <div className="calendar-toolbar">
          <div className="calendar-month" aria-live="polite">{monthLabel}</div>
          <div className="calendar-actions">
            <button className="button button-quiet" aria-label="Mês anterior" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}>‹</button>
            <button className="button button-secondary" onClick={goToday}>Hoje</button>
            <button className="button button-quiet" aria-label="Próximo mês" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}>›</button>
          </div>
        </div>
        {loading && <p className="calendar-state" role="status">Carregando calendário…</p>}
        {error && <div className="alert alert-error" role="alert">Não foi possível carregar a agenda: {error}<button onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
        <div className="calendar-legend" aria-label="Legenda de disponibilidade">
          <span><i className="legend-dot available" />Disponível</span>
          <span><i className="legend-dot partial" />Parcial</span>
          <span><i className="legend-dot full" />Lotado</span>
          <span><i className="legend-dot closed" />Sem atendimento</span>
        </div>
        {/* Grade compactada com redução de ~20% */}
        <div className="calendar-grid calendar-grid-reduced" role="grid" aria-label={`Calendário de ${monthLabel}`}>
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label, index) => (
            <div className="calendar-weekday" role="columnheader" key={`${label}-${index}`}>{label}</div>
          ))}
          {dates.map(date => {
            const key = dateValue(date);
            const day = daysByDate.get(key);
            const isCurrentMonth = date.getMonth() === monthIndex;
            const status = day?.status ?? 'no-schedule';
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-pressed={selected === key}
                aria-label={`${key}: ${statusLabels[status]}, ${day?.bookingCount ?? 0} agendamentos, ${day?.remaining ?? 0} vagas restantes`}
                className={`calendar-day day-${status} ${isCurrentMonth ? '' : 'outside-month'} ${selected === key ? 'selected-day' : ''} ${today === key ? 'today' : ''}`}
                onClick={() => setSelected(key)}
              >
                <span className="calendar-day-number">{date.getDate()}</span>
                <span className="calendar-day-status">{statusLabels[status]}</span>
                {day?.slots.length ? (
                  <span className="calendar-availability-count">{day.remaining}/{day.capacity} vagas</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title={selected ? `Horários disponíveis — ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date(`${selected}T12:00:00`))}` : 'Selecione um dia'}>
        {loading && <p className="calendar-state" role="status">Atualizando horários…</p>}
        {!loading && selectedDay && selectedDay.slots.length === 0 && <div className="empty-state">{statusLabels[selectedDay.status]}. Não há horários de descarga para esta data.</div>}
        {!loading && selectedDay && selectedDay.slots.length > 0 && (
          <div className="calendar-slot-list">
            {selectedDay.slots.map(slot => (
              <div className={`calendar-slot slot-${slot.status}`} key={slot.id}>
                <b>{fmt(slot.startsAt, slot.timezone)}</b>
                <span>Capacidade {slot.capacity}</span>
                <span>Ocupadas {slot.occupied}</span>
                <span>Restantes {slot.remaining ?? Math.max(0, slot.capacity - slot.occupied)}</span>
                <strong>{statusLabels[slot.status as keyof typeof statusLabels] ?? slot.status}</strong>
              </div>
            ))}
          </div>
        )}
        {!loading && selectedDay && selectedDay.bookings.length > 0 && (
          <div className="calendar-bookings">
            <h3>Agendamentos confirmados nesta data</h3>
            {selectedDay.bookings.map(booking => (
              <article className="calendar-booking" key={booking.id}>
                <div>
                  <b>{booking.protocol}</b>
                  <span>{fmt(booking.startsAt, booking.timezone)} · {booking.plate} · {booking.driverName}{booking.companyName ? ` · ${booking.companyName}` : ''}</span>
                </div>
                <button className="button button-quiet" onClick={() => onDetails(booking.id)}>Detalhes</button>
              </article>
            ))}
          </div>
        )}
        {!loading && !selectedDay && !error && <div className="empty-state">Selecione uma data para consultar disponibilidade.</div>}
      </Panel>
    </div>
  );
}

function ReschedulePanel({ bookingId, onClose, onError, onDone }: { bookingId: string; onClose: () => void; onError: (v: string) => void; onDone: () => void }) {
  const today = dateValue(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(dateValue(new Date(Date.now() + 6 * 86400000)));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setSlots((await api<{ slots: Slot[] }>(`/api/v1/availability?from=${from}&to=${to}`)).slots.filter(slot => slot.status === 'available' || slot.status === 'partial'));
      setSelected('');
    } catch (e) { onError((e as Error).message); }
  };
  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/v1/bookings/${bookingId}/reschedule`, json({ slotId: selected }));
      onDone();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Escolher novo horário">
      <div className="inline-fields">
        <label>De<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>Até<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="button button-secondary" onClick={() => void load()}>Consultar</button>
        <button className="button button-quiet" onClick={onClose}>Fechar</button>
      </div>
      <div className="slot-grid">
        {slots.map(slot => (
          <button key={slot.id} className={`slot-card ${selected === slot.id ? 'chosen' : ''}`} onClick={() => setSelected(slot.id)}>
            <b>{fmt(slot.startsAt, slot.timezone)}</b>
            <span>{slot.capacity - slot.occupied} vaga(s)</span>
          </button>
        ))}
      </div>
      <button className="button button-primary" disabled={!selected || busy} onClick={() => void submit()}>
        Confirmar reagendamento
      </button>
    </Panel>
  );
}

// Administração completa com todas as abas e funções originais
function Admin({ section, onNavigate, onError, onNotice }: { section: string; onNavigate: (section: string) => void; onError: (v: string) => void; onNotice: (v: string) => void }) {
  const [refresh, setRefresh] = useState(0);
  const { data: companiesData } = useLoad<{ companies: Company[] }>('/api/v1/admin/companies', refresh, { companies: [] });
  const [dashboardData, setDashboardData] = useState<AdminDashboardData | null>(null);
  const [bookingView, setBookingView] = useState<'calendar' | 'list'>('calendar');
  const [companyUsers, setCompanyUsers] = useState<Array<{ id: string; email: string; active: boolean; company_id: string }>>([]);
  const [usersCompanyId, setUsersCompanyId] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [audits, setAudits] = useState<Array<Record<string, unknown>>>([]);
  const [configs, setConfigs] = useState<Array<Record<string, unknown>>>([]);
  const [exceptions, setExceptions] = useState<Array<Record<string, unknown>>>([]);
  const [details, setDetails] = useState<BookingDetailsData | null>(null);
  const [reschedulingId, setReschedulingId] = useState('');
  const [windows, setWindows] = useState<DayWindow[]>([]);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [effectiveFrom, setEffectiveFrom] = useState(dateValue(new Date()));
  const [bookingFilterProtocol, setBookingFilterProtocol] = useState('');
  const [bookingFilterPlate, setBookingFilterPlate] = useState('');
  const [bookingFilterCompany, setBookingFilterCompany] = useState('');
  const [busy, setBusy] = useState(false);

  const loadBookings = async () => {
    const params = new URLSearchParams({ pageSize: '100' });
    if (bookingFilterProtocol) params.set('protocol', bookingFilterProtocol);
    if (bookingFilterPlate) params.set('plate', bookingFilterPlate);
    if (bookingFilterCompany) params.set('companyId', bookingFilterCompany);
    try { setBookings((await api<{ bookings: Booking[] }>(`/api/v1/bookings?${params}`)).bookings); }
    catch (e) { onError((e as Error).message); }
  };
  const loadDashboard = async () => {
    try {
      const today = dateValue(new Date());
      const availability = await api<Availability>(`/api/v1/availability?from=${today}&to=${today}`);
      const dashboard = await api<AdminDashboardData>('/api/v1/admin/dashboard');
      dashboard.metrics.available_slots_today = availability.slots.reduce((total, slot) => total + (slot.status === 'blocked' ? 0 : slot.remaining ?? Math.max(0, slot.capacity - slot.occupied)), 0);
      setDashboardData(dashboard);
    }
    catch (e) { onError((e as Error).message); }
  };
  const loadAudit = async () => {
    try { setAudits((await api<{ events: Array<Record<string, unknown>> }>('/api/v1/admin/audit?pageSize=100')).events); }
    catch (e) { onError((e as Error).message); }
  };
  const loadConfigs = async () => {
    try { setConfigs((await api<{ configurations: Array<Record<string, unknown>> }>('/api/v1/admin/calendar/configs')).configurations); }
    catch (e) { onError((e as Error).message); }
  };
  const loadExceptions = async () => {
    const from = dateValue(new Date());
    const to = dateValue(new Date(Date.now() + 180 * 86400000));
    try { setExceptions((await api<{ exceptions: Array<Record<string, unknown>> }>(`/api/v1/admin/calendar/exceptions?from=${from}&to=${to}`)).exceptions); }
    catch (e) { onError((e as Error).message); }
  };

  useEffect(() => {
    if (section === 'agenda' || section === 'home') void loadConfigs();
    if (section === 'home') void loadDashboard();
    if (section === 'exceptions') void loadExceptions();
    if (section === 'bookings' || section === 'upload') void loadBookings();
    if (section === 'audit') void loadAudit();
  }, [section, refresh]);

  const addWindow = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const f = new FormData(formElement);
    setWindows(v => [...v, { weekday: Number(f.get('weekday')), start: String(f.get('start')), end: String(f.get('end')), durationMinutes: Number(f.get('durationMinutes')), capacity: Number(f.get('capacity')) }]);
    formElement.reset();
  };
  const saveCalendar = async () => {
    if (windows.length === 0) {
      onError('Adicione pelo menos uma faixa de horário antes de publicar a agenda.');
      return;
    }
    const byDay = new Map<number, WindowRule[]>();
    windows.forEach(({ weekday, ...window }) => byDay.set(weekday, [...(byDay.get(weekday) ?? []), window]));
    setBusy(true);
    try {
      await api('/api/v1/admin/calendar/configs', json({ timezone, effectiveFrom, weeklyRules: [...byDay].map(([weekday, dayWindows]) => ({ weekday, windows: dayWindows })) }));
      setWindows([]);
      await loadConfigs();
      onNotice('Configuração de calendário publicada com sucesso.');
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };
  const addException = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const f = new FormData(formElement);
    const blocked = f.get('blocked') === 'on';
    const payload = { localDate: f.get('localDate'), blocked, ...(!blocked ? { windows: [{ start: f.get('start'), end: f.get('end'), durationMinutes: Number(f.get('durationMinutes')), capacity: Number(f.get('capacity')) }] } : {}) };
    try {
      await api('/api/v1/admin/calendar/exceptions', json(payload));
      onNotice('Exceção de calendário registrada.');
      formElement.reset();
      await loadExceptions();
    } catch (e) { onError((e as Error).message); }
  };
  const createCompany = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const f = new FormData(formElement);
    const email = String(f.get('email') || '');
    const password = String(f.get('password') || '');
    if (Boolean(email) !== Boolean(password)) { onError('Preencha e-mail e senha juntos para criar o usuário.'); return; }
    try {
      await api('/api/v1/admin/companies', json({ name: f.get('name'), ...(email ? { email, password } : {}) }));
      formElement.reset();
      setRefresh(v => v + 1);
      onNotice('Empresa cadastrada.');
    } catch (e) { onError((e as Error).message); }
  };
  const toggleCompany = async (company: Company) => {
    try {
      await api(`/api/v1/admin/companies/${company.id}`, { method: 'PATCH', body: JSON.stringify({ active: !company.active }) });
      setRefresh(v => v + 1);
    } catch (e) { onError((e as Error).message); }
  };
  const loadUsers = async (companyId: string) => {
    try {
      setUsersCompanyId(companyId);
      setCompanyUsers((await api<{ users: typeof companyUsers }>(`/api/v1/admin/users?companyId=${companyId}`)).users);
    } catch (e) { onError((e as Error).message); }
  };
  const createUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const f = new FormData(formElement);
    try {
      await api('/api/v1/admin/users', json({ companyId: f.get('companyId'), email: f.get('email'), password: f.get('password') }));
      formElement.reset();
      await loadUsers(String(f.get('companyId')));
      onNotice('Usuário cadastrado com sucesso.');
    } catch (e) { onError((e as Error).message); }
  };
  const toggleUser = async (user: { id: string; active: boolean }) => {
    try {
      await api(`/api/v1/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active: !user.active }) });
      await loadUsers(usersCompanyId);
    } catch (e) { onError((e as Error).message); }
  };
  const detail = async (id: string) => {
    try { setDetails(await api(`/api/v1/bookings/${id}`)); }
    catch (e) { onError((e as Error).message); }
  };
  const cancel = async (id: string) => {
    if (!window.confirm('Cancelar este agendamento?')) return;
    try {
      await api(`/api/v1/bookings/${id}/cancel`, { method: 'POST' });
      setRefresh(value => value + 1);
      await loadBookings();
      onNotice('Agendamento cancelado.');
    } catch (e) { onError((e as Error).message); }
  };
  const rebook = (id: string) => setReschedulingId(id);

  return (
    <>
      {section === 'home' && (
        <div className="admin-dashboard">
          <PageTitle eyebrow="VISÃO GERAL" title="Dashboard" description="Acompanhe a operação e a disponibilidade da agenda." action={<button className="button button-secondary" onClick={() => { setRefresh(value => value + 1); void loadDashboard(); }}>↻ Atualizar</button>} />
          <div className="dashboard-metrics">
            <MetricCard icon="bookings" label="Agendamentos de hoje" value={dashboardData ? String(dashboardData.metrics.bookings_today) : '—'} note="confirmados" />
            <MetricCard icon="agenda" label="Vagas disponíveis" value={dashboardData ? String(dashboardData.metrics.available_slots_today) : '—'} note="para hoje" />
            <MetricCard icon="trucks" label="Caminhões cadastrados" value={dashboardData ? String(dashboardData.metrics.trucks_total) : '—'} note="todas as empresas" />
            <MetricCard icon="drivers" label="Motoristas cadastrados" value={dashboardData ? String(dashboardData.metrics.drivers_total) : '—'} note="todas as empresas" />
          </div>
          <div className="admin-dashboard-grid">
            <Panel title="Próximos agendamentos">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Protocolo</th><th>Empresa</th><th>Data e horário</th><th>Caminhão</th><th>Motorista</th><th>Status</th><th>Ação</th></tr></thead>
                  <tbody>
                    {(dashboardData?.nextBookings ?? []).map(booking => (
                      <tr key={booking.id}>
                        <td><b>{booking.protocol}</b></td><td>{booking.company_name}</td><td>{fmt(booking.starts_at, booking.timezone)}</td>
                        <td>{booking.plate}</td><td>{booking.driver_name}</td><td><span className={`pill ${booking.status}`}>{bookingStatusLabel(booking.status)}</span></td>
                        <td><button className="button button-quiet" onClick={() => void detail(booking.id)}>Detalhes</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dashboardData && dashboardData.nextBookings.length === 0 && <div className="empty-state">Nenhum agendamento futuro confirmado.</div>}
              <button className="text-link" onClick={() => onNavigate('bookings')}>Ver todos os agendamentos {'\u2192'}</button>
            </Panel>
            <div className="admin-dashboard-calendar"><AppointmentsCalendar refresh={refresh} onDetails={detail} /></div>
          </div>
        </div>
      )}

      {section === 'agenda' && (
        <div className="admin-schedule-page">
          <PageTitle eyebrow="ADMINISTRAÇÃO" title="Configuração da agenda" description="Defina os horários e a capacidade operacional. Nenhum horário padrão é presumido." />
          <Panel title="Nova configuração com vigência">
            <div className="form-grid">
              <label>Fuso horário IANA<input value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="Ex.: America/Sao_Paulo" /></label>
              <label>Vigência a partir de<input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} /></label>
            </div>
            <form className="rule-form schedule-window-form" onSubmit={addWindow}>
              <label>Dia<select name="weekday">{[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{weekdayNames[d % 7]}</option>)}</select></label>
              <label>Abre<input name="start" type="time" required /></label>
              <label>Fecha<input name="end" type="time" required /></label>
              <label>Duração (min)<input name="durationMinutes" type="number" min="1" required /></label>
              <label>Capacidade<input name="capacity" type="number" min="1" required /></label>
              <button className="button button-secondary">Adicionar faixa</button>
            </form>
            {windows.length > 0 && (
              <>
                <ul className="simple-list">
                  {windows.map((w, i) => (
                    <li key={i}>
                      {weekdayNames[w.weekday % 7]} · {w.start}–{w.end} · {w.durationMinutes} min · {w.capacity} caminhões
                      <button className="danger-link" onClick={() => setWindows(v => v.filter((_, index) => index !== i))}>Remover</button>
                    </li>
                  ))}
                </ul>
                <button className="button button-primary" disabled={busy} onClick={() => void saveCalendar()}>
                  {busy ? 'Salvando…' : 'Publicar configuração'}
                </button>
              </>
            )}
          </Panel>
          <Panel title="Exceção de data">
            <form className="rule-form exception-form" onSubmit={addException}>
              <label>Data<input type="date" name="localDate" required /></label>
              <label className="checkbox-label"><input type="checkbox" name="blocked" /> Bloquear o dia</label>
              <label>Abertura<input type="time" name="start" /></label>
              <label>Fechamento<input type="time" name="end" /></label>
              <label>Duração (min)<input type="number" name="durationMinutes" min="1" defaultValue="30" /></label>
              <label>Capacidade<input type="number" name="capacity" min="1" defaultValue="1" /></label>
              <button className="button button-secondary">Salvar exceção</button>
            </form>
          </Panel>
          <Panel title="Configurações publicadas">
            {configs.length ? <div className="published-config-list">{configs.map((configuration, index) => <details key={String(configuration.id ?? index)}><summary><strong>{String(configuration.timezone ?? 'Fuso não informado')}</strong><span>Vigente desde {String(configuration.effective_from ?? '').slice(0, 10)}</span></summary><pre>{JSON.stringify(configuration.weekly_rules, null, 2)}</pre></details>)}</div> : <p className="muted">Agenda indisponível até a primeira configuração. Adicione as faixas de atendimento para liberar horários.</p>}
          </Panel>
        </div>
      )}

      {section === 'exceptions' && (
        <>
          <PageTitle eyebrow="CONFIGURAÇÃO DA AGENDA" title="Bloqueios e exceções" description="Consulte os bloqueios e cadastre exceções de funcionamento." />
          <Panel title="Novo bloqueio ou exceção">
            <form className="form-grid" onSubmit={addException}>
              <label>Data<input type="date" name="localDate" required /></label>
              <label className="checkbox-label"><input type="checkbox" name="blocked" /> Bloquear o dia inteiro</label>
              <label>Início<input type="time" name="start" /></label>
              <label>Fim<input type="time" name="end" /></label>
              <label>Duração (minutos)<input type="number" name="durationMinutes" min="1" defaultValue="30" /></label>
              <label>Capacidade<input type="number" name="capacity" min="1" defaultValue="1" /></label>
              <div className="wide"><button className="button button-primary">Salvar exceção</button></div>
            </form>
          </Panel>
          <Panel title="Próximas exceções">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Data</th><th>Tipo</th><th>Horários</th><th>Fuso horário</th></tr>
                </thead>
                <tbody>
                  {exceptions.map((exception, index) => {
                    const wins = Array.isArray(exception.windows) ? exception.windows as Array<{ start?: string; end?: string; capacity?: number }> : [];
                    const blocked = Boolean(exception.blocked);
                    return (
                      <tr key={String(exception.id ?? index)}>
                        <td>{String(exception.local_date).slice(0, 10)}</td>
                        <td>{blocked ? 'Bloqueio integral' : 'Horário especial'}</td>
                        <td>{blocked ? 'Sem atendimento' : wins.map(w => `${w.start}–${w.end} · ${w.capacity} vagas`).join(', ')}</td>
                        <td>{String(exception.timezone ?? '—')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {exceptions.length === 0 && <div className="empty-state">Não há bloqueios ou exceções nos próximos 180 dias.</div>}
          </Panel>
        </>
      )}

      {/* Tela de Empresas e Usuários restaurada com visual Revest */}
      {section === 'companies' && (
        <>
          <PageTitle eyebrow="ADMINISTRAÇÃO" title="Empresas e usuários" description="Cadastre uma empresa e gerencie suas contas de acesso." />
          <Panel title="Cadastrar empresa">
            <form className="form-grid" onSubmit={createCompany}>
              <label>Nome da empresa<input name="name" required maxLength={200} placeholder="Nome da transportadora / fornecedor" /></label>
              <label>E-mail do usuário (opcional)<input name="email" type="email" placeholder="usuario@empresa.com" /></label>
              <label>Senha inicial (mínimo 12 caracteres)<input name="password" type="password" minLength={12} placeholder="••••••••••••" /></label>
              <div className="wide"><button className="button button-primary">Salvar empresa</button></div>
            </form>
          </Panel>
          <Panel title="Cadastrar usuário">
            <form className="form-grid" onSubmit={createUser}>
              <label>
                Empresa
                <select name="companyId" required defaultValue="">
                  <option value="" disabled>Selecione a empresa</option>
                  {companiesData.companies.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>E-mail<input name="email" type="email" required placeholder="email@empresa.com" /></label>
              <label>Senha inicial (mínimo 12 caracteres)<input name="password" type="password" minLength={12} required placeholder="••••••••••••" /></label>
              <div className="wide"><button className="button button-secondary">Criar usuário</button></div>
            </form>
          </Panel>
          <Panel title="Empresas cadastradas">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Empresa</th><th>Status</th><th>Ações</th></tr>
                </thead>
                <tbody>
                  {companiesData.companies.map(c => (
                    <tr key={c.id}>
                      <td><b>{c.name}</b></td>
                      <td><span className={`pill ${c.active ? 'confirmed' : 'cancelled'}`}>{c.active ? 'Ativa' : 'Inativa'}</span></td>
                      <td>
                        <div className="row-actions">
                          <button onClick={() => void loadUsers(c.id)}>Ver usuários</button>
                          <button onClick={() => void toggleCompany(c)}>{c.active ? 'Desativar' : 'Ativar'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {usersCompanyId && (
              <div style={{ marginTop: '16px' }}>
                <h3>Usuários desta empresa</h3>
                <ul className="simple-list">
                  {companyUsers.map(u => (
                    <li key={u.id}>
                      {u.email} · <span className={`pill ${u.active ? 'confirmed' : 'cancelled'}`}>{u.active ? 'Ativo' : 'Inativo'}</span>
                      <button className="danger-link" onClick={() => void toggleUser(u)}>{u.active ? 'Desativar' : 'Ativar'}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </>
      )}

      {section === 'bookings' && (
        <>
          <PageTitle eyebrow="OPERAÇÃO" title="Agendamentos" description="Consulte a ocupação mensal e gerencie reservas." action={<button className="button button-secondary" onClick={() => setRefresh(value => value + 1)}>Atualizar</button>} />
          <div className="view-toggle" role="group" aria-label="Visualização de agendamentos">
            <button className={`button ${bookingView === 'calendar' ? 'button-primary' : 'button-quiet'}`} aria-pressed={bookingView === 'calendar'} onClick={() => setBookingView('calendar')}>Calendário</button>
            <button className={`button ${bookingView === 'list' ? 'button-primary' : 'button-quiet'}`} aria-pressed={bookingView === 'list'} onClick={() => setBookingView('list')}>Lista</button>
          </div>
          {bookingView === 'calendar' ? (
            <AppointmentsCalendar refresh={refresh} onDetails={detail} />
          ) : (
            <>
              <Panel title="Filtros">
                <div className="form-grid">
                  <label>Protocolo<input value={bookingFilterProtocol} onChange={e => setBookingFilterProtocol(e.target.value)} placeholder="Ex: #REV" /></label>
                  <label>Placa<input value={bookingFilterPlate} onChange={e => setBookingFilterPlate(e.target.value)} placeholder="ABC1D23" /></label>
                  <label>
                    Empresa
                    <select value={bookingFilterCompany} onChange={e => setBookingFilterCompany(e.target.value)}>
                      <option value="">Todas as empresas</option>
                      {companiesData.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <div><button className="button button-secondary" onClick={() => void loadBookings()}>Aplicar filtros</button></div>
                </div>
              </Panel>
              <Panel>
                {bookings.length ? (
                  <BookingTable bookings={bookings} onDetails={detail} onCancel={cancel} onReschedule={rebook} />
                ) : (
                  <div className="empty-state">Nenhum agendamento encontrado.</div>
                )}
              </Panel>
            </>
          )}
          {reschedulingId && (
            <ReschedulePanel bookingId={reschedulingId} onClose={() => setReschedulingId('')} onError={onError} onDone={() => { setReschedulingId(''); setRefresh(value => value + 1); void loadBookings(); onNotice('Agendamento reagendado.'); }} />
          )}
          {details && (
            <BookingDetails detail={details} onClose={() => setDetails(null)} onDeleteDocument={async id => { await api(`/api/v1/bookings/${details.booking.id}/documents/${id}`, { method: 'DELETE' }); await detail(details.booking.id); onNotice('Documento removido e registrado na auditoria.'); }} />
          )}
        </>
      )}

      {section === 'upload' && (
        <>
          <PageTitle eyebrow="DOCUMENTOS FISCAIS" title="Upload de nota fiscal" description="Anexe XML ou PDF a um agendamento existente." />
          <InvoiceUpload bookings={bookings} onError={onError} onNotice={onNotice} />
        </>
      )}

      {section === 'audit' && (
        <>
          <PageTitle eyebrow="SEGURANÇA" title="Auditoria" description="Eventos administrativos e de alteração de reservas." />
          <Panel>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Data</th><th>Ação</th><th>Recurso</th><th>Ator</th></tr>
                </thead>
                <tbody>
                  {audits.map((event, i) => (
                    <tr key={String(event.id ?? i)}>
                      <td>{fmt(String(event.created_at))}</td>
                      <td>{String(event.action)}</td>
                      <td>{String(event.resource_type)} · {String(event.resource_id)}</td>
                      <td>{String(event.actor_id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
