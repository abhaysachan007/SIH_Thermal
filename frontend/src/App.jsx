import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import InputPage from './pages/InputPage';
import ResultsPage from './pages/ResultsPage';
import { fetchLiveClimate } from './api/simulationApi';

function NavigationHeader() {
  const location = useLocation();
  const isResults = location.pathname === '/results';

  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md text-white border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand Logo & Name */}
        <Link to="/" className="flex items-center gap-3.5 group">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-inner shadow-white/20 border border-sky-400/30 group-hover:border-sky-400/60 transition-all">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
              <circle cx="12" cy="7" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-tight text-white font-mono">
                THERMA<span className="text-sky-400">·</span>LADAKH
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-semibold tracking-wider">
                v4.2 CAD
              </span>
            </div>
            <span className="text-[11px] text-slate-400 block font-normal leading-none mt-0.5">
              High-Altitude Passive Thermal Simulation Lab
            </span>
          </div>
        </Link>

        {/* Center / Right Environment Telemetry Badges */}
        <div className="hidden md:flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="text-slate-400">LOC:</span>
            <span className="font-semibold text-slate-200">Leh 34.15°N · 3500m</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
            <span className="text-slate-400">SOLVER:</span>
            <span className="font-semibold text-sky-400">ANSYS FEA + FDM</span>
          </div>

          {isResults && (
            <Link
              to="/"
              className="ml-2 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-sans text-xs font-semibold transition-all shadow-sm flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Design
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [liveClimate, setLiveClimate] = useState(null);
  const [isClimateLoading, setIsClimateLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    fetchLiveClimate()
      .then((climate) => setLiveClimate(climate?.ok ? climate : null))
      .catch(() => setLiveClimate(null))
      .finally(() => setIsClimateLoading(false));

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const sourceMonth = Number(liveClimate?.source_date?.slice(4, 6));
  const season = liveClimate?.season || (
    sourceMonth <= 2 || sourceMonth === 12 ? 'winter'
      : sourceMonth <= 5 ? 'spring'
        : sourceMonth <= 8 ? 'summer'
          : sourceMonth <= 11 ? 'autumn'
            : 'winter'
  );

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-50">
        <NavigationHeader />

        {isOffline && (
          <div
            role="status"
            className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-mono font-semibold text-amber-900"
          >
            ⚠ Offline — using cached climate data
          </div>
        )}

        {(isClimateLoading || liveClimate) && (
          <div
            className="bg-slate-900 px-4 py-2 text-center text-xs font-mono text-slate-200"
            title={liveClimate?.source_date ? `NASA POWER sample date: ${liveClimate.source_date}` : undefined}
          >
            {isClimateLoading
              ? 'Fetching Leh conditions...'
              : `Leh now: ${liveClimate.max_temp_C ?? liveClimate.min_temp_C}°C · Solar: ${liveClimate.peak_solar_W_m2} W/m² · ${season}`}
          </div>
        )}

        {/* Main Viewport Container */}
        <main className="flex-1 py-8 px-4 sm:px-6 max-w-7xl mx-auto w-full">
          <Routes>
            <Route path="/" element={<InputPage />} />
            <Route path="/results" element={<ResultsPage />} />
          </Routes>
        </main>

        {/* Technical Footer */}
        <footer className="bg-slate-950 text-slate-400 text-xs py-6 border-t border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-slate-300">THERMA·LADAKH</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">Passive Thermal Architecture & Numerical Computation for Extreme High-Altitude Climates</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono text-slate-500">
              <span>FDM Implicit 1D/3D</span>
              <span>•</span>
              <span>ANSYS MAPDL SOLID70</span>
              <span>•</span>
              <span>ISO 13790 Compliant</span>
            </div>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
