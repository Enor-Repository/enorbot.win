import { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Activity, BarChart3, ListTree, MessageSquare, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SystemStatus } from './SystemStatus'

interface LayoutProps {
  children: ReactNode
}

const navItems = [
  { to: '/overview', icon: Activity, label: 'Overview' },
  { to: '/groups', icon: ListTree, label: 'Groups & Rules' },
  { to: '/costs', icon: BarChart3, label: 'Costs' },
  { to: '/simulator', icon: MessageSquare, label: 'Simulator' },
]

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        {/* Logo/Title */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight">eNorBOT</h1>
              <p className="text-xs text-muted-foreground">Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )
                    }
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border text-xs text-muted-foreground">
          <p>v2.1.0 • Sprint 7B</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background relative">
        {/* System Status Indicator */}
        <SystemStatus />

        <div className="container mx-auto p-8 max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  )
}
