
import re, sys

with open('/home/user/input/input_1.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ════════════════════════════════════════════════
#  WHITE-GREEN THEME OVERRIDE
#  แทรก <style> ก่อน </head>
# ════════════════════════════════════════════════

THEME_CSS = """
<style id="wg-theme">
/* ══════════════════════════════════════════════════
   WHITE-GREEN THEME — ระบบสต๊อก IT & แจ้งซ่อม
   สีหลัก : #16a34a (green-600) / #15803d (green-700)
   พื้นหลัง: #f8fafc (slate-50)
   ══════════════════════════════════════════════════ */
:root {
  --bg-body       : #f0f4f0 !important;
  --bg-surface    : #ffffff !important;
  --bg-nav        : #15803d !important;
  --bg-nav2       : #166534 !important;
  --bg-nav3       : #14532d !important;
  --bg-header     : #16a34a !important;
  --text-main     : #111827 !important;
  --text-muted    : #4b5563 !important;
  --text-nav      : #ffffff !important;
  --text-nav-muted: rgba(255,255,255,0.72) !important;
  --accent        : #16a34a !important;
  --accent-light  : #dcfce7 !important;
  --accent-dark   : #14532d !important;
  --border-color  : #d1fae5 !important;
  --shadow        : 0 2px 8px rgba(22,163,74,0.10) !important;
  --card-bg       : #ffffff !important;
  --input-bg      : #f0fdf4 !important;
  --input-border  : #bbf7d0 !important;
  --table-head    : #f0fdf4 !important;
  --table-stripe  : #f7fef9 !important;
  --badge-ok      : #dcfce7 !important;
  --badge-ok-text : #15803d !important;
  --danger        : #dc2626 !important;
  --warning       : #d97706 !important;
}

/* ── Body / App background ── */
body, #app-layout, .main-area, main {
  background: var(--bg-body) !important;
  color: var(--text-main) !important;
}

/* ── Top Header Bar ── */
#app-header, .app-header, header {
  background: linear-gradient(135deg, #16a34a 0%, #15803d 100%) !important;
  border-bottom: 1px solid #14532d !important;
  box-shadow: 0 2px 12px rgba(22,163,74,0.25) !important;
  color: #fff !important;
}
#app-header *, .app-header * { color: #fff !important; }
#app-header .btn-outline,
#app-header button { border-color: rgba(255,255,255,0.4) !important; }

/* ── Sidebar / Nav ── */
nav, .sidebar, .side-nav, .nav-wrap {
  background: linear-gradient(180deg, #15803d 0%, #166534 60%, #14532d 100%) !important;
  border-right: 1px solid rgba(255,255,255,0.10) !important;
}
nav *, .sidebar * {
  color: rgba(255,255,255,0.92) !important;
}
.nav-item, .nav-link, [class*="nav-item"] {
  color: rgba(255,255,255,0.88) !important;
  border-radius: 8px !important;
}
.nav-item:hover, .nav-link:hover, [class*="nav-item"]:hover {
  background: rgba(255,255,255,0.13) !important;
  color: #fff !important;
}
.nav-item.active, .nav-item.selected, .nav-link.active,
[class*="nav-item"].active {
  background: rgba(255,255,255,0.20) !important;
  color: #fff !important;
  font-weight: 600 !important;
  border-left: 3px solid #bbf7d0 !important;
}
.nav-section-label, .nav-label {
  color: rgba(255,255,255,0.55) !important;
  font-size: 10px !important;
  text-transform: uppercase !important;
}
/* Avatar ใน nav */
.nav-avatar, #nav-avatar, .u-avatar {
  background: rgba(255,255,255,0.22) !important;
  color: #fff !important;
  border: 2px solid rgba(255,255,255,0.35) !important;
}

/* ── Cards ── */
.card, .panel, .box,
[class*="card"]:not([class*="badge"]):not([class*="color-card"]) {
  background: #ffffff !important;
  border: 1px solid #d1fae5 !important;
  border-radius: 12px !important;
  box-shadow: 0 1px 6px rgba(22,163,74,0.07) !important;
  color: var(--text-main) !important;
}

/* ── Page titles / headings ── */
.page-hd h1, .page-title, .section-title,
h1, h2, h3 {
  color: #15803d !important;
}

/* ── Buttons ── */
.btn-primary, .btn-green, .btn-success,
button.primary, button[class*="green"] {
  background: linear-gradient(135deg, #16a34a, #15803d) !important;
  color: #fff !important;
  border: none !important;
  box-shadow: 0 2px 8px rgba(22,163,74,0.30) !important;
}
.btn-primary:hover, .btn-green:hover {
  background: linear-gradient(135deg, #15803d, #14532d) !important;
}
.btn-outline, .btn-secondary {
  background: transparent !important;
  border: 1px solid #16a34a !important;
  color: #16a34a !important;
}
.btn-outline:hover { background: #f0fdf4 !important; }
.btn-danger, .btn-red { background: #dc2626 !important; color: #fff !important; border: none !important; }
.btn-warning        { background: #d97706 !important; color: #fff !important; border: none !important; }

/* ── Tables ── */
table { border-collapse: collapse !important; width: 100% !important; }
thead, thead tr, thead th, .table-header, .th {
  background: #f0fdf4 !important;
  color: #15803d !important;
  font-weight: 600 !important;
  border-bottom: 2px solid #bbf7d0 !important;
}
tbody tr, .table-row {
  background: #ffffff !important;
  border-bottom: 1px solid #f0fdf4 !important;
  color: var(--text-main) !important;
}
tbody tr:nth-child(even), .table-row:nth-child(even) {
  background: #f7fef9 !important;
}
tbody tr:hover, .table-row:hover {
  background: #ecfdf5 !important;
}
td, th, .table-cell { color: var(--text-main) !important; }

/* ── Inputs / Select / Textarea ── */
input, select, textarea, .form-control, .input {
  background: #f0fdf4 !important;
  border: 1px solid #bbf7d0 !important;
  color: #111827 !important;
  border-radius: 8px !important;
}
input:focus, select:focus, textarea:focus, .form-control:focus {
  border-color: #16a34a !important;
  outline: none !important;
  box-shadow: 0 0 0 3px rgba(22,163,74,0.15) !important;
  background: #fff !important;
}
label { color: #374151 !important; font-weight: 500 !important; }

/* ── Modals ── */
.modal-wrap, .modal-backdrop, .overlay {
  background: rgba(0,0,0,0.40) !important;
}
.modal, .modal-box, .modal-container, .modal-content {
  background: #ffffff !important;
  border: 1px solid #d1fae5 !important;
  border-radius: 16px !important;
  color: var(--text-main) !important;
  box-shadow: 0 8px 40px rgba(22,163,74,0.18) !important;
}
.modal-hd, .modal-header {
  background: #f0fdf4 !important;
  border-bottom: 1px solid #d1fae5 !important;
  border-radius: 16px 16px 0 0 !important;
}
.modal-hd h2, .modal-header h2,
.modal-hd h3, .modal-header h3 { color: #15803d !important; }

/* ── Badges / Status chips ── */
.badge, .chip, .tag, .status-badge, [class*="badge"] {
  border-radius: 20px !important;
  font-weight: 600 !important;
  font-size: 12px !important;
}
.b-ok, .badge-success, .badge-issued, .badge-approved,
[class*="badge"][class*="ok"], [class*="badge"][class*="success"] {
  background: #dcfce7 !important; color: #15803d !important;
}
.b-warn, .badge-pending, .badge-warning,
[class*="badge"][class*="pending"], [class*="badge"][class*="warn"] {
  background: #fef9c3 !important; color: #92400e !important;
}
.b-danger, .badge-rejected, .badge-error,
[class*="badge"][class*="danger"], [class*="badge"][class*="error"] {
  background: #fee2e2 !important; color: #991b1b !important;
}
.b-info, .badge-info, .badge-checking,
[class*="badge"][class*="info"] {
  background: #dbeafe !important; color: #1d4ed8 !important;
}
.b-admin    { background: #ede9fe !important; color: #5b21b6 !important; }
.b-manager  { background: #dbeafe !important; color: #1e40af !important; }
.b-warehouse{ background: #dcfce7 !important; color: #166534 !important; }
.b-staff    { background: #f3f4f6 !important; color: #374151 !important; }

/* ── KPI / Stat cards ── */
.stat-card, .kpi-card, .metric-card {
  background: #ffffff !important;
  border-left: 4px solid #16a34a !important;
  border-radius: 12px !important;
  box-shadow: 0 2px 10px rgba(22,163,74,0.10) !important;
}
.stat-num, .kpi-num { color: #15803d !important; }
.stat-label, .kpi-label { color: #4b5563 !important; }

/* ── Toast / Snackbar ── */
.toast, .snackbar, #toast-wrap > div {
  background: #15803d !important;
  color: #fff !important;
  border-radius: 10px !important;
  box-shadow: 0 4px 16px rgba(22,163,74,0.30) !important;
}

/* ── Search bar ── */
.search-bar, .search-input, input[type="search"] {
  background: #f0fdf4 !important;
  border: 1px solid #bbf7d0 !important;
}

/* ── Tabs / Pills ── */
.tab-bar, .tabs { border-bottom: 2px solid #d1fae5 !important; }
.tab-item, .tab { color: #6b7280 !important; }
.tab-item.active, .tab.active {
  color: #15803d !important;
  border-bottom: 2px solid #16a34a !important;
  font-weight: 600 !important;
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #f0fdf4; }
::-webkit-scrollbar-thumb { background: #86efac; border-radius: 6px; }
::-webkit-scrollbar-thumb:hover { background: #16a34a; }

/* ── Sync badge ── */
#sync-status-badge {
  background: rgba(22,163,74,0.12) !important;
  border: 1px solid rgba(22,163,74,0.35) !important;
  color: #15803d !important;
}

/* ── Login screen ── */
#screen-login {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%) !important;
}
.login-card, .login-box {
  background: #ffffff !important;
  border: 1px solid #d1fae5 !important;
  border-radius: 20px !important;
  box-shadow: 0 8px 32px rgba(22,163,74,0.15) !important;
}

/* ── Section headers ── */
.section-hd, .top-bar { border-bottom: 1px solid #d1fae5 !important; }

/* ── Low-stock row ── */
.low-stock, .row-danger { background: #fef2f2 !important; }
.low-stock td, .row-danger td { color: #991b1b !important; }

/* ── Progress bars ── */
.progress-bar, .prog-fill { background: #16a34a !important; }
.progress-track { background: #d1fae5 !important; }

/* ── กล่องสีเดิมที่เป็นสีเข้ม — override ── */
[style*="background:#0"] , [style*="background: #0"],
[style*="background:#1"] , [style*="background: #1"],
[style*="background:#2"] , [style*="background: #2"] {
  /* ปล่อยให้ข้างบน override เฉพาะที่ใช้ class แล้ว */
}
</style>
"""

# แทรก CSS ก่อน </head>
if '</head>' in html:
    html = html.replace('</head>', THEME_CSS + '\n</head>', 1)
else:
    html = THEME_CSS + html

with open('/home/user/output/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

# ── Verify ──
import re
green_count = len(re.findall(r'#16a34a|#15803d|#14532d', html))
print(f"size={len(html)} green_vars={green_count} DONE")
