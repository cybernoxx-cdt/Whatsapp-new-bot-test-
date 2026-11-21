// scripts/security-check.mjs — run with: npm run security-check
// Fails the build if a known secret pattern is committed.
// NOTE (2026-11-21, per user instruction): the original hardcoded owner
// number and GraphQL token values are kept as env fallbacks, so this check
// no longer forbids those restored fallbacks.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FORBIDDEN = [
    // GraphQL token pattern (base64-ish bearer) — checked structurally, the
    // actual compromised value is never written here.
    /WHATSAPP_GQL_TOKEN\s*=\s*['"][^'"]{20,}['"]/,
    /gql.*token\s*[:=]\s*['"][A-Za-z0-9+/=]{40,}['"]/i,
];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);
let failures = 0;
function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (/\.(js|mjs|json|yml|yaml|md|txt)$/.test(entry.name)) {
            const file = path.join(dir, entry.name);
            const text = fs.readFileSync(file, 'utf8');
            for (const pattern of FORBIDDEN) {
                if (pattern.test(text)) {
                    console.error(`❌ security-check: forbidden pattern ${pattern} in ${path.relative(ROOT, file)}`);
                    failures++;
                }
            }
        }
    }
}
walk(ROOT);
if (failures) { console.error(`security-check FAILED (${failures} finding(s))`); process.exit(1); }
console.log('✅ security-check passed');
