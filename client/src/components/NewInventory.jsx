import { useState, useMemo, useEffect } from 'react'
import Button from './ui/Button'
import Input from './ui/Input'
import Modal from './ui/Modal'
import Badge from './ui/Badge'
import Icon from './ui/Icon'
import {
  REGIONS,
  INVENTORY_CATEGORIES,
  STATUS_LIST,
  ENGINEERS,
  INITIAL_INVENTORY,
  INITIAL_AUDIT,
} from '../data/inventory'

// ─── API Config ───────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3001'

function getToken() {
  try { return localStorage.getItem('accessToken') } catch { return null }
}
function storeToken(token) {
  try { localStorage.setItem('accessToken', token) } catch {}
}
function clearToken() {
  try { localStorage.removeItem('accessToken') } catch {}
}
function getRefreshToken() {
  try { return localStorage.getItem('refreshToken') } catch { return null }
}
function storeRefreshToken(token) {
  try { localStorage.setItem('refreshToken', token) } catch {}
}
function clearRefreshToken() {
  try { localStorage.removeItem('refreshToken') } catch {}
}

// Prevent multiple simultaneous refresh calls
let _refreshPromise = null

async function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) throw new Error('No refresh token')
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'Token refresh failed')
    const newToken =
      data.accessToken || data.access_token || data.token ||
      data.data?.accessToken || data.data?.token
    if (!newToken) throw new Error('No access token in refresh response')
    storeToken(newToken)
    const newRefresh =
      data.refreshToken || data.refresh_token ||
      data.data?.refreshToken || data.data?.refresh_token
    if (newRefresh) storeRefreshToken(newRefresh)
    return newToken
  })()
  try {
    return await _refreshPromise
  } finally {
    _refreshPromise = null
  }
}

