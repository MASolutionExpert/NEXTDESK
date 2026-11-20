'use client';

import dynamic from 'next/dynamic';

const NextDeskApp = dynamic(() => import('./NextDeskApp.jsx'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex min-h-screen w-full items-center justify-center bg-white dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3 text-center text-emerald-700 dark:text-emerald-300">
        <img src="/chatdesk-logo.svg" alt="NextDesk" className="h-10 w-10 animate-pulse" />
      </div>
    </div>
  ),
});

export default function NextDeskShell({ children }) {
  return (
    <>
      <NextDeskApp />
      <div className="sr-only" aria-hidden="true">
        {children}
      </div>
    </>
  );
}
