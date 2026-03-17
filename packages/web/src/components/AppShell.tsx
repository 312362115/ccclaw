import { Outlet } from 'react-router-dom';
import { IconSidebar } from './IconSidebar';

export function AppShell() {
  return (
    <div className="flex h-dvh w-screen">
      <IconSidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
