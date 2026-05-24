import './index.css';

import { navigateTo } from '@devvit/web/client';
import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="relative flex flex-col justify-center items-center min-h-screen p-6 bg-gradient-to-br from-orange-50 via-white to-rose-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-50 dark:opacity-30">
        <div className="absolute top-[-40%] left-[-20%] w-[60%] h-[60%] rounded-full bg-orange-300/30 dark:bg-orange-500/20 blur-3xl" />
        <div className="absolute bottom-[-30%] right-[-15%] w-[50%] h-[50%] rounded-full bg-rose-300/30 dark:bg-rose-500/20 blur-3xl" />
      </div>

      <div className="relative max-w-sm w-full text-center">
        <img
          src="/huddle-logo.svg"
          alt="Huddle"
          className="mx-auto w-16 h-16 rounded-2xl shadow-xl shadow-orange-500/30 mb-5 select-none"
        />

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight mb-1">
          Huddle
        </h1>
        <p className="text-base text-gray-700 dark:text-gray-200 mb-1">
          The modqueue, with intelligence.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-7">
          Hey {context.username ?? 'mod'} — grouped reports, factual AI
          summaries, one-click verification.
        </p>

        <button
          className="group inline-flex items-center justify-center gap-2 px-6 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white font-semibold shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/40 hover:scale-[1.02] active:scale-100 transition-all"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          Open queue
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </button>
      </div>

      <footer className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
        <button
          className="hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => navigateTo('https://github.com/thamothara7/Huddle')}
        >
          GitHub
        </button>
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <button
          className="hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => navigateTo('https://arxiv.org/abs/2509.07314')}
        >
          Research
        </button>
        <span className="text-gray-300 dark:text-gray-700">·</span>
        <button
          className="hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => navigateTo('https://developers.reddit.com/docs')}
        >
          Devvit
        </button>
      </footer>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
