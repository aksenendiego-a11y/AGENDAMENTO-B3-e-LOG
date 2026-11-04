import { useState } from 'react';

export function DashboardRevest() {
  const [activeTab, setActiveTab] = useState('home');

  return (
    <div className="dashboard-revest">
      <header className="revest-topbar">
        <div className="revest-brand">
          <span>REVEST</span>
          <small>ACABAMENTOS</small>
        </div>
        <div className="revest-user">
          <span className="bell">🔔</span>
          <span>João da Silva</span>
          <small>Empresa Exemplo</small>
        </div>
      </header>

      <div className="revest-layout">
        <aside className="revest-sidebar">
          <nav>
            <button className={activeTab === 'home' ? 'active' : ''} onClick={() => setActiveTab('home')}>Início</button>
            <button onClick={() => setActiveTab('agenda')}>Agendamentos</button>
            <button>Novo Agendamento</button>
            <button>Meus Caminhões</button>
            <button>Meus Motoristas</button>
            <button>Notas Fiscais</button>
            <button>Calendário</button>
            <button>Configurações</button>
          </nav>
        </aside>

        <main className="revest-content">
          <div className="grid">
            <section className="card panel-empresa">
              <h3>Painel da Empresa</h3>
              <div className="metrics">
                <div>Agendamentos hoje 8</div>
                <div>Vagas disponíveis 4 de 12</div>
                <div>Total de caminhões 5</div>
                <div>Motoristas cadastrados 7</div>
              </div>
            </section>

            <section className="card calendario">
              <h3>Calendário de Disponibilidade</h3>
              <p>Maio 2025</p>
            </section>

            <section className="card novo-agendamento">
              <h3>Novo Agendamento</h3>
              <p>Preencha os dados para agendar a descarga do caminhão.</p>
            </section>

            <section className="card meus-agendamentos">
              <h3>Meus Agendamentos</h3>
              <p>Histórico e status dos seus agendamentos</p>
            </section>

            <section className="card detalhes">
              <h3>Detalhes do Agendamento</h3>
              <p>Protocolo #REV00123</p>
            </section>

            <section className="card upload">
              <h3>Upload de Nota Fiscal</h3>
              <p>Anexe o XML e/ou PDF da nota fiscal</p>
            </section>

            <section className="card configuracoes">
              <h3>Gestão de Configurações da Agenda</h3>
              <p>Funcionamento, Capacidade, Bloqueios</p>
            </section>

            <section className="card bloqueios">
              <h3>Bloqueios e Exceções</h3>
              <button>+ Novo bloqueio</button>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
