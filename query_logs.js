const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.systemLog.findMany({
    where: { message: { contains: 'Slot 75' } },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.dir(logs.map(l => `[${l.createdAt.toISOString()}] ${l.message}`).reverse(), { depth: null });
}
main().catch(console.error).finally(() => prisma.$disconnect());
