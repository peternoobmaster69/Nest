import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

const prisma = new PrismaClient();
try {
  const cards = await prisma.creditCardAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      cardName: true,
      last4Digit: true,
      encryptedCardNumber: true,
      encryptionIv: true,
      encryptionTag: true,
      encryptedSecurityCode: true,
      securityCodeIv: true,
      securityCodeTag: true,
    },
  });
  console.log(JSON.stringify(cards.map((c) => ({
    id: c.id,
    cardName: c.cardName,
    last4: c.last4Digit,
    hasCardEnc: Boolean(c.encryptedCardNumber && c.encryptionIv && c.encryptionTag),
    hasCvvEnc: Boolean(c.encryptedSecurityCode && c.securityCodeIv && c.securityCodeTag),
    cardCipherLen: c.encryptedCardNumber ? c.encryptedCardNumber.length : 0,
  })), null, 2));
} finally {
  await prisma.$disconnect();
}
