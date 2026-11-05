# 🛡️ CLAUDE.md - Project Engineering & AI Consistency Directive

## Project Vision & Architecture
This project is an advanced Binance futures risk management and automated crypto discovery system (**0211自动找币防爆仓救世之星**).

## Core Engineering Directives

### 1. Web & PC Client 100% Behavioral Parity (跨端绝对一致性)
- **Zero Divergence**: Web Browser environment and packaged PC Client (Electron) MUST run the exact same business logic, calculation pipelines, scanner rules, and UI interactions.
- **Network Proxy Alignment**: All API proxy requests must use `getProxyUrl` / `fetchWithFallback` to ensure `http://127.0.0.1:3000/api/proxy` is resolved seamlessly under both `http://` and `file://` protocols.
- **Config Sanitize Guard**: Storage values are automatically sanitized via `sanitizeConfigObject` on boot (`autoHealLocalStorage`) to clean `NaN`, `null`, or undefined values.

### 2. UI & Interaction Discipline
- **Input Focus**: Inputs, textareas, and selects override Electron drag regions with `-webkit-app-region: no-drag !important` and `user-select: text !important`.
- **No Native Alert Locks**: Never use native `window.alert()` or `window.confirm()` in desktop mode to avoid WebContents focus traps.
- **Non-blocking Modals**: System status alerts (such as IP change alerts) must remain non-blocking with explicit skip buttons, enabling full simulation mode functionality without private API whitelists.

### 3. Atomic Code Locks
- Preserve locked modules (`services/rules/`, `modules/profit-manager/`, `modules/hedge-guardian/`, `modules/rescue-tactics/`) unless explicitly directed by the user.

### 4. Build Pipeline Cleanliness
- Packaging scripts (`npm run build`, `dist:win`, `dist:mac`) enforce typechecking (`tsc --noEmit`) and fresh Vite builds before bundling Electron assets.
