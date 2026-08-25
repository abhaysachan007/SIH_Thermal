import React from 'react';

export default function StepIndicator({ steps, currentStep }) {
  return (
    <div className="flex items-center w-full mb-8">
      {steps.map((step, idx) => {
        const isDone = idx < currentStep;
        const isCurrent = idx === currentStep;

        return (
          <React.Fragment key={idx}>
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                  isDone
                    ? 'bg-success text-white'
                    : isCurrent
                    ? 'bg-primary text-white ring-4 ring-primary/20 font-extrabold'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isDone ? 'OK' : idx + 1}
              </div>
              <span
                className={`text-xs mt-1.5 font-medium whitespace-nowrap ${
                  isCurrent ? 'text-primary font-bold' : 'text-gray-500'
                }`}
              >
                {step}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 transition-all duration-300 ${
                  idx < currentStep ? 'bg-success' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
