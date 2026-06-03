import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { RemindersProvider, useRemindersContext } from '../context/RemindersContext'

// ── Icons ─────────────────────────────────────────────────────────────────────

const Icon = ({ d, d2 }) => (
  <svg style={{ width: 20, height: 20, flexShrink: 0 }} fill="none" viewBox="0 0 24 24"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {d2 && <path d={d2} />}
  </svg>
)

const ICONS = {
  dashboard:   'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  mytasks:     'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  clients:     'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  instructors: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  bell:        'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  settings:    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  settings2:   'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  signout:     'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  menu:        'M4 6h16M4 12h16M4 18h16',
  close:       'M6 18L18 6M6 6l12 12',
}

// ── Desktop nav link ──────────────────────────────────────────────────────────

function DesktopLink({ to, label, bold }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded text-sm transition-colors ${
          isActive
            ? bold ? 'bg-gray-900 text-white font-semibold' : 'bg-gray-100 text-gray-900 font-medium'
            : bold ? 'text-gray-700 font-semibold hover:bg-gray-100' : 'text-gray-500 font-medium hover:text-gray-800 hover:bg-gray-50'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

function DesktopRemindersLink() {
  const { overdueCount } = useRemindersContext()
  return (
    <NavLink
      to="/reminders"
      className={({ isActive }) =>
        `relative px-3 py-1.5 rounded text-sm font-medium transition-colors ${
          isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
        }`
      }
    >
      Reminders
      {overdueCount > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          minWidth: 16, height: 16, borderRadius: 99,
          background: '#ef4444', color: '#fff',
          fontSize: 10, fontWeight: 700, lineHeight: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3px',
        }}>
          {overdueCount > 9 ? '9+' : overdueCount}
        </span>
      )}
    </NavLink>
  )
}

// ── Mobile bottom tab ─────────────────────────────────────────────────────────

function BottomTab({ to, label, iconKey, badge }) {
  return (
    <NavLink
      to={to}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
               justifyContent: 'center', gap: 2, paddingTop: 8, paddingBottom: 8,
               fontSize: 10, fontWeight: 500, textDecoration: 'none', position: 'relative' }}
      className={({ isActive }) => isActive ? 'text-gray-900' : 'text-gray-400'}
    >
      <Icon d={ICONS[iconKey]} d2={iconKey === 'settings' ? ICONS.settings2 : undefined} />
      {label}
      {badge > 0 && (
        <span style={{
          position: 'absolute', top: 4, left: '50%', marginLeft: 6,
          minWidth: 15, height: 15, borderRadius: 99,
          background: '#ef4444', color: '#fff',
          fontSize: 9, fontWeight: 700, lineHeight: '15px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3px',
        }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </NavLink>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Shell() {
  const { user, logout } = useAuth()
  const { overdueCount } = useRemindersContext()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
    setMenuOpen(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        position: 'sticky', top: 0, zIndex: 40,
        // Prevent any overflow
        overflow: 'hidden',
      }}>
        {/* Single row — flex, no wrap, no overflow */}
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          padding: '0 16px',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
          minWidth: 0,  // allow flex children to shrink
        }}>
          {/* Left: logo */}
          <span style={{ fontWeight: 700, fontSize: 16, color: '#111827',
                         whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
            BGM Office
          </span>

          {/* Desktop nav — display controlled entirely by .desktop-nav CSS class */}
          <nav className="desktop-nav" style={{ gap: 4, alignItems: 'center' }}>
            <DesktopLink to="/dashboard"   label="Dashboard" />
            <DesktopLink to="/my-tasks"    label="My Tasks" bold />
            <DesktopLink to="/clients"     label="Clients" />
            <DesktopLink to="/instructors" label="Instructors" />
            <DesktopRemindersLink />
            {user?.role === 'admin' && <DesktopLink to="/settings" label="Settings" />}
          </nav>

          {/* Right section */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Desktop: name + sign out — display controlled by .desktop-nav CSS class */}
            <span className="desktop-nav" style={{ alignItems: 'center',
                  gap: 6, fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, borderRadius: '50%',
                background: '#e5e7eb', color: '#374151', fontWeight: 700, fontSize: 11,
              }}>
                {user?.initials}
              </span>
              {user?.name}
            </span>
            <button className="desktop-nav"
              onClick={handleLogout}
              style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none',
                       cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Sign out
            </button>

            {/* Mobile: initials avatar — display controlled by .mobile-only CSS class */}
            <span className="mobile-only" style={{
              alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: '50%',
              background: '#e5e7eb', color: '#374151', fontWeight: 700, fontSize: 12,
            }}>
              {user?.initials}
            </span>

            {/* Mobile: hamburger — display controlled by .mobile-only CSS class */}
            <button
              className="mobile-only"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Menu"
              style={{
                alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: 8,
                background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280',
              }}
            >
              <Icon d={menuOpen ? ICONS.close : ICONS.menu} />
            </button>
          </div>
        </div>

        {/* Mobile dropdown (Settings + Sign out) — always block-level, no display:flex inline */}
        {menuOpen && (
          <div style={{
            borderTop: '1px solid #f3f4f6', background: '#fff',
            padding: '8px 16px 12px',
          }}>
            {user?.role === 'admin' && (
              <NavLink
                to="/settings"
                onClick={() => setMenuOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 12,
                         padding: '10px 12px', borderRadius: 8, textDecoration: 'none',
                         fontSize: 14, fontWeight: 500, color: '#374151' }}
              >
                <Icon d={ICONS.settings} d2={ICONS.settings2} />
                Settings
              </NavLink>
            )}
            <button
              onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                       padding: '10px 12px', borderRadius: 8,
                       fontSize: 14, color: '#dc2626', background: 'none', border: 'none',
                       cursor: 'pointer', textAlign: 'left' }}
            >
              <Icon d={ICONS.signout} />
              Sign out
            </button>
          </div>
        )}
      </header>

      {/* ── Page content ───────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1280, width: '100%', margin: '0 auto',
                     padding: '16px 12px 96px' }}
            className="main-content">
        <Outlet />
      </main>

      {/* ── Bottom tab bar — display controlled by .bottom-nav CSS class ──── */}
      <nav className="bottom-nav" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff', borderTop: '1px solid #e5e7eb',
        zIndex: 40,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        <BottomTab to="/dashboard"   label="Dashboard"   iconKey="dashboard" />
        <BottomTab to="/my-tasks"    label="My Tasks"    iconKey="mytasks" />
        <BottomTab to="/clients"     label="Clients"     iconKey="clients" />
        <BottomTab to="/instructors" label="Instructors" iconKey="instructors" />
        <BottomTab to="/reminders"   label="Reminders"   iconKey="bell" badge={overdueCount} />
      </nav>
    </div>
  )
}

export default function NavShell() {
  return (
    <RemindersProvider>
      <Shell />
    </RemindersProvider>
  )
}
