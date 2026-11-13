import { catalog } from './catalog';
import { buildPrompt } from './prompt';
Object.assign(globalThis, { mechDesign: { catalog, buildPrompt } });
