export function FlowConnector({ variant = "main" }: { variant?: "main" | "branch" }) {
  if (variant === "branch") {
    return (
      <div className="flex items-center justify-center py-1" aria-hidden>
        <div className="h-8 w-px border-l-2 border-dashed border-emerald-400 dark:border-emerald-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-1" aria-hidden>
      <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />
      <svg className="h-3 w-3 text-gray-400 dark:text-gray-500" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 9L1 4h10L6 9z" />
      </svg>
    </div>
  );
}
