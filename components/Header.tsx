"use client";



import { useState, useRef, useEffect } from "react";

import ThemeSwitcher from "@/components/ThemeSwitcher";

type EvaluationType = { id: number; name: string };

export default function Header({
  types,
  activeId,
  onSelect,
  onOpenConfig,
}: {
  types: EvaluationType[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onOpenConfig: () => void;
}) {

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);



  const activeType = types.find((t) => t.id === activeId);

  const title = activeType ? `Evaluador de ${activeType.name}` : "Evaluador";



  useEffect(() => {

    function handleClickOutside(e: MouseEvent) {

      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {

        setDropdownOpen(false);

      }

    }

    if (dropdownOpen) {

      document.addEventListener("mousedown", handleClickOutside);

      return () => document.removeEventListener("mousedown", handleClickOutside);

    }

  }, [dropdownOpen]);



  return (

    <header className="relative flex shrink-0 h-12 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 dark:border-gray-700 dark:bg-[#252526]">

      <div className="flex items-center gap-3 min-w-0">

        <h1 className="shrink-0 text-base font-semibold text-gray-800 dark:text-gray-100 truncate">

          {title}

        </h1>

        <div className="relative shrink-0" ref={dropdownRef}>

          <button

            type="button"

            onClick={() => setDropdownOpen((open) => !open)}

            className="rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200/60 focus:outline-none focus:ring-1 focus:ring-gray-400 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:bg-white/10 dark:focus:ring-gray-500"

          >

            Cambiar evaluador

          </button>

          {dropdownOpen && (

            <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-[#252526]">

              {types.map((t) => (

                <button

                  key={t.id}

                  type="button"

                  onClick={() => {

                    onSelect(t.id);

                    setDropdownOpen(false);

                  }}

                  className={`w-full px-4 py-2 text-left text-sm transition-colors focus:outline-none focus:bg-surface-hover ${
                    activeId === t.id
                      ? "bg-surface-elevated font-medium text-foreground"
                      : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                  }`}

                >

                  {t.name}

                </button>

              ))}

              {types.length === 0 && (

                <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">

                  No hay tipos configurados

                </div>

              )}

            </div>

          )}

        </div>

      </div>

      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-lg border border-gray-200 bg-white px-4 py-1 dark:border-gray-600 dark:bg-[#1e1e1e]">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Masivo</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeSwitcher />

        <button

          type="button"

          onClick={onOpenConfig}

          title="Configuración"

          aria-label="Configuración"

          className="shrink-0 flex items-center justify-center rounded p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200/60 focus:outline-none focus:ring-1 focus:ring-gray-400 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-white/10 dark:focus:ring-gray-500"

        >

          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>

            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />

            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />

          </svg>

        </button>

      </div>

    </header>

  );

}


