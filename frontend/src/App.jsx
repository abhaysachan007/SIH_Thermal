import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import InputPage from './pages/InputPage';
import ResultsPage from './pages/ResultsPage';

function NavigationHeader() {
  const location = useLocation();
  const isResults = location.pathname === '/results';

  return (
    <nav className="nav-shell">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <div className="nav-logo-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{color:'#000'}}>
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div>
            <div className="nav-wordmark">THERMA<span>·</span>LADAKH</div>
            <div className="nav-sub">High-Altitude Passive Thermal Simulation</div>
          </div>
        </Link>

        <div className="nav-pills" style={{display: 'flex'}}>
          <div className="nav-pill" style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
            <span className="dot" />
            <span style={{color: 'var(--text-3)'}}>LOC:</span>
            <span style={{color: 'var(--text-2)', fontWeight: 600}}>Leh 34.15°N · 3500m</span>
          </div>

          <div className="nav-pill" style={{display: 'none'}}>
            <span style={{color: 'var(--text-3)'}}>SOLVER:</span>
            <span style={{color: 'var(--ice)', fontWeight: 600}}>ANSYS FEA + FDM</span>
          </div>

          <div className="nav-badge" style={{display: 'inline-block'}}>v4.2 CAD</div>

          {isResults && (
            <Link
              to="/"
              className="btn-primary"
              style={{textDecoration:'none'}}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
              New Design
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)'}}>
        <NavigationHeader />

        <main style={{flex: 1, padding: '40px 0'}}>
          <div className="page-wrap">
            <Routes>
              <Route path="/" element={<InputPage />} />
              <Route path="/results" element={<ResultsPage />} />
            </Routes>
          </div>
        </main>

        <footer className="footer-shell">
          <div className="footer-inner">
            <span className="footer-brand">THERMA·LADAKH</span>
            <div className="footer-pills">
              <span className="footer-pill">FDM Implicit 1D/3D</span>
              <span className="footer-pill">ANSYS MAPDL SOLID70</span>
              <span className="footer-pill">ISO 13790 Compliant</span>
              <span className="footer-pill">NASA POWER Climate API</span>
            </div>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
