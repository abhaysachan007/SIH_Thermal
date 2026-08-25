export default function LoadingSpinner({ message = 'Running thermal simulation…', onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-6 max-w-sm w-full mx-4">
        {/* Spinner */}
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <div className="absolute inset-2 rounded-full border-4 border-accent/30 border-b-transparent animate-spin [animation-direction:reverse] [animation-duration:1.5s]" />
          <div className="absolute inset-0 flex items-center justify-center text-2xl">🏠</div>
        </div>

        <div className="text-center">
          <h3 className="text-lg font-bold text-primary mb-1">Simulating…</h3>
          <p className="text-sm text-gray-600">{message}</p>
        </div>

        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-accent rounded-full animate-pulse w-3/4" />
        </div>

        <p className="text-xs text-gray-400 text-center">
          Running 24-hour thermal analysis for Ladakh conditions…
        </p>

        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-500 hover:text-red-500 border border-gray-200 rounded-lg hover:border-red-300 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