async function apiFetch(path, options = {}, _retry = false) {
  const token = getToken()

  if (!token && !_retry) {
    throw new Error('Authentication required. Please sign in again.')
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  // Auto-refresh on 401 then retry once
  if (res.status === 401 && !_retry) {
    try {
      console.log('[Auth] Access token expired — refreshing...')
      await refreshAccessToken()
      console.log('[Auth] Token refreshed — retrying request...')
      return apiFetch(path, options, true)
    } catch (refreshErr) {
      console.error('[Auth] Token refresh failed:', refreshErr.message)
      clearToken()
      clearRefreshToken()
      try { localStorage.removeItem('currentUser') } catch {}
      window.dispatchEvent(new Event('auth-expired'))
      throw new Error('Session expired. Please sign in again.')
    }
  }

  const json = await res.json().catch(() => ({}))

  if (res.status === 401) {
    clearToken()
    clearRefreshToken()
    try { localStorage.removeItem('currentUser') } catch {}
    window.dispatchEvent(new Event('auth-expired'))
    throw new Error(json.message || json.error || 'Session expired. Please sign in again.')
  }

  if (!res.ok) {
    console.error(`[API ${res.status}] ${path}`, json)
    let msg = ''
    if (Array.isArray(json.issues) && json.issues.length > 0) {
      msg = json.issues.map(e => {
        const field = Array.isArray(e.path) ? e.path.join('.') : (e.field || e.param || '')
        const message = e.message || e.msg || JSON.stringify(e)
        return field ? `${field}: ${message}` : message
      }).join(' • ')
    } else if (Array.isArray(json.errors) && json.errors.length > 0) {
      msg = json.errors.map(e => e.message || e.msg || JSON.stringify(e)).join(' • ')
    } else if (Array.isArray(json.details) && json.details.length > 0) {
      msg = json.details.map(e => e.message || JSON.stringify(e)).join(' • ')
    } else {
      msg = json.message || json.error || json.detail || `API error ${res.status}`
    }
    throw new Error(msg)
  }
  return json
}
// ─────────────────────────────────────────────────────────────────────────────

let barcodeCounter = 9
let auditIdCounter = 4
let sourceIdCounter = 1

function generateBarcode() {
  const num = String(barcodeCounter++).padStart(6, '0')
  return `P3-IND-${num}`
}

function generateSourceId() {
  const num = String(sourceIdCounter++).padStart(4, '0')
  return `SRC-${num}`
}

function generateAuditEntry(user, action, item, prev, next) {
  return { id: auditIdCounter++, user, action, item, prev, next, timestamp: new Date().toLocaleString() }
}

function P3Logo({ height = 28 }) {
  return (
    <svg height={height} viewBox="0 0 120 64" xmlns="http://www.w3.org/2000/svg" aria-label="P3 logo">
      <path d="M8 4 L8 60 L24 54 L24 38 C36 38 46 30 46 19 C46 8 36 4 24 4 Z M24 14 C30 14 34 16 34 19 C34 22 30 26 24 26 Z" fill="#1d4ed8" />
      <path d="M58 4 L100 4 L100 16 L78 16 L78 24 L92 24 C100 24 106 30 106 40 C106 52 96 60 82 60 C70 60 60 54 58 44 L70 41 C71 47 76 50 82 50 C89 50 94 46 94 40 C94 35 90 32 84 32 L66 32 L66 22 L88 14 L58 14 Z" fill="#1d4ed8" />
    </svg>
  )
}

function Dashboard({ inventory, currentUser }) {
  const isEngineer = currentUser?.role === 'Engineer'
  const counts = useMemo(() => {
    const c = {}
    STATUS_LIST.forEach(s => { c[s] = inventory.filter(i => i.status === s).length })
    return c
  }, [inventory])

  const byCategory = INVENTORY_CATEGORIES.map(cat => ({
    cat,
    available: inventory.filter(i => i.category === cat && i.status === 'Available').length,
    total: inventory.filter(i => i.category === cat).length,
  }))

  const byRegion = REGIONS.map(r => ({
    r,
    count: inventory.filter(i => i.region === r).length,
  }))

  const allOverdue = inventory.filter(i => i.expectedReturn && new Date(i.expectedReturn) < new Date() && i.status === 'Allocated')
  const overdue = isEngineer ? allOverdue.filter(i => i.engineer === currentUser.name) : allOverdue

  const NOT_ACCESSIBLE_STATUSES = ['Lost', 'Damaged', 'Retired', 'Reserved']
  const notAccessibleItems = inventory.filter(i => NOT_ACCESSIBLE_STATUSES.includes(i.status))
  const notAccessibleCount = notAccessibleItems.length

  const STATUS_COLOR_MAP = {
    Available: '#16a34a', Reserved: '#d97706', Allocated: '#2563eb',
    Returned: '#059669', Lost: '#dc2626', Damaged: '#ea580c',
    Repair: '#7c3aed', Retired: '#6b7280',
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 24px', fontSize: 22, fontWeight: 800, color: '#111827' }}>Dashboard</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#2563eb' }}>{inventory.length}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Total Inventory</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#16a34a' }}>{counts.Available}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Available</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#d97706' }}>{counts.Allocated}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Allocated</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#059669' }}>{counts.Returned}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Returned</div>
        </div>
        <div style={{ background: '#fff', border: '1.5px solid #fca5a5', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#dc2626' }}>{notAccessibleCount}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Not Accessible</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Lost · Damaged · Retired · Reserved</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#374151' }}>Category Summary</h3>
          {byCategory.map(({ cat, available, total }) => (
            <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{cat}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 12, background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>{available} avail</span>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{total} total</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#374151' }}>Region Summary</h3>
          {byRegion.map(({ r, count }) => (
            <div key={r} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{r}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#2563eb' }}>{count} items</span>
            </div>
          ))}
        </div>
      </div>

      {/* Not Accessible Section */}
      <div style={{ background: '#fff', border: '1.5px solid #fca5a5', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#dc2626' }}>Not Accessible</h3>
          <span style={{ fontSize: 12, background: '#fee2e2', color: '#dc2626', padding: '2px 10px', borderRadius: 99, fontWeight: 700, marginLeft: 4 }}>{notAccessibleCount} items</span>
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 4 }}>Lost · Damaged · Retired · Reserved</span>
        </div>
        {notAccessibleItems.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>No items in this category.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fef2f2', borderBottom: '1px solid #fca5a5' }}>
                  {['Item ID', 'Name', 'Category', 'Region', 'Status', 'Remarks'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {notAccessibleItems.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #fef2f2', background: idx % 2 === 0 ? '#fff' : '#fffbfb' }}>
                    <td style={{ padding: '9px 12px', fontWeight: 700, color: '#dc2626' }}>{item.id}</td>
                    <td style={{ padding: '9px 12px', color: '#111827' }}>{item.name}</td>
                    <td style={{ padding: '9px 12px', color: '#6b7280' }}>{item.category}</td>
                    <td style={{ padding: '9px 12px', color: '#6b7280' }}>{item.region}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <span style={{ background: STATUS_COLOR_MAP[item.status] + '20', color: STATUS_COLOR_MAP[item.status], border: `1px solid ${STATUS_COLOR_MAP[item.status]}40`, padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{item.status}</span>
                    </td>
                    <td style={{ padding: '9px 12px', color: '#9ca3af', fontStyle: item.remarks ? 'normal' : 'italic' }}>{item.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#374151' }}>
          ⚠ {isEngineer ? 'My Pending / Overdue Returns' : 'Pending / Overdue Returns'}
        </h3>
        {overdue.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>{isEngineer ? 'You have no overdue returns.' : 'No overdue returns.'}</p>
        ) : overdue.map(item => (
          <div key={item.id} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{item.name}</span>
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>{item.id}</span>
            </div>
            {!isEngineer && <span style={{ fontSize: 13, color: '#374151' }}>{item.engineer}</span>}
            <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Due: {item.expectedReturn}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function InventoryTable({ inventory, setInventory, auditLog, setAuditLog, role, locations, categories, rawLocations, rawCategories, locLoading, catLoading, locError, catError, currentUser }) {
  const [region, setRegion] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showEdit, setShowEdit] = useState(null)
  const [showAllocate, setShowAllocate] = useState(null)
  const [showReturn, setShowReturn] = useState(null)

  const emptyForm = { id: '', name: '', type: '', category: '3PL AA/CP', serial: '', asset: '', barcode: generateBarcode(), region: 'Bengaluru', engineer: '', receivedDate: '', returnDate: '', status: 'Available', remarks: '', quantity: 1, allocationDate: '', expectedReturn: '', sourceType: 'Client', sourceId: '', sourceName: '', sourceCompany: '', sourceAddress: '', sourcePhone: '', sourceEmail: '', sourceWebsite: '', sourceRemark: '', model: '', purchase_date: '', purchase_price: '', invoice_number: '', warranty_expiry: '', assigned_to: '', assignedToId: '', assigned_since: '', next_maintenance_date: '' }
  const [form, setForm] = useState(emptyForm)

  const filtered = useMemo(() => inventory.filter(i =>
    (!region || i.region === region) &&
    (!category || i.category === category) &&
    (!statusFilter || i.status === statusFilter) &&
    (!search || [i.id, i.name, i.serial, i.barcode, i.engineer].join(' ').toLowerCase().includes(search.toLowerCase()))
  ), [inventory, region, category, statusFilter, search])

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  // ── Fetch real users from /api/users for Assigned To dropdown ────────────
  const [rawUsers, setRawUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState(null)

  useEffect(() => {
    setUsersLoading(true)
    apiFetch('/api/users')
      .then(data => {
        console.log('[Users API response]', data)
        const list = Array.isArray(data) ? data : (data.users || data.data || data.results || data.items || [])
        const active = list.filter(u => u.is_active !== false)
        console.log('[Users loaded]', active.length, 'users')
        setRawUsers(active)
        setUsersError(null)
      })
      .catch(err => {
        console.error('[Users fetch failed]', err.message)
        setUsersError(err.message)
      })
      .finally(() => setUsersLoading(false))
  }, [])
  // ───────────────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    // ── Frontend validation ───────────────────────────────────────────────────
    const errors = {}
    if (!form.name?.trim())       errors.name        = 'Brand is required'
    if (!form.type?.trim())       errors.type        = 'Name is required'
    if (!form.category_id)        errors.category_id = 'Please select a Category'
    if (!form.serial?.trim())     errors.serial      = 'Serial Number is required'
    if (!form.asset?.trim())      errors.asset       = 'Asset Tag is required'
    if (!form.location_id)        errors.location_id = 'Please select a Region'
    if (!form.status)             errors.status      = 'Status is required'
    if (!form.quantity || Number(form.quantity) < 1) errors.quantity = 'Quantity must be at least 1'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setSaveError('Please fill in all required fields highlighted below.')
      return
    }
    setFieldErrors({})
    // ─────────────────────────────────────────────────────────────────────────
    setSaveError('')
    setSaving(true)
    try {
      // Map frontend status labels → exact backend enum values
      const STATUS_MAP = {
        'Available': 'available',
        'Allocated': 'assigned',
        'Reserved':  'assigned',
        'Returned':  'available',
        'Lost':      'lost',
        'Damaged':   'maintenance',
        'Repair':    'maintenance',
        'Retired':   'retired',
        'Disposed':  'disposed',
      }
      const mappedStatus = STATUS_MAP[form.status] || 'available'

      // Build payload with ONLY fields the backend /api/assets accepts







      // Build payload with ONLY fields the backend /api/assets accepts
      const payload = {
        name:                  form.type?.trim(),
        asset_tag:             form.asset?.trim() || undefined,
        serial_number:         form.serial?.trim(),
        brand:                 form.name?.trim() || undefined,
        model:                 form.model?.trim() || undefined,
        category_id:           form.category_id || undefined,
        location_id:           form.location_id || undefined,
        status:                mappedStatus,
        notes:                 form.remarks?.trim() || undefined,
        barcode:               form.barcode || generateBarcode(),
        purchase_date:         form.purchase_date || undefined,
        purchase_price:        form.purchase_price !== '' && form.purchase_price != null ? Number(form.purchase_price) : undefined,
        invoice_number:        form.invoice_number?.trim() || undefined,
        warranty_expiry:       form.warranty_expiry || undefined,
        assigned_to:           form.assignedToId || undefined,  // UUID from DB
        assigned_since:        form.assigned_since || undefined,
        next_maintenance_date: form.next_maintenance_date || undefined,
      }

      // Source details — only include if at least a name was entered
      if (form.sourceName?.trim()) {
        payload.source_type    = form.sourceType || 'Client'
        payload.source_name    = form.sourceName.trim()
        payload.source_company = form.sourceCompany?.trim() || undefined
        payload.source_phone   = form.sourcePhone?.trim() || undefined
        payload.source_email   = form.sourceEmail?.trim() || undefined
        payload.source_website = form.sourceWebsite?.trim() || undefined
        payload.source_address = form.sourceAddress?.trim() || undefined
        payload.source_remark  = form.sourceRemark?.trim() || undefined
      }

      // Remove undefined keys before sending
      Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])

      // DEBUG — remove after confirming fields are correct
      console.log('[Asset Create] Payload being sent:', JSON.stringify(payload, null, 2))

      const created = await apiFetch('/api/assets', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      // Use the ID returned by backend; fall back to frontend-generated
      const newItem = {
        ...form,
        id: created?.id || created?.asset_tag || form.id || `INV-${Date.now()}`,
        barcode: created?.barcode || payload.barcode,
        sourceId: created?.source_id || payload.source_id,
      }

      setInventory(inv => [...inv, newItem])
      setAuditLog(al => [...al, generateAuditEntry(currentUser?.name || 'User', 'Inventory Added', newItem.id, '–', form.status)])
      setShowAdd(false)
      setForm(emptyForm)
    } catch (err) {
      setSaveError(err.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async () => {
    setSaveError('')
    setSaveError('')
    setSaving(true)
    try {
      const STATUS_MAP = {
        'Available': 'available',
        'Allocated': 'assigned',
        'Reserved':  'assigned',
        'Returned':  'available',
        'Lost':      'lost',
        'Damaged':   'maintenance',
        'Repair':    'maintenance',
        'Retired':   'retired',
        'Disposed':  'disposed',
      }
      const mappedStatus = STATUS_MAP[form.status] || 'available'

      const assetPayload = {
        name:                  form.type?.trim(),
        asset_tag:             form.asset?.trim() || undefined,
        serial_number:         form.serial?.trim(),
        brand:                 form.name?.trim() || undefined,
        model:                 form.model?.trim() || undefined,
        category_id:           form.category_id || undefined,
        location_id:           form.location_id || undefined,
        status:                mappedStatus,
        notes:                 form.remarks?.trim() || undefined,
        barcode:               form.barcode || undefined,
        purchase_date:         form.purchase_date || undefined,
        purchase_price:        form.purchase_price !== '' && form.purchase_price != null ? Number(form.purchase_price) : undefined,
        invoice_number:        form.invoice_number?.trim() || undefined,
        warranty_expiry:       form.warranty_expiry || undefined,
        assigned_to:           form.assignedToId || undefined,  // UUID from DB
        assigned_since:        form.assigned_since || undefined,
        next_maintenance_date: form.next_maintenance_date || undefined,
      }
      const supplierPayload = {}

      if (form.sourceName?.trim()) {
        supplierPayload.source_type    = form.sourceType || 'Client'
        supplierPayload.source_name    = form.sourceName.trim()
        supplierPayload.source_company = form.sourceCompany?.trim() || undefined
        supplierPayload.source_phone   = form.sourcePhone?.trim() || undefined
        supplierPayload.source_email   = form.sourceEmail?.trim() || undefined
        supplierPayload.source_website = form.sourceWebsite?.trim() || undefined
        supplierPayload.source_address = form.sourceAddress?.trim() || undefined
        supplierPayload.source_remark  = form.sourceRemark?.trim() || undefined
      }

      Object.keys(assetPayload).forEach(k => assetPayload[k] === undefined && delete assetPayload[k])

      await apiFetch(`/api/assets/${showEdit.id}`, {
        method: 'PATCH',
        body: JSON.stringify(assetPayload),
      })

      setInventory(inv => inv.map(i => i.id === showEdit.id ? { ...form } : i))
      setAuditLog(al => [...al, generateAuditEntry(currentUser?.name || 'User', 'Inventory Updated', form.id, '–', form.status)])
      setShowEdit(null)
    } catch (err) {
      setSaveError(err.message || 'Failed to update. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this inventory item?')) return
    try {
      await apiFetch(`/api/assets/${id}`, { method: 'DELETE' })
      setInventory(inv => inv.filter(i => i.id !== id))
      setAuditLog(al => [...al, generateAuditEntry(currentUser?.name || 'User', 'Inventory Deleted', id, '–', 'Deleted')])
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  const [allocForm, setAllocForm] = useState({ engineer: '', project: '', allocationDate: '', expectedReturn: '' })
  const handleAllocate = () => {
    if (!showAllocate?.id) return
    const prev = showAllocate.status
    setInventory(inv => inv.map(i => i.id === showAllocate.id ? { ...i, ...allocForm, status: 'Allocated' } : i))
    setAuditLog(al => [...al, generateAuditEntry('Inventory Manager', 'Inventory Allocated', showAllocate.id, prev, 'Allocated')])
    setShowAllocate(null)
  }

  const [retForm, setRetForm] = useState({ condition: 'Good' })
  const handleReturn = () => {
    if (!showReturn?.id) return
    const newStatus = retForm.condition === 'Damaged' ? 'Damaged' : 'Returned'
    setInventory(inv => inv.map(i => i.id === showReturn.id ? { ...i, status: newStatus, engineer: '', returnDate: new Date().toISOString().slice(0, 10) } : i))
    setAuditLog(al => [...al, generateAuditEntry('Manager', 'Inventory Returned', showReturn.id, 'Allocated', newStatus)])
    setShowReturn(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>Inventory</h2>
        {(role === 'Administrator' || role === 'Inventory Manager') && (
          <Button icon={<Icon name="plus" size={14} />} onClick={() => { setForm(emptyForm); setShowAdd(true) }}>Add Item</Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ position: 'relative', flex: 2, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}><Icon name="search" size={16} /></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ID, name, serial, barcode, engineer…"
            style={{ width: '100%', padding: '9px 12px 9px 34px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        <select value={region} onChange={e => setRegion(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#374151' }}>
          <option value="">All Regions</option>
          {REGIONS.map(r => <option key={r}>{r}</option>)}//this region option shld  be fetch from the backend region table
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#374151' }}>
          <option value="">All Categories</option>
          {INVENTORY_CATEGORIES.map(c => <option key={c}>{c}</option>)} //this category option shld  be fetch from the backend category table
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#374151' }}>
          <option value="">All Statuses</option>
          {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              {['ID', 'Name', 'Category', 'Serial', 'Barcode', 'Region', 'Engineer', 'Source Details', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No inventory found.</td></tr>}
            {filtered.map((item, idx) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: '#2563eb' }}>{item.id}</td>
                <td style={{ padding: '10px 14px', color: '#111827' }}>{item.name}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.category}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280', fontFamily: 'monospace' }}>{item.serial}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>{item.barcode}</td>
                <td style={{ padding: '10px 14px', color: '#374151' }}>{item.region}</td>
                <td style={{ padding: '10px 14px', color: '#374151' }}>{item.engineer || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                <td style={{ padding: '10px 14px', minWidth: 180 }}>
                  {item.sourceName ? (
                    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: item.sourceType === 'Supplier' ? '#f0fdf4' : '#eff6ff', color: item.sourceType === 'Supplier' ? '#16a34a' : '#2563eb', border: `1px solid ${item.sourceType === 'Supplier' ? '#86efac' : '#93c5fd'}` }}>{item.sourceType || 'Client'}</span>
                        <span style={{ fontWeight: 700, color: '#111827' }}>{item.sourceName}</span>
                      </div>
                      {item.sourceId && <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 4, display: 'inline-block', marginBottom: 2 }}>{item.sourceId}</div>}
                      {item.sourceCompany && <div style={{ color: '#2563eb', fontSize: 11, fontWeight: 600 }}>🏢 {item.sourceCompany}</div>}
                      {item.sourcePhone && <div style={{ color: '#6b7280' }}>📞 {item.sourcePhone}</div>}
                      {item.sourceEmail && <div style={{ color: '#6b7280' }}>✉ {item.sourceEmail}</div>}
                      {item.sourceWebsite && <div style={{ color: '#6b7280' }}>🌐 {item.sourceWebsite}</div>}
                      {item.sourceAddress && <div style={{ color: '#9ca3af', fontSize: 11 }}>📍 {item.sourceAddress}</div>}
                      {item.sourceRemark && <div style={{ color: '#9ca3af', fontSize: 11, fontStyle: 'italic' }}>"{item.sourceRemark}"</div>}
                    </div>
                  ) : (
                    <span style={{ color: '#d1d5db' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '10px 14px' }}><Badge status={item.status} /></td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(role === 'Administrator' || role === 'Inventory Manager') && (
                      <>
                        <button title="Edit" onClick={() => { setForm({ ...item, assignedToId: item.assigned_to || item.assignedToId || '', assigned_to: item.assigned_to || item.engineer || '' }); setShowEdit(item) }} style={{ background: '#f3f4f6', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer' }}><Icon name="edit" size={13} color="#374151" /></button>
                        {item.status === 'Available' && <button title="Allocate" onClick={() => { setShowAllocate(item); setAllocForm({ engineer: '', project: '', allocationDate: new Date().toISOString().slice(0, 10), expectedReturn: '' }) }} style={{ background: '#dbeafe', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer' }}><Icon name="allocate" size={13} color="#2563eb" /></button>}
                        {item.status === 'Allocated' && <button title="Return" onClick={() => { setShowReturn(item); setRetForm({ condition: 'Good' }) }} style={{ background: '#dcfce7', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer' }}><Icon name="return" size={13} color="#16a34a" /></button>}
                        {role === 'Administrator' && <button title="Delete" onClick={() => handleDelete(item.id)} style={{ background: '#fee2e2', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer' }}><Icon name="trash" size={13} color="#dc2626" /></button>}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>{filtered.length} of {inventory.length} records</div>

      {showAdd && (
        <Modal title="Add Inventory Item" onClose={() => { setShowAdd(false); setSaveError(''); setFieldErrors({}) }} width={720}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            {/* Helper: red border + message if field has error */}
            {(() => {
              const err = (key) => fieldErrors[key]
                ? <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626', fontWeight: 500 }}>⚠ {fieldErrors[key]}</p>
                : null
              const borderStyle = (key) => fieldErrors[key] ? '1.5px solid #ef4444' : '1.5px solid #d1d5db'
              return (<>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Item ID</label>
                  <input value={form.id} onChange={e => setF('id', e.target.value)} placeholder="Auto-generated if blank"
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Brand <span style={{ color: '#ef4444' }}>*</span></label>
                  <input value={form.name} onChange={e => { setF('name', e.target.value); setFieldErrors(fe => ({ ...fe, name: '' })) }} placeholder="e.g. Dell, HP"
                    style={{ width: '100%', padding: '9px 12px', border: borderStyle('name'), borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                  {err('name')}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Name<span style={{ color: '#ef4444' }}>*</span></label>
                  <input value={form.type} onChange={e => { setF('type', e.target.value); setFieldErrors(fe => ({ ...fe, type: '' })) }} placeholder="e.g. Laptop, Test Bench"
                    style={{ width: '100%', padding: '9px 12px', border: borderStyle('type'), borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                  {err('type')}
                </div>

                {/* Category */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Category <span style={{ color: '#ef4444' }}>*</span></label>
                  <select value={form.category_id || ''} onChange={e => {
                    const obj = rawCategories.find(c => c.id === e.target.value)
                    setForm(f => ({ ...f, category_id: e.target.value, category: obj ? (obj.name || obj.category_name || obj.title || '') : '' }))
                    setFieldErrors(fe => ({ ...fe, category_id: '' }))
                  }} style={{ width: '100%', padding: '9px 12px', border: borderStyle('category_id'), borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff' }}>
                    <option value="">{catLoading ? 'Loading…' : 'Select category…'}</option>
                    {rawCategories.map(c => <option key={c.id} value={c.id}>{c.name || c.category_name || c.title}</option>)}
                  </select>
                  {err('category_id')}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Serial Number <span style={{ color: '#ef4444' }}>*</span></label>
                  <input value={form.serial} onChange={e => { setF('serial', e.target.value); setFieldErrors(fe => ({ ...fe, serial: '' })) }} placeholder="e.g. SN-ABC123"
                    style={{ width: '100%', padding: '9px 12px', border: borderStyle('serial'), borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                  {err('serial')}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Asset Tag <span style={{ color: '#ef4444' }}>*</span></label>
                  <input value={form.asset} onChange={e => { setF('asset', e.target.value); setFieldErrors(fe => ({ ...fe, asset: '' })) }} placeholder="e.g. AST-1001"
                    style={{ width: '100%', padding: '9px 12px', border: borderStyle('asset'), borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                  {err('asset')}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Barcode</label>
                  <input value={form.barcode} onChange={e => setF('barcode', e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                </div>

                {/* Region */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Region <span style={{ color: '#ef4444' }}>*</span></label>
                  <select value={form.location_id || ''} onChange={e => {
                    const obj = rawLocations.find(l => l.id === e.target.value)
                    setForm(f => ({ ...f, location_id: e.target.value, region: obj ? (obj.location_label || obj.region || obj.name || '') : '' }))
                    setFieldErrors(fe => ({ ...fe, location_id: '' }))
                  }} style={{ width: '100%', padding: '9px 12px', border: borderStyle('location_id'), borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff' }}>
                    <option value="">{locLoading ? 'Loading…' : 'Select region…'}</option>
                    {rawLocations.map(l => <option key={l.id} value={l.id}>{l.location_label || l.region || l.name}</option>)}
                  </select>
                  {err('location_id')}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Status <span style={{ color: '#ef4444' }}>*</span></label>
                  <select value={form.status} onChange={e => { setF('status', e.target.value); setFieldErrors(fe => ({ ...fe, status: '' })) }}
                    style={{ width: '100%', padding: '9px 12px', border: borderStyle('status'), borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff' }}>
                    <option value="">Select status…</option>
                    {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                  </select>
                  {err('status')}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Quantity <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="number" value={form.quantity} onChange={e => { setF('quantity', e.target.value); setFieldErrors(fe => ({ ...fe, quantity: '' })) }} min="1"
                    style={{ width: '100%', padding: '9px 12px', border: borderStyle('quantity'), borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                  {err('quantity')}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Received Date</label>
                  <input type="date" value={form.receivedDate} onChange={e => setF('receivedDate', e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Remarks</label>
                  <input value={form.remarks} onChange={e => setF('remarks', e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', boxSizing: 'border-box' }} />
                </div>
              </>)
            })()}
          </div>

          {/* Asset & Assignment Details Section */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '2px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={14} height={14} fill="none" stroke="#2563eb" strokeWidth={2} viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </div>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>Asset & Assignment Details</h4>
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Input label="Model" value={form.model} onChange={v => setF('model', v)} placeholder="e.g. Latitude 5540" />
              <Input label="Purchase Date" value={form.purchase_date} onChange={v => setF('purchase_date', v)} type="date" />
              <Input label="Purchase Price" value={form.purchase_price} onChange={v => setF('purchase_price', v)} type="number" placeholder="e.g. 55000" />
              <Input label="Invoice Number" value={form.invoice_number} onChange={v => setF('invoice_number', v)} placeholder="e.g. INV-2026-001" />
              <Input label="Warranty Expiry" value={form.warranty_expiry} onChange={v => setF('warranty_expiry', v)} type="date" />
              {/* Assigned To — real users from /api/users */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Assigned To</label>
                <select
                  value={form.assignedToId || ''}
                  onChange={e => {
                    const u = rawUsers.find(u => u.id === e.target.value)
                    setForm(f => ({ ...f, assignedToId: e.target.value, assigned_to: e.target.value, engineer: u ? u.name : '' }))
                  }}
                  disabled={usersLoading}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff', opacity: usersLoading ? 0.6 : 1 }}
                >
                  
                  <option value="">{usersLoading ? 'Loading users…' : rawUsers.length === 0 ? 'No users available' : 'Select user…'}</option>
                  {rawUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}{u.role ? ` — ${u.role}` : ''}</option>
                  ))}
                </select>
                {usersError && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626' }}>⚠ Could not load users: {usersError}</p>}
              </div>
              <Input label="Assigned Since" value={form.assigned_since} onChange={v => setF('assigned_since', v)} type="date" />
              <Input label="Next Maintenance Date" value={form.next_maintenance_date} onChange={v => setF('next_maintenance_date', v)} type="date" />
            </div>
          </div>

          {/* Source Details Section */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '2px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={14} height={14} fill="none" stroke="#2563eb" strokeWidth={2} viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>Source Details</h4>
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
            </div>
            {/* Source Type Radio Buttons */}
            <div style={{ display: 'flex', gap: 24, marginBottom: 18 }}>
              {['Client', 'Supplier'].map(type => (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                  <div style={{ position: 'relative', width: 18, height: 18 }}>
                    <input type="radio" name="addSourceType" value={type} checked={form.sourceType === type} onChange={() => setF('sourceType', type)}
                      style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', margin: 0 }} />
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${form.sourceType === type ? '#2563eb' : '#d1d5db'}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {form.sourceType === type && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }} />}
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: form.sourceType === type ? 700 : 500, color: form.sourceType === type ? '#2563eb' : '#374151' }}>{type}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Input label="Source ID" value={form.sourceId} onChange={v => setF('sourceId', v)} placeholder="Auto-generated if blank (e.g. SRC-0001)" />
              <Input label="Name" value={form.sourceName} onChange={v => setF('sourceName', v)} placeholder="Full name" />
              <Input label="Company Name" value={form.sourceCompany} onChange={v => setF('sourceCompany', v)} placeholder="Company / Organisation" />
              <Input label="Phone" value={form.sourcePhone} onChange={v => setF('sourcePhone', v)} placeholder="+91 XXXXX XXXXX" />
              <Input label="Email" value={form.sourceEmail} onChange={v => setF('sourceEmail', v)} type="email" placeholder="email@example.com" />
              <Input label="Website" value={form.sourceWebsite} onChange={v => setF('sourceWebsite', v)} placeholder="https://example.com" />
              <div style={{ gridColumn: '1 / -1' }}>
                <Input label="Address" value={form.sourceAddress} onChange={v => setF('sourceAddress', v)} placeholder="Street, City, State, PIN" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Input label="Remark" value={form.sourceRemark} onChange={v => setF('sourceRemark', v)} placeholder="Any additional notes about this source…" />
              </div>
            </div>
          </div>

          {saveError && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <Button variant="secondary" onClick={() => { setShowAdd(false); setSaveError(''); setFieldErrors({}) }}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving} icon={saving ? null : <Icon name="check" size={14} />}>
              {saving ? 'Saving…' : 'Add Item'}
            </Button>
          </div>
        </Modal>
      )}

      {showEdit && (
        <Modal title="Edit Inventory Item" onClose={() => { setShowEdit(null); setSaveError(''); setFieldErrors({}) }} width={720}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Input label="Item ID" value={form.id} onChange={v => setF('id', v)} />
            <Input label="Brand" value={form.name} onChange={v => setF('name', v)} required />
            <Input label="" value={form.type} onChange={v => setF('type', v)} />

            {/* Category — stores label + UUID */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Category</label>
              <select value={form.category_id || ''} onChange={e => {
                const obj = rawCategories.find(c => c.id === e.target.value)
                setForm(f => ({ ...f, category_id: e.target.value, category: obj ? (obj.name || obj.category_name || obj.title || '') : '' }))
              }} style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff' }}>
                <option value="">{catLoading ? 'Loading…' : 'Select category…'}</option>
                {rawCategories.map(c => <option key={c.id} value={c.id}>{c.name || c.category_name || c.title}</option>)}
              </select>
            </div>

            <Input label="Serial Number" value={form.serial} onChange={v => setF('serial', v)} />
            <Input label="Asset Tag" value={form.asset} onChange={v => setF('asset', v)} />
            <Input label="Barcode" value={form.barcode} onChange={v => setF('barcode', v)} />

            {/* Region — stores label + UUID */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Region</label>
              <select value={form.location_id || ''} onChange={e => {
                const obj = rawLocations.find(l => l.id === e.target.value)
                setForm(f => ({ ...f, location_id: e.target.value, region: obj ? (obj.location_label || obj.region || obj.name || '') : '' }))
              }} style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff' }}>
                <option value="">{locLoading ? 'Loading…' : 'Select region…'}</option>
                {rawLocations.map(l => <option key={l.id} value={l.id}>{l.location_label || l.region || l.name}</option>)}
              </select>
            </div>

            <Input label="Status" value={form.status} onChange={v => setF('status', v)} options={STATUS_LIST} />
            <Input label="Remarks" value={form.remarks} onChange={v => setF('remarks', v)} />
          </div>

          {/* Asset & Assignment Details Section */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '2px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={14} height={14} fill="none" stroke="#2563eb" strokeWidth={2} viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </div>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>Asset & Assignment Details</h4>
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Input label="Model" value={form.model} onChange={v => setF('model', v)} placeholder="e.g. Latitude 5540" />
              <Input label="Purchase Date" value={form.purchase_date} onChange={v => setF('purchase_date', v)} type="date" />
              <Input label="Purchase Price" value={form.purchase_price} onChange={v => setF('purchase_price', v)} type="number" placeholder="e.g. 55000" />
              <Input label="Invoice Number" value={form.invoice_number} onChange={v => setF('invoice_number', v)} placeholder="e.g. INV-2026-001" />
              <Input label="Warranty Expiry" value={form.warranty_expiry} onChange={v => setF('warranty_expiry', v)} type="date" />
              {/* Assigned To — real users from /api/users */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Assigned To</label>
                <select
                  value={form.assignedToId || ''}
                  onChange={e => {
                    const u = rawUsers.find(u => u.id === e.target.value)
                    setForm(f => ({ ...f, assignedToId: e.target.value, assigned_to: e.target.value, engineer: u ? u.name : '' }))
                  }}
                  disabled={usersLoading}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, color: '#111827', background: '#fff', opacity: usersLoading ? 0.6 : 1 }}
                >
                  
                  <option value="">{usersLoading ? 'Loading users…' : rawUsers.length === 0 ? 'No users available' : 'Select user…'}</option>
                  {rawUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}{u.role ? ` — ${u.role}` : ''}</option>
                  ))}
                </select>
                {usersError && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626' }}>⚠ Could not load users: {usersError}</p>}
              </div>
              <Input label="Assigned Since" value={form.assigned_since} onChange={v => setF('assigned_since', v)} type="date" />
              <Input label="Next Maintenance Date" value={form.next_maintenance_date} onChange={v => setF('next_maintenance_date', v)} type="date" />
            </div>
          </div>

          {/* Source Details Section */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: '2px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={14} height={14} fill="none" stroke="#2563eb" strokeWidth={2} viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>Source Details</h4>
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
            </div>
            <div style={{ display: 'flex', gap: 24, marginBottom: 18 }}>
              {['Client', 'Supplier'].map(type => (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                  <div style={{ position: 'relative', width: 18, height: 18 }}>
                    <input type="radio" name="editSourceType" value={type} checked={(form.sourceType || 'Client') === type} onChange={() => setF('sourceType', type)}
                      style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', margin: 0 }} />
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${(form.sourceType || 'Client') === type ? '#2563eb' : '#d1d5db'}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {(form.sourceType || 'Client') === type && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }} />}
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: (form.sourceType || 'Client') === type ? 700 : 500, color: (form.sourceType || 'Client') === type ? '#2563eb' : '#374151' }}>{type}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Input label="Source ID" value={form.sourceId || ''} onChange={v => setF('sourceId', v)} placeholder="Auto-generated if blank (e.g. SRC-0001)" />
              <Input label="Name" value={form.sourceName || ''} onChange={v => setF('sourceName', v)} placeholder="Full name" />
              <Input label="Company Name" value={form.sourceCompany || ''} onChange={v => setF('sourceCompany', v)} placeholder="Company / Organisation" />
              <Input label="Phone" value={form.sourcePhone || ''} onChange={v => setF('sourcePhone', v)} placeholder="+91 XXXXX XXXXX" />
              <Input label="Email" value={form.sourceEmail || ''} onChange={v => setF('sourceEmail', v)} type="email" placeholder="email@example.com" />
              <Input label="Website" value={form.sourceWebsite || ''} onChange={v => setF('sourceWebsite', v)} placeholder="https://example.com" />
              <div style={{ gridColumn: '1 / -1' }}>
                <Input label="Address" value={form.sourceAddress || ''} onChange={v => setF('sourceAddress', v)} placeholder="Street, City, State, PIN" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Input label="Remark" value={form.sourceRemark || ''} onChange={v => setF('sourceRemark', v)} placeholder="Any additional notes about this source…" />
              </div>
            </div>
          </div>

          {saveError && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <Button variant="secondary" onClick={() => { setShowEdit(null); setSaveError(''); setFieldErrors({}) }}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving} icon={saving ? null : <Icon name="check" size={14} />}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </Modal>
      )}

      {showAllocate && (
        <Modal title={`Allocate: ${showAllocate.name}`} onClose={() => setShowAllocate(null)} width={440}>
          <Input label="Engineer Name" value={allocForm.engineer} onChange={v => setAllocForm(f => ({ ...f, engineer: v }))} options={ALL_ENGINEERS} required />
          <Input label="Project Name" value={allocForm.project} onChange={v => setAllocForm(f => ({ ...f, project: v }))} required />
          <Input label="Allocation Date" value={allocForm.allocationDate} onChange={v => setAllocForm(f => ({ ...f, allocationDate: v }))} type="date" required />
          <Input label="Expected Return Date" value={allocForm.expectedReturn} onChange={v => setAllocForm(f => ({ ...f, expectedReturn: v }))} type="date" required />
          <div style={{ padding: '10px 14px', background: '#fefce8', borderRadius: 8, fontSize: 13, color: '#92400e', marginBottom: 16 }}>
            Status will change: <strong>Available → Allocated</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" onClick={() => setShowAllocate(null)}>Cancel</Button>
            <Button onClick={handleAllocate} icon={<Icon name="allocate" size={14} />} disabled={!allocForm.engineer || !allocForm.project}>Allocate</Button>
          </div>
        </Modal>
      )}

      {showReturn && (
        <Modal title={`Return: ${showReturn.name}`} onClose={() => setShowReturn(null)} width={400}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Currently assigned to: <strong style={{ color: '#111827' }}>{showReturn.engineer}</strong>
          </div>
          <Input label="Condition Assessment" value={retForm.condition} onChange={v => setRetForm(f => ({ ...f, condition: v }))} options={['Good', 'Damaged', 'Missing Parts']} required />
          <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, fontSize: 13, color: '#166534', marginBottom: 16 }}>
            Return date will be captured as today: <strong>{new Date().toLocaleDateString()}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" onClick={() => setShowReturn(null)}>Cancel</Button>
            <Button variant="success" onClick={handleReturn} icon={<Icon name="return" size={14} />}>Confirm Return</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BarcodeSection({ inventory }) {
  const [selected, setSelected] = useState([])
  const [barcodeType, setBarcodeType] = useState('QR Code')

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const p3Items = inventory.filter(i => i.category === 'P3 Accessories')

  const printBarcodes = () => {
    const items = selected.length > 0 ? inventory.filter(i => selected.includes(i.id)) : p3Items.slice(0, 5)
    alert(`Printing ${items.length} barcodes as ${barcodeType}:\n\n${items.map(i => `${i.barcode} — ${i.name}`).join('\n')}\n\n(PDF export would trigger here in production)`)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>Barcode Management</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={barcodeType} onChange={e => setBarcodeType(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
            <option>QR Code</option>
            <option>Code128 Barcode</option>
          </select>
          <Button icon={<Icon name="barcode" size={14} />} onClick={printBarcodes}>{selected.length > 0 ? `Print ${selected.length} Selected` : 'Bulk Print'}</Button>
          <Button icon={<Icon name="download" size={14} />} variant="secondary" onClick={() => alert('Exporting barcodes as PDF…')}>Export PDF</Button>
        </div>
      </div>

      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: '#0369a1' }}>
        <strong>Barcode Format:</strong> P3-IND-XXXXXX — Supports QR Code and Code128. Scanning via mobile camera, USB scanner, or Google Lens is supported in production.
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '12px 14px' }}><input type="checkbox" onChange={e => setSelected(e.target.checked ? p3Items.map(i => i.id) : [])} /></th>
              {['Barcode', 'Item Name', 'Category', 'Region', 'Status', 'Preview'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p3Items.map((item, idx) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '10px 14px' }}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelect(item.id)} /></td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 700, color: '#2563eb' }}>{item.barcode}</td>
                <td style={{ padding: '10px 14px' }}>{item.name}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.category}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.region}</td>
                <td style={{ padding: '10px 14px' }}><Badge status={item.status} /></td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ width: 48, height: 48, background: '#f3f4f6', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#9ca3af', border: '1px solid #e5e7eb', cursor: 'pointer' }}
                    onClick={() => alert(`${barcodeType} for ${item.barcode}`)}>
                    {barcodeType === 'QR Code' ? '▦ QR' : '▌▌▌'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AllocationSection({ inventory, currentUser }) {
  const isEngineer = currentUser?.role === 'Engineer'
  const allocated = inventory.filter(i => i.status === 'Allocated' && (!isEngineer || i.engineer === currentUser.name))
  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#111827' }}>Allocation Records</h2>
      {isEngineer && <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>Showing only items allocated to you — <strong>{currentUser.name}</strong></p>}
      {!isEngineer && <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>All allocated items across all engineers</p>}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              {['Item ID', 'Name', 'Category', 'Engineer', 'Allocation Date', 'Expected Return', 'Region', 'Status'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allocated.length === 0 && <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No allocated items.</td></tr>}
            {allocated.map((item, idx) => {
              const overdue = item.expectedReturn && new Date(item.expectedReturn) < new Date()
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: overdue ? '#fff7ed' : idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#2563eb' }}>{item.id}</td>
                  <td style={{ padding: '10px 14px' }}>{item.name}</td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.category}</td>
                  <td style={{ padding: '10px 14px' }}>{item.engineer}</td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.allocationDate || '—'}</td>
                  <td style={{ padding: '10px 14px' }}><span style={{ color: overdue ? '#dc2626' : '#374151', fontWeight: overdue ? 700 : 400 }}>{item.expectedReturn || '—'} {overdue && '⚠ OVERDUE'}</span></td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.region}</td>
                  <td style={{ padding: '10px 14px' }}><Badge status={item.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReturnSection({ inventory, currentUser }) {
  const isEngineer = currentUser?.role === 'Engineer'
  const pageTitle = isEngineer ? 'Reallocation' : 'Return Records'
  const returned = inventory.filter(i => i.status === 'Returned' && (!isEngineer || i.engineer === currentUser.name || i.previousEngineer === currentUser.name))
  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#111827' }}>{pageTitle}</h2>
      {isEngineer && <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>Items previously allocated to you — <strong>{currentUser.name}</strong></p>}
      {!isEngineer && <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>All returned items</p>}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              {['Item ID', 'Name', 'Category', 'Region', 'Return Date', 'Status'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {returned.length === 0 && <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No returned items yet.</td></tr>}
            {returned.map((item, idx) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: '#2563eb' }}>{item.id}</td>
                <td style={{ padding: '10px 14px' }}>{item.name}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.category}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.region}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.returnDate || '—'}</td>
                <td style={{ padding: '10px 14px' }}><Badge status={item.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Notifications({ inventory }) {
  const today = new Date()
  const in7Days = new Date()
  in7Days.setDate(today.getDate() + 7)

  const overdue = inventory.filter(i => i.expectedReturn && new Date(i.expectedReturn) < today && i.status === 'Allocated')
  const dueSoon = inventory.filter(i => i.expectedReturn && new Date(i.expectedReturn) <= in7Days && new Date(i.expectedReturn) >= today && i.status === 'Allocated')
  const lowStock = inventory.filter(i => i.quantity < 2 && i.status === 'Available')

  const NotifRow = ({ icon, color, title, desc }) => (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={16} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{title}</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  )

  return (
    <div>
      <h2 style={{ margin: '0 0 24px', fontSize: 22, fontWeight: 800, color: '#111827' }}>Notifications</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#dc2626' }}>{overdue.length}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Overdue Returns</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#d97706' }}>{dueSoon.length}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Due in 7 Days</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#7c3aed' }}>{lowStock.length}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Low Stock Items</div>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '0 20px' }}>
        {overdue.map(i => <NotifRow key={i.id} icon="bell" color="#dc2626" title={`Overdue Return — ${i.name}`} desc={`${i.engineer} — Expected: ${i.expectedReturn} — ${i.region}`} />)}
        {dueSoon.map(i => <NotifRow key={i.id} icon="bell" color="#d97706" title={`Return Due Soon — ${i.name}`} desc={`${i.engineer} — Due: ${i.expectedReturn}`} />)}
        {lowStock.map(i => <NotifRow key={i.id} icon="bell" color="#7c3aed" title={`Low Stock — ${i.name}`} desc={`Only ${i.quantity} available in ${i.region}`} />)}
        {overdue.length === 0 && dueSoon.length === 0 && lowStock.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No active notifications.</div>
        )}
      </div>
    </div>
  )
}

function Reports({ inventory }) {
  const [reportType, setReportType] = useState('utilization')

  const engineerStats = ALL_ENGINEERS.map(e => ({
    name: e,
    count: inventory.filter(i => i.engineer === e).length,
    active: inventory.filter(i => i.engineer === e && i.status === 'Allocated').length,
  })).filter(e => e.count > 0)

  const regionStats = REGIONS.map(r => ({
    r,
    total: inventory.filter(i => i.region === r).length,
    available: inventory.filter(i => i.region === r && i.status === 'Available').length,
    allocated: inventory.filter(i => i.region === r && i.status === 'Allocated').length,
  }))

  const missingItems = inventory.filter(i => i.status === 'Lost' || (i.expectedReturn && new Date(i.expectedReturn) < new Date() && i.status === 'Allocated'))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>Reports</h2>
        <Button icon={<Icon name="download" size={14} />} variant="secondary" onClick={() => alert('Exporting report as Excel/CSV/PDF…')}>Export Report</Button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[['utilization', 'Utilization'], ['engineer', 'Engineer Allocation'], ['region', 'Region Inventory'], ['missing', 'Missing Inventory']].map(([k, l]) => (
          <button key={k} onClick={() => setReportType(k)} style={{ padding: '8px 16px', borderRadius: 8, border: reportType === k ? '2px solid #2563eb' : '1.5px solid #d1d5db', background: reportType === k ? '#eff6ff' : '#fff', color: reportType === k ? '#2563eb' : '#374151', fontWeight: reportType === k ? 700 : 500, fontSize: 13, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>

      {reportType === 'utilization' && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Category', 'Total', 'Allocated', 'Available', 'Utilization %'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INVENTORY_CATEGORIES.map((cat, idx) => {
                const total = inventory.filter(i => i.category === cat).length
                const alloc = inventory.filter(i => i.category === cat && i.status === 'Allocated').length
                const avail = inventory.filter(i => i.category === cat && i.status === 'Available').length
                const pct = total > 0 ? Math.round((alloc / total) * 100) : 0
                return (
                  <tr key={cat} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{cat}</td>
                    <td style={{ padding: '10px 14px' }}>{total}</td>
                    <td style={{ padding: '10px 14px', color: '#2563eb' }}>{alloc}</td>
                    <td style={{ padding: '10px 14px', color: '#16a34a' }}>{avail}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: '#f3f4f6', borderRadius: 99 }}>
                          <div style={{ width: pct + '%', height: '100%', background: pct > 70 ? '#dc2626' : '#2563eb', borderRadius: 99 }} />
                        </div>
                        <span style={{ fontWeight: 700, color: '#374151', fontSize: 12 }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {reportType === 'engineer' && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Engineer', 'Total Assigned', 'Currently Active'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {engineerStats.length === 0 && <tr><td colSpan={3} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No allocation data.</td></tr>}
              {engineerStats.map((e, idx) => (
                <tr key={e.name} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{e.name}</td>
                  <td style={{ padding: '10px 14px' }}>{e.count}</td>
                  <td style={{ padding: '10px 14px', color: '#2563eb', fontWeight: 700 }}>{e.active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportType === 'region' && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Region', 'Total', 'Available', 'Allocated'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regionStats.map((r, idx) => (
                <tr key={r.r} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{r.r}</td>
                  <td style={{ padding: '10px 14px' }}>{r.total}</td>
                  <td style={{ padding: '10px 14px', color: '#16a34a' }}>{r.available}</td>
                  <td style={{ padding: '10px 14px', color: '#2563eb' }}>{r.allocated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportType === 'missing' && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Item ID', 'Name', 'Status', 'Engineer', 'Expected Return', 'Region'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {missingItems.length === 0 && <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No missing or overdue items.</td></tr>}
              {missingItems.map((item, idx) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: '#fff7ed' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#dc2626' }}>{item.id}</td>
                  <td style={{ padding: '10px 14px' }}>{item.name}</td>
                  <td style={{ padding: '10px 14px' }}><Badge status={item.status} /></td>
                  <td style={{ padding: '10px 14px' }}>{item.engineer || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#dc2626', fontWeight: 600 }}>{item.expectedReturn || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AuditTrail({ auditLog }) {
  const [search, setSearch] = useState('')
  const filtered = auditLog.filter(a => !search || [a.action, a.item, a.user].join(' ').toLowerCase().includes(search.toLowerCase())).slice().reverse()
  return (
    <div>
      <h2 style={{ margin: '0 0 24px', fontSize: 22, fontWeight: 800, color: '#111827' }}>Audit Trail</h2>
      <div style={{ position: 'relative', marginBottom: 20, maxWidth: 400 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}><Icon name="search" size={16} /></span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search audit log…"
          style={{ width: '100%', padding: '9px 12px 9px 34px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
      </div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              {['#', 'Timestamp', 'User', 'Action', 'Item', 'Previous', 'New Value'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>No audit records found.</td></tr>}
            {filtered.map((a, idx) => (
              <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '10px 14px', color: '#9ca3af' }}>{a.id}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280', whiteSpace: 'nowrap' }}>{a.timestamp}</td>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{a.user}</td>
                <td style={{ padding: '10px 14px', color: '#2563eb' }}>{a.action}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>{a.item}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{a.prev}</td>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: '#16a34a' }}>{a.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>{auditLog.length} total audit entries</div>
    </div>
  )
}

function BulkOperations({ inventory, setInventory, auditLog, setAuditLog }) {
  const [bulkAction, setBulkAction] = useState('status_update')
  const [selected, setSelected] = useState([])
  const [bulkStatus, setBulkStatus] = useState('Available')
  const [bulkEngineer, setBulkEngineer] = useState('')
  const [uploadStatus, setUploadStatus] = useState(null)

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const selectAll = (checked) => setSelected(checked ? inventory.map(i => i.id) : [])

  const handleBulkStatusUpdate = () => {
    if (selected.length === 0) return alert('Select at least one item.')
    setInventory(inv => inv.map(i => selected.includes(i.id) ? { ...i, status: bulkStatus } : i))
    setAuditLog(al => [...al, generateAuditEntry('Admin', 'Bulk Status Update', `${selected.length} items`, '—', bulkStatus)])
    setSelected([])
    alert(`Updated ${selected.length} items to "${bulkStatus}"`)
  }

  const handleBulkAssign = () => {
    if (selected.length === 0 || !bulkEngineer) return alert('Select items and an engineer.')
    setInventory(inv => inv.map(i => selected.includes(i.id) ? { ...i, engineer: bulkEngineer, status: 'Allocated', allocationDate: new Date().toISOString().slice(0, 10) } : i))
    setAuditLog(al => [...al, generateAuditEntry('Admin', 'Bulk Assignment', `${selected.length} items`, '—', `Assigned to ${bulkEngineer}`)])
    setSelected([])
    alert(`${selected.length} items assigned to ${bulkEngineer}`)
  }

  const handleBulkReturn = () => {
    const toReturn = selected.length > 0 ? selected : inventory.filter(i => i.status === 'Allocated').map(i => i.id)
    if (toReturn.length === 0) return alert('No allocated items to return.')
    setInventory(inv => inv.map(i => toReturn.includes(i.id) && i.status === 'Allocated' ? { ...i, status: 'Returned', engineer: '', returnDate: new Date().toISOString().slice(0, 10) } : i))
    setAuditLog(al => [...al, generateAuditEntry('Admin', 'Bulk Return', `${toReturn.length} items`, 'Allocated', 'Returned')])
    setSelected([])
    alert(`${toReturn.length} items returned.`)
  }

  const handleBulkBarcodeGen = () => {
    const toUpdate = selected.length > 0 ? selected : inventory.filter(i => !i.barcode).map(i => i.id)
    let count = 0
    setInventory(inv => inv.map(i => {
      if (toUpdate.includes(i.id) && !i.barcode) { count++; return { ...i, barcode: generateBarcode() } }
      return i
    }))
    alert(`Generated barcodes for ${count || selected.length} items.`)
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadStatus(`Parsing "${file.name}"… In production, this would import rows from Excel/CSV into inventory.`)
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 24px', fontSize: 22, fontWeight: 800, color: '#111827' }}>Bulk Operations</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[['status_update', 'Bulk Status Update'], ['assign', 'Bulk Assignment'], ['return', 'Bulk Return'], ['barcode', 'Bulk Barcode Generation'], ['upload', 'Bulk Upload (Excel/CSV)']].map(([k, l]) => (
          <button key={k} onClick={() => setBulkAction(k)} style={{ padding: '8px 16px', borderRadius: 8, border: bulkAction === k ? '2px solid #2563eb' : '1.5px solid #d1d5db', background: bulkAction === k ? '#eff6ff' : '#fff', color: bulkAction === k ? '#2563eb' : '#374151', fontWeight: bulkAction === k ? 700 : 500, fontSize: 13, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>

      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        {bulkAction === 'status_update' && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Set status to:</span>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ padding: '8px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14 }}>
              {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
            </select>
            <Button onClick={handleBulkStatusUpdate} disabled={selected.length === 0}>{selected.length > 0 ? `Update ${selected.length} Selected` : 'Select Items Below'}</Button>
          </div>
        )}
        {bulkAction === 'assign' && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Assign to engineer:</span>
            <select value={bulkEngineer} onChange={e => setBulkEngineer(e.target.value)} style={{ padding: '8px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14 }}>
              <option value="">Select engineer…</option>
              {ALL_ENGINEERS.map(e => <option key={e}>{e}</option>)}
            </select>
            <Button onClick={handleBulkAssign} disabled={selected.length === 0 || !bulkEngineer} icon={<Icon name="allocate" size={14} />}>{selected.length > 0 ? `Assign ${selected.length} Items` : 'Select Items Below'}</Button>
          </div>
        )}
        {bulkAction === 'return' && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: '#374151' }}>{selected.length > 0 ? `Return ${selected.length} selected items` : 'Return all allocated items'}</span>
            <Button variant="success" onClick={handleBulkReturn} icon={<Icon name="return" size={14} />}>{selected.length > 0 ? `Return ${selected.length} Selected` : 'Return All Allocated'}</Button>
          </div>
        )}
        {bulkAction === 'barcode' && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: '#374151' }}>{selected.length > 0 ? `Generate barcodes for ${selected.length} selected` : 'Generate missing barcodes for all items'}</span>
            <Button onClick={handleBulkBarcodeGen} icon={<Icon name="barcode" size={14} />}>Generate Barcodes</Button>
            <Button variant="secondary" icon={<Icon name="download" size={14} />} onClick={() => alert('Exporting all barcodes as PDF…')}>Export All Barcodes PDF</Button>
          </div>
        )}
        {bulkAction === 'upload' && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#2563eb', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                <Icon name="upload" size={16} color="#fff" />
                Choose Excel / CSV File
                <input type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
              </label>
            </div>
            {uploadStatus && <div style={{ padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 13, color: '#166534' }}>{uploadStatus}</div>}
            <div style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
              Supported formats: <strong>.xlsx</strong> and <strong>.csv</strong>. Template columns: ID, Name, Type, Category, Serial, Asset, Barcode, Region, Status, Quantity, Remarks.
            </div>
            <div style={{ marginTop: 10 }}>
              <Button variant="secondary" icon={<Icon name="download" size={14} />} onClick={() => alert('Downloading import template...')}>Download Import Template</Button>
            </div>
          </div>
        )}
      </div>

      {bulkAction !== 'upload' && (
        <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '12px 14px' }}><input type="checkbox" onChange={e => selectAll(e.target.checked)} checked={selected.length === inventory.length && inventory.length > 0} /></th>
                {['ID', 'Name', 'Category', 'Region', 'Status', 'Engineer'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inventory.map((item, idx) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: selected.includes(item.id) ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' }} onClick={() => toggleSelect(item.id)}>
                  <td style={{ padding: '10px 14px' }}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelect(item.id)} onClick={e => e.stopPropagation()} /></td>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#2563eb' }}>{item.id}</td>
                  <td style={{ padding: '10px 14px' }}>{item.name}</td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.category}</td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.region}</td>
                  <td style={{ padding: '10px 14px' }}><Badge status={item.status} /></td>
                  <td style={{ padding: '10px 14px', color: '#374151' }}>{item.engineer || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '10px 14px', fontSize: 12, color: '#9ca3af' }}>{selected.length} of {inventory.length} selected</div>
        </div>
      )}
    </div>
  )
}

const MOCK_USERS = [
  { email: 'admin@p3acclivis.com', password: 'admin123', name: 'Arjun Mehta', role: 'Administrator', avatar: 'AM' },
  { email: 'manager@p3acclivis.com', password: 'manager123', name: 'Priya Nair', role: 'Inventory Manager', avatar: 'PN' },
  { email: 'engineer@p3acclivis.com', password: 'eng123', name: 'Rohan Desai', role: 'Engineer', avatar: 'RD' },
  { email: 'readonly@p3acclivis.com', password: 'read123', name: 'Sneha Pillai', role: 'Read-Only', avatar: 'SP' },
]

// Merge MOCK_USERS engineer names into the ENGINEERS dropdown so
// logged-in engineers always appear as allocation options
const ALL_ENGINEERS = Array.from(new Set([
  ...ENGINEERS,
  ...MOCK_USERS.filter(u => u.role === 'Engineer').map(u => u.name),
]))

const normalizeRole = (role) => {
  const normalized = String(role || '').toLowerCase()
  const roleMap = {
    admin: 'Administrator',
    'inventory manager': 'Inventory Manager',
    engineer: 'Engineer',
    readonly: 'Read-Only',
    auditor: 'Read-Only',
    staff: 'Engineer',
  }
  return roleMap[normalized] || role
}

function SignIn({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setError('')
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true)
    try {
      const response = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await response.json()
      if (response.ok && data.user) {
        // Accept the token field used by the backend, while supporting common aliases.
        const accessToken =
          data.accessToken ||
          data.access_token ||
          data.token ||
          data.data?.accessToken ||
          data.data?.access_token ||
          data.data?.token

        if (!accessToken) {
          setError('Login succeeded, but the server did not return an access token.')
          setLoading(false)
          return
        }

        const normalizedUser = { ...data.user, role: normalizeRole(data.user.role) }

        // Store refresh token if provided by backend
        const refreshToken =
          data.refreshToken || data.refresh_token ||
          data.data?.refreshToken || data.data?.refresh_token
        if (refreshToken) storeRefreshToken(refreshToken)

        onLogin(normalizedUser, accessToken)
      } else {
        setError(data.message || 'Invalid email or password. Please try again.')
        setLoading(false)
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  const handleQuickLogin = (user) => {
    setEmail(user.email)
    setPassword(user.password)
    setError('')
  }

  const EyeIcon = ({ open }) => open
    ? <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    : <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>

  const ROLE_COLORS = { Administrator: '#2563eb', 'Inventory Manager': '#7c3aed', Engineer: '#16a34a', 'Read-Only': '#6b7280' }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: "'Inter','Segoe UI',sans-serif", background: '#f8fafc' }}>
      <div style={{ flex: '0 0 480px', background: 'linear-gradient(145deg, #0f172a 0%, #1e3a5f 50%, #1d4ed8 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px 48px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 60, left: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, background: '#2563eb', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={22} height={22} fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 3H8l-2 4h12l-2-4z"/></svg>
              </div>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 18, letterSpacing: -0.3 }}>InventoryHub</div>
                <div style={{ color: '#93c5fd', fontSize: 11, fontWeight: 500 }}>P3 Acclivis Technology</div>
              </div>
            </div>
            <div style={{ background: '#fff', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center' }}>
              <P3Logo height={22} />
            </div>
          </div>

          <h1 style={{ color: '#fff', fontSize: 32, fontWeight: 800, lineHeight: 1.2, margin: '0 0 16px', letterSpacing: -0.5 }}>
            Centralized Inventory<br />Management Tool
          </h1>
          <p style={{ color: '#93c5fd', fontSize: 14, lineHeight: 1.7, margin: '0 0 40px' }}>
            Track assets across regions, manage allocations, generate barcodes, and maintain a complete audit trail — all from one place.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { icon: '📍', label: 'Multi-region inventory tracking' },
              { icon: '🔖', label: 'Barcode generation & scanning' },
              { icon: '📊', label: 'Real-time dashboard & reports' },
              { icon: '🔒', label: 'Role-based access control' },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 16 }}>{f.icon}</span>
                <span style={{ color: '#e0f2fe', fontSize: 13, fontWeight: 500 }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ color: '#475569', fontSize: 12 }}>© 2026 P3 Acclivis Technology · Version 1.0</div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 6px', letterSpacing: -0.3 }}>Welcome back</h2>
          <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 32px' }}>Sign in to your InventoryHub account</p>

          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              placeholder="you@p3acclivis.com"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{ width: '100%', padding: '11px 14px', border: error ? '1.5px solid #ef4444' : '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, color: '#111827', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="Enter your password"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{ width: '100%', padding: '11px 44px 11px 14px', border: error ? '1.5px solid #ef4444' : '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, color: '#111827', boxSizing: 'border-box', outline: 'none' }}
              />
              <button onClick={() => setShowPass(s => !s)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2 }}>
                <EyeIcon open={showPass} />
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{ width: '100%', padding: '13px', background: loading ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.15s' }}>
            {loading ? (
              <><svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} style={{ animation: 'spin 0.8s linear infinite' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Signing in…</>
            ) : 'Sign In'}
          </button>

          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

          <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Demo Accounts — click to fill</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MOCK_USERS.map(u => (
                <button key={u.email} onClick={() => handleQuickLogin(u)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: ROLE_COLORS[u.role] + '20', color: ROLE_COLORS[u.role], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{u.avatar}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{u.email}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: ROLE_COLORS[u.role], background: ROLE_COLORS[u.role] + '15', padding: '3px 8px', borderRadius: 99 }}>{u.role}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'inventory', label: 'Inventory', icon: 'inventory' },
  { key: 'barcode', label: 'Barcodes', icon: 'barcode' },
  { key: 'allocation', label: 'Allocations', icon: 'allocate' },
  { key: 'returns', label: 'Returns', icon: 'return' },
  { key: 'notifications', label: 'Notifications', icon: 'bell' },
  { key: 'reports', label: 'Reports', icon: 'report' },
  { key: 'audit', label: 'Audit Trail', icon: 'audit' },
  { key: 'bulk', label: 'Bulk Ops', icon: 'bulk' },
  { key: 'miscellaneous', label: 'Miscellaneous', icon: 'bulk', dividerBefore: true },
]

const MISC_CATEGORIES = [
  { key: 'Consumables', label: 'Consumables', desc: 'Cables, adapters, batteries, pen drives', color: '#2563eb', bg: '#eff6ff' },
  { key: 'Tools & Equipment', label: 'Tools & Equipment', desc: 'Screwdrivers, multimeters, testing kits', color: '#d97706', bg: '#fffbeb' },
  { key: 'Damaged / Scrap', label: 'Damaged / Scrap', desc: 'Broken units, write-offs, disposal queue', color: '#dc2626', bg: '#fef2f2' },
  { key: 'Spare Parts', label: 'Spare Parts', desc: 'Replacement components, extra hardware', color: '#16a34a', bg: '#f0fdf4' },
  { key: 'Lost / Missing', label: 'Lost / Missing', desc: 'Unaccounted items under investigation', color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'Returned Items', label: 'Returned Items', desc: 'Items returned from engineers or clients', color: '#0891b2', bg: '#ecfeff' },
  { key: 'Documents', label: 'Documents', desc: 'Warranties, manuals, purchase invoices', color: '#374151', bg: '#f9fafb' },
]

const MISC_ICONS = {
  'Consumables': <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path d="M21 10H3M21 6H3M21 14H3M21 18H3"/></svg>,
  'Tools & Equipment': <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  'Damaged / Scrap': <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  'Spare Parts': <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
  'Lost / Missing': <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  'Returned Items': <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.29"/></svg>,
  'Documents': <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
}

const SOURCE_CATS = ['Consumables', 'Tools & Equipment', 'Spare Parts']
const TRACKING_CATS = ['Lost / Missing', 'Returned Items', 'Damaged / Scrap']

const TRACKING_FLAG = {
  'Lost / Missing': 'isLost',
  'Returned Items': 'isReturned',
  'Damaged / Scrap': 'isDamaged',
}

const TRACKING_LABEL = {
  'Lost / Missing': { mark: 'Mark as Lost', unmark: 'Unmark Lost', color: '#7c3aed', bg: '#f5f3ff' },
  'Returned Items': { mark: 'Mark as Returned', unmark: 'Unmark Returned', color: '#0891b2', bg: '#ecfeff' },
  'Damaged / Scrap': { mark: 'Mark as Damaged', unmark: 'Unmark Damaged', color: '#dc2626', bg: '#fef2f2' },
}

function Miscellaneous({ items, setItems, activeCat, setActiveCat }) {
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', qty: '', unit: '', remark: '', status: 'In Stock' })
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const STATUS_COLORS = {
    'In Stock': { color: '#16a34a', bg: '#f0fdf4' },
    'Low Stock': { color: '#d97706', bg: '#fffbeb' },
    'Out of Stock': { color: '#dc2626', bg: '#fef2f2' },
    'Under Review': { color: '#0891b2', bg: '#ecfeff' },
  }

  const handleAdd = () => {
    if (!form.name.trim() || !activeCat) return
    const newItem = { id: Date.now(), ...form, sourceCategory: activeCat, date: new Date().toLocaleDateString(), isLost: false, isReturned: false, isDamaged: false }
    setItems(prev => [...prev, newItem])
    setForm({ name: '', qty: '', unit: '', remark: '', status: 'In Stock' })
    setShowAdd(false)
  }

  const handleDelete = (id) => {
    if (!confirm('Remove this item?')) return
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const toggleFlag = (id, flag) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [flag]: !i[flag] } : i))
  }

  // Get items for a category view
  const getItemsForCat = (catKey) => {
    if (SOURCE_CATS.includes(catKey)) return items.filter(i => i.sourceCategory === catKey)
    const flag = TRACKING_FLAG[catKey]
    return items.filter(i => i[flag])
  }

  const countForCat = (catKey) => getItemsForCat(catKey).length

  const BackBtn = () => (
    <button onClick={() => { setActiveCat(null); setShowAdd(false); setForm({ name: '', qty: '', unit: '', remark: '', status: 'In Stock' }) }} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
      <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> Back
    </button>
  )

  if (activeCat) {
    const cat = MISC_CATEGORIES.find(c => c.key === activeCat)
    const catItems = getItemsForCat(activeCat)
    const isTracking = TRACKING_CATS.includes(activeCat)
    const tl = isTracking ? TRACKING_LABEL[activeCat] : null
    const flag = isTracking ? TRACKING_FLAG[activeCat] : null

    return (
      <div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <BackBtn />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cat.color }}>{MISC_ICONS[cat.key]}</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#111827' }}>{cat.label}</h2>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{isTracking ? `Showing all items marked as ${cat.label.toLowerCase()} from Consumables, Tools & Equipment, and Spare Parts` : cat.desc}</div>
            </div>
          </div>
          {!isTracking && (
            <div style={{ marginLeft: 'auto' }}>
              <button onClick={() => setShowAdd(true)} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Item
              </button>
            </div>
          )}
          {isTracking && (
            <div style={{ marginLeft: 'auto', background: tl.bg, border: `1px solid ${tl.color}30`, borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: tl.color }}>
              {catItems.length} item{catItems.length !== 1 ? 's' : ''} flagged
            </div>
          )}
        </div>

        {/* Tracking banner */}
        {isTracking && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            To add items here, go to <strong style={{ margin: '0 4px' }}>Consumables</strong>, <strong style={{ margin: '0 4px' }}>Tools & Equipment</strong>, or <strong style={{ margin: '0 4px' }}>Spare Parts</strong> and use the <em>"{tl?.mark}"</em> action on any row.
          </div>
        )}

        {/* Add form (source cats only) */}
        {!isTracking && showAdd && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700, color: '#111827' }}>Add to {cat.label}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>Item Name *</label>
                <input value={form.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. USB-C Cable 1m" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>Quantity</label>
                <input value={form.qty} onChange={e => setF('qty', e.target.value)} placeholder="e.g. 10" type="number" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>Unit</label>
                <input value={form.unit} onChange={e => setF('unit', e.target.value)} placeholder="e.g. pcs, boxes, kg" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>Status</label>
                <select value={form.status} onChange={e => setF('status', e.target.value)} style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13, color: '#374151', boxSizing: 'border-box' }}>
                  {Object.keys(STATUS_COLORS).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>Remark</label>
                <input value={form.remark} onChange={e => setF('remark', e.target.value)} placeholder="Any additional details…" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowAdd(false)} style={{ padding: '9px 18px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>Cancel</button>
              <button onClick={handleAdd} style={{ padding: '9px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add Item</button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {catItems.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '48px 24px', textAlign: 'center', color: '#9ca3af' }}>
            <div style={{ marginBottom: 8, opacity: 0.35, display: 'flex', justifyContent: 'center' }}>{MISC_ICONS[cat.key]}</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {isTracking ? `No items flagged as ${cat.label} yet` : `No items yet in ${cat.label}`}
            </div>
            <div style={{ fontSize: 12 }}>
              {isTracking ? `Go to a source category and use "${tl?.mark}" to flag items here` : 'Click "Add Item" to get started'}
            </div>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {[
                    'Item Name',
                    ...(isTracking ? ['Source'] : []),
                    'Qty', 'Unit', 'Status', 'Remark', 'Added On',
                    ...(isTracking ? ['Lost', 'Returned', 'Damaged'] : ['Mark as', 'Actions'])
                  ].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catItems.map((item, idx) => {
                  const sc = STATUS_COLORS[item.status] || STATUS_COLORS['In Stock']
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#111827' }}>{item.name}</td>
                      {isTracking && <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 11, background: '#f3f4f6', color: '#374151', borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>{item.sourceCategory}</span></td>}
                      <td style={{ padding: '10px 14px', color: '#374151' }}>{item.qty || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#6b7280' }}>{item.unit || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.color }}>{item.status}</span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#6b7280', maxWidth: 160 }}>{item.remark || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>{item.date}</td>

                      {/* Source cat: show 3 flag buttons + delete */}
                      {!isTracking && <>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <button onClick={() => toggleFlag(item.id, 'isLost')} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${item.isLost ? '#7c3aed' : '#e5e7eb'}`, background: item.isLost ? '#f5f3ff' : '#fff', color: item.isLost ? '#7c3aed' : '#6b7280', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {item.isLost ? '✓ Lost' : 'Lost'}
                            </button>
                            <button onClick={() => toggleFlag(item.id, 'isReturned')} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${item.isReturned ? '#0891b2' : '#e5e7eb'}`, background: item.isReturned ? '#ecfeff' : '#fff', color: item.isReturned ? '#0891b2' : '#6b7280', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {item.isReturned ? '✓ Returned' : 'Returned'}
                            </button>
                            <button onClick={() => toggleFlag(item.id, 'isDamaged')} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${item.isDamaged ? '#dc2626' : '#e5e7eb'}`, background: item.isDamaged ? '#fef2f2' : '#fff', color: item.isDamaged ? '#dc2626' : '#6b7280', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {item.isDamaged ? '✓ Damaged' : 'Damaged'}
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <button onClick={() => handleDelete(item.id)} style={{ background: '#fef2f2', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: '#dc2626', fontSize: 12, fontWeight: 600 }}>Delete</button>
                        </td>
                      </>}

                      {/* Tracking cat: show flag status cells */}
                      {isTracking && <>
                        <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 12, fontWeight: 700, color: item.isLost ? '#7c3aed' : '#d1d5db' }}>{item.isLost ? '✓' : '—'}</span></td>
                        <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 12, fontWeight: 700, color: item.isReturned ? '#0891b2' : '#d1d5db' }}>{item.isReturned ? '✓' : '—'}</span></td>
                        <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 12, fontWeight: 700, color: item.isDamaged ? '#dc2626' : '#d1d5db' }}>{item.isDamaged ? '✓' : '—'}</span></td>
                      </>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // Landing grid
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#111827' }}>Miscellaneous</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>Track consumables, tools, spare parts, and other assets. Items added in source categories automatically reflect in Lost / Missing, Returned Items, and Damaged / Scrap.</p>
      </div>

      <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Source Categories — add items here</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 28 }}>
        {MISC_CATEGORIES.filter(c => SOURCE_CATS.includes(c.key)).map(cat => {
          const count = countForCat(cat.key)
          return (
            <button key={cat.key} onClick={() => setActiveCat(cat.key)}
              style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = cat.color }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cat.color }}>{MISC_ICONS[cat.key]}</div>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{count}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{cat.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{cat.desc}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: cat.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                Manage <svg width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </button>
          )
        })}
      </div>

      <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tracking Categories — auto-populated from source items</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {MISC_CATEGORIES.filter(c => TRACKING_CATS.includes(c.key)).map(cat => {
          const count = countForCat(cat.key)
          return (
            <button key={cat.key} onClick={() => setActiveCat(cat.key)}
              style={{ background: '#fff', border: '1.5px dashed #e5e7eb', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = cat.color }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cat.color }}>{MISC_ICONS[cat.key]}</div>
                <span style={{ fontSize: 22, fontWeight: 800, color: count > 0 ? cat.color : '#d1d5db' }}>{count}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{cat.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{cat.desc}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: count > 0 ? cat.color : '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}>
                {count > 0 ? 'View flagged items' : 'No items flagged yet'} <svg width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </button>
          )
        })}
        {/* Documents card */}
        {MISC_CATEGORIES.filter(c => c.key === 'Documents').map(cat => {
          const count = countForCat(cat.key)
          return (
            <button key={cat.key} onClick={() => setActiveCat(cat.key)}
              style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = cat.color }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cat.color }}>{MISC_ICONS[cat.key]}</div>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{count}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{cat.label}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{cat.desc}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: cat.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                Manage <svg width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getStoredUser() {
  try {
    const token = localStorage.getItem('accessToken')
    const raw = localStorage.getItem('currentUser')
    // Only restore session if BOTH token AND user exist
    if (!token || !raw) {
      localStorage.removeItem('currentUser')
      localStorage.removeItem('accessToken')
      return null
    }
    return JSON.parse(raw)
  } catch {
    localStorage.removeItem('currentUser')
    localStorage.removeItem('accessToken')
    return null
  }
}

export default function InventoryApp() {
  const [currentUser, setCurrentUser] = useState(getStoredUser)
  const [authToken, setAuthToken] = useState(() => getToken())
  const [page, setPage] = useState('dashboard')
  const [inventory, setInventory] = useState(INITIAL_INVENTORY)
  const [auditLog, setAuditLog] = useState(INITIAL_AUDIT)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [miscItems, setMiscItems] = useState([])
  const [miscActiveCat, setMiscActiveCat] = useState(null)

  // ── Live locations & categories ─────────────────────────────────────────────
  const [rawLocations, setRawLocations] = useState([])
  const [rawCategories, setRawCategories] = useState([])
  const [locations, setLocations] = useState(REGIONS)
  const [categories, setCategories] = useState(INVENTORY_CATEGORIES)
  const [locLoading, setLocLoading] = useState(false)
  const [catLoading, setCatLoading] = useState(false)
  const [locError, setLocError] = useState(null)
  const [catError, setCatError] = useState(null)

  useEffect(() => {
    if (!currentUser || !authToken) return

    setLocLoading(true)
    apiFetch('/api/locations')
      .then(data => {
        const list = Array.isArray(data) ? data : (data.data || data.results || [])
        const active = list.filter(l => l.is_active !== false)
        setRawLocations(active)
        if (active.length > 0)
          setLocations(active.map(l => l.location_label || l.region || l.name || String(l)))
        setLocError(null)
      })
      .catch(() => setLocError('Could not load locations — using defaults.'))
      .finally(() => setLocLoading(false))

    setCatLoading(true)
    apiFetch('/api/categories')
      .then(data => {
        const list = Array.isArray(data) ? data : (data.data || data.results || [])
        const active = list.filter(c => c.is_active !== false)
        setRawCategories(active)
        if (active.length > 0)
          setCategories(active.map(c => c.name || c.category_name || c.title || String(c)))
        setCatError(null)
      })
      .catch(() => setCatError('Could not load categories — using defaults.'))
      .finally(() => setCatLoading(false))
  }, [authToken])
  // ───────────────────────────────────────────────────────────────────────────

  const handleLogout = () => {
    setCurrentUser(null)
    setAuthToken(null)
    setPage('dashboard')
    localStorage.removeItem('currentUser')
    clearToken()
    clearRefreshToken()
  }

  // If a protected API returns 401, invalidate the local session.
  useEffect(() => {
    const handleAuthExpired = () => {
      setCurrentUser(null)
      setAuthToken(null)
      setPage('dashboard')
      localStorage.removeItem('currentUser')
      clearToken()
      clearRefreshToken()
    }

    window.addEventListener('auth-expired', handleAuthExpired)
    return () => window.removeEventListener('auth-expired', handleAuthExpired)
  }, [])

  if (!currentUser) {
    return <SignIn onLogin={(user, token) => {
      // Store the fresh token BEFORE setting currentUser.
      if (!token) return

      storeToken(token)
      setAuthToken(token)
      localStorage.setItem('currentUser', JSON.stringify(user))
      setCurrentUser(user)
      setPage('dashboard')
    }} />
  }

  const role = currentUser.role

  const ROLE_TABS = {
    Administrator: NAV.map(n => n.key),
    'Inventory Manager': ['dashboard', 'inventory', 'barcode', 'allocation', 'returns', 'notifications', 'reports', 'bulk', 'miscellaneous'],
    Engineer: ['dashboard', 'allocation', 'returns', 'miscellaneous'],
    'Read-Only': ['dashboard', 'inventory', 'reports', 'miscellaneous'],
  }
  const allowed = ROLE_TABS[role] || []

  // For Engineer: rename "Returns" → "Reallocation" in sidebar
  const getNavLabel = (key) => {
    if (role === 'Engineer' && key === 'returns') return 'Reallocation'
    return NAV.find(n => n.key === key)?.label || key
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Inter', 'Segoe UI', sans-serif", background: '#f3f4f6' }}>
      <div style={{ width: sidebarOpen ? 220 : 56, background: '#111827', color: '#fff', display: 'flex', flexDirection: 'column', transition: 'width 0.2s', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 64 }}>
          {sidebarOpen && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: -0.3 }}>InventoryHub</span>
              <div style={{ background: '#fff', borderRadius: 6, padding: '3px 6px', display: 'flex', alignItems: 'center' }}>
                <P3Logo height={16} />
              </div>
            </div>
          )}
          <button onClick={() => setSidebarOpen(s => !s)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4, marginLeft: sidebarOpen ? 0 : 'auto' }}>
            <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        <nav style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
          {NAV.filter(n => allowed.includes(n.key)).map(n => (
            <div key={n.key}>
              {n.dividerBefore && sidebarOpen && (
                <div style={{ padding: '12px 12px 4px', fontSize: 10, fontWeight: 700, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Miscellaneous</div>
              )}
              {n.dividerBefore && !sidebarOpen && (
                <div style={{ height: 1, background: '#1f2937', margin: '8px 4px' }} />
              )}
              <button key={n.key} onClick={() => setPage(n.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none', background: page === n.key ? '#1d4ed8' : 'none', color: page === n.key ? '#fff' : '#9ca3af', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: page === n.key ? 700 : 500, marginBottom: 2, transition: 'background 0.15s' }}>
                <span style={{ flexShrink: 0 }}>
                  {n.key === 'miscellaneous'
                    ? <svg width={16} height={16} fill="none" stroke={page === n.key ? '#fff' : '#9ca3af'} strokeWidth={2} viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    : <Icon name={n.icon} size={16} color={page === n.key ? '#fff' : '#9ca3af'} />
                  }
                </span>
                {sidebarOpen && <span>{getNavLabel(n.key)}</span>}
              </button>
            </div>
          ))}
        </nav>
        {sidebarOpen && (
          <div style={{ padding: '16px', borderTop: '1px solid #1f2937' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{currentUser.avatar}</div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser.name}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{currentUser.role}</div>
              </div>
            </div>
            <button onClick={handleLogout} style={{ width: '100%', padding: '8px 12px', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}><span style={{ fontWeight: 700, color: '#111827' }}>{getNavLabel(page)}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '4px 12px', borderRadius: 99, fontWeight: 600 }}>{role}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{currentUser.name}</span>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800 }}>{currentUser.avatar}</div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {page === 'dashboard' && <Dashboard inventory={inventory} currentUser={currentUser} />}
          {page === 'inventory' && <InventoryTable inventory={inventory} setInventory={setInventory} auditLog={auditLog} setAuditLog={setAuditLog} role={role} currentUser={currentUser} locations={locations} categories={categories} rawLocations={rawLocations} rawCategories={rawCategories} locLoading={locLoading} catLoading={catLoading} locError={locError} catError={catError} />}
          {page === 'barcode' && <BarcodeSection inventory={inventory} />}
          {page === 'allocation' && <AllocationSection inventory={inventory} setInventory={setInventory} auditLog={auditLog} setAuditLog={setAuditLog} currentUser={currentUser} />}
          {page === 'returns' && <ReturnSection inventory={inventory} currentUser={currentUser} />}
          {page === 'notifications' && <Notifications inventory={inventory} />}
          {page === 'reports' && <Reports inventory={inventory} />}
          {page === 'audit' && <AuditTrail auditLog={auditLog} />}
          {page === 'bulk' && <BulkOperations inventory={inventory} setInventory={setInventory} auditLog={auditLog} setAuditLog={setAuditLog} />}
          {page === 'miscellaneous' && <Miscellaneous items={miscItems} setItems={setMiscItems} activeCat={miscActiveCat} setActiveCat={setMiscActiveCat} />}
        </div>
      </div>
    </div>
  )
}
