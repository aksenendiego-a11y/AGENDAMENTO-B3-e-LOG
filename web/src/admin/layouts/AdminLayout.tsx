import type { ReactNode } from 'react';
import { SADIcon } from '../../components/SADIcon';
import './admin.css';

export type AdminNavigationItem = [key: string, label: string, icon: string];

type AdminLayoutProps = {
  email: string;
  section: string;
  navigation: AdminNavigationItem[];
  collapsed: boolean;
  mobileMenuOpen: boolean;
  onNavigate: (section: string) => void;
  onToggleCollapsed: () => void;
  onToggleMobileMenu: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

const displayName = (email: string) => email.includes('@')
  ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  : 'Administrador';

export function AdminLayout({ email, section, navigation, collapsed, mobileMenuOpen, onNavigate, onToggleCollapsed, onToggleMobileMenu, onSignOut, children }: AdminLayoutProps) {
  const mobileItems = navigation.slice(0, 4);

  return (
    <div className={`shell admin-layout ${collapsed ? 'admin-sidebar-collapsed' : ''} ${mobileMenuOpen ? 'admin-mobile-menu-open' : ''}`}>
      <header className="admin-header">
        <a className="admin-brand" href="#dashboard" onClick={event => { event.preventDefault(); onNavigate('home'); }} aria-label="REVEST Acabamentos — Dashboard">
          <span>REVEST</span><small>ACABAMENTOS</small>
        </a>
        <div className="admin-system-title"><b>SAD</b><span>Agendamento de Descarga</span></div>
        <div className="admin-header-account">
          <span className="admin-notification" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span>
          <span className="admin-avatar">{email.slice(0, 1).toUpperCase()}</span>
          <div className="admin-account-name"><strong>{displayName(email)}</strong><small>Administrador</small></div>
          <button type="button" className="admin-signout" onClick={onSignOut}>Sair</button>
          <button type="button" className="admin-menu-toggle" onClick={onToggleMobileMenu} aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={mobileMenuOpen}><span /><span /><span /></button>
        </div>
      </header>

      <div className="admin-layout-body">
        <aside className="admin-sidebar" aria-label="Menu administrativo">
          <button type="button" className="admin-collapse-toggle" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>{collapsed ? '⇢' : '⇠'}</button>
          <div className="admin-sidebar-navigation">
            <span className="admin-sidebar-caption">MENU PRINCIPAL</span>
            {navigation.map(([key, label, icon]) => (
              <button type="button" key={key} className={`admin-nav-item ${section === key ? 'active' : ''}`} aria-current={section === key ? 'page' : undefined} onClick={() => onNavigate(key)}>
                <span className="admin-nav-icon"><SADIcon name={icon} /></span><span className="admin-nav-label">{key === 'home' ? 'Dashboard' : label}</span>
              </button>
            ))}
          </div>
          <div className="admin-sidebar-footer">
            <div className="admin-product-card"><span>S</span><div><b>SAD</b><small>Sistema de Agendamento<br />de Descarga</small></div></div>
            <div className="admin-support"><small>SUPORTE</small><b>Fale com o administrador</b></div>
            <small className="admin-version">Versão 1.0.0</small>
          </div>
        </aside>

        <button type="button" className="admin-backdrop" aria-label="Fechar menu" onClick={onToggleMobileMenu} />
        <main className="admin-content">
          {children}
        </main>
      </div>

      <nav className="admin-mobile-navigation" aria-label="Navegação administrativa">
        {mobileItems.map(([key, label, icon]) => (
          <button type="button" key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => onNavigate(key)}>
            <span><SADIcon name={icon} /></span><small>{key === 'home' ? 'Início' : key === 'agenda' ? 'Agenda' : key === 'exceptions' ? 'Bloqueios' : label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
