import * as React from 'react'

type IconNode = Array<[string, Record<string, string | number>]> 

function createIcon(iconName: string, iconNode: IconNode) {
  return React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement> & { size?: number | string; color?: string; strokeWidth?: number | string }>((props, ref) => {
    const { size = 24, color = 'currentColor', strokeWidth = 2, children, ...rest } = props
    return React.createElement(
      'svg',
      {
        ref,
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        role: 'img',
        'data-lucide': iconName,
        ...rest,
      },
      iconNode.map(([tag, attrs], index) => React.createElement(tag, { key: `${iconName}-${index}`, ...attrs })),
      children
    )
  })
}

const Activity = createIcon('Activity', [["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2","key":"169zse"}]])
const AlertCircle = createIcon('AlertCircle', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12","key":"1pkeuh"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16","key":"4dfq90"}]])
const AlertTriangle = createIcon('AlertTriangle', [["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","key":"wmoenq"}],["path",{"d":"M12 9v4","key":"juzpu7"}],["path",{"d":"M12 17h.01","key":"p32p05"}]])
const ArrowLeft = createIcon('ArrowLeft', [["path",{"d":"m12 19-7-7 7-7","key":"1l729n"}],["path",{"d":"M19 12H5","key":"x3x0zl"}]])
const ArrowRight = createIcon('ArrowRight', [["path",{"d":"M5 12h14","key":"1ays0h"}],["path",{"d":"m12 5 7 7-7 7","key":"xquz4c"}]])
const ArrowUpDown = createIcon('ArrowUpDown', [["path",{"d":"m21 16-4 4-4-4","key":"f6ql7i"}],["path",{"d":"M17 20V4","key":"1ejh1v"}],["path",{"d":"m3 8 4-4 4 4","key":"11wl7u"}],["path",{"d":"M7 4v16","key":"1glfcx"}]])
const Banknote = createIcon('Banknote', [["rect",{"width":"20","height":"12","x":"2","y":"6","rx":"2","key":"9lu3g6"}],["circle",{"cx":"12","cy":"12","r":"2","key":"1c9p78"}],["path",{"d":"M6 12h.01M18 12h.01","key":"113zkx"}]])
const Bell = createIcon('Bell', [["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0","key":"vwvbt9"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326","key":"11g9vi"}]])
const Bookmark = createIcon('Bookmark', [["path",{"d":"M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z","key":"oz39mx"}]])
const Boxes = createIcon('Boxes', [["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z","key":"lc1i9w"}],["path",{"d":"m7 16.5-4.74-2.85","key":"1o9zyk"}],["path",{"d":"m7 16.5 5-3","key":"va8pkn"}],["path",{"d":"M7 16.5v5.17","key":"jnp8gn"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z","key":"8zsnat"}],["path",{"d":"m17 16.5-5-3","key":"8arw3v"}],["path",{"d":"m17 16.5 4.74-2.85","key":"8rfmw"}],["path",{"d":"M17 16.5v5.17","key":"k6z78m"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z","key":"1xygjf"}],["path",{"d":"M12 8 7.26 5.15","key":"1vbdud"}],["path",{"d":"m12 8 4.74-2.85","key":"3rx089"}],["path",{"d":"M12 13.5V8","key":"1io7kd"}]])
const Building2 = createIcon('Building2', [["path",{"d":"M10 12h4","key":"a56b0p"}],["path",{"d":"M10 8h4","key":"1sr2af"}],["path",{"d":"M14 21v-3a2 2 0 0 0-4 0v3","key":"1rgiei"}],["path",{"d":"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2","key":"secmi2"}],["path",{"d":"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16","key":"16ra0t"}]])
const Calendar = createIcon('Calendar', [["path",{"d":"M8 2v3","key":"1ioesn"}],["path",{"d":"M16 2v3","key":"otl347"}],["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2","key":"h1oib"}],["path",{"d":"M3 9h18","key":"1pudct"}]])
const Check = createIcon('Check', [["path",{"d":"M20 6 9 17l-5-5","key":"1gmf2c"}]])
const CheckCheck = createIcon('CheckCheck', [["path",{"d":"M18 6 7 17l-5-5","key":"116fxf"}],["path",{"d":"m22 10-7.5 7.5L13 16","key":"ke71qq"}]])
const CheckCircle2 = createIcon('CheckCircle2', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["path",{"d":"m9 12 2 2 4-4","key":"dzmm74"}]])
const CheckIcon = createIcon('CheckIcon', [["path",{"d":"M20 6 9 17l-5-5","key":"1gmf2c"}]])
const ChevronDown = createIcon('ChevronDown', [["path",{"d":"m6 9 6 6 6-6","key":"qrunsl"}]])
const ChevronDownIcon = createIcon('ChevronDownIcon', [["path",{"d":"m6 9 6 6 6-6","key":"qrunsl"}]])
const ChevronLeft = createIcon('ChevronLeft', [["path",{"d":"m15 18-6-6 6-6","key":"1wnfg3"}]])
const ChevronLeftIcon = createIcon('ChevronLeftIcon', [["path",{"d":"m15 18-6-6 6-6","key":"1wnfg3"}]])
const ChevronRight = createIcon('ChevronRight', [["path",{"d":"m9 18 6-6-6-6","key":"mthhwq"}]])
const ChevronRightIcon = createIcon('ChevronRightIcon', [["path",{"d":"m9 18 6-6-6-6","key":"mthhwq"}]])
const ChevronUpIcon = createIcon('ChevronUpIcon', [["path",{"d":"m18 15-6-6-6 6","key":"153udz"}]])
const ChevronsUpDown = createIcon('ChevronsUpDown', [["path",{"d":"m7 15 5 5 5-5","key":"1hf1tw"}],["path",{"d":"m7 9 5-5 5 5","key":"sgt6xg"}]])
const CircleCheckIcon = createIcon('CircleCheckIcon', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["path",{"d":"m9 12 2 2 4-4","key":"dzmm74"}]])
const CircleIcon = createIcon('CircleIcon', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}]])
const Coins = createIcon('Coins', [["path",{"d":"M13.744 17.736a6 6 0 1 1-7.48-7.48","key":"bq4yh3"}],["path",{"d":"M15 6h1v4","key":"11y1tn"}],["path",{"d":"m6.134 14.768.866-.5 2 3.464","key":"17snzx"}],["circle",{"cx":"16","cy":"8","r":"6","key":"14bfc9"}]])
const Copy = createIcon('Copy', [["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2","key":"17jyea"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2","key":"zix9uf"}]])
const Crosshair = createIcon('Crosshair', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["line",{"x1":"22","x2":"18","y1":"12","y2":"12","key":"l9bcsi"}],["line",{"x1":"6","x2":"2","y1":"12","y2":"12","key":"13hhkx"}],["line",{"x1":"12","x2":"12","y1":"6","y2":"2","key":"10w3f3"}],["line",{"x1":"12","x2":"12","y1":"22","y2":"18","key":"15g9kq"}]])
const Database = createIcon('Database', [["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3","key":"msslwz"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5","key":"1wlel7"}],["path",{"d":"M3 12A9 3 0 0 0 21 12","key":"mv7ke4"}]])
const DollarSign = createIcon('DollarSign', [["line",{"x1":"12","x2":"12","y1":"2","y2":"22","key":"7eqyqh"}],["path",{"d":"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6","key":"1b0p4s"}]])
const Download = createIcon('Download', [["path",{"d":"M12 15V3","key":"m9g1x1"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","key":"ih7n3h"}],["path",{"d":"m7 10 5 5 5-5","key":"brsn70"}]])
const Eye = createIcon('Eye', [["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0","key":"1nclc0"}],["circle",{"cx":"12","cy":"12","r":"3","key":"1v7zrd"}]])
const FileSpreadsheet = createIcon('FileSpreadsheet', [["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","key":"1oefj6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5","key":"wfsgrz"}],["path",{"d":"M8 13h2","key":"yr2amv"}],["path",{"d":"M14 13h2","key":"un5t4a"}],["path",{"d":"M8 17h2","key":"2yhykz"}],["path",{"d":"M14 17h2","key":"10kma7"}]])
const FileText = createIcon('FileText', [["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","key":"1oefj6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5","key":"wfsgrz"}],["path",{"d":"M10 9H8","key":"b1mrlr"}],["path",{"d":"M16 13H8","key":"t4e002"}],["path",{"d":"M16 17H8","key":"z1uh3a"}]])
const GripVerticalIcon = createIcon('GripVerticalIcon', [["circle",{"cx":"9","cy":"12","r":"1","key":"1vctgf"}],["circle",{"cx":"9","cy":"5","r":"1","key":"hp0tcf"}],["circle",{"cx":"9","cy":"19","r":"1","key":"fkjjf6"}],["circle",{"cx":"15","cy":"12","r":"1","key":"1tmaij"}],["circle",{"cx":"15","cy":"5","r":"1","key":"19l28e"}],["circle",{"cx":"15","cy":"19","r":"1","key":"f4zoj3"}]])
const Hash = createIcon('Hash', [["line",{"x1":"4","x2":"20","y1":"9","y2":"9","key":"4lhtct"}],["line",{"x1":"4","x2":"20","y1":"15","y2":"15","key":"vyu0kd"}],["line",{"x1":"10","x2":"8","y1":"3","y2":"21","key":"1ggp8o"}],["line",{"x1":"16","x2":"14","y1":"3","y2":"21","key":"weycgp"}]])
const History = createIcon('History', [["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8","key":"1357e3"}],["path",{"d":"M3 3v5h5","key":"1xhq8a"}],["path",{"d":"M12 7v5l4 2","key":"1fdv2h"}]])
const ImageIcon = createIcon('ImageIcon', [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2","key":"1m3agn"}],["circle",{"cx":"9","cy":"9","r":"2","key":"af1f0g"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21","key":"1xmnt7"}]])
const Info = createIcon('Info', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["path",{"d":"M12 16v-4","key":"1dtifu"}],["path",{"d":"M12 8h.01","key":"e9boi3"}]])
const InfoIcon = createIcon('InfoIcon', [["circle",{"cx":"12","cy":"12","r":"10","key":"1mglay"}],["path",{"d":"M12 16v-4","key":"1dtifu"}],["path",{"d":"M12 8h.01","key":"e9boi3"}]])
const Landmark = createIcon('Landmark', [["path",{"d":"M10 18v-7","key":"wt116b"}],["path",{"d":"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z","key":"yxxwt6"}],["path",{"d":"M14 18v-7","key":"vav6t3"}],["path",{"d":"M18 18v-7","key":"aexdmj"}],["path",{"d":"M3 22h18","key":"8prr45"}],["path",{"d":"M6 18v-7","key":"1ivflk"}]])
const Languages = createIcon('Languages', [["path",{"d":"m5 8 6 6","key":"1wu5hv"}],["path",{"d":"m4 14 6-6 2-3","key":"1k1g8d"}],["path",{"d":"M2 5h12","key":"or177f"}],["path",{"d":"M7 2h1","key":"1t2jsx"}],["path",{"d":"m22 22-5-10-5 10","key":"don7ne"}],["path",{"d":"M14 18h6","key":"1m8k6r"}]])
const Layers = createIcon('Layers', [["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z","key":"zw3jo"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12","key":"1wduqc"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17","key":"kqbvx6"}]])
const LayoutDashboard = createIcon('LayoutDashboard', [["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1","key":"10lvy0"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1","key":"16une8"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1","key":"1hutg5"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1","key":"ldoo1y"}]])
const Loader2Icon = createIcon('Loader2Icon', [["path",{"d":"M21 12a9 9 0 1 1-6.219-8.56","key":"13zald"}]])
const Mail = createIcon('Mail', [["path",{"d":"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7","key":"132q7q"}],["rect",{"x":"2","y":"4","width":"20","height":"16","rx":"2","key":"izxlao"}]])
const MapPin = createIcon('MapPin', [["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0","key":"1r0f0z"}],["circle",{"cx":"12","cy":"10","r":"3","key":"ilqhr7"}]])
const MinusIcon = createIcon('MinusIcon', [["path",{"d":"M5 12h14","key":"1ays0h"}]])
const Moon = createIcon('Moon', [["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401","key":"kfwtm"}]])
const MoreHorizontal = createIcon('MoreHorizontal', [["circle",{"cx":"12","cy":"12","r":"1","key":"41hilf"}],["circle",{"cx":"19","cy":"12","r":"1","key":"1wjl8i"}],["circle",{"cx":"5","cy":"12","r":"1","key":"1pcz8c"}]])
const MoreHorizontalIcon = createIcon('MoreHorizontalIcon', [["circle",{"cx":"12","cy":"12","r":"1","key":"41hilf"}],["circle",{"cx":"19","cy":"12","r":"1","key":"1wjl8i"}],["circle",{"cx":"5","cy":"12","r":"1","key":"1pcz8c"}]])
const OctagonXIcon = createIcon('OctagonXIcon', [["path",{"d":"m15 9-6 6","key":"1uzhvr"}],["path",{"d":"M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z","key":"2d38gg"}],["path",{"d":"m9 9 6 6","key":"z0biqf"}]])
const Package = createIcon('Package', [["path",{"d":"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z","key":"1a0edw"}],["path",{"d":"M12 22V12","key":"d0xqtd"}],["polyline",{"points":"3.29 7 12 12 20.71 7","key":"ousv84"}],["path",{"d":"m7.5 4.27 9 5.15","key":"1c824w"}]])
const PanelLeftIcon = createIcon('PanelLeftIcon', [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","key":"afitv7"}],["path",{"d":"M9 3v18","key":"fh3hqa"}]])
const Paperclip = createIcon('Paperclip', [["path",{"d":"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551","key":"1miecu"}]])
const Phone = createIcon('Phone', [["path",{"d":"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384","key":"9njp5v"}]])
const Pin = createIcon('Pin', [["path",{"d":"M12 17v5","key":"bb1du9"}],["path",{"d":"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z","key":"1nkz8b"}]])
const Plus = createIcon('Plus', [["path",{"d":"M5 12h14","key":"1ays0h"}],["path",{"d":"M12 5v14","key":"s699le"}]])
const Receipt = createIcon('Receipt', [["path",{"d":"M12 17V7","key":"pyj7ub"}],["path",{"d":"M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8","key":"1elt7d"}],["path",{"d":"M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z","key":"ycz6yz"}]])
const RefreshCw = createIcon('RefreshCw', [["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","key":"v9h5vc"}],["path",{"d":"M21 3v5h-5","key":"1q7to0"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","key":"3uifl3"}],["path",{"d":"M8 16H3v5","key":"1cv678"}]])
const RotateCcw = createIcon('RotateCcw', [["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8","key":"1357e3"}],["path",{"d":"M3 3v5h5","key":"1xhq8a"}]])
const Save = createIcon('Save', [["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z","key":"1c8476"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7","key":"1ydtos"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7","key":"t51u73"}]])
const Search = createIcon('Search', [["path",{"d":"m21 21-4.34-4.34","key":"14j7rj"}],["circle",{"cx":"11","cy":"11","r":"8","key":"4ej97u"}]])
const SearchIcon = createIcon('SearchIcon', [["path",{"d":"m21 21-4.34-4.34","key":"14j7rj"}],["circle",{"cx":"11","cy":"11","r":"8","key":"4ej97u"}]])
const ScrollText = createIcon('ScrollText', [["path",{"d":"M15 12h-5","key":"r7krc0"}],["path",{"d":"M15 8h-5","key":"1khuty"}],["path",{"d":"M19 17V5a2 2 0 0 0-2-2H4","key":"zz82l3"}],["path",{"d":"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3","key":"1ph1d7"}]])
const Settings = createIcon('Settings', [["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915","key":"1i5ecw"}],["circle",{"cx":"12","cy":"12","r":"3","key":"1v7zrd"}]])
const Shield = createIcon('Shield', [["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z","key":"oel41y"}]])
const ShoppingCart = createIcon('ShoppingCart', [["circle",{"cx":"8","cy":"21","r":"1","key":"jimo8o"}],["circle",{"cx":"19","cy":"21","r":"1","key":"13723u"}],["path",{"d":"M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12","key":"9zh506"}]])
const Sparkles = createIcon('Sparkles', [["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z","key":"1s2grr"}],["path",{"d":"M20 2v4","key":"1rf3ol"}],["path",{"d":"M22 4h-4","key":"gwowj6"}],["circle",{"cx":"4","cy":"20","r":"2","key":"6kqj1y"}]])
const StickyNote = createIcon('StickyNote', [["path",{"d":"M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z","key":"1dfntj"}],["path",{"d":"M15 3v5a1 1 0 0 0 1 1h5","key":"6s6qgf"}]])
const Sun = createIcon('Sun', [["circle",{"cx":"12","cy":"12","r":"4","key":"4exip2"}],["path",{"d":"M12 2v2","key":"tus03m"}],["path",{"d":"M12 20v2","key":"1lh1kg"}],["path",{"d":"m4.93 4.93 1.41 1.41","key":"149t6j"}],["path",{"d":"m17.66 17.66 1.41 1.41","key":"ptbguv"}],["path",{"d":"M2 12h2","key":"1t8f8n"}],["path",{"d":"M20 12h2","key":"1q8mjw"}],["path",{"d":"m6.34 17.66-1.41 1.41","key":"1m8zz5"}],["path",{"d":"m19.07 4.93-1.41 1.41","key":"1shlcs"}]])
const ToggleLeft = createIcon('ToggleLeft', [["circle",{"cx":"9","cy":"12","r":"3","key":"u3jwor"}],["rect",{"width":"20","height":"14","x":"2","y":"5","rx":"7","key":"g7kal2"}]])
const ToggleRight = createIcon('ToggleRight', [["circle",{"cx":"15","cy":"12","r":"3","key":"1afu0r"}],["rect",{"width":"20","height":"14","x":"2","y":"5","rx":"7","key":"g7kal2"}]])
const Trash2 = createIcon('Trash2', [["path",{"d":"M10 11v6","key":"nco0om"}],["path",{"d":"M14 11v6","key":"outv1u"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6","key":"miytrc"}],["path",{"d":"M3 6h18","key":"d0wm0j"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2","key":"e791ji"}]])
const TrendingDown = createIcon('TrendingDown', [["path",{"d":"M16 17h6v-6","key":"t6n2it"}],["path",{"d":"m22 17-8.5-8.5-5 5L2 7","key":"x473p"}]])
const TrendingUp = createIcon('TrendingUp', [["path",{"d":"M16 7h6v6","key":"box55l"}],["path",{"d":"m22 7-8.5 8.5-5-5L2 17","key":"1t1m79"}]])
const TriangleAlertIcon = createIcon('TriangleAlertIcon', [["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","key":"wmoenq"}],["path",{"d":"M12 9v4","key":"juzpu7"}],["path",{"d":"M12 17h.01","key":"p32p05"}]])
const Truck = createIcon('Truck', [["path",{"d":"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2","key":"wrbu53"}],["path",{"d":"M15 18H9","key":"1lyqi6"}],["path",{"d":"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14","key":"lysw3i"}],["circle",{"cx":"17","cy":"18","r":"2","key":"332jqn"}],["circle",{"cx":"7","cy":"18","r":"2","key":"19iecd"}]])
const Upload = createIcon('Upload', [["path",{"d":"M12 3v12","key":"1x0j5s"}],["path",{"d":"m17 8-5-5-5 5","key":"7q97r8"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","key":"ih7n3h"}]])
const UserPlus = createIcon('UserPlus', [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","key":"1yyitq"}],["circle",{"cx":"9","cy":"7","r":"4","key":"nufk8"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14","key":"1bvyxn"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11","key":"1shjgl"}]])
const Users = createIcon('Users', [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","key":"1yyitq"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744","key":"16gr8j"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87","key":"kshegd"}],["circle",{"cx":"9","cy":"7","r":"4","key":"nufk8"}]])
const X = createIcon('X', [["path",{"d":"M18 6 6 18","key":"1bl5f8"}],["path",{"d":"m6 6 12 12","key":"d8bk6v"}]])
const XIcon = createIcon('XIcon', [["path",{"d":"M18 6 6 18","key":"1bl5f8"}],["path",{"d":"m6 6 12 12","key":"d8bk6v"}]])
const Zap = createIcon('Zap', [["path",{"d":"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z","key":"1v7up4"}]])

export { Activity }
export { AlertCircle }
export { AlertTriangle }
export { ArrowLeft }
export { ArrowRight }
export { ArrowUpDown }
export { Banknote }
export { Bell }
export { Bookmark }
export { Boxes }
export { Building2 }
export { Calendar }
export { Check }
export { CheckCheck }
export { CheckCircle2 }
export { CheckIcon }
export { ChevronDown }
export { ChevronDownIcon }
export { ChevronLeft }
export { ChevronLeftIcon }
export { ChevronRight }
export { ChevronRightIcon }
export { ChevronUpIcon }
export { ChevronsUpDown }
export { CircleCheckIcon }
export { CircleIcon }
export { Coins }
export { Copy }
export { Crosshair }
export { Database }
export { DollarSign }
export { Download }
export { Eye }
export { FileSpreadsheet }
export { FileText }
export { GripVerticalIcon }
export { Hash }
export { History }
export { ImageIcon }
export { Info }
export { InfoIcon }
export { Landmark }
export { Languages }
export { Layers }
export { LayoutDashboard }
export { Loader2Icon }
export { Mail }
export { MapPin }
export { MinusIcon }
export { Moon }
export { MoreHorizontal }
export { MoreHorizontalIcon }
export { OctagonXIcon }
export { Package }
export { PanelLeftIcon }
export { Paperclip }
export { Phone }
export { Pin }
export { Plus }
export { Receipt }
export { RefreshCw }
export { RotateCcw }
export { Save }
export { Search }
export { SearchIcon }
export { ScrollText }
export { Settings }
export { Shield }
export { ShoppingCart }
export { Sparkles }
export { StickyNote }
export { Sun }
export { ToggleLeft }
export { ToggleRight }
export { Trash2 }
export { TrendingDown }
export { TrendingUp }
export { TriangleAlertIcon }
export { Truck }
export { Upload }
export { UserPlus }
export { Users }
export { X }
export { XIcon }
export { Zap }
