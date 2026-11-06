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
    <div className={`shell admin-layout ${collapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      <header className="topbar">
        <a className="topbar-brand" href="#dashboard" onClick={event => { event.preventDefault(); onNavigate('home'); }} aria-label="REVEST Acabamentos — Dashboard">
          <span className="wordmark">
            <span className="main">REVEST</span>
            <small className="sub">ACABAMENTOS</small>
          </span>
        </a>
        <span className="system-badge">
          <strong>SAD</strong>
          <span>Agendamento de Descarga</span>
        </span>
        <div className="header-actions">
          <button className="notification-btn" aria-label="Notificações">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18c0 0-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </button>
          <span className="avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
          <div className="user-info">
            <span className="user-name">{displayName(email)}</span>
            <span className="user-role">Administrador</span>
          </div>
          <button className="button button-quiet sign-out-btn" onClick={onSignOut}>Sair</button>
          <button className="menu-toggle" onClick={onToggleMobileMenu} aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={mobileMenuOpen}>
            <span /><span /><span />
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label="Menu administrativo">
          <button className="sidebar-collapse-btn" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="sidebar-nav">
            <p className="nav-label">MENU PRINCIPAL</p>
            {navigation.map(([key, label, icon]) => (
              <button key={key} className={`nav-item ${section === key ? 'active' : ''}`} aria-current={section === key ? 'page' : undefined} onClick={() => onNavigate(key)}>
                <span className="nav-icon"><SADIcon name={icon} /></span>
                <span className="nav-label-text">{key === 'home' ? 'Dashboard' : label}</span>
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
            <div className="support-block"><span className="support-header">SUPORTE</span><span className="support-contact">Fale com o administrador</span></div>
            <small className="version-label">Versão 1.0.0</small>
          </div>
        </aside>

        <button className="mobile-backdrop" aria-label="Fechar menu" onClick={onToggleMobileMenu} />
        <main className="content">
          <div className="content-inner">
            {children}
          </div>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navegação administrativa">
        <div className="bottom-nav-inner">
          {mobileItems.map(([key, label, icon]) => (
            <button key={key} className={`bottom-nav-item ${section === key ? 'active' : ''}`} aria-current={section === key ? 'page' : undefined} onClick={() => onNavigate(key)}>
              <span><SADIcon name={icon} /></span>
              <small>{key === 'home' ? 'Início' : key === 'agenda' ? 'Agenda' : key === 'exceptions' ? 'Bloqueios' : label}</small>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}