import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, post, session, User } from './api';
import { useLiveUpdates } from './useLiveUpdates';
import { BatchesPage } from './pages/BatchesPage';
import { BatchDetailPage } from './pages/BatchDetailPage';
import { CertificatesPage } from './pages/CertificatesPage';
import { VerifyPage } from './pages/VerifyPage';
import { PhonePage } from './pages/PhonePage';

interface DemoUser {
  username: string;
  name: string;
  role: string;
  district: { name: string } | null;
  centre: { name: string } | null;
}

const ROLE_LABEL: Record<string, string> = {
  CENTRE: 'Training centre',
  DISTRICT_OFFICER: 'District officer',
  QUALITY: 'Quality team',
  STATE: 'State office',
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const navigate = useNavigate();
  const live = useLiveUpdates(user?.username);

  useEffect(() => {
    api<DemoUser[]>('/api/auth/demo-users').then(setDemoUsers).catch(() => setDemoUsers([]));
    if (session.token) api<User>('/api/auth/me').then(setUser).catch(() => session.set(null));
  }, []);

  async function switchUser(username: string) {
    if (!username) {
      session.set(null);
      setUser(null);
      return;
    }
    const { token, user: loggedIn } = await post<{ token: string; user: User }>('/api/auth/login', { username });
    session.set(token);
    setUser(loggedIn);
    navigate('/');
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          CertiFlow <span>Pragati Skills Mission</span>
        </Link>
        <nav>
          {user && <NavLink to="/" end>Batches</NavLink>}
          {user && <NavLink to="/certificates">Certificates</NavLink>}
          <NavLink to="/verify">Verify a certificate</NavLink>
          <NavLink to="/phone">Candidate phone</NavLink>
        </nav>
        <label className="switcher">
          Acting as
          <select value={user?.username ?? ''} onChange={(event) => switchUser(event.target.value)}>
            <option value="">— nobody (public) —</option>
            {demoUsers.map((demo) => (
              <option key={demo.username} value={demo.username}>
                {demo.name} · {ROLE_LABEL[demo.role]}
                {demo.district ? ` · ${demo.district.name}` : ''}
              </option>
            ))}
          </select>
        </label>
      </header>

      {live.lastEvent && <div className="live">● live · last update: {live.lastEvent}</div>}

      <main>
        <Routes>
          <Route path="/" element={user ? <BatchesPage user={user} version={live.version} /> : <Welcome />} />
          <Route path="/batches/:id" element={user ? <BatchDetailPage user={user} version={live.version} /> : <Welcome />} />
          <Route path="/certificates" element={user ? <CertificatesPage user={user} version={live.version} /> : <Welcome />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/verify/:certificateNo" element={<VerifyPage />} />
          <Route path="/phone" element={<PhonePage />} />
        </Routes>
      </main>
    </div>
  );
}

function Welcome() {
  return (
    <section className="card welcome">
      <h1>Skilling certificates, issued and verifiable</h1>
      <p>Pick a person in the top-right corner to try their part of the flow:</p>
      <ul>
        <li><b>Anika</b> (training centre) creates a batch, uploads the spreadsheet and submits it.</li>
        <li><b>Dev, Meera, Kabir</b> (district officers) review it. Two must agree.</li>
        <li><b>Neha</b> (quality team) checks batches over 50 candidates.</li>
        <li><b>Farah</b> (state office) gives the final approval, watches stuck batches, cancels certificates.</li>
      </ul>
      <p>
        No login needed to <Link to="/verify">verify a certificate</Link> or to see what a{' '}
        <Link to="/phone">candidate's phone</Link> received.
      </p>
    </section>
  );
}
