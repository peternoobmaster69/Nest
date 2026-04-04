import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const workspaceId='cmmfpkqfw000ojhu89r79lbay';
  const frequentFlyerId='cmmfy9mut0001jh9cead97joq';
  const today=new Date('2026-03-09T00:00:00.000Z');
  const rows=await prisma.mileProgram.findMany({
    where:{workspaceId,frequentFlyerId,OR:[{expiryDate:null},{expiryDate:{gte:today}}],firstRedeemedDate:{not:null},balanceMiles:{gt:0}},
    orderBy:{balanceMiles:'desc'},
    select:{id:true,date:true,title:true,balanceMiles:true,firstRedeemedDate:true,expiryDate:true}
  });
  const sum=rows.reduce((s,r)=>s+r.balanceMiles,0);
  console.log('count',rows.length,'sum',sum);
  console.log(JSON.stringify(rows.slice(-5),null,2));
}

main().catch((e)=>{console.error(e);process.exit(1)}).finally(async()=>{await prisma.$disconnect()});
