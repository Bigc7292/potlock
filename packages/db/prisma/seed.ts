import { STARTER_GRANT_PC } from "@potlock/shared";
import { prisma } from "../src/client.js";
import { createUserWithGrant, findUserByHandle } from "../src/users.js";

/** Eight dummy players, each with the 2,000 PC starter grant. Password for all: potlock. */
const SEED_HANDLES = ["vesper_k", "rook", "mako", "juniper", "cinder", "halyard", "quill", "sable"];

async function main(): Promise<void> {
  for (const handle of SEED_HANDLES) {
    if (await findUserByHandle(handle)) {
      console.log(`  ${handle} already exists`);
      continue;
    }
    await createUserWithGrant({ handle, password: "potlock" });
    console.log(`  ${handle} created with ${STARTER_GRANT_PC} PC`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
