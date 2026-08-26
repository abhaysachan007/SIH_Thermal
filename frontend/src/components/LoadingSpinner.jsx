export default function LoadingSpinner({ message = 'Computing transient thermal matrix…', onCancel }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 max-w-sm w-full text-white">
        {/* Precision CAD Radar / Mesh Spinner */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-slate-700/60" />
          <div className="absolute inset-0 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
          <div className="absolute inset-3 rounded-full border border-orange-400/40 border-b-transparent animate-spin [animation-direction:reverse] [animation-duration:1.2s]" />
          <div className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
        </div>

        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <span className="font-mono text-xs text-sky-400 font-bold uppercase tracking-wider">
              THERMA·LADAKH ENGINE
            </span>
          </div>
          <h3 className="text-base font-bold text-slate-100">
            Numerical Simulation in Progress
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed font-mono pt-1">
            {message}
          </p>
        </div>

        {/* Minimal Progress Bar */}
        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden border border-slate-700">
          <div className="h-full bg-gradient-to-r from-sky-500 via-orange-500 to-sky-400 rounded-full animate-pulse w-full" />
        </div>

        <div className="flex items-center justify-between w-full text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/80">
          <span>Ladakh Winter Profile</span>
          <span>Δt = 30s · 24h cycle</span>
        </div>

        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-slate-400 hover:text-rose-400 transition-colors pt-1 hover:underline"
          >
            Cancel Computation
          </button>
        )}
      </div>
    </div>
  );
}
