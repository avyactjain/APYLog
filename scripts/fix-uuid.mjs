import { rmSync } from "node:fs";
import { join } from "node:path";

const nestedUuid = join(process.cwd(), "node_modules/rpc-websockets/node_modules/uuid");
rmSync(nestedUuid, { recursive: true, force: true });
