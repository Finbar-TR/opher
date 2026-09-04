// Promotes an existing account to operator.
//
// Signing up always creates an ordinary member (`role` defaults to "member" in
// the schema, and nothing in the auth actions ever changes it), so the first
// operator on a fresh database has to be made by hand. This is that step.
//
// It deliberately does NOT create the account: sign up through the site first,
// so the password is one you chose and was hashed the same way every other
// password is.
//
// Usage (via the wrapper, which prompts for both values):
//   .\scripts\make-operator.ps1

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const email = (process.env.OPERATOR_EMAIL ?? "").trim().toLowerCase();

  if (!email) {
    throw new Error("OPERATOR_EMAIL is not set. Run this through scripts/make-operator.ps1.");
  }
  if (!url) {
    throw new Error("DATABASE_URL is not set. Run this through scripts/make-operator.ps1.");
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!existing) {
    const count = await prisma.user.count();
    throw new Error(
      `No account found for ${email}.\n` +
        `Sign up on the live site with that address first, then run this again.\n` +
        `(The database currently holds ${count} account${count === 1 ? "" : "s"}.)`
    );
  }

  if (existing.role === "operator") {
    console.log(`${existing.email} is already an operator. Nothing to do.`);
    return;
  }

  const updated = await prisma.user.update({
    where: { email },
    data: { role: "operator" },
    select: { email: true, name: true, role: true },
  });

  console.log(`${updated.email} (${updated.name}) is now an operator.`);
  console.log("Sign out and back in, then visit /operator.");
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
