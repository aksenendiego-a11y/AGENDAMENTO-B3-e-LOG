import { useState } from 'react';

export function DashboardRevestPage() {
  const [selectedDate, setSelectedDate] = useState(16);

  return (
    <div className="revest-dashboard">
      <header className="revest-header">
        <div className="revest-logo">
          <strong>REVEST</strong>
          <small>ACABAMENTOS</small>
        </div>
        <div className="revest-user">
          <span>🔔</span>
          <div>
            <strong>João da Silva</strong>
            <small>Empresa Exemplo</small>
          </div>
        </div>
      </header>

      <div className="revest-body">
        <aside className="revest-sidebar">
          {['Início','Agendamentos','Novo Agendamento','Meus Caminhões','Meus Motoristas','Notas Fiscais','Calendário','Configurações'].map((item,i)=>(
            <button key={i} className={i===0?'active':''}>{item}</button>
          ))}
          <div className="sidebar-footer">
            <div>SAD</div>
            <small>Sistema de Agendamento de Descarga</small>
          </div>
        </aside>

        <main className="revest-main">
          <div className="dashboard-grid">
            <section className="hero-login">
              <img src="https://via.placeholder.com/600x400?text=REVEST+Acabamentos" alt="Truck"/>
              <div className="login-card">
                <h4>Entrar na sua conta</h4>
                <input placeholder="E-mail ou CNPJ"/>
                <input type="password" placeholder="Senha"/>
                <button className="btn-yellow">Entrar</button>
              </div>
            </section>

            <section className="panel empresa">
              <h4>Painel da Empresa</h4>
              <div className="metrics-grid">
                <div><strong>8</strong><span>Agendamentos hoje</span></div>
                <div><strong>4</strong><span>Vagas disponíveis</span></div>
                <div><strong>5</strong><span>Total de caminhões</span></div>
                <div><strong>7</strong><span>Motoristas cadastrados</span></div>
              </div>
              <table>
                <thead><tr><th>Horário</th><th>Caminhão</th><th>Motorista</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td>08:00</td><td>GHI-4823</td><td>Carlos Souza</td><td>Confirmado</td></tr>
                </tbody>
              </table>
            </section>

            <section className="panel calendario">
              <h4>Calendário de Disponibilidade</h4>
              <div className="calendar-mini">Maio 2025</div>
              <div className="slots">
                {[8,9,10,11,13].map(h=> <button key={h}>{h}:00</button>)}
              </div>
            </section>

            <section className="panel novo">
              <h4>Novo Agendamento</h4>
              <div>Dados da carga</div>
              <input placeholder="Data e horário"/>
              <input placeholder="Caminhão"/>
              <input placeholder="Motorista"/>
            </section>

            <section className="panel meus">
              <h4>Meus Agendamentos</h4>
              <table><thead><tr><th>Protocolo</th><th>Data</th><th>Status</th></tr></thead></table>
            </section>

            <section className="panel detalhes">
              <h4>Detalhes do Agendamento</h4>
              <p>Protocolo #REV00123</p>
            </section>

            <section className="panel upload">
              <h4>Upload de Nota Fiscal</h4>
              <div>Arraste arquivos aqui</div>
            </section>

            <section className="panel config">
              <h4>Gestão de Configurações da Agenda</h4>
              <p>Funcionamento / Capacidade / Bloqueios</p>
            </section>

            <section className="panel bloqueios">
              <h4>Bloqueios e Exceções</h4>
              <button>+ Novo bloqueio</button>
            </section>
          </div>
        </main>
      </div>

      <style>{`
        .revest-dashboard{font-family:system-ui,sans-serif}
        .revest-header{background:#ffd900;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
        .revest-sidebar{width:220px;background:#111;color:#fff;padding:16px}
        .revest-sidebar button{display:block;width:100%;padding:8px;margin:4px 0;background:transparent;color:#fff;border:none;text-align:left}
        .revest-sidebar button.active{background:#ffd900;color:#000}
        .revest-body{display:grid;grid-template-columns:220px 1fr}
        .dashboard-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:16px}
        .panel{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px}
        .hero-login{grid-column:span 1;position:relative}
        .login-card{position:absolute;top:20px;left:20px;background:#fff;padding:16px;border-radius:8px}
        .btn-yellow{background:#ffd900;border:none;padding:8px 16px}
        .metrics-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      `}</style>
    </div>
  );
}
