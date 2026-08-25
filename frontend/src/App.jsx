import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import InputPage from './pages/InputPage';
import ResultsPage from './pages/ResultsPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-surface">
        {/* Navbar */}
        <header className="bg-primary text-white shadow-md">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <span className="bg-accent text-white font-bold px-2.5 py-1 rounded text-sm tracking-wide">
                SIH
              </span>
              <div>
                <span className="font-bold text-lg leading-tight block">
                  ThermalShelter
                </span>
                <span className="text-xs text-blue-200 block font-normal">
                  Ladakh Passive Shelter Thermal Optimizer
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-4 text-xs text-blue-100 font-medium">
              <span className="bg-white/10 px-3 py-1.5 rounded-full border border-white/20">
                High-Altitude Cold Desert Physics Engine
              </span>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<InputPage />} />
            <Route path="/results" element={<ResultsPage />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="bg-primary-dark text-blue-200 text-xs py-4 border-t border-white/10">
          <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
            <p>ThermalShelter - Passive Design Optimization for High-Altitude Cold Climates</p>
            <p className="text-blue-300">FastAPI + FDM Physics Simulation</p>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
