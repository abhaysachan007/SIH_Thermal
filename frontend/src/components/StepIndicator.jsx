import React from 'react';

export default function StepIndicator({ steps, currentStep }) {
  return (
    <div className="w-full mb-8">
      {/* Step Numbers & Labels Container */}
      <div className="flex items-center justify-between relative">
        {/* Background Connecting Track */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-[2px] bg-slate-200 -z-0" />
        {/* Active Progress Track */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] bg-sky-600 transition-all duration-500 ease-out -z-0"
          style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
        />

        {steps.map((step, idx) => {
          const isDone = idx < currentStep;
          const isCurrent = idx === currentStep;

          return (
            <div key={idx} className="flex flex-col items-center relative z-10 bg-slate-50 px-2 sm:px-4">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-mono text-xs font-bold transition-all duration-300 border ${
                  isDone
                    ? 'bg-slate-900 border-slate-900 text-sky-400 shadow-sm'
                    : isCurrent
                    ? 'bg-sky-600 border-sky-500 text-white ring-4 ring-sky-100 shadow-sm scale-105'
                    : 'bg-white border-slate-300 text-slate-400'
                }`}
              >
                {isDone ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>0{idx + 1}</span>
                )}
              </div>

              <div className="text-center mt-2">
                <span
                  className={`text-xs block tracking-tight ${
                    isCurrent
                      ? 'font-bold text-slate-900'
                      : isDone
                      ? 'font-medium text-slate-700'
                      : 'font-normal text-slate-400'
                  }`}
                >
                  {step}
                </span>
                <span className="text-[10px] font-mono text-slate-400 block -mt-0.5">
                  {idx === 0 ? 'Envelope' : idx === 1 ? 'Thermal Mass' : idx === 2 ? 'Solar Azimuth' : 'Verification'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
