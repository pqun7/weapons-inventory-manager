import dyn from './node_modules/lucide-react/dist/esm/dynamicIconImports.mjs'

const names = ['Activity', 'AlertCircle', 'AlertTriangle', 'ArrowLeft', 'ArrowRight', 'ArrowUpDown', 'Banknote', 'Bell', 'Bookmark', 'Boxes', 'Building2', 'Calendar', 'Check', 'CheckCheck', 'CheckCircle2', 'CheckIcon', 'ChevronDown', 'ChevronDownIcon', 'ChevronLeft', 'ChevronLeftIcon', 'ChevronRight', 'ChevronRightIcon', 'ChevronUpIcon', 'ChevronsUpDown', 'CircleCheckIcon', 'CircleIcon', 'Coins', 'Copy', 'Crosshair', 'Database', 'DollarSign', 'Download', 'Eye', 'FileSpreadsheet', 'FileText', 'GripVerticalIcon', 'Hash', 'History', 'ImageIcon', 'Info', 'InfoIcon', 'Landmark', 'Languages', 'Layers', 'LayoutDashboard', 'Loader2Icon', 'Mail', 'MapPin', 'MinusIcon', 'Moon', 'MoreHorizontal', 'MoreHorizontalIcon', 'OctagonXIcon', 'Package', 'PanelLeftIcon', 'Paperclip', 'Phone', 'Pin', 'Plus', 'Receipt', 'RefreshCw', 'RotateCcw', 'Save', 'Search', 'SearchIcon', 'ScrollText', 'Settings', 'Shield', 'ShoppingCart', 'Sparkles', 'StickyNote', 'Sun', 'ToggleLeft', 'ToggleRight', 'Trash2', 'TrendingDown', 'TrendingUp', 'TriangleAlertIcon', 'Truck', 'Upload', 'UserPlus', 'Users', 'X', 'XIcon', 'Zap']

function toKebab(name) {
    const base = name.endsWith('Icon') ? name.slice(0, -4) : name
    let output = ''
    for (let index = 0; index < base.length; index += 1) {
        const ch = base[index]
        const prev = base[index - 1]
        const next = base[index + 1]
        const isUpper = ch >= 'A' && ch <= 'Z'
        const isDigit = ch >= '0' && ch <= '9'
        const prevLowerOrDigit = prev ? ((prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9')) : false
        const nextLower = next ? (next >= 'a' && next <= 'z') : false
        if (index > 0 && isUpper && (prevLowerOrDigit || (prev && prev >= 'A' && prev <= 'Z' && nextLower))) {
            output += '-'
        }
        output += ch.toLowerCase()
        if (isDigit && next && next >= 'A' && next <= 'Z') {
            output += '-'
        }
    }
    return output
}

for (const name of names) {
    const key = toKebab(name)
    const has = Object.prototype.hasOwnProperty.call(dyn, key)
    console.log(`${name}\t${key}\t${has ? 'ok' : 'MISS'}`)
    if (!has) {
        const hits = Object.keys(dyn).filter((candidate) => candidate.includes(key.split('-')[0])).slice(0, 8)
        console.log(`  hits: ${hits.join(', ')}`)
    }
}
