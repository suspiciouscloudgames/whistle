import { rolldown } from "rolldown";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const build = await rolldown({input:join(root,"scripts/serve.ts"),platform:"node",external:["ws"]});
try { await build.write({file:resolve(process.argv[2]),format:"esm"}); }
finally { await build.close(); }
