// @ts-check
import { module } from "@prisma/composer";
import { postgres, dataContract } from "@prisma/composer-prisma-cloud/orm";
import serverContractJson from "./apps/server/src/prisma/contract.json" with { type: "json" };
import serverService from "./apps/server/service.mjs";

export default module("mono-pos", ({ provision }) => {
  const database = provision(postgres({ name: "database", contract: dataContract(serverContractJson), config: "./apps/server/prisma.config.ts" }));
  provision(serverService, { deps: { db: database } });
});
