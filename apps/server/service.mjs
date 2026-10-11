// @ts-check
import node from "@prisma/composer/node";
import { compute } from "@prisma/composer-prisma-cloud";
import { postgres, dataContract } from "@prisma/composer-prisma-cloud/orm";
import serverContractJson from "./src/prisma/contract.json" with { type: "json" };

export default compute({
  name: "server",
  deps: { db: postgres(dataContract(serverContractJson)) },
  build: node({ module: import.meta.url, dir: "dist", entry: "index.js" }),
});
