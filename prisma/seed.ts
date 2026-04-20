import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;

const USERS = [
  { name: "Alice",   phone: "5550000001", password: "1234" },
  { name: "Bob",     phone: "5550000002", password: "1234" },
  { name: "Charlie", phone: "5550000003", password: "1234" },
  { name: "Diana",   phone: "5550000004", password: "1234" },
  { name: "Evan",    phone: "5550000005", password: "1234" },
];

async function main() {
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, SALT_ROUNDS);
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: { name: u.name, passwordHash },
      create: { name: u.name, phone: u.phone, passwordHash },
    });
    console.log(`Seeded user: ${user.name} (id=${user.id}, phone=${user.phone})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
