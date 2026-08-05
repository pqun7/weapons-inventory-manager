import { writeFileSync } from 'fs'
import dyn from './node_modules/lucide-react/dist/esm/dynamicIconImports.mjs'

const icons = [
    'Activity', 'AlertCircle', 'AlertTriangle', 'ArrowLeft', 'ArrowRight', 'ArrowUpDown', 'Banknote', 'Bell', 'Bookmark', 'Boxes', 'Building2', 'Calendar', 'Check', 'CheckCheck', 'CheckCircle2', 'CheckIcon', 'ChevronDown', 'ChevronDownIcon', 'ChevronLeft', 'ChevronLeftIcon', 'ChevronRight', 'ChevronRightIcon', 'ChevronUpIcon', 'ChevronsUpDown', 'CircleCheckIcon', 'CircleIcon', 'Coins', 'Copy', 'Crosshair', 'Database', 'DollarSign', 'Download', 'Eye', 'FileSpreadsheet', 'FileText', 'GripVerticalIcon', 'Hash', 'History', 'ImageIcon', 'Info', 'InfoIcon', 'Landmark', 'Languages', 'Layers', 'LayoutDashboard', 'Loader2Icon', 'Mail', 'MapPin', 'MinusIcon', 'Moon', 'MoreHorizontal', 'MoreHorizontalIcon', 'OctagonXIcon', 'Package', 'PanelLeftIcon', 'Paperclip', 'Phone', 'Pin', 'Plus', 'Receipt', 'RefreshCw', 'RotateCcw', 'Save', 'Search', 'SearchIcon', 'ScrollText', 'Settings', 'Shield', 'ShoppingCart', 'Sparkles', 'StickyNote', 'Sun', 'ToggleLeft', 'ToggleRight', 'Trash2', 'TrendingDown', 'TrendingUp', 'TriangleAlertIcon', 'Truck', 'Upload', 'UserPlus', 'Users', 'X', 'XIcon', 'Zap'
]

function toKey(name) {
    const base = name.endsWith('Icon') ? name.slice(0, -4) : name
    let output = ''
    for (let index = 0; index < base.length; index += 1) {
        const ch = base[index]
        const prev = base[index - 1]
        const next = base[index + 1]
        const isUpper = ch >= 'A' && ch <= 'Z'
        const isLower = ch >= 'a' && ch <= 'z'
        const isDigit = ch >= '0' && ch <= '9'
        const prevLowerOrDigit = prev ? ((prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9')) : false
        const nextLower = next ? (next >= 'a' && next <= 'z') : false
        if (index > 0 && isUpper && (prevLowerOrDigit || (prev && prev >= 'A' && prev <= 'Z' && nextLower))) {
            output += '-'
        }
        if (index > 0 && isDigit && prev && ((prev >= 'a' && prev <= 'z') || (prev >= 'A' && prev <= 'Z'))) {
            output += '-'
        }
        output += ch.toLowerCase()
    }
    return output
}

const lines = []
lines.push("import * as React from 'react'")
lines.push("")
lines.push("type IconNode = Array<[string, Record<string, string | number>]> ")
lines.push("")
lines.push("function createIcon(iconName: string, iconNode: IconNode) {")
lines.push("  return React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement> & { size?: number | string; color?: string; strokeWidth?: number | string }>((props, ref) => {")
lines.push("    const { size = 24, color = 'currentColor', strokeWidth = 2, children, ...rest } = props")
lines.push("    return React.createElement(")
lines.push("      'svg',")
lines.push("      {")
lines.push("        ref,")
lines.push("        xmlns: 'http://www.w3.org/2000/svg',")
lines.push("        width: size,")
lines.push("        height: size,")
lines.push("        viewBox: '0 0 24 24',")
lines.push("        fill: 'none',")
lines.push("        stroke: color,")
lines.push("        strokeWidth,")
lines.push("        strokeLinecap: 'round',")
lines.push("        strokeLinejoin: 'round',")
lines.push("        role: 'img',")
lines.push("        'data-lucide': iconName,")
lines.push("        ...rest,")
lines.push("      },")
lines.push("      iconNode.map(([tag, attrs], index) => React.createElement(tag, { key: `${iconName}-${index}`, ...attrs })),")
lines.push("      children")
lines.push("    )")
lines.push("  })")
lines.push("}")
lines.push("")

for (const name of icons) {
    const key = toKey(name)
    const importFactory = dyn[key]
    if (!importFactory) throw new Error(`Missing dynamic import entry for ${name} (${key})`)
    const match = importFactory.toString().match(/\.\/icons\/(.+?)'/)
    if (!match) throw new Error(`Could not parse import path for ${name} (${key})`)
    const mod = await import(`./node_modules/lucide-react/dist/esm/icons/${match[1]}`)
    const iconNode = mod.__iconNode
    if (!iconNode) throw new Error(`Missing icon node for ${name} (${key})`)
    lines.push(`const ${name} = createIcon('${name}', ${JSON.stringify(iconNode)})`)
}

lines.push("")
for (const name of icons) {
    lines.push(`export { ${name} }`)
}

writeFileSync(new URL('./src/lib/lucide-icons.tsx', import.meta.url), lines.join('\n') + '\n')
console.log('generated src/lib/lucide-icons.tsx')
