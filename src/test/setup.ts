import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
Object.defineProperty(globalThis, 'matchMedia', { value: () => ({ matches:false, addEventListener(){}, removeEventListener(){} }), configurable: true });
