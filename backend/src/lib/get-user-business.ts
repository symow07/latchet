import { prisma } from "../prisma";

export async function getUserBusiness(userId: string) {
  const owned = await prisma.business.findUnique({ where: { ownerId: userId } });
  if (owned) return owned;
  const m = await prisma.teamMember.findFirst({
    where: { userId },
    include: { business: true },
  });
  return m?.business ?? null;
}
