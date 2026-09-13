const fs = require('fs');
const path = require('path');
const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s, 'utf8');

function replaceRequired(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`Expected block not found: ${label}`);
  return text.replace(oldText, newText);
}

// --- App.tsx: remove only references to the retired systems ---
let app = read('App.tsx');
for (const line of [
  "import SourceCodeModal from './components/SourceCodeModal';\n",
  "import SubscriptionModal from './components/SubscriptionModal';\n",
  "import { subscriptionService } from './services/subscriptionService';\n",
  "import { ActivationModal } from './components/ActivationModal';\n"
]) {
  app = replaceRequired(app, line, '', line.trim());
}

const activationStartMarker = '    // 🔒 暂时取消“防爆仓救世之星，安全授权锁”验证';
const activationEndMarker = '    const [systemEvents, setSystemEvents]';
const activationStart = app.indexOf(activationStartMarker);
const activationEnd = app.indexOf(activationEndMarker, activationStart);
if (activationStart < 0 || activationEnd < 0 || activationEnd <= activationStart) {
  throw new Error('Activation state block markers not found; refusing to edit App.tsx');
}
app = app.slice(0, activationStart) + app.slice(activationEnd);

app = replaceRequired(app, "    const [showSourceCode, setShowSourceCode] = useState(false);\n", '', 'showSourceCode state');
app = replaceRequired(app, "    const [showSubscription, setShowSubscription] = useState(false);\n", '', 'showSubscription state');

const subscriptionEffect = `    useEffect(() => {\n        const status = subscriptionService.getLicenseStatus();\n        if (!status.isActive) {\n            setShowSubscription(true);\n        }\n    }, []);\n\n`;
app = replaceRequired(app, subscriptionEffect, '', 'subscription effect');

const activationRender = `            {showSecurityLockModal && (\n                <ActivationModal \n                    isActivated={isSystemActivated}\n                    isOpen={showSecurityLockModal}\n                    onClose={() => setShowSecurityLockModal(false)}\n                    onActivated={handleSystemActivated} \n                />\n            )}\n`;
app = replaceRequired(app, activationRender, '', 'activation render');

app = replaceRequired(app, "                    onViewSource={() => setShowSourceCode(true)}\n", '', 'SettingsPanel source callback');
app = replaceRequired(app, "            {showSourceCode && <SourceCodeModal onClose={() => setShowSourceCode(false)} />}\n", '', 'source modal render');

const subscriptionRender = `            <SubscriptionModal \n                isOpen={showSubscription} \n                onSuccess={() => setShowSubscription(false)} \n                isLocked={!subscriptionService.getLicenseStatus().isActive}\n                onClose={() => setShowSubscription(false)}\n            />\n`;
app = replaceRequired(app, subscriptionRender, '', 'subscription modal render');

write('App.tsx', app);

// --- SettingsPanel: source-view prop no longer exists ---
let settingsPanel = read('components/SettingsPanel.tsx');
settingsPanel = replaceRequired(settingsPanel, '    onViewSource: () => void;\n', '', 'SettingsPanel onViewSource prop');
write('components/SettingsPanel.tsx', settingsPanel);

// --- types.ts: remove retired subscription-only types ---
let types = read('types.ts');
const retiredTypes = `export interface LicenseInfo {\n    isActive: boolean;\n    expirationDate: number;\n    planName: string;\n}\n\nexport interface SubscriptionPlan {\n    id: string;\n    name: string;\n    durationMonths: number;\n    price: number;\n    tag?: string;\n    popular?: boolean;\n}\n\n`;
types = replaceRequired(types, retiredTypes, '', 'subscription types');
write('types.ts', types);

// --- Delete the now-unreferenced compatibility files ---
for (const p of [
  'components/SourceCodeModal.tsx',
  'components/ActivationModal.tsx',
  'components/SubscriptionModal.tsx',
  'services/subscriptionService.ts'
]) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) throw new Error(`Expected retired file not found: ${p}`);
  fs.unlinkSync(full);
}

// Verify no functional remnants remain in TypeScript source.
const forbidden = [
  'SourceCodeModal', 'ActivationModal', 'SubscriptionModal', 'subscriptionService',
  'showSourceCode', 'showSubscription', 'showSecurityLockModal', 'isSystemActivated',
  'open_security_lock', 'SAVIOR_ACTIVATED', 'LicenseInfo', 'SubscriptionPlan',
  '/api/activation/', '/api/export-project', '/api/download-pc-installer', '/api/download-mobile-app'
];
const scanRoots = ['App.tsx', 'server.ts', 'types.ts', 'components', 'modules', 'services', 'utils'];
function walk(p) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) return [];
  const st = fs.statSync(full);
  if (st.isFile()) return /\.(ts|tsx)$/.test(p) ? [p] : [];
  return fs.readdirSync(full).flatMap(n => walk(path.join(p, n)));
}
const files = scanRoots.flatMap(walk);
for (const file of files) {
  const text = read(file);
  for (const token of forbidden) {
    if (text.includes(token)) throw new Error(`Retired token ${token} still present in ${file}`);
  }
}

// one-shot scaffolding removes itself and its workflow from the resulting tree
for (const p of ['scripts/remove-legacy-ui-once.cjs', '.github/workflows/remove-legacy-ui-once.yml']) {
  const full = path.join(root, p);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

console.log('Legacy UI/subscription/activation systems fully removed from tracked TypeScript source.');
