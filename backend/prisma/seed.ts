import { PrismaClient, Role } from '@prisma/client';

/**
 * Demo data from the brief: Anika (centre), Dev, Meera, Kabir (district officers),
 * Neha (quality team), Farah (state office). Safe to run many times (upserts only).
 */
const prisma = new PrismaClient();

async function main() {
  const pune = await prisma.district.upsert({ where: { name: 'Pune' }, update: {}, create: { name: 'Pune' } });
  const nagpur = await prisma.district.upsert({ where: { name: 'Nagpur' }, update: {}, create: { name: 'Nagpur' } });

  const anikaCentre = await prisma.trainingCentre.upsert({
    where: { code: 'PSM-PUN-001' },
    update: {},
    create: { code: 'PSM-PUN-001', name: 'Anika Skills Academy, Pune', districtId: pune.id },
  });
  // A second centre in another district, to show officers only see their own district.
  await prisma.trainingCentre.upsert({
    where: { code: 'PSM-NAG-001' },
    update: {},
    create: { code: 'PSM-NAG-001', name: 'Vidarbha Training Centre, Nagpur', districtId: nagpur.id },
  });

  const users = [
    { username: 'anika', name: 'Anika', role: Role.CENTRE, centreId: anikaCentre.id, districtId: pune.id },
    { username: 'dev', name: 'Dev', role: Role.DISTRICT_OFFICER, districtId: pune.id },
    { username: 'meera', name: 'Meera', role: Role.DISTRICT_OFFICER, districtId: pune.id },
    { username: 'kabir', name: 'Kabir', role: Role.DISTRICT_OFFICER, districtId: pune.id },
    { username: 'neha', name: 'Neha', role: Role.QUALITY },
    { username: 'farah', name: 'Farah', role: Role.STATE },
  ];
  for (const user of users) {
    await prisma.user.upsert({ where: { username: user.username }, update: {}, create: user });
  }

  // One batch already waiting for district review, so officers have something to try at once.
  const existing = await prisma.batch.count();
  if (existing === 0) {
    const anika = await prisma.user.findUniqueOrThrow({ where: { username: 'anika' } });
    await prisma.batch.create({
      data: {
        code: 'B-DEMO-0001',
        centreId: anikaCentre.id,
        courseCode: 'ELEC-101',
        courseName: 'Assistant Electrician',
        status: 'DISTRICT_REVIEW',
        submittedAt: new Date(),
        createdById: anika.id,
        candidates: {
          create: [
            { rowNumber: 2, enrolmentId: 'PSM24-0001', name: 'Ravi Kumar', phone: '+919876543210', score: 78 },
            { rowNumber: 3, enrolmentId: 'PSM24-0002', name: 'Priya Sharma', phone: '+919876543211', score: 85 },
            { rowNumber: 4, enrolmentId: 'PSM24-0003', name: 'Arjun Patil', phone: '+919876543212', score: 64 },
            { rowNumber: 5, enrolmentId: 'PSM24-0004', name: 'Sneha Deshmukh', phone: '+919876543213', score: 91 },
            { rowNumber: 6, enrolmentId: 'PSM24-0005', name: 'Imran Shaikh', phone: '+919876543214', score: 57 },
          ],
        },
      },
    });
  }
  console.log('Seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
