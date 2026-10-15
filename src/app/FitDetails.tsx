import type { ReactNode } from "react";

// "Fit with your goals" is open for every verdict, including SKIP.
export default function FitDetails({ children }: { children: ReactNode }) {
  return (
    <details
      className="group rounded-xl border border-gray-200 bg-white shadow-sm"
      open
    >
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-gray-700 sm:px-6">
        <span>Fit with your goals</span>
        <span
          aria-hidden="true"
          className="select-none text-gray-500 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-gray-100 px-5 py-4 sm:px-6">
        {children}
      </div>
    </details>
  );
}
