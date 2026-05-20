import { NavLink, Outlet, useParams, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FolderOpen, Shield, FileText, Settings, LogOut, Zap } from 'lucide-react'
import { logout } from '../../lib/api/auth'
import clsx from 'clsx'

function getUserEmail(): string {
  try {
    const token = localStorage.getItem('cb_token')
    if (!token) return ''
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.email || payload.sub || ''
  } catch {
    return ''
  }
}

export function AppShell() {
  const { id: projectId } = useParams()
  const navigate = useNavigate()
  const userEmail = getUserEmail()

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
      isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
    )

  const handleLogout = () => {
    logout()
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 h-full w-64 bg-gray-900 text-white flex flex-col z-20">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-purple-400" />
            <span className="text-lg font-bold text-white">
              Circuit <span className="text-purple-400">Breaker</span>
            </span>
          </div>
        </div>

        {/* Main Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <NavLink to="/dashboard" className={navLinkClass}>
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </NavLink>
          <NavLink to="/projects" end className={navLinkClass}>
            <FolderOpen className="w-4 h-4" />
            Projects
          </NavLink>

          {/* Project sub-nav */}
          {projectId && (
            <div className="mt-4">
              <p className="px-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Project
              </p>
              <NavLink to={`/projects/${projectId}/rules`} className={navLinkClass}>
                <Shield className="w-4 h-4" />
                Rules
              </NavLink>
              <NavLink to={`/projects/${projectId}/logs`} className={navLinkClass}>
                <FileText className="w-4 h-4" />
                Logs
              </NavLink>
              <NavLink to={`/projects/${projectId}/settings`} className={navLinkClass}>
                <Settings className="w-4 h-4" />
                Settings
              </NavLink>
            </div>
          )}
        </nav>

        {/* Bottom: user info + logout */}
        <div className="px-3 py-4 border-t border-gray-800">
          {userEmail && (
            <p className="px-3 mb-2 text-xs text-gray-500 truncate" title={userEmail}>
              {userEmail}
            </p>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 flex-1 min-h-screen bg-gray-50">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default AppShell
