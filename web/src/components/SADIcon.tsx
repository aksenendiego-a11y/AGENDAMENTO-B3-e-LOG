import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  bookings: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h7" /></>,
  agenda: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M12 13v5M9.5 15.5h5" /></>,
  exceptions: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M9 14l6 5M15 14l-6 5" /></>,
  companies: <><path d="M4 21V5l8-2v18M12 8h8v13M2 21h20" /><path d="M7 7h2M7 11h2M7 15h2M15 12h2M15 16h2" /></>,
  upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
  audit: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5h6M8.5 12l2 2 5-5M8.5 17h7" /></>,
  trucks: <><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7z" /><circle cx="7.5" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
  drivers: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0M4 5l1.5 1.5M20 5l-1.5 1.5" /></>,
  cadastro: <><path d="M3 7h11v11H3zM14 11h4l3 3v4h-7" /><circle cx="7.5" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 4h5" /></>,
  invoices: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
};

export function SADIcon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.home}</svg>;
}
