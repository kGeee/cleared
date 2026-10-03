// Demo workspace for the Operations and Growth teammates (from the product film).
// These apps (Excel, Cin7, ShipBob, SPS Commerce) aren't connected in this POC, so their data is simulated
// and labeled "Preview" in the UI. Finance comes from the server (QuickBooks, Outlook, OneDrive).

export const BRAND = 'Fable Grove';

export const EMAILS = [
  {
    id: 'kehe-po-1042', team: 'ops', from: 'KeHE purchasing', fromAddress: 'orders@kehe.example', time: '8:47 AM', unread: true,
    subject: 'PO 1042 · 120 cases', preview: 'Please confirm the ship plan',
    body: 'Please confirm the ship plan for this order.',
    fields: [['PO', '1042'], ['SKU', 'FG-12'], ['Quantity', '120 cases'], ['Requested ship', 'Friday']],
  },
  {
    id: 'east-wh', team: 'ops', from: 'East warehouse', fromAddress: 'east@3pl.example', time: '8:31 AM', unread: true,
    subject: 'Stock check', preview: '90 cases FG-12 eligible',
    body: 'Stock check for FG-12: 90 cases are eligible to release. Send a release by noon for a Friday pickup.',
  },
  {
    id: 'freight', team: 'ops', from: 'Freight broker', fromAddress: 'quotes@freight.example', time: '8:20 AM', unread: true,
    subject: 'Split-shipment quote', preview: 'Need the final case count',
    body: 'Happy to quote a split LTL pickup (East + West) for Friday. I need the final case count. A split pickup from both warehouses on Friday is $420 total. If you wait for one full load from East next week, it is about $240.',
  },
  {
    id: 'west-wh', team: 'ops', from: 'West warehouse', fromAddress: 'west@3pl.example', time: 'Wed', unread: false,
    subject: 'Allocation', preview: '30 cases ready to allocate',
    body: '30 cases of FG-12 are ready to allocate from West.',
  },
  {
    id: 'retail-broker', team: 'growth', from: 'Retail broker', fromAddress: 'broker@retailbroker.example', time: 'Wed', unread: false,
    subject: 'Friday launch', preview: 'Kit checklist attached',
    body: "Kit checklist for Friday's retail launch is attached. 12 sampling slots across the stores on the list. Can you confirm the final kit and that every slot is locked?",
    attachments: ['Retail_Broker_Kit.pdf'],
  },
  {
    id: 'samples', team: 'growth', from: 'Co-packer', fromAddress: 'ops@copacker.example', time: 'Tue', unread: false,
    subject: 'Product samples', preview: 'Samples ship Wednesday, due Thursday',
    body: 'Product samples for the launch ship Wednesday and are due Thursday. Tracking to follow.',
  },
];

export const STOCK = [
  { sku: 'FG-12', wh: 'East', available: 90, release: 'Pending' },
  { sku: 'FG-12', wh: 'West', available: 30, release: 'Pending' },
  { sku: 'FG-18', wh: 'East', available: 64, release: '' },
  { sku: 'FG-18', wh: 'West', available: 48, release: '' },
  { sku: 'FG-24', wh: 'East', available: 112, release: '' },
  { sku: 'FG-24', wh: 'West', available: 0, release: 'Restock Tue' },
];

export const PO = {
  customer: 'KeHE', po: '1042', sku: 'FG-12', cases: 120, ship: 'Friday',
  split: [{ wh: 'East', cases: 90, release: 'WR-2291' }, { wh: 'West', cases: 30, release: 'WR-2292' }],
  freight: { quote: 420, wait: 240, updated: 480 }, pallets: 6,
};

export const LAUNCH = {
  title: "Friday's retail launch",
  stores: [
    { name: 'Maple Market', slots: 1, email: 'buyer@maplemarket.example', ask: 'Confirm your Friday sampling slot?' },
    { name: 'Harbor Pantry', slots: 1, email: 'buyer@harborpantry.example', ask: 'Confirm your Friday sampling slot?' },
    { name: '10 other stores', slots: 10, confirmed: true },
  ],
  broker: { email: 'broker@retailbroker.example', ask: 'Updated kit attached. Confirm receipt?' },
  samples: 'Product samples due Thursday · delivery pending',
};

// Simple packaging mockups for the brand assets (fictional brand).
export function productSvg(version) {
  const v3 = version === 'v3';
  const bag = v3 ? '#e9f2e6' : '#d9cfbf';
  const band = v3 ? '#2f7a3b' : '#8a7b62';
  const label = v3 ? 'Fable Grove' : 'FABLE GROVE';
  return `<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Product image ${version}">
    <path d="M28 18 h64 l8 14 v104 a6 6 0 0 1 -6 6 h-68 a6 6 0 0 1 -6 -6 v-104z" fill="${bag}" stroke="#00000022"/>
    <rect x="22" y="52" width="76" height="42" fill="${band}"/>
    ${v3 ? '<circle cx="60" cy="66" r="7" fill="#e9f2e6"/><path d="M60 59 q6 -6 9 -1 q-5 2 -9 1z" fill="#a8d5a0"/>' : ''}
    <text x="60" y="${v3 ? 88 : 78}" font-family="Plus Jakarta Sans, sans-serif" font-size="${v3 ? 11 : 10}" font-weight="800" text-anchor="middle" fill="#fff">${label}</text>
    <text x="60" y="118" font-family="Plus Jakarta Sans, sans-serif" font-size="8" text-anchor="middle" fill="#33433a">${v3 ? 'Approved · v3' : 'Old image · v2'}</text>
  </svg>`;
}

export const ASSETS = [
  { name: 'FG_Product_Image_v2.png', status: 'In broker kit', kind: 'image', version: 'v2' },
  { name: 'FG_Product_Image_v3.png', status: 'Approved', kind: 'image', version: 'v3' },
  { name: 'Retail_Broker_Kit.pdf', status: 'Uses v2', kind: 'kit' },
];
